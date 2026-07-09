/**
 * Syncs all custom fields from Jira QAB into local QABOAR tickets.
 * Only updates tickets where each field is currently NULL.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });

const JIRA_BASE = 'https://cf2020.atlassian.net';
const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const TOKEN     = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const HEADERS   = { Authorization: `Basic ${AUTH}`, Accept: 'application/json' };

const FIELD_MAP = {
  customerName:   'customfield_10401',
  clientName:     'customfield_10883',
  projectManager: 'customfield_11380',
  productType:    'customfield_10203',
  combination:    'customfield_10236',
};
const JIRA_FIELDS = Object.values(FIELD_MAP).join(',');

function extractValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number') return String(raw);
  if (Array.isArray(raw)) {
    const vals = raw.map(v => v?.value ?? v?.name ?? v?.displayName ?? String(v)).filter(Boolean);
    return vals.length ? vals.join(', ') : null;
  }
  return raw.value ?? raw.name ?? raw.displayName ?? raw.emailAddress ?? null;
}

async function main() {
  const space = await db.space.findFirst({ where: { key: 'QABOAR' } });

  // Get all QABOAR issues that are missing at least one field
  const allIssues = await db.issue.findMany({
    where: {
      spaceId: space.id,
      OR: [
        { combination: null },
        { customerName: null },
        { clientName: null },
        { projectManager: null },
        { productType: null },
      ],
    },
    select: { id: true, key: true, combination: true, customerName: true, clientName: true, projectManager: true, productType: true },
  });

  console.log(`${allIssues.length} QABOAR tickets have at least one missing field`);

  let updated = 0;
  const BATCH = 100;

  for (let i = 0; i < allIssues.length; i += BATCH) {
    const batch = allIssues.slice(i, i + BATCH);
    const keys = batch.map(x => x.key).join(',');
    const jql = encodeURIComponent(`issueKey in (${keys})`);
    const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&maxResults=${BATCH}&fields=${JIRA_FIELDS}`;

    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) { console.error('Jira error:', res.status); continue; }
      const data = await res.json();

      for (const ji of (data.issues || [])) {
        const local = batch.find(x => x.key === ji.key);
        if (!local) continue;

        const patch = {};
        for (const [ourKey, jiraFieldId] of Object.entries(FIELD_MAP)) {
          if (local[ourKey] !== null) continue; // already has value
          const val = extractValue(ji.fields?.[jiraFieldId]);
          if (val) patch[ourKey] = val;
        }

        if (Object.keys(patch).length === 0) continue;

        await db.issue.update({ where: { key: ji.key }, data: patch });
        updated++;
      }
    } catch (e) {
      console.error('Error at batch', i, e.message);
    }

    if (i % 500 === 0 && i > 0) {
      console.log(`  processed ${i}/${allIssues.length} | updated: ${updated}`);
    }
  }

  console.log(`\nDone! Updated: ${updated} tickets`);

  // Final summary
  const after = await db.issue.aggregate({
    where: { spaceId: space.id },
    _count: { id: true },
  });
  const withCombo = await db.issue.count({ where: { spaceId: space.id, combination: { not: null } } });
  const withCust  = await db.issue.count({ where: { spaceId: space.id, customerName: { not: null } } });
  const withClient = await db.issue.count({ where: { spaceId: space.id, clientName: { not: null } } });
  const withPM    = await db.issue.count({ where: { spaceId: space.id, projectManager: { not: null } } });
  const total     = after._count.id;
  console.log(`\nFinal QABOAR field coverage:`);
  console.log(`  combination:    ${withCombo}/${total}`);
  console.log(`  customerName:   ${withCust}/${total}`);
  console.log(`  clientName:     ${withClient}/${total}`);
  console.log(`  projectManager: ${withPM}/${total}`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


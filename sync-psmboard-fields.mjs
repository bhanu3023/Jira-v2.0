import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const JIRA_BASE = 'https://cf2020.atlassian.net';
const AUTH = Buffer.from('sujana.manapuram@cloudfuze.com:REDACTED_API_TOKEN').toString('base64');
const HEADERS = { Authorization: `Basic ${AUTH}`, Accept: 'application/json' };

const FIELD_MAP = {
  productType:  'customfield_10203',
  combination:  'customfield_10236',
};
const JIRA_FIELDS = Object.values(FIELD_MAP).join(',');

function extractValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (Array.isArray(raw)) {
    const vals = raw.map(v => v?.value ?? v?.name ?? String(v)).filter(Boolean);
    return vals.length ? vals.join(', ') : null;
  }
  return raw.value ?? raw.name ?? null;
}

async function main() {
  const space = await db.space.findFirst({ where: { key: 'PSMBOARD' } });
  const issues = await db.issue.findMany({
    where: { spaceId: space.id, OR: [{ combination: null }, { productType: null }] },
    select: { id: true, key: true, combination: true, productType: true },
  });
  console.log(`${issues.length} PSMBOARD tickets missing fields`);

  let updated = 0;
  const BATCH = 100;
  for (let i = 0; i < issues.length; i += BATCH) {
    const batch = issues.slice(i, i + BATCH);
    const keys = batch.map(x => x.key).join(',');
    const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(`issueKey in (${keys})`)}&maxResults=${BATCH}&fields=${JIRA_FIELDS}`;
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) { console.error('Error', res.status); continue; }
      const data = await res.json();
      for (const ji of (data.issues || [])) {
        const local = batch.find(x => x.key === ji.key);
        if (!local) continue;
        const patch = {};
        for (const [ourKey, jiraId] of Object.entries(FIELD_MAP)) {
          if (local[ourKey] !== null) continue;
          const val = extractValue(ji.fields?.[jiraId]);
          if (val) patch[ourKey] = val;
        }
        if (!Object.keys(patch).length) continue;
        await db.issue.update({ where: { key: ji.key }, data: patch });
        updated++;
      }
    } catch (e) { console.error(e.message); }
    if ((i + BATCH) % 300 === 0) console.log(`  ${i + BATCH}/${issues.length} | updated: ${updated}`);
  }

  console.log(`\nDone! Updated: ${updated} tickets`);

  const withCombo = await db.issue.count({ where: { spaceId: space.id, combination: { not: null } } });
  const withPT    = await db.issue.count({ where: { spaceId: space.id, productType: { not: null } } });
  const total     = issues.length + (1137 - issues.length);
  console.log(`combination: ${withCombo}/1137 | productType: ${withPT}/1137`);
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });


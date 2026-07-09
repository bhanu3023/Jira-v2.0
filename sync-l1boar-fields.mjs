/**
 * Syncs customerName, clientName, projectManager from Jira CFITS into L1BOAR tickets.
 * Matches by normalized title (since L1BOAR keys don't match CFITS keys).
 * Only updates tickets where each field is currently NULL.
 * Run: node sync-l1boar-fields.mjs
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

// Jira field IDs in CFITS
const FIELD_MAP = {
  customerName:   'customfield_10401',
  clientName:     'customfield_10883',
  projectManager: 'customfield_11380',
  productType:    'customfield_10203',
  combination:    'customfield_10236',
};
const JIRA_FIELDS = ['summary', ...Object.values(FIELD_MAP)].join(',');

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

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
  const space = await db.space.findFirst({ where: { key: 'L1BOAR' } });
  if (!space) { console.error('L1BOAR space not found'); process.exit(1); }

  // Load L1BOAR issues missing at least one field
  const localIssues = await db.issue.findMany({
    where: {
      spaceId: space.id,
      OR: [
        { customerName: null },
        { clientName: null },
        { projectManager: null },
        { productType: null },
        { combination: null },
      ],
    },
    select: { id: true, key: true, summary: true, customerName: true, clientName: true, projectManager: true, productType: true, combination: true },
  });

  console.log(`${localIssues.length} L1BOAR tickets have at least one missing field`);

  // Build title lookup map
  const byTitle = new Map();
  for (const issue of localIssues) {
    if (!issue.summary) continue;
    const norm = normalize(issue.summary);
    byTitle.set(norm, issue);
    if (norm.length > 20) byTitle.set(norm.slice(0, 60), issue);
  }

  let updated = 0, noMatch = 0, pagesFetched = 0;
  let startAt = 0;
  const pageSize = 100;
  // Only fetch CFITS issues that have at least one of our target fields set
  const jql = encodeURIComponent('project=CFITS ORDER BY updated DESC');

  console.log('Paging through CFITS to find field values...');

  while (true) {
    const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${pageSize}&fields=${JIRA_FIELDS}`;
    let res, data;
    try {
      res = await fetch(url, { headers: HEADERS });
      if (!res.ok) { console.error('Jira error:', res.status, await res.text()); break; }
      data = await res.json();
    } catch (e) {
      console.error(`Fetch error at startAt=${startAt}:`, e.message);
      // retry once
      await new Promise(r => setTimeout(r, 2000));
      try {
        res = await fetch(url, { headers: HEADERS });
        if (!res.ok) { startAt += pageSize; continue; }
        data = await res.json();
      } catch (e2) { console.error('Retry failed:', e2.message); startAt += pageSize; continue; }
    }

    const batch = data.issues || [];
    pagesFetched++;

    if (pagesFetched % 20 === 0) {
      console.log(`  page ${pagesFetched} | startAt=${startAt} | updated=${updated} | byTitle remaining=${byTitle.size}`);
    }

    for (const ji of batch) {
      const norm = normalize(ji.fields?.summary || '');
      let localIssue = byTitle.get(norm) ?? byTitle.get(norm.slice(0, 60));

      // Fuzzy substring match fallback
      if (!localIssue && norm.length >= 15) {
        for (const [tNorm, issue] of byTitle) {
          const shorter = tNorm.length < norm.length ? tNorm : norm;
          const longer  = tNorm.length >= norm.length ? tNorm : norm;
          if (shorter.length >= 15 && longer.includes(shorter)) { localIssue = issue; break; }
        }
      }

      if (!localIssue) { noMatch++; continue; }

      const patch = {};
      for (const [ourKey, jiraFieldId] of Object.entries(FIELD_MAP)) {
        if (localIssue[ourKey] !== null) continue; // already has value
        const val = extractValue(ji.fields?.[jiraFieldId]);
        if (val) patch[ourKey] = val;
      }

      if (Object.keys(patch).length === 0) continue;

      try {
        await db.issue.update({ where: { key: localIssue.key }, data: patch });
        // Update in-memory so we don't update same ticket twice
        Object.assign(localIssue, patch);
        updated++;

        // If all fields filled, remove from lookup map
        const allFilled = Object.keys(FIELD_MAP).every(k => localIssue[k] !== null);
        if (allFilled) byTitle.delete(norm);
      } catch (e) {
        console.error('DB update error:', e.message);
      }
    }

    // Stop early if all local tickets are matched
    if (byTitle.size === 0) {
      console.log('All local tickets matched! Stopping early.');
      break;
    }

    if (batch.length < pageSize) break;
    startAt += pageSize;
  }

  console.log(`\nDone! Updated: ${updated} tickets | No Jira match: ${noMatch} | Pages fetched: ${pagesFetched}`);

  // Final summary
  const total = await db.issue.count({ where: { spaceId: space.id } });
  const withCust  = await db.issue.count({ where: { spaceId: space.id, customerName: { not: null } } });
  const withClient = await db.issue.count({ where: { spaceId: space.id, clientName: { not: null } } });
  const withPM    = await db.issue.count({ where: { spaceId: space.id, projectManager: { not: null } } });
  const withPT    = await db.issue.count({ where: { spaceId: space.id, productType: { not: null } } });
  const withCombo = await db.issue.count({ where: { spaceId: space.id, combination: { not: null } } });

  console.log(`\nFinal L1BOAR field coverage (out of ${total}):`);
  console.log(`  customerName:   ${withCust}/${total}`);
  console.log(`  clientName:     ${withClient}/${total}`);
  console.log(`  projectManager: ${withPM}/${total}`);
  console.log(`  productType:    ${withPT}/${total}`);
  console.log(`  combination:    ${withCombo}/${total}`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


/**
 * Sync history for L2B, L1BOAR, IB, PSM, CFM, L3B, MB, EB, CB, SOPS
 * High concurrency â€” 25 parallel changelog fetches
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const { Pool } = require('./node_modules/pg/lib/index.js');
const { PrismaPg } = require('./node_modules/@prisma/adapter-pg/dist/index.js');
const { PrismaClient } = require('./node_modules/@prisma/client/index.js');
const pool = new Pool({ connectionString: DATABASE_URL, max: 30 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const API_TOKEN = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
const JIRA_URL  = 'https://cf2020.atlassian.net';
const CONCURRENCY = 25;

const BOARDS = [
  'L2B', 'L1BOAR', 'IB', 'PSM', 'CFM', 'L3B', 'MB', 'EB', 'CB', 'SOPS'
];

async function fetchChangelog(jiraKey) {
  const all = [];
  let startAt = 0;
  while (true) {
    const res = await fetch(
      `${JIRA_URL}/rest/api/3/issue/${jiraKey}/changelog?startAt=${startAt}&maxResults=100`,
      { headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' } }
    );
    if (!res.ok) break;
    const data = await res.json();
    const values = data.values || [];
    all.push(...values);
    if (all.length >= (data.total || 0) || !values.length) break;
    startAt += values.length;
  }
  return all;
}

async function processIssue(localIssue) {
  const changelog = await fetchChangelog(localIssue.key);
  if (!changelog.length) return 0;

  const toInsert = [];
  for (const history of changelog) {
    const createdAt = history.created ? new Date(history.created) : new Date();
    const author = history.author;
    const authorName = author?.displayName || author?.emailAddress || 'Unknown';
    const authorEmail = author?.emailAddress || null;
    for (const item of history.items || []) {
      const field = (item.field || '').toLowerCase();
      if (!field) continue;
      toInsert.push({
        issueId: localIssue.id,
        field,
        oldValue: item.fromString || item.from || null,
        newValue: item.toString || item.to || null,
        authorName,
        authorEmail,
        createdAt,
      });
    }
  }

  if (toInsert.length > 0) {
    await db.issueHistory.createMany({ data: toInsert, skipDuplicates: true });
  }
  return toInsert.length;
}

async function syncBoard(prefix) {
  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: `${prefix}-` } },
    select: { id: true, key: true },
  });
  if (!localIssues.length) { console.log(`  [${prefix}] No local issues`); return 0; }

  const alreadySynced = await db.issueHistory.findMany({
    where: { issue: { key: { startsWith: `${prefix}-` } } },
    select: { issueId: true },
    distinct: ['issueId'],
  });
  const syncedIds = new Set(alreadySynced.map(h => h.issueId));
  const pending = localIssues.filter(i => !syncedIds.has(i.id));

  console.log(`\nâ”€â”€ [${prefix}] ${localIssues.length} issues, ${pending.length} to sync â”€â”€`);
  if (!pending.length) { console.log(`  [${prefix}] âœ… Already complete`); return 0; }

  let total = 0, processed = 0;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(issue => processIssue(issue).catch(() => 0)));
    total += results.reduce((a, b) => a + b, 0);
    processed += chunk.length;
    if (processed % 100 === 0 || processed === pending.length) {
      process.stdout.write(`\r  [${prefix}] ${processed}/${pending.length} | Records: ${total}   `);
    }
  }

  console.log(`\r  [${prefix}] âœ… Done â€” ${total} history records inserted                    `);
  return total;
}

async function main() {
  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘  History Sync: L2B, L1BOAR, IB, PSM, CFM,          â•‘');
  console.log('â•‘               L3B, MB, EB, CB, SOPS                 â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  let grand = 0;
  for (const prefix of BOARDS) {
    try { grand += await syncBoard(prefix); }
    catch (e) { console.error(`  âŒ [${prefix}] Error:`, e.message); }
  }

  console.log(`\n${'â•'.repeat(54)}`);
  console.log(`ðŸŽ‰ DONE! Total history records inserted: ${grand}`);
  console.log(`${'â•'.repeat(54)}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });


/**
 * Fast parallel history sync â€” runs multiple boards concurrently
 * Each board processes issues with concurrency=5 parallel changelog fetches
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
const pool = new Pool({ connectionString: DATABASE_URL, max: 20 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const API_TOKEN = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
const JIRA_URL  = 'https://cf2020.atlassian.net';
const CONCURRENCY = 25; // parallel changelog fetches per board

const ALL_BOARDS = [
  { prefix: 'QAB',    },
  { prefix: 'TEST',   },
  { prefix: 'L2B',    },
  { prefix: 'L1BOAR', },
  { prefix: 'IB',     },
  { prefix: 'PSM',    },
  { prefix: 'CFM',    },
  { prefix: 'L3B',    },
  { prefix: 'MB',     },
  { prefix: 'EB',     },
  { prefix: 'CB',     },
  { prefix: 'SOPS',   },
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

async function syncBoardHistory(prefix) {
  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: `${prefix}-` } },
    select: { id: true, key: true },
  });
  if (!localIssues.length) {
    console.log(`  [${prefix}] No local issues, skipping`);
    return 0;
  }

  // Find already-synced issue IDs
  const alreadySynced = await db.issueHistory.findMany({
    where: { issue: { key: { startsWith: `${prefix}-` } } },
    select: { issueId: true },
    distinct: ['issueId'],
  });
  const syncedIds = new Set(alreadySynced.map(h => h.issueId));
  const pending = localIssues.filter(i => !syncedIds.has(i.id));

  console.log(`  [${prefix}] Issues: ${localIssues.length} total, ${pending.length} to sync`);
  if (!pending.length) return 0;

  let totalInserted = 0;
  let processed = 0;

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(issue => processIssue(issue).catch(() => 0)));
    totalInserted += results.reduce((a, b) => a + b, 0);
    processed += chunk.length;
    if (processed % 50 === 0 || processed === pending.length) {
      process.stdout.write(`\r  [${prefix}] ${processed}/${pending.length} | Records: ${totalInserted}   `);
    }
  }

  console.log(`\r  [${prefix}] âœ… Done â€” ${totalInserted} history records inserted                    `);
  return totalInserted;
}

async function main() {
  const targetBoard = process.argv[2]?.toUpperCase();
  const boards = targetBoard
    ? ALL_BOARDS.filter(b => b.prefix === targetBoard)
    : ALL_BOARDS;

  if (!boards.length) { console.error(`Board "${targetBoard}" not found`); process.exit(1); }

  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘  Fast History Sync: Jira â†’ issue_history (all boards)â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

  let grand = 0;
  for (const board of boards) {
    try {
      grand += await syncBoardHistory(board.prefix);
    } catch (e) {
      console.error(`  âŒ [${board.prefix}] Error:`, e.message);
    }
  }

  console.log(`\n${'â•'.repeat(54)}`);
  console.log(`ðŸŽ‰ ALL DONE! Total history records inserted: ${grand}`);
  console.log(`${'â•'.repeat(54)}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });


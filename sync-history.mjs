/**
 * Sync Jira issue changelog (history) â†’ issue_history table for ALL boards
 * Uses the dedicated /rest/api/3/issue/{key}/changelog endpoint per issue
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
const pool = new Pool({ connectionString: DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const API_TOKEN = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
const JIRA_URL  = 'https://cf2020.atlassian.net';

const ALL_BOARDS = [
  { prefix: 'QAB',    jql: 'project in (QA) ORDER BY created DESC' },
  { prefix: 'TEST',   jql: 'project in (TEST, QPTT, QTTSS) ORDER BY created DESC' },
  { prefix: 'L2B',    jql: 'project in (L2B) ORDER BY created DESC' },
  { prefix: 'L1BOAR', jql: 'project in (CFITS) ORDER BY created DESC' },
  { prefix: 'IB',     jql: 'project in ("IN", SYS) ORDER BY created DESC' },
  { prefix: 'PSM',    jql: 'project in (PSM, PSR) ORDER BY created DESC' },
  { prefix: 'CFM',    jql: 'project in (CFM, "CF", CFC, CLOUDFUZE) ORDER BY created DESC' },
  { prefix: 'L3B',    jql: 'project in (L3B, L3) ORDER BY created DESC' },
  { prefix: 'MB',     jql: 'project in (MB, CST, STT, MSTT, STMTS) ORDER BY created DESC' },
  { prefix: 'EB',     jql: 'project in (EB, EM, OMM, OGM, GM, GD) ORDER BY created DESC' },
  { prefix: 'CB',     jql: 'project in (CB, CM, CMQ2) ORDER BY created DESC' },
  { prefix: 'SOPS',   jql: 'project in (SOPS, SO, SAL, SR) ORDER BY created DESC' },
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

async function syncBoardHistory({ prefix }) {
  console.log(`\nâ”€â”€ ${prefix} â”€â”€`);

  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: `${prefix}-` } },
    select: { id: true, key: true },
  });
  if (!localIssues.length) { console.log('  No local issues, skipping'); return { inserted: 0 }; }
  console.log(`  Local issues: ${localIssues.length}`);

  // Load already-synced issue IDs to skip re-fetching
  const alreadySynced = await db.issueHistory.findMany({
    where: { issue: { key: { startsWith: `${prefix}-` } } },
    select: { issueId: true },
    distinct: ['issueId'],
  });
  const syncedIds = new Set(alreadySynced.map(h => h.issueId));

  let totalInserted = 0;
  let processed = 0;

  for (const localIssue of localIssues) {
    // Skip if already synced
    if (syncedIds.has(localIssue.id)) {
      processed++;
      continue;
    }

    const jiraKey = localIssue.key; // local key matches Jira key
    const changelog = await fetchChangelog(jiraKey);

    if (!changelog.length) { processed++; continue; }

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
      totalInserted += toInsert.length;
    }

    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(`\r  Processed ${processed}/${localIssues.length} | History records: ${totalInserted}...`);
    }
  }

  console.log(`\r  âœ… Processed: ${processed} issues | History records: ${totalInserted}              `);
  return { inserted: totalInserted };
}

async function main() {
  const targetBoard = process.argv[2];
  const boards = targetBoard
    ? ALL_BOARDS.filter(b => b.prefix === targetBoard.toUpperCase())
    : ALL_BOARDS;

  if (!boards.length) {
    console.error(`Board "${targetBoard}" not found`);
    process.exit(1);
  }

  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘   Syncing Jira History â†’ issue_history table        â•‘');
  console.log(`â•‘   Boards: ${boards.map(b => b.prefix).join(', ').padEnd(43)}â•‘`);
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  let grandTotal = 0;
  for (const board of boards) {
    try {
      const { inserted } = await syncBoardHistory(board);
      grandTotal += inserted;
    } catch (e) {
      console.error(`  âŒ Error for ${board.prefix}:`, e.message);
    }
  }

  console.log(`\n${'â•'.repeat(54)}`);
  console.log(`ðŸŽ‰ ALL DONE! Total history records inserted: ${grandTotal}`);
  console.log(`${'â•'.repeat(54)}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });


/**
 * History sync v2 â€” matches local issues to Jira by SUMMARY (like comment sync does)
 * Fetches real Jira keys via JQL, then pulls changelog using actual Jira issue keys
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
const CONCURRENCY = 20;

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

function normalize(str) { return (str || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

async function fetchJiraIssues(jql) {
  const all = [];
  let nextPageToken = null;
  do {
    const params = new URLSearchParams({ jql, maxResults: '100', fields: 'summary' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${JIRA_URL}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
    });
    if (!res.ok) break;
    const data = await res.json();
    if (data.errorMessages?.length) break;
    all.push(...(data.issues || []));
    nextPageToken = data.isLast ? null : data.nextPageToken;
    if (nextPageToken) await new Promise(r => setTimeout(r, 80));
  } while (nextPageToken);
  return all;
}

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

async function processIssue(jiraKey, localIssueId) {
  const changelog = await fetchChangelog(jiraKey);
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
        issueId: localIssueId,
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

async function syncBoard({ prefix, jql }) {
  console.log(`\nâ”€â”€ [${prefix}] â”€â”€`);

  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: `${prefix}-` } },
    select: { id: true, key: true, summary: true },
  });
  if (!localIssues.length) { console.log(`  No local issues, skipping`); return 0; }

  // Build summary â†’ local issue map
  const summaryMap = new Map();
  const keyMap = new Map();
  for (const i of localIssues) {
    keyMap.set(i.key, i);
    const n = normalize(i.summary);
    if (!summaryMap.has(n)) summaryMap.set(n, i);
  }

  // Check already-synced
  const alreadySynced = await db.issueHistory.findMany({
    where: { issue: { key: { startsWith: `${prefix}-` } } },
    select: { issueId: true },
    distinct: ['issueId'],
  });
  const syncedIds = new Set(alreadySynced.map(h => h.issueId));
  console.log(`  Local: ${localIssues.length} issues, ${syncedIds.size} already synced`);

  // Fetch all Jira issues via JQL
  process.stdout.write(`  Fetching Jira issues...`);
  const jiraIssues = await fetchJiraIssues(jql);
  console.log(` ${jiraIssues.length} found`);

  // Build pairs: jiraKey â†’ localIssueId (skip already synced)
  const pairs = [];
  for (const ji of jiraIssues) {
    let local = keyMap.get(ji.key); // try exact key match first
    if (!local) local = summaryMap.get(normalize(ji.fields?.summary || ''));
    if (!local) continue;
    if (syncedIds.has(local.id)) continue;
    pairs.push({ jiraKey: ji.key, localId: local.id });
    syncedIds.add(local.id); // mark to avoid duplicates within this run
  }
  console.log(`  ${pairs.length} issues to sync`);
  if (!pairs.length) return 0;

  let total = 0, processed = 0;
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const chunk = pairs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(p => processIssue(p.jiraKey, p.localId).catch(() => 0))
    );
    total += results.reduce((a, b) => a + b, 0);
    processed += chunk.length;
    if (processed % 100 === 0 || processed === pairs.length) {
      process.stdout.write(`\r  [${prefix}] ${processed}/${pairs.length} | Records: ${total}   `);
    }
  }
  console.log(`\r  [${prefix}] âœ… Done â€” ${total} history records inserted                    `);
  return total;
}

async function main() {
  const targetBoard = process.argv[2]?.toUpperCase();
  const boards = targetBoard
    ? ALL_BOARDS.filter(b => b.prefix === targetBoard)
    : ALL_BOARDS;

  if (!boards.length) { console.error(`Board "${targetBoard}" not found`); process.exit(1); }

  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘  History Sync v2 â€” JQL match by summary             â•‘');
  console.log(`â•‘  Boards: ${boards.map(b => b.prefix).join(', ').padEnd(44)}â•‘`);
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  let grand = 0;
  for (const board of boards) {
    try { grand += await syncBoard(board); }
    catch (e) { console.error(`  âŒ [${board.prefix}] Error:`, e.message); }
  }

  console.log(`\n${'â•'.repeat(54)}`);
  console.log(`ðŸŽ‰ DONE! Total history records inserted: ${grand}`);
  console.log(`${'â•'.repeat(54)}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });


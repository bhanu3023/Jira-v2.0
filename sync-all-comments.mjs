/**
 * Sync comments from Jira â†’ local PostgreSQL for ALL boards
 * Strategy:
 *   1. For each board, fetch all Jira issues with comments
 *   2. Match local issue by summary
 *   3. Skip comments already synced (match by body text)
 *   4. Insert new comments
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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

const BOARD_MAP = [
  { prefix: 'TEST',   jql: 'project in (TEST, QPTT, QTTSS) ORDER BY created DESC' },
  { prefix: 'L2B',    jql: 'project in (L2B) ORDER BY created DESC' },
  { prefix: 'L1BOAR', jql: 'project in (CFITS) ORDER BY created DESC' },
  { prefix: 'IB',     jql: 'project in ("IN", SYS) ORDER BY created DESC' },
  { prefix: 'PSM',    jql: 'project in (PSM, PSR) ORDER BY created DESC' },
  { prefix: 'QAB',    jql: 'project in (QA) ORDER BY created DESC' },
  { prefix: 'CFM',    jql: 'project in (CFM, "CF", CFC, CLOUDFUZE) ORDER BY created DESC' },
  { prefix: 'L3B',    jql: 'project in (L3B, L3) ORDER BY created DESC' },
  { prefix: 'MB',     jql: 'project in (MB, CST, STT, MSTT, STMTS) ORDER BY created DESC' },
  { prefix: 'EB',     jql: 'project in (EB, EM, OMM, OGM, GM, GD) ORDER BY created DESC' },
  { prefix: 'CB',     jql: 'project in (CB, CM, CMQ2) ORDER BY created DESC' },
  { prefix: 'SOPS',   jql: 'project in (SOPS, SO, SAL, SR) ORDER BY created DESC' },
];

/** ADF node â†’ plain text */
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'mention') return node.attrs?.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'paragraph') return (node.content||[]).map(adfToText).join('') + '\n';
  if (node.type === 'heading') return '\n' + (node.content||[]).map(adfToText).join('') + '\n';
  if (node.type === 'bulletList') return (node.content||[]).map(li => 'â€¢ ' + (li.content||[]).map(adfToText).join('').trim()).join('\n') + '\n';
  if (node.type === 'orderedList') return (node.content||[]).map((li,i) => `${i+1}. ` + (li.content||[]).map(adfToText).join('').trim()).join('\n') + '\n';
  if (node.type === 'codeBlock') return '```\n' + (node.content||[]).map(adfToText).join('') + '```\n';
  if (node.type === 'blockquote') return (node.content||[]).map(adfToText).join('');
  if (node.content) return node.content.map(adfToText).join('');
  return '';
}

function normalize(str) { return (str||'').toLowerCase().replace(/\s+/g,' ').trim(); }
function rid() { return Math.random().toString(36).slice(2, 11); }

/** Fetch all issues with comments for a JQL query */
async function fetchIssuesWithComments(jql) {
  const all = [];
  let nextPageToken = null;
  do {
    const params = new URLSearchParams({ jql, maxResults: '100', fields: 'summary,comment' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${JIRA_URL}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
    });
    if (!res.ok) { console.warn(`  âš  HTTP ${res.status}`); return all; }
    const data = await res.json();
    if (data.errorMessages?.length) { console.warn('  âš ', data.errorMessages.join(', ')); return all; }
    // Only keep issues that actually have comments
    const withComments = (data.issues||[]).filter(i => (i.fields?.comment?.total || 0) > 0);
    all.push(...withComments);
    process.stdout.write(`\r  Scanned ${(data.issues||[]).length * (Math.ceil(all.length/100)||1)} issues, ${all.length} have comments...`);
    nextPageToken = data.isLast ? null : data.nextPageToken;
    if (nextPageToken) await new Promise(r => setTimeout(r, 100));
  } while (nextPageToken);
  console.log();
  return all;
}

/** Fetch all comments for a single Jira issue key */
async function fetchAllComments(jiraKey) {
  const comments = [];
  let startAt = 0;
  const maxResults = 100;
  while (true) {
    const res = await fetch(
      `${JIRA_URL}/rest/api/3/issue/${jiraKey}/comment?startAt=${startAt}&maxResults=${maxResults}`,
      { headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' } }
    );
    if (!res.ok) break;
    const data = await res.json();
    comments.push(...(data.comments||[]));
    if (comments.length >= data.total) break;
    startAt += maxResults;
  }
  return comments;
}

async function syncBoard({ prefix, jql }) {
  console.log(`\nâ”€â”€ ${prefix} â”€â”€`);

  // Load local issues for this prefix â†’ map by normalized summary
  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: `${prefix}-` } },
    select: { id: true, key: true, summary: true },
  });
  if (!localIssues.length) { console.log('  No local issues, skipping'); return 0; }

  const summaryMap = new Map();
  for (const i of localIssues) {
    const n = normalize(i.summary);
    if (!summaryMap.has(n)) summaryMap.set(n, i);
  }
  console.log(`  Local issues: ${localIssues.length}`);

  // Load all existing comments for this board (to avoid duplicates)
  const localIssueIds = localIssues.map(i => i.id);
  const existingComments = await db.comment.findMany({
    where: { issueId: { in: localIssueIds } },
    select: { issueId: true, body: true },
  });
  // Build set of "issueId::normalizedBody" for dedup
  const existingSet = new Set(existingComments.map(c => `${c.issueId}::${normalize(c.body||'')}`));
  console.log(`  Existing comments in DB: ${existingComments.length}`);

  // Fetch Jira issues that have comments
  process.stdout.write(`  Fetching Jira issues with comments...`);
  const jiraIssuesWithComments = await fetchIssuesWithComments(jql);
  console.log(`  ${jiraIssuesWithComments.length} Jira issues have comments`);

  let totalInserted = 0;
  let processed = 0;

  for (const ji of jiraIssuesWithComments) {
    const local = summaryMap.get(normalize(ji.fields?.summary||''));
    if (!local) continue;

    // Get all comments (search API only returns first 5, fetch all)
    const jiraComments = ji.fields?.comment?.total > 5
      ? await fetchAllComments(ji.key)
      : (ji.fields?.comment?.comments || []);

    for (const jc of jiraComments) {
      const bodyText = adfToText(jc.body).trim();
      if (!bodyText) continue;

      const dedupKey = `${local.id}::${normalize(bodyText)}`;
      if (existingSet.has(dedupKey)) continue; // already exists
      existingSet.add(dedupKey);

      const authorName = jc.author?.displayName || null;
      const authorEmail = jc.author?.emailAddress || null;
      const createdAt = jc.created ? new Date(jc.created) : new Date();
      const updatedAt = jc.updated ? new Date(jc.updated) : createdAt;

      await db.comment.create({
        data: {
          id: rid(),
          body: bodyText,
          issueId: local.id,
          authorId: null,
          authorName,
          authorEmail,
          createdAt,
          updatedAt,
        },
      });
      totalInserted++;
    }

    processed++;
    process.stdout.write(`\r  Processed ${processed}/${jiraIssuesWithComments.length} issues | Inserted ${totalInserted} comments...`);
  }

  console.log(`\r  âœ… Inserted: ${totalInserted} new comments (processed ${processed} issues)              `);
  return totalInserted;
}

async function main() {
  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘   Syncing ALL comments from Jira â†’ DB     â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  let grandTotal = 0;
  for (const board of BOARD_MAP) {
    try {
      grandTotal += await syncBoard(board);
    } catch (e) {
      console.error(`  âŒ Error for ${board.prefix}:`, e.message);
    }
  }

  console.log(`\n${'â•'.repeat(50)}`);
  console.log(`ðŸŽ‰ ALL DONE! Total new comments inserted: ${grandTotal}`);
  console.log(`${'â•'.repeat(50)}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });


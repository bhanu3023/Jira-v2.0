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

// IN and CF are reserved JQL words â€” must be quoted with double quotes in JQL
const MISSING_BOARDS = [
  { prefix: 'IB',  jql: 'project in ("IN", SYS) ORDER BY created DESC' },
  { prefix: 'CFM', jql: 'project in (CFM, "CF", CFC, CLOUDFUZE) ORDER BY created DESC' },
];

function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'paragraph') return (node.content||[]).map(adfToText).join('') + '\n';
  if (node.type === 'heading') return '\n' + (node.content||[]).map(adfToText).join('') + '\n';
  if (node.type === 'bulletList') return (node.content||[]).map(li => 'â€¢ ' + (li.content||[]).map(adfToText).join('').trim()).join('\n') + '\n';
  if (node.type === 'orderedList') return (node.content||[]).map((li,i) => `${i+1}. ` + (li.content||[]).map(adfToText).join('').trim()).join('\n') + '\n';
  if (node.type === 'codeBlock') return '```\n' + (node.content||[]).map(adfToText).join('') + '```\n';
  if (node.content) return node.content.map(adfToText).join('');
  return '';
}
function normalize(str) { return (str||'').toLowerCase().replace(/\s+/g,' ').trim(); }

async function fetchJiraIssues(jql) {
  const all = [];
  let nextPageToken = null;
  do {
    const params = new URLSearchParams({ jql, maxResults: '100', fields: 'summary,description' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${JIRA_URL}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
    });
    if (!res.ok) { console.warn(`  âš  HTTP ${res.status}:`, await res.text()); return all; }
    const data = await res.json();
    if (data.errorMessages?.length) { console.warn('  âš  Jira:', data.errorMessages.join(', ')); return all; }
    all.push(...(data.issues||[]));
    process.stdout.write(`\r  Fetched ${all.length} from Jira...`);
    nextPageToken = data.isLast ? null : data.nextPageToken;
    if (nextPageToken) await new Promise(r => setTimeout(r, 100));
  } while (nextPageToken);
  console.log();
  return all;
}

async function syncBoard({ prefix, jql }) {
  console.log(`\nâ”€â”€ ${prefix} â”€â”€`);
  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: `${prefix}-` } },
    select: { id: true, key: true, summary: true },
  });
  if (!localIssues.length) { console.log('  No local issues, skipping'); return 0; }
  const summaryMap = new Map();
  for (const i of localIssues) { const n = normalize(i.summary); if (!summaryMap.has(n)) summaryMap.set(n, i); }
  console.log(`  Local: ${localIssues.length} issues | ${summaryMap.size} unique summaries`);

  const jiraIssues = await fetchJiraIssues(jql);
  console.log(`  Jira: ${jiraIssues.length} issues`);

  const updates = [];
  for (const ji of jiraIssues) {
    const descRaw = ji.fields?.description;
    if (!descRaw) continue;
    const descText = adfToText(descRaw).trim();
    if (!descText) continue;
    const local = summaryMap.get(normalize(ji.fields?.summary||''));
    if (local) updates.push({ id: local.id, description: descText });
  }

  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i+50);
    await Promise.all(chunk.map(u => db.issue.update({ where: { id: u.id }, data: { description: u.description } })));
    process.stdout.write(`\r  Updated ${Math.min(i+50, updates.length)}/${updates.length}...`);
  }
  console.log(`\r  âœ… Updated: ${updates.length} descriptions                    `);
  return updates.length;
}

async function main() {
  console.log('=== Syncing missing boards (IB + CFM) ===');
  let total = 0;
  for (const board of MISSING_BOARDS) {
    total += await syncBoard(board);
  }
  console.log(`\nðŸŽ‰ Done! Total updated: ${total}`);
  await db.$disconnect();
  await pool.end();
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });


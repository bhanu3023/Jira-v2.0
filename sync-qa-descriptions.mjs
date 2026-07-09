/**
 * Sync QA descriptions from Jira â†’ local DB
 * Matches tickets by SUMMARY (title) because key numbers differ (QA-363 â‰  QAB-1143)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const DATABASE_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const { Pool } = require('./node_modules/pg/lib/index.js');
const { PrismaPg } = require('./node_modules/@prisma/adapter-pg/dist/index.js');
const { PrismaClient } = require('./node_modules/@prisma/client/index.js');
const pool = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const JIRA_URL  = 'https://cf2020.atlassian.net';
const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const API_TOKEN = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');

/** Convert Atlassian Document Format (ADF) â†’ plain text */
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'paragraph') return (node.content||[]).map(adfToText).join('') + '\n';
  if (node.type === 'heading') return '\n' + (node.content||[]).map(adfToText).join('') + '\n';
  if (node.type === 'bulletList') return (node.content||[]).map(li => 'â€¢ ' + (li.content||[]).map(adfToText).join('').trim()).join('\n') + '\n';
  if (node.type === 'orderedList') return (node.content||[]).map((li,i) => `${i+1}. ` + (li.content||[]).map(adfToText).join('').trim()).join('\n') + '\n';
  if (node.type === 'codeBlock') return '```\n' + (node.content||[]).map(adfToText).join('') + '\n```\n';
  if (node.content) return node.content.map(adfToText).join('');
  return '';
}

/** Normalize summary for comparison */
function normalize(str) {
  return (str || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function fetchAllJiraIssues() {
  const all = [];
  let nextPageToken = null;
  let page = 1;
  do {
    const params = new URLSearchParams({ jql: 'project=QA ORDER BY created DESC', maxResults: '100', fields: 'summary,description,attachment' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${JIRA_URL}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Jira error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    all.push(...(data.issues || []));
    process.stdout.write(`\r  Fetched ${all.length} Jira issues (page ${page})...`);
    nextPageToken = data.isLast ? null : data.nextPageToken;
    page++;
    if (nextPageToken) await new Promise(r => setTimeout(r, 150));
  } while (nextPageToken);
  console.log(`\n  Total from Jira: ${all.length}`);
  return all;
}

async function main() {
  console.log('=== QA Description Sync (match by summary) ===\n');

  // Step 1: Load ALL local QAB issues into a map keyed by normalized summary
  console.log('Loading local QAB issues...');
  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: 'QAB-' } },
    select: { id: true, key: true, summary: true, description: true },
  });
  console.log(`  Found ${localIssues.length} local QAB issues`);

  // Build lookup map: normalizedSummary â†’ issue
  const summaryMap = new Map();
  for (const issue of localIssues) {
    const norm = normalize(issue.summary);
    if (!summaryMap.has(norm)) summaryMap.set(norm, issue);
  }
  console.log(`  Unique summaries indexed: ${summaryMap.size}`);

  // Step 2: Fetch all Jira QA issues
  console.log('\nFetching Jira QA issues...');
  const jiraIssues = await fetchAllJiraIssues();

  // Step 3: Match and update
  console.log('\nMatching and updating...');
  let updated = 0, noDesc = 0, noMatch = 0, alreadyHas = 0;

  for (const ji of jiraIssues) {
    const descRaw = ji.fields?.description;
    if (!descRaw) { noDesc++; continue; }

    const descText = adfToText(descRaw).trim();
    if (!descText) { noDesc++; continue; }

    const jiraSummary = normalize(ji.fields?.summary || '');
    const local = summaryMap.get(jiraSummary);

    if (!local) { noMatch++; continue; }

    // Update description
    await db.issue.update({
      where: { id: local.id },
      data: { description: descText },
    });
    updated++;
    if (updated <= 5 || updated % 100 === 0) {
      console.log(`  âœ“ [${updated}] ${local.key} â† Jira ${ji.key}: "${descText.slice(0,60).replace(/\n/g,' ')}..."`);
    }
  }

  console.log(`\nâœ… Sync complete!`);
  console.log(`   Updated:          ${updated}`);
  console.log(`   No description:   ${noDesc}`);
  console.log(`   No local match:   ${noMatch}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error('\nâŒ Error:', e.message); process.exit(1); });


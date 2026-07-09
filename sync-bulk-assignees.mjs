/**
 * Bulk sync: fills in missing assignee, reporter, comments & history
 * for all issues across all boards by fetching from Jira.
 * Run: node sync-bulk-assignees.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');

const DB_URL  = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const pool    = new Pool({ connectionString: DB_URL });

const JIRA_BASE = 'https://cf2020.atlassian.net';
const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const TOKEN     = 'REDACTED_API_TOKEN';
const AUTH      = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const HEADERS   = { Authorization: AUTH, Accept: 'application/json' };

// Boards where local key == Jira key (can look up directly)
const DIRECT_BOARDS = [
  { spaceKey: 'L2BOARD',   jiraProject: 'L2B'    },
  { spaceKey: 'L3BOARD',   jiraProject: 'L3B'    },
  { spaceKey: 'PSMBOARD',  jiraProject: 'PSM'    },
  { spaceKey: 'CFMBOARD',  jiraProject: 'CFM'    },
  { spaceKey: 'INFRABOARD',jiraProject: 'IB'     },
  { spaceKey: 'MBBOARD',   jiraProject: 'MB'     },
  { spaceKey: 'EBBOARD',   jiraProject: 'EB'     },
  { spaceKey: 'CBBOARD',   jiraProject: 'CB'     },
  { spaceKey: 'SOPSBOARD', jiraProject: 'SOPS'   },
  { spaceKey: 'QABOAR',    jiraProject: 'QABOAR' },
];

// L1BOAR â†’ CFITS (different key prefix, match by title)
const L1_BOARD = { spaceKey: 'L1BOAR', jiraProject: 'CFITS' };

const CUSTOM_FIELDS = 'customfield_10401,customfield_10883,customfield_11380,customfield_10203,customfield_10236';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractVal(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number') return String(raw);
  if (Array.isArray(raw)) return raw.map(v => v?.value ?? v?.name ?? String(v)).filter(Boolean).join(', ') || null;
  return raw.value ?? raw.name ?? raw.displayName ?? raw.emailAddress ?? null;
}

function adfToHtml(node) {
  if (!node) return '';
  if (node.type === 'doc') return (node.content||[]).map(adfToHtml).join('');
  if (node.type === 'paragraph') { const i=(node.content||[]).map(adfToHtml).join(''); return i?`<p>${i}</p>`:'<p></p>'; }
  if (node.type === 'text') {
    let t = node.text||'';
    for (const m of node.marks||[]) {
      if (m.type==='strong') t=`<strong>${t}</strong>`;
      if (m.type==='em') t=`<em>${t}</em>`;
      if (m.type==='underline') t=`<u>${t}</u>`;
      if (m.type==='code') t=`<code>${t}</code>`;
      if (m.type==='link') t=`<a href="${m.attrs?.href||'#'}">${t}</a>`;
    }
    return t;
  }
  if (node.type==='hardBreak') return '<br/>';
  if (node.type==='bulletList') return `<ul>${(node.content||[]).map(adfToHtml).join('')}</ul>`;
  if (node.type==='orderedList') return `<ol>${(node.content||[]).map(adfToHtml).join('')}</ol>`;
  if (node.type==='listItem') return `<li>${(node.content||[]).map(adfToHtml).join('')}</li>`;
  if (node.type==='heading') return `<h${node.attrs?.level||2}>${(node.content||[]).map(adfToHtml).join('')}</h${node.attrs?.level||2}>`;
  if (node.type==='codeBlock') return `<pre><code>${(node.content||[]).map(n=>n.text||'').join('')}</code></pre>`;
  if (node.type==='blockquote') return `<blockquote>${(node.content||[]).map(adfToHtml).join('')}</blockquote>`;
  return (node.content||[]).map(adfToHtml).join('');
}

// Cache for user lookups to avoid repeated DB queries
const userCache = new Map();
async function resolveUser(displayName) {
  if (!displayName) return null;
  const key = displayName.trim().toLowerCase();
  if (userCache.has(key)) return userCache.get(key);
  const parts = displayName.trim().split(/\s+/);
  let user = null;
  // Full name match
  const r1 = await pool.query(
    `SELECT id, email FROM users WHERE LOWER(CONCAT("firstName",' ',"lastName")) = LOWER($1) LIMIT 1`,
    [displayName.trim()]
  );
  if (r1.rows.length) user = r1.rows[0];
  // First name only
  if (!user && parts[0]) {
    const r2 = await pool.query(`SELECT id, email FROM users WHERE LOWER("firstName") = LOWER($1) LIMIT 1`, [parts[0]]);
    if (r2.rows.length) user = r2.rows[0];
  }
  userCache.set(key, user);
  return user;
}

async function fetchWithRetry(url, opts, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      return res;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// Fetch Jira issues by keys in batches of 50 using JQL
async function fetchJiraByKeys(keys, extraFields = '') {
  const results = new Map(); // jiraKey â†’ fields+changelog
  const batchSize = 50;
  const fields = `summary,assignee,reporter,comment,status,priority,issuetype,parent,labels,${CUSTOM_FIELDS}${extraFields}`;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const jql = encodeURIComponent(`key in (${batch.join(',')}) ORDER BY key ASC`);
    const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&maxResults=${batchSize}&fields=${fields}&expand=changelog`;
    try {
      const res = await fetchWithRetry(url, { headers: HEADERS });
      if (!res.ok) { process.stderr.write(`  Jira error ${res.status} for batch\n`); continue; }
      const data = await res.json();
      for (const issue of data.issues || []) {
        results.set(issue.key, issue);
      }
    } catch (e) {
      process.stderr.write(`  Fetch error: ${e.message}\n`);
    }
    // Small delay to avoid rate limiting
    if (i + batchSize < keys.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

async function applyJiraData(localIssueId, localIssueKey, ji) {
  const f = ji.fields || {};
  let updated = 0;

  // Resolve assignee/reporter
  const assigneeUser = await resolveUser(f.assignee?.displayName);
  const reporterUser = await resolveUser(f.reporter?.displayName);

  const setClauses = [];
  const vals = [];
  let idx = 1;

  if (assigneeUser) { setClauses.push(`"assigneeId" = $${idx++}`); vals.push(assigneeUser.id); }
  if (reporterUser) { setClauses.push(`"reporterId" = $${idx++}`); vals.push(reporterUser.id); }
  // Also fill custom fields if missing
  const cfMap = {
    customerName:   extractVal(f.customfield_10401),
    clientName:     extractVal(f.customfield_10883),
    projectManager: extractVal(f.customfield_11380),
    productType:    extractVal(f.customfield_10203),
    combination:    extractVal(f.customfield_10236),
  };
  for (const [col, val] of Object.entries(cfMap)) {
    if (val) { setClauses.push(`"${col}" = COALESCE("${col}", $${idx++})`); vals.push(val); }
  }

  if (setClauses.length) {
    vals.push(localIssueId);
    await pool.query(`UPDATE issues SET ${setClauses.join(', ')} WHERE id = $${idx}`, vals);
    updated++;
  }

  // Import comments if issue has none locally
  const commentCount = await pool.query(`SELECT COUNT(*) FROM comments WHERE "issueId" = $1`, [localIssueId]);
  const jiraComments = f.comment?.comments || [];
  if (parseInt(commentCount.rows[0].count) === 0 && jiraComments.length > 0) {
    for (const jc of jiraComments) {
      const author = await resolveUser(jc.author?.displayName);
      const body = typeof jc.body === 'object' ? adfToHtml(jc.body) : (jc.body || '');
      await pool.query(
        `INSERT INTO comments (id, body, "issueId", "authorId", "authorName", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)`,
        [body || '(empty)', localIssueId, author?.id || null, jc.author?.displayName || null,
         new Date(jc.created), new Date(jc.updated || jc.created)]
      );
    }
    updated++;
  }

  // Import history if issue has none locally
  const histCount = await pool.query(`SELECT COUNT(*) FROM issue_history WHERE "issueId" = $1`, [localIssueId]);
  const changelog = ji.changelog?.histories || [];
  if (parseInt(histCount.rows[0].count) === 0 && changelog.length > 0) {
    for (const entry of changelog) {
      const author = await resolveUser(entry.author?.displayName);
      for (const item of entry.items || []) {
        await pool.query(
          `INSERT INTO issue_history (id, "issueId", field, "oldValue", "newValue", "authorName", "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)`,
          [localIssueId, item.field?.toLowerCase() || '', item.fromString || null, item.toString || null,
           entry.author?.displayName || null, new Date(entry.created)]
        );
      }
    }
    updated++;
  }

  return updated > 0;
}

// â”€â”€ Sync direct boards (key matches Jira) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function syncDirectBoard({ spaceKey, jiraProject }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Board: ${spaceKey} â† Jira: ${jiraProject}`);

  const spaceRes = await pool.query(`SELECT id FROM spaces WHERE key = $1`, [spaceKey]);
  if (!spaceRes.rows.length) { console.log('  Space not found, skipping.'); return; }
  const spaceId = spaceRes.rows[0].id;

  // Get all issues with missing assignee OR no comments OR no history
  const issuesRes = await pool.query(`
    SELECT i.id, i.key FROM issues i
    WHERE i."spaceId" = $1
      AND (i."assigneeId" IS NULL OR i."reporterId" IS NULL)
    ORDER BY i.key
  `, [spaceId]);

  const issues = issuesRes.rows;
  console.log(`  ${issues.length} issues missing assignee/reporter`);
  if (issues.length === 0) return;

  const keys = issues.map(i => i.key);
  let updated = 0;
  const batchSize = 50;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = issues.slice(i, i + batchSize);
    const batchKeys = batch.map(x => x.key);
    const jiraMap = await fetchJiraByKeys(batchKeys);

    for (const issue of batch) {
      const ji = jiraMap.get(issue.key);
      if (!ji) continue;
      const didUpdate = await applyJiraData(issue.id, issue.key, ji);
      if (didUpdate) updated++;
    }

    const progress = Math.min(i + batchSize, keys.length);
    process.stdout.write(`  Progress: ${progress}/${keys.length} (updated ${updated})\r`);
  }

  console.log(`\n  â†’ Updated ${updated}/${issues.length} issues in ${spaceKey}`);
}

// â”€â”€ Sync L1BOAR (key mismatch, match by title via CFITS) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function syncL1Board() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Board: L1BOAR â† Jira: CFITS (title-matching)`);

  const spaceRes = await pool.query(`SELECT id FROM spaces WHERE key = 'L1BOAR'`);
  if (!spaceRes.rows.length) { console.log('  Space not found.'); return; }
  const spaceId = spaceRes.rows[0].id;

  const issuesRes = await pool.query(`
    SELECT i.id, i.key, i.summary FROM issues i
    WHERE i."spaceId" = $1 AND (i."assigneeId" IS NULL OR i."reporterId" IS NULL)
    ORDER BY i.key
  `, [spaceId]);

  const localIssues = issuesRes.rows;
  console.log(`  ${localIssues.length} issues missing assignee/reporter`);
  if (localIssues.length === 0) return;

  // Build title â†’ issue map
  const byTitle = new Map();
  for (const issue of localIssues) {
    if (issue.summary) {
      byTitle.set(normalize(issue.summary), issue);
      const norm = normalize(issue.summary);
      if (norm.length > 20) byTitle.set(norm.slice(0, 60), issue);
    }
  }

  // Fetch CFITS issues with assignee set (targeted JQL)
  const jql = encodeURIComponent('project=CFITS AND assignee is not EMPTY ORDER BY updated DESC');
  let nextPageToken = null;
  let fetched = 0;
  let updated = 0;
  const pageSize = 100;
  const fields = `summary,assignee,reporter,comment,${CUSTOM_FIELDS}`;

  while (byTitle.size > 0) {
    let url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&maxResults=${pageSize}&fields=${fields}`;
    if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

    let res, data;
    try {
      res = await fetchWithRetry(url, { headers: HEADERS });
      if (!res.ok) { console.error(`  Jira error ${res.status}`); break; }
      data = await res.json();
    } catch (e) { console.error(`  Fetch error: ${e.message}`); break; }

    const batch = data.issues || [];
    fetched += batch.length;

    for (const ji of batch) {
      const norm = normalize(ji.fields?.summary || '');
      let localIssue = byTitle.get(norm) ?? byTitle.get(norm.slice(0, 60));
      if (!localIssue && norm.length >= 15) {
        for (const [tNorm, issue] of byTitle) {
          const shorter = tNorm.length < norm.length ? tNorm : norm;
          const longer  = tNorm.length >= norm.length ? tNorm : norm;
          if (shorter.length >= 15 && longer.includes(shorter)) { localIssue = issue; break; }
        }
      }
      if (!localIssue) continue;

      const didUpdate = await applyJiraData(localIssue.id, localIssue.key, ji);
      if (didUpdate) {
        updated++;
        byTitle.delete(norm);
        if (norm.length > 20) byTitle.delete(norm.slice(0, 60));
      }
    }

    if (fetched % 2000 === 0) process.stdout.write(`  Fetched ${fetched} from CFITS, updated ${updated}...\r`);
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  console.log(`\n  â†’ Updated ${updated} issues in L1BOAR (fetched ${fetched} from CFITS)`);
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function main() {
  console.log('Bulk syncing assignee/reporter/comments/history for all boards...');
  console.log('Start:', new Date().toLocaleTimeString());

  for (const board of DIRECT_BOARDS) {
    await syncDirectBoard(board);
  }

  await syncL1Board();

  console.log('\nâœ… Done!', new Date().toLocaleTimeString());
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });


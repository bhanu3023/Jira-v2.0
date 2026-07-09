/**
 * Syncs a specific issue from Jira into the local DB: assignee, reporter, comments, history.
 * Usage: node sync-missing-issue.mjs L2B-12718
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

// ADF node â†’ plain HTML
function adfToHtml(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'doc') return (node.content || []).map(adfToHtml).join('');
  if (node.type === 'paragraph') {
    const inner = (node.content || []).map(adfToHtml).join('');
    return inner ? `<p>${inner}</p>` : '<p></p>';
  }
  if (node.type === 'text') {
    let t = node.text || '';
    const marks = node.marks || [];
    for (const m of marks) {
      if (m.type === 'strong')    t = `<strong>${t}</strong>`;
      if (m.type === 'em')        t = `<em>${t}</em>`;
      if (m.type === 'underline') t = `<u>${t}</u>`;
      if (m.type === 'code')      t = `<code>${t}</code>`;
      if (m.type === 'link')      t = `<a href="${m.attrs?.href || '#'}">${t}</a>`;
    }
    return t;
  }
  if (node.type === 'hardBreak') return '<br/>';
  if (node.type === 'bulletList') return `<ul>${(node.content||[]).map(adfToHtml).join('')}</ul>`;
  if (node.type === 'orderedList') return `<ol>${(node.content||[]).map(adfToHtml).join('')}</ol>`;
  if (node.type === 'listItem') return `<li>${(node.content||[]).map(adfToHtml).join('')}</li>`;
  if (node.type === 'heading') return `<h${node.attrs?.level||2}>${(node.content||[]).map(adfToHtml).join('')}</h${node.attrs?.level||2}>`;
  if (node.type === 'codeBlock') return `<pre><code>${(node.content||[]).map(n=>n.text||'').join('')}</code></pre>`;
  if (node.type === 'blockquote') return `<blockquote>${(node.content||[]).map(adfToHtml).join('')}</blockquote>`;
  if (node.type === 'mediaSingle' || node.type === 'media') {
    const url = node.attrs?.url || node.content?.[0]?.attrs?.url;
    if (url) return `<img src="${url}" style="max-width:100%"/>`;
    return '';
  }
  if (node.type === 'inlineCard' || node.type === 'blockCard') {
    const url = node.attrs?.url;
    return url ? `<a href="${url}">${url}</a>` : '';
  }
  return (node.content || []).map(adfToHtml).join('');
}

// Match Jira displayName â†’ local user by firstName+lastName
async function resolveUserByDisplayName(displayName) {
  if (!displayName) return null;
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 0) return null;

  // Try full name match
  const rows = await pool.query(
    `SELECT id, email FROM users WHERE LOWER(CONCAT("firstName", ' ', "lastName")) = LOWER($1)`,
    [displayName.trim()]
  );
  if (rows.rows.length) return rows.rows[0];

  // Try first name only
  if (parts.length >= 1) {
    const rows2 = await pool.query(
      `SELECT id, email FROM users WHERE LOWER("firstName") = LOWER($1) LIMIT 1`,
      [parts[0]]
    );
    if (rows2.rows.length) return rows2.rows[0];
  }
  return null;
}

async function syncIssue(issueKey) {
  console.log(`\nSyncing ${issueKey}...`);

  // Get local issue
  const localRes = await pool.query(`SELECT id, "spaceId" FROM issues WHERE key = $1`, [issueKey]);
  if (!localRes.rows.length) { console.log('Issue not in DB, skipping.'); return; }
  const { id: issueId } = localRes.rows[0];

  // Fetch from Jira with changelog
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}?fields=summary,assignee,reporter,comment,status,priority,issuetype,customfield_10401,customfield_10883,customfield_11380,customfield_10203,customfield_10236&expand=changelog`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) { console.log(`Jira error ${res.status}`); return; }
  const ji = await res.json();
  const f = ji.fields || {};

  // â”€â”€ 1. Resolve & update assignee/reporter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const assigneeUser  = await resolveUserByDisplayName(f.assignee?.displayName);
  const reporterUser  = await resolveUserByDisplayName(f.reporter?.displayName);

  console.log(`  Assignee: "${f.assignee?.displayName}" â†’ ${assigneeUser?.email || 'NOT FOUND'}`);
  console.log(`  Reporter: "${f.reporter?.displayName}" â†’ ${reporterUser?.email || 'NOT FOUND'}`);

  const updateFields = [];
  const updateVals = [];
  let idx = 1;
  if (assigneeUser) { updateFields.push(`"assigneeId" = $${idx++}`); updateVals.push(assigneeUser.id); }
  if (reporterUser) { updateFields.push(`"reporterId" = $${idx++}`); updateVals.push(reporterUser.id); }
  if (updateFields.length) {
    updateVals.push(issueId);
    await pool.query(`UPDATE issues SET ${updateFields.join(', ')} WHERE id = $${idx}`, updateVals);
    console.log(`  âœ“ Updated assignee/reporter`);
  }

  // â”€â”€ 2. Import comments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const jiraComments = f.comment?.comments || [];
  console.log(`  ${jiraComments.length} comments in Jira`);

  // Delete existing comments for this issue (re-sync fresh)
  await pool.query(`DELETE FROM comments WHERE "issueId" = $1`, [issueId]);

  for (const jc of jiraComments) {
    const authorUser = await resolveUserByDisplayName(jc.author?.displayName);
    let body = '';
    if (jc.body && typeof jc.body === 'object') {
      body = adfToHtml(jc.body);
    } else if (typeof jc.body === 'string') {
      body = jc.body;
    }

    await pool.query(
      `INSERT INTO comments (id, body, "issueId", "authorId", "authorName", "authorEmail", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)`,
      [
        body || '(empty)',
        issueId,
        authorUser?.id || null,
        jc.author?.displayName || null,
        authorUser?.email || null,
        new Date(jc.created),
        new Date(jc.updated || jc.created),
      ]
    );
  }
  console.log(`  âœ“ Imported ${jiraComments.length} comments`);

  // â”€â”€ 3. Import history from changelog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const changelog = ji.changelog?.histories || [];
  console.log(`  ${changelog.length} changelog entries in Jira`);

  // Delete existing history for clean re-sync
  await pool.query(`DELETE FROM issue_history WHERE "issueId" = $1`, [issueId]);

  let histCount = 0;
  for (const entry of changelog) {
    const authorUser = await resolveUserByDisplayName(entry.author?.displayName);
    const authorName  = entry.author?.displayName || null;
    const authorEmail = authorUser?.email || null;
    const createdAt   = new Date(entry.created);

    for (const item of entry.items || []) {
      const field = item.field?.toLowerCase() || '';
      // Map field names to our convention
      const fieldMap = {
        status: 'status', assignee: 'assignee', priority: 'priority',
        summary: 'summary', description: 'description', issuetype: 'issuetype',
        labels: 'labels', comment: 'comment', resolution: 'resolution',
      };
      const mappedField = fieldMap[field] || field;

      await pool.query(
        `INSERT INTO issue_history (id, "issueId", field, "oldValue", "newValue", "authorName", "authorEmail", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)`,
        [issueId, mappedField, item.fromString || null, item.toString || null, authorName, authorEmail, createdAt]
      );
      histCount++;
    }
  }
  console.log(`  âœ“ Imported ${histCount} history entries`);
  console.log(`  Done for ${issueKey}`);
}

const key = process.argv[2] || 'L2B-12718';
syncIssue(key).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });


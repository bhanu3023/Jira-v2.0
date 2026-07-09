/**
 * migrate-cfits.js
 * Imports CFITS (L1BOAR) tickets from Jira that don't exist locally.
 * Deduplication: match by normalized summary in L1BOAR space.
 */
const https = require('https');
const { Pool } = require('pg');

const JIRA_BASE_URL = 'https://cf2020.atlassian.net';
const JIRA_EMAIL = 'sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN = 'REDACTED_API_TOKEN';
const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
const pool = new Pool({ host:'localhost', port:5433, database:'neutara_db', user:'postgres', password:'neutara123' });

function jiraPost(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'cf2020.atlassian.net',
      path: '/rest/api/3/search/jql',
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function normSummary(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function getLocalSummarySet() {
  const r = await pool.query(`SELECT LOWER(TRIM(summary)) as s FROM issues WHERE key LIKE 'L1BOAR-%' AND summary IS NOT NULL AND summary != ''`);
  const set = new Set();
  r.rows.forEach(row => set.add(row.s));
  return set;
}

async function getSpace() {
  const r = await pool.query(`SELECT id FROM spaces WHERE key='TESTIN' LIMIT 1`);
  return r.rows[0]?.id;
}

async function getOrCreateStatus(spaceId, statusName) {
  const r = await pool.query(`SELECT id FROM statuses WHERE "spaceId"=$1 AND LOWER(name)=LOWER($2) LIMIT 1`, [spaceId, statusName]);
  if (r.rows[0]) return r.rows[0].id;
  const r2 = await pool.query(`SELECT id FROM statuses WHERE "spaceId"=$1 LIMIT 1`, [spaceId]);
  return r2.rows[0]?.id || null;
}

async function resolveUser(displayName, email) {
  if (!displayName) return null;
  const parts = displayName.trim().split(/\s+/);
  const r = await pool.query(
    `SELECT id FROM users WHERE LOWER("firstName")=LOWER($1) AND LOWER("lastName")=LOWER($2) LIMIT 1`,
    [parts[0], parts.slice(1).join(' ')]
  );
  if (r.rows[0]) return r.rows[0].id;
  if (email) {
    const r2 = await pool.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (r2.rows[0]) return r2.rows[0].id;
  }
  return null;
}

async function getNextL1BoarNum() {
  const r = await pool.query(`SELECT MAX(CAST(SPLIT_PART(key,'-',2) AS INTEGER)) as mx FROM issues WHERE key LIKE 'L1BOAR-%'`);
  return (r.rows[0]?.mx || 5618) + 1;
}

function extractText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.content) return node.content.map(extractText).join('\n');
  return '';
}

async function importTicket(jiraIssue, spaceId, nextNum) {
  const f = jiraIssue.fields || {};
  const summary = f.summary || jiraIssue.key;
  const jiraKey = jiraIssue.key;
  const localKey = `L1BOAR-${nextNum}`;

  const statusId = await getOrCreateStatus(spaceId, f.status?.name || 'Open');
  const assigneeId = await resolveUser(f.assignee?.displayName, f.assignee?.emailAddress);
  const reporterId = await resolveUser(f.reporter?.displayName, f.reporter?.emailAddress);
  const priority = (f.priority?.name || 'medium').toLowerCase();
  const type = (f.issuetype?.name || 'task').toLowerCase();
  const createdAt = f.created ? new Date(f.created) : new Date();
  const updatedAt = f.updated ? new Date(f.updated) : new Date();
  const jiraAssigneeName = f.assignee?.displayName || null;
  const jiraReporterName = f.reporter?.displayName || null;

  let description = '';
  if (f.description?.content) {
    description = extractText(f.description);
  } else if (typeof f.description === 'string') {
    description = f.description;
  }

  const id = 'pg_' + Math.random().toString(36).slice(2, 14);

  await pool.query(
    `INSERT INTO issues (id, key, summary, description, type, priority, "spaceId", "statusId", "assigneeId", "reporterId", "createdAt", "updatedAt", current_department, jira_source_key, jira_assignee_name, jira_reporter_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (key) DO NOTHING`,
    [id, localKey, summary, description, type, priority, spaceId, statusId, assigneeId, reporterId, createdAt, updatedAt, 'Migration', jiraKey, jiraAssigneeName, jiraReporterName]
  );
  return localKey;
}

async function main() {
  // Ensure columns exist
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS jira_source_key TEXT`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS jira_assignee_name TEXT`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS jira_reporter_name TEXT`);

  const spaceId = await getSpace();
  if (!spaceId) { console.error('Space TESTIN not found'); process.exit(1); }
  console.log('Space ID:', spaceId);

  console.log('Loading existing summaries...');
  const existingSummaries = await getLocalSummarySet();
  console.log(`Found ${existingSummaries.size} existing L1BOAR summaries`);

  const existingJiraKeys = new Set();
  const jkRows = await pool.query(`SELECT jira_source_key FROM issues WHERE jira_source_key IS NOT NULL`);
  jkRows.rows.forEach(r => existingJiraKeys.add(r.jira_source_key));
  console.log(`${existingJiraKeys.size} tickets already have jira_source_key`);

  let nextNum = await getNextL1BoarNum();
  console.log(`Next L1BOAR number: ${nextNum}`);

  let totalProcessed = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  let nextPageToken = undefined;

  do {
    const body = {
      jql: 'project=CFITS ORDER BY key DESC',
      maxResults: 50,
      fields: ['summary', 'description', 'status', 'priority', 'issuetype', 'assignee', 'reporter', 'created', 'updated']
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const result = await jiraPost(body);
    const issues = result.issues || [];
    nextPageToken = result.nextPageToken || null;

    if (issues.length === 0) break;

    for (const issue of issues) {
      totalProcessed++;
      const normSum = normSummary(issue.fields?.summary);

      if (existingJiraKeys.has(issue.key)) {
        totalSkipped++;
        continue;
      }
      if (existingSummaries.has(normSum)) {
        totalSkipped++;
        // Mark existing ticket with jira_source_key
        if (normSum) {
          await pool.query(
            `UPDATE issues SET jira_source_key=$1 WHERE id=(SELECT id FROM issues WHERE key LIKE 'L1BOAR-%' AND LOWER(TRIM(summary))=$2 AND jira_source_key IS NULL LIMIT 1)`,
            [issue.key, normSum]
          );
        }
        continue;
      }

      const localKey = await importTicket(issue, spaceId, nextNum);
      existingSummaries.add(normSum);
      existingJiraKeys.add(issue.key);
      nextNum++;
      totalImported++;
      console.log(`  Imported ${issue.key} â†’ ${localKey}: ${(issue.fields?.summary||'').substring(0,60)}`);
    }

    console.log(`Processed ${totalProcessed} | imported: ${totalImported} | skipped: ${totalSkipped} | nextPageToken: ${nextPageToken ? 'yes' : 'no'}`);
    await new Promise(r => setTimeout(r, 200));
  } while (nextPageToken);

  console.log(`\nDone! Total: ${totalProcessed}, imported: ${totalImported}, skipped: ${totalSkipped}`);

  // Assign CF keys to new tickets
  if (totalImported > 0) {
    console.log('Assigning CF keys to new tickets...');
    const maxCF = await pool.query(`SELECT MAX(CAST(SUBSTRING(cf_key FROM 4) AS INTEGER)) as mx FROM issues WHERE cf_key LIKE 'CF-%'`);
    let cfNum = (maxCF.rows[0]?.mx || 0) + 1;
    const newTickets = await pool.query(`SELECT id FROM issues WHERE key LIKE 'L1BOAR-%' AND cf_key IS NULL ORDER BY "createdAt" ASC`);
    for (const row of newTickets.rows) {
      await pool.query(`UPDATE issues SET cf_key=$1 WHERE id=$2`, [`CF-${cfNum}`, row.id]);
      cfNum++;
    }
    console.log(`Assigned ${newTickets.rows.length} CF keys`);
  }

  pool.end();
}

main().catch(e => { console.error(e); pool.end(); });


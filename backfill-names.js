/**
 * backfill-names.js
 * For L1BOAR tickets with null assigneeId/reporterId,
 * fetch from Jira by summary match and backfill jira_assignee_name/jira_reporter_name.
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
      headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
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

function escapeJql(s) {
  return s.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
}

async function main() {
  // Get tickets missing assignee or reporter name
  const r = await pool.query(`
    SELECT id, key, summary
    FROM issues
    WHERE key LIKE 'L1BOAR-%'
    AND (jira_assignee_name IS NULL OR jira_reporter_name IS NULL)
    AND summary IS NOT NULL AND summary != ''
    ORDER BY "createdAt" DESC
    LIMIT 500
  `);

  console.log(`Found ${r.rows.length} L1BOAR tickets to backfill`);
  let updated = 0;

  for (const ticket of r.rows) {
    const summary = ticket.summary;
    // Escape for JQL
    const escaped = escapeJql(summary.substring(0, 100));
    try {
      const res = await jiraPost({
        jql: `project=CFITS AND summary ~ "${escaped}" ORDER BY created DESC`,
        maxResults: 3,
        fields: ['summary', 'assignee', 'reporter']
      });

      if (res.issues && res.issues.length > 0) {
        // Find best match by summary similarity
        const match = res.issues.find(i =>
          (i.fields?.summary||'').toLowerCase().trim() === summary.toLowerCase().trim()
        ) || res.issues[0];

        const assigneeName = match.fields?.assignee?.displayName || null;
        const reporterName = match.fields?.reporter?.displayName || null;

        if (assigneeName || reporterName) {
          await pool.query(
            `UPDATE issues SET jira_assignee_name=$1, jira_reporter_name=$2 WHERE id=$3`,
            [assigneeName, reporterName, ticket.id]
          );
          updated++;
          if (updated % 20 === 0) console.log(`Updated ${updated} tickets...`);
        }
      }
    } catch(e) {
      // Skip on error
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`Done! Updated ${updated} tickets with Jira names`);
  pool.end();
}

main().catch(e => { console.error(e); pool.end(); });


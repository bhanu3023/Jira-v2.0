const https = require('https');
const { Pool } = require('pg');

const JIRA_BASE_URL = 'https://cf2020.atlassian.net';
const JIRA_EMAIL = 'sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN = 'REDACTED_API_TOKEN';
const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

const pool = new Pool({ host:'localhost', port:5433, database:'neutara_db', user:'postgres', password:'neutara123' });

function jiraGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(JIRA_BASE_URL + path, { headers: { 'Authorization': auth, 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Check if CFITS-5000 summary matches L1BOAR-5000
  const j5000 = await jiraGet('/rest/api/3/issue/CFITS-5000?fields=summary,created');
  console.log('Jira CFITS-5000:', j5000.fields?.summary, '| created:', j5000.fields?.created);

  const r5000 = await pool.query(`SELECT key, summary, "createdAt" FROM issues WHERE key='L1BOAR-5000'`);
  console.log('Local L1BOAR-5000:', r5000.rows[0]?.summary, '| created:', r5000.rows[0]?.createdAt);

  // Also check CFITS-1
  const j1 = await jiraGet('/rest/api/3/issue/CFITS-1?fields=summary,created');
  console.log('Jira CFITS-1:', j1.fields?.summary);
  const r1 = await pool.query(`SELECT key, summary FROM issues WHERE key='L1BOAR-1'`);
  console.log('Local L1BOAR-1:', r1.rows[0]?.summary);

  pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });


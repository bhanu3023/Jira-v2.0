const https = require('https');
const { Pool } = require('pg');
const JIRA_EMAIL = 'sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN = 'REDACTED_API_TOKEN';
const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
const pool = new Pool({ host:'localhost', port:5433, database:'neutara_db', user:'postgres', password:'neutara123' });

function jiraGet(key) {
  return new Promise((resolve, reject) => {
    const url = `https://cf2020.atlassian.net/rest/api/3/issue/${key}?fields=description,attachment`;
    const req = https.request(url, { headers: { 'Authorization': auth, 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Find an L2B ticket we know has image references
  const r = await pool.query(`SELECT key FROM issues WHERE key LIKE 'L2B-%' AND description ILIKE '%!image%' LIMIT 1`);

  // Just fetch a recent CFITS ticket to see ADF format
  const ji = await jiraGet('CFITS-8000');
  const desc = ji.fields?.description;

  if (desc) {
    console.log('Description type:', desc.type);
    console.log('Content nodes:', JSON.stringify(desc.content?.slice(0,3), null, 2));
    // Check for media nodes (images)
    const findMedia = (node) => {
      if (!node) return [];
      if (node.type === 'mediaSingle' || node.type === 'media') return [node];
      if (node.content) return node.content.flatMap(findMedia);
      return [];
    };
    const media = findMedia(desc);
    console.log('Media nodes found:', media.length);
    if (media.length > 0) console.log('First media:', JSON.stringify(media[0], null, 2));
  }

  // Also check attachments
  const attachments = ji.fields?.attachment || [];
  console.log('Attachments:', attachments.length);
  if (attachments.length > 0) console.log('First attachment:', JSON.stringify(attachments[0], null, 2));

  // Check history records for a specific L1BOAR ticket
  const h = await pool.query(`SELECT COUNT(*) as cnt FROM issue_history WHERE "issueId"=(SELECT id FROM issues WHERE key='L1BOAR-1')`);
  console.log('\nHistory records for L1BOAR-1:', h.rows[0].cnt);
  const sample = await pool.query(`SELECT field, "oldValue", "newValue", "authorName" FROM issue_history WHERE "issueId"=(SELECT id FROM issues WHERE key='L1BOAR-1') LIMIT 5`);
  console.log('Sample:', JSON.stringify(sample.rows, null, 2));

  pool.end();
}
main().catch(e => { console.error(e); pool.end(); });


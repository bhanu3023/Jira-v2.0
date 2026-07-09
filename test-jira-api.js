const https = require('https');
const JIRA_EMAIL = 'sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN = 'REDACTED_API_TOKEN';
const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

const payload = JSON.stringify({
  jql: 'project=CFITS ORDER BY key DESC',
  maxResults: 5,
  fields: ['summary', 'assignee', 'reporter', 'status', 'priority', 'issuetype', 'created', 'updated']
});

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
  console.log('Status:', res.statusCode);
  res.on('data', d => data += d);
  res.on('end', () => {
    const json = JSON.parse(data);
    if (json.issues) {
      console.log('Total:', json.total);
      json.issues.forEach(i => console.log(`${i.key}: ${i.fields?.summary?.substring(0,50)}`));
    } else {
      console.log(JSON.stringify(json).substring(0, 500));
    }
  });
});
req.on('error', e => console.error('Error:', e.message));
req.write(payload);
req.end();


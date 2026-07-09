const { Pool } = require('pg');
const pool = new Pool({ host:'localhost', port:5433, database:'neutara_db', user:'postgres', password:'neutara123' });

pool.query(`SELECT COUNT(*) as total FROM issue_history WHERE "issueId" IN (SELECT id FROM issues WHERE key LIKE 'L1BOAR-%')`)
.then(r => {
  console.log('L1BOAR history records:', r.rows[0]);
  // Check sample history record
  return pool.query(`SELECT * FROM issue_history ORDER BY "createdAt" DESC LIMIT 3`);
}).then(r => {
  console.log('Sample history:', JSON.stringify(r.rows, null, 2));
  // Check if any descriptions have Jira image references
  return pool.query(`SELECT key, LEFT(description,500) FROM issues WHERE description ILIKE '%!image%' OR description ILIKE '%secure/attachment%' LIMIT 3`);
}).then(r => {
  console.log('Descriptions with Jira image refs:', JSON.stringify(r.rows, null, 2));
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });

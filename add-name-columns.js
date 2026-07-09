const { Pool } = require('pg');
const pool = new Pool({ host:'localhost', port:5433, database:'neutara_db', user:'postgres', password:'neutara123' });
pool.query(`
  ALTER TABLE issues ADD COLUMN IF NOT EXISTS jira_assignee_name TEXT;
  ALTER TABLE issues ADD COLUMN IF NOT EXISTS jira_reporter_name TEXT;
  ALTER TABLE issues ADD COLUMN IF NOT EXISTS jira_source_key TEXT;
  CREATE INDEX IF NOT EXISTS idx_issues_jira_source_key ON issues(jira_source_key);
`).then(() => { console.log('Columns added'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });

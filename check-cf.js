const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5433/neutara_db' });
pool.query('SELECT key, cf_key, current_department, summary FROM issues WHERE cf_key = $1 LIMIT 1', ['CF-27210'])
  .then(r => { console.log(JSON.stringify(r.rows[0])); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });

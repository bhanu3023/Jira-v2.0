import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5433/neutara_db' });
const spaces = await pool.query(`SELECT id, key, name FROM spaces`);
console.log('spaces:', JSON.stringify(spaces.rows));
const depts = await pool.query(`SELECT DISTINCT current_department, "spaceId" FROM issues WHERE current_department IS NOT NULL ORDER BY current_department`);
console.log('depts:', JSON.stringify(depts.rows));
await pool.end();

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5432/neutara_db' });

const r = await pool.query(`SELECT id, key, name FROM spaces WHERE name ILIKE '%test%' OR key ILIKE '%test%'`);
console.log(r.rows);
await pool.end();

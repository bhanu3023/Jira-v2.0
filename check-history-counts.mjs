import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5432/neutara_db' });

const r = await pool.query(`
  SELECT
    s.key,
    s.name,
    COUNT(DISTINCT i.id) AS issues,
    COUNT(DISTINCT h.id) AS history_records
  FROM spaces s
  LEFT JOIN issues i ON i."spaceId" = s.id
  LEFT JOIN issue_history h ON h."issueId" = i.id
  GROUP BY s.key, s.name
  ORDER BY s.key
`);
console.table(r.rows);
await pool.end();

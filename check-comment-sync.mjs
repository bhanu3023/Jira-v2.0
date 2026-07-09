import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5432/neutara_db' });

// Check comments with images per board
const r = await pool.query(`
  SELECT
    s.key,
    s.name,
    COUNT(DISTINCT i.id) AS total_issues,
    COUNT(DISTINCT c.id) AS total_comments,
    COUNT(DISTINCT CASE WHEN c.body LIKE '%<img%' THEN c.id END) AS comments_with_images
  FROM spaces s
  LEFT JOIN issues i ON i."spaceId" = s.id
  LEFT JOIN comments c ON c."issueId" = i.id
  GROUP BY s.key, s.name
  ORDER BY s.key
`);
console.table(r.rows);
await pool.end();

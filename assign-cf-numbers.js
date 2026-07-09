const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5433/neutara_db' });

async function main() {
  // Add cf_key column if not exists
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS cf_key VARCHAR`);
  console.log('cf_key column ready');

  // Assign CF-1, CF-2 ... sequentially ordered by createdAt
  const result = await pool.query(`
    UPDATE issues i
    SET cf_key = 'CF-' || numbered.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
      FROM issues
    ) AS numbered
    WHERE i.id = numbered.id
  `);
  console.log('Updated rows:', result.rowCount);

  // Verify sample per queue
  const sample = await pool.query(`
    SELECT current_department, MIN(cf_key) as first_key, MAX(cf_key) as last_key, COUNT(*) as cnt
    FROM issues
    GROUP BY current_department
    ORDER BY cnt DESC
  `);
  console.log('\nQueue CF key ranges:');
  sample.rows.forEach(r => console.log(`  ${r.current_department}: ${r.first_key} ~ ${r.last_key} (${r.cnt} tickets)`));

  await pool.end();
}
main().catch(console.error);

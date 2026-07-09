const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5433/neutara_db' });
async function main() {
  const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='issues' ORDER BY ordinal_position`);
  console.log('Columns:', cols.rows.map(r => r.column_name).join(', '));
  const total = await pool.query('SELECT COUNT(*) FROM issues');
  console.log('Total tickets:', total.rows[0].count);
  const sample = await pool.query(`SELECT key, current_department FROM issues ORDER BY "createdAt" LIMIT 5`);
  console.log('Sample keys:', JSON.stringify(sample.rows));
  const depts = await pool.query(`SELECT current_department, COUNT(*) cnt FROM issues GROUP BY current_department ORDER BY cnt DESC`);
  console.log('\nQueue counts:');
  depts.rows.forEach(r => console.log(' ', r.current_department + ':', r.cnt));
  await pool.end();
}
main().catch(console.error);

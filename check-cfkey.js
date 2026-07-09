const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5433/neutara_db' });
async function main() {
  const nulls = await pool.query('SELECT COUNT(*) cnt FROM issues WHERE cf_key IS NULL');
  console.log('Tickets WITHOUT cf_key:', nulls.rows[0].cnt);
  const total = await pool.query('SELECT COUNT(*) cnt FROM issues');
  console.log('Total tickets:', total.rows[0].cnt);
  const s = await pool.query(`SELECT key, cf_key FROM issues WHERE current_department='Infra' ORDER BY "createdAt" DESC LIMIT 5`);
  console.log('Infra sample:', JSON.stringify(s.rows));
  await pool.end();
}
main().catch(console.error);

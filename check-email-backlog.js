const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });
async function main() {
  // Current Email-Migration-Backlog tickets in DB
  const count = await pool.query("SELECT COUNT(*) FROM issues WHERE current_department = 'Email-Migration-Backlog'");
  console.log("Email-Migration-Backlog tickets in DB:", count.rows[0].count);

  // Check if EBBOARD space exists
  const space = await pool.query("SELECT id, key, name FROM spaces WHERE key = 'EBBOARD' OR name ILIKE '%email%migration%'");
  console.log("EBBOARD space:", JSON.stringify(space.rows));

  // All current dept distribution
  const depts = await pool.query("SELECT current_department, COUNT(*) as cnt FROM issues GROUP BY current_department ORDER BY cnt DESC");
  console.log("\nAll queue counts:");
  for (const r of depts.rows) console.log(`  "${r.current_department}": ${r.cnt}`);

  await pool.end();
}
main().catch(console.error);

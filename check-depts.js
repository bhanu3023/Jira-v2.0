const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });
async function main() {
  const testin = await pool.query("SELECT id, key, name, sub_board_keys FROM spaces WHERE key = 'TESTIN'");
  console.log("TESTIN config:", JSON.stringify(testin.rows[0], null, 2));

  // All current_department values
  const depts = await pool.query(`
    SELECT current_department, COUNT(*) as cnt FROM issues
    GROUP BY current_department ORDER BY cnt DESC
  `);
  console.log("\nAll dept values:", JSON.stringify(depts.rows, null, 2));

  // Sample 5 Migration tickets to see their fields
  const sample = await pool.query(`
    SELECT key, current_department, original_dept, "statusId" FROM issues LIMIT 5
  `);
  console.log("\nSample tickets:", JSON.stringify(sample.rows, null, 2));

  await pool.end();
}
main().catch(console.error);

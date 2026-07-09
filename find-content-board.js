const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });
async function main() {
  const spaces = await pool.query("SELECT id, key, name FROM spaces WHERE name ILIKE $1 OR key ILIKE $1", ["%content%"]);
  console.log("Spaces:", JSON.stringify(spaces.rows));
  for (const s of spaces.rows) {
    const cnt = await pool.query('SELECT COUNT(*) FROM issues WHERE "spaceId" = $1', [s.id]);
    console.log(s.key, s.name, "->", cnt.rows[0].count, "tickets");
  }
  await pool.end();
}
main().catch(console.error);

const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });
async function main() {
  const cols = await pool.query("SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name='id'");
  console.log("users.id:", JSON.stringify(cols.rows[0]));

  const icols = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='issues' AND column_name IN ('reporterId','assigneeId')");
  console.log("issues FK cols:", JSON.stringify(icols.rows));

  // Try inserting a test user
  try {
    await pool.query(
      "INSERT INTO users (id,email,\"firstName\",\"lastName\",\"createdAt\",\"updatedAt\") VALUES ($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT (email) DO NOTHING",
      ["usr_hrushikesh_sholapure_cloudfuze_com", "hrushikesh.sholapure@cloudfuze.com", "Hrushikesh", "Sholapure"]
    );
    const check = await pool.query("SELECT id FROM users WHERE email='hrushikesh.sholapure@cloudfuze.com'");
    console.log("User inserted:", JSON.stringify(check.rows));
  } catch(e) { console.log("Insert error:", e.message); }

  await pool.end();
}
main().catch(console.error);

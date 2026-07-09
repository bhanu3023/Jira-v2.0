const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });
async function main() {
  const CFMBOARD_SPACE_ID = "411a43b4-bb95-4e86-b98b-cf9b9714a46b";
  const TESTIN_ID_Q = await pool.query("SELECT id, key FROM spaces WHERE key = 'TESTIN'");
  const TESTIN_ID = TESTIN_ID_Q.rows[0].id;
  const TESTIN_KEY = TESTIN_ID_Q.rows[0].key.toLowerCase();

  const users = await pool.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN issues i ON (i."reporterId" = u.id OR i."assigneeId" = u.id)
     WHERE i."spaceId" = $1`,
    [CFMBOARD_SPACE_ID]
  );
  console.log("Unique users in CFMBOARD:", users.rows.length);

  let added = 0;
  for (const u of users.rows) {
    const exists = await pool.query(
      'SELECT 1 FROM space_members WHERE "spaceId" = $1 AND "userId" = $2',
      [TESTIN_ID, u.id]
    );
    if (exists.rows.length === 0) {
      const memberId = `sm_${TESTIN_KEY}_${u.id}`;
      await pool.query(
        'INSERT INTO space_members (id, "spaceId", "userId", role) VALUES ($1, $2, $3, $4)',
        [memberId, TESTIN_ID, u.id, 'member']
      );
      added++;
    }
  }
  console.log("New members added to CloudFuze Board:", added);

  const final = await pool.query("SELECT sub_board_keys FROM spaces WHERE key = 'TESTIN'");
  console.log("Final sub_board_keys:", final.rows[0].sub_board_keys);

  await pool.end();
}
main().catch(console.error);

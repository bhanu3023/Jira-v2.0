const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });
async function main() {
  const CBBOARD_SPACE_ID = "0229d3dc-9f0c-4322-8d50-f078d3c31be6";
  const TESTIN_SPACE_ID_QUERY = await pool.query("SELECT id FROM spaces WHERE key = 'TESTIN'");
  const TESTIN_ID = TESTIN_SPACE_ID_QUERY.rows[0].id;

  const users = await pool.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN issues i ON (i."reporterId" = u.id OR i."assigneeId" = u.id)
     WHERE i."spaceId" = $1`,
    [CBBOARD_SPACE_ID]
  );
  console.log("Unique users in CBBOARD:", users.rows.length);

  let added = 0;
  for (const u of users.rows) {
    const exists = await pool.query(
      'SELECT 1 FROM space_members WHERE "spaceId" = $1 AND "userId" = $2',
      [TESTIN_ID, u.id]
    );
    if (exists.rows.length === 0) {
      await pool.query(
        'INSERT INTO space_members ("spaceId", "userId", role) VALUES ($1, $2, $3)',
        [TESTIN_ID, u.id, 'member']
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

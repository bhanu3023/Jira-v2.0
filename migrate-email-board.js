const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:neutara123@localhost:5433/neutara_db" });
async function main() {
  const EBBOARD_SPACE_ID = "942ae277-9aa8-4037-9b9c-80d8cab93d78";
  const QUEUE_NAME = "Email-Migration-Backlog";

  const TESTIN = await pool.query("SELECT id FROM spaces WHERE key = 'TESTIN'");
  const TESTIN_ID = TESTIN.rows[0].id;

  // 1. Update tickets
  const update = await pool.query(
    `UPDATE issues SET current_department = $1, original_dept = $1
     WHERE "spaceId" = $2 AND (current_department IS NULL OR current_department = '')`,
    [QUEUE_NAME, EBBOARD_SPACE_ID]
  );
  console.log("Updated tickets:", update.rowCount);

  // 2. Add EBBOARD to TESTIN sub_board_keys
  const currentKeys = await pool.query("SELECT sub_board_keys FROM spaces WHERE key = 'TESTIN'");
  const keys = currentKeys.rows[0].sub_board_keys || [];
  if (!keys.includes("EBBOARD")) {
    await pool.query(
      "UPDATE spaces SET sub_board_keys = array_append(sub_board_keys, $1) WHERE key = 'TESTIN'",
      ["EBBOARD"]
    );
    console.log("Added EBBOARD to sub_board_keys");
  } else {
    console.log("EBBOARD already in sub_board_keys");
  }

  // 3. Add users to TESTIN space_members
  const users = await pool.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN issues i ON (i."reporterId" = u.id OR i."assigneeId" = u.id)
     WHERE i."spaceId" = $1`,
    [EBBOARD_SPACE_ID]
  );
  console.log("Unique users in EBBOARD:", users.rows.length);

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

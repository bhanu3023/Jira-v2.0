import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5432/neutara_db' });

const spaceId = 'b94a8ac8-6854-4c1c-a8df-ef1a2d32e876';

// Count what we're deleting
const counts = await pool.query(`
  SELECT
    (SELECT COUNT(*) FROM issues WHERE "spaceId" = $1) AS issues,
    (SELECT COUNT(*) FROM comments c JOIN issues i ON c."issueId" = i.id WHERE i."spaceId" = $1) AS comments,
    (SELECT COUNT(*) FROM issue_history h JOIN issues i ON h."issueId" = i.id WHERE i."spaceId" = $1) AS history
`, [spaceId]);
console.log('Deleting:', counts.rows[0]);

// Delete space — CASCADE will remove issues, comments, history, attachments, statuses, members
await pool.query(`DELETE FROM spaces WHERE id = $1`, [spaceId]);

// Also log in deleted_spaces so it doesn't get re-created
await pool.query(`INSERT INTO deleted_spaces (key, "deletedAt") VALUES ('TESTBOARD', NOW()) ON CONFLICT DO NOTHING`);

console.log('✅ Space "QA Projects - Test Board" (TESTBOARD) deleted entirely');
await pool.end();

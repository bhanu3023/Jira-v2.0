import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5432/neutara_db' });

await pool.query(`
  CREATE TABLE IF NOT EXISTS issue_history (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "issueId" TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "authorName" TEXT,
    "authorEmail" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_issue_history_issue_id ON issue_history("issueId");
  CREATE INDEX IF NOT EXISTS idx_issue_history_created_at ON issue_history("createdAt");
`);
console.log('✅ issue_history table created');
await pool.end();

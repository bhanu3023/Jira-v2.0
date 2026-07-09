import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5432/neutara_db' });

await pool.query(`
  CREATE TABLE IF NOT EXISTS api_tokens (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"     TEXT NOT NULL,
    name         TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL UNIQUE,
    prefix       TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP,
    "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
    "expiresAt"  TIMESTAMP
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens("userId")`);
await pool.query(`CREATE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens("tokenHash")`);

console.log('✅ api_tokens table created');
await pool.end();

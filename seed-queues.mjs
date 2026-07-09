/**
 * seed-queues.mjs
 * Seeds custom_queues table from department data in issues table.
 * Run on server after DB restore: node seed-queues.mjs
 */
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:neutara123@localhost:5433/neutara_db'
});

// Create table
await pool.query(`
  CREATE TABLE IF NOT EXISTS custom_queues (
    space_key TEXT PRIMARY KEY,
    queues JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

// Get all spaces
const spaces = await pool.query(`SELECT id, key, name FROM spaces`);

for (const space of spaces.rows) {
  // Check if already seeded
  const existing = await pool.query(`SELECT queues FROM custom_queues WHERE space_key = $1`, [space.key]);
  if (existing.rows.length > 0 && existing.rows[0].queues.length > 0) {
    console.log(`✓ ${space.key} (${space.name}) — already has ${existing.rows[0].queues.length} queues, skipping`);
    continue;
  }

  // Get departments used in this space
  const depts = await pool.query(`
    SELECT DISTINCT current_department
    FROM issues
    WHERE "spaceId" = $1 AND current_department IS NOT NULL
    ORDER BY current_department
  `, [space.id]);

  if (depts.rows.length === 0) {
    console.log(`⚠ ${space.key} (${space.name}) — no departments found, skipping`);
    continue;
  }

  // Build queue objects from departments
  const queues = depts.rows.map((d, i) => ({
    id: `cq_${Date.now() + i}`,
    name: d.current_department,
    memberIds: []
  }));

  await pool.query(
    `INSERT INTO custom_queues (space_key, queues, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (space_key) DO UPDATE SET queues = EXCLUDED.queues, updated_at = NOW()`,
    [space.key, JSON.stringify(queues)]
  );

  console.log(`✅ ${space.key} (${space.name}) — seeded ${queues.length} queues:`);
  queues.forEach(q => console.log(`   - ${q.name} (${q.id})`));
}

await pool.end();
console.log('\nDone!');

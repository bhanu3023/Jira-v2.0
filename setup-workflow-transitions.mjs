/**
 * Creates default "all → all" workflow transitions for every board.
 * Safe to re-run — uses upsert so no duplicates.
 * Run: node setup-workflow-transitions.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });

async function main() {
  const spaces = await db.space.findMany({ select: { id: true, key: true, name: true } });
  let total = 0;

  for (const space of spaces) {
    const statuses = await db.status.findMany({ where: { spaceId: space.id } });
    if (statuses.length === 0) { console.log(`${space.key}: no statuses, skip`); continue; }

    let created = 0;
    for (const from of statuses) {
      for (const to of statuses) {
        if (from.id === to.id) continue;
        try {
          await db.workflowTransition.upsert({
            where: { spaceId_fromStatusId_toStatusId: { spaceId: space.id, fromStatusId: from.id, toStatusId: to.id } },
            create: { spaceId: space.id, fromStatusId: from.id, toStatusId: to.id, name: `→ ${to.name}` },
            update: {},
          });
          created++;
        } catch { /* skip */ }
      }
    }
    total += created;
    console.log(`${space.key}: ${statuses.length} statuses → ${created} transitions created`);
  }

  console.log(`\nDone! Total transitions: ${total}`);
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

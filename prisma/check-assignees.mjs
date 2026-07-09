import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const spaces = await prisma.space.findMany({ select: { id: true, key: true } });
  console.log('Space       | Total  | Assignee | Reporter');
  console.log('------------|--------|----------|----------');
  for (const sp of spaces) {
    const total    = await prisma.issue.count({ where: { spaceId: sp.id } });
    const withA    = await prisma.issue.count({ where: { spaceId: sp.id, assigneeId: { not: null } } });
    const withR    = await prisma.issue.count({ where: { spaceId: sp.id, reporterId: { not: null } } });
    console.log(`${sp.key.padEnd(11)} | ${String(total).padStart(6)} | ${String(withA).padStart(8)} | ${String(withR).padStart(8)}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());

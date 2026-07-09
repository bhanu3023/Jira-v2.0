process.env.DATABASE_URL = 'postgresql://postgres:neutara123@localhost:5433/neutara_db';
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  const issues = await db.issue.findMany({
    where: { current_department: 'Infra' },
    select: { key: true, cf_key: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('Prisma result sample:');
  issues.forEach(i => console.log(' key:', i.key, ' cf_key:', i.cf_key));
  await db.$disconnect();
}
main().catch(console.error);

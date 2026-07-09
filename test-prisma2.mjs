import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5433/neutara_db' });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const issues = await db.issue.findMany({
  where: { current_department: 'Infra' },
  select: { key: true, cf_key: true },
  take: 3,
  orderBy: { createdAt: 'desc' },
});
console.log('Prisma returns cf_key?', JSON.stringify(issues, null, 2));
await db.$disconnect();
pool.end();

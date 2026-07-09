import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');
const { PrismaPg } = require('./node_modules/@prisma/adapter-pg/dist/index.js');
const { PrismaClient } = require('./node_modules/@prisma/client/index.js');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5432/neutara_db', max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const BOARDS = ['L2B', 'L1BOAR', 'IB', 'PSM', 'CFM', 'L3B', 'MB', 'EB', 'CB', 'SOPS'];

for (const prefix of BOARDS) {
  const total = await db.issue.count({ where: { key: { startsWith: `${prefix}-` } } });
  const synced = await db.comment.findMany({
    where: { issue: { key: { startsWith: `${prefix}-` } }, body: { contains: 'jira-image-synced' } },
    select: { issueId: true },
    distinct: ['issueId'],
  });
  // Actually count comments that have been fetched from jira (any comment with content)
  const issuesWithComments = await db.comment.findMany({
    where: { issue: { key: { startsWith: `${prefix}-` } } },
    select: { issueId: true },
    distinct: ['issueId'],
  });
  console.log(`[${prefix}] Total issues: ${total}, Issues with comments in DB: ${issuesWithComments.length}`);
}

await db.$disconnect();
await pool.end();

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma = new PrismaClient({ adapter });

const loadJson = (file) => {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) { return null; }
};

async function main() {
  const dbUsers = await prisma.user.findMany({ select: { id: true, email: true, firstName: true, lastName: true } });
  const nameToId = new Map(dbUsers.map(u => [`${u.firstName} ${u.lastName}`.toLowerCase().trim(), u.id]));
  const emailToId = new Map(dbUsers.map(u => [u.email.toLowerCase(), u.id]));

  const allIssues = loadJson(path.join(root, '.jira-issues-seed.json')) || [];

  const boards = ['INFRABOARD', 'PSMBOARD', 'TESTBOARD', 'CFMBOARD', 'L2BOARD', 'L3BOARD'];
  for (const board of boards) {
    const boardIssues = allIssues.filter(i => i.spaceKey === board && i.assignee?.email);
    const fakeEmailIssues = boardIssues.filter(i => i.assignee.email.includes('@jira.com'));
    const unmatched = new Set();
    for (const issue of fakeEmailIssues) {
      const a = issue.assignee;
      const name = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase().trim();
      const email = a.email.toLowerCase();
      if (!emailToId.has(email) && !nameToId.has(name)) {
        unmatched.add(`${a.firstName} ${a.lastName}`);
      }
    }
    console.log(`\n${board}: ${boardIssues.length} with assignee, ${fakeEmailIssues.length} fake emails, ${unmatched.size} unmatched names`);
    [...unmatched].slice(0, 8).forEach(n => console.log('  -', n));
  }
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());

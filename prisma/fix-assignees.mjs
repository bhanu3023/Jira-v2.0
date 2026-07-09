/**
 * fix-assignees.mjs
 * Updates assigneeId/reporterId for ALL issues where the seed stored
 * fake "@jira.com" emails instead of real emails.
 * Matches by full name (firstName + lastName) against DB users.
 * Run: node prisma/fix-assignees.mjs
 */
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
  } catch (e) { console.error('Failed to load', file, e.message); return null; }
};

async function main() {
  console.log('🔧 Fixing assignee/reporter for all issues...\n');

  // Build user lookup: by email and by "firstname lastname"
  const dbUsers = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const emailToId = new Map(dbUsers.map(u => [u.email.toLowerCase(), u.id]));
  const nameToId  = new Map(
    dbUsers.map(u => [`${u.firstName} ${u.lastName}`.toLowerCase().trim(), u.id])
  );
  console.log(`Loaded ${dbUsers.length} users\n`);

  function resolveUser(userObj) {
    if (!userObj) return null;
    const email = String(userObj.email || '').toLowerCase();
    if (email && emailToId.has(email)) return emailToId.get(email);
    const name = `${userObj.firstName || ''} ${userObj.lastName || ''}`.toLowerCase().trim();
    if (name && nameToId.has(name)) return nameToId.get(name);
    return null;
  }

  // Load all seed issues
  const allIssues = loadJson(path.join(root, '.jira-issues-seed.json')) || [];
  console.log(`Loaded ${allIssues.length} seed issues\n`);

  // Build a map: issueKey -> { assigneeId, reporterId }
  // Only include issues where at least one changed due to name-based resolution
  const updates = new Map();
  for (const issue of allIssues) {
    const assigneeId = resolveUser(issue.assignee);
    const reporterId = resolveUser(issue.reporter);
    // Only track issues with fake jira emails that now have resolved IDs
    const assigneeEmail = String(issue.assignee?.email || '').toLowerCase();
    const reporterEmail = String(issue.reporter?.email || '').toLowerCase();
    const assigneeIsFake = assigneeEmail.includes('@jira.com');
    const reporterIsFake = reporterEmail.includes('@jira.com');
    if ((assigneeIsFake && assigneeId) || (reporterIsFake && reporterId)) {
      updates.set(issue.key, { assigneeId, reporterId, assigneeIsFake, reporterIsFake });
    }
  }
  console.log(`Issues needing update: ${updates.size}\n`);

  // Apply updates in batches using key-based lookup
  let updated = 0;
  const keys = [...updates.keys()];
  const BATCH = 500;

  for (let i = 0; i < keys.length; i += BATCH) {
    const batchKeys = keys.slice(i, i + BATCH);
    // Fetch DB issues for these keys
    const dbIssues = await prisma.issue.findMany({
      where: { key: { in: batchKeys } },
      select: { id: true, key: true, assigneeId: true, reporterId: true },
    });

    for (const dbIssue of dbIssues) {
      const upd = updates.get(dbIssue.key);
      if (!upd) continue;
      const data = {};
      if (upd.assigneeIsFake && upd.assigneeId && dbIssue.assigneeId !== upd.assigneeId) {
        data.assigneeId = upd.assigneeId;
      }
      if (upd.reporterIsFake && upd.reporterId && dbIssue.reporterId !== upd.reporterId) {
        data.reporterId = upd.reporterId;
      }
      if (Object.keys(data).length > 0) {
        await prisma.issue.update({ where: { id: dbIssue.id }, data });
        updated++;
      }
    }
    process.stdout.write(`  Processed ${Math.min(i + BATCH, keys.length)}/${keys.length}\r`);
  }

  console.log(`\n✅ Updated ${updated} issues\n`);

  // Final summary
  const spaces = await prisma.space.findMany({ select: { id: true, key: true } });
  console.log('Space       | Total  | Assignee | Reporter');
  console.log('------------|--------|----------|----------');
  for (const sp of spaces) {
    const total = await prisma.issue.count({ where: { spaceId: sp.id } });
    const withA = await prisma.issue.count({ where: { spaceId: sp.id, assigneeId: { not: null } } });
    const withR = await prisma.issue.count({ where: { spaceId: sp.id, reporterId: { not: null } } });
    console.log(`${sp.key.padEnd(11)} | ${String(total).padStart(6)} | ${String(withA).padStart(8)} | ${String(withR).padStart(8)}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

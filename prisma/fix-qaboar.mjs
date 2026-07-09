/**
 * fix-qaboar.mjs
 * Fixes QABOAR issues that have no `id` in the seed file.
 * Generates IDs from their keys and upserts them into the DB.
 * Matches assignee/reporter by email first, then by full name.
 * Run: node prisma/fix-qaboar.mjs
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
  console.log('🔧 Fixing QABOAR issues...\n');

  // Load seed data
  const allIssues = loadJson(path.join(root, '.jira-issues-seed.json')) || [];
  const qabIssues = allIssues.filter(i => i.spaceKey === 'QABOAR');
  console.log(`Found ${qabIssues.length} QABOAR issues in seed\n`);

  // Build user lookup by email and by name
  const dbUsers = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const emailToDbId = new Map(dbUsers.map(u => [u.email.toLowerCase(), u.id]));
  // name key: "firstname lastname" lowercased
  const nameToDbId = new Map(
    dbUsers.map(u => [`${u.firstName} ${u.lastName}`.toLowerCase().trim(), u.id])
  );
  console.log(`Loaded ${dbUsers.length} users (email + name lookup)\n`);

  function resolveUser(userObj) {
    if (!userObj) return null;
    // Try email first
    const email = String(userObj.email || '').toLowerCase();
    if (email && emailToDbId.has(email)) return emailToDbId.get(email);
    // Try full name
    const name = `${userObj.firstName || ''} ${userObj.lastName || ''}`.toLowerCase().trim();
    if (name && nameToDbId.has(name)) return nameToDbId.get(name);
    return null;
  }

  // Get QABOAR space
  const space = await prisma.space.findUnique({ where: { key: 'QABOAR' } });
  if (!space) { console.error('QABOAR space not found in DB!'); return; }
  console.log(`QABOAR space id: ${space.id}\n`);

  // Get statuses for QABOAR
  const statuses = await prisma.status.findMany({ where: { spaceId: space.id } });
  const statusMap = new Map(statuses.map(s => [s.name.toLowerCase(), s.id]));
  console.log(`QABOAR statuses: ${[...statusMap.keys()].join(', ')}\n`);

  // Delete existing QABOAR issues (including the broken one)
  await prisma.issue.deleteMany({ where: { spaceId: space.id } });
  console.log('Cleared existing QABOAR issues from DB\n');

  // Insert in batches
  const BATCH = 200;
  let imported = 0;

  for (let i = 0; i < qabIssues.length; i += BATCH) {
    const batch = qabIssues.slice(i, i + BATCH);
    const toCreate = [];

    for (const issue of batch) {
      // Generate ID from key: QABOAR-1 -> issue_qaboar_1
      const generatedId = `issue_${issue.key.toLowerCase().replace(/-/g, '_')}`;

      const statusName = String(issue.status?.name || '').toLowerCase();
      const statusId = statusMap.get(statusName) || null;

      const assigneeId = resolveUser(issue.assignee);
      const reporterId = resolveUser(issue.reporter);

      toCreate.push({
        id:             generatedId,
        key:            String(issue.key || ''),
        summary:        String(issue.summary || ''),
        description:    issue.description ? String(issue.description) : null,
        type:           String(issue.type || 'task'),
        workType:       issue.workType     ? String(issue.workType)     : null,
        priority:       String(issue.priority || 'medium'),
        spaceId:        space.id,
        statusId,
        assigneeId,
        reporterId,
        parentKey:      issue.parentKey    ? String(issue.parentKey)    : null,
        labels:         Array.isArray(issue.labels) ? issue.labels.map(String) : [],
        productType:    issue.productType      ? String(issue.productType)      : null,
        combination:    issue.combination      ? String(issue.combination)      : null,
        rootCause:      issue.rootCause        ? String(issue.rootCause)        : null,
        fixDescription: issue.fixDescription   ? String(issue.fixDescription)   : null,
        createdAt:      issue.createdAt ? new Date(issue.createdAt) : new Date(),
        updatedAt:      issue.updatedAt ? new Date(issue.updatedAt) : new Date(),
      });
    }

    if (toCreate.length) {
      await prisma.issue.createMany({ data: toCreate, skipDuplicates: true });
      imported += toCreate.length;
    }
    process.stdout.write(`  ${Math.min(i + BATCH, qabIssues.length)}/${qabIssues.length} processed\r`);
  }

  console.log(`\n✅ Imported ${imported} QABOAR issues\n`);

  // Verify
  const count    = await prisma.issue.count({ where: { spaceId: space.id } });
  const withA    = await prisma.issue.count({ where: { spaceId: space.id, assigneeId: { not: null } } });
  const withR    = await prisma.issue.count({ where: { spaceId: space.id, reporterId: { not: null } } });
  console.log(`Verification:`);
  console.log(`  Total QABOAR issues : ${count}`);
  console.log(`  With assignee       : ${withA}`);
  console.log(`  With reporter       : ${withR}`);

  // Show which assignee names didn't match (for debugging)
  const unmatched = new Set();
  qabIssues.forEach(i => {
    if (i.assignee && !resolveUser(i.assignee)) {
      unmatched.add(`${i.assignee.firstName} ${i.assignee.lastName} <${i.assignee.email}>`);
    }
  });
  if (unmatched.size) {
    console.log(`\n⚠️  ${unmatched.size} unique assignees not matched to DB users:`);
    [...unmatched].slice(0, 10).forEach(n => console.log('  -', n));
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

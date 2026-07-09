/**
 * seed-to-pg.mjs
 * Imports all JSON seed data into PostgreSQL.
 * Run: node prisma/seed-to-pg.mjs
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
  } catch { return null; }
};

const SPACES_FILE  = path.join(root, '.jira-spaces-seed.json');
const ISSUES_FILE  = path.join(root, '.jira-issues-seed.json');
const USERS_FILE   = path.join(root, '.jira-users-seed.json');
const DELETED_FILE = path.join(root, '.jira-deleted-spaces.json');

async function main() {
  console.log('🚀 Starting seed-to-PostgreSQL migration...\n');

  // ── Clear existing data ───────────────────────────────────────────────────
  console.log('Clearing existing data...');
  await prisma.comment.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.label.deleteMany();
  await prisma.filter.deleteMany();
  await prisma.status.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();
  await prisma.deletedSpace.deleteMany();
  console.log('  ✓ Cleared\n');

  // ── Users ─────────────────────────────────────────────────────────────────
  const rawUsers = loadJson(USERS_FILE) || [];
  console.log(`Importing ${rawUsers.length} users...`);
  const userIdMap = new Map(); // oldId -> newId (we keep same ids)

  const usersToCreate = rawUsers
    .filter(u => u.email)
    .map(u => ({
      id:          String(u.id || ''),
      email:       String(u.email || '').toLowerCase(),
      firstName:   String(u.firstName || ''),
      lastName:    String(u.lastName  || ''),
      displayName: String(u.displayName || `${u.firstName} ${u.lastName}`.trim()),
      password:    String(u.password || 'changeme123'),
      role:        String(u.role || 'agent'),
      isActive:    u.isActive !== false,
    }));

  // Deduplicate by email
  const seenEmails = new Set();
  const uniqueUsers = usersToCreate.filter(u => {
    if (!u.email || seenEmails.has(u.email)) return false;
    seenEmails.add(u.email);
    return true;
  });

  // Insert in batches of 500
  for (let i = 0; i < uniqueUsers.length; i += 500) {
    await prisma.user.createMany({ data: uniqueUsers.slice(i, i + 500), skipDuplicates: true });
    process.stdout.write(`  ${Math.min(i + 500, uniqueUsers.length)}/${uniqueUsers.length}\r`);
  }
  console.log(`  ✓ ${uniqueUsers.length} users imported\n`);

  // Build userId lookup: oldId -> dbId
  const dbUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const emailToDbId = new Map(dbUsers.map(u => [u.email, u.id]));
  for (const u of rawUsers) {
    const dbId = emailToDbId.get((u.email || '').toLowerCase());
    if (dbId) userIdMap.set(String(u.id), dbId);
  }

  // ── Spaces + Statuses ─────────────────────────────────────────────────────
  const rawSpaces = loadJson(SPACES_FILE) || [];
  console.log(`Importing ${rawSpaces.length} spaces with statuses...`);

  const spaceKeyToDbId = new Map();
  const statusNameToDbId = new Map(); // `${spaceKey}:${statusName}` -> dbId

  for (const sp of rawSpaces) {
    const spaceKey = String(sp.key || '').toUpperCase();
    const space = await prisma.space.create({
      data: {
        id:          String(sp.id || ''),
        key:         spaceKey,
        name:        String(sp.name || spaceKey),
        description: sp.description ? String(sp.description) : null,
        type:        String(sp.type || 'scrum'),
        icon:        sp.icon ? String(sp.icon) : null,
        memberCount: Number(sp.memberCount || 0),
        issueCount:  Number(sp.issueCount  || 0),
        createdAt:   sp.createdAt ? new Date(sp.createdAt) : new Date(),
        updatedAt:   sp.updatedAt ? new Date(sp.updatedAt) : new Date(),
      },
    });
    spaceKeyToDbId.set(spaceKey, space.id);

    // Create statuses
    const statuses = Array.isArray(sp.statuses) ? sp.statuses : [];
    for (const st of statuses) {
      const status = await prisma.status.create({
        data: {
          name:     String(st.name || 'Open'),
          category: String(st.category || 'todo'),
          color:    String(st.color || '#6B7280'),
          order:    Number(st.order || 0),
          spaceId:  space.id,
        },
      });
      statusNameToDbId.set(`${spaceKey}:${String(st.name || '').toLowerCase()}`, status.id);
    }

    // Create members
    const members = Array.isArray(sp.members) ? sp.members : [];
    for (const m of members) {
      const email = String(m.email || '').toLowerCase();
      const userId = emailToDbId.get(email) || userIdMap.get(String(m.id || ''));
      if (!userId) continue;
      await prisma.spaceMember.upsert({
        where: { spaceId_userId: { spaceId: space.id, userId } },
        create: { spaceId: space.id, userId, role: String(m.role || 'agent') },
        update: {},
      });
    }
  }
  console.log(`  ✓ ${rawSpaces.length} spaces imported\n`);

  // ── Deleted spaces ────────────────────────────────────────────────────────
  const deletedKeys = loadJson(DELETED_FILE) || [];
  if (deletedKeys.length) {
    await prisma.deletedSpace.createMany({
      data: deletedKeys.map((k) => ({ key: String(k).toUpperCase() })),
      skipDuplicates: true,
    });
    console.log(`  ✓ ${deletedKeys.length} deleted spaces recorded\n`);
  }

  // ── Issues ────────────────────────────────────────────────────────────────
  const rawIssues = loadJson(ISSUES_FILE) || [];
  console.log(`Importing ${rawIssues.length} issues...`);

  const BATCH = 200;
  let imported = 0;
  let skipped  = 0;

  for (let i = 0; i < rawIssues.length; i += BATCH) {
    const batch = rawIssues.slice(i, i + BATCH);
    const issuesToCreate = [];
    const commentsToCreate = [];

    for (const issue of batch) {
      const spaceKey = String(issue.spaceKey || '').toUpperCase();
      const spaceId  = spaceKeyToDbId.get(spaceKey);
      if (!spaceId) { skipped++; continue; }

      const statusName = String(issue.status?.name || '').toLowerCase();
      const statusId   = statusNameToDbId.get(`${spaceKey}:${statusName}`) || null;

      const assigneeEmail = String(issue.assignee?.email || '').toLowerCase();
      const reporterEmail = String(issue.reporter?.email || '').toLowerCase();
      const assigneeId = emailToDbId.get(assigneeEmail) || null;
      const reporterId = emailToDbId.get(reporterEmail) || null;

      issuesToCreate.push({
        id:              String(issue.id || ''),
        key:             String(issue.key || ''),
        summary:         String(issue.summary || ''),
        description:     issue.description ? String(issue.description) : null,
        type:            String(issue.type || 'task'),
        workType:        issue.workType     ? String(issue.workType)     : null,
        priority:        String(issue.priority || 'medium'),
        spaceId,
        statusId,
        assigneeId,
        reporterId,
        parentKey:       issue.parentKey    ? String(issue.parentKey)    : null,
        labels:          Array.isArray(issue.labels) ? issue.labels.map(String) : [],
        productType:     issue.productType      ? String(issue.productType)      : null,
        combination:     issue.combination      ? String(issue.combination)      : null,
        rootCause:       issue.rootCause        ? String(issue.rootCause)        : null,
        fixDescription:  issue.fixDescription   ? String(issue.fixDescription)   : null,
        manageClientName:issue.manageClientName ? String(issue.manageClientName) : null,
        customerPlan:    issue.customerPlan     ? String(issue.customerPlan)     : null,
        testEnvironment: issue.testEnvironment  ? String(issue.testEnvironment)  : null,
        createdAt:       issue.createdAt ? new Date(issue.createdAt) : new Date(),
        updatedAt:       issue.updatedAt ? new Date(issue.updatedAt) : new Date(),
      });

      // Collect comments
      for (const c of (issue.comments || [])) {
        const authorEmail = String(c.authorEmail || '').toLowerCase();
        commentsToCreate.push({
          id:          String(c.id || ''),
          body:        String(c.body || ''),
          issueId:     String(issue.id || ''),
          authorId:    emailToDbId.get(authorEmail) || null,
          authorName:  c.authorName  ? String(c.authorName)  : null,
          authorEmail: authorEmail || null,
          createdAt:   c.createdAt ? new Date(c.createdAt) : new Date(),
          updatedAt:   c.updatedAt ? new Date(c.updatedAt) : new Date(),
        });
      }
    }

    if (issuesToCreate.length) {
      await prisma.issue.createMany({ data: issuesToCreate, skipDuplicates: true });
    }
    if (commentsToCreate.length) {
      await prisma.comment.createMany({ data: commentsToCreate, skipDuplicates: true });
    }

    imported += issuesToCreate.length;
    process.stdout.write(`  ${imported}/${rawIssues.length} issues...\r`);
  }

  console.log(`  ✓ ${imported} issues imported, ${skipped} skipped\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const [uCount, sCount, iCount, cCount] = await Promise.all([
    prisma.user.count(),
    prisma.space.count(),
    prisma.issue.count(),
    prisma.comment.count(),
  ]);

  console.log('✅ Migration complete!\n');
  console.log(`   Users:    ${uCount}`);
  console.log(`   Spaces:   ${sCount}`);
  console.log(`   Issues:   ${iCount}`);
  console.log(`   Comments: ${cCount}\n`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

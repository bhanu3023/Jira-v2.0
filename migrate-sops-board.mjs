/**
 * migrate-sops-board.mjs
 * Migrates Sales Operation (SOPS) from Jira into PostgreSQL.
 * Run: node migrate-sops-board.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rid = () => crypto.randomUUID();

const DB_URL   = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter  = new PrismaPg({ connectionString: DB_URL });
const prisma   = new PrismaClient({ adapter });

const JIRA_DATA = path.join(__dirname, '..', 'jira_sops_data.json');
const loadJson  = (f) => { try { let r = fs.readFileSync(f, 'utf8'); if (r.charCodeAt(0) === 0xFEFF) r = r.slice(1); return JSON.parse(r); } catch { return null; } };

console.log('Loading jira_sops_data.json …');
const jiraData = loadJson(JIRA_DATA);
if (!jiraData) { console.error('jira_sops_data.json not found! Run fetch-sops.mjs first.'); process.exit(1); }

const { issues: jiraIssues, members: jiraMembers } = jiraData;
console.log(`  Issues : ${jiraIssues.length}`);
console.log(`  Members: ${jiraMembers.length}`);

// ── SOPS statuses (from what Jira returned) ───────────────────────────────────
const SOPS_STATUSES = [
  { name: 'Open',        category: 'todo',        color: '#64748B', order: 0 },
  { name: 'In Progress', category: 'in_progress', color: '#3B82F6', order: 1 },
  { name: 'Resolved',    category: 'done',        color: '#10B981', order: 2 },
  { name: 'Closed',      category: 'done',        color: '#059669', order: 3 },
  { name: 'Done',        category: 'done',        color: '#16A34A', order: 4 },
];

const mapStatus = (name) => {
  const n = (name || '').toLowerCase().trim();
  if (n.includes('progress'))  return 'In Progress';
  if (n.includes('resolve'))   return 'Resolved';
  if (n.includes('close'))     return 'Closed';
  if (n.includes('done'))      return 'Done';
  return 'Open';
};

const mapType = (t) => {
  const n = (t || '').toLowerCase().replace(/[\s-]+/g, '');
  if (n === 'bug')              return 'bug';
  if (n === 'story')            return 'story';
  if (n === 'epic')             return 'epic';
  if (n.includes('sub'))        return 'subtask';
  if (n.includes('email'))      return 'task';
  return 'task';
};

const mapPriority = (p) => {
  const n = (p || '').toLowerCase();
  if (n === 'highest') return 'highest';
  if (n === 'high')    return 'high';
  if (n === 'low')     return 'low';
  if (n === 'lowest')  return 'lowest';
  return 'medium';
};

function extractText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(extractText).join(' ');
  return '';
}

function extractFieldValue(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'number') return String(field);
  if (Array.isArray(field)) return field.map(v => extractFieldValue(v)).filter(Boolean).join(', ');
  if (field.value) return field.value;
  if (field.name)  return field.name;
  if (field.content) return extractText(field);
  return '';
}

async function main() {
  // ── 1. Upsert Space ──────────────────────────────────────────────────────────
  console.log('\n1. Creating SOPSBOARD space …');
  let space = await prisma.space.findUnique({ where: { key: 'SOPSBOARD' } });
  if (space) {
    console.log('   Space already exists — updating …');
    await prisma.status.deleteMany({ where: { spaceId: space.id } });
    space = await prisma.space.update({
      where: { key: 'SOPSBOARD' },
      data: { name: 'Sales Operation', type: 'service_desk', icon: null, description: 'Sales Operation board', issueCount: jiraIssues.length },
    });
  } else {
    space = await prisma.space.create({
      data: {
        id: rid(),
        key: 'SOPSBOARD',
        name: 'Sales Operation',
        type: 'service_desk',
        icon: null,
        description: 'Sales Operation board',
        issueCount: jiraIssues.length,
        memberCount: jiraMembers.length,
      },
    });
  }
  console.log(`   ✓ Space id: ${space.id}`);

  // ── 2. Create statuses ───────────────────────────────────────────────────────
  console.log('2. Creating statuses …');
  const statusMap = new Map(); // statusName -> dbId
  for (const st of SOPS_STATUSES) {
    const created = await prisma.status.create({
      data: { name: st.name, category: st.category, color: st.color, order: st.order, spaceId: space.id },
    });
    statusMap.set(st.name, created.id);
  }
  console.log(`   ✓ ${statusMap.size} statuses created`);

  // ── 3. Upsert users (members + assignees + reporters) ────────────────────────
  console.log('3. Upserting users …');
  const userEmailMap = new Map(); // email -> dbId

  // Pre-load all existing users
  const existingUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of existingUsers) userEmailMap.set(u.email.toLowerCase(), u.id);

  // Collect all unique people from issues
  const peopleMap = new Map(); // accountId -> { email, firstName, lastName, displayName }
  const addPerson = (ju) => {
    if (!ju) return;
    const aid = ju.accountId || ju.key || '';
    if (!aid || peopleMap.has(aid)) return;
    const email = (ju.emailAddress || ju.email || '').toLowerCase();
    const displayName = ju.displayName || '';
    const nameParts = displayName.trim().split(/\s+/);
    const firstName = nameParts[0] || displayName || 'Unknown';
    const lastName  = nameParts.slice(1).join(' ');
    peopleMap.set(aid, { email, firstName, lastName, displayName });
  };

  for (const m of jiraMembers) addPerson(m);
  for (const ji of jiraIssues) {
    const f = ji.fields || {};
    addPerson(f.assignee);
    addPerson(f.reporter);
    for (const c of (f.comment?.comments || [])) addPerson(c.author);
  }

  let usersCreated = 0;
  const accountIdToDbId = new Map(); // jira accountId -> db userId

  for (const [aid, p] of peopleMap) {
    const email = p.email;
    if (email && userEmailMap.has(email)) {
      accountIdToDbId.set(aid, userEmailMap.get(email));
      continue;
    }
    // Create new user
    const newId = rid();
    const emailToUse = email || `sops_${aid.slice(0, 8)}@cloudfuze.com`;
    try {
      await prisma.user.upsert({
        where: { email: emailToUse },
        create: { id: newId, email: emailToUse, firstName: p.firstName, lastName: p.lastName, displayName: p.displayName, password: 'changeme123', role: 'agent', isActive: true },
        update: {},
      });
      const dbId = (await prisma.user.findUnique({ where: { email: emailToUse }, select: { id: true } }))?.id || newId;
      userEmailMap.set(emailToUse, dbId);
      accountIdToDbId.set(aid, dbId);
      usersCreated++;
    } catch { /* skip duplicates */ }
  }
  console.log(`   ✓ ${usersCreated} new users created, ${peopleMap.size - usersCreated} already existed`);

  // ── 4. Add space members ─────────────────────────────────────────────────────
  console.log('4. Adding space members …');
  for (const m of jiraMembers) {
    const aid = m.accountId || m.key || '';
    const userId = accountIdToDbId.get(aid);
    if (!userId) continue;
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: space.id, userId } },
      create: { spaceId: space.id, userId, role: 'agent' },
      update: {},
    });
  }
  const memberCount = await prisma.spaceMember.count({ where: { spaceId: space.id } });
  await prisma.space.update({ where: { id: space.id }, data: { memberCount } });
  console.log(`   ✓ ${memberCount} members linked`);

  // ── 5. Delete old SOPSBOARD issues if re-running ─────────────────────────────
  const oldCount = await prisma.issue.count({ where: { spaceId: space.id } });
  if (oldCount > 0) {
    console.log(`5. Removing ${oldCount} existing SOPSBOARD issues for clean re-import …`);
    await prisma.comment.deleteMany({ where: { issue: { spaceId: space.id } } });
    await prisma.issue.deleteMany({ where: { spaceId: space.id } });
  }

  // ── 6. Import issues + comments ──────────────────────────────────────────────
  console.log(`${oldCount > 0 ? '6' : '5'}. Importing ${jiraIssues.length} issues …`);

  const resolvePerson = (ju) => {
    if (!ju) return null;
    const aid = ju.accountId || ju.key || '';
    const email = (ju.emailAddress || ju.email || '').toLowerCase();
    return accountIdToDbId.get(aid) || (email ? userEmailMap.get(email) : null) || null;
  };

  let imported = 0;
  const BATCH = 50;

  for (let i = 0; i < jiraIssues.length; i += BATCH) {
    const batch = jiraIssues.slice(i, i + BATCH);
    for (const ji of batch) {
      const f = ji.fields || {};
      const statusName = mapStatus(f.status?.name);
      const statusId   = statusMap.get(statusName) || statusMap.get('Open');
      const assigneeId = resolvePerson(f.assignee);
      const reporterId = resolvePerson(f.reporter);

      try {
        const issue = await prisma.issue.create({
          data: {
            id:          rid(),
            key:         ji.key,
            summary:     f.summary || '(No summary)',
            description: extractText(f.description) || null,
            type:        mapType(f.issuetype?.name),
            workType:    f.issuetype?.name || null,
            priority:    mapPriority(f.priority?.name),
            spaceId:     space.id,
            statusId:    statusId || null,
            assigneeId:  assigneeId || null,
            reporterId:  reporterId || null,
            parentKey:   f.parent?.key || null,
            labels:      Array.isArray(f.labels) ? f.labels : [],
            productType:      extractFieldValue(f.customfield_10203) || null,
            combination:      extractFieldValue(f.customfield_10236) || null,
            rootCause:        extractText(f.customfield_10059) || null,
            fixDescription:   extractText(f.customfield_10402) || null,
            manageClientName: extractFieldValue(f.customfield_11242) || null,
            customerPlan:     extractFieldValue(f.customfield_11344) || null,
            testEnvironment:  extractFieldValue(f.customfield_10037) || null,
            createdAt:   f.created ? new Date(f.created) : new Date(),
            updatedAt:   f.updated ? new Date(f.updated) : new Date(),
          },
        });

        // Import comments
        const comments = (f.comment?.comments || []);
        for (const c of comments) {
          const authorId = resolvePerson(c.author);
          const authorObj = c.author;
          const displayName = authorObj?.displayName || '';
          await prisma.comment.create({
            data: {
              id:          rid(),
              body:        extractText(c.body) || '',
              issueId:     issue.id,
              authorId:    authorId || null,
              authorName:  displayName || null,
              authorEmail: (authorObj?.emailAddress || authorObj?.email || '').toLowerCase() || null,
              createdAt:   c.created ? new Date(c.created) : new Date(),
              updatedAt:   c.updated ? new Date(c.updated || c.created) : new Date(),
            },
          });
        }

        imported++;
        process.stdout.write(`   ${imported}/${jiraIssues.length}\r`);
      } catch (err) {
        console.error(`\n   ⚠️  Skipped ${ji.key}: ${err.message}`);
      }
    }
  }

  // Update issue count
  const finalCount = await prisma.issue.count({ where: { spaceId: space.id } });
  await prisma.space.update({ where: { id: space.id }, data: { issueCount: finalCount } });

  // ── Summary ──────────────────────────────────────────────────────────────────
  const commentCount = await prisma.comment.count({ where: { issue: { spaceId: space.id } } });
  console.log(`\n\n✅ SOPS Migration complete!`);
  console.log(`   Space   : SOPSBOARD — Sales Operation`);
  console.log(`   Issues  : ${finalCount}`);
  console.log(`   Comments: ${commentCount}`);
  console.log(`   Members : ${memberCount}`);
  console.log(`   Statuses: ${statusMap.size}`);
  console.log('\n   Status breakdown:');
  for (const [name] of statusMap) {
    const c = await prisma.issue.count({ where: { spaceId: space.id, status: { name } } });
    if (c > 0) console.log(`     ${name}: ${c}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

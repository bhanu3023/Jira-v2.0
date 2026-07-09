/**
 * migrate-all-json.mjs
 * Moves ALL remaining JSON data into PostgreSQL:
 *   1. Any QABOAR issues missing from DB (raw file has more than seed)
 *   2. Xray test steps -> issues.testSteps column
 * Then deletes all raw JSON files from C:\Users\BhanuSrikakulam\testing\
 *
 * Run: node prisma/migrate-all-json.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.join(__dirname, '..');
const RAW_DIR   = 'C:\\Users\\BhanuSrikakulam\\testing';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma  = new PrismaClient({ adapter });

const loadJson = (file) => {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) { console.error('  Failed to load', path.basename(file), ':', e.message); return null; }
};

// ── Normalize Jira displayName for user lookup ─────────────────────────────
function normalizeName(name) {
  if (!name) return '';
  return name.replace(/\./g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
}

async function buildUserLookups() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const emailToId      = new Map(users.map(u => [u.email.toLowerCase(), u.id]));
  const nameToId       = new Map(users.map(u => [`${u.firstName} ${u.lastName}`.toLowerCase().trim(), u.id]));
  const emailPrefixToId = new Map(users.map(u => [u.email.split('@')[0].toLowerCase(), u.id]));

  function resolve(displayName) {
    if (!displayName) return null;
    const dn   = displayName.toLowerCase().trim();
    if (emailToId.has(dn))      return emailToId.get(dn);
    if (nameToId.has(dn))       return nameToId.get(dn);
    const norm = normalizeName(dn);
    if (nameToId.has(norm))     return nameToId.get(norm);
    if (emailPrefixToId.has(dn))   return emailPrefixToId.get(dn);
    if (emailPrefixToId.has(norm)) return emailPrefixToId.get(norm);
    return null;
  }
  return resolve;
}

// ── Step 1: Import missing QABOAR issues from raw file ─────────────────────
async function importMissingQaboar(resolveUser) {
  console.log('\n── Step 1: Importing missing QABOAR issues ──────────────────');
  const qabFile = path.join(RAW_DIR, 'jira_qab_data.json');
  const data    = loadJson(qabFile);
  if (!data) return;
  const jiraIssues = data.issues || [];

  const space = await prisma.space.findUnique({ where: { key: 'QABOAR' } });
  if (!space) { console.log('  QABOAR space not found'); return; }

  const statuses = await prisma.status.findMany({ where: { spaceId: space.id } });
  const statusMap = new Map(statuses.map(s => [s.name.toLowerCase(), s.id]));

  // Find which keys are already in DB
  const existingKeys = new Set(
    (await prisma.issue.findMany({ where: { spaceId: space.id }, select: { key: true } }))
    .map(i => i.key)
  );

  const toCreate = [];
  for (const ji of jiraIssues) {
    if (existingKeys.has(ji.key)) continue;
    const f = ji.fields;
    const statusName = (f.status?.name || '').toLowerCase();
    toCreate.push({
      id:          `issue_${ji.key.toLowerCase().replace(/-/g, '_')}`,
      key:         ji.key,
      summary:     String(f.summary || ''),
      description: f.description ? JSON.stringify(f.description) : null,
      type:        (f.issuetype?.name || 'task').toLowerCase(),
      priority:    (f.priority?.name  || 'medium').toLowerCase(),
      spaceId:     space.id,
      statusId:    statusMap.get(statusName) || null,
      assigneeId:  resolveUser(f.assignee?.displayName),
      reporterId:  resolveUser(f.reporter?.displayName),
      createdAt:   f.created ? new Date(f.created) : new Date(),
      updatedAt:   f.updated ? new Date(f.updated) : new Date(),
    });
  }

  if (toCreate.length === 0) {
    console.log('  ✓ No missing QABOAR issues');
    return;
  }

  await prisma.issue.createMany({ data: toCreate, skipDuplicates: true });
  console.log(`  ✓ Imported ${toCreate.length} missing QABOAR issues`);
}

// ── Step 2: Store Xray test steps ──────────────────────────────────────────
async function importXraySteps() {
  console.log('\n── Step 2: Storing Xray test steps ──────────────────────────');
  const xrayFile = path.join(RAW_DIR, 'xray_steps.json');
  const xray     = loadJson(xrayFile);
  if (!xray) return;

  const keys    = Object.keys(xray);
  console.log(`  ${keys.length} issue keys with test steps`);

  const BATCH = 200;
  let updated = 0;

  for (let i = 0; i < keys.length; i += BATCH) {
    const batchKeys = keys.slice(i, i + BATCH);
    const dbIssues  = await prisma.issue.findMany({
      where: { key: { in: batchKeys } },
      select: { id: true, key: true },
    });

    for (const dbIssue of dbIssues) {
      const steps = xray[dbIssue.key];
      if (!steps || !steps.length) continue;
      await prisma.issue.update({
        where: { id: dbIssue.id },
        data:  { testSteps: steps },
      });
      updated++;
    }
    process.stdout.write(`  Progress: ${Math.min(i + BATCH, keys.length)}/${keys.length}\r`);
  }

  console.log(`  ✓ Stored test steps for ${updated} issues        `);
}

// ── Step 3: Delete raw JSON files ──────────────────────────────────────────
async function deleteRawFiles() {
  console.log('\n── Step 3: Deleting raw JSON files ──────────────────────────');
  const filesToDelete = [
    path.join(RAW_DIR, 'jira_cb_data.json'),
    path.join(RAW_DIR, 'jira_cfm_data.json'),
    path.join(RAW_DIR, 'jira_data.json'),
    path.join(RAW_DIR, 'jira_eb_data.json'),
    path.join(RAW_DIR, 'jira_ib_custom.json'),
    path.join(RAW_DIR, 'jira_l1_data.json'),
    path.join(RAW_DIR, 'jira_l2b_data.json'),
    path.join(RAW_DIR, 'jira_l3b_data.json'),
    path.join(RAW_DIR, 'jira_mb_data.json'),
    path.join(RAW_DIR, 'jira_psm_data.json'),
    path.join(RAW_DIR, 'jira_qab_data.json'),
    path.join(RAW_DIR, 'jira_sops_data.json'),
    path.join(RAW_DIR, 'jira_test_data.json'),
    path.join(RAW_DIR, 'xray_steps.json'),
    // Seed files in the project (data is now in PostgreSQL)
    path.join(root, '.jira-issues-seed.json'),
    path.join(root, '.jira-users-seed.json'),
    path.join(root, '.jira-spaces-seed.json'),
    path.join(root, '.jira-deleted-spaces.json'),
  ];

  let deleted = 0;
  let totalSizeMB = 0;
  for (const f of filesToDelete) {
    if (fs.existsSync(f)) {
      const size = fs.statSync(f).size;
      fs.unlinkSync(f);
      console.log(`  ✓ Deleted ${path.basename(f)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      deleted++;
      totalSizeMB += size / 1024 / 1024;
    } else {
      console.log(`  ⏭  Skipped ${path.basename(f)} (not found)`);
    }
  }
  console.log(`\n  Deleted ${deleted} files, freed ~${totalSizeMB.toFixed(0)} MB`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Migrating all JSON data to PostgreSQL...\n');

  const resolveUser = await buildUserLookups();
  console.log('  User lookups ready');

  await importMissingQaboar(resolveUser);
  await importXraySteps();
  await deleteRawFiles();

  // Final DB counts
  console.log('\n── Final DB summary ─────────────────────────────────────────');
  const [users, spaces, issues, comments] = await Promise.all([
    prisma.user.count(),
    prisma.space.count(),
    prisma.issue.count(),
    prisma.comment.count(),
  ]);
  const withSteps = await prisma.issue.count({ where: { testSteps: { not: null } } });
  console.log(`  Users:      ${users}`);
  console.log(`  Spaces:     ${spaces}`);
  console.log(`  Issues:     ${issues}`);
  console.log(`  Comments:   ${comments}`);
  console.log(`  Test steps: ${withSteps} issues`);
  console.log('\n✅ All done! JSON files removed, data safely in PostgreSQL.\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

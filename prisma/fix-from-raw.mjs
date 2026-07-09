/**
 * fix-from-raw.mjs
 * Reads raw Jira JSON data files and updates assigneeId/reporterId in DB
 * by matching Jira displayName to DB user names.
 *
 * Run: node prisma/fix-from-raw.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const RAW_DIR = 'C:\\Users\\BhanuSrikakulam\\testing';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma = new PrismaClient({ adapter });

// Map of raw JSON filename -> space key prefix
const DATA_FILES = [
  { file: 'jira_cfm_data.json',  prefix: 'CFM' },
  { file: 'jira_ib_custom.json', prefix: 'IB' },
  { file: 'jira_l2b_data.json',  prefix: 'L2' },
  { file: 'jira_l3b_data.json',  prefix: 'L3' },
  { file: 'jira_psm_data.json',  prefix: 'PSM' },
  { file: 'jira_test_data.json', prefix: 'TEST' },
  { file: 'jira_eb_data.json',   prefix: 'EB' },
  { file: 'jira_cb_data.json',   prefix: 'CB' },
  { file: 'jira_mb_data.json',   prefix: 'MB' },
  { file: 'jira_sops_data.json', prefix: 'SOPS' },
  { file: 'jira_l1_data.json',   prefix: 'L1' },
];

const loadJson = (file) => {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) { console.error('Failed to load', file, ':', e.message); return null; }
};

// Normalize a display name for matching
function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/\./g, ' ')   // "Bharath.Tummaganti" -> "Bharath Tummaganti"
    .replace(/_/g, ' ')    // underscores to spaces
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

async function main() {
  console.log('🔧 Fixing assignee/reporter from raw Jira data files...\n');

  // Build user lookup maps
  const dbUsers = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  // Map 1: "firstname lastname" -> id
  const nameToId = new Map(
    dbUsers.map(u => [`${u.firstName} ${u.lastName}`.toLowerCase().trim(), u.id])
  );
  // Map 2: email prefix -> id (e.g. "ravic" from "ravic@cloudfuze.com")
  const emailPrefixToId = new Map(
    dbUsers.map(u => {
      const prefix = u.email.split('@')[0].toLowerCase();
      return [prefix, u.id];
    })
  );
  // Map 3: email -> id
  const emailToId = new Map(dbUsers.map(u => [u.email.toLowerCase(), u.id]));
  // Map 4: displayName normalized -> id (build from all combinations)
  const displayToId = new Map();
  for (const u of dbUsers) {
    const full = `${u.firstName} ${u.lastName}`.toLowerCase().trim();
    displayToId.set(full, u.id);
    displayToId.set(normalizeName(full), u.id);
    // Also add email prefix
    const prefix = u.email.split('@')[0].toLowerCase();
    displayToId.set(prefix, u.id);
    displayToId.set(normalizeName(prefix), u.id);
  }

  console.log(`Loaded ${dbUsers.length} users with name/email lookups\n`);

  function resolveDisplayName(displayName) {
    if (!displayName) return null;
    const dn = displayName.toLowerCase().trim();
    if (displayToId.has(dn)) return displayToId.get(dn);
    const norm = normalizeName(dn);
    if (displayToId.has(norm)) return displayToId.get(norm);
    // Try email-like: "Bharath.Tummaganti" -> check email prefix
    if (emailPrefixToId.has(dn)) return emailPrefixToId.get(dn);
    if (emailPrefixToId.has(norm.replace(/\s/g, '.'))) return emailPrefixToId.get(norm.replace(/\s/g, '.'));
    return null;
  }

  let totalUpdated = 0;

  for (const { file, prefix } of DATA_FILES) {
    const filePath = path.join(RAW_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`⏭  Skipping ${file} (not found)`);
      continue;
    }

    process.stdout.write(`Loading ${file}...`);
    const data = loadJson(filePath);
    if (!data) { console.log(' failed\n'); continue; }
    const jiraIssues = data.issues || (Array.isArray(data) ? data : []);
    console.log(` ${jiraIssues.length} issues`);

    // Build key -> {assigneeId, reporterId} map
    const keyToUsers = new Map();
    for (const ji of jiraIssues) {
      const key = ji.key;
      const assigneeId = resolveDisplayName(ji.fields?.assignee?.displayName);
      const reporterId = resolveDisplayName(ji.fields?.reporter?.displayName);
      if (assigneeId || reporterId) {
        keyToUsers.set(key, { assigneeId, reporterId });
      }
    }

    console.log(`  Resolved ${keyToUsers.size} issues with assignee/reporter`);

    // Update DB in batches
    const keys = [...keyToUsers.keys()];
    const BATCH = 500;
    let batchUpdated = 0;

    for (let i = 0; i < keys.length; i += BATCH) {
      const batchKeys = keys.slice(i, i + BATCH);
      const dbIssues = await prisma.issue.findMany({
        where: { key: { in: batchKeys } },
        select: { id: true, key: true, assigneeId: true, reporterId: true },
      });

      for (const dbIssue of dbIssues) {
        const upd = keyToUsers.get(dbIssue.key);
        if (!upd) continue;
        const data = {};
        if (upd.assigneeId && dbIssue.assigneeId !== upd.assigneeId) data.assigneeId = upd.assigneeId;
        if (upd.reporterId && dbIssue.reporterId !== upd.reporterId) data.reporterId = upd.reporterId;
        if (Object.keys(data).length > 0) {
          await prisma.issue.update({ where: { id: dbIssue.id }, data });
          batchUpdated++;
        }
      }
      process.stdout.write(`  Progress: ${Math.min(i + BATCH, keys.length)}/${keys.length}\r`);
    }

    console.log(`  ✅ Updated ${batchUpdated} issues in ${file}          `);
    totalUpdated += batchUpdated;
  }

  console.log(`\n🎉 Total updated: ${totalUpdated} issues\n`);

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

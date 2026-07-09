/**
 * fix-seed-qaboar-ids.mjs
 * Patches .jira-issues-seed.json to add proper IDs for QABOAR issues
 * that were missing them. Run once to permanently fix the seed file.
 * Run: node prisma/fix-seed-qaboar-ids.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const ISSUES_FILE = path.join(root, '.jira-issues-seed.json');

console.log('Patching .jira-issues-seed.json for QABOAR IDs...');
const issues = JSON.parse(fs.readFileSync(ISSUES_FILE, 'utf8'));

let patched = 0;
for (const issue of issues) {
  if (issue.spaceKey === 'QABOAR' && issue.key && !issue.id) {
    issue.id = `issue_${issue.key.toLowerCase().replace(/-/g, '_')}`;
    patched++;
  }
}

console.log(`Patched ${patched} QABOAR issues with generated IDs`);
fs.writeFileSync(ISSUES_FILE, JSON.stringify(issues), 'utf8');
console.log('✅ Saved .jira-issues-seed.json');

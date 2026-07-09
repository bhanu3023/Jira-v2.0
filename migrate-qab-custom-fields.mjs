/**
 * migrate-qab-custom-fields.mjs
 * Patches QABOAR issues in seed with Product Type + Combination from Jira QAB
 * Run: node migrate-qab-custom-fields.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISSUES_SEED = path.join(__dirname, '.jira-issues-seed.json');
const JIRA_DATA   = path.join(__dirname, '..', 'jira_qab_data.json');

const loadJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const saveJson = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

console.log('Loading jira_qab_data.json …');
const jiraData = loadJson(JIRA_DATA);
if (!jiraData) { console.error('jira_qab_data.json not found!'); process.exit(1); }

// Build map: numeric part → custom fields
const cfMap = new Map();
for (const ji of jiraData.issues) {
  const f = ji.fields || {};
  const productType  = f.customfield_10203?.value || null;
  const combination  = Array.isArray(f.customfield_10236) ? f.customfield_10236.map(o => o.value).filter(Boolean) : [];
  const num = ji.key.replace(/^[^-]+-/, '');  // "QAB-42" → "42"
  cfMap.set(ji.key, { productType, combination });
  cfMap.set(num,    { productType, combination });
}
console.log(`  Built map for ${jiraData.issues.length} issues`);

console.log('Patching QABOAR issues in seed …');
const allIssues = loadJson(ISSUES_SEED);
if (!allIssues) { console.error('Seed not found!'); process.exit(1); }

let patched = 0;
for (const issue of allIssues) {
  if ((issue.spaceKey || '').toUpperCase() !== 'QABOAR') continue;
  const num = issue.key.replace(/^[^-]+-/, '');
  const cf = cfMap.get(issue.key) || cfMap.get(num);
  if (!cf) continue;
  issue.productType = cf.productType;
  issue.combination = cf.combination;
  patched++;
}
saveJson(ISSUES_SEED, allIssues);

const qab = allIssues.filter(i => (i.spaceKey||'').toUpperCase() === 'QABOAR');
console.log(`  ✓ Patched: ${patched} / ${qab.length} issues`);
console.log(`  Product Type filled: ${qab.filter(i => i.productType).length}`);
console.log(`  Combination filled:  ${qab.filter(i => i.combination?.length).length}`);
console.log('\n✅ Done! Restart the dev server.\n');

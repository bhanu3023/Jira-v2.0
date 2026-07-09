/**
 * patch-xray-steps.mjs — Patches Xray test steps into TESTBOARD issues in seed
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISSUES_SEED = path.join(__dirname, '.jira-issues-seed.json');
const STEPS_FILE  = path.join(__dirname, '..', 'xray_steps.json');

console.log('Loading files...');
const issues   = JSON.parse(fs.readFileSync(ISSUES_SEED, 'utf-8'));
const stepsMap = JSON.parse(fs.readFileSync(STEPS_FILE, 'utf-8'));

console.log(`Issues in seed: ${issues.length}`);
console.log(`Issues with steps: ${Object.keys(stepsMap).length}`);

let patched = 0;
for (const issue of issues) {
  if (issue.spaceKey !== 'TESTBOARD') continue;
  const steps = stepsMap[issue.key];
  if (steps && steps.length > 0) {
    issue.testSteps = steps.map((s, i) => ({
      index:          i + 1,
      action:         s.action   || '',
      data:           s.data     || '',
      expectedResult: s.result   || '',
      comments:       '',
    }));
    patched++;
  }
}

console.log(`Patched ${patched} TESTBOARD issues with test steps`);
fs.writeFileSync(ISSUES_SEED, JSON.stringify(issues, null, 2), 'utf-8');
console.log('✅ Seed file updated!');

/**
 * patch-test-steps.mjs
 * Patches TESTBOARD issues in seed with real Xray test steps
 * Run: node patch-test-steps.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISSUES_SEED = path.join(__dirname, '.jira-issues-seed.json');
const STEPS_FILE  = path.join(__dirname, '..', 'xray_steps.json');

console.log('Loading files...');
const issues   = JSON.parse(fs.readFileSync(ISSUES_SEED, 'utf-8'));
const stepsMap = JSON.parse(fs.readFileSync(STEPS_FILE,  'utf-8'));

console.log(`Issues in seed: ${issues.length}`);
console.log(`Issues with steps: ${Object.keys(stepsMap).length}`);

let patched = 0;
for (const issue of issues) {
  if (issue.spaceKey !== 'TESTBOARD') continue;
  const steps = stepsMap[issue.key];
  if (steps && steps.length > 0) {
    issue.testSteps = steps.map((s, i) => ({
      index:          i + 1,
      action:         s.action  || '',
      data:           s.data    || '',
      expectedResult: s.result  || '',
      comments:       '',
    }));
    patched++;
  }
}

fs.writeFileSync(ISSUES_SEED, JSON.stringify(issues, null, 2), 'utf-8');
console.log(`\n✅ Patched ${patched} TESTBOARD issues with real test steps`);
console.log('Restart the dev server to see the steps in tickets.');

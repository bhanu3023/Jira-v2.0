/**
 * migrate-l1-custom-fields.mjs
 * Patches existing L1BOAR issues in the seed files with custom field values
 * fetched from Jira CFITS: Product Type, Combination, Project Manager,
 * Customer Name, Client Name
 *
 * Run: node migrate-l1-custom-fields.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ISSUES_SEED = path.join(__dirname, '.jira-issues-seed.json');
const JIRA_DATA   = path.join(__dirname, '..', 'jira_l1_data.json');

const loadJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const saveJson = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

// ── ADF text extractor ────────────────────────────────────────────────────────
function extractText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(extractText).join('');
  return '';
}

// ── Load data ─────────────────────────────────────────────────────────────────
console.log('Loading jira_l1_data.json …');
const jiraData = loadJson(JIRA_DATA);
if (!jiraData) { console.error('jira_l1_data.json not found! Run fetch-l1-custom.mjs first.'); process.exit(1); }

const { issues: jiraIssues } = jiraData;
console.log(`  Jira issues: ${jiraIssues.length}`);

// Build a map: numeric issue number → custom field values
// Seed uses "L1BOAR-N", Jira uses "CFITS-N" — match by the number
const cfMap = new Map();
for (const ji of jiraIssues) {
  const f = ji.fields || {};

  // Product Type — single select
  const productType = f.customfield_10203?.value || null;

  // Combination — multiselect
  const combination = Array.isArray(f.customfield_10236)
    ? f.customfield_10236.map(o => o.value).filter(Boolean)
    : [];

  // Project Manager — multiselect
  const projectManager = Array.isArray(f.customfield_11380)
    ? f.customfield_11380.map(o => o.value).filter(Boolean)
    : [];

  // Customer Name — labels (array of plain strings)
  const customerName = Array.isArray(f.customfield_10401)
    ? f.customfield_10401.filter(Boolean)
    : [];

  // Client Name — multiselect
  const clientName = Array.isArray(f.customfield_10883)
    ? f.customfield_10883.map(o => o.value).filter(Boolean)
    : [];

  // Store by both original key (CFITS-N) and numeric part (N) for flexible matching
  const num = ji.key.replace(/^[^-]+-/, ''); // "CFITS-123" → "123"
  cfMap.set(ji.key, { productType, combination, projectManager, customerName, clientName });
  cfMap.set(num,    { productType, combination, projectManager, customerName, clientName });
}

console.log(`  Custom field map built for ${cfMap.size} Jira issues`);

// ── Patch seed issues ─────────────────────────────────────────────────────────
console.log('Patching L1BOAR issues in seed …');
const allIssues = loadJson(ISSUES_SEED);
if (!allIssues) { console.error('.jira-issues-seed.json not found!'); process.exit(1); }

let patched = 0;
let notFound = 0;

for (const issue of allIssues) {
  if ((issue.spaceKey || '').toUpperCase() !== 'L1BOAR') continue;

  // Match by numeric part: seed "L1BOAR-123" → "123", Jira "CFITS-123" → "123"
  const num = issue.key.replace(/^[^-]+-/, '');
  const cf = cfMap.get(issue.key) || cfMap.get(num);
  if (!cf) { notFound++; continue; }

  issue.productType    = cf.productType;
  issue.combination    = cf.combination;
  issue.projectManager = cf.projectManager;
  issue.customerName   = cf.customerName;
  issue.clientName     = cf.clientName;
  patched++;
}

saveJson(ISSUES_SEED, allIssues);

console.log(`  ✓ Patched  : ${patched} issues`);
console.log(`  ✗ Not found: ${notFound} issues (key mismatch — may use different key format)`);

// ── Stats ─────────────────────────────────────────────────────────────────────
const l1Issues = allIssues.filter(i => (i.spaceKey || '').toUpperCase() === 'L1BOAR');
console.log(`\n  L1BOAR total in seed : ${l1Issues.length}`);
console.log(`  Product Type filled  : ${l1Issues.filter(i => i.productType).length}`);
console.log(`  Combination filled   : ${l1Issues.filter(i => i.combination?.length).length}`);
console.log(`  Project Manager filled: ${l1Issues.filter(i => i.projectManager?.length).length}`);
console.log(`  Customer Name filled : ${l1Issues.filter(i => i.customerName?.length).length}`);
console.log(`  Client Name filled   : ${l1Issues.filter(i => i.clientName?.length).length}`);

console.log('\n✅ L1 custom fields patched! Restart the dev server to see the changes.\n');

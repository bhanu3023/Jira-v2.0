/**
 * Patch script: Updates status (and reporter+assignee) on all L1BOAR issues
 * using POSITIONAL matching â€” 1st CFITS issue â†’ L1BOAR-1, 2nd â†’ L1BOAR-2, etc.
 * This is reliable even when summaries have duplicates.
 *
 * Run: node patch-status.mjs
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const JIRA_HOST  = 'cf2020.atlassian.net';
const JIRA_EMAIL = 'Sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN = 'REDACTED_API_TOKEN';

const JIRA_PROJECT = 'CFITS';
const SEED_FILE    = path.join(process.cwd(), '.jira-issues-seed.json');
const PAGE_SIZE    = 100;

const jiraAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

// â”€â”€â”€ Status mapping: Jira status name â†’ app status object â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STATUS_MAP = {
  'Opened':                { id: 'st_opened',           name: 'Opened',               category: 'in_progress', color: '#64748B' },
  'In Progress':           { id: 'st_in_progress',      name: 'In Progress',          category: 'in_progress', color: '#3B82F6' },
  'Waiting for Customer':  { id: 'st_waiting_customer', name: 'Waiting for Customer', category: 'in_progress', color: '#F59E0B' },
  'Waiting for L2':        { id: 'st_waiting_l2',       name: 'Waiting for L2',       category: 'in_progress', color: '#F97316' },
  'Pending with L2':       { id: 'st_pending_l2',       name: 'Pending with L2',      category: 'in_progress', color: '#8B5CF6' },
  'Pending with QA':       { id: 'st_pending_qa',       name: 'Pending with QA',      category: 'in_progress', color: '#06B6D4' },
  'Pending with Infra':    { id: 'st_pending_infra',    name: 'Pending with Infra',   category: 'in_progress', color: '#6366F1' },
  'Reopen':                { id: 'st_reopen',           name: 'Reopen',               category: 'in_progress', color: '#EF4444' },
  'Resolved':              { id: 'st_resolved',         name: 'Resolved',             category: 'done',        color: '#10B981' },
  'Closed':                { id: 'st_closed',           name: 'Closed',               category: 'done',        color: '#059669' },
};

const DEFAULT_STATUS = { id: 'st_opened', name: 'Opened', category: 'in_progress', color: '#64748B' };

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function jiraRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: JIRA_HOST,
      path: '/rest/api/3/search/jql',
      method: 'POST',
      headers: {
        Authorization: `Basic ${jiraAuth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse error')); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parseName(displayName) {
  if (!displayName) return { firstName: 'Unknown', lastName: '' };
  const parts = displayName.trim().split(' ');
  return { firstName: parts[0] || 'Unknown', lastName: parts.slice(1).join(' ') || '' };
}

function makeUser(jiraUser) {
  if (!jiraUser) return null;
  const { firstName, lastName } = parseName(jiraUser.displayName);
  const email = jiraUser.emailAddress || `${jiraUser.accountId}@jira.com`;
  const id = `ext_${email.replace(/[^a-z0-9]/gi, '_')}`;
  return { id, firstName, lastName, email };
}

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  Patch: Status + Reporter + Assignee (Positional)');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

  // 1. Load seed file and sort L1BOAR issues by their numeric key (ascending)
  console.log('â‘  Loading seed file...');
  if (!fs.existsSync(SEED_FILE)) {
    console.error('  âœ— Seed file not found:', SEED_FILE);
    process.exit(1);
  }
  const seedIssues = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  console.log(`  âœ“ Loaded ${seedIssues.length} issues from seed file`);

  // Build sorted array of L1BOAR issue indices by key number (ascending)
  // Position 0 = L1BOAR-1 = CFITS-1st issue, position 1 = L1BOAR-2 = CFITS-2nd, etc.
  const l1boarEntries = seedIssues
    .map((issue, idx) => ({ issue, idx }))
    .filter(e => e.issue.key && String(e.issue.key).startsWith('L1BOAR'))
    .sort((a, b) => {
      const na = parseInt(String(a.issue.key).split('-').pop() || '0', 10);
      const nb = parseInt(String(b.issue.key).split('-').pop() || '0', 10);
      return na - nb;
    });

  console.log(`  âœ“ Found ${l1boarEntries.length} L1BOAR issues (sorted ascending)`);

  // 2. Fetch ALL CFITS issues in the same order (created ASC) used during migration
  console.log(`\nâ‘¡ Fetching all CFITS issues from Jira (created ASC)...`);
  let nextPageToken = null;
  let page = 1;
  const jiraIssues = [];

  do {
    const body = {
      jql: `project=${JIRA_PROJECT} ORDER BY created ASC`,
      maxResults: PAGE_SIZE,
      fields: ['summary', 'status', 'reporter', 'assignee'],
      ...(nextPageToken && { nextPageToken }),
    };

    const data = await jiraRequest(body);
    if (data.errorMessages || data.error) {
      console.error('  âœ— Jira error:', data.errorMessages || data.error);
      process.exit(1);
    }

    jiraIssues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken || null;
    if (page % 10 === 0) console.log(`  Page ${page}: fetched ${jiraIssues.length} total`);
    page++;
  } while (nextPageToken);

  console.log(`  âœ“ Fetched ${jiraIssues.length} Jira issues`);

  // 3. Positional match: jiraIssues[i] â†’ l1boarEntries[i]
  console.log('\nâ‘¢ Applying positional patch...');
  const limit = Math.min(jiraIssues.length, l1boarEntries.length);
  const statusCounts = {};

  for (let i = 0; i < limit; i++) {
    const ji = jiraIssues[i];
    const { issue, idx } = l1boarEntries[i];

    // Status
    const jiraStatusName = ji.fields.status?.name || '';
    const appStatus = STATUS_MAP[jiraStatusName] || DEFAULT_STATUS;
    seedIssues[idx].status = appStatus;
    statusCounts[appStatus.name] = (statusCounts[appStatus.name] || 0) + 1;

    // Reporter
    const reporter = makeUser(ji.fields.reporter);
    if (reporter) seedIssues[idx].reporter = reporter;

    // Assignee
    seedIssues[idx].assignee = makeUser(ji.fields.assignee);
  }

  console.log(`  âœ“ Patched ${limit} issues`);
  console.log('\n  Status breakdown:');
  Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`    ${name.padEnd(28)} ${count}`);
  });

  // 4. Save updated seed file
  console.log('\nâ‘£ Saving updated seed file...');
  fs.writeFileSync(SEED_FILE, JSON.stringify(seedIssues, null, 2), 'utf-8');
  const size = (fs.statSync(SEED_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`  âœ“ Saved (${size} MB)`);

  console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  PATCH COMPLETE â€” restart server to apply.');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });


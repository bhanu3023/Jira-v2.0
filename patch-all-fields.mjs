/**
 * Patch script: Updates ALL fields on L1BOAR issues from Jira
 * Fields: status, reporter, assignee, priority, type (issuetype), createdAt
 * Uses POSITIONAL matching: nth CFITS issue â†’ nth L1BOAR issue (by key asc)
 *
 * Run: node patch-all-fields.mjs
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

// â”€â”€â”€ Mappings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STATUS_MAP = {
  'Opened':               { id: 'st_opened',           name: 'Opened',               category: 'in_progress', color: '#64748B' },
  'In Progress':          { id: 'st_in_progress',      name: 'In Progress',          category: 'in_progress', color: '#3B82F6' },
  'Waiting for Customer': { id: 'st_waiting_customer', name: 'Waiting for Customer', category: 'in_progress', color: '#F59E0B' },
  'Waiting for L2':       { id: 'st_waiting_l2',       name: 'Waiting for L2',       category: 'in_progress', color: '#F97316' },
  'Pending with L2':      { id: 'st_pending_l2',       name: 'Pending with L2',      category: 'in_progress', color: '#8B5CF6' },
  'Pending with QA':      { id: 'st_pending_qa',       name: 'Pending with QA',      category: 'in_progress', color: '#06B6D4' },
  'Pending with Infra':   { id: 'st_pending_infra',    name: 'Pending with Infra',   category: 'in_progress', color: '#6366F1' },
  'Reopen':               { id: 'st_reopen',           name: 'Reopen',               category: 'in_progress', color: '#EF4444' },
  'Resolved':             { id: 'st_resolved',         name: 'Resolved',             category: 'done',        color: '#10B981' },
  'Closed':               { id: 'st_closed',           name: 'Closed',               category: 'done',        color: '#059669' },
};
const DEFAULT_STATUS = STATUS_MAP['Opened'];

// Jira priority name â†’ app priority value (lowercase)
const PRIORITY_MAP = {
  'Highest': 'highest',
  'High':    'high',
  'Medium':  'medium',
  'Low':     'low',
  'Lowest':  'lowest',
};

// Jira issuetype name â†’ app type
const TYPE_MAP = {
  '[System] Service request':                  'service_request',
  '[System] Service request with approvals':   'service_request',
  '[System] Incident':                         'incident',
  'Task':                                      'task',
  'Sub-task':                                  'subtask',
};

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
  console.log('  Patch ALL Fields: status Â· reporter Â· assignee');
  console.log('               priority Â· type Â· createdAt');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

  // 1. Load seed and sort L1BOAR issues by key number (asc = same order as migration)
  console.log('â‘  Loading seed file...');
  if (!fs.existsSync(SEED_FILE)) { console.error('  âœ— Seed file not found:', SEED_FILE); process.exit(1); }
  const seedIssues = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  console.log(`  âœ“ Loaded ${seedIssues.length} issues`);

  const l1boarEntries = seedIssues
    .map((issue, idx) => ({ issue, idx }))
    .filter(e => String(e.issue.key || '').startsWith('L1BOAR'))
    .sort((a, b) => {
      const na = parseInt(String(a.issue.key).split('-').pop() || '0', 10);
      const nb = parseInt(String(b.issue.key).split('-').pop() || '0', 10);
      return na - nb;
    });

  console.log(`  âœ“ ${l1boarEntries.length} L1BOAR issues sorted ascending`);

  // 2. Fetch ALL CFITS issues in created-ASC order (same as migration)
  console.log(`\nâ‘¡ Fetching all CFITS issues from Jira...`);
  let nextPageToken = null;
  let page = 1;
  const jiraIssues = [];

  do {
    const body = {
      jql: `project=${JIRA_PROJECT} ORDER BY created ASC`,
      maxResults: PAGE_SIZE,
      fields: ['summary', 'status', 'reporter', 'assignee', 'priority', 'issuetype', 'created'],
      ...(nextPageToken && { nextPageToken }),
    };
    const data = await jiraRequest(body);
    if (data.errorMessages || data.error) { console.error('  âœ— Jira error:', data.errorMessages || data.error); process.exit(1); }
    jiraIssues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken || null;
    if (page % 10 === 0) console.log(`  Page ${page}: fetched ${jiraIssues.length} total`);
    page++;
  } while (nextPageToken);

  console.log(`  âœ“ Fetched ${jiraIssues.length} Jira issues`);

  // 3. Positional patch
  console.log('\nâ‘¢ Applying positional patch...');
  const limit = Math.min(jiraIssues.length, l1boarEntries.length);
  const statusCounts = {}, priorityCounts = {}, typeCounts = {};

  for (let i = 0; i < limit; i++) {
    const ji = jiraIssues[i];
    const { idx } = l1boarEntries[i];
    const f = ji.fields;

    // Status
    const appStatus = STATUS_MAP[f.status?.name || ''] || DEFAULT_STATUS;
    seedIssues[idx].status = appStatus;
    statusCounts[appStatus.name] = (statusCounts[appStatus.name] || 0) + 1;

    // Priority
    const appPriority = PRIORITY_MAP[f.priority?.name || ''] || 'medium';
    seedIssues[idx].priority = appPriority;
    priorityCounts[appPriority] = (priorityCounts[appPriority] || 0) + 1;

    // Type (worktype)
    const appType = TYPE_MAP[f.issuetype?.name || ''] || 'task';
    seedIssues[idx].type = appType;
    typeCounts[appType] = (typeCounts[appType] || 0) + 1;

    // Created date (use real Jira creation time)
    if (f.created) seedIssues[idx].createdAt = f.created;

    // Reporter
    const reporter = makeUser(f.reporter);
    if (reporter) seedIssues[idx].reporter = reporter;

    // Assignee
    seedIssues[idx].assignee = makeUser(f.assignee);
  }

  console.log(`  âœ“ Patched ${limit} issues\n`);

  console.log('  Status breakdown:');
  Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).forEach(([n,c])=>console.log(`    ${n.padEnd(28)} ${c}`));
  console.log('\n  Priority breakdown:');
  Object.entries(priorityCounts).sort((a,b)=>b[1]-a[1]).forEach(([n,c])=>console.log(`    ${n.padEnd(28)} ${c}`));
  console.log('\n  Type breakdown:');
  Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).forEach(([n,c])=>console.log(`    ${n.padEnd(28)} ${c}`));

  // 4. Save
  console.log('\nâ‘£ Saving updated seed file...');
  fs.writeFileSync(SEED_FILE, JSON.stringify(seedIssues, null, 2), 'utf-8');
  const size = (fs.statSync(SEED_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`  âœ“ Saved (${size} MB)`);

  console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  PATCH COMPLETE â€” restart server to apply.');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });


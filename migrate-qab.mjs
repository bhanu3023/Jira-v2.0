/**
 * Migration script: QAB (Quality-Analyst-Board) â†’ QABOAR space
 * Migrates all tickets with status, reporter, assignee, priority, type, createdAt
 * Run: node migrate-qab.mjs
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const JIRA_HOST    = 'cf2020.atlassian.net';
const JIRA_EMAIL   = 'Sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN   = 'REDACTED_API_TOKEN';

const JIRA_PROJECT   = 'QAB';
const APP_SPACE_KEY  = 'QABOAR';
const APP_SPACE_NAME = 'Quality-Analyst-Board';
const ISSUES_SEED    = path.join(process.cwd(), '.jira-issues-seed.json');
const SPACES_SEED    = path.join(process.cwd(), '.jira-spaces-seed.json');
const PAGE_SIZE      = 100;

const jiraAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

// â”€â”€â”€ Status mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STATUS_MAP = {
  'Opened':             { id: 'st_qab_opened',       name: 'Opened',             category: 'in_progress', color: '#64748B' },
  'In Progress':        { id: 'st_qab_in_progress',  name: 'In Progress',        category: 'in_progress', color: '#3B82F6' },
  'Pending-with-Dev':   { id: 'st_qab_pending_dev',  name: 'Pending-with-Dev',   category: 'in_progress', color: '#8B5CF6' },
  'Waiting for L2':     { id: 'st_qab_waiting_l2',   name: 'Waiting for L2',     category: 'in_progress', color: '#F97316' },
  'Waiting for L3':     { id: 'st_qab_waiting_l3',   name: 'Waiting for L3',     category: 'in_progress', color: '#F59E0B' },
  'Pending with L2':    { id: 'st_qab_pending_l2',   name: 'Pending with L2',    category: 'in_progress', color: '#06B6D4' },
  'Resolved':           { id: 'st_qab_resolved',     name: 'Resolved',           category: 'done',        color: '#10B981' },
};
const DEFAULT_STATUS = STATUS_MAP['Opened'];

// â”€â”€â”€ Priority mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PRIORITY_MAP = {
  'Highest': 'highest', 'High': 'high', 'Medium': 'medium', 'Low': 'low', 'Lowest': 'lowest',
};

// â”€â”€â”€ Type mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TYPE_MAP = {
  'Task':     'task',
  'Sub-task': 'subtask',
  'Bug':      'bug',
  'Story':    'story',
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function jiraRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: JIRA_HOST, path: '/rest/api/3/search/jql', method: 'POST',
      headers: { Authorization: `Basic ${jiraAuth}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('JSON parse error')); } }); });
    req.on('error', reject); req.write(payload); req.end();
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
  return { id: `ext_${email.replace(/[^a-z0-9]/gi, '_')}`, firstName, lastName, email };
}

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function main() {
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  Migrate: QAB (Quality-Analyst-Board) â†’ QABOAR');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

  // 1. Load existing seed files
  const issuesSeed = fs.existsSync(ISSUES_SEED) ? JSON.parse(fs.readFileSync(ISSUES_SEED, 'utf-8')) : [];
  const spacesSeed = fs.existsSync(SPACES_SEED) ? JSON.parse(fs.readFileSync(SPACES_SEED, 'utf-8')) : [];
  console.log(`â‘  Loaded seed: ${issuesSeed.length} issues, ${spacesSeed.length} spaces`);

  // Remove any previous QABOAR data
  const cleanIssues = issuesSeed.filter(i => !String(i.key || '').startsWith(APP_SPACE_KEY));
  const cleanSpaces = spacesSeed.filter(s => String(s.key || '').toUpperCase() !== APP_SPACE_KEY);
  console.log(`  Removed old QABOAR data (if any)`);

  // 2. Fetch all QAB issues from Jira
  console.log(`\nâ‘¡ Fetching all ${JIRA_PROJECT} issues from Jira...`);
  let nextPageToken = null, page = 1;
  const jiraIssues = [];

  do {
    const body = {
      jql: `project=${JIRA_PROJECT} ORDER BY created ASC`,
      maxResults: PAGE_SIZE,
      fields: ['summary', 'description', 'status', 'reporter', 'assignee', 'priority', 'issuetype', 'created'],
      ...(nextPageToken && { nextPageToken }),
    };
    const data = await jiraRequest(body);
    if (data.errorMessages || data.error) { console.error('Jira error:', data.errorMessages || data.error); process.exit(1); }
    jiraIssues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken || null;
    if (page % 5 === 0) console.log(`  Page ${page}: fetched ${jiraIssues.length} total`);
    page++;
  } while (nextPageToken);

  console.log(`  âœ“ Fetched ${jiraIssues.length} issues from Jira`);

  // 3. Build QABOAR space
  const QAB_STATUSES = Object.values(STATUS_MAP).map((s, i) => ({ ...s, order: i }));
  const space = {
    id: 's_qaboar',
    name: APP_SPACE_NAME,
    key: APP_SPACE_KEY,
    description: 'Quality Analyst Board â€” migrated from Jira QAB',
    type: 'service_desk',
    issueCount: jiraIssues.length,
    memberCount: 1,
    members: [{ id: 'sm_qaboar_1', email: JIRA_EMAIL, firstName: 'Sujana', lastName: 'Manapuram', role: 'admin' }],
    statuses: QAB_STATUSES,
    createdAt: new Date().toISOString(),
  };

  // 4. Build issues
  console.log(`\nâ‘¢ Building ${jiraIssues.length} issues...`);
  const statusCounts = {}, typeCounts = {};
  const newIssues = jiraIssues.map((ji, i) => {
    const f = ji.fields;
    const appStatus   = STATUS_MAP[f.status?.name || ''] || DEFAULT_STATUS;
    const appPriority = PRIORITY_MAP[f.priority?.name || ''] || 'medium';
    const appType     = TYPE_MAP[f.issuetype?.name || ''] || 'task';

    statusCounts[appStatus.name] = (statusCounts[appStatus.name] || 0) + 1;
    typeCounts[appType] = (typeCounts[appType] || 0) + 1;

    return {
      key:       `${APP_SPACE_KEY}-${i + 1}`,
      spaceKey:  APP_SPACE_KEY,
      summary:   f.summary || '(No summary)',
      description: f.description ? JSON.stringify(f.description) : '',
      type:      appType,
      priority:  appPriority,
      status:    appStatus,
      reporter:  makeUser(f.reporter),
      assignee:  makeUser(f.assignee),
      createdAt: f.created || new Date().toISOString(),
      updatedAt: f.created || new Date().toISOString(),
      comments:  [],
      labels:    [],
      customFieldValues: {},
    };
  });

  console.log('  Status breakdown:');
  Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).forEach(([n,c])=>console.log(`    ${n.padEnd(25)} ${c}`));
  console.log('  Type breakdown:');
  Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).forEach(([n,c])=>console.log(`    ${n.padEnd(25)} ${c}`));

  // 5. Save to seed files
  console.log(`\nâ‘£ Saving to seed files...`);
  const finalIssues = [...cleanIssues, ...newIssues];
  const finalSpaces = [...cleanSpaces, space];

  fs.writeFileSync(ISSUES_SEED, JSON.stringify(finalIssues, null, 2), 'utf-8');
  fs.writeFileSync(SPACES_SEED, JSON.stringify(finalSpaces, null, 2), 'utf-8');

  const isz = (fs.statSync(ISSUES_SEED).size / 1024 / 1024).toFixed(1);
  const ssz = (fs.statSync(SPACES_SEED).size / 1024).toFixed(1);
  console.log(`  âœ“ Issues seed: ${finalIssues.length} issues (${isz} MB)`);
  console.log(`  âœ“ Spaces seed: ${finalSpaces.length} spaces (${ssz} KB)`);

  console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`  MIGRATION COMPLETE â€” ${jiraIssues.length} tickets in QABOAR`);
  console.log('  Restart server (npm run dev) to load.');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });


/**
 * Patch script: Updates reporter & assignee on all L1BOAR issues
 * from Jira data â€” no full re-migration needed.
 * Run: node patch-reporter-assignee.mjs
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const JIRA_HOST  = 'cf2020.atlassian.net';
const JIRA_EMAIL = 'Sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN = 'REDACTED_API_TOKEN';

const JIRA_PROJECT  = 'CFITS';
const SEED_FILE     = path.join(process.cwd(), '.jira-issues-seed.json');
const PAGE_SIZE     = 100;

const jiraAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

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
  console.log('  Patch: Reporter & Assignee from Jira â†’ Seed File');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

  // 1. Load current seed file
  console.log('â‘  Loading seed file...');
  if (!fs.existsSync(SEED_FILE)) {
    console.error('  âœ— Seed file not found:', SEED_FILE);
    process.exit(1);
  }
  const seedIssues = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  console.log(`  âœ“ Loaded ${seedIssues.length} issues from seed file`);

  // 2. Build map: summary (normalised) â†’ seed issue index
  const summaryToIdx = new Map();
  seedIssues.forEach((issue, idx) => {
    if (issue.summary) {
      summaryToIdx.set(issue.summary.trim().toLowerCase(), idx);
    }
  });
  console.log(`  âœ“ Built summary index for ${summaryToIdx.size} issues`);

  // 3. Fetch all CFITS issues from Jira with reporter/assignee
  console.log(`\nâ‘¡ Fetching reporter/assignee from Jira project ${JIRA_PROJECT}...`);
  let nextPageToken = null;
  let page = 1;
  let patched = 0;
  let jiraFetched = 0;

  do {
    const body = {
      jql: `project=${JIRA_PROJECT} ORDER BY created ASC`,
      maxResults: PAGE_SIZE,
      fields: ['summary', 'reporter', 'assignee'],
      ...(nextPageToken && { nextPageToken }),
    };

    const data = await jiraRequest(body);
    if (data.errorMessages || data.error) {
      console.error('  âœ— Jira error:', data.errorMessages || data.error);
      process.exit(1);
    }

    const issues = data.issues || [];
    jiraFetched += issues.length;

    for (const ji of issues) {
      const summary = (ji.fields.summary || '').trim().toLowerCase();
      const idx = summaryToIdx.get(summary);
      if (idx === undefined) continue;

      const reporter = makeUser(ji.fields.reporter);
      const assignee = makeUser(ji.fields.assignee);

      if (reporter) seedIssues[idx].reporter = reporter;
      seedIssues[idx].assignee = assignee;

      patched++;
    }

    nextPageToken = data.nextPageToken || null;
    if (page % 10 === 0) console.log(`  Page ${page}: fetched ${jiraFetched} total, patched ${patched} issues so far`);
    page++;
  } while (nextPageToken);

  console.log(`\n  âœ“ Fetched ${jiraFetched} Jira issues`);
  console.log(`  âœ“ Patched ${patched} seed issues with reporter/assignee`);

  // 4. Save updated seed file
  console.log('\nâ‘¢ Saving updated seed file...');
  fs.writeFileSync(SEED_FILE, JSON.stringify(seedIssues, null, 2), 'utf-8');
  const size = (fs.statSync(SEED_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`  âœ“ Saved (${size} MB)`);

  console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  PATCH COMPLETE');
  console.log('  Restart your server (npm run dev) to see reporter &');
  console.log('  assignee names on all tickets.');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });


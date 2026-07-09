/**
 * Jira â†’ App Migration Script
 * Migrates CFITS (L1 board) tickets from Jira into the local app
 * Run: node migrate-l1.mjs
 */

import https from 'https';
import http from 'http';

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const JIRA_HOST    = 'cf2020.atlassian.net';
const JIRA_EMAIL   = 'Sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN   = 'REDACTED_API_TOKEN';

const APP_HOST     = 'localhost';
const APP_PORT     = 8080;
const APP_EMAIL    = 'admin@jira.com';
const APP_PASSWORD = 'admin123';

const JIRA_PROJECT = 'CFITS';           // L1 board key in Jira
const APP_SPACE_KEY = 'L1BOAR';         // Space key matching the existing L1-Board
const APP_SPACE_NAME = 'L1-Board';      // Space name

const PAGE_SIZE = 50;                   // tickets per Jira API page

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const jiraAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

function jiraRequest(path, body) {
  return new Promise((resolve, reject) => {
    const isPost = !!body;
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: JIRA_HOST,
      path,
      method: isPost ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${jiraAuth}`,
        Accept: 'application/json',
        ...(isPost && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function appRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: APP_HOST,
      port: APP_PORT,
      path: `/api${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(payload && { 'Content-Length': Buffer.byteLength(payload) }),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractText(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  if (!adf.content) return '';
  return adf.content.map((block) => {
    if (block.content) return block.content.map((n) => n.text || '').join('');
    return block.text || '';
  }).join('\n').trim();
}

function mapPriority(p) {
  const s = (p || '').toLowerCase();
  if (s.includes('highest') || s.includes('critical')) return 'Critical';
  if (s.includes('high')) return 'High';
  if (s.includes('low') || s.includes('lowest')) return 'Low';
  return 'Medium';
}

function mapStatus(s) {
  const v = (s || '').toLowerCase();
  if (v.includes('done') || v.includes('closed') || v.includes('resolved') || v.includes('complete')) return 'Done';
  if (v.includes('progress') || v.includes('review') || v.includes('testing') || v.includes('pending')) return 'In Progress';
  return 'To Do';
}

function mapType(t) {
  const v = (t || '').toLowerCase();
  if (v.includes('bug')) return 'bug';
  if (v.includes('epic')) return 'epic';
  if (v.includes('story')) return 'story';
  if (v.includes('sub')) return 'subtask';
  return 'task';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  Jira â†’ App Migration  |  Project: CFITS (L1 Board)');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

  // 1. Login to app
  console.log('â‘  Logging into the app...');
  const loginRes = await appRequest('/auth/login', 'POST', { email: APP_EMAIL, password: APP_PASSWORD });
  if (!loginRes.body.token) {
    console.error('  âœ— Login failed:', loginRes.body);
    process.exit(1);
  }
  const token = loginRes.body.token;
  console.log('  âœ“ Logged in as', loginRes.body.user?.email || APP_EMAIL);

  // 2. Create space (or reuse if already exists)
  console.log(`\nâ‘¡ Creating space "${APP_SPACE_NAME}" (key: ${APP_SPACE_KEY})...`);
  const spaceRes = await appRequest('/spaces', 'POST', {
    name: APP_SPACE_NAME,
    key: APP_SPACE_KEY,
    description: 'Imported from Jira CFITS (L1 Board)',
    icon: 'ðŸŽ«',
  }, token);

  if (spaceRes.status === 201 || spaceRes.status === 200) {
    console.log(`  âœ“ Space created: ${APP_SPACE_KEY}`);
  } else if (spaceRes.body?.error?.includes('exist') || spaceRes.status === 409) {
    console.log(`  â„¹ Space ${APP_SPACE_KEY} already exists â€” will add tickets to it`);
  } else {
    console.log(`  â„¹ Space response (${spaceRes.status}):`, JSON.stringify(spaceRes.body).substring(0, 100));
  }

  // 3. Fetch all tickets from Jira (cursor-paginated)
  console.log(`\nâ‘¢ Fetching all tickets from Jira project ${JIRA_PROJECT}...`);
  const allIssues = [];
  let nextPageToken = null;
  let page = 1;

  do {
    const body = {
      jql: `project=${JIRA_PROJECT} ORDER BY created ASC`,
      maxResults: PAGE_SIZE,
      fields: [
        'summary', 'description', 'status', 'priority', 'issuetype',
        'assignee', 'reporter', 'created', 'updated', 'duedate',
        'labels', 'customfield_10016', 'comment', 'resolution',
      ],
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const data = await jiraRequest('/rest/api/3/search/jql', body);

    if (data.errorMessages || data.error) {
      console.error('  âœ— Jira error:', data.errorMessages || data.error);
      process.exit(1);
    }

    const issues = data.issues || [];
    allIssues.push(...issues);
    nextPageToken = data.nextPageToken || null;
    console.log(`  Page ${page}: fetched ${issues.length} tickets (total so far: ${allIssues.length})`);
    page++;
  } while (nextPageToken);

  console.log(`\n  âœ“ Total tickets to import: ${allIssues.length}`);

  // 4. Import tickets into app
  console.log(`\nâ‘£ Importing tickets into space ${APP_SPACE_KEY}...`);
  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < allIssues.length; i++) {
    const ji = allIssues[i];
    const f = ji.fields;

    const title = f.summary || '(No title)';
    const issueData = {
      title,
      summary: title,
      description: extractText(f.description),
      status: mapStatus(f.status?.name),
      priority: mapPriority(f.priority?.name),
      type: mapType(f.issuetype?.name),
      spaceKey: APP_SPACE_KEY,
      labels: Array.isArray(f.labels) ? f.labels : [],
      storyPoints: f.customfield_10016 || undefined,
      dueDate: f.duedate || undefined,
      originalJiraKey: ji.key,
    };

    try {
      const res = await appRequest('/issues', 'POST', issueData, token);
      if (res.status === 200 || res.status === 201) {
        imported++;
        if ((imported) % 50 === 0 || i === allIssues.length - 1) {
          const pct = Math.round(((i + 1) / allIssues.length) * 100);
          console.log(`  [${pct}%] ${imported} imported, ${skipped} skipped â€” last: ${ji.key} "${title.substring(0, 50)}"`);
        }
      } else {
        skipped++;
        errors.push(`${ji.key}: HTTP ${res.status} â€” ${JSON.stringify(res.body).substring(0, 80)}`);
      }
    } catch (err) {
      skipped++;
      errors.push(`${ji.key}: ${err.message}`);
    }

    // small delay to not overwhelm the local server
    if (i % 20 === 0 && i > 0) await sleep(50);
  }

  // 5. Persist to disk so data survives server restarts
  console.log('\nâ‘¤ Saving data to disk (so it survives server restarts)...');
  try {
    const persistRes = await appRequest('/admin/persist-seed', 'POST', {}, token);
    console.log(`  âœ“ Saved: ${persistRes.body.issues} issues, ${persistRes.body.spaces} spaces`);
  } catch (err) {
    console.warn('  âš  Could not persist seed:', err.message);
  }

  // 6. Summary
  console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  MIGRATION COMPLETE');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`  âœ“ Imported : ${imported} tickets`);
  console.log(`  âœ— Skipped  : ${skipped} tickets`);
  console.log(`  ðŸ“¦ Space   : ${APP_SPACE_KEY} in the app`);

  if (errors.length > 0) {
    console.log(`\n  Errors (${errors.length}):`);
    errors.slice(0, 20).forEach((e) => console.log('   -', e));
    if (errors.length > 20) console.log(`   ... and ${errors.length - 20} more`);
  }

  console.log('\n  Open your app and go to the L1 space to see all tickets!');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});


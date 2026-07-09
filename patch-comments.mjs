/**
 * patch-comments.mjs
 * Fetches comments from Jira for CFITS (L1BOAR) and QAB (QABOAR) projects
 * and patches them into .jira-issues-seed.json
 * Run: node patch-comments.mjs
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const JIRA_HOST  = 'cf2020.atlassian.net';
const JIRA_EMAIL = 'Sujana.manapuram@cloudfuze.com';
const JIRA_TOKEN = 'REDACTED_API_TOKEN';
const jiraAuth   = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

const ISSUES_SEED = path.join(process.cwd(), '.jira-issues-seed.json');
const PAGE_SIZE   = 100;

// Projects to fetch
const PROJECTS = [
  { jiraKey: 'CFITS', appPrefix: 'L1BOAR' },
  { jiraKey: 'QAB',   appPrefix: 'QABOAR' },
];

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function jiraSearchRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: JIRA_HOST,
      path: '/rest/api/3/search/jql',
      method: 'POST',
      headers: {
        Authorization: `Basic ${jiraAuth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('JSON parse error: ' + d.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Extract plain text from Atlassian Document Format (ADF)
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'paragraph') {
    const inner = (node.content || []).map(adfToText).join('');
    return inner + '\n';
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content || []).map(adfToText).join('');
  }
  if (node.type === 'listItem') {
    return 'â€¢ ' + (node.content || []).map(adfToText).join('').trim() + '\n';
  }
  if (node.type === 'blockquote') {
    return (node.content || []).map(adfToText).join('').split('\n').map(l => '> ' + l).join('\n') + '\n';
  }
  if (node.type === 'codeBlock') {
    return (node.content || []).map(adfToText).join('') + '\n';
  }
  if (node.content) {
    return node.content.map(adfToText).join('');
  }
  return '';
}

function parseName(displayName) {
  if (!displayName) return { firstName: 'Unknown', lastName: '' };
  const parts = displayName.trim().split(' ');
  return { firstName: parts[0] || 'Unknown', lastName: parts.slice(1).join(' ') || '' };
}

function toSlug(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '.');
}

function resolveEmail(jiraUser) {
  if (!jiraUser) return null;
  const raw = (jiraUser.emailAddress || '').toLowerCase();
  if (raw && !raw.endsWith('@jira.com') && !raw.endsWith('@atlassian.net')) return raw;
  const { firstName, lastName } = parseName(jiraUser.displayName);
  const name = (firstName + ' ' + lastName).trim();
  if (!name || name === 'Unknown') return null;
  return toSlug(name) + '@cloudfuze.com';
}

function makeAuthor(jiraUser) {
  if (!jiraUser) return { firstName: 'Unknown', lastName: '', email: 'unknown@cloudfuze.com' };
  const { firstName, lastName } = parseName(jiraUser.displayName);
  const email = resolveEmail(jiraUser) || `${jiraUser.accountId}@jira.com`;
  return { firstName, lastName, email };
}

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchAllWithComments(projectKey) {
  const issues = [];
  let nextPageToken = null;
  let page = 1;
  process.stdout.write(`  Fetching ${projectKey} with comments...`);
  do {
    const body = {
      jql: `project=${projectKey} ORDER BY created ASC`,
      maxResults: PAGE_SIZE,
      fields: ['summary', 'comment'],
      ...(nextPageToken && { nextPageToken }),
    };
    const data = await jiraSearchRequest(body);
    if (data.errorMessages || data.error) {
      console.error('\nJira error:', data.errorMessages || data.error);
      process.exit(1);
    }
    issues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken || null;
    if (page % 10 === 0) process.stdout.write(` ${issues.length}`);
    page++;
  } while (nextPageToken);
  console.log(` âœ“ ${issues.length} issues`);
  return issues;
}

async function main() {
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  Patch: Comments from Jira â†’ L1BOAR + QABOAR');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

  const seedIssues = JSON.parse(fs.readFileSync(ISSUES_SEED, 'utf-8'));
  console.log(`Loaded seed: ${seedIssues.length} issues\n`);

  let totalPatched = 0;
  let totalComments = 0;

  for (const { jiraKey, appPrefix } of PROJECTS) {
    const jiraIssues = await fetchAllWithComments(jiraKey);
    const appIssues  = seedIssues
      .filter(i => String(i.key || '').startsWith(appPrefix + '-'))
      .sort((a, b) => {
        const na = parseInt(String(a.key).split('-')[1], 10);
        const nb = parseInt(String(b.key).split('-')[1], 10);
        return na - nb;
      });

    console.log(`  ${appPrefix}: ${jiraIssues.length} Jira â†’ ${appIssues.length} app issues`);

    const limit = Math.min(jiraIssues.length, appIssues.length);
    for (let i = 0; i < limit; i++) {
      const jiraIssue = jiraIssues[i];
      const appIssue  = appIssues[i];
      const rawComments = jiraIssue.fields?.comment?.comments || [];

      if (rawComments.length === 0) continue;

      const comments = rawComments.map(c => {
        const author = makeAuthor(c.author);
        let body = '';
        if (c.body && typeof c.body === 'object') {
          body = adfToText(c.body).trim();
        } else if (typeof c.body === 'string') {
          body = c.body;
        }
        return {
          id: `cmt_${c.id}`,
          author,
          body,
          createdAt: c.created || new Date().toISOString(),
          updatedAt: c.updated || c.created || new Date().toISOString(),
          isInternal: false,
        };
      }).filter(c => c.body.length > 0);

      if (comments.length > 0) {
        appIssue.comments = comments;
        appIssue.commentCount = comments.length;
        totalPatched++;
        totalComments += comments.length;
      }
    }

    console.log(`  âœ“ Patched ${totalPatched} issues with ${totalComments} comments so far\n`);
  }

  fs.writeFileSync(ISSUES_SEED, JSON.stringify(seedIssues, null, 2), 'utf-8');
  const mb = (fs.statSync(ISSUES_SEED).size / 1024 / 1024).toFixed(1);
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`  DONE â€” ${totalComments} comments patched into ${totalPatched} issues`);
  console.log(`  Seed file: ${mb} MB`);
  console.log('  Restart server (npm run dev) to load.');
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });


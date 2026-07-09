/**
 * Direct Node.js script â€” syncs CFITS comments into L1BOAR
 * Run: node sync-l1boar-comments.mjs
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const adapter = new PrismaPg({ connectionString: DB_URL });
const db = new PrismaClient({ adapter });

const JIRA_BASE  = 'https://cf2020.atlassian.net';
const EMAIL      = 'sujana.manapuram@cloudfuze.com';
const TOKEN      = 'REDACTED_API_TOKEN';
const AUTH       = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const HEADERS    = { Authorization: `Basic ${AUTH}`, Accept: 'application/json' };

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function rid() {
  return `cmt_${Math.random().toString(36).slice(2, 12)}`;
}

function extractAdfText(nodes) {
  if (!nodes) return '';
  return nodes.map(node => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'paragraph') return extractAdfText(node.content || []) + '\n';
    if (node.content) return extractAdfText(node.content);
    return '';
  }).join('').trim();
}

function extractText(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.trim();
  if (body.type === 'doc' && Array.isArray(body.content)) return extractAdfText(body.content);
  return JSON.stringify(body);
}

async function main() {
  console.log('Loading L1BOAR issues with no comments...');
  const space = await db.space.findFirst({ where: { key: 'L1BOAR' } });
  const localIssues = await db.issue.findMany({
    where: { spaceId: space.id, comments: { none: {} } },
    select: { id: true, key: true, summary: true },
  });
  console.log(`${localIssues.length} L1BOAR issues need comments`);

  // Build title map
  const byTitle = new Map();
  for (const issue of localIssues) {
    if (!issue.summary) continue;
    const norm = normalize(issue.summary);
    byTitle.set(norm, issue);
    if (norm.length > 20) byTitle.set(norm.slice(0, 60), issue);
  }

  let inserted = 0, noMatch = 0, pagesFetched = 0;
  let startAt = 0;
  const pageSize = 100;
  const jql = encodeURIComponent('project=CFITS ORDER BY updated DESC');

  console.log('Paging through CFITS...');
  while (true) {
    const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${pageSize}&fields=summary,comment`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) { console.error('Jira error:', res.status, await res.text()); break; }
    const data = await res.json();
    const batch = data.issues || [];
    pagesFetched++;

    if (pagesFetched % 10 === 0) process.stdout.write(`  page ${pagesFetched}, startAt=${startAt}, inserted=${inserted}\n`);

    for (const ji of batch) {
      const jiraComments = ji.fields?.comment?.comments || [];
      if (!jiraComments.length) continue;

      const norm = normalize(ji.fields?.summary || '');
      let localIssue = byTitle.get(norm) ?? byTitle.get(norm.slice(0, 60));

      if (!localIssue && norm.length >= 15) {
        for (const [tNorm, issue] of byTitle) {
          const shorter = tNorm.length < norm.length ? tNorm : norm;
          const longer  = tNorm.length >= norm.length ? tNorm : norm;
          if (shorter.length >= 15 && longer.includes(shorter)) { localIssue = issue; break; }
        }
      }

      if (!localIssue) { noMatch++; continue; }

      for (const jc of jiraComments) {
        const commentText = extractText(jc.body);
        if (!commentText) continue;
        try {
          await db.comment.create({
            data: {
              id: rid(), body: commentText, issueId: localIssue.id,
              authorName: jc.author?.displayName ?? 'Jira User',
              authorEmail: jc.author?.emailAddress ?? '',
              createdAt: jc.created ? new Date(jc.created) : new Date(),
              updatedAt: jc.updated ? new Date(jc.updated) : new Date(),
            },
          });
          inserted++;
        } catch { /* skip duplicate */ }
      }
      byTitle.delete(norm);
    }

    if (batch.length < pageSize) break;
    startAt += pageSize;
  }

  console.log(`\nDone! Inserted: ${inserted} | No Jira match: ${noMatch} | Pages: ${pagesFetched}`);
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


/**
 * Sync comment images for remaining boards only (skipping QAB and TEST)
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const { Pool } = require('./node_modules/pg/lib/index.js');
const { PrismaPg } = require('./node_modules/@prisma/adapter-pg/dist/index.js');
const { PrismaClient } = require('./node_modules/@prisma/client/index.js');
const pool = new Pool({ connectionString: DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const API_TOKEN = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
const JIRA_URL  = 'https://cf2020.atlassian.net';

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads', 'attachments');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const REMAINING_BOARDS = [
  { prefix: 'L2B',    jql: 'project in (L2B) ORDER BY created DESC' },
  { prefix: 'L1BOAR', jql: 'project in (CFITS) ORDER BY created DESC' },
  { prefix: 'IB',     jql: 'project in ("IN", SYS) ORDER BY created DESC' },
  { prefix: 'PSM',    jql: 'project in (PSM, PSR) ORDER BY created DESC' },
  { prefix: 'CFM',    jql: 'project in (CFM, "CF", CFC, CLOUDFUZE) ORDER BY created DESC' },
  { prefix: 'L3B',    jql: 'project in (L3B, L3) ORDER BY created DESC' },
  { prefix: 'MB',     jql: 'project in (MB, CST, STT, MSTT, STMTS) ORDER BY created DESC' },
  { prefix: 'EB',     jql: 'project in (EB, EM, OMM, OGM, GM, GD) ORDER BY created DESC' },
  { prefix: 'CB',     jql: 'project in (CB, CM, CMQ2) ORDER BY created DESC' },
  { prefix: 'SOPS',   jql: 'project in (SOPS, SO, SAL, SR) ORDER BY created DESC' },
];

function normalize(str) { return (str || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function safeFilename(name) { return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function adfToHtml(node, mediaMap) {
  if (!node) return '';
  if (typeof node === 'string') return escHtml(node);
  switch (node.type) {
    case 'doc': return (node.content||[]).map(n=>adfToHtml(n,mediaMap)).join('');
    case 'text': {
      let t = escHtml(node.text||'');
      for (const m of node.marks||[]) {
        if (m.type==='strong') t=`<strong>${t}</strong>`;
        else if (m.type==='em') t=`<em>${t}</em>`;
        else if (m.type==='underline') t=`<u>${t}</u>`;
        else if (m.type==='strike') t=`<s>${t}</s>`;
        else if (m.type==='code') t=`<code>${t}</code>`;
        else if (m.type==='link') t=`<a href="${escHtml(m.attrs?.href||'#')}" target="_blank">${t}</a>`;
      }
      return t;
    }
    case 'mention': return `<span class="mention">@${escHtml(node.attrs?.text?.replace(/^@/,'')||'')}</span>`;
    case 'hardBreak': return '<br>';
    case 'paragraph': return `<p>${(node.content||[]).map(n=>adfToHtml(n,mediaMap)).join('')}</p>`;
    case 'heading': { const l=node.attrs?.level||2; return `<h${l}>${(node.content||[]).map(n=>adfToHtml(n,mediaMap)).join('')}</h${l}>`; }
    case 'bulletList': return `<ul>${(node.content||[]).map(li=>`<li>${(li.content||[]).map(n=>adfToHtml(n,mediaMap)).join('')}</li>`).join('')}</ul>`;
    case 'orderedList': return `<ol>${(node.content||[]).map(li=>`<li>${(li.content||[]).map(n=>adfToHtml(n,mediaMap)).join('')}</li>`).join('')}</ol>`;
    case 'codeBlock': return `<pre><code>${(node.content||[]).map(n=>adfToHtml(n,mediaMap)).join('')}</code></pre>`;
    case 'blockquote': return `<blockquote>${(node.content||[]).map(n=>adfToHtml(n,mediaMap)).join('')}</blockquote>`;
    case 'mediaSingle': {
      const media = (node.content||[]).find(c=>c.type==='media');
      if (!media) return '';
      const localUrl = mediaMap?.get(media.attrs?.id);
      const alt = media.attrs?.alt||'image';
      if (localUrl) return `<img src="${escHtml(localUrl)}" alt="${escHtml(alt)}" style="max-width:100%;border-radius:6px;margin:8px 0;">`;
      return `<span style="color:#888;font-size:12px">[image: ${escHtml(alt)}]</span>`;
    }
    case 'media': return '';
    default: return (node.content||[]).map(n=>adfToHtml(n,mediaMap)).join('');
  }
}

function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type==='text') return node.text||'';
  if (node.type==='mention') return node.attrs?.text||'';
  if (node.type==='hardBreak') return '\n';
  if (node.type==='mediaSingle'||node.type==='media') return '';
  if (node.content) return node.content.map(adfToText).join('');
  return '';
}

function hasMedia(node) {
  if (!node) return false;
  if (node.type==='mediaSingle'||node.type==='media') return true;
  if (node.content) return node.content.some(c=>hasMedia(c));
  return false;
}

function collectMediaNodes(node, result=[]) {
  if (!node) return result;
  if (node.type==='mediaSingle') {
    const media=(node.content||[]).find(c=>c.type==='media');
    if (media?.attrs?.id) result.push({ id: media.attrs.id, alt: media.attrs.alt||'image' });
  }
  if (node.content) node.content.forEach(c=>collectMediaNodes(c,result));
  return result;
}

async function fetchWithRetry(url, opts, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      return res;
    } catch (e) {
      if (i === retries) throw e;
      const wait = 2000 * (i + 1);
      process.stderr.write(`  [retry ${i+1}/${retries}] fetch error, waiting ${wait}ms...\n`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function fetchIssuesWithComments(jql) {
  const all = [];
  let nextPageToken = null;
  do {
    const params = new URLSearchParams({ jql, maxResults:'100', fields:'summary,comment,attachment' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetchWithRetry(`${JIRA_URL}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization:`Basic ${AUTH}`, Accept:'application/json' }
    });
    if (!res.ok) return all;
    const data = await res.json();
    if (data.errorMessages?.length) return all;
    all.push(...(data.issues||[]).filter(i=>(i.fields?.comment?.total||0)>0));
    nextPageToken = data.isLast ? null : data.nextPageToken;
    if (nextPageToken) await new Promise(r=>setTimeout(r,120));
  } while (nextPageToken);
  return all;
}

async function fetchAllComments(jiraKey) {
  const comments = [];
  let startAt = 0;
  while (true) {
    const res = await fetchWithRetry(`${JIRA_URL}/rest/api/3/issue/${jiraKey}/comment?startAt=${startAt}&maxResults=100`,
      { headers:{ Authorization:`Basic ${AUTH}`, Accept:'application/json' } });
    if (!res.ok) break;
    const data = await res.json();
    comments.push(...(data.comments||[]));
    if (comments.length>=data.total) break;
    startAt+=100;
  }
  return comments;
}

async function downloadFile(contentUrl, destPath) {
  const res = await fetch(contentUrl, { headers:{ Authorization:`Basic ${AUTH}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function syncBoard({ prefix, jql }) {
  console.log(`\nâ”€â”€ ${prefix} â”€â”€`);
  const localIssues = await db.issue.findMany({
    where: { key:{ startsWith:`${prefix}-` } },
    select: { id:true, key:true, summary:true },
  });
  if (!localIssues.length) { console.log('  No local issues, skipping'); return { updated:0, images:0 }; }

  const summaryMap = new Map();
  for (const i of localIssues) { const n=normalize(i.summary); if (!summaryMap.has(n)) summaryMap.set(n,i); }
  console.log(`  Local issues: ${localIssues.length}`);

  process.stdout.write(`  Fetching Jira issues...`);
  const jiraIssues = await fetchIssuesWithComments(jql);
  console.log(` ${jiraIssues.length} have comments`);

  let totalUpdated=0, totalImages=0, processed=0;

  for (const ji of jiraIssues) {
    const local = summaryMap.get(normalize(ji.fields?.summary||''));
    if (!local) continue;

    const jiraComments = ji.fields?.comment?.total>5
      ? await fetchAllComments(ji.key)
      : (ji.fields?.comment?.comments||[]);

    const commentsWithMedia = jiraComments.filter(jc=>hasMedia(jc.body));
    if (!commentsWithMedia.length) { processed++; continue; }

    const attachments = ji.fields?.attachment||[];
    const filenameToAtt = new Map();
    for (const att of attachments) filenameToAtt.set(att.filename, att);

    const issueDir = path.join(UPLOADS_DIR, local.id);
    fs.mkdirSync(issueDir, { recursive:true });

    const dbComments = await db.comment.findMany({
      where:{ issueId:local.id }, select:{ id:true, body:true, createdAt:true }
    });

    for (const jc of commentsWithMedia) {
      const mediaNodes = collectMediaNodes(jc.body);
      const mediaMap = new Map();

      for (const mn of mediaNodes) {
        const att = filenameToAtt.get(mn.alt);
        if (!att) continue;
        const safeFile = safeFilename(att.filename);
        const destPath = path.join(issueDir, safeFile);
        const localUrl = `/uploads/attachments/${local.id}/${safeFile}`;
        if (!fs.existsSync(destPath)) {
          try { await downloadFile(att.content, destPath); } catch { continue; }
        }
        totalImages++;
        mediaMap.set(mn.id, localUrl);
      }

      if (!mediaMap.size) continue;

      const htmlBody = adfToHtml(jc.body, mediaMap);
      if (!htmlBody.trim()) continue;

      const jcCreated = jc.created ? new Date(jc.created) : null;
      let dbComment = jcCreated
        ? dbComments.find(c=>Math.abs(new Date(c.createdAt).getTime()-jcCreated.getTime())<2000)
        : null;

      if (!dbComment) {
        const jcText = normalize(adfToText(jc.body));
        dbComment = dbComments.find(c=>normalize(c.body).includes(jcText.slice(0,50))||jcText.includes(normalize(c.body).slice(0,50)));
      }

      if (dbComment) {
        await db.comment.update({ where:{ id:dbComment.id }, data:{ body:htmlBody } });
        totalUpdated++;
      }
    }

    processed++;
    process.stdout.write(`\r  Processed ${processed}/${jiraIssues.length} | Updated ${totalUpdated} comments | Images: ${totalImages}...`);
  }

  console.log(`\r  âœ… Updated: ${totalUpdated} comments | Images: ${totalImages}              `);
  return { updated:totalUpdated, images:totalImages };
}

async function main() {
  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘  Syncing comment images â€” remaining 10 boards       â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  let grandUpdated=0, grandImages=0;
  for (const board of REMAINING_BOARDS) {
    try {
      const { updated, images } = await syncBoard(board);
      grandUpdated += updated;
      grandImages += images;
    } catch(e) {
      console.error(`  âŒ Error for ${board.prefix}:`, e.message);
    }
  }

  console.log(`\n${'â•'.repeat(54)}`);
  console.log(`ðŸŽ‰ ALL DONE! Comments updated: ${grandUpdated} | Images: ${grandImages}`);
  console.log(`${'â•'.repeat(54)}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e=>{ console.error('Fatal:', e.message); process.exit(1); });


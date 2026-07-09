/**
 * Sync image attachments from Jira â†’ local app for ALL boards
 * Strategy:
 *   1. For each board, fetch all Jira issues with attachments
 *   2. Match local issue by summary (normalized)
 *   3. Download image files (image/* mime types only)
 *   4. Save to public/uploads/attachments/{issueId}/
 *   5. Insert records into attachments table (skip already synced)
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

// Directory where images will be saved (inside Next.js public folder)
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads', 'attachments');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const BOARD_MAP = [
  { prefix: 'TEST',   jql: 'project in (TEST, QPTT, QTTSS) ORDER BY created DESC' },
  { prefix: 'L2B',    jql: 'project in (L2B) ORDER BY created DESC' },
  { prefix: 'L1BOAR', jql: 'project in (CFITS) ORDER BY created DESC' },
  { prefix: 'IB',     jql: 'project in ("IN", SYS) ORDER BY created DESC' },
  { prefix: 'PSM',    jql: 'project in (PSM, PSR) ORDER BY created DESC' },
  { prefix: 'QAB',    jql: 'project in (QA) ORDER BY created DESC' },
  { prefix: 'CFM',    jql: 'project in (CFM, "CF", CFC, CLOUDFUZE) ORDER BY created DESC' },
  { prefix: 'L3B',    jql: 'project in (L3B, L3) ORDER BY created DESC' },
  { prefix: 'MB',     jql: 'project in (MB, CST, STT, MSTT, STMTS) ORDER BY created DESC' },
  { prefix: 'EB',     jql: 'project in (EB, EM, OMM, OGM, GM, GD) ORDER BY created DESC' },
  { prefix: 'CB',     jql: 'project in (CB, CM, CMQ2) ORDER BY created DESC' },
  { prefix: 'SOPS',   jql: 'project in (SOPS, SO, SAL, SR) ORDER BY created DESC' },
];

function normalize(str) { return (str || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function rid() { return Math.random().toString(36).slice(2, 11); }
function safeFilename(name) { return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200); }

/** Fetch all Jira issues with attachments for a JQL query */
async function fetchIssuesWithAttachments(jql) {
  const all = [];
  let nextPageToken = null;
  do {
    const params = new URLSearchParams({ jql, maxResults: '100', fields: 'summary,attachment' });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const res = await fetch(`${JIRA_URL}/rest/api/3/search/jql?${params}`, {
      headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
    });
    if (!res.ok) { console.warn(`  âš  HTTP ${res.status}`); return all; }
    const data = await res.json();
    if (data.errorMessages?.length) { console.warn('  âš ', data.errorMessages.join(', ')); return all; }
    // Only keep issues that have image attachments
    const withImages = (data.issues || []).filter(i => {
      const attachments = i.fields?.attachment || [];
      return attachments.some(a => a.mimeType?.startsWith('image/'));
    });
    all.push(...withImages);
    process.stdout.write(`\r  Scanned ${all.length} issues with images...`);
    nextPageToken = data.isLast ? null : data.nextPageToken;
    if (nextPageToken) await new Promise(r => setTimeout(r, 100));
  } while (nextPageToken);
  console.log();
  return all;
}

/** Download a single attachment from Jira and save to disk */
async function downloadAttachment(contentUrl, destPath) {
  const res = await fetch(contentUrl, {
    headers: { Authorization: `Basic ${AUTH}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${contentUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function syncBoard({ prefix, jql }) {
  console.log(`\nâ”€â”€ ${prefix} â”€â”€`);

  // Load local issues for this board
  const localIssues = await db.issue.findMany({
    where: { key: { startsWith: `${prefix}-` } },
    select: { id: true, key: true, summary: true },
  });
  if (!localIssues.length) { console.log('  No local issues, skipping'); return 0; }

  const summaryMap = new Map();
  for (const i of localIssues) {
    const n = normalize(i.summary);
    if (!summaryMap.has(n)) summaryMap.set(n, i);
  }
  console.log(`  Local issues: ${localIssues.length}`);

  // Load already-synced jiraIds to skip
  const localIssueIds = localIssues.map(i => i.id);
  const existingRaw = await pool.query(
    `SELECT "jiraId" FROM attachments WHERE "issueId" = ANY($1) AND "jiraId" IS NOT NULL`,
    [localIssueIds]
  );
  const existingJiraIds = new Set(existingRaw.rows.map(r => r.jiraId));
  console.log(`  Already synced attachments: ${existingJiraIds.size}`);

  // Fetch Jira issues that have image attachments
  process.stdout.write(`  Fetching Jira issues with images...`);
  const jiraIssues = await fetchIssuesWithAttachments(jql);
  console.log(`  ${jiraIssues.length} Jira issues have images`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let processed = 0;

  for (const ji of jiraIssues) {
    const local = summaryMap.get(normalize(ji.fields?.summary || ''));
    if (!local) continue;

    const attachments = (ji.fields?.attachment || []).filter(a => a.mimeType?.startsWith('image/'));

    // Create issue-specific directory
    const issueDir = path.join(UPLOADS_DIR, local.id);
    fs.mkdirSync(issueDir, { recursive: true });

    for (const att of attachments) {
      if (existingJiraIds.has(att.id)) { totalSkipped++; continue; }

      try {
        const safeFile = safeFilename(att.filename);
        const destPath = path.join(issueDir, safeFile);
        const fileSize = await downloadAttachment(att.content, destPath);

        // Store relative URL path (accessible from browser via Next.js public folder)
        const urlPath = `/uploads/attachments/${local.id}/${safeFile}`;

        await pool.query(
          `INSERT INTO attachments (id, "issueId", filename, url, "mimeType", size, "jiraId", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT DO NOTHING`,
          [rid(), local.id, att.filename, urlPath, att.mimeType, fileSize, att.id]
        );

        existingJiraIds.add(att.id);
        totalInserted++;
      } catch (e) {
        totalErrors++;
        // Skip failed downloads silently
      }
    }

    processed++;
    process.stdout.write(`\r  Processed ${processed}/${jiraIssues.length} issues | Downloaded ${totalInserted} images | Errors: ${totalErrors}...`);
  }

  console.log(`\r  âœ… Downloaded: ${totalInserted} images | Skipped: ${totalSkipped} | Errors: ${totalErrors} (processed ${processed} issues)              `);
  return totalInserted;
}

async function main() {
  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘   Syncing ALL image attachments Jira â†’ DB     â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  let grandTotal = 0;
  for (const board of BOARD_MAP) {
    try {
      grandTotal += await syncBoard(board);
    } catch (e) {
      console.error(`  âŒ Error for ${board.prefix}:`, e.message);
    }
  }

  console.log(`\n${'â•'.repeat(52)}`);
  console.log(`ðŸŽ‰ ALL DONE! Total images downloaded: ${grandTotal}`);
  console.log(`${'â•'.repeat(52)}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });


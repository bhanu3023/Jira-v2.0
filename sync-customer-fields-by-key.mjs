/**
 * Syncs customerName (and clientName, projectManager, productType, combination)
 * from Jira for ALL boards, matching by issue KEY (not title).
 * For L1BOAR: uses title-matching against CFITS.
 * Run: node sync-customer-fields-by-key.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');

const DB_URL    = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const pool      = new Pool({ connectionString: DB_URL });

const JIRA_BASE = 'https://cf2020.atlassian.net';
const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const TOKEN     = 'REDACTED_API_TOKEN';
const AUTH      = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const HEADERS   = { Authorization: AUTH, Accept: 'application/json' };

const FIELD_MAP = {
  customerName:   'customfield_10401',
  clientName:     'customfield_10883',
  projectManager: 'customfield_11380',
  productType:    'customfield_10203',
  combination:    'customfield_10236',
};
const JIRA_FIELDS = ['summary', ...Object.values(FIELD_MAP)].join(',');

// Direct boards: local spaceKey â†’ Jira project prefix
const DIRECT_BOARDS = [
  { spaceKey: 'L2BOARD',   jiraProject: 'L2B'    },
  { spaceKey: 'L3BOARD',   jiraProject: 'L3B'    },
  { spaceKey: 'PSMBOARD',  jiraProject: 'PSM'    },
  { spaceKey: 'CFMBOARD',  jiraProject: 'CFM'    },
  { spaceKey: 'INFRABOARD',jiraProject: 'IB'     },
  { spaceKey: 'MBBOARD',   jiraProject: 'MB'     },
  { spaceKey: 'EBBOARD',   jiraProject: 'EB'     },
  { spaceKey: 'CBBOARD',   jiraProject: 'CB'     },
  { spaceKey: 'SOPSBOARD', jiraProject: 'SOPS'   },
  { spaceKey: 'QABOAR',    jiraProject: 'QABOAR' },
];

function extractValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number') return String(raw);
  if (Array.isArray(raw)) {
    const vals = raw.map(v => v?.value ?? v?.name ?? v?.displayName ?? String(v)).filter(Boolean);
    return vals.length ? vals.join(', ') : null;
  }
  return raw.value ?? raw.name ?? raw.displayName ?? raw.emailAddress ?? null;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJiraIssues(keys) {
  // Fetch up to 50 issues by key
  const jql = `key in (${keys.join(',')})`;
  const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${JIRA_FIELDS}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        const txt = await res.text();
        if (res.status === 429) { await sleep(10000); continue; }
        console.error(`  Jira error ${res.status}: ${txt.slice(0, 150)}`);
        return [];
      }
      const data = await res.json();
      return data.issues || [];
    } catch (e) {
      console.error(`  Fetch error: ${e.message}`);
      await sleep(3000 * (attempt + 1));
    }
  }
  return [];
}

async function syncDirectBoard({ spaceKey, jiraProject }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Board: ${spaceKey}  â†  Jira: ${jiraProject}`);

  const spaceRes = await pool.query(`SELECT id FROM spaces WHERE key = $1`, [spaceKey]);
  if (!spaceRes.rows.length) { console.log(`  Space not found, skipping.`); return; }
  const spaceId = spaceRes.rows[0].id;

  // Get all issues missing at least customerName (we'll update all fields we find)
  const localRes = await pool.query(`
    SELECT id, key FROM issues
    WHERE "spaceId" = $1
      AND ("customerName" IS NULL OR "customerName" = ''
        OR "clientName" IS NULL
        OR "projectManager" IS NULL
        OR "productType" IS NULL
        OR combination IS NULL)
    ORDER BY key
  `, [spaceId]);

  const localIssues = localRes.rows;
  console.log(`  ${localIssues.length} issues have at least one missing custom field`);
  if (localIssues.length === 0) { console.log('  Nothing to do.'); return; }

  // Build a map by key for fast lookup
  const byKey = new Map(localIssues.map(i => [i.key, i]));
  const keys = localIssues.map(i => i.key);

  let updated = 0;
  const BATCH = 50;

  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const jiraIssues = await fetchJiraIssues(batch);

    for (const ji of jiraIssues) {
      const local = byKey.get(ji.key);
      if (!local) continue;

      const setClauses = [];
      const vals = [];
      let idx = 1;
      for (const [ourKey, jiraFieldId] of Object.entries(FIELD_MAP)) {
        const val = extractValue(ji.fields?.[jiraFieldId]);
        if (!val) continue;
        setClauses.push(`"${ourKey}" = $${idx++}`);
        vals.push(val);
      }
      if (!setClauses.length) continue;

      vals.push(local.id);
      await pool.query(`UPDATE issues SET ${setClauses.join(', ')} WHERE id = $${idx}`, vals);
      updated++;
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= keys.length) {
      process.stdout.write(`  Progress: ${Math.min(i + BATCH, keys.length)}/${keys.length} (updated ${updated})\n`);
    }
  }

  console.log(`  â†’ Updated ${updated}/${localIssues.length} issues in ${spaceKey}`);

  const names = await pool.query(
    `SELECT COUNT(DISTINCT "customerName") as cnt FROM issues WHERE "spaceId" = $1 AND "customerName" IS NOT NULL AND "customerName" <> ''`,
    [spaceId]
  );
  console.log(`  Distinct customer names now: ${names.rows[0].cnt}`);
}

// L1BOAR uses title-matching against CFITS (keys don't match)
async function syncL1Boar() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Board: L1BOAR  â†  Jira: CFITS (title-matching)`);

  const spaceRes = await pool.query(`SELECT id FROM spaces WHERE key = 'L1BOAR'`);
  if (!spaceRes.rows.length) { console.log('  Space not found, skipping.'); return; }
  const spaceId = spaceRes.rows[0].id;

  const localRes = await pool.query(`
    SELECT id, key, summary FROM issues
    WHERE "spaceId" = $1
      AND ("customerName" IS NULL OR "customerName" = ''
        OR "clientName" IS NULL OR "projectManager" IS NULL
        OR "productType" IS NULL OR combination IS NULL)
  `, [spaceId]);

  const localIssues = localRes.rows;
  console.log(`  ${localIssues.length} issues missing fields`);
  if (localIssues.length === 0) { console.log('  Nothing to do.'); return; }

  const byTitle = new Map();
  for (const issue of localIssues) {
    if (!issue.summary) continue;
    const norm = normalize(issue.summary);
    byTitle.set(norm, issue);
    if (norm.length > 20) byTitle.set(norm.slice(0, 60), issue);
  }

  // Fetch all CFITS issues with fields set using cursor pagination
  const fieldConditions = Object.values(FIELD_MAP)
    .map(id => `cf[${id.replace('customfield_', '')}] is not EMPTY`)
    .join(' OR ');
  const jql = `project=CFITS AND (${fieldConditions}) ORDER BY updated DESC`;

  const jiraMap = new Map(); // norm title â†’ fields
  let nextPageToken = null;
  let fetched = 0;

  while (true) {
    let url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=${JIRA_FIELDS}`;
    if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) { console.error(`  Jira error ${res.status}`); break; }
    const data = await res.json();
    const batch = data.issues || [];

    for (const ji of batch) {
      const norm = normalize(ji.fields?.summary || '');
      if (!norm) continue;
      const fields = {};
      for (const [ourKey, jiraFieldId] of Object.entries(FIELD_MAP)) {
        const val = extractValue(ji.fields?.[jiraFieldId]);
        if (val) fields[ourKey] = val;
      }
      if (Object.keys(fields).length > 0) {
        jiraMap.set(norm, fields);
        if (norm.length > 20) jiraMap.set(norm.slice(0, 60), fields);
      }
    }

    fetched += batch.length;
    if (fetched % 1000 === 0) process.stdout.write(`  Fetched ${fetched} from CFITS...\n`);
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  console.log(`  Fetched ${fetched} from CFITS | ${jiraMap.size} unique entries`);

  const jiraEntries = Array.from(jiraMap.entries());
  let updated = 0;

  for (const issue of localIssues) {
    if (!issue.summary) continue;
    const localNorm = normalize(issue.summary);
    let jiraFields = jiraMap.get(localNorm) ?? jiraMap.get(localNorm.slice(0, 60));
    if (!jiraFields && localNorm.length >= 15) {
      for (const [jNorm, fields] of jiraEntries) {
        const shorter = jNorm.length < localNorm.length ? jNorm : localNorm;
        const longer  = jNorm.length >= localNorm.length ? jNorm : localNorm;
        if (shorter.length >= 15 && longer.includes(shorter)) { jiraFields = fields; break; }
      }
    }
    if (!jiraFields) continue;

    const setClauses = [];
    const vals = [];
    let idx = 1;
    for (const [ourKey] of Object.entries(FIELD_MAP)) {
      if (!jiraFields[ourKey]) continue;
      setClauses.push(`"${ourKey}" = $${idx++}`);
      vals.push(jiraFields[ourKey]);
    }
    if (!setClauses.length) continue;

    vals.push(issue.id);
    await pool.query(`UPDATE issues SET ${setClauses.join(', ')} WHERE id = $${idx}`, vals);
    updated++;
  }

  console.log(`  â†’ Updated ${updated}/${localIssues.length} issues in L1BOAR`);
}

async function main() {
  console.log('Syncing customer fields for all boards (key-based matching)...');
  console.log(`Start: ${new Date().toLocaleTimeString()}\n`);

  for (const board of DIRECT_BOARDS) {
    await syncDirectBoard(board);
  }
  await syncL1Boar();

  console.log(`\nâœ… Done! ${new Date().toLocaleTimeString()}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });


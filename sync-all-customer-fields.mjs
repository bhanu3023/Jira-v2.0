/**
 * Syncs customerName, clientName, projectManager, productType, combination
 * from Jira into ALL local boards.
 * Uses /rest/api/3/search/jql with nextPageToken pagination.
 * Run: node sync-all-customer-fields.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('./node_modules/pg/lib/index.js');

const DB_URL    = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const pool      = new Pool({ connectionString: DB_URL });

const JIRA_BASE = 'https://cf2020.atlassian.net';
const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const TOKEN     = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const HEADERS   = { Authorization: `Basic ${AUTH}`, Accept: 'application/json' };

const FIELD_MAP = {
  customerName:   'customfield_10401',
  clientName:     'customfield_10883',
  projectManager: 'customfield_11380',
  productType:    'customfield_10203',
  combination:    'customfield_10236',
};
const JIRA_FIELDS = ['summary', ...Object.values(FIELD_MAP)].join(',');

// local DB spaceKey â†’ Jira project key
const BOARD_MAP = [
  { spaceKey: 'L1BOAR',   jiraProject: 'CFITS'  },
  { spaceKey: 'L2BOARD',  jiraProject: 'L2B'    },
  { spaceKey: 'L3BOARD',  jiraProject: 'L3B'    },
  { spaceKey: 'PSMBOARD', jiraProject: 'PSM'    },
  { spaceKey: 'CFMBOARD', jiraProject: 'CFM'    },
  { spaceKey: 'INFRABOARD',jiraProject: 'IB'    },
  { spaceKey: 'MBBOARD',  jiraProject: 'MB'     },
  { spaceKey: 'EBBOARD',  jiraProject: 'EB'     },
  { spaceKey: 'CBBOARD',  jiraProject: 'CB'     },
  { spaceKey: 'SOPSBOARD',jiraProject: 'SOPS'   },
  { spaceKey: 'QABOAR',   jiraProject: 'QABOAR' },
];

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

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

async function fetchWithRetry(url, opts, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      return res;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function fetchJiraFieldMap(jiraProject) {
  const fieldConditions = Object.values(FIELD_MAP)
    .map(id => `cf[${id.replace('customfield_', '')}] is not EMPTY`)
    .join(' OR ');
  const jqlStr = `project=${jiraProject} AND (${fieldConditions}) ORDER BY updated DESC`;

  const map = new Map();
  let nextPageToken = null;
  let fetched = 0;
  const pageSize = 100;
  let firstPage = true;

  while (true) {
    let url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(jqlStr)}&maxResults=${pageSize}&fields=${JIRA_FIELDS}`;
    if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

    let res, data;
    try {
      res = await fetchWithRetry(url, { headers: HEADERS });
      if (!res.ok) {
        const err = await res.text();
        console.error(`  Jira ${jiraProject} error ${res.status}: ${err.slice(0, 200)}`);
        break;
      }
      data = await res.json();
    } catch (e) {
      console.error(`  Fetch failed: ${e.message}`);
      break;
    }

    const batch = data.issues || [];
    if (firstPage) {
      console.log(`  Fetching Jira ${jiraProject} (issues with fields set)... first batch: ${batch.length}`);
      firstPage = false;
    }

    for (const ji of batch) {
      const norm = normalize(ji.fields?.summary || '');
      if (!norm) continue;
      const fields = {};
      for (const [ourKey, jiraFieldId] of Object.entries(FIELD_MAP)) {
        const val = extractValue(ji.fields?.[jiraFieldId]);
        if (val) fields[ourKey] = val;
      }
      if (Object.keys(fields).length > 0) {
        map.set(norm, fields);
        if (norm.length > 20) map.set(norm.slice(0, 60), fields);
      }
    }

    fetched += batch.length;
    if (fetched % 1000 === 0 && fetched > 0) process.stdout.write(`    fetched ${fetched}...\n`);

    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  console.log(`  Total fetched from Jira: ${fetched} | Unique entries in map: ${map.size}`);
  return map;
}

async function syncBoard({ spaceKey, jiraProject }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Board: ${spaceKey}  â†  Jira: ${jiraProject}`);

  const spaceRes = await pool.query(`SELECT id FROM spaces WHERE key = $1`, [spaceKey]);
  if (!spaceRes.rows.length) { console.log(`  Space not found, skipping.`); return; }
  const spaceId = spaceRes.rows[0].id;

  const localRes = await pool.query(`
    SELECT id, key, summary, "customerName", "clientName", "projectManager", "productType", combination
    FROM issues
    WHERE "spaceId" = $1
      AND ("customerName" IS NULL OR "clientName" IS NULL OR "projectManager" IS NULL
           OR "productType" IS NULL OR combination IS NULL)
  `, [spaceId]);

  const localIssues = localRes.rows;
  console.log(`  ${localIssues.length} issues have at least one missing field`);
  if (localIssues.length === 0) { console.log('  Nothing to do.'); return; }

  const byTitle = new Map();
  for (const issue of localIssues) {
    if (!issue.summary) continue;
    const norm = normalize(issue.summary);
    byTitle.set(norm, issue);
    if (norm.length > 20) byTitle.set(norm.slice(0, 60), issue);
  }

  const jiraMap = await fetchJiraFieldMap(jiraProject);

  if (jiraMap.size === 0) { console.log('  No Jira issues with fields found, skipping.'); return; }

  let updated = 0;
  const jiraEntries = Array.from(jiraMap.entries());

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
    for (const ourKey of Object.keys(FIELD_MAP)) {
      if (issue[ourKey] !== null) continue;
      if (!jiraFields[ourKey]) continue;
      setClauses.push(`"${ourKey}" = $${idx++}`);
      vals.push(jiraFields[ourKey]);
    }
    if (!setClauses.length) continue;

    vals.push(issue.id);
    await pool.query(`UPDATE issues SET ${setClauses.join(', ')} WHERE id = $${idx}`, vals);
    updated++;
    if (updated <= 5 || updated % 100 === 0) {
      const log = setClauses.map((c, i) => `${c.split(' = ')[0].replace(/"/g,'')}="${vals[i]}"`).join(', ');
      console.log(`  âœ“ [${updated}] ${issue.key}: ${log}`);
    }
  }

  console.log(`  â†’ Updated ${updated} issues in ${spaceKey}`);

  const names = await pool.query(
    `SELECT DISTINCT "customerName" FROM issues WHERE "spaceId" = $1 AND "customerName" IS NOT NULL ORDER BY "customerName"`,
    [spaceId]
  );
  const nameList = names.rows.map(r => r.customerName);
  console.log(`  Customer names (${nameList.length}): ${nameList.slice(0, 15).join(', ')}${nameList.length > 15 ? '...' : ''}`);
}

async function main() {
  console.log('Syncing customer fields for all boards from Jira...');
  for (const board of BOARD_MAP) {
    await syncBoard(board);
  }
  console.log('\nâœ… All boards synced!');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });


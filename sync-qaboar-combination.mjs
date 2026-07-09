/**
 * Syncs the Combination field (customfield_10236) from Jira QAB into local QABOAR tickets.
 * Only updates tickets that currently have combination = NULL.
 * Matches by key directly (QAB-xxx == QAB-xxx).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DB_URL = 'postgresql://postgres:neutara123@localhost:5432/neutara_db';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });

const JIRA_BASE = 'https://cf2020.atlassian.net';
const EMAIL     = 'sujana.manapuram@cloudfuze.com';
const TOKEN     = 'REDACTED_API_TOKEN';
const AUTH      = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const HEADERS   = { Authorization: `Basic ${AUTH}`, Accept: 'application/json' };

// Jira field IDs
const COMBO_FIELD  = 'customfield_10236';

function extractValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (Array.isArray(raw)) {
    const vals = raw.map(v => v?.value ?? v?.name ?? String(v)).filter(Boolean);
    return vals.length ? vals.join(', ') : null;
  }
  return raw.value ?? raw.name ?? null;
}

async function main() {
  // Load QABOAR issues missing combination
  const space = await db.space.findFirst({ where: { key: 'QABOAR' } });
  const missing = await db.issue.findMany({
    where: { spaceId: space.id, combination: null },
    select: { id: true, key: true },
  });
  console.log(`${missing.length} QABOAR tickets missing combination field`);
  if (!missing.length) { await db.$disconnect(); return; }

  // Batch Jira lookups: fetch 100 issues at a time via JQL key IN (...)
  let updated = 0, notInJira = 0;
  const BATCH = 100;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const keys = batch.map(x => x.key).join(',');
    const jql = encodeURIComponent(`issueKey in (${keys})`);
    const url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&maxResults=${BATCH}&fields=${COMBO_FIELD}`;

    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) { console.error('Jira error:', res.status); continue; }
      const data = await res.json();

      for (const ji of (data.issues || [])) {
        const combo = extractValue(ji.fields?.[COMBO_FIELD]);
        if (!combo) { notInJira++; continue; }

        await db.issue.update({
          where: { key: ji.key },
          data: { combination: combo },
        });
        updated++;
      }
    } catch (e) {
      console.error('Error at batch', i, e.message);
    }

    if ((i / BATCH) % 5 === 0) {
      console.log(`  processed ${i + BATCH}/${missing.length} | updated: ${updated}`);
    }
  }

  console.log(`\nDone! Updated: ${updated} | No combination in Jira: ${notInJira}`);
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


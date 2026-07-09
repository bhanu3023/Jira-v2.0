/**
 * POST /api/jira-sync-fields
 *
 * Syncs Customer Name, Client Name, Project Manager, Product Type, Combination
 * from a Jira project into our local issues by matching on summary/title.
 *
 * Optimised: only fetches Jira issues that actually have at least one field filled,
 * then bulk-patches all matched local issues in a single internal request.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
// Allow up to 5 minutes for large syncs
export const maxDuration = 300;

function extractValue(raw: any): any {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number') return raw;
  if (Array.isArray(raw)) {
    const vals = raw.map(extractValue).filter(v => v !== null && v !== '');
    return vals.length ? vals : null;
  }
  if (typeof raw === 'object') {
    return raw.value ?? raw.name ?? raw.displayName ?? raw.emailAddress ?? null;
  }
  return null;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Field mapping: our key → Jira customfield ID
const DEFAULT_FIELD_MAP: Record<string, string> = {
  customerName:   'customfield_10401',
  clientName:     'customfield_10883',
  projectManager: 'customfield_11380',
  productType:    'customfield_10203',
  combination:    'customfield_10236',
};

export async function POST(req: NextRequest) {
  try {
    const { jiraUrl, email, apiToken, jiraProject, spaceKey, fieldMap } = await req.json();

    if (!jiraUrl || !email || !apiToken || !jiraProject) {
      return NextResponse.json({ ok: false, error: 'Missing jiraUrl, email, apiToken or jiraProject' }, { status: 400 });
    }

    const base = jiraUrl.replace(/\/$/, '').replace(/\/jira$/, '');
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const jiraHeaders = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    };

    const mapping: Record<string, string> = { ...DEFAULT_FIELD_MAP, ...fieldMap };
    const jiraFieldIds = Object.values(mapping).join(',');

    // ── 1. Fetch ONLY Jira issues that have at least one field filled ─────────
    // This is far fewer than ALL issues and avoids fetching thousands of empty records
    const customFieldConditions = Object.values(mapping)
      .map(id => `cf[${id.replace('customfield_', '')}] is not EMPTY`)
      .join(' OR ');
    const jql = encodeURIComponent(
      `project=${jiraProject} AND (${customFieldConditions}) ORDER BY updated DESC`
    );

    const jiraMap = new Map<string, Record<string, any>>(); // normalizedTitle → fields
    let startAt = 0;
    const pageSize = 100;

    while (true) {
      const url = `${base}/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${pageSize}&fields=summary,${jiraFieldIds}`;
      const res = await fetch(url, { headers: jiraHeaders });
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ ok: false, error: `Jira search failed: ${err}` }, { status: 400 });
      }
      const data = await res.json();
      const batch: any[] = data.issues || [];
      for (const ji of batch) {
        const normTitle = normalize(ji.fields?.summary || '');
        if (normTitle) jiraMap.set(normTitle, ji.fields || {});
        // Also index partial title (first 60 chars) for fuzzy match
        if (normTitle.length > 20) jiraMap.set(normTitle.slice(0, 60), ji.fields || {});
      }
      if (batch.length < pageSize) break;
      startAt += pageSize;
    }

    // ── 2. Fetch all local issues in the space ────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080';
    const localRes = await fetch(`${appUrl}/api/issues?spaceKey=${spaceKey}&limit=5000`, {
      headers: { 'x-internal': '1' },
    });
    if (!localRes.ok) {
      return NextResponse.json({ ok: false, error: `Failed to fetch local issues: ${localRes.status}` }, { status: 500 });
    }
    const localData = await localRes.json();
    const localIssues: any[] = localData.issues || [];

    // ── 3. Match & bulk update ────────────────────────────────────────────────
    let matched = 0;
    let updated = 0;
    const log: string[] = [];

    // Build update patches for all matches
    const patches: Array<{ key: string; patch: Record<string, any>; jiraKey?: string }> = [];

    for (const local of localIssues) {
      const localTitle = local.summary || local.title || '';
      if (!localTitle) continue;
      const localNorm = normalize(localTitle);

      // Find best match
      let jiraFields: Record<string, any> | undefined;

      // Exact match
      if (jiraMap.has(localNorm)) {
        jiraFields = jiraMap.get(localNorm);
      } else {
        // Substring match: find a jira title that is contained in or contains the local title
        const entries = Array.from(jiraMap.entries());
        for (let ei = 0; ei < entries.length; ei++) {
          const [jiraNorm, fields] = entries[ei];
          if (jiraNorm.length < 10) continue;
          const shorter = jiraNorm.length < localNorm.length ? jiraNorm : localNorm;
          const longer  = jiraNorm.length >= localNorm.length ? jiraNorm : localNorm;
          if (shorter.length >= 15 && longer.includes(shorter)) {
            jiraFields = fields;
            break;
          }
        }
      }

      if (!jiraFields) continue;
      matched++;

      const patch: Record<string, any> = {};
      for (const [ourKey, jiraFieldId] of Object.entries(mapping)) {
        const raw = jiraFields[jiraFieldId];
        const val = extractValue(raw);
        if (val !== null && val !== undefined && val !== '') {
          patch[ourKey] = val;
        }
      }

      if (Object.keys(patch).length === 0) continue;
      patches.push({ key: local.key, patch });
    }

    // Apply patches sequentially (fast — local in-memory store)
    for (const { key, patch } of patches) {
      try {
        const r = await fetch(`${appUrl}/api/issues/${key}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-internal': '1' },
          body: JSON.stringify(patch),
        });
        if (r.ok) {
          updated++;
          log.push(`✓ ${key}: ${Object.entries(patch).map(([k,v]) => `${k}="${Array.isArray(v) ? v.join(', ') : v}"`).join(', ')}`);
        }
      } catch {
        // skip
      }
    }

    return NextResponse.json({
      ok: true,
      jiraWithFields: jiraMap.size,
      localTotal: localIssues.length,
      matched,
      updated,
      log,
    });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

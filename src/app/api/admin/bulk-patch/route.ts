/**
 * POST /api/admin/bulk-patch
 * Body: { secret, patches: [{key, patch}] }
 * Applies custom-field patches to multiple issues at once (internal migration use).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SECRET = process.env.ADMIN_BULK_SECRET || 'cf-admin-sync-2024';
const ADMIN_HEADER = 'cf-admin-sync-2024';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.secret !== SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const patches: Array<{ key: string; patch: Record<string, any> }> = body.patches || [];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080';
  let updated = 0;
  const errors: string[] = [];

  for (const { key, patch } of patches) {
    try {
      const r = await fetch(`${appUrl}/api/issues/${key.toUpperCase()}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-admin': ADMIN_HEADER,
        },
        body: JSON.stringify(patch),
      });
      if (r.ok) updated++;
      else errors.push(`${key}: HTTP ${r.status}`);
    } catch (e: any) {
      errors.push(`${key}: ${e.message}`);
    }
  }

  return NextResponse.json({ ok: true, total: patches.length, updated, errors: errors.slice(0, 20) });
}

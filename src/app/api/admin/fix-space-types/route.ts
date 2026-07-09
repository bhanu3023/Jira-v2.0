/**
 * POST /api/admin/fix-space-types
 * Bulk-updates all spaces that have type='service_desk' to 'scrum',
 * EXCEPT those whose key is in the SERVICE_DESK_KEYS list.
 *
 * Body: { secret: "cf-admin-sync-2024", serviceDesk?: string[] }
 * serviceDesk: optional list of space keys to keep as service_desk.
 *              Defaults to known SD keys.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const SECRET = process.env.ADMIN_BULK_SECRET || 'cf-admin-sync-2024';

// Known service-desk space keys — all others will be set to 'scrum'
const DEFAULT_SD_KEYS = ['SOPSBOARD'];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.secret !== SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const sdKeys: string[] = (body.serviceDesk ?? DEFAULT_SD_KEYS).map((k: string) => k.toUpperCase());

  // Update all spaces with type='service_desk' that are NOT in the SD list
  const result = await db.space.updateMany({
    where: {
      type: 'service_desk',
      key: { notIn: sdKeys },
    },
    data: { type: 'scrum' },
  });

  return NextResponse.json({ ok: true, updated: result.count, keptServiceDesk: sdKeys });
}

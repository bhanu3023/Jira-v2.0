/**
 * GET /api/auth/oauth/google?spaceKey=INFRA&returnUrl=...
 * Redirects user to Google OAuth consent screen.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/oauth-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const spaceKey  = searchParams.get('spaceKey')  || 'INFRA';
  const returnUrl = searchParams.get('returnUrl') || `/spaces/${spaceKey}/settings?tab=email`;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const base = returnUrl.includes('?') ? returnUrl : `${returnUrl}?tab=email`;
    return NextResponse.redirect(
      new URL(`${base}&oauth_error=GOOGLE_CLIENT_ID+is+not+configured+in+.env.local`, req.url)
    );
  }

  const appUrl      = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080';
  const redirectUri = `${appUrl}/api/auth/oauth/google/callback`;
  const state       = Buffer.from(JSON.stringify({ spaceKey, returnUrl, ts: Date.now() })).toString('base64url');

  return NextResponse.redirect(getGoogleAuthUrl(redirectUri, state));
}

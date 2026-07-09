/**
 * GET /api/auth/oauth/google/callback
 * Google redirects here after the user picks an account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exchangeGoogleCode } from '@/lib/oauth-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state') || '';
  const error = searchParams.get('error');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080';

  let spaceKey  = 'INFRA';
  let returnUrl = `/spaces/INFRA/settings?tab=email`;
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    spaceKey  = parsed.spaceKey  || spaceKey;
    returnUrl = parsed.returnUrl || returnUrl;
  } catch {}

  const failUrl = `${appUrl}${returnUrl}${returnUrl.includes('?') ? '&' : '?'}oauth_error=${encodeURIComponent(error || 'unknown_error')}`;

  if (error || !code) return NextResponse.redirect(failUrl);

  const redirectUri = `${appUrl}/api/auth/oauth/google/callback`;
  const result = await exchangeGoogleCode(code, redirectUri);

  if (!result) return NextResponse.redirect(failUrl.replace('unknown_error', 'token_exchange_failed'));

  // Start IMAP poller with OAuth token
  try {
    await fetch(`${appUrl}/api/email/connect`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        email:             result.email,
        oauthAccessToken:  result.tokens.accessToken,
        oauthRefreshToken: result.tokens.refreshToken,
        oauthProvider:     'google',
        imapHost:          'imap.gmail.com',
        smtpHost:          'smtp.gmail.com',
        spaceKey,
        autoReply:         true,
        appUrl,
      }),
    });
  } catch (e) {
    console.error('[OAuth/Google] Failed to start poller:', e);
  }

  const successUrl = `${appUrl}${returnUrl}${returnUrl.includes('?') ? '&' : '?'}oauth_success=1&oauth_email=${encodeURIComponent(result.email)}&oauth_name=${encodeURIComponent(result.name || '')}`;
  return NextResponse.redirect(successUrl);
}

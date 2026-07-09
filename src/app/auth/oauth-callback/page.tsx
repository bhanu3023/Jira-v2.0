'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/store';

/**
 * /auth/oauth-callback
 *
 * Server → client bridge: the Microsoft OAuth callback (server route) redirects
 * here with ?token=<jwt>&next=<url>.  We store the token in localStorage so the
 * Zustand store picks it up, then navigate to the intended destination.
 */
function OAuthCallbackContent() {
  const searchParams   = useSearchParams();
  const router         = useRouter();
  const loadUser       = useStore((s) => s.loadUser);

  useEffect(() => {
    const token     = searchParams.get('token');
    const next      = searchParams.get('next') || '/dashboard';
    const oauthErr  = searchParams.get('oauth_error');

    if (oauthErr) {
      router.replace(`/auth/login?oauth_error=${encodeURIComponent(oauthErr)}`);
      return;
    }

    if (!token) {
      router.replace('/auth/login?oauth_error=missing_token');
      return;
    }

    // Store token and do a hard navigation to ensure fresh JS is loaded
    localStorage.setItem('jira_token', token);
    window.location.replace(next);
  }, [searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
      <p className="text-sm text-gray-500">Signing you in…</p>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}

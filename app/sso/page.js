'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatSsoError } from '@/lib/ff/sso-errors';

function SsoInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const launchToken = searchParams.get('launch_token') ?? '';
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!launchToken) {
      setError('Missing launch token. Open Frameforge from the OWeb App Store.');
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/sso/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ launch_token: launchToken }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.error || 'sso_failed');
        }

        const supabase = createClient();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: payload.accessToken,
          refresh_token: payload.refreshToken ?? '',
        });
        if (sessionError) throw sessionError;

        await fetch('/api/auth/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activation_kind: 'sso_launch',
            workspace_id: payload.orgId,
          }),
        });

        if (cancelled) return;
        router.replace('/studio');
        router.refresh();
      } catch (e) {
        if (cancelled) return;
        const raw = e instanceof Error ? e.message : 'SSO failed';
        setError(formatSsoError(raw));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [launchToken, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-white">
      <div className="max-w-md text-center">
        {error ? (
          <>
            <h1 className="text-xl font-bold">Could not sign you in</h1>
            <p className="mt-2 text-sm text-white/50">{error}</p>
            <a href="/login" className="mt-4 inline-block text-sm text-[#d9ff00] hover:underline">
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Signing you in…</h1>
            <p className="mt-2 text-sm text-white/50">Completing secure handoff from OWeb.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function SsoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
          <p className="text-sm text-white/50">Loading…</p>
        </div>
      }
    >
      <SsoInner />
    </Suspense>
  );
}

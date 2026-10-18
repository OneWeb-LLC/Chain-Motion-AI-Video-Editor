import { FF_APP_ID, getOwebPlatformApiUrl } from '@/lib/ff/constants';
import {
  buildOwebRedeemLaunchUrl,
  mapRedeemErrorFromResponse,
} from '@/lib/sso/redeem-contract';

export { OWEB_REDEEM_LAUNCH_TOKEN_PATH, mapRedeemErrorFromResponse } from '@/lib/sso/redeem-contract';

const REDEEM_TIMEOUT_MS = 15_000;

export function getOwebRedeemLaunchUrl() {
  return buildOwebRedeemLaunchUrl(getOwebPlatformApiUrl());
}

/** Redeem a one-time OWeb ecosystem launch token via the control-plane API (OWeb PR #57). */
export async function redeemEcosystemLaunchToken(launchToken) {
  const trimmed = launchToken.trim();
  if (!trimmed) throw new Error('missing_launch_token');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDEEM_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(getOwebRedeemLaunchUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        launch_token: trimmed,
        app_id: FF_APP_ID,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('redeem_timeout');
    throw new Error('redeem_unreachable');
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const mapped = mapRedeemErrorFromResponse(
      response.status,
      payload.error ?? payload.message,
    );
    throw new Error(mapped);
  }

  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new Error('redeem_invalid_response');
  }
  if (typeof payload.org_id !== 'string' || typeof payload.user_id !== 'string') {
    throw new Error('redeem_invalid_response');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    orgId: payload.org_id,
    userId: payload.user_id,
  };
}

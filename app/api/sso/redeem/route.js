import { NextResponse } from 'next/server';
import { redeemEcosystemLaunchToken } from '@/lib/sso/redeem-launch-token.server';

function httpStatusForRedeemError(message) {
  if (
    message === 'missing_launch_token' ||
    message === 'invalid_launch_token' ||
    message === 'launch_token_expired' ||
    message === 'launch_token_consumed' ||
    message === 'launch_token_wrong_app' ||
    message === 'redeem_invalid_response'
  ) {
    return 400;
  }
  if (message === 'redeem_timeout' || message === 'redeem_unreachable') {
    return 503;
  }
  return 502;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const launchToken = typeof body.launch_token === 'string' ? body.launch_token : '';
    const result = await redeemEcosystemLaunchToken(launchToken);
    return NextResponse.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      orgId: result.orgId,
      userId: result.userId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sso_failed';
    return NextResponse.json({ error: message }, { status: httpStatusForRedeemError(message) });
  }
}

/** Centralized OWeb SSO redeem (PR #57) — shared contract helpers (no secrets). */

export const OWEB_REDEEM_LAUNCH_TOKEN_PATH = '/ecosystem/redeem-launch-token';

export function buildOwebRedeemLaunchUrl(platformApiBase) {
  const base = (platformApiBase || 'https://oweb.one/api/v1').replace(/\/$/, '');
  return `${base}${OWEB_REDEEM_LAUNCH_TOKEN_PATH}`;
}

export function mapRedeemErrorFromResponse(status, errorCode) {
  const code = typeof errorCode === 'string' ? errorCode : 'redeem_failed';
  if (status === 408 || code === 'redeem_timeout') return 'redeem_timeout';
  if (code === 'missing_token' || code === 'missing_launch_token') return 'missing_launch_token';
  if (code === 'invalid_token' || code === 'invalid_launch_token') return 'invalid_launch_token';
  if (code === 'expired_token' || code === 'launch_token_expired') return 'launch_token_expired';
  if (code === 'launch_token_consumed' || code.includes('consumed')) return 'launch_token_consumed';
  if (code === 'app_mismatch' || code === 'launch_token_wrong_app') return 'launch_token_wrong_app';
  if (status === 502 || status === 503 || code === 'redeem_unreachable') return 'redeem_unreachable';
  return code;
}

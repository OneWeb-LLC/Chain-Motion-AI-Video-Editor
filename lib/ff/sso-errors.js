export function formatSsoError(raw) {
  if (raw.includes('redeem_unreachable') || raw.includes('redeem_timeout')) {
    return 'OWeb sign-in handoff is temporarily unavailable. Try again or use email sign-in.';
  }
  if (raw.includes('launch_token_consumed')) {
    return 'This launch link was already used. Start again from OWeb.';
  }
  if (raw.includes('launch_token_expired')) {
    return 'This launch link expired. Start again from OWeb.';
  }
  if (raw.includes('launch_token_wrong_app')) {
    return 'This launch link is for a different app.';
  }
  if (raw.includes('invalid_launch_token') || raw.includes('missing_launch_token')) {
    return 'Invalid or missing launch token. Open Frameforge from the OWeb App Store.';
  }
  return raw;
}

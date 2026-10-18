/** OWeb ecosystem app id (must match control-plane `ecosystem-apps.ts` when registered). */
export const FF_APP_ID = 'frameforge';

export const FF_TABLE_PREFIX = 'ff_';

export const SUPABASE_AUTH_STORAGE_KEY = 'ao-supabase-auth';

export const OWEB_ORIGIN = 'https://oweb.one';
export const OWEB_AUTH_URL = 'https://auth.oweb.one';

export const ONE_OS_PROJECT_ID = 'ebjzdcnphkfpxfldnatm';

export function getOwebAppUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_OWEB_APP_URL || process.env.OWEB_APP_URL;
  return (fromEnv || OWEB_ORIGIN).replace(/\/$/, '');
}

export function getOwebPlatformApiUrl() {
  const fromEnv =
    process.env.NEXT_PUBLIC_OWEB_PLATFORM_API_URL || process.env.OWEB_PLATFORM_API_URL;
  return (fromEnv || `${getOwebAppUrl()}/api/v1`).replace(/\/$/, '');
}

export function getAppPublicUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  return (fromEnv || 'http://localhost:3000').replace(/\/$/, '');
}

export function owebLoginUrl(options = {}) {
  const url = new URL('/login', getOwebAppUrl());
  if (options.launch !== false) {
    url.searchParams.set('launch', FF_APP_ID);
  }
  if (options.redirect) {
    url.searchParams.set('redirect', options.redirect);
  }
  return url.toString();
}

export function owebSignupUrl() {
  const url = new URL('/signup', getOwebAppUrl());
  url.searchParams.set('launch', FF_APP_ID);
  return url.toString();
}

/** When true, product routes require OneID session (default: true in production). */
export function isAuthRequired() {
  const flag = process.env.NEXT_PUBLIC_FF_REQUIRE_AUTH || process.env.FF_REQUIRE_AUTH;
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return process.env.NODE_ENV === 'production';
}


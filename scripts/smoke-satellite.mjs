/**
 * Static satellite readiness smoke (no network).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');
assert(
  !envExample.includes('SUPABASE_SERVICE_ROLE_KEY'),
  'env.example must not require SUPABASE_SERVICE_ROLE_KEY (centralized OWeb redeem)',
);
assert(envExample.includes('NEXT_PUBLIC_FF_REQUIRE_AUTH=true'), 'env.example must document REQUIRE_AUTH');
assert(envExample.includes('ebjzdcnphkfpxfldnatm'), 'env.example must pin One OS project id');
assert(envExample.includes('auth.oweb.one'), 'env.example must use auth.oweb.one');
assert(
  envExample.includes('NEXT_PUBLIC_OWEB_PLATFORM_API_URL'),
  'env.example must document OWeb platform API for SSO redeem',
);

assert(existsSync(resolve(root, 'docs/SATELLITE.md')), 'missing docs/SATELLITE.md');
assert(
  existsSync(resolve(root, 'supabase/migrations/20261018130000_ff_profiles_isolation.sql')),
  'missing ff_profiles migration',
);

const constants = readFileSync(resolve(root, 'lib/ff/constants.js'), 'utf8');
assert(constants.includes("FF_APP_ID = 'frameforge'"), 'app id must be frameforge');
assert(constants.includes('ao-supabase-auth'), 'shared session key ao-supabase-auth required');

const client = readFileSync(resolve(root, 'lib/supabase/client.js'), 'utf8');
assert(
  client.includes('SUPABASE_AUTH_STORAGE_KEY') || client.includes('ao-supabase-auth'),
  'browser client must use shared ao-supabase-auth storage key',
);

const redeem = readFileSync(resolve(root, 'lib/sso/redeem-launch-token.server.js'), 'utf8');
const redeemContract = readFileSync(resolve(root, 'lib/sso/redeem-contract.js'), 'utf8');
assert(
  redeemContract.includes('/ecosystem/redeem-launch-token'),
  'SSO redeem must call OWeb centralized endpoint',
);
assert(
  redeem.includes('getOwebRedeemLaunchUrl') && redeem.includes('app_id: FF_APP_ID'),
  'SSO redeem server must POST launch_token and app_id to OWeb',
);
assert(
  !redeem.includes('ao_ecosystem_launch_tokens') && !redeem.includes('getSupabaseAdmin'),
  'SSO redeem must not use direct token table access or service-role client',
);

const isolationSql = readFileSync(
  resolve(root, 'supabase/migrations/20261018130000_ff_profiles_isolation.sql'),
  'utf8',
);
assert(isolationSql.includes('FORCE ROW LEVEL SECURITY'), 'ff migration must FORCE RLS');
assert(
  isolationSql.includes('(SELECT auth.uid()) = id'),
  'ff_profiles_self must compare auth.uid() to id',
);

if (failures.length) {
  console.error('smoke:satellite FAILED');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}

console.log('smoke:satellite OK');

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OWEB_REDEEM_LAUNCH_TOKEN_PATH,
  buildOwebRedeemLaunchUrl,
  mapRedeemErrorFromResponse,
} from '../lib/sso/redeem-contract.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('centralized redeem URL and app_id contract', () => {
  assert.equal(OWEB_REDEEM_LAUNCH_TOKEN_PATH, '/ecosystem/redeem-launch-token');
  assert.equal(
    buildOwebRedeemLaunchUrl('https://oweb.one/api/v1'),
    'https://oweb.one/api/v1/ecosystem/redeem-launch-token',
  );
  const constants = readFileSync(resolve(root, 'lib/ff/constants.js'), 'utf8');
  assert.match(constants, /FF_APP_ID = 'frameforge'/);
});

test('mapRedeemErrorFromResponse normalizes OWeb errors', () => {
  assert.equal(mapRedeemErrorFromResponse(400, 'expired_token'), 'launch_token_expired');
  assert.equal(mapRedeemErrorFromResponse(400, 'app_mismatch'), 'launch_token_wrong_app');
  assert.equal(mapRedeemErrorFromResponse(503, 'redeem_unreachable'), 'redeem_unreachable');
});

test('redeem implementation does not require service role env', () => {
  const src = readFileSync(resolve(root, 'lib/sso/redeem-launch-token.server.js'), 'utf8');
  assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(src, /getSupabaseAdmin/);
  assert.doesNotMatch(src, /ao_ecosystem_launch_tokens/);
  assert.match(src, /launch_token:\s*trimmed/);
  assert.match(src, /app_id:\s*FF_APP_ID/);
  assert.match(src, /cache:\s*['"]no-store['"]/);
  assert.match(src, /buildOwebRedeemLaunchUrl|getOwebRedeemLaunchUrl/);
});

test('satellite repo does not ship admin service-role client', () => {
  const files = ['lib/env.server.js', '.env.example', 'ENV_AUDIT.md'].map((f) =>
    readFileSync(resolve(root, f), 'utf8'),
  );
  for (const content of files) {
    assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY=/);
  }
});

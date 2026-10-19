import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('next rewrites editor API through authenticated backend proxy', () => {
  const cfg = readFileSync(resolve(root, 'next.config.mjs'), 'utf8');
  assert.match(cfg, /destination: '\/api\/backend\/:path'/);
  assert.doesNotMatch(cfg, /FRAMEFORGE_API_URL.*destination/);
});

test('backend proxy forwards workspace headers', () => {
  const src = readFileSync(resolve(root, 'lib/api/frameforge-proxy.server.js'), 'utf8');
  assert.match(src, /X-FF-Workspace-Id/);
  assert.match(src, /X-FF-Proxy-Secret/);
  assert.match(src, /api_unavailable/);
});

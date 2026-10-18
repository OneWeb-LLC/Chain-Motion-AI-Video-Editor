import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultWorkspaceId, isPlatformWorkspace } from '../lib/workspace/platform-workspace.js';

test('pickDefaultWorkspaceId prefers non-platform workspace', () => {
  const workspaces = [
    { id: 'plat', kind: 'platform', slug: 'oweb-platform', name: 'OWeb Platform' },
    { id: 'personal', kind: 'personal', slug: 'me', name: 'Me' },
  ];
  assert.equal(pickDefaultWorkspaceId(workspaces), 'personal');
  assert.equal(isPlatformWorkspace(workspaces[0]), true);
});

test('pickDefaultWorkspaceId honors explicit member id', () => {
  const workspaces = [
    { id: 'a', kind: 'team', slug: 'a', name: 'A' },
    { id: 'b', kind: 'team', slug: 'b', name: 'B' },
  ];
  assert.equal(pickDefaultWorkspaceId(workspaces, 'b'), 'b');
});

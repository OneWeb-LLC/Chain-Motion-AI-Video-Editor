export const PLATFORM_WORKSPACE_SLUG = 'oweb-platform';
export const PLATFORM_WORKSPACE_ID = 'b4dcf6b5-84be-49cb-a370-8d38082a5d3d';

export function isPlatformWorkspace(workspace) {
  if (!workspace) return false;
  if (workspace.id === PLATFORM_WORKSPACE_ID) return true;
  if (workspace.slug === PLATFORM_WORKSPACE_SLUG) return true;
  if (workspace.name === 'OWeb Platform') return true;
  if (workspace.kind === 'platform') return true;
  return false;
}

export function pickDefaultWorkspace(workspaces) {
  if (!workspaces?.length) return null;
  return workspaces.find((w) => !isPlatformWorkspace(w)) ?? workspaces[0];
}

export function pickDefaultWorkspaceId(workspaces, explicitId) {
  if (!workspaces?.length) return null;
  if (explicitId && workspaces.some((w) => w.id === explicitId)) return explicitId;
  return pickDefaultWorkspace(workspaces)?.id ?? null;
}

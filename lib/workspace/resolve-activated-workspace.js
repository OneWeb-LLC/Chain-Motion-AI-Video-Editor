import { pickDefaultWorkspaceId } from '@/lib/workspace/platform-workspace';

export const WORKSPACE_ACTIVATED_KINDS = [
  'personal_bootstrap',
  'created',
  'sign_in',
  'sso_launch',
  'invite_accept',
  'provisioned',
];

/**
 * Resolve workspace context (D15): prefer requested if activated, else personal, else default member workspace.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function resolveActivatedWorkspaceContext(supabase, {
  userId,
  requestedWorkspaceId,
  memberWorkspaces,
}) {
  if (!memberWorkspaces?.length) {
    return { workspaceId: null, fallbackUsed: false };
  }

  const { data, error } = await supabase
    .from('one_id_workspace_activations')
    .select('workspace_id')
    .eq('user_id', userId)
    .in('activation_kind', WORKSPACE_ACTIVATED_KINDS);

  if (error) {
    console.warn('[frameforge] workspace activations lookup failed', error.message);
  }

  const activated = new Set((data ?? []).map((row) => row.workspace_id));
  const memberIds = new Set(memberWorkspaces.map((w) => w.id));

  if (
    requestedWorkspaceId &&
    memberIds.has(requestedWorkspaceId) &&
    activated.has(requestedWorkspaceId)
  ) {
    return { workspaceId: requestedWorkspaceId, fallbackUsed: false };
  }

  const activatedMembers = memberWorkspaces.filter((w) => activated.has(w.id));
  if (activatedMembers.length) {
    const personal = activatedMembers.find((w) => w.kind === 'personal');
    const fallbackId =
      personal?.id ?? pickDefaultWorkspaceId(activatedMembers, null);
    return {
      workspaceId: fallbackId,
      fallbackUsed: Boolean(
        requestedWorkspaceId && requestedWorkspaceId !== fallbackId,
      ),
    };
  }

  const defaultId = pickDefaultWorkspaceId(memberWorkspaces, null);
  return {
    workspaceId: defaultId,
    fallbackUsed: Boolean(requestedWorkspaceId && requestedWorkspaceId !== defaultId),
  };
}

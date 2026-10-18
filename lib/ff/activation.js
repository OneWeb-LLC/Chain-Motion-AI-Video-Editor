import { FF_APP_ID, getOwebPlatformApiUrl } from '@/lib/ff/constants';

/**
 * Record app activation via OWeb control-plane API (preferred contract).
 * Falls back to direct RPC on the shared One OS project when the API is unreachable.
 */
export async function activateFrameforgeApp(supabase, userId, accessToken, activationKind) {
  const kind = activationKind ?? 'sign_in';

  if (accessToken) {
    try {
      const res = await fetch(`${getOwebPlatformApiUrl()}/oneid/activate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ app_id: FF_APP_ID, activation_kind: kind }),
      });
      if (res.ok) return;
      if (res.status !== 404) {
        console.warn('[frameforge] OWeb app activation HTTP failed', res.status);
      }
    } catch (err) {
      console.warn('[frameforge] OWeb app activation HTTP error', err?.message ?? err);
    }
  }

  const { error } = await supabase.rpc('ao_upsert_app_activation', {
    p_app_id: FF_APP_ID,
    p_user_id: userId,
    p_activation_kind: kind,
  });
  if (error) console.warn('[frameforge] app activation RPC failed', error.message);
}

export async function activateFrameforgeWorkspace(
  supabase,
  userId,
  workspaceId,
  accessToken,
  activationKind,
) {
  const kind = activationKind ?? 'sign_in';

  if (accessToken) {
    try {
      const res = await fetch(`${getOwebPlatformApiUrl()}/oneid/activate-workspace`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspace_id: workspaceId, activation_kind: kind }),
      });
      if (res.ok) return;
      if (res.status !== 404) {
        console.warn('[frameforge] OWeb workspace activation HTTP failed', res.status);
      }
    } catch (err) {
      console.warn('[frameforge] OWeb workspace activation HTTP error', err?.message ?? err);
    }
  }

  const { error } = await supabase.rpc('ao_upsert_workspace_activation', {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_activation_kind: kind,
  });
  if (error) console.warn('[frameforge] workspace activation RPC failed', error.message);
}

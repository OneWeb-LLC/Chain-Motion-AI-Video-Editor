/** @typedef {{ id: string; name: string; slug: string; kind?: string | null }} WorkspaceSummary */

/** OWeb workspaces (`ao_orgs`) the user belongs to. */
export async function fetchMyWorkspaces(supabase, userId) {
  const { data: memberships, error: memberErr } = await supabase
    .from('ao_org_members')
    .select('org_id')
    .eq('user_id', userId)
    .is('left_at', null);

  if (memberErr) {
    console.warn('[frameforge] workspace memberships failed', memberErr.message);
    return [];
  }

  const orgIds = (memberships ?? [])
    .map((m) => m.org_id)
    .filter((id) => Boolean(id));

  if (!orgIds.length) return [];

  const { data: orgs, error: orgErr } = await supabase
    .from('ao_orgs')
    .select('id, name, slug, kind')
    .in('id', orgIds)
    .order('name');

  if (orgErr) {
    console.warn('[frameforge] workspace orgs failed', orgErr.message);
    return [];
  }

  return (orgs ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    kind: o.kind,
  }));
}

export async function ensurePersonalWorkspace(supabase, userId, displayName) {
  const { data, error } = await supabase.rpc('ao_ensure_personal_workspace', {
    _uid: userId,
    _display_name: displayName,
  });

  if (error) {
    console.warn('[frameforge] personal workspace ensure failed', error.message);
    return null;
  }

  if (typeof data === 'string' && data.length > 0) return data;
  return null;
}

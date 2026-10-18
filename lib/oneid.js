/** Read OneID handle from Supabase Auth user metadata. */
export function oneIdFromUserMetadata(user) {
  const raw = user?.user_metadata?.one_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Format handle for UI. */
export function formatOneId(handle) {
  if (!handle) return null;
  const normalized = handle.replace(/^@/, '').toLowerCase();
  return normalized ? `@${normalized}` : null;
}

/** Read canonical OneID handle from `one_id_profiles`. */
export async function fetchOneIdHandle(supabase, userId) {
  const { data, error } = await supabase
    .from('one_id_profiles')
    .select('one_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[frameforge] one_id lookup failed', error.message);
    return null;
  }

  return data?.one_id ?? null;
}

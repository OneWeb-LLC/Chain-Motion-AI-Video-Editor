import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_AUTH_STORAGE_KEY } from '@/lib/ff/constants';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env.server';

export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || getSupabaseUrl();
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    getSupabaseAnonKey();

  if (!url || !key) {
    throw new Error(
      'Missing Supabase public env: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* set from Server Component — middleware will refresh session */
        }
      },
    },
    auth: {
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
  });
}

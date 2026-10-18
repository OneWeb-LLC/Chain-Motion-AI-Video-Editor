import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { isAuthRequired, SUPABASE_AUTH_STORAGE_KEY } from '@/lib/ff/constants';

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
    auth: {
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicAuth = pathname === '/login' || pathname === '/sso';
  const isStudio = pathname === '/studio' || pathname.startsWith('/studio/');

  if (isAuthRequired() && isStudio && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === '/login') {
    const next = request.nextUrl.searchParams.get('next') || '/studio';
    const dest = request.nextUrl.clone();
    dest.pathname = next.startsWith('/') ? next : '/studio';
    dest.search = '';
    return NextResponse.redirect(dest);
  }

  if (isPublicAuth && !user) {
    return supabaseResponse;
  }

  return supabaseResponse;
}

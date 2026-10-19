import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/studio/:path*',
    '/login',
    '/sso',
    '/static/index.html',
    '/static/set-studio.html',
    '/api/backend/:path*',
  ],
};

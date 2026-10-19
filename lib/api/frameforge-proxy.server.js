import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAuthRequired } from '@/lib/ff/constants';
import { readRequestedWorkspaceId } from '@/lib/workspace/session.server';
import { establishProductSession } from '@/lib/workspace/session.server';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export function backendBase() {
  const raw = process.env.FRAMEFORGE_API_URL;
  return raw ? raw.replace(/\/$/, '') : null;
}

export async function backendFetch(path, { user, workspaceId, method = 'GET', body, headers = {} } = {}) {
  const backend = backendBase();
  if (!backend) {
    return null;
  }
  const target = new URL(path.startsWith('/') ? path : `/${path}`, `${backend}/`);
  const reqHeaders = forwardHeaders(
    { headers: { get: (k) => headers[k] ?? null } },
    { user, workspaceId },
  );
  return fetch(target, {
    method,
    headers: reqHeaders,
    body,
    redirect: 'manual',
  });
}

function apiUnavailable() {
  return NextResponse.json(
    {
      detail:
        'Frameforge editor API is not configured. Set FRAMEFORGE_API_URL to a reachable run.py service.',
      code: 'api_unavailable',
    },
    { status: 503 },
  );
}

async function resolveSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, workspaceId: null, accessToken: null };
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const ctx = await establishProductSession(supabase, user, {
    accessToken: session?.access_token ?? null,
    activationKind: 'sign_in',
    persistCookie: false,
    requestedWorkspaceId: await readRequestedWorkspaceId(),
  });
  return {
    supabase,
    user,
    workspaceId: ctx.workspaceId,
    accessToken: session?.access_token ?? null,
  };
}

function forwardHeaders(request, { user, workspaceId }) {
  const headers = new Headers();
  const secret = process.env.FRAMEFORGE_PROXY_SECRET;
  if (secret) {
    headers.set('X-FF-Proxy-Secret', secret);
  }
  headers.set('X-FF-User-Id', user.id);
  if (workspaceId) {
    headers.set('X-FF-Workspace-Id', workspaceId);
  }
  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  const range = request.headers.get('range');
  if (range) {
    headers.set('Range', range);
  }
  return headers;
}

function responseHeaders(upstream) {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  return headers;
}

/** Proxy /api/* to the Python Frameforge service with OneID workspace context. */
export async function proxyFrameforgeApi(request, pathSegments) {
  const backend = backendBase();
  if (!backend) {
    return apiUnavailable();
  }

  if (isAuthRequired()) {
    const { user, workspaceId } = await resolveSession();
    if (!user) {
      return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
    }
    if (!workspaceId) {
      return NextResponse.json(
        { detail: 'No activated workspace context for this session', code: 'workspace_required' },
        { status: 403 },
      );
    }

    const path = pathSegments?.length ? pathSegments.join('/') : '';
    const target = new URL(`/api/${path}`, `${backend}/`);
    target.search = request.nextUrl.search;

    const method = request.method;
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const body = hasBody ? await request.arrayBuffer() : undefined;

    const upstream = await fetch(target, {
      method,
      headers: forwardHeaders(request, { user, workspaceId }),
      body,
      redirect: 'manual',
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream),
    });
  }

  const path = pathSegments?.length ? pathSegments.join('/') : '';
  const target = new URL(`/api/${path}`, `${backend}/`);
  target.search = request.nextUrl.search;
  const upstream = await fetch(target, {
    method: request.method,
    headers: forwardHeaders(request, { user: { id: 'local' }, workspaceId: 'local' }),
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer(),
    redirect: 'manual',
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders(upstream),
  });
}

export function isFrameforgeApiConfigured() {
  return Boolean(backendBase());
}

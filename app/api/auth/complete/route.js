import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { establishProductSession } from '@/lib/workspace/session.server';

/** Post-login hook: workspace resolution, activation, profile projection (server-side). */
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const activationKind =
    typeof body.activation_kind === 'string' ? body.activation_kind : 'sign_in';
  const requestedWorkspaceId =
    typeof body.workspace_id === 'string' ? body.workspace_id : null;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const ctx = await establishProductSession(supabase, user, {
    accessToken: session?.access_token ?? null,
    activationKind,
    requestedWorkspaceId,
  });

  return NextResponse.json({
    ok: true,
    workspace_id: ctx.workspaceId,
    fallback_used: ctx.fallbackUsed,
  });
}

import { redirect } from 'next/navigation';
import { isAuthRequired } from '@/lib/ff/constants';
import { formatOneId, fetchOneIdHandle, oneIdFromUserMetadata } from '@/lib/oneid';
import { createClient } from '@/lib/supabase/server';
import { establishProductSession } from '@/lib/workspace/session.server';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Studio — Frameforge',
};

export default async function StudioPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    if (isAuthRequired()) redirect('/login?next=/studio');
    redirect('/static/index.html');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isAuthRequired() && !user) {
    redirect('/login?next=/studio');
  }

  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await establishProductSession(supabase, user, {
      accessToken: session?.access_token ?? null,
      activationKind: 'sign_in',
      persistCookie: false,
    });
    const handle =
      oneIdFromUserMetadata(user) ?? (await fetchOneIdHandle(supabase, user.id));
    void formatOneId(handle);
  }

  redirect('/static/index.html');
}

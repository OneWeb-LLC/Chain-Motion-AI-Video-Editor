-- Frameforge satellite (app_id=frameforge) on shared One OS
-- Local profile projection only: id = auth.users.id, self-only RLS.

DROP FUNCTION IF EXISTS public.ff_is_workspace_member(UUID);

CREATE TABLE IF NOT EXISTS public.ff_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  one_id TEXT,
  display_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ff_profiles FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ff_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.ff_profiles FROM anon;
REVOKE ALL ON TABLE public.ff_profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ff_profiles TO authenticated;
GRANT ALL ON TABLE public.ff_profiles TO service_role;

DROP POLICY IF EXISTS ff_profiles_self ON public.ff_profiles;
CREATE POLICY ff_profiles_self ON public.ff_profiles
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

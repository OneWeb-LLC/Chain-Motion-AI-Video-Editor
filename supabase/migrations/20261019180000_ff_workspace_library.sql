-- Workspace library exports (oDrive-compatible metadata; blobs in storage)

CREATE TABLE IF NOT EXISTS public.ff_workspace_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  byte_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ff_workspace_exports_workspace_idx
  ON public.ff_workspace_exports (workspace_id, created_at DESC);

ALTER TABLE public.ff_workspace_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ff_workspace_exports FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ff_workspace_exports FROM PUBLIC;
REVOKE ALL ON TABLE public.ff_workspace_exports FROM anon;
GRANT SELECT, INSERT ON TABLE public.ff_workspace_exports TO authenticated;
GRANT ALL ON TABLE public.ff_workspace_exports TO service_role;

DROP POLICY IF EXISTS ff_workspace_exports_self ON public.ff_workspace_exports;
CREATE POLICY ff_workspace_exports_self ON public.ff_workspace_exports
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ff-workspace-library',
  'ff-workspace-library',
  false,
  524288000,
  ARRAY['video/mp4', 'application/zip', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS ff_workspace_library_read ON storage.objects;
CREATE POLICY ff_workspace_library_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ff-workspace-library'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS ff_workspace_library_insert ON storage.objects;
CREATE POLICY ff_workspace_library_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ff-workspace-library'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

import { createClient } from '@/lib/supabase/server';
import { backendFetch } from '@/lib/api/frameforge-proxy.server';
import {
  establishProductSession,
  readRequestedWorkspaceId,
} from '@/lib/workspace/session.server';

const BUCKET = 'ff-workspace-library';

export async function publishExportJob({ jobId, projectId, name }) {
  if (!jobId || !projectId) {
    throw new Error('job_id and project_id are required');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: 401, body: { error: 'unauthorized' } };
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
  const workspaceId = ctx.workspaceId;
  if (!workspaceId) {
    return { status: 403, body: { error: 'workspace_required' } };
  }

  const stateRes = await backendFetch('/api/state', { user, workspaceId, method: 'GET' });
  if (!stateRes?.ok) {
    return { status: 503, body: { error: 'editor_api_unavailable' } };
  }
  const state = await stateRes.json();
  const job = (state.jobs || []).find((j) => j.id === jobId);
  if (!job || job.status !== 'completed' || !job.download) {
    return { status: 400, body: { error: 'export_not_ready' } };
  }

  const fileRes = await backendFetch(job.download, { user, workspaceId, method: 'GET' });
  if (!fileRes.ok) {
    return { status: 502, body: { error: 'export_download_failed' } };
  }

  const bytes = Buffer.from(await fileRes.arrayBuffer());
  const safeName = (name || job.name || 'export')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 120);
  const ext = job.download.endsWith('.zip') ? '.zip' : '.mp4';
  const fileName = safeName.endsWith(ext) ? safeName : `${safeName}${ext}`;
  const storagePath = `${user.id}/${workspaceId}/${jobId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: ext === '.zip' ? 'application/zip' : 'video/mp4',
      upsert: true,
    });
  if (uploadError) {
    return { status: 500, body: { error: 'storage_upload_failed', detail: uploadError.message } };
  }

  const { data: row, error: insertError } = await supabase
    .from('ff_workspace_exports')
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      project_id: projectId,
      job_id: jobId,
      storage_path: storagePath,
      file_name: fileName,
      byte_size: bytes.length,
    })
    .select('id, storage_path, file_name, byte_size, created_at')
    .single();

  if (insertError) {
    return { status: 500, body: { error: 'metadata_insert_failed', detail: insertError.message } };
  }

  return { status: 200, body: { ok: true, export: row } };
}

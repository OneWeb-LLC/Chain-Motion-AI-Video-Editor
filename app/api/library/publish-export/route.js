import { NextResponse } from 'next/server';
import { publishExportJob } from '@/lib/ff/library-export.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const result = await publishExportJob({
    jobId: typeof body.job_id === 'string' ? body.job_id : null,
    projectId: typeof body.project_id === 'string' ? body.project_id : null,
    name: typeof body.name === 'string' ? body.name : null,
  });
  return NextResponse.json(result.body, { status: result.status });
}

import { NextResponse } from 'next/server';
import { FF_APP_ID, getAppPublicUrl, isAuthRequired } from '@/lib/ff/constants';
import { isFrameforgeApiConfigured } from '@/lib/api/frameforge-proxy.server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    app_id: FF_APP_ID,
    mode: 'satellite',
    auth_required: isAuthRequired(),
    api_configured: isFrameforgeApiConfigured(),
    app_url: getAppPublicUrl(),
  });
}

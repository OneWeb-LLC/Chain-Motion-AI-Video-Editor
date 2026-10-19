import { proxyFrameforgeApi } from '@/lib/api/frameforge-proxy.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request, context) {
  const { path } = await context.params;
  return proxyFrameforgeApi(request, path ?? []);
}

export async function GET(request, context) {
  return handle(request, context);
}

export async function POST(request, context) {
  return handle(request, context);
}

export async function PUT(request, context) {
  return handle(request, context);
}

export async function PATCH(request, context) {
  return handle(request, context);
}

export async function DELETE(request, context) {
  return handle(request, context);
}

export async function HEAD(request, context) {
  return handle(request, context);
}

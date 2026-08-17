// app/api/streams/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { removeStream, updateViewerCount } from '@/lib/store';
import { UpdateStreamPayload } from '@/lib/types';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  removeStream(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Partial<UpdateStreamPayload>;

  if (typeof body.viewerCount !== 'number') {
    return NextResponse.json({ error: 'viewerCount must be a number' }, { status: 400 });
  }

  const ok = updateViewerCount(id, body.viewerCount);
  if (!ok) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
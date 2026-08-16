// app/api/streams/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { removeStream } from '@/lib/store';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  removeStream(id);
  return NextResponse.json({ ok: true });
}
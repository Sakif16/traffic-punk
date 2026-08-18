// app/api/streams/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { addStream, listStreams } from '@/lib/store';
import { CreateStreamPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({ streams: listStreams() });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<CreateStreamPayload>;
  const { id, peerId, place, district, country } = body;

  if (!id || !peerId || !place || !district || !country) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  addStream({
    id,
    peerId,
    place,
    district,
    country,
    createdAt: Date.now(),
  });

  return NextResponse.json({ ok: true });
}
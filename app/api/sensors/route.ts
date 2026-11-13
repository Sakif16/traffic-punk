// app/api/sensors/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getLatestReading, saveReading, SENSOR_STALE_MS } from '@/lib/sensorStore';
import { SensorPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function keyMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Latest reading plus its age, for the website.
export async function GET() {
  const reading = getLatestReading();
  const ageMs = reading ? Date.now() - reading.receivedAt : null;

  return NextResponse.json(
    {
      reading: reading ?? null,
      ageMs,
      online: ageMs !== null && ageMs <= SENSOR_STALE_MS,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

// Called by the ESP32. Requires the x-api-key header.
export async function POST(request: NextRequest) {
  const expectedKey = process.env.SENSOR_API_KEY;
  if (!expectedKey) {
    return NextResponse.json({ error: 'SENSOR_API_KEY is not configured' }, { status: 500 });
  }

  if (!keyMatches(request.headers.get('x-api-key'), expectedKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Partial<SensorPayload>;
  try {
    body = (await request.json()) as Partial<SensorPayload>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { temperature, humidity } = body;
  if (
    typeof temperature !== 'number' ||
    typeof humidity !== 'number' ||
    !Number.isFinite(temperature) ||
    !Number.isFinite(humidity) ||
    temperature < -40 ||
    temperature > 80 ||
    humidity < 0 ||
    humidity > 100
  ) {
    return NextResponse.json({ error: 'Invalid temperature or humidity' }, { status: 400 });
  }

  const sensorId =
    typeof body.sensorId === 'string' && body.sensorId.trim()
      ? body.sensorId.trim().slice(0, 40)
      : 'default';

  saveReading({ sensorId, temperature, humidity, receivedAt: Date.now() });

  return NextResponse.json({ ok: true });
}
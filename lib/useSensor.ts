// lib/useSensor.ts
'use client';

import { useEffect, useState } from 'react';
import type { SensorReading } from './types';

export interface SensorState {
  loaded: boolean;
  online: boolean;
  reading: SensorReading | null;
  ageMs: number | null;
}

const POLL_MS = 5000;

// Polls the latest shared sensor reading.
export function useSensor(): SensorState {
  const [state, setState] = useState<SensorState>({
    loaded: false,
    online: false,
    reading: null,
    ageMs: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/sensors', { cache: 'no-store' });
        const data: { reading: SensorReading | null; ageMs: number | null; online: boolean } =
          await res.json();
        if (!cancelled) {
          setState({ loaded: true, online: data.online, reading: data.reading, ageMs: data.ageMs });
        }
      } catch {
        // Keep the previous state on transient errors.
      }
    }

    const timeout = setTimeout(load, 0);
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  return state;
}
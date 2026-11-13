// lib/sensorStore.ts
import { SensorReading } from './types';

declare global {
  var __sensors: Map<string, SensorReading> | undefined;
}

if (!globalThis.__sensors) {
  globalThis.__sensors = new Map<string, SensorReading>();
}

const sensors: Map<string, SensorReading> = globalThis.__sensors;

// A reading older than this is treated as "sensor offline".
export const SENSOR_STALE_MS = 60_000;

export function saveReading(reading: SensorReading): void {
  sensors.set(reading.sensorId, reading);
}

// Most recent reading across all sensors (all streams share it for now).
export function getLatestReading(): SensorReading | undefined {
  let latest: SensorReading | undefined;
  for (const reading of sensors.values()) {
    if (!latest || reading.receivedAt > latest.receivedAt) latest = reading;
  }
  return latest;
}
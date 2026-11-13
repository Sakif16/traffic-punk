// lib/climate.ts

export type ComfortLevel = 'Comfortable' | 'Warm' | 'Hot' | 'Very hot' | 'Extreme';

// Heat index ("feels like") in °C, using the NWS Rothfusz regression.
export function heatIndexC(tempC: number, humidity: number): number {
  const t = tempC * 1.8 + 32;
  const r = humidity;

  // Simple formula first; the full regression only applies in hot conditions.
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + r * 0.094);
  const avg = (simple + t) / 2;
  if (avg < 80) return tempC;

  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * r -
    0.22475541 * t * r -
    0.00683783 * t * t -
    0.05481717 * r * r +
    0.00122874 * t * t * r +
    0.00085282 * t * r * r -
    0.00000199 * t * t * r * r;

  if (r < 13 && t >= 80 && t <= 112) {
    hi -= ((13 - r) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  } else if (r > 85 && t >= 80 && t <= 87) {
    hi += ((r - 85) / 10) * ((87 - t) / 5);
  }

  return (hi - 32) / 1.8;
}

export function comfortFrom(heatIndex: number): ComfortLevel {
  if (heatIndex < 27) return 'Comfortable';
  if (heatIndex < 32) return 'Warm';
  if (heatIndex < 41) return 'Hot';
  if (heatIndex < 54) return 'Very hot';
  return 'Extreme';
}

export const COMFORT_STYLES: Record<ComfortLevel, string> = {
  Comfortable: 'bg-green-600/20 text-green-400 border-green-700',
  Warm: 'bg-yellow-600/20 text-yellow-400 border-yellow-700',
  Hot: 'bg-orange-600/20 text-orange-400 border-orange-700',
  'Very hot': 'bg-red-600/20 text-red-400 border-red-700',
  Extreme: 'bg-red-800/30 text-red-300 border-red-800',
};
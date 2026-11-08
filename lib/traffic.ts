// lib/traffic.ts

export interface Detection {
  x1: number; // normalised 0..1, relative to the video frame
  y1: number;
  x2: number;
  y2: number;
  score: number;
  classId: number;
}

export type TrafficLevel = 'Light' | 'Medium' | 'Heavy';

// ---- Tuning knobs (change these after testing on your real junctions) ----

// Ignore detections below this confidence.
export const CONFIDENCE_THRESHOLD = 0.35;

// Weighted score at or above which traffic counts as Medium / Heavy.
export const MEDIUM_FROM = 4;
export const HEAVY_FROM = 10;

// How long (ms) the displayed numbers are averaged over.
const WINDOW_MS = 3000;
// How long (ms) a new traffic level must hold before the label changes.
const LEVEL_HOLD_MS = 2000;

// COCO class IDs for vehicles, with a "size weight" for the density score.
export const VEHICLE_CLASSES: Record<number, { label: string; weight: number }> = {
  1: { label: 'bicycle', weight: 0.5 },
  2: { label: 'car', weight: 1 },
  3: { label: 'motorcycle', weight: 0.5 },
  5: { label: 'bus', weight: 2.5 },
  7: { label: 'truck', weight: 2.5 },
};

export interface FrameSummary {
  vehicles: Detection[];
  total: number;
  score: number;
  counts: Record<string, number>;
}

export function summarize(detections: Detection[]): FrameSummary {
  const vehicles: Detection[] = [];
  const counts: Record<string, number> = {};
  let score = 0;

  for (const d of detections) {
    const cls = VEHICLE_CLASSES[d.classId];
    if (!cls || d.score < CONFIDENCE_THRESHOLD) continue;
    vehicles.push(d);
    counts[cls.label] = (counts[cls.label] ?? 0) + 1;
    score += cls.weight;
  }

  return { vehicles, total: vehicles.length, score, counts };
}

export function levelFromScore(score: number): TrafficLevel {
  if (score >= HEAVY_FROM) return 'Heavy';
  if (score >= MEDIUM_FROM) return 'Medium';
  return 'Light';
}

export interface SmoothedTraffic {
  total: number;
  score: number;
  counts: Record<string, number>;
  level: TrafficLevel;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface Sample {
  t: number;
  summary: FrameSummary;
}

// Smooths per-frame results so the numbers and label don't flicker.
export class TrafficSmoother {
  private samples: Sample[] = [];
  private level: TrafficLevel | null = null;
  private candidate: TrafficLevel | null = null;
  private candidateSince = 0;

  push(summary: FrameSummary, now: number): SmoothedTraffic {
    this.samples.push({ t: now, summary });
    this.samples = this.samples.filter((s) => now - s.t <= WINDOW_MS);

    const total = Math.round(median(this.samples.map((s) => s.summary.total)));
    const score = median(this.samples.map((s) => s.summary.score));

    const labels = new Set<string>();
    this.samples.forEach((s) => Object.keys(s.summary.counts).forEach((l) => labels.add(l)));
    const counts: Record<string, number> = {};
    labels.forEach((label) => {
      const n = Math.round(median(this.samples.map((s) => s.summary.counts[label] ?? 0)));
      if (n > 0) counts[label] = n;
    });

    const raw = levelFromScore(score);
    if (this.level === null) {
      this.level = raw;
    } else if (raw === this.level) {
      this.candidate = null;
    } else if (this.candidate !== raw) {
      this.candidate = raw;
      this.candidateSince = now;
    } else if (now - this.candidateSince >= LEVEL_HOLD_MS) {
      this.level = raw;
      this.candidate = null;
    }

    return { total, score, counts, level: this.level };
  }
}
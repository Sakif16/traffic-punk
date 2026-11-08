// lib/traffic.ts

export interface Detection {
  x1: number; // normalised 0..1 relative to the video frame
  y1: number;
  x2: number;
  y2: number;
  score: number;
  classId: number;
}

export interface TrackedVehicle extends Detection {
  id: number;
  stationary: boolean;
}

export type TrafficLevel = 'Light' | 'Medium' | 'Heavy';

// Minimum detection confidence.
export const CONFIDENCE_THRESHOLD = 0.25;

// Weighted score thresholds for Medium / Heavy.
export const MEDIUM_FROM = 4;
export const HEAVY_FROM = 10;

// Heavy when enough vehicles are stopped and they are a large share of all vehicles.
export const MIN_STATIONARY_FOR_HEAVY = 2;
export const STATIONARY_SHARE_FOR_HEAVY = 0.5;

// Time a box must stay in place to count as stopped (ms).
const STATIONARY_AFTER_MS = 2500;
// Allowed movement as a fraction of box size.
const MOVE_RATIO = 0.2;
// Minimum allowed movement as a fraction of the frame (absorbs box jitter).
const MIN_MOVE = 0.008;
// Minimum overlap to continue an existing track.
const MATCH_IOU = 0.3;
// Time a track survives without a detection (ms).
const MAX_MISSING_MS = 1500;

// Averaging window for displayed numbers (ms).
const WINDOW_MS = 4000;
// Time a new level must hold before the label changes (ms).
const LEVEL_HOLD_MS = 2000;

// COCO vehicle classes with density weights.
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

// Keeps vehicle detections only and computes per-frame counts and density score.
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

// Traffic level from density score, with a standstill override to Heavy.
export function levelFrom(score: number, total: number, stationary: number): TrafficLevel {
  let level: TrafficLevel = 'Light';
  if (score >= HEAVY_FROM) level = 'Heavy';
  else if (score >= MEDIUM_FROM) level = 'Medium';

  if (
    total > 0 &&
    stationary >= MIN_STATIONARY_FOR_HEAVY &&
    stationary / total >= STATIONARY_SHARE_FOR_HEAVY
  ) {
    level = 'Heavy';
  }

  return level;
}

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

interface Track {
  id: number;
  det: Detection;
  history: { t: number; cx: number; cy: number }[];
  firstSeen: number;
  lastSeen: number;
  stationary: boolean;
}

// Tracks vehicles across frames and flags the ones that are not moving.
export class VehicleTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  update(vehicles: Detection[], now: number): TrackedVehicle[] {
    // Greedy matching by highest overlap.
    const pairs: { ti: number; di: number; iou: number }[] = [];
    this.tracks.forEach((track, ti) => {
      vehicles.forEach((d, di) => {
        const overlap = iou(track.det, d);
        if (overlap >= MATCH_IOU) pairs.push({ ti, di, iou: overlap });
      });
    });
    pairs.sort((a, b) => b.iou - a.iou);

    const usedTracks = new Set<number>();
    const assigned = new Map<number, Track>();
    for (const p of pairs) {
      if (usedTracks.has(p.ti) || assigned.has(p.di)) continue;
      usedTracks.add(p.ti);
      assigned.set(p.di, this.tracks[p.ti]);
    }

    const result: TrackedVehicle[] = [];
    vehicles.forEach((d, di) => {
      let track = assigned.get(di);
      if (!track) {
        track = {
          id: this.nextId++,
          det: d,
          history: [],
          firstSeen: now,
          lastSeen: now,
          stationary: false,
        };
        this.tracks.push(track);
      }

      track.det = d;
      track.lastSeen = now;
      track.history.push({ t: now, cx: (d.x1 + d.x2) / 2, cy: (d.y1 + d.y2) / 2 });
      track.history = track.history.filter((h) => now - h.t <= STATIONARY_AFTER_MS + 1000);
      track.stationary = this.isStationary(track, now);

      result.push({ ...d, id: track.id, stationary: track.stationary });
    });

    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= MAX_MISSING_MS);

    return result;
  }

  private isStationary(track: Track, now: number): boolean {
    if (now - track.firstSeen < STATIONARY_AFTER_MS) return false;

    const recent = track.history.filter((h) => now - h.t <= STATIONARY_AFTER_MS);
    if (recent.length < 3) return false;

    const w = track.det.x2 - track.det.x1;
    const h = track.det.y2 - track.det.y1;
    const allowX = Math.max(w * MOVE_RATIO, MIN_MOVE);
    const allowY = Math.max(h * MOVE_RATIO, MIN_MOVE);
    const cx = (track.det.x1 + track.det.x2) / 2;
    const cy = (track.det.y1 + track.det.y2) / 2;

    return recent.every((p) => Math.abs(p.cx - cx) <= allowX && Math.abs(p.cy - cy) <= allowY);
  }
}

export interface SmoothedTraffic {
  total: number;
  score: number;
  stationary: number;
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
  stationary: number;
}

// Rolling median over recent frames, with a hold time before the level changes.
export class TrafficSmoother {
  private samples: Sample[] = [];
  private level: TrafficLevel | null = null;
  private candidate: TrafficLevel | null = null;
  private candidateSince = 0;

  push(summary: FrameSummary, stationary: number, now: number): SmoothedTraffic {
    this.samples.push({ t: now, summary, stationary });
    this.samples = this.samples.filter((s) => now - s.t <= WINDOW_MS);

    const total = Math.round(median(this.samples.map((s) => s.summary.total)));
    const score = median(this.samples.map((s) => s.summary.score));
    const stationaryCount = Math.round(median(this.samples.map((s) => s.stationary)));

    const labels = new Set<string>();
    this.samples.forEach((s) => Object.keys(s.summary.counts).forEach((l) => labels.add(l)));
    const counts: Record<string, number> = {};
    labels.forEach((label) => {
      const n = Math.round(median(this.samples.map((s) => s.summary.counts[label] ?? 0)));
      if (n > 0) counts[label] = n;
    });

    const raw = levelFrom(score, total, stationaryCount);
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

    return { total, score, stationary: stationaryCount, counts, level: this.level };
  }
}
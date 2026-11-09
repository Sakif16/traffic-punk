// lib/useTrafficAnalysis.ts
'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  Detection,
  SmoothedTraffic,
  TrackedVehicle,
  TrafficSmoother,
  VEHICLE_CLASSES,
  VehicleTracker,
  summarize,
} from './traffic';

export type AnalysisState = 'loading' | 'running' | 'error';

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
  showBoxes: boolean;
}

const MODEL_URL = '/models/yolo26n.onnx';
const POLL_MS = 16;
const UI_UPDATE_MS = 400;

const MOVING_COLOR = '#22c55e';
const STOPPED_COLOR = '#f97316';

// Box easing time constant (ms). Lower = snappier, higher = smoother.
const EASE_MS = 60;
// Max time a box is extrapolated forward using its measured speed (ms).
const MAX_PREDICT_MS = 400;
// Time before a box that is no longer detected starts fading, and fade length (ms).
const FADE_DELAY_MS = 150;
const FADE_MS = 450;

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface DisplayBox {
  cur: Rect;
  target: Rect;
  vel: Rect; // normalised units per ms
  capturedAt: number;
  seenAt: number;
  classId: number;
  score: number;
  stationary: boolean;
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Draws boxes over the video, accounting for object-contain letterboxing.
function drawBoxes(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  boxes: DisplayBox[],
  now: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const scale = Math.min(cssW / vw, cssH / vh);
  const contentW = vw * scale;
  const contentH = vh * scale;
  const offsetX = (cssW - contentW) / 2;
  const offsetY = (cssH - contentH) / 2;

  ctx.lineWidth = 2;
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'top';

  for (const b of boxes) {
    const missing = now - b.seenAt;
    const alpha = missing <= FADE_DELAY_MS ? 1 : Math.max(0, 1 - (missing - FADE_DELAY_MS) / FADE_MS);
    if (alpha <= 0) continue;

    const color = b.stationary ? STOPPED_COLOR : MOVING_COLOR;
    const x = offsetX + b.cur.x1 * contentW;
    const y = offsetY + b.cur.y1 * contentH;
    const w = (b.cur.x2 - b.cur.x1) * contentW;
    const h = (b.cur.y2 - b.cur.y1) * contentH;

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    const name = VEHICLE_CLASSES[b.classId]?.label ?? 'vehicle';
    const label = `${name} ${Math.round(b.score * 100)}%${b.stationary ? ' - stopped' : ''}`;
    const textW = ctx.measureText(label).width + 6;
    const labelY = y >= 16 ? y - 16 : y;
    ctx.fillStyle = color;
    ctx.fillRect(x, labelY, textW, 16);
    ctx.fillStyle = '#000000';
    ctx.fillText(label, x + 3, labelY + 2);
  }
  ctx.globalAlpha = 1;
}

export function useTrafficAnalysis({ videoRef, canvasRef, enabled, showBoxes }: Options) {
  const [state, setState] = useState<AnalysisState>('loading');
  const [traffic, setTraffic] = useState<SmoothedTraffic | null>(null);
  const showBoxesRef = useRef(showBoxes);

  useEffect(() => {
    showBoxesRef.current = showBoxes;
    if (!showBoxes) clearCanvas(canvasRef.current);
  }, [showBoxes, canvasRef]);

  useEffect(() => {
    if (!enabled) return;

    const worker = new Worker('/yolo-worker.js', { type: 'module' });
    const smoother = new TrafficSmoother();
    const tracker = new VehicleTracker();
    const display = new Map<number, DisplayBox>();
    let cancelled = false;
    let ready = false;
    let busy = false;
    let lastSentAt = 0;
    let lastUiUpdate = 0;
    let lastFrameAt = performance.now();
    let rafId = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Updates box targets and speeds from a new detection result.
    function applyDetections(tracked: TrackedVehicle[], capturedAt: number, now: number) {
      for (const v of tracked) {
        const rect: Rect = { x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2 };
        const existing = display.get(v.id);

        if (!existing) {
          display.set(v.id, {
            cur: { ...rect },
            target: rect,
            vel: { x1: 0, y1: 0, x2: 0, y2: 0 },
            capturedAt,
            seenAt: now,
            classId: v.classId,
            score: v.score,
            stationary: v.stationary,
          });
          continue;
        }

        const dt = capturedAt - existing.capturedAt;
        if (dt > 30 && !v.stationary) {
          const blend = (prev: number, next: number, old: number) => 0.5 * old + 0.5 * ((next - prev) / dt);
          existing.vel = {
            x1: blend(existing.target.x1, rect.x1, existing.vel.x1),
            y1: blend(existing.target.y1, rect.y1, existing.vel.y1),
            x2: blend(existing.target.x2, rect.x2, existing.vel.x2),
            y2: blend(existing.target.y2, rect.y2, existing.vel.y2),
          };
        } else if (v.stationary) {
          existing.vel = { x1: 0, y1: 0, x2: 0, y2: 0 };
        }

        existing.target = rect;
        existing.capturedAt = capturedAt;
        existing.seenAt = now;
        existing.classId = v.classId;
        existing.score = v.score;
        existing.stationary = v.stationary;
      }
    }

    // Runs every display frame: eases boxes toward their predicted positions and draws them.
    function renderLoop(t: number) {
      if (cancelled) return;
      rafId = requestAnimationFrame(renderLoop);

      const dt = Math.min(100, t - lastFrameAt);
      lastFrameAt = t;
      const ease = 1 - Math.exp(-dt / EASE_MS);

      for (const [id, b] of display) {
        if (t - b.seenAt > FADE_DELAY_MS + FADE_MS) {
          display.delete(id);
          continue;
        }
        const elapsed = Math.min(MAX_PREDICT_MS, Math.max(0, t - b.capturedAt));
        b.cur.x1 += (b.target.x1 + b.vel.x1 * elapsed - b.cur.x1) * ease;
        b.cur.y1 += (b.target.y1 + b.vel.y1 * elapsed - b.cur.y1) * ease;
        b.cur.x2 += (b.target.x2 + b.vel.x2 * elapsed - b.cur.x2) * ease;
        b.cur.y2 += (b.target.y2 + b.vel.y2 * elapsed - b.cur.y2) * ease;
      }

      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      if (showBoxesRef.current) drawBoxes(canvas, video, Array.from(display.values()), t);
      else clearCanvas(canvas);
    }

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'ready') {
        ready = true;
        console.log('Detector backend:', msg.backend);
        setState('running');
        return;
      }

      if (msg.type === 'error') {
        console.error('Detector error:', msg.message);
        busy = false;
        if (msg.fatal) setState('error');
        return;
      }

      if (msg.type === 'result') {
        busy = false;
        if (cancelled) return;

        const summary = summarize(msg.detections as Detection[]);
        const now = performance.now();
        const tracked = tracker.update(summary.vehicles, now);
        const stationary = tracked.filter((v) => v.stationary).length;
        const smoothed = smoother.push(summary, stationary, now);

        applyDetections(tracked, lastSentAt, now);

        if (now - lastUiUpdate >= UI_UPDATE_MS) {
          lastUiUpdate = now;
          setTraffic(smoothed);
        }
      }
    };

    worker.onerror = (e) => {
      console.error('Worker failed:', e.message);
      setState('error');
    };

    worker.postMessage({ type: 'init', modelUrl: MODEL_URL });

    // Sends the next frame as soon as the worker is idle.
    async function tick() {
      if (cancelled) return;

      const video = videoRef.current;
      if (
        ready &&
        !busy &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        !document.hidden
      ) {
        busy = true;
        try {
          lastSentAt = performance.now();
          const bitmap = await createImageBitmap(video);
          worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
        } catch {
          busy = false;
        }
      }

      timer = setTimeout(tick, POLL_MS);
    }

    tick();
    rafId = requestAnimationFrame(renderLoop);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(rafId);
      worker.terminate();
      display.clear();
      clearCanvas(canvasRef.current);
      setTraffic(null);
    };
  }, [enabled, videoRef, canvasRef]);

  return { state, traffic };
}
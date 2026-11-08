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
const POLL_MS = 100;
const UI_UPDATE_MS = 400;

const MOVING_COLOR = '#22c55e';
const STOPPED_COLOR = '#f97316';

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Draws boxes over the video, accounting for object-contain letterboxing.
function drawDetections(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  vehicles: TrackedVehicle[]
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

  for (const d of vehicles) {
    const color = d.stationary ? STOPPED_COLOR : MOVING_COLOR;
    const x = offsetX + d.x1 * contentW;
    const y = offsetY + d.y1 * contentH;
    const w = (d.x2 - d.x1) * contentW;
    const h = (d.y2 - d.y1) * contentH;

    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    const name = VEHICLE_CLASSES[d.classId]?.label ?? 'vehicle';
    const label = `${name} ${Math.round(d.score * 100)}%${d.stationary ? ' - stopped' : ''}`;
    const textW = ctx.measureText(label).width + 6;
    const labelY = y >= 16 ? y - 16 : y;
    ctx.fillStyle = color;
    ctx.fillRect(x, labelY, textW, 16);
    ctx.fillStyle = '#000000';
    ctx.fillText(label, x + 3, labelY + 2);
  }
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
    let cancelled = false;
    let ready = false;
    let busy = false;
    let lastUiUpdate = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'ready') {
        ready = true;
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

        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (canvas && video) {
          if (showBoxesRef.current) drawDetections(canvas, video, tracked);
          else clearCanvas(canvas);
        }

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

    // Sends the next frame once the worker is idle.
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
          const bitmap = await createImageBitmap(video);
          worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
        } catch {
          busy = false;
        }
      }

      timer = setTimeout(tick, POLL_MS);
    }

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      worker.terminate();
      clearCanvas(canvasRef.current);
      setTraffic(null);
    };
  }, [enabled, videoRef, canvasRef]);

  return { state, traffic };
}
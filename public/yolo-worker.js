// YOLO26 inference worker: full-frame pass plus zoomed tiles for small vehicles.
import * as ort from '/ort/ort.wasm.min.mjs';

const SIZE = 640;
const MIN_SCORE = 0.2;
const PASS_IOU = 0.6;
const MERGE_IOU = 0.55;
const MAX_PER_PASS = 300;

// Set TILE_COUNT to 0 or 1 to disable tiling.
const TILE_COUNT = 3;
const TILE_FRACTION = 0.45;
const EDGE_EPS = 0.02;

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;

let session = null;
const canvas = new OffscreenCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const clamp = (v) => Math.min(1, Math.max(0, v));

async function init(modelUrl) {
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  // Warm-up run.
  const dummy = new ort.Tensor('float32', new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]);
  await session.run({ [session.inputNames[0]]: dummy });
}

function iou(a, b) {
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

// Per-class non-maximum suppression.
function nms(boxes, iouThreshold, limit) {
  boxes.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of boxes) {
    let keep = true;
    for (const k of kept) {
      if (k.classId === box.classId && iou(k, box) > iouThreshold) {
        keep = false;
        break;
      }
    }
    if (keep) {
      kept.push(box);
      if (kept.length >= limit) break;
    }
  }
  return kept;
}

// Decodes model output into 640x640 pixel boxes. Supports [1, 4+nc, N], [1, N, 4+nc] and [1, N, 6].
function decodeOutput(output) {
  const dims = output.dims;
  const d = output.data;
  const boxes = [];

  if (dims.length !== 3) {
    throw new Error('Unexpected model output shape: [' + dims.join(', ') + ']');
  }

  // End-to-end format: x1, y1, x2, y2, score, classId.
  if (dims[2] === 6) {
    for (let i = 0; i < dims[1]; i++) {
      const o = i * 6;
      const score = d[o + 4];
      if (score < MIN_SCORE) continue;
      boxes.push({
        x1: d[o],
        y1: d[o + 1],
        x2: d[o + 2],
        y2: d[o + 3],
        score,
        classId: Math.round(d[o + 5]),
      });
    }
    return boxes;
  }

  const channelsFirst = dims[1] < dims[2];
  const numChannels = channelsFirst ? dims[1] : dims[2];
  const numAnchors = channelsFirst ? dims[2] : dims[1];
  const numClasses = numChannels - 4;
  if (numClasses < 1) {
    throw new Error('Unexpected model output shape: [' + dims.join(', ') + ']');
  }

  const at = channelsFirst
    ? (anchor, channel) => d[channel * numAnchors + anchor]
    : (anchor, channel) => d[anchor * numChannels + channel];

  for (let i = 0; i < numAnchors; i++) {
    let bestScore = 0;
    let bestClass = -1;
    for (let c = 0; c < numClasses; c++) {
      const s = at(i, 4 + c);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }
    if (bestScore < MIN_SCORE) continue;

    const cx = at(i, 0);
    const cy = at(i, 1);
    const w = at(i, 2);
    const h = at(i, 3);
    boxes.push({
      x1: cx - w / 2,
      y1: cy - h / 2,
      x2: cx + w / 2,
      y2: cy + h / 2,
      score: bestScore,
      classId: bestClass,
    });
  }

  return nms(boxes, PASS_IOU, MAX_PER_PASS);
}

// Runs the model on one region; returns boxes normalised to that region.
async function runPass(bitmap, rx, ry, rw, rh) {
  const scale = Math.min(SIZE / rw, SIZE / rh);
  const nw = Math.round(rw * scale);
  const nh = Math.round(rh * scale);
  const padX = Math.floor((SIZE - nw) / 2);
  const padY = Math.floor((SIZE - nh) / 2);

  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, rx, ry, rw, rh, padX, padY, nw, nh);

  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const area = SIZE * SIZE;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = data[i * 4] / 255;
    input[i + area] = data[i * 4 + 1] / 255;
    input[i + 2 * area] = data[i * 4 + 2] / 255;
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const output = results[session.outputNames[0]];

  return decodeOutput(output).map((b) => ({
    x1: clamp((b.x1 - padX) / scale / rw),
    y1: clamp((b.y1 - padY) / scale / rh),
    x2: clamp((b.x2 - padX) / scale / rw),
    y2: clamp((b.y2 - padY) / scale / rh),
    score: b.score,
    classId: b.classId,
  }));
}

// Converts region-normalised boxes to full-frame normalised boxes.
function toFullFrame(boxes, rx, ry, rw, rh, W, H) {
  return boxes.map((b) => ({
    x1: (rx + b.x1 * rw) / W,
    y1: (ry + b.y1 * rh) / H,
    x2: (rx + b.x2 * rw) / W,
    y2: (ry + b.y2 * rh) / H,
    score: b.score,
    classId: b.classId,
  }));
}

async function detect(bitmap) {
  const W = bitmap.width;
  const H = bitmap.height;

  try {
    const fullBoxes = await runPass(bitmap, 0, 0, W, H);
    const all = toFullFrame(fullBoxes, 0, 0, W, H, W, H);

    if (TILE_COUNT > 1) {
      const landscape = W >= H;
      for (let i = 0; i < TILE_COUNT; i++) {
        const start = (i * (1 - TILE_FRACTION)) / (TILE_COUNT - 1);

        let rx = 0;
        let ry = 0;
        let rw = W;
        let rh = H;
        if (landscape) {
          rx = Math.round(start * W);
          rw = Math.round(TILE_FRACTION * W);
        } else {
          ry = Math.round(start * H);
          rh = Math.round(TILE_FRACTION * H);
        }

        const boxes = await runPass(bitmap, rx, ry, rw, rh);

        // Drop boxes cut off by an inner tile border.
        const usable = boxes.filter((b) => {
          const a1 = landscape ? b.x1 : b.y1;
          const a2 = landscape ? b.x2 : b.y2;
          if (i > 0 && a1 < EDGE_EPS) return false;
          if (i < TILE_COUNT - 1 && a2 > 1 - EDGE_EPS) return false;
          return true;
        });

        all.push(...toFullFrame(usable, rx, ry, rw, rh, W, H));
      }
    }

    return nms(all, MERGE_IOU, MAX_PER_PASS);
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      await init(msg.modelUrl);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', fatal: true, message: String(err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    try {
      const detections = await detect(msg.bitmap);
      self.postMessage({ type: 'result', detections });
    } catch (err) {
      self.postMessage({ type: 'error', fatal: false, message: String(err) });
    }
  }
};
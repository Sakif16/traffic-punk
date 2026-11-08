// Runs YOLO26 in a background thread so the video never stutters.
// Handles both export formats:
//   - raw:        [1, 4+numClasses, 8400]  (needs NMS, done here)
//   - end-to-end: [1, 300, 6]              (already filtered by the model)
import * as ort from '/ort/ort.wasm.min.mjs';

const SIZE = 640;
const MIN_SCORE = 0.25;
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 300;

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;

let session = null;
const canvas = new OffscreenCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d', { willReadFrequently: true });

async function init(modelUrl) {
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  // Warm-up run so the first real frame is not slow.
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

// Non-maximum suppression, done separately for each class.
function nms(boxes) {
  boxes.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of boxes) {
    let keep = true;
    for (const k of kept) {
      if (k.classId === box.classId && iou(k, box) > IOU_THRESHOLD) {
        keep = false;
        break;
      }
    }
    if (keep) {
      kept.push(box);
      if (kept.length >= MAX_DETECTIONS) break;
    }
  }
  return kept;
}

// Returns boxes in 640x640 letterboxed pixel space: { x1, y1, x2, y2, score, classId }
function decodeOutput(output) {
  const dims = output.dims;
  const d = output.data;
  const boxes = [];

  if (dims.length !== 3) {
    throw new Error('Unexpected model output shape: [' + dims.join(', ') + ']');
  }

  // End-to-end format: [1, N, 6] = x1, y1, x2, y2, score, classId
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

  // Raw format. Either [1, 4+nc, N] (channels first) or [1, N, 4+nc].
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

  return nms(boxes);
}

async function detect(bitmap) {
  const w = bitmap.width;
  const h = bitmap.height;

  // Letterbox: resize keeping aspect ratio, pad the rest with grey.
  const scale = Math.min(SIZE / w, SIZE / h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  const padX = Math.floor((SIZE - nw) / 2);
  const padY = Math.floor((SIZE - nh) / 2);

  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, 0, 0, w, h, padX, padY, nw, nh);
  bitmap.close();

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

  const boxes = decodeOutput(output);
  const clamp = (v) => Math.min(1, Math.max(0, v));

  // Map from 640x640 letterboxed space back to the original frame, normalised 0..1
  return boxes.map((b) => ({
    x1: clamp((b.x1 - padX) / scale / w),
    y1: clamp((b.y1 - padY) / scale / h),
    x2: clamp((b.x2 - padX) / scale / w),
    y2: clamp((b.y2 - padY) / scale / h),
    score: b.score,
    classId: b.classId,
  }));
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
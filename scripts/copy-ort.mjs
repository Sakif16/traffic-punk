import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = join('node_modules', 'onnxruntime-web', 'dist');
const dest = join('public', 'ort');

if (!existsSync(src)) {
  console.error('onnxruntime-web is not installed. Run: pnpm add onnxruntime-web');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

// CPU (wasm) and GPU (webgpu) runtimes with their wasm backends.
const files = readdirSync(src).filter((f) => {
  if (f === 'ort.wasm.min.mjs' || f === 'ort.webgpu.min.mjs') return true;
  return f.startsWith('ort-wasm-simd-threaded') && (f.endsWith('.mjs') || f.endsWith('.wasm'));
});

if (!files.includes('ort.wasm.min.mjs')) {
  console.error('ort.wasm.min.mjs not found in', src);
  console.error('Files available:', readdirSync(src).join(', '));
  process.exit(1);
}

if (!files.includes('ort.webgpu.min.mjs')) {
  console.warn('ort.webgpu.min.mjs not found, WebGPU will be unavailable (CPU fallback only).');
}

for (const f of files) {
  cpSync(join(src, f), join(dest, f));
  console.log('copied', f);
}
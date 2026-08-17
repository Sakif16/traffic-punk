// lib/store.ts
import { LiveStream } from './types';

declare global {
  // eslint-disable-next-line no-var
  var __streams: Map<string, LiveStream> | undefined;
}

if (!globalThis.__streams) {
  globalThis.__streams = new Map<string, LiveStream>();
}

export const streams: Map<string, LiveStream> = globalThis.__streams;

export function addStream(stream: Omit<LiveStream, 'viewerCount'>): void {
  streams.set(stream.id, { ...stream, viewerCount: 0 });
}

export function removeStream(id: string): void {
  streams.delete(id);
}

export function listStreams(): LiveStream[] {
  return Array.from(streams.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getStream(id: string): LiveStream | undefined {
  return streams.get(id);
}

export function updateViewerCount(id: string, viewerCount: number): boolean {
  const stream = streams.get(id);
  if (!stream) return false;
  stream.viewerCount = Math.max(0, viewerCount);
  return true;
}
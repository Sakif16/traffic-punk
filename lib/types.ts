// lib/types.ts

export interface LiveStream {
  id: string;
  peerId: string;
  place: string;
  district: string;
  country: string;
  createdAt: number;
  viewerCount: number;
}

export interface CreateStreamPayload {
  id: string;
  peerId: string;
  place: string;
  district: string;
  country: string;
}

export interface UpdateStreamPayload {
  viewerCount: number;
}
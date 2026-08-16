// lib/types.ts

export interface LiveStream {
  id: string;
  peerId: string;
  place: string;
  district: string;
  country: string;
  createdAt: number;
}

export interface CreateStreamPayload {
  id: string;
  peerId: string;
  place: string;
  district: string;
  country: string;
}
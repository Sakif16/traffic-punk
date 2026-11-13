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

export interface SensorReading {
  sensorId: string;
  temperature: number; // °C
  humidity: number; // % relative humidity
  receivedAt: number; // server time (ms)
}

export interface SensorPayload {
  sensorId?: string;
  temperature: number;
  humidity: number;
}
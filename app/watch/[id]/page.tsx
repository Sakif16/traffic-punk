// app/watch/[id]/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';
import { LiveStream } from '@/lib/types';

type Status = 'connecting' | 'live' | 'offline';

export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [info, setInfo] = useState<LiveStream | null>(null);

  useEffect(() => {
    let peer: Peer | undefined;
    let cancelled = false;

    async function connect() {
      const res = await fetch('/api/streams');
      const data: { streams: LiveStream[] } = await res.json();
      const stream = (data.streams || []).find((s) => s.id === id);

      if (!stream) {
        setStatus('offline');
        return;
      }
      setInfo(stream);

      const { default: PeerCtor } = await import('peerjs');
      peer = new PeerCtor();

      peer.on('open', () => {
        if (cancelled || !peer) return;
        // We pass an empty stream because we're only receiving, not sending.
        const call: MediaConnection = peer.call(stream.peerId, new MediaStream());
        call.on('stream', (remoteStream: MediaStream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = remoteStream;
          }
          setStatus('live');
        });
        call.on('close', () => setStatus('offline'));
        call.on('error', () => setStatus('offline'));
      });

      peer.on('error', () => setStatus('offline'));
    }

    connect();

    return () => {
      cancelled = true;
      if (peer) peer.destroy();
    };
  }, [id]);

  return (
    <main className="w-full h-screen bg-black flex flex-col">
      <video ref={videoRef} autoPlay playsInline className="flex-1 w-full object-contain" />
      <div className="p-2 text-center text-sm text-neutral-300 bg-neutral-900">
        {status === 'live' && info
          ? `${info.place} — ${info.district}, ${info.country}`
          : status === 'connecting'
          ? 'Connecting…'
          : 'Stream offline'}
      </div>
    </main>
  );
}
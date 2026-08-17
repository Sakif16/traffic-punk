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
    let pollInterval: ReturnType<typeof setInterval> | undefined;

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

      // The broadcaster calls US with the real video/audio — we just open
      // a data connection to let them know a viewer showed up.
      peer.on('open', () => {
        if (cancelled || !peer) return;
        peer.connect(stream.peerId);
      });

      peer.on('call', (call: MediaConnection) => {
        call.answer(); // we don't send anything back, only receive
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

      // Keep place/district/country + viewer count fresh while watching.
      pollInterval = setInterval(async () => {
        try {
          const r = await fetch('/api/streams');
          const d: { streams: LiveStream[] } = await r.json();
          const updated = (d.streams || []).find((s) => s.id === id);
          if (updated) setInfo(updated);
        } catch {
          // ignore transient errors
        }
      }, 5000);
    }

    connect();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (peer) peer.destroy();
    };
  }, [id]);

  return (
    <main className="w-full h-screen bg-black flex flex-col">
      <video ref={videoRef} autoPlay playsInline className="flex-1 w-full object-contain" />
      <div className="p-2 text-center text-sm text-neutral-300 bg-neutral-900 flex items-center justify-center gap-3">
        {status === 'live' && info ? (
          <>
            <span>
              {info.place} — {info.district}, {info.country}
            </span>
            <span className="text-neutral-500">👀 {info.viewerCount}</span>
          </>
        ) : status === 'connecting' ? (
          'Connecting…'
        ) : (
          'Stream offline'
        )}
      </div>
    </main>
  );
}
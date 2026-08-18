// app/watch/[id]/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';
import { LiveStream } from '@/lib/types';

type Status = 'connecting' | 'live' | 'offline';

const REDIRECT_SECONDS = 3;

export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [info, setInfo] = useState<LiveStream | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    let peer: Peer | undefined;
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let countdownInterval: ReturnType<typeof setInterval> | undefined;

    function goOffline() {
      if (cancelled) return;
      setStatus('offline');
      if (pollInterval) clearInterval(pollInterval);

      setCountdown(REDIRECT_SECONDS);
      let remaining = REDIRECT_SECONDS;
      countdownInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownInterval) clearInterval(countdownInterval);
          router.push('/');
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    }

    async function connect() {
      const res = await fetch('/api/streams');
      const data: { streams: LiveStream[] } = await res.json();
      const stream = (data.streams || []).find((s) => s.id === id);

      if (!stream) {
        goOffline();
        return;
      }
      setInfo(stream);

      const { default: PeerCtor } = await import('peerjs');
      peer = new PeerCtor();

      peer.on('open', () => {
        if (cancelled || !peer) return;
        peer.connect(stream.peerId);
      });

      peer.on('call', (call: MediaConnection) => {
        call.answer();
        call.on('stream', (remoteStream: MediaStream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = remoteStream;
          }
          setStatus('live');
        });
        // Fires when the broadcaster ends the stream / closes the connection.
        call.on('close', goOffline);
        call.on('error', goOffline);
      });

      peer.on('error', goOffline);
      peer.on('disconnected', goOffline);

      // Backup check: if the stream disappears from the server list
      // (e.g. broadcaster tab crashed without a clean close event), catch it here too.
      pollInterval = setInterval(async () => {
        try {
          const r = await fetch('/api/streams');
          const d: { streams: LiveStream[] } = await r.json();
          const updated = (d.streams || []).find((s) => s.id === id);
          if (!updated) {
            goOffline();
          } else {
            setInfo(updated);
          }
        } catch {
          // ignore transient errors
        }
      }, 5000);
    }

    connect();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (countdownInterval) clearInterval(countdownInterval);
      if (peer) peer.destroy();
    };
  }, [id, router]);

  return (
    <main className="w-full h-screen bg-black flex flex-col">
      <div className="flex-1 relative">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />

        {status === 'offline' && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-2">
            <p className="text-lg font-semibold">Stream ended</p>
            <p className="text-neutral-400 text-sm">
              Redirecting to home in {countdown}…
            </p>
          </div>
        )}
      </div>

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
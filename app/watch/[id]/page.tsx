// app/watch/[id]/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type Peer from 'peerjs';
import type { DataConnection, MediaConnection } from 'peerjs';
import { LiveStream } from '@/lib/types';

type Status = 'connecting' | 'live' | 'blocked' | 'offline';

const REDIRECT_SECONDS = 3;
const MEDIA_WAIT_MS = 8000;
const MAX_JOIN_ATTEMPTS = 3;

export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const statusRef = useRef<Status>('connecting');
  const [status, setStatus] = useState<Status>('connecting');
  const [info, setInfo] = useState<LiveStream | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  function updateStatus(nextStatus: Status) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  useEffect(() => {
    let peer: Peer | undefined;
    let dataConn: DataConnection | undefined;
    let mediaCall: MediaConnection | undefined;
    let cancelled = false;
    let offline = false;
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let countdownInterval: ReturnType<typeof setInterval> | undefined;
    let mediaWaitTimeout: ReturnType<typeof setTimeout> | undefined;

    function clearMediaWait() {
      if (mediaWaitTimeout) clearTimeout(mediaWaitTimeout);
      mediaWaitTimeout = undefined;
    }

    function goOffline() {
      if (cancelled || offline) return;
      offline = true;
      clearMediaWait();
      updateStatus('offline');
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

    function scheduleMediaRetry(stream: LiveStream, attempt: number) {
      clearMediaWait();
      mediaWaitTimeout = setTimeout(() => {
        if (cancelled || statusRef.current === 'live') return;

        const previousConn = dataConn;
        const previousCall = mediaCall;
        dataConn = undefined;
        mediaCall = undefined;
        previousConn?.close();
        previousCall?.close();

        if (attempt >= MAX_JOIN_ATTEMPTS) {
          goOffline();
          return;
        }

        connectToBroadcaster(stream, attempt + 1);
      }, MEDIA_WAIT_MS);
    }

    function connectToBroadcaster(stream: LiveStream, attempt = 1) {
      if (cancelled || !peer) return;
      updateStatus('connecting');

      const previousConn = dataConn;
      const previousCall = mediaCall;
      dataConn = undefined;
      mediaCall = undefined;
      previousConn?.close();
      previousCall?.close();

      const conn = peer.connect(stream.peerId, {
        metadata: { streamId: stream.id, role: 'viewer' },
      });
      dataConn = conn;

      conn.on('open', () => {
        conn.send({ type: 'viewer-ready', streamId: stream.id });
        scheduleMediaRetry(stream, attempt);
      });

      conn.on('error', () => {
        if (dataConn !== conn) return;
        if (attempt >= MAX_JOIN_ATTEMPTS) goOffline();
        else connectToBroadcaster(stream, attempt + 1);
      });

      conn.on('close', () => {
        if (dataConn !== conn) return;
        if (statusRef.current !== 'live' && !offline && !cancelled) {
          if (attempt >= MAX_JOIN_ATTEMPTS) goOffline();
          else connectToBroadcaster(stream, attempt + 1);
        }
      });
    }

    async function playRemoteStream(remoteStream: MediaStream) {
      const video = videoRef.current;
      if (!video) return;

      video.srcObject = remoteStream;
      video.muted = true;
      video.playsInline = true;

      try {
        await video.play();
        updateStatus('live');
      } catch {
        updateStatus('blocked');
      }
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
        connectToBroadcaster(stream);
      });

      peer.on('call', (call: MediaConnection) => {
        mediaCall = call;
        call.on('stream', (remoteStream: MediaStream) => {
          clearMediaWait();
          void playRemoteStream(remoteStream);
        });
        // Fires when the broadcaster ends the stream / closes the connection.
        call.on('close', () => {
          if (mediaCall === call) goOffline();
        });
        call.on('error', () => {
          if (mediaCall === call) goOffline();
        });
        call.answer();
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
      clearMediaWait();
      if (pollInterval) clearInterval(pollInterval);
      if (countdownInterval) clearInterval(countdownInterval);
      dataConn?.close();
      mediaCall?.close();
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

        {status === 'blocked' && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-3">
            <p className="text-lg font-semibold">Video paused</p>
            <button
              onClick={() => {
                void videoRef.current?.play().then(() => updateStatus('live')).catch(() => {});
              }}
              className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded font-medium"
            >
              Play
            </button>
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
        ) : status === 'blocked' ? (
          'Video paused'
        ) : (
          'Stream offline'
        )}
      </div>
    </main>
  );
}

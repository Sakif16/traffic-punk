// app/watch/[id]/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';
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
    let mediaCall: MediaConnection | undefined;
    let viewerOfferStream: MediaStream | undefined;
    let audioContext: AudioContext | undefined;
    let oscillator: OscillatorNode | undefined;
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

    function createViewerOfferStream() {
      const tracks: MediaStreamTrack[] = [];
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 9;
      canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height);
      const canvasStream = canvas.captureStream(1);
      const videoTrack = canvasStream.getVideoTracks()[0];
      if (videoTrack) tracks.push(videoTrack);

      try {
        audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        const gain = audioContext.createGain();
        oscillator = audioContext.createOscillator();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        const audioTrack = destination.stream.getAudioTracks()[0];
        if (audioTrack) tracks.push(audioTrack);
      } catch {
        // A video-only offer still lets browsers negotiate the important visual track.
      }

      return new MediaStream(tracks);
    }

    function stopViewerOfferStream() {
      viewerOfferStream?.getTracks().forEach((track) => track.stop());
      viewerOfferStream = undefined;
      oscillator?.stop();
      oscillator = undefined;
      void audioContext?.close();
      audioContext = undefined;
    }

    function scheduleMediaRetry(stream: LiveStream, attempt: number) {
      clearMediaWait();
      mediaWaitTimeout = setTimeout(() => {
        if (cancelled || statusRef.current === 'live') return;

        const previousCall = mediaCall;
        mediaCall = undefined;
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

      const previousCall = mediaCall;
      mediaCall = undefined;
      previousCall?.close();

      viewerOfferStream ??= createViewerOfferStream();
      const call = peer.call(stream.peerId, viewerOfferStream, {
        metadata: { streamId: stream.id, role: 'viewer' },
      });
      mediaCall = call;
      scheduleMediaRetry(stream, attempt);

      call.on('stream', (remoteStream: MediaStream) => {
        clearMediaWait();
        void playRemoteStream(remoteStream);
      });

      call.on('close', () => {
        if (mediaCall !== call || statusRef.current === 'live' || offline || cancelled) return;
        if (attempt >= MAX_JOIN_ATTEMPTS) goOffline();
        else connectToBroadcaster(stream, attempt + 1);
      });

      call.on('error', () => {
        if (mediaCall !== call || offline || cancelled) return;
        if (attempt >= MAX_JOIN_ATTEMPTS) goOffline();
        else connectToBroadcaster(stream, attempt + 1);
      });
    }

    async function playRemoteStream(remoteStream: MediaStream) {
      const video = videoRef.current;
      if (!video) return;

      video.muted = true;
      video.playsInline = true;
      video.srcObject = remoteStream;

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
      mediaCall?.close();
      stopViewerOfferStream();
      if (peer) peer.destroy();
    };
  }, [id, router]);

  return (
    <main className="w-full h-screen bg-black flex flex-col">
      <div className="flex-1 relative">
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />

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

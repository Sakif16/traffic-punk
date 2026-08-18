// app/go-live/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';

export default function GoLivePage() {
  const [place, setPlace] = useState('');
  const [district, setDistrict] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const viewersRef = useRef<Map<string, MediaConnection>>(new Map());
  const endedRef = useRef(false);

  const router = useRouter();

  // Stops the camera/mic hardware and tears down all connections.
  // Safe to call more than once (e.g. both on unmount AND on button click).
  function stopEverything() {
    if (endedRef.current) return;
    endedRef.current = true;

    if (streamIdRef.current) {
      fetch('/api/streams/' + streamIdRef.current, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => {});
    }

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    viewersRef.current.forEach((call) => call.close());
    viewersRef.current.clear();

    // This is the critical line that was missing before — without it,
    // the camera/mic hardware keeps running even after the peer connection closes.
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setViewerCount(0);
  }

  function reportViewerCount() {
    if (!streamIdRef.current) return;
    fetch('/api/streams/' + streamIdRef.current, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewerCount: viewersRef.current.size }),
    }).catch(() => {});
  }

  useEffect(() => {
    window.addEventListener('beforeunload', stopEverything);
    return () => {
      window.removeEventListener('beforeunload', stopEverything);
      // Covers back-button / clicking a nav link without pressing "End Stream".
      stopEverything();
    };
  }, []);

  async function startStream(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    endedRef.current = false;

    if (place.trim() === '' || /\s/.test(place.trim())) {
      setError('Place must be a single word, no spaces.');
      return;
    }
    if (!district.trim() || !country.trim()) {
      setError('District and country are required.');
      return;
    }

    try {
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = localStream;

      if (videoRef.current) {
        videoRef.current.srcObject = localStream;
      }

      const { default: PeerCtor } = await import('peerjs');
      const id = crypto.randomUUID();
      streamIdRef.current = id;

      const peer = new PeerCtor(id);
      peerRef.current = peer;

      peer.on('open', async (peerId: string) => {
        function removeViewer(peerId: string, call: MediaConnection) {
          if (viewersRef.current.get(peerId) !== call) return;
          viewersRef.current.delete(peerId);
          setViewerCount(viewersRef.current.size);
          reportViewerCount();
        }

        peer.on('call', (call: MediaConnection) => {
          if (!localStreamRef.current || endedRef.current) {
            call.close();
            return;
          }

          const previousCall = viewersRef.current.get(call.peer);
          if (previousCall && previousCall !== call) previousCall.close();

          viewersRef.current.set(call.peer, call);
          setViewerCount(viewersRef.current.size);
          reportViewerCount();

          call.on('close', () => removeViewer(call.peer, call));
          call.on('error', () => removeViewer(call.peer, call));
          call.answer(localStreamRef.current);
        });

        await fetch('/api/streams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            peerId,
            place: place.trim(),
            district: district.trim(),
            country: country.trim(),
          }),
        });

        setLive(true);
      });

      peer.on('error', (err: { type: string }) => {
        console.error(err);
        setError('Connection error: ' + err.type);
        setLive(false);
        stopEverything();
      });
    } catch (err) {
      console.error(err);
      setError('Could not access camera/microphone.');
    }
  }

  function handleStop() {
    stopEverything();
    router.push('/');
  }

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">Go Live</h1>

      {!live && (
        <form onSubmit={startStream} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Place (road / junction, one word)</label>
            <input
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="MirpurRoad10"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">District / State</label>
            <input
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              placeholder="Dhaka"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Country</label>
            <input
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Bangladesh"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            className="w-full bg-red-600 hover:bg-red-700 py-2 rounded font-medium"
          >
            Continue
          </button>
        </form>
      )}

      <div className={live ? 'mt-4' : 'mt-4 hidden'}>
        <video ref={videoRef} autoPlay muted playsInline className="w-full rounded bg-black" />
        {live && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-neutral-400">👀 {viewerCount} watching</span>
            <button
              onClick={handleStop}
              className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded"
            >
              End Stream
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// app/go-live/page.tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';

export default function GoLivePage() {
  const [place, setPlace] = useState('');
  const [district, setDistrict] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const router = useRouter();

  async function startStream(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

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

      if (videoRef.current) {
        videoRef.current.srcObject = localStream;
      }

      const { default: PeerCtor } = await import('peerjs');
      const id = crypto.randomUUID();
      streamIdRef.current = id;

      const peer = new PeerCtor(id);
      peerRef.current = peer;

      peer.on('open', async (peerId: string) => {
        peer.on('call', (call: MediaConnection) => {
          call.answer(localStream);
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
      });

      window.addEventListener('beforeunload', endStream);
    } catch (err) {
      console.error(err);
      setError('Could not access camera/microphone.');
    }
  }

  function endStream() {
    if (streamIdRef.current) {
      fetch('/api/streams/' + streamIdRef.current, {
        method: 'DELETE',
        keepalive: true,
      });
    }
    if (peerRef.current) {
      peerRef.current.destroy();
    }
  }

  function handleStop() {
    endStream();
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
          <button
            onClick={handleStop}
            className="mt-3 w-full bg-neutral-800 hover:bg-neutral-700 py-2 rounded"
          >
            End Stream
          </button>
        )}
      </div>
    </main>
  );
}
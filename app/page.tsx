// app/page.tsx
'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LiveStream } from '@/lib/types';
require("node:dns/promises").setServers(["1.1.1.1", "8.8.8.8"]);

function HomeContent() {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [origin, setOrigin] = useState('');

  const searchParams = useSearchParams();
  const isEmbed = searchParams.get('embed') === '1';

  const fetchStreams = useCallback(async () => {
    try {
      const res = await fetch('/api/streams');
      const data: { streams: LiveStream[] } = await res.json();
      setStreams(data.streams || []);
    } catch (e) {
      console.error('Failed to load streams', e);
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    const timeout = setTimeout(fetchStreams, 0);
    const interval = setInterval(fetchStreams, 4000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [fetchStreams]);

  function copyEmbed(id: string) {
    const origin = window.location.origin;
    const code = `<iframe src="${origin}/watch/${id}" width="640" height="360" allow="autoplay" frameborder="0"></iframe>`;
    navigator.clipboard.writeText(code);
    alert('Embed code copied to clipboard');
  }

  const listEmbedCode = `<iframe src="${origin}?embed=1" width="640" height="480" allow="autoplay" frameborder="0"></iframe>`;

  return (
    <main className="max-w-4xl mx-auto p-6">
      {!isEmbed && (
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Live Roads</h1>
          <Link
            href="/go-live"
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-sm font-medium"
          >
            Go Live
          </Link>
        </div>
      )}

      <div className="border border-neutral-800 rounded p-4">
        {!isEmbed && (
          <pre className="text-xs text-neutral-400 bg-neutral-900 rounded p-3 mb-4 overflow-x-auto whitespace-pre-wrap break-all">
            {listEmbedCode}
          </pre>
        )}

        {streams.length === 0 && (
          <p className="text-neutral-400">No live streams right now.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {streams.map((s) => (
            <div key={s.id} className="border border-neutral-800 rounded p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                <span className="text-xs uppercase tracking-wide text-red-400">Live</span>
              </div>
              <h2 className="font-semibold text-lg">{s.place}</h2>
              <p className="text-sm text-neutral-400">
                {s.district}, {s.country}
              </p>
              <p className="text-xs text-neutral-500 mb-3">👀 {s.viewerCount} watching</p>
              <div className="flex gap-2">
                <Link
                  href={`/watch/${s.id}`}
                  className="text-sm bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded"
                >
                  Watch
                </Link>
                <button
                  onClick={() => copyEmbed(s.id)}
                  className="text-sm bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded"
                >
                  Copy Embed
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
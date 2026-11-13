// app/page.tsx
'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LiveStream } from '@/lib/types';


function HomeContent() {
  const [streams, setStreams] = useState<LiveStream[]>([]);

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

  return (
    <main className={isEmbed ? 'w-full p-3 sm:p-4' : 'max-w-4xl mx-auto p-6'}>
      {/* In embed mode, let the host site's background show through. */}
      {isEmbed && (
        <style>{`html, body { background: transparent !important; }`}</style>
      )}

      {!isEmbed && (
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Live Roads</h1>
          <Link
            href="/go-live"
            className="bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          >
            Go Live
          </Link>
        </div>
      )}

      <div
        className={
          isEmbed ? '' : 'border border-neutral-800 bg-neutral-900/40 rounded-2xl p-4'
        }
      >
        {streams.length === 0 && (
          <p className="text-neutral-400 text-sm border border-neutral-800 bg-neutral-900/60 rounded-xl px-4 py-3">
            No live streams right now.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {streams.map((s) => (
            <div
              key={s.id}
              className="border border-neutral-800 bg-neutral-900/60 hover:border-orange-500/40 transition-colors rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                <span className="text-xs uppercase tracking-wide text-red-400">Live</span>
              </div>
              <h2 className="font-semibold text-lg text-neutral-100">{s.place}</h2>
              <p className="text-sm text-neutral-400">
                {s.district}, {s.country}
              </p>
              <p className="text-xs text-neutral-500 mb-3">👀 {s.viewerCount} watching</p>
              <div className="flex gap-2">
                <Link
                  href={`/watch/${s.id}`}
                  className="text-sm font-medium bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 px-3 py-1.5 rounded-full transition-colors"
                >
                  Watch
                </Link>
                <button
                  onClick={() => copyEmbed(s.id)}
                  className="text-sm text-neutral-100 border border-neutral-700 hover:bg-neutral-800 px-3 py-1.5 rounded-full transition-colors"
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
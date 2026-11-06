'use client';

import { useState } from 'react';
import { Loading } from '@/components/loading';
import { cn } from '@/lib/utils';

export function VideoPlayer({ src, poster, label, muted = false, onSize, onError, className }: {
  src: string; poster?: string; label: string; muted?: boolean;
  onSize?: (size: [number, number]) => void; onError?: () => void; className?: string;
}) {
  const [posterReady, setPosterReady] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className={cn('relative overflow-hidden rounded-xl bg-zinc-950', className)}>
    {poster && !posterFailed && (
      // Track the native poster's load without starting playback; identical requests share the browser cache.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={poster} alt="" aria-hidden="true" className="hidden" onLoad={() => setPosterReady(true)} onError={() => setPosterFailed(true)} />
    )}
    <video aria-label={label} src={src} poster={posterFailed ? undefined : poster} controls muted={muted} playsInline preload="metadata"
      className="block aspect-video w-full object-contain"
      onLoadedMetadata={event => onSize?.([event.currentTarget.videoWidth, event.currentTarget.videoHeight])}
      onLoadedData={() => setFrameReady(true)} onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onPlaying={() => setBuffering(false)}
      onError={() => { setFailed(true); onError?.(); }} />
    {!failed && (buffering || (!frameReady && !posterReady && !posterFailed)) && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20"><Loading label={buffering ? 'Buffering video…' : 'Loading preview…'} className="rounded-full bg-black/60 px-4 py-2 text-white" /></div>}
    {posterFailed && !frameReady && !failed && <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-xs text-white/80">Preview unavailable. Press play to watch the video.</p>}
    {failed && <p role="alert" className="px-4 py-3 text-sm text-white/80">This video could not be played. Try reloading the page.</p>}
  </div>;
}

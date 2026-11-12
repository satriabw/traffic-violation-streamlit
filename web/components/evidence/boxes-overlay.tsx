'use client';

import { useState } from 'react';
import { bboxAt, label, MUTED, placeLabels, speedAt, type Track } from '@/lib/evidence';
import { safeUrl } from '@/lib/format';

export function BoxesOverlay({ src, tracks, frame, sourceSize, colours, violatorId, involvedIds = [] }: {
  src: string;
  tracks: Track[];
  frame?: number | null;
  sourceSize?: [number, number] | null;
  colours: Map<number, string>;
  violatorId?: number | null;
  // The road users the rule's checks found when it fired.
  involvedIds?: readonly number[];
}) {
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const [failed, setFailed] = useState(false);
  const size = sourceSize ?? natural;
  const url = safeUrl(src);
  if (!url) return <p role="alert">The evidence image URL is unavailable.</p>;
  const font = Math.max(13, (size?.[0] ?? 800) / 62);
  const boxes = tracks.flatMap(track => {
    const box = bboxAt(track, frame);
    if (!box || box.length < 4 || !box.every(Number.isFinite)) return [];
    const speed = speedAt(track, frame);
    const role = track.trackId === violatorId ? ' · violator' : involvedIds.includes(track.trackId) ? ' · involved' : '';
    const text = label(track) + role
      + (speed != null && Number.isFinite(speed) ? ` ${speed.toFixed(speed < 100 ? 1 : 0)} m/s` : '');
    return [{ track, box, text, colour: colours.get(track.trackId) ?? MUTED }];
  });
  const labelled = boxes.filter(item => colours.has(item.track.trackId) || item.track.trackId === violatorId);
  const positions = placeLabels(labelled.map(item => ({
    x: item.box[0], y: item.box[1], w: item.text.length * font * 0.6 + 10, h: font + 10,
  })), size?.[0] ?? 800);
  return (
    <figure className="space-y-2">
      <div className="relative">
        {/* Evidence has an API-provided size and must retain its original aspect ratio. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Evidence at frame ${frame ?? 'unknown'}`} className="block h-auto w-full"
          onLoad={event => setNatural([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])}
          onError={() => setFailed(true)} />
        {size && !failed && (
          <svg viewBox={`0 0 ${size[0]} ${size[1]}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Detected road users">
            {boxes.map(({ track, box, colour }) => {
              const width = Math.max(2, size[0] / 480) + Number(track.trackId === violatorId);
              return <g key={`${track.kind}-${track.trackId}`} fill="none">
                <rect x={box[0]} y={box[1]} width={Math.max(0, box[2] - box[0])} height={Math.max(0, box[3] - box[1])} stroke="rgba(0,0,0,0.59)" strokeWidth={width + 2} />
                <rect x={box[0]} y={box[1]} width={Math.max(0, box[2] - box[0])} height={Math.max(0, box[3] - box[1])} stroke={colour} strokeWidth={width} />
              </g>;
            })}
            {labelled.map((item, index) => <g key={`${item.track.kind}-${item.track.trackId}`}>
              <rect {...positions[index]} width={item.text.length * font * 0.6 + 10} height={font + 10} fill="rgba(0,0,0,0.78)" rx={3} />
              <text x={positions[index].x + 5} y={positions[index].y + font + 2} fill={item.colour} fontSize={font}>{item.text}</text>
            </g>)}
          </svg>
        )}
      </div>
      {failed && <p role="alert">Could not load the evidence image.</p>}
      <figcaption className="text-sm text-muted-foreground">Frame {frame ?? '—'} with the detected road users outlined. Outlines are drawn on top of the original, unedited video frame.</figcaption>
    </figure>
  );
}

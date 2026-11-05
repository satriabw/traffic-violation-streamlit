'use client';

import { useId } from 'react';
import { GRID, INK, INK_SOFT, label, padded, within, type GroundZone, type Track } from '@/lib/evidence';

type Point = [number, number];
export function GroundPlot({ tracks, colours, fps, violationT, zones, view }: {
  tracks: Track[];
  colours: Map<number, string>;
  fps?: number | null;
  violationT?: number | null;
  zones: GroundZone[];
  view: ((x: number, y: number) => Point) | null;
}) {
  const clipId = useId();
  const paths = tracks.filter(track => colours.has(track.trackId)).map(track => ({
    track,
    points: track.frameIdxs.flatMap((frame, index) => {
      const raw = track.trajectory[index];
      if (!raw || raw.length < 2 || !raw.slice(0, 2).every(Number.isFinite)) return [];
      const point = view ? view(raw[0], raw[1]) : [raw[0], raw[1]] as Point;
      return [{ point, t: fps ? frame / fps : null, speed: track.speed[index] }];
    }),
  })).filter(path => path.points.length);
  const all = paths.flatMap(path => path.points.map(row => row.point));
  if (!all.length) return <p>No positions available — this site had no camera calibration when the violation was found, so positions could not be estimated.</p>;
  const xd = padded(all.map(p => p[0]));
  const yd = padded(all.map(p => p[1]));
  const scale = Math.min(480 / (xd[1] - xd[0]), 300 / (yd[1] - yd[0]));
  const x = (v: number) => 70 + 240 + (v - (xd[0] + xd[1]) / 2) * scale;
  const y = (v: number) => 20 + 150 - (v - (yd[0] + yd[1]) / 2) * scale;
  const centre: Point = [all.reduce((n, p) => n + p[0], 0) / all.length, all.reduce((n, p) => n + p[1], 0) / all.length];
  const visibleZones = zones.map(zone => ({ ...zone, points: zone.points.map(p => view ? view(...p) : p) }))
    .filter(zone => within(zone.points, centre));
  const polygon = (points: Point[]) => points.map(p => `${x(p[0])},${y(p[1])}`).join(' ');
  return (
    <figure className="space-y-2">
      <svg viewBox="0 0 620 390" role="img" aria-label="Top-down paths in metres" className="w-full">
        <defs><clipPath id={clipId}><rect x={70} y={20} width={480} height={300} /></clipPath></defs>
        {Array.from({ length: 5 }, (_, i) => {
          const xv = xd[0] + (xd[1] - xd[0]) * i / 4;
          const yv = yd[0] + (yd[1] - yd[0]) * i / 4;
          return <g key={i} fontSize={11} fill={INK_SOFT}>
            <path d={`M${x(xv)},20V320 M70,${y(yv)}H550`} stroke={GRID} />
            <text x={x(xv)} y={340} textAnchor="middle">{xv.toFixed(1)}</text>
            <text x={62} y={y(yv) + 4} textAnchor="end">{yv.toFixed(1)}</text>
          </g>;
        })}
        <g clipPath={`url(#${clipId})`}>
          {visibleZones.map((zone, index) => {
            const edge = zone.kind === 'edge';
            const at = edge
              ? zone.points.reduce((a, p) => [a[0] + p[0] / zone.points.length, a[1] + p[1] / zone.points.length] as Point, [0, 0] as Point)
              : zone.points[0];
            return <g key={`${zone.zone}-${index}`}>
              <polyline points={polygon(zone.points)} fill="none" stroke={INK_SOFT} strokeWidth={edge ? 3 : 1} strokeDasharray={edge ? undefined : '4 3'} opacity={edge ? 0.6 : 1}><title>{zone.label}</title></polyline>
              <text x={x(at[0]) + (edge ? 0 : 4)} y={y(at[1]) + (edge ? -8 : 10)} fill={INK_SOFT} fontSize={10} fontStyle={edge ? 'italic' : undefined}>{zone.label}</text>
            </g>;
          })}
          {paths.map(({ track, points }) => {
            const end = points[points.length - 1].point;
            const moment = violationT == null || !fps ? null : points.reduce((best, row) => Math.abs(row.t! - violationT) < Math.abs(best.t! - violationT) ? row : best);
            return <g key={`${track.kind}-${track.trackId}`}>
              <polyline points={polygon(points.map(row => row.point))} fill="none" stroke={colours.get(track.trackId)} strokeWidth={2} />
              {points.map((row, index) => <circle key={index} cx={x(row.point[0])} cy={y(row.point[1])} r={5} fill="transparent"><title>{`${label(track)} · ${row.t?.toFixed(2) ?? '—'} s · ${row.speed?.toFixed(2) ?? '—'} m/s · (${row.point.map(n => n.toFixed(1)).join(', ')}) m`}</title></circle>)}
              <text x={x(end[0]) + 8} y={y(end[1]) - 6} fontSize={11} fill={INK}>{label(track)}</text>
              {moment && <path d={`M${x(moment.point[0])},${y(moment.point[1]) - 8}l8,8 -8,8 -8,-8Z`} fill={colours.get(track.trackId)} stroke="white" strokeWidth={2}><title>{`${label(track)} at ${moment.t?.toFixed(2)} s`}</title></path>}
            </g>;
          })}
        </g>
        <text x={310} y={375} textAnchor="middle" fontSize={12} fill={INK}>{view ? 'across the picture (m)' : 'ground plane x (m)'}</text>
        <text transform="translate(15 170) rotate(-90)" textAnchor="middle" fontSize={12} fill={INK}>{view ? 'into the picture (m)' : 'ground plane y (m)'}</text>
      </svg>
      <figcaption className="text-sm text-muted-foreground">The diamond marks each road user’s position at the moment of the violation.{view && ' Turned to match the camera: up is further into the picture, left and right are the picture’s own.'}{visibleZones.length > 0 && ' Dashed outlines are the configuration’s zones; thick lines are named edges, such as a crossing’s kerbs.'}</figcaption>
    </figure>
  );
}

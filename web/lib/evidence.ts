import type { Track as RawTrack } from './types';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
export const MUTED = '#94a3b8';
export const INK = '#0f172a';
export const INK_SOFT = '#64748b';
export const GRID = '#e2e8f0';
export const ZONE = '#cbd5e1';
export const ZONE_REACH_METRES = 200;
export const SPEED_WINDOW_SECONDS = 10;
export const IMPLAUSIBLE_SPEED_MS = 60;

type Point = [number, number];
type Metadata = {
  vehicles?: Partial<RawTrack>[] | null;
  pedestrians?: Partial<RawTrack>[] | null;
  ground_from_pixel?: number[][] | null;
};
type Region = {
  id?: string;
  points?: number[][] | null;
  edges?: Record<string, number[]> | null;
};
type Configuration = { regions?: Record<string, Region[] | null> | null };
export type Track = {
  trackId: number;
  kind: 'vehicle' | 'pedestrian';
  frameIdxs: number[];
  bboxes: number[][];
  trajectory: (number[] | null)[];
  speed: (number | null)[];
};
export type GroundZone = {
  zone: string;
  kind: 'zone' | 'edge';
  label: string;
  points: Point[];
};

export function label(track: Track): string {
  return `${track.kind.slice(0, 3)} #${track.trackId}`;
}

export function tracksOf(metadata: Metadata | null | undefined): Track[] {
  const tracks: Track[] = [];
  for (const kind of ['vehicle', 'pedestrian'] as const) {
    const rows = kind === 'vehicle' ? metadata?.vehicles : metadata?.pedestrians;
    for (const raw of rows ?? []) {
      if (raw.track_id == null) continue;
      tracks.push({
        trackId: raw.track_id,
        kind,
        frameIdxs: [...(raw.frame_idxs ?? [])],
        bboxes: (raw.bboxes ?? []).map(box => [...box]),
        trajectory: (raw.trajectory ?? []).map(point => point ? [...point] : null),
        speed: [...(raw.speed ?? [])],
      });
    }
  }
  return tracks;
}

export function sampleAt(track: Track, frame: number | null | undefined): number | null {
  if (frame == null || !Number.isFinite(frame)) return null;
  let best: number | null = null;
  let gap = Infinity;
  track.frameIdxs.forEach((value, index) => {
    const distance = Math.abs(value - frame);
    if (distance < gap) {
      best = index;
      gap = distance;
    }
  });
  return gap <= 15 ? best : null;
}

export function bboxAt(track: Track, frame: number | null | undefined): number[] | null {
  const index = sampleAt(track, frame);
  return index == null ? null : track.bboxes[index] ?? null;
}

export function speedAt(track: Track, frame: number | null | undefined): number | null {
  const index = sampleAt(track, frame);
  return index == null ? null : track.speed[index] ?? null;
}

// The violator, then each road user the rule's checks found when it fired, as the API reads them from its trace.
export function involved(
  tracks: Track[],
  violatorId: number | null | undefined,
  involvedIds: readonly number[] | null | undefined,
): Track[] {
  const ids = [...(violatorId != null ? [violatorId] : []), ...(involvedIds ?? []).filter(id => id !== violatorId)];
  return ids.flatMap(id => tracks.find(t => t.trackId === id) ?? []);
}

export function colourMap(ids: Iterable<number>): Map<number, string> {
  const colours = new Map<number, string>();
  for (const id of ids) {
    if (colours.has(id)) continue;
    if (colours.size === SERIES.length) break;
    colours.set(id, SERIES[colours.size]);
  }
  return colours;
}

export function implausible(tracks: Track[], colours: Map<number, string>): number | null {
  let fastest = 0;
  for (const track of tracks) {
    if (!colours.has(track.trackId)) continue;
    for (const speed of track.speed) {
      if (speed != null && Number.isFinite(speed)) fastest = Math.max(fastest, speed);
    }
  }
  return fastest > IMPLAUSIBLE_SPEED_MS ? fastest : null;
}

export function project(h: number[][], point: number[]): Point | null {
  if (h.length !== 3 || h.some(row => row.length !== 3 || !row.every(Number.isFinite))
    || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)) return null;
  const [gx, gy, w] = h.map(row => row[0] * point[0] + row[1] * point[1] + row[2]);
  if (w <= 1e-9) return null;
  const projected: Point = [gx / w, gy / w];
  return projected.every(Number.isFinite) ? projected : null;
}

export function cameraView(
  metadata: Metadata | null | undefined,
  size: [number, number] | null | undefined,
): ((x: number, y: number) => Point) | null {
  const h = metadata?.ground_from_pixel;
  if (!h || !size || size.some(n => !Number.isFinite(n) || n <= 0)) return null;
  const [width, height] = size;
  const origin = project(h, [width / 2, height]);
  const right = project(h, [width * 0.75, height]);
  const ahead = [0.5, 0.7, 0.9]
    .map(share => project(h, [width / 2, height * share]))
    .find(point => point != null);
  if (!origin || !right || !ahead) return null;
  let fx = ahead[0] - origin[0];
  let fy = ahead[1] - origin[1];
  const length = Math.hypot(fx, fy);
  if (length < 1e-9) return null;
  fx /= length;
  fy /= length;
  let rx = fy;
  let ry = -fx;
  if ((right[0] - origin[0]) * rx + (right[1] - origin[1]) * ry < 0) {
    rx = -rx;
    ry = -ry;
  }
  return (x, y) => {
    const dx = x - origin[0];
    const dy = y - origin[1];
    return [dx * rx + dy * ry, dx * fx + dy * fy];
  };
}

export function groundZones(
  metadata: Metadata | null | undefined,
  configuration: Configuration | null | undefined,
): GroundZone[] {
  const h = metadata?.ground_from_pixel;
  if (!h || !configuration) return [];
  const zones: GroundZone[] = [];
  for (const [layer, items] of Object.entries(configuration.regions ?? {})) {
    for (const item of items ?? []) {
      if (!item.points || item.points.length < 3) continue;
      const projected = item.points.map(point => project(h, point));
      if (projected.some(point => point == null)) continue;
      const ground = projected as Point[];
      const first = ground[0];
      const last = ground[ground.length - 1];
      const ring = first[0] === last[0] && first[1] === last[1] ? ground : [...ground, first];
      const name = item.id ?? layer;
      zones.push({ zone: name, kind: 'zone', label: name, points: ring });
      for (const [edge, [a, b]] of Object.entries(item.edges ?? {})) {
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0
          || a >= ground.length || b >= ground.length) continue;
        zones.push({
          zone: `${name}:${edge}`,
          kind: 'edge',
          label: edge.replaceAll('_', ' '),
          points: [ground[a], ground[b]],
        });
      }
    }
  }
  return zones;
}

export function padded(values: number[], share = 0.15, least = 2): Point {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [-least, least];
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const pad = Math.max((high - low) * share, least);
  return [low - pad, high + pad];
}

export function within(points: number[][], centre: Point): boolean {
  return points.length > 0 && points.every(point =>
    Math.abs(point[0] - centre[0]) <= ZONE_REACH_METRES
    && Math.abs(point[1] - centre[1]) <= ZONE_REACH_METRES);
}

export function placeLabels(
  labels: { x: number; y: number; w: number; h: number }[],
  imageWidth: number,
): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const ordered = labels.map((label, index) => ({ ...label, index })).sort((a, b) => a.y - b.y);
  for (const label of ordered) {
    const x = Math.min(label.x, imageWidth - label.w);
    let y = label.y - label.h > 0 ? label.y - label.h : label.y;
    for (let round = 0; round < 8; round++) {
      const overlaps = placed.some(p => x < p.x + p.w && x + label.w > p.x
        && y < p.y + p.h && y + label.h > p.y);
      if (!overlaps) break;
      y += label.h + 2;
    }
    placed.push({ x, y, w: label.w, h: label.h });
    result[label.index] = { x, y };
  }
  return result;
}

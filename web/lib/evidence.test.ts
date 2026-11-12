import { describe, expect, it } from 'vitest';
import {
  bboxAt, cameraView, colourMap, groundZones, implausible, involved, label,
  padded, placeLabels, project, sampleAt, speedAt, tracksOf, within, type Track,
} from './evidence';

const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const box = [1, 1, 3, 3];
const polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const configuration = { regions: { rois: [{ id: 'crossing', points: polygon, edges: { near_kerb: [0, 1] } }] } };
function track(trackId: number, kind: Track['kind'] = 'pedestrian', hits = 15): Track {
  return { trackId, kind, frameIdxs: Array.from({ length: 15 }, (_, i) => i),
    bboxes: Array.from({ length: hits }, () => [...box]), trajectory: [], speed: [] };
}

describe('evidence maths', () => {
  it('maps partial metadata in vehicle then pedestrian order without sharing arrays', () => {
    expect(tracksOf(null)).toEqual([]);
    const metadata = { vehicles: [{ track_id: 1, frame_idxs: [0, 30] }], pedestrians: [{ track_id: 2 }] };
    const tracks = tracksOf(metadata);
    expect(tracks.map(t => t.kind)).toEqual(['vehicle', 'pedestrian']);
    expect(label(tracks[0])).toBe('veh #1');
    tracks[0].frameIdxs.push(50);
    expect(metadata.vehicles[0].frame_idxs).toEqual([0, 30]);
  });

  it('finds nearest samples within fifteen frames and handles missing parallel values', () => {
    const t = { ...track(7, 'vehicle'), frameIdxs: [0, 30], bboxes: [box], speed: [12] };
    expect(sampleAt(t, 20)).toBe(1);
    expect(sampleAt({ ...t, frameIdxs: [0, 100] }, 20)).toBeNull();
    expect(sampleAt(t, null)).toBeNull();
    expect(bboxAt(t, 0)).toEqual(box);
    expect(bboxAt(t, 30)).toBeNull();
    expect(speedAt(t, 0)).toBe(12);
    expect(speedAt(t, 30)).toBeNull();
  });

  it('lists the violator then the road users the rule found, from any list, in the rule\'s order', () => {
    const cyclist = track(1, 'pedestrian');
    const tracks = [track(2, 'vehicle'), track(3), track(5, 'vehicle'), cyclist];
    expect(involved(tracks, 1, [5, 3]).map(t => t.trackId)).toEqual([1, 5, 3]);
    expect(involved(tracks, 1, [1, 9]).map(t => t.trackId)).toEqual([1]);
    expect(involved(tracks, 1, undefined)).toEqual([cyclist]);
    expect(involved(tracks, null, [3]).map(t => t.trackId)).toEqual([3]);
  });

  it('uses three stable palette slots and reports only selected implausible speeds', () => {
    const colours = colourMap([5, 9, 12, 20]);
    expect([...colours]).toEqual([[5, '#2a78d6'], [9, '#eb6834'], [12, '#1baf7a']]);
    expect(implausible([{ ...track(5), speed: [null, 61] }], colours)).toBe(61);
    expect(implausible([{ ...track(5), speed: [59] }], colours)).toBeNull();
    expect(implausible([{ ...track(20), speed: [61] }], colours)).toBeNull();
  });

  it('projects finite ground points and rejects horizon and invalid matrices', () => {
    expect(project(identity, [3, 4])).toEqual([3, 4]);
    for (const w of [-1, 0, 1e-10]) {
      expect(project([[1, 0, 0], [0, 1, 0], [0, 0, w]], [3, 4])).toBeNull();
    }
    expect(project([], [3, 4])).toBeNull();
    expect(project(identity, [Infinity, 4])).toBeNull();
  });

  it('projects entire closed zones and named edges, dropping horizon-crossing polygons', () => {
    expect(groundZones(null, configuration)).toEqual([]);
    const zones = groundZones({ ground_from_pixel: identity }, configuration);
    expect(zones).toEqual([
      { zone: 'crossing', kind: 'zone', label: 'crossing', points: [...polygon, polygon[0]] },
      { zone: 'crossing:near_kerb', kind: 'edge', label: 'near kerb', points: polygon.slice(0, 2) },
    ]);
    const cfg = { regions: { rois: [
      { id: 'bad', points: [[0, -1], [1, 2], [0, 2]] },
      { id: 'good', points: [[0, 1], [1, 2], [0, 2], [0, 1]] },
    ] } };
    const result = groundZones({ ground_from_pixel: [[1, 0, 0], [0, 1, 0], [0, 1, 0]] }, cfg);
    expect(result.map(z => z.zone)).toEqual(['good']);
    expect(result[0].points).toHaveLength(4);
  });

  it('orients camera ground coordinates without changing metre distances', () => {
    expect(cameraView({}, [1920, 1080])).toBeNull();
    expect(cameraView({ ground_from_pixel: identity }, null)).toBeNull();
    const view = cameraView({ ground_from_pixel: identity }, [100, 100])!;
    expect(view(50, 100)).toEqual([0, 0]);
    expect(view(60, 80)).toEqual([10, 20]);
    const mirror = cameraView({ ground_from_pixel: [[-2, 0, 0], [0, 2, 0], [0, 0, 1]] }, [100, 100])!;
    expect(mirror(-120, 160)).toEqual([20, 40]);
  });

  it('pads domains and bounds every point by coordinate distance', () => {
    expect(padded([10, 20])).toEqual([8, 22]);
    expect(padded([0, 100])).toEqual([-15, 115]);
    expect(within([[200, 200], [-200, -200]], [0, 0])).toBe(true);
    expect(within([[201, 0]], [0, 0])).toBe(false);
    expect(within([], [0, 0])).toBe(false);
  });

  it('places labels in deterministic top order, nudging overlaps and clamping width', () => {
    const labels = [{ x: 95, y: 30, w: 20, h: 10 }, { x: 95, y: 30, w: 20, h: 10 }];
    const before = structuredClone(labels);
    const placed = placeLabels(labels, 100);
    expect(placed[0].y).not.toBe(placed[1].y);
    expect(placed.every((p, i) => p.x + labels[i].w <= 100)).toBe(true);
    expect(labels).toEqual(before);
  });
});

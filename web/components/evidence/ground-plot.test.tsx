import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GroundPlot } from './ground-plot';
import { BoxesOverlay } from './boxes-overlay';
import { colourMap, type Track } from '@/lib/evidence';

const track: Track = {
  trackId: 7, kind: 'vehicle', frameIdxs: [0, 100],
  bboxes: [[10, 20, 50, 60], [20, 30, 60, 70]],
  trajectory: [[0, 0], [10, 10]], speed: [12.3, 14],
};
const colours = new Map([[7, '#2a78d6']]);

describe('evidence presentation', () => {
  it('marks the nearest valid path point even beyond the box sample cutoff', () => {
    const html = renderToStaticMarkup(<GroundPlot tracks={[track]} colours={colours} fps={10} violationT={8} zones={[]} view={null} />);
    expect(html).toContain('veh #7 at 10.00 s');
    expect(html).toContain('ground plane x (m)');
    expect(html).toContain('ground plane y (m)');
  });

  it('shows the calibration empty state for tracks without positions', () => {
    const html = renderToStaticMarkup(<GroundPlot tracks={[{ ...track, trajectory: [] }]} colours={colours} fps={10} zones={[]} view={null} />);
    expect(html).toContain('No positions available');
  });

  it('turns paths and zones together and excludes distant projected zones', () => {
    const html = renderToStaticMarkup(<GroundPlot tracks={[track]} colours={colours} fps={10} zones={[
      { zone: 'near', kind: 'zone', label: 'crossing', points: [[0, 0], [10, 0], [0, 0]] },
      { zone: 'far', kind: 'zone', label: 'distant crossing', points: [[500, 500], [600, 500]] },
    ]} view={(x, y) => [-y, x]} />);
    expect(html).toContain('across the picture (m)');
    expect(html).toContain('<title>crossing</title>');
    expect(html).not.toContain('distant crossing');
  });

  it('uses source coordinates and labels only selected users and the violator', () => {
    const other = { ...track, trackId: 8 };
    const html = renderToStaticMarkup(<BoxesOverlay src="/frame.jpg" tracks={[track, other]} frame={0} sourceSize={[1920, 1080]} colours={colours} violatorId={7} />);
    expect(html).toContain('viewBox="0 0 1920 1080"');
    expect(html).toContain('veh #7 · judged 12.3 m/s');
    const found = renderToStaticMarkup(<BoxesOverlay src="/frame.jpg" tracks={[track, other]} frame={0} sourceSize={[1920, 1080]} colours={colourMap([8])} violatorId={7} involvedIds={[8]} />);
    expect(found).toContain('veh #8 · involved');
    expect(html).not.toContain('veh #8');
    expect(html).toContain('#94a3b8');
  });

  it('refuses an unsafe API image URL', () => {
    const html = renderToStaticMarkup(<BoxesOverlay src="javascript:alert(1)" tracks={[]} colours={colours} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('URL is unavailable');
  });
});

import { describe, expect, it } from 'vitest';
import { summarise } from './overview';
import type { Run, Site, ViolationSummary } from './types';

const sites: Site[] = [
  { id: 'a', name: 'Camera', created_at: '', updated_at: '', source: { kind: 'stream' } as Site['source'] },
  { id: 'b', name: 'Camera', created_at: '', updated_at: '' },
];
const violation = (status: string, detected_at: string): ViolationSummary => ({
  id: status, site_id: 'a', run_id: 'run', type: 'speeding',
  explanation_status: status, detected_at, created_at: '', updated_at: '',
});

describe('summarise', () => {
  it('counts violations apart from observations, UTC days, and every site independently of duplicate names', () => {
    const result = summarise(sites, [
      violation('detected', '2026-11-01T18:00:00Z'),
      violation('explained', '2026-11-01T20:00:00Z'),
      violation('pending', '2026-11-01T16:00:00Z'),
      { ...violation('detected', '2026-11-01T17:00:00Z'), observation: true },
    ], [{ status: 'queued' }, { status: 'failed' }] as Run[]);
    expect(result.tiles).toEqual({
      sites: 2, streams: 1, violations: 3, observations: 1, confirmed: 0, awaiting: 1, reviewed: 1,
      pending: 1, failed: 0, busy: 1, failedRuns: 1,
    });
    expect(result.perDay).toEqual([
      { day: '2026-11-01', count: 3 },
    ]);
    expect(result.bySite).toEqual([{ site: 'Camera', count: 3 }, { site: 'Camera', count: 0 }]);
  });

  it('fills zero days between first and last detection', () => {
    expect(summarise(sites, [
      violation('detected', '2026-10-31T18:00:00Z'),
      violation('failed', '2026-11-02T18:00:00Z'),
    ], []).perDay).toEqual([
      { day: '2026-10-31', count: 1 },
      { day: '2026-11-01', count: 0 },
      { day: '2026-11-02', count: 1 },
    ]);
  });

  it('keeps empty sites with zero counts and no invented days', () => {
    const result = summarise(sites, [], []);
    expect(result.perDay).toEqual([]);
    expect(result.bySite.map(row => row.count)).toEqual([0, 0]);
    expect(result.tiles.violations).toBe(0);
  });
});

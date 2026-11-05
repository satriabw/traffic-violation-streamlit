import { describe, expect, it } from 'vitest';
import { drawnSize } from './regions';
import type { Source } from './types';

describe('region coordinate space', () => {
  const source = { metadata: { resolution: { width: 1920, height: 1080 } } } as Source;
  it('prefers configuration coordinates, then falls back to source resolution', () => {
    expect(drawnSize({ camera: { width: 640, height: 480 } }, source)).toEqual([640, 480]);
    expect(drawnSize({}, source)).toEqual([1920, 1080]);
    expect(drawnSize({ camera: { width: -1, height: 480 } }, source)).toEqual([1920, 1080]);
    expect(drawnSize(null, null)).toBeNull();
  });
});

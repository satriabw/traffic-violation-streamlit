import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedFeedUrl, ffmpegArgs, reachable } from './feed';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';
afterEach(() => vi.resetAllMocks());
describe('feed URLs', () => {
  it.each(['file:///etc/passwd', 'concat:a|b', 'gopher://x', 'not a url', 'http://x\n'])('refuses %s', value => expect(allowedFeedUrl(value)).toBeNull());
  it('allows camera URLs and limits ffmpeg protocols before input', () => {
    expect(allowedFeedUrl('rtsp://cam/1')?.hostname).toBe('cam');
    const args = ffmpegArgs(new URL('rtsp://cam/1'));
    expect(args).toContain('-rtsp_transport');
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('-i'));
    expect(ffmpegArgs(new URL('https://cam/1'))).not.toContain('-rtsp_transport');
  });
  it('falls back only on lookup failure, preserving credentials, port and path', async () => {
    vi.mocked(lookup).mockRejectedValueOnce(new Error('DNS'));
    expect((await reachable(new URL('rtsp://user:pass@tv-rtsp:8554/live'))).href).toBe('rtsp://user:pass@127.0.0.1:8554/live');
    vi.mocked(lookup).mockResolvedValueOnce({ address: '10.0.0.1', family: 4 });
    expect((await reachable(new URL('rtsp://cam/live'))).hostname).toBe('cam');
  });
});

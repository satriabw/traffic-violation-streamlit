import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('@/lib/feed', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/feed')>(), reachable: vi.fn(async (url: URL) => url) }));
import { spawn } from 'node:child_process';
import { reachable } from '@/lib/feed';
import { GET } from './route';

const site = '12345678-1234-1234-1234-123456789abc';
const children: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn<() => boolean>> })[] = [];
const fetchMock = vi.fn();
const request = (signal?: AbortSignal) => new Request(`http://console/feed?site=${site}`, { signal });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(Response.json({ kind: 'stream', stream_url: 'rtsp://cam/live' }));
  // Each request needs its own consumable response body.
  fetchMock.mockImplementation(async () => Response.json({ kind: 'stream', stream_url: 'rtsp://cam/live' }));
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    child.kill.mockImplementation(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit('close', null, 'SIGKILL');
      return true;
    });
    children.push(child);
    return child as unknown as ReturnType<typeof spawn>;
  });
});
afterEach(() => {
  children.splice(0).forEach(child => child.kill());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('feed route', () => {
  it('rejects invalid site ids before contacting the API', async () => {
    expect((await GET(new Request('http://console/feed?site=../x'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns 404 for video and missing sources', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ kind: 'video' }));
    expect((await GET(request())).status).toBe(404);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(request())).status).toBe(404);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('rejects unsafe stored URLs without spawning', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ kind: 'stream', stream_url: 'file:///etc/passwd' }));
    expect((await GET(request())).status).toBe(422);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('limits concurrent viewers and frees the slot on cancellation', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => GET(request())));
    expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200, 429]);
    await responses[0].body!.cancel();
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect((await GET(request())).status).toBe(200);
  });
  it('reserves slots during pending DNS lookups', async () => {
    let resolve!: (url: URL) => void;
    vi.mocked(reachable).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = GET(request());
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    const others = await Promise.all(Array.from({ length: 4 }, () => GET(request())));
    expect(others.map(r => r.status)).toEqual([200, 200, 200, 429]);
    resolve(new URL('rtsp://cam/live'));
    expect((await pending).status).toBe(200);
  });
  it('streams bytes and kills the child when the viewer aborts', async () => {
    const abort = new AbortController();
    const response = await GET(request(abort.signal));
    expect(response.headers.get('content-type')).toContain('boundary=ffmpeg');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const reader = response.body!.getReader();
    children[0].stdout.write(Buffer.from('jpeg'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('jpeg');
    abort.abort();
    expect(children[0].kill).toHaveBeenCalled();
    expect((await reader.read()).done).toBe(true);
  });
  it('releases failed spawn slots and returns a readable stream error', async () => {
    const response = await GET(request());
    children[0].emit('error', new Error('ENOENT'));
    await expect(response.body!.getReader().read()).rejects.toThrow('could not start');
    expect((await GET(request())).status).toBe(200);
  });
});

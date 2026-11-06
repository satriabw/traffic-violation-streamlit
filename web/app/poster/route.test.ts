import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { GET } from './route';
const site = '12345678-1234-1234-1234-123456789abc';
const file = '12345678-1234-1234-1234-123456789def';
const fetchMock = vi.fn();
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
let counter = 0;
let source: string;
function request(signal?: AbortSignal) { return new Request(`http://console/poster?site=${site}&source=${source}`, { signal }); }
beforeEach(() => {
  source = `12345678-1234-1234-1234-${String(++counter).padStart(12, '0')}`;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/sources') ? Response.json({ id: source, kind: 'video', file_id: file }) : Response.json({ download_url: '/api/v1/storage/video/clip.mp4' }));
  child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });
describe('video posters', () => {
  it('rejects invalid identifiers, source changes and non-video sources without spawning', async () => {
    expect((await GET(new Request('http://console/poster?site=../file'))).status).toBe(400);
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'changed', kind: 'video' }));
    expect((await GET(request())).status).toBe(409);
    fetchMock.mockResolvedValueOnce(Response.json({ id: source, kind: 'stream' }));
    expect((await GET(request())).status).toBe(404); expect(spawn).not.toHaveBeenCalled();
  });
  it('only decodes an HTTP(S) URL obtained from the stored file', async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/sources') ? Response.json({ id: source, kind: 'video', file_id: file }) : Response.json({ download_url: 'file:///etc/passwd' }));
    expect((await GET(request())).status).toBe(422); expect(spawn).not.toHaveBeenCalled();
  });
  it('returns a JPEG and reuses the bounded cache on repeated requests', async () => {
    const pending = GET(request()); await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); child.emit('close', 0);
    const response = await pending;
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=600');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 217]));
    expect((await GET(request())).status).toBe(200); expect(spawn).toHaveBeenCalledOnce();
    const args = vi.mocked(spawn).mock.calls[0][1]!;
    expect(args).toContain('-protocol_whitelist'); expect(args).toContain('http://localhost:8001/api/v1/storage/video/clip.mp4');
  });
  it('kills the process when the requesting viewer disconnects', async () => {
    const abort = new AbortController(); const pending = GET(request(abort.signal));
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce()); abort.abort();
    expect((await pending).status).toBe(499); expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('kills a stalled preview after fifteen seconds', async () => {
    vi.useFakeTimers(); const pending = GET(request());
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce()); await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).status).toBe(502); expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('handles missing ffmpeg without leaving a pending request', async () => {
    const pending = GET(request()); await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce()); child.emit('error', new Error('ENOENT'));
    expect((await pending).status).toBe(502);
  });
});

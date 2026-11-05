import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { allowedFeedUrl, ffmpegArgs, MAX_FEEDS, reachable } from '@/lib/feed';
import type { Source } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const running = new Set<symbol>();
const message = (status: number, detail: string) => Response.json({ detail }, { status });

export async function GET(request: Request): Promise<Response> {
  const site = new URL(request.url).searchParams.get('site') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(site)) return message(400, 'Choose a valid site.');
  let source: Source;
  try {
    const base = (process.env.API_BASE_URL || 'http://localhost:8001').replace(/\/$/, '');
    const response = await fetch(`${base}/api/v1/sites/${site}/sources`, { cache: 'no-store', signal: request.signal });
    if (response.status === 404) return message(404, 'No live source is attached.');
    if (!response.ok) return message(502, 'Could not read the site’s source.');
    source = await response.json();
  } catch {
    return message(request.signal.aborted ? 499 : 502, 'Could not reach the API.');
  }
  if (!source || source.kind !== 'stream') return message(404, 'No live source is attached.');
  const url = allowedFeedUrl(source.stream_url ?? '');
  if (!url) return message(422, 'The feed URL is not supported.');
  if (running.size >= MAX_FEEDS) return message(429, 'Four feeds are already being watched. Close one and try again.');
  // Reserve before DNS lookup so simultaneous requests cannot exceed the limit.
  const token = Symbol();
  running.add(token);
  try {
    const input = await reachable(url);
    if (request.signal.aborted) { running.delete(token); return message(499, 'The viewer disconnected.'); }
    const child = spawn('ffmpeg', ffmpegArgs(input), { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.resume();
    const reader = (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>).getReader();
    let stopped = false;
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const release = () => { running.delete(token); request.signal.removeEventListener('abort', stop); };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.kill('SIGKILL');
      void reader.cancel().catch(() => {});
      if (!closed) { closed = true; controller?.close(); }
    };
    child.once('close', release);
    child.once('error', () => {
      release();
      if (!closed) { closed = true; controller?.error(new Error('The live feed could not start. Check ffmpeg and the source.')); }
    });
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        request.signal.addEventListener('abort', stop, { once: true });
        if (request.signal.aborted) stop();
      },
      async pull() {
        try {
          const result = await reader.read();
          if (closed) return;
          if (result.done) { closed = true; controller.close(); }
          else controller.enqueue(result.value);
        } catch {
          if (!closed) { closed = true; controller.error(new Error('The live feed ended.')); }
          stop();
        }
      },
      cancel() { closed = true; stop(); },
    });
    return new Response(body, { headers: {
      'Content-Type': 'multipart/x-mixed-replace;boundary=ffmpeg',
      'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no',
    } });
  } catch {
    running.delete(token);
    return message(502, 'The live feed could not start. Check ffmpeg and the source.');
  }
}

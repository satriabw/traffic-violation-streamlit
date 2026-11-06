import { spawn } from 'node:child_process';
import type { Source, FileRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cache = new Map<string, { bytes: Uint8Array; expires: number }>();
let active = 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const message = (status: number, detail: string) => Response.json({ detail }, { status });

function frame(url: URL, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
      '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-i', url.href,
      '-frames:v', '1', '-vf', 'scale=1280:-2:force_original_aspect_ratio=decrease', '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) { child.kill('SIGKILL'); reject(error); }
      else if (size) resolve(new Uint8Array(Buffer.concat(chunks)));
      else reject(new Error('No preview frame was returned.'));
    };
    const abort = () => finish(new Error('Preview cancelled.'));
    const timer = setTimeout(() => finish(new Error('Preview timed out.')), 15_000);
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) finish(new Error('Preview exceeds size limit.'));
      else chunks.push(chunk);
    });
    child.once('error', error => finish(error));
    child.once('close', code => finish(code === 0 ? undefined : new Error('Could not decode a preview frame.')));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const site = query.get('site') ?? '';
  const sourceId = query.get('source') ?? '';
  if (!uuid.test(site) || !uuid.test(sourceId)) return message(400, 'Choose a valid site and source.');
  const base = (process.env.API_BASE_URL || 'http://localhost:8001').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/api/v1/sites/${site}/sources`, { cache: 'no-store', signal: request.signal });
    if (response.status === 404) return message(404, 'No video is attached.');
    if (!response.ok) return message(502, 'Could not read the video source.');
    const source: Source = await response.json();
    if (source.id !== sourceId) return message(409, 'The source has changed. Reload to see its preview.');
    if (source.kind !== 'video' || !source.file_id || !uuid.test(source.file_id)) return message(404, 'No video preview is available.');
    const cached = cache.get(source.id);
    let bytes = cached && cached.expires > Date.now() ? cached.bytes : undefined;
    if (!bytes) {
      if (active >= 4) return message(429, 'Previews are busy. Try again shortly.');
      active++;
      try {
        const fileResponse = await fetch(`${base}/api/v1/files/${source.file_id}`, { cache: 'no-store', signal: request.signal });
        if (!fileResponse.ok) return message(502, 'Could not read the video file.');
        const file: FileRow = await fileResponse.json();
        if (!file.download_url) return message(404, 'No video preview is available.');
        const url = new URL(file.download_url, `${base}/`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\\\u0000-\u0020\u007f]/.test(file.download_url)) return message(422, 'The video URL is not supported.');
        bytes = await frame(url, request.signal);
        if (cache.size >= 32) cache.delete(cache.keys().next().value!);
        cache.set(source.id, { bytes, expires: Date.now() + 600_000 });
      } finally { active--; }
    }
    return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return message(request.signal.aborted ? 499 : 502, 'The video preview could not be created.');
  }
}

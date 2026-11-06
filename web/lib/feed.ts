// Server-only: used by the Node feed route, never by client components.
import { lookup } from 'node:dns/promises';

export const MAX_FEEDS = 4;
export function allowedFeedUrl(value: string): URL | null {
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['rtsp:', 'rtsps:', 'http:', 'https:'].includes(url.protocol) && url.hostname ? url : null;
  } catch { return null; }
}

export async function reachable(url: URL): Promise<URL> {
  const result = new URL(url.href);
  try { await lookup(result.hostname.replace(/^\[|\]$/g, '')); }
  catch { result.hostname = '127.0.0.1'; }
  return result;
}

export function ffmpegArgs(url: URL): string[] {
  return ['-hide_banner', '-loglevel', 'error',
    ...(['rtsp:', 'rtsps:'].includes(url.protocol) ? ['-rtsp_transport', 'tcp'] : []),
    '-protocol_whitelist', 'rtsp,rtsps,rtp,udp,tcp,tls,http,https',
    '-i', url.href, '-vf', 'fps=2', '-q:v', '5', '-f', 'mpjpeg', '-'];
}

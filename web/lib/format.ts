import type { Source, Run } from './types';
export function safeUrl(url?: string | null): string | undefined {
  if (!url || /[\\\u0000-\u0020\u007f-\u009f]/.test(url)) {
    return undefined;
  }
  if (url.startsWith('/')) {
    return url.startsWith('//') ? undefined : url;
  }
  if (!/^https?:\/\//i.test(url)) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? url : undefined;
  }
  catch {
    return undefined;
  }
}

export function unescapeText<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})/g, (raw, high, low, single) => {
      if (high) {
        return String.fromCodePoint(0x10000 + ((parseInt(high, 16) - 0xd800) << 10) + parseInt(low, 16) - 0xdc00);
      }
      const code = parseInt(single, 16);
      return code >= 0xd800 && code <= 0xdfff ? raw : String.fromCharCode(code);
    }) as T;
  }
  if (Array.isArray(value)) {
    return value.map(unescapeText) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unescapeText(v)])) as T;
  }
  return value;
}

export function ts(iso?: string | null, withSeconds = true): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    timeZoneName: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? {
      second: '2-digit'
    } : {}),
    hour12: false
  }).format(date);
}

export function bytesHuman(n?: number | null): string {
  if (!n) {
    return '—';
  }
  let size = n;
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (size < 1024 || unit === 'GB') {
      return `${size.toFixed(unit === 'B' ? 0 : 1)} ${unit}`;
    }
    size /= 1024;
  }
  return '—';
}

function clock(seconds: number): string {
  const n = Math.round(seconds);
  const h = Math.floor(n / 3600);
  const m = Math.floor(n % 3600 / 60);
  const s = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function frameTime(frame?: number | null, fps?: number | null): string {
  if (frame == null) {
    return '—';
  }
  return `frame ${frame}${fps && fps > 0 ? ` · ${clock(frame / fps)}` : ''}`;
}

function timing(source?: Source | null) {
  const fps = source?.kind === 'video' ? source.metadata?.fps : null;
  return fps && fps > 0 ? {
    fps,
    start: source?.recorded_at ? Date.parse(source.recorded_at) : NaN
  } : null;
}

export function eventTime(source: Source | null | undefined, frame: number | null | undefined, detectedAt?: string | null): string {
  const t = timing(source);
  if (t && frame != null) {
    const offset = frame / t.fps;
    return Number.isFinite(t.start) ? ts(new Date(t.start + offset * 1000).toISOString()) : `${clock(offset)} into the video`;
  }
  return detectedAt ? `≈ ${ts(detectedAt)}` : '—';
}

export function runSpan(source: Source | null | undefined, run: Pick<Run, 'frame_start' | 'frame_end'>): string {
  if (run.frame_start == null) {
    return 'whole video';
  }
  const t = timing(source);
  if (!t || run.frame_end == null) {
    return `frames ${run.frame_start}–${run.frame_end ?? '—'}`;
  }
  const a = run.frame_start / t.fps, b = run.frame_end / t.fps;
  return Number.isFinite(t.start) ? `${ts(new Date(t.start + a * 1000).toISOString())}–${ts(new Date(t.start + b * 1000).toISOString()).split(', ')[1]}` : `${clock(a)}–${clock(b)} of the video`;
}

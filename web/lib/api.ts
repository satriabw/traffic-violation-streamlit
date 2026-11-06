import { safeUrl } from './format';
import type { FileRow, FileType, Page, Site, StreamEvent } from './types';
export const CHAT_ENABLED = ['1', 'true', 'yes'].includes((process.env.NEXT_PUBLIC_CHAT_ENABLED ?? '').toLowerCase());
const UNREACHABLE = 'Could not reach the API. Is the stack up? `docker compose up api` in the traffic-violation repo.';
export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
    this.name = 'ApiError';
  }
}

async function checkedFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  }
  catch (e) {
    if (e instanceof TypeError) {
      throw new ApiError(0, UNREACHABLE);
    }
    throw e;
  }
}

async function detailOf(res: Response): Promise<string> {
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  }
  catch {
    return res.status >= 500 ? UNREACHABLE : text.slice(0, 400) || res.statusText;
  }
  const detail = body?.detail ?? body;
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail)) {
    const parts = detail.map(item => {
      if (typeof item !== 'object' || item === null) {
        return String(item);
      }
      const location = item.loc?.slice(1).join(' → ');
      return [location, item.msg].filter(Boolean).join(': ');
    });
    return parts.join('; ') || JSON.stringify(body);
  }
  return JSON.stringify(detail);
}

async function ensureOk(res: Response) {
  if (!res.ok) {
    throw new ApiError(res.status, await detailOf(res));
  }
}

function apiPath(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(path)) {
    throw new ApiError(400, 'Invalid API path');
  }
  return `/api/v1${path}`;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await checkedFetch(apiPath(path), {
    method,
    headers: body === undefined ? undefined : {
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  await ensureOk(res);
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
export const del = (path: string) => request<void>('DELETE', path);
export async function getOrNull<T>(path: string, when: (e: ApiError) => boolean = e => e.status === 404): Promise<T | null> {
  try {
    return await get<T>(path);
  }
  catch (e) {
    if (e instanceof ApiError && when(e)) {
      return null;
    }
    throw e;
  }
}

export async function allSites(): Promise<Site[]> {
  const items: Site[] = [];
  let offset = 0;
  for (;;) {
    const page = await get<Page<Site>>(`/sites?limit=100&offset=${offset}`);
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || !page.items.length) {
      return items;
    }
  }
}

export function signedHeaders(url: string): Set<string> {
  return new Set((new URL(url, 'http://console.local').searchParams.get('X-Amz-SignedHeaders') ?? '').toLowerCase().split(';').filter(Boolean));
}

export async function upload(file: File, type: FileType): Promise<FileRow> {
  const row = await post<FileRow>('/files', {
    name: file.name,
    type,
    size_bytes: file.size,
    content_type: file.type || null
  });
  const url = safeUrl(row.upload_url);
  if (!url) {
    throw new ApiError(400, 'The API returned an invalid upload URL.');
  }
  let res: Response;
  if (signedHeaders(url).has('content-type')) {
    if (!file.type) {
      throw new ApiError(400, 'This upload requires a file content type.');
    }
    res = await checkedFetch(url, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type
      },
      credentials: 'same-origin'
    });
  }
  else {
    const absolute = new URL(url, globalThis.location?.origin ?? 'http://localhost');
    const req = new Request(absolute, {
      method: 'PUT',
      body: file,
      credentials: 'same-origin'
    });
    req.headers.delete('Content-Type');
    res = await checkedFetch(req);
  }
  await ensureOk(res);
  return post<FileRow>(`/files/${encodeURIComponent(row.id)}/complete`);
}

export function parseSse(text: string): {
  events: StreamEvent[];
  rest: string;
} {
  const events: StreamEvent[] = [];
  const boundary = /\r?\n\r?\n/g;
  let start = 0;
  let match;
  while ((match = boundary.exec(text)) !== null) {
    const block = text.slice(start, match.index);
    start = boundary.lastIndex;
    let kind = '';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        kind = line.slice(6).trim();
      }
      else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (kind === 'replay') {
      events.push({
        type: 'replay'
      });
    }
    else if (data.join('\n').trim()) {
      events.push(JSON.parse(data.join('\n')) as StreamEvent);
    }
  }
  return {
    events,
    rest: text.slice(start)
  };
}

export async function streamEvents(path: string, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await checkedFetch(apiPath(path), {
    headers: {
      Accept: 'text/event-stream'
    },
    signal
  });
  await ensureOk(res);
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      const parsed = parseSse(rest + decoder.decode(value, {
        stream: !done
      }));
      rest = parsed.rest;
      parsed.events.forEach(onEvent);
      if (done) {
        break;
      }
    }
  }
  catch (e) {
    if (e instanceof TypeError) {
      throw new ApiError(0, UNREACHABLE);
    }
    throw e;
  }
  finally {
    try {
      await reader.cancel();
    }
    finally {
      reader.releaseLock();
    }
  }
}

export async function readEvents(path: string): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await streamEvents(path, e => events.push(e));
  return events;
}

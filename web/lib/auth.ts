import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'console_session';
export const SESSION_SECONDS = 8 * 60 * 60;

export function credentials() {
  const user = process.env.CONSOLE_USER;
  const password = process.env.CONSOLE_PASSWORD;
  return user && password ? { user, password } : null;
}

export function matches(value: string, expected: string) {
  const a = createHash('sha256').update(value).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function signature(payload: string) {
  const config = credentials();
  if (!config) throw new Error('Console credentials are not configured');
  const key = createHash('sha256').update(JSON.stringify([config.user, config.password])).digest();
  return createHmac('sha256', key).update(`console-session-v1:${payload}`).digest('base64url');
}

export function createSession(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ expires: now + SESSION_SECONDS * 1000, nonce: randomUUID() })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function validSession(value?: string, now = Date.now()) {
  if (!value || value.length > 1024 || !credentials()) return false;
  const parts = value.split('.');
  if (parts.length !== 2 || !matches(parts[1], signature(parts[0]))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return typeof payload.expires === 'number' && payload.expires > now && payload.expires <= now + SESSION_SECONDS * 1000;
  } catch { return false; }
}

export { loginDestination } from './navigation';

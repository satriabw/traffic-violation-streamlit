import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, loginDestination, matches, SESSION_SECONDS, validSession } from './auth';

describe('console sessions', () => {
  beforeEach(() => { vi.stubEnv('CONSOLE_USER', 'operator'); vi.stubEnv('CONSOLE_PASSWORD', 'pä:ss'); });
  afterEach(() => vi.unstubAllEnvs());
  it('validates signed sessions, rejects tampering, and expires after eight hours', () => {
    const now = Date.now();
    const value = createSession(now);
    expect(validSession(value, now)).toBe(true);
    expect(validSession(value + 'x', now)).toBe(false);
    expect(validSession('forged.cookie', now)).toBe(false);
    expect(validSession(value, now + SESSION_SECONDS * 1000)).toBe(false);
    expect(validSession(undefined)).toBe(false);
    expect(validSession('a.b.c')).toBe(false);
  });
  it('invalidates sessions after credential rotation or missing configuration', () => {
    const value = createSession();
    vi.stubEnv('CONSOLE_PASSWORD', 'changed');
    expect(validSession(value)).toBe(false);
    vi.stubEnv('CONSOLE_PASSWORD', 'pä:ss');
    vi.stubEnv('CONSOLE_USER', 'someone-else');
    expect(validSession(value)).toBe(false);
    delete process.env.CONSOLE_PASSWORD;
    expect(validSession(value)).toBe(false);
  });
  it('creates unique cookies without putting credentials in the payload', () => {
    const a = createSession(), b = createSession();
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split('.')[0], 'base64url').toString()).not.toContain('pä:ss');
    expect(matches('pä:ss', 'pä:ss')).toBe(true);
    expect(matches('pä:ss', 'wrong')).toBe(false);
  });
  it('keeps local destinations and refuses open redirects and login loops', () => {
    expect(loginDestination('/chat?site=abc&violation=def')).toBe('/chat?site=abc&violation=def');
    for (const value of [undefined, '//evil.test', '/\\evil.test', 'https://evil.test', '/login', '/api/v1/sites', '/auth/logout', '/a/../login', '/feed', '/health']) expect(loginDestination(value)).toBe('/');
  });
});

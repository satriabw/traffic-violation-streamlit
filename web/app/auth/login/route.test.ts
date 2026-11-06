import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, validSession } from '@/lib/auth';
import { POST } from './route';
import { POST as logout } from '../logout/route';

function request(body: unknown, site = 'same-origin', url = 'http://localhost/auth/login') {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': site }, body: JSON.stringify(body) });
}
describe('login and logout', () => {
  beforeEach(() => { vi.stubEnv('CONSOLE_USER', 'operator'); vi.stubEnv('CONSOLE_PASSWORD', 'pä:ss'); });
  afterEach(() => vi.unstubAllEnvs());
  it('sets an HttpOnly session cookie and never returns credentials', async () => {
    const response = await POST(request({ username: 'operator', password: 'pä:ss' }));
    expect(response.status).toBe(200);
    expect(validSession(response.cookies.get(SESSION_COOKIE)?.value)).toBe(true);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Max-Age=28800');
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('uses Secure cookies over HTTPS', async () => {
    const response = await POST(request({ username: 'operator', password: 'pä:ss' }, 'same-origin', 'https://console.test/auth/login'));
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });
  it('rejects wrong or missing credentials without setting a cookie', async () => {
    for (const body of [{ username: 'operator', password: 'wrong' }, { username: 'wrong', password: 'pä:ss' }]) {
      const response = await POST(request(body)); expect(response.status).toBe(401); expect(response.cookies.has(SESSION_COOKIE)).toBe(false);
    }
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request(null))).status).toBe(400);
  });
  it('protects login and logout from cross-site requests', async () => {
    expect((await POST(request({ username: 'operator', password: 'pä:ss' }, 'cross-site'))).status).toBe(403);
    expect(logout(request({}, 'cross-site')).status).toBe(403);
  });
  it('clears the cookie on logout', () => {
    const response = logout(request({}));
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe('');
  });
  it('bounds repeated failed attempts', async () => {
    // Reset failure count with a successful sign-in, then exhaust this process window.
    await POST(request({ username: 'operator', password: 'pä:ss' }));
    for (let i = 0; i < 10; i++) expect((await POST(request({ username: 'operator', password: 'bad' }))).status).toBe(401);
    const response = await POST(request({ username: 'operator', password: 'bad' }));
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60');
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61_000);
    expect((await POST(request({ username: 'operator', password: 'pä:ss' }))).status).toBe(200);
    vi.useRealTimers();
  });
});

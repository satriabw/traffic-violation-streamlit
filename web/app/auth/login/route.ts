import { NextRequest, NextResponse } from 'next/server';
import { createSession, credentials, matches, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/auth';

export const runtime = 'nodejs';
// One operator account: bound failed attempts per process without retaining passwords or IPs.
let failures = 0;
let resetAt = 0;

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return NextResponse.json({ error: 'Cross-origin request refused' }, { status: 403, headers });
  const config = credentials();
  if (!config) return NextResponse.json({ error: 'Console credentials are not configured' }, { status: 503, headers });
  if (Date.now() >= resetAt) { failures = 0; resetAt = Date.now() + 60_000; }
  if (failures >= 10) return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429, headers: { ...headers, 'Retry-After': '60' } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400, headers }); }
  const { username, password } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 1024 || password.length > 4096) return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400, headers });
  const userMatches = matches(username, config.user);
  const passwordMatches = matches(password, config.password);
  if (!userMatches || !passwordMatches) {
    failures++;
    return NextResponse.json({ error: 'The username or password is incorrect.' }, { status: 401, headers });
  }
  failures = 0;
  const response = NextResponse.json({ ok: true }, { headers });
  response.cookies.set(SESSION_COOKIE, createSession(), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS,
    secure: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
  });
  return response;
}

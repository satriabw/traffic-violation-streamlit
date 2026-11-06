import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return new NextResponse('Cross-origin request refused', { status: 403 });
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0, secure: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https' });
  return response;
}

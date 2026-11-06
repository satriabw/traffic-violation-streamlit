import { NextRequest, NextResponse } from 'next/server';
import { credentials, loginDestination, matches, SESSION_COOKIE, validSession } from '@/lib/auth';

export function proxy(request: NextRequest): Response | undefined {
  const config = credentials();
  if (!config) return new NextResponse('Console credentials are not configured', { status: 503 });
  const path = request.nextUrl.pathname;
  const publicRoute = path === '/icon.svg' || path === '/login' || path === '/auth/login' || path === '/auth/logout';
  const authorization = request.headers.get('authorization');
  const expected = 'Basic ' + Buffer.from(`${config.user}:${config.password}`, 'utf8').toString('base64');
  const basicClient = !request.headers.has('sec-fetch-mode');
  const authenticated = (basicClient && authorization !== null && matches(authorization, expected)) || validSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!publicRoute && !authenticated) {
    if (['GET', 'HEAD'].includes(request.method) && !path.startsWith('/api/') && path !== '/feed' && path !== '/poster' && path !== '/health') {
      const target = new URL('/login', request.url);
      target.searchParams.set('next', loginDestination(`${path}${request.nextUrl.search}`));
      return NextResponse.redirect(target);
    }
    return new NextResponse('Authentication required', { status: 401 });
  }
  if (path.startsWith('/api/') && /\.\.|%2e|%2f/i.test(path)) return new NextResponse('Invalid API path', { status: 400 });
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('sec-fetch-site') !== 'same-origin') {
    return new NextResponse('Cross-origin request refused', { status: 403 });
  }
  return undefined;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

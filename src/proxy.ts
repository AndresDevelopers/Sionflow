import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth-session';
import { verifyFirebaseIdTokenEdge } from '@/lib/firebase-token-edge';

/**
 * Edge/network gate for authenticated app shells (Next.js "proxy" convention).
 * APIs keep their own Bearer/CRON checks — this only protects document navigations.
 *
 * Offline/PWA: cached navigations may be served by the SW without re-hitting this
 * proxy; client PrivateRoute remains the offline UX authority.
 */

const PUBLIC_EXACT = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/app-admin/login',
  '/no-permission',
  '/~offline',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest',
  '/favicon.ico',
  // SEO locale landings (indexable without session)
  '/es',
  '/en',
]);

const PUBLIC_PREFIXES = [
  '/api/',
  '/_next/',
  '/icon',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Static assets in /public
  if (/\.[a-zA-Z0-9]+$/.test(pathname) && !pathname.endsWith('.html')) {
    return true;
  }
  return false;
}

function isUsefulNextPath(pathname: string): boolean {
  if (!pathname || pathname === '/' || pathname === '/login') return false;
  // SEO locale landings are public; after login send users to the app shell (/)
  if (pathname === '/es' || pathname === '/en') return false;
  if (
    pathname === '/register' ||
    pathname === '/forgot-password' ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next')
  ) {
    return false;
  }
  return true;
}

function loginRedirect(request: NextRequest, reason: string): NextResponse {
  const loginUrl = new URL('/login', request.url);
  const { pathname, search } = request.nextUrl;
  if (isUsefulNextPath(pathname)) {
    loginUrl.searchParams.set('next', `${pathname}${search}`);
  }
  loginUrl.searchParams.set('reason', reason);
  const res = NextResponse.redirect(loginUrl);
  // Drop invalid cookie so the client can re-mint after login
  if (reason === 'invalid' || reason === 'missing') {
    res.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Platform admin login is public; panel requires session (below)
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    // Soft-fail for RSC prefetch/data requests to avoid breaking client hydration races
    // right after login before the cookie is written. Full document navigations are gated.
    const purpose = request.headers.get('next-router-prefetch');
    const isRsc = request.headers.get('rsc') === '1' || request.nextUrl.searchParams.has('_rsc');
    if (purpose === '1' || isRsc) {
      // Still allow the shell; PrivateRoute + APIs enforce auth.
      return NextResponse.next();
    }
    return loginRedirect(request, 'missing');
  }

  try {
    await verifyFirebaseIdTokenEdge(token);
    return NextResponse.next();
  } catch {
    const isRsc =
      request.headers.get('rsc') === '1' || request.nextUrl.searchParams.has('_rsc');
    if (isRsc || request.headers.get('next-router-prefetch') === '1') {
      return NextResponse.next();
    }
    return loginRedirect(request, 'invalid');
  }
}

export const config = {
  matcher: [
    /*
     * Run on app routes; skip static/image optimization internals.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

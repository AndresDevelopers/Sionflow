import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth-session';
import {
  isInvalidTokenError,
  verifyFirebaseIdTokenEdge,
} from '@/lib/firebase-token-edge';

/**
 * Edge/network gate for authenticated app shells (Next.js "proxy" convention).
 * APIs keep their own Bearer/CRON checks — this only protects document navigations.
 *
 * Offline/PWA: cached navigations may be served by the SW without re-hitting this
 * proxy; client PrivateRoute remains the offline UX authority.
 *
 * Resilience: only a token the verifier actually rejected sends the user to
 * /login. Verification infrastructure failures (Google JWKS unreachable, missing
 * project config) let the shell through instead of locking the PWA out — every
 * API still validates its own Bearer token and Firestore rules protect data.
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

/** Strip trailing slash except for `/` so /app-admin/login/ stays public. */
function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
}

function isAppAdminPath(pathname: string): boolean {
  return pathname === '/app-admin' || pathname.startsWith('/app-admin/');
}

function isPublicPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (PUBLIC_EXACT.has(path)) return true;
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p) || pathname.startsWith(p))) {
    return true;
  }
  // Static assets in /public
  if (/\.[a-zA-Z0-9]+$/.test(path) && !path.endsWith('.html')) {
    return true;
  }
  return false;
}

function isUsefulNextPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (!path || path === '/' || path === '/login' || path === '/app-admin/login') {
    return false;
  }
  // SEO locale landings are public; after login send users to the app shell (/)
  if (path === '/es' || path === '/en') return false;
  if (
    path === '/register' ||
    path === '/forgot-password' ||
    path.startsWith('/api') ||
    path.startsWith('/_next')
  ) {
    return false;
  }
  return true;
}

/**
 * Unauthenticated document navigations:
 * - Platform admin shell → /app-admin/login (never the ward-member /login)
 * - Everything else → /login
 *
 * Previously /app-admin/panel bounced to /login?next=/app-admin/panel&reason=missing,
 * so operators never saw the admin form and thought login was broken.
 */
function loginRedirect(request: NextRequest, reason: string): NextResponse {
  const { pathname, search } = request.nextUrl;
  const path = normalizePathname(pathname);
  const loginPath = isAppAdminPath(path) ? '/app-admin/login' : '/login';
  const loginUrl = new URL(loginPath, request.url);

  if (isUsefulNextPath(path)) {
    loginUrl.searchParams.set('next', `${path}${search}`);
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
  } catch (error) {
    const isRsc =
      request.headers.get('rsc') === '1' || request.nextUrl.searchParams.has('_rsc');
    if (isRsc || request.headers.get('next-router-prefetch') === '1') {
      return NextResponse.next();
    }
    if (!isInvalidTokenError(error)) {
      // Cannot verify right now (JWKS/network/config). Never clear the cookie or
      // bounce to /login: keep the app usable and let the client + APIs decide.
      console.warn('[proxy] session verification unavailable; allowing shell', error);
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

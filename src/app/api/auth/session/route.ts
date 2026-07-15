import { NextResponse } from 'next/server';
import {
  AuthHttpError,
  getErrorStatus,
  requireUid,
} from '@/lib/api-auth';
import {
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth-session';
import { enforceRateLimit } from '@/lib/rate-limit';

function extractBearer(request: Request): string | null {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * POST /api/auth/session
 * Sets httpOnly cookie with a verified Firebase ID token for Edge middleware.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, 'auth');
  if (limited) return limited;

  try {
    await requireUid(request);
    const token = extractBearer(request);
    if (!token) {
      return NextResponse.json({ error: 'Token requerido.' }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return res;
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (error instanceof AuthHttpError) {
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'No se pudo crear la sesión.' }, { status });
  }
}

/**
 * DELETE /api/auth/session
 * Clears the middleware session cookie (logout).
 */
export async function DELETE(request: Request) {
  const limited = await enforceRateLimit(request, 'auth');
  if (limited) return limited;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return res;
}

/** Soft keep-alive / debug: does not leak uid. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    cookie: SESSION_COOKIE_NAME,
    maxAgeSec: SESSION_COOKIE_MAX_AGE_SEC,
  });
}

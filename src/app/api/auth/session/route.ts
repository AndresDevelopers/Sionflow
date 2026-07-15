import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth-session';
import { verifyFirebaseIdTokenEdge } from '@/lib/firebase-token-edge';
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceededResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * Session cookie bridge for the Next.js proxy.
 *
 * CRITICAL: this route must NOT import firebase-admin (or anything that loads it).
 * Production login was broken because Admin SDK init failures made this endpoint
 * return 500 before the cookie could be set → proxy reason=missing forever.
 *
 * Token verification uses JWKS via jose (same as the proxy gate).
 */

function extractBearer(request: Request): string | null {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** IP-only rate limit — avoids any Firebase Admin dependency on this path. */
function enforceIpRateLimit(request: Request) {
  const identity = `ip:${getClientIp(request)}`;
  const result = checkRateLimit(identity, RATE_LIMITS.auth);
  if (!result.success) {
    return rateLimitExceededResponse(result);
  }
  return null;
}

/**
 * POST /api/auth/session
 * Sets httpOnly cookie with a verified Firebase ID token for the Next.js proxy.
 */
export async function POST(request: Request) {
  const limited = enforceIpRateLimit(request);
  if (limited) return limited;

  try {
    const token = extractBearer(request);
    if (!token) {
      return NextResponse.json({ error: 'Token requerido.' }, { status: 401 });
    }

    // Verify signature + audience/issuer (same checks as proxy)
    await verifyFirebaseIdTokenEdge(token);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return res;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'No se pudo crear la sesión.';
    // 401 for bad tokens; 500 only for unexpected verify infra failures
    const isConfig =
      message.includes('not configured') || message.includes('project id');
    const status = isConfig ? 503 : 401;
    return NextResponse.json(
      {
        error: isConfig
          ? 'Configuración de Firebase incompleta en el servidor.'
          : 'Token inválido o expirado.',
        detail: process.env.NODE_ENV === 'development' ? message : undefined,
      },
      { status }
    );
  }
}

/**
 * DELETE /api/auth/session
 * Clears the proxy session cookie (logout).
 */
export async function DELETE(request: Request) {
  const limited = enforceIpRateLimit(request);
  if (limited) return limited;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return res;
}

/** Soft keep-alive / debug: does not leak uid. No Admin SDK. */
export async function GET() {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    '';
  return NextResponse.json({
    ok: true,
    cookie: SESSION_COOKIE_NAME,
    maxAgeSec: SESSION_COOKIE_MAX_AGE_SEC,
    projectIdConfigured: Boolean(projectId),
  });
}

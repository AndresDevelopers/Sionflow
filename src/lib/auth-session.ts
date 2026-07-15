/**
 * Server session cookie bridged from Firebase client ID tokens.
 * Cookie is verified in Edge middleware via JWKS (see firebase-token-edge.ts).
 */

export const SESSION_COOKIE_NAME = 'sf_session';

/** Align with typical Firebase ID token lifetime (1h). Client refreshes on idTokenChanged. */
export const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60;

export function sessionCookieOptions(maxAge = SESSION_COOKIE_MAX_AGE_SEC) {
  const secure = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

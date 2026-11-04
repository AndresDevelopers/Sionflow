/**
 * Edge-safe verification of Firebase ID tokens (JWKS).
 * Used by proxy (request gate) — no firebase-admin on the Edge/Node runtime.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  )
);

/** jose codes that mean the presented token itself is not valid. */
const TOKEN_REJECTION_CODES = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWS_INVALID',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
]);

/**
 * True only when the token was rejected (expired, forged, malformed).
 * Anything else — JWKS fetch/timeout, missing project config, unexpected
 * errors — is an infrastructure failure and must NOT sign the user out:
 * the app shell stays reachable and APIs keep verifying their own Bearer.
 */
export function isInvalidTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && TOKEN_REJECTION_CODES.has(code);
}

export type VerifiedFirebaseToken = JWTPayload & {
  sub: string;
  user_id?: string;
  email?: string;
};

export async function verifyFirebaseIdTokenEdge(
  token: string
): Promise<VerifiedFirebaseToken> {
  // Prefer public client project id (must match the token audience). Fall back to
  // common server aliases so a missing NEXT_PUBLIC_ var does not brick production.
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    '';
  if (!projectId) {
    throw new Error(
      'Firebase project id is not configured (NEXT_PUBLIC_FIREBASE_PROJECT_ID)'
    );
  }

  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) {
    throw new Error('Token missing subject');
  }

  return payload as VerifiedFirebaseToken;
}

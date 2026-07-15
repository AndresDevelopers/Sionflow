/**
 * Edge-safe verification of Firebase ID tokens (JWKS).
 * Used by middleware — no firebase-admin on the Edge runtime.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  )
);

export type VerifiedFirebaseToken = JWTPayload & {
  sub: string;
  user_id?: string;
  email?: string;
};

export async function verifyFirebaseIdTokenEdge(
  token: string
): Promise<VerifiedFirebaseToken> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured');
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

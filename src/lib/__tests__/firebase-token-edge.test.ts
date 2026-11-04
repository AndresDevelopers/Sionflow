import { describe, expect, it } from 'vitest';
import { isInvalidTokenError } from '@/lib/firebase-token-edge';

function joseError(code: string): Error {
  const error = new Error(code);
  (error as Error & { code?: string }).code = code;
  return error;
}

describe('isInvalidTokenError', () => {
  it('treats rejected tokens as authentication failures', () => {
    expect(isInvalidTokenError(joseError('ERR_JWT_EXPIRED'))).toBe(true);
    expect(isInvalidTokenError(joseError('ERR_JWT_INVALID'))).toBe(true);
    expect(isInvalidTokenError(joseError('ERR_JWT_CLAIM_VALIDATION_FAILED'))).toBe(true);
    expect(isInvalidTokenError(joseError('ERR_JWS_SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
  });

  it('treats infrastructure failures as retryable, not as a sign-out', () => {
    expect(isInvalidTokenError(joseError('ERR_JWKS_TIMEOUT'))).toBe(false);
    expect(isInvalidTokenError(joseError('ERR_JWKS_NO_MATCHING_KEY'))).toBe(false);
    expect(
      isInvalidTokenError(
        new Error('Firebase project id is not configured (NEXT_PUBLIC_FIREBASE_PROJECT_ID)')
      )
    ).toBe(false);
    expect(isInvalidTokenError(undefined)).toBe(false);
    expect(isInvalidTokenError('network')).toBe(false);
  });
});

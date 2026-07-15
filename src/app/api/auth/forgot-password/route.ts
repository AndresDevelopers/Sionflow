import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * Password-reset preflight.
 *
 * Anti-enumeration: always returns the same 200 payload whether the email
 * exists or not. The client then calls Firebase sendPasswordResetEmail
 * (which itself does not reveal user existence on modern clients).
 *
 * Rate-limited to limit abuse of the reset flow.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'auth');
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const email =
      body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string'
        ? (body as { email: string }).email.trim().toLowerCase()
        : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'invalid-email', message: 'A valid email is required.' },
        { status: 400 }
      );
    }

    // Uniform success — do not probe Auth for existence in the response.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'unexpected', message: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}

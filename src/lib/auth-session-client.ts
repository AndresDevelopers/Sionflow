/**
 * Client helper: keep proxy session cookie in sync with Firebase Auth.
 *
 * IMPORTANT: callers that gate navigation (login/register) MUST check the
 * boolean return. A false result means the httpOnly cookie was NOT written
 * and a full document navigation to a protected route will bounce to /login.
 */

const REDIRECT_GUARD_KEY = 'sf_auth_redirect_guard';
const REDIRECT_GUARD_MAX = 2;

export async function syncServerSession(idToken: string | null): Promise<boolean> {
  try {
    if (idToken) {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        // Surface server-side failures (e.g. 500 from misconfigured Admin) in console
        // so production debugging is possible without breaking the login UX.
        try {
          const body = await res.text();
          console.warn(
            `[auth-session] POST /api/auth/session failed: ${res.status}`,
            body.slice(0, 300)
          );
        } catch {
          console.warn(`[auth-session] POST /api/auth/session failed: ${res.status}`);
        }
      }
      return res.ok;
    }

    const res = await fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return res.ok;
  } catch (error) {
    // Network / SW failure — cookie may be stale or missing.
    console.warn('[auth-session] syncServerSession network error', error);
    return false;
  }
}

/**
 * Mint the proxy session cookie, forcing a token refresh once if the first
 * attempt fails (common right after cold start or clock skew).
 */
export async function ensureServerSession(
  getIdToken: (forceRefresh?: boolean) => Promise<string>
): Promise<boolean> {
  try {
    const token = await getIdToken(false);
    if (await syncServerSession(token)) return true;

    const fresh = await getIdToken(true);
    return syncServerSession(fresh);
  } catch {
    return false;
  }
}

/**
 * Prevent infinite /login ↔ / loops when Firebase has a client session but the
 * Edge cookie cannot be verified (missing env, project mismatch, etc.).
 */
export function canAttemptAuthRedirect(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const n = Number(sessionStorage.getItem(REDIRECT_GUARD_KEY) || '0');
    if (!Number.isFinite(n) || n >= REDIRECT_GUARD_MAX) return false;
    sessionStorage.setItem(REDIRECT_GUARD_KEY, String(n + 1));
    return true;
  } catch {
    return true;
  }
}

export function clearAuthRedirectGuard(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(REDIRECT_GUARD_KEY);
  } catch {
    // ignore
  }
}

/**
 * Full document navigation so the proxy always sees the freshly set cookie.
 * Client soft navigations can race RSC prefetches before Set-Cookie lands.
 */
export function hardNavigate(path: string): void {
  if (typeof window === 'undefined') return;
  const target =
    path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
  window.location.replace(target);
}

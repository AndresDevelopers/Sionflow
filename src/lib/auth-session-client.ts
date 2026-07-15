/**
 * Client helper: keep Edge middleware session cookie in sync with Firebase Auth.
 */

export async function syncServerSession(idToken: string | null): Promise<void> {
  try {
    if (idToken) {
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } else {
      await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    }
  } catch {
    // Non-fatal: APIs still use Bearer; middleware is defense-in-depth.
  }
}

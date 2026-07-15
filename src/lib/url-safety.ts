/**
 * URL sanitizers safe for both client and server (no firebase-admin).
 */

/**
 * Sanitize client-supplied app deep links.
 * Only same-app relative paths (no scheme, no protocol-relative).
 */
export function sanitizeAppRelativeUrl(url: unknown, fallback = '/'): string {
  if (typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('://') ||
    trimmed.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(trimmed) ||
    trimmed.toLowerCase().startsWith('/\\') ||
    /^\/\s*javascript:/i.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed.slice(0, 500);
}

/** Official Church HTTPS hosts allowed for external notification links. */
const SAFE_EXTERNAL_HOSTS = new Set([
  'newsroom.churchofjesuschrist.org',
  'www.churchofjesuschrist.org',
  'churchofjesuschrist.org',
  'www.familysearch.org',
  'familysearch.org',
]);

/**
 * Allow only https URLs on a small official allowlist.
 * Returns null if unsafe.
 */
export function sanitizeExternalHttpsUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!SAFE_EXTERNAL_HOSTS.has(host)) return null;
  return parsed.toString();
}

/**
 * Resolve a safe navigation target from a notification actionUrl.
 */
export function sanitizeNotificationActionUrl(
  url: unknown,
  actionType?: string | null
): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    const rel = sanitizeAppRelativeUrl(trimmed, '');
    return rel || null;
  }
  if (actionType === 'external' || trimmed.startsWith('https://')) {
    return sanitizeExternalHttpsUrl(trimmed);
  }
  return null;
}

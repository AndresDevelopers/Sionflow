/**
 * SSRF guards for server-side fetches of client-supplied or semi-trusted URLs.
 * Used by /api/download-qr and similar proxies.
 */

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Hosts allowed for image proxy downloads (Firebase Storage / GCS / app storage). */
const ALLOWED_HOST_EXACT = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

export class UnsafeUrlError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UnsafeUrlError';
    this.status = status;
  }
}

function isIpv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.lan')
  ) {
    return true;
  }

  // Block all raw IP literals (IPv4/IPv6) — require hostnames on the allowlist.
  if (h.includes(':') || isIpv4Literal(h)) {
    return true;
  }

  return false;
}

function isAllowedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();

  if (isPrivateOrLocalHostname(h)) {
    return false;
  }

  if (ALLOWED_HOST_EXACT.has(h)) {
    return true;
  }

  if (h === 'firebasestorage.app' || h.endsWith('.firebasestorage.app')) {
    return true;
  }

  // Optional: same host as configured public site (static QR on own domain).
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) {
    try {
      const siteHost = new URL(siteUrl).hostname.toLowerCase();
      if (siteHost && siteHost === h) {
        return true;
      }
    } catch {
      // ignore invalid SITE_URL
    }
  }

  // Storage bucket hostname style: bucket.storage.googleapis.com is already exact-matched via parent.
  // Also allow project-specific *.appspot.com download hosts if ever used.
  if (h.endsWith('.appspot.com')) {
    return true;
  }

  return false;
}

/**
 * Parse and validate a remote URL for server-side fetch.
 * Only https + allowlisted public hosts; rejects private/local/IP literals.
 */
export function assertSafeRemoteImageUrl(raw: string): URL {
  if (!raw || typeof raw !== 'string' || raw.length > 2048) {
    throw new UnsafeUrlError('URL inválida o demasiado larga.');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError('URL malformada.');
  }

  if (parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('Solo se permiten URLs https.');
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('URL con credenciales no permitida.');
  }

  if (!isAllowedHostname(parsed.hostname)) {
    throw new UnsafeUrlError(
      'Host no permitido. Solo Firebase Storage / GCS / dominio del sitio.'
    );
  }

  return parsed;
}

/**
 * Fetch a remote image after SSRF checks. Does not follow redirects.
 */
export async function fetchSafeRemoteImage(
  rawUrl: string,
  options?: { timeoutMs?: number; maxBytes?: number }
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const url = assertSafeRemoteImageUrl(rawUrl);
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const maxBytes = options?.maxBytes ?? MAX_RESPONSE_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'image/*,*/*;q=0.8',
      },
      // Avoid caching untrusted intermediary responses on the edge
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new UnsafeUrlError('No se pudo descargar la imagen.', 502);
    }

    const contentType = (res.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!contentType.startsWith('image/')) {
      throw new UnsafeUrlError('La URL no devolvió una imagen.', 415);
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new UnsafeUrlError('Imagen demasiado grande.', 413);
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength <= 0 || buffer.byteLength > maxBytes) {
      throw new UnsafeUrlError('Imagen vacía o demasiado grande.', 413);
    }

    return { buffer, contentType };
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UnsafeUrlError('Tiempo de espera agotado al descargar la imagen.', 504);
    }
    throw new UnsafeUrlError('Fallo al descargar la imagen.', 502);
  } finally {
    clearTimeout(timer);
  }
}

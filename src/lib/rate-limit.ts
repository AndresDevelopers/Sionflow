/**
 * In-memory rate limiter (fixed window + Map with TTL eviction).
 *
 * NOTE: In multi-instance Vercel deployments this limit is **per instance**,
 * not global across the fleet. That is acceptable for the current project size.
 * If traffic grows or you need a hard global cap, replace the store with
 * Redis/Upstash (CSP already allows `*.upstash.io`).
 *
 * No Upstash/Redis dependency is present in package.json today, so this
 * stays zero-deps and surgical.
 */

import { NextResponse } from 'next/server';

export type RateLimitPreset = 'api' | 'churchChat' | 'auth' | 'upload';

export type RateLimitConfig = {
  /** Max requests allowed in the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Key namespace (route / category). */
  prefix: string;
};

/** Default presets used by API routes. */
export const RATE_LIMITS: Record<RateLimitPreset, RateLimitConfig> = {
  /** Generic authenticated/public API traffic. */
  api: { limit: 60, windowMs: 60_000, prefix: 'api' },
  /** DeepSeek-backed chat — highest variable cost. Prefer uid over IP. */
  churchChat: { limit: 10, windowMs: 60_000, prefix: 'church-chat' },
  /** Auth-adjacent public endpoints (forgot password, capacity). */
  auth: { limit: 20, windowMs: 60_000, prefix: 'auth' },
  /** Multipart / base64 uploads. */
  upload: { limit: 30, windowMs: 60_000, prefix: 'upload' },
};

type Bucket = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Bucket>();

/** Soft cap to avoid unbounded memory growth (LRU-ish eviction of oldest keys). */
const MAX_KEYS = 10_000;

function pruneExpired(now: number): void {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

function evictOldestIfNeeded(): void {
  if (store.size < MAX_KEYS) return;
  // Map iteration order is insertion order — drop earliest entries first.
  const excess = store.size - MAX_KEYS + 1;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
};

/**
 * Record one hit for `key` under the given config.
 * Returns whether the request is allowed.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup when the map is large.
  if (store.size > MAX_KEYS * 0.8) {
    pruneExpired(now);
  }
  evictOldestIfNeeded();

  const fullKey = `${config.prefix}:${key}`;
  const existing = store.get(fullKey);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + config.windowMs;
    store.set(fullKey, { count: 1, resetAt });
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetAt,
      retryAfterSec: Math.ceil(config.windowMs / 1000),
    };
  }

  if (existing.count >= config.limit) {
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    success: true,
    limit: config.limit,
    remaining: Math.max(0, config.limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown';
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Resolve a stable identity for rate limiting: prefers Firebase uid when a
 * valid Bearer ID token is present; otherwise falls back to client IP.
 *
 * Uses JWKS (jose) instead of firebase-admin so importing this module never
 * crashes API routes when Admin credentials are missing/misconfigured.
 */
export async function resolveRateLimitIdentity(request: Request): Promise<string> {
  const token = getBearerToken(request);
  if (token) {
    try {
      const { verifyFirebaseIdTokenEdge } = await import('@/lib/firebase-token-edge');
      const decoded = await verifyFirebaseIdTokenEdge(token);
      if (decoded?.sub) {
        return `uid:${decoded.sub}`;
      }
    } catch {
      // Invalid/expired token or missing project id — fall through to IP.
    }
  }
  return `ip:${getClientIp(request)}`;
}

export function rateLimitExceededResponse(result: RateLimitResult, message?: string): NextResponse {
  const body = {
    error: 'rate_limit_exceeded',
    message:
      message ??
      `Too many requests. Limit is ${result.limit} per minute. Try again in ${result.retryAfterSec}s.`,
  };
  return NextResponse.json(body, {
    status: 429,
    headers: {
      'Retry-After': String(result.retryAfterSec),
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    },
  });
}

/**
 * Enforce rate limit at the start of an API route handler.
 * Returns a 429 NextResponse when exceeded; otherwise null (caller continues).
 */
export async function enforceRateLimit(
  request: Request,
  preset: RateLimitPreset | RateLimitConfig = 'api'
): Promise<NextResponse | null> {
  const config = typeof preset === 'string' ? RATE_LIMITS[preset] : preset;
  const identity = await resolveRateLimitIdentity(request);
  const result = checkRateLimit(identity, config);
  if (!result.success) {
    return rateLimitExceededResponse(result);
  }
  return null;
}

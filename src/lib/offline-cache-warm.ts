/**
 * Smart offline pre-cache:
 *
 * 1) PAGE SHELLS (background, when online on app open)
 *    - HTML document for every main route
 *    - Next.js RSC / flight payloads (so client navigation works offline)
 *    - Static assets referenced by those shells (via SW / aggressive fetch)
 *    Shells alone = user can OPEN the page offline (may be empty of data).
 *
 * 2) PAGE CONTENT (when the user visits a page online)
 *    - Handled by Firestore persistent cache, localStorage helpers, image cache
 *    - Visiting a page marks it as "content-seen" for UX hints
 *
 * 3) IMAGES
 *    - Client Cache API + SW (see image-offline-cache)
 */
import { navigationItems } from '@/lib/navigation';
import { isBrowserOnline } from '@/lib/network';
import {
  cacheImages,
  collectMemberImageUrls,
  isCacheableImageUrl,
} from '@/lib/image-offline-cache';
import { getAppStoragePrefix } from '@/lib/app-config';

/** All routes we want openable offline (shell only until content is visited). */
export const ALL_SHELL_ROUTES: string[] = Array.from(
  new Set([
    ...navigationItems.map((item) => item.href),
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/members',
    '/observations',
    '/converts',
    '/converts/add',
    '/ministering',
    '/ministering/add',
    '/ministering/urgent',
    '/birthdays',
    '/family-search',
    '/missionary-work',
    '/future-members',
    '/service',
    '/service/add',
    '/church-chat',
    '/council',
    '/reports/activities',
    '/reports/add',
    '/settings',
    '/profile',
    '/donate',
    '/admin',
    '/~offline',
    '/no-permission',
    '/manifest',
    '/api/icon',
    '/logo.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-192.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
    '/favicon.ico',
  ])
);

const SHELL_META_KEY = () => `${getAppStoragePrefix()}_shells_precache_v1`;
const CONTENT_SEEN_KEY = () => `${getAppStoragePrefix()}_content_seen_v1`;

function toAbsoluteUrls(paths: string[]): string[] {
  if (typeof window === 'undefined') return [];
  const origin = window.location.origin;
  const set = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    try {
      const url = p.startsWith('http') ? p : new URL(p, origin).href;
      set.add(url);
    } catch {
      // skip
    }
  }
  return [...set];
}

function idleYield(timeoutMs = 1200): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
        }
      ).requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else {
      setTimeout(resolve, 50);
    }
  });
}

function readJsonMap(key: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonMap(key: string, map: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // quota
  }
}

/** Mark that this route's content was loaded while online (data should exist in caches). */
export function markPageContentSeen(pathname: string): void {
  if (!pathname || typeof window === 'undefined') return;
  const path = pathname.split('?')[0] || pathname;
  const map = readJsonMap(CONTENT_SEEN_KEY());
  map[path] = Date.now();
  writeJsonMap(CONTENT_SEEN_KEY(), map);
}

export function wasPageContentSeen(pathname: string): boolean {
  if (!pathname || typeof window === 'undefined') return false;
  const path = pathname.split('?')[0] || pathname;
  const map = readJsonMap(CONTENT_SEEN_KEY());
  return Boolean(map[path]);
}

export function getShellPrecacheMeta(): { lastRun: number; routes: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SHELL_META_KEY());
    if (!raw) return null;
    return JSON.parse(raw) as { lastRun: number; routes: number };
  } catch {
    return null;
  }
}

function setShellPrecacheMeta(routes: number) {
  try {
    localStorage.setItem(
      SHELL_META_KEY(),
      JSON.stringify({ lastRun: Date.now(), routes })
    );
  } catch {
    // ignore
  }
}

/**
 * Fetch a route as:
 * - full document (for hard navigation / reload offline)
 * - RSC prefetch headers (for soft client navigation offline)
 * Then put both into Cache Storage when possible.
 */
async function cacheRouteShell(pathOrUrl: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const absolute = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : new URL(pathOrUrl, window.location.origin).href;

  let ok = false;

  // Document (HTML shell)
  try {
    const docRes = await fetch(absolute, {
      credentials: 'same-origin',
      cache: 'reload',
      headers: { Accept: 'text/html' },
    });
    if (docRes.ok) {
      ok = true;
      try {
        const cache = await caches.open('pages');
        await cache.put(absolute, docRes.clone());
        // Also key by path for ignoreSearch matches
        const path = new URL(absolute).pathname;
        await cache.put(path, docRes.clone());
      } catch {
        // ignore put failures
      }
    }
  } catch {
    // ignore
  }

  // Next.js App Router flight / RSC (soft navigation)
  try {
    const rscRes = await fetch(absolute, {
      credentials: 'same-origin',
      cache: 'reload',
      headers: {
        RSC: '1',
        'Next-Router-Prefetch': '1',
        Accept: '*/*',
      },
    });
    if (rscRes.ok) {
      ok = true;
      try {
        const cache = await caches.open('pages-rsc');
        await cache.put(absolute, rscRes.clone());
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore — not all routes return RSC the same way
  }

  return ok;
}

export type ShellPrecacheProgress = {
  done: number;
  total: number;
  current?: string;
  phase: 'shells' | 'images' | 'done';
};

/**
 * Background pre-cache of ALL page shells (no business data).
 * Safe to call multiple times; throttled by last-run meta (4h).
 */
export async function precacheAllPageShells(options?: {
  force?: boolean;
  onProgress?: (p: ShellPrecacheProgress) => void;
  signal?: AbortSignal;
  /** Next.js router.prefetch from the app (optional but important for soft nav) */
  routerPrefetch?: (href: string) => void | Promise<void>;
}): Promise<void> {
  if (typeof window === 'undefined' || !isBrowserOnline()) return;

  const meta = getShellPrecacheMeta();
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  if (!options?.force && meta && Date.now() - meta.lastRun < FOUR_HOURS) {
    // Still refresh lightly in idle, but skip full storm
    return;
  }

  const routes = ALL_SHELL_ROUTES.filter(
    (r) => r.startsWith('/') && !r.startsWith('/api/')
  );
  const assets = ALL_SHELL_ROUTES.filter(
    (r) => r.startsWith('/api/') || /\.(png|ico|jpg|svg|webp)$/i.test(r)
  );

  const total = routes.length + assets.length;
  let done = 0;

  const signal = options?.signal;
  const report = (phase: ShellPrecacheProgress['phase'], current?: string) => {
    options?.onProgress?.({ done, total, current, phase });
  };

  report('shells');

  // Prefer Next router.prefetch first (populates App Router client cache)
  if (options?.routerPrefetch) {
    for (const href of routes) {
      if (signal?.aborted) return;
      if (!isBrowserOnline()) return;
      try {
        await options.routerPrefetch(href);
      } catch {
        // ignore
      }
      await idleYield(800);
    }
  }

  // Document + RSC into Cache Storage (hard offline navigations)
  for (const href of routes) {
    if (signal?.aborted) return;
    if (!isBrowserOnline()) return;
    report('shells', href);
    await cacheRouteShell(href);
    done += 1;
    report('shells', href);
    await idleYield(1000);
  }

  // Static assets
  for (const asset of assets) {
    if (signal?.aborted) return;
    if (!isBrowserOnline()) return;
    try {
      const url = toAbsoluteUrls([asset])[0];
      if (url) {
        await fetch(url, { credentials: 'same-origin', cache: 'reload' });
      }
    } catch {
      // ignore
    }
    done += 1;
    report('shells', asset);
    await idleYield(400);
  }

  // Notify custom SW
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    const worker = reg?.active ?? reg?.waiting ?? reg?.installing;
    worker?.postMessage({
      type: 'WARM_CACHE_URLS',
      urls: toAbsoluteUrls([...routes, ...assets]),
    });
  } catch {
    // ignore
  }

  // Start URL — cache the actual resolved URL (including after redirects,
  // e.g. / → /login). Use a fresh clone for both the original key and the
  // resolved URL so the PWA always opens from cache when NetworkFirst times out.
  try {
    const cache = await caches.open('start-url');
    const start = await fetch('/', {
      credentials: 'same-origin',
      cache: 'no-cache',
      redirect: 'follow',
    });
    if (start.ok) {
      // Cache both the canonical "/" key and the actual resolved URL
      await cache.put('/', start.clone());
      if (start.redirected && start.url && start.url !== window.location.origin + '/') {
        await cache.put(start.url, start.clone());
      }
    }
  } catch {
    // ignore
  }

  setShellPrecacheMeta(routes.length);
  report('done');
}

/**
 * Full warm: shells + optional images. Used on login / online.
 */
export async function warmOfflineCaches(
  extraUrls: string[] = [],
  options?: {
    forceShells?: boolean;
    routerPrefetch?: (href: string) => void | Promise<void>;
    onProgress?: (p: ShellPrecacheProgress) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  if (typeof window === 'undefined' || !isBrowserOnline()) return;

  // 1) Page shells first (user can open any page offline)
  await precacheAllPageShells({
    force: options?.forceShells,
    routerPrefetch: options?.routerPrefetch,
    onProgress: options?.onProgress,
    signal: options?.signal,
  });

  // 2) Images (content media)
  const imageUrls = [
    ...new Set(
      extraUrls.filter((u): u is string => typeof u === 'string' && isCacheableImageUrl(u))
    ),
  ];
  if (imageUrls.length && isBrowserOnline() && !options?.signal?.aborted) {
    options?.onProgress?.({
      done: 0,
      total: imageUrls.length,
      phase: 'images',
    });
    await cacheImages(imageUrls, { concurrency: 4, limit: 300 });
  }

  options?.onProgress?.({ done: 1, total: 1, phase: 'done' });
}

/** Extract image URLs worth caching (member photos, gallery, etc.). */
export function collectImageUrls(sources: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue;
    if (isCacheableImageUrl(src)) out.push(src);
  }
  return out;
}

export { collectMemberImageUrls };

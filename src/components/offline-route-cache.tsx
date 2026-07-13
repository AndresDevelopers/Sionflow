'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isBrowserOnline } from '@/lib/network';

/**
 * While online, re-fetch the current document URL so Workbox / custom SW
 * always has a fresh HTML shell for this path (critical after client navigations).
 * Without this, pull-to-refresh offline often hits a URL never put in Cache Storage.
 */
export function OfflineRouteCache() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isBrowserOnline()) return;
    if (!pathname) return;

    const url = window.location.href;
    const controller = new AbortController();

    // Debounce rapid navigations
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await fetch(url, {
            credentials: 'same-origin',
            cache: 'reload',
            signal: controller.signal,
          });
        } catch {
          // ignore
        }

        // Also ask SW warm cache for this path
        try {
          const reg = await navigator.serviceWorker?.getRegistration('/');
          const worker = reg?.active ?? reg?.waiting;
          worker?.postMessage({
            type: 'WARM_CACHE_URLS',
            urls: [url, pathname, `${window.location.origin}${pathname}`],
          });
        } catch {
          // ignore
        }
      })();
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pathname]);

  // When going offline mid-session, block hard reloads from leaving the SPA
  // if we can't guarantee the document is cached (best-effort UX).
  useEffect(() => {
    const onOffline = () => {
      // Soft-notify via custom event for indicators; do not reload
      window.dispatchEvent(new CustomEvent('sionflow:went-offline'));
    };
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, []);

  return null;
}

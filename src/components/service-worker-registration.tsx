'use client';

import { useEffect } from 'react';

/**
 * Development: tear down service workers + Cache Storage so stale production
 * Workbox precaches cannot serve old JS (Server Action IDs).
 * Production: register /sw.js so the app shell and assets stay available offline.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      const nukeCachesAndWorkers = async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          const hadWorkers = registrations.length > 0;
          await Promise.all(registrations.map((registration) => registration.unregister()));

          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
          }

          // One-shot reload so the page cannot keep executing a SW-cached
          // bundle that still calls deleted Server Action IDs.
          const reloadKey = 'qf-sw-nuke-reload-v1';
          if (hadWorkers && sessionStorage.getItem(reloadKey) !== '1') {
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
          }
        } catch {
          // ignore
        }
      };

      void nukeCachesAndWorkers();
      return;
    }

    // Production: keep a single SW for PWA offline shell + push (FCM bridge in worker/)
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        // Take control ASAP so subsequent navigations can be served offline
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              // New SW ready — activate on next visit; do not wipe caches here
              console.log('[sw] update installed; will activate on next load');
            }
          });
        });
      } catch (error) {
        console.warn('[sw] registration failed', error);
      }
    })();
  }, []);

  return null;
}

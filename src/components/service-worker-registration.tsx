'use client';

import { useEffect } from 'react';
import { warmOfflineCaches } from '@/lib/offline-cache-warm';
import { isBrowserOnline } from '@/lib/network';

/**
 * Development: tear down service workers + Cache Storage so stale production
 * Workbox precaches cannot serve old JS.
 * Production: register /sw.js, claim clients, and warm offline caches.
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

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        const activateWaiting = () => {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        };

        activateWaiting();

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              activateWaiting();
            }
          });
        });

        // Wait until an active worker exists (needed before FCM getToken on Android).
        // navigator.serviceWorker.ready can hang if install never completes — bound the wait.
        const readyWithTimeout = Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((resolve) => {
            window.setTimeout(() => resolve(null), 15_000);
          }),
        ]);
        const readyRegistration = await readyWithTimeout;
        if (!readyRegistration) {
          console.warn('[sw] ready timed out — push may fail until next load');
        }

        // First install: page may not be controlled until reload — do it once.
        // Never force reload while offline (would show the native "sin internet" page).
        if (!navigator.serviceWorker.controller && isBrowserOnline()) {
          const claimKey = 'qf-sw-claim-reload-v3';
          if (sessionStorage.getItem(claimKey) !== '1') {
            sessionStorage.setItem(claimKey, '1');
            window.location.reload();
            return;
          }
        }

        // Light warm of start URL only — full shell precache is OfflineShellPrecache
        // (avoids double network storm on every SW registration).
        if (isBrowserOnline()) {
          window.setTimeout(() => {
            void warmOfflineCaches([], { forceShells: false });
          }, 8000);
        }
      } catch (error) {
        console.warn('[sw] registration failed', error);
      }
    })();
  }, []);

  return null;
}

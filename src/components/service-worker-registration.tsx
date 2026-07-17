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
        // ── Cache the CURRENT page as start-url IMMEDIATELY ───────────
        // Before the SW takes control, save a snapshot so the PWA always
        // finds something in the start-url cache — critical for the very
        // first PWA open when the server might be slow (cold start, 3G).
        if ('caches' in window && isBrowserOnline()) {
          try {
            const cache = await caches.open('start-url');
            const docClone = document.documentElement.outerHTML;
            const res = new Response(
              '<!DOCTYPE html>' + docClone,
              {
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              },
            );
            await cache.put('/', res.clone());
            await cache.put(window.location.href, res.clone());
          } catch {
            // ignore — best-effort
          }
        }

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

        // Prefer clientsClaim + controllerchange over a hard reload.
        // Force-reloading on first visit used to cancel Chrome's install sheet
        // mid-prompt ("tap Install → nothing → tap again → works").
        if (!navigator.serviceWorker.controller && isBrowserOnline()) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
              window.clearTimeout(timer);
              resolve();
            };
            const onControllerChange = () => done();
            navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
            activateWaiting();
            const timer = window.setTimeout(done, 4_000);
          });
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

'use client';

import { useEffect, useState } from 'react';
import {
  cacheImage,
  getCachedImageSrc,
  isCacheableImageUrl,
} from '@/lib/image-offline-cache';
import { isBrowserOnline } from '@/lib/network';

/**
 * Returns a displayable image src that prefers the local Cache Storage copy
 * whenever available (online and offline) to avoid re-downloading Storage bytes.
 *
 * Flow:
 * 1) If cached → blob: immediately (after async cache read)
 * 2) Else online → show network URL, then switch to blob: once stored
 * 3) Else offline without cache → original URL (may fail)
 */
export function useOfflineImageSrc(
  src: string | null | undefined
): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => {
    if (!src) return undefined;
    if (src.startsWith('blob:') || src.startsWith('data:')) return src;
    // First paint: network when online (cache lookup is async); offline waits
    return isBrowserOnline() || !isCacheableImageUrl(src) ? src : undefined;
  });

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolved(undefined);
      return;
    }
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      setResolved(src);
      return;
    }
    if (!isCacheableImageUrl(src)) {
      setResolved(src);
      return;
    }

    void (async () => {
      // Always prefer local copy when present (saves cellular data)
      const cached = await getCachedImageSrc(src);
      if (cancelled) return;
      if (cached) {
        setResolved(cached);
        return;
      }

      if (isBrowserOnline()) {
        // Not cached yet: paint network URL, then promote to blob: after store
        setResolved(src);
        const stored = await cacheImage(src);
        if (!cancelled && stored) {
          setResolved(stored);
        }
        return;
      }

      // Offline + no cache
      setResolved(src);
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  // Connectivity flips: keep preferring blob: when available
  useEffect(() => {
    if (!src || !isCacheableImageUrl(src)) return;

    const preferLocalOrWarm = () => {
      void (async () => {
        const cached = await getCachedImageSrc(src);
        if (cached) {
          setResolved(cached);
          return;
        }
        if (!isBrowserOnline()) {
          setResolved(src);
          return;
        }
        setResolved(src);
        const stored = await cacheImage(src);
        if (stored) setResolved(stored);
      })();
    };

    window.addEventListener('offline', preferLocalOrWarm);
    window.addEventListener('online', preferLocalOrWarm);
    return () => {
      window.removeEventListener('offline', preferLocalOrWarm);
      window.removeEventListener('online', preferLocalOrWarm);
    };
  }, [src]);

  return resolved;
}

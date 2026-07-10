'use client';

/**
 * Foto de perfil de miembro.
 * Usa <img> nativo (no next/image) para evitar fallos con URLs de Firebase Storage
 * en dev y con tokens de descarga.
 */

import { useEffect, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '@/lib/firebase';

type MemberPhotoProps = {
  photoURL?: string | null;
  name?: string;
  size?: number;
  className?: string;
};

function resolvePhotoURL(photoURL?: string | null): string | undefined {
  if (typeof photoURL !== 'string') return undefined;
  const trimmed = photoURL.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Extrae la ruta de Storage de una download URL de Firebase. */
function storagePathFromDownloadURL(url: string): string | null {
  try {
    const match = url.match(/\/o\/([^?]+)/);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function refreshFirebaseDownloadURL(url: string): Promise<string | null> {
  if (!storage) return null;
  const path = storagePathFromDownloadURL(url);
  if (!path) return null;
  try {
    return await getDownloadURL(ref(storage, path));
  } catch {
    return null;
  }
}

export function MemberPhoto({
  photoURL,
  name = '',
  size = 40,
  className = '',
}: MemberPhotoProps) {
  const resolved = resolvePhotoURL(photoURL);
  const [src, setSrc] = useState<string | undefined>(resolved);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  useEffect(() => {
    setSrc(resolvePhotoURL(photoURL));
    setFailed(false);
    setRefreshing(false);
  }, [photoURL]);

  if (!src || failed) {
    return (
      <div
        className={`rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-medium text-muted-foreground ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
        title={name || undefined}
      >
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name || 'Foto de perfil'}
      width={size}
      height={size}
      className={`rounded-full object-cover shrink-0 bg-muted ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (refreshing) {
          setFailed(true);
          return;
        }
        setRefreshing(true);
        void (async () => {
          const fresh = await refreshFirebaseDownloadURL(src);
          if (fresh && fresh !== src) {
            setSrc(fresh);
            setRefreshing(false);
            return;
          }
          setFailed(true);
        })();
      }}
    />
  );
}

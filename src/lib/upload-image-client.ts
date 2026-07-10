/**
 * Client helper: upload an image through the Next.js API (Admin SDK / GCS).
 *
 * Sends JSON base64 (not multipart) so production Node/Vercel never trips on
 * `instanceof File` with FormData Blobs from another realm.
 */
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export type ServerUploadResult = {
  url: string;
  firebaseUrl?: string;
  path: string;
  contentType?: string;
  size?: number;
};

const UPLOAD_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} agotó el tiempo (${Math.round(ms / 1000)}s).`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Wait until Firebase Auth has a currentUser (context user can be set first). */
export async function waitForFirebaseUser(timeoutMs = 12_000): Promise<User> {
  if (!auth) {
    throw new Error('Firebase Auth no está disponible en este navegador.');
  }
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return withTimeout(
    new Promise<User>((resolve, reject) => {
      const unsub = onAuthStateChanged(
        auth,
        (user) => {
          if (user) {
            unsub();
            resolve(user);
          }
        },
        (error) => {
          unsub();
          reject(error);
        }
      );
    }),
    timeoutMs,
    'Esperar sesión de Firebase'
  );
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      if (!result.startsWith('data:')) {
        reject(new Error('No se pudo convertir la imagen a data URL.'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen para subirla.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload via POST /api/storage/upload with JSON body.
 * Always requires a logged-in Firebase user (ID token).
 */
export async function uploadImageViaServer(
  file: Blob,
  options: {
    folder?: string;
    fileName?: string;
    /** Optional data URL if already computed (skips re-read). */
    dataUrl?: string;
  } = {}
): Promise<ServerUploadResult> {
  const user = await waitForFirebaseUser();
  const idToken = await withTimeout(user.getIdToken(), 15_000, 'Obtener token de sesión');

  let imageData = options.dataUrl;
  if (!imageData) {
    // Ensure MIME is present for the server regex (some mobile Blobs have empty type).
    let blob = file;
    if (!blob.type || !blob.type.startsWith('image/')) {
      blob = new Blob([await file.arrayBuffer()], { type: 'image/jpeg' });
    }
    imageData = await blobToDataUrl(blob);
  }

  if (!imageData.startsWith('data:image/')) {
    // Force a generic image prefix if FileReader omitted type
    if (imageData.startsWith('data:;base64,') || imageData.startsWith('data:application/octet-stream;base64,')) {
      imageData = imageData.replace(/^data:[^;]*;base64,/, 'data:image/jpeg;base64,');
    } else {
      throw new Error('La imagen no se pudo codificar (data URL inválido).');
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        imageData,
        folder: options.folder || 'missionary-images',
        fileName: options.fileName || 'image.jpg',
      }),
      cache: 'no-store',
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      firebaseUrl?: string;
      path?: string;
      contentType?: string;
      size?: number;
      error?: string;
    };

    if (!response.ok || !payload.url || !payload.path) {
      throw new Error(
        payload.error ||
          `Error al subir (${response.status}). ${
            response.status === 413
              ? 'La imagen es demasiado grande.'
              : response.status === 401
                ? 'Sesión expirada; vuelve a iniciar sesión.'
                : response.status === 503
                  ? 'Almacenamiento no configurado en el servidor.'
                  : 'Intenta de nuevo.'
          }`
      );
    }

    return {
      url: payload.url,
      firebaseUrl: payload.firebaseUrl,
      path: payload.path,
      contentType: payload.contentType,
      size: payload.size,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`La subida agotó el tiempo (${Math.round(UPLOAD_TIMEOUT_MS / 1000)}s).`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

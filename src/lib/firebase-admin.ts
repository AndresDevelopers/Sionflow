import fs from 'fs';
import logger from './logger';
import { initializeApp, getApps, cert, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import type { Messaging } from 'firebase-admin/messaging';

// Initialize Firebase Admin SDK
//
// IMPORTANT: do NOT import firebase-admin/storage at module top-level.
// getStorage() pulls @google-cloud/storage → gaxios → uuid. If uuid is
// forced to an ESM-only major (v10+), gaxios's require('uuid') throws
// ERR_REQUIRE_ESM and used to brick the ENTIRE Admin SDK (including
// verifyIdToken for /api/app-admin/*), which surfaced as "Invalid ID token".
let app: App | undefined;
let authAdmin: Auth;
let firestoreAdmin: Firestore;
let storageAdmin: Storage | undefined;
let messagingAdmin: Messaging | undefined;
let storageInitError: unknown = null;
let messagingInitError: unknown = null;
let warnedInvalidServiceAccount = false;
let warnedMissingServiceAccount = false;
let initError: unknown = null;

type ServiceAccountWithLegacy = ServiceAccount & { project_id?: string };

export function parseServiceAccountKey(value: string): ServiceAccountWithLegacy | null {
  const trimmed = value.trim();
  const candidates: string[] = [];
  const maybeJsonPath = trimmed.endsWith('.json') ? trimmed : '';
  const compact = trimmed.replace(/\s+/g, '');

  if (trimmed) {
    candidates.push(trimmed);
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      candidates.push(trimmed.slice(1, -1));
    }
    if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length % 4 === 0) {
      try {
        candidates.push(Buffer.from(compact, 'base64').toString('utf8'));
      } catch (error) {
        logger.debug({ message: 'Failed to decode base64 service account candidate', error });
      }
    }
  }

  if (maybeJsonPath && fs.existsSync(maybeJsonPath)) {
    try {
      candidates.push(fs.readFileSync(maybeJsonPath, 'utf8'));
    } catch (error) {
      logger.debug({ message: 'Failed to read service account from path', error });
    }
  }

  const normalizePrivateKey = (candidate: string) => {
    const match = candidate.match(/"private_key"\s*:\s*"([\s\S]*?)"/);
    if (!match) return candidate;
    const normalizedKey = match[1].replace(/\r?\n/g, '\\n');
    return candidate.replace(match[0], `"private_key":"${normalizedKey}"`);
  };

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ServiceAccountWithLegacy;
      if (!parsed.projectId && parsed.project_id) {
        parsed.projectId = parsed.project_id;
      }
      return parsed;
    } catch (error) {
      logger.debug({ message: 'Failed to parse candidate directly, attempting normalization', error });
      try {
        const normalized = normalizePrivateKey(candidate);
        const parsed = JSON.parse(normalized) as ServiceAccountWithLegacy;
        if (!parsed.projectId && parsed.project_id) {
          parsed.projectId = parsed.project_id;
        }
        return parsed;
      } catch (error) {
        logger.debug({ message: 'Failed to parse service account JSON even after key normalization', error });
      }
    }
  }

  return null;
}

function initializeAdminApp(): App {
  if (getApps().length) {
    return getApps()[0];
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const envProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const isCi = Boolean(process.env.CI);

  if (serviceAccountKey) {
    const serviceAccount = parseServiceAccountKey(serviceAccountKey);
    if (serviceAccount) {
      if (envProjectId && serviceAccount.projectId && serviceAccount.projectId !== envProjectId) {
        // Project ID mismatch: override with the correct env project ID
        // The service account credentials (private key, client email) remain valid
        // as long as the SA has the proper IAM permissions on the env project.
        if (!isCi) {
          console.warn(
            `[firebase-admin] Service account project_id (${serviceAccount.projectId}) overridden ` +
              `with env project (${envProjectId}). Ensure the SA has FCM/Firestore permissions on ${envProjectId}.`
          );
        }
        serviceAccount.projectId = envProjectId;
      }

      const resolvedProjectId = envProjectId ?? serviceAccount.projectId;

      return initializeApp({
        credential: cert(serviceAccount),
        projectId: resolvedProjectId,
        storageBucket,
      });
    }

    if (!warnedInvalidServiceAccount) {
      if (!isCi) {
        console.warn(
          '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON — using Application Default Credentials.'
        );
      }
      warnedInvalidServiceAccount = true;
    }
    return initializeApp({
      projectId: envProjectId,
      storageBucket,
    });
  }

  // Fallback: Application Default Credentials (works in Cloud Run / GCP)
  if (!warnedMissingServiceAccount) {
    if (!isCi) {
      console.warn(
        '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_KEY not set — using Application Default Credentials.'
      );
    }
    warnedMissingServiceAccount = true;
  }
  return initializeApp({
    projectId: envProjectId,
    storageBucket,
  });
}

function failingProxy(label: string, cause: unknown): never {
  throw cause instanceof Error
    ? cause
    : new Error(
        `[firebase-admin] ${label} is not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY on the host.`
      );
}

function makeFailingService<T>(label: string, cause: unknown): T {
  return new Proxy(
    {},
    {
      get() {
        return failingProxy(label, cause);
      },
    }
  ) as T;
}

try {
  app = initializeAdminApp();
  // Auth + Firestore are required for almost every protected API (app-admin login included).
  // Keep them independent of Storage/Messaging optional clients.
  authAdmin = getAuth(app);
  firestoreAdmin = getFirestore(app);
} catch (error) {
  // Do NOT rethrow: a bad service account must not brick routes that only need
  // jose/JWKS (login session cookie). Call sites that touch Admin will fail
  // with a clear error at request time instead of a module-load 500.
  initError = error;
  console.error('[firebase-admin] Failed to initialize Firebase Admin SDK:', error);
  authAdmin = makeFailingService<Auth>('Auth', initError);
  firestoreAdmin = makeFailingService<Firestore>('Firestore', initError);
}

/** Lazy Storage client — only loads @google-cloud/storage when a route needs a bucket. */
function getStorageAdmin(): Storage {
  if (storageAdmin) return storageAdmin;
  if (storageInitError) {
    return makeFailingService<Storage>('Storage', storageInitError);
  }
  if (!app || initError) {
    storageInitError =
      initError ??
      new Error(
        '[firebase-admin] Admin SDK is not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY on the host.'
      );
    return makeFailingService<Storage>('Storage', storageInitError);
  }
  try {
    // Dynamic require/import so a broken uuid/gaxios chain cannot break Auth.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getStorage } = require('firebase-admin/storage') as typeof import('firebase-admin/storage');
    storageAdmin = getStorage(app);
    return storageAdmin;
  } catch (error) {
    storageInitError = error;
    console.error(
      '[firebase-admin] Storage client failed to load (auth/firestore still work):',
      error
    );
    return makeFailingService<Storage>('Storage', storageInitError);
  }
}

/** Lazy Messaging client. */
function getMessagingAdmin(): Messaging {
  if (messagingAdmin) return messagingAdmin;
  if (messagingInitError) {
    return makeFailingService<Messaging>('Messaging', messagingInitError);
  }
  if (!app || initError) {
    messagingInitError =
      initError ??
      new Error(
        '[firebase-admin] Admin SDK is not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY on the host.'
      );
    return makeFailingService<Messaging>('Messaging', messagingInitError);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMessaging } = require('firebase-admin/messaging') as typeof import('firebase-admin/messaging');
    messagingAdmin = getMessaging(app);
    return messagingAdmin;
  } catch (error) {
    messagingInitError = error;
    console.error(
      '[firebase-admin] Messaging client failed to load (auth/firestore still work):',
      error
    );
    return makeFailingService<Messaging>('Messaging', messagingInitError);
  }
}

/**
 * Exported Messaging instance (lazy Proxy).
 * Existing `import { messagingAdmin }` call sites keep working.
 */
const messagingAdminExport = new Proxy({} as Messaging, {
  get(_target, prop, receiver) {
    const client = getMessagingAdmin();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/**
 * Exported Storage instance (lazy Proxy).
 * Existing `import { storageAdmin }` call sites keep working.
 */
const storageAdminExport = new Proxy({} as Storage, {
  get(_target, prop, receiver) {
    const client = getStorageAdmin();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/** Default app bucket (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET). */
export function getAdminBucket(bucketName?: string) {
  if (!app) {
    throw initError instanceof Error
      ? initError
      : new Error(
          '[firebase-admin] Admin SDK is not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY on the host.'
        );
  }
  const name =
    bucketName ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    (app.options.storageBucket as string | undefined);
  if (!name) {
    throw new Error(
      'Storage bucket no configurado. Define NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.'
    );
  }
  return getStorageAdmin().bucket(name);
}

/** True when Firebase Admin Auth/Firestore initialized successfully. */
export function isFirebaseAdminReady(): boolean {
  return Boolean(app) && initError == null;
}

export {
  authAdmin,
  firestoreAdmin,
  storageAdminExport as storageAdmin,
  messagingAdminExport as messagingAdmin,
};

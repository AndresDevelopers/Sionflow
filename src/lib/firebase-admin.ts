import fs from 'fs';
import logger from './logger';
import { initializeApp, getApps, cert, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

// Initialize Firebase Admin SDK
let app: App | undefined;
let authAdmin: Auth;
let firestoreAdmin: Firestore;
let storageAdmin: Storage;
let messagingAdmin: Messaging;
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

try {
  app = initializeAdminApp();
  authAdmin = getAuth(app);
  firestoreAdmin = getFirestore(app);
  storageAdmin = getStorage(app);
  messagingAdmin = getMessaging(app);
} catch (error) {
  // Do NOT rethrow: a bad service account must not brick routes that only need
  // jose/JWKS (login session cookie). Call sites that touch Admin will fail
  // with a clear error at request time instead of a module-load 500.
  initError = error;
  console.error('[firebase-admin] Failed to initialize Firebase Admin SDK:', error);
  const failing = new Proxy(
    {},
    {
      get() {
        throw initError instanceof Error
          ? initError
          : new Error(
              '[firebase-admin] Admin SDK is not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY on the host.'
            );
      },
    }
  );
  authAdmin = failing as Auth;
  firestoreAdmin = failing as Firestore;
  storageAdmin = failing as Storage;
  messagingAdmin = failing as Messaging;
}

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
  return storageAdmin.bucket(name);
}

/** True when Firebase Admin initialized successfully. */
export function isFirebaseAdminReady(): boolean {
  return Boolean(app) && initError == null;
}

export { authAdmin, firestoreAdmin, storageAdmin, messagingAdmin };

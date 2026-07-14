import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
} from 'firebase/messaging';
import { app } from '@/lib/firebase';
import type { BrowserPushDiagnostics } from '@/lib/push-diagnostics';
import { getPushDeviceId } from '@/lib/push-subscription';

let messaging: Messaging | null = null;
let messagingInitPromise: Promise<Messaging | null> | null = null;

export type PushEnableErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'ios-not-standalone'
  | 'permission-denied'
  | 'permission-dismissed'
  | 'service-worker'
  | 'vapid'
  | 'token'
  | 'unknown';

export class PushEnableError extends Error {
  readonly code: PushEnableErrorCode;

  constructor(code: PushEnableErrorCode, message: string) {
    super(message);
    this.name = 'PushEnableError';
    this.code = code;
  }
}

/** Detect iOS / iPadOS (incl. iPad desktop-class UA). */
export function isIosLikeDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) {
    return true;
  }

  // iPadOS 13+ can report as Macintosh with touch
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** PWA installed to home screen (required for iOS web push). */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
    if (window.matchMedia('(display-mode: fullscreen)').matches) {
      return true;
    }
  } catch {
    // matchMedia may throw in very old engines
  }

  // Legacy iOS Safari
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function isSecurePushContext(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  // localhost is treated as secure for SW/push in modern browsers
  return window.isSecureContext === true;
}

/**
 * Synchronous feature detection for Web Push (old Android → Android 16, desktop, iOS PWA).
 * Does not call Firebase isSupported() (async).
 */
export function isBrowserPushApiAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    isSecurePushContext() &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Full support check including Firebase Messaging runtime requirements.
 */
export async function isFirebaseMessagingSupported(): Promise<boolean> {
  if (!isBrowserPushApiAvailable()) {
    return false;
  }

  try {
    return await isSupported();
  } catch {
    return false;
  }
}

const SW_READY_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Wait until a registration has an active worker (Android Chrome can leave
 * installing/waiting briefly after register / update).
 */
async function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = SW_READY_TIMEOUT_MS
): Promise<ServiceWorkerRegistration> {
  if (registration.active) {
    return registration;
  }

  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    return withTimeout(navigator.serviceWorker.ready, timeoutMs, 'serviceWorker.ready');
  }

  if (worker.state === 'activated' && registration.active) {
    return registration;
  }

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const onStateChange = () => {
        if (worker.state === 'activated' || registration.active) {
          worker.removeEventListener('statechange', onStateChange);
          resolve();
        } else if (worker.state === 'redundant') {
          worker.removeEventListener('statechange', onStateChange);
          reject(new Error('Service worker became redundant before activation'));
        }
      };

      worker.addEventListener('statechange', onStateChange);
      // In case state already advanced between checks
      onStateChange();
    }),
    timeoutMs,
    'service worker activation'
  );

  if (!registration.active) {
    // Final fallback — ready resolves when there is an active worker controlling a client
    return withTimeout(navigator.serviceWorker.ready, 5_000, 'serviceWorker.ready');
  }

  return registration;
}

/**
 * Resolve the app service worker used for FCM.
 * Tries existing registration first, then registers /sw.js (production PWA).
 * Compatible with old Android WebViews that only expose partial SW APIs.
 */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    // Prefer the registration that covers this page (no path → current document URL)
    let registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.getRegistration('/')) ??
      null;

    // Production PWA registers /sw.js; if user toggles push before bootstrap finishes, register here.
    // In development next-pwa is disabled and SW is intentionally torn down — avoid re-registering.
    if (!registration && process.env.NODE_ENV === 'production') {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
      } catch (registerError) {
        console.error('Error registering service worker for push:', registerError);
      }
    }

    if (!registration) {
      // Last resort: wait for any SW that might still be installing
      try {
        registration = await withTimeout(
          navigator.serviceWorker.ready,
          3_000,
          'serviceWorker.ready'
        );
      } catch {
        return null;
      }
    }

    return await waitForActiveServiceWorker(registration);
  } catch (error) {
    console.error('Error waiting for service worker registration:', error);
    return null;
  }
}

export async function getBrowserPushDiagnostics(): Promise<BrowserPushDiagnostics> {
  if (!isBrowserPushApiAvailable()) {
    return {
      isSupported: false,
      permission: 'unsupported',
      deviceId: null,
      serviceWorkerScriptUrl: null,
      serviceWorkerState: null,
    };
  }

  const registration = await getServiceWorkerRegistration();
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing ?? null;

  return {
    isSupported: true,
    permission: Notification.permission,
    deviceId: getPushDeviceId(),
    serviceWorkerScriptUrl: worker?.scriptURL ?? null,
    serviceWorkerState: worker?.state ?? null,
  };
}

async function initializeMessagingAsync(): Promise<Messaging | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  if (messaging) {
    return messaging;
  }

  if (messagingInitPromise) {
    return messagingInitPromise;
  }

  messagingInitPromise = (async () => {
    try {
      const supported = await isSupported();
      if (!supported) {
        return null;
      }

      messaging = getMessaging(app);
      return messaging;
    } catch (error) {
      console.error('Error initializing Firebase Messaging:', error);
      return null;
    } finally {
      messagingInitPromise = null;
    }
  })();

  return messagingInitPromise;
}

/**
 * Sync helper for foreground listeners. Avoids calling getMessaging on browsers
 * without Push/SW (e.g. iOS Safari not installed as PWA) where it throws.
 */
export const initializeMessaging = (): Messaging | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  if (messaging) {
    return messaging;
  }

  if (!isBrowserPushApiAvailable()) {
    return null;
  }

  try {
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    console.error('Error initializing Firebase Messaging:', error);
    // Async path retries after isSupported()
    void initializeMessagingAsync();
    return null;
  }
};

async function getFcmToken(): Promise<string> {
  const messagingInstance = await initializeMessagingAsync();
  if (!messagingInstance) {
    throw new PushEnableError('unsupported', 'Firebase Messaging is not supported in this browser');
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.error('VAPID key not found in environment variables');
    throw new PushEnableError('vapid', 'VAPID key not configured');
  }

  const serviceWorkerRegistration = await getServiceWorkerRegistration();
  if (!serviceWorkerRegistration?.active) {
    throw new PushEnableError(
      'service-worker',
      'Service worker registration not ready for push notifications'
    );
  }

  try {
    const token = await getToken(messagingInstance, {
      vapidKey,
      serviceWorkerRegistration,
    });

    if (!token) {
      throw new PushEnableError('token', 'FCM returned an empty token');
    }

    return token;
  } catch (error) {
    if (error instanceof PushEnableError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    // Common Android Chrome / WebView failures around push service / SW
    if (/service worker|no active|registration|push service|AbortError|InvalidState/i.test(message)) {
      throw new PushEnableError('service-worker', message);
    }

    throw new PushEnableError('token', message || 'Failed to obtain FCM token');
  }
}

function assertCanEnablePush(): void {
  if (typeof window === 'undefined') {
    throw new PushEnableError('unsupported', 'Not in a browser environment');
  }

  if (!isSecurePushContext()) {
    throw new PushEnableError(
      'insecure-context',
      'Push notifications require HTTPS (or localhost)'
    );
  }

  if (!isBrowserPushApiAvailable()) {
    throw new PushEnableError(
      'unsupported',
      'This browser does not support web push notifications'
    );
  }

  // iOS / iPadOS only deliver web push when the app is installed to the home screen
  if (isIosLikeDevice() && !isStandaloneDisplayMode()) {
    throw new PushEnableError(
      'ios-not-standalone',
      'On iOS, install the app to the home screen and open it from there to enable push'
    );
  }
}

/**
 * Request notification permission (must stay close to the user gesture on Android)
 * and return an FCM token. Throws PushEnableError with a stable code.
 */
export const requestNotificationPermission = async (): Promise<string | null> => {
  assertCanEnablePush();

  // Request permission as early as possible to preserve user activation on mobile browsers
  // (Android 13+ / Android 16 map this to the system notification permission).
  let permission: NotificationPermission = Notification.permission;

  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch (error) {
      console.error('Notification.requestPermission failed:', error);
      throw new PushEnableError(
        'permission-denied',
        error instanceof Error ? error.message : 'Permission request failed'
      );
    }
  }

  if (permission === 'denied') {
    throw new PushEnableError(
      'permission-denied',
      'Notification permission denied by the user or system'
    );
  }

  if (permission !== 'granted') {
    // Older browsers may return non-standard values; treat as dismissed
    throw new PushEnableError('permission-dismissed', `Unexpected permission state: ${permission}`);
  }

  try {
    return await getFcmToken();
  } catch (error) {
    console.error('Error getting notification permission/token:', error);
    if (error instanceof PushEnableError) {
      throw error;
    }
    throw new PushEnableError(
      'token',
      error instanceof Error ? error.message : 'Failed to get FCM token'
    );
  }
};

export const getExistingNotificationToken = async (): Promise<string | null> => {
  try {
    if (typeof window === 'undefined' || !isBrowserPushApiAvailable()) {
      return null;
    }

    if (Notification.permission !== 'granted') {
      return null;
    }

    if (!(await isFirebaseMessagingSupported())) {
      return null;
    }

    return await getFcmToken();
  } catch (error) {
    console.error('Error getting existing notification token:', error);
    return null;
  }
};

/**
 * Best-effort token deletion. Never throws — disable flows must still clear server prefs.
 */
export const deleteNotificationToken = async (): Promise<boolean> => {
  try {
    if (typeof window === 'undefined' || !isBrowserPushApiAvailable()) {
      return false;
    }

    if (!(await isFirebaseMessagingSupported())) {
      return false;
    }

    const messagingInstance = await initializeMessagingAsync();
    if (!messagingInstance) {
      return false;
    }

    // Ensure SW is available; deleteToken uses the same registration scope as getToken
    await getServiceWorkerRegistration();
    return await deleteToken(messagingInstance);
  } catch (error) {
    console.error('Error deleting notification token:', error);
    return false;
  }
};

// Listen for foreground messages
export const onMessageListener = (callback: (payload: Record<string, unknown>) => void) => {
  const messagingInstance = initializeMessaging();
  if (!messagingInstance) {
    return () => undefined;
  }

  return onMessage(messagingInstance, (payload) => {
    callback(payload as unknown as Record<string, unknown>);
  });
};

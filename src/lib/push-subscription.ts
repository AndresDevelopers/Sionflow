import { doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { pushSubscriptionsCollection, usersCollection } from '@/lib/collections';
import { getAppStoragePrefix } from '@/lib/app-config';

const PUSH_DEVICE_STORAGE_KEY = `${getAppStoragePrefix()}.push.device-id`;

export interface PushSubscriptionRecord {
  userId: string;
  deviceId: string;
  fcmToken: string | null;
  /** Explicit per-device opt-in. Prefer this + fcmToken over account-level flags. */
  enabled?: boolean;
  userAgent?: string;
  platform?: string;
  updatedAt?: unknown;
  subscribedAt?: unknown;
  unsubscribedAt?: unknown;
  lastPushAttemptAt?: unknown;
  lastPushAttemptMode?: 'live' | 'dry-run';
  lastPushResult?: 'success' | 'failure' | 'invalid-token' | 'not-attempted';
  lastPushErrorCode?: string | null;
  lastNotificationTag?: string | null;
}

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getPushDeviceId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const existingDeviceId = window.localStorage.getItem(PUSH_DEVICE_STORAGE_KEY);
    if (existingDeviceId) {
      return existingDeviceId;
    }

    const nextDeviceId = createDeviceId();
    window.localStorage.setItem(PUSH_DEVICE_STORAGE_KEY, nextDeviceId);
    return nextDeviceId;
  } catch (error) {
    console.error('Error reading push device ID:', error);
    return null;
  }
}

export function getPushSubscriptionDocId(userId: string, deviceId: string): string {
  return `${userId}_${deviceId}`;
}

export function getCurrentPushSubscriptionTarget(userId: string) {
  const deviceId = getPushDeviceId();
  if (!deviceId) {
    return null;
  }

  return {
    deviceId,
    ref: doc(pushSubscriptionsCollection, getPushSubscriptionDocId(userId, deviceId)),
  };
}

/** navigator.platform is empty/deprecated on many Android 10+ browsers; fall back safely. */
function getClientPlatformLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  const fromUaData = nav.userAgentData?.platform?.trim();
  if (fromUaData) {
    return fromUaData;
  }

  const fromPlatform = typeof navigator.platform === 'string' ? navigator.platform.trim() : '';
  if (fromPlatform) {
    return fromPlatform;
  }

  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'unknown';
}

export function isActivePushSubscription(
  subscription: Pick<PushSubscriptionRecord, 'fcmToken' | 'enabled'> | null | undefined
): boolean {
  if (!subscription) {
    return false;
  }

  const token = subscription.fcmToken;
  if (typeof token !== 'string' || token.length === 0) {
    return false;
  }

  // Legacy docs may omit `enabled`; treat non-empty token as active.
  if (subscription.enabled === false) {
    return false;
  }

  return true;
}

/**
 * Whether THIS browser/device currently has push enabled for the user.
 * Source of truth for the Settings switch (not the account-level flag).
 */
export async function isCurrentDevicePushEnabled(userId: string): Promise<boolean> {
  const subscription = await getCurrentPushSubscription(userId);
  return isActivePushSubscription(subscription);
}

/**
 * Lists deviceIds with an active FCM token for this user.
 */
export async function listActivePushDeviceIds(userId: string): Promise<string[]> {
  const snapshot = await getDocs(
    query(pushSubscriptionsCollection, where('userId', '==', userId))
  );

  const deviceIds: string[] = [];
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() as PushSubscriptionRecord;
    if (!isActivePushSubscription(data)) {
      return;
    }
    deviceIds.push(
      typeof data.deviceId === 'string' && data.deviceId.length > 0
        ? data.deviceId
        : docSnap.id
    );
  });

  return deviceIds;
}

export async function userHasAnyActivePushDevice(
  userId: string,
  options?: { excludeDeviceId?: string }
): Promise<boolean> {
  const active = await listActivePushDeviceIds(userId);
  if (!options?.excludeDeviceId) {
    return active.length > 0;
  }
  return active.some((id) => id !== options.excludeDeviceId);
}

/**
 * Keeps c_users.pushNotificationsEnabled as a derived “any device active” flag
 * for server-side eligibility / diagnostics. Delivery still uses per-device tokens.
 */
export async function syncAccountPushEnabledFlag(userId: string): Promise<boolean> {
  const enabled = await userHasAnyActivePushDevice(userId);
  await setDoc(
    doc(usersCollection, userId),
    { pushNotificationsEnabled: enabled },
    { merge: true }
  );
  return enabled;
}

export async function saveCurrentPushSubscription(userId: string, fcmToken: string): Promise<boolean> {
  const target = getCurrentPushSubscriptionTarget(userId);
  if (!target) {
    return false;
  }

  await setDoc(
    target.ref,
    {
      userId,
      deviceId: target.deviceId,
      fcmToken,
      enabled: true,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      platform: getClientPlatformLabel(),
      updatedAt: serverTimestamp(),
      subscribedAt: serverTimestamp(),
      unsubscribedAt: null,
    },
    { merge: true }
  );

  return true;
}

/**
 * Opt out push for THIS device only. Other devices keep their tokens.
 */
export async function clearCurrentPushSubscription(userId: string): Promise<boolean> {
  const target = getCurrentPushSubscriptionTarget(userId);
  if (!target) {
    return false;
  }

  await setDoc(
    target.ref,
    {
      userId,
      deviceId: target.deviceId,
      fcmToken: null,
      enabled: false,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      platform: getClientPlatformLabel(),
      updatedAt: serverTimestamp(),
      unsubscribedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}

export async function getCurrentPushSubscription(userId: string): Promise<PushSubscriptionRecord | null> {
  const target = getCurrentPushSubscriptionTarget(userId);
  if (!target) {
    return null;
  }

  const subscriptionDoc = await getDoc(target.ref);
  if (!subscriptionDoc.exists()) {
    return null;
  }

  return subscriptionDoc.data() as PushSubscriptionRecord;
}

export async function getCurrentPushSubscriptionToken(userId: string): Promise<string | null> {
  const subscription = await getCurrentPushSubscription(userId);
  if (!isActivePushSubscription(subscription)) {
    return null;
  }
  return subscription?.fcmToken ?? null;
}

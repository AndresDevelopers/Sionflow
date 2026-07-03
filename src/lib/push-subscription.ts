import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { pushSubscriptionsCollection } from '@/lib/collections';

const PUSH_DEVICE_STORAGE_KEY = 'quorumflow.push.device-id';

export interface PushSubscriptionRecord {
  userId: string;
  deviceId: string;
  fcmToken: string | null;
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

export async function saveCurrentPushSubscription(userId: string, fcmToken: string): Promise<boolean> {
  const target = getCurrentPushSubscriptionTarget(userId);
  if (!target) {
    return false;
  }

  await setDoc(target.ref, {
    userId,
    deviceId: target.deviceId,
    fcmToken,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    updatedAt: serverTimestamp(),
    subscribedAt: serverTimestamp(),
  }, { merge: true });

  return true;
}

export async function clearCurrentPushSubscription(userId: string): Promise<boolean> {
  const target = getCurrentPushSubscriptionTarget(userId);
  if (!target) {
    return false;
  }

  await setDoc(target.ref, {
    userId,
    deviceId: target.deviceId,
    fcmToken: null,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    updatedAt: serverTimestamp(),
    unsubscribedAt: serverTimestamp(),
  }, { merge: true });

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
  return subscription?.fcmToken ?? null;
}

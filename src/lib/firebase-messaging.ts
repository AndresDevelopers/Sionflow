import { deleteToken, getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging';
import { app } from '@/lib/firebase';
import type { BrowserPushDiagnostics } from '@/lib/push-diagnostics';
import { getPushDeviceId } from '@/lib/push-subscription';

let messaging: Messaging | null = null;

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (registration) {
      return registration;
    }

    return await navigator.serviceWorker.ready;
  } catch (error) {
    console.error('Error waiting for service worker registration:', error);
    return null;
  }
}

export async function getBrowserPushDiagnostics(): Promise<BrowserPushDiagnostics> {
  const isSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  if (!isSupported) {
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

async function getFcmToken(): Promise<string | null> {
  const messagingInstance = initializeMessaging();
  if (!messagingInstance) {
    throw new Error('Messaging not initialized');
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.error('VAPID key not found in environment variables');
    throw new Error('VAPID key not configured');
  }

  const serviceWorkerRegistration = await getServiceWorkerRegistration();
  if (!serviceWorkerRegistration) {
    throw new Error('Service worker registration not ready');
  }

  return getToken(messagingInstance, {
    vapidKey,
    serviceWorkerRegistration,
  });
}

// Initialize Firebase Messaging
export const initializeMessaging = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    if (!messaging) {
      messaging = getMessaging(app);
    }
    return messaging;
  } catch (error) {
    console.error('Error initializing Firebase Messaging:', error);
    return null;
  }
};

// Request notification permission and get FCM token
export const requestNotificationPermission = async (): Promise<string | null> => {
  try {
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      console.log('Notification permission denied');
      return null;
    }

    return await getFcmToken();
  } catch (error) {
    console.error('Error getting notification permission:', error);
    return null;
  }
};

export const getExistingNotificationToken = async (): Promise<string | null> => {
  try {
    if (typeof window === 'undefined' || Notification.permission !== 'granted') {
      return null;
    }

    return await getFcmToken();
  } catch (error) {
    console.error('Error getting existing notification token:', error);
    return null;
  }
};

export const deleteNotificationToken = async (): Promise<boolean> => {
  try {
    const messagingInstance = initializeMessaging();
    if (!messagingInstance) {
      return false;
    }

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

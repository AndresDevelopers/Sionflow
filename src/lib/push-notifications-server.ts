
import { firestoreAdmin, messagingAdmin } from './firebase-admin';
import { pushSubscriptionsCollection, usersCollection, notificationsCollection } from './collections-server';
import { createHash } from 'crypto';

// FCM sendEachForMulticast supports max 500 tokens per call
const FCM_BATCH_LIMIT = 500;
// Firestore 'in' operator supports max 30 items
const FIRESTORE_IN_LIMIT = 30;

export interface PushNotificationParams {
  title: string;
  body: string;
  url?: string;
  userId?: string; // If provided, only send to this user. If not, send to all with push enabled.
  tag?: string;
}

function getEcuadorDateKey(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function buildDeterministicInAppNotificationDocId(params: {
  userId: string;
  tag: string;
  title: string;
  body: string;
  dateKey: string;
}): string {
  const base = `${params.userId}__${params.tag}__${params.dateKey}__${params.title}__${params.body}`;
  return createHash('sha256').update(base).digest('hex');
}

/**
 * Fetch FCM tokens for a list of user IDs.
 */
async function getFCMTokensForUsers(userIds: string[]): Promise<string[]> {
  const tokens: string[] = [];

  for (let i = 0; i < userIds.length; i += FIRESTORE_IN_LIMIT) {
    const chunk = userIds.slice(i, i + FIRESTORE_IN_LIMIT);
    const snapshot = await pushSubscriptionsCollection
      .where('userId', 'in', chunk)
      .get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.fcmToken) {
        tokens.push(data.fcmToken as string);
      }
    });
  }

  return [...new Set(tokens)];
}

/**
 * Sends a push notification via FCM and also creates in-app notifications.
 */
export async function sendServerSidePushNotification(params: PushNotificationParams) {
  const { title, body, url, userId, tag = 'general-notification' } = params;

  let targetUserIds: string[] = [];

  if (userId) {
    targetUserIds = [userId];
  } else {
    // Broadcast: get all users with push notifications enabled
    const usersSnapshot = await usersCollection.get();
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.pushNotificationsEnabled === true || userData.notificationsEnabled !== false) {
        targetUserIds.push(doc.id);
      }
    });
  }

  if (targetUserIds.length === 0) {
    return { success: true, sentCount: 0, message: 'No target users' };
  }

  const tokens = await getFCMTokensForUsers(targetUserIds);

  if (tokens.length === 0) {
    return { success: true, sentCount: 0, message: 'No FCM tokens found' };
  }

  let totalSuccess = 0;
  let totalFailure = 0;

  // 1. Send FCM Push
  for (let i = 0; i < tokens.length; i += FCM_BATCH_LIMIT) {
    const tokenBatch = tokens.slice(i, i + FCM_BATCH_LIMIT);
    const message = {
      notification: { title, body },
      data: {
        url: url ?? '/',
        title,
        body,
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title,
          body,
          icon: '/logo.svg',
          badge: '/logo.svg',
          tag: tag,
        },
        fcmOptions: { link: url ?? '/' },
      },
      tokens: tokenBatch,
    };

    const response = await messagingAdmin.sendEachForMulticast(message);
    totalSuccess += response.successCount;
    totalFailure += response.failureCount;

    // Track results and invalidate dead tokens
    const batch = firestoreAdmin.batch();
    for (let j = 0; j < response.responses.length; j++) {
      const resp = response.responses[j];
      const token = tokenBatch[j];
      
      if (!resp.success) {
        console.error(`[Push] Failed token ${token}:`, resp.error?.code);
      }

      const isInvalidToken =
        resp.error?.code === 'messaging/registration-token-not-registered' ||
        resp.error?.code === 'messaging/invalid-registration-token';

      // Find subscription docs for this token to update them
      const subSnapshot = await pushSubscriptionsCollection.where('fcmToken', '==', token).get();
      subSnapshot.forEach(subDoc => {
        batch.set(
          subDoc.ref,
          {
            lastPushAttemptAt: new Date(),
            lastPushAttemptMode: 'automatic',
            lastPushResult: resp.success ? 'success' : (isInvalidToken ? 'invalid-token' : 'failure'),
            lastPushErrorCode: resp.error?.code ?? null,
            lastNotificationTag: tag,
            updatedAt: new Date(),
            ...(isInvalidToken ? {
              fcmToken: null,
              unsubscribedAt: new Date(),
            } : {}),
          },
          { merge: true }
        );
      });
    }
    await batch.commit();
  }

  // 2. Create In-App Notifications (idempotent by user+tag+content+Ecuador day)
  const batchSize = 200;
  const dateKey = getEcuadorDateKey();
  for (let i = 0; i < targetUserIds.length; i += batchSize) {
    const chunk = targetUserIds.slice(i, i + batchSize);

    await Promise.all(chunk.map(async (uid) => {
      const notifRef = notificationsCollection.doc(
        buildDeterministicInAppNotificationDocId({
          userId: uid,
          tag,
          title,
          body,
          dateKey,
        })
      );
      try {
        await notifRef.create({
          userId: uid,
          title,
          body,
          createdAt: new Date(),
          isRead: false,
          actionUrl: url ?? '/',
          actionType: 'navigate',
          contextType: tag === 'birthday-notification' ? 'birthday' : 'general'
        });
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined;
        // Already exists (Firestore ALREADY_EXISTS) -> skip to keep idempotency
        if (code === 6 || code === 'already-exists') {
          return;
        }
        throw error;
      }
    }));
  }

  return {
    success: true,
    sentCount: totalSuccess,
    failedCount: totalFailure
  };
}

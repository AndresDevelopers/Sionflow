
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
  barrioOrg?: string | null;
}

/** Resultado de una operación de push notification */
export interface PushNotificationResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  message?: string;
}

interface TokenInfo {
  docId: string;
  fcmToken: string;
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
 * Obtiene los FCM tokens junto con sus docIds para usuarios específicos.
 * Retorna los tokens únicos y un mapa token → docIds para invalidación sin N+1.
 */
async function getFCMTokenInfoForUsers(userIds: string[]): Promise<{
  uniqueTokens: string[];
  tokenToDocIds: Map<string, string[]>;
}> {
  const tokenInfos: TokenInfo[] = [];

  for (let i = 0; i < userIds.length; i += FIRESTORE_IN_LIMIT) {
    const chunk = userIds.slice(i, i + FIRESTORE_IN_LIMIT);
    const snapshot = await pushSubscriptionsCollection
      .where('userId', 'in', chunk)
      .get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.fcmToken) {
        tokenInfos.push({
          docId: doc.id,
          fcmToken: data.fcmToken as string,
        });
      }
    });
  }

  // Deduplicar tokens y mantener mapeo token → docIds
  const tokenToDocIds = new Map<string, string[]>();
  const uniqueTokens: string[] = [];

  for (const info of tokenInfos) {
    if (tokenToDocIds.has(info.fcmToken)) {
      tokenToDocIds.get(info.fcmToken)!.push(info.docId);
    } else {
      tokenToDocIds.set(info.fcmToken, [info.docId]);
      uniqueTokens.push(info.fcmToken);
    }
  }

  return { uniqueTokens, tokenToDocIds };
}

// ── Cache en memoria para targetUserIds ─────────────────────────────────
// Evita leer c_users completo en cada llamada del Vercel Cron.
let _targetUsersCache: {
  key: string;
  userIds: string[];
  ts: number;
} | null = null;
const TARGET_USERS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos

async function getTargetUserIds(barrioOrg?: string | null): Promise<string[]> {
  const cacheKey = barrioOrg || '__all__';
  const now = Date.now();

  if (_targetUsersCache && _targetUsersCache.key === cacheKey &&
      (now - _targetUsersCache.ts) < TARGET_USERS_CACHE_TTL_MS) {
    return _targetUsersCache.userIds;
  }

  const usersSnapshot = await usersCollection.get();
  const userIds: string[] = [];
  usersSnapshot.forEach((doc) => {
    const userData = doc.data();
    if (barrioOrg && userData.barrioOrg !== barrioOrg) return;
    // Solo usuarios que han activado explícitamente push (consistente con Cloud Functions)
    if (userData.pushNotificationsEnabled === true) {
      userIds.push(doc.id);
    }
  });

  _targetUsersCache = { key: cacheKey, userIds, ts: now };
  return userIds;
}

/**
 * Sends a push notification via FCM and also creates in-app notifications.
 * Optimizado: sin N+1 queries al invalidar tokens (usa mapa token→docIds).
 */
export async function sendServerSidePushNotification(
  params: PushNotificationParams
): Promise<PushNotificationResult> {
  const { title, body, url, userId, tag = 'general-notification', barrioOrg } = params;

  let targetUserIds: string[] = [];

  if (userId) {
    targetUserIds = [userId];
  } else {
    targetUserIds = await getTargetUserIds(barrioOrg);
  }

  if (targetUserIds.length === 0) {
    return { success: true, sentCount: 0, failedCount: 0, message: 'No target users' };
  }

  const { uniqueTokens, tokenToDocIds } = await getFCMTokenInfoForUsers(targetUserIds);

  if (uniqueTokens.length === 0) {
    return { success: true, sentCount: 0, failedCount: 0, message: 'No FCM tokens found' };
  }

  let totalSuccess = 0;
  let totalFailure = 0;

  // 1. Send FCM Push (sin N+1: usamos tokenToDocIds en lugar de re-query)
  for (let i = 0; i < uniqueTokens.length; i += FCM_BATCH_LIMIT) {
    const tokenBatch = uniqueTokens.slice(i, i + FCM_BATCH_LIMIT);
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
          icon: '/icono-app.png',
          badge: '/icono-app.png',
          tag: tag,
        },
        fcmOptions: { link: url ?? '/' },
      },
      tokens: tokenBatch,
    };

    const response = await messagingAdmin.sendEachForMulticast(message);
    totalSuccess += response.successCount;
    totalFailure += response.failureCount;

    // Track results and invalidate dead tokens (sin N+1)
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

      // Usar el mapa pre-construido en lugar de hacer un query por token
      const docIds = tokenToDocIds.get(token) ?? [];
      for (const docId of docIds) {
        batch.set(
          pushSubscriptionsCollection.doc(docId),
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
      }
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
          contextType: tag === 'birthday-notification' ? 'birthday' : 'general',
          ...(barrioOrg ? { barrioOrg } : {}),
        });
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined;
        // Already exists (Firestore ALREADY_EXISTS) → skip to keep idempotency
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
    failedCount: totalFailure,
  };
}

/**
 * Envía notificaciones de cumpleaños para múltiples personas en un solo batch.
 * Evita leer c_users completo por cada cumpleañero individual.
 */
export async function sendBirthdayBatchNotifications(
  birthdays: { name: string; id: string; barrioOrg?: string | null }[]
): Promise<{ totalPushSent: number; errors: string[] }> {
  if (birthdays.length === 0) {
    return { totalPushSent: 0, errors: [] };
  }

  let totalPushSent = 0;
  const errors: string[] = [];

  for (const birthday of birthdays) {
    try {
      const result = await sendServerSidePushNotification({
        title: '\uD83C\uDF82 ¡Feliz Cumpleaños!',
        body: `Hoy es el cumpleaños de ${birthday.name}. ¡No olvides felicitarlo!`,
        url: '/birthdays',
        tag: 'birthday-notification',
        barrioOrg: birthday.barrioOrg,
      });
      if (result.success) {
        totalPushSent += result.sentCount || 0;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Error for ${birthday.name}: ${msg}`);
    }
  }

  return { totalPushSent, errors };
}

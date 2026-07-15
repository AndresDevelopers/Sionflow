import { NextRequest, NextResponse } from 'next/server';
import { firestoreAdmin, messagingAdmin } from '@/lib/firebase-admin';
import { getAppNotificationTag } from '@/lib/app-config';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  getErrorStatus,
  getUserBarrioOrg,
  requireLeadership,
  requireUidAndBarrioOrg,
  sanitizeAppRelativeUrl,
} from '@/lib/api-auth';

// Firestore 'in' operator supports max 30 items
const FIRESTORE_IN_LIMIT = 30;

/**
 * Fetch FCM tokens for a list of user IDs.
 * Returns every active token registered for the target users.
 */
async function getFCMTokensForUsers(userIds: string[]): Promise<string[]> {
  const tokens: string[] = [];

  for (let i = 0; i < userIds.length; i += FIRESTORE_IN_LIMIT) {
    const chunk = userIds.slice(i, i + FIRESTORE_IN_LIMIT);
    const snapshot = await firestoreAdmin
      .collection('c_push_subscriptions')
      .where('userId', 'in', chunk)
      .get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      const token = data.fcmToken;
      // Only devices that opted in on that device (token present, not disabled)
      if (typeof token === 'string' && token.length > 0 && data.enabled !== false) {
        tokens.push(token);
      }
    });
  }

  // Deduplicate tokens in case a user has multiple entries
  return [...new Set(tokens)];
}

async function getSubscriptionDocsByTokens(tokens: string[]) {
  if (tokens.length === 0) {
    return new Map<string, string[]>();
  }

  const matches = new Map<string, string[]>();
  for (const token of tokens) {
    const snapshot = await firestoreAdmin
      .collection('c_push_subscriptions')
      .where('fcmToken', '==', token)
      .get();

    matches.set(token, snapshot.docs.map((doc) => doc.id));
  }

  return matches;
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const { uid, barrioOrg: callerBarrioOrg } = await requireUidAndBarrioOrg(request);
    // Broadcast / targeted push can spam the whole ward — leadership only.
    await requireLeadership(uid);

    const { title, body, url, userId } = await request.json() as {
      title?: string;
      body?: string;
      url?: string;
      userId?: string;
    };

    if (!title || !body) {
      return NextResponse.json(
        { error: 'Title and body are required' },
        { status: 400 }
      );
    }

    // Only same-app relative paths (block open redirects / phishing via push deep links).
    const safeUrl = sanitizeAppRelativeUrl(url, '/');

    let targetUserIds: string[] = [];

    if (userId) {
      // Target a single user — must share the caller's barrioOrg
      let targetBarrioOrg: string;
      try {
        targetBarrioOrg = await getUserBarrioOrg(userId);
      } catch (error) {
        const status = getErrorStatus(error, 403);
        if (status === 403) {
          return NextResponse.json(
            { error: 'No tienes acceso a este usuario' },
            { status: 403 }
          );
        }
        throw error;
      }
      if (targetBarrioOrg !== callerBarrioOrg) {
        return NextResponse.json(
          { error: 'No tienes acceso a este usuario' },
          { status: 403 }
        );
      }
      targetUserIds = [userId];
    } else {
      // Broadcast to the caller's barrio. Only devices with an active
      // c_push_subscriptions token receive FCM (per-device opt-in).
      const usersSnapshot = await firestoreAdmin
        .collection('c_users')
        .where('barrioOrg', '==', callerBarrioOrg)
        .get();
      usersSnapshot.forEach((doc) => {
        targetUserIds.push(doc.id);
      });
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No hay usuarios con notificaciones push habilitadas',
        sentCount: 0,
        failedCount: 0,
      });
    }

    const tokens = await getFCMTokensForUsers(targetUserIds);

    if (tokens.length === 0) {
      return NextResponse.json({
        success: true,
        message: `${targetUserIds.length} usuario(s) con notificaciones activas pero sin token FCM registrado. El usuario debe activar notificaciones desde el dispositivo.`,
        sentCount: 0,
        failedCount: 0,
      });
    }

    // FCM sendEachForMulticast supports max 500 tokens per call
    const FCM_BATCH_LIMIT = 500;
    let totalSuccess = 0;
    let totalFailure = 0;

    const subscriptionDocsByToken = await getSubscriptionDocsByTokens(tokens);

    for (let i = 0; i < tokens.length; i += FCM_BATCH_LIMIT) {
      const tokenBatch = tokens.slice(i, i + FCM_BATCH_LIMIT);
      const message = {
        notification: { title, body },
        data: {
          url: safeUrl,
          title,
          body,
        },
        webpush: {
          headers: {
            Urgency: 'high',
          },
          notification: {
            title,
            body,
            icon: '/icono-app.png',
            badge: '/icono-app.png',
            tag: getAppNotificationTag(),
          },
          fcmOptions: {
            link: safeUrl,
          },
        },
        tokens: tokenBatch,
      };

      const response = await messagingAdmin.sendEachForMulticast(message);
      totalSuccess += response.successCount;
      totalFailure += response.failureCount;

      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.error('[FCM] Failed token:', tokenBatch[idx], resp.error?.code);
          }
        });
      }

      const batch = firestoreAdmin.batch();
      response.responses.forEach((resp, idx) => {
        const token = tokenBatch[idx];
        const docIds = subscriptionDocsByToken.get(token) ?? [];
        const isInvalidToken =
          resp.error?.code === 'messaging/registration-token-not-registered' ||
          resp.error?.code === 'messaging/invalid-registration-token';

        docIds.forEach((docId) => {
          batch.set(
            firestoreAdmin.collection('c_push_subscriptions').doc(docId),
            {
              lastPushAttemptAt: new Date(),
              lastPushAttemptMode: 'live',
              lastPushResult: resp.success ? 'success' : (isInvalidToken ? 'invalid-token' : 'failure'),
              lastPushErrorCode: resp.error?.code ?? null,
              lastNotificationTag: 'api-send-fcm-notification',
              updatedAt: new Date(),
              ...(isInvalidToken
                ? {
                  fcmToken: null,
                  enabled: false,
                  unsubscribedAt: new Date(),
                }
                : {}),
            },
            { merge: true }
          );
        });
      });
      await batch.commit();
    }

    console.log(`[FCM] Sent: ${totalSuccess} ok, ${totalFailure} failed`);

    return NextResponse.json({
      success: true,
      message: `Notificaciones enviadas: ${totalSuccess} exitosas, ${totalFailure} fallidas`,
      sentCount: totalSuccess,
      failedCount: totalFailure,
    });
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }
    console.error('[FCM] Error in send-fcm-notification API:', error);
    return NextResponse.json(
      { error: 'Failed to send push notifications' },
      { status: 500 }
    );
  }
}

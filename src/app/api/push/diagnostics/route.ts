import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { authAdmin, firestoreAdmin, messagingAdmin } from '@/lib/firebase-admin';
import { hasLeadershipPrivileges, normalizeRole } from '@/lib/roles';
import {
  type PushDiagnosticsResponse,
  pushDiagnosticsRequestSchema,
  type PushSubscriptionDiagnostic,
} from '@/lib/push-diagnostics';

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim() || null;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : null;
  }

  return null;
}

function formatEcuadorTime(date: Date): string {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
    }

    const decodedToken = await authAdmin.verifyIdToken(token);
    const viewerDoc = await firestoreAdmin.collection('c_users').doc(decodedToken.uid).get();
    const viewerRole = normalizeRole(viewerDoc.data()?.role);

    if (!hasLeadershipPrivileges(viewerRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const parsedBody = pushDiagnosticsRequestSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const { userId, runDryCheck } = parsedBody.data;
    const targetUserId = userId ?? decodedToken.uid;

    const [targetUserDoc, subscriptionsSnapshot] = await Promise.all([
      firestoreAdmin.collection('c_users').doc(targetUserId).get(),
      firestoreAdmin.collection('c_push_subscriptions').where('userId', '==', targetUserId).get(),
    ]);

    const targetUserData = targetUserDoc.data() ?? {};
    const subscriptions = subscriptionsSnapshot.docs.map((doc) => {
      const data = doc.data();
      const diagnostic: PushSubscriptionDiagnostic = {
        docId: doc.id,
        userId: targetUserId,
        deviceId: typeof data.deviceId === 'string' ? data.deviceId : null,
        hasToken: typeof data.fcmToken === 'string' && data.fcmToken.length > 0,
        updatedAt: toIsoString(data.updatedAt),
        subscribedAt: toIsoString(data.subscribedAt),
        unsubscribedAt: toIsoString(data.unsubscribedAt),
        lastPushAttemptAt: toIsoString(data.lastPushAttemptAt),
        lastPushAttemptMode:
          data.lastPushAttemptMode === 'live' || data.lastPushAttemptMode === 'dry-run'
            ? data.lastPushAttemptMode
            : null,
        lastPushResult:
          data.lastPushResult === 'success' ||
          data.lastPushResult === 'failure' ||
          data.lastPushResult === 'invalid-token' ||
          data.lastPushResult === 'not-attempted'
            ? data.lastPushResult
            : null,
        lastPushErrorCode: typeof data.lastPushErrorCode === 'string' ? data.lastPushErrorCode : null,
        lastNotificationTag: typeof data.lastNotificationTag === 'string' ? data.lastNotificationTag : null,
        userAgent: typeof data.userAgent === 'string' ? data.userAgent : null,
        platform: typeof data.platform === 'string' ? data.platform : null,
      };

      return {
        ref: doc.ref,
        diagnostic,
        token: typeof data.fcmToken === 'string' && data.fcmToken.length > 0 ? data.fcmToken : null,
      };
    });

    let dryRunSummary: PushDiagnosticsResponse['dryRunSummary'];

    if (runDryCheck) {
      const tokenRecords = subscriptions.filter((subscription) => subscription.token);
      const uniqueTokens = [...new Set(tokenRecords.map((subscription) => subscription.token).filter(Boolean))];

      if (uniqueTokens.length > 0) {
        const response = await messagingAdmin.sendEachForMulticast({
          tokens: uniqueTokens as string[],
          notification: {
            title: 'QuorumFlow Push Diagnostic',
            body: 'Dry-run validation for this subscription.',
          },
          data: {
            url: '/settings',
            tag: 'push-diagnostic-dry-run',
            title: 'QuorumFlow Push Diagnostic',
            body: 'Dry-run validation for this subscription.',
          },
          webpush: {
            fcmOptions: {
              link: '/settings',
            },
          },
        }, true);

        dryRunSummary = {
          tokensChecked: uniqueTokens.length,
          successCount: response.successCount,
          failureCount: response.failureCount,
        };

        const tokenResultMap = new Map<string, { success: boolean; errorCode: string | null; errorMessage: string | null }>();
        response.responses.forEach((result, index) => {
          tokenResultMap.set(uniqueTokens[index] as string, {
            success: result.success,
            errorCode: result.error?.code ?? null,
            errorMessage: result.error?.message ?? null,
          });
        });

        const batch = firestoreAdmin.batch();
        for (const subscription of tokenRecords) {
          const tokenResult = tokenResultMap.get(subscription.token as string);
          if (!tokenResult) {
            continue;
          }

          subscription.diagnostic.dryRunStatus = tokenResult.success ? 'success' : 'failure';
          subscription.diagnostic.dryRunErrorCode = tokenResult.errorCode;
          subscription.diagnostic.dryRunErrorMessage = tokenResult.errorMessage;

          batch.set(subscription.ref, {
            lastPushAttemptAt: FieldValue.serverTimestamp(),
            lastPushAttemptMode: 'dry-run',
            lastPushResult: tokenResult.success ? 'success' : 'failure',
            lastPushErrorCode: tokenResult.errorCode,
            lastNotificationTag: 'push-diagnostic-dry-run',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        await batch.commit();
      } else {
        dryRunSummary = {
          tokensChecked: 0,
          successCount: 0,
          failureCount: 0,
        };
      }
    }

    const now = new Date();
    const response: PushDiagnosticsResponse = {
      viewerUserId: decodedToken.uid,
      viewerRole,
      targetUserId,
      pushNotificationsEnabled: targetUserData.pushNotificationsEnabled === true,
      inAppNotificationsEnabled: targetUserData.inAppNotificationsEnabled !== false,
      serverTimeUtc: now.toISOString(),
      serverTimeEcuador: formatEcuadorTime(now),
      subscriptions: subscriptions.map((subscription) => subscription.diagnostic),
      ...(dryRunSummary ? { dryRunSummary } : {}),
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to build push diagnostics',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

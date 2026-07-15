import { NextRequest, NextResponse } from 'next/server';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  getErrorStatus,
  requireLeadership,
  requireUidAndBarrioOrg,
} from '@/lib/api-auth';

/**
 * Count how many users in the caller's barrio would receive a notification.
 * Does NOT scan all barrios. Requires Bearer auth + leadership.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const { uid, barrioOrg } = await requireUidAndBarrioOrg(request);
    await requireLeadership(uid);
    const { title, body } = await request.json();

    if (!title || !body) {
      return NextResponse.json(
        { error: 'Title and body are required' },
        { status: 400 }
      );
    }

    const usersSnapshot = await firestoreAdmin
      .collection('c_users')
      .where('barrioOrg', '==', barrioOrg)
      .get();

    let notificationCount = 0;
    let skippedCount = 0;

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const notificationsEnabled = userData.notificationsEnabled !== false;
      if (notificationsEnabled) {
        notificationCount++;
      } else {
        skippedCount++;
      }
    });

    return NextResponse.json({
      success: true,
      message: `${notificationCount} usuarios recibirán la notificación, ${skippedCount} la tienen desactivada`,
      notificationCount,
      skippedCount,
      barrioOrg,
    });
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }
    console.error('Error in send-push-notification API:', error);
    return NextResponse.json(
      { error: 'Failed to process notification preferences' },
      { status: 500 }
    );
  }
}

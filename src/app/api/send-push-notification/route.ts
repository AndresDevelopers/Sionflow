import { NextRequest, NextResponse } from 'next/server';
import { firestoreAdmin } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const { title, body, url } = await request.json();

    if (!title || !body) {
      return NextResponse.json(
        { error: 'Title and body are required' },
        { status: 400 }
      );
    }

    // Get all users from Firestore
    const usersSnapshot = await firestoreAdmin
      .collection('c_users')
      .get();

    let notificationCount = 0;
    let skippedCount = 0;

    // Count users with notifications enabled
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      // Por defecto las notificaciones están activas (notificationsEnabled !== false)
      const notificationsEnabled = userData.notificationsEnabled !== false;
      
      if (notificationsEnabled) {
        notificationCount++;
      } else {
        skippedCount++;
      }
    });

    // Note: Las notificaciones push reales se manejarán cuando el usuario
    // abra la app y vea las notificaciones in-app que ya se crearon en Firestore
    // Este endpoint solo sirve para contar cuántos usuarios recibirían la notificación

    return NextResponse.json({
      success: true,
      message: `${notificationCount} usuarios recibirán la notificación, ${skippedCount} la tienen desactivada`,
      notificationCount,
      skippedCount,
    });
  } catch (error) {
    console.error('Error in send-push-notification API:', error);
    return NextResponse.json(
      { error: 'Failed to process notification preferences' },
      { status: 500 }
    );
  }
}

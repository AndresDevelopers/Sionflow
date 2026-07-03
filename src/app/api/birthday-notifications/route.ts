
import { NextRequest, NextResponse } from 'next/server';
import { birthdaysCollection, membersCollection } from '@/lib/collections-server';
import { getEcuadorDateParts } from '@/lib/date-utils';
import { sendServerSidePushNotification } from '@/lib/push-notifications-server';

export async function GET(request: NextRequest) {
  // Verificación de autenticación para Vercel Cron
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const today = new Date();
    // Get date parts in Ecuador timezone (UTC-5)
    // Using Intl.DateTimeFormat to be consistent with getEcuadorDateParts
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guayaquil',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(today);
    const currentMonth = Number(parts.find((part) => part.type === 'month')?.value);
    const currentDay = Number(parts.find((part) => part.type === 'day')?.value);

    console.log(`[Birthdays] Checking for birthdays on ${currentDay}/${currentMonth} (Ecuador Time)`);

    const birthdaysToday: { name: string; id: string }[] = [];

    // 1. Fetch from c_birthdays
    const birthdaysSnapshot = await birthdaysCollection.get();
    birthdaysSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.birthDate) {
        const birthParts = getEcuadorDateParts(data.birthDate);
        if (birthParts && birthParts.month === currentMonth && birthParts.day === currentDay) {
          birthdaysToday.push({ name: data.name, id: doc.id });
        }
      }
    });

    // 2. Fetch from c_miembros (excluding deceased)
    const membersSnapshot = await membersCollection.where('status', '!=', 'deceased').get();
    membersSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.birthDate) {
        const birthParts = getEcuadorDateParts(data.birthDate);
        if (birthParts && birthParts.month === currentMonth && birthParts.day === currentDay) {
          const name = `${data.firstName} ${data.lastName}`;
          // Avoid duplicates if they are already in birthdaysToday
          if (!birthdaysToday.find(b => b.name === name)) {
            birthdaysToday.push({ name, id: doc.id });
          }
        }
      }
    });

    console.log(`[Birthdays] Found ${birthdaysToday.length} birthdays today`);

    if (birthdaysToday.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No hay cumpleaños registrados para el día de hoy.',
        count: 0
      });
    }

    // 3. Send notifications for each birthday
    let totalNotificationsSent = 0;
    for (const birthday of birthdaysToday) {
      const result = await sendServerSidePushNotification({
        title: "🎂 ¡Feliz Cumpleaños!",
        body: `Hoy es el cumpleaños de ${birthday.name}. ¡No olvides felicitarlo!`,
        url: '/birthdays',
        tag: 'birthday-notification'
      });
      
      if (result.success) {
        totalNotificationsSent += (result.sentCount || 0);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Procesados ${birthdaysToday.length} cumpleaños.`,
      birthdays: birthdaysToday.map(b => b.name),
      totalPushSent: totalNotificationsSent
    });

  } catch (error) {
    console.error('[Birthdays] Critical error in birthday notifications API:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process birthday notifications',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Support POST for manual triggering from external services
export async function POST(request: NextRequest) {
  return GET(request);
}

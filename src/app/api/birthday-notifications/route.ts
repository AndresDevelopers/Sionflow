
import { NextRequest, NextResponse } from 'next/server';
import { birthdaysCollection, membersCollection } from '@/lib/collections-server';
import { getEcuadorDateParts } from '@/lib/date-utils';
import { sendBirthdayBatchNotifications } from '@/lib/push-notifications-server';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  // Fail closed: cron secret required (do not open if env is missing)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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

    const birthdaysToday: { name: string; id: string; barrioOrg?: string | null }[] = [];

    // 1. Fetch from c_birthdays
    const birthdaysSnapshot = await birthdaysCollection.get();
    birthdaysSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.birthDate) {
        const birthParts = getEcuadorDateParts(data.birthDate);
        if (birthParts && birthParts.month === currentMonth && birthParts.day === currentDay) {
          birthdaysToday.push({ name: data.name, id: doc.id, barrioOrg: data.barrioOrg || null });
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
            birthdaysToday.push({ name, id: doc.id, barrioOrg: data.barrioOrg || null });
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

    // 3. Send notifications — usando función agrupada que cachea c_users entre llamadas
    const { totalPushSent, errors } = await sendBirthdayBatchNotifications(birthdaysToday);

    // Do not return names of people from other barrios in the HTTP response
    return NextResponse.json({
      success: true,
      message: `Procesados ${birthdaysToday.length} cumpleaños.`,
      count: birthdaysToday.length,
      totalPushSent,
      errors: errors.length > 0 ? errors : undefined,
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


import { NextRequest, NextResponse } from 'next/server';
import {
  birthdaysCollection,
  membersCollection,
  usersCollection,
} from '@/lib/collections-server';
import { getEcuadorDateParts } from '@/lib/date-utils';
import { sendBirthdayBatchNotifications } from '@/lib/push-notifications-server';
import { enforceRateLimit } from '@/lib/rate-limit';

/** Firestore `in` operator limit */
const FIRESTORE_IN_LIMIT = 30;

/** Non-deceased member statuses (avoids full-collection scan with status !=) */
const LIVING_STATUSES = ['active', 'less_active', 'inactive'] as const;

/**
 * Distinct barrioOrg values that have at least one user.
 * Field mask only — much cheaper than loading full user docs.
 */
async function listActiveBarrioOrgs(): Promise<string[]> {
  const snap = await usersCollection.select('barrioOrg').get();
  const set = new Set<string>();
  snap.forEach((docSnap) => {
    const raw = docSnap.data()?.barrioOrg;
    if (typeof raw === 'string') {
      const bo = raw.trim();
      if (bo.includes('|') && !bo.startsWith('|') && !bo.endsWith('|')) {
        set.add(bo);
      }
    }
  });
  return Array.from(set);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

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
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guayaquil',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(today);
    const currentMonth = Number(parts.find((part) => part.type === 'month')?.value);
    const currentDay = Number(parts.find((part) => part.type === 'day')?.value);

    console.log(
      `[Birthdays] Checking for birthdays on ${currentDay}/${currentMonth} (Ecuador Time)`
    );

    const activeBarrioOrgs = await listActiveBarrioOrgs();
    if (activeBarrioOrgs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No hay barrios activos con usuarios.',
        count: 0,
        barriosScanned: 0,
      });
    }

    console.log(`[Birthdays] Scoping to ${activeBarrioOrgs.length} barrioOrg(s)`);

    const birthdaysToday: { name: string; id: string; barrioOrg?: string | null }[] = [];
    const seenNames = new Set<string>();

    // Per-tenant reads (chunks of 30) — never full c_cumpleanos / c_miembros project scan
    for (const chunk of chunkArray(activeBarrioOrgs, FIRESTORE_IN_LIMIT)) {
      const [birthdaysSnap, membersSnap] = await Promise.all([
        birthdaysCollection.where('barrioOrg', 'in', chunk).get(),
        membersCollection
          .where('barrioOrg', 'in', chunk)
          .where('status', 'in', [...LIVING_STATUSES])
          .get(),
      ]);

      birthdaysSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.birthDate) return;
        const birthParts = getEcuadorDateParts(data.birthDate);
        if (
          birthParts &&
          birthParts.month === currentMonth &&
          birthParts.day === currentDay
        ) {
          const name = typeof data.name === 'string' ? data.name : '';
          if (!name) return;
          const key = `${data.barrioOrg || ''}|${name}`;
          if (seenNames.has(key)) return;
          seenNames.add(key);
          birthdaysToday.push({
            name,
            id: docSnap.id,
            barrioOrg: typeof data.barrioOrg === 'string' ? data.barrioOrg : null,
          });
        }
      });

      membersSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.birthDate) return;
        const birthParts = getEcuadorDateParts(data.birthDate);
        if (
          birthParts &&
          birthParts.month === currentMonth &&
          birthParts.day === currentDay
        ) {
          const name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
          if (!name) return;
          const key = `${data.barrioOrg || ''}|${name}`;
          if (seenNames.has(key)) return;
          seenNames.add(key);
          birthdaysToday.push({
            name,
            id: docSnap.id,
            barrioOrg: typeof data.barrioOrg === 'string' ? data.barrioOrg : null,
          });
        }
      });
    }

    console.log(`[Birthdays] Found ${birthdaysToday.length} birthdays today`);

    if (birthdaysToday.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No hay cumpleaños registrados para el día de hoy.',
        count: 0,
        barriosScanned: activeBarrioOrgs.length,
      });
    }

    // Grouped push: sendBirthdayBatchNotifications scopes by birthday.barrioOrg
    const { totalPushSent, errors } = await sendBirthdayBatchNotifications(birthdaysToday);

    return NextResponse.json({
      success: true,
      message: `Procesados ${birthdaysToday.length} cumpleaños.`,
      count: birthdaysToday.length,
      barriosScanned: activeBarrioOrgs.length,
      totalPushSent,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[Birthdays] Critical error in birthday notifications API:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process birthday notifications',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Support POST for manual triggering from external services
export async function POST(request: NextRequest) {
  return GET(request);
}

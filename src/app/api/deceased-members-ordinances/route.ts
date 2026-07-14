import { NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { membersCollection } from '@/lib/collections-server';
import { sendServerSidePushNotification } from '@/lib/push-notifications-server';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * Weekly deceased members ordinances notifications (cron).
 * Requires CRON_SECRET Bearer token. Never exposes full member lists across barrios
 * in the HTTP response — only aggregated counts.
 */

interface DeceasedMember {
  id: string;
  firstName: string;
  lastName: string;
  templeOrdinances: string[];
  templeWorkCompletedAt: unknown | null;
  barrioOrg?: string | null;
}

const ALL_TEMPLE_ORDINANCES = [
  'baptism',
  'confirmation',
  'initiatory',
  'endowment',
  'sealed_to_father',
  'sealed_to_mother',
  'sealed_to_spouse',
] as const;

function hasAllTempleOrdinances(member: { templeOrdinances?: string[] }) {
  const memberOrdinances = member.templeOrdinances ?? [];
  return ALL_TEMPLE_ORDINANCES.every((ord) => memberOrdinances.includes(ord));
}

function requireCronAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  // Fail closed: if CRON_SECRET is not configured, reject all calls
  if (!cronSecret) {
    logger.error({ message: 'CRON_SECRET not configured; rejecting deceased-members-ordinances' });
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const today = new Date();
    const dayOfWeek = today.getDay();

    const deceasedSnapshot = await membersCollection.where('status', '==', 'deceased').get();

    const deceasedMembers: DeceasedMember[] = deceasedSnapshot.docs.map((docSnap) => {
      const data = docSnap.data() as {
        firstName?: string;
        lastName?: string;
        templeOrdinances?: string[];
        templeWorkCompletedAt?: unknown;
        barrioOrg?: string | null;
      };
      return {
        id: docSnap.id,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        templeOrdinances: data.templeOrdinances || [],
        templeWorkCompletedAt: data.templeWorkCompletedAt || null,
        barrioOrg: data.barrioOrg || null
      };
    });

    const membersNeedingOrdinances = deceasedMembers.filter(member => !hasAllTempleOrdinances(member));

    if (membersNeedingOrdinances.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No deceased members need temple ordinances at this time',
        membersNeedingOrdinances: 0,
        sent: 0,
        skipped: 0
      });
    }

    const byBarrioOrg = new Map<string, DeceasedMember[]>();
    for (const m of membersNeedingOrdinances) {
      const key = m.barrioOrg || '__no_barrio__';
      if (!byBarrioOrg.has(key)) byBarrioOrg.set(key, []);
      byBarrioOrg.get(key)!.push(m);
    }

    let totalSent = 0;
    const perBarrio: { barrioOrg: string; count: number; sent: number }[] = [];

    for (const [barrioOrg, members] of byBarrioOrg) {
      const missingCount = members.length;
      const memberNames = members.map((m) => `${m.firstName} ${m.lastName}`).join(', ');

      const title = "⚰️ Miembros Fallecidos Sin Ordenanzas Completas";
      const body =
        missingCount === 1
          ? `Hay ${missingCount} miembro fallecido que necesita ordenanzas del templo: ${memberNames}`
          : `Hay ${missingCount} miembros fallecidos que necesitan ordenanzas del templo: ${memberNames}`;

      const pushResult = await sendServerSidePushNotification({
        title,
        body,
        url: '/council',
        tag: 'deceased-ordinances',
        barrioOrg: barrioOrg === '__no_barrio__' ? null : barrioOrg,
      });
      const sent = pushResult.sentCount ?? 0;
      totalSent += sent;
      perBarrio.push({ barrioOrg, count: missingCount, sent });
    }

    // Response intentionally omits full member names/ids (cross-tenant PII)
    return NextResponse.json({
      success: true,
      message: `Processed ${membersNeedingOrdinances.length} deceased members needing ordinances`,
      membersNeedingOrdinances: membersNeedingOrdinances.length,
      perBarrio,
      sent: totalSent,
      skipped: 0,
      dayOfWeek
    });

  } catch (error) {
    logger.error({ error, message: 'Error in deceased members ordinances notification' });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process deceased members notifications',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}

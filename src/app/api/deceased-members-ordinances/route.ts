import { NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { membersCollection } from '@/lib/collections-server';
import { sendServerSidePushNotification } from '@/lib/push-notifications-server';

/**
 * API Endpoint for weekly deceased members ordinances notifications
 * 
 * This endpoint should be called by a Firebase Scheduler cron job every Monday at 9:00 AM
 * Schedule: 0 9 * * 1 (every Monday at 9:00 AM)
 * 
 * The endpoint checks if there are deceased members with incomplete temple ordinances
 * and sends push notifications to all users with push notifications enabled.
 */

interface DeceasedMember {
  id: string;
  firstName: string;
  lastName: string;
  templeOrdinances: string[];
  templeWorkCompletedAt: unknown | null;
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

function getMissingTempleOrdinances(member: { templeOrdinances?: string[] }) {
  const memberOrdinances = member.templeOrdinances ?? [];
  return ALL_TEMPLE_ORDINANCES.filter((ord) => !memberOrdinances.includes(ord));
}

export async function GET() {
  try {
    // Check if today is Monday (for validation)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // In production, this should be triggered by a cron job
    // For development, we can still test it manually
    
    const deceasedSnapshot = await membersCollection.where('status', '==', 'deceased').get();

    const deceasedMembers: DeceasedMember[] = deceasedSnapshot.docs.map((docSnap) => {
      const data = docSnap.data() as {
        firstName?: string;
        lastName?: string;
        templeOrdinances?: string[];
        templeWorkCompletedAt?: unknown;
      };
      return {
        id: docSnap.id,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        templeOrdinances: data.templeOrdinances || [],
        templeWorkCompletedAt: data.templeWorkCompletedAt || null
      };
    });
    
    // Filter members who still need ordinances
    const membersNeedingOrdinances = deceasedMembers.filter(member => {
      // If all ordinances are completed, skip
      if (hasAllTempleOrdinances(member)) {
        return false;
      }
      return true;
    });
    
    // If no members need ordinances, return early
    if (membersNeedingOrdinances.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No deceased members need temple ordinances at this time',
        membersNeedingOrdinances: 0,
        sent: 0,
        skipped: 0
      });
    }
    
    const missingCount = membersNeedingOrdinances.length;
    const memberNames = membersNeedingOrdinances.map((m) => `${m.firstName} ${m.lastName}`).join(', ');

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
    });
    
    return NextResponse.json({
      success: true,
      message: `Processed ${membersNeedingOrdinances.length} deceased members needing ordinances`,
      membersNeedingOrdinances: membersNeedingOrdinances.length,
      members: membersNeedingOrdinances.map(m => ({
        id: m.id,
        name: `${m.firstName} ${m.lastName}`,
        missingOrdinances: getMissingTempleOrdinances(m)
      })),
      sent: pushResult.sentCount ?? 0,
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

// Also support POST for manual triggering
export async function POST() {
  return GET();
}

import { NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { Member, MemberStatus } from '@/lib/types';
import { createMember } from '@/lib/members-data';
import { Timestamp } from 'firebase-admin/firestore';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  getErrorStatus,
  requireUidAndBarrioOrg,
} from '@/lib/api-auth';

const normalizeMemberStatus = (status?: unknown): MemberStatus => {
  if (typeof status !== 'string') return 'active';

  const normalized = status.toLowerCase().trim();
  if (['deceased', 'fallecido', 'fallecida'].includes(normalized)) return 'deceased';
  if (['inactive', 'inactivo'].includes(normalized)) return 'inactive';
  if (['less_active', 'less active', 'menos activo', 'menos_activo'].includes(normalized)) {
    return 'less_active';
  }
  if (['active', 'activo'].includes(normalized)) return 'active';

  return 'active';
};

const deriveMemberStatus = (memberData: Record<string, unknown>): MemberStatus => {
  if (memberData.status) {
    return normalizeMemberStatus(memberData.status);
  }

  if (memberData.inactiveSince) return 'inactive';
  if (memberData.lessActiveObservation || memberData.lessActiveCompletedAt) return 'less_active';

  return 'active';
};

function coerceToTimestamp(value: unknown): Timestamp | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : Timestamp.fromDate(value);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : Timestamp.fromDate(date);
  }
  if (typeof value === 'object' && value) {
    const maybeValue: any = value;
    if (typeof maybeValue.toDate === 'function') {
      const date = maybeValue.toDate();
      if (date instanceof Date && !isNaN(date.getTime())) {
        return Timestamp.fromDate(date);
      }
    }
    const seconds = maybeValue.seconds ?? maybeValue._seconds;
    const nanoseconds = maybeValue.nanoseconds ?? maybeValue._nanoseconds;
    if (typeof seconds === 'number') {
      const millis =
        seconds * 1000 +
        (typeof nanoseconds === 'number' ? Math.floor(nanoseconds / 1_000_000) : 0);
      return Timestamp.fromMillis(millis);
    }
  }
  return undefined;
}

async function fetchMembers(
  barrioOrg: string,
  status?: MemberStatus,
  opts?: { limit?: number }
): Promise<Member[]> {
  // Fail closed: never list members across all tenants via Admin SDK
  if (!barrioOrg || !barrioOrg.includes('|')) {
    throw new Error('barrioOrg is required to fetch members');
  }

  const db = firestoreAdmin;
  const membersCollection = db.collection('c_miembros');

  let query: FirebaseFirestore.Query = membersCollection.where('barrioOrg', '==', barrioOrg);

  if (status) {
    query = query.where('status', '==', status);
  }

  query = query.orderBy('lastName');

  if (opts?.limit && opts.limit > 0) {
    query = query.limit(opts.limit);
  }

  const snapshot = await query.get();

  const members: Member[] = [];
  snapshot.forEach((doc: any) => {
    const memberData = doc.data();
    const processedMemberData = {
      ...memberData,
      status: deriveMemberStatus(memberData)
    };
    members.push({
      id: doc.id,
      ...processedMemberData
    } as Member);
  });

  return members;
}

// Cache key must include barrioOrg so different wards/orgs don't share cached data
function getMembersCached(barrioOrg: string, status?: MemberStatus, limit?: number) {
  const cacheKey = `members-${barrioOrg}-${status || 'all'}-${limit || 'nolimit'}`;
  const tags = ['members', `members-${barrioOrg}`];

  return unstable_cache(
    () => fetchMembers(barrioOrg, status, { limit }),
    [cacheKey],
    {
      revalidate: 3600, // 1 hour
      tags
    }
  )();
}

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const { barrioOrg } = await requireUidAndBarrioOrg(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as MemberStatus | null;
    // Always use server-resolved barrioOrg — ignore query string barrioOrg
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) || undefined : undefined;

    // In development, always fetch fresh data without cache
    if (process.env.NODE_ENV !== 'production') {
      const members = await fetchMembers(barrioOrg, status || undefined, { limit });
      const response = NextResponse.json(members);
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      return response;
    }

    // Use cached version only in production
    const members = await getMembersCached(barrioOrg, status || undefined, limit);
    return NextResponse.json(members);
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }

    console.error('❌ Detailed error in /api/members:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      code: (error as any)?.code,
      details: (error as any)?.details
    });

    return NextResponse.json(
      {
        error: 'Failed to fetch members',
        details: error instanceof Error ? error.message : 'Unknown error',
        code: (error as any)?.code || 'UNKNOWN'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const { barrioOrg, uid } = await requireUidAndBarrioOrg(request);

    const data = await request.json();

    const memberData: any = {
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: uid,
    };
    // Never trust client-supplied barrioOrg
    delete memberData.barrioOrg;

    if ('birthDate' in data) {
      const birthDate = coerceToTimestamp(data.birthDate);
      if (birthDate instanceof Timestamp) {
        memberData.birthDate = birthDate;
      } else if (birthDate === null) {
        memberData.birthDate = null;
      } else if (data.birthDate) {
        console.warn('⚠️ Invalid birthDate, skipping conversion:', data.birthDate);
      }
    }
    if ('baptismDate' in data) {
      const baptismDate = coerceToTimestamp(data.baptismDate);
      if (baptismDate instanceof Timestamp) {
        memberData.baptismDate = baptismDate;
      } else if (baptismDate === null) {
        memberData.baptismDate = null;
      } else if (data.baptismDate) {
        console.warn('⚠️ Invalid baptismDate, skipping conversion:', data.baptismDate);
      }
    }

    // Set activity dates based on status
    if (data.status === 'active') {
      memberData.lastActiveDate = Timestamp.now();
      memberData.inactiveSince = null;
    } else {
      memberData.inactiveSince = Timestamp.now();
    }

    const memberId = await createMember(memberData, barrioOrg);

    // Always invalidate cache when creating/updating members
    revalidateTag('members', 'default');

    // Return response with cache-busting headers
    const response = NextResponse.json({ id: memberId }, { status: 201 });
    response.headers.set('Cache-Control', 'no-store');

    return response;
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }
    console.error('Error creating member:', error);
    return NextResponse.json(
      { error: 'Failed to create member' },
      { status: 500 }
    );
  }
}

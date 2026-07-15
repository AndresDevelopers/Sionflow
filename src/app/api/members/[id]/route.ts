import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import logger from '@/lib/logger';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  getErrorStatus,
  requireCanWrite,
  requireUidAndBarrioOrg,
} from '@/lib/api-auth';

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  let data: any = null;
  const { id } = await params;
  try {
    const { uid, barrioOrg: callerBarrioOrg } = await requireUidAndBarrioOrg(request);
    // Admin SDK bypasses Firestore rules — enforce write permission here.
    await requireCanWrite(uid);

    try {
      data = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    if (!id || id.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid member ID' },
        { status: 400 }
      );
    }

    const memberRef = firestoreAdmin.collection('c_miembros').doc(id);
    const memberDoc = await memberRef.get();
    if (!memberDoc.exists) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 });
    }

    const memberData = memberDoc.data() as { barrioOrg?: string };
    if (memberData.barrioOrg !== callerBarrioOrg) {
      return NextResponse.json(
        { error: 'No tienes acceso a este miembro' },
        { status: 403 }
      );
    }

    // Convert date strings to Admin Timestamps
    const updateData: Record<string, unknown> = {
      ...data,
      updatedAt: Timestamp.now(),
    };
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.createdBy;
    delete updateData.barrioOrg;

    if ('birthDate' in data) {
      const bd = coerceToTimestamp(data.birthDate);
      updateData.birthDate = bd instanceof Timestamp ? bd : null;
    }
    if ('baptismDate' in data) {
      const bap = coerceToTimestamp(data.baptismDate);
      updateData.baptismDate = bap instanceof Timestamp ? bap : null;
    }

    // Admin SDK — bypasses Firestore rules
    await memberRef.update(updateData);

    revalidateTag('members', 'default');

    const response = NextResponse.json({ success: true });
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
    return NextResponse.json(
      { error: 'Failed to update member' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  const { id } = await params;
  try {
    const { uid, barrioOrg: callerBarrioOrg } = await requireUidAndBarrioOrg(request);
    // Admin SDK bypasses Firestore rules — enforce write permission here.
    await requireCanWrite(uid);

    if (!id || id.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid member ID' },
        { status: 400 }
      );
    }

    // Check if member has photo to delete from storage; also enforce barrioOrg scope
    let photoURL: string | undefined;
    const memberDoc = await firestoreAdmin.collection('c_miembros').doc(id).get();
    if (!memberDoc.exists) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 });
    }

    const memberData = memberDoc.data() as { barrioOrg?: string; photoURL?: string };
    if (memberData.barrioOrg !== callerBarrioOrg) {
      return NextResponse.json(
        { error: 'No tienes acceso a este miembro' },
        { status: 403 }
      );
    }
    photoURL = memberData.photoURL;

    // Delete photo from Firebase Storage if exists (via Admin SDK)
    if (photoURL) {
      try {
        const { getAdminBucket } = await import('@/lib/firebase-admin');
        const bucket = getAdminBucket();
        // photoURL contains full Firebase Storage download URL, extract path
        // e.g. https://firebasestorage.googleapis.com/v0/b/PROJECT/o/path%2Ffile?alt=media
        const urlPath = photoURL.split('/o/')[1]?.split('?')[0];
        if (urlPath) {
          const filePath = decodeURIComponent(urlPath);
          await bucket.file(filePath).delete().catch(() => {});
        }
      } catch {
        // Non-critical, continue
      }
    }

    // Admin SDK — bypasses Firestore rules
    await firestoreAdmin.collection('c_miembros').doc(id).delete();

    revalidateTag('members', 'default');

    const response = NextResponse.json({ success: true });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const status = getErrorStatus(error, 500);
    logger.error({ error, message: 'Error deleting member', memberId: id });
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}

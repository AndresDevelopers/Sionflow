import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { Timestamp } from 'firebase/firestore';
import { updateMember, deleteMember } from '@/lib/members-data';

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
  let data: any = null;
  const { id } = await params;
  try {
    // Parse request body with error handling
    try {
      data = await request.json();
    } catch (parseError) {
      console.error('❌ Error parsing request JSON:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body', details: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    // Validate member ID
    if (!id || id.trim() === '') {
      console.error('❌ Invalid member ID:', id);
      return NextResponse.json(
        { error: 'Invalid member ID', details: 'Member ID is required' },
        { status: 400 }
      );
    }

    console.log('📥 PUT /api/members/[id] received data:', {
      memberId: id,
      data,
      dataKeys: Object.keys(data),
      birthDate: data.birthDate,
      baptismDate: data.baptismDate
    });

    // Test Firebase connectivity
    try {
      const { initializeApp, getApps } = await import('firebase/app');
      const { getFirestore } = await import('firebase/firestore');
      const { firebaseConfig } = await import('@/firebaseConfig');

      console.log('🔥 Testing Firebase initialization...');
      const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      console.log('✅ Firebase initialized successfully');
    } catch (firebaseError) {
      console.error('❌ Firebase initialization error:', firebaseError);
      return NextResponse.json(
        { error: 'Firebase initialization failed', details: 'Cannot connect to Firebase' },
        { status: 500 }
      );
    }
    // Convert date strings to Timestamps
    const memberData: any = {
      ...data,
      updatedAt: Timestamp.now(),
    };

    if ('birthDate' in data) {
      const birthDate = coerceToTimestamp(data.birthDate);
      if (birthDate instanceof Timestamp) {
        memberData.birthDate = birthDate;
        console.log('📅 Converted birthDate:', {
          original: data.birthDate,
          converted: memberData.birthDate
        });
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
        console.log('🎂 Converted baptismDate:', {
          original: data.baptismDate,
          converted: memberData.baptismDate
        });
      } else if (baptismDate === null) {
        memberData.baptismDate = null;
      } else if (data.baptismDate) {
        console.warn('⚠️ Invalid baptismDate, skipping conversion:', data.baptismDate);
      }
    }

    console.log('🔄 Calling updateMember with:', {
      memberId: id,
      memberData,
      memberDataKeys: Object.keys(memberData)
    });

    await updateMember(id, memberData);

    // Always invalidate cache when updating members
    revalidateTag('members', 'default');

    // Return response with cache-busting headers
    const response = NextResponse.json({ success: true });
    response.headers.set('Cache-Control', 'no-store');
    
    return response;
  } catch (error) {
    console.error('❌ Error updating member:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      memberId: id,
      dataKeys: data ? Object.keys(data) : 'data not parsed yet'
    });

    // Return more detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorResponse = {
      error: 'Failed to update member',
      details: errorMessage,
      memberId: id,
      timestamp: new Date().toISOString()
    };

    console.error('🚨 Sending error response:', errorResponse);

    try {
      return NextResponse.json(errorResponse, { status: 500 });
    } catch (responseError) {
      console.error('❌ Error creating response:', responseError);
      // Fallback response
      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await deleteMember(id);

    // Always invalidate cache when deleting members
    revalidateTag('members', 'default');

    // Return response with cache-busting headers
    const response = NextResponse.json({ success: true });
    response.headers.set('Cache-Control', 'no-store');
    
    return response;
  } catch (error) {
    console.error('Error deleting member:', error);
    return NextResponse.json(
      { error: 'Failed to delete member' },
      { status: 500 }
    );
  }
}

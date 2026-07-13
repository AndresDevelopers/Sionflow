import { NextRequest, NextResponse } from 'next/server';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { normalizeRole, ROLE_LIMITS } from '@/lib/roles';

/**
 * Public capacity check for self-registration (role `user` / miembro).
 * Does not expose user PII — only counts and limits for a barrioOrg.
 */
export async function GET(request: NextRequest) {
  try {
    const barrio = request.nextUrl.searchParams.get('barrio')?.trim() ?? '';
    const organizacion = request.nextUrl.searchParams.get('organizacion')?.trim() ?? '';

    if (!barrio || !organizacion) {
      return NextResponse.json(
        { error: 'missing-params', message: 'barrio and organizacion are required.' },
        { status: 400 }
      );
    }

    const barrioOrg = `${barrio}|${organizacion}`;
    const snap = await firestoreAdmin
      .collection('c_users')
      .where('barrioOrg', '==', barrioOrg)
      .get();

    let memberCount = 0;
    snap.forEach((doc) => {
      if (normalizeRole(doc.data().role) === 'user') {
        memberCount += 1;
      }
    });

    const limit = ROLE_LIMITS.user;
    const remaining = Math.max(0, limit - memberCount);

    return NextResponse.json({
      barrioOrg,
      role: 'user' as const,
      count: memberCount,
      limit,
      remaining,
      full: remaining === 0,
    });
  } catch (error) {
    console.error('[registration-capacity] Error:', error);
    return NextResponse.json(
      { error: 'unexpected', message: 'Could not check registration capacity.' },
      { status: 500 }
    );
  }
}

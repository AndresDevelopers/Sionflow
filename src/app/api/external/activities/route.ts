import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { authAdmin, firestoreAdmin } from '@/lib/firebase-admin';

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

async function resolveBarrioOrg(request: NextRequest): Promise<string | NextResponse> {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await authAdmin.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const userDoc = await firestoreAdmin.collection('c_users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    return NextResponse.json({ error: 'User not found' }, { status: 403 });
  }

  const data = userDoc.data()!;
  const barrio = data.barrio || 'Libertad';
  const organizacion = data.organizacion || 'Quórum de Élderes';
  return `${barrio}|${organizacion}`;
}

function serializeDoc(docData: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(docData)) {
    if (value && typeof value === 'object' && typeof (value as any).toDate === 'function') {
      const date = (value as any).toDate();
      if (date instanceof Date && !isNaN(date.getTime())) {
        result[key] = date.toISOString();
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function getYearDateRange(yearStr: string): { start: Date; end: Date } | null {
  const year = parseInt(yearStr, 10);
  if (isNaN(year) || year < 2000 || year > 2100) return null;
  return {
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31, 23, 59, 59, 999),
  };
}

async function fetchActivitiesData(barrioOrg: string, yearStr: string | null) {
  let query = firestoreAdmin
    .collection('c_actividades')
    .where('barrioOrg', '==', barrioOrg);

  if (yearStr) {
    const range = getYearDateRange(yearStr);
    if (range) {
      query = query.where('date', '>=', range.start).where('date', '<=', range.end);
    }
  }

  query = query.orderBy('date', 'desc');

  const snapshot = await query.get();
  return snapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...serializeDoc(doc.data()),
  }));
}

const getCachedActivitiesData = unstable_cache(
  (barrioOrg: string, yearStr: string | null) => fetchActivitiesData(barrioOrg, yearStr),
  ['external-activities'],
  { revalidate: 3600, tags: ['external-activities'] }
);

export async function GET(request: NextRequest) {
  const barrioOrg = await resolveBarrioOrg(request);
  if (barrioOrg instanceof NextResponse) return barrioOrg;

  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year');

  try {
    if (process.env.NODE_ENV !== 'production') {
      const data = await fetchActivitiesData(barrioOrg, year);
      const response = NextResponse.json(data);
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      return response;
    }

    const data = await getCachedActivitiesData(barrioOrg, year);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in /api/external/activities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activities data', details: (error as Error).message },
      { status: 500 }
    );
  }
}

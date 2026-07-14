import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getErrorStatus, requireUidAndBarrioOrg } from '@/lib/api-auth';

async function resolveBarrioOrg(request: NextRequest): Promise<string | NextResponse> {
  try {
    const { barrioOrg } = await requireUidAndBarrioOrg(request);
    return barrioOrg;
  } catch (error) {
    const status = getErrorStatus(error, 401);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unauthorized' },
      { status: status === 500 ? 401 : status }
    );
  }
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

async function fetchServicesData(barrioOrg: string, yearStr: string | null) {
  let query = firestoreAdmin
    .collection('c_servicios')
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

const getCachedServicesData = unstable_cache(
  (barrioOrg: string, yearStr: string | null) => fetchServicesData(barrioOrg, yearStr),
  ['external-services'],
  { revalidate: 3600, tags: ['external-services'] }
);

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  const barrioOrg = await resolveBarrioOrg(request);
  if (barrioOrg instanceof NextResponse) return barrioOrg;

  const { searchParams } = new URL(request.url);
  const year = searchParams.get('year');

  try {
    if (process.env.NODE_ENV !== 'production') {
      const data = await fetchServicesData(barrioOrg, year);
      const response = NextResponse.json(data);
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      return response;
    }

    const data = await getCachedServicesData(barrioOrg, year);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in /api/external/services:', error);
    return NextResponse.json(
      { error: 'Failed to fetch services data', details: (error as Error).message },
      { status: 500 }
    );
  }
}

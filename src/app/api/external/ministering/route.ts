import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { authAdmin, firestoreAdmin } from '@/lib/firebase-admin';

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

interface ResolvedAuth {
  barrioOrg: string;
  userEmail: string | null;
}

async function resolveAuth(request: NextRequest): Promise<ResolvedAuth | NextResponse> {
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
  const userEmail = decoded.email || null;

  return { barrioOrg: `${barrio}|${organizacion}`, userEmail };
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

async function resolveMemberNames(barrioOrg: string, email: string | null, memberId: string | null, cedula: string | null): Promise<Set<string> | null> {
  if (!email && !memberId && !cedula) return null;

  const memberNames = new Set<string>();
  const collection = firestoreAdmin.collection('c_miembros');

  if (memberId) {
    const doc = await collection.doc(memberId).get();
    if (doc.exists) {
      const m = doc.data()!;
      const fullName = `${m.firstName || ''} ${m.lastName || ''}`.trim();
      if (fullName) memberNames.add(fullName);
    }
  }

  if (cedula) {
    const snapshot = await collection
      .where('barrioOrg', '==', barrioOrg)
      .where('memberId', '==', cedula)
      .get();
    snapshot.docs.forEach(doc => {
      const m = doc.data();
      const fullName = `${m.firstName || ''} ${m.lastName || ''}`.trim();
      if (fullName) memberNames.add(fullName);
    });
  }

  if (email) {
    const snapshot = await collection
      .where('barrioOrg', '==', barrioOrg)
      .where('email', '==', email)
      .get();
    snapshot.docs.forEach(doc => {
      const m = doc.data();
      const fullName = `${m.firstName || ''} ${m.lastName || ''}`.trim();
      if (fullName) memberNames.add(fullName);
    });
  }

  return memberNames.size > 0 ? memberNames : null;
}

async function fetchMinisteringData(barrioOrg: string, email: string | null, memberId: string | null, cedula: string | null) {
  const memberNames = await resolveMemberNames(barrioOrg, email, memberId, cedula);

  const [compSnapshot, distSnapshot] = await Promise.all([
    firestoreAdmin
      .collection('c_ministracion')
      .where('barrioOrg', '==', barrioOrg)
      .orderBy('companions')
      .get(),
    firestoreAdmin
      .collection('c_ministracion_distritos')
      .where('barrioOrg', '==', barrioOrg)
      .orderBy('name')
      .get(),
  ]);

  let companionships = compSnapshot.docs.map(doc => ({
    id: doc.id,
    ...serializeDoc(doc.data()),
  }));

  // Filter by member email if applicable
  if (memberNames && memberNames.size > 0) {
    companionships = companionships.filter((comp: any) => {
      const companions: string[] = comp.companions || [];
      if (companions.some((name: string) => memberNames!.has(name))) return true;

      const families: any[] = comp.families || [];
      return families.some((f: any) => memberNames!.has(f.name || ''));
    });
  }

  const matchingCompIds = new Set(companionships.map((c: any) => c.id));

  const districts = distSnapshot.docs
    .map(doc => ({
      id: doc.id,
      ...serializeDoc(doc.data()),
    }))
    .filter((dist: any) => {
      if (!memberNames || memberNames.size === 0) return true;
      const ids: string[] = dist.companionshipIds || [];
      return ids.some((id: string) => matchingCompIds.has(id));
    });

  return { companionships, districts };
}

const getCachedMinisteringData = unstable_cache(
  fetchMinisteringData,
  ['external-ministering'],
  { revalidate: 3600, tags: ['external-ministering'] }
);

export async function GET(request: NextRequest) {
  const resolved = await resolveAuth(request);
  if (resolved instanceof NextResponse) return resolved;

  const { barrioOrg, userEmail } = resolved;

  // Allow filtering by specific member via email, ID, or cedula query params
  const { searchParams } = new URL(request.url);
  const memberEmail = searchParams.get('email') || userEmail || null;
  const memberId = searchParams.get('memberId') || null;
  const cedula = searchParams.get('cedula') || null;

  try {
    if (process.env.NODE_ENV !== 'production') {
      const data = await fetchMinisteringData(barrioOrg, memberEmail, memberId, cedula);
      const response = NextResponse.json(data);
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      return response;
    }

    const data = await getCachedMinisteringData(barrioOrg, memberEmail, memberId, cedula);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in /api/external/ministering:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ministering data', details: (error as Error).message },
      { status: 500 }
    );
  }
}

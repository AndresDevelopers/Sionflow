import { NextResponse } from 'next/server';
import { z } from 'zod';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  getErrorStatus,
  requireUidAndBarrioOrg,
} from '@/lib/api-auth';
import { hasLeadershipPrivileges, normalizeRole } from '@/lib/roles';
import logger from '@/lib/logger';

/**
 * Admin-only migration: find documents missing barrioOrg and assign the caller's
 * barrioOrg (or a same-tenant target barrioOrg). Uses Admin SDK because client
 * rules hide docs without barrioOrg (fail-closed isolation).
 */

const DATA_COLLECTIONS = [
  'c_miembros',
  'c_conversos',
  'c_actividades',
  'c_servicios',
  'c_futuros_miembros',
  'c_cumpleanos',
  'c_ministracion',
  'c_ministracion_distritos',
  'c_ministracion_historial',
  'c_bautismos',
  'c_anotaciones',
  'c_observaciones_salud',
  'c_reporte_anual',
  'c_obra_misional_amigos_conversos',
  'c_obra_misional_investigadores',
  'c_obra_misional_asignaciones',
  'c_obra_misional_imagenes',
  'c_fs_capacitaciones',
  'c_fs_pendientes',
  'c_fs_anotaciones',
  'c_admin_audit',
] as const;

const bodySchema = z.object({
  action: z.enum(['analyze', 'migrate']),
  /** Target barrioOrg to stamp on missing docs — must match caller's tenant */
  targetBarrioOrg: z.string().min(3).max(200),
  /** Max docs scanned per collection (safety) */
  limitPerCollection: z.number().int().min(1).max(2000).optional().default(500),
});

async function requireLeadership(uid: string) {
  const userDoc = await firestoreAdmin.collection('c_users').doc(uid).get();
  if (!userDoc.exists) {
    throw Object.assign(new Error('Usuario no encontrado.'), { status: 403 });
  }
  const role = normalizeRole(userDoc.data()?.role);
  if (!hasLeadershipPrivileges(role)) {
    throw Object.assign(new Error('Solo liderazgo puede migrar barrioOrg.'), { status: 403 });
  }
}

function isMissingBarrioOrg(data: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!data) return true;
  const bo = data.barrioOrg;
  return typeof bo !== 'string' || !bo.includes('|') || bo.startsWith('|') || bo.endsWith('|');
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const { uid, barrioOrg: callerBarrioOrg } = await requireUidAndBarrioOrg(request);
    await requireLeadership(uid);

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { action, targetBarrioOrg, limitPerCollection } = parsed.data;

    // Never allow stamping another tenant's key
    if (targetBarrioOrg !== callerBarrioOrg) {
      return NextResponse.json(
        {
          error:
            'targetBarrioOrg debe coincidir con tu barrio/organización. No se permite migrar a otro tenant.',
        },
        { status: 403 }
      );
    }

    const results: Record<
      string,
      { totalScanned: number; missing: number; updated?: number }
    > = {};

    for (const collectionName of DATA_COLLECTIONS) {
      const snap = await firestoreAdmin
        .collection(collectionName)
        .limit(limitPerCollection)
        .get();

      let missing = 0;
      const missingRefs: FirebaseFirestore.DocumentReference[] = [];

      snap.forEach((docSnap) => {
        if (isMissingBarrioOrg(docSnap.data())) {
          missing++;
          missingRefs.push(docSnap.ref);
        }
      });

      results[collectionName] = {
        totalScanned: snap.size,
        missing,
      };

      if (action === 'migrate' && missingRefs.length > 0) {
        let updated = 0;
        // Firestore batch limit 500
        for (let i = 0; i < missingRefs.length; i += 450) {
          const batch = firestoreAdmin.batch();
          const chunk = missingRefs.slice(i, i + 450);
          for (const ref of chunk) {
            batch.update(ref, { barrioOrg: targetBarrioOrg });
          }
          await batch.commit();
          updated += chunk.length;
        }
        results[collectionName].updated = updated;
      }
    }

    const totalMissing = Object.values(results).reduce((s, r) => s + r.missing, 0);
    const totalUpdated = Object.values(results).reduce(
      (s, r) => s + (r.updated ?? 0),
      0
    );

    logger.info({
      message: 'migrate-barrio-org completed',
      uid,
      action,
      targetBarrioOrg,
      totalMissing,
      totalUpdated,
    });

    return NextResponse.json({
      success: true,
      action,
      targetBarrioOrg,
      totalMissing,
      totalUpdated: action === 'migrate' ? totalUpdated : undefined,
      collections: results,
    });
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }
    logger.error({ error, message: 'migrate-barrio-org failed' });
    return NextResponse.json(
      { error: 'Error al migrar barrioOrg' },
      { status: 500 }
    );
  }
}

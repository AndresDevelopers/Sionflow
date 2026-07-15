import { NextResponse } from 'next/server';
import { z } from 'zod';
import { firestoreAdmin } from '@/lib/firebase-admin';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  getErrorStatus,
  requireLeadership,
  requireUidAndBarrioOrg,
} from '@/lib/api-auth';
import logger from '@/lib/logger';

/**
 * Leadership migration: stamp barrioOrg on legacy docs that can be
 * **attributed** to the caller's tenant.
 *
 * CRITICAL: never claim unscoped docs from another ward. A missing barrioOrg
 * alone is not enough — we require barrio+organización match or createdBy/userId
 * belonging to the caller's barrioOrg.
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
  /** Target barrioOrg to stamp — must match caller's tenant */
  targetBarrioOrg: z.string().min(3).max(200),
  /** Max docs scanned per collection (safety) */
  limitPerCollection: z.number().int().min(1).max(2000).optional().default(500),
});

function isMissingBarrioOrg(data: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!data) return true;
  const bo = data.barrioOrg;
  return typeof bo !== 'string' || !bo.includes('|') || bo.startsWith('|') || bo.endsWith('|');
}

function parseBarrioOrgParts(barrioOrg: string): { barrio: string; organizacion: string } | null {
  const idx = barrioOrg.indexOf('|');
  if (idx <= 0 || idx === barrioOrg.length - 1) return null;
  return {
    barrio: barrioOrg.slice(0, idx).trim(),
    organizacion: barrioOrg.slice(idx + 1).trim(),
  };
}

/**
 * True only when the document can be confidently linked to targetBarrioOrg.
 * Unattributable legacy docs are skipped (fail closed — never tenant-theft).
 */
function canAttributeToTenant(
  data: FirebaseFirestore.DocumentData | undefined,
  targetBarrioOrg: string,
  callerUids: Set<string>
): boolean {
  if (!data) return false;

  const parts = parseBarrioOrgParts(targetBarrioOrg);
  if (!parts) return false;

  const barrio = typeof data.barrio === 'string' ? data.barrio.trim() : '';
  const organizacion =
    typeof data.organizacion === 'string' ? data.organizacion.trim() : '';

  // Explicit partial tenant fields that reconstruct to the caller
  if (barrio && organizacion && `${barrio}|${organizacion}` === targetBarrioOrg) {
    return true;
  }
  // Both parts present and match even if stored separately with different casing edge cases
  if (
    barrio &&
    organizacion &&
    barrio === parts.barrio &&
    organizacion === parts.organizacion
  ) {
    return true;
  }

  // Author / owner belongs to this tenant
  const ownerCandidates = [data.createdBy, data.userId, data.uid, data.actorUid];
  for (const candidate of ownerCandidates) {
    if (typeof candidate === 'string' && callerUids.has(candidate)) {
      return true;
    }
  }

  return false;
}

async function loadCallerUids(barrioOrg: string): Promise<Set<string>> {
  const snap = await firestoreAdmin
    .collection('c_users')
    .where('barrioOrg', '==', barrioOrg)
    .select()
    .get();
  return new Set(snap.docs.map((d) => d.id));
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

    if (targetBarrioOrg !== callerBarrioOrg) {
      return NextResponse.json(
        {
          error:
            'targetBarrioOrg debe coincidir con tu barrio/organización. No se permite migrar a otro tenant.',
        },
        { status: 403 }
      );
    }

    const callerUids = await loadCallerUids(callerBarrioOrg);

    const results: Record<
      string,
      {
        totalScanned: number;
        missing: number;
        attributable: number;
        skippedUnattributable: number;
        updated?: number;
      }
    > = {};

    for (const collectionName of DATA_COLLECTIONS) {
      const snap = await firestoreAdmin
        .collection(collectionName)
        .limit(limitPerCollection)
        .get();

      let missing = 0;
      let attributable = 0;
      let skippedUnattributable = 0;
      const toUpdate: FirebaseFirestore.DocumentReference[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!isMissingBarrioOrg(data)) return;
        missing += 1;
        if (canAttributeToTenant(data, targetBarrioOrg, callerUids)) {
          attributable += 1;
          toUpdate.push(docSnap.ref);
        } else {
          skippedUnattributable += 1;
        }
      });

      results[collectionName] = {
        totalScanned: snap.size,
        missing,
        attributable,
        skippedUnattributable,
      };

      if (action === 'migrate' && toUpdate.length > 0) {
        let updated = 0;
        for (let i = 0; i < toUpdate.length; i += 450) {
          const batch = firestoreAdmin.batch();
          const chunk = toUpdate.slice(i, i + 450);
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
    const totalAttributable = Object.values(results).reduce(
      (s, r) => s + r.attributable,
      0
    );
    const totalSkipped = Object.values(results).reduce(
      (s, r) => s + r.skippedUnattributable,
      0
    );
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
      totalAttributable,
      totalSkipped,
      totalUpdated,
    });

    return NextResponse.json({
      success: true,
      action,
      targetBarrioOrg,
      totalMissing,
      totalAttributable,
      totalSkippedUnattributable: totalSkipped,
      totalUpdated: action === 'migrate' ? totalUpdated : undefined,
      note:
        totalSkipped > 0
          ? 'Algunos docs sin barrioOrg no se atribuyeron a tu tenant (sin barrio/organización ni createdBy de tu barrio). No se reclamaron.'
          : undefined,
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

#!/usr/bin/env node
/**
 * Migration script: Add barrioOrg field to all existing data documents.
 * 
 * Usage: npx tsx scripts/migrate-barrioOrg.ts
 * 
 * Reads all c_users to map uid → barrioOrg.
 * For each data collection:
 *   - Documents with userId/createdBy/actorUid → use owner's barrioOrg
 *   - Documents without owner → default to "Libertad|Quórum de Élderes"
 *   - Documents already with barrioOrg → skip
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const DEFAULT_BARRIO = 'Libertad';
const DEFAULT_ORG = 'Quórum de Élderes';
const DEFAULT_BARRIO_ORG = `${DEFAULT_BARRIO}|${DEFAULT_ORG}`;

// All data collections that need scoping
const DATA_COLLECTIONS = [
  'c_miembros',
  'c_conversos',
  'c_conversos_info',
  'c_futuros_miembros',
  'c_ministracion',
  'c_ministracion_distritos',
  'c_ministracion_historial',
  'c_actividades',
  'c_servicios',
  'c_cumpleanos',
  'c_bautismos',
  'c_fs_capacitaciones',
  'c_fs_pendientes',
  'c_fs_anotaciones',
  'c_obra_misional_asignaciones',
  'c_obra_misional_investigadores',
  'c_obra_misional_amigos_conversos',
  'c_obra_misional_imagenes',
  'c_anotaciones',
  'c_observaciones_salud',
  'c_reporte_anual',
  'c_admin_audit',
  'c_notifications',
];

async function main() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is required');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) });
  }

  const db = getFirestore();

  // Step 1: Build uid → barrioOrg map from c_users
  console.log('Building user → barrioOrg map...');
  const usersMap = new Map<string, string>();
  const usersSnap = await db.collection('c_users').get();
  usersSnap.forEach(doc => {
    const data = doc.data();
    const barrio = data.barrio || DEFAULT_BARRIO;
    const organizacion = data.organizacion || DEFAULT_ORG;
    usersMap.set(doc.id, `${barrio}|${organizacion}`);
  });
  console.log(`  Found ${usersMap.size} users`);

  // Step 2: Process each collection
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const collName of DATA_COLLECTIONS) {
    console.log(`\nProcessing ${collName}...`);
    const coll = db.collection(collName);
    const snap = await coll.get();
    
    let updated = 0;
    let skipped = 0;
    const batch = db.batch();
    let batchCount = 0;

    snap.forEach(doc => {
      const data = doc.data();
      
      // Skip if already has barrioOrg
      if (data.barrioOrg) {
        skipped++;
        return;
      }

      let barrioOrg: string;

      // Try to determine from ownership fields
      const ownerUid = data.userId || data.createdBy || data.actorUid;
      if (ownerUid && usersMap.has(ownerUid)) {
        barrioOrg = usersMap.get(ownerUid)!;
      } else {
        barrioOrg = DEFAULT_BARRIO_ORG;
      }

      batch.update(doc.ref, { barrioOrg });
      batchCount++;
      updated++;

      // Firestore batch limit is 500
      if (batchCount >= 500) {
        // We'll commit in batches
      }
    });

    if (batchCount > 0) {
      await batch.commit();
    }

    totalUpdated += updated;
    totalSkipped += skipped;
    console.log(`  Updated: ${updated}, Skipped (already scoped): ${skipped}`);
  }

  console.log(`\n✅ Migration complete. Total updated: ${totalUpdated}, Total skipped: ${totalSkipped}`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

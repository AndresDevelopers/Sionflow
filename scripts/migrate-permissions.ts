/**
 * Script de migración: Asigna permission: 'all' a usuarios con roles de liderazgo
 * (counselor, president, secretary) que no tengan el campo 'permission' definido.
 *
 * Ejecutar con:
 *   npx tsx scripts/migrate-permissions.ts
 *
 * Requiere la variable de entorno GOOGLE_APPLICATION_CREDENTIALS o
 * estar autenticado con firebase-tools.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : undefined;

if (serviceAccount) {
  initializeApp({ credential: cert(serviceAccount) });
} else {
  initializeApp();
}

const db = getFirestore();

const LEADERSHIP_ROLES = ['counselor', 'president', 'secretary'];

async function migrate() {
  console.log('Iniciando migración de permisos...');

  const snapshot = await db.collection('c_users').get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const role = data.role;

    // Si ya tiene permission, saltar
    if (data.permission) {
      skipped++;
      continue;
    }

    // Solo aplicar a roles de liderazgo
    if (LEADERSHIP_ROLES.includes(role)) {
      await db.collection('c_users').doc(doc.id).update({ permission: 'all' });
      updated++;
      console.log(`  ✓ ${data.email || doc.id}: ${role} → permission: 'all'`);
    } else {
      // user, other → mantener default 'read' (no necesita update porque normalizePermission ya devuelve 'read')
      skipped++;
    }
  }

  console.log(`\nMigración completada: ${updated} actualizados, ${skipped} omitidos.`);
}

migrate().catch((err) => {
  console.error('Error en migración:', err);
  process.exit(1);
});

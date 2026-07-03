#!/usr/bin/env node
/**
 * Migración: Agrega barrioOrg a documentos de c_users que no lo tienen.
 * barrioOrg = barrio + "|" + organizacion
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

async function main() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) {
    console.error("FIREBASE_SERVICE_ACCOUNT_KEY env var is required");
    process.exit(1);
  }
  const serviceAccount = JSON.parse(serviceAccountJson);
  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  const db = getFirestore();

  console.log("=== Migrando c_users: agregando barrioOrg faltante ===\n");
  const usersSnap = await db.collection("c_users").get();
  let updated = 0;
  let skipped = 0;

  const batch = db.batch();
  let batchCount = 0;

  usersSnap.forEach((doc) => {
    const data = doc.data();
    if (data.barrioOrg) {
      skipped++;
      return;
    }
    const barrio = data.barrio || "Libertad";
    const org = data.organizacion || "Quórum de Élderes";
    const barrioOrg = `${barrio}|${org}`;
    batch.update(doc.ref, { barrioOrg });
    batchCount++;
    updated++;
    console.log(`  ✅ ${data.email}: barrioOrg="${barrioOrg}"`);
  });

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`\n=== Resultado: ${updated} actualizados, ${skipped} ya tenían barrioOrg ===`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

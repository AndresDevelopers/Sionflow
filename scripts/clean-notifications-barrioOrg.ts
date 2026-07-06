#!/usr/bin/env node
/**
 * Limpieza: Elimina notificaciones de c_notifications que no tienen barrioOrg.
 * Estas notificaciones se crearon sin scope de barrio/organización y aparecen
 * en todas las campanitas sin filtrar. El código ya fue corregido para que las
 * futuras notificaciones siempre incluyan barrioOrg.
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

  console.log("=== Limpiando c_notifications sin barrioOrg ===\n");

  const snap = await db.collection("c_notifications").get();
  console.log(`Total notificaciones en colección: ${snap.size}`);

  let deleted = 0;
  let kept = 0;

  // Batch deletes in groups of 500
  let batch = db.batch();
  let batchCount = 0;
  const BATCH_LIMIT = 500;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.barrioOrg) {
      batch.delete(doc.ref);
      batchCount++;
      deleted++;
      console.log(`  🗑️  ${doc.id}: "${data.title?.substring(0, 40)}" (sin barrioOrg)`);
    } else {
      kept++;
    }

    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      console.log(`  ✅ Commit batch: ${batchCount} eliminados`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`  ✅ Commit batch final: ${batchCount} eliminados`);
  }

  console.log(`\n=== Resultado: ${deleted} eliminadas, ${kept} conservadas (tienen barrioOrg) ===`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

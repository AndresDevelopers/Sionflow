#!/usr/bin/env node
/**
 * Set or update the donation configuration in Firestore.
 *
 * The donate page reads from c_donate_config/global to show:
 *   - A QR code image URL (qrImageUrl)
 *   - A donation link (donateLink)
 *
 * Usage:
 *   npx tsx scripts/set-donate-config.ts \
 *     --link "https://your-donation-link.com" \
 *     --qr "https://your-qr-image-url.com/qr.png"
 *
 * You can provide only one of the two fields. Existing fields are preserved.
 *
 * Prerequisites:
 *   FIREBASE_SERVICE_ACCOUNT_KEY env var must be set (JSON string).
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseArgs(): { link?: string; qr?: string } {
  const args = process.argv.slice(2);
  const result: { link?: string; qr?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--link' && i + 1 < args.length) {
      result.link = args[++i];
    } else if (args[i] === '--qr' && i + 1 < args.length) {
      result.qr = args[++i];
    }
  }

  if (!result.link && !result.qr) {
    console.error('Error: At least one of --link or --qr must be provided.');
    console.error('Usage: npx tsx scripts/set-donate-config.ts --link "URL" --qr "URL"');
    process.exit(1);
  }

  return result;
}

async function main() {
  const { link, qr } = parseArgs();

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
  const docRef = db.collection('c_donate_config').doc('global');

  const updateData: Record<string, string> = {};
  if (link) updateData.donateLink = link;
  if (qr) updateData.qrImageUrl = qr;

  await docRef.set(updateData, { merge: true });

  console.log('✅ Donate config updated successfully:');
  if (link) console.log(`   Donate link: ${link}`);
  if (qr) console.log(`   QR image:    ${qr}`);

  // Read back to confirm
  const snapshot = await docRef.get();
  const data = snapshot.data();
  console.log('\n📋 Current config in Firestore:');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(err => {
  console.error('Failed to set donate config:', err);
  process.exit(1);
});

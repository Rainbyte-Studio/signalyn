/**
 * SIGNALYN — Phase P1.5 Standalone Retail Catalog Migration CLI
 * 
 * Standalone migration script designed to execute natively inside customer project
 * 'signalyn-5406e' via Cloud Run Jobs, Cloud Shell, or Compute VM using ambient ADC:
 * Service Account: signalyn-backend@signalyn-5406e.iam.gserviceaccount.com
 * (Zero private keys required).
 * 
 * Usage:
 *   npx tsx src/server/migration/retailMigrationStandalone.ts [--approve] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  STAGED_CATALOG_BUFFER_PATH,
  RECOVERY_BACKUP_PATH,
  validateStagedDiscoveryBuffer,
  DEDICATED_SERVICE_ACCOUNT,
} from '../retail/retailMigrationService';
import { cleanServerData } from '../serverFirestoreAdapter';

const TARGET_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'signalyn-5406e';
const TARGET_DATABASE_ID =
  process.env.FIREBASE_DATABASE_ID || 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34';

async function runStandaloneMigration() {
  const isApproved = process.argv.includes('--approve');
  const isDryRun = process.argv.includes('--dry-run') || !isApproved;

  console.log('================================================================');
  console.log('SIGNALYN P1.5 — STANDALONE RETAIL CATALOG FIRESTORE MIGRATION');
  console.log('================================================================');
  console.log(`Target Project:     ${TARGET_PROJECT_ID}`);
  console.log(`Target Database:    ${TARGET_DATABASE_ID}`);
  console.log(`Target Mode:        ${isDryRun ? 'DRY-RUN (Inspection Only)' : 'LIVE COMMIT (Administrator Approved)'}`);
  console.log(`Dedicated SA:       ${DEDICATED_SERVICE_ACCOUNT}`);
  console.log('----------------------------------------------------------------');

  // Step 1: Validate Staged Discovery Buffer
  console.log('\n[Step 1] Auditing Staged Discovery Buffer...');
  const validation = validateStagedDiscoveryBuffer();
  console.log(`  Buffer Found:      ${fs.existsSync(STAGED_CATALOG_BUFFER_PATH)}`);
  console.log(`  SHA256:            ${validation.bufferSha256}`);
  console.log(`  Discovered Prods:  ${validation.stagedDiscoveredProducts}`);
  console.log(`  Live Offers:       ${validation.stagedLiveOffers}`);
  console.log(`  Pilot Products:    ${validation.stagedPilotProducts} (Strictly Preserved)`);
  console.log(`  Pilot Offers:      ${validation.stagedPilotOffers} (Strictly Preserved)`);
  console.log(`  Validation Status: ${validation.isValid ? 'VALID' : 'INVALID'}`);

  if (!validation.isValid) {
    console.error('\n❌ Buffer validation failed:');
    validation.validationErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  // Step 2: Initialize Admin SDK with ambient ADC
  console.log('\n[Step 2] Initializing Firebase Admin SDK...');
  const app = getApps().length > 0 ? getApp() : initializeApp({ projectId: TARGET_PROJECT_ID });
  const db = getFirestore(app, TARGET_DATABASE_ID);

  // Step 3: Diagnostic Write Probe
  console.log('\n[Step 3] Probing Firestore Write Permission...');
  const probeId = `probe-cli-${Date.now()}`;
  try {
    await db.collection('system').doc(probeId).set({
      probeId,
      at: new Date().toISOString(),
      initiatedBy: 'retailMigrationStandalone.ts',
    });
    console.log('  ✓ Write probe succeeded.');
    await db.collection('system').doc(probeId).delete();
    console.log('  ✓ Cleanup delete probe succeeded.');
  } catch (err: any) {
    console.error(`\n❌ Write probe failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('\nRemediation:');
    console.error(`Ensure this environment is authenticated as a service account with roles/datastore.user on project ${TARGET_PROJECT_ID}.`);
    process.exit(1);
  }

  if (isDryRun) {
    console.log('\n[DRY RUN COMPLETE] Validation succeeded. Re-run with --approve to execute live commit.');
    process.exit(0);
  }

  // Step 4: Execute Chunked Migration
  console.log('\n[Step 4] Committing Discovery Data in Chunks of 400...');
  const rawData = JSON.parse(fs.readFileSync(STAGED_CATALOG_BUFFER_PATH, 'utf-8'));
  const discoveredProds = (rawData.products || []).filter((p: any) => !p.isPilot);
  const liveOffers = (rawData.offers || []).filter((o: any) => o.isLiveVerified === true || o.observationStatus === 'LIVE_VERIFIED');
  const liveHistory = (rawData.priceHistory || []).filter((h: any) => h.isLiveVerified === true || h.observationStatus === 'LIVE_VERIFIED');

  const ops: Array<{ collection: string; id: string; data: any }> = [];
  for (const prod of discoveredProds) {
    ops.push({ collection: 'retailProducts', id: prod.id, data: cleanServerData(prod) });
  }
  for (const off of liveOffers) {
    ops.push({ collection: 'retailOffers', id: off.id, data: cleanServerData(off) });
  }
  for (const hist of liveHistory) {
    ops.push({ collection: 'retailPriceHistory', id: hist.id, data: cleanServerData(hist) });
  }

  const CHUNK_SIZE = 400;
  let batchesCommitted = 0;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      batch.set(db.collection(op.collection).doc(op.id), op.data, { merge: true });
    }
    await batch.commit();
    batchesCommitted++;
    console.log(`  Committed batch ${batchesCommitted}/${Math.ceil(ops.length / CHUNK_SIZE)} (${chunk.length} items)`);
  }

  // Step 5: Verify Final Remote Firestore Counts
  console.log('\n[Step 5] Verifying Remote Firestore Collections...');
  const [pSnap, oSnap, hSnap] = await Promise.all([
    db.collection('retailProducts').get(),
    db.collection('retailOffers').get(),
    db.collection('retailPriceHistory').get(),
  ]);

  console.log(`  retailProducts:     ${pSnap.size} (Expected: 21 pilot + ${discoveredProds.length} discovered = ${21 + discoveredProds.length})`);
  console.log(`  retailOffers:       ${oSnap.size} (Expected: 27 pilot + ${liveOffers.length} live = ${27 + liveOffers.length})`);
  console.log(`  retailPriceHistory: ${hSnap.size} (Expected: 108 baseline + ${liveHistory.length} live = ${108 + liveHistory.length})`);

  await db.collection('system').doc('retailMigrationLog').set({
    migratedAt: new Date().toISOString(),
    migratedBy: 'retailMigrationStandalone.ts',
    productsCommitted: discoveredProds.length,
    offersCommitted: liveOffers.length,
    historyCommitted: liveHistory.length,
    batchesCommitted,
    finalRemoteCounts: {
      products: pSnap.size,
      offers: oSnap.size,
      history: hSnap.size,
    },
  });

  console.log('\n================================================================');
  console.log('✓ SIGNALYN RETAIL CATALOG FIRESTORE MIGRATION COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
}

runStandaloneMigration().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});

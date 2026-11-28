import { randomUUID } from 'node:crypto';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { getServerIdentityStatus } from './firestoreAdmin';
import { getServerDb } from './serverFirestoreAdapter';
import { getGeminiQuotaStatus } from './geminiQuotaGuard';
import { getPipelineStatus } from './dailyPipelineOrchestrator';
import { LEASE_DOC_PATH } from './pipelineLease';
import { isPermanentArticleDeletionEnabled } from './backfill/permanentArticleDeletion';
import type { ProductionSafetyBackendReport, TransactionSafetyResult } from '../types/productionSafetyDiagnostics';

export const SAFETY_DIAGNOSTICS_COLLECTION = 'system/productionSafetyDiagnostics/transactions';

/** Exercises database permissions without writing any application or quota records. */
export async function verifySafetyTransactions(db: Firestore): Promise<TransactionSafetyResult> {
  const id = randomUUID();
  const collection = db.collection(SAFETY_DIAGNOSTICS_COLLECTION);
  const ref = collection.doc(id);
  const match = collection.where(FieldPath.documentId(), '==', id);
  let stage: TransactionSafetyResult['stage'] = 'create';
  let failed: TransactionSafetyResult['stage'] | null = null;
  let updated = false;
  let cleanupVerified = false;

  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) throw new Error('Probe identifier already exists');
      tx.create(ref, { probeId: id, phase: 'created' });
    });

    stage = 'read-update';
    await db.runTransaction(async (tx) => {
      const [snapshot, query] = await Promise.all([tx.get(ref), tx.get(match)]);
      if (snapshot.get('probeId') !== id || snapshot.get('phase') !== 'created' ||
          query.size !== 1 || query.docs[0].get('probeId') !== id) {
        throw new Error('Committed probe did not match its scoped query');
      }
      tx.update(ref, { phase: 'updated' });
    });
    updated = true;
  } catch {
    failed = stage;
  } finally {
    // An RPC can fail after the server commits. Always try cleanup, and only delete our own probe.
    try {
      const observed = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return false;
        if (snapshot.get('probeId') !== id) throw new Error('Probe ownership mismatch');
        tx.delete(ref);
        return snapshot.get('phase') === 'updated';
      });
      cleanupVerified = !(await ref.get()).exists;
      if (!cleanupVerified || (updated && !observed)) failed ??= 'delete-verify';
    } catch {
      failed ??= 'delete-verify';
    }
    if (!cleanupVerified) {
      console.warn('[Production safety] Temporary Firestore probe cleanup not verified:', ref.path);
    }
  }

  return failed
    ? { status: 'FAIL', stage: failed, cleanupVerified }
    : { status: 'PASS', stage: 'complete', cleanupVerified: true };
}

async function readPipelineState(db: Firestore): Promise<ProductionSafetyBackendReport['environment']['dailyPipeline']> {
  const [status, lease] = await Promise.all([getPipelineStatus(), db.doc(LEASE_DOC_PATH).get()]);
  if (status.isRunning) return 'RUNNING';
  if (!lease.exists || lease.get('status') === 'RELEASED') return 'IDLE';
  const expiresAt = Date.parse(lease.get('expiresAt'));
  if (lease.get('status') !== 'ACTIVE' || !Number.isFinite(expiresAt)) return null;
  return expiresAt > Date.now() ? 'LEASE_ACTIVE' : 'IDLE';
}

export async function runProductionSafetyDiagnostics(): Promise<ProductionSafetyBackendReport> {
  const identity = getServerIdentityStatus();
  const environment: ProductionSafetyBackendReport['environment'] = {
    revision: process.env.K_REVISION || null,
    firestoreProject: identity.projectId || null,
    firestoreDatabase: identity.databaseId || null,
    quotaAccountingMode: null,
    permanentDeletionEnabled: isPermanentArticleDeletionEnabled(),
    historicalBackfillEnabled: process.env.HISTORICAL_BACKFILL_FORCE_DISABLED === 'true' ? false : null,
    dailyPipeline: null,
  };
  if (!identity.initialized || !identity.projectId || !identity.databaseId) {
    return { environment, transaction: { status: 'UNVERIFIED', stage: 'unavailable', cleanupVerified: false } };
  }
  const db = getServerDb();
  if (db.databaseId !== identity.databaseId) {
    return { environment, transaction: { status: 'UNVERIFIED', stage: 'unavailable', cleanupVerified: false } };
  }
  const [quota, historical, pipeline, transaction] = await Promise.allSettled([
    getGeminiQuotaStatus(),
    environment.historicalBackfillEnabled === false
      ? Promise.resolve(false)
      : db.doc('system/historicalBackfillConfig').get().then((snapshot) => snapshot.get('enabled') === true),
    readPipelineState(db),
    verifySafetyTransactions(db),
  ]);
  if (quota.status === 'fulfilled') environment.quotaAccountingMode = quota.value.accountingMode ?? null;
  if (historical.status === 'fulfilled') environment.historicalBackfillEnabled = historical.value;
  if (pipeline.status === 'fulfilled') environment.dailyPipeline = pipeline.value;
  return {
    environment,
    transaction: transaction.status === 'fulfilled' ? transaction.value : {
      status: 'UNVERIFIED', stage: 'unavailable', cleanupVerified: false,
    },
  };
}

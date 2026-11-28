import type { HistoricalCleanupManifestSelection, HistoricalCleanupRecoveryReport } from '../../types';
import { HISTORICAL_CLEANUP_LEASE_PATH } from '../maintenanceLock';

export const MANIFEST_CLEANUP_CHUNK_SIZE = 100;

export interface ManifestCleanupProgress {
  count: number;
  cursor: number;
  attempt: number;
  state: 'RUNNING' | 'STOPPED' | 'RECONCILED' | 'COMPLETED';
  owner: string | null;
  pendingCount: number;
  skippedCount: number;
}

export function manifestCleanupAuditId(manifest: HistoricalCleanupManifestSelection): string {
  return `manifest-${manifest.selectionSha256}`;
}

export function manifestCleanupProgressRef(db: FirebaseFirestore.Firestore, auditId: string) {
  return db.doc(`system/historicalBacklogCleanupAudit/runs/${auditId}/recovery/state`);
}

export function readManifestCleanupProgress(
  data: FirebaseFirestore.DocumentData | undefined,
  count: number,
): ManifestCleanupProgress | undefined {
  if (!data) return undefined;
  const { cursor, attempt, state, owner, pendingCount, skippedCount } = data;
  if (data.count !== count || !Number.isInteger(cursor) || cursor < 0 || cursor > count ||
      !Number.isInteger(attempt) || attempt < 1 ||
      !['RUNNING', 'STOPPED', 'RECONCILED', 'COMPLETED'].includes(state) ||
      !(owner === null || typeof owner === 'string') ||
      !Number.isInteger(pendingCount) || pendingCount < 0 || pendingCount > MANIFEST_CLEANUP_CHUNK_SIZE ||
      !Number.isInteger(skippedCount) || skippedCount < 0 || cursor + pendingCount + skippedCount > count ||
      (state === 'RUNNING' && (!owner || pendingCount === 0)) ||
      (state !== 'RUNNING' && pendingCount !== 0) ||
      (state === 'COMPLETED' && cursor !== count)) {
    throw new Error('MANIFEST_RECONCILIATION_REQUIRED: Cleanup progress could not be verified.');
  }
  return { count, cursor, attempt, state, owner, pendingCount, skippedCount };
}

export function requireManifestExecutionPosition(
  progress: ManifestCleanupProgress | undefined,
  continuing: boolean,
) {
  if (!continuing && !progress) return { cursor: 0, attempt: 0 };
  if (continuing && progress?.state === 'RECONCILED' && progress.cursor < progress.count) {
    return { cursor: progress.cursor, attempt: progress.attempt };
  }
  throw new Error('MANIFEST_RECONCILIATION_REQUIRED: Reconcile the original manifest before continuing with a fresh confirmation.');
}

export async function reconcileManifestCleanup(
  db: FirebaseFirestore.Firestore,
  manifest: HistoricalCleanupManifestSelection,
): Promise<HistoricalCleanupRecoveryReport> {
  const auditId = manifestCleanupAuditId(manifest);
  const ref = manifestCleanupProgressRef(db, auditId);
  return db.runTransaction(async (transaction) => {
    const progress = readManifestCleanupProgress((await transaction.get(ref)).data(), manifest.candidateCount);
    if (!progress) {
      return { auditId, status: 'NOT_STARTED', committedCount: 0, skippedCount: 0,
        unprocessedCount: manifest.candidateCount, unresolvedCount: 0, canContinue: false };
    }
    const lease = (await transaction.get(db.doc(HISTORICAL_CLEANUP_LEASE_PATH))).data();
    const running = progress.state === 'RUNNING' && lease?.owner === progress.owner &&
      lease.status === 'ACTIVE' && lease.expiresAtMs > Date.now();
    if (!running && progress.state !== 'COMPLETED' && progress.state !== 'RECONCILED') {
      // Every chunk reads this document and advances it in the same transaction as the
      // receipt and deletes. Changing it fences an interrupted worker before any continuation.
      transaction.update(ref, { state: 'RECONCILED', owner: null, pendingCount: 0 });
    }
    const unresolvedCount = running ? progress.pendingCount : 0;
    return {
      auditId,
      status: progress.state === 'COMPLETED' ? 'COMPLETED' : running ? 'RUNNING' :
        progress.cursor > 0 ? 'PARTIAL' : 'STOPPED',
      committedCount: progress.cursor,
      skippedCount: progress.skippedCount,
      unprocessedCount: progress.count - progress.cursor - progress.skippedCount - unresolvedCount,
      unresolvedCount,
      canContinue: !running && progress.cursor < progress.count,
    };
  });
}

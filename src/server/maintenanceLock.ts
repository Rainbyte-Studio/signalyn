/**
 * Signalyn Exclusive Historical Cleanup Maintenance Lock
 *
 * Manages a distributed Firestore lock at `system/historicalCleanupLease` so
 * permanent historical backlog cleanup can never overlap with:
 * - Daily Intelligence Pipeline
 * - Manual / batch / pending article analysis
 * - Incremental Story assignment
 * - Failed article recovery / deletion
 * - Out-of-scope cleanup
 * - Historical Backfill batches / resumes
 */

import { getServerDb, cleanServerData } from './serverFirestoreAdapter';

export const HISTORICAL_CLEANUP_LEASE_PATH = 'system/historicalCleanupLease';
export const DEFAULT_CLEANUP_LEASE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function assertHistoricalCleanupLeaseOwner(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  owner: string,
): Promise<void> {
  const lease = (await transaction.get(db.doc(HISTORICAL_CLEANUP_LEASE_PATH))).data();
  if (lease?.owner !== owner || lease.status !== 'ACTIVE' || !(lease.expiresAtMs > Date.now())) {
    throw new Error('HISTORICAL_CLEANUP_ACTIVE: This operation no longer holds the historical cleanup lease.');
  }
}

export interface HistoricalCleanupLeaseRecord {
  owner: string;
  purpose: string;
  acquiredAt: string;
  expiresAt: string;
  expiresAtMs: number;
  status: 'ACTIVE' | 'RELEASED';
  releasedAt?: string;
}

export interface HistoricalCleanupLeaseStatus {
  active: boolean;
  lease?: HistoricalCleanupLeaseRecord;
  timeRemainingSeconds: number;
}

function getCleanupLeaseRef(): any | null {
  try {
    const db = getServerDb();
    if (!db || typeof db.doc !== 'function') return null;
    const ref = db.doc(HISTORICAL_CLEANUP_LEASE_PATH);
    if (!ref || typeof ref.get !== 'function') return null;
    return ref;
  } catch {
    return null;
  }
}

/**
 * Atomically acquires the exclusive historical cleanup lock in Firestore.
 * Fails closed: if another cleanup holds an active lease or the transaction fails, throws.
 */
export async function acquireHistoricalCleanupLease(
  owner: string,
  purpose: string = 'HISTORICAL_BACKLOG_CLEANUP',
  ttlMs: number = DEFAULT_CLEANUP_LEASE_TTL_MS
): Promise<{ acquired: true; owner: string; expiresAt: string }> {
  const db = getServerDb();
  const leaseRef = db.doc(HISTORICAL_CLEANUP_LEASE_PATH);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAtMs = now + ttlMs;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(leaseRef);
    const data = snap?.exists ? (snap.data() as HistoricalCleanupLeaseRecord) : undefined;
    const existingExpiryMs =
      typeof data?.expiresAtMs === 'number'
        ? data.expiresAtMs
        : data?.expiresAt
        ? Date.parse(data.expiresAt)
        : 0;

    if (data && data.status === 'ACTIVE' && existingExpiryMs > now && data.owner !== owner) {
      throw new Error(
        `HISTORICAL_CLEANUP_ACTIVE: An administrator Historical Backlog Cleanup (${data.owner}) is currently in progress until ${data.expiresAt}.`
      );
    }

    const record: HistoricalCleanupLeaseRecord = {
      owner,
      purpose,
      acquiredAt: nowIso,
      expiresAt: expiresAtIso,
      expiresAtMs,
      status: 'ACTIVE',
    };

    transaction.set(leaseRef, cleanServerData(record));
  });

  return { acquired: true, owner, expiresAt: expiresAtIso };
}

/**
 * Releases the exclusive historical cleanup lock if held by `owner`.
 */
export async function releaseHistoricalCleanupLease(owner: string): Promise<boolean> {
  try {
    const db = getServerDb();
    const leaseRef = db.doc(HISTORICAL_CLEANUP_LEASE_PATH);
    await db.runTransaction(async (transaction: any) => {
      const snap = await transaction.get(leaseRef);
      if (!snap?.exists) return;
      const data = snap.data() as HistoricalCleanupLeaseRecord;
      if (data?.owner === owner) {
        transaction.set(
          leaseRef,
          cleanServerData({
            ...data,
            status: 'RELEASED',
            expiresAtMs: Date.now(),
            releasedAt: new Date().toISOString(),
          })
        );
      }
    });
    return true;
  } catch (err) {
    console.warn('[Maintenance Lock] Could not release historical cleanup lease:', err);
    return false;
  }
}

/**
 * Reads the current historical cleanup lease status (safe for minimal test doubles).
 */
export async function getHistoricalCleanupLeaseStatus(): Promise<HistoricalCleanupLeaseStatus> {
  const leaseRef = getCleanupLeaseRef();
  if (!leaseRef) {
    return { active: false, timeRemainingSeconds: 0 };
  }

  try {
    const snap = await leaseRef.get();
    if (!snap || !snap.exists || typeof snap.data !== 'function') {
      return { active: false, timeRemainingSeconds: 0 };
    }
    const data = snap.data() as HistoricalCleanupLeaseRecord | undefined;
    if (!data || data.status !== 'ACTIVE') {
      return { active: false, lease: data, timeRemainingSeconds: 0 };
    }
    const now = Date.now();
    const expiresMs =
      typeof data.expiresAtMs === 'number'
        ? data.expiresAtMs
        : data.expiresAt
        ? Date.parse(data.expiresAt)
        : 0;
    const isActive = Number.isFinite(expiresMs) && expiresMs > now;
    return {
      active: isActive,
      lease: data,
      timeRemainingSeconds: isActive ? Math.max(0, Math.round((expiresMs - now) / 1000)) : 0,
    };
  } catch {
    return { active: false, timeRemainingSeconds: 0 };
  }
}

/**
 * Throws a conflict error if an administrator Historical Backlog Cleanup is actively running.
 */
export async function assertNoHistoricalCleanupActive(operationName: string): Promise<void> {
  const status = await getHistoricalCleanupLeaseStatus();
  if (status.active) {
    throw new Error(
      `HISTORICAL_CLEANUP_ACTIVE: Cannot run ${operationName} while Historical Backlog Cleanup (${status.lease?.owner || 'active'}) is in progress. Please retry once cleanup completes.`
    );
  }
}

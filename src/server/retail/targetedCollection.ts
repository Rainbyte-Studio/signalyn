import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { RetailCollectionRun, RetailOffer, RetailPriceHistoryEntry } from '../../types/retailPrice';
import { getAthensCurrentDateString } from '../reportingWindow';
import { cleanServerData, getServerDb } from '../serverFirestoreAdapter';
import { fetchPlaisioOffer, PLAISIO_BASE_URL } from './plaisioAdapter';

export const DISCOVERY_RETAILERS = ['public-gr', 'kotsovolos-gr', 'plaisio-gr'] as const;
const RETAILER = 'plaisio-gr';
const MAX_OFFERS = 5;
const REQUEST_TIMEOUT_MS = 4_000;
const REQUEST_DELAY_MS = 3_000;
const RUN_TIMEOUT_MS = 35_000;

export class RetailCollectionError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function gate(db: Firestore) {
  return db.collection('retailCollectionLocks').doc(RETAILER);
}

// Legacy writers cannot be fenced at commit. Hold their guard until the writer
// settles, even if its HTTP caller disconnects. A killed process requires recovery.
export async function withLegacyRetailWriter<T>(write: () => Promise<T>, db = getServerDb()): Promise<T> {
  const ref = gate(db);
  const owner = randomUUID();
  await db.runTransaction(async (tx) => {
    const lock = await tx.get(ref);
    if (lock.exists && (lock.get('kind') === 'legacy' || lock.get('expiresAt') > lock.readTime.toMillis())) {
      throw new RetailCollectionError(409, 'Another retail writer holds the Plaisio lock.');
    }
    if (lock.get('runId')) {
      const runRef = db.collection('retailCollectionRuns').doc(lock.get('runId'));
      const run = (await tx.get(runRef)).data() as RetailCollectionRun | undefined;
      if (run?.status === 'RUNNING') tx.set(runRef, finish(run, 'TIMED_OUT', lock.readTime.toMillis()));
    }
    tx.set(ref, { kind: 'legacy', owner, acquiredAt: lock.readTime.toMillis() });
  });
  try {
    return await write();
  } finally {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).get('owner') === owner) tx.delete(ref);
    });
  }
}

function finish(run: RetailCollectionRun, status: RetailCollectionRun['status'], now: number): RetailCollectionRun {
  return {
    ...run,
    status,
    completedAt: new Date(now).toISOString(),
    durationMs: Math.max(0, now - Date.parse(run.startedAt)),
    ...(status === 'TIMED_OUT' ? { errorSummary: 'Collection deadline expired.' } : {}),
  };
}

function isPlaisioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === PLAISIO_BASE_URL && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function collectTargetedRetailer(
  retailerId: unknown,
  key: unknown,
  options: { db?: Firestore; fetchOffer?: typeof fetchPlaisioOffer; timeoutMs?: number; requestDelayMs?: number } = {},
): Promise<RetailCollectionRun> {
  if (retailerId !== RETAILER) throw new RetailCollectionError(400, 'Unsupported retailerId.');
  if (typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) {
    throw new RetailCollectionError(400, 'Provide an Idempotency-Key of 16–100 letters, digits, underscores or hyphens.');
  }
  const db = options.db ?? getServerDb();
  const fetchOffer = options.fetchOffer ?? fetchPlaisioOffer;
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS;
  const lockRef = gate(db);
  const runs = db.collection('retailCollectionRuns');
  const runRef = runs.doc(`targeted-${RETAILER}-${key}`);
  const sourceRef = db.collection('retailSources').doc(RETAILER);
  const owner = randomUUID();
  const acquired = await db.runTransaction(async (tx) => {
    const [lock, existing] = await tx.getAll(lockRef, runRef);
    const now = lock.readTime.toMillis();
    const previous = existing.data() as RetailCollectionRun | undefined;
    if (previous && previous.status !== 'RUNNING') return { run: previous, replay: true };
    const active = lock.exists && (lock.get('kind') === 'legacy' || lock.get('expiresAt') > now);
    if (active) throw new RetailCollectionError(409, 'Another retail writer holds the Plaisio lock.');
    if (previous) {
      const run = finish(previous, 'TIMED_OUT', now);
      tx.set(runRef, run);
      if (lock.get('runId') === run.id) tx.delete(lockRef);
      return { run, replay: true };
    }
    const source = await tx.get(sourceRef);
    if (!source.exists || source.get('enabled') === false) {
      throw new RetailCollectionError(409, 'Plaisio must have an enabled Firestore source.');
    }
    const expiredId = lock.get('runId');
    const expired = expiredId ? await tx.get(runs.doc(expiredId)) : undefined;
    const expiredRun = expired?.data() as RetailCollectionRun | undefined;
    if (expired && expiredRun?.status === 'RUNNING') {
      tx.set(expired.ref, finish(expiredRun, 'TIMED_OUT', now));
    }
    const run: RetailCollectionRun = {
      id: runRef.id, startedAt: new Date(now).toISOString(), status: 'RUNNING',
      retailers: {}, totalAttempted: 0, totalCollected: 0, newObservations: 0, durationMs: 0, triggeredBy: 'MANUAL',
    };
    tx.set(runRef, run);
    tx.set(lockRef, { kind: 'targeted', owner, runId: run.id, expiresAt: now + timeoutMs });
    return { run, replay: false };
  }, { maxAttempts: 3 });
  if (acquired.replay) return acquired.run;

  const run = acquired.run;
  const controller = new AbortController();
  const deadline = Date.parse(run.startedAt) + timeoutMs;
  const outOfTime = () => controller.signal.aborted || Date.now() >= deadline;
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  type LiveOffer = Awaited<ReturnType<typeof fetchOffer>>['offers'][number] & { priceCents: number };
  const observations: Array<{ offer: RetailOffer; revision?: Timestamp; live: LiveOffer; at: string }> = [];
  let error: string | undefined;
  let blocked = false;
  let httpStatus: number | undefined;
  try {
    const targets = await db.collection('retailOffers')
      .where('retailerId', '==', RETAILER).where('status', '==', 'ACTIVE').limit(MAX_OFFERS).get();
    let requested = false;
    for (const doc of targets.docs) {
      if (outOfTime()) break;
      const offer = doc.data() as RetailOffer;
      run.totalAttempted++;
      if (offer.id !== doc.id || offer.retailerId !== RETAILER || !offer.retailerSku ||
          offer.retailerSku.includes('/') || offer.retailerSku === 'unknown-sku' || !isPlaisioUrl(offer.url)) {
        error = 'An existing offer has an invalid Plaisio identity or URL.';
        continue;
      }
      if (requested) await delay(options.requestDelayMs ?? REQUEST_DELAY_MS, undefined, { signal: controller.signal });
      if (outOfTime()) break;
      requested = true;
      const result = await fetchOffer(offer.url, {
        timeoutMs: REQUEST_TIMEOUT_MS, signal: controller.signal, followRedirects: false,
        maxResponseBytes: 4 * 1024 * 1024,
      });
      if (outOfTime()) break;
      httpStatus = result.httpStatus;
      blocked = result.status === 'REQUIRES_AUTHORIZATION' || httpStatus === 401 || httpStatus === 403;
      if (blocked) {
        error = result.error || 'Plaisio denied collection access.';
        break;
      }
      const live = result.offers.find((item) => item.retailerSku === offer.retailerSku);
      if (!result.success || result.retailerId !== RETAILER || !live || live.currency !== 'EUR' ||
          typeof live.priceCents !== 'number' || !Number.isSafeInteger(live.priceCents) || live.priceCents <= 0) {
        error = result.error || 'No verified EUR price for the existing Plaisio SKU.';
        continue;
      }
      observations.push({ offer, revision: doc.updateTime, live: { ...live, priceCents: live.priceCents }, at: new Date().toISOString() });
    }
    if (targets.empty) error = 'No existing Plaisio offers to refresh.';
  } catch {
    error = 'Plaisio offer collection failed.';
  } finally {
    clearTimeout(timer);
  }
  return db.runTransaction(async (tx) => {
    const [lock, persisted, source] = await tx.getAll(lockRef, runRef, sourceRef);
    const now = lock.readTime.toMillis();
    const storedRun = persisted.data() as RetailCollectionRun;
    if (storedRun.status !== 'RUNNING') return storedRun;
    if (lock.get('owner') !== owner) throw new RetailCollectionError(409, 'Plaisio lease ownership changed.');
    const timedOut = () => now >= lock.get('expiresAt') || outOfTime();
    const persistTimeout = () => {
      const result = finish(run, 'TIMED_OUT', now);
      tx.set(runRef, result);
      tx.delete(lockRef);
      return result;
    };
    if (timedOut()) return persistTimeout();
    const candidates = observations.map(({ offer, revision, live, at }) => {
      const day = getAthensCurrentDateString(new Date(at));
      return {
        offer, revision, live, at, day, offerRef: db.collection('retailOffers').doc(offer.id),
        historyRef: db.collection('retailPriceHistory').doc(`${RETAILER}__${offer.retailerSku}__${day}`),
      };
    });
    const snapshots = candidates.length ? await tx.getAll(...candidates.flatMap(({ offerRef, historyRef }) => [offerRef, historyRef])) : [];
    if (timedOut()) return persistTimeout();
    // A transaction callback can retry. Build counts from the current snapshots.
    const result = { ...run, totalCollected: 0, newObservations: 0 };
    let latest = '';
    let rejected = false;
    const seen = new Set<string>();
    for (const [index, candidate] of candidates.entries()) {
      const { offer, revision, live, at, day, offerRef, historyRef } = candidate;
      const currentSnapshot = snapshots[index * 2];
      const current = currentSnapshot.data() as RetailOffer | undefined;
      const history = snapshots[index * 2 + 1].data() as RetailPriceHistoryEntry | undefined;
      if (!source.exists || source.get('enabled') === false || !current || current.retailerId !== RETAILER ||
          current.status !== 'ACTIVE' || (revision && !currentSnapshot.updateTime?.isEqual(revision)) ||
          current.canonicalProductId !== offer.canonicalProductId || current.id !== offer.id || current.retailerSku !== offer.retailerSku || current.url !== offer.url ||
          (current.lastObservedAt || '') > at || (history && (history.retailerId !== RETAILER ||
            history.offerId !== current.id || history.recordedAt > at)) || seen.has(historyRef.id)) {
        rejected = true;
        continue;
      }
      seen.add(historyRef.id);
      const price = {
        referencePriceCents: live.referencePriceCents ?? null, stockStatus: live.stockStatus,
        isAvailable: live.isAvailable, currency: 'EUR', priceSourceType: 'LIVE_SCRAPED',
        observationStatus: 'LIVE_VERIFIED', isLiveVerified: true, collectionRunId: run.id,
      } as const;
      tx.update(offerRef, {
        ...price, currentPriceCents: live.priceCents, sourceVerifiedAt: at, lastSuccessfulFetchAt: at, lastObservedAt: at,
      });
      tx.set(historyRef, cleanServerData({
        ...price, id: historyRef.id, offerId: current.id, retailerId: RETAILER, dateAthens: day,
        canonicalProductId: current.canonicalProductId, priceCents: live.priceCents, recordedAt: at,
      } satisfies RetailPriceHistoryEntry));
      result.totalCollected++;
      if (!history) result.newObservations++;
      if (at > latest) latest = at;
    }
    if (latest && latest > (source.get('lastSuccessfulCollectionAt') || '')) {
      tx.update(sourceRef, { lastSuccessfulCollectionAt: latest });
    }
    const summary = rejected ? 'Some Plaisio offers changed or conflicted before persistence.' : error;
    const status = result.totalCollected ? (summary ? 'PARTIAL' : 'SUCCESS') : blocked ? 'ACCESS_BLOCKED' : 'FAILED';
    result.retailers = { [RETAILER]: { status, itemsAttempted: result.totalAttempted, itemsCollected: result.totalCollected, httpStatus, error: summary } };
    result.errorSummary = summary;
    const finished = finish(result, status, now);
    tx.set(runRef, cleanServerData(finished));
    tx.delete(lockRef);
    return cleanServerData(finished) as RetailCollectionRun;
  }, { maxAttempts: 3 });
}

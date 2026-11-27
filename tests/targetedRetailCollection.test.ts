import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { collectTargetedRetailer, withLegacyRetailWriter } from '../src/server/retail/targetedCollection';
import { fetchPlaisioOffer } from '../src/server/retail/plaisioAdapter';
import { resolveRetailCatalogTimestamps, resolveRetailerOperationalStatus } from '../src/utils/dataIntegrityContracts';

type Data = Record<string, unknown>;
type Ref = { id: string; path: string };

function mockFirestore() {
  const state = new Map<string, Data>();
  let timeOffset = 0;
  let queue = Promise.resolve();
  let failObservationCommit = false;
  const snapshot = (ref: Ref) => {
    const data = structuredClone(state.get(ref.path));
    return {
      id: ref.id, ref, exists: !!data, data: () => data, get: (field: string) => data?.[field],
      readTime: { toMillis: () => Date.now() + timeOffset },
    };
  };
  const db = {
    collection(name: string) {
      const doc = (id: string): Ref => ({ id, path: `${name}/${id}` });
      const query = (filters: [string, unknown][], limit = Infinity) => ({
        where: (field: string, operator: string, value: unknown) => {
          assert.equal(operator, '==');
          return query([...filters, [field, value]], limit);
        },
        limit: (count: number) => query(filters, count),
        async get() {
          const docs = [...state.entries()]
            .filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value))
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, limit).map(([path]) => snapshot(doc(path.split('/')[1])));
          return { docs, empty: !docs.length };
        },
      });
      return { doc, ...query([]) };
    },
    runTransaction<T>(callback: (tx: unknown) => Promise<T>) {
      const execution = queue.then(async () => {
        const writes = new Map<string, Data | undefined>();
        const get = async (ref: Ref) => {
          assert.equal(writes.size, 0, 'all reads must precede writes');
          return snapshot(ref);
        };
        const result = await callback({
          get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
          set: (ref: Ref, data: Data) => writes.set(ref.path, data),
          update: (ref: Ref, data: Data) => {
            assert(state.has(ref.path));
            writes.set(ref.path, { ...state.get(ref.path), ...data });
          },
          delete: (ref: Ref) => writes.set(ref.path, undefined),
        });
        if (failObservationCommit && [...writes.keys()].some((path) => path.startsWith('retailPriceHistory/'))) {
          failObservationCommit = false;
          throw new Error('Mock Firestore commit failure');
        }
        for (const [path, data] of writes) {
          if (data) state.set(path, structuredClone(data));
          else state.delete(path);
        }
        return result;
      });
      queue = execution.then(() => undefined, () => undefined);
      return execution;
    },
  } as unknown as Firestore;
  state.set('retailSources/plaisio-gr', { enabled: true });
  return {
    db, state, expire: () => { timeOffset += 60_000; },
    failNextObservationCommit: () => { failObservationCommit = true; },
  };
}

const A = 'first-test-idempotency-key';
const B = 'second-test-idempotency-key';
const SOURCE = 'retailSources/plaisio-gr';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function addOffer(state: Map<string, Data>, sku: string, retailerId = 'plaisio-gr') {
  const id = `${retailerId}__${sku}`;
  const url = `https://www.plaisio.gr/product_${sku}`;
  state.set(`retailOffers/${id}`, { id, url, status: 'ACTIVE', retailerSku: sku, retailerId, canonicalProductId: 'product' });
}

const fetchSuccess: typeof fetchPlaisioOffer = async (url, options) => {
  assert.equal(options?.followRedirects, false);
  const sku = url.split('_').at(-1)!;
  assert.match(url, /^https:\/\/www\.plaisio\.gr\//);
  return {
    retailerId: 'plaisio-gr', success: true, status: 'ACTIVE', httpStatus: 200,
    offers: [{
      retailerSku: sku, title: 'Fixture', brand: 'Fixture', url, priceCents: 1_999, currency: 'EUR',
      stockStatus: 'IN_STOCK', isAvailable: true, priceSourceType: 'LIVE_SCRAPED',
      observationStatus: 'LIVE_VERIFIED', isLiveVerified: true,
    }],
  };
};

test('allowlist and key validation run before database access', async () => {
  await assert.rejects(collectTargetedRetailer('public-gr', A), { statusCode: 400 });
  await assert.rejects(collectTargetedRetailer('plaisio-gr', 'invalid'), { statusCode: 400 });
});

test('concurrent attempts and the legacy writer cannot acquire an active lease', async () => {
  const { db, state } = mockFirestore();
  addOffer(state, '12345');
  const entered = deferred();
  const release = deferred();
  const fetchOffer: typeof fetchPlaisioOffer = async (...args) => {
    entered.resolve();
    await release.promise;
    return fetchSuccess(...args);
  };
  const first = collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer });
  await entered.promise;
  try {
    await assert.rejects(collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer }), { statusCode: 409 });
    await assert.rejects(collectTargetedRetailer('plaisio-gr', B, { db, fetchOffer }), { statusCode: 409 });
    await assert.rejects(withLegacyRetailWriter(async () => assert.fail('writer entered'), db), { statusCode: 409 });
  } finally {
    release.resolve();
  }
  const result = await first;
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(await collectTargetedRetailer('plaisio-gr', A, {
    db, fetchOffer: async () => assert.fail('replay fetched'),
  }), result);
});

test('expired holder is fenced after takeover and cannot persist stale observations', async () => {
  const { db, state, expire } = mockFirestore();
  addOffer(state, '12345');
  const entered = deferred();
  const release = deferred();
  const first = collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer: async (...args) => {
    entered.resolve();
    await release.promise;
    return fetchSuccess(...args);
  } });
  await entered.promise;
  expire();
  const second = await collectTargetedRetailer('plaisio-gr', B, { db, fetchOffer: fetchSuccess, timeoutMs: 120_000 });
  release.resolve();
  assert.equal(second.status, 'SUCCESS');
  assert.equal((await first).status, 'TIMED_OUT');
  assert.equal(state.get('retailOffers/plaisio-gr__12345')?.collectionRunId, second.id);
});

test('partial failure commits only valid Plaisio observations and updates freshness', async () => {
  const { db, state } = mockFirestore();
  for (const sku of ['11111', '22222', '33333']) addOffer(state, sku);
  addOffer(state, '44444', 'public-gr');
  state.set('retailOffers/plaisio-gr__33333', { ...state.get('retailOffers/plaisio-gr__33333'), url: 'https://example.com/' });
  const fetchOffer: typeof fetchPlaisioOffer = async (...args) => {
    const result = await fetchSuccess(...args);
    if (args[0].endsWith('22222')) result.offers[0].priceCents = null;
    return result;
  };
  const result = await collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer, requestDelayMs: 0 });
  assert.equal(result.status, 'PARTIAL');
  assert.deepEqual(Object.keys(result.retailers), ['plaisio-gr']);
  assert.equal(result.totalAttempted, 3);
  assert.equal(result.totalCollected, 1);
  assert.equal(result.newObservations, 1);
  assert.deepEqual(
    [...state.keys()].filter((path) => path.startsWith('retailPriceHistory/')).map((path) => path.slice(0, -10)),
    ['retailPriceHistory/plaisio-gr__11111__'],
  );
  assert.equal(state.get(SOURCE)?.lastSuccessfulCollectionAt, state.get('retailOffers/plaisio-gr__11111')?.lastObservedAt);
  assert.equal(state.get('retailOffers/public-gr__44444')?.lastObservedAt, undefined);
  assert([...state.keys()].every((path) => !path.startsWith('retailProducts/') && !path.startsWith('retailMatchReviews/')));
  const second = await collectTargetedRetailer('plaisio-gr', B, { db, fetchOffer, requestDelayMs: 0 });
  assert.equal(second.totalCollected, 1);
  assert.equal(second.newObservations, 0);
});

test('run timeout cancels fetches and discards observations collected before the deadline', async () => {
  const { db, state } = mockFirestore();
  addOffer(state, '11111');
  addOffer(state, '22222');
  const result = await collectTargetedRetailer('plaisio-gr', A, {
    db, timeoutMs: 75, requestDelayMs: 0,
    fetchOffer: async (url, options) => {
      if (url.endsWith('11111')) return fetchSuccess(url, options);
      const signal = options!.signal!;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return fetchSuccess(url, options);
    },
  });
  assert.equal(result.status, 'TIMED_OUT');
  assert.equal(result.totalAttempted, 2);
  assert.equal(result.totalCollected, 0);
  assert(!state.get(SOURCE)?.lastSuccessfulCollectionAt);
  assert(![...state.keys()].some((path) => path.startsWith('retailPriceHistory/')));
});

test('a failed observation transaction leaves no prices or freshness and retries resolve expiry', async () => {
  const { db, state, expire, failNextObservationCommit } = mockFirestore();
  addOffer(state, '12345');
  failNextObservationCommit();
  await assert.rejects(collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer: fetchSuccess }), /Mock Firestore/);
  assert(!state.get(SOURCE)?.lastSuccessfulCollectionAt);
  assert(!state.get('retailOffers/plaisio-gr__12345')?.collectionRunId);
  expire();
  const replay = await collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer: async () => assert.fail('replay fetched') });
  assert.equal(replay.status, 'TIMED_OUT');
});

test('legacy writer stays exclusive past targeted lease duration', async () => {
  const { db, expire } = mockFirestore();
  const entered = deferred();
  const release = deferred();
  const legacy = withLegacyRetailWriter(async () => {
    entered.resolve();
    await release.promise;
  }, db);
  await entered.promise;
  expire();
  try {
    await assert.rejects(collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer: fetchSuccess }), { statusCode: 409 });
  } finally {
    release.resolve();
  }
  await legacy;
});

test('probe and discovery attempt timestamps do not imply successful collection', () => {
  const now = new Date().toISOString();
  const source = { id: 'plaisio-gr' as const, lastDiscoveryAt: now, lastSuccessAt: now };
  const result = resolveRetailerOperationalStatus({ source });
  assert.equal(result.collectionDimension.effectiveLastCollectionAt, null);
  assert.equal(resolveRetailCatalogTimestamps({ sources: [source] }).catalogInventoryAsOfAt, null);
});

test('disabled source is rejected and enabled source reads at most five active offers', async () => {
  const { db, state } = mockFirestore();
  for (let index = 0; index < 7; index++) addOffer(state, String(10000 + index));
  const inactivePath = 'retailOffers/plaisio-gr__10000';
  state.set(inactivePath, { ...state.get(inactivePath), status: 'DISCONTINUED' });
  state.set(SOURCE, { enabled: false });
  await assert.rejects(collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer: fetchSuccess }), { statusCode: 409 });
  state.set(SOURCE, { enabled: true });
  const run = await collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer: fetchSuccess, requestDelayMs: 0 });
  assert.equal(run.totalAttempted, 5);
  assert.equal(run.totalCollected, 5);
  assert(!state.get(inactivePath)?.lastObservedAt);
});

test('access denial stops requests without updating freshness', async () => {
  const { db, state } = mockFirestore();
  addOffer(state, '11111');
  addOffer(state, '22222');
  const result = await collectTargetedRetailer('plaisio-gr', A, { db, fetchOffer: async () => ({
    retailerId: 'plaisio-gr', success: false, status: 'REQUIRES_AUTHORIZATION', httpStatus: 403, offers: [],
  }) });
  assert.equal(result.status, 'ACCESS_BLOCKED');
  assert.equal(result.totalAttempted, 1);
  assert(!state.get(SOURCE)?.lastSuccessfulCollectionAt);
});

test('targeted adapter prevents redirects and rejects oversized bodies', async (context) => {
  context.mock.method(globalThis, 'fetch', async (_: string, options: RequestInit) => {
    assert.equal(options.redirect, 'error');
    return new Response('oversized');
  });
  const result = await fetchPlaisioOffer('https://www.plaisio.gr/product_12345', {
    followRedirects: false, maxResponseBytes: 2,
  });
  assert.equal(result.success, false);
  assert.match(result.error || '', /size limit/);
});

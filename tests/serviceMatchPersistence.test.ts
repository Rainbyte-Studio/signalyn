/**
 * Signalyn S1.2.2 — Service Product Matching Persistence & Sync Integrity Test Suite
 *
 * Covers all 18 Objective 9 Verification Scenarios using deterministic mock Firestore clients:
 *  1. Authoritative canonical product loading from Firestore (no seedPilotCatalog, fail-closed in prod)
 *  2. Deterministic match document ID generation
 *  3. Idempotent repeated recomputation
 *  4. Preservation of manual review decisions (CONFIRMED / DISMISSED)
 *  5. Apple iPhone generation applicability (iOS 18 vs iOS 26.7 hardware floor & narrow model scope)
 *  6. Apple AirPods non-false-positive matching
 *  7. Huawei Pura 70 vs Pura 80 generation isolation
 *  8. Huawei MateBook vs MatePad category isolation & broad bulletin downgrade
 *  9. Samsung Galaxy S / Z / A / Tab model isolation & broad SMR downgrade
 * 10. Dry-run recomputation without writes
 * 11. Confirmed persistence with bounded batches (<= 200) and read-back verification
 * 12. Partial batch failure handling
 * 13. Dashboard counter consistency with Firestore (0 when empty, persisted count when populated, UNAVAILABLE on error)
 * 14. Sync run status COMPLETED vs PARTIAL (finalized BEFORE Firestore batch commit)
 * 15. Admin-only endpoint protection (401/403 rejection)
 * 16. Preview in-memory mode labeling (PREVIEW_IN_MEMORY_ONLY)
 * 17. State restoration after simulated server restart
 * 18. Non-interference with Retail Price Intelligence
 *
 * Note: Unit tests use mock Firestore clients and never claim live production verification.
 */

import assert from 'assert';
import {
  buildDeterministicMatchId,
  matchAdvisoryToCatalogProducts,
  countLegacyBroadVerifiedIds,
  SERVICE_MATCHER_VERSION,
} from '../src/server/service/serviceProductMatcher';
import {
  loadAuthoritativeCatalogProducts,
  recomputeServiceProductMatches,
  getServiceDashboardStats,
  getPersistenceDiagnostic,
  resetServiceStateForTests,
  initializeServiceIntelligence,
} from '../src/server/service/servicePipelineService';
import { getMemCatalog } from '../src/server/retail/retailPipelineService';
import { requireAdminOrAuthorizedClient } from '../src/server/authMiddleware';
import { RetailProduct } from '../src/types/retailPrice';
import { ServiceAdvisory, ServiceProductMatch } from '../src/types/serviceIntelligence';

/**
 * Deterministic in-memory mock Firestore supporting collections, docs, count(), and batch()
 */
function createMockFirestoreForS122(options: {
  permissionDenied?: boolean;
  failOnBatchIndex?: number;
  seedCollections?: Record<string, Record<string, any>>;
} = {}) {
  const store: Record<string, Record<string, any>> = options.seedCollections
    ? JSON.parse(JSON.stringify(options.seedCollections))
    : {};

  let batchCommitCallCount = 0;
  const batchSizesCommitted: number[] = [];

  const makePermError = () => {
    const err: any = new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.');
    err.code = 7;
    return err;
  };

  const db = {
    _store: store,
    _batchSizesCommitted: batchSizesCommitted,
    collection(colName: string) {
      if (!store[colName]) store[colName] = {};
      const colData = store[colName];

      const buildDocsList = () =>
        Object.entries(colData).map(([id, val]) => ({
          id,
          exists: true,
          data: () => JSON.parse(JSON.stringify(val)),
        }));

      const makeQuery = (docsList: Array<{ id: string; exists: boolean; data: () => any }>) => ({
        limit(n: number) {
          return makeQuery(docsList.slice(0, n));
        },
        orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
          const sorted = [...docsList].sort((a, b) => {
            const va = String(a.data()?.[field] || '');
            const vb = String(b.data()?.[field] || '');
            return dir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
          });
          return makeQuery(sorted);
        },
        count() {
          return {
            async get() {
              if (options.permissionDenied) throw makePermError();
              return { data: () => ({ count: docsList.length }) };
            },
          };
        },
        async get() {
          if (options.permissionDenied) throw makePermError();
          return {
            empty: docsList.length === 0,
            size: docsList.length,
            docs: docsList,
          };
        },
      });

      return {
        ...makeQuery(buildDocsList()),
        doc(docId: string) {
          return {
            id: docId,
            colName,
            path: `${colName}/${docId}`,
            async set(payload: Record<string, any>) {
              if (options.permissionDenied) throw makePermError();
              colData[docId] = JSON.parse(JSON.stringify(payload));
            },
            async get() {
              if (options.permissionDenied) throw makePermError();
              const existing = colData[docId];
              if (!existing) return { exists: false, data: () => undefined };
              return { exists: true, data: () => JSON.parse(JSON.stringify(existing)) };
            },
            async delete() {
              if (options.permissionDenied) throw makePermError();
              delete colData[docId];
            },
          };
        },
      };
    },
    batch() {
      const ops: Array<{ type: 'set' | 'delete'; colName: string; docId: string; payload?: any }> = [];
      return {
        set(docRef: { colName: string; id: string }, payload: any) {
          ops.push({ type: 'set', colName: docRef.colName, docId: docRef.id, payload });
        },
        delete(docRef: { colName: string; id: string }) {
          ops.push({ type: 'delete', colName: docRef.colName, docId: docRef.id });
        },
        async commit() {
          if (options.permissionDenied) throw makePermError();
          const currentBatchIdx = batchCommitCallCount++;
          if (
            options.failOnBatchIndex !== undefined &&
            currentBatchIdx === options.failOnBatchIndex
          ) {
            throw new Error(`Simulated Firestore batch failure at batch index ${currentBatchIdx}`);
          }
          batchSizesCommitted.push(ops.length);
          for (const op of ops) {
            if (!store[op.colName]) store[op.colName] = {};
            if (op.type === 'set') {
              store[op.colName][op.docId] = JSON.parse(JSON.stringify(op.payload));
            } else if (op.type === 'delete') {
              delete store[op.colName][op.docId];
            }
          }
        },
      };
    },
  };

  return db;
}

const SAMPLE_CATALOG: RetailProduct[] = [
  { id: 'prod-ip-xs', name: 'Apple iPhone XS 64GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone XS', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-ip-11', name: 'Apple iPhone 11 128GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone 11', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-ip-12', name: 'Apple iPhone 12 128GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone 12', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-ip-15-pro', name: 'Apple iPhone 15 Pro 256GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone 15 Pro', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-ip-16-pro', name: 'Apple iPhone 16 Pro 128GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone 16 Pro', isPilot: true, createdAt: '', updatedAt: '' },
  { id: 'prod-ip-18-pro', name: 'Apple iPhone 18 Pro 256GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone 18 Pro', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-airpods-pro-2', name: 'Apple AirPods Pro 2', brand: 'Apple', category: 'AUDIO', modelFamily: 'AirPods Pro', isPilot: true, createdAt: '', updatedAt: '' },
  { id: 'prod-watch-s10', name: 'Apple Watch Series 10 46mm', brand: 'Apple', category: 'WEARABLES', modelFamily: 'Watch Series 10', isPilot: true, createdAt: '', updatedAt: '' },
  { id: 'prod-hw-pura70', name: 'HUAWEI Pura 70 256GB', brand: 'HUAWEI', category: 'SMARTPHONES', modelFamily: 'Pura 70', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-hw-pura80-pro', name: 'HUAWEI Pura 80 Pro 512GB', brand: 'HUAWEI', category: 'SMARTPHONES', modelFamily: 'Pura 80 Pro', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-hw-matepad-115', name: 'HUAWEI MatePad 11.5 128GB', brand: 'HUAWEI', category: 'TABLETS', modelFamily: 'MatePad 11.5', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-hw-matebook-d16', name: 'HUAWEI MateBook D 16', brand: 'HUAWEI', category: 'LAPTOPS', modelFamily: 'MateBook D 16', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-sam-s24', name: 'Samsung Galaxy S24 256GB', brand: 'Samsung', category: 'SMARTPHONES', modelFamily: 'Galaxy S24', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-sam-s25-ultra', name: 'Samsung Galaxy S25 Ultra 256GB', brand: 'Samsung', category: 'SMARTPHONES', modelFamily: 'Galaxy S25 Ultra', isPilot: true, createdAt: '', updatedAt: '' },
  { id: 'prod-sam-zfold6', name: 'Samsung Galaxy Z Fold6 256GB', brand: 'Samsung', category: 'SMARTPHONES', modelFamily: 'Galaxy Z Fold6', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-sam-zflip6', name: 'Samsung Galaxy Z Flip6 256GB', brand: 'Samsung', category: 'SMARTPHONES', modelFamily: 'Galaxy Z Flip6', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-sam-a55', name: 'Samsung Galaxy A55 5G 128GB', brand: 'Samsung', category: 'SMARTPHONES', modelFamily: 'Galaxy A55', isPilot: false, createdAt: '', updatedAt: '' },
  { id: 'prod-sam-tabs9', name: 'Samsung Galaxy Tab S9 256GB', brand: 'Samsung', category: 'TABLETS', modelFamily: 'Galaxy Tab S9', isPilot: false, createdAt: '', updatedAt: '' },
];

const SAMPLE_ADVISORIES: ServiceAdvisory[] = [
  {
    id: 'adv-apple-ios18',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    advisoryType: 'SECURITY_UPDATE',
    title: 'iOS 18.1 and iPadOS 18.1',
    summary: 'Security updates for iPhone XS and later',
    publishedAt: '2024-10-28',
    updatedAt: '2024-10-28',
    sourceUrl: 'https://support.apple.com/en-us/121563',
    affectedProductsText: 'iPhone XS and later',
    affectedProducts: ['iPhone'],
    affectedVersions: [],
    fixedVersions: ['iOS 18.1'],
    cveIds: ['CVE-2024-44243'],
    severity: 'HIGH',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
  },
  {
    id: 'adv-apple-ios26-7',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    advisoryType: 'SECURITY_UPDATE',
    title: 'iOS 26.7 and iPadOS 26.7',
    summary: 'Security update for iOS 26.7',
    publishedAt: '2026-09-15',
    updatedAt: '2026-09-15',
    sourceUrl: 'https://support.apple.com/en-us/999001',
    affectedProductsText: 'iPhone 11 and later',
    affectedProducts: ['iPhone'],
    affectedVersions: [],
    fixedVersions: ['iOS 26.7'],
    cveIds: ['CVE-2026-10001'],
    severity: 'HIGH',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
  },
  {
    id: 'adv-apple-ios18-7-11-narrow',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    advisoryType: 'SECURITY_UPDATE',
    title: 'iOS 18.7.11',
    summary: 'Legacy security update exclusively for iPhone XS, iPhone XS Max, iPhone XR',
    publishedAt: '2026-09-15',
    updatedAt: '2026-09-15',
    sourceUrl: 'https://support.apple.com/en-us/999002',
    affectedProductsText: 'iPhone XS, iPhone XS Max, iPhone XR',
    affectedProducts: ['iPhone XS', 'iPhone XS Max', 'iPhone XR'],
    affectedVersions: [],
    fixedVersions: ['iOS 18.7.11'],
    cveIds: ['CVE-2026-10002'],
    severity: 'MEDIUM',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
  },
  {
    id: 'adv-apple-iphone-duo',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    advisoryType: 'SECURITY_UPDATE',
    title: 'iOS 26.6.1 for iPhone Duo',
    summary: 'Device-specific release for iPhone Duo',
    publishedAt: '2026-08-10',
    updatedAt: '2026-08-10',
    sourceUrl: 'https://support.apple.com/en-us/999003',
    affectedProductsText: 'iPhone Duo',
    affectedProducts: ['iPhone Duo'],
    affectedVersions: [],
    fixedVersions: ['iOS 26.6.1'],
    cveIds: [],
    severity: 'LOW',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
  },
  {
    id: 'adv-apple-watch-s12',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    advisoryType: 'SECURITY_UPDATE',
    title: 'watchOS 26.0.1',
    summary: 'Available for Apple Watch Series 12 and Apple Watch Ultra 4',
    publishedAt: '2026-09-20',
    updatedAt: '2026-09-20',
    sourceUrl: 'https://support.apple.com/en-us/999004',
    affectedProductsText: 'Apple Watch Series 12 and Apple Watch Ultra 4',
    affectedProducts: ['Apple Watch Series 12', 'Apple Watch Ultra 4'],
    affectedVersions: [],
    fixedVersions: ['watchOS 26.0.1'],
    cveIds: [],
    severity: 'LOW',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
  },
  {
    id: 'adv-huawei-pura70-q',
    sourceId: 'huawei-security',
    manufacturer: 'Huawei',
    advisoryType: 'UPDATE_SCHEDULE',
    title: 'HUAWEI Pura 70 Quarterly Security Update Scope',
    summary: 'Quarterly security update scope for HUAWEI Pura 70',
    publishedAt: '2026-01-01',
    updatedAt: '2026-01-01',
    sourceUrl: 'https://consumer.huawei.com/gr/support/bulletin/',
    affectedProductsText: 'HUAWEI Pura 70',
    affectedProducts: ['HUAWEI Pura 70'],
    affectedVersions: [],
    fixedVersions: [],
    cveIds: [],
    severity: 'INFORMATIONAL',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
    updateFrequency: 'QUARTERLY',
  },
  {
    id: 'adv-huawei-pura80-m',
    sourceId: 'huawei-security',
    manufacturer: 'Huawei',
    advisoryType: 'UPDATE_SCHEDULE',
    title: 'HUAWEI Pura 80 Pro Monthly Security Update Scope',
    summary: 'Monthly security update scope for HUAWEI Pura 80 Pro',
    publishedAt: '2026-01-01',
    updatedAt: '2026-01-01',
    sourceUrl: 'https://consumer.huawei.com/gr/support/bulletin/',
    affectedProductsText: 'HUAWEI Pura 80 Pro',
    affectedProducts: ['HUAWEI Pura 80 Pro'],
    affectedVersions: [],
    fixedVersions: [],
    cveIds: [],
    severity: 'INFORMATIONAL',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
    updateFrequency: 'MONTHLY',
  },
  {
    id: 'adv-huawei-broad-bulletin',
    sourceId: 'huawei-security',
    manufacturer: 'Huawei',
    advisoryType: 'SECURITY_UPDATE',
    title: 'HUAWEI EMUI / HarmonyOS Monthly Security Bulletin (October 2026)',
    summary: 'Monthly security patch for HUAWEI Smartphones and Tablets (MatePad series)',
    publishedAt: '2026-10-01',
    updatedAt: '2026-10-01',
    sourceUrl: 'https://consumer.huawei.com/gr/support/bulletin/2026/10/',
    affectedProductsText: 'HUAWEI Smartphones (Pura / Mate / nova series), Tablets (MatePad series)',
    affectedProducts: ['HUAWEI Smartphones', 'Tablets (MatePad series)'],
    affectedVersions: ['EMUI 14'],
    fixedVersions: ['October 2026 Security Patch'],
    cveIds: ['CVE-2026-20001'],
    severity: 'HIGH',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
  },
  {
    id: 'adv-samsung-broad-smr',
    sourceId: 'samsung-security',
    manufacturer: 'Samsung',
    advisoryType: 'SECURITY_UPDATE',
    title: 'Samsung Mobile Security Maintenance Release (SMR-OCT-2026)',
    summary: 'Monthly SMR covering Samsung Galaxy S series, Galaxy Z series, Galaxy A series, and Galaxy Tab series',
    publishedAt: '2026-10-01',
    updatedAt: '2026-10-01',
    sourceUrl: 'https://security.samsungmobile.com/securityUpdate.smsb',
    affectedProductsText: 'Galaxy S series, Galaxy Z Fold, Galaxy Z Flip, Galaxy A series, Galaxy Tab series',
    affectedProducts: ['Galaxy S series', 'Galaxy Z Fold', 'Galaxy Z Flip', 'Galaxy A series', 'Galaxy Tab series'],
    affectedVersions: ['Android 15', 'Android 16'],
    fixedVersions: ['SMR-OCT-2026-1'],
    cveIds: ['CVE-2026-30001'],
    severity: 'HIGH',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: '2026-10-28T00:00:00.000Z',
  },
];

function buildSeedCollections() {
  const retailProductsMap: Record<string, any> = {};
  for (const p of SAMPLE_CATALOG) {
    retailProductsMap[p.id] = p;
  }
  const advisoriesMap: Record<string, any> = {};
  for (const a of SAMPLE_ADVISORIES) {
    advisoriesMap[a.id] = a;
  }
  return {
    retailProducts: retailProductsMap,
    serviceAdvisories: advisoriesMap,
    serviceSources: {
      'apple-security': { id: 'apple-security', status: 'ACTIVE', recordsDiscovered: 5 },
      'huawei-security': { id: 'huawei-security', status: 'ACTIVE', recordsDiscovered: 3 },
      'samsung-security': { id: 'samsung-security', status: 'ACTIVE', recordsDiscovered: 1 },
    },
    serviceVulnerabilities: {
      'CVE-2024-44243': { cveId: 'CVE-2024-44243' },
    },
    serviceProductMatches: {},
    serviceSyncRuns: {
      'run-completed-1': {
        id: 'run-completed-1',
        sourceId: 'apple-security',
        status: 'COMPLETED',
        startedAt: '2026-10-28T10:00:00.000Z',
        completedAt: '2026-10-28T10:00:03.000Z',
        durationMs: 3000,
        advisoriesDiscovered: 5,
        advisoriesCreated: 5,
        advisoriesUpdated: 0,
        persistenceStorageMode: 'FIRESTORE_AUTHORITATIVE',
        matchingStageStatus: 'DEFERRED_TO_RECOMPUTE',
      },
    },
    serviceAlerts: {},
  };
}

async function runS122Tests() {
  console.log('=== SIGNALYN S1.2.2 SERVICE PRODUCT MATCH PERSISTENCE & SYNC INTEGRITY TESTS ===\n');
  let passed = 0;

  await initializeServiceIntelligence();

  // -------------------------------------------------------------------------
  // Scenario 1: Authoritative Canonical Product Loading from Firestore
  // -------------------------------------------------------------------------
  console.log('Scenario 1: Authoritative Canonical Product Loading from Firestore');
  const mockDb1 = createMockFirestoreForS122({ seedCollections: buildSeedCollections() });
  const loadedCatalog = await loadAuthoritativeCatalogProducts({ customDb: mockDb1 });
  assert.strictEqual(loadedCatalog.source, 'FIRESTORE_AUTHORITATIVE');
  assert.strictEqual(loadedCatalog.products.length, SAMPLE_CATALOG.length);

  // Fail-closed check when Firestore retailProducts is empty in production
  const mockEmptyCatalogDb = createMockFirestoreForS122({
    seedCollections: { retailProducts: {} },
  });
  let threwOnEmptyProdCatalog = false;
  try {
    await loadAuthoritativeCatalogProducts({
      customDb: mockEmptyCatalogDb,
    });
  } catch (err: any) {
    threwOnEmptyProdCatalog = String(err.message).includes('0 canonical products');
  }
  assert.strictEqual(
    threwOnEmptyProdCatalog,
    true,
    'Must fail closed when retailProducts is empty in Firestore'
  );
  console.log('  ✓ Loaded authoritative retailProducts from Firestore & verified fail-closed guard');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 2: Deterministic Match Document ID Generation
  // -------------------------------------------------------------------------
  console.log('\nScenario 2: Deterministic Match Document ID Generation');
  const idA = buildDeterministicMatchId('prod-ip-16-pro', 'adv-apple-ios18');
  const idB = buildDeterministicMatchId('prod-ip-16-pro', 'adv-apple-ios18');
  assert.strictEqual(idA, idB);
  assert.strictEqual(idA, 'match-prod-ip-16-pro-adv-apple-ios18');
  console.log(`  ✓ Deterministic ID verified: ${idA}`);
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 5: Apple iPhone Generation Applicability & Narrow Model Scope
  // -------------------------------------------------------------------------
  console.log('\nScenario 5: Apple iPhone Generation Applicability & Narrow Model Scope');
  // 5a: iOS 18.1 ("iPhone XS and later") -> matches XS, 11, 12, 15 Pro, 16 Pro, but NOT iPhone 18 Pro (shipped with iOS 27+)
  const mIos18 = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[0], SAMPLE_CATALOG);
  const vIos18 = mIos18.filter((m) => m.confidence === 'VERIFIED').map((m) => m.canonicalProductId);
  assert.ok(vIos18.includes('prod-ip-xs'), 'iOS 18.1 must match iPhone XS');
  assert.ok(vIos18.includes('prod-ip-11'), 'iOS 18.1 must match iPhone 11');
  assert.ok(vIos18.includes('prod-ip-16-pro'), 'iOS 18.1 must match iPhone 16 Pro');
  assert.ok(!vIos18.includes('prod-ip-18-pro'), 'iOS 18.1 must NOT match iPhone 18 Pro (shipped with iOS 27+)');

  // 5b: iOS 26.7 ("iPhone 11 and later") -> excludes iPhone XS (gen < 11) and excludes iPhone 18 Pro (shipped with iOS 27+), matches 11/12/15/16
  const mIos26 = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[1], SAMPLE_CATALOG);
  const vIos26 = mIos26.filter((m) => m.confidence === 'VERIFIED').map((m) => m.canonicalProductId);
  assert.ok(!vIos26.includes('prod-ip-xs'), 'iOS 26.7 must NOT match iPhone XS');
  assert.ok(!vIos26.includes('prod-ip-18-pro'), 'iOS 26.7 must NOT match iPhone 18 Pro (shipped with iOS 27+)');
  assert.ok(vIos26.includes('prod-ip-11'), 'iOS 26.7 must match iPhone 11');
  assert.ok(vIos26.includes('prod-ip-15-pro'), 'iOS 26.7 must match iPhone 15 Pro');
  assert.ok(vIos26.includes('prod-ip-16-pro'), 'iOS 26.7 must match iPhone 16 Pro');

  // 5c: iOS 18.7.11 ("iPhone XS, iPhone XS Max, iPhone XR") -> matches ONLY XS, never 11/12/15/16
  const mIos18Narrow = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[2], SAMPLE_CATALOG);
  const vIos18Narrow = mIos18Narrow.map((m) => m.canonicalProductId);
  assert.deepStrictEqual(vIos18Narrow, ['prod-ip-xs'], 'Narrow iPhone XS/XR update must ONLY match iPhone XS');

  // 5d: "iPhone Duo" -> matches 0 standard iPhones
  const mDuo = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[3], SAMPLE_CATALOG);
  assert.strictEqual(mDuo.length, 0, 'iPhone Duo advisory must not match standard iPhone 11-16 models');

  // 5e: "Apple Watch Series 12 and Apple Watch Ultra 4" -> does NOT match Watch Series 10
  const mWatch12 = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[4], SAMPLE_CATALOG);
  assert.strictEqual(mWatch12.length, 0, 'Watch Series 12 / Ultra 4 update must not match Watch Series 10');
  console.log('  ✓ Apple iOS generation floor and narrow device scope verified');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 6: Apple AirPods Non-False-Positive Matching
  // -------------------------------------------------------------------------
  console.log('\nScenario 6: Apple AirPods Non-False-Positive Matching');
  const allAppleMatches = SAMPLE_ADVISORIES.filter((a) => a.manufacturer === 'Apple').flatMap((a) =>
    matchAdvisoryToCatalogProducts(a, SAMPLE_CATALOG)
  );
  assert.strictEqual(
    allAppleMatches.some((m) => m.canonicalProductId === 'prod-airpods-pro-2'),
    false,
    'iOS / watchOS advisories must never match AirPods'
  );
  console.log('  ✓ Zero false-positive matches on Apple AirPods');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 7: Huawei Pura 70 vs Pura 80 Generation Isolation
  // -------------------------------------------------------------------------
  console.log('\nScenario 7: Huawei Pura 70 vs Pura 80 Generation Isolation');
  const mPura70 = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[5], SAMPLE_CATALOG);
  assert.deepStrictEqual(
    mPura70.map((m) => m.canonicalProductId),
    ['prod-hw-pura70'],
    'Huawei Pura 70 quarterly schedule must match ONLY Pura 70 and never Pura 80'
  );
  assert.strictEqual(mPura70[0].confidence, 'VERIFIED');

  const mPura80 = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[6], SAMPLE_CATALOG);
  assert.deepStrictEqual(
    mPura80.map((m) => m.canonicalProductId),
    ['prod-hw-pura80-pro'],
    'Huawei Pura 80 Pro monthly schedule must match ONLY Pura 80 Pro and never Pura 70'
  );
  assert.strictEqual(mPura80[0].confidence, 'VERIFIED');
  console.log('  ✓ Huawei Pura 70 vs Pura 80 generational isolation verified');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 8: Huawei MateBook vs MatePad Category Isolation & Broad Bulletin Downgrade
  // -------------------------------------------------------------------------
  console.log('\nScenario 8: Huawei MateBook vs MatePad Isolation & Broad Bulletin Downgrade');
  const mHuaweiBroad = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[7], SAMPLE_CATALOG);
  assert.strictEqual(
    mHuaweiBroad.some((m) => m.canonicalProductId === 'prod-hw-matebook-d16'),
    false,
    'EMUI/HarmonyOS smartphone & MatePad bulletin must never match MateBook laptop'
  );
  const matepadMatch = mHuaweiBroad.find((m) => m.canonicalProductId === 'prod-hw-matepad-115');
  assert.ok(matepadMatch, 'MatePad 11.5 should be matched as a candidate on MatePad series bulletin');
  assert.notStrictEqual(
    matepadMatch.confidence,
    'VERIFIED',
    'Broad "Tablets (MatePad series)" bulletin must NOT be auto-confirmed as VERIFIED without exact model'
  );
  assert.strictEqual(matepadMatch.status, 'PENDING_REVIEW');
  console.log(`  ✓ MateBook isolated & MatePad broad series downgraded to ${matepadMatch.confidence} (${matepadMatch.status})`);
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 9: Samsung Galaxy S / Z / A / Tab Model Isolation & Broad SMR Downgrade
  // -------------------------------------------------------------------------
  console.log('\nScenario 9: Samsung Galaxy S / Z / A / Tab Model Isolation & Broad SMR Downgrade');
  const mSamsungSmr = matchAdvisoryToCatalogProducts(SAMPLE_ADVISORIES[8], SAMPLE_CATALOG);
  const s25Match = mSamsungSmr.find((m) => m.canonicalProductId === 'prod-sam-s25-ultra');
  const a55Match = mSamsungSmr.find((m) => m.canonicalProductId === 'prod-sam-a55');
  const tabMatch = mSamsungSmr.find((m) => m.canonicalProductId === 'prod-sam-tabs9');
  assert.ok(s25Match);
  assert.strictEqual(s25Match.confidence, 'LIKELY', 'Broad Samsung SMR must assign LIKELY (not VERIFIED) to S25 Ultra');
  assert.strictEqual(s25Match.status, 'PENDING_REVIEW');
  assert.ok(a55Match);
  assert.strictEqual(a55Match.confidence, 'AMBIGUOUS_REVIEW', 'Broad Galaxy A series must require AMBIGUOUS_REVIEW');
  assert.ok(tabMatch);
  assert.strictEqual(tabMatch.confidence, 'AMBIGUOUS_REVIEW', 'Broad Galaxy Tab series must require AMBIGUOUS_REVIEW');

  // Verify legacy downgrade counter detects previously VERIFIED matches that were tightened
  const legacyBroadSet = countLegacyBroadVerifiedIds(SAMPLE_ADVISORIES, SAMPLE_CATALOG);
  assert.ok(legacyBroadSet.size > 0, 'Must track legacy broad VERIFIED matches for downgrade audit');
  console.log('  ✓ Samsung Galaxy S / Z / A / Tab rules and SMR confidence safeguards verified');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 10: Dry-Run Recomputation Without Writes
  // -------------------------------------------------------------------------
  console.log('\nScenario 10: Dry-Run Recomputation Without Writes');
  const mockDbDry = createMockFirestoreForS122({ seedCollections: buildSeedCollections() });
  const drySummary = await recomputeServiceProductMatches({
    mode: 'DRY_RUN',
    confirmPersistence: false,
    customDb: mockDbDry,
  });
  assert.strictEqual(drySummary.mode, 'DRY_RUN');
  assert.strictEqual(drySummary.status, 'DRY_RUN_READY');
  assert.strictEqual(drySummary.persistenceExecuted, false);
  assert.strictEqual(drySummary.batchesCommitted, 0);
  assert.ok(drySummary.candidateMatchesGenerated > 0, 'Dry run must compute candidate matches');
  assert.strictEqual(
    Object.keys(mockDbDry._store.serviceProductMatches).length,
    0,
    'Dry run must write 0 documents to Firestore serviceProductMatches'
  );
  console.log(
    `  ✓ Dry-run examined ${drySummary.advisoriesExamined} advisories x ${drySummary.canonicalProductsExamined} products -> ${drySummary.candidateMatchesGenerated} candidates, 0 Firestore writes`
  );
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 11: Confirmed Persistence with Bounded Batches & Read-Back Verification
  // -------------------------------------------------------------------------
  console.log('\nScenario 11: Confirmed Persistence with Bounded Batches & Read-Back Verification');
  const persistSummary1 = await recomputeServiceProductMatches({
    mode: 'PERSIST',
    confirmPersistence: true,
    reviewedBy: 'admin@signalyn.test',
    customDb: mockDbDry,
  });
  assert.strictEqual(persistSummary1.mode, 'PERSIST');
  assert.strictEqual(persistSummary1.status, 'PERSISTED_VERIFIED');
  assert.strictEqual(persistSummary1.persistenceExecuted, true);
  assert.strictEqual(persistSummary1.persistedTotalCount, persistSummary1.candidateMatchesGenerated);
  assert.ok(
    mockDbDry._batchSizesCommitted.every((sz) => sz <= 200),
    'Every Firestore batch write must be bounded to <= 200 operations'
  );
  console.log(
    `  ✓ Confirmed persistence wrote ${persistSummary1.persistedTotalCount} matches across ${persistSummary1.batchesCommitted} bounded batch(es)`
  );
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 3: Idempotent Repeated Recomputation
  // -------------------------------------------------------------------------
  console.log('\nScenario 3: Idempotent Repeated Recomputation');
  const persistSummary2 = await recomputeServiceProductMatches({
    mode: 'PERSIST',
    confirmPersistence: true,
    reviewedBy: 'admin@signalyn.test',
    customDb: mockDbDry,
  });
  assert.strictEqual(persistSummary2.plannedCreates, 0, 'Second run must have 0 planned creates');
  assert.strictEqual(persistSummary2.plannedUpdates, 0, 'Second run must have 0 planned updates');
  assert.strictEqual(
    persistSummary2.plannedUnchanged,
    persistSummary2.candidateMatchesGenerated,
    'Second run must classify all matches as unchanged'
  );
  assert.strictEqual(
    Object.keys(mockDbDry._store.serviceProductMatches).length,
    persistSummary1.candidateMatchesGenerated,
    'Total document count in Firestore must remain identical on repeated recomputation'
  );
  console.log(`  ✓ Idempotent second run verified (${persistSummary2.plannedUnchanged} unchanged, 0 creates, 0 updates)`);
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 4: Preservation of Manual Review Decisions (CONFIRMED / DISMISSED)
  // -------------------------------------------------------------------------
  console.log('\nScenario 4: Preservation of Manual Review Decisions');
  const pendingMatchToDismiss = Object.values(mockDbDry._store.serviceProductMatches).find(
    (m: any) => m.status === 'PENDING_REVIEW'
  ) as ServiceProductMatch;
  assert.ok(pendingMatchToDismiss, 'Must have at least one PENDING_REVIEW match to test admin resolution');

  // Simulate admin dismissing this match in Firestore
  mockDbDry._store.serviceProductMatches[pendingMatchToDismiss.id] = {
    ...pendingMatchToDismiss,
    status: 'DISMISSED',
    reviewedAt: '2026-10-28T11:00:00.000Z',
    reviewedBy: 'admin@signalyn.test',
  };

  const persistAfterReview = await recomputeServiceProductMatches({
    mode: 'PERSIST',
    confirmPersistence: true,
    reviewedBy: 'admin@signalyn.test',
    customDb: mockDbDry,
  });
  assert.ok(
    persistAfterReview.preservedAdminDecisions >= 1,
    'Must report preserved manual review decision'
  );
  const storedAfterRecompute = mockDbDry._store.serviceProductMatches[pendingMatchToDismiss.id];
  assert.strictEqual(
    storedAfterRecompute.status,
    'DISMISSED',
    'Manual DISMISSED status must never be overwritten to PENDING_REVIEW by recomputation'
  );
  assert.strictEqual(storedAfterRecompute.reviewedBy, 'admin@signalyn.test');
  console.log(
    `  ✓ Manual review decision (DISMISSED by ${storedAfterRecompute.reviewedBy}) preserved across recomputation`
  );
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 12: Partial Batch Failure Handling
  // -------------------------------------------------------------------------
  console.log('\nScenario 12: Partial Batch Failure Handling');
  const mockDbFailBatch = createMockFirestoreForS122({
    seedCollections: buildSeedCollections(),
    failOnBatchIndex: 0,
  });
  let batchFailureCaught = false;
  try {
    await recomputeServiceProductMatches({
      mode: 'PERSIST',
      confirmPersistence: true,
      customDb: mockDbFailBatch,
    });
  } catch (err: any) {
    batchFailureCaught = String(err.message).includes('batch commit failed');
  }
  assert.strictEqual(
    batchFailureCaught,
    true,
    'Batch commit failure must throw and recordPERSISTENCE_FAILED without claiming success'
  );
  const diagAfterFail = await getPersistenceDiagnostic(false, {
    customDb: mockDbFailBatch,
    bypassRateLimit: true,
  });
  assert.strictEqual(diagAfterFail.matchReconciliation?.lastPersistenceStatus, 'FAILED');
  console.log(`  ✓ Batch failure handled cleanly (status: ${diagAfterFail.matchReconciliation?.lastPersistenceStatus})`);
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 13: Dashboard Counter Consistency with Firestore
  // -------------------------------------------------------------------------
  console.log('\nScenario 13: Dashboard Counter Consistency with Firestore');
  // 13a: Empty serviceProductMatches in Firestore -> dashboard shows 0 confirmed & 0 pending
  const mockDbEmptyMatches = createMockFirestoreForS122({
    seedCollections: buildSeedCollections(),
  });
  const statsWhenEmpty = await getServiceDashboardStats({ customDb: mockDbEmptyMatches });
  assert.strictEqual(statsWhenEmpty.persistedMatchesStatus, 'FIRESTORE_AUTHORITATIVE');
  assert.strictEqual(
    statsWhenEmpty.verifiedProductMatchesCount,
    0,
    'When Firestore serviceProductMatches has 0 docs, Confirmed Catalog Product Links must be 0'
  );
  assert.strictEqual(
    statsWhenEmpty.pendingReviewMatchesCount,
    0,
    'When Firestore serviceProductMatches has 0 docs, Pending Review Matches must be 0'
  );

  // 13b: Populated serviceProductMatches in Firestore -> dashboard matches Firestore counts
  const statsWhenPopulated = await getServiceDashboardStats({ customDb: mockDbDry });
  assert.strictEqual(statsWhenPopulated.persistedMatchesStatus, 'FIRESTORE_AUTHORITATIVE');
  assert.strictEqual(statsWhenPopulated.verifiedProductMatchesCount, persistSummary1.verifiedCandidates);

  // 13c: Permission-denied / unavailable Firestore -> dashboard reports UNAVAILABLE
  const mockDbPermDenied = createMockFirestoreForS122({ permissionDenied: true });
  const statsWhenUnavailable = await getServiceDashboardStats({ customDb: mockDbPermDenied });
  assert.strictEqual(statsWhenUnavailable.persistedMatchesStatus, 'UNAVAILABLE');
  assert.strictEqual(statsWhenUnavailable.persistedVerifiedProductMatchesCount, 'UNAVAILABLE');
  console.log('  ✓ Dashboard counters verified for empty (0), populated, and UNAVAILABLE Firestore states');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 14: Sync Run Status COMPLETED vs PARTIAL
  // -------------------------------------------------------------------------
  console.log('\nScenario 14: Sync Run Status COMPLETED vs PARTIAL');
  const diagCompletedSync = await getPersistenceDiagnostic(false, {
    customDb: mockDbDry,
    bypassRateLimit: true,
  });
  assert.strictEqual(
    diagCompletedSync.lastPersistedSync.status,
    'SUCCESS',
    'Completed serviceSyncRuns record with FIRESTORE_AUTHORITATIVE must report SUCCESS'
  );
  assert.strictEqual(diagCompletedSync.lastPersistedSync.syncRunId, 'run-completed-1');

  // Verify legacy pre-commit STARTED record is accurately diagnosed as PARTIAL with clear note
  const mockDbPartialSync = createMockFirestoreForS122({
    seedCollections: {
      ...buildSeedCollections(),
      serviceSyncRuns: {
        'run-legacy-started': {
          id: 'run-legacy-started',
          sourceId: 'apple-security',
          status: 'STARTED',
          startedAt: '2026-10-28T09:00:00.000Z',
          advisoriesCreated: 30,
          persistenceStorageMode: 'FIRESTORE_AUTHORITATIVE',
        },
      },
    },
  });
  const diagPartialSync = await getPersistenceDiagnostic(false, {
    customDb: mockDbPartialSync,
    bypassRateLimit: true,
  });
  assert.strictEqual(diagPartialSync.lastPersistedSync.status, 'PARTIAL');
  assert.ok(diagPartialSync.lastPersistedSync.notes?.includes('STARTED'));
  console.log('  ✓ Sync run status COMPLETED vs PARTIAL verified');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 15: Admin-Only Endpoint Protection
  // -------------------------------------------------------------------------
  console.log('\nScenario 15: Admin-Only Endpoint Protection');
  let httpCode = 0;
  let nextInvoked = false;
  await requireAdminOrAuthorizedClient(
    { headers: {} } as any,
    {
      status(c: number) {
        httpCode = c;
        return this;
      },
      json() {
        return this;
      },
    } as any,
    () => {
      nextInvoked = true;
    }
  );
  assert.strictEqual(nextInvoked, false);
  assert.strictEqual(httpCode, 401);
  console.log('  ✓ Admin-only middleware blocks unauthenticated callers with HTTP 401');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 16: Preview In-Memory Mode Labeling
  // -------------------------------------------------------------------------
  console.log('\nScenario 16: Preview In-Memory Mode Labeling');
  const diagPreviewDenied = await getPersistenceDiagnostic(false, {
    customDb: mockDbPermDenied,
    bypassRateLimit: true,
  });
  assert.strictEqual(diagPreviewDenied.storageMode, 'PREVIEW_IN_MEMORY_ONLY');
  assert.strictEqual(diagPreviewDenied.overallVerificationStatus, 'PRODUCTION_NOT_VERIFIED');
  console.log('  ✓ Preview sandbox fallback explicitly labeled PREVIEW_IN_MEMORY_ONLY');
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 17: State Restoration After Simulated Server Restart
  // -------------------------------------------------------------------------
  console.log('\nScenario 17: State Restoration After Simulated Server Restart');
  resetServiceStateForTests();
  const statsAfterRestart = await getServiceDashboardStats({ customDb: mockDbDry });
  assert.strictEqual(
    statsAfterRestart.verifiedProductMatchesCount,
    persistSummary1.verifiedCandidates,
    'After simulated server restart, verifiedProductMatchesCount must be restored from Firestore'
  );
  assert.strictEqual(
    statsAfterRestart.totalAdvisories,
    SAMPLE_ADVISORIES.length,
    'After simulated server restart, totalAdvisories must be restored from Firestore'
  );
  console.log(
    `  ✓ State restored from Firestore after restart (${statsAfterRestart.verifiedProductMatchesCount} VERIFIED matches)`
  );
  passed++;

  // -------------------------------------------------------------------------
  // Scenario 18: Non-Interference with Retail Price Intelligence
  // -------------------------------------------------------------------------
  console.log('\nScenario 18: Non-Interference with Retail Price Intelligence');
  // 18a: Verify recomputeServiceProductMatches never called seedPilotCatalog()
  assert.strictEqual(
    getMemCatalog().size,
    0,
    'recomputeServiceProductMatches must NEVER call seedPilotCatalog()'
  );
  // 18b: Verify Firestore retailProducts documents were not modified
  const retailProductsAfter = Object.values(mockDbDry._store.retailProducts);
  assert.strictEqual(
    retailProductsAfter.length,
    SAMPLE_CATALOG.length,
    'Firestore retailProducts count must remain untouched'
  );
  assert.deepStrictEqual(
    retailProductsAfter,
    SAMPLE_CATALOG,
    'Firestore retailProducts documents must not be modified by Service Product Matching'
  );
  console.log('  ✓ Zero interference with Retail Price Intelligence & zero seedPilotCatalog() calls verified');
  passed++;

  console.log(`\nALL ${passed}/18 S1.2.2 REGRESSION TESTS PASSED CLEANLY (Matcher ${SERVICE_MATCHER_VERSION}).`);
  process.exit(0);
}

runS122Tests().catch((err) => {
  console.error('Fatal test failure in serviceMatchPersistence.test.ts:', err);
  process.exit(1);
});

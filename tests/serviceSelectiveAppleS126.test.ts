/**
 * Signalyn S1.2.6 — Selective Apple Advisory Reprocessing & Production Quality Gate Closure Tests
 *
 * Covers:
 * 1. Phase 1 verification of the exact 102-advisory production state (38 Apple, 13 Huawei, 10 Samsung,
 *    41 CISA KEV; 7 stale pre-S1.2.5 Apple zero-CVE records; 1 Apple advisory missing detail CVEs;
 *    780 candidate matches: 278 VERIFIED, 292 LIKELY, 210 AMBIGUOUS_REVIEW).
 * 2. Phase 2 read-only DRY_RUN preview (zero Firestore writes, preserves all advisory IDs,
 *    zero changes to Huawei/Samsung/CISA KEV/NIST NVD).
 * 3. Phase 2 missing-CVE evidence safeguard (never fabricates CVEs when official Apple page is
 *    unreachable or lacks CVE evidence; retains NEEDS_REVIEW status).
 * 4. Phase 2/3/4 PERSIST execution with admin confirmation, snapshot hash guard, Firestore read-back
 *    verification, idempotency on second run, 12/12 Quality Gate PASS closure, and 780 -> 686
 *    candidate match reconciliation stability with 0 persisted product matches.
 */

import { initializeApp as initClientApp, getApps, getApp } from 'firebase/app';
import { getFirestore as getClientFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { TARGET_DATABASE_ID } from '../src/server/firestoreAdmin';
import {
  ServiceAdvisory,
  ServiceProductMatch,
  ServiceSource,
  ServiceSyncRun,
  ServiceVulnerability,
} from '../src/types/serviceIntelligence';
import { RetailProduct } from '../src/types/retailPrice';
import {
  fetchAppleSecurityReleases,
  cleanAppleReleaseTitle,
} from '../src/server/service/adapters/appleSecurityAdapter';
import { fetchHuaweiSecurityBulletins } from '../src/server/service/adapters/huaweiSecurityAdapter';
import { fetchSamsungSecurityBulletins } from '../src/server/service/adapters/samsungSecurityAdapter';
import { fetchCisaKevFeed } from '../src/server/service/adapters/cisaKevAdapter';
import {
  reprocessSelectiveAppleAdvisories,
  recomputeServiceProductMatches,
  getMatchEvidenceReview,
  getPersistenceDiagnostic,
  resetServiceStateForTests,
} from '../src/server/service/servicePipelineService';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function createMockProductionFirestore(seed: {
  advisories: ServiceAdvisory[];
  products: RetailProduct[];
  vulnerabilities?: ServiceVulnerability[];
  sources?: ServiceSource[];
  matches?: ServiceProductMatch[];
  syncRuns?: ServiceSyncRun[];
}) {
  const cols: Record<string, Map<string, any>> = {
    serviceAdvisories: new Map(seed.advisories.map((a) => [a.id, structuredClone(a)])),
    retailProducts: new Map(seed.products.map((p) => [p.id, structuredClone(p)])),
    serviceVulnerabilities: new Map(
      (seed.vulnerabilities || []).map((v) => [v.cveId, structuredClone(v)]),
    ),
    serviceSources: new Map((seed.sources || []).map((s) => [s.id, structuredClone(s)])),
    serviceProductMatches: new Map((seed.matches || []).map((m) => [m.id, structuredClone(m)])),
    serviceSyncRuns: new Map((seed.syncRuns || []).map((r) => [r.id, structuredClone(r)])),
    serviceAlerts: new Map(),
    _serviceDiagnostics: new Map(),
  };

  let batchCommitCount = 0;
  let totalDocumentsWritten = 0;

  const getColMap = (name: string) => {
    if (!cols[name]) cols[name] = new Map();
    return cols[name];
  };

  const makeCollectionRef = (name: string) => {
    const map = getColMap(name);
    return {
      get: async () => {
        const docs = Array.from(map.entries()).map(([id, val]) => ({
          id,
          exists: true,
          data: () => structuredClone(val),
        }));
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
        };
      },
      count: () => ({
        get: async () => ({
          data: () => ({
            count: Array.from(map.keys()).filter((k) => !k.startsWith('_diag_probe_')).length,
          }),
        }),
      }),
      limit: (n: number) => ({
        get: async () => {
          const docs = Array.from(map.entries())
            .slice(0, n)
            .map(([id, val]) => ({
              id,
              exists: true,
              data: () => structuredClone(val),
            }));
          return { empty: docs.length === 0, size: docs.length, docs };
        },
      }),
      orderBy: () => ({
        limit: (n: number) => ({
          get: async () => {
            const docs = Array.from(map.entries())
              .slice(0, n)
              .map(([id, val]) => ({
                id,
                exists: true,
                data: () => structuredClone(val),
              }));
            return { empty: docs.length === 0, size: docs.length, docs };
          },
        }),
      }),
      doc: (docId: string) => ({
        id: docId,
        get: async () => {
          const exists = map.has(docId);
          const val = map.get(docId);
          return {
            id: docId,
            exists,
            data: () => (exists ? structuredClone(val) : undefined),
          };
        },
        set: async (data: any, opts?: { merge?: boolean }) => {
          totalDocumentsWritten++;
          const prev = map.get(docId) || {};
          map.set(
            docId,
            opts?.merge ? { ...structuredClone(prev), ...structuredClone(data) } : structuredClone(data),
          );
        },
        delete: async () => {
          map.delete(docId);
        },
      }),
    };
  };

  return {
    cols,
    getStats: () => ({ batchCommitCount, totalDocumentsWritten }),
    resetWriteStats: () => {
      batchCommitCount = 0;
      totalDocumentsWritten = 0;
    },
    collection: (name: string) => makeCollectionRef(name),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: any, opts?: { merge?: boolean }) => {
          ops.push(() => {
            for (const [, map] of Object.entries(cols)) {
              // Resolve collection map by matching doc ref closure
            }
          });
          // Bind directly via ref.set in commit
          (ops as any)._refOps = (ops as any)._refOps || [];
          (ops as any)._refOps.push({ ref, data, opts });
        },
        commit: async () => {
          batchCommitCount++;
          const refOps = (ops as any)._refOps || [];
          for (const item of refOps) {
            await item.ref.set(item.data, item.opts);
          }
        },
      };
    },
  };
}

async function buildAuthoritative102ProductionDataset(): Promise<{
  advisories102: ServiceAdvisory[];
  products326: RetailProduct[];
  vulnerabilities41: ServiceVulnerability[];
}> {
  // 1. Load the 326 canonical products from authoritative Firestore retailProducts
  const app = getApps().length === 0 ? initClientApp(firebaseConfig) : getApp();
  const clientDb = getClientFirestore(app, TARGET_DATABASE_ID);
  const prodSnap = await getDocs(collection(clientDb, 'retailProducts'));
  const products326 = prodSnap.docs
    .filter((d) => !d.id.startsWith('_diag_probe_'))
    .map((d) => ({ ...(d.data() as any), id: d.id } as RetailProduct));

  // 2. Fetch live official sources to reconstruct the exact 102-advisory production dataset
  const [apple31, huawei, samsung, cisa] = await Promise.all([
    fetchAppleSecurityReleases({ maxReleases: 31, timeoutMs: 20000 }),
    fetchHuaweiSecurityBulletins({ maxBulletins: 10, timeoutMs: 20000 }),
    fetchSamsungSecurityBulletins({ maxBulletins: 10, timeoutMs: 20000 }),
    fetchCisaKevFeed({ maxRecords: 41, timeoutMs: 20000 }),
  ]);

  // Pre-S1.2.5 had rows 2..31 (30 Apple advisories), where the 7 zero-CVE releases had dirty IDs/titles
  // and row #31 (adv-apple-xcode-27-20260914) had cveIds: [] from the pre-S1.2.5 index-only scrape.
  // Then S1.2.5 synced rows 1..30 (adding 7 clean-slug zero-CVE advisories + Xcode 27.2, while leaving
  // row #31 Xcode 27 untouched with cveIds: []).
  const preS125Apple30 = apple31.advisories.slice(1, 31).map((a) => {
    const rawTitle = a.isZeroCveRelease
      ? `${a.title} This update has no published CVE entries.`
      : a.title;
    const oldSlug = rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const dateDigits = a.publishedAt.replace(/[^0-9]/g, '');
    const oldId = `adv-apple-${oldSlug}-${dateDigits}`;
    return {
      ...a,
      id: oldId,
      title: rawTitle,
      cveIds: [],
      isZeroCveRelease: undefined,
      severity: 'HIGH' as const,
    };
  });

  const s125Apple30 = apple31.advisories.slice(0, 30);
  const mergedAppleMap = new Map<string, ServiceAdvisory>();
  for (const a of preS125Apple30) mergedAppleMap.set(a.id, a);
  for (const a of s125Apple30) mergedAppleMap.set(a.id, a);

  const advisories102: ServiceAdvisory[] = [
    ...Array.from(mergedAppleMap.values()),
    ...huawei.advisories,
    ...samsung.advisories,
    ...cisa.advisories,
  ];

  return {
    advisories102,
    products326,
    vulnerabilities41: cisa.vulnerabilities,
  };
}

async function runTests() {
  console.log('=== SIGNALYN S1.2.6 — SELECTIVE APPLE REPROCESSING & QUALITY GATE TESTS ===');
  resetServiceStateForTests();

  const { advisories102, products326, vulnerabilities41 } =
    await buildAuthoritative102ProductionDataset();

  const mockDb = createMockProductionFirestore({
    advisories: advisories102,
    products: products326,
    vulnerabilities: vulnerabilities41,
  });

  // ---------------------------------------------------------------------------
  // TEST 1: Verify Phase 1 Production Findings on the 102-Advisory Dataset
  // ---------------------------------------------------------------------------
  console.log('\n[Test 1] Verifying Phase 1 production state (102 advisories, 780 matches, 7 stale + 1 missing CVE)...');
  const dryRunReport = await reprocessSelectiveAppleAdvisories({
    mode: 'DRY_RUN',
    confirmPersistence: false,
    customDb: mockDb,
  });

  assert(
    dryRunReport.beforeMetrics.totalAdvisories === 102,
    `Expected 102 total advisories before reprocessing, got ${dryRunReport.beforeMetrics.totalAdvisories}`,
  );
  assert(
    dryRunReport.totalAppleAdvisoriesExamined === 38,
    `Expected 38 Apple advisories examined, got ${dryRunReport.totalAppleAdvisoriesExamined}`,
  );
  assert(
    dryRunReport.beforeMetrics.appleStalePreS125Count === 7,
    `Expected 7 stale pre-S1.2.5 Apple records, got ${dryRunReport.beforeMetrics.appleStalePreS125Count}`,
  );
  assert(
    dryRunReport.beforeMetrics.appleMissingDetailCvesCount === 1,
    `Expected 1 Apple advisory missing detail CVEs (adv-apple-xcode-27-20260914), got ${dryRunReport.beforeMetrics.appleMissingDetailCvesCount}`,
  );
  assert(
    dryRunReport.beforeMetrics.appleRequiresReprocessingCount === 8,
    `Expected 8 Apple advisories flagged in schema audit, got ${dryRunReport.beforeMetrics.appleRequiresReprocessingCount}`,
  );
  assert(
    dryRunReport.beforeMetrics.duplicateGroupsCount === 7,
    `Expected 7 duplicate Apple zero-CVE groups before reprocessing, got ${dryRunReport.beforeMetrics.duplicateGroupsCount}`,
  );
  assert(
    dryRunReport.beforeMetrics.candidateMatchesTotal === 780 &&
      dryRunReport.beforeMetrics.verifiedCandidates === 278 &&
      dryRunReport.beforeMetrics.likelyCandidates === 292 &&
      dryRunReport.beforeMetrics.ambiguousReviewCandidates === 210,
    `Expected 780 (278/292/210) candidate matches before reprocessing, got ${dryRunReport.beforeMetrics.candidateMatchesTotal} (${dryRunReport.beforeMetrics.verifiedCandidates}/${dryRunReport.beforeMetrics.likelyCandidates}/${dryRunReport.beforeMetrics.ambiguousReviewCandidates})`,
  );
  console.log('  -> PASS: Exact Phase 1 production metrics verified (102 advisories, 7 stale, 1 missing CVE, 780 matches).');

  // ---------------------------------------------------------------------------
  // TEST 2: Verify Read-Only DRY_RUN Guarantees (Zero Firestore Writes & ID Preservation)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying DRY_RUN mode performs zero Firestore writes and preserves all advisory IDs...');
  const writeStatsAfterDryRun = mockDb.getStats();
  assert(
    writeStatsAfterDryRun.batchCommitCount === 0 && writeStatsAfterDryRun.totalDocumentsWritten === 0,
    `Expected 0 Firestore writes during DRY_RUN, got ${writeStatsAfterDryRun.totalDocumentsWritten}`,
  );
  assert(
    dryRunReport.mode === 'DRY_RUN' && dryRunReport.status === 'DRY_RUN_PREVIEW_READY',
    `Expected DRY_RUN_PREVIEW_READY, got ${dryRunReport.status}`,
  );
  assert(
    dryRunReport.nonAppleRecordsTouchedCount === 0,
    'Expected 0 non-Apple records touched',
  );
  for (const rc of dryRunReport.recordChanges) {
    assert(rc.preservedExistingId === true, `Advisory ID must be preserved for ${rc.advisoryId}`);
    assert(rc.advisoryId.startsWith('adv-apple-'), `Only Apple advisories may be targeted: ${rc.advisoryId}`);
  }
  const xcodeChange = dryRunReport.recordChanges.find(
    (r) => r.advisoryId === 'adv-apple-xcode-27-20260914',
  );
  assert(
    Boolean(xcodeChange) &&
      xcodeChange!.actionTaken === 'EXTRACT_OFFICIAL_DETAIL_CVES' &&
      xcodeChange!.after.cveIds.length === 5 &&
      xcodeChange!.after.cveIds.includes('CVE-2026-65393'),
    `Expected adv-apple-xcode-27-20260914 to extract 5 official CVEs from support.apple.com/en-us/149040, got ${JSON.stringify(xcodeChange?.after.cveIds)}`,
  );
  console.log('  -> PASS: DRY_RUN preview verified with 0 writes and 5 official CVEs extracted for Xcode 27.');

  // ---------------------------------------------------------------------------
  // TEST 3: Missing CVE Evidence Safeguard (Never Fabricate CVEs on Unreachable Page)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying missing-evidence safeguard when official Apple detail page is unreachable...');
  const unreachableFetch: typeof fetch = async () =>
    new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });

  const insufficientReport = await reprocessSelectiveAppleAdvisories({
    mode: 'DRY_RUN',
    confirmPersistence: false,
    includeMetadataNormalization: false,
    customDb: mockDb,
    customFetch: unreachableFetch,
  });

  const xcodeInsufficient = insufficientReport.recordChanges.find(
    (r) => r.advisoryId === 'adv-apple-xcode-27-20260914',
  );
  assert(
    xcodeInsufficient?.actionTaken === 'RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE' &&
      xcodeInsufficient.after.cveIds.length === 0 &&
      insufficientReport.insufficientEvidenceRetainedCount === 1,
    `Expected adv-apple-xcode-27-20260914 to retain cveIds: [] and RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE when detail page returns 503`,
  );
  assert(
    insufficientReport.afterMetrics.appleMissingDetailCvesCount === 1 &&
      insufficientReport.afterMetrics.qualityGateOverallStatus === 'NEEDS_REVIEW',
    'Expected Quality Gate to remain NEEDS_REVIEW when official CVE evidence cannot be retrieved',
  );
  console.log('  -> PASS: Missing-evidence safeguard verified (0 fabricated CVEs; retains NEEDS_REVIEW).');

  // ---------------------------------------------------------------------------
  // TEST 4: Snapshot Hash Mismatch Guard on PERSIST
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying stale snapshot hash guard blocks unauthorized/stale PERSIST...');
  let staleBlocked = false;
  try {
    await reprocessSelectiveAppleAdvisories({
      mode: 'PERSIST',
      confirmPersistence: true,
      expectedSnapshotHash: 'snap-s123-stale-invalid',
      customDb: mockDb,
    });
  } catch (err: any) {
    if (String(err?.message || err).includes('STALE_REPROCESS_SNAPSHOT')) {
      staleBlocked = true;
    }
  }
  assert(staleBlocked, 'Expected stale expectedSnapshotHash to be blocked with STALE_REPROCESS_SNAPSHOT');
  console.log('  -> PASS: Stale snapshot hash guard verified.');

  // ---------------------------------------------------------------------------
  // TEST 5: Execute Selective Apple Reprocessing PERSIST & Verify Quality Gate Closure
  // ---------------------------------------------------------------------------
  console.log('\n[Test 5] Executing confirmed PERSIST and verifying Firestore read-back, 12/12 Quality Gate PASS, and 686 match reconciliation...');
  mockDb.resetWriteStats();

  const persistReport = await reprocessSelectiveAppleAdvisories({
    mode: 'PERSIST',
    confirmPersistence: true,
    expectedSnapshotHash: dryRunReport.snapshotHashBefore,
    customDb: mockDb,
  });

  assert(
    persistReport.status === 'PERSISTED_AND_VERIFIED' && persistReport.readBackVerified === true,
    `Expected PERSISTED_AND_VERIFIED with readBackVerified=true, got ${persistReport.status}`,
  );
  assert(
    persistReport.totalAdvisoriesInStore === 102 &&
      persistReport.activeAppleAdvisoriesAfter === 31 &&
      persistReport.supersededAppleAdvisoriesAfter === 7,
    `Expected 102 total advisories (31 active Apple, 7 superseded Apple), got ${persistReport.totalAdvisoriesInStore} (${persistReport.activeAppleAdvisoriesAfter} active, ${persistReport.supersededAppleAdvisoriesAfter} superseded)`,
  );
  assert(
    persistReport.afterMetrics.appleStalePreS125Count === 0 &&
      persistReport.afterMetrics.appleMissingDetailCvesCount === 0 &&
      persistReport.afterMetrics.appleRequiresReprocessingCount === 0 &&
      persistReport.afterMetrics.duplicateGroupsCount === 0,
    `Expected 0 stale Apple records, 0 missing detail CVEs, and 0 duplicate groups after persistence, got ${JSON.stringify(persistReport.afterMetrics)}`,
  );
  assert(
    persistReport.afterMetrics.qualityGateOverallStatus === 'PASS' &&
      persistReport.afterMetrics.qualityGatePassCount === 12 &&
      persistReport.afterMetrics.qualityGateNeedsReviewCount === 0 &&
      persistReport.afterMetrics.qualityGateBlockedCount === 0,
    `Expected 12 PASS / 0 NEEDS_REVIEW / 0 BLOCKED after persistence, got ${persistReport.afterMetrics.qualityGatePassCount} PASS / ${persistReport.afterMetrics.qualityGateNeedsReviewCount} NEEDS_REVIEW / ${persistReport.afterMetrics.qualityGateBlockedCount} BLOCKED`,
  );
  assert(
    persistReport.afterMetrics.candidateMatchesTotal === 686 &&
      persistReport.afterMetrics.verifiedCandidates === 278 &&
      persistReport.afterMetrics.likelyCandidates === 198 &&
      persistReport.afterMetrics.ambiguousReviewCandidates === 210,
    `Expected candidate matches to reconcile from 780 -> 686 (278 VERIFIED, 198 LIKELY, 210 AMBIGUOUS_REVIEW), got ${persistReport.afterMetrics.candidateMatchesTotal} (${persistReport.afterMetrics.verifiedCandidates}/${persistReport.afterMetrics.likelyCandidates}/${persistReport.afterMetrics.ambiguousReviewCandidates})`,
  );
  assert(
    mockDb.cols.serviceProductMatches.size === 0,
    `Expected 0 persisted product matches in serviceProductMatches (no automatic bulk match persistence), got ${mockDb.cols.serviceProductMatches.size}`,
  );
  console.log('  -> PASS: PERSIST verified (12/12 Quality Gate PASS, 686 candidate matches, 0 persisted product matches).');

  // ---------------------------------------------------------------------------
  // TEST 6: Verify Idempotency on Second Run & Non-Apple Data Untouched
  // ---------------------------------------------------------------------------
  console.log('\n[Test 6] Verifying idempotency on second run and zero unintended changes to Huawei/Samsung/CISA/NIST...');
  mockDb.resetWriteStats();
  const secondRun = await reprocessSelectiveAppleAdvisories({
    mode: 'PERSIST',
    confirmPersistence: true,
    customDb: mockDb,
  });
  assert(
    secondRun.status === 'NO_CHANGES_REQUIRED' &&
      secondRun.recordsPlannedForUpdateCount === 0 &&
      secondRun.recordsPersistedCount === 0 &&
      mockDb.getStats().totalDocumentsWritten === 0,
    `Expected second run to be 100% idempotent with 0 writes, got status=${secondRun.status}, writes=${mockDb.getStats().totalDocumentsWritten}`,
  );

  // Verify Huawei (13), Samsung (10), CISA KEV (41) in mockDb are byte-for-byte identical to initial seed
  for (const origAdv of advisories102) {
    if (origAdv.sourceId !== 'apple-security') {
      const currentAdv = mockDb.cols.serviceAdvisories.get(origAdv.id);
      assert(
        JSON.stringify(currentAdv) === JSON.stringify(origAdv),
        `Non-Apple advisory ${origAdv.id} (${origAdv.sourceId}) was modified!`,
      );
    }
  }
  console.log('  -> PASS: Second run is 100% idempotent (0 writes) and Huawei/Samsung/CISA KEV records are byte-for-byte untouched.');

  // ---------------------------------------------------------------------------
  // TEST 7: Verify Match Evidence Review & Production Diagnostics Alignment Post-S1.2.6
  // ---------------------------------------------------------------------------
  console.log('\n[Test 7] Verifying getMatchEvidenceReview and getPersistenceDiagnostic alignment post-S1.2.6...');
  const reviewAfter = await getMatchEvidenceReview({
    customDb: mockDb,
    reuseSnapshotIfValid: true,
  });
  const diagAfter = await getPersistenceDiagnostic(false, {
    customDb: mockDb,
    bypassRateLimit: true,
  });

  assert(
    reviewAfter.candidates.length === 686 &&
      reviewAfter.verifiedCountInSnapshot === 278 &&
      reviewAfter.likelyCountInSnapshot === 198 &&
      reviewAfter.ambiguousCountInSnapshot === 210,
    `Expected Match Evidence Inspector to load 686 candidates (278/198/210), got ${reviewAfter.candidates.length}`,
  );
  assert(
    reviewAfter.s125IntegrityAudit?.qualityGate12Check.overallStatus === 'PASS' &&
      reviewAfter.s125IntegrityAudit?.qualityGate12Check.passCount === 12,
    'Expected Match Evidence Review S1.2.5/S1.2.6 12-check Quality Gate to be PASS (12/12)',
  );
  assert(
    diagAfter.subsystemStatuses?.qualityGateStatus === 'PASS' &&
      diagAfter.reconciledCounters?.totalPersistedAdvisories === 102 &&
      diagAfter.reconciledCounters?.activeAdvisoriesCount === 95,
    `Expected Production Diagnostics to report qualityGateStatus=PASS, totalPersistedAdvisories=102, activeAdvisoriesCount=95, got ${JSON.stringify(diagAfter.subsystemStatuses)} / ${JSON.stringify(diagAfter.reconciledCounters)}`,
  );
  console.log('  -> PASS: Match Evidence Inspector and Production Diagnostics are 100% aligned.');

  console.log('\n=== ALL S1.2.6 SELECTIVE APPLE REPROCESSING & QUALITY GATE TESTS PASSED ===');
}

runTests().catch((err) => {
  console.error('S1.2.6 Test Suite Failed:', err);
  process.exit(1);
});

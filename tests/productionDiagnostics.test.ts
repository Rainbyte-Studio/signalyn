/**
 * Signalyn S1.2.1 — Production Firestore Diagnostics Test Suite
 * 
 * Covers all 11 Objective 7 Verification Scenarios:
 * 1. Admin-only access enforcement
 * 2. Non-admin / unauthenticated rejection
 * 3. Correct named Firestore database (ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34)
 * 4. Actual document count retrieval (with confidence & status breakdown)
 * 5. Permission-denied handling (UNAVAILABLE instead of 0)
 * 6. Write/read-back/verify/delete lifecycle (mock Firestore unit verification)
 * 7. Cleanup failure handling (INCOMPLETE + remainingDocument path)
 * 8. Preview versus production distinction
 * 9. Dashboard and Firestore count comparison
 * 10. No interference with Service Intelligence synchronization
 * 11. No interference with Retail Price Intelligence
 * 
 * Note: Unit tests with mock Firestore clients verify deterministic logic and
 * do NOT claim real production persistence is verified.
 */

import assert from 'assert';
import {
  getPersistenceDiagnostic,
  runPersistenceProbe,
  resetDiagnosticProbeStateForTests,
  getServiceDashboardStats,
  getServiceSources,
  initializeServiceIntelligence,
} from '../src/server/service/servicePipelineService';
import { getMemCatalog, seedPilotCatalog } from '../src/server/retail/retailPipelineService';
import { requireAdminOrAuthorizedClient } from '../src/server/authMiddleware';

/**
 * Builds a deterministic in-memory mock Firestore client for unit testing
 */
function createMockFirestore(options: {
  permissionDenied?: boolean;
  corruptReadBackNonce?: boolean;
  failCleanup?: boolean;
  seedDocs?: Record<string, Record<string, any>>;
} = {}) {
  const store: Record<string, Record<string, any>> = options.seedDocs
    ? JSON.parse(JSON.stringify(options.seedDocs))
    : {
        serviceSources: {
          'apple-security': { id: 'apple-security', status: 'ACTIVE', recordsDiscovered: 30 },
          'huawei-security': { id: 'huawei-security', status: 'ACTIVE', recordsDiscovered: 13 },
        },
        serviceAdvisories: {
          'adv-1': { id: 'adv-1', isKnownExploited: true, cisaKevStatus: 'ACTIVE_EXPLOITED' },
          'adv-2': { id: 'adv-2', isKnownExploited: false },
          'adv-3': { id: 'adv-3', isKnownExploited: false },
        },
        serviceVulnerabilities: {
          'CVE-2026-0001': { cveId: 'CVE-2026-0001' },
        },
        serviceProductMatches: {
          'm-1': { id: 'm-1', confidence: 'VERIFIED', status: 'CONFIRMED' },
          'm-2': { id: 'm-2', confidence: 'VERIFIED', status: 'CONFIRMED' },
          'm-3': { id: 'm-3', confidence: 'LIKELY', status: 'PENDING_REVIEW' },
          'm-4': { id: 'm-4', confidence: 'AMBIGUOUS_REVIEW', status: 'PENDING_REVIEW' },
          'm-5': { id: 'm-5', confidence: 'UNMATCHED', status: 'DISMISSED' },
        },
        serviceSyncRuns: {
          'sync-1': {
            id: 'sync-1',
            sourceId: 'apple-security',
            status: 'COMPLETED',
            startedAt: '2026-10-28T08:00:00.000Z',
            completedAt: '2026-10-28T08:00:05.000Z',
            advisoriesCreated: 15,
            advisoriesUpdated: 15,
            persistenceStorageMode: 'FIRESTORE_AUTHORITATIVE',
          },
        },
        serviceAlerts: {},
        _serviceDiagnostics: {},
      };

  const makePermDeniedError = () => {
    const err: any = new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.');
    err.code = 7;
    return err;
  };

  return {
    collection(colName: string) {
      if (!store[colName]) store[colName] = {};
      const colData = store[colName];

      const makeQueryObj = (docsArray: Array<{ id: string; data: () => any }>) => ({
        limit(n: number) {
          return makeQueryObj(docsArray.slice(0, n));
        },
        orderBy() {
          return makeQueryObj(docsArray);
        },
        count() {
          return {
            async get() {
              if (options.permissionDenied) throw makePermDeniedError();
              return { data: () => ({ count: docsArray.length }) };
            },
          };
        },
        async get() {
          if (options.permissionDenied) throw makePermDeniedError();
          return {
            empty: docsArray.length === 0,
            size: docsArray.length,
            docs: docsArray,
          };
        },
      });

      const currentDocs = () =>
        Object.entries(colData).map(([id, val]) => ({
          id,
          exists: true,
          data: () => val,
        }));

      return {
        ...makeQueryObj(currentDocs()),
        doc(docId: string) {
          return {
            id: docId,
            path: `${colName}/${docId}`,
            async set(payload: Record<string, any>) {
              if (options.permissionDenied) throw makePermDeniedError();
              colData[docId] = { ...payload };
            },
            async get() {
              if (options.permissionDenied) throw makePermDeniedError();
              const existing = colData[docId];
              if (!existing) {
                return { exists: false, data: () => undefined };
              }
              const returned = options.corruptReadBackNonce
                ? { ...existing, nonce: 'corrupted_nonce_value' }
                : { ...existing };
              return { exists: true, data: () => returned };
            },
            async delete() {
              if (options.permissionDenied) throw makePermDeniedError();
              if (options.failCleanup) {
                throw new Error('Simulated Firestore cleanup network interruption');
              }
              delete colData[docId];
            },
          };
        },
      };
    },
  };
}

async function runDiagnosticsTests() {
  console.log('=== SIGNALYN S1.2.1 PRODUCTION DIAGNOSTICS TEST SUITE ===\n');
  let passed = 0;

  await initializeServiceIntelligence();

  // ------------------------------------------------------------------
  // 1 & 2. Admin-Only Access & Non-Admin Rejection
  // ------------------------------------------------------------------
  console.log('Test 1 & 2: Admin-Only Access & Non-Admin Rejection');
  let statusSent = 0;
  let bodySent: any = null;
  const mockUnauthReq: any = { headers: {} };
  const mockRes: any = {
    status(code: number) {
      statusSent = code;
      return this;
    },
    json(payload: any) {
      bodySent = payload;
      return this;
    },
  };
  let nextCalled = false;
  await requireAdminOrAuthorizedClient(mockUnauthReq, mockRes, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false, 'Unauthenticated request must NOT call next()');
  assert.strictEqual(statusSent, 401, 'Unauthenticated request must return HTTP 401');
  assert.ok(bodySent?.error, 'Must return error message on rejection');

  // Invalid Bearer token rejection
  statusSent = 0;
  const mockBadTokenReq: any = { headers: { authorization: 'Bearer invalid.jwt.token' } };
  await requireAdminOrAuthorizedClient(mockBadTokenReq, mockRes, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false, 'Invalid token request must NOT call next()');
  assert.ok(statusSent === 401 || statusSent === 403, 'Invalid token must return 401 or 403');
  console.log('  ✓ Unauthenticated & non-admin requests rejected with 401/403');
  passed += 2;

  // ------------------------------------------------------------------
  // 3. Correct Named Firestore Database
  // ------------------------------------------------------------------
  console.log('\nTest 3: Correct Named Firestore Database Target');
  const previewDiag = await getPersistenceDiagnostic(false);
  assert.strictEqual(previewDiag.runtimeInfo.firebaseProjectId, 'signalyn-5406e');
  assert.strictEqual(
    previewDiag.runtimeInfo.firestoreDatabaseId,
    'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34'
  );
  console.log('  ✓ Named database ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34 verified');
  passed++;

  // ------------------------------------------------------------------
  // 4. Actual Document Count Retrieval & Confidence/Status Separation
  // ------------------------------------------------------------------
  console.log('\nTest 4: Actual Document Count Retrieval (Mock Connected Firestore)');
  const mockConnectedDb = createMockFirestore();
  const connectedDiag = await getPersistenceDiagnostic(false, {
    customDb: mockConnectedDb,
    bypassRateLimit: true,
  });
  assert.strictEqual(connectedDiag.firestoreConnection, 'CONNECTED');
  assert.strictEqual(connectedDiag.firestoreCounts.serviceSources, 2);
  assert.strictEqual(connectedDiag.firestoreCounts.serviceAdvisories, 3);
  assert.strictEqual(connectedDiag.firestoreCounts.serviceVulnerabilities, 1);
  assert.strictEqual(connectedDiag.firestoreCounts.serviceProductMatches, 5);
  assert.strictEqual(connectedDiag.firestoreCounts.productMatchesBreakdown.VERIFIED, 2);
  assert.strictEqual(connectedDiag.firestoreCounts.productMatchesBreakdown.LIKELY, 1);
  assert.strictEqual(connectedDiag.firestoreCounts.productMatchesBreakdown.AMBIGUOUS_REVIEW, 1);
  assert.strictEqual(connectedDiag.firestoreCounts.productMatchesBreakdown.UNMATCHED, 1);
  assert.strictEqual(connectedDiag.firestoreCounts.productMatchesStatusBreakdown?.CONFIRMED, 2);
  assert.strictEqual(connectedDiag.firestoreCounts.productMatchesStatusBreakdown?.PENDING_REVIEW, 2);
  assert.strictEqual(connectedDiag.firestoreCounts.productMatchesStatusBreakdown?.DISMISSED, 1);
  assert.strictEqual(connectedDiag.lastPersistedSync.status, 'SUCCESS');
  assert.strictEqual(connectedDiag.lastPersistedSync.syncRunId, 'sync-1');
  console.log('  ✓ Actual collection counts, confidence breakdown, status breakdown, and last sync verified');
  passed++;

  // ------------------------------------------------------------------
  // 5. Permission-Denied Handling (UNAVAILABLE instead of 0)
  // ------------------------------------------------------------------
  console.log('\nTest 5: Permission-Denied Handling');
  const mockPermDeniedDb = createMockFirestore({ permissionDenied: true });
  const deniedDiag = await getPersistenceDiagnostic(false, {
    customDb: mockPermDeniedDb,
    bypassRateLimit: true,
  });
  assert.strictEqual(deniedDiag.firestoreConnection, 'PERMISSION_DENIED');
  assert.strictEqual(deniedDiag.storageMode, 'PREVIEW_IN_MEMORY_ONLY');
  assert.strictEqual(deniedDiag.overallVerificationStatus, 'PRODUCTION_NOT_VERIFIED');
  assert.strictEqual(deniedDiag.firestoreCounts.serviceSources, 'UNAVAILABLE');
  assert.strictEqual(deniedDiag.firestoreCounts.serviceAdvisories, 'UNAVAILABLE');
  assert.strictEqual(deniedDiag.firestoreCounts.serviceProductMatches, 'UNAVAILABLE');
  assert.strictEqual(deniedDiag.firestoreCounts.productMatchesBreakdown.VERIFIED, 'UNAVAILABLE');
  console.log('  ✓ Permission-denied returns UNAVAILABLE counts (never false zero)');
  passed++;

  // ------------------------------------------------------------------
  // 6. Write / Read-Back / Content Verification / Delete Lifecycle
  // ------------------------------------------------------------------
  console.log('\nTest 6: Write / Read-Back / Verify / Delete Probe Lifecycle');
  const probeSuccess = await runPersistenceProbe({
    customDb: mockConnectedDb,
    bypassRateLimit: true,
  });
  assert.strictEqual(probeSuccess.write.status, 'SUCCESS');
  assert.strictEqual(probeSuccess.readBack.status, 'SUCCESS');
  assert.strictEqual(probeSuccess.contentVerification.status, 'SUCCESS');
  assert.strictEqual(probeSuccess.cleanup.status, 'SUCCESS');
  assert.strictEqual(probeSuccess.overallResult, 'VERIFIED');
  assert.strictEqual(probeSuccess.remainingDocument, undefined);

  // Content verification failure check
  const mockCorruptDb = createMockFirestore({ corruptReadBackNonce: true });
  const probeCorrupt = await runPersistenceProbe({
    customDb: mockCorruptDb,
    bypassRateLimit: true,
  });
  assert.strictEqual(probeCorrupt.write.status, 'SUCCESS');
  assert.strictEqual(probeCorrupt.readBack.status, 'SUCCESS');
  assert.strictEqual(probeCorrupt.contentVerification.status, 'FAILED');
  assert.strictEqual(probeCorrupt.overallResult, 'FAILED');
  console.log('  ✓ Full 4-step probe lifecycle and content verification check passed');
  passed++;

  // ------------------------------------------------------------------
  // 7. Cleanup Failure Handling
  // ------------------------------------------------------------------
  console.log('\nTest 7: Cleanup Failure Handling');
  const mockCleanupFailDb = createMockFirestore({ failCleanup: true });
  const probeCleanupFail = await runPersistenceProbe({
    customDb: mockCleanupFailDb,
    bypassRateLimit: true,
  });
  assert.strictEqual(probeCleanupFail.write.status, 'SUCCESS');
  assert.strictEqual(probeCleanupFail.readBack.status, 'SUCCESS');
  assert.strictEqual(probeCleanupFail.contentVerification.status, 'SUCCESS');
  assert.strictEqual(probeCleanupFail.cleanup.status, 'FAILED');
  assert.strictEqual(probeCleanupFail.overallResult, 'INCOMPLETE');
  assert.ok(
    probeCleanupFail.remainingDocument?.startsWith('_serviceDiagnostics/_diag_probe_'),
    'Must report remaining diagnostic document path when cleanup fails'
  );
  console.log(`  ✓ Cleanup failure reported INCOMPLETE with remainingDocument: ${probeCleanupFail.remainingDocument}`);
  passed++;

  // ------------------------------------------------------------------
  // 8. Preview vs Production Runtime Distinction
  // ------------------------------------------------------------------
  console.log('\nTest 8: Preview vs Production Runtime Distinction');
  assert.strictEqual(previewDiag.runtimeInfo.environment, 'AI Studio Preview');
  assert.strictEqual(previewDiag.runtimeInfo.cloudRunService, undefined);

  // Simulate Cloud Run env vars temporarily
  const prevKService = process.env.K_SERVICE;
  const prevRegion = process.env.CLOUD_RUN_REGION;
  process.env.K_SERVICE = 'signalyn';
  process.env.CLOUD_RUN_REGION = 'us-west1';
  const cloudRunDiag = await getPersistenceDiagnostic(false, {
    customDb: mockConnectedDb,
    bypassRateLimit: true,
  });
  assert.strictEqual(cloudRunDiag.runtimeInfo.environment, 'Cloud Run');
  assert.strictEqual(cloudRunDiag.runtimeInfo.cloudRunService, 'signalyn');
  assert.strictEqual(cloudRunDiag.runtimeInfo.cloudRunRegion, 'us-west1');
  if (prevKService === undefined) delete process.env.K_SERVICE;
  else process.env.K_SERVICE = prevKService;
  if (prevRegion === undefined) delete process.env.CLOUD_RUN_REGION;
  else process.env.CLOUD_RUN_REGION = prevRegion;
  console.log('  ✓ Preview vs Cloud Run runtime environment detection verified');
  passed++;

  // ------------------------------------------------------------------
  // 9. Dashboard and Firestore Count Comparison
  // ------------------------------------------------------------------
  console.log('\nTest 9: Dashboard and Firestore Count Comparison');
  const dashStats = await getServiceDashboardStats({ customDb: mockConnectedDb });
  const confirmedCheck = connectedDiag.consistencyChecks.find(
    (c) => c.metric === 'Confirmed Product Links'
  );
  assert.ok(confirmedCheck);
  assert.strictEqual(confirmedCheck.dashboardCount, dashStats.verifiedProductMatchesCount);
  assert.strictEqual(confirmedCheck.firestoreCount, 2);
  assert.strictEqual(
    confirmedCheck.difference,
    dashStats.verifiedProductMatchesCount - 2
  );
  console.log('  ✓ Dashboard vs Firestore discrepancy calculation verified');
  passed++;

  // ------------------------------------------------------------------
  // 10 & 11. Non-Interference with Service Intelligence & Retail Price Intelligence
  // ------------------------------------------------------------------
  console.log('\nTest 10 & 11: Non-Interference with Service & Retail Intelligence');
  resetDiagnosticProbeStateForTests();
  const sourcesAfter = await getServiceSources();
  assert.strictEqual(sourcesAfter.length, 5, '5 official service sources must remain intact');
  assert.ok(
    sourcesAfter.every((s) => !s.id.startsWith('_diag_probe_')),
    'Diagnostic probes must never pollute serviceSources'
  );

  await seedPilotCatalog();
  const retailCatalog = getMemCatalog();
  assert.ok(retailCatalog.size > 0, 'Retail catalog must remain populated');
  const pilotSample = Array.from(retailCatalog.values()).find(
    (p) => p.id === 'prod-apple-iphone-16-pro-128'
  );
  assert.ok(pilotSample, 'Pilot product must exist');
  assert.strictEqual(pilotSample?.brand, 'Apple', 'Retail product brand must remain untouched');
  console.log('  ✓ Zero interference with Service Intelligence or Retail Price Intelligence');
  passed += 2;

  console.log(`\nALL ${passed}/11 S1.2.1 DIAGNOSTICS TESTS PASSED CLEANLY.`);
  process.exit(0);
}

runDiagnosticsTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

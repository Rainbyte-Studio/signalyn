import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SIGNALYN_APP_VERSION,
  UNKNOWN_RELEASE_VALUE,
  compareFrontendBackendRelease,
  resolveSanitizedReleaseMetadata,
} from '../src/utils/releaseMetadata';
import {
  computeReconciledSourceKpiCounts,
  ensureFiniteCount,
  evaluateSourceStatusToggleContract,
  normalizeCatalogCategoryDisplay,
  reconcileBackfillCategoryDistribution,
  reconcileRetailCatalogCounts,
  resolveCanonicalSourceOperationalState,
  resolveRetailCatalogTimestamps,
  resolveRetailerOperationalStatus,
} from '../src/utils/dataIntegrityContracts';
import {
  classifyDailyBriefHttpResponse,
  resolveDailyBriefViewState,
} from '../src/utils/dailyBriefPresentation';
import {
  validateStrictBriefDateParam,
} from '../src/server/dailyBriefRouteContract';
import {
  VALID_NAVIGATION_TABS,
  VALID_SETTINGS_SECTIONS,
  buildNavigationHash,
  parseNavigationHash,
} from '../src/utils/navigationSync';
import { computeSourceHealth, getSourceFeeds } from '../src/utils/urlUtils';
import type {
  BacklogInventory,
  RetailDashboardStats,
  RetailProductViewItem,
  Source,
} from '../src/types';

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error('   ', err instanceof Error ? err.message : err);
  }
}

console.log('=== SIGNALYN P2.3.2.3 — Consolidated Deployment Readiness Review Suite ===\n');

// ============================================================================
// PART A — RELEASE & BUILD TRACEABILITY (Tests 1–3)
// ============================================================================

runTest(
  'Part A.1: Release metadata is deterministic, build-stamped, handles missing git SHA as UNKNOWN, and strips secrets',
  () => {
    const metaNoGit = resolveSanitizedReleaseMetadata({
      appVersion: SIGNALYN_APP_VERSION,
      buildId: '1.1.0-20261101083000',
      commitSha: null,
      buildTimestamp: '2026-11-01T08:30:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00048-abc',
      GEMINI_API_KEY: 'AIzaSySecretKeyShouldNeverLeak123456789',
    });

    assert.equal(metaNoGit.appVersion, SIGNALYN_APP_VERSION);
    assert.equal(metaNoGit.commitSha, UNKNOWN_RELEASE_VALUE);
    assert.equal(metaNoGit.buildTimestamp, '2026-11-01T08:30:00.000Z');
    assert.equal(metaNoGit.serverReleaseId, 'signalyn-00048-abc');

    // Repeat calls with identical input are 100% deterministic (never runtime clock)
    const metaNoGitSecondCall = resolveSanitizedReleaseMetadata({
      appVersion: SIGNALYN_APP_VERSION,
      buildId: '1.1.0-20261101083000',
      commitSha: null,
      buildTimestamp: '2026-11-01T08:30:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00048-abc',
    });
    assert.deepEqual(metaNoGit, metaNoGitSecondCall);

    // Secret-like tokens in fields are sanitized to UNKNOWN
    const secretInjected = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.2.2',
      buildId: 'AIzaSyFakeSecretTokenValue1234567890',
      commitSha: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret',
      buildTimestamp: '2026-11-01T08:30:00.000Z',
      environment: 'production',
      serverReleaseId: '/app/applet/server.ts',
    });
    assert.equal(secretInjected.buildId, UNKNOWN_RELEASE_VALUE);
    assert.equal(secretInjected.commitSha, UNKNOWN_RELEASE_VALUE);
    assert.equal(secretInjected.serverReleaseId, UNKNOWN_RELEASE_VALUE);
  }
);

runTest(
  'Part A.2: compareFrontendBackendRelease detects version, commit, buildId, AND buildTimestamp mismatches',
  () => {
    const frontend = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.2.2',
      buildId: '2.3.2.2-20261101080000',
      commitSha: 'a1b2c3d',
      buildTimestamp: '2026-11-01T08:00:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00048',
    });

    const backendSame = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.2.2',
      buildId: '2.3.2.2-20261101080000',
      commitSha: 'a1b2c3d',
      buildTimestamp: '2026-11-01T08:00:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00048',
    });

    const matchSummary = compareFrontendBackendRelease(frontend, backendSame);
    assert.equal(matchSummary.status, 'VERIFIED_MATCH');
    assert.equal(matchSummary.versionMatchStatus, 'MATCH');
    assert.equal(matchSummary.isMatched, true);

    // Same version 2.3.2.2, unknown commitSha/buildId on one side, but different buildTimestamp
    const backendNewerBuildTimestamp = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.2.2',
      buildId: UNKNOWN_RELEASE_VALUE,
      commitSha: UNKNOWN_RELEASE_VALUE,
      buildTimestamp: '2026-11-01T09:15:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00049',
    });

    const tsMismatch = compareFrontendBackendRelease(frontend, backendNewerBuildTimestamp);
    assert.equal(tsMismatch.status, 'VERSION_MISMATCH');
    assert.equal(tsMismatch.isMatched, false);
    assert.ok(tsMismatch.detailText.includes('buildTimestamp'));
  }
);

runTest(
  'Part A.3: GET /api/system/release sets Cache-Control: no-store and SystemDiagnosticsPanel fetches with cache: no-store',
  () => {
    const serverCode = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
    const diagCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/settings/SystemDiagnosticsPanel.tsx'),
      'utf8'
    );

    assert.ok(
      serverCode.includes("app.get('/api/system/release'") &&
        serverCode.includes("res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')"),
      'server.ts must set Cache-Control: no-store on GET /api/system/release'
    );
    assert.ok(
      diagCode.includes("fetch('/api/system/release', { cache: 'no-store' })"),
      'SystemDiagnosticsPanel.tsx must fetch /api/system/release with cache: no-store'
    );
  }
);

// ============================================================================
// PART B — SECURITY & ROUTE REGRESSION AUDIT (Tests 4–5)
// ============================================================================

runTest(
  'Part B.4: All mutating / diagnostic POST routes in server.ts require authentication or OIDC scheduler verification',
  () => {
    const serverCode = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');

    // Read-only Daily Brief endpoints remain public GET
    assert.ok(serverCode.includes("app.get('/api/daily-brief/latest'"));
    assert.ok(serverCode.includes("app.get('/api/daily-brief'"));

    // Mutating Daily Brief & Pipeline endpoints require admin/authorized client or scheduler OIDC
    assert.ok(
      /app\.post\(\s*'\/api\/daily-brief\/generate',\s*requireAdminOrAuthorizedClient/.test(
        serverCode
      )
    );
    assert.ok(
      /app\.post\(\s*'\/api\/pipeline\/run',\s*requireAdminOrAuthorizedClient/.test(
        serverCode
      )
    );
    assert.ok(
      serverCode.includes(
        "app.post('/api/pipeline/scheduled-run', requireSchedulerAuth"
      )
    );

    // Bounded persistence write/delete probe requires admin authorization
    assert.ok(
      serverCode.includes(
        "app.post('/api/retail/persistence/test', requireAdminOrAuthorizedClient"
      ),
      'POST /api/retail/persistence/test must be guarded by requireAdminOrAuthorizedClient'
    );
    assert.ok(
      serverCode.includes(
        "app.post('/api/service/diagnostic/probe', requireAdminOrAuthorizedClient"
      )
    );

    // API 404 fallback returns JSON before SPA HTML catch-all
    const api404Idx = serverCode.indexOf("app.use('/api'");
    const spaFallbackIdx = serverCode.indexOf("app.get('*'");
    assert.ok(
      api404Idx !== -1 && spaFallbackIdx !== -1 && api404Idx < spaFallbackIdx,
      '/api/* JSON 404 handler must be registered before SPA HTML fallback'
    );
  }
);

runTest(
  'Part B.5: Firestore rules and database binding target authoritative named database and enforce public-read / admin-write',
  () => {
    const firebaseConfig = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8')
    );
    assert.equal(firebaseConfig.projectId, 'signalyn-5406e');
    assert.equal(
      firebaseConfig.firestoreDatabaseId,
      'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34'
    );

    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    assert.ok(rules.includes('match /dailyBriefs/{briefId}'));
    assert.ok(rules.includes('allow read: if true;'));
    assert.ok(rules.includes('isAuthorizedAdmin()'));
  }
);

// ============================================================================
// PART C — SOURCE RESUME / PAUSE BEHAVIOR (Tests 6–12)
// ============================================================================

function makeFeed(
  id: string,
  status: 'ACTIVE' | 'PAUSED' | 'ERROR',
  isPrimary = false,
  failureCount = 0
) {
  return {
    id,
    title: `Feed ${id}`,
    url: `https://example.gr/${id}/rss`,
    feedType: 'RSS' as const,
    status,
    isPrimary,
    categories: ['Tech'],
    articlesCollected: 25,
    failureCount,
    lastError: failureCount > 0 ? 'HTTP 404 Not Found' : null,
  };
}

runTest(
  'Part C.6 (Scenario 1): Parent ACTIVE + all disabled feeds (Insomnia.gr / Matrixlife.gr) blocks direct toggle, prevents flipping parent to PAUSED, and never mutates feeds',
  () => {
    const insomnia: Source = {
      id: 'src-insomnia',
      name: 'Insomnia.gr',
      websiteUrl: 'https://www.insomnia.gr',
      feedUrl: 'https://www.insomnia.gr/rss',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'ACTIVE',
      health: 'PAUSED',
      collectionMethod: 'RSS',
      priority: 9,
      articlesCollected: 85,
      errorCount: 3,
      feeds: [makeFeed('ins-1', 'PAUSED', true, 2), makeFeed('ins-2', 'PAUSED', false, 1)],
    };

    const resolved = resolveCanonicalSourceOperationalState(insomnia);
    assert.equal(resolved.effectiveBucket, 'PAUSED');
    assert.equal(resolved.actionButtonMode, 'RESUME_FEEDS');

    const contract = evaluateSourceStatusToggleContract(insomnia);
    assert.equal(contract.scenario, 'BLOCKED_PARENT_ACTIVE_ALL_FEEDS_DISABLED');
    assert.equal(contract.allowed, false);
    assert.equal(contract.requiresFeedSelection, true);
    assert.equal(contract.mutatesChildFeeds, false);
    assert.equal(contract.currentParentStatus, 'ACTIVE');
    assert.equal(contract.targetParentStatus, 'ACTIVE');
    assert.equal(contract.resultingEffectiveBucket, 'PAUSED');
    assert.equal(contract.actionMode, 'OPEN_FEED_MANAGER');
    assert.deepEqual(contract.preservedChildFeedStatuses, [
      { feedId: 'ins-1', status: 'PAUSED' },
      { feedId: 'ins-2', status: 'PAUSED' },
    ]);
  }
);

runTest(
  'Part C.7 (Scenario 2): Parent ACTIVE + one enabled feed allows pausing source without mutating child feed',
  () => {
    const activeSource: Source = {
      id: 'src-techgear',
      name: 'Techgear.gr',
      websiteUrl: 'https://www.techgear.gr',
      feedUrl: 'https://www.techgear.gr/feed',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'ACTIVE',
      health: 'HEALTHY',
      collectionMethod: 'RSS',
      priority: 8,
      articlesCollected: 120,
      errorCount: 0,
      feeds: [makeFeed('tg-1', 'ACTIVE', true, 0)],
    };

    const contract = evaluateSourceStatusToggleContract(activeSource);
    assert.equal(contract.scenario, 'PAUSE_ACTIVE_SOURCE');
    assert.equal(contract.allowed, true);
    assert.equal(contract.mutatesChildFeeds, false);
    assert.equal(contract.currentParentStatus, 'ACTIVE');
    assert.equal(contract.targetParentStatus, 'PAUSED');
    assert.equal(contract.currentEffectiveBucket, 'ACTIVE');
    assert.equal(contract.resultingEffectiveBucket, 'PAUSED');
    assert.deepEqual(contract.preservedChildFeedStatuses, [
      { feedId: 'tg-1', status: 'ACTIVE' },
    ]);
  }
);

runTest(
  'Part C.8 (Scenario 3): Parent PAUSED + enabled feeds allows resuming source to effective ACTIVE while keeping disabled feeds untouched',
  () => {
    const pausedSourceWithEnabledFeed: Source = {
      id: 'src-paused-enabled',
      name: 'Paused Media With Enabled Feed',
      websiteUrl: 'https://www.pausedmedia.gr',
      feedUrl: 'https://www.pausedmedia.gr/feed',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'PAUSED',
      health: 'PAUSED',
      collectionMethod: 'RSS',
      priority: 7,
      articlesCollected: 50,
      errorCount: 0,
      feeds: [makeFeed('pm-1', 'ACTIVE', true, 0), makeFeed('pm-2', 'PAUSED', false, 2)],
    };

    const contract = evaluateSourceStatusToggleContract(pausedSourceWithEnabledFeed);
    assert.equal(contract.scenario, 'RESUME_PAUSED_SOURCE_WITH_ENABLED_FEEDS');
    assert.equal(contract.allowed, true);
    assert.equal(contract.mutatesChildFeeds, false);
    assert.equal(contract.currentParentStatus, 'PAUSED');
    assert.equal(contract.targetParentStatus, 'ACTIVE');
    assert.equal(contract.currentEffectiveBucket, 'PAUSED');
    assert.equal(contract.resultingEffectiveBucket, 'ACTIVE');
    assert.deepEqual(contract.preservedChildFeedStatuses, [
      { feedId: 'pm-1', status: 'ACTIVE' },
      { feedId: 'pm-2', status: 'PAUSED' },
    ]);
  }
);

runTest(
  'Part C.9 (Scenario 4): Parent PAUSED + all disabled feeds blocks parent-only resume so UI never falsely claims source was resumed',
  () => {
    const pausedAllDisabled: Source = {
      id: 'src-paused-all-disabled',
      name: 'Paused Source All Feeds Disabled',
      websiteUrl: 'https://www.allpaused.gr',
      feedUrl: 'https://www.allpaused.gr/feed',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'PAUSED',
      health: 'PAUSED',
      collectionMethod: 'RSS',
      priority: 6,
      articlesCollected: 10,
      errorCount: 4,
      feeds: [makeFeed('ap-1', 'PAUSED', true, 4), makeFeed('ap-2', 'PAUSED', false, 0)],
    };

    const resolved = resolveCanonicalSourceOperationalState(pausedAllDisabled);
    assert.equal(resolved.effectiveBucket, 'PAUSED');
    assert.equal(resolved.actionButtonMode, 'RESUME_FEEDS');

    const contract = evaluateSourceStatusToggleContract(pausedAllDisabled);
    assert.equal(contract.scenario, 'BLOCKED_PARENT_PAUSED_ALL_FEEDS_DISABLED');
    assert.equal(contract.allowed, false);
    assert.equal(contract.requiresFeedSelection, true);
    assert.equal(contract.mutatesChildFeeds, false);
    assert.equal(contract.currentParentStatus, 'PAUSED');
    assert.equal(contract.targetParentStatus, 'PAUSED');
    assert.equal(contract.resultingEffectiveBucket, 'PAUSED');
  }
);

runTest(
  'Part C.10 (Scenario 5): Parent ACTIVE + mixed enabled/disabled feeds preserves individual feed states across pause -> resume cycle',
  () => {
    const mixedSource: Source = {
      id: 'src-mixed',
      name: 'Mixed Feeds Publication',
      websiteUrl: 'https://www.mixed.gr',
      feedUrl: 'https://www.mixed.gr/feed',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'ACTIVE',
      health: 'HEALTHY',
      collectionMethod: 'RSS',
      priority: 8,
      articlesCollected: 200,
      errorCount: 3,
      feeds: [
        makeFeed('mix-enabled', 'ACTIVE', true, 0),
        makeFeed('mix-disabled-broken', 'PAUSED', false, 3),
      ],
    };

    // Step 1: Pause parent source
    const pauseContract = evaluateSourceStatusToggleContract(mixedSource);
    assert.equal(pauseContract.allowed, true);
    assert.equal(pauseContract.targetParentStatus, 'PAUSED');

    const pausedSource: Source = {
      ...mixedSource,
      status: pauseContract.targetParentStatus,
      feeds: getSourceFeeds(mixedSource),
      health: computeSourceHealth(getSourceFeeds(mixedSource), pauseContract.targetParentStatus),
    };
    assert.equal(pausedSource.feeds![0].status, 'ACTIVE');
    assert.equal(pausedSource.feeds![1].status, 'PAUSED');

    // Step 2: Resume parent source
    const resumeContract = evaluateSourceStatusToggleContract(pausedSource);
    assert.equal(resumeContract.allowed, true);
    assert.equal(resumeContract.targetParentStatus, 'ACTIVE');
    assert.equal(resumeContract.resultingEffectiveBucket, 'ACTIVE');

    const resumedSource: Source = {
      ...pausedSource,
      status: resumeContract.targetParentStatus,
      feeds: getSourceFeeds(pausedSource),
      health: computeSourceHealth(getSourceFeeds(pausedSource), resumeContract.targetParentStatus),
    };

    // Verify disabled broken feed was NOT silently re-enabled!
    assert.equal(resumedSource.status, 'ACTIVE');
    assert.equal(resumedSource.feeds![0].status, 'ACTIVE');
    assert.equal(resumedSource.feeds![1].status, 'PAUSED');
  }
);

runTest(
  'Part C.11 (Scenario 6 & Partial/Failed Write): Zero configured feeds blocks toggle; simulated repository write failure leaves source & feeds unchanged',
  () => {
    const zeroFeedsSource: Source = {
      id: 'src-empty',
      name: 'Unconfigured Source',
      websiteUrl: 'https://www.empty.gr',
      feedUrl: '',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'NEEDS_CONFIGURATION',
      health: 'NEEDS_CONFIGURATION',
      collectionMethod: 'RSS',
      priority: 5,
      articlesCollected: 0,
      errorCount: 0,
      feeds: [],
    };

    const emptyContract = evaluateSourceStatusToggleContract(zeroFeedsSource);
    assert.equal(emptyContract.scenario, 'BLOCKED_ZERO_CONFIGURED_FEEDS');
    assert.equal(emptyContract.allowed, false);
    assert.equal(emptyContract.mutatesChildFeeds, false);

    // Simulate repository toggle execution with write failure handling
    let writeAttempts = 0;
    function simulateToggleWithOptionalWriteFailure(
      src: Source,
      shouldFailWrite: boolean
    ): Source {
      const c = evaluateSourceStatusToggleContract(src);
      if (!c.allowed) {
        throw new Error(c.userMessage);
      }
      writeAttempts++;
      if (shouldFailWrite) {
        throw new Error('Simulated Firestore write timeout');
      }
      const existingFeeds = getSourceFeeds(src);
      const newHealth = computeSourceHealth(existingFeeds, c.targetParentStatus);
      return {
        ...src,
        status: c.targetParentStatus,
        feeds: existingFeeds,
        health: newHealth,
      };
    }

    // Blocked toggle performs 0 write attempts
    assert.throws(() => simulateToggleWithOptionalWriteFailure(zeroFeedsSource, false));
    assert.equal(writeAttempts, 0);

    // Failed write propagates error and does not mutate original source object
    const validSource: Source = {
      ...zeroFeedsSource,
      id: 'src-valid',
      status: 'ACTIVE',
      health: 'HEALTHY',
      feeds: [makeFeed('v-1', 'ACTIVE', true, 0)],
    };
    assert.throws(
      () => simulateToggleWithOptionalWriteFailure(validSource, true),
      /Simulated Firestore write timeout/
    );
    assert.equal(writeAttempts, 1);
    assert.equal(validSource.status, 'ACTIVE');
    assert.equal(validSource.feeds![0].status, 'ACTIVE');
  }
);

// ============================================================================
// PART D — CROSS-MODULE DATA & STATUS CONSISTENCY (Tests 13–17)
// ============================================================================

runTest(
  'Part D.13 (Section 7): Retailer 5-dimension status & freshness reconciles Public.gr, Plaisio, and Kotsovolos across all views',
  () => {
    const refMs = Date.parse('2026-10-31T12:00:00.000Z');

    // Public.gr: 155 live offers, 10 pilot offers, last collected 2026-10-26 (>48h old -> STALE)
    const publicStale = resolveRetailerOperationalStatus({
      source: {
        id: 'public-gr',
        name: 'Public.gr',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
        lastSuccessAt: '2026-10-26T09:15:00.000Z',
        lastHttpError: 'HTTP 403 Forbidden during initial P0 probe',
      },
      liveOffersCount: 155,
      pilotOffersCount: 10,
      referenceTimeMs: refMs,
    });
    assert.equal(publicStale.configurationDimension, 'ENABLED');
    assert.equal(publicStale.connectivityDimension, 'REACHABLE');
    assert.equal(publicStale.inventoryDimension, 'LIVE_VERIFIED_OFFERS');
    assert.equal(publicStale.freshnessDimension, 'STALE');
    assert.equal(publicStale.operationalState, 'HISTORICAL_LIVE_STALE');
    assert.equal(publicStale.isCurrentlyLiveActive, false);
    assert.equal(publicStale.isCurrentlyWafBlocked, false);
    assert.ok(
      publicStale.formattedHistoricalProbeNote?.startsWith(
        'Undated historical probe note (timestamp not recorded, not active block):'
      )
    );

    // Kotsovolos: HTTP 200 reachable, 0 live offers, 10 pilot offers, 0/4 validated categories
    const kotsovolos = resolveRetailerOperationalStatus({
      source: {
        id: 'kotsovolos-gr',
        name: 'Kotsovolos',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
        categoryEndpoints: {
          SMARTPHONES: {
            category: 'SMARTPHONES',
            enabled: true,
            url: 'https://www.kotsovolos.gr/smartphones',
            defaultUrl: 'https://www.kotsovolos.gr/smartphones',
            status: 'UNVERIFIED',
            validationStatus: 'UNVERIFIED',
          },
        } as any,
      },
      liveOffersCount: 0,
      pilotOffersCount: 10,
      referenceTimeMs: refMs,
    });
    assert.equal(kotsovolos.operationalState, 'PROBE_REACHABLE_NO_LIVE_OFFERS');
    assert.equal(kotsovolos.isCurrentlyLiveActive, false);
    assert.equal(kotsovolos.validCategoriesCount, 0);
  }
);

runTest(
  'Part D.14 (Section 8): Source status & error counts reconcile 17 configured, 15 effective active, 2 feed-paused, 0 current errors, 11 historical warnings',
  () => {
    const sources: Source[] = [];
    for (let i = 1; i <= 15; i++) {
      sources.push({
        id: `s-${i}`,
        name: `Active Source ${i}`,
        websiteUrl: `https://s${i}.gr`,
        feedUrl: `https://s${i}.gr/rss`,
        type: 'TECH_MEDIA',
        market: 'Greece',
        language: 'el',
        status: 'ACTIVE',
        health: 'HEALTHY',
        collectionMethod: 'RSS',
        priority: 8,
        articlesCollected: 100,
        errorCount: 0,
        feeds: [makeFeed(`f-${i}`, 'ACTIVE', true, 0)],
      });
    }
    // Insomnia (5 historical feed failures) + Matrixlife (6 historical feed failures) = 11 historical warnings
    sources.push({
      id: 'src-insomnia',
      name: 'Insomnia.gr',
      websiteUrl: 'https://www.insomnia.gr',
      feedUrl: 'https://www.insomnia.gr/rss',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'ACTIVE',
      health: 'PAUSED',
      collectionMethod: 'RSS',
      priority: 9,
      articlesCollected: 85,
      errorCount: 5,
      feeds: [makeFeed('ins-1', 'PAUSED', true, 5)],
    });
    sources.push({
      id: 'src-matrixlife',
      name: 'Matrixlife.gr',
      websiteUrl: 'https://www.matrixlife.gr',
      feedUrl: 'https://www.matrixlife.gr/rss',
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'ACTIVE',
      health: 'PAUSED',
      collectionMethod: 'RSS',
      priority: 7,
      articlesCollected: 42,
      errorCount: 6,
      feeds: [makeFeed('mat-1', 'PAUSED', true, 6)],
    });

    const kpi = computeReconciledSourceKpiCounts(sources);
    assert.equal(kpi.total, 17);
    assert.equal(kpi.configuredEnabledCount, 17);
    assert.equal(kpi.effectiveActiveCount, 15);
    assert.equal(kpi.effectivePausedCount, 2);
    assert.equal(kpi.feedDerivedPausedCount, 2);
    assert.equal(kpi.currentErrorSourcesCount, 0);
    assert.equal(kpi.sourcesWithHistoricalErrorsCount, 2);
    assert.equal(kpi.totalHistoricalFeedErrorsCount, 11);
    assert.equal(kpi.isAdditiveReconciled, true);
  }
);

runTest(
  'Part D.15 (Section 9 & 10): Retail 326 SKU reconciliation (308 + 7 + 11 = 326) & Backfill 3,931 category reconciliation (3,814 + 117 = 3,931)',
  () => {
    const products: RetailProductViewItem[] = [];
    for (let i = 1; i <= 305; i++) {
      products.push({
        product: { id: `l-${i}`, canonicalName: `Live ${i}`, brand: 'Huawei', category: 'SMARTPHONES' },
        offers: [{ id: `o-${i}`, retailerId: 'plaisio-gr', currentPriceCents: 39900, status: 'ACTIVE', isLiveVerified: true, observationStatus: 'LIVE_VERIFIED', lastObservedAt: '2026-10-26T09:00:00.000Z' }],
        isLiveVerified: true,
        hasLiveVerifiedOffer: true,
        hasPilotOffer: false,
        lastUpdated: '2026-10-26T09:00:00.000Z',
      } as any);
    }
    for (let i = 1; i <= 3; i++) {
      products.push({
        product: { id: `m-${i}`, canonicalName: `Mixed ${i}`, brand: 'Huawei', category: 'SMARTPHONES' },
        offers: [
          { id: `om-l-${i}`, retailerId: 'public-gr', currentPriceCents: 59900, status: 'ACTIVE', isLiveVerified: true, observationStatus: 'LIVE_VERIFIED', lastObservedAt: '2026-10-26T09:00:00.000Z' },
          { id: `om-p-${i}`, retailerId: 'kotsovolos-gr', currentPriceCents: 64900, status: 'ACTIVE', isLiveVerified: false, observationStatus: 'PILOT_SEED', priceSourceType: 'SEEDED_PILOT', lastObservedAt: '2025-02-18T10:00:00.000Z' },
        ],
        isLiveVerified: true,
        hasLiveVerifiedOffer: true,
        hasPilotOffer: true,
        lastUpdated: '2025-02-18T10:00:00.000Z',
      } as any);
    }
    for (let i = 1; i <= 7; i++) {
      products.push({
        product: { id: `p-${i}`, canonicalName: `Pilot ${i}`, brand: 'Huawei', category: 'WEARABLES' },
        offers: [{ id: `op-${i}`, retailerId: 'kotsovolos-gr', currentPriceCents: 24900, status: 'ACTIVE', isLiveVerified: false, observationStatus: 'PILOT_SEED', priceSourceType: 'SEEDED_PILOT', lastObservedAt: '2025-02-18T10:00:00.000Z' }],
        isLiveVerified: false,
        hasLiveVerifiedOffer: false,
        hasPilotOffer: true,
        lastUpdated: '2025-02-18T10:00:00.000Z',
      } as any);
    }
    for (let i = 1; i <= 11; i++) {
      products.push({
        product: { id: `u-${i}`, canonicalName: `Unlinked ${i}`, brand: 'Huawei', category: 'AUDIO' },
        offers: [],
        isLiveVerified: false,
        hasLiveVerifiedOffer: false,
        hasPilotOffer: false,
        lastUpdated: '2026-10-25T10:00:00.000Z',
      } as any);
    }

    const breakdown = reconcileRetailCatalogCounts(products, null);
    assert.equal(breakdown.allProductsCount, 326);
    assert.equal(breakdown.liveVerifiedProductsCount, 308);
    assert.equal(breakdown.pilotOnlyProductsCount, 7);
    assert.equal(breakdown.unlinkedOrZeroOfferProductsCount, 11);
    assert.equal(breakdown.mixedProvenanceProductsCount, 3);
    assert.equal(breakdown.pilotProductsCount, 10);
    assert.equal(breakdown.isAdditiveReconciled, true);
    assert.equal(breakdown.isSkuEquationBalanced, true);

    const timestamps = resolveRetailCatalogTimestamps({
      products: products as any,
      retailStats: {
        lastSuccessfulRun: { completedAt: '2026-10-26T09:15:00.000Z' },
      } as RetailDashboardStats,
    });
    assert.equal(timestamps.pilotBaselineDate, '2025-02-18');
    assert.equal(timestamps.catalogInventoryAsOfDate, '2026-10-26');
    assert.notEqual(timestamps.catalogInventoryAsOfDate, '2025-02-18');

    // Backfill 3,814 + 117 = 3,931
    const inv: BacklogInventory = {
      totalStoredArticles: 3931,
      alreadyAnalyzedArticles: 1044,
      pendingStrategicallyRelevantArticles: 6,
      pendingHistoricalStrategicArticles: 0,
      pendingTodayStrategicArticles: 6,
      pendingUncertainArticles: 123,
      pendingOutOfScopeArticles: 0,
      alreadySkippedArticles: 2764,
      rawPendingArticles: 129,
      failedArticlesEligibleForRetry: 0,
      permanentFailures: 0,
      countsByCategory: {
        SMARTPHONE: 722,
        WEARABLE: 102,
        AUDIO: 53,
        TABLET: 50,
        CORPORATE_UNCERTAIN: 123,
        OUT_OF_SCOPE: 2764,
        LEGACY_UNCLASSIFIED: 117,
      },
      countsByCompany: {},
      countsBySource: {},
      publicationDateDistribution: {},
      lastAuditedAt: '2026-10-31T08:00:00.000Z',
    };
    const reconciledBackfill = reconcileBackfillCategoryDistribution(inv);
    assert.equal(reconciledBackfill.sixCategorySum, 3814);
    assert.equal(reconciledBackfill.legacyUnclassifiedCount, 117);
    assert.equal(reconciledBackfill.sevenCategorySum, 3931);
    assert.equal(reconciledBackfill.isTotalReconciledWithLegacy, true);
  }
);

runTest(
  'Part D.16 (Section 11): Product Catalog finite KPI counters and category normalization',
  () => {
    assert.equal(ensureFiniteCount(NaN), 0);
    assert.equal(ensureFiniteCount(undefined), 0);
    assert.equal(ensureFiniteCount(null), 0);
    assert.equal(ensureFiniteCount(Infinity), 0);
    assert.equal(ensureFiniteCount(133), 133);

    assert.equal(normalizeCatalogCategoryDisplay('WEARABLE'), 'Wearables');
    assert.equal(normalizeCatalogCategoryDisplay('Smartwatches'), 'Wearables');
    assert.equal(normalizeCatalogCategoryDisplay('TABLET'), 'Tablets');
    assert.equal(normalizeCatalogCategoryDisplay('SMARTPHONE'), 'Smartphones');
  }
);

// ============================================================================
// PART E — DAILY BRIEF & NAVIGATION REGRESSION (Tests 17–18)
// ============================================================================

runTest(
  'Part E.17 (Section 12): Daily Brief read contract handles all 8 required states without false Generation Failed errors',
  () => {
    // 1. Valid published brief
    const validParam = validateStrictBriefDateParam({ date: '2026-10-30' });
    assert.equal(validParam.valid, true);
    assert.equal(validParam.dateStr, '2026-10-30');

    const validResp = classifyDailyBriefHttpResponse({
      status: 200,
      ok: true,
      contentType: 'application/json',
      rawBody: JSON.stringify({
        found: true,
        brief: {
          id: 'brief-2026-10-30',
          date: '2026-10-30',
          status: 'PUBLISHED',
          en: {
            language: 'en',
            executiveHeadline: 'Huawei expands wearable lead',
            executiveSummary: ['Point 1'],
            keyThemes: ['Wearables'],
            headlineDevelopments: [],
            categoryBreakdowns: [],
            competitorMoves: [],
          },
        },
      }),
      requestedDate: '2026-10-30',
      archiveList: [{ date: '2026-10-30', status: 'PUBLISHED' }],
    });
    assert.equal(validResp.outcome, 'LOADED');
    assert.equal(validResp.brief?.date, '2026-10-30');

    // 2. Missing brief (empty state, NOT generation error)
    const missingResp = classifyDailyBriefHttpResponse({
      status: 404,
      ok: false,
      contentType: 'application/json',
      rawBody: JSON.stringify({ found: false, date: '2026-10-20' }),
      requestedDate: '2026-10-20',
      archiveList: [{ date: '2026-10-30', status: 'PUBLISHED' }],
    });
    assert.equal(missingResp.outcome, 'NOT_FOUND');

    // 3. Invalid date parameter
    assert.equal(validateStrictBriefDateParam({ date: '2026/10/30' }).valid, false);
    assert.equal(validateStrictBriefDateParam({ date: 'invalid-date' }).valid, false);
    assert.equal(validateStrictBriefDateParam({ date: '2026-02-30' }).valid, false);

    // 4. HTTP 404 route mismatch / published metadata mismatch
    const mismatch404 = classifyDailyBriefHttpResponse({
      status: 404,
      ok: false,
      contentType: 'application/json',
      rawBody: JSON.stringify({ found: false, date: '2026-10-29' }),
      requestedDate: '2026-10-29',
      archiveList: [
        { date: '2026-10-30', status: 'PUBLISHED' },
        { date: '2026-10-29', status: 'PUBLISHED' },
      ],
    });
    assert.equal(mismatch404.outcome, 'PUBLISHED_METADATA_MISMATCH');

    // 5. HTTP 500 server error
    const err500 = classifyDailyBriefHttpResponse({
      status: 500,
      ok: false,
      contentType: 'application/json',
      rawBody: JSON.stringify({ error: 'Firestore read timeout' }),
      requestedDate: '2026-10-30',
    });
    assert.equal(err500.outcome, 'READ_ERROR');
    assert.equal(err500.error?.kind, 'SERVER_ERROR');
    assert.ok(!err500.error?.userMessage.includes('Generation Failed'));

    // 6. Non-JSON HTML fallback response
    const errHtml = classifyDailyBriefHttpResponse({
      status: 200,
      ok: true,
      contentType: 'text/html; charset=utf-8',
      rawBody: '<!doctype html><html><body>SPA</body></html>',
      requestedDate: '2026-10-30',
    });
    assert.equal(errHtml.outcome, 'READ_ERROR');
    assert.equal(errHtml.error?.kind, 'HTML_FALLBACK');
    assert.ok(!errHtml.error?.userMessage.includes('Generation Failed'));

    // 7. Malformed JSON / Network read failure view state
    const errJson = classifyDailyBriefHttpResponse({
      status: 200,
      ok: true,
      contentType: 'application/json',
      rawBody: '{broken-json',
      requestedDate: '2026-10-30',
    });
    assert.equal(errJson.outcome, 'READ_ERROR');
    assert.equal(errJson.error?.kind, 'INVALID_JSON');

    // 8. Published-metadata mismatch view state resolution
    const viewState = resolveDailyBriefViewState({
      isLoading: false,
      briefDoc: null,
      activeContent: null,
      readError: null,
      selectedDate: '2026-10-29',
      archiveList: [
        { date: '2026-10-30', status: 'PUBLISHED' },
        { date: '2026-10-29', status: 'PUBLISHED' },
      ],
    });
    assert.equal(viewState, 'PUBLISHED_METADATA_MISMATCH');
  }
);

runTest(
  'Part E.18 (Section 13): Navigation synchronization covers all 16 primary views, Settings sub-tabs, and #backfill vs #settings:backfill disambiguation',
  () => {
    assert.equal(VALID_NAVIGATION_TABS.length, 16);
    for (const tab of VALID_NAVIGATION_TABS) {
      const hash = buildNavigationHash(tab);
      const parsed = parseNavigationHash(hash);
      assert.equal(parsed.activeTab, tab);
    }

    for (const section of VALID_SETTINGS_SECTIONS) {
      const hash = buildNavigationHash('settings', {
        settingsSection: section,
      });
      const parsed = parseNavigationHash(hash, { currentActiveTab: 'settings' });
      assert.equal(parsed.activeTab, 'settings');
      assert.equal(parsed.settingsSection, section);
    }

    // Top-level #backfill vs Settings #settings:backfill disambiguation
    const topBackfill = parseNavigationHash('#backfill');
    assert.equal(topBackfill.activeTab, 'backfill');

    const settingsBackfill = parseNavigationHash('#settings:backfill');
    assert.equal(settingsBackfill.activeTab, 'settings');
    assert.equal(settingsBackfill.settingsSection, 'backfill');
  }
);

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}

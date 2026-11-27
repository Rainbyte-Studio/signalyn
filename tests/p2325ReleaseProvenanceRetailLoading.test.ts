import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeStableSourceFingerprint,
  resolveServerReleaseProvenance
} from '../src/server/sourceFingerprint';
import {
  SIGNALYN_APP_VERSION,
  isSourceFingerprintToken,
  resolveProvenanceTokenKind,
  resolveSanitizedReleaseMetadata,
  compareFrontendBackendRelease
} from '../src/utils/releaseMetadata';
import {
  reconcileRetailCatalogCounts,
  resolveRetailSourceDiscoveredCount,
  resolveRetailerEffectiveExtractionStrategy,
  classifyRetailerHistoricalNotes,
  resolveModuleLoadingGuardState,
  resolveCanonicalSourceOperationalState,
  evaluateSourceStatusToggleContract,
  formatSourceRowErrorOrWarningDisplay,
  reconcileBackfillCategoryDistribution
} from '../src/utils/dataIntegrityContracts';

let passed = 0;
let failed = 0;

function runTest(id: string, description: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ [PASS] ${id}: ${description}`);
    passed++;
  } catch (err: any) {
    console.error(`❌ [FAIL] ${id}: ${description}`);
    console.error(`   Error: ${err?.message || err}`);
    failed++;
  }
}

console.log('================================================================================');
console.log('SIGNALYN P2.3.2.5 — Release Provenance, Retail Consistency & Loading-State Suite');
console.log('================================================================================\n');

const ROOT_DIR = path.resolve('.');

// ---------------------------------------------------------------------------
// TASK 1: Stable Source-Code Fingerprint & Provenance Verification
// ---------------------------------------------------------------------------

runTest('T1.1', 'SIGNALYN_APP_VERSION is updated to 2.3.2.5 and matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  assert.equal(SIGNALYN_APP_VERSION, '2.3.2.5');
  assert.equal(pkg.version, '2.3.2.5');
});

runTest('T1.2', 'computeStableSourceFingerprint computes deterministic src-<12-hex> across repeated calls', () => {
  const fp1 = computeStableSourceFingerprint(ROOT_DIR);
  const fp2 = computeStableSourceFingerprint(ROOT_DIR);
  assert.equal(fp1, fp2);
  assert.match(fp1, /^src-[0-9a-f]{12}$/);
  assert.equal(isSourceFingerprintToken(fp1), true);
  assert.equal(resolveProvenanceTokenKind(fp1), 'SOURCE_FINGERPRINT');
});

runTest('T1.3', 'resolveServerReleaseProvenance falls back to deterministic sourceFingerprint when git SHA is UNKNOWN', () => {
  const prov = resolveServerReleaseProvenance({
    rootDir: ROOT_DIR,
    env: {
      COMMIT_SHA: 'UNKNOWN',
      GIT_COMMIT: '',
      K_REVISION: 'signalyn-00032-test'
    },
    releaseFilePayload: null
  });
  assert.match(prov.commitSha, /^src-[0-9a-f]{12}$/);
  assert.equal(prov.sourceFingerprint, prov.commitSha);
  assert.equal(prov.provenanceType, 'SOURCE_FINGERPRINT');
});

runTest('T1.4', 'resolveServerReleaseProvenance preserves explicit git commit SHA when provided', () => {
  const prov = resolveServerReleaseProvenance({
    rootDir: ROOT_DIR,
    env: {
      COMMIT_SHA: 'a1b2c3d4e5f6'
    },
    releaseFilePayload: null
  });
  assert.equal(prov.commitSha, 'a1b2c3d4e5f6');
  assert.equal(prov.provenanceType, 'GIT_COMMIT_SHA');
  assert.match(prov.sourceFingerprint, /^src-[0-9a-f]{12}$/);
});

runTest('T1.5', 'compareFrontendBackendRelease identifies src-<12-hex> as a source-code fingerprint (not full container binary hash) and preserves VERIFIED_MATCH', () => {
  const fp = computeStableSourceFingerprint(ROOT_DIR);
  const frontendMeta = resolveSanitizedReleaseMetadata({
    appVersion: '2.3.2.5',
    buildId: `signalyn-v2.3.2.5-${fp}`,
    buildTimestamp: '2026-11-01T12:30:00.000Z',
    sourceFingerprint: fp
  });
  const backendMeta = resolveSanitizedReleaseMetadata({
    appVersion: '2.3.2.5',
    buildId: `signalyn-v2.3.2.5-${fp}`,
    buildTimestamp: '2026-11-01T12:30:00.000Z',
    commitSha: fp,
    K_REVISION: 'signalyn-00032-p2325'
  });

  assert.equal(frontendMeta.commitSha, fp);
  assert.equal(backendMeta.commitSha, fp);

  const comparison = compareFrontendBackendRelease(frontendMeta, backendMeta);
  assert.equal(comparison.isMatch, true);
  assert.equal(comparison.isMatched, true);
  assert.equal(comparison.status, 'VERIFIED_MATCH');
  assert.equal(comparison.badgeLabel, 'VERIFIED MATCH');
  assert.ok(comparison.detailText.includes(`source-code fingerprint ${fp}`));
  assert.ok(comparison.detailText.includes('not a cryptographic hash of the complete container binary'));
  assert.equal(comparison.detailText.toLowerCase().includes('exact same binary'), false);
});

// ---------------------------------------------------------------------------
// TASK 2: Canonical 326 Retail SKU Taxonomy & 411 Offer Reconciliation
// ---------------------------------------------------------------------------

// Authoritative production distribution:
// - 305 Live-Only SKUs (380 linked live offers: 75 * 2 + 230 * 1 = 380)
// - 3 Dual-Coverage SKUs (3 linked live offers + 6 linked pilot offers -> 380 + 3 = 383 linked live offers)
//   => 308 Live Verified SKUs (305 Live-Only + 3 Dual-Coverage)
// - 7 Pilot-Only SKUs (21 linked pilot offers: 7 * 3 = 21 -> 6 + 21 = 27 linked pilot offers)
//   => 10 total SKUs in Pilot Reference (7 Pilot-Only + 3 Dual-Coverage)
// - 11 Unlinked / No-Offer SKUs (0 active offers)
//   => 308 Live Verified + 7 Pilot-Only + 11 Unlinked/No Offer = 326 Canonical SKUs
const EXACT_PRODUCTION_PRODUCTS = [
  ...Array.from({ length: 305 }, (_, idx) => ({
    product: { id: `live-prod-${idx + 1}`, name: `Live SKU ${idx + 1}`, brand: 'HUAWEI', category: 'SMARTPHONE' },
    lowestLiveVerifiedPriceCents: 49900,
    lowestPilotPriceCents: null,
    offers: idx < 75
      ? [
          { id: `o-live-a-${idx}`, retailerId: 'public-gr', isLiveVerified: true, observationStatus: 'LIVE_VERIFIED', currentPriceCents: 49900, status: 'IN_STOCK' },
          { id: `o-live-b-${idx}`, retailerId: 'kotsovolos-gr', isLiveVerified: true, observationStatus: 'LIVE_VERIFIED', currentPriceCents: 50900, status: 'IN_STOCK' }
        ]
      : [
          { id: `o-live-a-${idx}`, retailerId: 'public-gr', isLiveVerified: true, observationStatus: 'LIVE_VERIFIED', currentPriceCents: 49900, status: 'IN_STOCK' }
        ]
  })),
  ...Array.from({ length: 3 }, (_, idx) => ({
    product: { id: `dual-prod-${idx + 1}`, name: `Dual SKU ${idx + 1}`, brand: 'HUAWEI', category: 'SMARTPHONE' },
    lowestLiveVerifiedPriceCents: 69900,
    lowestPilotPriceCents: 71900,
    offers: [
      { id: `o-dual-live-${idx}`, retailerId: 'public-gr', isLiveVerified: true, observationStatus: 'LIVE_VERIFIED', currentPriceCents: 69900, status: 'IN_STOCK' },
      { id: `o-dual-pilot-a-${idx}`, retailerId: 'plaisio-gr', isLiveVerified: false, observationStatus: 'SEEDED_PILOT', priceSourceType: 'SEEDED_PILOT', currentPriceCents: 71900, status: 'IN_STOCK' },
      { id: `o-dual-pilot-b-${idx}`, retailerId: 'kotsovolos-gr', isLiveVerified: false, observationStatus: 'SEEDED_PILOT', priceSourceType: 'SEEDED_PILOT', currentPriceCents: 72900, status: 'IN_STOCK' }
    ]
  })),
  ...Array.from({ length: 7 }, (_, idx) => ({
    product: { id: `pilot-prod-${idx + 1}`, name: `Pilot SKU ${idx + 1}`, brand: 'HUAWEI', category: 'SMARTPHONE' },
    lowestLiveVerifiedPriceCents: null,
    lowestPilotPriceCents: 39900,
    offers: [
      { id: `o-pilot-a-${idx}`, retailerId: 'public-gr', isLiveVerified: false, observationStatus: 'SEEDED_PILOT', priceSourceType: 'SEEDED_PILOT', currentPriceCents: 39900, status: 'IN_STOCK' },
      { id: `o-pilot-b-${idx}`, retailerId: 'plaisio-gr', isLiveVerified: false, observationStatus: 'SEEDED_PILOT', priceSourceType: 'SEEDED_PILOT', currentPriceCents: 40900, status: 'IN_STOCK' },
      { id: `o-pilot-c-${idx}`, retailerId: 'kotsovolos-gr', isLiveVerified: false, observationStatus: 'SEEDED_PILOT', priceSourceType: 'SEEDED_PILOT', currentPriceCents: 41900, status: 'IN_STOCK' }
    ]
  })),
  ...Array.from({ length: 11 }, (_, idx) => ({
    product: { id: `no-offer-prod-${idx + 1}`, name: `No Offer SKU ${idx + 1}`, brand: 'HUAWEI', category: 'SMARTPHONE' },
    lowestLiveVerifiedPriceCents: null,
    lowestPilotPriceCents: null,
    offers: []
  }))
] as any[];

runTest('T2.1', 'reconcileRetailCatalogCounts reconciles canonical 326 SKUs (308 Live Verified [305 Live-Only + 3 Dual] + 7 Pilot-Only + 11 No-Offer) and 411 offers (384 live [383 linked + 1 review] + 27 pilot)', () => {
  const topLevelDashboardStats: any = {
    totalTrackedProducts: 326,
    liveVerifiedProductsCount: 308,
    seededPilotProductsCount: 10,
    pilotOnlyProductsCount: 7,
    mixedProvenanceProductsCount: 3,
    totalActiveOffers: 411,
    liveVerifiedOffersCount: 384,
    seededPilotOffersCount: 27,
    unlinkedOffersCount: 1
  };

  const rec = reconcileRetailCatalogCounts(EXACT_PRODUCTION_PRODUCTS, topLevelDashboardStats, 1);

  assert.equal(rec.allProductsCount, 326);
  assert.equal(rec.liveOnlyProductsCount, 305);
  assert.equal(rec.mixedProvenanceProductsCount, 3);
  assert.equal(rec.liveVerifiedProductsCount, 308);
  assert.equal(rec.pilotOnlyProductsCount, 7);
  assert.equal(rec.pilotProductsCount, 10);
  assert.equal(rec.unlinkedOrNoOfferProductsCount, 11);
  assert.equal(rec.isSkuEquationBalanced, true);
  assert.equal(
    rec.reconciliationFormulaText,
    '326 Canonical SKUs = 308 Live Verified + 7 Pilot-Only + 11 Unlinked/No Offer (3 SKUs have both Live & Pilot offers; 10 total in Pilot Ref)'
  );

  // Offer contract checks
  assert.equal(rec.liveVerifiedLinkedOffersCount, 383);
  assert.equal(rec.unlinkedLiveOffersCount, 1);
  assert.equal(rec.totalLiveVerifiedOffersCount, 384);
  assert.equal(rec.liveVerifiedOffersCount, 384);
  assert.equal(rec.pilotLinkedOffersCount, 27);
  assert.equal(rec.seededPilotOffersCount, 27);
  assert.equal(rec.allLinkedOffersCount, 410);
  assert.equal(rec.totalActiveOffersCount, 411);
  assert.equal(rec.isOfferEquationBalanced, true);
  assert.equal(
    rec.offerReconciliationFormulaText,
    '411 Active Offers = 384 Live Verified (383 Linked + 1 Unlinked in Review Queue) + 27 Seeded Pilot (410 Total Linked)'
  );
});

runTest('T2.2', 'RetailPricesView and OverviewDashboard bind top-level /api/retail/dashboard-stats without losing stats', () => {
  const retailPricesSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/retail/RetailPricesView.tsx'), 'utf8');
  const overviewSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/overview/OverviewDashboard.tsx'), 'utf8');

  assert.ok(retailPricesSrc.includes('dashData?.stats || dashData || null'), 'RetailPricesView must bind dashData?.stats || dashData');
  assert.ok(overviewSrc.includes('setRetailStats(data?.stats || data || null)'), 'OverviewDashboard must bind data?.stats || data');
});

runTest('T2.3', 'resolveRetailSourceDiscoveredCount reads lastDiscoveryStats.productsFound (144, 144, 96) instead of returning 0', () => {
  const publicSource: any = {
    id: 'public-gr',
    lastDiscoveryStats: { productsFound: 144, offersUpdated: 144, durationMs: 41200 }
  };
  const kotsovolosSource: any = {
    id: 'kotsovolos-gr',
    lastDiscoveryStats: { productsFound: 144, offersUpdated: 144, durationMs: 38900 }
  };
  const plaisioSource: any = {
    id: 'plaisio-gr',
    lastDiscoveryStats: { productsFound: 96, offersUpdated: 96, durationMs: 29400 }
  };

  assert.equal(resolveRetailSourceDiscoveredCount(publicSource), 144);
  assert.equal(resolveRetailSourceDiscoveredCount(kotsovolosSource), 144);
  assert.equal(resolveRetailSourceDiscoveredCount(plaisioSource), 96);
  assert.equal(
    resolveRetailSourceDiscoveredCount(publicSource) +
      resolveRetailSourceDiscoveredCount(kotsovolosSource) +
      resolveRetailSourceDiscoveredCount(plaisioSource),
    384
  );
});

// ---------------------------------------------------------------------------
// TASK 3: Historical WAF & Legacy P0 Note Classification
// ---------------------------------------------------------------------------

runTest('T3.1', 'classifyRetailerHistoricalNotes and resolveRetailerEffectiveExtractionStrategy label legacy P0 WAF/403 notes as historical when Playwright HTTP 200 is live', () => {
  const kotsovolosSource: any = {
    id: 'kotsovolos-gr',
    integrationMethod: 'Currys Group / Kotsovolos B2B XML Feed (blocked by Akamai WAF 403)',
    accessConditions: 'Automated requests blocked by Akamai WAF (HTTP 403). Requires B2B XML feed or headless browser.',
    customNotes: 'Initial P0 probe returned HTTP 403.',
    categoryEndpoints: {
      smartphones: {
        categoryId: 'smartphones',
        validationStatus: 'VALID_CATEGORY',
        status: 'LIVE_VERIFIED',
        lastHttpStatus: 200,
        productsDetected: 36,
        extractionStrategy: 'PLAYWRIGHT_HEADLESS'
      }
    }
  };

  const effectiveStrategy = resolveRetailerEffectiveExtractionStrategy(kotsovolosSource);
  assert.equal(effectiveStrategy, 'PLAYWRIGHT_HEADLESS');

  const classification = classifyRetailerHistoricalNotes({
    source: kotsovolosSource,
    liveOffersCount: 144
  });

  assert.equal(classification.hasLegacyWafOrStaticNote, true);
  assert.equal(classification.isHistoricalResolvedNote, true);
  assert.equal(classification.effectiveExtractionStrategy, 'PLAYWRIGHT_HEADLESS');
  assert.ok(classification.historicalClarificationBanner?.includes('Historical P0 Static-Probe Note (Resolved — Not Active Block)'));
  assert.ok(classification.historicalClarificationBanner?.includes('PLAYWRIGHT_HEADLESS'));
});

// ---------------------------------------------------------------------------
// TASK 4: Initial Loading-State Integrity & Stale Fallback Elimination
// ---------------------------------------------------------------------------

runTest('T4.1', 'resolveModuleLoadingGuardState prevents false 0 KPIs and false empty states while isLoading is true', () => {
  const whileLoading = resolveModuleLoadingGuardState({
    isLoading: true,
    itemCount: 0,
    hasDataObject: false
  });
  assert.equal(whileLoading.showLoadingSkeleton, true);
  assert.equal(whileLoading.showEmptyState, false);
  assert.equal(whileLoading.showDataContent, false);
  assert.equal(whileLoading.statusLabel, 'LOADING_INITIAL');

  const afterLoadedWithData = resolveModuleLoadingGuardState({
    isLoading: false,
    itemCount: 326,
    hasDataObject: true
  });
  assert.equal(afterLoadedWithData.showLoadingSkeleton, false);
  assert.equal(afterLoadedWithData.showEmptyState, false);
  assert.equal(afterLoadedWithData.showDataContent, true);
  assert.equal(afterLoadedWithData.statusLabel, 'DATA_READY');

  const afterLoadedEmpty = resolveModuleLoadingGuardState({
    isLoading: false,
    itemCount: 0,
    hasDataObject: false
  });
  assert.equal(afterLoadedEmpty.showLoadingSkeleton, false);
  assert.equal(afterLoadedEmpty.showEmptyState, true);
  assert.equal(afterLoadedEmpty.showDataContent, false);
  assert.equal(afterLoadedEmpty.statusLabel, 'EMPTY_VERIFIED');
});

runTest('T4.2', 'SystemDiagnosticsPanel, HistoricalBackfillSection, and HistoricalBackfillSettingsCard have zero hardcoded outdated fallback KPI numbers', () => {
  const diagSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/settings/SystemDiagnosticsPanel.tsx'), 'utf8');
  assert.equal(diagSrc.includes('?? 21'), false, 'SystemDiagnosticsPanel must not contain ?? 21 fallback');
  assert.equal(diagSrc.includes('?? 27'), false, 'SystemDiagnosticsPanel must not contain ?? 27 fallback');
  assert.equal(diagSrc.includes('?? 108'), false, 'SystemDiagnosticsPanel must not contain ?? 108 fallback');
  assert.equal(diagSrc.includes('ais-sandbox@ais-europe-west2'), false, 'SystemDiagnosticsPanel must not contain stale sandbox service account fallback');

  const backfillSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/settings/HistoricalBackfillSection.tsx'), 'utf8');
  assert.equal(backfillSrc.includes('?? 2046'), false, 'HistoricalBackfillSection must not contain ?? 2046 fallback');
  assert.equal(backfillSrc.includes('?? 1442'), false, 'HistoricalBackfillSection must not contain ?? 1442 fallback');
  assert.equal(backfillSrc.includes('?? 1065'), false, 'HistoricalBackfillSection must not contain ?? 1065 fallback');
  assert.equal(backfillSrc.includes('?? 320'), false, 'HistoricalBackfillSection must not contain ?? 320 fallback');
  assert.equal(backfillSrc.includes('?? 285'), false, 'HistoricalBackfillSection must not contain ?? 285 fallback');

  const backfillCardSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/settings/HistoricalBackfillSettingsCard.tsx'), 'utf8');
  assert.equal(backfillCardSrc.includes("?? '315'"), false, 'HistoricalBackfillSettingsCard must not contain ?? 315 fallback');
  assert.equal(backfillCardSrc.includes("?? '62'"), false, 'HistoricalBackfillSettingsCard must not contain ?? 62 fallback');

  // Verify reconcileBackfillCategoryDistribution(null) returns 0s instead of fabricated 2046/491/51/34/23/62/1385
  const nullBackfill = reconcileBackfillCategoryDistribution(null);
  assert.equal(nullBackfill.totalStoredArticles, 0);
  assert.equal(nullBackfill.smartphoneCount, 0);
  assert.equal(nullBackfill.outOfScopeCount, 0);
  assert.equal(nullBackfill.sumAllBuckets, 0);
});

runTest('T4.3', 'DailyBriefView, OverviewDashboard, RetailPricesView, SourcesManager, and HistoricalBackfillSection enforce loading state guards before empty/KPI states', () => {
  const dailyBriefSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/dailybrief/DailyBriefView.tsx'), 'utf8');
  const overviewSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/overview/OverviewDashboard.tsx'), 'utf8');
  const retailSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/retail/RetailPricesView.tsx'), 'utf8');
  const sourcesSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/sources/SourcesManager.tsx'), 'utf8');
  const backfillSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/settings/HistoricalBackfillSection.tsx'), 'utf8');

  assert.ok(dailyBriefSrc.includes('isArchiveLoading'), 'DailyBriefView must track isArchiveLoading');
  assert.ok(
    overviewSrc.includes('isModulesLoading && retailStats === null && retailProducts.length === 0'),
    'OverviewDashboard must guard retail panel while loading'
  );
  assert.ok(
    retailSrc.includes('if (loading && (!stats || products.length === 0))'),
    'RetailPricesView must guard initial loading until stats and products resolve'
  );
  assert.ok(sourcesSrc.includes('isLoading && sources.length === 0'), 'SourcesManager must guard table empty state while loading');
  assert.ok(backfillSrc.includes('const isInitialLoading = loadingInventory && !inventory'), 'HistoricalBackfillSection must guard initial loading state');
});

// ---------------------------------------------------------------------------
// TASK 5 & TASK 6: Warning vs Error Terminology & Operational UX Consistency
// ---------------------------------------------------------------------------

runTest('T5.1', 'formatSourceRowErrorOrWarningDisplay distinguishes historical feed warnings on healthy/paused sources from active errors', () => {
  const healthyWithHistFailures = resolveCanonicalSourceOperationalState({
    id: 'techblog-gr',
    name: 'Techblog.gr',
    status: 'ACTIVE',
    errorCount: 3,
    feeds: [
      { id: 'f1', url: 'https://techblog.gr/feed', status: 'ACTIVE', failureCount: 0 }
    ]
  } as any);
  const formattedHealthy = formatSourceRowErrorOrWarningDisplay(healthyWithHistFailures);
  assert.equal(formattedHealthy.badgeKind, 'HISTORICAL_WARNING');
  assert.equal(formattedHealthy.displayValue, '3 hist.');
  assert.equal(formattedHealthy.tone, 'amber');

  const pausedWithHistFailures = resolveCanonicalSourceOperationalState({
    id: 'gsmarena-rss',
    name: 'GSMArena',
    status: 'PAUSED',
    errorCount: 6,
    feeds: [
      { id: 'f2', url: 'https://gsmarena.com/rss', status: 'PAUSED', failureCount: 6, lastError: 'Timeout' }
    ]
  } as any);
  const formattedPaused = formatSourceRowErrorOrWarningDisplay(pausedWithHistFailures);
  assert.equal(formattedPaused.badgeKind, 'HISTORICAL_WARNING');
  assert.equal(formattedPaused.displayValue, '6 hist.');
  assert.equal(formattedPaused.tone, 'amber');

  const activeFailingSource = resolveCanonicalSourceOperationalState({
    id: 'broken-feed',
    name: 'Broken Feed',
    status: 'ERROR',
    errorCount: 4,
    feeds: [
      { id: 'f3', url: 'https://example.com/rss', status: 'ERROR', failureCount: 4, lastError: 'HTTP 500' }
    ]
  } as any);
  const formattedError = formatSourceRowErrorOrWarningDisplay(activeFailingSource);
  assert.equal(formattedError.badgeKind, 'ACTIVE_ERROR');
  assert.equal(formattedError.displayValue, '4 active');
  assert.equal(formattedError.tone, 'rose');
});

runTest('T6.1', 'Operational UX: Zero-enabled-feed sources never show "Resume monitoring & feeds", Retail Daily Automation never shows "Disable Daily Schedule" when DISABLED_PENDING_ADMIN_APPROVAL, and Backfill describes 7-category reconciliation', () => {
  // 1. Zero-enabled-feed source (Insomnia.gr / Matrixlife.gr)
  const zeroActiveFeedSource: any = {
    id: 'src-insomnia',
    name: 'Insomnia.gr',
    status: 'ACTIVE',
    feeds: [
      { id: 'f1', url: 'https://www.insomnia.gr/rss', status: 'PAUSED', failureCount: 3 }
    ]
  };
  const resolvedZeroActive = resolveCanonicalSourceOperationalState(zeroActiveFeedSource);
  assert.equal(resolvedZeroActive.actionButtonLabel, 'Select feed to resume');
  assert.equal(resolvedZeroActive.actionButtonLabel.includes('Resume monitoring & feeds'), false);
  assert.equal(resolvedZeroActive.actionButtonTitle.includes('Resume monitoring & feeds'), false);
  const toggleContract = evaluateSourceStatusToggleContract(zeroActiveFeedSource);
  assert.equal(toggleContract.allowed, false);
  assert.equal(toggleContract.buttonLabel, 'Select Feed to Resume');

  // 2. Retail Daily Automation button guard when DISABLED_PENDING_ADMIN_APPROVAL
  const retailSettingsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/retail/RetailSourcesSettings.tsx'), 'utf8');
  assert.ok(
    retailSettingsSrc.includes('(!scheduleConfig?.enabled && !scheduleApprovalChecked)'),
    'RetailSourcesSettings must disable schedule action button when disabled and approval checkbox is unchecked'
  );
  assert.ok(
    retailSettingsSrc.includes("'Confirm Admin Approval Above to Activate'"),
    'RetailSourcesSettings must show "Confirm Admin Approval Above to Activate" instead of "Disable Daily Schedule" when disabled'
  );

  // 3. Historical Backfill 7-category reconciliation wording
  const backfillSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/settings/HistoricalBackfillSection.tsx'), 'utf8');
  assert.equal(backfillSrc.includes('6-category hardware reconciliation'), false);
  assert.ok(backfillSrc.includes('7-category reconciliation'));

  const backfillRec = reconcileBackfillCategoryDistribution({
    totalStoredArticles: 3931,
    countsByCategory: {
      SMARTPHONE: 722,
      WEARABLE: 102,
      AUDIO: 53,
      TABLET: 50,
      CORPORATE_UNCERTAIN: 123,
      OUT_OF_SCOPE: 2764,
      LEGACY_UNCLASSIFIED: 117
    }
  });
  assert.equal(backfillRec.buckets.length, 7);
  assert.equal(backfillRec.sevenCategorySum, 3931);
  assert.ok(backfillRec.reconciliationDetailLabel.includes('7 Categories'));
});

console.log('\n--------------------------------------------------------------------------------');
console.log(`P2.3.2.5 Test Summary: ${passed} passed, ${failed} failed`);
console.log('--------------------------------------------------------------------------------');

if (failed > 0) {
  process.exit(1);
}

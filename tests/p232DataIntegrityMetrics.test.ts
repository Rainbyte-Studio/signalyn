/**
 * SIGNALYN P2.3.2 — Data Integrity & Metrics Reliability Regression Suite
 *
 * Focused regression tests verifying all 7 confirmed audit findings (F02, F03, F04,
 * F07, F08, F09, F15) across pure data-contract resolvers, intelligence selectors,
 * catalog statistics, and component source invariants.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ensureFiniteCount,
  normalizeRetailBrandDisplay,
  matchesCanonicalRetailBrand,
  getDeduplicatedCanonicalBrands,
  normalizeCatalogCategoryDisplay,
  reconcileRetailCatalogCounts,
  evaluateProductPriceComparisonSemantics,
  resolveRetailerOperationalStatus,
  resolveCanonicalSourceOperationalState,
  computeReconciledSourceKpiCounts,
  reconcileBackfillCategoryDistribution,
} from '../src/utils/dataIntegrityContracts';
import {
  buildPriorityIntelligenceSignals,
  computeExecutiveSummaryKpis,
  evaluateLiveRetailMovementForPeriod,
  resolveTargetContext,
} from '../src/services/commandCenterIntelligence';
import {
  getProductCatalogStatistics,
  validateProductCatalogIntegrity,
  matchesLifecycleFilter,
} from '../src/services/productAuditRegistry';
import {
  getMergedCanonicalProducts,
  CANONICAL_COMPANIES_REGISTRY,
} from '../src/services/canonicalEntities';
import { RetailProductViewItem, RetailSource } from '../src/types/retailPrice';
import { BacklogInventory, Product, Source } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('================================================================');
console.log('SIGNALYN P2.3.2 — DATA INTEGRITY & METRICS RELIABILITY TESTS');
console.log('================================================================\n');

// Reference time: 2026-10-31T12:00:00Z
const REF_TIME_MS = new Date('2026-10-31T12:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// 1 & 2. F02: Overview 24h / 7d / 30d / all retail event filtering &
//        exclusion of 2025-02-18 pilot baseline events from recent windows
// ---------------------------------------------------------------------------
console.log('--- 1 & 2. F02: Overview Retail Time-Window & Provenance Filtering ---');
{
  // Fixture: HUAWEI Pura 70 Pro with a recent live offer check (2026-10-31)
  // AND a historical 2025-02-18 pilot delta (-€100).
  const pura70MixedItem: RetailProductViewItem = {
    product: {
      id: 'prod-hw-pura70-pro',
      name: 'HUAWEI Pura 70 Pro',
      brand: 'HUAWEI',
      category: 'SMARTPHONES',
      modelFamily: 'Pura 70',
      storage: '512GB',
      color: 'Black',
      connectivity: '5G',
      isHuawei: true,
      isPilot: true,
      active: true,
    },
    offers: [
      {
        id: 'offer-plaisio-live',
        productId: 'prod-hw-pura70-pro',
        retailerId: 'plaisio-gr',
        retailerName: 'Plaisio',
        retailerSku: 'PLA-P70P',
        title: 'HUAWEI Pura 70 Pro 512GB',
        url: 'https://www.plaisio.gr/telephony/pura-70-pro',
        currentPriceCents: 99900,
        currency: 'EUR',
        stockStatus: 'IN_STOCK',
        isLiveVerified: true,
        observationStatus: 'LIVE_VERIFIED',
        priceSourceType: 'LIVE_HTTP_CRAWL',
        lastCheckedAt: '2026-10-31T08:00:00.000Z',
        lastVerifiedAt: '2026-10-31T08:00:00.000Z',
        active: true,
      },
      {
        id: 'offer-public-pilot',
        productId: 'prod-hw-pura70-pro',
        retailerId: 'public-gr',
        retailerName: 'Public.gr',
        retailerSku: 'PUB-P70P',
        title: 'HUAWEI Pura 70 Pro 512GB',
        url: 'https://www.public.gr/product/pura-70-pro',
        currentPriceCents: 99900,
        currency: 'EUR',
        stockStatus: 'IN_STOCK',
        isLiveVerified: false,
        observationStatus: 'SEEDED_PILOT',
        priceSourceType: 'SEEDED_PILOT',
        lastCheckedAt: '2025-02-18T10:00:00.000Z',
        active: true,
      },
    ],
    lowestPriceCents: 99900,
    lowestRetailer: 'Plaisio',
    lowestLiveVerifiedPriceCents: 99900,
    lowestLiveVerifiedRetailer: 'Plaisio',
    lowestPilotPriceCents: 99900,
    lowestPilotRetailer: 'Public.gr',
    effectiveLowestPriceCents: 99900,
    effectiveLowestPriceProvenance: 'LIVE_VERIFIED',
    // Even if legacy priceDelta24hCents was populated from 2025-02-18 pilot history,
    // livePriceDelta24hCents is null (only 1 live observation) and pilot movement is 2025-02-18.
    priceDelta24hCents: null,
    priceDelta7dCents: null,
    priceDelta30dCents: null,
    livePriceDelta24hCents: null,
    livePriceMovementObservedAt: null,
    pilotPriceDelta24hCents: -10000,
    pilotPriceMovementObservedAt: '2025-02-18T10:00:00.000Z',
    liveObservationCount: 1,
    latestLiveObservationDate: '2026-10-31',
    comparisonType: 'LIVE_WITH_PILOT_REF',
    lastUpdated: '2025-02-18T10:00:00.000Z',
  };

  // Fixture: Legacy item where priceDelta24hCents (-10000) has lastUpdated = 2025-02-18
  const legacyDatedRetailItem: RetailProductViewItem = {
    ...pura70MixedItem,
    priceDelta24hCents: -10000,
    livePriceDelta24hCents: undefined,
    liveObservationCount: undefined,
    lastUpdated: '2025-02-18T10:00:00.000Z',
  };

  // Fixture: Genuine recent multi-snapshot live price movement on 2026-10-31
  const genuineRecentMoveItem: RetailProductViewItem = {
    ...pura70MixedItem,
    product: { ...pura70MixedItem.product, id: 'prod-hw-gt5', name: 'HUAWEI Watch GT 5' },
    priceDelta24hCents: -5000,
    livePriceDelta24hCents: -5000,
    livePriceMovementObservedAt: '2026-10-31T08:00:00.000Z',
    liveObservationCount: 2,
    latestLiveObservationDate: '2026-10-31',
    lastUpdated: '2026-10-31T08:00:00.000Z',
  };

  const evalMixed24h = evaluateLiveRetailMovementForPeriod(pura70MixedItem, '24h', REF_TIME_MS);
  const evalLegacy24h = evaluateLiveRetailMovementForPeriod(legacyDatedRetailItem, '24h', REF_TIME_MS);
  const evalLegacy7d = evaluateLiveRetailMovementForPeriod(legacyDatedRetailItem, '7d', REF_TIME_MS);
  const evalLegacy30d = evaluateLiveRetailMovementForPeriod(legacyDatedRetailItem, '30d', REF_TIME_MS);
  const evalGenuine24h = evaluateLiveRetailMovementForPeriod(genuineRecentMoveItem, '24h', REF_TIME_MS);

  assert(
    evalMixed24h.isEligible === false,
    'Pura 70 Pro with 1 live observation + 2025-02-18 pilot delta is NOT eligible as a 24h live price movement'
  );
  assert(
    evalLegacy24h.isEligible === false &&
      evalLegacy7d.isEligible === false &&
      evalLegacy30d.isEligible === false,
    '2025-02-18 retail movement is excluded from 24h, 7d, and 30d reporting windows'
  );
  assert(
    evalGenuine24h.isEligible === true && evalGenuine24h.deltaCents === -5000,
    'Genuine 2026-10-31 multi-observation live movement IS eligible in 24h window'
  );

  const targetContext = resolveTargetContext(
    CANONICAL_COMPANIES_REGISTRY,
    null,
    'HUAWEI'
  );

  const signals24h = buildPriorityIntelligenceSignals({
    stories: [],
    advisories: [],
    retailProducts: [pura70MixedItem, legacyDatedRetailItem],
    target: targetContext,
    scope: 'GLOBAL_MARKET',
    period: '24h',
    referenceTimeMs: REF_TIME_MS,
  });

  const kpis24h = computeExecutiveSummaryKpis({
    signals: signals24h,
    stories: [],
    retailStats: null,
    retailProducts: [pura70MixedItem, legacyDatedRetailItem],
    serviceStats: null,
    advisories: [],
    target: targetContext,
    scope: 'GLOBAL_MARKET',
    period: '24h',
    referenceTimeMs: REF_TIME_MS,
  });

  const retailKpi24h = kpis24h.find((k) => k.id === 'retail-pricing');

  assert(
    retailKpi24h !== undefined &&
      retailKpi24h.label === 'Monitored Retail Catalog',
    'Overview KPI 3 does NOT count 2025-02-18 retail event as a 24h Verified Retail Price Movement'
  );
  assert(
    signals24h.filter((s) => s.domain === 'RETAIL_PRICING').length === 0,
    'Priority Intelligence Signals and KPI 3 agree: 0 retail price movement signals in 24h window for 2025-02-18 event'
  );
}

// ---------------------------------------------------------------------------
// 3. F03: Retail operational status consistency across KPI, health cards,
//    matrix headers, and source settings
// ---------------------------------------------------------------------------
console.log('\n--- 3. F03: Retailer Operational Status Consistency ---');
{
  const plaisioSource: Partial<RetailSource> = {
    id: 'plaisio-gr',
    name: 'Plaisio',
    status: 'ACTIVE',
    readinessState: 'LIVE_READY',
    lastHttpStatus: 200,
    lastSuccessAt: '2026-10-30T14:00:00.000Z',
  };
  const publicSource: Partial<RetailSource> = {
    id: 'public-gr',
    name: 'Public.gr',
    status: 'ACTIVE',
    readinessState: 'LIVE_READY',
    lastHttpStatus: 200,
    lastSuccessAt: '2026-10-31T08:00:00.000Z',
  };
  const kotsovolosSource: Partial<RetailSource> = {
    id: 'kotsovolos-gr',
    name: 'Kotsovolos',
    status: 'ACTIVE',
    readinessState: 'LIVE_READY',
    lastHttpStatus: 200,
    lastSuccessAt: undefined,
  };
  const wafBlockedSource: Partial<RetailSource> = {
    id: 'public-gr',
    name: 'Public.gr',
    status: 'ACCESS_BLOCKED',
    readinessState: 'ACCESS_BLOCKED',
    lastHttpStatus: 403,
    lastSuccessAt: undefined,
  };

  const plaisioResolved = resolveRetailerOperationalStatus({
    source: plaisioSource as RetailSource,
    liveOffersCount: 256,
    pilotOffersCount: 0,
    referenceTimeMs: REF_TIME_MS,
  });
  const publicResolved = resolveRetailerOperationalStatus({
    source: publicSource as RetailSource,
    liveOffersCount: 155,
    pilotOffersCount: 10,
    referenceTimeMs: REF_TIME_MS,
  });
  const kotsovolosResolved = resolveRetailerOperationalStatus({
    source: {
      ...(kotsovolosSource as RetailSource),
      categoryEndpoints: {
        SMARTPHONES: {
          category: 'SMARTPHONES',
          url: 'https://www.kotsovolos.gr/smartphones',
          status: 'LIVE_VERIFIED',
          validationStatus: 'VALID_CATEGORY',
        },
      } as any,
    },
    liveOffersCount: 0,
    pilotOffersCount: 10,
  });
  const blockedResolved = resolveRetailerOperationalStatus({
    source: wafBlockedSource as RetailSource,
    liveOffersCount: 0,
    pilotOffersCount: 10,
  });

  assert(
    plaisioResolved.operationalState === 'LIVE_OPERATIONAL' &&
      plaisioResolved.matrixColumnBadgeLabel === '(Live • 256)',
    'Plaisio with 256 live offers resolves to LIVE_OPERATIONAL / (Live • 256)'
  );
  assert(
    publicResolved.operationalState === 'LIVE_OPERATIONAL' &&
      publicResolved.matrixColumnBadgeLabel === '(Live • 155)',
    'Public.gr with 155 live offers resolves to LIVE_OPERATIONAL / (Live • 155) instead of hardcoded (403 WAF)'
  );
  assert(
    kotsovolosResolved.operationalState === 'PROBE_REACHABLE_NO_LIVE_OFFERS' &&
      kotsovolosResolved.isCountedOperationalInKpi === false &&
      kotsovolosResolved.matrixColumnBadgeLabel === '(Pilot Ref • 0 Live)',
    'Kotsovolos with 0 live offers + 10 pilot offers + lastSuccessAt=null resolves to PROBE_REACHABLE_NO_LIVE_OFFERS instead of claiming Live extraction active'
  );
  assert(
    blockedResolved.operationalState === 'WAF_BLOCKED' &&
      blockedResolved.matrixColumnBadgeLabel === '(403 WAF)',
    'Retailer with HTTP 403 / ACCESS_BLOCKED resolves to WAF_BLOCKED / (403 WAF)'
  );

  const retailViewSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/retail/RetailPricesView.tsx'),
    'utf8'
  );
  assert(
    !retailViewSource.includes('Public / Kotsovolos: 403'),
    'RetailPricesView.tsx no longer contains hardcoded "Public / Kotsovolos: 403" in KPI 3'
  );
  assert(
    retailViewSource.includes("getResolvedRetailerStatus('public-gr').columnHeaderBadge") &&
      retailViewSource.includes("getResolvedRetailerStatus('kotsovolos-gr').columnHeaderBadge") &&
      retailViewSource.includes("getResolvedRetailerStatus('plaisio-gr').columnHeaderBadge"),
    'RetailPricesView.tsx matrix column headers use unified getResolvedRetailerStatus badges'
  );
}

// ---------------------------------------------------------------------------
// 4, 5 & 6. F04: Single-observation, multi-observation, and stale-observation
//           24h delta comparison semantics
// ---------------------------------------------------------------------------
console.log('\n--- 4, 5 & 6. F04: Retail 24h Price Comparison & Freshness Semantics ---');
{
  // Audit fixture: HUAWEI Watch GT 7 41mm Pink with a single observation on 2026-10-26
  const singleStaleItem = {
    product: {
      id: 'prod-hw-watch-gt7-41-pink',
      name: 'HUAWEI Watch GT 7 41mm Pink',
      brand: 'HUAWEI',
      category: 'WEARABLES',
      modelFamily: 'Watch GT 7',
      isPilot: false,
      active: true,
    },
    offers: [
      {
        id: 'offer-pub-gt7',
        canonicalProductId: 'prod-hw-watch-gt7-41-pink',
        retailerId: 'public-gr',
        retailerName: 'Public.gr',
        retailerSku: 'PUB-GT7-PK',
        title: 'HUAWEI Watch GT 7 41mm Pink',
        url: 'https://www.public.gr/product/watch-gt-7',
        currentPriceCents: 24900,
        currency: 'EUR',
        stockStatus: 'IN_STOCK',
        isLiveVerified: true,
        observationStatus: 'LIVE_VERIFIED',
        priceSourceType: 'LIVE_PUBLIC_HTML',
        lastObservedAt: '2026-10-26T10:00:00.000Z',
        active: true,
      },
    ],
    lowestPriceCents: 24900,
    lowestRetailer: 'Public.gr',
    lowestLiveVerifiedPriceCents: 24900,
    lowestLiveVerifiedRetailer: 'Public.gr',
    lowestPilotPriceCents: null,
    effectiveLowestPriceCents: 24900,
    effectiveLowestPriceProvenance: 'LIVE_VERIFIED',
    priceDelta24hCents: null,
    priceDelta7dCents: null,
    priceDelta30dCents: null,
    liveObservationCount: 1,
    latestLiveObservationDate: '2026-10-26',
    comparisonType: 'LIVE_SINGLE_RETAILER',
    lastUpdated: '2026-10-26T10:00:00.000Z',
  } as unknown as RetailProductViewItem;

  const singleSemantics = evaluateProductPriceComparisonSemantics({
    item: singleStaleItem,
    historyEntries: [
      {
        id: 'hist-1',
        canonicalProductId: 'prod-hw-watch-gt7-41-pink',
        offerId: 'offer-pub-gt7',
        retailerId: 'public-gr',
        priceCents: 24900,
        currency: 'EUR',
        stockStatus: 'IN_STOCK',
        recordedAt: '2026-10-26T10:00:00.000Z',
        dateAthens: '2026-10-26',
        isLiveVerified: true,
        observationStatus: 'LIVE_VERIFIED',
        priceSourceType: 'LIVE_PUBLIC_HTML',
      } as any,
    ],
    referenceTimeMs: REF_TIME_MS,
  });

  assert(
    singleSemantics.eligibility === 'INSUFFICIENT_HISTORY_SINGLE_OBS' &&
      singleSemantics.isEligibleForLiveWindowDelta === false &&
      singleSemantics.secondaryDetailText.includes('1 observation (2026-10-26) — no prior snapshot'),
    'Single-observation Watch GT 7 41mm Pink on 2026-10-26 is labeled "1 observation (2026-10-26) — no prior snapshot" instead of "Unchanged vs prior snapshot"'
  );

  // Multi-observation stale item (2 observations, latest on 2026-10-25 > 48h ago)
  const multiStaleSemantics = evaluateProductPriceComparisonSemantics({
    item: {
      ...singleStaleItem,
      liveObservationCount: 2,
      latestLiveObservationDate: '2026-10-25',
      lastUpdated: '2026-10-25T10:00:00.000Z',
    },
    referenceTimeMs: REF_TIME_MS,
  });

  assert(
    multiStaleSemantics.eligibility === 'STALE_LIVE_OBSERVATION' &&
      multiStaleSemantics.isStaleFor24hWindow === true &&
      multiStaleSemantics.secondaryDetailText.includes('Stale observation (2026-10-25)'),
    'Multi-observation product whose latest observation is >48h old is labeled as a stale observation'
  );

  // Multi-observation fresh unchanged item (2 observations, latest on 2026-10-31)
  const multiFreshUnchangedSemantics = evaluateProductPriceComparisonSemantics({
    item: {
      ...singleStaleItem,
      liveObservationCount: 2,
      latestLiveObservationDate: '2026-10-31',
      lastUpdated: '2026-10-31T08:00:00.000Z',
      livePriceDelta24hCents: 0,
      priceDelta24hCents: 0,
    },
    referenceTimeMs: REF_TIME_MS,
  });

  assert(
    multiFreshUnchangedSemantics.eligibility === 'ELIGIBLE_LIVE_UNCHANGED' &&
      multiFreshUnchangedSemantics.isStaleFor24hWindow === false &&
      multiFreshUnchangedSemantics.secondaryDetailText.includes('Unchanged vs prior snapshot'),
    'Fresh multi-observation product with 0 delta is eligible and labeled "Unchanged vs prior snapshot"'
  );
}

// ---------------------------------------------------------------------------
// 7. F07: Source KPI counter, filter result, badge, and action-button consistency
// ---------------------------------------------------------------------------
console.log('\n--- 7. F07: Source Status & Feed Health Reconciliation ---');
{
  const healthySource: Source = {
    id: 'src-techgear',
    name: 'Techgear.gr',
    websiteUrl: 'https://www.techgear.gr',
    collectionMethod: 'RSS',
    market: 'Greece',
    categories: ['Smartphones'],
    status: 'ACTIVE',
    health: 'HEALTHY',
    articlesCollected: 310,
    errorCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-31T00:00:00Z',
    feeds: [
      {
        id: 'f-1',
        title: 'Main RSS',
        url: 'https://www.techgear.gr/feed',
        feedType: 'RSS',
        categories: ['Smartphones'],
        coverageRole: 'PRIMARY',
        status: 'ACTIVE',
        isPrimary: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-10-31T00:00:00Z',
        failureCount: 0,
        articlesCollected: 310,
      },
    ],
  };

  // Audit fixture: Insomnia.gr with source.status='ACTIVE' but all feeds PAUSED (0 active, 5 errors)
  const insomniaSource: Source = {
    id: 'src-insomnia',
    name: 'Insomnia.gr',
    websiteUrl: 'https://www.insomnia.gr',
    collectionMethod: 'RSS',
    market: 'Greece',
    categories: ['Smartphones'],
    status: 'ACTIVE',
    health: 'PAUSED',
    articlesCollected: 120,
    errorCount: 5,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-31T00:00:00Z',
    feeds: [
      {
        id: 'f-ins-1',
        title: 'Insomnia RSS',
        url: 'https://www.insomnia.gr/rss',
        feedType: 'RSS',
        categories: ['Smartphones'],
        coverageRole: 'PRIMARY',
        status: 'PAUSED',
        isPrimary: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-10-31T00:00:00Z',
        failureCount: 5,
        articlesCollected: 120,
      },
    ],
  };

  const matrixlifeSource: Source = {
    ...insomniaSource,
    id: 'src-matrixlife',
    name: 'Matrixlife.gr',
    websiteUrl: 'https://www.matrixlife.gr',
  };

  const resolvedInsomnia = resolveCanonicalSourceOperationalState(insomniaSource);
  assert(
    resolvedInsomnia.effectiveBucket === 'PAUSED' &&
      resolvedInsomnia.badgeLabel === 'PAUSED' &&
      resolvedInsomnia.isFeedDerivedPaused === true &&
      resolvedInsomnia.actionButtonMode === 'RESUME_FEEDS' &&
      resolvedInsomnia.actionButtonLabel === 'Select feed to resume',
    'Insomnia (status=ACTIVE, 0 active feeds, all feeds PAUSED) resolves to PAUSED bucket, PAUSED badge, and Select feed to resume action'
  );

  // Simulate 15 healthy active sources + Insomnia + Matrixlife (17 total)
  const all17Sources: Source[] = [
    ...Array.from({ length: 15 }, (_, idx) => ({
      ...healthySource,
      id: `src-active-${idx + 1}`,
      name: `Active Source ${idx + 1}`,
    })),
    insomniaSource,
    matrixlifeSource,
  ];

  const kpiCounts = computeReconciledSourceKpiCounts(all17Sources);
  assert(
    kpiCounts.total === 17 &&
      kpiCounts.active === 15 &&
      kpiCounts.paused === 2 &&
      kpiCounts.error === 0,
    `Reconciled source KPI counts for 15 active + 2 feed-paused sources equal Total=17, Active=15, Paused=2 (got Active=${kpiCounts.active}, Paused=${kpiCounts.paused})`
  );

  const pausedFiltered = all17Sources.filter(
    (s) => resolveCanonicalSourceOperationalState(s).effectiveBucket === 'PAUSED'
  );
  assert(
    pausedFiltered.length === 2 &&
      pausedFiltered.some((s) => s.id === 'src-insomnia') &&
      pausedFiltered.some((s) => s.id === 'src-matrixlife'),
    'Filtering by Paused KPI bucket returns both Insomnia.gr and Matrixlife.gr (2 rows)'
  );
}

// ---------------------------------------------------------------------------
// 8 & 9. F08: Backfill category sum reconciliation (3,814 + 117 = 3,931) &
//        Analytics vs Backfill baseline reconciliation
// ---------------------------------------------------------------------------
console.log('\n--- 8 & 9. F08: Backfill Category Sum & Cross-Module Reconciliation ---');
{
  const prodInventoryFixture: BacklogInventory = {
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

  const reconciled = reconcileBackfillCategoryDistribution(prodInventoryFixture);
  assert(
    reconciled.sixCategorySum === 3814 &&
      reconciled.legacyUnclassifiedCount === 117 &&
      reconciled.sevenCategorySum === 3931 &&
      reconciled.totalStoredArticles === 3931 &&
      reconciled.isTotalReconciledWithLegacy === true,
    `Backfill category distribution reconciles 3,814 primary + 117 Legacy/Unclassified = 3,931 total (100% reconciliation)`
  );

  const backfillSectionSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/settings/HistoricalBackfillSection.tsx'),
    'utf8'
  );
  assert(
    !backfillSectionSource.includes('Analytics Daily Baseline: 193') &&
      !backfillSectionSource.includes('Brand-Bearing SOV: 144') &&
      !backfillSectionSource.includes('>193 articles<'),
    'HistoricalBackfillSection.tsx no longer contains hardcoded 193 / 144 analytics baseline numbers'
  );
}

// ---------------------------------------------------------------------------
// 10 & 11. F09: Product catalog KPI formatting with zero NaN values &
//          Canonical category normalization (Smartphones vs SMARTPHONE)
// ---------------------------------------------------------------------------
console.log('\n--- 10 & 11. F09: Product Catalog Statistics & Category Normalization ---');
{
  // Include a promoted Firestore product with category='SMARTPHONE' ("Google Pixel 11 Pro")
  const promotedPixel11Pro: Product = {
    id: 'prod-goog-googlepixel11pro',
    companyId: 'comp-google',
    name: 'Google Pixel 11 Pro',
    aliases: ['Pixel 11 Pro'],
    category: 'SMARTPHONE',
    active: true,
    lifecycle: 'RUMORED',
    entityLevel: 'PRODUCT_MODEL',
  };

  const mergedProducts = getMergedCanonicalProducts([promotedPixel11Pro]);
  const stats = getProductCatalogStatistics(mergedProducts);
  const integrity = validateProductCatalogIntegrity(mergedProducts);

  assert(
    mergedProducts.length === 57,
    `Merged canonical catalog with Google Pixel 11 Pro has 57 products (56 baseline + 1 promoted)`
  );
  assert(
    Number.isFinite(stats.confirmedGreekMarketTotal) &&
      !Number.isNaN(stats.confirmedGreekMarketTotal) &&
      Number.isFinite(stats.greekMarketOfficial) &&
      Number.isFinite(stats.greekMarketRetailConfirmed) &&
      Number.isFinite(stats.greekMarketUnknown),
    `Greek market catalog statistics are finite integers with zero NaN values (Confirmed GR=${stats.confirmedGreekMarketTotal}, Official=${stats.greekMarketOfficial}, Retail=${stats.greekMarketRetailConfirmed}, Unverified=${stats.greekMarketUnknown})`
  );
  assert(
    Number.isFinite(stats.individualModels) &&
      stats.individualModels > 0 &&
      Number.isFinite(stats.productSeries) &&
      stats.productSeries > 0 &&
      Number.isFinite(stats.productFamilies) &&
      stats.productFamilies > 0 &&
      stats.individualModels + stats.productSeries + stats.productFamilies + stats.placeholders ===
        stats.total,
    `Catalog architecture entry-type counts are finite and sum to total (${stats.individualModels} Models + ${stats.productSeries} Series + ${stats.productFamilies} Families = ${stats.total})`
  );

  const distinctCategories = Array.from(new Set(mergedProducts.map((p) => p.category)));
  assert(
    distinctCategories.includes('Smartphones') &&
      !distinctCategories.includes('SMARTPHONE') &&
      distinctCategories.length === 4,
    `Canonical product categories normalize "SMARTPHONE" into "Smartphones" with exactly 4 hardware domains (${distinctCategories.join(', ')})`
  );

  const smartphonesFiltered = mergedProducts.filter((p) => p.category === 'Smartphones');
  assert(
    smartphonesFiltered.length === 28 &&
      smartphonesFiltered.some((p) => p.name === 'Google Pixel 11 Pro'),
    `Filtering by "Smartphones" returns all 28 smartphones including Google Pixel 11 Pro`
  );

  assert(
    matchesLifecycleFilter('RELEASED', 'RELEASED' as any) === true &&
      matchesLifecycleFilter('ANNOUNCED', 'RELEASED' as any) === false &&
      matchesLifecycleFilter('ANNOUNCED', 'ANNOUNCED' as any) === true,
    'matchesLifecycleFilter accurately filters RELEASED and ANNOUNCED options'
  );
  assert(
    integrity.totalProducts === 57 && integrity.auditedProductsCount === 56,
    `validateProductCatalogIntegrity reports 56/57 audited when 1 promoted product lacks static audit entry`
  );
}

// ---------------------------------------------------------------------------
// 12. F15: Canonical brand normalization (Huawei/HUAWEI, Apple/APPLE,
//     Samsung/SAMSUNG) and SKU count reconciliation (326 = 308 + 7 + 11)
// ---------------------------------------------------------------------------
console.log('\n--- 12. F15: Retail Brand Normalization & 326 SKU Count Reconciliation ---');
{
  const rawBrands = [
    'Huawei',
    'HUAWEI',
    'Apple',
    'APPLE',
    'Samsung',
    'SAMSUNG',
    'Xiaomi',
    'XIAOMI',
    'Garmin',
    'GARMIN',
    'Honor',
    'HONOR',
  ];
  const dedupedBrands = getDeduplicatedCanonicalBrands(rawBrands);
  assert(
    dedupedBrands.length === 6 &&
      dedupedBrands.includes('HUAWEI') &&
      dedupedBrands.includes('Apple') &&
      !dedupedBrands.includes('APPLE') &&
      dedupedBrands.includes('Samsung') &&
      !dedupedBrands.includes('SAMSUNG') &&
      !dedupedBrands.includes('Huawei'),
    `getDeduplicatedCanonicalBrands deduplicates case variants into [${dedupedBrands.join(', ')}]`
  );
  assert(
    matchesCanonicalRetailBrand('Huawei', 'HUAWEI') &&
      matchesCanonicalRetailBrand('HUAWEI', 'Huawei') &&
      matchesCanonicalRetailBrand('APPLE', 'Apple') &&
      matchesCanonicalRetailBrand('SAMSUNG', 'Samsung'),
    'matchesCanonicalRetailBrand matches all case variants of HUAWEI, Apple, and Samsung'
  );

  // Build 326 SKU fixture matching production distribution:
  // - 305 Live-Only SKUs
  // - 3 Mixed (Live + Pilot) SKUs -> total Live Verified = 308, total Pilot Ref = 3 + 7 = 10
  // - 7 Pilot-Only SKUs
  // - 11 Unlinked / Zero-Offer SKUs
  // Total = 305 + 3 + 7 + 11 = 326
  const makeMockSku = (
    idx: number,
    mode: 'LIVE_ONLY' | 'MIXED' | 'PILOT_ONLY' | 'NO_OFFER'
  ): RetailProductViewItem =>
    ({
      product: {
        id: `sku-${idx}`,
        name: `SKU ${idx}`,
        brand: idx % 2 === 0 ? 'Huawei' : 'HUAWEI',
        category: 'SMARTPHONES',
        modelFamily: 'Model',
        isPilot: mode === 'PILOT_ONLY' || mode === 'MIXED',
        active: true,
      },
      offers:
        mode === 'LIVE_ONLY'
          ? [
              {
                id: `off-live-${idx}`,
                canonicalProductId: `sku-${idx}`,
                retailerId: 'plaisio-gr',
                retailerName: 'Plaisio',
                retailerSku: `L-${idx}`,
                title: `SKU ${idx}`,
                url: 'https://www.plaisio.gr/p',
                currentPriceCents: 50000,
                currency: 'EUR',
                stockStatus: 'IN_STOCK',
                isLiveVerified: true,
                observationStatus: 'LIVE_VERIFIED',
                priceSourceType: 'LIVE_PUBLIC_HTML',
                lastObservedAt: '2026-10-31T08:00:00Z',
                active: true,
              },
            ]
          : mode === 'MIXED'
          ? [
              {
                id: `off-live-${idx}`,
                canonicalProductId: `sku-${idx}`,
                retailerId: 'plaisio-gr',
                retailerName: 'Plaisio',
                retailerSku: `L-${idx}`,
                title: `SKU ${idx}`,
                url: 'https://www.plaisio.gr/p',
                currentPriceCents: 50000,
                currency: 'EUR',
                stockStatus: 'IN_STOCK',
                isLiveVerified: true,
                observationStatus: 'LIVE_VERIFIED',
                priceSourceType: 'LIVE_PUBLIC_HTML',
                lastObservedAt: '2026-10-31T08:00:00Z',
                active: true,
              },
              {
                id: `off-pilot-${idx}`,
                canonicalProductId: `sku-${idx}`,
                retailerId: 'kotsovolos-gr',
                retailerName: 'Kotsovolos',
                retailerSku: `P-${idx}`,
                title: `SKU ${idx}`,
                url: 'https://www.kotsovolos.gr/p',
                currentPriceCents: 52000,
                currency: 'EUR',
                stockStatus: 'IN_STOCK',
                isLiveVerified: false,
                observationStatus: 'SEEDED_PILOT',
                priceSourceType: 'SEEDED_PILOT',
                lastObservedAt: '2025-02-18T10:00:00Z',
                active: true,
              },
            ]
          : mode === 'PILOT_ONLY'
          ? [
              {
                id: `off-pilot-${idx}`,
                canonicalProductId: `sku-${idx}`,
                retailerId: 'kotsovolos-gr',
                retailerName: 'Kotsovolos',
                retailerSku: `P-${idx}`,
                title: `SKU ${idx}`,
                url: 'https://www.kotsovolos.gr/p',
                currentPriceCents: 52000,
                currency: 'EUR',
                stockStatus: 'IN_STOCK',
                isLiveVerified: false,
                observationStatus: 'SEEDED_PILOT',
                priceSourceType: 'SEEDED_PILOT',
                lastObservedAt: '2025-02-18T10:00:00Z',
                active: true,
              },
            ]
          : [],
      lowestPriceCents: mode === 'NO_OFFER' ? null : 50000,
      lowestRetailer: mode === 'NO_OFFER' ? undefined : 'Plaisio',
      lowestLiveVerifiedPriceCents:
        mode === 'LIVE_ONLY' || mode === 'MIXED' ? 50000 : null,
      lowestLiveVerifiedRetailer:
        mode === 'LIVE_ONLY' || mode === 'MIXED' ? 'Plaisio' : undefined,
      lowestPilotPriceCents:
        mode === 'PILOT_ONLY' || mode === 'MIXED' ? 52000 : null,
      lowestPilotRetailer:
        mode === 'PILOT_ONLY' || mode === 'MIXED' ? 'Kotsovolos' : undefined,
      effectiveLowestPriceCents: mode === 'NO_OFFER' ? null : 50000,
      effectiveLowestPriceProvenance:
        mode === 'LIVE_ONLY' || mode === 'MIXED'
          ? 'LIVE_VERIFIED'
          : mode === 'PILOT_ONLY'
          ? 'SEEDED_PILOT'
          : 'NONE',
      priceDelta24hCents: null,
      priceDelta7dCents: null,
      priceDelta30dCents: null,
      comparisonType: 'LIVE_SINGLE_RETAILER',
      lastUpdated: '2026-10-31T08:00:00Z',
    } as unknown as RetailProductViewItem);

  const mock326Products: RetailProductViewItem[] = [
    ...Array.from({ length: 305 }, (_, i) => makeMockSku(i + 1, 'LIVE_ONLY')),
    ...Array.from({ length: 3 }, (_, i) => makeMockSku(306 + i, 'MIXED')),
    ...Array.from({ length: 7 }, (_, i) => makeMockSku(309 + i, 'PILOT_ONLY')),
    ...Array.from({ length: 11 }, (_, i) => makeMockSku(316 + i, 'NO_OFFER')),
  ];

  const skuRec = reconcileRetailCatalogCounts(mock326Products, null);
  assert(
    skuRec.allProductsCount === 326 &&
      skuRec.liveVerifiedProductsCount === 308 &&
      skuRec.pilotOnlyProductsCount === 7 &&
      skuRec.unlinkedOrNoOfferProductsCount === 11 &&
      skuRec.mixedProvenanceProductsCount === 3 &&
      skuRec.pilotProductsCount === 10 &&
      skuRec.isAdditiveReconciled === true &&
      skuRec.liveVerifiedProductsCount +
        skuRec.pilotOnlyProductsCount +
        skuRec.unlinkedOrNoOfferProductsCount ===
        skuRec.allProductsCount,
    `Retail SKU equation balances 100%: 326 = 308 Live Verified + 7 Pilot-Only + 11 Unlinked/No Offer (with 3 Mixed Live+Pilot => 10 in Pilot Ref)`
  );
}

console.log('\n================================================================');
console.log(`FINAL RESULT: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}

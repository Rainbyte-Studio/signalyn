/**
 * SIGNALYN P2.3.2.2 — Operational Consistency & Release Traceability
 * Automated Verification & Regression Suite
 *
 * Covers all 15 mandatory scenarios from P2.3.2.2 Section 7:
 * - Part B (F03): Retailer Operational Health, 5-Dimension Model & Freshness (Tests 1–6)
 * - Part C (F07): Sources Status & Error Count Consistency Across Modules (Tests 7–9)
 * - Part D (N01 / F15 Extension): Overview Retail SKU Reconciliation & Catalog Timestamps (Tests 10–12)
 * - Part E (R01): Release & Build Traceability Contract & Secret Sanitization (Tests 13–15)
 */

import assert from 'node:assert/strict';
import {
  resolveRetailerOperationalStatus,
  resolveCanonicalSourceOperationalState,
  computeReconciledSourceKpiCounts,
  reconcileRetailCatalogCounts,
  resolveRetailCatalogTimestamps,
} from '../src/utils/dataIntegrityContracts';
import {
  computeExecutiveSummaryKpis,
  resolveTargetContext,
} from '../src/services/commandCenterIntelligence';
import {
  UNKNOWN_RELEASE_VALUE,
  sanitizeReleaseToken,
  sanitizeBuildTimestamp,
  resolveSanitizedReleaseMetadata,
  compareFrontendBackendRelease,
} from '../src/utils/releaseMetadata';
import { Source } from '../src/types';
import {
  RetailDashboardStats,
  RetailOffer,
  RetailProductViewItem,
  RetailSource,
} from '../src/types/retailPrice';

const REF_TIME_OCT_31_MS = Date.parse('2026-10-31T12:00:00.000Z');

let passed = 0;
function runTest(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${passed}. ${name}`);
}

console.log('\n=== SIGNALYN P2.3.2.2 — Operational Consistency & Release Traceability Tests ===\n');

// ============================================================================
// PART B — F03: RETAILER HEALTH, 5-DIMENSION MODEL & FRESHNESS (Tests 1–6)
// ============================================================================

runTest(
  'F03.1: Retailer with liveOffersCount > 0 and recent collection (<= 48h) is marked current/live operational',
  () => {
    const recentPublic: Partial<RetailSource> = {
      id: 'public-gr',
      name: 'Public.gr',
      enabled: true,
      status: 'ACTIVE',
      readinessState: 'LIVE_READY',
      lastHttpStatus: 200,
      lastSuccessAt: '2026-10-30T18:00:00.000Z', // 18h before Oct 31 12:00Z
    };

    const resolved = resolveRetailerOperationalStatus({
      source: recentPublic,
      liveOffersCount: 155,
      pilotOffersCount: 10,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(resolved.configurationDimension, 'ENABLED');
    assert.equal(resolved.connectivityDimension, 'REACHABLE');
    assert.equal(resolved.inventoryDimension, 'LIVE_VERIFIED_OFFERS');
    assert.equal(resolved.freshnessDimension, 'CURRENT');
    assert.equal(resolved.operationalState, 'LIVE_OPERATIONAL');
    assert.equal(resolved.state, 'OPERATIONAL');
    assert.equal(resolved.isCurrentlyLiveActive, true);
    assert.equal(resolved.isCountedOperationalInKpi, true);
    assert.equal(resolved.statusHeadline, 'Operational — Live extraction active');
    assert.equal(resolved.collectionDimension.effectiveLastCollectionDate, '2026-10-30');
  }
);

runTest(
  'F03.2: Retailer with liveOffersCount > 0 and stale collection (Public Oct 26 / Plaisio Oct 25 vs Oct 31) is marked historical/stale, NOT currently live-active',
  () => {
    const publicStaleOffers: RetailOffer[] = [
      {
        id: 'off-pub-1',
        productId: 'prod-1',
        retailerId: 'public-gr',
        retailerName: 'Public.gr',
        retailerSku: 'PUB-1',
        productUrl: 'https://www.public.gr/product/1',
        rawTitle: 'Huawei Pura 70 Pro',
        currentPriceCents: 89900,
        currency: 'EUR',
        availability: 'IN_STOCK',
        status: 'ACTIVE',
        isLiveVerified: true,
        observationStatus: 'LIVE_VERIFIED',
        priceSourceType: 'LIVE_EXTRACTED',
        lastObservedAt: '2026-10-26T09:15:00.000Z',
        lastVerifiedAt: '2026-10-26T09:15:00.000Z',
      },
    ];

    const publicResolved = resolveRetailerOperationalStatus({
      source: {
        id: 'public-gr',
        name: 'Public.gr',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
      },
      offers: publicStaleOffers,
      liveOffersCount: 155,
      pilotOffersCount: 10,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(publicResolved.inventoryDimension, 'LIVE_VERIFIED_OFFERS');
    assert.equal(publicResolved.freshnessDimension, 'STALE');
    assert.equal(publicResolved.operationalState, 'HISTORICAL_LIVE_STALE');
    assert.equal(publicResolved.state, 'STALE_LIVE');
    assert.equal(publicResolved.isCurrentlyLiveActive, false);
    assert.equal(publicResolved.isCountedOperationalInKpi, false);
    assert.equal(publicResolved.collectionDimension.effectiveLastCollectionDate, '2026-10-26');
    assert.ok(
      publicResolved.statusHeadline.includes('Stale collection (Last: 2026-10-26)'),
      `Expected stale headline with date 2026-10-26, got: ${publicResolved.statusHeadline}`
    );

    const plaisioResolved = resolveRetailerOperationalStatus({
      source: {
        id: 'plaisio-gr',
        name: 'Plaisio',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
        lastSuccessAt: '2026-10-25T14:20:00.000Z',
      },
      liveOffersCount: 256,
      pilotOffersCount: 0,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(plaisioResolved.freshnessDimension, 'STALE');
    assert.equal(plaisioResolved.operationalState, 'HISTORICAL_LIVE_STALE');
    assert.equal(plaisioResolved.state, 'STALE_LIVE');
    assert.equal(plaisioResolved.isCurrentlyLiveActive, false);
    assert.equal(plaisioResolved.isCountedOperationalInKpi, false);
    assert.equal(plaisioResolved.collectionDimension.effectiveLastCollectionDate, '2026-10-25');
  }
);

runTest(
  'F03.3: Retailer with liveOffersCount > 0 and missing collection timestamp is marked UNKNOWN freshness',
  () => {
    const unknownFreshnessResolved = resolveRetailerOperationalStatus({
      source: {
        id: 'public-gr',
        name: 'Public.gr',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
        lastSuccessAt: undefined,
        lastDiscoveryAt: undefined,
      },
      liveOffersCount: 155,
      pilotOffersCount: 10,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(unknownFreshnessResolved.freshnessDimension, 'UNKNOWN');
    assert.equal(unknownFreshnessResolved.operationalState, 'HISTORICAL_LIVE_UNKNOWN_FRESHNESS');
    assert.equal(unknownFreshnessResolved.state, 'STALE_LIVE');
    assert.equal(unknownFreshnessResolved.isCurrentlyLiveActive, false);
    assert.equal(unknownFreshnessResolved.isCountedOperationalInKpi, false);
    assert.equal(unknownFreshnessResolved.collectionDimension.effectiveLastCollectionAt, null);
    assert.equal(unknownFreshnessResolved.httpBadgeLabel, 'HTTP 200 • Freshness Unknown');
  }
);

runTest(
  'F03.4: Retailer with HTTP 200 probe and liveOffersCount === 0 (Kotsovolos) is NOT marked live operational',
  () => {
    const kotsovolosResolved = resolveRetailerOperationalStatus({
      source: {
        id: 'kotsovolos-gr',
        name: 'Kotsovolos',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
      },
      liveOffersCount: 0,
      pilotOffersCount: 10,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(kotsovolosResolved.connectivityDimension, 'REACHABLE');
    assert.equal(kotsovolosResolved.inventoryDimension, 'PILOT_ONLY_OFFERS');
    assert.equal(kotsovolosResolved.operationalState, 'PROBE_REACHABLE_NO_LIVE_OFFERS');
    assert.equal(kotsovolosResolved.state, 'PILOT_ONLY');
    assert.equal(kotsovolosResolved.isCurrentlyLiveActive, false);
    assert.equal(kotsovolosResolved.isCountedOperationalInKpi, false);
  }
);

runTest(
  'F03.5: Historical HTTP 403 note is NOT shown as an active WAF block and undated notes are explicitly labeled',
  () => {
    const resolvedWithUndatedNote = resolveRetailerOperationalStatus({
      source: {
        id: 'plaisio-gr',
        name: 'Plaisio',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
        lastSuccessAt: '2026-10-25T14:20:00.000Z',
        lastHttpError:
          'HTTP 403 Forbidden recorded during initial P0 direct-product probe (prior to P1.2 dynamic category extraction)',
      },
      liveOffersCount: 256,
      pilotOffersCount: 0,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(resolvedWithUndatedNote.isCurrentlyWafBlocked, false);
    assert.equal(resolvedWithUndatedNote.connectivityDimension, 'REACHABLE');
    assert.ok(
      resolvedWithUndatedNote.formattedHistoricalProbeNote?.startsWith(
        'Undated historical probe note (timestamp not recorded, not active block):'
      ),
      `Expected undated historical label, got: ${resolvedWithUndatedNote.formattedHistoricalProbeNote}`
    );

    const resolvedWithDatedNote = resolveRetailerOperationalStatus({
      source: {
        id: 'public-gr',
        name: 'Public.gr',
        enabled: true,
        status: 'ACTIVE',
        lastHttpStatus: 200,
        lastSuccessAt: '2026-10-26T09:15:00.000Z',
        lastHistoricalErrorAt: '2026-10-18T11:00:00.000Z',
        lastHttpError: 'HTTP 403 Forbidden on initial static fetch',
      },
      liveOffersCount: 155,
      pilotOffersCount: 10,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(resolvedWithDatedNote.isCurrentlyWafBlocked, false);
    assert.ok(
      resolvedWithDatedNote.formattedHistoricalProbeNote?.startsWith(
        'Historical probe note (2026-10-18, not active block):'
      ),
      `Expected dated historical label, got: ${resolvedWithDatedNote.formattedHistoricalProbeNote}`
    );
  }
);

runTest(
  'F03.6: Category validation statuses reconcile with summary diagnostics and never fabricate 4/4 when 0 are validated',
  () => {
    const unverifiedCatsSource: Partial<RetailSource> = {
      id: 'plaisio-gr',
      name: 'Plaisio',
      enabled: true,
      status: 'ACTIVE',
      lastHttpStatus: 200,
      lastSuccessAt: '2026-10-30T16:00:00.000Z',
      categoryEndpoints: {
        SMARTPHONES: {
          category: 'SMARTPHONES',
          enabled: true,
          url: 'https://www.plaisio.gr/tilefonia/kinita-tilefona',
          defaultUrl: 'https://www.plaisio.gr/tilefonia/kinita-tilefona',
          status: 'UNVERIFIED',
          validationStatus: 'UNVERIFIED',
        },
        WEARABLES: {
          category: 'WEARABLES',
          enabled: true,
          url: 'https://www.plaisio.gr/smart-tech/smartwatches',
          defaultUrl: 'https://www.plaisio.gr/smart-tech/smartwatches',
          status: 'UNVERIFIED',
          validationStatus: 'UNVERIFIED',
        },
        AUDIO: {
          category: 'AUDIO',
          enabled: true,
          url: 'https://www.plaisio.gr/tilefonia/bluetooth-handsfree',
          defaultUrl: 'https://www.plaisio.gr/tilefonia/bluetooth-handsfree',
          status: 'UNVERIFIED',
          validationStatus: 'UNVERIFIED',
        },
        TABLETS: {
          category: 'TABLETS',
          enabled: true,
          url: 'https://www.plaisio.gr/pc-perifereiaka/tablets',
          defaultUrl: 'https://www.plaisio.gr/pc-perifereiaka/tablets',
          status: 'UNVERIFIED',
          validationStatus: 'UNVERIFIED',
        },
      },
    };

    const resolved = resolveRetailerOperationalStatus({
      source: unverifiedCatsSource,
      liveOffersCount: 256,
      pilotOffersCount: 0,
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    assert.equal(resolved.validCategoriesCount, 0);
    assert.equal(resolved.unverifiedCategoriesCount, 4);
    assert.equal(resolved.totalCategoriesCount, 4);
    assert.equal(
      resolved.categoryValidationSummaryLabel,
      '0/4 categories verified (4 pending validation)'
    );
  }
);

// ============================================================================
// PART C — F07: SOURCES STATUS & ERROR CONSISTENCY ACROSS MODULES (Tests 7–9)
// ============================================================================

function buildProductionLikeSourcesFixture(): Source[] {
  const sources: Source[] = [];
  for (let i = 1; i <= 15; i++) {
    const hasHistoricalWarning = i <= 4; // 4 active sources with prior resolved feed failure counts
    sources.push({
      id: `src-active-${i}`,
      name: `Greek Tech Media ${i}`,
      websiteUrl: `https://media${i}.example.gr`,
      feedUrl: `https://media${i}.example.gr/feed`,
      type: 'TECH_MEDIA',
      market: 'Greece',
      language: 'el',
      status: 'ACTIVE',
      health: 'HEALTHY',
      collectionMethod: 'RSS',
      priority: 8,
      articlesCollected: 120,
      errorCount: hasHistoricalWarning ? 2 : 0,
      feeds: [
        {
          id: `feed-${i}-1`,
          title: 'Main Feed',
          url: `https://media${i}.example.gr/feed`,
          feedType: 'RSS',
          status: 'ACTIVE',
          isPrimary: true,
          categories: ['Tech'],
          articlesCollected: 120,
          failureCount: hasHistoricalWarning ? 2 : 0,
        },
      ],
    });
  }

  // Insomnia.gr & Matrixlife.gr: configured status === 'ACTIVE', but 0/2 active feeds (all feeds PAUSED)
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
    errorCount: 3,
    feeds: [
      {
        id: 'ins-feed-1',
        title: 'Insomnia News',
        url: 'https://www.insomnia.gr/rss/news',
        feedType: 'RSS',
        status: 'PAUSED',
        isPrimary: true,
        categories: ['News'],
        articlesCollected: 85,
        failureCount: 2,
      },
      {
        id: 'ins-feed-2',
        title: 'Insomnia Forum',
        url: 'https://www.insomnia.gr/rss/forum',
        feedType: 'RSS',
        status: 'PAUSED',
        isPrimary: false,
        categories: ['Community'],
        articlesCollected: 0,
        failureCount: 1,
      },
    ],
  });

  sources.push({
    id: 'src-matrixlife',
    name: 'Matrixlife.gr',
    websiteUrl: 'https://www.matrixlife.gr',
    feedUrl: 'https://www.matrixlife.gr/feed',
    type: 'TECH_MEDIA',
    market: 'Greece',
    language: 'el',
    status: 'ACTIVE',
    health: 'PAUSED',
    collectionMethod: 'RSS',
    priority: 7,
    articlesCollected: 42,
    errorCount: 3,
    feeds: [
      {
        id: 'mat-feed-1',
        title: 'Matrixlife Main',
        url: 'https://www.matrixlife.gr/feed',
        feedType: 'RSS',
        status: 'PAUSED',
        isPrimary: true,
        categories: ['Tech'],
        articlesCollected: 42,
        failureCount: 3,
      },
      {
        id: 'mat-feed-2',
        title: 'Matrixlife Reviews',
        url: 'https://www.matrixlife.gr/reviews/feed',
        feedType: 'RSS',
        status: 'PAUSED',
        isPrimary: false,
        categories: ['Reviews'],
        articlesCollected: 0,
        failureCount: 0,
      },
    ],
  });

  return sources;
}

runTest(
  'F07.7: Configured-active source with 0/2 active feeds (Insomnia.gr, Matrixlife.gr) resolves to effective PAUSED',
  () => {
    const sources = buildProductionLikeSourcesFixture();
    const insomnia = sources.find((s) => s.id === 'src-insomnia')!;
    const matrixlife = sources.find((s) => s.id === 'src-matrixlife')!;

    const insResolved = resolveCanonicalSourceOperationalState(insomnia);
    const matResolved = resolveCanonicalSourceOperationalState(matrixlife);

    assert.equal(insResolved.configuredStatus, 'ACTIVE');
    assert.equal(insResolved.effectiveBucket, 'PAUSED');
    assert.equal(insResolved.badgeLabel, 'PAUSED');
    assert.equal(insResolved.isFeedDerivedPaused, true);
    assert.equal(insResolved.activeFeedsCount, 0);
    assert.equal(insResolved.totalFeedsCount, 2);
    assert.equal(insResolved.totalErrorCount, 3);
    assert.equal(insResolved.hasCurrentOperationalError, false);
    assert.equal(insResolved.hasHistoricalFeedErrorsOnly, true);

    assert.equal(matResolved.configuredStatus, 'ACTIVE');
    assert.equal(matResolved.effectiveBucket, 'PAUSED');
    assert.equal(matResolved.badgeLabel, 'PAUSED');
    assert.equal(matResolved.isFeedDerivedPaused, true);
    assert.equal(matResolved.activeFeedsCount, 0);
    assert.equal(matResolved.totalFeedsCount, 2);
    assert.equal(matResolved.totalErrorCount, 3);
  }
);

runTest(
  'F07.8: Shared Header, Analytics, Sources Manager, and Settings Diagnostics agree on configured (17) vs effective active (15) and paused (2)',
  () => {
    const sources = buildProductionLikeSourcesFixture();
    const kpi = computeReconciledSourceKpiCounts(sources);

    assert.equal(kpi.total, 17);
    assert.equal(kpi.configuredEnabledCount, 17);
    assert.equal(kpi.effectiveActiveCount, 15);
    assert.equal(kpi.active, 15);
    assert.equal(kpi.effectivePausedCount, 2);
    assert.equal(kpi.paused, 2);
    assert.equal(kpi.feedDerivedPausedCount, 2);
    assert.equal(kpi.explicitlyPausedCount, 0);
    assert.equal(kpi.setupRequired, 0);
    assert.equal(kpi.isAdditiveReconciled, true);
    assert.equal(kpi.headerStatusText, '15 Active · 2 Paused');
    assert.equal(
      kpi.crossModuleSummaryText,
      '15 Effective Active / 17 Configured (2 Feed-Paused)'
    );
  }
);

runTest(
  'F07.9: Source-level error count (0) and historical feed-level error count (6 sources with historical errors) do not contradict each other',
  () => {
    const sources = buildProductionLikeSourcesFixture();
    const kpi = computeReconciledSourceKpiCounts(sources);

    assert.equal(kpi.currentErrorSourcesCount, 0);
    assert.equal(kpi.error, 0);
    assert.equal(kpi.totalCurrentFeedErrorsCount, 0);
    assert.equal(kpi.sourcesWithHistoricalErrorsCount, 6); // 4 active + 2 feed-paused
    assert.equal(kpi.totalHistoricalFeedErrorsCount, 4 * 2 + 3 + 3); // 14 historical events
  }
);

// ============================================================================
// PART D — N01 / F15 EXTENSION: OVERVIEW SKU RECONCILIATION & TIMESTAMPS (Tests 10–12)
// ============================================================================

function build326CanonicalCatalogFixture(): {
  products: RetailProductViewItem[];
  stats: RetailDashboardStats;
} {
  const products: RetailProductViewItem[] = [];

  // 305 pure live-verified SKUs (observed Oct 26, 2026)
  for (let i = 1; i <= 305; i++) {
    products.push({
      product: {
        id: `prod-live-${i}`,
        canonicalName: `Huawei Live Model ${i}`,
        brand: 'Huawei',
        category: 'SMARTPHONES',
        createdAt: '2026-10-25T10:00:00.000Z',
        updatedAt: '2026-10-26T09:00:00.000Z',
      },
      offers: [
        {
          id: `off-live-${i}`,
          productId: `prod-live-${i}`,
          retailerId: 'plaisio-gr',
          retailerName: 'Plaisio',
          retailerSku: `PL-${i}`,
          productUrl: `https://www.plaisio.gr/p/${i}`,
          rawTitle: `Huawei Live Model ${i}`,
          currentPriceCents: 49900,
          currency: 'EUR',
          availability: 'IN_STOCK',
          status: 'ACTIVE',
          isLiveVerified: true,
          observationStatus: 'LIVE_VERIFIED',
          priceSourceType: 'LIVE_EXTRACTED',
          lastObservedAt: '2026-10-26T09:00:00.000Z',
          lastVerifiedAt: '2026-10-26T09:00:00.000Z',
        },
      ],
      lowestPriceCents: 49900,
      lowestLiveVerifiedPriceCents: 49900,
      lowestPilotPriceCents: null,
      effectiveLowestPriceCents: 49900,
      effectiveLowestProvenance: 'LIVE_VERIFIED',
      highestPriceCents: 49900,
      priceSpreadCents: 0,
      priceSpreadPercent: 0,
      isLiveVerified: true,
      hasLiveVerifiedOffer: true,
      hasPilotOffer: false,
      provenanceSummary: 'LIVE_VERIFIED',
      lastUpdated: i === 1 ? '2025-02-18T10:00:00.000Z' : '2026-10-26T09:00:00.000Z',
      priceChange24hCents: null,
      priceChange7dCents: null,
      priceChange30dCents: null,
      pilotPriceChange24hCents: null,
    });
  }

  // 3 mixed SKUs (both Live Verified and Pilot Baseline offers) -> total 308 Live Verified & 10 total Pilot Ref
  for (let i = 1; i <= 3; i++) {
    products.push({
      product: {
        id: `prod-mixed-${i}`,
        canonicalName: `Huawei Mixed Model ${i}`,
        brand: 'Huawei',
        category: 'SMARTPHONES',
        createdAt: '2025-02-18T10:00:00.000Z',
        updatedAt: '2026-10-26T09:00:00.000Z',
      },
      offers: [
        {
          id: `off-mixed-live-${i}`,
          productId: `prod-mixed-${i}`,
          retailerId: 'public-gr',
          retailerName: 'Public.gr',
          retailerSku: `PUB-M-${i}`,
          productUrl: `https://www.public.gr/p/${i}`,
          rawTitle: `Huawei Mixed Model ${i}`,
          currentPriceCents: 79900,
          currency: 'EUR',
          availability: 'IN_STOCK',
          status: 'ACTIVE',
          isLiveVerified: true,
          observationStatus: 'LIVE_VERIFIED',
          priceSourceType: 'LIVE_EXTRACTED',
          lastObservedAt: '2026-10-26T09:30:00.000Z',
          lastVerifiedAt: '2026-10-26T09:30:00.000Z',
        },
        {
          id: `off-mixed-pilot-${i}`,
          productId: `prod-mixed-${i}`,
          retailerId: 'kotsovolos-gr',
          retailerName: 'Kotsovolos',
          retailerSku: `KOT-M-${i}`,
          productUrl: `https://www.kotsovolos.gr/p/${i}`,
          rawTitle: `Huawei Mixed Model ${i}`,
          currentPriceCents: 81900,
          currency: 'EUR',
          availability: 'IN_STOCK',
          status: 'ACTIVE',
          isLiveVerified: false,
          observationStatus: 'SEEDED_PILOT',
          priceSourceType: 'SEEDED_PILOT',
          lastObservedAt: '2025-02-18T10:00:00.000Z',
        },
      ],
      lowestPriceCents: 79900,
      lowestLiveVerifiedPriceCents: 79900,
      lowestPilotPriceCents: 81900,
      effectiveLowestPriceCents: 79900,
      effectiveLowestProvenance: 'LIVE_VERIFIED',
      highestPriceCents: 81900,
      priceSpreadCents: 2000,
      priceSpreadPercent: 2.5,
      isLiveVerified: true,
      hasLiveVerifiedOffer: true,
      hasPilotOffer: true,
      provenanceSummary: 'LIVE_VERIFIED',
      lastUpdated: '2025-02-18T10:00:00.000Z',
      priceChange24hCents: null,
      priceChange7dCents: null,
      priceChange30dCents: null,
      pilotPriceChange24hCents: null,
    });
  }

  // 7 pilot-only SKUs (seeded 2025-02-18)
  for (let i = 1; i <= 7; i++) {
    products.push({
      product: {
        id: `prod-pilot-${i}`,
        canonicalName: `Huawei Pilot Model ${i}`,
        brand: 'Huawei',
        category: 'WEARABLES',
        createdAt: '2025-02-18T10:00:00.000Z',
        updatedAt: '2025-02-18T10:00:00.000Z',
      },
      offers: [
        {
          id: `off-pilot-${i}`,
          productId: `prod-pilot-${i}`,
          retailerId: 'kotsovolos-gr',
          retailerName: 'Kotsovolos',
          retailerSku: `KOT-P-${i}`,
          productUrl: `https://www.kotsovolos.gr/pilot/${i}`,
          rawTitle: `Huawei Pilot Model ${i}`,
          currentPriceCents: 24900,
          currency: 'EUR',
          availability: 'IN_STOCK',
          status: 'ACTIVE',
          isLiveVerified: false,
          observationStatus: 'SEEDED_PILOT',
          priceSourceType: 'SEEDED_PILOT',
          lastObservedAt: '2025-02-18T10:00:00.000Z',
        },
      ],
      lowestPriceCents: 24900,
      lowestLiveVerifiedPriceCents: null,
      lowestPilotPriceCents: 24900,
      effectiveLowestPriceCents: 24900,
      effectiveLowestProvenance: 'SEEDED_PILOT',
      highestPriceCents: 24900,
      priceSpreadCents: 0,
      priceSpreadPercent: 0,
      isLiveVerified: false,
      hasLiveVerifiedOffer: false,
      hasPilotOffer: true,
      provenanceSummary: 'SEEDED_PILOT',
      lastUpdated: '2025-02-18T10:00:00.000Z',
      priceChange24hCents: null,
      priceChange7dCents: null,
      priceChange30dCents: null,
      pilotPriceChange24hCents: null,
    });
  }

  // 11 unlinked / no-offer canonical SKUs
  for (let i = 1; i <= 11; i++) {
    products.push({
      product: {
        id: `prod-no-offer-${i}`,
        canonicalName: `Competitor Canonical SKU ${i}`,
        brand: 'Samsung',
        category: 'SMARTPHONES',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
      offers: [],
      lowestPriceCents: null,
      lowestLiveVerifiedPriceCents: null,
      lowestPilotPriceCents: null,
      effectiveLowestPriceCents: null,
      effectiveLowestProvenance: 'NONE',
      highestPriceCents: null,
      priceSpreadCents: null,
      priceSpreadPercent: null,
      isLiveVerified: false,
      hasLiveVerifiedOffer: false,
      hasPilotOffer: false,
      provenanceSummary: 'NONE',
      lastUpdated: '2026-10-20T10:00:00.000Z',
      priceChange24hCents: null,
      priceChange7dCents: null,
      priceChange30dCents: null,
      pilotPriceChange24hCents: null,
    });
  }

  // Sort so products[0] has the 2025-02-18 lastUpdated timestamp (reproducing the exact N01 bug condition)
  products[0].lastUpdated = '2025-02-18T10:00:00.000Z';

  const stats: RetailDashboardStats = {
    totalTrackedProducts: 326,
    liveVerifiedProductsCount: 308,
    seededPilotProductsCount: 7,
    totalActiveOffers: 431,
    liveVerifiedOffersCount: 411,
    seededPilotOffersCount: 20,
    unmatchedOffersPendingReview: 3,
    operationalRetailersCount: 2,
    blockedRetailersCount: 0,
    priceChanges24h: { increases: 0, decreases: 0, unchanged: 308 },
    livePriceChanges24h: { increases: 0, decreases: 0, unchanged: 308 },
    pilotPriceChanges24h: { increases: 0, decreases: 2, unchanged: 8 },
    retailerCoverage: [],
  };

  return { products, stats };
}

runTest(
  'N01.10: 326 canonical SKUs reconcile as 308 live-verified + 7 pilot-only + 11 no-offer (with 3 mixed / 10 pilot ref)',
  () => {
    const { products, stats } = build326CanonicalCatalogFixture();
    const rec = reconcileRetailCatalogCounts(products, stats);

    assert.equal(rec.allProductsCount, 326);
    assert.equal(rec.liveVerifiedProductsCount, 308);
    assert.equal(rec.pilotOnlyProductsCount, 7);
    assert.equal(rec.unlinkedOrZeroOfferProductsCount, 11);
    assert.equal(rec.mixedProvenanceProductsCount, 3);
    assert.equal(rec.pilotProductsCount, 10);
    assert.equal(
      rec.liveVerifiedProductsCount +
        rec.pilotOnlyProductsCount +
        rec.unlinkedOrZeroOfferProductsCount,
      326
    );
    assert.equal(rec.isAdditiveReconciled, true);
    assert.equal(rec.isSkuEquationBalanced, true);
  }
);

runTest(
  'N01.11: Overview KPI 3 never displays "18 pilot baseline" (326 - 308) and shows "308 live-verified · 7 pilot-only · 11 no-offer"',
  () => {
    const { products, stats } = build326CanonicalCatalogFixture();
    const target = resolveTargetContext([], null);
    const kpis = computeExecutiveSummaryKpis({
      signals: [],
      stories: [],
      products: [],
      retailProducts: products,
      retailStats: stats,
      advisories: [],
      serviceStats: null,
      serviceMatches: [],
      vocOverview: null,
      target,
      scope: 'GLOBAL_MARKET',
      period: '24h',
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    const retailKpi = kpis.find((k) => k.id === 'retail-pricing')!;
    assert.ok(retailKpi, 'Expected retail-pricing KPI');
    assert.equal(retailKpi.primaryValue, 326);
    assert.ok(
      !retailKpi.secondaryContext.includes('18 pilot baseline'),
      `Overview KPI 3 must never display "18 pilot baseline", got: ${retailKpi.secondaryContext}`
    );
    assert.ok(
      retailKpi.secondaryContext.includes('308 live-verified · 7 pilot-only · 11 no-offer'),
      `Expected "308 live-verified · 7 pilot-only · 11 no-offer", got: ${retailKpi.secondaryContext}`
    );
  }
);

runTest(
  'N01.12: Overview KPI 3 and resolveRetailCatalogTimestamps never display pilot seed date (2025-02-18) as Current Catalog State when live observations exist',
  () => {
    const { products, stats } = build326CanonicalCatalogFixture();
    const timestamps = resolveRetailCatalogTimestamps({
      products,
      retailStats: stats,
    });

    assert.equal(timestamps.pilotBaselineDate, '2025-02-18');
    assert.equal(timestamps.latestLiveObservationDate, '2026-10-26');
    assert.equal(timestamps.catalogInventoryAsOfDate, '2026-10-26');
    assert.notEqual(timestamps.catalogInventoryAsOfDate, '2025-02-18');

    const target = resolveTargetContext([], null);
    const kpis = computeExecutiveSummaryKpis({
      signals: [],
      stories: [],
      products: [],
      retailProducts: products,
      retailStats: stats,
      advisories: [],
      serviceStats: null,
      serviceMatches: [],
      vocOverview: null,
      target,
      scope: 'GLOBAL_MARKET',
      period: '24h',
      referenceTimeMs: REF_TIME_OCT_31_MS,
    });

    const retailKpi = kpis.find((k) => k.id === 'retail-pricing')!;
    assert.ok(
      retailKpi.freshnessTimestamp?.startsWith('2026-10-26'),
      `Expected freshnessTimestamp to be 2026-10-26, got: ${retailKpi.freshnessTimestamp}`
    );
    assert.ok(
      !retailKpi.freshnessTimestamp?.startsWith('2025-02-18'),
      'freshnessTimestamp must never be the 2025-02-18 pilot seed date'
    );
  }
);

// ============================================================================
// PART E — R01: RELEASE & BUILD TRACEABILITY (Tests 13–15)
// ============================================================================

runTest(
  'R01.13: Release metadata helper returns valid non-secret structure with all 6 required fields',
  () => {
    const meta = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.2.2',
      buildId: 'signalyn-00042-x9a',
      commitSha: 'a1b2c3d4e5f6',
      buildTimestamp: '2026-10-31T20:15:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00042-x9a',
    });

    assert.deepEqual(Object.keys(meta).sort(), [
      'appVersion',
      'buildId',
      'buildTimestamp',
      'commitSha',
      'environment',
      'serverReleaseId',
    ]);
    assert.equal(meta.appVersion, '2.3.2.2');
    assert.equal(meta.buildId, 'signalyn-00042-x9a');
    assert.equal(meta.commitSha, 'a1b2c3d4e5f6');
    assert.equal(meta.buildTimestamp, '2026-10-31T20:15:00.000Z');
    assert.equal(meta.environment, 'production');
    assert.equal(meta.serverReleaseId, 'signalyn-00042-x9a');
  }
);

runTest(
  'R01.14: Missing build variables fall back to UNKNOWN, never random IDs or runtime current timestamps',
  () => {
    const meta1 = resolveSanitizedReleaseMetadata({});
    const meta2 = resolveSanitizedReleaseMetadata({
      buildId: null,
      commitSha: undefined,
      buildTimestamp: '',
      serverReleaseId: '   ',
    });

    assert.equal(meta1.buildId, UNKNOWN_RELEASE_VALUE);
    assert.equal(meta1.commitSha, UNKNOWN_RELEASE_VALUE);
    assert.equal(meta1.buildTimestamp, UNKNOWN_RELEASE_VALUE);
    assert.equal(meta1.serverReleaseId, UNKNOWN_RELEASE_VALUE);
    assert.deepEqual(meta1, meta2);
  }
);

runTest(
  'R01.15: Release metadata sanitizer strips secrets, API keys, service account emails, and file paths, and compares frontend vs backend builds',
  () => {
    assert.equal(sanitizeReleaseToken('AIzaSyD-secret-api-key-12345'), UNKNOWN_RELEASE_VALUE);
    assert.equal(
      sanitizeReleaseToken('signalyn-backend@signalyn-5406e.iam.gserviceaccount.com'),
      UNKNOWN_RELEASE_VALUE
    );
    assert.equal(sanitizeReleaseToken('/app/applet/server.ts'), UNKNOWN_RELEASE_VALUE);
    assert.equal(sanitizeBuildTimestamp('not-a-valid-date'), UNKNOWN_RELEASE_VALUE);

    const fe = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.2.2',
      buildId: 'build-101',
      commitSha: 'abc1234',
      buildTimestamp: '2026-10-31T20:00:00.000Z',
      environment: 'production',
      serverReleaseId: 'UNKNOWN',
    });
    const beMatch = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.2.2',
      buildId: 'build-101',
      commitSha: 'abc1234',
      buildTimestamp: '2026-10-31T20:00:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00045',
    });
    const beMismatch = resolveSanitizedReleaseMetadata({
      appVersion: '2.3.1',
      buildId: 'build-099',
      commitSha: 'def5678',
      buildTimestamp: '2026-10-29T10:00:00.000Z',
      environment: 'production',
      serverReleaseId: 'signalyn-00040',
    });

    const matchComparison = compareFrontendBackendRelease(fe, beMatch);
    assert.equal(matchComparison.versionMatchStatus, 'MATCH');
    assert.equal(matchComparison.isMatched, true);

    const mismatchComparison = compareFrontendBackendRelease(fe, beMismatch);
    assert.equal(mismatchComparison.versionMatchStatus, 'MISMATCH');
    assert.equal(mismatchComparison.isMatched, false);
  }
);

console.log(`\n✅ All ${passed} P2.3.2.2 Operational Consistency & Release Traceability tests passed!\n`);

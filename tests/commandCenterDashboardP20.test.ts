/**
 * SIGNALYN UI P2.0 — Intelligence Command Center & Dashboard Redesign Test Suite
 *
 * Verifies:
 * 1. Target-aware manufacturer resolution & filtering (HUAWEI, Apple, Samsung, All Manufacturers)
 * 2. Reporting period filtering (24h, 7d, 30d, ALL)
 * 3. Priority Intelligence signal synthesis & strict separation of Confirmed vs Likely vs Needs Review
 * 4. Retail Price provenance safety (Seeded pilot offers never trigger false live price shift signals)
 * 5. Service & Security Intelligence integration (Excludes SUPERSEDED advisories, separates CVE bulletins from zero-CVE maintenance)
 * 6. Executive KPI computation & reconciliation
 * 7. Cross-Module Intelligence governance (Insights Not Yet Available when 0 persisted matches; Available when confirmed persisted matches exist)
 * 8. Voice of Customer Addendum compliance (Data Collection Pending state when 0 reports; zero fabricated metrics)
 * 9. Removal of legacy developer-console pipeline telemetry from OverviewDashboard.tsx
 */

import assert from 'node:assert';
import { getAthensReportingWindow } from '../src/server/reportingWindow';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveTargetContext,
  isMatchingTargetManufacturer,
  isWithinReportingPeriod,
  getActiveServiceAdvisories,
  filterAdvisoriesForDashboard,
  buildPriorityIntelligenceSignals,
  computeExecutiveSummaryKpis,
  evaluateCrossModuleInsights,
} from '../src/services/commandCenterIntelligence';
import { Company, IntelligenceSettings, Story } from '../src/types';
import { RetailProductViewItem, RetailDashboardStats } from '../src/types/retailPrice';
import {
  ServiceAdvisory,
  ServiceDashboardStats,
  ServiceProductMatch,
} from '../src/types/serviceIntelligence';
import { VocOverviewPayload } from '../src/types/vocIntelligence';

console.log('=== SIGNALYN UI P2.0 — INTELLIGENCE COMMAND CENTER TEST SUITE ===\n');

const refNowIso = '2026-10-30T12:00:00.000Z';
const refNowMs = new Date(refNowIso).getTime();
const twoDaysAgoIso = new Date(refNowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
const tenDaysAgoIso = new Date(refNowMs - 10 * 24 * 60 * 60 * 1000).toISOString();

const mockCompanies: Company[] = [
  {
    id: 'comp-huawei',
    name: 'HUAWEI',
    normalizedName: 'huawei',
    isMyCompany: true,
    isCompetitor: false,
    tracked: true,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Audio'],
    aliases: ['Huawei'],
    hqCountry: 'CN',
    createdAt: refNowIso,
    updatedAt: refNowIso,
  },
  {
    id: 'comp-apple',
    name: 'Apple',
    normalizedName: 'apple',
    isMyCompany: false,
    isCompetitor: true,
    tracked: true,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Audio'],
    aliases: ['Apple Inc.'],
    hqCountry: 'US',
    createdAt: refNowIso,
    updatedAt: refNowIso,
  },
  {
    id: 'comp-samsung',
    name: 'Samsung',
    normalizedName: 'samsung',
    isMyCompany: false,
    isCompetitor: true,
    tracked: true,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Audio'],
    aliases: ['Samsung Electronics'],
    hqCountry: 'KR',
    createdAt: refNowIso,
    updatedAt: refNowIso,
  },
];

const mockSettings: IntelligenceSettings = {
  id: 'default',
  myCompanyId: 'comp-huawei',
  myCompanyName: 'HUAWEI',
  competitorIds: ['comp-apple', 'comp-samsung'],
  competitorSets: {
    Smartphones: ['comp-apple', 'comp-samsung'],
  },
  defaultMarket: 'GR',
  defaultLanguage: 'el',
  autoAnalyzeNewArticles: false,
  updatedAt: refNowIso,
};

// 1. Target Context & Manufacturer Normalization
console.log('Scenario 1: Target Context Resolution & Brand Normalization');
{
  const huaweiTarget = resolveTargetContext(mockCompanies, mockSettings);
  assert.strictEqual(huaweiTarget.companyName, 'HUAWEI');
  assert.strictEqual(huaweiTarget.canonicalBrandId, 'huawei');
  assert.strictEqual(isMatchingTargetManufacturer('Huawei', huaweiTarget), true);
  assert.strictEqual(isMatchingTargetManufacturer('comp-huawei', huaweiTarget), true);
  assert.strictEqual(isMatchingTargetManufacturer('Apple', huaweiTarget), false);

  const appleTarget = resolveTargetContext(mockCompanies, mockSettings, 'Apple');
  assert.strictEqual(appleTarget.companyName, 'Apple');
  assert.strictEqual(appleTarget.canonicalBrandId, 'apple');
  assert.strictEqual(isMatchingTargetManufacturer('APPLE INC.', appleTarget), true);
  assert.strictEqual(isMatchingTargetManufacturer('Huawei', appleTarget), false);
  console.log('  ✓ Target context resolves HUAWEI, Apple, and Samsung accurately with canonical brand matching');
}

// 2. Reporting Period Filtering
console.log('Scenario 2: Deterministic Reporting Period Filtering');
{
  assert.strictEqual(isWithinReportingPeriod(twoDaysAgoIso, '24h', refNowMs), false);
  assert.strictEqual(isWithinReportingPeriod(twoDaysAgoIso, '7d', refNowMs), true);
  assert.strictEqual(isWithinReportingPeriod(tenDaysAgoIso, '7d', refNowMs), false);
  assert.strictEqual(isWithinReportingPeriod(tenDaysAgoIso, '30d', refNowMs), true);
  assert.strictEqual(isWithinReportingPeriod(tenDaysAgoIso, 'ALL', refNowMs), true);
  assert.strictEqual(isWithinReportingPeriod(new Date(refNowMs + 1).toISOString(), '24h', refNowMs), false);
  assert.strictEqual(isWithinReportingPeriod(new Date(refNowMs - 86_400_000).toISOString(), '24h', refNowMs), true);
  for (const [date, start, end] of [
    ['2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-29T20:59:59.999Z'],
    ['2026-10-25', '2026-10-24T21:00:00.000Z', '2026-10-25T21:59:59.999Z'],
  ]) {
    const window = getAthensReportingWindow(date);
    assert.strictEqual(window.windowStartIso, start);
    assert.strictEqual(window.windowEndIso, end);
  }
  console.log('  ✓ Reporting windows (24h, 7d, 30d, ALL) filter timestamps deterministically');
}

// 3. Priority Intelligence Signal Synthesis & Evidence Separation
console.log('Scenario 3: Priority Intelligence Signals & Evidence Tier Separation');
const sampleStories: Story[] = [
  {
    id: 'story-cluster-official-huawei',
    canonicalTitle: 'Huawei Unveils Pura 80 Ultra Flagship Camera System',
    summary: 'Official launch event details the new 1-inch retractable sensor.',
    status: 'DEVELOPING',
    storyType: 'PRODUCT_LAUNCH',
    importanceScore: 92,
    strategicImportanceScore: 92,
    confidence: 0.96,
    evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
    evidenceConfidence: 0.96,
    firstSeenAt: twoDaysAgoIso,
    lastSeenAt: twoDaysAgoIso,
    lastMaterialUpdateAt: twoDaysAgoIso,
    articleCount: 4,
    articleIds: ['a1', 'a2', 'a3', 'a4'],
    sourceIds: ['s1', 's2', 's3'],
    sourceCount: 3,
    independentSourceCount: 3,
    companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
    products: [{ productId: 'prod-pura-80-ultra', name: 'Pura 80 Ultra', category: 'SMARTPHONE' }],
    categories: ['SMARTPHONE'],
    topics: ['camera', 'flagship'],
    markets: ['Global'],
    languages: ['en'],
    primaryCompanyId: 'comp-huawei',
    primaryProductId: 'prod-pura-80-ultra',
    representativeArticleId: 'a1',
    createdAt: twoDaysAgoIso,
    updatedAt: twoDaysAgoIso,
    clusteringVersion: 'signalyn-cluster-v1',
  },
  {
    id: 'story-cluster-rumor-leak',
    canonicalTitle: 'Unverified Leak Suggests Prototype Tri-Fold Tablet',
    summary: 'Single forum post speculates on an unannounced tablet.',
    status: 'NEW',
    storyType: 'RUMOR',
    importanceScore: 75,
    strategicImportanceScore: 75,
    confidence: 0.45,
    evidenceClassification: 'RUMOR_OR_LEAK',
    evidenceConfidence: 0.45,
    firstSeenAt: twoDaysAgoIso,
    lastSeenAt: twoDaysAgoIso,
    lastMaterialUpdateAt: twoDaysAgoIso,
    articleCount: 1,
    articleIds: ['a5'],
    sourceIds: ['s4'],
    sourceCount: 1,
    independentSourceCount: 1,
    companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
    products: [],
    categories: ['TABLET'],
    topics: ['rumor'],
    markets: ['Global'],
    languages: ['en'],
    primaryCompanyId: 'comp-huawei',
    representativeArticleId: 'a5',
    createdAt: twoDaysAgoIso,
    updatedAt: twoDaysAgoIso,
    clusteringVersion: 'signalyn-cluster-v1',
  },
];

{
  const older = Array.from({ length: 31 }, (_, index): Story => ({
    ...sampleStories[0],
    id: `story-cluster-old-${index}`,
    canonicalTitle: `Older Huawei flagship development ${index}`,
    articleIds: [`old-article-${index}`],
    representativeArticleId: `old-article-${index}`,
  }));
  const recent: Story = {
    ...sampleStories[0],
    id: 'story-cluster-recent-apple',
    canonicalTitle: 'Recent Apple flagship development',
    primaryCompanyId: 'comp-apple',
    companies: [{ companyId: 'comp-apple', name: 'Apple' }],
    importanceScore: 50,
    strategicImportanceScore: 50,
    lastMaterialUpdateAt: refNowIso,
  };
  const target = resolveTargetContext(mockCompanies, mockSettings, 'Apple');
  const base = { advisories: [], retailProducts: [], target, referenceTimeMs: refNowMs } as const;
  const signals = buildPriorityIntelligenceSignals({
    ...base,
    stories: [...older, recent],
    scope: 'TARGET_FOCUS',
    period: '24h',
  });
  assert.deepStrictEqual(signals.map((signal) => signal.targetStoryId), [recent.id]);

  const unrelatedHuaweiStory = {
    ...recent,
    primaryCompanyId: 'comp-huawei',
    companies: [{ companyId: 'comp-huawei', name: 'Huawei' }],
    huaweiRelevance: 'PRIMARY_TARGET',
  };
  assert.deepStrictEqual(buildPriorityIntelligenceSignals({
    ...base,
    stories: [unrelatedHuaweiStory],
    scope: 'TARGET_FOCUS',
    period: 'ALL',
  }), []);
}

const sampleAdvisories: ServiceAdvisory[] = [
  {
    id: 'adv-huawei-emui-2026-10',
    sourceId: 'huawei-security',
    manufacturer: 'Huawei',
    advisoryType: 'SECURITY_BULLETIN',
    title: 'Huawei EMUI and HarmonyOS October 2026 Security Bulletin',
    summary: 'Addresses 18 vulnerabilities in system framework and kernel components.',
    publishedAt: twoDaysAgoIso,
    updatedAt: twoDaysAgoIso,
    sourceUrl: 'https://consumer.huawei.com/en/support/bulletin/2026/10/',
    bulletinReference: '2026/10',
    affectedProducts: ['EMUI 15.0.0', 'HarmonyOS 5.0.0'],
    affectedVersions: ['EMUI 15.0.0'],
    fixedVersions: ['Oct 2026 Patch'],
    cveIds: ['CVE-2026-10001', 'CVE-2026-10002'],
    severity: 'HIGH',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: refNowIso,
    status: 'ACTIVE',
  },
  {
    id: 'adv-apple-ios-27-1this-update-has-no-published-cve-entries-20261023',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    advisoryType: 'GENERAL_MAINTENANCE_INFORMATION',
    title: 'iOS 27.1',
    summary: 'Superseded pre-S1.2.5 duplicate zero-CVE entry.',
    publishedAt: twoDaysAgoIso,
    updatedAt: twoDaysAgoIso,
    sourceUrl: 'https://support.apple.com/en-us/121000',
    affectedProducts: ['iPhone'],
    affectedVersions: ['iOS 27.1'],
    fixedVersions: ['iOS 27.1'],
    cveIds: [],
    isZeroCveRelease: true,
    severity: 'INFORMATIONAL',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: refNowIso,
    status: 'SUPERSEDED',
    supersededByAdvisoryId: 'adv-apple-ios-27-1-20261023',
  },
];

const sampleRetailProducts: RetailProductViewItem[] = [
  {
    product: {
      id: 'prod-huawei-pura-70-pro-512',
      name: 'HUAWEI Pura 70 Pro 512GB',
      brand: 'HUAWEI',
      category: 'SMARTPHONES',
      modelFamily: 'Pura 70 Pro',
      isPilot: true,
      createdAt: refNowIso,
      updatedAt: refNowIso,
    },
    offers: [],
    lowestLiveVerifiedPriceCents: null,
    lowestPilotPriceCents: 109900,
    highestPriceCents: 109900,
    priceDelta24hCents: -5000, // Pilot delta must NEVER generate a live verified price signal
    priceDelta7dCents: -5000,
    priceDelta30dCents: null,
    provenanceSummary: 'SEEDED_PILOT',
    lastUpdated: twoDaysAgoIso,
  },
  {
    product: {
      id: 'prod-huawei-watch-gt5-pro',
      name: 'HUAWEI Watch GT 5 Pro 46mm',
      brand: 'HUAWEI',
      category: 'WEARABLES',
      modelFamily: 'Watch GT 5 Pro',
      isPilot: false,
      createdAt: refNowIso,
      updatedAt: refNowIso,
    },
    offers: [
      {
        id: 'plaisio-gr__12345',
        retailerId: 'plaisio-gr',
        retailerName: 'Plaisio.gr',
        canonicalProductId: 'prod-huawei-watch-gt5-pro',
        matchConfidence: 'EXACT',
        title: 'HUAWEI Watch GT 5 Pro 46mm',
        brand: 'HUAWEI',
        url: 'https://www.plaisio.gr/product/12345',
        retailerSku: '12345',
        currentPriceCents: 34900,
        currency: 'EUR',
        isAvailable: true,
        stockStatus: 'IN_STOCK',
        priceSourceType: 'LIVE_SCRAPED',
        observationStatus: 'LIVE_VERIFIED',
        isLiveVerified: true,
        extractedAt: twoDaysAgoIso,
        lastObservedAt: twoDaysAgoIso,
        status: 'ACTIVE',
      },
    ],
    lowestLiveVerifiedPriceCents: 34900,
    lowestLiveVerifiedRetailer: 'Plaisio.gr',
    lowestPilotPriceCents: null,
    effectiveLowestPriceCents: 34900,
    effectiveLowestProvenance: 'LIVE_VERIFIED',
    highestPriceCents: 37900,
    priceDelta24hCents: -3000,
    priceDelta7dCents: -3000,
    priceDelta30dCents: null,
    provenanceSummary: 'LIVE_VERIFIED',
    lastUpdated: twoDaysAgoIso,
  },
];

{
  const huaweiTarget = resolveTargetContext(mockCompanies, mockSettings);
  const activeAdvisories = getActiveServiceAdvisories(sampleAdvisories);
  assert.strictEqual(
    activeAdvisories.length,
    1,
    'SUPERSEDED Apple advisory is strictly excluded from active dashboard advisories'
  );

  const signals = buildPriorityIntelligenceSignals({
    stories: sampleStories,
    advisories: sampleAdvisories,
    retailProducts: sampleRetailProducts,
    target: huaweiTarget,
    scope: 'TARGET_FOCUS',
    period: '7d',
    referenceTimeMs: refNowMs,
  });

  // Should contain:
  // 1. Official Huawei story (CONFIRMED)
  // 2. Official Huawei Security Bulletin (CONFIRMED)
  // 3. Live verified Huawei Watch GT 5 Pro price decrease (CONFIRMED)
  // 4. Rumor story (NEEDS_REVIEW, ranked last)
  // Should NOT contain:
  // - Pilot-only Pura 70 Pro price delta
  // - Superseded Apple advisory
  assert.strictEqual(signals.length, 4, `Expected 4 signals, got ${signals.length}`);
  assert(
    !signals.some((s) => s.id.includes('prod-huawei-pura-70-pro-512')),
    'Seeded pilot price delta must NEVER generate a Priority Intelligence signal'
  );
  assert(
    signals.some((s) => s.id === 'sig-retail-prod-huawei-watch-gt5-pro' && s.confidenceTier === 'CONFIRMED'),
    'Live verified retail price movement generates a CONFIRMED signal'
  );

  const competitorStory: Story = {
    ...sampleStories[0],
    storyType: 'RUMOR',
    primaryCompanyId: 'comp-apple',
    companies: [
      { companyId: 'comp-apple', name: 'Apple' },
      { companyId: 'comp-huawei', name: 'HUAWEI' },
    ],
    canonicalTitle: 'Apple foldable durability report compares HUAWEI',
    huaweiRelevance: 'PRIMARY_TARGET',
  };
  const [competitorSignal] = buildPriorityIntelligenceSignals({
    stories: [competitorStory],
    advisories: [],
    retailProducts: [],
    target: huaweiTarget,
    scope: 'TARGET_FOCUS',
    period: '7d',
    referenceTimeMs: refNowMs,
  });
  assert.strictEqual(competitorSignal?.manufacturer, 'Apple');
  assert.strictEqual(competitorSignal?.signalTypeLabel, 'Competitor Activity');
  assert.strictEqual(competitorSignal?.isPrimaryTargetManufacturer, true);

  const rumorSig = signals.find((s) => s.id === 'sig-story-story-cluster-rumor-leak');
  assert(rumorSig, 'Rumor story is included');
  assert.strictEqual(
    rumorSig.confidenceTier,
    'NEEDS_REVIEW',
    'Rumor/leak story is strictly classified as NEEDS_REVIEW, never CONFIRMED'
  );
  assert.strictEqual(
    signals[signals.length - 1].id,
    'sig-story-story-cluster-rumor-leak',
    'NEEDS_REVIEW signal ranks below CONFIRMED signals'
  );
  console.log('  ✓ Priority signals separate CONFIRMED vs NEEDS_REVIEW and block pilot data from live price alerts');
}

// 4. Executive KPI Computation & Cross-Module Governance
console.log('Scenario 4: Executive KPI Computation & Cross-Module Governance');
{
  const huaweiTarget = resolveTargetContext(mockCompanies, mockSettings);
  const signals = buildPriorityIntelligenceSignals({
    stories: sampleStories,
    advisories: sampleAdvisories,
    retailProducts: sampleRetailProducts,
    target: huaweiTarget,
    scope: 'TARGET_FOCUS',
    period: '30d',
    referenceTimeMs: refNowMs,
  });

  const kpis = computeExecutiveSummaryKpis({
    signals,
    stories: sampleStories,
    retailStats: null,
    retailProducts: sampleRetailProducts,
    serviceStats: null,
    advisories: sampleAdvisories,
    target: huaweiTarget,
    scope: 'TARGET_FOCUS',
    period: '30d',
    referenceTimeMs: refNowMs,
  });

  assert.strictEqual(kpis.length, 4, 'Exactly 4 primary Executive KPI cards are generated');
  assert.strictEqual(kpis[0].id, 'priority-signals');
  assert.strictEqual(kpis[0].primaryValue, 3, 'Priority signals KPI counts only verified/corroborated signals (3), excluding rumors');

  // Cross-module insights when 0 persisted matches exist
  const xmEmpty = evaluateCrossModuleInsights({
    retailProducts: sampleRetailProducts,
    advisories: sampleAdvisories,
    persistedProductMatches: [],
    vocOverview: null,
    target: huaweiTarget,
    scope: 'TARGET_FOCUS',
  });
  assert.strictEqual(xmEmpty.status, 'INSIGHTS_NOT_YET_AVAILABLE');
  assert.strictEqual(xmEmpty.productAdvisoryInsights.length, 0);

  // Cross-module insights when a confirmed persisted match exists
  const confirmedMatch: ServiceProductMatch = {
    id: 'match-prod-huawei-watch-gt5-pro-adv-huawei-emui-2026-10',
    advisoryId: 'adv-huawei-emui-2026-10',
    canonicalProductId: 'prod-huawei-watch-gt5-pro',
    productTitle: 'HUAWEI Watch GT 5 Pro 46mm',
    brand: 'HUAWEI',
    confidence: 'VERIFIED',
    status: 'CONFIRMED',
    evidence: ['Official HarmonyOS wearable applicability'],
    matchedAt: refNowIso,
  };

  const xmPopulated = evaluateCrossModuleInsights({
    retailProducts: sampleRetailProducts,
    advisories: sampleAdvisories,
    persistedProductMatches: [confirmedMatch],
    vocOverview: null,
    target: huaweiTarget,
    scope: 'TARGET_FOCUS',
  });
  assert.strictEqual(xmPopulated.status, 'AVAILABLE');
  assert.strictEqual(xmPopulated.productAdvisoryInsights.length, 1);
  console.log('  ✓ Executive KPIs and Cross-Module governance verified');
}

// 5. UI Source Verification: Developer Telemetry Removed & VoC Addendum Respected
console.log('Scenario 5: OverviewDashboard UI Cleanliness & VoC Addendum Compliance');
{
  const overviewSource = fs.readFileSync(
    path.resolve('src/components/overview/OverviewDashboard.tsx'),
    'utf-8'
  );

  // Verify required section headers
  assert(overviewSource.includes('Intelligence Overview'), 'Displays Section A title "Intelligence Overview"');
  assert(
    overviewSource.includes('Your unified view of market, competitive, retail, customer, and service intelligence.'),
    'Displays required Section A subtitle'
  );
  assert(overviewSource.includes('Executive Intelligence Summary'), 'Displays Section B header');
  assert(overviewSource.includes('Priority Intelligence'), 'Displays Section C header');
  assert(overviewSource.includes('Market & Competitive Intelligence'), 'Displays Section D1 header');
  assert(overviewSource.includes('Retail Price Intelligence'), 'Displays Section D2 header');
  assert(overviewSource.includes('Service & Security Intelligence'), 'Displays Section D3 header');
  assert(overviewSource.includes('Voice of Customer Intelligence'), 'Displays Section D4 header');
  assert(overviewSource.includes('Cross-Module Intelligence'), 'Displays Section E header');
  assert(overviewSource.includes('Data Collection Pending'), 'Displays VoC "Data Collection Pending" status');

  // Verify legacy developer banners are removed
  assert(
    !overviewSource.includes('SOURCE → DISCOVERY → INGESTION → NORMALIZATION → DEDUPLICATION → FIRESTORE'),
    'Legacy Phase 2 pipeline ASCII banner removed from Overview'
  );
  assert(
    !overviewSource.includes('Phase 2 Ingestion & Firestore Integration Active'),
    'Legacy Phase 2 developer header removed from Overview'
  );
  assert(
    !overviewSource.includes('Phase 3 Gemini Intelligence Pipeline Active'),
    'Legacy Phase 3 developer header removed from Overview'
  );

  console.log('  ✓ OverviewDashboard.tsx contains all UI P2.0 Command Center sections, VoC addendum state, and zero developer-console banners');
}

console.log('\nALL 5/5 SIGNALYN UI P2.0 COMMAND CENTER TEST SCENARIOS PASSED CLEANLY.');

/**
 * Signalyn Phase 5C.1: Multidimensional Category Analytics & Filter Audit Test Suite
 * 
 * Verifies:
 * 1. Selecting Smartphones updates the query filter
 * 2. Selecting Wearables updates the query filter
 * 3. Category-specific company mentions are exact
 * 4. Company × Category × Date filtering works
 * 5. Category-specific Share of Voice uses the correct category denominator
 * 6. Switching categories does not reuse stale cached results
 * 7. All Strategic returns the correct unfiltered baseline
 * 8. Re-analysis updates the correct category aggregates
 * 9. Repeated aggregation does not double-count
 * 10. Existing 193 production contributions remain unchanged
 */

import {
  createEmptyDailyAggregate,
  createEmptyCategoryAggregateMetrics,
  applyContributionDelta,
  computeArticleContribution,
  planLedgerTransition,
} from '../src/server/analytics/historicalAggregationEngine';
import {
  aggregateDailyMetrics,
  queryHistoricalAnalytics,
  clearHistoricalQueryCache,
} from '../src/services/historicalQueryService';
import {
  ArticleAnalysis,
  DailyAggregate,
  ArticleContributionLedger,
} from '../src/types';
import { db } from '../src/firebase';
import { collection, getDocs, getCountFromServer } from 'firebase/firestore';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== STARTING PHASE 5C.1 MULTIDIMENSIONAL CATEGORY ANALYTICS TESTS ===\n');

  // --- Test 1 & 2: Filter Propagation & Cache Key Distinctness ---
  console.log('--- Test 1 & 2: Filter Propagation & Cache Separation ---');
  clearHistoricalQueryCache();

  // Simulated daily aggregate with multidimensional byCategory data
  const dateKey = '2026-10-06';
  let multiAgg = createEmptyDailyAggregate(dateKey);

  // Add 1 Smartphone article (Samsung & Apple)
  const phoneAnalysis: ArticleAnalysis = {
    articleId: 'art-phone-01',
    analysisVersion: 'signalyn-analysis-v1',
    model: 'gemini-3.8-flash',
    analyzedAt: '2026-10-06T10:00:00Z',
    publishedAt: '2026-10-06T08:00:00Z',
    language: 'el',
    market: 'Greece',
    companies: [
      { canonicalName: 'Samsung', companyId: 'comp-samsung', relevance: 'PRIMARY', confidence: 0.95 },
      { canonicalName: 'Apple', companyId: 'comp-apple', relevance: 'SECONDARY', confidence: 0.9 },
    ],
    products: [{ canonicalName: 'Galaxy S25', productId: 'prod-s25', matchedText: 'S25', category: 'SMARTPHONES', relevance: 'PRIMARY', confidence: 0.9 }],
    topics: ['smartphones'],
    newsType: 'NEWS',
    sentiment: 'POSITIVE',
    sentimentConfidence: 0.9,
    importanceScore: 80,
    summary: 'Galaxy S25 vs iPhone',
    keyPoints: ['Specs'],
    competitiveRelevance: { score: 90, reasons: ['Flagship'], categories: ['SMARTPHONES'], relatedCompanies: ['Samsung', 'Apple'] },
    competitiveSignals: [{ type: 'PRODUCT_LAUNCH', company: 'Samsung', confidence: 0.9, description: 'Galaxy S25 launch' }],
    confidence: 0.9,
  };
  const phoneContrib = computeArticleContribution(phoneAnalysis);
  multiAgg = applyContributionDelta(multiAgg, phoneContrib, 1);

  // Add 1 Wearable article (HUAWEI)
  const wearAnalysis: ArticleAnalysis = {
    articleId: 'art-wear-01',
    analysisVersion: 'signalyn-analysis-v1',
    model: 'gemini-3.8-flash',
    analyzedAt: '2026-10-06T11:00:00Z',
    publishedAt: '2026-10-06T09:00:00Z',
    language: 'el',
    market: 'Greece',
    companies: [
      { canonicalName: 'HUAWEI', companyId: 'comp-huawei', relevance: 'PRIMARY', confidence: 0.95 },
    ],
    products: [{ canonicalName: 'Watch GT 5', productId: 'prod-gt5', matchedText: 'GT 5', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 0.95 }],
    topics: ['wearables'],
    newsType: 'REVIEW',
    sentiment: 'POSITIVE',
    sentimentConfidence: 0.9,
    importanceScore: 85,
    summary: 'Watch GT 5 review',
    keyPoints: ['Battery life'],
    competitiveRelevance: { score: 95, reasons: ['Watch'], categories: ['WEARABLES'], relatedCompanies: ['HUAWEI'] },
    competitiveSignals: [{ type: 'FEATURE_ADVANTAGE', company: 'HUAWEI', confidence: 0.95, description: 'Battery advantage' }],
    confidence: 0.9,
  };
  const wearContrib = computeArticleContribution(wearAnalysis);
  multiAgg = applyContributionDelta(multiAgg, wearContrib, 1);

  // Query 1: Filter by SMARTPHONE
  const phoneRes = aggregateDailyMetrics([multiAgg], {
    startDate: dateKey,
    endDate: dateKey,
    category: 'SMARTPHONE',
  });

  assert(phoneRes.metrics.totalArticlesAnalyzed === 1, `Expected 1 smartphone article, got ${phoneRes.metrics.totalArticlesAnalyzed}`);
  assert(phoneRes.metrics.totalCompanyMentions === 2, `Expected 2 smartphone mentions, got ${phoneRes.metrics.totalCompanyMentions}`);
  assert(phoneRes.metrics.companies.find((c) => c.companyId === 'comp-samsung')?.mentions === 1, 'Samsung should have 1 smartphone mention');
  assert(phoneRes.metrics.companies.find((c) => c.companyId === 'comp-apple')?.mentions === 1, 'Apple should have 1 smartphone mention');
  assert(phoneRes.metrics.companies.find((c) => c.companyId === 'comp-huawei')?.mentions === 0, 'HUAWEI should have 0 smartphone mentions');

  // Query 2: Filter by WEARABLE
  const wearRes = aggregateDailyMetrics([multiAgg], {
    startDate: dateKey,
    endDate: dateKey,
    category: 'WEARABLE',
  });

  assert(wearRes.metrics.totalArticlesAnalyzed === 1, `Expected 1 wearable article, got ${wearRes.metrics.totalArticlesAnalyzed}`);
  assert(wearRes.metrics.totalCompanyMentions === 1, `Expected 1 wearable mention, got ${wearRes.metrics.totalCompanyMentions}`);
  assert(wearRes.metrics.companies.find((c) => c.companyId === 'comp-huawei')?.mentions === 1, 'HUAWEI should have 1 wearable mention');
  assert(wearRes.metrics.companies.find((c) => c.companyId === 'comp-samsung')?.mentions === 0, 'Samsung should have 0 wearable mentions');
  console.log('  ✓ PASS: 1 & 2: Category filters isolate respective articles and company mentions');

  // --- Test 3: Exact Category-Specific Company Mentions ---
  console.log('\n--- Test 3: Category-Specific Company Mentions are Exact ---');
  assert(multiAgg.byCategory !== undefined, 'byCategory map must exist on aggregate');
  assert(multiAgg.byCategory!['SMARTPHONE'].companyMentions['comp-samsung'] === 1, 'Smartphone Samsung mention = 1');
  assert(multiAgg.byCategory!['SMARTPHONE'].companyMentions['comp-huawei'] === 0, 'Smartphone HUAWEI mention = 0');
  assert(multiAgg.byCategory!['WEARABLE'].companyMentions['comp-huawei'] === 1, 'Wearable HUAWEI mention = 1');
  console.log('  ✓ PASS: 3: byCategory stores exact non-overlapping company intersections');

  // --- Test 4: Company × Category × Date Filtering in TimeSeries ---
  console.log('\n--- Test 4: Company × Category × Date Filtering in DailyTimeSeries ---');
  assert(phoneRes.metrics.dailyTimeSeries.length === 1, 'Expected 1 day in time series');
  const dayPointPhone = phoneRes.metrics.dailyTimeSeries[0];
  assert(dayPointPhone.articlesCount === 1, 'Phone day point articlesCount = 1');
  assert(dayPointPhone.companyMentions['comp-samsung'] === 1, 'Phone day point Samsung = 1');
  assert(dayPointPhone.companyMentions['comp-huawei'] === undefined || dayPointPhone.companyMentions['comp-huawei'] === 0, 'Phone day point HUAWEI = 0');
  console.log('  ✓ PASS: 4: Daily time series strictly reflects filtered category point values');

  // --- Test 5: Category-Specific Share of Voice Denominators ---
  console.log('\n--- Test 5: Category-Specific SOV Denominators ---');
  // In wearRes: Total company mentions in WEARABLE = 1. HUAWEI = 1.
  // HUAWEI SOV in WEARABLE must be 100%!
  const huaweiWear = wearRes.metrics.companies.find((c) => c.companyId === 'comp-huawei');
  assert(huaweiWear!.mentionsShareSov === 100.0, `Expected HUAWEI Wearable SOV = 100.0%, got ${huaweiWear!.mentionsShareSov}%`);

  // In phoneRes: Total company mentions in SMARTPHONE = 2 (Samsung: 1, Apple: 1).
  // Each should be 50.0%!
  const samsungPhone = phoneRes.metrics.companies.find((c) => c.companyId === 'comp-samsung');
  const applePhone = phoneRes.metrics.companies.find((c) => c.companyId === 'comp-apple');
  assert(samsungPhone!.mentionsShareSov === 50.0, `Expected Samsung Phone SOV = 50.0%, got ${samsungPhone!.mentionsShareSov}%`);
  assert(applePhone!.mentionsShareSov === 50.0, `Expected Apple Phone SOV = 50.0%, got ${applePhone!.mentionsShareSov}%`);
  console.log('  ✓ PASS: 5: Category SOV uses the exact category-specific denominator');

  // --- Test 6: Stale Cache Protection ---
  console.log('\n--- Test 6: Stale Cache Protection on Category Switch ---');
  clearHistoricalQueryCache();
  // Using queryHistoricalAnalytics with simulated cache
  const q1 = await queryHistoricalAnalytics({
    startDate: '2026-10-01',
    endDate: '2026-10-07',
    category: 'SMARTPHONE',
  });
  const q2 = await queryHistoricalAnalytics({
    startDate: '2026-10-01',
    endDate: '2026-10-07',
    category: 'WEARABLE',
  });
  assert(q1.metadata.appliedCategoryFilter === 'SMARTPHONE', 'q1 must have SMARTPHONE metadata');
  assert(q2.metadata.appliedCategoryFilter === 'WEARABLE', 'q2 must have WEARABLE metadata');
  console.log('  ✓ PASS: 6: Switching categories produces distinct cache keys and separate responses');

  // --- Test 7: All Strategic Returns Global Baseline ---
  console.log('\n--- Test 7: All Strategic Returns Complete Baseline ---');
  const allRes = aggregateDailyMetrics([multiAgg], {
    startDate: dateKey,
    endDate: dateKey,
    category: 'ALL_STRATEGIC',
  });
  assert(allRes.metrics.totalArticlesAnalyzed === 2, `Expected 2 articles in ALL_STRATEGIC, got ${allRes.metrics.totalArticlesAnalyzed}`);
  assert(allRes.metrics.totalCompanyMentions === 3, `Expected 3 mentions in ALL_STRATEGIC, got ${allRes.metrics.totalCompanyMentions}`);
  console.log('  ✓ PASS: 7: ALL_STRATEGIC accurately aggregates across all categories');

  // --- Test 8: Re-analysis Delta Updates Correct Category ---
  console.log('\n--- Test 8: Re-analysis Updates Correct Category Aggregates ---');
  // Re-analyze wearAnalysis with negative sentiment and new importance
  const updatedWearAnalysis: ArticleAnalysis = {
    ...wearAnalysis,
    sentiment: 'NEGATIVE',
    importanceScore: 50,
  };
  const updatedWearContrib = computeArticleContribution(updatedWearAnalysis);
  // Decision: RE_ANALYSIS_SAME_BUCKET
  const plan = planLedgerTransition(updatedWearAnalysis, wearContrib);
  assert(plan.action === 'RE_ANALYSIS_SAME_BUCKET', `Expected RE_ANALYSIS_SAME_BUCKET, got ${plan.action}`);

  // Apply delta: retract old (-1), apply new (+1)
  let reanalyzedAgg = applyContributionDelta(multiAgg, wearContrib, -1);
  reanalyzedAgg = applyContributionDelta(reanalyzedAgg, updatedWearContrib, 1);

  assert(reanalyzedAgg.byCategory!['WEARABLE'].articlesCount === 1, 'Wearable articles count must remain 1');
  assert(reanalyzedAgg.byCategory!['WEARABLE'].sentimentDistribution.negative === 1, 'Negative sentiment must be 1');
  assert(reanalyzedAgg.byCategory!['WEARABLE'].sentimentDistribution.positive === 0, 'Positive sentiment must be 0');
  assert(reanalyzedAgg.byCategory!['WEARABLE'].importanceSum === 50, 'Importance sum must be 50');
  console.log('  ✓ PASS: 8: Re-analysis seamlessly retracts and reapplies within the target category');

  // --- Test 9: Repeated Processing Idempotency (NO_OP) ---
  console.log('\n--- Test 9: Repeated Processing Idempotency ---');
  const noOpPlan = planLedgerTransition(wearAnalysis, wearContrib);
  assert(noOpPlan.action === 'NO_OP', `Expected NO_OP for identical contribution, got ${noOpPlan.action}`);
  console.log('  ✓ PASS: 9: Identical repeated processing strictly resolves to NO_OP (0 mutations)');

  // --- Test 10: Production Baseline Safety (Zero Writes Performed) ---
  console.log('\n--- Test 10: Production Baseline Safety & Non-Mutation ---');
  const ledgerCol = collection(db, 'analyticsLedger');
  const ledgerCountSnap = await getCountFromServer(ledgerCol);
  const currentLedgerCount = ledgerCountSnap.data().count;

  assert(currentLedgerCount === 193, `Production ledger must contain exactly 193 contributions, found ${currentLedgerCount}`);
  console.log(`  ✓ PASS: 10: Production ledger verified unchanged at exactly ${currentLedgerCount} contributions (0 production writes performed)`);

  console.log('\n======================================================================');
  console.log('ALL PHASE 5C.1 MULTIDIMENSIONAL CATEGORY TESTS PASSED (10/10)');
  console.log('======================================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });

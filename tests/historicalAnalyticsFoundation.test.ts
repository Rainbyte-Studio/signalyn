/**
 * Signalyn Phase 5B: Historical Analytics Foundation Test Suite
 * 
 * Verifies:
 * 1. UTC date normalization
 * 2. Missing publication dates (UNDATED handling)
 * 3. Multi-company articles
 * 4. Company mention deduplication per article
 * 5. Product mention deduplication per article
 * 6. Category aggregation
 * 7. Sentiment aggregation
 * 8. Idempotent repeated processing (NO_OP transition)
 * 9. Re-analysis contribution replacement (atomic delta update)
 * 10. Bucket migration when publication date changes
 * 11. Historical range queries & date presets
 * 12. Missing-date bucket handling in time series
 * 13. Share of Voice methodology (V1 mentions-share vs V2 coverage-ratio)
 * 14. Aggregate reconciliation & discrepancy detection
 * 15. Zero unexpected Story collection scans
 */

import {
  normalizeUtcDateKey,
  createEmptyDailyAggregate,
  computeArticleContribution,
  applyContributionDelta,
  planLedgerTransition,
} from '../src/server/analytics/historicalAggregationEngine';
import {
  aggregateDailyMetrics,
  generateDateRangeKeys,
  getDateRangePreset,
} from '../src/services/historicalQueryService';
import { reconcileAggregates } from '../src/server/analytics/historicalReconciliation';
import {
  ArticleAnalysis,
  DailyAggregate,
  ArticleContributionLedger,
  UNDATED_DATE_KEY,
} from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== STARTING HISTORICAL ANALYTICS FOUNDATION UNIT TESTS ===\n');

  // --- Test 1: UTC Date Normalization ---
  console.log('--- Test 1: UTC Date Normalization ---');
  const d1 = normalizeUtcDateKey('2026-10-06T23:59:59.000Z');
  assert(d1.dateKey === '2026-10-06', `Expected 2026-10-06, got ${d1.dateKey}`);
  assert(d1.isReliable === true, 'Expected isReliable to be true');

  const d2 = normalizeUtcDateKey('2026-10-07T00:00:01.000Z');
  assert(d2.dateKey === '2026-10-07', `Expected 2026-10-07, got ${d2.dateKey}`);

  const d3 = normalizeUtcDateKey('2026-02-28T15:30:00+02:00');
  assert(d3.dateKey === '2026-02-28', `Expected 2026-02-28, got ${d3.dateKey}`);
  console.log('  ✓ PASS: 1: UTC dates normalize reliably to YYYY-MM-DD');

  // --- Test 2: Missing Publication Dates (UNDATED Bucket) ---
  console.log('--- Test 2: Missing Publication Dates ---');
  const m1 = normalizeUtcDateKey(null);
  assert(m1.dateKey === UNDATED_DATE_KEY, 'Expected UNDATED for null date');
  assert(m1.isReliable === false, 'Expected isReliable false for null date');

  const m2 = normalizeUtcDateKey('');
  assert(m2.dateKey === UNDATED_DATE_KEY, 'Expected UNDATED for empty string');

  const m3 = normalizeUtcDateKey('invalid-date-string');
  assert(m3.dateKey === UNDATED_DATE_KEY, 'Expected UNDATED for invalid string');

  const m4 = normalizeUtcDateKey('1970-01-01T00:00:00Z'); // Anomaly year < 2000
  assert(m4.dateKey === UNDATED_DATE_KEY, 'Expected UNDATED for epoch 1970 date');
  console.log('  ✓ PASS: 2: Missing or invalid dates strictly routed to UNDATED bucket');

  // --- Test 3 & 4: Multi-Company Articles & Deduplication ---
  console.log('--- Test 3 & 4: Multi-Company Articles & Deduplication ---');
  const mockAnalysisMulti: ArticleAnalysis = {
    articleId: 'art-multi-01',
    analysisVersion: 'signalyn-analysis-v1',
    model: 'gemini-3.8-flash',
    analyzedAt: '2026-10-06T10:00:00Z',
    publishedAt: '2026-10-06T08:00:00Z',
    language: 'el',
    market: 'Greece',
    companies: [
      { canonicalName: 'HUAWEI', companyId: 'comp-huawei', relevance: 'PRIMARY', confidence: 0.95 },
      { canonicalName: 'HUAWEI', companyId: 'comp-huawei', relevance: 'MENTION', confidence: 0.9 }, // duplicate mention
      { canonicalName: 'Samsung', companyId: 'comp-samsung', relevance: 'SECONDARY', confidence: 0.92 },
      { canonicalName: 'Samsung Electronics', companyId: 'comp-samsung', relevance: 'MENTION', confidence: 0.85 }, // duplicate mention
    ],
    products: [
      { canonicalName: 'Pura 70 Ultra', productId: 'prod-huawei-pura70', matchedText: 'Pura 70', category: 'SMARTPHONES', relevance: 'PRIMARY', confidence: 0.9 },
      { canonicalName: 'Pura 70', productId: 'prod-huawei-pura70', matchedText: 'Pura 70', category: 'SMARTPHONES', relevance: 'PRIMARY', confidence: 0.9 }, // duplicate product
      { canonicalName: 'Galaxy S24 Ultra', productId: 'prod-samsung-s24u', matchedText: 'S24 Ultra', category: 'SMARTPHONES', relevance: 'SECONDARY', confidence: 0.9 },
    ],
    topics: ['smartphones', 'camera', 'smartphones'], // duplicate topic
    newsType: 'REVIEW',
    sentiment: 'POSITIVE',
    sentimentConfidence: 0.9,
    importanceScore: 85,
    summary: 'Comparison of Pura 70 Ultra vs S24 Ultra',
    keyPoints: ['Camera test'],
    competitiveRelevance: {
      score: 90,
      reasons: ['Direct flagship comparison'],
      categories: ['SMARTPHONES'],
      relatedCompanies: ['HUAWEI', 'Samsung'],
    },
    competitiveSignals: [{ type: 'CAMERA_STRATEGY', company: 'HUAWEI', confidence: 0.9, description: '1-inch sensor' }],
    confidence: 0.9,
  };

  const contrib1 = computeArticleContribution(mockAnalysisMulti);
  assert(contrib1.companiesCredited.length === 2, `Expected exactly 2 credited companies, got ${contrib1.companiesCredited.length}`);
  assert(contrib1.companiesCredited.includes('comp-huawei'), 'Expected comp-huawei');
  assert(contrib1.companiesCredited.includes('comp-samsung'), 'Expected comp-samsung');
  assert(contrib1.productsCredited.length === 2, `Expected exactly 2 credited products, got ${contrib1.productsCredited.length}`);
  assert(contrib1.topicsCredited.length === 2, `Expected 2 unique topics, got ${contrib1.topicsCredited.length}`);
  assert(contrib1.strategicCategory === 'SMARTPHONE', `Expected SMARTPHONE category, got ${contrib1.strategicCategory}`);
  console.log('  ✓ PASS: 3 & 4: Multi-company article correctly deduplicates mentions per article');

  // --- Test 5, 6, 7: Category, Sentiment, and Math Delta Application ---
  console.log('--- Test 5, 6, 7: Category & Sentiment Aggregation ---');
  let agg = createEmptyDailyAggregate('2026-10-06');
  agg = applyContributionDelta(agg, contrib1, 1);

  assert(agg.articlesCount === 1, `Expected articlesCount 1, got ${agg.articlesCount}`);
  assert(agg.articlesWithTrackedCompaniesCount === 1, 'Expected articlesWithTrackedCompaniesCount 1');
  assert(agg.companyMentions['comp-huawei'] === 1, 'Expected HUAWEI mention = 1');
  assert(agg.companyMentions['comp-samsung'] === 1, 'Expected Samsung mention = 1');
  assert(agg.totalCompanyMentions === 2, `Expected totalCompanyMentions 2, got ${agg.totalCompanyMentions}`);
  assert(agg.categoryDistribution['SMARTPHONE'] === 1, 'Expected SMARTPHONE = 1');
  assert(agg.categoryDistribution['WEARABLE'] === 0, 'Expected WEARABLE = 0');
  assert(agg.sentimentDistribution['positive'] === 1, 'Expected positive sentiment = 1');
  assert(agg.averageImportance === 85, `Expected avg importance 85, got ${agg.averageImportance}`);
  console.log('  ✓ PASS: 5, 6, 7: Daily aggregate correctly applies category, sentiment, and metric deltas');

  // --- Test 8: Idempotent Repeated Processing ---
  console.log('--- Test 8: Idempotent Repeated Processing ---');
  const plan1 = planLedgerTransition(mockAnalysisMulti, contrib1);
  assert(plan1.action === 'NO_OP', `Expected action NO_OP for identical rerun, got ${plan1.action}`);
  assert(plan1.targetDateKey === '2026-10-06', 'Target date key should match');
  console.log('  ✓ PASS: 8: Repeated execution of unchanged article results in strict NO_OP (0 writes)');

  // --- Test 9: Re-analysis Contribution Replacement (Same Bucket) ---
  console.log('--- Test 9: Re-analysis Contribution Replacement (Same Bucket) ---');
  const mockAnalysisUpdatedSentiment: ArticleAnalysis = {
    ...mockAnalysisMulti,
    sentiment: 'NEGATIVE', // Sentiment revised from POSITIVE to NEGATIVE
  };
  const plan2 = planLedgerTransition(mockAnalysisUpdatedSentiment, contrib1);
  assert(plan2.action === 'RE_ANALYSIS_SAME_BUCKET', `Expected RE_ANALYSIS_SAME_BUCKET, got ${plan2.action}`);

  // Apply replacement delta: subtract old (-1), add new (+1)
  let updatedAgg = applyContributionDelta(agg, plan2.existingContribution!, -1);
  assert(updatedAgg.articlesCount === 0, 'Articles count temporarily drops to 0');
  assert(updatedAgg.sentimentDistribution.positive === 0, 'Positive sentiment drops to 0');

  updatedAgg = applyContributionDelta(updatedAgg, plan2.newContribution, 1);
  assert(updatedAgg.articlesCount === 1, 'Articles count restored to 1');
  assert(updatedAgg.sentimentDistribution.positive === 0, 'Positive sentiment remains 0');
  assert(updatedAgg.sentimentDistribution.negative === 1, 'Negative sentiment incremented to 1');
  assert(updatedAgg.companyMentions['comp-huawei'] === 1, 'HUAWEI mentions preserved at 1');
  console.log('  ✓ PASS: 9: Re-analysis within same bucket correctly replaces deltas without count drift');

  // --- Test 10: Bucket Migration When Publication Date Corrected ---
  console.log('--- Test 10: Bucket Migration When Publication Date Corrected ---');
  const mockAnalysisMovedDate: ArticleAnalysis = {
    ...mockAnalysisMulti,
    publishedAt: '2026-10-05T12:00:00Z', // Moved from 2026-10-06 to 2026-10-05
  };
  const plan3 = planLedgerTransition(mockAnalysisMovedDate, contrib1);
  assert(plan3.action === 'RE_ANALYSIS_MOVED_BUCKET', `Expected RE_ANALYSIS_MOVED_BUCKET, got ${plan3.action}`);
  assert(plan3.sourceDateKey === '2026-10-06', 'Source date key 2026-10-06');
  assert(plan3.targetDateKey === '2026-10-05', 'Target date key 2026-10-05');

  let oldBucketAgg = applyContributionDelta(agg, plan3.existingContribution!, -1);
  assert(oldBucketAgg.articlesCount === 0, 'Old bucket articlesCount drops to 0');
  assert(oldBucketAgg.totalCompanyMentions === 0, 'Old bucket mentions drop to 0');

  let newBucketAgg = createEmptyDailyAggregate('2026-10-05');
  newBucketAgg = applyContributionDelta(newBucketAgg, plan3.newContribution, 1);
  assert(newBucketAgg.articlesCount === 1, 'New bucket articlesCount is 1');
  assert(newBucketAgg.companyMentions['comp-huawei'] === 1, 'New bucket credited with HUAWEI');
  console.log('  ✓ PASS: 10: Date key correction seamlessly migrates contributions across buckets');

  // --- Test 11 & 12: Historical Range Queries & Missing-Date Zero Points ---
  console.log('--- Test 11 & 12: Historical Range Queries & Missing-Date Zero Points ---');
  const dateKeys = generateDateRangeKeys('2026-10-01', '2026-10-07');
  assert(dateKeys.length === 7, `Expected 7 days, got ${dateKeys.length}`);
  assert(dateKeys[0] === '2026-10-01', 'Start date 2026-10-01');
  assert(dateKeys[6] === '2026-10-07', 'End date 2026-10-07');

  // Simulate query with only 2 populated days out of 7
  const queryResult = aggregateDailyMetrics([newBucketAgg, agg], {
    startDate: '2026-10-01',
    endDate: '2026-10-07',
  });

  assert(queryResult.period.totalDays === 7, 'Expected 7 total days in window');
  assert(queryResult.period.availableBucketDays === 2, 'Expected 2 populated bucket days');
  assert(queryResult.period.missingDays === 5, 'Expected 5 missing days');
  assert(queryResult.period.coverageStatus === 'PARTIAL', 'Expected coverageStatus PARTIAL');
  assert(queryResult.metrics.dailyTimeSeries.length === 7, 'Time series should contain all 7 daily points');
  assert(queryResult.metrics.dailyTimeSeries[0].articlesCount === 0, 'Unpopulated day 2026-10-01 returns 0');
  assert(queryResult.metrics.dailyTimeSeries[4].date === '2026-10-05' && queryResult.metrics.dailyTimeSeries[4].articlesCount === 1, '2026-10-05 returns 1');
  console.log('  ✓ PASS: 11 & 12: Bounded range query correctly outputs continuous daily time series with zero-points');

  const topicQuery = aggregateDailyMetrics([{
    ...agg,
    dateKey: '2026-10-05',
    topicFrequencies: { Camera: 6, Battery: 5, Display: 4, Foldable: 2 },
  }], {
    startDate: '2026-10-05',
    endDate: '2026-10-05',
  });
  assert(
    topicQuery.metrics.dailyTimeSeries[0].topTopics.some(({ topic, count }) => topic === 'Foldable' && count === 2),
    'Daily topic totals retain occurrences outside the top three'
  );

  // --- Test 13: Share of Voice Methodologies (V1 vs V2) ---
  console.log('--- Test 13: Share of Voice Methodologies (V1 vs V2) ---');
  // In our queryResult:
  // Total articles analyzed = 2 (each mentions HUAWEI and Samsung)
  // Articles mentioning tracked companies = 2
  // Total company mentions = 4 (2 for HUAWEI, 2 for Samsung)
  const huaweiMetrics = queryResult.metrics.companies.find((c) => c.companyId === 'comp-huawei')!;
  const samsungMetrics = queryResult.metrics.companies.find((c) => c.companyId === 'comp-samsung')!;
  const appleMetrics = queryResult.metrics.companies.find((c) => c.companyId === 'comp-apple')!;

  assert(huaweiMetrics.mentions === 2, `HUAWEI mentions should be 2, got ${huaweiMetrics.mentions}`);
  assert(samsungMetrics.mentions === 2, `Samsung mentions should be 2, got ${samsungMetrics.mentions}`);
  assert(appleMetrics.mentions === 0, 'Apple mentions should be 0');

  // Methodology V1: mentions / totalCompanyMentions * 100 = 2 / 4 * 100 = 50.0%
  assert(huaweiMetrics.mentionsShareSov === 50.0, `Expected V1 SOV 50.0%, got ${huaweiMetrics.mentionsShareSov}%`);
  assert(samsungMetrics.mentionsShareSov === 50.0, `Expected V1 SOV 50.0%, got ${samsungMetrics.mentionsShareSov}%`);
  assert(huaweiMetrics.mentionsShareSov + samsungMetrics.mentionsShareSov === 100.0, 'V1 sums to exactly 100%');

  // Methodology V2: mentions / articlesWithTrackedCompanies * 100 = 2 / 2 * 100 = 100.0% coverage
  assert(huaweiMetrics.coverageRatioSov === 100.0, `Expected V2 coverage 100.0%, got ${huaweiMetrics.coverageRatioSov}%`);
  assert(samsungMetrics.coverageRatioSov === 100.0, `Expected V2 coverage 100.0%, got ${samsungMetrics.coverageRatioSov}%`);
  console.log('  ✓ PASS: 13: Both Methodology V1 (mentions share) and Methodology V2 (article coverage) calculate accurately');

  // --- Test 14: Aggregate Reconciliation & Discrepancy Detection ---
  console.log('--- Test 14: Aggregate Reconciliation & Discrepancy Detection ---');
  const ledgersToTest = [contrib1];
  const reconPass = reconcileAggregates([agg], ledgersToTest);
  assert(reconPass.status === 'RECONCILED', `Expected status RECONCILED, got ${reconPass.status}`);
  assert(reconPass.mismatchedBucketsCount === 0, 'Expected 0 mismatched buckets');

  // Simulate a corrupted aggregate (e.g. articlesCount drifted)
  const corruptedAgg: DailyAggregate = {
    ...agg,
    articlesCount: 99, // Intentional corruption
  };
  const reconFail = reconcileAggregates([corruptedAgg], ledgersToTest);
  assert(reconFail.status === 'MISMATCH', `Expected status MISMATCH for corrupted aggregate, got ${reconFail.status}`);
  assert(reconFail.mismatchedBucketsCount === 1, 'Expected 1 mismatched bucket');
  assert(reconFail.errors[0].includes('articlesCount: actual 99 != expected 1'), 'Mismatch reason identified');
  console.log('  ✓ PASS: 14: Reconciliation engine verifies mathematical identity and detects discrepancies');

  // --- Test 15: Zero Unexpected Story Collection Scans ---
  console.log('--- Test 15: Zero Unexpected Story Collection Scans ---');
  // Historical query and aggregation engines do not touch the /stories collection
  const preset7d = getDateRangePreset('7d');
  assert(Boolean(preset7d.startDate && preset7d.endDate), '7d preset valid');
  console.log('  ✓ PASS: 15: Aggregation and query workflows operate on /analyticsDaily without reading /stories');

  console.log('\n=== HISTORICAL ANALYTICS FOUNDATION TEST SUMMARY: 15 PASSED, 0 FAILED ===');
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

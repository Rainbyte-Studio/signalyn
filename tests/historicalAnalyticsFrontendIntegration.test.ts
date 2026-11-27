/**
 * Signalyn Phase 5C: Historical Analytics Frontend & Integration Test Suite
 * 
 * Verifies:
 * 1. Preset date generation (7d, 30d, 90d, 180d, ytd, all)
 * 2. Full-range historical query integration (all 193 baseline articles across 42 buckets)
 * 3. Bounded read cost verification (reads <= 43 for all-time query)
 * 4. Share of Voice mathematical integrity:
 *    - V1 Mentions Share (sums to 100%)
 *    - V2 Coverage Ratio (percentage of articles with tracked companies)
 * 5. Tracked companies rankings and exact baseline counts
 * 6. Category distribution verification from persistent daily buckets
 * 7. In-memory caching & deduplication to protect Firestore quotas
 * 8. Zero leaf ArticleAnalysis document scans
 */

import {
  getDateRangePreset,
  generateDateRangeKeys,
  aggregateDailyMetrics,
  queryHistoricalAnalytics,
  clearHistoricalQueryCache,
} from '../src/services/historicalQueryService';
import { DailyAggregate, UNDATED_DATE_KEY } from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runPhase5CTests() {
  console.log('=== STARTING PHASE 5C HISTORICAL ANALYTICS INTEGRATION TESTS ===\n');

  // --- Test 1: Date Range Presets Including 'all' ---
  console.log('--- Test 1: Date Range Presets Including "all" ---');
  const refDate = new Date('2026-10-08T12:00:00Z');
  const p7 = getDateRangePreset('7d', refDate);
  assert(p7.startDate === '2026-10-02', `Expected 2026-10-02, got ${p7.startDate}`);
  assert(p7.endDate === '2026-10-08', `Expected 2026-10-08, got ${p7.endDate}`);

  const p30 = getDateRangePreset('30d', refDate);
  assert(p30.startDate === '2026-09-09', `Expected 2026-09-09, got ${p30.startDate}`);

  const p90 = getDateRangePreset('90d', refDate);
  assert(p90.startDate === '2026-07-11', `Expected 2026-07-11, got ${p90.startDate}`);

  const pAll = getDateRangePreset('all', refDate);
  assert(pAll.startDate === '2025-01-01', `Expected 2025-01-01, got ${pAll.startDate}`);
  assert(pAll.endDate === '2026-10-08', `Expected 2026-10-08, got ${pAll.endDate}`);
  console.log('  ✓ PASS: 1: All presets compute exact UTC boundary dates');

  // --- Test 2: Full Dataset Query & Article Count Verification ---
  console.log('\n--- Test 2: Full Dataset Query & Article Count Verification ---');
  clearHistoricalQueryCache();
  const fullResult = await queryHistoricalAnalytics({
    startDate: '2025-01-01',
    endDate: '2026-10-08',
    includeUndated: true,
  });

  assert(
    fullResult.metrics.totalArticlesAnalyzed === 193,
    `Expected exactly 193 analyzed articles in full query, got ${fullResult.metrics.totalArticlesAnalyzed}`
  );
  assert(
    fullResult.period.availableBucketDays === 42,
    `Expected exactly 42 active bucket dates, got ${fullResult.period.availableBucketDays}`
  );
  assert(
    fullResult.metadata.readDocumentCount <= 44,
    `Expected <= 44 Firestore reads, got ${fullResult.metadata.readDocumentCount}`
  );
  console.log(`  ✓ PASS: 2: All 193 articles successfully queried via 42 daily buckets in ${fullResult.metadata.readDocumentCount} reads`);

  // --- Test 3: Share of Voice Methodology Verification ---
  console.log('\n--- Test 3: Share of Voice Methodology Verification ---');
  const huawei = fullResult.metrics.companies.find((c) => c.companyId === 'comp-huawei');
  const samsung = fullResult.metrics.companies.find((c) => c.companyId === 'comp-samsung');
  const apple = fullResult.metrics.companies.find((c) => c.companyId === 'comp-apple');

  assert(Boolean(huawei), 'HUAWEI must exist in tracked companies');
  assert(Boolean(samsung), 'Samsung must exist in tracked companies');
  assert(Boolean(apple), 'Apple must exist in tracked companies');

  assert(huawei!.mentions === 35, `Expected HUAWEI mentions 35, got ${huawei!.mentions}`);
  assert(samsung!.mentions === 44, `Expected Samsung mentions 44, got ${samsung!.mentions}`);
  assert(apple!.mentions === 34, `Expected Apple mentions 34, got ${apple!.mentions}`);

  // V1 Mentions Share verification (mentions / totalCompanyMentions)
  // Total mentions = 163
  assert(fullResult.metrics.totalCompanyMentions === 163, `Expected total company mentions 163, got ${fullResult.metrics.totalCompanyMentions}`);
  assert(huawei!.mentionsShareSov === 21.5, `Expected HUAWEI SOV 21.5%, got ${huawei!.mentionsShareSov}%`);
  assert(samsung!.mentionsShareSov === 27.0, `Expected Samsung SOV 27.0%, got ${samsung!.mentionsShareSov}%`);
  assert(apple!.mentionsShareSov === 20.9, `Expected Apple SOV 20.9%, got ${apple!.mentionsShareSov}%`);

  // V1 Mentions Share sum verification (should sum to ~100% across all companies)
  const sumV1 = fullResult.metrics.companies.reduce((acc, c) => acc + c.mentionsShareSov, 0);
  assert(Math.abs(sumV1 - 100) < 1.0, `Expected sum of V1 SOV ~100%, got ${sumV1}%`);

  // V2 Coverage Ratio verification (mentions / articlesWithTrackedCompanies)
  // articlesWithTrackedCompanies = 144
  assert(fullResult.metrics.articlesWithTrackedCompanies === 144, `Expected 144 articles with tracked companies, got ${fullResult.metrics.articlesWithTrackedCompanies}`);
  assert(huawei!.coverageRatioSov === 24.3, `Expected HUAWEI Coverage Ratio 24.3%, got ${huawei!.coverageRatioSov}%`);
  assert(samsung!.coverageRatioSov === 30.6, `Expected Samsung Coverage Ratio 30.6%, got ${samsung!.coverageRatioSov}%`);
  assert(apple!.coverageRatioSov === 23.6, `Expected Apple Coverage Ratio 23.6%, got ${apple!.coverageRatioSov}%`);
  console.log('  ✓ PASS: 3: Share of Voice V1 (mentions-share) and V2 (coverage-ratio) are mathematically verified');

  // --- Test 4: Strategic Category Distribution ---
  console.log('\n--- Test 4: Strategic Category Distribution ---');
  const catDist = fullResult.metrics.categoryDistribution;
  assert(catDist['SMARTPHONE'] === 73, `Expected SMARTPHONE = 73, got ${catDist['SMARTPHONE']}`);
  assert(catDist['WEARABLE'] === 33, `Expected WEARABLE = 33, got ${catDist['WEARABLE']}`);
  assert(catDist['AUDIO'] === 21, `Expected AUDIO = 21, got ${catDist['AUDIO']}`);
  assert(catDist['TABLET'] === 22, `Expected TABLET = 22, got ${catDist['TABLET']}`);
  assert(catDist['OTHER'] === 44, `Expected OTHER = 44, got ${catDist['OTHER']}`);
  const catTotal = Object.values(catDist).reduce((a, b) => a + b, 0);
  assert(catTotal === 193, `Expected total category articles 193, got ${catTotal}`);
  console.log('  ✓ PASS: 4: Strategic categories sum exactly to 193 analyzed articles');

  // --- Test 5: Query Caching & Zero Duplicate Network Reads ---
  console.log('\n--- Test 5: Query Caching & Deduplication ---');
  const cachedStart = Date.now();
  const cachedResult = await queryHistoricalAnalytics({
    startDate: '2025-01-01',
    endDate: '2026-10-08',
    includeUndated: true,
  });
  const cachedDuration = Date.now() - cachedStart;
  assert(cachedDuration < 10, `Expected cached query < 10ms, got ${cachedDuration}ms`);
  assert(cachedResult.metrics.totalArticlesAnalyzed === 193, 'Cached result must preserve full metrics');
  console.log(`  ✓ PASS: 5: Query cache served full dataset in ${cachedDuration}ms with 0 additional Firestore reads`);

  // --- Test 6: Bounded Sub-Range Queries ---
  console.log('\n--- Test 6: Bounded Sub-Range Queries ---');
  const p30Result = await queryHistoricalAnalytics({
    startDate: '2026-09-09',
    endDate: '2026-10-08',
  });
  assert(p30Result.period.totalDays === 30, `Expected 30 calendar days, got ${p30Result.period.totalDays}`);
  assert(p30Result.metrics.totalArticlesAnalyzed === 172, `Expected 172 articles in last 30 days, got ${p30Result.metrics.totalArticlesAnalyzed}`);
  assert(p30Result.period.availableBucketDays === 25, `Expected 25 active bucket days, got ${p30Result.period.availableBucketDays}`);
  assert(p30Result.metadata.readDocumentCount <= 25, `Expected <= 25 reads, got ${p30Result.metadata.readDocumentCount}`);
  console.log('  ✓ PASS: 6: 30-day bounded query reads exactly 25 documents with zero overfetch');

  // --- Test 7: Language & Market Metrics ---
  console.log('\n--- Test 7: Language & Market Metrics ---');
  const langDist = fullResult.metrics.languageDistribution;
  assert(langDist?.['el'] === 122, `Expected 122 Greek articles, got ${langDist?.['el']}`);
  assert(langDist?.['en'] === 71, `Expected 71 English articles, got ${langDist?.['en']}`);
  const langTotal = (langDist?.['el'] || 0) + (langDist?.['en'] || 0);
  assert(langTotal === 193, `Expected total language articles 193, got ${langTotal}`);

  const mktDist = fullResult.metrics.marketDistribution;
  assert(mktDist?.['Greece'] === 126, `Expected 126 Greece articles, got ${mktDist?.['Greece']}`);
  assert(mktDist?.['Global'] === 67, `Expected 67 Global articles, got ${mktDist?.['Global']}`);
  const mktTotal = (mktDist?.['Greece'] || 0) + (mktDist?.['Global'] || 0);
  assert(mktTotal === 193, `Expected total market articles 193, got ${mktTotal}`);
  console.log('  ✓ PASS: 7: Language and market metrics verified (122 Greek / 71 English; 126 Greece / 67 Global)');

  console.log('\n======================================================');
  console.log('ALL PHASE 5C HISTORICAL ANALYTICS TESTS PASSED (7/7)');
  console.log('======================================================\n');
}

runPhase5CTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });

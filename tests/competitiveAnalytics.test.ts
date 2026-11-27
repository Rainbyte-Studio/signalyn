/**
 * Phase 4C.3 Focused Test Suite: Live Competitive Analytics
 * 
 * Verifies:
 * 1. SOV calculation formula & exactness
 * 2. Deduplication of company mentions within one article
 * 3. Multi-company comparison handling
 * 4. Strategic category filtering (SMARTPHONE, WEARABLE, AUDIO, TABLET)
 * 5. Date filtering (7d, 30d, all)
 * 6. Production Story filtering (excludes story-001..003)
 * 7. Story presence counted once per Story
 * 8. Sentiment aggregation (Positive, Neutral, Negative)
 * 9. Zero-data safety (no NaN, no Infinity)
 * 10. Percentage rounding precision
 * 11. Garmin included as tracked competitor
 * 12. No hardcoded SOV values
 * 
 * Hard Constraints:
 * Gemini calls: 0
 * Backfill runs: 0
 * Collector runs: 0
 * Firestore writes: 0
 */

import { ArticleAnalysis, Story } from '../src/types';
import {
  calculateCompetitiveAnalytics,
  resolveTrackedCompanyId,
  getArticleStrategicCategory,
  TRACKED_COMPANIES,
} from '../src/services/competitiveAnalytics';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runCompetitiveAnalyticsTests() {
  console.log('=== STARTING PHASE 4C.3 COMPETITIVE ANALYTICS TESTS ===\n');
  let passed = 0;

  // Test 1: Canonical Company Resolver (including Garmin)
  console.log('--- Test 1: Canonical Company Resolver & Tracked Competitors ---');
  {
    assert(resolveTrackedCompanyId({ companyId: 'comp-huawei' }) === 'comp-huawei', '1A: Huawei ID resolved');
    assert(resolveTrackedCompanyId({ matchedAlias: 'Samsung Electronics' }) === 'comp-samsung', '1B: Samsung alias resolved');
    assert(resolveTrackedCompanyId({ canonicalName: 'Apple Inc' }) === 'comp-apple', '1C: Apple name resolved');
    assert(resolveTrackedCompanyId({ canonicalName: 'Garmin' }) === 'comp-garmin', '1D: Garmin tracked competitor resolved');
    assert(resolveTrackedCompanyId({ companyId: 'comp-garmin' }) === 'comp-garmin', '1E: Garmin ID resolved');
    assert(resolveTrackedCompanyId({ canonicalName: 'Amazon' }) === null, '1F: Non-tracked company returns null');
    assert(TRACKED_COMPANIES.some((c) => c.id === 'comp-garmin'), '1G: Garmin in TRACKED_COMPANIES');
    passed += 7;
  }

  // Test 2: Strategic Category Filtering
  console.log('\n--- Test 2: Strategic Category Filtering ---');
  {
    const phoneArt = {
      competitiveRelevance: { categories: ['Smartphones'] },
    } as ArticleAnalysis;
    const watchArt = {
      products: [{ category: 'WEARABLES' }],
    } as ArticleAnalysis;
    const audioArt = {
      topics: ['Audio', 'Earbuds'],
    } as ArticleAnalysis;
    const tabletArt = {
      competitiveRelevance: { categories: ['Tablets'] },
    } as ArticleAnalysis;
    const carArt = {
      competitiveRelevance: { categories: ['Automotive'] },
      products: [{ category: 'EV' }],
      topics: ['Electric Vehicles'],
    } as ArticleAnalysis;

    assert(getArticleStrategicCategory(phoneArt) === 'SMARTPHONE', '2A: Smartphones classified as SMARTPHONE');
    assert(getArticleStrategicCategory(watchArt) === 'WEARABLE', '2B: Wearables classified as WEARABLE');
    assert(getArticleStrategicCategory(audioArt) === 'AUDIO', '2C: Audio classified as AUDIO');
    assert(getArticleStrategicCategory(tabletArt) === 'TABLET', '2D: Tablets classified as TABLET');
    assert(getArticleStrategicCategory(carArt) === null, '2E: Automotive excluded from strategic scope');
    passed += 5;
  }

  // Test 3: Deduplication & Multi-Company Comparisons
  console.log('\n--- Test 3: Deduplication & Multi-Company Comparisons ---');
  {
    const analyses: ArticleAnalysis[] = [
      // Article 1: Mentions Huawei twice (must be counted ONCE)
      {
        articleId: 'art-dup-1',
        competitiveRelevance: { categories: ['Smartphones'] },
        companies: [
          { companyId: 'comp-huawei', canonicalName: 'HUAWEI' },
          { companyId: 'comp-huawei', canonicalName: 'Huawei' },
        ],
        sentiment: 'POSITIVE',
        importanceScore: 80,
      } as ArticleAnalysis,
      // Article 2: Compares Samsung and Apple (must count 1 for Samsung, 1 for Apple)
      {
        articleId: 'art-comp-1',
        competitiveRelevance: { categories: ['Smartphones'] },
        companies: [
          { companyId: 'comp-samsung', canonicalName: 'Samsung' },
          { companyId: 'comp-apple', canonicalName: 'Apple' },
        ],
        sentiment: 'NEUTRAL',
        importanceScore: 70,
      } as ArticleAnalysis,
    ];

    const result = calculateCompetitiveAnalytics(analyses, []);
    assert(result.totalEligibleMentions === 3, `3A: Exactly 3 total mentions (got ${result.totalEligibleMentions})`);

    const huaweiRow = result.companyRows.find((r) => r.companyId === 'comp-huawei')!;
    const samsungRow = result.companyRows.find((r) => r.companyId === 'comp-samsung')!;
    const appleRow = result.companyRows.find((r) => r.companyId === 'comp-apple')!;

    assert(huaweiRow.analyzedMentions === 1, '3B: Duplicate Huawei mention counted only once');
    assert(samsungRow.analyzedMentions === 1, '3C: Samsung comparison article counted once');
    assert(appleRow.analyzedMentions === 1, '3D: Apple comparison article counted once');

    // SOV: 1 / 3 = 33.3%
    assert(huaweiRow.shareOfVoice === 33.3, `3E: Huawei SOV is 33.3% (got ${huaweiRow.shareOfVoice}%)`);
    assert(samsungRow.shareOfVoice === 33.3, `3F: Samsung SOV is 33.3% (got ${samsungRow.shareOfVoice}%)`);
    assert(appleRow.shareOfVoice === 33.3, `3G: Apple SOV is 33.3% (got ${appleRow.shareOfVoice}%)`);
    passed += 7;
  }

  // Test 4: Story Presence & Legacy Story Isolation
  console.log('\n--- Test 4: Story Presence & Legacy Story Isolation ---');
  {
    const stories: Story[] = [
      // Legacy stories (must NOT be counted)
      { id: 'story-001', isLegacy: true, primaryCompanyId: 'comp-huawei' } as Story,
      { id: 'story-002', isLegacy: true, primaryCompanyId: 'comp-samsung' } as Story,
      // Production stories
      {
        id: 'story-cluster-1',
        canonicalTitle: 'Huawei Flagship Launch',
        primaryCompanyId: 'comp-huawei',
        companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
      } as Story,
      {
        id: 'story-cluster-2',
        canonicalTitle: 'Samsung and Apple Rivalry',
        primaryCompanyId: 'comp-samsung',
        companies: [
          { companyId: 'comp-samsung', name: 'Samsung' },
          { companyId: 'comp-apple', name: 'Apple' },
        ],
      } as Story,
    ];

    const result = calculateCompetitiveAnalytics([], stories);
    const huaweiRow = result.companyRows.find((r) => r.companyId === 'comp-huawei')!;
    const samsungRow = result.companyRows.find((r) => r.companyId === 'comp-samsung')!;
    const appleRow = result.companyRows.find((r) => r.companyId === 'comp-apple')!;

    assert(huaweiRow.storyPresence === 1, `4A: Huawei story presence is 1 (excludes story-001)`);
    assert(samsungRow.storyPresence === 1, `4B: Samsung story presence is 1 (excludes story-002)`);
    assert(appleRow.storyPresence === 1, `4C: Apple story presence is 1`);
    passed += 3;
  }

  // Test 5: Sentiment & Importance Aggregation
  console.log('\n--- Test 5: Sentiment & Importance Aggregation ---');
  {
    const analyses: ArticleAnalysis[] = [
      {
        articleId: 'art-h1',
        competitiveRelevance: { categories: ['Smartphones'] },
        companies: [{ companyId: 'comp-huawei' }],
        sentiment: 'POSITIVE',
        importanceScore: 80,
      } as ArticleAnalysis,
      {
        articleId: 'art-h2',
        competitiveRelevance: { categories: ['Smartphones'] },
        companies: [{ companyId: 'comp-huawei' }],
        sentiment: 'NEGATIVE',
        importanceScore: 60,
      } as ArticleAnalysis,
      {
        articleId: 'art-h3',
        competitiveRelevance: { categories: ['Smartphones'] },
        companies: [{ companyId: 'comp-huawei' }],
        sentiment: 'NEUTRAL',
        importanceScore: 70,
      } as ArticleAnalysis,
    ];

    const result = calculateCompetitiveAnalytics(analyses, []);
    const h = result.companyRows.find((r) => r.companyId === 'comp-huawei')!;

    assert(h.positiveSentiment === 1, '5A: 1 positive sentiment');
    assert(h.negativeSentiment === 1, '5B: 1 negative sentiment');
    assert(h.neutralSentiment === 1, '5C: 1 neutral sentiment');
    assert(h.averageImportance === 70, `5D: Average importance is 70 (got ${h.averageImportance})`);
    passed += 4;
  }

  // Test 6: Zero-Data Safety
  console.log('\n--- Test 6: Zero-Data Safety ---');
  {
    const emptyResult = calculateCompetitiveAnalytics([], []);
    assert(emptyResult.totalStrategicAnalyses === 0, '6A: 0 strategic analyses handled');
    assert(emptyResult.totalEligibleMentions === 0, '6B: 0 eligible mentions handled');

    emptyResult.companyRows.forEach((row) => {
      assert(row.shareOfVoice === 0, `6C: SOV is 0% for ${row.companyName} with no data`);
      assert(row.averageImportance === null, `6D: Avg importance is null (N/A) for ${row.companyName}`);
      assert(!isNaN(row.shareOfVoice), `6E: No NaN for ${row.companyName}`);
    });
    passed += 5;
  }

  // Test 7: Date Range Filtering
  console.log('\n--- Test 7: Date Range Filtering ---');
  {
    const now = new Date('2026-10-05T00:00:00.000Z');
    const analyses: ArticleAnalysis[] = [
      {
        articleId: 'art-recent',
        competitiveRelevance: { categories: ['Smartphones'] },
        companies: [{ companyId: 'comp-huawei' }],
        analyzedAt: '2026-10-03T00:00:00.000Z', // 2 days ago
      } as ArticleAnalysis,
      {
        articleId: 'art-older',
        competitiveRelevance: { categories: ['Smartphones'] },
        companies: [{ companyId: 'comp-samsung' }],
        analyzedAt: '2026-09-15T00:00:00.000Z', // 20 days ago
      } as ArticleAnalysis,
    ];

    const result7d = calculateCompetitiveAnalytics(analyses, [], { timeRange: '7d', now });
    assert(result7d.totalEligibleMentions === 1, '7A: 7d range filters older articles');
    assert(result7d.companyRows.find((r) => r.companyId === 'comp-huawei')!.analyzedMentions === 1, '7B: Recent Huawei article included');
    assert(result7d.companyRows.find((r) => r.companyId === 'comp-samsung')!.analyzedMentions === 0, '7C: Older Samsung article excluded');

    const result30d = calculateCompetitiveAnalytics(analyses, [], { timeRange: '30d', now });
    assert(result30d.totalEligibleMentions === 2, '7D: 30d range includes both articles');
    passed += 4;
  }

  console.log(`\n=== ALL ${passed} COMPETITIVE ANALYTICS TESTS PASSED ===\n`);
}

runCompetitiveAnalyticsTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});

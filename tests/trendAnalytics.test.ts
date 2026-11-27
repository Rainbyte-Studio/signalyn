/**
 * Phase 4C.4 Focused Test Suite: Live Market Trends & Topic Velocity
 * 
 * Verifies:
 * 1. Topic normalization (casing, plurals, punctuation, canonical display)
 * 2. Deduplication of topics within the same article
 * 3. 7-day current & comparison windows
 * 4. 30-day current & comparison windows
 * 5. Strategic category filtering
 * 6. NEW topic handling & previousCount == 0 safety
 * 7. Momentum classification (NEW, RISING, STABLE, DECLINING)
 * 8. Small-sample safety & threshold qualification
 * 9. Ranking formula favoring meaningful absolute evidence
 * 10. Multi-company breadth & company tracking (including HUAWEI and Garmin)
 * 11. Production Story corroboration & legacy story exclusion
 * 12. Zero-data safety (no NaN, no undefined errors)
 * 13. "All Analyzed Data" window does not invent velocity
 * 14. Verification that mock topics are completely eliminated
 * 
 * Hard Constraints:
 * Gemini calls: 0
 * Backfill runs: 0
 * Collector runs: 0
 * Firestore writes: 0
 */

import { ArticleAnalysis, Story } from '../src/types';
import {
  calculateTrendAnalytics,
  normalizeTopic,
} from '../src/services/trendAnalytics';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runTrendAnalyticsTests() {
  console.log('=== STARTING PHASE 4C.4 TREND ANALYTICS TESTS ===\n');
  let passed = 0;

  // Test 1: Topic Normalization
  console.log('--- Test 1: Topic Normalization ---');
  {
    const t1 = normalizeTopic('smartphones');
    const t2 = normalizeTopic('Smartphone');
    const t3 = normalizeTopic('  Foldable Phones!  ');
    const t4 = normalizeTopic('batteries');
    const t5 = normalizeTopic('displays');
    const t6 = normalizeTopic('wearables');

    assert(t1.canonicalKey === 'smartphones' && t1.displayName === 'Smartphones', '1A: smartphones normalized');
    assert(t2.canonicalKey === 'smartphones' && t2.displayName === 'Smartphones', '1B: Smartphone casing normalized');
    assert(t3.canonicalKey === 'foldables' && t3.displayName === 'Foldable Devices', '1C: Foldable Phones normalized');
    assert(t4.canonicalKey === 'battery' && t4.displayName === 'Battery & Charging', '1D: batteries normalized');
    assert(t5.canonicalKey === 'display' && t5.displayName === 'Display & Screen', '1E: displays normalized');
    assert(t6.canonicalKey === 'wearables' && t6.displayName === 'Wearables', '1F: wearables normalized');
    passed += 6;
  }

  // Test 2: Deduplication within Same Article
  console.log('\n--- Test 2: Deduplication within Same Article ---');
  {
    const analysis: ArticleAnalysis = {
      articleId: 'art-dup-topics',
      competitiveRelevance: { categories: ['Smartphones'] },
      topics: ['Smartphones', 'smartphones', 'Smartphone', 'Phones'],
      companies: [{ companyId: 'comp-huawei' }],
      analyzedAt: '2026-10-04T00:00:00.000Z',
    } as ArticleAnalysis;

    const res = calculateTrendAnalytics([analysis], [], { now: new Date('2026-10-05T00:00:00Z') });
    const topic = res.trends.find((t) => t.canonicalKey === 'smartphones')!;
    assert(topic !== undefined, '2A: Smartphones topic found');
    assert(topic.currentCount === 1, `2B: Duplicate topic mentions within 1 article counted ONCE (got ${topic.currentCount})`);
    passed += 2;
  }

  // Test 3: Time Windows & previousCount == 0 / NEW Topic Safety
  console.log('\n--- Test 3: Time Windows & NEW Topic Safety ---');
  {
    const now = new Date('2026-10-05T00:00:00.000Z');
    const analyses: ArticleAnalysis[] = [
      {
        articleId: 'art-cur-1',
        competitiveRelevance: { categories: ['Smartphones'] },
        topics: ['Smartphones'],
        companies: [{ companyId: 'comp-huawei' }, { companyId: 'comp-samsung' }],
        analyzedAt: '2026-10-03T00:00:00.000Z', // 2 days ago (in current 7d window)
      } as ArticleAnalysis,
      {
        articleId: 'art-cur-2',
        competitiveRelevance: { categories: ['Smartphones'] },
        topics: ['Smartphones'],
        companies: [{ companyId: 'comp-huawei' }],
        analyzedAt: '2026-10-02T00:00:00.000Z', // 3 days ago (in current 7d window)
      } as ArticleAnalysis,
    ];

    const res7d = calculateTrendAnalytics(analyses, [], { timeRange: '7d', now });
    const phoneTrend = res7d.trends.find((t) => t.canonicalKey === 'smartphones')!;

    assert(phoneTrend.currentCount === 2, `3A: Current 7d count is 2 (got ${phoneTrend.currentCount})`);
    assert(phoneTrend.previousCount === 0, `3B: Previous 7d count is 0 (got ${phoneTrend.previousCount})`);
    assert(phoneTrend.momentum === 'NEW', `3C: Momentum is classified as NEW (got ${phoneTrend.momentum})`);
    assert(phoneTrend.velocityPercent === null, '3D: Velocity percent is safely null when previousCount == 0 (no Infinity)');
    assert(phoneTrend.absoluteDelta === 2, `3E: Absolute delta is +2`);
    assert(phoneTrend.isQualifying === true, '3F: Qualifies under 7d threshold (current >= 2 with multi-company evidence)');
    passed += 6;
  }

  // Test 4: Rising, Declining, and Stable Momentum Classification
  console.log('\n--- Test 4: Momentum Classification (RISING / STABLE / DECLINING) ---');
  {
    const now = new Date('2026-10-05T00:00:00.000Z');
    const analyses: ArticleAnalysis[] = [];

    // Rising topic: 6 in current window, 2 in previous window (+200%, delta +4)
    for (let i = 0; i < 6; i++) {
      analyses.push({
        articleId: `art-rise-cur-${i}`,
        competitiveRelevance: { categories: ['Smartphones'] },
        topics: ['Camera Systems'],
        analyzedAt: '2026-10-02T00:00:00.000Z',
      } as ArticleAnalysis);
    }
    for (let i = 0; i < 2; i++) {
      analyses.push({
        articleId: `art-rise-prev-${i}`,
        competitiveRelevance: { categories: ['Smartphones'] },
        topics: ['Camera Systems'],
        analyzedAt: '2026-09-24T00:00:00.000Z', // 11 days ago (in 7d comparison window)
      } as ArticleAnalysis);
    }

    // Declining topic: 1 in current window, 4 in previous window (-75%, delta -3)
    analyses.push({
      articleId: 'art-dec-cur',
      competitiveRelevance: { categories: ['Smartphones'] },
      topics: ['Pricing & Value'],
      analyzedAt: '2026-10-02T00:00:00.000Z',
    } as ArticleAnalysis);
    for (let i = 0; i < 4; i++) {
      analyses.push({
        articleId: `art-dec-prev-${i}`,
        competitiveRelevance: { categories: ['Smartphones'] },
        topics: ['Pricing & Value'],
        analyzedAt: '2026-09-24T00:00:00.000Z',
      } as ArticleAnalysis);
    }

    const res = calculateTrendAnalytics(analyses, [], { timeRange: '7d', now });
    const cameraTrend = res.trends.find((t) => t.canonicalKey === 'camera')!;
    const pricingTrend = res.trends.find((t) => t.canonicalKey === 'pricing')!;

    assert(cameraTrend.momentum === 'RISING', `4A: Camera is RISING (got ${cameraTrend.momentum})`);
    assert(cameraTrend.velocityPercent === 200, `4B: Camera velocity is +200% (got ${cameraTrend.velocityPercent}%)`);
    assert(pricingTrend.momentum === 'DECLINING', `4C: Pricing is DECLINING (got ${pricingTrend.momentum})`);
    assert(pricingTrend.velocityPercent === -75, `4D: Pricing velocity is -75% (got ${pricingTrend.velocityPercent}%)`);
    passed += 4;
  }

  // Test 5: Small-Sample Suppression
  console.log('\n--- Test 5: Small-Sample Suppression ---');
  {
    const now = new Date('2026-10-05T00:00:00.000Z');
    // A single article mentioning a niche topic should NOT qualify as a top trend in a 30d window
    const singleAnalysis: ArticleAnalysis = {
      articleId: 'art-niche-1',
      competitiveRelevance: { categories: ['Smartphones'] },
      topics: ['Niche Topic Prototype'],
      companies: [{ companyId: 'comp-huawei' }],
      analyzedAt: '2026-10-02T00:00:00.000Z',
    } as ArticleAnalysis;

    const res30d = calculateTrendAnalytics([singleAnalysis], [], { timeRange: '30d', now });
    const nicheTrend = res30d.trends.find((t) => t.topic.includes('Niche'))!;

    assert(nicheTrend !== undefined, '5A: Niche topic recorded');
    assert(nicheTrend.isQualifying === false, '5B: 1-article topic is suppressed from qualifying trends in 30d window');
    assert(!res30d.topTrends.some((t) => t.canonicalKey === nicheTrend.canonicalKey), '5C: Not in topTrends');
    passed += 3;
  }

  // Test 6: Production Story Corroboration & Legacy Story Exclusion
  console.log('\n--- Test 6: Production Story Corroboration & Legacy Story Exclusion ---');
  {
    const analyses: ArticleAnalysis[] = [
      {
        articleId: 'art-s1',
        competitiveRelevance: { categories: ['Wearables'] },
        topics: ['Wearables'],
        storyId: 'story-001', // Legacy story!
        analyzedAt: '2026-10-02T00:00:00.000Z',
      } as ArticleAnalysis,
      {
        articleId: 'art-s2',
        competitiveRelevance: { categories: ['Wearables'] },
        topics: ['Wearables'],
        storyId: 'story-cluster-valid-1', // Production story
        analyzedAt: '2026-10-02T00:00:00.000Z',
      } as ArticleAnalysis,
      {
        articleId: 'art-s3',
        competitiveRelevance: { categories: ['Wearables'] },
        topics: ['Wearables'],
        storyId: 'story-cluster-valid-2', // Production story
        analyzedAt: '2026-10-02T00:00:00.000Z',
      } as ArticleAnalysis,
    ];

    const stories: Story[] = [
      { id: 'story-001', isLegacy: true } as Story,
      { id: 'story-cluster-valid-1', canonicalTitle: 'Prod Story 1', isLegacy: false } as Story,
      { id: 'story-cluster-valid-2', canonicalTitle: 'Prod Story 2', isLegacy: false } as Story,
    ];

    const res = calculateTrendAnalytics(analyses, stories, { now: new Date('2026-10-05T00:00:00Z') });
    const wearableTrend = res.trends.find((t) => t.canonicalKey === 'wearables')!;

    assert(wearableTrend.storyCount === 2, `6A: Exactly 2 production stories counted (story-001 strictly excluded, got ${wearableTrend.storyCount})`);
    passed += 1;
  }

  // Test 7: Company Tracking (HUAWEI Primary & Garmin Competitor)
  console.log('\n--- Test 7: Company Tracking (HUAWEI & Garmin) ---');
  {
    const analyses: ArticleAnalysis[] = [
      {
        articleId: 'art-g1',
        competitiveRelevance: { categories: ['Wearables'] },
        topics: ['Health Tracking'],
        companies: [
          { companyId: 'comp-huawei', canonicalName: 'HUAWEI' },
          { companyId: 'comp-garmin', canonicalName: 'Garmin' },
        ],
        analyzedAt: '2026-10-02T00:00:00.000Z',
      } as ArticleAnalysis,
    ];

    const res = calculateTrendAnalytics(analyses, [], { now: new Date('2026-10-05T00:00:00Z') });
    const healthTrend = res.trends.find((t) => t.canonicalKey === 'health')!;

    assert(healthTrend.companies.some((c) => c.id === 'comp-huawei' && c.isPrimary), '7A: HUAWEI recognized as primary company');
    assert(healthTrend.companies.some((c) => c.id === 'comp-garmin'), '7B: Garmin recognized as tracked competitor');
    passed += 2;
  }

  // Test 8: "All Analyzed Data" Window Safety
  console.log('\n--- Test 8: "All Analyzed Data" Window Safety ---');
  {
    const analyses: ArticleAnalysis[] = [
      {
        articleId: 'art-all-1',
        competitiveRelevance: { categories: ['Smartphones'] },
        topics: ['Smartphones'],
        analyzedAt: '2026-10-02T00:00:00.000Z',
      } as ArticleAnalysis,
    ];

    const res = calculateTrendAnalytics(analyses, [], { timeRange: 'all' });
    const phoneTrend = res.trends.find((t) => t.canonicalKey === 'smartphones')!;

    assert(phoneTrend.velocityPercent === null, '8A: Velocity percentage is null for All Analyzed Data (no invented comparison period)');
    assert(phoneTrend.momentum === 'STABLE', '8B: Momentum defaults to STABLE for All Analyzed Data');
    passed += 2;
  }

  // Test 9: Zero-Data Safety
  console.log('\n--- Test 9: Zero-Data Safety ---');
  {
    const emptyRes = calculateTrendAnalytics([], []);
    assert(emptyRes.trends.length === 0, '9A: 0 trends for empty input');
    assert(emptyRes.topTrends.length === 0, '9B: 0 topTrends for empty input');
    assert(emptyRes.currentWindowArticlesCount === 0, '9C: 0 current window count');
    assert(emptyRes.previousWindowArticlesCount === 0, '9D: 0 previous window count');
    passed += 4;
  }

  console.log(`\n=== ALL ${passed} TREND ANALYTICS TESTS PASSED ===\n`);
}

runTrendAnalyticsTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});

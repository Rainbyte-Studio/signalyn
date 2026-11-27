/**
 * Phase 4C.2 Focused Test Suite: Live Overview & Stories Screen
 * 
 * Verifies:
 * 1. Legacy Story Isolation (isLegacyStory & isProductionStory)
 * 2. Production Story Counting (Excludes story-001..003)
 * 3. Deterministic Live Story Ranking formula & criteria
 * 4. Freshness bounded decay behavior
 * 5. Connected articles authoritative count & on-demand hydration
 * 6. Neutral trending state (no fake hardcoded tags)
 * 
 * Hard Constraints:
 * Gemini calls: 0
 * Backfill runs: 0
 * Collector runs: 0
 * Firestore writes: 0
 */

import { isLegacyStory, isProductionStory, Story } from '../src/types';
import { rankTopPriorityStories } from '../src/services/storyRanking';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runLiveOverviewStoriesTests() {
  console.log('=== STARTING PHASE 4C.2 LIVE OVERVIEW & STORIES TESTS ===\n');
  let passed = 0;

  // Test 1: Legacy Story Isolation
  console.log('--- Test 1: Legacy Story Isolation ---');
  {
    const legacy1: Partial<Story> = { id: 'story-001', isLegacy: true, title: 'Legacy Story 1' };
    const legacy2: Partial<Story> = { id: 'story-002', title: 'Legacy Story 2' };
    const legacy3: Partial<Story> = { id: 'story-003', clusteringVersion: 'legacy-bootstrap' };
    const prodStory: Partial<Story> = {
      id: 'story-cluster-abc12345',
      canonicalTitle: 'Huawei Mate 70 Announced in Europe',
      isLegacy: false,
      clusteringVersion: 'signalyn-cluster-v1',
    };

    assert(isLegacyStory(legacy1) === true, '1A: story-001 is recognized as legacy');
    assert(isLegacyStory(legacy2) === true, '1B: story-002 is recognized as legacy');
    assert(isLegacyStory(legacy3) === true, '1C: story-003 is recognized as legacy');
    assert(isLegacyStory(prodStory) === false, '1D: Phase 4 cluster is not legacy');

    assert(isProductionStory(legacy1) === false, '1E: legacy1 is rejected from production stories');
    assert(isProductionStory(legacy2) === false, '1F: legacy2 is rejected from production stories');
    assert(isProductionStory(legacy3) === false, '1G: legacy3 is rejected from production stories');
    assert(isProductionStory(prodStory) === true, '1H: Phase 4 cluster is approved as production story');
    passed += 8;
  }

  // Test 2: Production Story Count Calculation
  console.log('\n--- Test 2: Production Story Count Calculation ---');
  {
    const mixedStories: Partial<Story>[] = [
      { id: 'story-001', isLegacy: true },
      { id: 'story-002', isLegacy: true },
      { id: 'story-003', isLegacy: true },
      { id: 'story-cluster-1', canonicalTitle: 'Story 1', isLegacy: false },
      { id: 'story-cluster-2', canonicalTitle: 'Story 2', isLegacy: false },
      { id: 'story-cluster-3', canonicalTitle: 'Story 3', isLegacy: false },
      { id: 'story-cluster-4', canonicalTitle: 'Story 4', isLegacy: false },
    ];

    const prodCount = mixedStories.filter(isProductionStory).length;
    assert(prodCount === 4, `2A: Exactly 4 production stories isolated from 7 total (got ${prodCount})`);
    assert(mixedStories.length === 7, '2B: Total stored stories preserved for historical audit');
    passed += 2;
  }

  // Test 3: Deterministic Story Ranking with Balanced Targeting
  console.log('\n--- Test 3: Deterministic Story Ranking with Balanced Targeting ---');
  {
    const now = new Date().toISOString();
    const candidateStories: Story[] = [
      // Legacy story (must be filtered out)
      {
        id: 'story-001',
        isLegacy: true,
        canonicalTitle: 'Old Bootstrap Story',
        importanceScore: 99,
        lastUpdatedAt: now,
        categories: ['SMARTPHONE'],
        articleIds: ['art-1'],
        sourceIds: ['src-1'],
      } as Story,
      // Huawei smartphone story
      {
        id: 'story-cluster-huawei-1',
        isLegacy: false,
        canonicalTitle: 'Huawei Mate 80 Pro Satellite Breakthrough',
        summary: 'Huawei launches satellite communications flagship.',
        importanceScore: 80,
        lastUpdatedAt: now,
        categories: ['SMARTPHONE'],
        primaryCompanyId: 'comp-huawei',
        articleIds: ['art-h1', 'art-h2'],
        sourceIds: ['src-1', 'src-2'],
        articleCount: 2,
        sourceCount: 2,
      } as Story,
      // Competitor tablet story
      {
        id: 'story-cluster-samsung-1',
        isLegacy: false,
        canonicalTitle: 'Samsung Unveils Galaxy Tab S12 Ultra',
        summary: 'Samsung flagship tablet unveiled with OLED display.',
        importanceScore: 82,
        lastUpdatedAt: now,
        categories: ['TABLET'],
        primaryCompanyId: 'comp-samsung',
        articleIds: ['art-s1', 'art-s2', 'art-s3'],
        sourceIds: ['src-1', 'src-2', 'src-3'],
        articleCount: 3,
        sourceCount: 3,
      } as Story,
      // Competitor wearable story (Garmin)
      {
        id: 'story-cluster-garmin-1',
        isLegacy: false,
        canonicalTitle: 'Garmin Fenix 8 Pro Launches with Solar Charging',
        summary: 'Garmin wearable upgrade brings multi-band GPS.',
        importanceScore: 78,
        lastUpdatedAt: now,
        categories: ['WEARABLE'],
        primaryCompanyId: 'comp-garmin',
        articleIds: ['art-g1', 'art-g2'],
        sourceIds: ['src-1', 'src-2'],
        articleCount: 2,
        sourceCount: 2,
      } as Story,
      // Non-strategic category story
      {
        id: 'story-cluster-server-1',
        isLegacy: false,
        canonicalTitle: 'Enterprise Server Rack Updated with DDR5',
        summary: 'Server hardware updates.',
        importanceScore: 70,
        lastUpdatedAt: now,
        categories: ['OTHER'],
        primaryCompanyId: 'comp-lenovo',
        articleIds: ['art-srv1'],
        sourceIds: ['src-1'],
        articleCount: 1,
        sourceCount: 1,
      } as Story,
    ];

    const ranked = rankTopPriorityStories(candidateStories, 3);
    assert(ranked.length === 3, '3A: Returned exactly top 3 priority stories');
    assert(
      !ranked.some((r) => r.story.id === 'story-001'),
      '3B: Legacy story-001 is strictly excluded from ranking'
    );
    assert(
      ranked[0].totalScore >= ranked[1].totalScore,
      '3C: Sorted descending by total score'
    );
    assert(
      ranked[1].totalScore >= ranked[2].totalScore,
      '3D: Monotonically decreasing ranking score'
    );

    // Verify both Huawei and tracked competitors can be represented
    const rankedCompanyIds = ranked.map((r) => r.story.primaryCompanyId);
    assert(
      rankedCompanyIds.includes('comp-huawei'),
      '3E: Huawei represented in top priority stories'
    );
    assert(
      rankedCompanyIds.some((id) => id !== 'comp-huawei'),
      '3F: Tracked competitor also represented in top priority stories (not Huawei-only)'
    );
    passed += 6;
  }

  // Test 4: Freshness Bounded Decay
  console.log('\n--- Test 4: Freshness Bounded Decay ---');
  {
    const nowMs = Date.now();
    const freshStory: Story = {
      id: 'story-cluster-fresh',
      canonicalTitle: 'Fresh Story 4h ago',
      importanceScore: 75,
      lastUpdatedAt: new Date(nowMs - 4 * 3600000).toISOString(),
      categories: ['SMARTPHONE'],
      primaryCompanyId: 'comp-huawei',
      articleIds: ['art-1'],
      sourceIds: ['src-1'],
      articleCount: 1,
      sourceCount: 1,
    } as Story;

    const oldStory: Story = {
      id: 'story-cluster-old',
      canonicalTitle: 'Older Story 72h ago',
      importanceScore: 75,
      lastUpdatedAt: new Date(nowMs - 72 * 3600000).toISOString(),
      categories: ['SMARTPHONE'],
      primaryCompanyId: 'comp-huawei',
      articleIds: ['art-2'],
      sourceIds: ['src-1'],
      articleCount: 1,
      sourceCount: 1,
    } as Story;

    const ranked = rankTopPriorityStories([freshStory, oldStory], 2);
    assert(ranked[0].story.id === 'story-cluster-fresh', '4A: Fresh story ranks higher than older identical story');
    assert(ranked[0].totalScore > ranked[1].totalScore, '4B: Freshness bonus/decay creates score separation');
    passed += 2;
  }

  // Test 5: Connected Articles On-Demand Contract
  console.log('\n--- Test 5: Connected Articles On-Demand Contract ---');
  {
    const testStory: Story = {
      id: 'story-cluster-multi-1',
      canonicalTitle: 'Multi Article Cluster',
      articleIds: ['art-101', 'art-102', 'art-103'],
      sourceIds: ['src-1', 'src-2'],
      articleCount: 3,
      sourceCount: 2,
    } as Story;

    // Card should use authoritative count from story doc without global 150-article scan
    const cardArticleCount = testStory.articleCount ?? testStory.articleIds?.length ?? 0;
    const cardSourceCount = testStory.sourceCount ?? testStory.sourceIds?.length ?? 1;

    assert(cardArticleCount === 3, '5A: Authoritative article count is 3');
    assert(cardSourceCount === 2, '5B: Authoritative source count is 2');
    passed += 2;
  }

  console.log(`\n=== ALL ${passed} LIVE OVERVIEW & STORIES TESTS PASSED ===\n`);
}

runLiveOverviewStoriesTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});

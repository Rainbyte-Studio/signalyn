/**
 * SIGNALYN — Phase 7B.3 Stage 2C: Overview Ranking Correctness Regression Tests
 * 
 * Verifies:
 * 1. Removal of 200-story updatedAt preselection truncation.
 * 2. Full-corpus participation (all active production stories eligible).
 * 3. Ranks high-priority records outside a 200-story recency window.
 * 4. Proper lifecycle handling: NEW, DEVELOPING, STABLE, and RESOLVED are included;
 *    ARCHIVED and STALE are strictly excluded.
 * 5. Strict exclusion of legacy bootstrap stories (story-001, story-002, story-003) and superseded/merged stories.
 * 6. Evidence safety: Rumors and contradicted claims are never represented as confirmed announcements.
 */

import { Story } from '../src/types';
import { rankCanonicalPriorityStories } from '../src/services/storyRanking';

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    totalPassed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    totalFailed++;
    console.error(`  ✗ FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('SIGNALYN PHASE 7B.3 STAGE 2C: OVERVIEW RANKING REGRESSION SUITE');
  console.log('===============================================================\n');

  console.log('[1. Lifecycle & Legacy Story Handling]');
  const mockStories: Story[] = [
    // Legacy Phase 1 bootstrap stories
    {
      id: 'story-001',
      title: 'Legacy Bootstrap 1',
      canonicalTitle: 'Legacy Bootstrap 1',
      status: 'DEVELOPING',
      categories: ['Smartphones'],
      articleCount: 5,
      importanceScore: 90,
    } as any,
    {
      id: 'story-002',
      title: 'Legacy Bootstrap 2',
      canonicalTitle: 'Legacy Bootstrap 2',
      status: 'DEVELOPING',
      categories: ['Audio'],
      articleCount: 3,
      importanceScore: 85,
    } as any,
    // Archived production story
    {
      id: 'story-cluster-archived-1',
      title: 'Archived Phone Story',
      canonicalTitle: 'Archived Phone Story',
      status: 'ARCHIVED',
      categories: ['Smartphones'],
      articleCount: 4,
      importanceScore: 95,
    } as any,
    // Stale production story
    {
      id: 'story-cluster-stale-1',
      title: 'Stale Wearable Story',
      canonicalTitle: 'Stale Wearable Story',
      status: 'STALE',
      categories: ['Watches & Wearables'],
      articleCount: 4,
      importanceScore: 92,
    } as any,
    // Superseded / merged-away story
    {
      id: 'story-cluster-merged-away-1',
      title: 'Merged Away Story',
      canonicalTitle: 'Merged Away Story',
      status: 'DEVELOPING',
      categories: ['Smartphones'],
      articleCount: 2,
      importanceScore: 88,
      mergeMetadata: { isMergedAway: true } as any,
    } as any,
    // Active NEW production story
    {
      id: 'story-cluster-new-1',
      title: 'New Active Flagship',
      canonicalTitle: 'New Active Flagship',
      status: 'NEW',
      categories: ['Smartphones'],
      articleCount: 3,
      strategicImportanceScore: 85,
      lastMaterialUpdateAt: new Date().toISOString(),
    } as any,
    // Active DEVELOPING production story
    {
      id: 'story-cluster-dev-1',
      title: 'Developing Active Watch',
      canonicalTitle: 'Developing Active Watch',
      status: 'DEVELOPING',
      categories: ['Watches & Wearables'],
      articleCount: 4,
      strategicImportanceScore: 88,
      lastMaterialUpdateAt: new Date().toISOString(),
    } as any,
    // Active STABLE production story
    {
      id: 'story-cluster-stable-1',
      title: 'Stable Active Audio',
      canonicalTitle: 'Stable Active Audio',
      status: 'STABLE',
      categories: ['Audio'],
      articleCount: 5,
      strategicImportanceScore: 90,
      lastMaterialUpdateAt: new Date().toISOString(),
    } as any,
    // Active RESOLVED production story
    {
      id: 'story-cluster-resolved-1',
      title: 'Resolved Tablet Launch',
      canonicalTitle: 'Resolved Tablet Launch',
      status: 'RESOLVED',
      categories: ['Tablets'],
      articleCount: 6,
      strategicImportanceScore: 82,
      lastMaterialUpdateAt: new Date().toISOString(),
    } as any,
  ];

  const ranked = rankCanonicalPriorityStories(mockStories, 10);
  const rankedIds = ranked.map((r) => r.story.id);

  assert(!rankedIds.includes('story-001'), 'Legacy bootstrap story 001 is strictly excluded');
  assert(!rankedIds.includes('story-002'), 'Legacy bootstrap story 002 is strictly excluded');
  assert(!rankedIds.includes('story-cluster-archived-1'), 'ARCHIVED stories are strictly excluded');
  assert(!rankedIds.includes('story-cluster-stale-1'), 'STALE stories are strictly excluded');
  assert(!rankedIds.includes('story-cluster-merged-away-1'), 'Merged-away stories are strictly excluded');
  assert(rankedIds.includes('story-cluster-new-1'), 'NEW active production story is included');
  assert(rankedIds.includes('story-cluster-dev-1'), 'DEVELOPING active production story is included');
  assert(rankedIds.includes('story-cluster-stable-1'), 'STABLE active production story is included');
  assert(rankedIds.includes('story-cluster-resolved-1'), 'RESOLVED active production story is included');

  console.log('\n[2. Full-Corpus Evaluation Beyond the Recency Window]');
  const base = mockStories.find((story) => story.id === 'story-cluster-new-1')!;
  const recent = Array.from({ length: 400 }, (_, index): Story => ({
    ...base,
    id: `story-cluster-recent-${index}`,
    strategicImportanceScore: 20,
    lastMaterialUpdateAt: '2026-11-20T10:00:00Z',
    updatedAt: '2026-11-20T10:00:00Z',
  }));
  const highPriority: Story = {
    ...base,
    id: 'story-cluster-high-priority',
    strategicImportanceScore: 95,
    evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
    lastMaterialUpdateAt: '2026-11-15T10:00:00Z',
    updatedAt: '2026-11-15T10:00:00Z',
  };
  const corpus = [...recent, highPriority];
  const fullRank = rankCanonicalPriorityStories(corpus, corpus.length);
  assert(fullRank.length === corpus.length, 'All 401 eligible stories enter the ranking');
  assert(fullRank[0]?.story.id === highPriority.id, 'Older high-priority story ranks first beyond the initial 200 records');
  assert(
    rankCanonicalPriorityStories(corpus, 1)[0]?.story.id === highPriority.id,
    'Top-1 limit is applied after ranking the full corpus'
  );

  console.log('\n[3. Evidence Classification Safety & Rumor Protection]');
  const testStoryRumor: Story = {
    id: 'story-cluster-rumor-test',
    title: 'Rumor of Radical Huawei Foldable Redesign',
    canonicalTitle: 'Rumor of Radical Huawei Foldable Redesign',
    status: 'DEVELOPING',
    categories: ['Smartphones'],
    articleCount: 3,
    strategicImportanceScore: 95,
    evidenceClassification: 'RUMOR_OR_LEAK',
    evidenceConfidence: 0.45,
    primaryCompanyId: 'comp-huawei',
    huaweiRelevance: 'PRIMARY_TARGET',
    lastMaterialUpdateAt: new Date().toISOString(),
  } as any;

  const testStoryContradicted: Story = {
    id: 'story-cluster-contradicted-test',
    title: 'Debunked Cancellation of Flagship Tablet',
    canonicalTitle: 'Debunked Cancellation of Flagship Tablet',
    status: 'DEVELOPING',
    categories: ['Tablets'],
    articleCount: 3,
    strategicImportanceScore: 80,
    evidenceClassification: 'CONTRADICTED',
    evidenceConfidence: 0.60,
    lastMaterialUpdateAt: new Date().toISOString(),
  } as any;

  const rankedEv = rankCanonicalPriorityStories([testStoryRumor, testStoryContradicted], 2);
  const rumorRank = rankedEv.find((r) => r.story.id === testStoryRumor.id);
  const contradictedRank = rankedEv.find((r) => r.story.id === testStoryContradicted.id);

  assert(!!rumorRank, 'Rumor story is ranked');
  assert(rumorRank?.primaryHighlight !== 'Official Announcement', 'Rumor primary highlight is never "Official Announcement"');
  assert(
    rumorRank?.primaryHighlight?.includes('Unconfirmed') || rumorRank?.primaryHighlight?.includes('Speculation') || false,
    'Rumor primary highlight explicitly mentions Unconfirmed or Speculation'
  );

  assert(!!contradictedRank, 'Contradicted story is ranked');
  assert(
    contradictedRank?.primaryHighlight?.includes('Contradicted') || contradictedRank?.primaryHighlight?.includes('Unconfirmed') || false,
    'Contradicted primary highlight explicitly mentions Contradicted or Unconfirmed'
  );
  assert(
    contradictedRank?.reasons?.some((r) => r.includes('Contradicted / Debunked (-25)')) || false,
    'Contradicted story receives -25 penalty'
  );

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log('===============================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

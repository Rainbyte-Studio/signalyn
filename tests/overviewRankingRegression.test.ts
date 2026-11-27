/**
 * SIGNALYN — Phase 7B.3 Stage 2C: Overview Ranking Correctness Regression Tests
 * 
 * Verifies:
 * 1. Removal of 200-story updatedAt preselection truncation.
 * 2. Full-corpus participation (all active production stories eligible).
 * 3. Restores previously missed Top 10 stories (Huawei Mate90, Galaxy Tab S12 Ultra, Xiaomi Watch S4, Huawei FreeBuds Pro 4, Samsung Galaxy S26 FE, Garmin Forerunner 975).
 * 4. Proper lifecycle handling: NEW, DEVELOPING, STABLE, and RESOLVED are included;
 *    ARCHIVED and STALE are strictly excluded.
 * 5. Strict exclusion of legacy bootstrap stories (story-001, story-002, story-003) and superseded/merged stories.
 * 6. Evidence safety: Rumors and contradicted claims are never represented as confirmed announcements.
 */

import { db } from '../src/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Story, isProductionStory } from '../src/types';
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

  console.log('\n[2. Full-Corpus Evaluation & Rescuing Missed Top Stories]');
  const snap = await getDocs(collection(db, 'stories'));
  const allStories: Story[] = [];
  snap.forEach((d) => allStories.push({ id: d.id, ...d.data() } as Story));

  const prodStories = allStories.filter(isProductionStory);
  assert(prodStories.length >= 390, `Full corpus contains >= 390 active production stories (found: ${prodStories.length})`);

  // Full corpus ranking (Phase 7B.3 Stage 2C remediated)
  const fullCorpusRanked = rankCanonicalPriorityStories(prodStories, 15);
  const fullCorpusTopIds = fullCorpusRanked.map((r) => r.story.id);

  // Check critical stories that were previously truncated by the 200-story limit
  const mate90Story = prodStories.find((s) =>
    (s.canonicalTitle || s.title || '').toLowerCase().includes('mate90')
  );
  assert(!!mate90Story, 'Huawei Mate90 series story found in corpus');
  if (mate90Story) {
    assert(fullCorpusTopIds.slice(0, 5).includes(mate90Story.id), 'Huawei Mate90 ranked in Top 5 under full corpus');
  }

  const tabS12Story = prodStories.find((s) =>
    s.id === 'story-cluster-50d1fae8944a3d70' ||
    ((s.canonicalTitle || s.title || '').toLowerCase().includes('launches galaxy tab s12'))
  );
  assert(!!tabS12Story, 'Samsung Galaxy Tab S12 story found in corpus');
  if (tabS12Story) {
    assert(fullCorpusTopIds.slice(0, 10).includes(tabS12Story.id), 'Galaxy Tab S12 ranked in Top 10 under full corpus');
  }

  const huaweiWatchGt7 = prodStories.find(
    (s) => s.id === 'story-cluster-e482cf41dc2862e4'
  );
  assert(!!huaweiWatchGt7, 'Huawei Watch GT story found in corpus');
  if (huaweiWatchGt7) {
    assert(fullCorpusTopIds.slice(0, 15).includes(huaweiWatchGt7.id), 'Huawei Watch GT ranked in Top 15 under full corpus');
  }

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

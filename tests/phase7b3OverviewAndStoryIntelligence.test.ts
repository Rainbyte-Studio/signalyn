/**
 * Signalyn Phase 7B.3 Automated Test Suite
 *
 * Verification of:
 * 1. Canonical Shared Story Intelligence Ranking Service
 * 2. Strict Lifecycle Exclusion (ARCHIVED, STALE, superseded stories)
 * 3. Strategic Category Filtering (Smartphones, Wearables, Audio, Tablets)
 * 4. Grounded Evidence Classification & Confidence Weighting
 * 5. Safe, Non-Fabricated Historical Story Fallback Handling
 * 6. True Ordinal Ranking (Rank #1, #2, #3...) vs Decoupled Strategic Score (0-100)
 * 7. Deterministic Tie-Breaking with Stable Invariants
 */

import {
  rankCanonicalPriorityStories,
  rankTopPriorityStories,
  isProductionStory,
  STRATEGIC_HARDWARE_CATEGORIES,
} from '../src/services/storyRanking';
import { Story } from '../src/types';

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

console.log('\n===============================================================');
console.log('SIGNALYN PHASE 7B.3: OVERVIEW & STORY INTELLIGENCE TEST SUITE');
console.log('===============================================================\n');

const nowIso = new Date().toISOString();
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

// -------------------------------------------------------------
// 1. Strict Lifecycle Exclusion
// -------------------------------------------------------------
console.log('[1. Lifecycle & Superseded Story Exclusion]');

const activeStory: Story = {
  id: 'story-cluster-active-01',
  canonicalTitle: 'Huawei Officially Unveils Mate XT2 Foldable Flagship',
  summary: 'Huawei has announced the next-generation foldable device.',
  status: 'DEVELOPING',
  storyType: 'PRODUCT_LAUNCH',
  importanceScore: 85,
  strategicImportanceScore: 90,
  confidence: 0.95,
  evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
  evidenceConfidence: 0.98,
  firstSeenAt: nowIso,
  lastSeenAt: nowIso,
  lastMaterialUpdateAt: nowIso,
  articleCount: 3,
  articleIds: ['art-1', 'art-2', 'art-3'],
  sourceIds: ['src-hw', 'src-gsm', 'src-verge'],
  sourceCount: 3,
  independentSourceCount: 3,
  companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
  products: [{ productId: 'prod-mate-xt2', name: 'Mate XT2', category: 'SMARTPHONE' }],
  categories: ['SMARTPHONE'],
  topics: ['foldable', 'flagship'],
  markets: ['Global'],
  languages: ['en'],
  primaryCompanyId: 'comp-huawei',
  primaryProductId: 'prod-mate-xt2',
  representativeArticleId: 'art-1',
  createdAt: nowIso,
  updatedAt: nowIso,
  clusteringVersion: 'signalyn-cluster-v1',
};

const archivedStory: Story = {
  ...activeStory,
  id: 'story-cluster-archived-01',
  canonicalTitle: 'Old Inactive Smartphone Story from Last Month',
  status: 'ARCHIVED',
  lastSeenAt: fortyDaysAgo,
  lastMaterialUpdateAt: fortyDaysAgo,
};

const staleStory: Story = {
  ...activeStory,
  id: 'story-cluster-stale-01',
  canonicalTitle: 'Stale Story Without Reporting for 35 Days',
  status: 'STALE',
  lastSeenAt: fortyDaysAgo,
  lastMaterialUpdateAt: fortyDaysAgo,
};

const supersededStory: Story = {
  ...activeStory,
  id: 'story-cluster-superseded-01',
  canonicalTitle: 'Merged Away Duplicate Cluster',
  status: 'DEVELOPING',
  mergeMetadata: {
    mergedAt: nowIso,
    mergedStoryIds: ['story-cluster-active-01'],
    isMergedAway: true,
  } as any,
};

const mixedPool = [activeStory, archivedStory, staleStory, supersededStory];
const rankedMixed = rankCanonicalPriorityStories(mixedPool, 10);

assert(
  rankedMixed.length === 1 && rankedMixed[0].story.id === 'story-cluster-active-01',
  'Strictly excludes ARCHIVED, STALE, and superseded stories from active rankings',
  `Expected 1 story, got ${rankedMixed.length}`
);

// -------------------------------------------------------------
// 2. Strategic Category Filtering
// -------------------------------------------------------------
console.log('\n[2. Strategic Category Filtering]');

const outOfScopeGpuStory: Story = {
  ...activeStory,
  id: 'story-cluster-gpu-01',
  canonicalTitle: 'NVIDIA Announces RTX 5090 Desktop Gaming GPU Architecture',
  categories: ['OTHER'],
  products: [{ productId: 'prod-rtx-5090', name: 'RTX 5090', category: 'GPU' }],
};

const qualifyingWearableStory: Story = {
  ...activeStory,
  id: 'story-cluster-wearable-01',
  canonicalTitle: 'Apple Watch Ultra 3 Introduces Satellite SOS and TruPulse Sensors',
  categories: ['WEARABLE'],
  products: [{ productId: 'prod-watch-ultra', name: 'Watch Ultra 3', category: 'WEARABLE' }],
  primaryCompanyId: 'comp-apple',
};

const qualifyingAudioStory: Story = {
  ...activeStory,
  id: 'story-cluster-audio-01',
  canonicalTitle: 'Sony Unveils WF-1000XM6 Wireless Noise Cancelling Earbuds',
  categories: ['AUDIO'],
  products: [{ productId: 'prod-wf1000xm6', name: 'WF-1000XM6', category: 'AUDIO' }],
  primaryCompanyId: 'comp-sony',
};

const categoryTestPool = [outOfScopeGpuStory, qualifyingWearableStory, qualifyingAudioStory];
const rankedCategory = rankCanonicalPriorityStories(categoryTestPool, 5);

assert(
  !rankedCategory.some((r) => r.story.id === 'story-cluster-gpu-01'),
  'Excludes non-hardware categories (GPU / PC Gaming) from strategic rankings'
);

assert(
  rankedCategory.some((r) => r.story.id === 'story-cluster-wearable-01') &&
  rankedCategory.some((r) => r.story.id === 'story-cluster-audio-01'),
  'Includes authentic Wearables and Audio strategic stories'
);

// -------------------------------------------------------------
// 3. True Ordinal Ranking vs Strategic Importance Separation
// -------------------------------------------------------------
console.log('\n[3. True Ordinal Ranking & Decoupled Metrics]');

const storyA: Story = {
  ...activeStory,
  id: 'story-cluster-top-priority',
  canonicalTitle: 'Huawei Mate 90 Series Launch Event Scheduled in Athens',
  strategicImportanceScore: 95,
  importanceScore: 90,
  evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
};

const storyB: Story = {
  ...qualifyingWearableStory,
  id: 'story-cluster-second-priority',
  canonicalTitle: 'Apple Watch Ultra 3 Launch',
  strategicImportanceScore: 78,
  importanceScore: 75,
  evidenceClassification: 'VERIFIED_REPORT',
};

const rankedOrdinal = rankCanonicalPriorityStories([storyB, storyA], 2);

assert(rankedOrdinal[0].rank === 1, 'First place story receives explicit ordinal rank #1');
assert(rankedOrdinal[1].rank === 2, 'Second place story receives explicit ordinal rank #2');
assert(
  rankedOrdinal[0].story.id === 'story-cluster-top-priority',
  'Higher priority story is placed at Rank #1'
);
assert(
  rankedOrdinal[0].strategicImportance === 95,
  'Strategic Importance Score is accurately decoupled (95/100)'
);
assert(
  rankedOrdinal[0].evidenceConfidence === 0.98,
  'Evidence Confidence is accurately isolated (98%)'
);
assert(
  rankedOrdinal[0].priorityScore !== rankedOrdinal[0].rank,
  'Ordinal rank is strictly separated from internal calculation score'
);

// -------------------------------------------------------------
// 4. Safe Non-Fabricated Historical Story Fallback Handling
// -------------------------------------------------------------
console.log('\n[4. Safe Historical Story Handling]');

const historicalStoryWithout7B2: Story = {
  id: 'story-cluster-historical-pre7b2',
  canonicalTitle: 'Samsung Galaxy S26 Ultra Display Specifications Detailed',
  summary: 'Early details on Samsung display technology.',
  status: 'STABLE',
  storyType: 'ANNOUNCEMENT',
  importanceScore: 70, // Old field
  confidence: 0.85,    // Old field
  // Missing 7B.2 fields:
  strategicImportanceScore: undefined,
  evidenceClassification: undefined,
  evidenceConfidence: undefined,
  lastMaterialUpdateAt: undefined,
  firstSeenAt: threeDaysAgo,
  lastSeenAt: threeDaysAgo,
  articleCount: 2,
  articleIds: ['art-s1', 'art-s2'],
  sourceIds: ['src-gsm', 'src-tech'],
  sourceCount: 2,
  companies: [{ companyId: 'comp-samsung', name: 'Samsung' }],
  products: [{ productId: 'prod-s26', name: 'Galaxy S26 Ultra', category: 'SMARTPHONE' }],
  categories: ['SMARTPHONE'],
  topics: ['display'],
  markets: ['Global'],
  languages: ['en'],
  primaryCompanyId: 'comp-samsung',
  primaryProductId: 'prod-s26',
  representativeArticleId: 'art-s1',
  createdAt: threeDaysAgo,
  updatedAt: threeDaysAgo,
  clusteringVersion: 'signalyn-cluster-v1',
};

const rankedHistorical = rankCanonicalPriorityStories([historicalStoryWithout7B2], 1);

assert(rankedHistorical.length === 1, 'Historical stories missing 7B.2 fields are safely eligible');
assert(
  rankedHistorical[0].strategicImportance === 70,
  'Historical story safely falls back to importanceScore without fabrication',
  `Got strategicImportance ${rankedHistorical[0].strategicImportance}`
);
assert(
  rankedHistorical[0].evidenceClassification === 'UNVERIFIED',
  'Historical story missing classification is transparently labeled UNVERIFIED, never falsely confirmed'
);
assert(
  rankedHistorical[0].evidenceConfidence === 0.85,
  'Historical story falls back safely to legacy confidence (0.85)'
);

// -------------------------------------------------------------
// 5. Evidence Classification & Leak vs Official Distinction
// -------------------------------------------------------------
console.log('\n[5. Evidence Classification & Source Reliability]');

const officialStory: Story = {
  ...activeStory,
  id: 'story-cluster-official',
  canonicalTitle: 'Huawei Official Press Release: Mate XT2 Global Release',
  strategicImportanceScore: 75,
  evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
};

const unconfirmedLeakStory: Story = {
  ...activeStory,
  id: 'story-cluster-leak',
  canonicalTitle: 'Tipster Leaks Supposed Render of Mate XT2 Packaging',
  strategicImportanceScore: 75,
  evidenceClassification: 'RUMOR_OR_LEAK',
};

const contradictedStory: Story = {
  ...activeStory,
  id: 'story-cluster-debunked',
  canonicalTitle: 'Debunked Rumor: Mate XT2 Launch Cancelled',
  strategicImportanceScore: 75,
  evidenceClassification: 'CONTRADICTED',
};

const rankedEvidence = rankCanonicalPriorityStories([contradictedStory, unconfirmedLeakStory, officialStory], 3);

assert(
  rankedEvidence[0].story.id === 'story-cluster-official',
  'Official announcement ranks above unconfirmed rumors and leaks'
);
assert(
  rankedEvidence[rankedEvidence.length - 1].story.id === 'story-cluster-debunked',
  'Contradicted / debunked reporting receives heavy penalty and ranks lowest'
);

// -------------------------------------------------------------
// 6. Deterministic Tie-Breaking
// -------------------------------------------------------------
console.log('\n[6. Deterministic Tie-Breaking]');

const tieStoryA: Story = {
  ...activeStory,
  id: 'story-cluster-aaa',
  canonicalTitle: 'Tied Story A',
  strategicImportanceScore: 80,
  evidenceClassification: 'VERIFIED_REPORT',
  lastMaterialUpdateAt: nowIso,
};

const tieStoryB: Story = {
  ...activeStory,
  id: 'story-cluster-bbb',
  canonicalTitle: 'Tied Story B',
  strategicImportanceScore: 80,
  evidenceClassification: 'VERIFIED_REPORT',
  lastMaterialUpdateAt: nowIso,
};

// Evaluate ranking twice in different input orders
const run1 = rankCanonicalPriorityStories([tieStoryB, tieStoryA], 2);
const run2 = rankCanonicalPriorityStories([tieStoryA, tieStoryB], 2);

assert(
  run1[0].story.id === run2[0].story.id && run1[1].story.id === run2[1].story.id,
  'Tie-breaking is perfectly deterministic regardless of input order',
  `Run 1: ${run1.map((r) => r.story.id).join(',')} | Run 2: ${run2.map((r) => r.story.id).join(',')}`
);

// -------------------------------------------------------------
// 7. Backward Compatibility: rankTopPriorityStories wrapper
// -------------------------------------------------------------
console.log('\n[7. Backward Compatibility Wrapper]');

const legacyCallResults = rankTopPriorityStories([activeStory], 1);
assert(legacyCallResults.length === 1, 'rankTopPriorityStories returns valid results');
assert(legacyCallResults[0].rank === 1, 'rankTopPriorityStories wrapper populates rank: 1');
assert(typeof legacyCallResults[0].totalScore === 'number', 'rankTopPriorityStories maintains totalScore');

// -------------------------------------------------------------
// Final Summary
// -------------------------------------------------------------
console.log('\n===============================================================');
console.log(`TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log('===============================================================\n');

if (totalFailed > 0) {
  process.exit(1);
}

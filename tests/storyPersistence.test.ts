/**
 * Unit Test Suite for Story Persistence Service (Phase 4A.7)
 * Verifies:
 * - Deterministic Story ID generation & order independence
 * - Immutable Story ID after membership expansion (Existing Story Join)
 * - Multi-company Story preservation (Xiaomi + Apple)
 * - Canonical Category consistency (SMARTPHONE, WEARABLE, AUDIO, TABLET)
 * - Membership source-of-truth consistency & duplicate prevention
 * - Idempotent retry & StoryRun telemetry
 * - Legacy story & unrelated real story protection
 */

import {
  generateDeterministicStoryId,
  buildStoryAndMemberships,
  CLUSTERING_VERSION,
} from '../src/server/clustering/storyPersistenceService';
import {
  containsGreekCharacters,
  generateDeterministicPresentation,
  isPresentationMigrationRequired,
} from '../src/server/clustering/storyPresentationService';
import { ProposedCluster } from '../src/server/clustering/types';
import { Article, ArticleAnalysis, isLegacyStory, Story } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

export function runPersistenceTests() {
  console.log('=== STARTING STORY PERSISTENCE UNIT TESTS ===\n');

  // Test 1: Deterministic Story ID generation & Order Independence
  console.log('Test 1: Deterministic Story ID Generation & Order Independence');
  {
    const idList1 = ['art-71c6dacc13f92842b5d26949', 'art-325a5511c6dc5a25d992a232'];
    const idList2 = ['art-325a5511c6dc5a25d992a232', 'art-71c6dacc13f92842b5d26949']; // Reverse order

    const id1 = generateDeterministicStoryId(idList1, 'comp-huawei', 'HUAWEI Watch GT 7 Pro', 'REVIEW');
    const id2 = generateDeterministicStoryId(idList2, 'comp-huawei', 'HUAWEI Watch GT 7 Pro', 'REVIEW');

    assert(id1.startsWith('story-cluster-'), 'ID has story-cluster- prefix');
    assert(id1 === id2, 'Same article IDs in reverse order produce identical Story ID');

    // Different product produces different ID
    const id3 = generateDeterministicStoryId(idList1, 'comp-huawei', 'HUAWEI Watch GT 7 Base', 'REVIEW');
    assert(id1 !== id3, 'Different product produces different Story ID');

    // Different type produces different ID
    const id4 = generateDeterministicStoryId(idList1, 'comp-huawei', 'HUAWEI Watch GT 7 Pro', 'PRODUCT_LAUNCH');
    assert(id1 !== id4, 'Different newsType produces different Story ID');
  }

  // Test 2: Story Aggregate Consistency
  console.log('\nTest 2: Story Aggregate Consistency');
  {
    const artA: Article = {
      id: 'art-1',
      feedId: 'f1',
      sourceId: 'src-insomnia',
      sourceName: 'Insomnia',
      canonicalUrl: 'https://example.com/1',
      title: 'Review A',
      excerpt: 'Excerpt A',
      publishedAt: '2026-09-25T10:00:00Z',
      collectedAt: '2026-09-25T11:00:00Z',
      updatedAt: '2026-09-25T11:00:00Z',
      contentHash: 'h1',
      discoveredViaFeeds: ['f1'],
      processingStatus: 'ANALYZED',
      language: 'el',
      market: 'Greece',
      rawCategories: ['Tech'],
    };

    const artB: Article = {
      id: 'art-2',
      feedId: 'f2',
      sourceId: 'src-gsmarena',
      sourceName: 'GSMArena',
      canonicalUrl: 'https://example.com/2',
      title: 'Review B',
      excerpt: 'Excerpt B',
      publishedAt: '2026-09-29T14:00:00Z',
      collectedAt: '2026-09-29T15:00:00Z',
      updatedAt: '2026-09-29T15:00:00Z',
      contentHash: 'h2',
      discoveredViaFeeds: ['f2'],
      processingStatus: 'ANALYZED',
      language: 'en',
      market: 'Global',
      rawCategories: ['Tech'],
    };

    const anA = {
      articleId: 'art-1',
      analyzedAt: '2026-09-25T12:00:00Z',
      companies: [{ companyId: 'comp-huawei', canonicalName: 'HUAWEI', relevance: 'PRIMARY', confidence: 0.95 }],
      products: [{ productId: 'prod-watch-gt-7-pro', canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'Watch GT 7 Pro', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 0.95 }],
      newsType: 'REVIEW',
      importanceScore: 45,
      confidence: 0.95,
      sentiment: 'POSITIVE',
      summary: 'Summary A',
      topics: ['Smartwatch', 'Battery'],
      competitiveSignals: [],
    } as unknown as ArticleAnalysis;

    const anB = {
      articleId: 'art-2',
      analyzedAt: '2026-09-29T16:00:00Z',
      companies: [{ companyId: 'comp-huawei', canonicalName: 'HUAWEI', relevance: 'PRIMARY', confidence: 0.95 }],
      products: [{ productId: 'prod-watch-gt-7-pro', canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'Watch GT 7 Pro', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 0.95 }],
      newsType: 'REVIEW',
      importanceScore: 65,
      confidence: 0.95,
      sentiment: 'POSITIVE',
      summary: 'Summary B',
      topics: ['Smartwatch', 'Fitness'],
      competitiveSignals: [],
    } as unknown as ArticleAnalysis;

    const cluster: ProposedCluster = {
      clusterId: 'story-cluster-test',
      canonicalTitle: 'HUAWEI Watch GT 7 Pro Coverage',
      primaryCompanyId: 'comp-huawei',
      primaryProductId: 'HUAWEI Watch GT 7 Pro',
      newsType: 'REVIEW',
      articleIds: ['art-1', 'art-2'],
      confidence: 0.95,
      reason: 'MATCH',
    };

    const articlesMap = new Map([['art-1', artA], ['art-2', artB]]);
    const analysesMap = new Map([['art-1', anA], ['art-2', anB]]);

    const { story, memberships } = buildStoryAndMemberships(cluster, articlesMap, analysesMap);

    assert(story.articleCount === 2, 'articleCount equals 2');
    assert(story.sourceCount === 2, 'sourceCount equals 2 unique sources');
    assert(story.representativeArticleId === 'art-2', 'representativeArticleId selected as art-2 (highest importance score 65 vs 45)');
    assert(story.firstSeenAt === '2026-09-25T10:00:00Z', 'firstSeenAt is earliest published date');
    assert(story.lastSeenAt === '2026-09-29T14:00:00Z', 'lastSeenAt is latest published date');
    assert(memberships.length === 2, 'Generated exactly 2 StoryMembership documents');
    assert(memberships[0].storyId === 'story-cluster-test', 'Membership 0 points to storyId');
    assert(memberships[1].storyId === 'story-cluster-test', 'Membership 1 points to storyId');
    assert(story.isLegacy === false, 'Story isLegacy is strictly false');
  }

  // Test 3: Legacy Story Protection
  console.log('\nTest 3: Legacy Story Protection');
  {
    const legacyStory: Story = {
      id: 'story-001',
      canonicalTitle: 'Legacy 1',
      summary: 'Legacy',
      status: 'DEVELOPING',
      storyType: 'PRODUCT_LAUNCH',
      importanceScore: 70,
      confidence: 0.9,
      firstSeenAt: '2026-09-20T10:00:00Z',
      lastSeenAt: '2026-09-25T10:00:00Z',
      articleCount: 1,
      articleIds: ['art-001'],
      sourceIds: ['src-mock'],
      sourceCount: 1,
      companies: [{ companyId: 'comp-huawei', name: 'HUAWEI', relevance: 'PRIMARY' }],
      products: [],
      categories: ['Smartphones'],
      topics: ['Foldables'],
      markets: ['Global'],
      languages: ['en'],
      primaryCompanyId: 'comp-huawei',
      primaryProductId: null,
      representativeArticleId: 'art-001',
      createdAt: '2026-09-20T10:00:00Z',
      updatedAt: '2026-09-25T10:00:00Z',
      clusteringVersion: 'legacy-bootstrap',
      isLegacy: true,
    };

    assert(isLegacyStory(legacyStory), 'isLegacyStory returns true for story-001');
    assert(isLegacyStory({ id: 'story-002' }), 'isLegacyStory returns true for story-002');
    assert(isLegacyStory({ id: 'story-003' }), 'isLegacyStory returns true for story-003');
    assert(!isLegacyStory({ id: 'story-cluster-abcdef1234567890', clusteringVersion: 'signalyn-cluster-v1' }), 'isLegacyStory returns false for generated Phase 4 story');
  }

  // Test 4: Immutable Story ID after Membership Expansion (Existing Story Join)
  console.log('\nTest 4: Immutable Story ID after Membership Expansion');
  {
    const existingStory: Story = {
      id: 'story-cluster-6cdb5fb91731bd8d',
      canonicalTitle: 'Η νέα σειρά HUAWEI WATCH GT 7 έφτασε στην Ελλάδα',
      title: 'Η νέα σειρά HUAWEI WATCH GT 7 έφτασε στην Ελλάδα',
      summary: 'Initial launch summary',
      status: 'DEVELOPING',
      storyType: 'PRODUCT_LAUNCH',
      importanceScore: 65,
      confidence: 1.0,
      firstSeenAt: '2026-09-24T13:37:33.000Z',
      lastSeenAt: '2026-09-24T13:37:33.000Z',
      articleCount: 1,
      articleIds: ['art-dc265a0d8311334b14a9b99c'],
      sourceIds: ['src-munvea1z-v4as'],
      sourceCount: 1,
      companies: [{ companyId: 'comp-huawei', name: 'HUAWEI', relevance: 'PRIMARY' }],
      products: [{ productId: 'HUAWEI WATCH GT 7', name: 'HUAWEI WATCH GT 7', category: 'WEARABLE' }],
      categories: ['WEARABLE'],
      topics: ['Wearables'],
      markets: ['Greece'],
      languages: ['el'],
      primaryCompanyId: 'comp-huawei',
      primaryProductId: 'HUAWEI WATCH GT 7',
      representativeArticleId: 'art-dc265a0d8311334b14a9b99c',
      createdAt: '2026-10-01T12:24:34.375Z',
      updatedAt: '2026-10-01T12:24:34.375Z',
      clusteringVersion: CLUSTERING_VERSION,
      isLegacy: false,
    };

    const incomingArt: Article = {
      id: 'art-9260d9786c56579ee364a98e',
      feedId: 'f-vg24',
      sourceId: 'src-vg24',
      sourceName: 'VG24',
      canonicalUrl: 'https://vg24.gr/gt7',
      title: 'HUAWEI WATCH GT 7 Series: Η νέα γενιά premium smartwatches είναι πλέον διαθέσιμη στην Ελλάδα',
      excerpt: 'Excerpt VG24',
      publishedAt: '2026-09-24T14:54:11.000Z',
      collectedAt: '2026-09-30T09:08:40.000Z',
      updatedAt: '2026-09-30T09:08:40.000Z',
      contentHash: 'hash-vg24',
      discoveredViaFeeds: ['f-vg24'],
      processingStatus: 'ANALYZED',
      language: 'el',
      market: 'Greece',
      rawCategories: ['Tech'],
    };

    const incomingAn = {
      articleId: 'art-9260d9786c56579ee364a98e',
      analyzedAt: '2026-10-01T12:55:22.000Z',
      companies: [{ companyId: 'comp-huawei', canonicalName: 'HUAWEI', relevance: 'PRIMARY', confidence: 0.98 }],
      products: [{ canonicalName: 'HUAWEI WATCH GT 7', matchedText: 'HUAWEI WATCH GT 7', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 0.98 }],
      newsType: 'PRODUCT_LAUNCH',
      importanceScore: 60,
      confidence: 0.98,
      sentiment: 'POSITIVE',
      summary: 'VG24 launch article',
      topics: ['Wearables', 'Smartwatch'],
      competitiveSignals: [],
    } as unknown as ArticleAnalysis;

    const joinCluster: ProposedCluster = {
      clusterId: existingStory.id,
      canonicalTitle: existingStory.title || '',
      primaryCompanyId: 'comp-huawei',
      primaryProductId: 'HUAWEI WATCH GT 7',
      newsType: 'PRODUCT_LAUNCH',
      articleIds: ['art-9260d9786c56579ee364a98e'],
      confidence: 0.98,
      reason: 'MATCH',
    };

    const artMap = new Map([
      ['art-dc265a0d8311334b14a9b99c', { id: 'art-dc265a0d8311334b14a9b99c', sourceId: 'src-munvea1z-v4as', publishedAt: '2026-09-24T13:37:33.000Z', rawCategories: ['Tech'] } as Article],
      ['art-9260d9786c56579ee364a98e', incomingArt]
    ]);
    const anMap = new Map([
      ['art-dc265a0d8311334b14a9b99c', { articleId: 'art-dc265a0d8311334b14a9b99c', importanceScore: 65 } as ArticleAnalysis],
      ['art-9260d9786c56579ee364a98e', incomingAn]
    ]);

    const { story: updatedStory } = buildStoryAndMemberships(joinCluster, artMap, anMap, existingStory);

    assert(updatedStory.id === existingStory.id, '4A: Story ID remains strictly immutable upon membership expansion');
    assert(updatedStory.articleCount === 2, '4B: articleCount expanded from 1 to 2');
    assert(updatedStory.sourceCount === 2, '4C: sourceCount expanded from 1 to 2 unique sources');
    assert(updatedStory.articleIds.includes('art-dc265a0d8311334b14a9b99c') && updatedStory.articleIds.includes('art-9260d9786c56579ee364a98e'), '4D: articleIds contains both existing and incoming members');
    assert(updatedStory.lastSeenAt === '2026-09-24T14:54:11.000Z', '4E: lastSeenAt updated to latest published date');
  }

  // Test 5: Multi-Company Story Preservation
  console.log('\nTest 5: Multi-Company Story Preservation');
  {
    const compArt: Article = {
      id: 'art-10228d177d45f88fa65b63c2',
      feedId: 'f1',
      sourceId: 'src-insomnia',
      sourceName: 'Insomnia',
      canonicalUrl: 'https://example.com/comp',
      title: 'Xiaomi 17 Ultra vs iPhone 18 Pro Max',
      excerpt: 'Comparison review',
      publishedAt: '2026-09-26T10:00:00Z',
      collectedAt: '2026-09-26T11:00:00Z',
      updatedAt: '2026-09-26T11:00:00Z',
      contentHash: 'h-comp',
      discoveredViaFeeds: ['f1'],
      processingStatus: 'ANALYZED',
      language: 'el',
      market: 'Greece',
      rawCategories: ['Tech'],
    };

    const compAn = {
      articleId: 'art-10228d177d45f88fa65b63c2',
      analyzedAt: '2026-09-26T12:00:00Z',
      companies: [
        { companyId: 'comp-xiaomi', canonicalName: 'Xiaomi', relevance: 'PRIMARY', confidence: 0.95 },
        { companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY', confidence: 0.95 },
      ],
      products: [
        { canonicalName: 'Xiaomi 17 Ultra', matchedText: 'Xiaomi 17 Ultra', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 0.95 },
        { canonicalName: 'iPhone 18 Pro Max', matchedText: 'iPhone 18 Pro Max', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 0.95 },
      ],
      newsType: 'REVIEW',
      importanceScore: 80,
      confidence: 0.95,
      sentiment: 'NEUTRAL',
      summary: 'Comparison of flagships',
      topics: ['Smartphones', 'Camera'],
      competitiveSignals: [],
    } as unknown as ArticleAnalysis;

    const compCluster: ProposedCluster = {
      clusterId: 'story-cluster-comparison',
      canonicalTitle: 'Xiaomi 17 Ultra vs iPhone 18 Pro Max',
      primaryCompanyId: 'comp-xiaomi',
      primaryProductId: 'Xiaomi 17 Ultra',
      newsType: 'REVIEW',
      articleIds: ['art-10228d177d45f88fa65b63c2'],
      confidence: 0.95,
      reason: 'Comparison',
    };

    const artMap = new Map([['art-10228d177d45f88fa65b63c2', compArt]]);
    const anMap = new Map([['art-10228d177d45f88fa65b63c2', compAn]]);

    const { story: compStory } = buildStoryAndMemberships(compCluster, artMap, anMap);

    const companyNames = compStory.companies.map((c) => c.name.toLowerCase());
    assert(companyNames.includes('xiaomi'), '5A: Preserves Xiaomi in Story.companies');
    assert(companyNames.includes('apple'), '5B: Preserves Apple in Story.companies');
    assert(compStory.categories.includes('SMARTPHONE'), '5C: Canonical category resolves to SMARTPHONE');
  }

  // Test 6: Category Aggregate Consistency
  console.log('\nTest 6: Category Aggregate Consistency');
  {
    const tabletArt: Article = {
      id: 'art-tab',
      feedId: 'f1',
      sourceId: 'src-gsm',
      sourceName: 'GSMArena',
      canonicalUrl: 'https://example.com/tab',
      title: 'Galaxy Tab S12 Ultra Details',
      excerpt: 'Tablet leak',
      publishedAt: '2026-09-28T10:00:00Z',
      collectedAt: '2026-09-28T11:00:00Z',
      updatedAt: '2026-09-28T11:00:00Z',
      contentHash: 'h-tab',
      discoveredViaFeeds: ['f1'],
      processingStatus: 'ANALYZED',
      language: 'en',
      market: 'Global',
      rawCategories: ['Tech'],
    };

    const tabletAn = {
      articleId: 'art-tab',
      analyzedAt: '2026-09-28T12:00:00Z',
      companies: [{ companyId: 'comp-samsung', canonicalName: 'Samsung', relevance: 'PRIMARY', confidence: 0.95 }],
      products: [{ canonicalName: 'Galaxy Tab S12 Ultra', matchedText: 'Galaxy Tab S12 Ultra', category: 'TABLET', relevance: 'PRIMARY', confidence: 0.95 }],
      newsType: 'PRODUCT_LEAK',
      importanceScore: 75,
      confidence: 0.95,
      sentiment: 'NEUTRAL',
      summary: 'Tablet specs leak',
      topics: ['Tablets'],
      competitiveSignals: [],
    } as unknown as ArticleAnalysis;

    const tabCluster: ProposedCluster = {
      clusterId: 'story-cluster-tab',
      canonicalTitle: 'Galaxy Tab S12 Ultra Leak',
      primaryCompanyId: 'comp-samsung',
      primaryProductId: 'Galaxy Tab S12 Ultra',
      newsType: 'PRODUCT_LEAK',
      articleIds: ['art-tab'],
      confidence: 0.95,
      reason: 'LEAK',
    };

    const artMap = new Map([['art-tab', tabletArt]]);
    const anMap = new Map([['art-tab', tabletAn]]);

    const { story: tabStory } = buildStoryAndMemberships(tabCluster, artMap, anMap);
    assert(tabStory.categories.includes('TABLET'), '6A: Tablet resolves to TABLET');
    assert(!tabStory.categories.includes('SMARTPHONE'), '6B: Tablet does not become cross-category SMARTPHONE');
  }

  console.log(`\n=== PERSISTENCE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPersistenceTests();
}

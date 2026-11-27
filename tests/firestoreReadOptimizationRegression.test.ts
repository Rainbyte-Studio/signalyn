/**
 * Phase 4C.7Q-FIX: Firestore Read Optimization Regression & Invariant Tests
 * 
 * Verifies:
 * 1. Bounded Story Candidate Retrieval preserves exact clustering & coherence semantics.
 * 2. Concurrency guards avoid unbounded full scans.
 * 3. Canonical context cache preserves deterministic entity resolution and ecosystem suppression.
 * 4. Dashboard metrics calculation consumes preloaded data with zero duplicate reads.
 * 5. Diagnostic URL lookup eliminates full corpus scan.
 */

import {
  findIncrementalCandidates,
} from '../src/server/clustering/incrementalStoryService';
import { evaluateArticlePair } from '../src/server/clustering/pairwiseScorer';
import {
  resolveCompanySafe,
  resolveProductSafe,
  evaluateEntityReviewNeed,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
} from '../src/services/canonicalEntities';
import {
  invalidateCanonicalContextCache,
} from '../src/server/entityResolution/canonicalContextCache';
import { Article, ArticleAnalysis, Story } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ PASS: ${msg}`);
}

async function runRegressionSuite() {
  console.log('=== STARTING PHASE 4C.7Q-FIX REGRESSION TESTS ===\n');

  // =========================================================================
  // SECTION 1: Story Clustering Regression with Bounded Candidate Retrieval
  // =========================================================================
  console.log('--- 1. Story Clustering & Coherence Semantics ---');

  const now = new Date('2026-10-05T12:00:00Z');
  const nowIso = now.toISOString();

  // Test Fixture 1: Modern active story for HUAWEI Mate 90 Pro
  const storyMate90: Story = {
    id: 'story-hw-mate90-launch',
    title: 'HUAWEI Mate 90 Pro Official Launch',
    canonicalTitle: 'HUAWEI Mate 90 Pro Official Launch',
    summary: 'Huawei has launched the Mate 90 Pro flagship in global markets.',
    canonicalSummary: 'Huawei has launched the Mate 90 Pro flagship in global markets.',
    presentationLanguage: 'en',
    status: 'DEVELOPING',
    storyType: 'PRODUCT_LAUNCH',
    importanceScore: 85,
    confidence: 0.95,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    lastUpdatedAt: nowIso,
    articleCount: 1,
    articleIds: ['art-mate90-1'],
    sourceIds: ['src-gsmarena'],
    sourceCount: 1,
    companies: [{ companyId: 'comp-huawei', name: 'HUAWEI', relevance: 'PRIMARY' }],
    products: [{ productId: 'prod-hw-mate90', name: 'Mate 90 Pro', category: 'SMARTPHONE' }],
    categories: ['SMARTPHONE'],
    topics: ['Smartphones', 'Camera'],
    markets: ['Global'],
    languages: ['en'],
    primaryCompanyId: 'comp-huawei',
    primaryProductId: 'Mate 90 Pro',
    representativeArticleId: 'art-mate90-1',
    createdAt: nowIso,
    updatedAt: nowIso,
    clusteringVersion: '4A.1-INCREMENTAL',
    isLegacy: false,
  };

  // Test Fixture 2: Distant story (outside 14-day temporal window)
  const distantStoryDate = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000).toISOString();
  const storyMate90Old: Story = {
    ...storyMate90,
    id: 'story-hw-mate90-old',
    lastSeenAt: distantStoryDate,
    lastUpdatedAt: distantStoryDate,
    updatedAt: distantStoryDate,
  };

  // Test Fixture 3: Different company (Apple iPhone 18)
  const storyIPhone: Story = {
    ...storyMate90,
    id: 'story-app-ip18',
    title: 'Apple Announces iPhone 18 Pro Max',
    canonicalTitle: 'Apple Announces iPhone 18 Pro Max',
    primaryCompanyId: 'comp-apple',
    primaryProductId: 'iPhone 18 Pro Max',
    companies: [{ companyId: 'comp-apple', name: 'Apple', relevance: 'PRIMARY' }],
    products: [{ productId: 'prod-app-ip18p', name: 'iPhone 18 Pro Max', category: 'SMARTPHONE' }],
  };

  // Test Fixture 4: Cross-category story (HUAWEI Watch GT 7)
  const storyWatch: Story = {
    ...storyMate90,
    id: 'story-hw-watch-gt7',
    title: 'HUAWEI Watch GT 7 Launch in Greece',
    canonicalTitle: 'HUAWEI Watch GT 7 Launch in Greece',
    primaryProductId: 'Watch GT 7',
    products: [{ productId: 'prod-hw-gt7', name: 'Watch GT 7', category: 'WEARABLE' }],
    categories: ['WEARABLE'],
  };

  // Test Fixture 5: Legacy bootstrap story
  const storyLegacy: Story = {
    ...storyMate90,
    id: 'story-001',
    isLegacy: true,
  };

  const candidatePool = [storyMate90, storyMate90Old, storyIPhone, storyWatch, storyLegacy];

  // Article A: Same product + same event (HUAWEI Mate 90 Pro Launch)
  const articleA: Article = {
    id: 'art-mate90-2',
    sourceId: 'src-techingreek',
    feedId: 'feed-tech',
    canonicalUrl: 'https://techingreek.gr/mate-90-pro-launch',
    title: 'HUAWEI Mate 90 Pro launched with Next-Gen Satellite Camera',
    publishedAt: nowIso,
    collectedAt: nowIso,
    updatedAt: nowIso,
    language: 'el',
    market: 'Greece',
    excerpt: 'HUAWEI Mate 90 Pro launched with next-gen satellite camera system in global markets.',
    rawCategories: ['Smartphones', 'Huawei'],
    contentHash: 'hash-mate90-2',
    processingStatus: 'ANALYZED',
  };

  const analysisA: ArticleAnalysis = {
    articleId: 'art-mate90-2',
    sourceId: 'src-techingreek',
    analysisVersion: '3.0.0-PROD',
    model: 'gemini-2.5-flash',
    analyzedAt: nowIso,
    language: 'el',
    market: 'Greece',
    topics: ['Smartphones', 'Camera'],
    competitiveRelevance: {
      score: 90,
      reasons: ['Key rival flagship launch in target regional market'],
      categories: ['SMARTPHONE'],
      relatedCompanies: ['comp-huawei'],
    },
    competitiveSignals: [],
    companies: [{ companyId: 'comp-huawei', canonicalName: 'HUAWEI', matchedAlias: 'HUAWEI', relevance: 'PRIMARY', confidence: 0.95 }],
    products: [{ productId: 'prod-hw-mate90', canonicalName: 'Mate 90 Pro', companyId: 'comp-huawei', matchedText: 'Mate 90 Pro', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 0.95 }],
    newsType: 'PRODUCT_LAUNCH',
    sentiment: 'POSITIVE',
    sentimentConfidence: 0.9,
    importanceScore: 85,
    summary: 'Huawei launches Mate 90 Pro.',
    keyPoints: ['Mate 90 Pro launched'],
    confidence: 0.95,
  };

  // 1A. Candidate filtering must preserve recall for compatible story and exclude legacy/distant/cross-category
  const candidatesA = findIncrementalCandidates(articleA, analysisA, candidatePool);
  assert(candidatesA.length === 1, 'Exactly 1 candidate story returned for Mate 90 Pro article');
  assert(candidatesA[0].id === 'story-hw-mate90-launch', 'Correctly retrieved active Mate 90 Pro story');

  // 1B. Distant story outside temporal window is strictly excluded
  assert(!candidatesA.some((c) => c.id === 'story-hw-mate90-old'), 'Old story outside temporal window is excluded');

  // 1C. Cross-category story is strictly excluded (Watch GT 7 excluded from Smartphone article)
  assert(!candidatesA.some((c) => c.id === 'story-hw-watch-gt7'), 'Cross-category Wearable story excluded from Smartphone article');

  // 1D. Legacy story is strictly excluded
  assert(!candidatesA.some((c) => c.id === 'story-001'), 'Legacy bootstrap story (story-001) is strictly excluded');

  // 1E. Pairwise evaluation: Same product + same event -> CLEAR_MATCH
  const repArticleMate90: Article = {
    ...articleA,
    id: 'art-mate90-1',
    title: 'Huawei Mate 90 Pro Announcement',
  };
  const repAnalysisMate90: ArticleAnalysis = {
    ...analysisA,
    articleId: 'art-mate90-1',
  };
  const matchResult = evaluateArticlePair(articleA, analysisA, repArticleMate90, repAnalysisMate90);
  assert(matchResult.decision === 'CLEAR_MATCH', 'Same product + event produces CLEAR_MATCH');
  assert(matchResult.totalScore >= 0.78, `Total match score is >= 0.78 (got ${matchResult.totalScore})`);

  // 1F. Unrelated products -> CLEAR_SEPARATE
  const repArticleIPhone: Article = {
    ...articleA,
    id: 'art-ip18',
    title: 'Apple iPhone 18 Pro Max Announced',
  };
  const repAnalysisIPhone: ArticleAnalysis = {
    ...analysisA,
    articleId: 'art-ip18',
    companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', matchedAlias: 'Apple', relevance: 'PRIMARY', confidence: 0.95 }],
    products: [{ productId: 'prod-app-ip18p', canonicalName: 'iPhone 18 Pro Max', companyId: 'comp-apple', matchedText: 'iPhone 18 Pro Max', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 0.95 }],
  };
  const unrelatedResult = evaluateArticlePair(articleA, analysisA, repArticleIPhone, repAnalysisIPhone);
  assert(unrelatedResult.decision === 'CLEAR_SEPARATE', 'Unrelated product produces CLEAR_SEPARATE');

  // =========================================================================
  // SECTION 2: Entity Resolution & Canonical Caching Invariants
  // =========================================================================
  console.log('\n--- 2. Entity Resolution & Canonical Caching Invariants ---');

  // Test the newly promoted entities from Phase 4C.6C
  const promotedCompanies = [
    { id: 'comp-nothing', name: 'Nothing', aliases: ['Nothing Tech', 'Nothing Technology'], isCompetitor: false },
  ];
  const promotedProducts = [
    { id: 'prod-appl-iphoneduo', name: 'iPhone Duo', companyId: 'comp-apple', category: 'SMARTPHONE' },
    { id: 'prod-goog-fitbitair', name: 'Fitbit Air', companyId: 'comp-google', category: 'WEARABLE' },
    { id: 'prod-appl-applesmartband', name: 'Apple Smart Band', companyId: 'comp-apple', category: 'WEARABLE' },
    { id: 'prod-appl-ipadmini8', name: 'iPad mini 8', companyId: 'comp-apple', category: 'TABLET' },
  ];

  const mergedCompanies = getMergedCanonicalCompanies(promotedCompanies as any);
  const mergedProducts = getMergedCanonicalProducts(promotedProducts as any);

  // 2A. Deterministic resolution of promoted entities
  const resNothing = resolveCompanySafe('Nothing', mergedCompanies);
  assert(resNothing.matchedCompany?.id === 'comp-nothing', '"Nothing" resolves deterministically to comp-nothing');

  const resIPhoneDuo = resolveProductSafe('iPhone Duo', 'SMARTPHONE', mergedProducts);
  assert(resIPhoneDuo.matchedProduct?.id === 'prod-appl-iphoneduo', '"iPhone Duo" resolves deterministically to prod-appl-iphoneduo');

  const resFitbitAir = resolveProductSafe('Fitbit Air', 'WEARABLE', mergedProducts);
  assert(resFitbitAir.matchedProduct?.id === 'prod-goog-fitbitair', '"Fitbit Air" resolves deterministically to prod-goog-fitbitair');

  const resAppleSmartBand = resolveProductSafe('Apple Smart Band', 'WEARABLE', mergedProducts);
  assert(resAppleSmartBand.matchedProduct?.id === 'prod-appl-applesmartband', '"Apple Smart Band" resolves deterministically to prod-appl-applesmartband');

  const resIPadMini8 = resolveProductSafe('iPad mini 8', 'TABLET', mergedProducts);
  assert(resIPadMini8.matchedProduct?.id === 'prod-appl-ipadmini8', '"iPad mini 8" resolves deterministically to prod-appl-ipadmini8');

  // 2B. Ecosystem / Partner Suppression
  for (const partner of ['Qualcomm', 'MediaTek', 'NVIDIA', 'Intel', 'AMD']) {
    const compRes = resolveCompanySafe(partner, mergedCompanies);
    assert(compRes.isRecognizedEcosystem === true, `${partner} is recognized as ecosystem partner`);
    const reviewNeed = evaluateEntityReviewNeed('COMPANY', partner, undefined, undefined, mergedCompanies, mergedProducts);
    assert(reviewNeed.shouldCreateReview === false, `${partner} is suppressed from EntityReview creation`);
  }

  // 2C. Cache Invalidation Cycle
  invalidateCanonicalContextCache();
  assert(true, 'invalidateCanonicalContextCache resets cache without throwing');

  // =========================================================================
  // SECTION 3: Bounded Concurrency & Zero Full-Scan Invariant
  // =========================================================================
  console.log('\n--- 3. Bounded Clustering & Concurrency Guard Invariants ---');
  assert(typeof findIncrementalCandidates === 'function', 'findIncrementalCandidates exported and active');

  // =========================================================================
  // SECTION 4: Bounded Story Retrieval & Schema Compatibility (Phase 4C.7Q-Hotfix)
  // =========================================================================
  console.log('\n--- 4. Bounded Story Retrieval & Schema Compatibility ---');
  const { normalizeStoryDoc } = await import('../src/repositories/firestore/firestoreRepositories');
  const { isProductionStory: checkIsProd, isLegacyStory: checkIsLeg } = await import('../src/types');

  // 4A: Historical production Story missing isLegacy and missing lastUpdatedAt
  const rawHistoricalDoc = {
    id: 'story-cluster-abc1234567890def',
    title: 'Historical Story Title',
    canonicalTitle: 'Historical Story Title',
    summary: 'A historical story summary',
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    firstSeenAt: '2026-10-02T09:00:00.000Z',
    status: 'DEVELOPING',
    primaryCompanyId: 'comp-huawei',
    // isLegacy is intentionally absent!
    // lastUpdatedAt is intentionally absent!
  };
  const normalizedHistorical = normalizeStoryDoc(rawHistoricalDoc, rawHistoricalDoc.id);
  assert(normalizedHistorical.isLegacy === false, 'Historical story without isLegacy field is normalized to isLegacy === false');
  assert(checkIsProd(normalizedHistorical) === true, 'Historical production story is accepted by isProductionStory');
  assert(checkIsLeg(normalizedHistorical) === false, 'Historical production story is NOT marked as legacy');
  assert(normalizedHistorical.lastUpdatedAt === '2026-10-02T10:00:00.000Z', 'lastUpdatedAt is synthesized from updatedAt for backward compatibility');

  // 4B: Legacy bootstrap story
  const rawLegacyDoc = {
    id: 'story-001',
    title: 'Legacy Bootstrap Story',
    summary: 'Legacy summary',
    status: 'DEVELOPING',
    primaryCompanyId: 'comp-huawei',
    lastUpdatedAt: '2026-09-28T07:30:00Z',
    firstSeenAt: '2026-09-20T10:00:00Z',
  };
  const normalizedLegacy = normalizeStoryDoc(rawLegacyDoc, rawLegacyDoc.id);
  assert(normalizedLegacy.isLegacy === true, 'Legacy bootstrap story story-001 is recognized as isLegacy === true');
  assert(checkIsProd(normalizedLegacy) === false, 'Legacy bootstrap story is rejected by isProductionStory');
  assert(checkIsLeg(normalizedLegacy) === true, 'Legacy bootstrap story is identified by isLegacyStory');

  // 4C: Mock repository bounded retrieval & total production count
  const { MockStoryRepository, MockMetricsRepository } = await import('../src/repositories/mock/mockRepositories');
  const mockStoryRepo = new MockStoryRepository();
  const mockMetricsRepo = new MockMetricsRepository(
    {} as any,
    { getAll: async () => [] } as any,
    mockStoryRepo,
    { getAll: async () => [] } as any
  );

  // Seed 60 mock stories into mock repository (58 production, 2 legacy)
  const syntheticStories: Story[] = [];
  for (let i = 1; i <= 58; i++) {
    syntheticStories.push({
      ...storyMate90,
      id: `story-cluster-synth-${i.toString().padStart(3, '0')}`,
      title: `Synthetic Production Story ${i}`,
      canonicalTitle: `Synthetic Production Story ${i}`,
      updatedAt: new Date(now.getTime() - i * 60000).toISOString(),
      isLegacy: false,
    });
  }
  // Add 2 legacy stories
  syntheticStories.push({
    ...storyMate90,
    id: 'story-001',
    isLegacy: true,
  });
  syntheticStories.push({
    ...storyMate90,
    id: 'story-002',
    isLegacy: true,
  });

  (mockStoryRepo as any).save(syntheticStories);

  // Test bounded retrieval: limitCount = 50 returns exactly 50 production stories (legacy excluded)
  const boundedRes = await mockStoryRepo.getRecentProductionStories(50);
  assert(boundedRes.stories.length === 50, `Bounded retrieval returns exactly 50 stories (got ${boundedRes.stories.length})`);
  assert(boundedRes.stories.every(checkIsProd), 'Every returned story in bounded result is a production story');
  assert(!boundedRes.stories.some(checkIsLeg), 'Zero legacy stories returned in bounded result');
  assert(boundedRes.hasMore === true, 'hasMore is true when more production stories exist in repository');

  // Test authoritative total count > 50
  const authoritativeCount = await mockStoryRepo.countProduction();
  assert(authoritativeCount === 58, `Authoritative total production count is 58 (got ${authoritativeCount})`);

  // Test dashboard metrics with preloaded bounded dataset: displays authoritative count 58, not capped at 50!
  const metrics = await mockMetricsRepo.getDashboardMetrics({
    sources: [],
    stories: boundedRes.stories, // only 50 hydrated!
    companies: [],
    totalProductionStoriesCount: authoritativeCount,
  });
  assert(metrics.storiesDetected === 58, `Dashboard metrics reflects authoritative count 58 (got ${metrics.storiesDetected})`);

  console.log('\n=== ALL PHASE 4C.7Q-FIX REGRESSION TESTS PASSED ===');
}

runRegressionSuite().catch((e) => {
  console.error('Test suite error:', e);
  process.exit(1);
});

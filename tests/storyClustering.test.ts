/**
 * Unit Test Suite for Signalyn Phase 4A Deterministic Story Clustering Engine
 * 
 * Verifies Requirements A through J:
 * A. Same company + same exact product + compatible event signals
 * B. Same company + same product + incompatible newsType
 * C. Same product family but different exact product
 * D. Same product but distant publication dates
 * E. Same product but technical review vs lifestyle/editorial context
 * F. Completely unrelated company/product
 * G. Ambiguous evidence
 * H. Legacy Story exclusion
 * I. Candidate result limit
 * J. Deterministic repeatability
 */

import { Article, ArticleAnalysis, Story } from '../src/types';
import { StoryClusteringEngine } from '../src/server/clustering/storyClusteringEngine';
import { evaluateArticlePair } from '../src/server/clustering/pairwiseScorer';

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

function createMockArticle(overrides: Partial<Article>): Article {
  return {
    id: overrides.id || 'art-mock-1',
    feedId: 'feed-mock',
    sourceId: overrides.sourceId || 'src-mock',
    sourceName: overrides.sourceName || 'Mock Source',
    canonicalUrl: overrides.canonicalUrl || 'https://example.com/article',
    title: overrides.title || 'Mock Article Title',
    excerpt: overrides.excerpt || 'Mock Article Excerpt',
    publishedAt: overrides.publishedAt || '2026-09-25T12:00:00Z',
    collectedAt: '2026-09-25T12:30:00Z',
    updatedAt: overrides.updatedAt || '2026-09-25T12:00:00Z',
    contentHash: 'hash123',
    discoveredViaFeeds: ['feed-mock'],
    processingStatus: 'ANALYZED',
    language: overrides.language || 'el',
    market: overrides.market || 'Greece',
    rawCategories: ['Technology'],
    ...overrides,
  };
}

function createMockAnalysis(overrides: Partial<ArticleAnalysis>): ArticleAnalysis {
  return {
    articleId: overrides.articleId || 'art-mock-1',
    sourceId: overrides.sourceId || 'src-mock',
    analysisVersion: 'signalyn-analysis-v1',
    model: 'gemini-3.1-flash-lite',
    analyzedAt: '2026-09-25T13:00:00Z',
    language: 'el',
    market: overrides.market || 'Greece',
    companies: overrides.companies || [
      {
        companyId: 'comp-huawei',
        canonicalName: 'HUAWEI',
        matchedAlias: 'HUAWEI',
        relevance: 'PRIMARY',
        confidence: 1.0,
      },
    ],
    products: overrides.products || [
      {
        canonicalName: 'HUAWEI WATCH GT 7 Pro',
        matchedText: 'HUAWEI WATCH GT 7 Pro',
        category: 'WEARABLES',
        subcategory: 'Smartwatch',
        relevance: 'PRIMARY',
        confidence: 1.0,
      },
    ],
    topics: overrides.topics || ['Wearables', 'Health', 'Fitness'],
    newsType: overrides.newsType || 'REVIEW',
    sentiment: 'POSITIVE',
    sentimentConfidence: 0.9,
    importanceScore: overrides.importanceScore ?? 65,
    summary: overrides.summary || 'Summary of the review',
    keyPoints: overrides.keyPoints || ['Key point 1'],
    competitiveSignals: overrides.competitiveSignals || [],
    competitiveRelevance: overrides.competitiveRelevance || {
      score: 50,
      reasons: ['Test competitive reasoning'],
      categories: ['Wearables'],
      relatedCompanies: ['Apple', 'Samsung'],
    },
    confidence: overrides.confidence ?? 0.95,
    ...overrides,
  };
}

export async function runTests() {
  console.log('=== STARTING STORY CLUSTERING ENGINE UNIT TESTS ===\n');
  const engine = new StoryClusteringEngine();

  // Test A: Same company + same exact product + compatible event signals
  console.log('Test A: Same company + same exact product + compatible event signals');
  {
    const artA = createMockArticle({
      id: 'art-a1',
      title: 'HUAWEI Watch GT 7 Pro Review: In-depth look',
      publishedAt: '2026-09-25T10:00:00Z',
    });
    const anA = createMockAnalysis({
      articleId: 'art-a1',
      newsType: 'REVIEW',
      importanceScore: 65,
      products: [{ canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'HUAWEI Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
      topics: ['Wearables', 'Battery', 'Health'],
    });

    const artB = createMockArticle({
      id: 'art-a2',
      title: 'HUAWEI Watch GT 7 Pro Review: Battery champion',
      publishedAt: '2026-09-26T14:00:00Z', // 1.1 days delta
    });
    const anB = createMockAnalysis({
      articleId: 'art-a2',
      newsType: 'REVIEW',
      importanceScore: 60,
      products: [{ canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'HUAWEI Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
      topics: ['Wearables', 'Battery', 'Sports'],
    });

    const res = engine.evaluatePair(artA, anA, artB, anB);
    assert(res.totalScore >= 0.78, 'Test A Total Score >= 0.78', `Got ${res.totalScore}`);
    assert(res.decision === 'CLEAR_MATCH', 'Test A Decision is CLEAR_MATCH', `Got ${res.decision}`);
    assert(res.scores.exactProductScore === 1.0, 'Test A Exact Product Score is 1.0');
    assert(res.scores.companyScore === 1.0, 'Test A Company Score is 1.0');
  }

  // Test B: Same company + same product + incompatible newsType (REVIEW vs PRODUCT_LAUNCH)
  console.log('\nTest B: Same company + same product + incompatible newsType');
  {
    const artReview = createMockArticle({
      id: 'art-b1',
      title: 'HUAWEI Watch GT 7 Pro Review',
      publishedAt: '2026-09-25T10:00:00Z',
    });
    const anReview = createMockAnalysis({
      articleId: 'art-b1',
      newsType: 'REVIEW',
      importanceScore: 65,
    });

    const artLaunch = createMockArticle({
      id: 'art-b2',
      title: 'HUAWEI Watch GT 7 Pro Officially Launched in Greece',
      publishedAt: '2026-09-25T12:00:00Z',
    });
    const anLaunch = createMockAnalysis({
      articleId: 'art-b2',
      newsType: 'PRODUCT_LAUNCH',
      importanceScore: 70,
    });

    const res = engine.evaluatePair(artReview, anReview, artLaunch, anLaunch);
    assert(res.decision === 'CLEAR_SEPARATE', 'Test B Decision is CLEAR_SEPARATE', `Got ${res.decision}`);
    assert(res.scores.newsTypeScore <= 0.20, 'Test B newsTypeScore <= 0.20', `Got ${res.scores.newsTypeScore}`);
    assert(res.explanation.includes('Hard Gate'), 'Test B triggers Hard Gate for incompatible intents');
  }

  // Test C: Same product family but different exact product (Watch GT 7 vs Watch GT 7 Pro)
  console.log('\nTest C: Same product family but different exact product');
  {
    const artBase = createMockArticle({
      id: 'art-c1',
      title: 'HUAWEI Watch GT 7 Announced',
      publishedAt: '2026-09-24T10:00:00Z',
    });
    const anBase = createMockAnalysis({
      articleId: 'art-c1',
      newsType: 'PRODUCT_LAUNCH',
      products: [{ canonicalName: 'HUAWEI Watch GT 7', matchedText: 'HUAWEI Watch GT 7', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artPro = createMockArticle({
      id: 'art-c2',
      title: 'HUAWEI Watch GT 7 Pro Announced',
      publishedAt: '2026-09-24T10:30:00Z',
    });
    const anPro = createMockAnalysis({
      articleId: 'art-c2',
      newsType: 'PRODUCT_LAUNCH',
      products: [{ canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'HUAWEI Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
    });

    const res = engine.evaluatePair(artBase, anBase, artPro, anPro);
    assert(res.scores.exactProductScore === 0.0, 'Test C Exact Product Score is 0.0');
    assert(res.scores.productFamilyScore === 1.0, 'Test C Product Family Score is 1.0');
    assert(res.totalScore < 0.90, 'Test C Total Score recognizes difference between exact & family');
  }

  // Test D: Same product but distant publication dates (>30 days apart)
  console.log('\nTest D: Same product but distant publication dates');
  {
    const artSept = createMockArticle({
      id: 'art-d1',
      title: 'HUAWEI Watch GT 7 Pro Review',
      publishedAt: '2026-09-25T10:00:00Z',
    });
    const anSept = createMockAnalysis({ articleId: 'art-d1' });

    const artNov = createMockArticle({
      id: 'art-d2',
      title: 'HUAWEI Watch GT 7 Pro Review After Two Months',
      publishedAt: '2026-11-15T10:00:00Z', // 51 days later
    });
    const anNov = createMockAnalysis({ articleId: 'art-d2' });

    const res = engine.evaluatePair(artSept, anSept, artNov, anNov);
    assert(res.scores.temporalScore === 0.0, 'Test D Temporal Score is 0.0');
    assert(res.decision === 'CLEAR_SEPARATE', 'Test D Decision is CLEAR_SEPARATE');
  }

  // Test E: Same product but technical review vs lifestyle/editorial context
  console.log('\nTest E: Same product but technical review vs lifestyle/editorial context');
  {
    const artTech = createMockArticle({
      id: 'art-e1',
      title: 'HUAWEI Watch GT 7 Pro Review: Sensor accuracy and GPS benchmark',
      publishedAt: '2026-09-25T10:00:00Z',
    });
    const anTech = createMockAnalysis({
      articleId: 'art-e1',
      newsType: 'REVIEW',
      importanceScore: 65,
    });

    const artLifestyle = createMockArticle({
      id: 'art-e2',
      title: 'Ισορροπία εν μέσω πίεσης: Πώς το Huawei Watch GT 7 Pro θωρακίζει την ευεξία μου στα δύσκολα ωράρια',
      excerpt: 'Προσωπική εμπειρία διαχείρισης στρες και καθημερινής ευεξίας στο γραφείο',
      publishedAt: '2026-09-25T11:00:00Z',
    });
    const anLifestyle = createMockAnalysis({
      articleId: 'art-e2',
      newsType: 'REVIEW',
      importanceScore: 30,
      summary: 'A review focusing on wellness, mindfulness and workplace stress management.',
    });

    const res = engine.evaluatePair(artTech, anTech, artLifestyle, anLifestyle);
    assert(res.decision !== 'CLEAR_MATCH', 'Test E is NOT CLEAR_MATCH (does not force merge)');
    assert(res.scores.newsTypeScore === 0.35, 'Test E newsTypeScore reflects editorial divergence', `Got ${res.scores.newsTypeScore}`);
  }

  // Test F: Completely unrelated company/product
  console.log('\nTest F: Completely unrelated company/product');
  {
    const artHuawei = createMockArticle({
      id: 'art-f1',
      title: 'HUAWEI Watch GT 7 Pro Review',
      publishedAt: '2026-09-25T10:00:00Z',
    });
    const anHuawei = createMockAnalysis({ articleId: 'art-f1' });

    const artApple = createMockArticle({
      id: 'art-f2',
      title: 'Apple iPhone 17 Pro Camera Analysis',
      publishedAt: '2026-09-25T10:00:00Z',
    });
    const anApple = createMockAnalysis({
      articleId: 'art-f2',
      companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', matchedAlias: 'Apple', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'Apple iPhone 17 Pro', matchedText: 'iPhone 17 Pro', category: 'SMARTPHONES', relevance: 'PRIMARY', confidence: 1 }],
      newsType: 'REVIEW',
    });

    const res = engine.evaluatePair(artHuawei, anHuawei, artApple, anApple);
    assert(res.scores.companyScore === 0.0, 'Test F Company Score is 0.0');
    assert(res.decision === 'CLEAR_SEPARATE', 'Test F Decision is CLEAR_SEPARATE');
  }

  // Test G: Ambiguous evidence
  console.log('\nTest G: Ambiguous evidence');
  {
    const art1 = createMockArticle({
      id: 'art-g1',
      title: 'Huawei Watch GT 7 Series Feature Overview',
      publishedAt: '2026-09-20T10:00:00Z',
    });
    const an1 = createMockAnalysis({
      articleId: 'art-g1',
      newsType: 'OTHER',
      importanceScore: 45,
      products: [{ canonicalName: 'HUAWEI Watch GT 7', matchedText: 'Watch GT 7', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
    });

    const art2 = createMockArticle({
      id: 'art-g2',
      title: 'Huawei Wearables Update: GT Series Ecosystem',
      publishedAt: '2026-09-25T10:00:00Z', // 5 days delta
    });
    const an2 = createMockAnalysis({
      articleId: 'art-g2',
      newsType: 'SOFTWARE_UPDATE',
      importanceScore: 50,
      products: [{ canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
    });

    const res = engine.evaluatePair(art1, an1, art2, an2);
    assert(res.decision === 'AMBIGUOUS' || res.decision === 'CLEAR_SEPARATE', 'Test G is properly classified without false match');
  }

  // Test H: Legacy Story exclusion
  console.log('\nTest H: Legacy Story exclusion');
  {
    const legacyStory1: Story = {
      id: 'story-001',
      canonicalTitle: 'Tri-Fold and Ultra-Thin Foldable Smartphone Race',
      summary: 'Legacy',
      status: 'DEVELOPING',
      storyType: 'PRODUCT_LAUNCH',
      importanceScore: 80,
      confidence: 0.9,
      firstSeenAt: '2026-09-20T10:00:00Z',
      lastSeenAt: '2026-09-25T10:00:00Z',
      articleCount: 4,
      articleIds: ['art-001'],
      sourceIds: ['src-gsmarena'],
      sourceCount: 1,
      companies: [{ companyId: 'comp-huawei', name: 'HUAWEI', relevance: 'PRIMARY' }],
      products: [],
      categories: ['Wearables'],
      topics: ['Wearables'],
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

    const modernStory: Story = {
      ...legacyStory1,
      id: 'story-modern-001',
      canonicalTitle: 'Modern Phase 4 Story',
      clusteringVersion: 'signalyn-cluster-v1',
      isLegacy: false,
    };

    const art = createMockArticle({ publishedAt: '2026-09-25T10:00:00Z' });
    const an = createMockAnalysis({ articleId: art.id });

    const candidates = engine.findCandidateStories(art, an, [legacyStory1, modernStory]);
    assert(candidates.length === 1, 'Test H Candidates length is 1');
    assert(candidates[0].id === 'story-modern-001', 'Test H Only modern story is candidate, legacy is excluded');
  }

  // Test I: Candidate result limit
  console.log('\nTest I: Candidate result limit');
  {
    const art = createMockArticle({ publishedAt: '2026-09-25T10:00:00Z' });
    const an = createMockAnalysis({ articleId: art.id });

    const manyStories: Story[] = Array.from({ length: 35 }, (_, idx) => ({
      id: `story-test-${idx}`,
      canonicalTitle: `Story ${idx}`,
      summary: '',
      status: 'DEVELOPING',
      storyType: 'REVIEW',
      importanceScore: 60,
      confidence: 0.9,
      firstSeenAt: '2026-09-25T09:00:00Z',
      lastSeenAt: '2026-09-25T09:00:00Z',
      articleCount: 1,
      articleIds: [`art-${idx}`],
      sourceIds: ['src-mock'],
      sourceCount: 1,
      companies: [{ companyId: 'comp-huawei', name: 'HUAWEI', relevance: 'PRIMARY' }],
      products: [],
      categories: ['Wearables'],
      topics: ['Wearables'],
      markets: ['Greece'],
      languages: ['el'],
      primaryCompanyId: 'comp-huawei',
      primaryProductId: null,
      representativeArticleId: null,
      createdAt: '2026-09-25T09:00:00Z',
      updatedAt: '2026-09-25T09:00:00Z',
      clusteringVersion: 'signalyn-cluster-v1',
      isLegacy: false,
    }));

    const candidates = engine.findCandidateStories(art, an, manyStories);
    assert(candidates.length === 20, 'Test I Candidate limit is strictly 20 (maxCandidates)', `Got ${candidates.length}`);
  }

  // Test J: Deterministic repeatability
  console.log('\nTest J: Deterministic repeatability');
  {
    const art1 = createMockArticle({ id: 'art-j1', publishedAt: '2026-09-25T10:00:00Z' });
    const an1 = createMockAnalysis({ articleId: 'art-j1' });
    const art2 = createMockArticle({ id: 'art-j2', publishedAt: '2026-09-26T10:00:00Z' });
    const an2 = createMockAnalysis({ articleId: 'art-j2' });

    const res1 = engine.evaluatePair(art1, an1, art2, an2);
    const res2 = engine.evaluatePair(art1, an1, art2, an2);
    const res3 = engine.evaluatePair(art1, an1, art2, an2);

    assert(res1.totalScore === res2.totalScore && res2.totalScore === res3.totalScore, 'Test J Total scores are identical across runs');
    assert(res1.decision === res2.decision && res2.decision === res3.decision, 'Test J Decisions are identical across runs');
    assert(res1.explanation === res2.explanation, 'Test J Explanations are identical across runs');
  }

  // ==========================================
  // Phase 4A.2 Unit Tests: Stage 2 Semantic Adjudication & Coherence
  // ==========================================

  console.log('\n--- Phase 4A.2 Tests: Stage 2 Semantic Adjudication & Coherence ---');

  // Test 2A & 2B: CLEAR_MATCH & CLEAR_SEPARATE bypass Gemini
  console.log('\nTest 2A & 2B: CLEAR_MATCH and CLEAR_SEPARATE bypass Gemini');
  {
    let geminiCalls = 0;
    const mockAdjudicator = async () => {
      geminiCalls++;
      return {
        articleAId: 'a',
        articleBId: 'b',
        rawDecision: 'SAME_EVENT' as const,
        confidence: 0.95,
        mappedDecision: 'SEMANTIC_MATCH' as const,
        rationale: 'Mock',
        sharedEventSignals: [],
        distinctEventSignals: [],
        modelUsed: 'mock',
        durationMs: 1,
      };
    };

    // Pair 1: CLEAR_MATCH pair
    const artA = createMockArticle({ id: 'art-m1', title: 'HUAWEI Watch GT 7 Pro Review A', publishedAt: '2026-09-25T10:00:00Z' });
    const anA = createMockAnalysis({ articleId: 'art-m1', newsType: 'REVIEW' });
    const artB = createMockArticle({ id: 'art-m2', title: 'HUAWEI Watch GT 7 Pro Review B', publishedAt: '2026-09-25T12:00:00Z' });
    const anB = createMockAnalysis({ articleId: 'art-m2', newsType: 'REVIEW' });

    // Pair 2: CLEAR_SEPARATE pair (Apple vs Huawei)
    const artC = createMockArticle({ id: 'art-m3', title: 'Apple iPhone 17 Pro Launch', publishedAt: '2026-09-25T12:00:00Z' });
    const anC = createMockAnalysis({
      articleId: 'art-m3',
      companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'iPhone 17 Pro', matchedText: 'iPhone 17 Pro', category: 'SMARTPHONES', relevance: 'PRIMARY', confidence: 1 }],
      newsType: 'PRODUCT_LAUNCH',
    });

    const articlesMap = new Map<string, Article>([
      ['art-m1', artA],
      ['art-m2', artB],
      ['art-m3', artC],
    ]);
    const analysesMap = new Map<string, ArticleAnalysis>([
      ['art-m1', anA],
      ['art-m2', anB],
      ['art-m3', anC],
    ]);

    const res = await engine.evaluateStage2DryRun(
      ['art-m1', 'art-m2', 'art-m3'],
      articlesMap,
      analysesMap,
      { adjudicator: mockAdjudicator }
    );

    assert(res.summary.stage1Matches === 1, 'Test 2A: Stage 1 CLEAR_MATCH detected');
    assert(res.summary.stage1Separates === 2, 'Test 2B: Stage 1 CLEAR_SEPARATE detected (2 pairs)');
    assert(res.summary.stage1Ambiguous === 0, 'Test 2A/2B: 0 ambiguous pairs in this set');
    assert(geminiCalls === 0, 'Test 2A/2B: Gemini calls = 0 (bypassed entirely for CLEAR_MATCH & CLEAR_SEPARATE)', `Got ${geminiCalls}`);
  }

  // Test 2C: AMBIGUOUS invokes semantic adjudication
  console.log('\nTest 2C: AMBIGUOUS invokes semantic adjudication');
  {
    let geminiCalls = 0;
    const mockAdjudicator = async () => {
      geminiCalls++;
      return {
        articleAId: 'art-tech',
        articleBId: 'art-life',
        rawDecision: 'RELATED_BUT_DISTINCT' as const,
        confidence: 0.90,
        mappedDecision: 'SEMANTIC_SEPARATE' as const,
        rationale: 'Technical vs lifestyle narrative',
        sharedEventSignals: ['HUAWEI Watch GT 7 Pro'],
        distinctEventSignals: ['Workplace wellness angle'],
        modelUsed: 'mock',
        durationMs: 1,
      };
    };

    const artTech = createMockArticle({ id: 'art-tech', title: 'HUAWEI Watch GT 7 Pro Review', publishedAt: '2026-09-25T10:00:00Z' });
    const anTech = createMockAnalysis({ articleId: 'art-tech', newsType: 'REVIEW', importanceScore: 65 });

    const artLife = createMockArticle({
      id: 'art-life',
      title: 'Ισορροπία εν μέσω πίεσης: Πώς το Huawei Watch GT 7 Pro θωρακίζει την ευεξία μου',
      publishedAt: '2026-09-25T11:00:00Z',
    });
    const anLife = createMockAnalysis({
      articleId: 'art-life',
      newsType: 'REVIEW',
      importanceScore: 30,
      summary: 'Personal wellness and workplace lifestyle review.',
    });

    const articlesMap = new Map([['art-tech', artTech], ['art-life', artLife]]);
    const analysesMap = new Map([['art-tech', anTech], ['art-life', anLife]]);

    const res = await engine.evaluateStage2DryRun(['art-tech', 'art-life'], articlesMap, analysesMap, { adjudicator: mockAdjudicator });
    assert(res.summary.stage1Ambiguous === 1, 'Test 2C: Stage 1 flags pair as AMBIGUOUS');
    assert(geminiCalls === 1, 'Test 2C: Gemini adjudicator invoked exactly 1 time for AMBIGUOUS pair', `Got ${geminiCalls}`);
    assert(res.stage2Adjudications.length === 1, 'Test 2C: 1 adjudication record returned');
  }

  // Test 2D, 2E, 2F: Decision Mappings (SAME_EVENT, RELATED_BUT_DISTINCT, DIFFERENT_EVENT)
  console.log('\nTest 2D, 2E, 2F: Decision Mappings');
  {
    const { mapSemanticDecision } = await import('../src/server/clustering/ambiguousAdjudicator');
    assert(mapSemanticDecision('SAME_EVENT', 0.85) === 'SEMANTIC_MATCH', 'Test 2D: SAME_EVENT >= 0.80 -> SEMANTIC_MATCH');
    assert(mapSemanticDecision('RELATED_BUT_DISTINCT', 0.85) === 'SEMANTIC_SEPARATE', 'Test 2E: RELATED_BUT_DISTINCT >= 0.80 -> SEMANTIC_SEPARATE');
    assert(mapSemanticDecision('DIFFERENT_EVENT', 0.90) === 'SEMANTIC_SEPARATE', 'Test 2F: DIFFERENT_EVENT >= 0.80 -> SEMANTIC_SEPARATE');
  }

  // Test 2G, 2H, 2I: Uncertain, Low-Confidence, and Malformed routing to REVIEW_REQUIRED
  console.log('\nTest 2G, 2H, 2I: UNCERTAIN, Low-Confidence, and Malformed safety routing');
  {
    const { mapSemanticDecision } = await import('../src/server/clustering/ambiguousAdjudicator');
    assert(mapSemanticDecision('UNCERTAIN', 0.95) === 'REVIEW_REQUIRED', 'Test 2G: UNCERTAIN -> REVIEW_REQUIRED');
    assert(mapSemanticDecision('SAME_EVENT', 0.75) === 'REVIEW_REQUIRED', 'Test 2H: Confidence < 0.80 -> REVIEW_REQUIRED (even if raw is SAME_EVENT)');
    assert(mapSemanticDecision('RELATED_BUT_DISTINCT', 0.60) === 'REVIEW_REQUIRED', 'Test 2H: Low confidence RELATED_BUT_DISTINCT -> REVIEW_REQUIRED');

    // Test 2I: Verify in dry run that REVIEW_REQUIRED generates a StoryReview proposal
    const mockUncertainAdjudicator = async () => ({
      articleAId: 'art-u1',
      articleBId: 'art-u2',
      rawDecision: 'UNCERTAIN' as const,
      confidence: 0.50,
      mappedDecision: 'REVIEW_REQUIRED' as const,
      rationale: 'Insufficient signals',
      sharedEventSignals: [],
      distinctEventSignals: [],
      modelUsed: 'mock',
      durationMs: 1,
    });

    const artU1 = createMockArticle({ id: 'art-u1', title: 'Watch GT 7 Tech Review' });
    const anU1 = createMockAnalysis({ articleId: 'art-u1', newsType: 'REVIEW', importanceScore: 65 });
    const artU2 = createMockArticle({ id: 'art-u2', title: 'Watch GT 7 Lifestyle Review' });
    const anU2 = createMockAnalysis({ articleId: 'art-u2', newsType: 'REVIEW', importanceScore: 30 });

    const res = await engine.evaluateStage2DryRun(
      ['art-u1', 'art-u2'],
      new Map([['art-u1', artU1], ['art-u2', artU2]]),
      new Map([['art-u1', anU1], ['art-u2', anU2]]),
      { adjudicator: mockUncertainAdjudicator }
    );

    assert(res.reviewProposals.length === 1, 'Test 2I: REVIEW_REQUIRED safely created 1 StoryReview proposal');
    assert(res.reviewProposals[0].reason === 'AMBIGUOUS_MULTI_CANDIDATE', 'Test 2I: StoryReview proposal has AMBIGUOUS_MULTI_CANDIDATE reason');
    assert(res.summary.finalClustersCount === 2, 'Test 2I: Unresolved review keeps articles in 2 separate clusters (no false merge)');
  }

  // Test 2J: Transitive false merge prevention (A MATCH B, B MATCH C, A SEPARATE C)
  console.log('\nTest 2J: Transitive false merge prevention');
  {
    // A and B MATCH
    // B and C are AMBIGUOUS in Stage 1, then SEMANTIC_MATCH in Stage 2
    // But A and C are CLEAR_SEPARATE (separated by > 30 days)!
    // Result must NOT be {A, B, C}!
    const artA = createMockArticle({
      id: 'art-tA',
      title: 'Huawei Watch GT 7 Pro Technical Review',
      publishedAt: '2026-08-10T10:00:00Z',
    });
    const anA = createMockAnalysis({
      articleId: 'art-tA',
      newsType: 'REVIEW',
      products: [{ canonicalName: 'Huawei Watch GT 7 Pro', matchedText: 'Huawei Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artB = createMockArticle({
      id: 'art-tB',
      title: 'Huawei Watch GT 7 Pro Overview',
      publishedAt: '2026-08-12T10:00:00Z', // 2 days after A -> CLEAR_MATCH with A
    });
    const anB = createMockAnalysis({
      articleId: 'art-tB',
      newsType: 'REVIEW',
      products: [{ canonicalName: 'Huawei Watch GT 7 Pro', matchedText: 'Huawei Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
    });

    // Article C is lifestyle/wellness published on Sept 11 (30 days from B -> AMBIGUOUS with B; 32 days from A -> CLEAR_SEPARATE with A)
    const artC = createMockArticle({
      id: 'art-tC',
      title: 'Ισορροπία εν μέσω πίεσης: Πώς το Huawei Watch GT 7 Pro θωρακίζει την ευεξία μου στα δύσκολα ωράρια',
      excerpt: 'Προσωπική εμπειρία διαχείρισης στρες και καθημερινής ευεξίας στο γραφείο',
      publishedAt: '2026-09-11T10:00:00Z',
    });
    const anC = createMockAnalysis({
      articleId: 'art-tC',
      newsType: 'REVIEW',
      importanceScore: 30,
      summary: 'Personal wellness and workplace lifestyle review.',
      products: [{ canonicalName: 'Huawei Watch GT 7 Pro', matchedText: 'Huawei Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }],
    });

    // Mock an adjudicator that attempts to match B and C
    const mockTransitiveAdj = async (a1: Article, a2: ArticleAnalysis, b1: Article, b2: ArticleAnalysis) => {
      return {
        articleAId: a1.id,
        articleBId: b1.id,
        rawDecision: 'SAME_EVENT' as const,
        confidence: 0.95,
        mappedDecision: 'SEMANTIC_MATCH' as const,
        rationale: 'Stage 2 over-eager match for B and C',
        sharedEventSignals: ['Huawei Watch GT 7 Pro'],
        distinctEventSignals: [],
        modelUsed: 'mock',
        durationMs: 1,
      };
    };

    const res = await engine.evaluateStage2DryRun(
      ['art-tA', 'art-tB', 'art-tC'],
      new Map([['art-tA', artA], ['art-tB', artB], ['art-tC', artC]]),
      new Map([['art-tA', anA], ['art-tB', anB], ['art-tC', anC]]),
      { adjudicator: mockTransitiveAdj }
    );

    // C must NOT be combined into cluster with A!
    const clusterWithA = res.proposedClusters.find((c) => c.articleIds.includes('art-tA'));
    assert(clusterWithA !== undefined, 'Test 2J: Cluster with A exists');
    assert(!clusterWithA?.articleIds.includes('art-tC'), 'Test 2J: Article C is strictly BLOCKED from entering cluster with A due to transitive conflict');
    assert(res.transitiveConflicts.length >= 1, 'Test 2J: Transitive conflict successfully recorded');
  }

  // Test 2K: Deterministic cluster coherence (Product Variant Mismatch)
  console.log('\nTest 2K: Deterministic cluster coherence');
  {
    const { validateClusterAdmission } = await import('../src/server/clustering/clusterCoherence');
    const artPro = createMockArticle({ id: 'art-pro', title: 'Huawei Watch GT 7 Pro Review' });
    const anPro = createMockAnalysis({ articleId: 'art-pro', newsType: 'REVIEW', products: [{ canonicalName: 'Huawei Watch GT 7 Pro', matchedText: 'Huawei Watch GT 7 Pro', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }] });

    const artBase = createMockArticle({ id: 'art-base', title: 'Huawei Watch GT 7 Base Review' });
    const anBase = createMockAnalysis({ articleId: 'art-base', newsType: 'REVIEW', products: [{ canonicalName: 'Huawei Watch GT 7', matchedText: 'Huawei Watch GT 7', category: 'WEARABLES', relevance: 'PRIMARY', confidence: 1 }] });

    const check = validateClusterAdmission(
      'art-base',
      ['art-pro'],
      'cluster-test',
      new Map(),
      new Map(),
      new Map([['art-pro', artPro], ['art-base', artBase]]),
      new Map([['art-pro', anPro], ['art-base', anBase]])
    );

    assert(!check.canAdmit, 'Test 2K: Product variant mismatch (Base vs Pro) blocks cluster admission');
    assert(Boolean(check.conflict?.reason.includes('Product variant mismatch')), 'Test 2K: Conflict reason identifies variant mismatch');
  }

  // Test 2L: Gemini Call Limit Enforcement
  console.log('\nTest 2L: Gemini Call Limit Enforcement');
  {
    let callCount = 0;
    const countingAdjudicator = async () => {
      callCount++;
      return {
        articleAId: 'a',
        articleBId: 'b',
        rawDecision: 'RELATED_BUT_DISTINCT' as const,
        confidence: 0.90,
        mappedDecision: 'SEMANTIC_SEPARATE' as const,
        rationale: 'Mock',
        sharedEventSignals: [],
        distinctEventSignals: [],
        modelUsed: 'mock',
        durationMs: 1,
      };
    };

    // 4 articles that all produce AMBIGUOUS pairs among each other
    const art1 = createMockArticle({ id: 'art-l1', title: 'Ambiguous 1' });
    const an1 = createMockAnalysis({ articleId: 'art-l1', newsType: 'REVIEW', importanceScore: 60 });
    const art2 = createMockArticle({ id: 'art-l2', title: 'Ambiguous 2' });
    const an2 = createMockAnalysis({ articleId: 'art-l2', newsType: 'REVIEW', importanceScore: 30 }); // lifestyle vs tech -> ambiguous
    const art3 = createMockArticle({ id: 'art-l3', title: 'Ambiguous 3' });
    const an3 = createMockAnalysis({ articleId: 'art-l3', newsType: 'REVIEW', importanceScore: 30 });

    const res = await engine.evaluateStage2DryRun(
      ['art-l1', 'art-l2', 'art-l3'],
      new Map([['art-l1', art1], ['art-l2', art2], ['art-l3', art3]]),
      new Map([['art-l1', an1], ['art-l2', an2], ['art-l3', an3]]),
      { maxGeminiCalls: 1, adjudicator: countingAdjudicator } // Limit = 1 call!
    );

    assert(callCount === 1, 'Test 2L: Exactly 1 call was executed respecting maxGeminiCalls = 1', `Got ${callCount}`);
    assert(res.summary.geminiCallsPerformed === 1, 'Test 2L: Summary records geminiCallsPerformed = 1');
  }

  console.log(`\n=== UNIT TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

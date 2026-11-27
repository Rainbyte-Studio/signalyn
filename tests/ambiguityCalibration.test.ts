/**
 * Unit Test Suite for Ambiguity Calibration & Pair Pruning (Phase 4A.6B)
 */

import { StoryClusteringEngine, checkPairPruning } from '../src/server/clustering/storyClusteringEngine';
import { evaluateArticlePair } from '../src/server/clustering/pairwiseScorer';
import { Article, ArticleAnalysis, Story } from '../src/types';

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

function makeMockArt(overrides: Partial<Article>): Article {
  const baseTime = '2026-09-28T12:00:00Z';
  return {
    id: overrides.id || 'art-mock-1',
    feedId: 'f1',
    sourceId: overrides.sourceId || 'src-1',
    canonicalUrl: 'https://example.com/art',
    title: overrides.title || 'Mock Title',
    excerpt: overrides.excerpt || 'Mock Excerpt',
    publishedAt: overrides.publishedAt || baseTime,
    collectedAt: baseTime,
    updatedAt: baseTime,
    contentHash: 'hash-1',
    discoveredViaFeeds: ['f1'],
    processingStatus: 'ANALYZED',
    language: 'en',
    market: 'Global',
    rawCategories: ['Tech'],
    ...overrides,
  };
}

function makeMockAnalysis(overrides: Partial<ArticleAnalysis>): ArticleAnalysis {
  const baseTime = '2026-09-28T12:00:00Z';
  return {
    articleId: overrides.articleId || 'art-mock-1',
    sourceId: 'src-1',
    analysisVersion: 'v1',
    model: 'm1',
    analyzedAt: baseTime,
    language: 'en',
    market: 'Global',
    companies: overrides.companies || [
      { companyId: 'comp-huawei', canonicalName: 'HUAWEI', relevance: 'PRIMARY', confidence: 1 },
    ],
    products: overrides.products || [
      { canonicalName: 'Huawei Mate 90 series', matchedText: 'Huawei Mate 90 series', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 },
    ],
    topics: overrides.topics || ['Smartphones'],
    newsType: overrides.newsType || 'PRODUCT_LEAK',
    sentiment: 'NEUTRAL',
    sentimentConfidence: 0.9,
    importanceScore: 60,
    summary: 'Mock summary',
    keyPoints: ['Point 1'],
    competitiveSignals: [],
    competitiveRelevance: { score: 60, reasons: [], categories: ['SMARTPHONE'], relatedCompanies: [] },
    confidence: 0.95,
    ...overrides,
  };
}

export async function runAmbiguityCalibrationTests() {
  console.log('=== STARTING AMBIGUITY CALIBRATION & PAIR PRUNING TESTS ===\n');

  const baseTime = '2026-09-28T12:00:00Z';
  const closeTime = '2026-09-29T14:00:00Z'; // 1.1 days delta

  // Test 9A & 9B: Moderate score with high entity alignment becomes AMBIGUOUS, not CLEAR_SEPARATE
  console.log('--- Test 9A & 9B: Ambiguity Calibration for Aligned Entity Leak Pairs ---');
  {
    const artA = makeMockArt({ id: 'art-mate90-specs', title: 'Huawei Mate 90 series key specs leaked ahead of launch', publishedAt: baseTime });
    const anA = makeMockAnalysis({
      articleId: 'art-mate90-specs',
      products: [{ canonicalName: 'Huawei Mate 90 series', matchedText: 'Huawei Mate 90 series', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
      newsType: 'PRODUCT_LEAK',
    });

    const artB = makeMockArt({ id: 'art-mate90-renders', title: 'Huawei Mate 90 series renders confirm three punch-hole front', publishedAt: closeTime });
    const anB = makeMockAnalysis({
      articleId: 'art-mate90-renders',
      products: [{ canonicalName: 'Mate 90', matchedText: 'Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
      newsType: 'PRODUCT_LEAK',
    });

    const res = evaluateArticlePair(artA, anA, artB, anB);

    assert(
      res.decision !== 'CLEAR_SEPARATE',
      '9A: Same company + same category + same family + same newsType + close date does NOT automatically become CLEAR_SEPARATE'
    );
    assert(
      res.decision === 'AMBIGUOUS',
      '9B: Such a pair cleanly enters AMBIGUOUS band for Stage 2 semantic review'
    );
    assert(
      res.scores.productFamilyScore === 1.0,
      '9B Sub-check: Product family matches (brand prefix normalized: "Huawei Mate 90" and "Mate 90")'
    );
  }

  // Test 9C: Hard product mismatch remains CLEAR_SEPARATE
  console.log('\n--- Test 9C: Hard Product Mismatch ---');
  {
    const artA = makeMockArt({ id: 'art-mate90', title: 'Huawei Mate 90 specs leaked', publishedAt: baseTime });
    const anA = makeMockAnalysis({
      articleId: 'art-mate90',
      products: [{ canonicalName: 'Huawei Mate 90', matchedText: 'Huawei Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artB = makeMockArt({ id: 'art-matext', title: 'Huawei Mate XT2 foldable unveiled', publishedAt: baseTime });
    const anB = makeMockAnalysis({
      articleId: 'art-matext',
      products: [{ canonicalName: 'Huawei Mate XT2', matchedText: 'Huawei Mate XT2', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const res = evaluateArticlePair(artA, anA, artB, anB);
    assert(
      res.decision === 'CLEAR_SEPARATE',
      '9C: Hard product mismatch (Mate 90 vs Mate XT2) remains strictly CLEAR_SEPARATE'
    );
  }

  // Test 9D: Hard company mismatch remains CLEAR_SEPARATE
  console.log('\n--- Test 9D: Hard Company Mismatch ---');
  {
    const artA = makeMockArt({ id: 'art-airpods', title: 'AirPods 5 launched', publishedAt: baseTime });
    const anA = makeMockAnalysis({
      articleId: 'art-airpods',
      companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'AirPods 5', matchedText: 'AirPods 5', category: 'AUDIO', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artB = makeMockArt({ id: 'art-buds', title: 'Galaxy Buds On leaked', publishedAt: baseTime });
    const anB = makeMockAnalysis({
      articleId: 'art-buds',
      companies: [{ companyId: 'comp-samsung', canonicalName: 'Samsung', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'Galaxy Buds On', matchedText: 'Galaxy Buds On', category: 'AUDIO', relevance: 'PRIMARY', confidence: 1 }],
    });

    const res = evaluateArticlePair(artA, anA, artB, anB);
    assert(
      res.decision === 'CLEAR_SEPARATE',
      '9D: Hard company mismatch (Apple vs Samsung) triggers Hard Gate 1 CLEAR_SEPARATE'
    );
  }

  // Test 9E: Category mismatch remains excluded by checkPairPruning
  console.log('\n--- Test 9E: Category Mismatch Pruning ---');
  {
    const artPhone = makeMockArt({ id: 'art-p', title: 'Huawei Mate 90 phone', publishedAt: baseTime });
    const anPhone = makeMockAnalysis({
      articleId: 'art-p',
      products: [{ canonicalName: 'Huawei Mate 90', matchedText: 'Huawei Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artWatch = makeMockArt({ id: 'art-w', title: 'Huawei Watch GT 7', publishedAt: baseTime });
    const anWatch = makeMockAnalysis({
      articleId: 'art-w',
      products: [{ canonicalName: 'Huawei Watch GT 7', matchedText: 'Huawei Watch GT 7', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const pruning = checkPairPruning(artPhone, anPhone, artWatch, anWatch);
    assert(
      pruning.prune === true && Boolean(pruning.reason?.includes('Incompatible categories')),
      '9E: Cross-category pair (SMARTPHONE vs WEARABLE) is pruned before scoring'
    );
  }

  // Test 9F: Temporal hard separation remains intact
  console.log('\n--- Test 9F: Temporal Distance Pruning (> 30 days) ---');
  {
    const artOld = makeMockArt({ id: 'art-old', title: 'Huawei Mate 90 earlier report', publishedAt: '2026-08-10T12:00:00Z' });
    const anOld = makeMockAnalysis({
      articleId: 'art-old',
      products: [{ canonicalName: 'Huawei Mate 90', matchedText: 'Huawei Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artNew = makeMockArt({ id: 'art-new', title: 'Huawei Mate 90 late report', publishedAt: '2026-09-30T12:00:00Z' });
    const anNew = makeMockAnalysis({
      articleId: 'art-new',
      products: [{ canonicalName: 'Huawei Mate 90', matchedText: 'Huawei Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const pruning = checkPairPruning(artOld, anOld, artNew, anNew);
    assert(
      pruning.prune === true && Boolean(pruning.reason?.includes('Temporal distance')),
      '9F: Temporal distance > 30 days is pruned before scoring'
    );
  }

  // Test 9G & 9H: Stage 2 Invocation for AMBIGUOUS vs Bypass for Deterministic
  console.log('\n--- Test 9G & 9H: Stage 2 Selective Invocation ---');
  {
    const engine = new StoryClusteringEngine();
    let geminiCalls = 0;
    const mockAdjudicator = async () => {
      geminiCalls++;
      return {
        articleAId: 'a',
        articleBId: 'b',
        rawDecision: 'SAME_EVENT' as const,
        confidence: 0.95,
        mappedDecision: 'SEMANTIC_MATCH' as const,
        rationale: 'Mock match',
        sharedEventSignals: ['Mate 90'],
        distinctEventSignals: [],
        modelUsed: 'mock',
        durationMs: 10,
      };
    };

    const art1 = makeMockArt({ id: 'art-1', title: 'Huawei Mate 90 specs', publishedAt: baseTime });
    const an1 = makeMockAnalysis({ articleId: 'art-1', products: [{ canonicalName: 'Huawei Mate 90 series', matchedText: 'Huawei Mate 90 series', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }] });

    const art2 = makeMockArt({ id: 'art-2', title: 'Huawei Mate 90 renders', publishedAt: closeTime });
    const an2 = makeMockAnalysis({ articleId: 'art-2', products: [{ canonicalName: 'Mate 90', matchedText: 'Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }] });

    const art3 = makeMockArt({ id: 'art-3', title: 'AirPods 5 launched', publishedAt: baseTime });
    const an3 = makeMockAnalysis({
      articleId: 'art-3',
      companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'AirPods 5', matchedText: 'AirPods 5', category: 'AUDIO', relevance: 'PRIMARY', confidence: 1 }],
    });

    const articlesMap = new Map([['art-1', art1], ['art-2', art2], ['art-3', art3]]);
    const analysesMap = new Map([['art-1', an1], ['art-2', an2], ['art-3', an3]]);

    const res = await engine.evaluateStage2DryRun(
      ['art-1', 'art-2', 'art-3'],
      articlesMap,
      analysesMap,
      { maxGeminiCalls: 3, adjudicator: mockAdjudicator }
    );

    assert(
      geminiCalls === 1,
      '9G: Ambiguous pair invokes Stage 2 semantic adjudicator exactly once'
    );
    assert(
      res.summary.pairsPruned === 2,
      '9H: Incompatible cross-category pairs (art-3 AirPods vs art-1, art-2) are pruned and bypass Stage 2'
    );
  }

  // Test 9I: Pair pruning removes impossible pairs before scoring
  console.log('\n--- Test 9I: Pair Pruning Statistics ---');
  {
    const engine = new StoryClusteringEngine();
    const artPhone = makeMockArt({ id: 'p1', title: 'Phone 1', publishedAt: baseTime });
    const anPhone = makeMockAnalysis({ articleId: 'p1' });

    const artWatch = makeMockArt({ id: 'w1', title: 'Watch 1', publishedAt: baseTime });
    const anWatch = makeMockAnalysis({ articleId: 'w1', products: [{ canonicalName: 'Watch', matchedText: 'Watch', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }] });

    const dryRun = engine.evaluateDryRun(
      ['p1', 'w1'],
      new Map([['p1', artPhone], ['w1', artWatch]]),
      new Map([['p1', anPhone], ['w1', anWatch]])
    );

    assert(
      dryRun.summary.pairsPruned === 1 && dryRun.summary.pairsScored === 0,
      '9I: Impossible pair is pruned without executing full pairwise scorer (pairsPruned: 1, pairsScored: 0)'
    );
  }

  // Test 9J: Multi-company comparison is not incorrectly pruned
  console.log('\n--- Test 9J: Multi-Company Comparison Overlap Safety ---');
  {
    const artApple = makeMockArt({ id: 'art-apple', title: 'iPhone 18 Pro Max review', publishedAt: baseTime });
    const anApple = makeMockAnalysis({
      articleId: 'art-apple',
      companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'iPhone 18 Pro Max', matchedText: 'iPhone 18 Pro Max', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artCompare = makeMockArt({ id: 'art-compare', title: 'Xiaomi 17 Ultra vs iPhone 18 Pro Max comparison', publishedAt: baseTime });
    const anCompare = makeMockAnalysis({
      articleId: 'art-compare',
      companies: [
        { companyId: 'comp-xiaomi', canonicalName: 'Xiaomi', relevance: 'PRIMARY', confidence: 1 },
        { companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY', confidence: 1 },
      ],
      products: [
        { canonicalName: 'Xiaomi 17 Ultra', matchedText: 'Xiaomi 17 Ultra', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 },
        { canonicalName: 'iPhone 18 Pro Max', matchedText: 'iPhone 18 Pro Max', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 },
      ],
    });

    const pruning = checkPairPruning(artApple, anCompare, artCompare, anCompare);
    assert(
      pruning.prune === false,
      '9J: Multi-company comparison article sharing comp-apple is NOT pruned'
    );
  }

  // Test 9K: UNKNOWN category preserves recall
  console.log('\n--- Test 9K: UNKNOWN Category Preservation ---');
  {
    const artKnown = makeMockArt({ id: 'art-k', title: 'Known device', publishedAt: baseTime });
    const anKnown = makeMockAnalysis({ articleId: 'art-k' });

    const artUnknown = makeMockArt({ id: 'art-u', title: 'General tech update', publishedAt: baseTime });
    const anUnknown = makeMockAnalysis({ articleId: 'art-u', products: [], competitiveRelevance: { score: 40, reasons: [], categories: [], relatedCompanies: [] } });

    const pruning = checkPairPruning(artKnown, anKnown, artUnknown, anUnknown);
    assert(
      pruning.prune === false,
      '9K: UNKNOWN category safely avoids pruning to preserve recall'
    );
  }

  // Test 9L: Existing Watch GT 7 regression remains unchanged
  console.log('\n--- Test 9L: Existing Watch GT 7 Regression ---');
  {
    const artReview1 = makeMockArt({
      id: 'art-rev1',
      title: 'HUAWEI WATCH GT 7 Pro Technical In-Depth Review',
      publishedAt: '2026-09-25T10:00:00Z',
    });
    const anReview1 = makeMockAnalysis({
      articleId: 'art-rev1',
      newsType: 'REVIEW',
      products: [{ canonicalName: 'HUAWEI WATCH GT 7 Pro', matchedText: 'HUAWEI WATCH GT 7 Pro', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const artReview2 = makeMockArt({
      id: 'art-rev2',
      title: 'HUAWEI WATCH GT 7 Pro Review and Teardown',
      publishedAt: '2026-09-27T10:00:00Z',
    });
    const anReview2 = makeMockAnalysis({
      articleId: 'art-rev2',
      newsType: 'REVIEW',
      products: [{ canonicalName: 'HUAWEI WATCH GT 7 Pro', matchedText: 'HUAWEI WATCH GT 7 Pro', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const resReview = evaluateArticlePair(artReview1, anReview1, artReview2, anReview2);
    assert(
      resReview.decision === 'CLEAR_MATCH',
      '9L-1: Two Watch GT 7 Pro technical reviews remain compatible CLEAR_MATCH'
    );

    const artLaunch = makeMockArt({
      id: 'art-launch',
      title: 'HUAWEI WATCH GT 7 Series Greece Launch and Availability',
      publishedAt: '2026-09-24T10:00:00Z',
    });
    const anLaunch = makeMockAnalysis({
      articleId: 'art-launch',
      newsType: 'PRODUCT_LAUNCH',
      products: [{ canonicalName: 'HUAWEI WATCH GT 7 Series', matchedText: 'HUAWEI WATCH GT 7 Series', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
    });

    const resLaunchVsReview = evaluateArticlePair(artReview1, anReview1, artLaunch, anLaunch);
    assert(
      resLaunchVsReview.decision === 'CLEAR_SEPARATE',
      '9L-2: Watch GT 7 Greek launch remains strictly distinct from technical reviews'
    );
  }

  console.log(`\n=== AMBIGUITY CALIBRATION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAmbiguityCalibrationTests();
}

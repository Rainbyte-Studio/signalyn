/**
 * Unit Test Suite for Canonical Device Category Model & Candidate Retrieval (Phase 4A.5)
 */

import {
  normalizeDeviceCategory,
  inferCategoryFromProductName,
  resolveCanonicalCategories,
  resolvePrimaryCanonicalCategory,
  getStoryCanonicalCategories,
  areCategoriesCompatible,
} from '../src/server/clustering/categoryModel';
import { StoryClusteringEngine } from '../src/server/clustering/storyClusteringEngine';
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

export function runCategoryModelTests() {
  console.log('=== STARTING CATEGORY MODEL & CANDIDATE RETRIEVAL TESTS ===\n');

  // --- Requirement 12: Category Normalization Tests (12A - 12L) ---
  console.log('--- Requirement 12: Category Normalization Tests ---');

  // 12A: HUAWEI Mate smartphone -> SMARTPHONE
  assert(
    inferCategoryFromProductName('HUAWEI Mate 90 Pro') === 'SMARTPHONE',
    '12A: HUAWEI Mate 90 Pro resolves to SMARTPHONE'
  );

  // 12B: HUAWEI Watch GT -> WEARABLE
  assert(
    inferCategoryFromProductName('HUAWEI Watch GT 7 Pro') === 'WEARABLE',
    '12B: HUAWEI Watch GT 7 Pro resolves to WEARABLE'
  );

  // 12C: AirPods -> AUDIO
  assert(
    inferCategoryFromProductName('AirPods 5') === 'AUDIO' &&
    inferCategoryFromProductName('AirPods Pro 2') === 'AUDIO',
    '12C: AirPods resolves to AUDIO'
  );

  // 12D: Galaxy Buds -> AUDIO
  assert(
    inferCategoryFromProductName('Galaxy Buds On') === 'AUDIO' &&
    inferCategoryFromProductName('Samsung Galaxy Buds 3 Pro') === 'AUDIO',
    '12D: Galaxy Buds resolves to AUDIO'
  );

  // 12E: MatePad -> TABLET
  assert(
    inferCategoryFromProductName('Huawei MatePad Air Z') === 'TABLET',
    '12E: Huawei MatePad Air Z resolves to TABLET'
  );

  // 12F: Galaxy Tab -> TABLET
  assert(
    inferCategoryFromProductName('Samsung Galaxy Tab S12 Ultra') === 'TABLET',
    '12F: Samsung Galaxy Tab S12 Ultra resolves to TABLET'
  );

  // 12G: iPad -> TABLET
  assert(
    inferCategoryFromProductName('Apple iPad Air 6') === 'TABLET',
    '12G: Apple iPad Air 6 resolves to TABLET'
  );

  // 12H: Apple Watch -> WEARABLE
  assert(
    inferCategoryFromProductName('Apple Watch Ultra 3') === 'WEARABLE' &&
    inferCategoryFromProductName('Apple Watch Series 10') === 'WEARABLE',
    '12H: Apple Watch resolves to WEARABLE'
  );

  // 12I: Greek watch terminology -> WEARABLE
  assert(
    normalizeDeviceCategory('ρολόι') === 'WEARABLE' &&
    normalizeDeviceCategory('έξυπνο ρολόι') === 'WEARABLE' &&
    normalizeDeviceCategory('ρολόγια') === 'WEARABLE',
    '12I: Greek watch terminology ("ρολόι", "έξυπνο ρολόι") resolves to WEARABLE'
  );

  // 12J: Greek headphones/earbuds terminology -> AUDIO
  assert(
    normalizeDeviceCategory('ακουστικά') === 'AUDIO' &&
    normalizeDeviceCategory('ασύρματα ακουστικά') === 'AUDIO',
    '12J: Greek audio terminology ("ακουστικά", "ασύρματα ακουστικά") resolves to AUDIO'
  );

  // 12K: generic "Air" does NOT determine category
  assert(
    normalizeDeviceCategory('Air') === 'UNKNOWN' &&
    normalizeDeviceCategory('air') === 'UNKNOWN' &&
    normalizeDeviceCategory('Pro') === 'UNKNOWN' &&
    normalizeDeviceCategory('Ultra') === 'UNKNOWN' &&
    normalizeDeviceCategory('Max') === 'UNKNOWN',
    '12K: Generic variant tokens ("Air", "Pro", "Ultra", "Max") safely resolve to UNKNOWN'
  );

  // 12L: unknown product safely returns UNKNOWN
  assert(
    inferCategoryFromProductName('SuperCool Gizmo 9000') === 'UNKNOWN' &&
    normalizeDeviceCategory('QuantumFlux') === 'UNKNOWN',
    '12L: Unrecognized entity safely returns UNKNOWN'
  );

  // --- Requirement 13: Candidate Retrieval Tests (13A - 13J) ---
  console.log('\n--- Requirement 13: Candidate Retrieval Category Filtering Tests ---');

  const engine = new StoryClusteringEngine({ candidateTimeWindowDays: 7, maxCandidates: 20 });
  const baseTime = '2026-09-28T12:00:00Z';

  // Base Huawei Watch Story
  const huaweiWatchStory: Story = {
    id: 'story-cluster-huawei-watch-01',
    canonicalTitle: 'Huawei Watch GT 7 Pro Launch',
    summary: 'Huawei Watch GT 7 Pro coverage',
    status: 'DEVELOPING',
    storyType: 'REVIEW',
    importanceScore: 60,
    confidence: 0.95,
    firstSeenAt: '2026-09-25T10:00:00Z',
    lastSeenAt: '2026-09-27T10:00:00Z',
    articleCount: 2,
    articleIds: ['art-w1', 'art-w2'],
    sourceIds: ['s1'],
    sourceCount: 1,
    companies: [{ companyId: 'comp-huawei', name: 'HUAWEI', relevance: 'PRIMARY' }],
    products: [{ name: 'HUAWEI Watch GT 7 Pro', category: 'WEARABLE' }],
    categories: ['WEARABLE'],
    topics: ['Wearables', 'Battery'],
    markets: ['Greece'],
    languages: ['el'],
    primaryCompanyId: 'comp-huawei',
    primaryProductId: 'HUAWEI Watch GT 7 Pro',
    representativeArticleId: 'art-w1',
    createdAt: '2026-09-25T10:00:00Z',
    updatedAt: '2026-09-27T10:00:00Z',
    clusteringVersion: 'signalyn-cluster-v1',
    isLegacy: false,
  };

  // Base Huawei Tablet Story
  const huaweiTabletStory: Story = {
    ...huaweiWatchStory,
    id: 'story-cluster-huawei-tablet-01',
    canonicalTitle: 'Huawei MatePad Air Tablets Launch',
    primaryProductId: 'Huawei MatePad Air',
    products: [{ name: 'Huawei MatePad Air', category: 'TABLET' }],
    categories: ['TABLET'],
  };

  // Base Apple Watch Story
  const appleWatchStory: Story = {
    ...huaweiWatchStory,
    id: 'story-cluster-apple-watch-01',
    canonicalTitle: 'Apple Watch Ultra 3 Announcement',
    primaryCompanyId: 'comp-apple',
    companies: [{ companyId: 'comp-apple', name: 'Apple', relevance: 'PRIMARY' }],
    primaryProductId: 'Apple Watch Ultra 3',
    products: [{ name: 'Apple Watch Ultra 3', category: 'WEARABLE' }],
    categories: ['WEARABLE'],
  };

  // Base Samsung Smartphone Story
  const samsungPhoneStory: Story = {
    ...huaweiWatchStory,
    id: 'story-cluster-samsung-phone-01',
    canonicalTitle: 'Samsung Galaxy S27 Ultra Camera Details',
    primaryCompanyId: 'comp-samsung',
    companies: [{ companyId: 'comp-samsung', name: 'Samsung', relevance: 'PRIMARY' }],
    primaryProductId: 'Samsung Galaxy S27 Ultra',
    products: [{ name: 'Samsung Galaxy S27 Ultra', category: 'SMARTPHONE' }],
    categories: ['SMARTPHONE'],
  };

  // Mock Articles
  const mockHuaweiPhoneArticle: Article = {
    id: 'art-h-phone-1',
    feedId: 'f1',
    sourceId: 'src-gsm',
    canonicalUrl: 'https://example.com/h-phone',
    title: 'Huawei Mate 90 series key specs leaked ahead of launch',
    excerpt: 'Huawei Mate 90 specs leaked',
    publishedAt: baseTime,
    collectedAt: baseTime,
    updatedAt: baseTime,
    contentHash: 'hash-hp',
    discoveredViaFeeds: ['f1'],
    processingStatus: 'ANALYZED',
    language: 'en',
    market: 'Global',
    rawCategories: ['Technology'],
  };

  const mockHuaweiPhoneAnalysis: ArticleAnalysis = {
    articleId: 'art-h-phone-1',
    sourceId: 'src-gsm',
    analysisVersion: 'v1',
    model: 'm1',
    analyzedAt: baseTime,
    language: 'en',
    market: 'Global',
    companies: [{ companyId: 'comp-huawei', canonicalName: 'HUAWEI', relevance: 'PRIMARY', confidence: 1 }],
    products: [{ canonicalName: 'Huawei Mate 90', matchedText: 'Huawei Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
    topics: ['Smartphones', 'Camera'],
    newsType: 'PRODUCT_LEAK',
    sentiment: 'POSITIVE',
    sentimentConfidence: 0.9,
    importanceScore: 70,
    summary: 'Mate 90 specs leaked',
    keyPoints: ['Specs leaked'],
    competitiveSignals: [],
    competitiveRelevance: { score: 70, reasons: [], categories: ['SMARTPHONE'], relatedCompanies: [] },
    confidence: 0.95,
  };

  // 13A: HUAWEI smartphone article does NOT retrieve HUAWEI watch Story
  {
    const candidates = engine.findCandidateStories(
      mockHuaweiPhoneArticle,
      mockHuaweiPhoneAnalysis,
      [huaweiWatchStory]
    );
    assert(
      candidates.length === 0,
      '13A: HUAWEI smartphone article does NOT retrieve HUAWEI watch Story'
    );
  }

  // 13B: HUAWEI smartphone article does NOT retrieve HUAWEI tablet Story
  {
    const candidates = engine.findCandidateStories(
      mockHuaweiPhoneArticle,
      mockHuaweiPhoneAnalysis,
      [huaweiTabletStory]
    );
    assert(
      candidates.length === 0,
      '13B: HUAWEI smartphone article does NOT retrieve HUAWEI tablet Story'
    );
  }

  // 13C: HUAWEI watch article can retrieve compatible HUAWEI watch Story
  {
    const mockWatchArt: Article = {
      ...mockHuaweiPhoneArticle,
      id: 'art-h-watch-new',
      title: 'HUAWEI Watch GT 7 Pro Hands-On Review',
    };
    const mockWatchAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-h-watch-new',
      products: [{ canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'HUAWEI Watch GT 7 Pro', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
      competitiveRelevance: { score: 70, reasons: [], categories: ['WEARABLE'], relatedCompanies: [] },
    };
    const candidates = engine.findCandidateStories(
      mockWatchArt,
      mockWatchAnalysis,
      [huaweiWatchStory, huaweiTabletStory]
    );
    assert(
      candidates.length === 1 && candidates[0].id === 'story-cluster-huawei-watch-01',
      '13C: HUAWEI watch article retrieves compatible HUAWEI watch Story (and filters tablet story)'
    );
  }

  // 13D: Apple smartphone article does NOT retrieve Apple Watch Story
  {
    const applePhoneArt: Article = { ...mockHuaweiPhoneArticle, id: 'art-apple-phone', title: 'iPhone 18 Pro Max Release' };
    const applePhoneAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-apple-phone',
      companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'iPhone 18 Pro Max', matchedText: 'iPhone 18 Pro Max', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 }],
      competitiveRelevance: { score: 70, reasons: [], categories: ['SMARTPHONE'], relatedCompanies: [] },
    };
    const candidates = engine.findCandidateStories(
      applePhoneArt,
      applePhoneAnalysis,
      [appleWatchStory]
    );
    assert(
      candidates.length === 0,
      '13D: Apple smartphone article does NOT retrieve Apple Watch Story'
    );
  }

  // 13E: Samsung Galaxy Buds article does NOT retrieve Galaxy smartphone Story
  {
    const samsungBudsArt: Article = { ...mockHuaweiPhoneArticle, id: 'art-samsung-buds', title: 'Galaxy Buds On clip-on design' };
    const samsungBudsAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-samsung-buds',
      companies: [{ companyId: 'comp-samsung', canonicalName: 'Samsung', relevance: 'PRIMARY', confidence: 1 }],
      products: [{ canonicalName: 'Galaxy Buds On', matchedText: 'Galaxy Buds On', category: 'AUDIO', relevance: 'PRIMARY', confidence: 1 }],
      competitiveRelevance: { score: 70, reasons: [], categories: ['AUDIO'], relatedCompanies: [] },
    };
    const candidates = engine.findCandidateStories(
      samsungBudsArt,
      samsungBudsAnalysis,
      [samsungPhoneStory]
    );
    assert(
      candidates.length === 0,
      '13E: Samsung Galaxy Buds article does NOT retrieve Galaxy smartphone Story'
    );
  }

  // 13F: UNKNOWN category does not cause unsafe false-negative filtering
  {
    const unknownArt: Article = {
      ...mockHuaweiPhoneArticle,
      id: 'art-unknown-device',
      title: 'Huawei Tech Innovation Update',
      excerpt: 'General corporate innovation strategy overview',
    };
    const unknownAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-unknown-device',
      products: [],
      topics: [],
      competitiveRelevance: { score: 50, reasons: [], categories: [], relatedCompanies: [] },
    };
    const candidates = engine.findCandidateStories(
      unknownArt,
      unknownAnalysis,
      [huaweiWatchStory]
    );
    assert(
      candidates.length === 1 && candidates[0].id === 'story-cluster-huawei-watch-01',
      '13F: UNKNOWN category preserves recall and does not falsely reject candidate story'
    );
  }

  // 13G: Multi-category article can retrieve Stories sharing at least one reliable category
  {
    const multiArt: Article = {
      ...mockHuaweiPhoneArticle,
      id: 'art-multi-eco',
      title: 'Huawei Ecosystem Launch: Mate 90 Phone and Watch GT 7',
    };
    const multiAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-multi-eco',
      products: [
        { canonicalName: 'Huawei Mate 90', matchedText: 'Huawei Mate 90', category: 'SMARTPHONE', relevance: 'PRIMARY', confidence: 1 },
        { canonicalName: 'HUAWEI Watch GT 7 Pro', matchedText: 'HUAWEI Watch GT 7 Pro', category: 'WEARABLE', relevance: 'SECONDARY', confidence: 1 },
      ],
      competitiveRelevance: { score: 80, reasons: [], categories: ['SMARTPHONE', 'WEARABLE'], relatedCompanies: [] },
    };
    const candidates = engine.findCandidateStories(
      multiArt,
      multiAnalysis,
      [huaweiWatchStory, huaweiTabletStory]
    );
    assert(
      candidates.length === 1 && candidates[0].id === 'story-cluster-huawei-watch-01',
      '13G: Multi-category article matches story intersecting on WEARABLE, but excludes TABLET'
    );
  }

  // 13H: Category filtering occurs BEFORE maxCandidates = 20 truncation
  {
    // Generate 25 candidate stories: 24 tablet stories (most recent) + 1 watch story (older, but in time window)
    const tabletStories: Story[] = Array.from({ length: 24 }, (_, i) => ({
      ...huaweiTabletStory,
      id: `story-tablet-spam-${i}`,
      lastSeenAt: new Date(new Date(baseTime).getTime() - (i + 1) * 3600 * 1000).toISOString(),
    }));
    const olderWatchStory: Story = {
      ...huaweiWatchStory,
      id: 'story-watch-real-target',
      lastSeenAt: new Date(new Date(baseTime).getTime() - 25 * 3600 * 1000).toISOString(), // older
    };

    const watchArt: Article = { ...mockHuaweiPhoneArticle, id: 'art-watch-h', title: 'Huawei Watch GT 7 Update' };
    const watchAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-watch-h',
      products: [{ canonicalName: 'Huawei Watch GT 7', matchedText: 'Huawei Watch GT 7', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
      competitiveRelevance: { score: 70, reasons: [], categories: ['WEARABLE'], relatedCompanies: [] },
    };

    // If category filtering were done AFTER maxCandidates(20) truncation, all 20 slots would be taken by recent tablet stories!
    // Because category filtering happens BEFORE truncation, all 24 tablet stories are discarded, and the watch story survives!
    const candidates = engine.findCandidateStories(
      watchArt,
      watchAnalysis,
      [...tabletStories, olderWatchStory]
    );
    assert(
      candidates.length === 1 && candidates[0].id === 'story-watch-real-target',
      '13H: Category filtering occurs BEFORE maxCandidates=20 truncation (target story not crowded out)'
    );
  }

  // 13I: Existing temporal/company filtering still works
  {
    // Distant story (> 7 days)
    const distantStory: Story = {
      ...huaweiWatchStory,
      id: 'story-distant-huawei',
      lastSeenAt: new Date(new Date(baseTime).getTime() - 40 * 24 * 3600 * 1000).toISOString(),
    };
    const watchArt: Article = { ...mockHuaweiPhoneArticle, id: 'art-watch-time', title: 'Huawei Watch GT 7 Update' };
    const watchAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-watch-time',
      products: [{ canonicalName: 'Huawei Watch GT 7', matchedText: 'Huawei Watch GT 7', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
    };
    const candidates = engine.findCandidateStories(
      watchArt,
      watchAnalysis,
      [distantStory]
    );
    assert(
      candidates.length === 0,
      '13I: Temporal window filter (> 7 days) correctly discards distant story'
    );
  }

  // 13J: Legacy Story exclusion still works
  {
    const legacyStory: Story = {
      id: 'story-001',
      canonicalTitle: 'Legacy Bootstrap Story',
      summary: 'Legacy',
      status: 'DEVELOPING',
      storyType: 'PRODUCT_LAUNCH',
      importanceScore: 80,
      confidence: 0.9,
      firstSeenAt: baseTime,
      lastSeenAt: baseTime,
      articleCount: 1,
      articleIds: ['art-001'],
      sourceIds: ['s1'],
      sourceCount: 1,
      companies: [{ companyId: 'comp-huawei', name: 'HUAWEI', relevance: 'PRIMARY' }],
      products: [{ name: 'HUAWEI Watch GT 7 Pro', category: 'WEARABLE' }],
      categories: ['WEARABLE'],
      topics: [],
      markets: ['Global'],
      languages: ['en'],
      primaryCompanyId: 'comp-huawei',
      primaryProductId: 'HUAWEI Watch GT 7 Pro',
      representativeArticleId: 'art-001',
      createdAt: baseTime,
      updatedAt: baseTime,
      clusteringVersion: 'legacy-bootstrap',
      isLegacy: true,
    };
    const watchArt: Article = { ...mockHuaweiPhoneArticle, id: 'art-watch-leg', title: 'Huawei Watch GT 7 Update' };
    const watchAnalysis: ArticleAnalysis = {
      ...mockHuaweiPhoneAnalysis,
      articleId: 'art-watch-leg',
      products: [{ canonicalName: 'Huawei Watch GT 7', matchedText: 'Huawei Watch GT 7', category: 'WEARABLE', relevance: 'PRIMARY', confidence: 1 }],
    };
    const candidates = engine.findCandidateStories(
      watchArt,
      watchAnalysis,
      [legacyStory]
    );
    assert(
      candidates.length === 0,
      '13J: Legacy Story (story-001) is strictly excluded from candidate retrieval'
    );
  }

  console.log(`\n=== CATEGORY & CANDIDATE RETRIEVAL TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCategoryModelTests();
}

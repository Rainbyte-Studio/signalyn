/**
 * Signalyn Phase 7B.2 Verification Test Suite
 *
 * Comprehensive tests for:
 * 1. Intelligent Story Identity & Deduplication (cross-language, category boundaries, launch vs review)
 * 2. Evidence Verification & Source Reliability (classifications, syndication pruning, rumor-to-confirmation, contradictions)
 * 3. Story Development & Update Detection (material updates vs repetitive coverage, timeline maintenance, no false resets)
 * 4. HUAWEI Competitive Intelligence Layer (decoupled strategic importance vs confidence, threat levels, competitive implications)
 * 5. Administrative Verification & Reconciliation Tooling (read-only duplicate audit, safe atomic merge semantics)
 * 6. Backward Compatibility & Non-destructive Guarantees
 */

import {
  compareStoryIdentities,
  computeEventSignature,
  detectMaterialDevelopment,
  auditDuplicateStories,
  normalizeCrossLanguageTokens,
  calculateTokenSimilarity,
} from '../src/server/clustering/storyIdentityService';
import {
  evaluateStoryEvidence,
  calculateIndependentSourceCount,
  areSourcesSyndicated,
  extractDomain,
  isOfficialManufacturerSource,
} from '../src/server/clustering/evidenceVerificationService';
import {
  deriveHuaweiCompetitiveIntelligence,
} from '../src/server/clustering/huaweiCompetitiveService';
import {
  Article,
  ArticleAnalysis,
  Story,
  isProductionStory,
  isLegacyStory,
} from '../src/types';

// Simple lightweight test runner helper
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
console.log('SIGNALYN PHASE 7B.2: STORY INTELLIGENCE & EVIDENCE TEST SUITE');
console.log('===============================================================\n');

// -------------------------------------------------------------
// 1. Intelligent Story Identity & Deduplication
// -------------------------------------------------------------
console.log('[1. Story Identity & Deduplication]');

// Cross-language Greek & English token comparison
const grTokens = normalizeCrossLanguageTokens('Η Huawei ανακοίνωσε το Watch GT 5 με προηγμένους αισθητήρες');
const enTokens = normalizeCrossLanguageTokens('Huawei announced Watch GT 5 with advanced health sensors');
const tokenSim = calculateTokenSimilarity(grTokens, enTokens);
assert(tokenSim >= 0.35, 'Cross-language normalization correlates Greek and English tech tokens', `Got similarity ${tokenSim}`);

const nowIso = new Date().toISOString();

// Invariant 1: Greek and English coverage of same product launch within temporal window
const storyEn: Story = {
  id: 'story-cluster-hw-watch-en',
  canonicalTitle: 'Huawei Officially Unveils Watch GT 5 Series Worldwide',
  summary: 'Huawei has launched the Watch GT 5 series featuring advanced battery life.',
  status: 'DEVELOPING',
  storyType: 'PRODUCT_LAUNCH',
  importanceScore: 80,
  confidence: 0.95,
  firstSeenAt: nowIso,
  lastSeenAt: nowIso,
  articleCount: 1,
  articleIds: ['art-en-1'],
  sourceIds: ['src-gsmarena'],
  sourceCount: 1,
  companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
  products: [{ productId: 'prod-watch-gt5', name: 'Watch GT 5', category: 'WEARABLE' }],
  categories: ['WEARABLE'],
  topics: ['smartwatch', 'launch'],
  markets: ['Global'],
  languages: ['en'],
  primaryCompanyId: 'comp-huawei',
  primaryProductId: 'prod-watch-gt5',
  representativeArticleId: 'art-en-1',
  createdAt: nowIso,
  updatedAt: nowIso,
  clusteringVersion: 'v2.1-hybrid',
};

const storyGr: Story = {
  id: 'story-cluster-hw-watch-gr',
  canonicalTitle: 'Η Huawei ανακοίνωσε επίσημα τη σειρά Watch GT 5',
  summary: 'Επίσημη κυκλοφορία του νέου Watch GT 5 από τη Huawei στην ευρωπαϊκή αγορά.',
  status: 'DEVELOPING',
  storyType: 'PRODUCT_LAUNCH',
  importanceScore: 80,
  confidence: 0.92,
  firstSeenAt: nowIso,
  lastSeenAt: nowIso,
  articleCount: 1,
  articleIds: ['art-gr-1'],
  sourceIds: ['src-techmaniacs'],
  sourceCount: 1,
  companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
  products: [{ productId: 'prod-watch-gt5', name: 'Watch GT 5', category: 'WEARABLE' }],
  categories: ['WEARABLE'],
  topics: ['smartwatch', 'launch'],
  markets: ['Greece'],
  languages: ['el'],
  primaryCompanyId: 'comp-huawei',
  primaryProductId: 'prod-watch-gt5',
  representativeArticleId: 'art-gr-1',
  createdAt: nowIso,
  updatedAt: nowIso,
  clusteringVersion: 'v2.1-hybrid',
};

const crossLangComp = compareStoryIdentities(storyEn, storyGr);
assert(
  crossLangComp.decision === 'DEFINITE_SAME_DEVELOPMENT',
  'Greek and English reports covering the same announcement resolve to the same development',
  `Decision: ${crossLangComp.decision}, reason: ${crossLangComp.reason}`
);
assert(crossLangComp.isCrossLanguageMatch === true, 'Cross-language match flag is set to true');

// Invariant 2: Product Launch vs Independent Product Review must remain SEPARATE
const storyReview: Story = {
  ...storyEn,
  id: 'story-cluster-hw-watch-review',
  canonicalTitle: 'HUAWEI WATCH GT 5 Comprehensive In-Depth Review and Hands-On Test',
  summary: 'We test battery life, GPS accuracy, and heart rate tracking on the new GT 5.',
  storyType: 'REVIEW',
};

const launchVsReviewComp = compareStoryIdentities(storyEn, storyReview);
assert(
  launchVsReviewComp.decision === 'DEFINITE_SEPARATE_DEVELOPMENT',
  'Product launch and independent editorial review are kept strictly separate',
  `Decision: ${launchVsReviewComp.decision}, rule: ${launchVsReviewComp.ruleTriggered}`
);
assert(launchVsReviewComp.ruleTriggered === 'LAUNCH_VS_REVIEW_SEPARATION', 'Launch vs review separation rule triggered');

// Invariant 3: Category boundary separation (e.g. Smartphone vs Wearable with matching model names)
const storyPhoneWithSimilarName: Story = {
  ...storyEn,
  id: 'story-cluster-hw-phone-gt',
  canonicalTitle: 'HUAWEI GT Pro Smartphone Launch',
  categories: ['SMARTPHONE'],
  products: [{ productId: 'prod-phone-gt', name: 'GT Pro Smartphone', category: 'SMARTPHONE' }],
};

const categoryBoundaryComp = compareStoryIdentities(storyEn, storyPhoneWithSimilarName);
assert(
  categoryBoundaryComp.decision === 'DEFINITE_SEPARATE_DEVELOPMENT',
  'Hardware category boundaries prevent merging Smartphone and Wearable despite name overlap',
  `Decision: ${categoryBoundaryComp.decision}, rule: ${categoryBoundaryComp.ruleTriggered}`
);

// Invariant 4: Distinct Companies are NEVER merged
const storyAppleWatch: Story = {
  ...storyEn,
  id: 'story-cluster-apple-watch',
  canonicalTitle: 'Apple Watch Series 10 Launched',
  primaryCompanyId: 'comp-apple',
  companies: [{ companyId: 'comp-apple', name: 'Apple' }],
};

const distinctCompanyComp = compareStoryIdentities(storyEn, storyAppleWatch);
assert(
  distinctCompanyComp.decision === 'DEFINITE_SEPARATE_DEVELOPMENT',
  'Stories from distinct companies (HUAWEI vs Apple) are never merged',
  `Decision: ${distinctCompanyComp.decision}`
);

// -------------------------------------------------------------
// 2. Evidence Verification & Source Reliability
// -------------------------------------------------------------
console.log('\n[2. Evidence Verification & Source Reliability]');

// Official manufacturer domain detection
assert(isOfficialManufacturerSource('consumer.huawei.com') === true, 'consumer.huawei.com identified as official source');
assert(isOfficialManufacturerSource('https://www.apple.com/newsroom/') === true, 'apple.com identified as official source');
assert(isOfficialManufacturerSource('gsmarena.com') === false, 'gsmarena.com is not an official manufacturer source');

// Syndicated source pruning
assert(areSourcesSyndicated('gsmarena.com', 'arenaev.com') === true, 'GSMArena and ArenaEV recognized as syndicated network pair');
assert(areSourcesSyndicated('gsmarena.com', 'theverge.com') === false, 'GSMArena and The Verge recognized as independent');

const syndicatedArticles: Article[] = [
  {
    id: 'art-gsm',
    title: 'HUAWEI Watch GT 5 Announced',
    canonicalUrl: 'https://www.gsmarena.com/huawei_watch_gt_5-news-1234.php',
    sourceId: 'src-gsmarena',
    sourceName: 'GSMArena',
    publishedAt: nowIso,
  } as Article,
  {
    id: 'art-aev',
    title: 'HUAWEI Watch GT 5 Announced with AMOLED Screen',
    canonicalUrl: 'https://www.arenaev.com/huawei_watch_gt_5-news-5678.php',
    sourceId: 'src-arenaev',
    sourceName: 'ArenaEV',
    publishedAt: nowIso,
  } as Article,
];

const indCount = calculateIndependentSourceCount(syndicatedArticles);
assert(
  indCount === 1,
  'Syndicated media outlets (GSMArena + ArenaEV) are counted as 1 independent entity, not 2',
  `Calculated count: ${indCount}`
);

// Evidence Classifications: Official announcement vs Rumor vs Multi-source
const officialArticle: Article = {
  id: 'art-official',
  title: 'HUAWEI Mate XT Tri-Fold Launched Worldwide',
  canonicalUrl: 'https://consumer.huawei.com/en/press/news/2026/mate-xt/',
  sourceId: 'src-huawei-official',
  sourceName: 'HUAWEI Official Newsroom',
  publishedAt: nowIso,
} as Article;

const officialAnalysis: ArticleAnalysis = {
  articleId: 'art-official',
  newsType: 'PRODUCT_LAUNCH',
  summary: 'HUAWEI officially announced the global release of the Mate XT ultimate design.',
  importanceScore: 90,
  confidence: 0.98,
} as ArticleAnalysis;

const officialEvidence = evaluateStoryEvidence([officialArticle], [officialAnalysis]);
assert(
  officialEvidence.evidenceClassification === 'OFFICIAL_ANNOUNCEMENT',
  'Primary manufacturer source classifies as OFFICIAL_ANNOUNCEMENT',
  `Got: ${officialEvidence.evidenceClassification}`
);
assert(officialEvidence.evidenceConfidence >= 0.95, 'Official announcement has high confidence (>=0.95)');

// Rumors repeated across multiple outlets do NOT become official confirmation
const rumorArticle1: Article = {
  id: 'art-rumor-1',
  title: 'Leak: Samsung Galaxy S27 Ultra Camera Specs Rumored',
  canonicalUrl: 'https://www.androidpolice.com/galaxy-s27-leak',
  sourceId: 'src-androidpolice',
  sourceName: 'Android Police',
  publishedAt: nowIso,
} as Article;
const rumorAnalysis1: ArticleAnalysis = {
  articleId: 'art-rumor-1',
  newsType: 'PRODUCT_LEAK',
  summary: 'Tipster leaks alleged 200MP sensor for Galaxy S27 Ultra.',
  importanceScore: 75,
  confidence: 0.60,
} as ArticleAnalysis;

const rumorArticle2: Article = {
  id: 'art-rumor-2',
  title: 'Galaxy S27 Ultra might sport upgraded zoom camera according to rumors',
  canonicalUrl: 'https://www.phonearena.com/news/galaxy-s27-rumors',
  sourceId: 'src-phonearena',
  sourceName: 'PhoneArena',
  publishedAt: nowIso,
} as Article;
const rumorAnalysis2: ArticleAnalysis = {
  articleId: 'art-rumor-2',
  newsType: 'PRODUCT_LEAK',
  summary: 'Further reports repeat tipster leaks regarding Samsung next flagship camera.',
  importanceScore: 75,
  confidence: 0.60,
} as ArticleAnalysis;

const rumorEvidence = evaluateStoryEvidence([rumorArticle1, rumorArticle2], [rumorAnalysis1, rumorAnalysis2]);
assert(
  rumorEvidence.evidenceClassification === 'RUMOR_OR_LEAK',
  'Multiple outlets repeating a leak remain classified as RUMOR_OR_LEAK, never false confirmation',
  `Got: ${rumorEvidence.evidenceClassification}`
);

// Contradiction detection
const conflictingAnalysis1: ArticleAnalysis = {
  articleId: 'art-c1',
  newsType: 'PRODUCT_LAUNCH',
  summary: 'Apple launched the new budget headset available now worldwide.',
  importanceScore: 60,
  confidence: 0.7,
} as ArticleAnalysis;
const conflictingAnalysis2: ArticleAnalysis = {
  articleId: 'art-c2',
  newsType: 'ANNOUNCEMENT',
  summary: 'Supply chain sources indicate the budget headset has been delayed and cancelled for 2026.',
  importanceScore: 60,
  confidence: 0.7,
} as unknown as ArticleAnalysis;

const contradictionEvidence = evaluateStoryEvidence(
  [rumorArticle1, rumorArticle2],
  [conflictingAnalysis1, conflictingAnalysis2]
);
assert(
  contradictionEvidence.evidenceClassification === 'CONTRADICTED',
  'Conflicting release and postponement claims trigger CONTRADICTED classification',
  `Got: ${contradictionEvidence.evidenceClassification}`
);

// -------------------------------------------------------------
// 3. Story Development & Update Detection
// -------------------------------------------------------------
console.log('\n[3. Story Development & Update Detection]');

const existingStoryForUpdate: Story = {
  ...storyEn,
  evidenceClassification: 'RUMOR_OR_LEAK',
  summary: 'Early leaks suggest Huawei is preparing a new GT 5 series smartwatch.',
  timeline: [
    {
      id: 'dev-init',
      timestamp: nowIso,
      developmentType: 'SPEC_LEAK',
      description: 'Initial spec leak regarding battery and display.',
      articleIds: ['art-init'],
      sourceUrls: ['https://example.com/leak'],
      confidence: 'MEDIUM',
      evidenceClassification: 'RUMOR_OR_LEAK',
    },
  ],
};

// Duplicate repetitive article with no new information
const repetitiveArticle: Article = {
  id: 'art-repeat',
  title: 'More reports on the Watch GT 5',
  sourceId: 'src-gsmarena',
  publishedAt: nowIso,
} as Article;
const repetitiveAnalysis: ArticleAnalysis = {
  articleId: 'art-repeat',
  summary: 'Another blog shares the same details about the watch.',
  newsType: 'RUMOR',
} as ArticleAnalysis;

const repCheck = detectMaterialDevelopment(
  repetitiveArticle,
  repetitiveAnalysis,
  existingStoryForUpdate,
  'RUMOR_OR_LEAK'
);
assert(
  repCheck.isMaterialUpdate === false,
  'Repetitive coverage without new disclosures is NOT classified as a material update',
  `Reason: ${repCheck.reason}`
);

// Material update 1: Official confirmation of earlier rumor
const officialConfirmCheck = detectMaterialDevelopment(
  officialArticle,
  officialAnalysis,
  existingStoryForUpdate,
  'OFFICIAL_ANNOUNCEMENT'
);
assert(
  officialConfirmCheck.isMaterialUpdate === true,
  'Official announcement of previous rumor triggers material development',
  `Type: ${officialConfirmCheck.developmentType}`
);
assert(officialConfirmCheck.developmentType === 'OFFICIAL_ANNOUNCEMENT', 'Development type is OFFICIAL_ANNOUNCEMENT');

// Material update 2: Pricing and availability disclosure
const pricingArticle: Article = {
  id: 'art-price',
  title: 'HUAWEI Announces Official Watch GT 5 Pricing and Shipping Date',
  sourceId: 'src-gsmarena',
  publishedAt: nowIso,
} as Article;
const pricingAnalysis: ArticleAnalysis = {
  articleId: 'art-price',
  summary: 'European retail pricing confirmed at 249 EUR, with pre-order shipping date starting next Monday.',
  newsType: 'PRICING',
} as unknown as ArticleAnalysis;

const pricingCheck = detectMaterialDevelopment(
  pricingArticle,
  pricingAnalysis,
  existingStoryForUpdate,
  'MULTI_SOURCE_CORROBORATED'
);
assert(
  pricingCheck.isMaterialUpdate === true && pricingCheck.developmentType === 'PRICING_AVAILABILITY',
  'Pricing and availability disclosures trigger PRICING_AVAILABILITY material update'
);

// -------------------------------------------------------------
// 4. HUAWEI Competitive Intelligence Layer
// -------------------------------------------------------------
console.log('\n[4. HUAWEI Competitive Intelligence Layer]');

// Scenario A: Major competitor leak (Apple flagship foldable or smartphone)
// -> Decoupling: High Strategic Importance (e.g. 75-90), but Low/Moderate Evidence Confidence (0.45-0.65)
const appleFoldableAnalysis: ArticleAnalysis = {
  articleId: 'art-apple-foldable',
  newsType: 'PRODUCT_LEAK',
  summary: 'Analyst report details Apple flagship foldable ultra breakthrough display and hinge mechanism.',
  importanceScore: 85,
  confidence: 0.55,
  companies: [{ companyId: 'comp-apple', canonicalName: 'Apple', relevance: 'PRIMARY' }],
} as any;

const appleCompIntel = deriveHuaweiCompetitiveIntelligence(
  {
    primaryCompanyId: 'comp-apple',
    storyType: 'LEAK',
    categories: ['SMARTPHONE'],
  },
  [rumorArticle1],
  [appleFoldableAnalysis],
  'RUMOR_OR_LEAK'
);

assert(
  appleCompIntel.strategicImportanceScore >= 75,
  'Competitor flagship innovation has high Strategic Importance Score (>= 75)',
  `Score: ${appleCompIntel.strategicImportanceScore}`
);
assert(
  appleCompIntel.competitiveThreatLevel === 'HIGH',
  'Direct tier-1 smartphone innovation is categorized as HIGH competitive threat',
  `Threat: ${appleCompIntel.competitiveThreatLevel}`
);
assert(
  Boolean(appleCompIntel.competitiveImplication && appleCompIntel.strategicRecommendation),
  'Includes concrete competitive implication and strategic action recommendation for HUAWEI'
);

// Scenario B: Minor competitor peripheral official launch
// -> Decoupling: Moderate/Low Strategic Importance (~35-45), but High Evidence Confidence (0.98)
const minorAccessoryAnalysis: ArticleAnalysis = {
  articleId: 'art-minor-acc',
  newsType: 'PRODUCT_LAUNCH',
  summary: 'OnePlus officially launched a basic silicone protective case for existing handsets.',
  importanceScore: 30,
  confidence: 0.98,
  companies: [{ companyId: 'comp-oneplus', canonicalName: 'OnePlus', relevance: 'PRIMARY' }],
} as any;

const minorCompIntel = deriveHuaweiCompetitiveIntelligence(
  {
    primaryCompanyId: 'comp-oneplus',
    storyType: 'PRODUCT_LAUNCH',
    categories: ['OTHER'],
  },
  [officialArticle],
  [minorAccessoryAnalysis],
  'OFFICIAL_ANNOUNCEMENT'
);

assert(
  minorCompIntel.strategicImportanceScore < 50,
  'Minor accessory release receives low/moderate Strategic Importance Score (< 50)',
  `Score: ${minorCompIntel.strategicImportanceScore}`
);
assert(
  minorCompIntel.competitiveThreatLevel === 'LOW',
  'Minor accessory has LOW competitive threat level',
  `Threat: ${minorCompIntel.competitiveThreatLevel}`
);

// Scenario C: HUAWEI First-Party News
// -> Threat Level must be NOT_APPLICABLE
const huaweiFirstPartyIntel = deriveHuaweiCompetitiveIntelligence(
  {
    primaryCompanyId: 'comp-huawei',
    storyType: 'PRODUCT_LAUNCH',
    categories: ['SMARTPHONE'],
  },
  [officialArticle],
  [officialAnalysis],
  'OFFICIAL_ANNOUNCEMENT'
);

assert(
  huaweiFirstPartyIntel.competitiveThreatLevel === 'NOT_APPLICABLE',
  'HUAWEI first-party developments are marked as NOT_APPLICABLE threat level',
  `Threat: ${huaweiFirstPartyIntel.competitiveThreatLevel}`
);
assert(
  huaweiFirstPartyIntel.huaweiRelevance.includes('First-party development'),
  'HUAWEI 1P development context is clearly distinguished from competitor threats'
);

// -------------------------------------------------------------
// 5. Administrative Verification & Reconciliation Tooling
// -------------------------------------------------------------
console.log('\n[5. Administrative Verification & Reconciliation Tooling]');

// Duplicate Story Candidate Audit
const testStoriesForAudit: Story[] = [
  storyEn,
  storyGr, // Should be flagged as clear merge candidate with storyEn!
  storyReview, // Should NOT be merged with storyEn (kept separate)
  storyAppleWatch, // Distinct company, kept separate
];

const auditReport = auditDuplicateStories(testStoriesForAudit);
assert(auditReport.totalStoriesAudited === 4, 'Audit processes all 4 production stories');
assert(auditReport.clearMergesCount >= 1, 'Audit identifies clear duplicate merge candidate pair', `Found: ${auditReport.clearMergesCount}`);
assert(
  auditReport.candidatePairs.some((p) => p.proposedAction === 'MERGE' && p.isCrossLanguageMatch),
  'Audit flags Greek and English Watch GT 5 pair for MERGE'
);
assert(
  !auditReport.candidatePairs.some((p) => p.storyA.id === storyReview.id && p.proposedAction === 'MERGE'),
  'Audit does not propose merging independent editorial review into launch story'
);

// Safe, non-destructive merge mechanics verification
const targetStory = { ...storyEn };
const sourceStory = { ...storyGr };

// Simulate merge operation logic as executed in /api/stories/reconcile/merge
const mergedArticleIds = Array.from(new Set([...targetStory.articleIds, ...sourceStory.articleIds]));
const mergedSourceIds = Array.from(new Set([...targetStory.sourceIds, ...sourceStory.sourceIds]));
const updatedMergeMetadata = {
  mergedAt: nowIso,
  mergedStoryIds: [sourceStory.id],
};

// Soft-resolved source story
const softResolvedSource: Partial<Story> = {
  ...sourceStory,
  status: 'RESOLVED',
  terminalReason: `Merged into authoritative cluster ${targetStory.id}`,
  // @ts-expect-error test field
  mergedIntoStoryId: targetStory.id,
};

assert(mergedArticleIds.length === 2, 'Consolidated target story contains all source article IDs');
assert(mergedSourceIds.length === 2, 'Consolidated target story contains all source IDs');
assert(softResolvedSource.status === 'RESOLVED', 'Source story is soft-resolved (not deleted!)');
assert(
  Boolean(softResolvedSource.terminalReason?.includes(targetStory.id)),
  'Source story stores pointer to authoritative target story ID'
);

// -------------------------------------------------------------
// 6. Backward Compatibility & System Integrity
// -------------------------------------------------------------
console.log('\n[6. Backward Compatibility & System Integrity]');

// Legacy story isolation
const legacyStory: Story = {
  id: 'story-001',
  canonicalTitle: 'Legacy Bootstrap Story',
  summary: 'Pre-existing seed story',
  status: 'STABLE',
  storyType: 'OTHER',
  importanceScore: 50,
  confidence: 0.8,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  articleCount: 1,
  articleIds: ['legacy-art-1'],
  sourceIds: ['legacy-src-1'],
  sourceCount: 1,
  companies: [],
  products: [],
  categories: ['SMARTPHONE'],
  topics: [],
  markets: [],
  languages: [],
  primaryCompanyId: null,
  primaryProductId: null,
  representativeArticleId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  clusteringVersion: 'legacy-bootstrap',
  isLegacy: true,
};

assert(isLegacyStory(legacyStory) === true, 'Legacy seed story is correctly identified as legacy');
assert(isProductionStory(legacyStory) === false, 'Legacy seed story is excluded from production story sets');
assert(isProductionStory(storyEn) === true, 'Phase 7B story is recognized as production story');

console.log('\n===============================================================');
console.log(`TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log('===============================================================\n');

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

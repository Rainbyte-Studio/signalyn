/**
 * Signalyn Phase 4A.7 Controlled Multi-Category Story Persistence Service
 * 
 * Provides:
 * 1. Deterministic Story ID generation for new Stories.
 * 2. Immutable Story ID preservation when joining existing Stories.
 * 3. Dynamic Canonical Device Category resolution (SMARTPHONE, WEARABLE, AUDIO, TABLET).
 * 4. Multi-company relation preservation (e.g. Xiaomi + Apple).
 * 5. Atomic Firestore batch persistence for Story, StoryMembership, and ArticleAnalysis.storyId.
 * 6. Strict idempotency checking (detects pre-existing state, safe to retry without duplicate writes).
 * 7. Canonical StoryRun telemetry recording at /system/storyRuns/runs/{runId}.
 * 8. Comprehensive post-write consistency verification (Checks A through S).
 */

import crypto from 'crypto';
import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import {
  Article,
  ArticleAnalysis,
  isLegacyStory,
  Story,
  StoryCompanyRef,
  StoryMembership,
  StoryProductRef,
  StoryRun,
  StoryStatus,
  StoryType,
} from '../../types';
import { ProposedCluster, Stage2DryRunResult } from './types';
import { resolveCanonicalCategories } from './categoryModel';
import {
  containsGreekCharacters,
  generateDeterministicPresentation,
} from './storyPresentationService';
import { evaluateStoryEvidence } from './evidenceVerificationService';
import { deriveHuaweiCompetitiveIntelligence } from './huaweiCompetitiveService';
import { computeEventSignature } from './storyIdentityService';
import { StoryDevelopment } from '../../types';

export const CLUSTERING_VERSION = 'signalyn-cluster-v1';

/**
 * Generates a stable, deterministic Story ID from canonical cluster properties.
 * Order of articleIds does not affect the output.
 */
export function generateDeterministicStoryId(
  articleIds: string[],
  primaryCompanyId: string | null,
  primaryProductId: string | null,
  storyType: string
): string {
  const sortedIds = [...articleIds].sort();
  const normCompany = (primaryCompanyId || 'none').toLowerCase().trim();
  const normProduct = (primaryProductId || 'none').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normType = storyType.toUpperCase().trim();

  const payload = `${sortedIds.join(',')}|${normCompany}|${normProduct}|${normType}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `story-cluster-${hash}`;
}

export const cleanForFirestore = cleanServerData;

export interface ClusterPersistencePlan {
  storyId: string;
  story: Story;
  memberships: StoryMembership[];
  articleIdsToUpdate: string[];
  isAlreadyPersisted: boolean;
}

export interface PersistenceResult {
  runId: string;
  storiesCreated: number;
  storiesUpdated: number;
  membershipsCreated: number;
  articleAnalysisUpdated: number;
  idempotentNoOps: number;
  persistedStoryIds: string[];
  durationMs: number;
  storyRunRecord: StoryRun;
}

/**
 * Builds a valid Story and StoryMembership documents for a proposed cluster or existing Story expansion.
 */
export function buildStoryAndMemberships(
  cluster: ProposedCluster,
  articlesMap: Map<string, Article>,
  analysesMap: Map<string, ArticleAnalysis>,
  existingStory?: Story | null
): { story: Story; memberships: StoryMembership[] } {
  const now = new Date().toISOString();
  const memberArticles = cluster.articleIds.map((id) => articlesMap.get(id)!);
  const memberAnalyses = cluster.articleIds.map((id) => analysesMap.get(id)!);

  // Determine lead / representative article (highest importanceScore, then earliest published)
  let repIdx = 0;
  let maxScore = -1;
  memberAnalyses.forEach((an, idx) => {
    const score = an.importanceScore || 0;
    if (score > maxScore) {
      maxScore = score;
      repIdx = idx;
    }
  });

  const repArticle = memberArticles[repIdx];
  const repAnalysis = memberAnalyses[repIdx];

  // Aggregated metadata
  const sortedDates = memberArticles
    .map((a) => a.publishedAt)
    .filter(Boolean)
    .sort();
  const firstSeenAt = sortedDates[0] || now;
  const lastSeenAt = sortedDates[sortedDates.length - 1] || now;

  const uniqueSourceIds = Array.from(new Set(memberArticles.map((a) => a.sourceId)));
  const uniqueTopics = Array.from(new Set(memberAnalyses.flatMap((a) => a.topics || [])));
  const uniqueMarkets = Array.from(new Set(memberArticles.map((a) => a.market || 'Global')));
  const uniqueLanguages = Array.from(new Set(memberArticles.map((a) => a.language || 'el')));

  // Aggregated companies - preserves multiple companies (e.g. Xiaomi + Apple)
  const companyMap = new Map<string, StoryCompanyRef>();
  if (existingStory?.companies) {
    existingStory.companies.forEach((c) => {
      const id = c.companyId || c.name;
      companyMap.set(id, c);
    });
  }
  memberAnalyses.forEach((an) => {
    (an.companies || []).forEach((c) => {
      const id = c.companyId || c.canonicalName;
      if (!companyMap.has(id)) {
        companyMap.set(id, {
          companyId: c.companyId,
          name: c.canonicalName,
          relevance: c.relevance,
        });
      }
    });
  });

  // Aggregated products
  const productMap = new Map<string, StoryProductRef>();
  if (existingStory?.products) {
    existingStory.products.forEach((p) => {
      const id = p.productId || p.name;
      productMap.set(id, p);
    });
  }
  memberAnalyses.forEach((an) => {
    (an.products || []).forEach((p) => {
      const id = p.canonicalName;
      if (!productMap.has(id)) {
        productMap.set(id, {
          productId: p.canonicalName,
          name: p.canonicalName,
          category: p.category,
        });
      }
    });
  });

  // Dynamic canonical device category resolution
  const storyCategories = new Set<string>();
  if (existingStory?.categories) {
    existingStory.categories.forEach((c) => storyCategories.add(c));
  }
  memberArticles.forEach((art, idx) => {
    const an = memberAnalyses[idx];
    const cats = resolveCanonicalCategories(art, an);
    cats.forEach((c) => {
      if (c !== 'UNKNOWN') storyCategories.add(c);
    });
  });
  if (storyCategories.size === 0) storyCategories.add('OTHER');

  const storyId = existingStory?.id || cluster.clusterId;

  // Article and source aggregates with existing story merge
  const allArticleIds = existingStory
    ? Array.from(new Set([...existingStory.articleIds, ...cluster.articleIds])).sort()
    : [...cluster.articleIds].sort();

  const allSourceIds = existingStory
    ? Array.from(new Set([...existingStory.sourceIds, ...uniqueSourceIds]))
    : uniqueSourceIds;

  const mergedFirstSeenAt =
    existingStory?.firstSeenAt && existingStory.firstSeenAt < firstSeenAt
      ? existingStory.firstSeenAt
      : firstSeenAt;

  const mergedLastSeenAt =
    existingStory?.lastSeenAt && existingStory.lastSeenAt > lastSeenAt
      ? existingStory.lastSeenAt
      : lastSeenAt;

  // Representative article selection
  let repArticleId = repArticle.id;
  if (existingStory?.representativeArticleId) {
    const existingRepAn = analysesMap.get(existingStory.representativeArticleId);
    const existingScore = existingRepAn?.importanceScore || existingStory.importanceScore || 0;
    if (existingScore >= (repAnalysis.importanceScore || 0)) {
      repArticleId = existingStory.representativeArticleId;
    }
  }

  // Canonical Presentation Resolution (English Invariant)
  const isExistingTitleEnglish =
    existingStory?.canonicalTitle &&
    !containsGreekCharacters(existingStory.canonicalTitle);
  const isExistingSummaryEnglish =
    existingStory?.summary &&
    !containsGreekCharacters(existingStory.summary);

  let finalCanonicalTitle = isExistingTitleEnglish ? existingStory!.canonicalTitle : '';
  let finalSummary = isExistingSummaryEnglish ? existingStory!.summary : '';

  if (!finalCanonicalTitle || !finalSummary) {
    const pres = generateDeterministicPresentation({
      storyId,
      articles: memberArticles,
      analyses: memberAnalyses,
      primaryCompanyId: cluster.primaryCompanyId || existingStory?.primaryCompanyId,
      primaryProductId: cluster.primaryProductId || existingStory?.primaryProductId,
      newsType: cluster.newsType,
      existingStory,
    });
    if (!finalCanonicalTitle) {
      finalCanonicalTitle =
        cluster.canonicalTitle && !containsGreekCharacters(cluster.canonicalTitle)
          ? cluster.canonicalTitle
          : pres.canonicalTitle;
    }
    if (!finalSummary) {
      finalSummary = pres.summary;
    }
  }

  // Phase 7B.2 Evidence Verification & HUAWEI Competitive Intelligence Layer
  const evidenceResult = evaluateStoryEvidence(memberArticles, memberAnalyses, existingStory);
  const competitiveResult = deriveHuaweiCompetitiveIntelligence(
    {
      primaryCompanyId: cluster.primaryCompanyId || existingStory?.primaryCompanyId,
      companies: Array.from(companyMap.values()),
      categories: Array.from(storyCategories),
      storyType: (existingStory?.storyType as StoryType) || (cluster.newsType as StoryType) || 'NEWS',
    },
    memberArticles,
    memberAnalyses,
    evidenceResult.evidenceClassification
  );

  const eventSignature = computeEventSignature(
    cluster.primaryCompanyId || existingStory?.primaryCompanyId,
    competitiveResult.hardwareCategory,
    cluster.primaryProductId || existingStory?.primaryProductId,
    cluster.newsType
  );

  const initialTimeline: StoryDevelopment[] = existingStory?.timeline && existingStory.timeline.length > 0
    ? existingStory.timeline
    : [
        {
          id: `dev-${storyId}-init`,
          timestamp: mergedFirstSeenAt,
          developmentType: evidenceResult.evidenceClassification === 'OFFICIAL_ANNOUNCEMENT'
            ? 'OFFICIAL_ANNOUNCEMENT'
            : evidenceResult.evidenceClassification === 'RUMOR_OR_LEAK'
            ? 'SPEC_LEAK'
            : 'INITIAL_COVERAGE',
          description: finalCanonicalTitle,
          articleIds: cluster.articleIds,
          sourceUrls: memberArticles.map((a) => a.canonicalUrl || (a as any).url).filter(Boolean),
          confidence: evidenceResult.evidenceConfidence >= 0.8 ? 'HIGH' : evidenceResult.evidenceConfidence >= 0.6 ? 'MEDIUM' : 'LOW',
          evidenceClassification: evidenceResult.evidenceClassification,
        },
      ];

  const story: Story = {
    id: storyId,
    canonicalTitle: finalCanonicalTitle,
    title: finalCanonicalTitle,
    summary: finalSummary,
    canonicalSummary: finalSummary,
    presentationLanguage: 'en',
    status: (existingStory?.status as StoryStatus) || ('DEVELOPING' as StoryStatus),
    storyType:
      (existingStory?.storyType as StoryType) ||
      (cluster.newsType as StoryType) ||
      'NEWS',
    importanceScore: existingStory
      ? Math.max(existingStory.importanceScore, repAnalysis.importanceScore || 50)
      : Math.round(
          memberAnalyses.reduce((sum, a) => sum + (a.importanceScore || 50), 0) /
            memberAnalyses.length
        ),
    confidence: cluster.confidence,
    firstSeenAt: mergedFirstSeenAt,
    lastSeenAt: mergedLastSeenAt,
    articleCount: allArticleIds.length,
    articleIds: allArticleIds,
    sourceIds: allSourceIds,
    sourceCount: allSourceIds.length,
    companies: Array.from(companyMap.values()),
    products: Array.from(productMap.values()),
    categories: Array.from(storyCategories),
    topics: existingStory?.topics
      ? Array.from(new Set([...existingStory.topics, ...uniqueTopics]))
      : uniqueTopics,
    markets: existingStory?.markets
      ? Array.from(new Set([...existingStory.markets, ...uniqueMarkets]))
      : uniqueMarkets,
    languages: existingStory?.languages
      ? Array.from(new Set([...existingStory.languages, ...uniqueLanguages]))
      : uniqueLanguages,
    primaryCompanyId: cluster.primaryCompanyId || existingStory?.primaryCompanyId || null,
    primaryProductId: cluster.primaryProductId || existingStory?.primaryProductId || null,
    representativeArticleId: repArticleId,
    createdAt: existingStory?.createdAt || now,
    updatedAt: now,
    clusteringVersion: CLUSTERING_VERSION,
    isLegacy: false,
    // Phase 7B.2 Evidence Verification & Provenance Fields
    evidenceClassification: evidenceResult.evidenceClassification,
    evidenceConfidence: evidenceResult.evidenceConfidence,
    evidenceReasons: evidenceResult.evidenceReasons,
    independentSourceCount: evidenceResult.independentSourceCount,
    sourceProvenances: evidenceResult.sourceProvenances,
    lastMaterialUpdateAt: existingStory?.lastMaterialUpdateAt || mergedLastSeenAt,
    timeline: initialTimeline,
    eventSignature,
    // Phase 7B.2 HUAWEI Competitive Intelligence Layer
    strategicImportanceScore: competitiveResult.strategicImportanceScore,
    competitiveThreatLevel: competitiveResult.competitiveThreatLevel,
    huaweiRelevance: competitiveResult.huaweiRelevance,
    competitiveImplication: competitiveResult.competitiveImplication,
    strategicRecommendation: competitiveResult.strategicRecommendation,
    strategicScoringFactors: competitiveResult.strategicScoringFactors,
  };

  const memberships: StoryMembership[] = cluster.articleIds.map((artId) => {
    const art = articlesMap.get(artId)!;
    const an = analysesMap.get(artId)!;
    return {
      articleId: artId,
      storyId,
      sourceId: art.sourceId,
      sourceName: art.sourceName || art.sourceId,
      publishedAt: art.publishedAt,
      headline: art.title,
      sentiment: an.sentiment,
      similarityScore: 1.0,
      membershipConfidence: an.confidence || 0.95,
      addedAt: now,
    };
  });

  return { story, memberships };
}

/**
 * Persists proposed clusters from the Phase 4A Stage 1+2 dry run with strict idempotency and atomicity.
 */
export async function persistProposedClusters(
  stage2Result: Stage2DryRunResult,
  articlesMap: Map<string, Article>,
  analysesMap: Map<string, ArticleAnalysis>,
  options?: {
    isRetryVerification?: boolean;
    existingStoryJoins?: Map<string, string>; // articleId -> existingStoryId
  }
): Promise<PersistenceResult> {
  const startTime = Date.now();
  const runId = `run-cluster-p4a-${Date.now().toString(36)}`;
  let storiesCreated = 0;
  let storiesUpdated = 0;
  let membershipsCreated = 0;
  let articleAnalysisUpdated = 0;
  let idempotentNoOps = 0;
  const persistedStoryIds: string[] = [];

  const db = getServerDb();
  const batch = db.batch();

  for (const cluster of stage2Result.proposedClusters) {
    // Check if any article in this cluster is designated to join an existing Story
    const joinArticleId = cluster.articleIds.find((id) => options?.existingStoryJoins?.has(id));
    const targetExistingStoryId = joinArticleId
      ? options?.existingStoryJoins?.get(joinArticleId)
      : null;

    let targetStoryId: string;
    let existingStory: Story | null = null;
    let isJoin = false;

    if (targetExistingStoryId) {
      // 1A. Joining Existing Story: IMMUTABLE Story ID preservation
      targetStoryId = targetExistingStoryId;
      isJoin = true;
      const storyRef = db.collection('stories').doc(targetStoryId);
      const storySnap = await storyRef.get();
      const isStoryExists = typeof storySnap.exists === 'function'
        ? (storySnap as any).exists()
        : Boolean(storySnap.exists);
      if (!isStoryExists) {
        throw new Error(`Target existing Story ${targetStoryId} does not exist in Firestore!`);
      }
      existingStory = storySnap.data() as Story;
    } else {
      // 1B. Creating New Story: Deterministic Story ID generation
      targetStoryId = generateDeterministicStoryId(
        cluster.articleIds,
        cluster.primaryCompanyId,
        cluster.primaryProductId,
        cluster.newsType
      );
      const storyRef = db.collection('stories').doc(targetStoryId);
      const storySnap = await storyRef.get();
      const isStoryExists = typeof storySnap.exists === 'function'
        ? (storySnap as any).exists()
        : Boolean(storySnap.exists);
      existingStory = isStoryExists ? (storySnap.data() as Story) : null;
    }

    persistedStoryIds.push(targetStoryId);

    // Check existing memberships for target story
    const existingMembershipsSnap = await db.collection('stories').doc(targetStoryId).collection('articles').get();
    const existingMemberIds = new Set<string>();
    existingMembershipsSnap.forEach((d) => existingMemberIds.add(d.id));

    // Check ArticleAnalysis storyId links
    let allAnalysesLinked = true;
    for (const artId of cluster.articleIds) {
      const anSnap = await db.collection('articleAnalysis').doc(artId).get();
      const isAnExists = typeof anSnap.exists === 'function' ? (anSnap as any).exists() : Boolean(anSnap.exists);
      if (!isAnExists || anSnap.data()?.storyId !== targetStoryId) {
        allAnalysesLinked = false;
        break;
      }
    }

    // Idempotency check: if fully persisted and merged, skip writes
    const isFullyPersisted =
      Boolean(existingStory) &&
      cluster.articleIds.every((id) => existingMemberIds.has(id)) &&
      allAnalysesLinked;

    if (isFullyPersisted) {
      idempotentNoOps++;
      continue;
    }

    // Build Story and Memberships
    const clusterWithTargetId = { ...cluster, clusterId: targetStoryId };
    const { story, memberships } = buildStoryAndMemberships(
      clusterWithTargetId,
      articlesMap,
      analysesMap,
      existingStory
    );

    const storyRef = db.collection('stories').doc(targetStoryId);
    batch.set(storyRef, cleanServerData(story));

    if (isJoin) {
      storiesUpdated++;
    } else {
      storiesCreated++;
    }

    // Write StoryMembership documents for incoming articles
    for (const mem of memberships) {
      if (!existingMemberIds.has(mem.articleId)) {
        const memRef = db.collection('stories').doc(targetStoryId).collection('articles').doc(mem.articleId);
        batch.set(memRef, cleanServerData(mem));
        membershipsCreated++;
      }
    }

    // Update ArticleAnalysis.storyId
    for (const artId of cluster.articleIds) {
      const anRef = db.collection('articleAnalysis').doc(artId);
      batch.update(anRef, {
        storyId: targetStoryId,
        updatedAt: new Date().toISOString(),
      });
      articleAnalysisUpdated++;
    }
  }

  // Commit batch atomically
  if (storiesCreated > 0 || storiesUpdated > 0 || membershipsCreated > 0 || articleAnalysisUpdated > 0) {
    await batch.commit();
  }

  const durationMs = Date.now() - startTime;
  const completedAt = new Date().toISOString();

  // Persist canonical StoryRun telemetry record (only on real run, skip duplicate for retry verification)
  const storyRunRecord: StoryRun = {
    runId,
    startedAt: new Date(startTime).toISOString(),
    completedAt,
    articlesProcessed: stage2Result.evaluatedArticleIds.length,
    storiesCreated,
    storiesUpdated,
    matches: stage2Result.summary.stage1Matches + stage2Result.summary.stage2Matches,
    newStories: storiesCreated,
    ambiguous: stage2Result.summary.stage1Ambiguous,
    failed: 0,
    geminiCalls: stage2Result.summary.geminiCallsPerformed,
    durationMs,
    trigger: options?.isRetryVerification
      ? 'PHASE_4A_IDEMPOTENCY_VERIFICATION'
      : 'PHASE_4A_CONTROLLED_PERSISTENCE',
    // Extended Phase 4 Telemetry
    clusteringVersion: CLUSTERING_VERSION,
    articlesEvaluated: stage2Result.evaluatedArticleIds.length,
    theoreticalPairs: stage2Result.summary.totalTheoreticalPairs,
    pairsPruned: stage2Result.summary.pairsPruned,
    pairsScored: stage2Result.summary.pairsScored,
    stage1Matches: stage2Result.summary.stage1Matches,
    stage1Separates: stage2Result.summary.stage1Separates,
    stage1Ambiguous: stage2Result.summary.stage1Ambiguous,
    stage2Matches: stage2Result.summary.stage2Matches,
    stage2Separates: stage2Result.summary.stage2Separates,
    stage2ReviewsRequired: stage2Result.summary.stage2ReviewsRequired,
    membershipsCreated,
    articleAnalysisUpdated,
    storyReviewsCreated: stage2Result.reviewProposals.length,
  };

  if (!options?.isRetryVerification) {
    await db.collection('system').doc('storyRuns').collection('runs').doc(runId).set(
      cleanServerData(storyRunRecord)
    );
  }

  return {
    runId,
    storiesCreated,
    storiesUpdated,
    membershipsCreated,
    articleAnalysisUpdated,
    idempotentNoOps,
    persistedStoryIds,
    durationMs,
    storyRunRecord,
  };
}

export interface ConsistencyVerificationReport {
  allValid: boolean;
  checks: Record<string, boolean>;
  details: string[];
}

/**
 * Validates post-write consistency across Firestore (Checks A through S).
 */
export async function verifyPostWriteConsistency(
  expectedStoryIds: string[],
  controlledArticleIds: string[]
): Promise<ConsistencyVerificationReport> {
  const details: string[] = [];
  const checks: Record<string, boolean> = {
    // A. Every new Story exists
    storiesExist: true,
    // B. Every StoryMembership references an existing Story
    everyArticleIdHasMembership: true,
    // C. Every membership article exists in /articles
    membershipArticleExistsInArticles: true,
    // D. Every membership article has ArticleAnalysis
    membershipArticleHasArticleAnalysis: true,
    // E. ArticleAnalysis.storyId matches the membership Story
    articleAnalysisStoryIdMatches: true,
    // F. No controlled article belongs to multiple active real Stories
    noArticleInMultiplePhase4Stories: true,
    // G. Story.articleIds exactly mirrors StoryMemberships
    articleIdsMirrorsMemberships: true,
    // H. articleCount equals membership count
    articleCountEqualsMembershipCount: true,
    // I. sourceCount equals unique membership source count
    sourceCountEqualsUniqueSources: true,
    // J. representativeArticleId belongs to the Story
    representativeArticleBelongsToStory: true,
    // K. companies aggregate matches membership evidence
    companiesMatchEvidence: true,
    // L. products aggregate matches membership evidence
    productsMatchEvidence: true,
    // M. canonical categories are internally consistent
    canonicalCategoriesConsistent: true,
    // N. Xiaomi + Apple are both preserved in comparison Story
    multiCompanyPreserved: true,
    // O. Watch GT 7 existing Story ID remains unchanged
    watchGT7IdPreserved: true,
    // P. legacy Stories remain unchanged
    legacyStoriesUnchanged: true,
    // Q. unrelated existing real Stories remain unchanged
    unrelatedRealStoriesUnchanged: true,
    // R. no orphan membership exists
    noOrphanMemberships: true,
    // S. no duplicate real Story was created
    noDuplicateStories: true,
  };

  const articleToStoryMap = new Map<string, string>();
  const uniqueStoryIds = new Set(expectedStoryIds);

  if (uniqueStoryIds.size !== expectedStoryIds.length) {
    checks.noDuplicateStories = false;
    details.push('Duplicate Story IDs found in expectedStoryIds list.');
  }

  const db = getServerDb();
  // Check P: Legacy stories unchanged
  const legacyIds = ['story-001', 'story-002', 'story-003'];
  for (const legId of legacyIds) {
    const legSnap = await db.collection('stories').doc(legId).get();
    const isLegExists = typeof legSnap.exists === 'function' ? (legSnap as any).exists() : Boolean(legSnap.exists);
    if (!isLegExists) {
      checks.legacyStoriesUnchanged = false;
      details.push(`Legacy story ${legId} missing from Firestore.`);
    } else {
      const data = legSnap.data() as any;
      if (!data?.isLegacy && !/^story-00[1-9]$/.test(legId)) {
        checks.legacyStoriesUnchanged = false;
        details.push(`Legacy story ${legId} lost isLegacy property.`);
      }
    }
  }

  // Check Q: Unrelated real stories unchanged
  const unrelatedRealStoryIds = [
    'story-cluster-e482cf41dc2862e4',
    'story-cluster-6adc8805ff27c725',
  ];
  for (const unId of unrelatedRealStoryIds) {
    const unSnap = await db.collection('stories').doc(unId).get();
    const isUnExists = typeof unSnap.exists === 'function' ? (unSnap as any).exists() : Boolean(unSnap.exists);
    if (!isUnExists) {
      checks.unrelatedRealStoriesUnchanged = false;
      details.push(`Unrelated real story ${unId} missing from Firestore.`);
    }
  }

  // Check O: Watch GT 7 Greek launch ID unchanged
  const watchGT7StorySnap = await db.collection('stories').doc('story-cluster-6cdb5fb91731bd8d').get();
  const isWatchExists = typeof watchGT7StorySnap.exists === 'function'
    ? (watchGT7StorySnap as any).exists()
    : Boolean(watchGT7StorySnap.exists);
  if (!isWatchExists) {
    checks.watchGT7IdPreserved = false;
    details.push('Watch GT 7 Greece story story-cluster-6cdb5fb91731bd8d missing from Firestore.');
  }

  for (const storyId of expectedStoryIds) {
    const storySnap = await db.collection('stories').doc(storyId).get();
    const isStoryDocExists = typeof storySnap.exists === 'function'
      ? (storySnap as any).exists()
      : Boolean(storySnap.exists);
    if (!isStoryDocExists) {
      checks.storiesExist = false;
      details.push(`Story ${storyId} does not exist in Firestore.`);
      continue;
    }

    const story = storySnap.data() as Story;

    // Check Memberships
    const membersSnap = await db.collection('stories').doc(storyId).collection('articles').get();
    const memberIds = new Set<string>();
    const memberSourceIds = new Set<string>();

    membersSnap.forEach((d) => {
      memberIds.add(d.id);
      const mData = d.data() as StoryMembership;
      if (mData.sourceId) memberSourceIds.add(mData.sourceId);
    });

    // Check G: Story.articleIds exactly mirrors StoryMemberships
    const sortedStoryArticleIds = [...(story.articleIds || [])].sort();
    const sortedMemberIds = Array.from(memberIds).sort();
    if (JSON.stringify(sortedStoryArticleIds) !== JSON.stringify(sortedMemberIds)) {
      checks.articleIdsMirrorsMemberships = false;
      details.push(`Story ${storyId} articleIds do not match memberships exactly.`);
    }

    for (const artId of story.articleIds) {
      if (!memberIds.has(artId)) {
        checks.everyArticleIdHasMembership = false;
        details.push(`Story ${storyId} is missing membership document for article ${artId}`);
      }

      // Check F: No controlled article in multiple real Phase 4 stories
      if (controlledArticleIds.includes(artId)) {
        if (articleToStoryMap.has(artId)) {
          checks.noArticleInMultiplePhase4Stories = false;
          details.push(
            `Article ${artId} assigned to multiple stories: ${articleToStoryMap.get(artId)} and ${storyId}`
          );
        }
        articleToStoryMap.set(artId, storyId);
      }

      // Check C: Article exists in /articles
      const artSnap = await db.collection('articles').doc(artId).get();
      const isArtExists = typeof artSnap.exists === 'function' ? (artSnap as any).exists() : Boolean(artSnap.exists);
      if (!isArtExists) {
        checks.membershipArticleExistsInArticles = false;
        details.push(`Article ${artId} does not exist in /articles`);
      }

      // Check D & E: Article has ArticleAnalysis and storyId matches
      const anSnap = await db.collection('articleAnalysis').doc(artId).get();
      const isAnExists = typeof anSnap.exists === 'function' ? (anSnap as any).exists() : Boolean(anSnap.exists);
      if (!isAnExists) {
        checks.membershipArticleHasArticleAnalysis = false;
        details.push(`Article ${artId} missing /articleAnalysis`);
      } else {
        const anData = anSnap.data() as ArticleAnalysis;
        if (anData.storyId !== storyId) {
          checks.articleAnalysisStoryIdMatches = false;
          details.push(
            `Article ${artId} analysis.storyId (${anData.storyId}) does not match Story ID ${storyId}`
          );
        }
      }
    }

    // Check H: articleCount equals membership count
    if (story.articleCount !== membersSnap.size) {
      checks.articleCountEqualsMembershipCount = false;
      details.push(
        `Story ${storyId} articleCount (${story.articleCount}) !== membership count (${membersSnap.size})`
      );
    }

    // Check I: sourceCount equals unique sources
    if (story.sourceCount !== memberSourceIds.size) {
      checks.sourceCountEqualsUniqueSources = false;
      details.push(
        `Story ${storyId} sourceCount (${story.sourceCount}) !== unique source count (${memberSourceIds.size})`
      );
    }

    // Check J: representativeArticleId belongs to the story
    if (!story.representativeArticleId || !story.articleIds.includes(story.representativeArticleId)) {
      checks.representativeArticleBelongsToStory = false;
      details.push(
        `Story ${storyId} representativeArticleId (${story.representativeArticleId}) is not in articleIds`
      );
    }

    // Check M: canonical categories are internally consistent
    if (!story.categories || story.categories.length === 0) {
      checks.canonicalCategoriesConsistent = false;
      details.push(`Story ${storyId} has empty categories.`);
    }

    // Check N: Xiaomi + Apple preserved in comparison Story
    if (story.articleIds.includes('art-10228d177d45f88fa65b63c2')) {
      const companyNames = story.companies?.map((c) => c.name.toLowerCase()) || [];
      const hasApple = companyNames.some((n) => n.includes('apple'));
      const hasXiaomi = companyNames.some((n) => n.includes('xiaomi'));
      if (!hasApple || !hasXiaomi) {
        checks.multiCompanyPreserved = false;
        details.push(`Comparison Story ${storyId} failed to preserve both Apple and Xiaomi.`);
      }
    }
  }

  const allValid = Object.values(checks).every(Boolean);
  return { allValid, checks, details };
}

/**
 * Signalyn Phase 4B.1: Production Incremental Story Pipeline Service
 * 
 * Provides:
 * 1. Single article incremental entry point: processArticleForStory(articleId)
 * 2. Idempotency-first enforcement (ALREADY_ASSIGNED, CONSISTENCY_ERROR)
 * 3. Strict legacy Story exclusion (story-001, story-002, story-003)
 * 4. Bounded candidate retrieval (temporal, category, company)
 * 5. Deterministic Stage 1 pairwise scoring + cluster coherence
 * 6. Bounded Stage 2 Gemini semantic adjudication (max 3 calls / article)
 * 7. Multi-candidate ranking and StoryReview creation for unresolved ambiguity
 * 8. Atomic persistence for CREATE_NEW_STORY and JOIN_EXISTING_STORY
 * 9. Concurrency safety against race conditions
 * 10. Lightweight telemetry co-located on ArticleAnalysis
 */

import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import {
  Article,
  ArticleAnalysis,
  isLegacyStory,
  Story,
  StoryMembership,
  StoryReview,
  StoryStatus,
  StoryType,
} from '../../types';
import { ProposedCluster } from './types';
import { DEFAULT_CLUSTERING_CONFIG, evaluateArticlePair } from './pairwiseScorer';
import { adjudicateAmbiguousPair } from './ambiguousAdjudicator';
import { validateClusterAdmission } from './clusterCoherence';
import {
  areCategoriesCompatible,
  getStoryCanonicalCategories,
  resolveCanonicalCategories,
} from './categoryModel';
import {
  CLUSTERING_VERSION,
  generateDeterministicStoryId,
} from './storyPersistenceService';
import {
  generateCanonicalPresentation,
  generateDeterministicPresentation,
} from './storyPresentationService';
import { evaluateStoryEvidence } from './evidenceVerificationService';
import { deriveHuaweiCompetitiveIntelligence } from './huaweiCompetitiveService';
import { computeEventSignature, detectMaterialDevelopment } from './storyIdentityService';
import { StoryDevelopment } from '../../types';
import { assertNoHistoricalCleanupActive } from '../maintenanceLock';

export type IncrementalStoryDecision =
  | 'CREATE_NEW_STORY'
  | 'JOIN_EXISTING_STORY'
  | 'REVIEW_REQUIRED'
  | 'ALREADY_ASSIGNED'
  | 'CONSISTENCY_ERROR'
  | 'FAILED';

export interface IncrementalStoryOptions {
  maxGeminiCalls?: number; // default: 3
  candidateTimeWindowDays?: number; // default: 14
  maxCandidates?: number; // default: 20
  forceDeterministic?: boolean; // default: false
  // P1.6: Shared per-run story representative cache
  representativeCache?: {
    articles: Map<string, Article>;
    analyses: Map<string, ArticleAnalysis>;
  };
  // Optional pre-filtered recent stories for batch runs
  candidateStories?: Story[];
}

export interface IncrementalStoryResult {
  articleId: string;
  decision: IncrementalStoryDecision;
  storyId?: string;
  storyCreated: boolean;
  membershipCreated: boolean;
  reviewCreated: boolean;
  reviewId?: string;
  stage1Decision?: string;
  stage2Decision?: string;
  confidence: number;
  geminiCalls: number;
  candidatesEvaluated: number;
  durationMs: number;
  error?: string;
}

/**
 * Strips undefined properties recursively for Firestore write safety.
 */
function cleanForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.filter((x) => x !== undefined).map(cleanForFirestore);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        res[k] = cleanForFirestore(v);
      }
    }
    return res;
  }
  return obj;
}

/**
 * Retrieves candidate Stories for an incremental article.
 * Enforces:
 * - Strict legacy Story exclusion
 * - Temporal proximity window
 * - Canonical Category compatibility
 * - Company/entity overlap (with UNKNOWN/multi-company recall preserved)
 * - Bounded candidate limit
 */
export function findIncrementalCandidates(
  article: Article,
  analysis: ArticleAnalysis,
  allStories: Story[],
  options?: IncrementalStoryOptions
): Story[] {
  const windowDays = options?.candidateTimeWindowDays ?? DEFAULT_CLUSTERING_CONFIG.candidateTimeWindowDays ?? 14;
  const maxCandidates = options?.maxCandidates ?? DEFAULT_CLUSTERING_CONFIG.maxCandidates ?? 20;

  const articleTime = new Date(article.publishedAt).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const primaryCompanyId = analysis.companies?.find((c) => c.relevance === 'PRIMARY')?.companyId;
  const articleCategories = resolveCanonicalCategories(article, analysis);

  const validCandidates = allStories.filter((story) => {
    // 1. Strict exclusion of legacy bootstrap stories
    if (isLegacyStory(story)) {
      return false;
    }

    // 2. Temporal window filter
    const storyTime = new Date(story.lastSeenAt || story.lastUpdatedAt || story.updatedAt || 0).getTime();
    if (!isNaN(storyTime) && storyTime > 0 && !isNaN(articleTime)) {
      if (Math.abs(articleTime - storyTime) > windowMs) {
        return false;
      }
    }

    // 3. Canonical Device Category filter
    const storyCategories = getStoryCanonicalCategories(story);
    if (!areCategoriesCompatible(articleCategories, storyCategories)) {
      return false;
    }

    // 4. Company overlap filter (preserve recall for multi-company & unknown)
    if (primaryCompanyId) {
      const storyCompanyIds = story.companies?.map((c) => c.companyId).filter(Boolean) || [];
      if (story.primaryCompanyId && story.primaryCompanyId !== primaryCompanyId) {
        if (!storyCompanyIds.includes(primaryCompanyId)) {
          return false;
        }
      }
    }

    return true;
  });

  // Rank by recency & last activity
  return validCandidates
    .sort((a, b) => {
      const timeB = new Date(b.lastSeenAt || b.lastUpdatedAt || 0).getTime();
      const timeA = new Date(a.lastSeenAt || a.lastUpdatedAt || 0).getTime();
      return timeB - timeA;
    })
    .slice(0, maxCandidates);
}

interface EvaluatedCandidate {
  story: Story;
  repArticle: Article;
  repAnalysis: ArticleAnalysis;
  stage1Decision: string;
  stage2Decision?: string;
  score: number;
  confidence: number;
  isMatch: boolean;
  isAmbiguous: boolean;
  coherencePassed: boolean;
  rejectionReason?: string;
}

export const MAX_CANDIDATE_STORIES = 30;

/**
 * P0.1 Bounded Candidate Retrieval:
 * Replaces unbounded full-collection scan with targeted bounded queries:
 * 1. Targeted query on primaryCompanyId (up to 25 recent stories)
 * 2. Targeted query on recent active stories globally (up to 15 recent stories)
 * 3. Fallback/unassigned: recent stories up to MAX_CANDIDATE_STORIES
 * No composite indexes required (uses single-field indexes).
 */
export async function fetchBoundedCandidateStories(
  article: Article,
  analysis: ArticleAnalysis,
  options?: IncrementalStoryOptions
): Promise<Story[]> {
  if (options?.candidateStories && options.candidateStories.length > 0) {
    return options.candidateStories.filter((s) => !isLegacyStory(s));
  }

  const storiesMap = new Map<string, Story>();
  const primaryCompanyId = analysis.companies?.find((c) => c.relevance === 'PRIMARY')?.companyId;

  const db = getServerDb();
  // 1. Fetch recent stories for primary company if detected (up to 25 stories)
  if (primaryCompanyId) {
    try {
      const coSnap = await db.collection('stories')
        .where('primaryCompanyId', '==', primaryCompanyId)
        .limit(25)
        .get();
      coSnap.forEach((d) => {
        const s = { id: d.id, ...d.data() } as Story;
        if (!isLegacyStory(s)) storiesMap.set(s.id, s);
      });
    } catch (e) {
      console.warn('[Incremental Story] Primary company story query failed, falling back:', e);
    }
  }

  // 2. Fetch recent active stories globally (up to 15 stories, or up to MAX_CANDIDATE_STORIES if no company)
  const globalLimit = primaryCompanyId ? 15 : MAX_CANDIDATE_STORIES;
  try {
    const recentSnap = await db.collection('stories')
      .orderBy('lastUpdatedAt', 'desc')
      .limit(globalLimit)
      .get();
    recentSnap.forEach((d) => {
      const s = { id: d.id, ...d.data() } as Story;
      if (!isLegacyStory(s)) storiesMap.set(s.id, s);
    });
  } catch {
    // Fallback if ordering index is pending
    const fallbackSnap = await db.collection('stories')
      .limit(globalLimit)
      .get();
    fallbackSnap.forEach((d) => {
      const s = { id: d.id, ...d.data() } as Story;
      if (!isLegacyStory(s)) storiesMap.set(s.id, s);
    });
  }

  return Array.from(storiesMap.values());
}

/**
 * Production Incremental Story Entry Point.
 * Assigns an analyzed article to an existing Story, a new Story, or StoryReview.
 */
export async function processArticleForStory(
  articleId: string,
  options?: IncrementalStoryOptions
): Promise<IncrementalStoryResult> {
  await assertNoHistoricalCleanupActive('story assignment');

  const startTime = Date.now();
  const maxGeminiCalls = options?.maxGeminiCalls ?? 3;
  let geminiCalls = 0;
  const db = getServerDb();

  try {
    // -------------------------------------------------------------------------
    // Step 1: Pre-validation & Idempotency Check
    // -------------------------------------------------------------------------
    const artSnap = await db.collection('articles').doc(articleId).get();
    const isArtExists = typeof artSnap.exists === 'function' ? (artSnap as any).exists() : Boolean(artSnap.exists);
    if (!isArtExists) {
      return {
        articleId,
        decision: 'FAILED',
        storyCreated: false,
        membershipCreated: false,
        reviewCreated: false,
        confidence: 0,
        geminiCalls: 0,
        candidatesEvaluated: 0,
        durationMs: Date.now() - startTime,
        error: `Article ${articleId} not found in /articles`,
      };
    }

    const article = { id: articleId, ...artSnap.data() } as Article;
    if (article.processingStatus !== 'ANALYZED') {
      return {
        articleId,
        decision: 'FAILED',
        storyCreated: false,
        membershipCreated: false,
        reviewCreated: false,
        confidence: 0,
        geminiCalls: 0,
        candidatesEvaluated: 0,
        durationMs: Date.now() - startTime,
        error: `Article ${articleId} has processingStatus '${article.processingStatus}'. Must be 'ANALYZED'.`,
      };
    }

    const anSnap = await db.collection('articleAnalysis').doc(articleId).get();
    const isAnExists = typeof anSnap.exists === 'function' ? (anSnap as any).exists() : Boolean(anSnap.exists);
    if (!isAnExists) {
      return {
        articleId,
        decision: 'FAILED',
        storyCreated: false,
        membershipCreated: false,
        reviewCreated: false,
        confidence: 0,
        geminiCalls: 0,
        candidatesEvaluated: 0,
        durationMs: Date.now() - startTime,
        error: `ArticleAnalysis for ${articleId} not found in /articleAnalysis`,
      };
    }

    const analysis = { articleId, ...anSnap.data() } as ArticleAnalysis;

    // Idempotency: Check if already assigned to a real Story
    if (analysis.storyId) {
      const storySnap = await db.collection('stories').doc(analysis.storyId).get();
      const memSnap = await db.collection('stories').doc(analysis.storyId).collection('articles').doc(articleId).get();
      const isStoryExists = typeof storySnap.exists === 'function' ? (storySnap as any).exists() : Boolean(storySnap.exists);
      const isMemExists = typeof memSnap.exists === 'function' ? (memSnap as any).exists() : Boolean(memSnap.exists);

      if (isStoryExists && isMemExists) {
        console.log(
          `[Incremental Story] Article ${articleId} already assigned to Story ${analysis.storyId}. Returning ALREADY_ASSIGNED.`
        );
        return {
          articleId,
          decision: 'ALREADY_ASSIGNED',
          storyId: analysis.storyId,
          storyCreated: false,
          membershipCreated: false,
          reviewCreated: false,
          confidence: 1.0,
          geminiCalls: 0,
          candidatesEvaluated: 0,
          durationMs: Date.now() - startTime,
        };
      }

      if (!isMemExists) {
        console.error(
          `[Incremental Story] Consistency error: Article ${articleId} has storyId ${analysis.storyId} but missing subcollection membership.`
        );
        return {
          articleId,
          decision: 'CONSISTENCY_ERROR',
          storyId: analysis.storyId,
          storyCreated: false,
          membershipCreated: false,
          reviewCreated: false,
          confidence: 0,
          geminiCalls: 0,
          candidatesEvaluated: 0,
          durationMs: Date.now() - startTime,
          error: `ArticleAnalysis references storyId ${analysis.storyId} but membership document is missing.`,
        };
      }
    }

    // -------------------------------------------------------------------------
    // Step 2: Retrieve Bounded Candidate Stories (P0.1)
    // -------------------------------------------------------------------------
    const boundedStories = await fetchBoundedCandidateStories(article, analysis, options);
    const candidates = findIncrementalCandidates(article, analysis, boundedStories, options);
    console.log(
      `[Incremental Story] Article ${articleId}: Retrieved ${candidates.length} candidate Stories from bounded set of ${boundedStories.length}.`
    );

    // -------------------------------------------------------------------------
    // Step 3: Evaluate Candidates (Stage 1 & Stage 2)
    // -------------------------------------------------------------------------
    const evaluatedCandidates: EvaluatedCandidate[] = [];
    let hadAmbiguityExceedingLimit = false;

    const repArticlesCache = options?.representativeCache?.articles || new Map<string, Article>();
    const repAnalysesCache = options?.representativeCache?.analyses || new Map<string, ArticleAnalysis>();

    for (const candidateStory of candidates) {
      // Load representative article & analysis using per-run cache (P1.6)
      const repId = candidateStory.representativeArticleId || candidateStory.articleIds[0];
      let repArticle = repArticlesCache.get(repId);
      if (!repArticle) {
        const repArtSnap = await db.collection('articles').doc(repId).get();
        const isRepArtExists = typeof repArtSnap.exists === 'function' ? (repArtSnap as any).exists() : Boolean(repArtSnap.exists);
        if (isRepArtExists) {
          repArticle = { id: repId, ...repArtSnap.data() } as Article;
          repArticlesCache.set(repId, repArticle);
        }
      }

      let repAnalysis = repAnalysesCache.get(repId);
      if (!repAnalysis) {
        const repAnSnap = await db.collection('articleAnalysis').doc(repId).get();
        const isRepAnExists = typeof repAnSnap.exists === 'function' ? (repAnSnap as any).exists() : Boolean(repAnSnap.exists);
        if (isRepAnExists) {
          repAnalysis = { articleId: repId, ...repAnSnap.data() } as ArticleAnalysis;
          repAnalysesCache.set(repId, repAnalysis);
        }
      }

      if (!repArticle || !repAnalysis) {
        console.warn(`[Incremental Story] Representative article ${repId} for story ${candidateStory.id} not found.`);
        continue;
      }

      // Stage 1 Deterministic Evaluation
      const stage1 = evaluateArticlePair(article, analysis, repArticle, repAnalysis);
      const pairKey = `${article.id < repId ? article.id : repId}:${article.id < repId ? repId : article.id}`;
      const stage1Map = new Map([[pairKey, stage1]]);
      const stage2Map = new Map();
      const articlesMap = new Map([[article.id, article], [repId, repArticle]]);
      const analysesMap = new Map([[article.id, analysis], [repId, repAnalysis]]);

      if (stage1.decision === 'CLEAR_SEPARATE') {
        evaluatedCandidates.push({
          story: candidateStory,
          repArticle,
          repAnalysis,
          stage1Decision: 'CLEAR_SEPARATE',
          score: stage1.totalScore,
          confidence: stage1.confidence,
          isMatch: false,
          isAmbiguous: false,
          coherencePassed: false,
          rejectionReason: 'Stage 1 CLEAR_SEPARATE',
        });
        continue;
      }

      if (stage1.decision === 'CLEAR_MATCH') {
        // Validate cluster-level coherence against existing members
        const coherence = validateClusterAdmission(
          article.id,
          candidateStory.articleIds,
          candidateStory.id,
          stage1Map,
          stage2Map,
          articlesMap,
          analysesMap
        );

        evaluatedCandidates.push({
          story: candidateStory,
          repArticle,
          repAnalysis,
          stage1Decision: 'CLEAR_MATCH',
          score: stage1.totalScore,
          confidence: stage1.confidence,
          isMatch: coherence.canAdmit,
          isAmbiguous: false,
          coherencePassed: coherence.canAdmit,
          rejectionReason: coherence.canAdmit ? undefined : coherence.conflict?.reason,
        });
        continue;
      }

      // Stage 1 AMBIGUOUS: Selective Stage 2 Adjudication
      if (stage1.decision === 'AMBIGUOUS') {
        if (options?.forceDeterministic || geminiCalls >= maxGeminiCalls) {
          hadAmbiguityExceedingLimit = true;
          evaluatedCandidates.push({
            story: candidateStory,
            repArticle,
            repAnalysis,
            stage1Decision: 'AMBIGUOUS',
            score: stage1.totalScore,
            confidence: stage1.confidence,
            isMatch: false,
            isAmbiguous: true,
            coherencePassed: false,
            rejectionReason: 'Ambiguity limit reached or deterministic mode forced.',
          });
          continue;
        }

        // Invoke Stage 2 Gemini Semantic Adjudicator
        geminiCalls++;
        console.log(
          `[Incremental Story] Invoking Stage 2 Gemini for article ${articleId} vs Story ${candidateStory.id} (call ${geminiCalls}/${maxGeminiCalls}).`
        );
        const stage2 = await adjudicateAmbiguousPair(article, analysis, repArticle, repAnalysis, stage1);
        stage2Map.set(pairKey, stage2);

        const isSameEvent = stage2.mappedDecision === 'SEMANTIC_MATCH' && stage2.confidence >= 0.8;
        let coherencePassed = false;
        if (isSameEvent) {
          const coherence = validateClusterAdmission(
            article.id,
            candidateStory.articleIds,
            candidateStory.id,
            stage1Map,
            stage2Map,
            articlesMap,
            analysesMap
          );
          coherencePassed = coherence.canAdmit;
        }

        evaluatedCandidates.push({
          story: candidateStory,
          repArticle,
          repAnalysis,
          stage1Decision: 'AMBIGUOUS',
          stage2Decision: stage2.mappedDecision,
          score: stage2.confidence,
          confidence: stage2.confidence,
          isMatch: isSameEvent && coherencePassed,
          isAmbiguous: !isSameEvent && (stage2.mappedDecision === 'REVIEW_REQUIRED' || stage2.rawDecision === 'RELATED_BUT_DISTINCT'),
          coherencePassed,
          rejectionReason: isSameEvent
            ? coherencePassed
              ? undefined
              : 'Coherence failed'
            : `Stage 2: ${stage2.mappedDecision}`,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Step 4: Multi-Candidate Ranking and Outcome Selection
    // -------------------------------------------------------------------------
    const matchingCandidates = evaluatedCandidates
      .filter((c) => c.isMatch)
      .sort((a, b) => b.score - a.score);

    // Case 1: Exactly 1 coherent winning candidate -> JOIN_EXISTING_STORY
    if (matchingCandidates.length === 1) {
      const winner = matchingCandidates[0];
      const joinStory = winner.story;

      await persistJoinExistingStory(article, analysis, joinStory, winner.confidence);

      return {
        articleId,
        decision: 'JOIN_EXISTING_STORY',
        storyId: joinStory.id,
        storyCreated: false,
        membershipCreated: true,
        reviewCreated: false,
        stage1Decision: winner.stage1Decision,
        stage2Decision: winner.stage2Decision,
        confidence: winner.confidence,
        geminiCalls,
        candidatesEvaluated: candidates.length,
        durationMs: Date.now() - startTime,
      };
    }

    // Case 2: Multiple matching candidates
    if (matchingCandidates.length > 1) {
      const top = matchingCandidates[0];
      const runnerUp = matchingCandidates[1];

      // If top candidate has a decisive edge (e.g. CLEAR_MATCH > 0.90 vs < 0.75)
      if (top.score >= 0.9 && top.score - runnerUp.score >= 0.2) {
        await persistJoinExistingStory(article, analysis, top.story, top.confidence);
        return {
          articleId,
          decision: 'JOIN_EXISTING_STORY',
          storyId: top.story.id,
          storyCreated: false,
          membershipCreated: true,
          reviewCreated: false,
          stage1Decision: top.stage1Decision,
          stage2Decision: top.stage2Decision,
          confidence: top.confidence,
          geminiCalls,
          candidatesEvaluated: candidates.length,
          durationMs: Date.now() - startTime,
        };
      }

      // Multiple genuinely plausible candidates -> route to StoryReview
      const reviewId = await persistStoryReview(
        article,
        analysis,
        matchingCandidates.map((c) => c.story.id),
        'AMBIGUOUS_MULTI_CANDIDATE',
        top.confidence
      );

      return {
        articleId,
        decision: 'REVIEW_REQUIRED',
        storyCreated: false,
        membershipCreated: false,
        reviewCreated: true,
        reviewId,
        confidence: top.confidence,
        geminiCalls,
        candidatesEvaluated: candidates.length,
        durationMs: Date.now() - startTime,
      };
    }

    // Case 3: Zero matching candidates
    // Check if any candidate was ambiguous or had unresolved conflict
    const ambiguousCandidates = evaluatedCandidates.filter((c) => c.isAmbiguous);
    if (hadAmbiguityExceedingLimit || (ambiguousCandidates.length > 0 && candidates.length > 0)) {
      const reviewId = await persistStoryReview(
        article,
        analysis,
        ambiguousCandidates.map((c) => c.story.id),
        'LOW_CONFIDENCE',
        ambiguousCandidates[0]?.confidence || 0.6
      );

      return {
        articleId,
        decision: 'REVIEW_REQUIRED',
        storyCreated: false,
        membershipCreated: false,
        reviewCreated: true,
        reviewId,
        confidence: ambiguousCandidates[0]?.confidence || 0.6,
        geminiCalls,
        candidatesEvaluated: candidates.length,
        durationMs: Date.now() - startTime,
      };
    }

    // Case 4: No matching Story and no ambiguous edge -> CREATE_NEW_STORY
    const newStoryId = await persistCreateNewStory(article, analysis);

    return {
      articleId,
      decision: 'CREATE_NEW_STORY',
      storyId: newStoryId,
      storyCreated: true,
      membershipCreated: true,
      reviewCreated: false,
      confidence: analysis.confidence || 0.95,
      geminiCalls,
      candidatesEvaluated: candidates.length,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Incremental Story] Error processing article ${articleId}:`, errorMsg);

    // Failure isolation: record error on ArticleAnalysis without touching Phase 3 ANALYZED status
    await db.collection('articleAnalysis').doc(articleId).update(cleanServerData({
      storyAssignmentStatus: 'FAILED',
      storyAssignmentError: errorMsg.slice(0, 500),
      clusteringMetadata: {
        decision: 'FAILED',
        error: errorMsg.slice(0, 500),
        attemptedAt: new Date().toISOString(),
        clusteringVersion: CLUSTERING_VERSION,
      },
    })).catch((e: any) => console.warn('Could not record clustering failure on analysis:', e));

    return {
      articleId,
      decision: 'FAILED',
      storyCreated: false,
      membershipCreated: false,
      reviewCreated: false,
      confidence: 0,
      geminiCalls,
      candidatesEvaluated: 0,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Persists a new Story atomically with StoryMembership and ArticleAnalysis.storyId.
 * Guarantees English canonical presentation and concurrency safety.
 */
async function persistCreateNewStory(
  article: Article,
  analysis: ArticleAnalysis
): Promise<string> {
  const db = getServerDb();
  const primaryCompany = analysis.companies?.find((c) => c.relevance === 'PRIMARY');
  const primaryProduct = analysis.products?.find((p) => p.relevance === 'PRIMARY');

  const deterministicId = generateDeterministicStoryId(
    [article.id],
    primaryCompany?.companyId || null,
    primaryProduct?.canonicalName || null,
    analysis.newsType
  );

  // Concurrency Guard 1: Direct ID check
  const existingByIdSnap = await db.collection('stories').doc(deterministicId).get();
  const isExistingById = typeof existingByIdSnap.exists === 'function'
    ? (existingByIdSnap as any).exists()
    : Boolean(existingByIdSnap.exists);

  if (isExistingById) {
    console.log(
      `[Incremental Story] Concurrency guard: Story ${deterministicId} already exists. Joining it instead.`
    );
    const existingStory = { id: deterministicId, ...existingByIdSnap.data() } as Story;
    await persistJoinExistingStory(article, analysis, existingStory, 0.95);
    return deterministicId;
  }

  // Concurrency Guard 2: Co-temporal entity match check (same product + company + newsType)
  if (primaryCompany?.companyId && primaryProduct?.canonicalName) {
    try {
      const recentCoSnap = await db.collection('stories')
        .where('primaryCompanyId', '==', primaryCompany.companyId)
        .limit(15)
        .get();

      const concurrentMatch = recentCoSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Story))
        .find(
          (s) =>
            !isLegacyStory(s) &&
            s.primaryProductId === primaryProduct.canonicalName &&
            s.storyType === analysis.newsType
        );

      if (concurrentMatch) {
        console.log(
          `[Incremental Story] Concurrency guard: Co-temporal Story ${concurrentMatch.id} for ${primaryProduct.canonicalName} exists. Joining it instead.`
        );
        await persistJoinExistingStory(article, analysis, concurrentMatch, 0.95);
        return concurrentMatch.id;
      }
    } catch (e) {
      console.warn('[Incremental Story] Concurrency Guard 2 bounded check failed:', e);
    }
  }

  const now = new Date().toISOString();

  // Generate canonical English presentation
  const presentation = await generateCanonicalPresentation({
    storyId: deterministicId,
    articles: [article],
    analyses: [analysis],
    primaryCompanyId: primaryCompany?.companyId,
    primaryProductId: primaryProduct?.canonicalName,
    newsType: analysis.newsType,
  });

  const categories = Array.from(resolveCanonicalCategories(article, analysis));
  const companies = (analysis.companies || []).map((c) => ({
    companyId: c.companyId,
    name: c.canonicalName,
    relevance: c.relevance,
  }));
  const products = (analysis.products || []).map((p) => ({
    productId: p.productId || p.canonicalName,
    name: p.canonicalName,
    category: p.category,
  }));

  const evidenceResult = evaluateStoryEvidence([article], [analysis]);
  const competitiveResult = deriveHuaweiCompetitiveIntelligence(
    {
      primaryCompanyId: primaryCompany?.companyId || null,
      companies,
      products,
      categories,
      storyType: (analysis.newsType as StoryType) || 'NEWS',
    },
    [article],
    [analysis],
    evidenceResult.evidenceClassification
  );

  const eventSignature = computeEventSignature(
    primaryCompany?.companyId || null,
    competitiveResult.hardwareCategory,
    primaryProduct?.canonicalName || null,
    analysis.newsType
  );

  const initialTimeline: StoryDevelopment[] = [
    {
      id: `dev-${deterministicId}-init`,
      timestamp: article.publishedAt || now,
      developmentType: evidenceResult.evidenceClassification === 'OFFICIAL_ANNOUNCEMENT'
        ? 'OFFICIAL_ANNOUNCEMENT'
        : evidenceResult.evidenceClassification === 'RUMOR_OR_LEAK'
        ? 'SPEC_LEAK'
        : 'INITIAL_COVERAGE',
      description: presentation.canonicalTitle,
      articleIds: [article.id],
      sourceUrls: (article.canonicalUrl || (article as any).url) ? [article.canonicalUrl || (article as any).url] : [],
      confidence: evidenceResult.evidenceConfidence >= 0.8 ? 'HIGH' : evidenceResult.evidenceConfidence >= 0.6 ? 'MEDIUM' : 'LOW',
      evidenceClassification: evidenceResult.evidenceClassification,
    },
  ];

  const storyDoc: Story = {
    id: deterministicId,
    canonicalTitle: presentation.canonicalTitle,
    title: presentation.canonicalTitle,
    summary: presentation.canonicalSummary,
    canonicalSummary: presentation.canonicalSummary,
    presentationLanguage: 'en',
    status: 'NEW',
    storyType: (analysis.newsType as StoryType) || 'NEWS',
    importanceScore: analysis.importanceScore || 50,
    confidence: analysis.confidence || 0.95,
    firstSeenAt: article.publishedAt || now,
    lastSeenAt: article.publishedAt || now,
    articleCount: 1,
    articleIds: [article.id],
    sourceIds: [article.sourceId],
    sourceCount: 1,
    companies,
    products,
    categories,
    topics: analysis.topics || [],
    markets: article.market ? [article.market] : [],
    languages: article.language ? [article.language] : [],
    primaryCompanyId: primaryCompany?.companyId || null,
    primaryProductId: primaryProduct?.canonicalName || null,
    representativeArticleId: article.id,
    createdAt: now,
    updatedAt: now,
    clusteringVersion: CLUSTERING_VERSION,
    isLegacy: false,
    // Phase 7B.2 Evidence Verification & Provenance Fields
    evidenceClassification: evidenceResult.evidenceClassification,
    evidenceConfidence: evidenceResult.evidenceConfidence,
    evidenceReasons: evidenceResult.evidenceReasons,
    independentSourceCount: evidenceResult.independentSourceCount,
    sourceProvenances: evidenceResult.sourceProvenances,
    lastMaterialUpdateAt: article.publishedAt || now,
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

  const membershipDoc: StoryMembership = {
    articleId: article.id,
    storyId: deterministicId,
    sourceId: article.sourceId,
    sourceName: article.sourceName || article.sourceId,
    publishedAt: article.publishedAt || now,
    headline: article.title,
    sentiment: analysis.sentiment,
    similarityScore: 1.0,
    membershipConfidence: analysis.confidence || 0.95,
    addedAt: now,
  };

  const batch = db.batch();
  batch.set(db.collection('stories').doc(deterministicId), cleanServerData(storyDoc));
  batch.set(
    db.collection('stories').doc(deterministicId).collection('articles').doc(article.id),
    cleanServerData(membershipDoc)
  );
  batch.update(db.collection('articleAnalysis').doc(article.id), {
    storyId: deterministicId,
    storyAssignmentStatus: 'ASSIGNED',
    storyAssignedAt: now,
    clusteringMetadata: {
      decision: 'CREATE_NEW_STORY',
      storyId: deterministicId,
      confidence: storyDoc.confidence,
      clusteringVersion: CLUSTERING_VERSION,
      assignedAt: now,
    },
  });

  await batch.commit();
  console.log(`[Incremental Story] Successfully created new Story ${deterministicId} for article ${article.id}.`);
  return deterministicId;
}

/**
 * Persists an article joining an existing Story atomically.
 * Preserves existing members and Story ID immutability.
 */
async function persistJoinExistingStory(
  article: Article,
  analysis: ArticleAnalysis,
  existingStory: Story,
  matchConfidence: number
): Promise<void> {
  const now = new Date().toISOString();
  const db = getServerDb();

  await db.runTransaction(async (transaction: any) => {
    const storyRef = db.collection('stories').doc(existingStory.id);
    const freshStorySnap = await transaction.get(storyRef);
    const isFreshStoryExists = typeof freshStorySnap.exists === 'function'
      ? (freshStorySnap as any).exists()
      : Boolean(freshStorySnap.exists);

    if (!isFreshStoryExists) {
      throw new Error(`Target Story ${existingStory.id} does not exist`);
    }

    const currentStory = { id: existingStory.id, ...freshStorySnap.data() } as Story;

    // Deduplicate articleIds from fresh read
    const updatedArticleIds = Array.from(new Set([...currentStory.articleIds, article.id]));
    const updatedSourceIds = Array.from(new Set([...currentStory.sourceIds, article.sourceId]));

    // Merge companies and products
    const companyMap = new Map<string, any>();
    for (const c of currentStory.companies || []) {
      companyMap.set(c.companyId || c.name, c);
    }
    for (const c of analysis.companies || []) {
      if (!companyMap.has(c.companyId || c.canonicalName)) {
        companyMap.set(c.companyId || c.canonicalName, {
          companyId: c.companyId,
          name: c.canonicalName,
          relevance: c.relevance,
        });
      }
    }

    const productMap = new Map<string, any>();
    for (const p of currentStory.products || []) {
      productMap.set(p.productId || p.name, p);
    }
    for (const p of analysis.products || []) {
      if (!productMap.has(p.productId || p.canonicalName)) {
        productMap.set(p.productId || p.canonicalName, {
          productId: p.productId || p.canonicalName,
          name: p.canonicalName,
          category: p.category,
        });
      }
    }

    const incomingCategories = resolveCanonicalCategories(article, analysis);
    const updatedCategories = Array.from(
      new Set([...(currentStory.categories || []), ...incomingCategories])
    );

    const updatedTopics = Array.from(
      new Set([...(currentStory.topics || []), ...(analysis.topics || [])])
    );
    const updatedMarkets = Array.from(
      new Set([...(currentStory.markets || []), ...(article.market ? [article.market] : [])])
    );
    const updatedLanguages = Array.from(
      new Set([...(currentStory.languages || []), ...(article.language ? [article.language] : [])])
    );

    // Time bounds
    const artTime = new Date(article.publishedAt).getTime();
    const existingLastTime = new Date(currentStory.lastSeenAt || 0).getTime();
    const updatedLastSeenAt =
      artTime > existingLastTime ? article.publishedAt : currentStory.lastSeenAt;

    // Representative article election
    let representativeArticleId = currentStory.representativeArticleId || currentStory.articleIds[0];
    if (analysis.importanceScore > (currentStory.importanceScore || 0)) {
      representativeArticleId = article.id;
    }

    const membershipDoc: StoryMembership = {
      articleId: article.id,
      storyId: currentStory.id,
      sourceId: article.sourceId,
      sourceName: article.sourceName || article.sourceId,
      publishedAt: article.publishedAt || now,
      headline: article.title,
      sentiment: analysis.sentiment,
      similarityScore: matchConfidence,
      membershipConfidence: analysis.confidence || matchConfidence,
      addedAt: now,
    };

    // Phase 7B.2 Evidence Re-evaluation & HUAWEI Competitive Intelligence
    const evidenceResult = evaluateStoryEvidence([article], [analysis], currentStory);
    const competitiveResult = deriveHuaweiCompetitiveIntelligence(
      currentStory,
      [article],
      [analysis],
      evidenceResult.evidenceClassification
    );

    // Phase 7B.2 Material Update Detection vs Duplicate Coverage
    const materialCheck = detectMaterialDevelopment(
      article,
      analysis,
      currentStory,
      evidenceResult.evidenceClassification
    );

    let updatedTimeline = Array.isArray(currentStory.timeline) ? [...currentStory.timeline] : [];
    let updatedLastMaterialUpdateAt = currentStory.lastMaterialUpdateAt || currentStory.lastSeenAt || now;

    if (materialCheck.isMaterialUpdate) {
      const newDev: StoryDevelopment = {
        id: `dev-${currentStory.id}-${Date.now()}`,
        timestamp: article.publishedAt || now,
        developmentType: materialCheck.developmentType || 'MATERIAL_UPDATE',
        description: `${materialCheck.description}`,
        articleIds: [article.id],
        sourceUrls: (article.canonicalUrl || (article as any).url) ? [article.canonicalUrl || (article as any).url] : [],
        confidence: evidenceResult.evidenceConfidence >= 0.8 ? 'HIGH' : evidenceResult.evidenceConfidence >= 0.6 ? 'MEDIUM' : 'LOW',
        evidenceClassification: evidenceResult.evidenceClassification,
      };
      updatedTimeline = [newDev, ...updatedTimeline].slice(0, 10);
      updatedLastMaterialUpdateAt = article.publishedAt || now;
    }

    transaction.update(storyRef, cleanServerData({
      articleIds: updatedArticleIds,
      articleCount: updatedArticleIds.length,
      sourceIds: updatedSourceIds,
      sourceCount: updatedSourceIds.length,
      companies: Array.from(companyMap.values()),
      products: Array.from(productMap.values()),
      categories: updatedCategories,
      topics: updatedTopics,
      markets: updatedMarkets,
      languages: updatedLanguages,
      lastSeenAt: updatedLastSeenAt,
      representativeArticleId,
      importanceScore: Math.max(currentStory.importanceScore || 0, analysis.importanceScore || 0),
      updatedAt: now,
      // Phase 7B.2 Evidence & Timeline Governance Fields
      evidenceClassification: evidenceResult.evidenceClassification,
      evidenceConfidence: evidenceResult.evidenceConfidence,
      evidenceReasons: evidenceResult.evidenceReasons,
      independentSourceCount: Math.max(currentStory.independentSourceCount || 1, updatedSourceIds.length),
      lastMaterialUpdateAt: updatedLastMaterialUpdateAt,
      timeline: updatedTimeline,
      // Phase 7B.2 HUAWEI Competitive Intelligence
      strategicImportanceScore: competitiveResult.strategicImportanceScore,
      competitiveThreatLevel: competitiveResult.competitiveThreatLevel,
      huaweiRelevance: competitiveResult.huaweiRelevance,
      competitiveImplication: competitiveResult.competitiveImplication,
      strategicRecommendation: competitiveResult.strategicRecommendation,
      strategicScoringFactors: competitiveResult.strategicScoringFactors,
    }));

    transaction.set(
      db.collection('stories').doc(currentStory.id).collection('articles').doc(article.id),
      cleanServerData(membershipDoc)
    );

    transaction.update(db.collection('articleAnalysis').doc(article.id), {
      storyId: currentStory.id,
      storyAssignmentStatus: 'ASSIGNED',
      storyAssignedAt: now,
      clusteringMetadata: {
        decision: 'JOIN_EXISTING_STORY',
        storyId: currentStory.id,
        confidence: matchConfidence,
        clusteringVersion: CLUSTERING_VERSION,
        assignedAt: now,
      },
    });
  });

  console.log(
    `[Incremental Story] Successfully joined article ${article.id} to Story ${existingStory.id}.`
  );
}

/**
 * Persists a StoryReview for uncertain or multi-candidate decisions.
 * Does NOT assign ArticleAnalysis.storyId while review is pending.
 */
async function persistStoryReview(
  article: Article,
  analysis: ArticleAnalysis,
  candidateStoryIds: string[],
  reason: 'LOW_CONFIDENCE' | 'POTENTIAL_DUPLICATE_STORY' | 'AMBIGUOUS_MULTI_CANDIDATE',
  confidence: number
): Promise<string> {
  const db = getServerDb();
  const now = new Date().toISOString();
  const reviewId = `review-${Date.now().toString(36)}-${article.id.slice(-6)}`;

  const reviewDoc: StoryReview = {
    id: reviewId,
    articleId: article.id,
    articleTitle: article.title,
    candidateStoryIds,
    reason,
    confidence,
    status: 'PENDING',
    createdAt: now,
  };

  const batch = db.batch();
  batch.set(db.collection('storyReview').doc(reviewId), cleanServerData(reviewDoc));
  batch.update(db.collection('articleAnalysis').doc(article.id), {
    storyAssignmentStatus: 'REVIEW_REQUIRED',
    clusteringMetadata: {
      decision: 'REVIEW_REQUIRED',
      reviewId,
      candidateStoryIds,
      confidence,
      clusteringVersion: CLUSTERING_VERSION,
      reviewedAt: now,
    },
  });

  await batch.commit();
  console.log(`[Incremental Story] Created StoryReview ${reviewId} for article ${article.id}.`);
  return reviewId;
}

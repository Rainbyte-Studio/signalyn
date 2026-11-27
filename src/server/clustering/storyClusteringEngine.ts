/**
 * Signalyn Phase 4A Deterministic Story Clustering Engine
 * 
 * Provides:
 * 1. Bounded candidate retrieval with legacy exclusion.
 * 2. Deterministic pairwise evaluation (PairwiseScorer).
 * 3. Dry-run execution mode with ZERO Firestore mutations and ZERO Gemini calls.
 */

import { Article, ArticleAnalysis, isLegacyStory, Story } from '../../types';
import {
  ClusteringDecision,
  ClusteringEngineConfig,
  DryRunResult,
  PairwiseMatchResult,
  ProposedCluster,
  SemanticAdjudicationResult,
  Stage2DryRunResult,
  StoryReviewProposal,
  TransitiveConflict,
} from './types';
import { DEFAULT_CLUSTERING_CONFIG, evaluateArticlePair } from './pairwiseScorer';
import { adjudicateAmbiguousPair } from './ambiguousAdjudicator';
import { makePairKey, validateClusterAdmission } from './clusterCoherence';
import {
  areCategoriesCompatible,
  getStoryCanonicalCategories,
  resolveCanonicalCategories,
} from './categoryModel';
import { generateDeterministicPresentation } from './storyPresentationService';

export interface PairPruningCheck {
  prune: boolean;
  reason?: string;
}

/**
 * Deterministically checks whether a pair of articles is eligible for full pairwise scoring.
 * Prunes pairs early if:
 * 1. Canonical categories are incompatible (preserves UNKNOWN and multi-category)
 * 2. Temporal distance exceeds 30-day clustering horizon
 * 3. Companies are completely disjoint (preserves multi-company comparisons)
 */
export function checkPairPruning(
  artA: Article,
  anA: ArticleAnalysis,
  artB: Article,
  anB: ArticleAnalysis
): PairPruningCheck {
  // 1. Incompatible canonical categories
  const catsA = resolveCanonicalCategories(artA, anA);
  const catsB = resolveCanonicalCategories(artB, anB);
  if (!areCategoriesCompatible(catsA, catsB)) {
    return {
      prune: true,
      reason: `Pruned before scoring: Incompatible categories ([${Array.from(catsA).join(',')}] vs [${Array.from(catsB).join(',')}])`,
    };
  }

  // 2. Temporal distance exceeds clustering horizon (> 30 days)
  const timeA = new Date(artA.publishedAt).getTime();
  const timeB = new Date(artB.publishedAt).getTime();
  if (!isNaN(timeA) && !isNaN(timeB)) {
    const diffDays = Math.abs(timeA - timeB) / (1000 * 60 * 60 * 24);
    if (diffDays > 30) {
      return {
        prune: true,
        reason: `Pruned before scoring: Temporal distance (${diffDays.toFixed(1)} days) exceeds 30-day clustering horizon`,
      };
    }
  }

  // 3. Disjoint company entities (preserves multi-company articles)
  const compsA = anA.companies?.map((c) => c.companyId || c.canonicalName.toLowerCase()) || [];
  const compsB = anB.companies?.map((c) => c.companyId || c.canonicalName.toLowerCase()) || [];
  if (compsA.length > 0 && compsB.length > 0) {
    const hasOverlap = compsA.some((ca) => compsB.includes(ca));
    if (!hasOverlap) {
      return {
        prune: true,
        reason: `Pruned before scoring: Disjoint company entities (${compsA.join(',')} vs ${compsB.join(',')})`,
      };
    }
  }

  return { prune: false };
}

function createPrunedPairwiseResult(
  artA: Article,
  artB: Article,
  reason: string
): PairwiseMatchResult {
  return {
    articleAId: artA.id,
    articleBId: artB.id,
    articleATitle: artA.title,
    articleBTitle: artB.title,
    scores: {
      temporalScore: 0,
      companyScore: 0,
      exactProductScore: 0,
      productFamilyScore: 0,
      newsTypeScore: 0,
      topicScore: 0,
      marketScore: 0,
      titleSimilarity: 0,
    },
    totalScore: 0,
    confidence: 1.0,
    decision: 'CLEAR_SEPARATE',
    explanation: reason,
  };
}

export class StoryClusteringEngine {
  private config: ClusteringEngineConfig;

  constructor(config?: Partial<ClusteringEngineConfig>) {
    this.config = { ...DEFAULT_CLUSTERING_CONFIG, ...config };
  }

  /**
   * Bounded Candidate Retrieval:
   * Constrains candidate Stories using deterministic filters:
   * - Excludes legacy/bootstrap Phase 1 stories (via isLegacyStory).
   * - Bounded by publication/event time proximity window (default: 7 days).
   * - Bounded by primary company overlap.
   * - Sorted and capped at maxCandidates (default: 20).
   */
  findCandidateStories(
    article: Article,
    analysis: ArticleAnalysis,
    allStories: Story[]
  ): Story[] {
    const articleTime = new Date(article.publishedAt).getTime();
    const windowMs = this.config.candidateTimeWindowDays * 24 * 60 * 60 * 1000;
    const primaryCompanyId = analysis.companies?.find((c) => c.relevance === 'PRIMARY')?.companyId;
    const articleCategories = resolveCanonicalCategories(article, analysis);

    const validCandidates = allStories.filter((story) => {
      // 1. Strict exclusion of legacy / mock bootstrap stories
      if (isLegacyStory(story)) {
        return false;
      }

      // 2. Temporal window filter
      const storyTime = new Date(story.lastSeenAt || story.lastUpdatedAt || story.updatedAt || 0).getTime();
      if (!isNaN(storyTime) && storyTime > 0) {
        if (Math.abs(articleTime - storyTime) > windowMs) {
          return false;
        }
      }

      // 3. Canonical Device Category filter (BEFORE consuming bounded maxCandidates slots)
      const storyCategories = getStoryCanonicalCategories(story);
      if (!areCategoriesCompatible(articleCategories, storyCategories)) {
        return false;
      }

      // 4. Company overlap filter
      if (primaryCompanyId) {
        const storyCompanyIds = story.companies?.map((c) => c.companyId) || [];
        if (story.primaryCompanyId && story.primaryCompanyId !== primaryCompanyId) {
          // If story has a primary company and it's different, check if secondary overlap exists
          if (!storyCompanyIds.includes(primaryCompanyId)) {
            return false;
          }
        }
      }

      return true;
    });

    // Score and rank candidates by recency & relevance
    return validCandidates
      .sort((a, b) => {
        const timeB = new Date(b.lastSeenAt || b.lastUpdatedAt || 0).getTime();
        const timeA = new Date(a.lastSeenAt || a.lastUpdatedAt || 0).getTime();
        return timeB - timeA;
      })
      .slice(0, this.config.maxCandidates);
  }

  /**
   * Evaluates a pair of articles deterministically.
   */
  evaluatePair(
    articleA: Article,
    analysisA: ArticleAnalysis,
    articleB: Article,
    analysisB: ArticleAnalysis
  ): PairwiseMatchResult {
    return evaluateArticlePair(articleA, analysisA, articleB, analysisB, this.config);
  }

  /**
   * Dry-Run Evaluation:
   * Evaluates deterministic grouping for an explicit set of articles.
   * Performs ZERO Firestore writes and ZERO Gemini API calls.
   */
  evaluateDryRun(
    articleIds: string[],
    articlesMap: Map<string, Article>,
    analysesMap: Map<string, ArticleAnalysis>
  ): DryRunResult {
    const pairwiseComparisons: PairwiseMatchResult[] = [];
    const ambiguousPairs: PairwiseMatchResult[] = [];
    let clearMatches = 0;
    let clearSeparates = 0;
    let ambiguousCount = 0;
    let pairsPruned = 0;
    let pairsScored = 0;

    const totalTheoreticalPairs = (articleIds.length * (articleIds.length - 1)) / 2;

    // 1. Compute all unique pairwise evaluations (N * (N - 1) / 2) with early pruning
    for (let i = 0; i < articleIds.length; i++) {
      for (let j = i + 1; j < articleIds.length; j++) {
        const idA = articleIds[i];
        const idB = articleIds[j];
        const artA = articlesMap.get(idA);
        const artB = articlesMap.get(idB);
        const anA = analysesMap.get(idA);
        const anB = analysesMap.get(idB);

        if (!artA || !anA || !artB || !anB) {
          continue;
        }

        // Evaluate pair pruning first
        const pruning = checkPairPruning(artA, anA, artB, anB);
        if (pruning.prune) {
          pairsPruned++;
          clearSeparates++;
          const matchResult = createPrunedPairwiseResult(artA, artB, pruning.reason!);
          pairwiseComparisons.push(matchResult);
          continue;
        }

        pairsScored++;
        const matchResult = this.evaluatePair(artA, anA, artB, anB);
        pairwiseComparisons.push(matchResult);

        if (matchResult.decision === 'CLEAR_MATCH') {
          clearMatches++;
        } else if (matchResult.decision === 'CLEAR_SEPARATE') {
          clearSeparates++;
        } else {
          ambiguousCount++;
          ambiguousPairs.push(matchResult);
        }
      }
    }

    // 2. Deterministic Graph Component Formation (Disjoint Set Union)
    // Only edges with CLEAR_MATCH connect articles into a single cluster.
    const parent = new Map<string, string>();
    for (const id of articleIds) {
      parent.set(id, id);
    }

    const find = (id: string): string => {
      if (parent.get(id) !== id) {
        parent.set(id, find(parent.get(id)!));
      }
      return parent.get(id)!;
    };

    const union = (idA: string, idB: string) => {
      const rootA = find(idA);
      const rootB = find(idB);
      if (rootA !== rootB) {
        parent.set(rootB, rootA);
      }
    };

    // Connect CLEAR_MATCH pairs
    for (const cmp of pairwiseComparisons) {
      if (cmp.decision === 'CLEAR_MATCH') {
        union(cmp.articleAId, cmp.articleBId);
      }
    }

    // Group articles by connected root
    const clusterGroups = new Map<string, string[]>();
    for (const id of articleIds) {
      const root = find(id);
      if (!clusterGroups.has(root)) {
        clusterGroups.set(root, []);
      }
      clusterGroups.get(root)!.push(id);
    }

    // 3. Synthesize Proposed Clusters
    const proposedClusters: ProposedCluster[] = [];
    let clusterIdx = 1;

    for (const [, memberIds] of clusterGroups.entries()) {
      const leadId = memberIds[0];
      const leadArt = articlesMap.get(leadId)!;
      const leadAn = analysesMap.get(leadId)!;

      const primaryCompany = leadAn.companies?.find((c) => c.relevance === 'PRIMARY')?.companyId || null;
      const primaryProduct = leadAn.products?.find((p) => p.relevance === 'PRIMARY')?.canonicalName || null;

      const englishPresentation = generateDeterministicPresentation({
        articles: memberIds.map((id) => articlesMap.get(id)!),
        analyses: memberIds.map((id) => analysesMap.get(id)!),
        primaryCompanyId: primaryCompany,
        primaryProductId: primaryProduct,
        newsType: leadAn.newsType,
      });

      proposedClusters.push({
        clusterId: `cluster-prop-${String(clusterIdx++).padStart(3, '0')}`,
        canonicalTitle: memberIds.length > 1
          ? `${leadAn.products?.[0]?.canonicalName || 'Product'} Coverage: Multi-Source Synthesized Story`
          : englishPresentation.canonicalTitle,
        primaryCompanyId: primaryCompany,
        primaryProductId: primaryProduct,
        newsType: leadAn.newsType,
        articleIds: memberIds,
        confidence: Number(
          (
            memberIds.reduce((sum, id) => sum + (analysesMap.get(id)?.confidence || 0.85), 0) /
            memberIds.length
          ).toFixed(2)
        ),
        reason: memberIds.length > 1
          ? `Consolidated ${memberIds.length} articles via deterministic CLEAR_MATCH graph connectivity.`
          : 'Isolated single-article cluster: Separated by incompatible event intent, editorial angle, or threshold.',
      });
    }

    return {
      evaluatedArticleIds: articleIds,
      pairwiseComparisons,
      proposedClusters,
      ambiguousPairs,
      summary: {
        totalArticles: articleIds.length,
        totalPairsEvaluated: pairwiseComparisons.length,
        totalTheoreticalPairs,
        pairsPruned,
        pairsScored,
        clearMatches,
        clearSeparates,
        ambiguousCount,
        clustersFormed: proposedClusters.length,
      },
    };
  }

  /**
   * Stage 2 Dry-Run Evaluation (Phase 4A.2):
   * 1. Runs deterministic Stage 1 pairwise evaluation.
   * 2. Bypasses Gemini for CLEAR_MATCH and CLEAR_SEPARATE pairs.
   * 3. For AMBIGUOUS pairs only, invokes semantic adjudicator (respecting call limit).
   * 4. Enforces cluster coherence rules (A MATCH B, B MATCH C, A SEPARATE C -> prevents transitive false merge).
   * 5. Produces in-memory StoryReviewProposal objects for REVIEW_REQUIRED outcomes.
   * 6. Zero Firestore writes.
   */
  async evaluateStage2DryRun(
    articleIds: string[],
    articlesMap: Map<string, Article>,
    analysesMap: Map<string, ArticleAnalysis>,
    options?: {
      maxGeminiCalls?: number;
      adjudicator?: (
        artA: Article,
        anA: ArticleAnalysis,
        artB: Article,
        anB: ArticleAnalysis,
        stage1: PairwiseMatchResult
      ) => Promise<SemanticAdjudicationResult>;
    }
  ): Promise<Stage2DryRunResult> {
    const maxCalls = options?.maxGeminiCalls ?? 2;
    const adjudicate = options?.adjudicator ?? adjudicateAmbiguousPair;

    // 1. Stage 1 Pairwise Comparisons with Early Pruning
    const stage1Comparisons: PairwiseMatchResult[] = [];
    const stage1Map = new Map<string, PairwiseMatchResult>();
    const ambiguousPairs: PairwiseMatchResult[] = [];
    let stage1Matches = 0;
    let stage1Separates = 0;
    let stage1Ambiguous = 0;
    let pairsPruned = 0;
    let pairsScored = 0;

    const totalTheoreticalPairs = (articleIds.length * (articleIds.length - 1)) / 2;

    for (let i = 0; i < articleIds.length; i++) {
      for (let j = i + 1; j < articleIds.length; j++) {
        const idA = articleIds[i];
        const idB = articleIds[j];
        const artA = articlesMap.get(idA);
        const artB = articlesMap.get(idB);
        const anA = analysesMap.get(idA);
        const anB = analysesMap.get(idB);

        if (!artA || !anA || !artB || !anB) continue;

        const pairKey = makePairKey(idA, idB);

        // Evaluate pair pruning first
        const pruning = checkPairPruning(artA, anA, artB, anB);
        if (pruning.prune) {
          pairsPruned++;
          stage1Separates++;
          const matchResult = createPrunedPairwiseResult(artA, artB, pruning.reason!);
          stage1Comparisons.push(matchResult);
          stage1Map.set(pairKey, matchResult);
          continue;
        }

        pairsScored++;
        const stage1Res = this.evaluatePair(artA, anA, artB, anB);
        stage1Comparisons.push(stage1Res);
        stage1Map.set(pairKey, stage1Res);

        if (stage1Res.decision === 'CLEAR_MATCH') {
          stage1Matches++;
        } else if (stage1Res.decision === 'CLEAR_SEPARATE') {
          stage1Separates++;
        } else {
          stage1Ambiguous++;
          ambiguousPairs.push(stage1Res);
        }
      }
    }

    // 2. Stage 2 Semantic Adjudication (ONLY for AMBIGUOUS pairs)
    const stage2Adjudications: SemanticAdjudicationResult[] = [];
    const stage2Map = new Map<string, SemanticAdjudicationResult>();
    const reviewProposals: StoryReviewProposal[] = [];
    let geminiCallsPerformed = 0;
    let stage2Matches = 0;
    let stage2Separates = 0;
    let stage2ReviewsRequired = 0;

    for (const ambPair of ambiguousPairs) {
      if (geminiCallsPerformed >= maxCalls) {
        console.warn(`[Clustering Stage 2] Gemini call limit (${maxCalls}) reached. Routing remaining ambiguous pair to REVIEW_REQUIRED.`);
        const fallbackAdjudication: SemanticAdjudicationResult = {
          articleAId: ambPair.articleAId,
          articleBId: ambPair.articleBId,
          rawDecision: 'UNCERTAIN',
          confidence: 0.5,
          mappedDecision: 'REVIEW_REQUIRED',
          rationale: `Gemini call limit (${maxCalls}) reached before adjudicating pair.`,
          sharedEventSignals: [],
          distinctEventSignals: [],
          modelUsed: 'none',
          durationMs: 0,
        };
        stage2Adjudications.push(fallbackAdjudication);
        stage2Map.set(makePairKey(ambPair.articleAId, ambPair.articleBId), fallbackAdjudication);
        stage2ReviewsRequired++;
        continue;
      }

      const artA = articlesMap.get(ambPair.articleAId)!;
      const anA = analysesMap.get(ambPair.articleAId)!;
      const artB = articlesMap.get(ambPair.articleBId)!;
      const anB = analysesMap.get(ambPair.articleBId)!;

      geminiCallsPerformed++;
      const adjRes = await adjudicate(artA, anA, artB, anB, ambPair);
      stage2Adjudications.push(adjRes);
      stage2Map.set(makePairKey(ambPair.articleAId, ambPair.articleBId), adjRes);

      if (adjRes.mappedDecision === 'SEMANTIC_MATCH') {
        stage2Matches++;
      } else if (adjRes.mappedDecision === 'SEMANTIC_SEPARATE') {
        stage2Separates++;
      } else {
        stage2ReviewsRequired++;
        // Construct in-memory StoryReview proposal
        reviewProposals.push({
          id: `rev-prop-${ambPair.articleAId.slice(-6)}-${ambPair.articleBId.slice(-6)}`,
          articleId: ambPair.articleBId,
          articleTitle: artB.title,
          candidateArticleIds: [ambPair.articleAId],
          reason: 'AMBIGUOUS_MULTI_CANDIDATE',
          confidence: adjRes.confidence,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          rationale: adjRes.rationale,
          evidence: {
            pairArticleId: ambPair.articleAId,
            pairArticleTitle: artA.title,
            sharedSignals: adjRes.sharedEventSignals,
            distinctSignals: adjRes.distinctEventSignals,
          },
          proposedResolutionOptions: ['ASSIGN_TO_STORY', 'CREATE_NEW_STORY', 'DISMISS'],
        });
      }
    }

    // 3. Cluster Formation with Coherence & Transitive Conflict Prevention
    const clusters: string[][] = [];
    const transitiveConflicts: TransitiveConflict[] = [];

    for (const artId of articleIds) {
      let admitted = false;

      // Try admitting to existing clusters where at least one member has a MATCH
      for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
        const clusterMembers = clusters[cIdx];
        const clusterId = `cluster-prop-${String(cIdx + 1).padStart(3, '0')}`;

        // Check if there is at least one MATCH edge with a member of this cluster
        const hasMatchWithCluster = clusterMembers.some((memberId) => {
          const key = makePairKey(artId, memberId);
          const s1 = stage1Map.get(key);
          const s2 = stage2Map.get(key);
          return (
            s1?.decision === 'CLEAR_MATCH' ||
            s2?.mappedDecision === 'SEMANTIC_MATCH'
          );
        });

        if (!hasMatchWithCluster) {
          continue;
        }

        // Validate cluster coherence against ALL members of the cluster
        const coherenceCheck = validateClusterAdmission(
          artId,
          clusterMembers,
          clusterId,
          stage1Map,
          stage2Map,
          articlesMap,
          analysesMap
        );

        if (coherenceCheck.canAdmit) {
          clusterMembers.push(artId);
          admitted = true;
          break;
        } else if (coherenceCheck.conflict) {
          transitiveConflicts.push(coherenceCheck.conflict);
        }
      }

      // If not admitted to any existing cluster, forms its own single-article cluster
      if (!admitted) {
        clusters.push([artId]);
      }
    }

    // 4. Synthesize Proposed Clusters
    const proposedClusters: ProposedCluster[] = [];
    let clusterIdx = 1;

    for (const memberIds of clusters) {
      const leadId = memberIds[0];
      const leadArt = articlesMap.get(leadId)!;
      const leadAn = analysesMap.get(leadId)!;

      const primaryCompany = leadAn.companies?.find((c) => c.relevance === 'PRIMARY')?.companyId || null;
      const primaryProduct = leadAn.products?.find((p) => p.relevance === 'PRIMARY')?.canonicalName || null;

      const englishPresentation = generateDeterministicPresentation({
        articles: memberIds.map((id) => articlesMap.get(id)!),
        analyses: memberIds.map((id) => analysesMap.get(id)!),
        primaryCompanyId: primaryCompany,
        primaryProductId: primaryProduct,
        newsType: leadAn.newsType,
      });

      proposedClusters.push({
        clusterId: `cluster-prop-${String(clusterIdx++).padStart(3, '0')}`,
        canonicalTitle: memberIds.length > 1
          ? `${leadAn.products?.[0]?.canonicalName || 'Product'} Coverage: Multi-Source Synthesized Story`
          : englishPresentation.canonicalTitle,
        primaryCompanyId: primaryCompany,
        primaryProductId: primaryProduct,
        newsType: leadAn.newsType,
        articleIds: memberIds,
        confidence: Number(
          (
            memberIds.reduce((sum, id) => sum + (analysesMap.get(id)?.confidence || 0.85), 0) /
            memberIds.length
          ).toFixed(2)
        ),
        reason: memberIds.length > 1
          ? `Consolidated ${memberIds.length} articles via coherent CLEAR_MATCH / SEMANTIC_MATCH edges.`
          : 'Isolated single-article cluster: Separated by event intent, editorial angle, or coherence check.',
      });
    }

    return {
      evaluatedArticleIds: articleIds,
      stage1Comparisons,
      stage2Adjudications,
      proposedClusters,
      reviewProposals,
      transitiveConflicts,
      summary: {
        totalArticles: articleIds.length,
        totalTheoreticalPairs,
        pairsPruned,
        pairsScored,
        stage1Matches,
        stage1Separates,
        stage1Ambiguous,
        geminiCallsPerformed,
        stage2Matches,
        stage2Separates,
        stage2ReviewsRequired,
        finalClustersCount: proposedClusters.length,
        reviewProposalsCount: reviewProposals.length,
        transitiveConflictsCount: transitiveConflicts.length,
      },
    };
  }
}

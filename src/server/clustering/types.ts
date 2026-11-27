/**
 * Signalyn Phase 4A Story Clustering Engine Types
 * Pure deterministic data structures for Story candidate retrieval,
 * pairwise scoring, and cluster formation.
 */

import { NewsType } from '../../types';

export type ClusteringDecision = 'CLEAR_MATCH' | 'CLEAR_SEPARATE' | 'AMBIGUOUS';

export interface PairwiseScoreComponents {
  temporalScore: number;       // 0.0 - 1.0: Publication time proximity
  companyScore: number;        // 0.0 - 1.0: Canonical company identity overlap
  exactProductScore: number;   // 0.0 - 1.0: Exact product name/variant identity
  productFamilyScore: number;  // 0.0 - 1.0: Product line / generation family overlap
  newsTypeScore: number;       // 0.0 - 1.0: Event intent compatibility
  topicScore: number;          // 0.0 - 1.0: Content topic vector overlap
  marketScore: number;         // 0.0 - 1.0: Geographic market alignment
  titleSimilarity: number;     // 0.0 - 1.0: Normalized title token similarity
  editorialPenalty?: number;   // Subtractive/multiplicative penalty for lifestyle vs tech mismatch
}

export interface PairwiseMatchResult {
  articleAId: string;
  articleBId: string;
  articleATitle: string;
  articleBTitle: string;
  scores: PairwiseScoreComponents;
  totalScore: number;          // 0.0 - 1.0
  confidence: number;          // 0.0 - 1.0
  decision: ClusteringDecision;
  explanation: string;
}

export interface ClusteringWeights {
  temporal: number;            // default: 0.15
  company: number;             // default: 0.15
  exactProduct: number;        // default: 0.20
  productFamily: number;       // default: 0.10
  newsType: number;            // default: 0.20
  topic: number;               // default: 0.08
  market: number;              // default: 0.04
  titleSimilarity: number;      // default: 0.08
}

export interface ClusteringThresholds {
  clearMatchThreshold: number;     // default: 0.78
  clearSeparateThreshold: number;  // default: 0.48
  // Between [clearSeparateThreshold, clearMatchThreshold) is AMBIGUOUS
}

export interface ClusteringEngineConfig {
  candidateTimeWindowDays: number; // default: 7 days
  maxCandidates: number;           // default: 20 candidates
  weights: ClusteringWeights;
  thresholds: ClusteringThresholds;
}

export interface ProposedCluster {
  clusterId: string;
  canonicalTitle: string;
  primaryCompanyId: string | null;
  primaryProductId: string | null;
  newsType: NewsType;
  articleIds: string[];
  confidence: number;
  reason: string;
}

export interface DryRunResult {
  evaluatedArticleIds: string[];
  pairwiseComparisons: PairwiseMatchResult[];
  proposedClusters: ProposedCluster[];
  ambiguousPairs: PairwiseMatchResult[];
  summary: {
    totalArticles: number;
    totalPairsEvaluated: number;
    totalTheoreticalPairs?: number;
    pairsPruned?: number;
    pairsScored?: number;
    clearMatches: number;
    clearSeparates: number;
    ambiguousCount: number;
    clustersFormed: number;
  };
}

// ==========================================
// Phase 4A.2: Stage 2 Semantic Adjudication Types
// ==========================================

export type SemanticDecision =
  | 'SAME_EVENT'
  | 'RELATED_BUT_DISTINCT'
  | 'DIFFERENT_EVENT'
  | 'UNCERTAIN';

export type MappedSemanticDecision =
  | 'SEMANTIC_MATCH'
  | 'SEMANTIC_SEPARATE'
  | 'REVIEW_REQUIRED';

export interface SemanticAdjudicationRaw {
  decision: SemanticDecision;
  confidence: number;
  rationale: string;
  sharedEventSignals: string[];
  distinctEventSignals: string[];
}

export interface SemanticAdjudicationResult {
  articleAId: string;
  articleBId: string;
  rawDecision: SemanticDecision;
  confidence: number;
  mappedDecision: MappedSemanticDecision;
  rationale: string;
  sharedEventSignals: string[];
  distinctEventSignals: string[];
  modelUsed: string;
  durationMs: number;
}

export interface StoryReviewProposal {
  id: string;
  articleId: string;
  articleTitle: string;
  candidateArticleIds?: string[];
  candidateStoryIds?: string[];
  suggestedStoryId?: string;
  reason: 'LOW_CONFIDENCE' | 'POTENTIAL_DUPLICATE_STORY' | 'AMBIGUOUS_MULTI_CANDIDATE';
  confidence: number;
  status: 'PENDING';
  createdAt: string;
  rationale: string;
  evidence?: {
    pairArticleId: string;
    pairArticleTitle: string;
    sharedSignals: string[];
    distinctSignals: string[];
  };
  proposedResolutionOptions: Array<'ASSIGN_TO_STORY' | 'CREATE_NEW_STORY' | 'MERGE_STORIES' | 'DISMISS'>;
}

export interface TransitiveConflict {
  clusterId: string;
  candidateArticleId: string;
  conflictWithArticleId: string;
  conflictType: 'CLEAR_SEPARATE' | 'SEMANTIC_SEPARATE' | 'INCOMPATIBLE_EVENT_INTENT';
  reason: string;
}

export interface Stage2DryRunResult {
  evaluatedArticleIds: string[];
  stage1Comparisons: PairwiseMatchResult[];
  stage2Adjudications: SemanticAdjudicationResult[];
  proposedClusters: ProposedCluster[];
  reviewProposals: StoryReviewProposal[];
  transitiveConflicts: TransitiveConflict[];
  summary: {
    totalArticles: number;
    totalTheoreticalPairs?: number;
    pairsPruned?: number;
    pairsScored?: number;
    stage1Matches: number;
    stage1Separates: number;
    stage1Ambiguous: number;
    geminiCallsPerformed: number;
    stage2Matches: number;
    stage2Separates: number;
    stage2ReviewsRequired: number;
    finalClustersCount: number;
    reviewProposalsCount: number;
    transitiveConflictsCount: number;
  };
}

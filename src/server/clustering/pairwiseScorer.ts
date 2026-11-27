/**
 * Deterministic Pairwise Scorer for Story Clustering (Phase 4A)
 * Computes component scores, weighted aggregate, and 3-way decision
 * (CLEAR_MATCH, CLEAR_SEPARATE, AMBIGUOUS).
 */

import { Article, ArticleAnalysis } from '../../types';
import {
  ClusteringDecision,
  ClusteringEngineConfig,
  PairwiseMatchResult,
  PairwiseScoreComponents,
} from './types';
import {
  calculateTokenJaccard,
  extractProductFamily,
  isLifestyleOrEditorial,
  normalizeText,
  tokenizeText,
} from './normalizer';

export const DEFAULT_CLUSTERING_CONFIG: ClusteringEngineConfig = {
  candidateTimeWindowDays: 7,
  maxCandidates: 20,
  weights: {
    temporal: 0.15,
    company: 0.15,
    exactProduct: 0.20,
    productFamily: 0.10,
    newsType: 0.20,
    topic: 0.08,
    market: 0.04,
    titleSimilarity: 0.08,
  },
  thresholds: {
    clearMatchThreshold: 0.78,
    clearSeparateThreshold: 0.48,
  },
};

/**
 * Computes temporal proximity score (0.0 - 1.0) based on publication date delta in days.
 */
export function scoreTemporalProximity(dateStrA: string, dateStrB: string): number {
  const timeA = new Date(dateStrA).getTime();
  const timeB = new Date(dateStrB).getTime();
  if (isNaN(timeA) || isNaN(timeB)) return 0.5;

  const diffMs = Math.abs(timeA - timeB);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= 1.0) return 1.0;
  if (diffDays <= 3.0) return 0.85;
  if (diffDays <= 7.0) return 0.65;
  if (diffDays <= 14.0) return 0.35;
  if (diffDays <= 30.0) return 0.10;
  return 0.0;
}

/**
 * Computes company overlap score (0.0 - 1.0).
 */
export function scoreCompanyOverlap(analysisA: ArticleAnalysis, analysisB: ArticleAnalysis): number {
  const primaryA = analysisA.companies?.find((c) => c.relevance === 'PRIMARY')?.companyId;
  const primaryB = analysisB.companies?.find((c) => c.relevance === 'PRIMARY')?.companyId;

  if (primaryA && primaryB && primaryA === primaryB) {
    return 1.0;
  }

  const allA = new Set(analysisA.companies?.map((c) => c.companyId) || []);
  const allB = new Set(analysisB.companies?.map((c) => c.companyId) || []);

  for (const id of allA) {
    if (allB.has(id)) return 0.5;
  }

  return 0.0;
}

/**
 * Computes exact product and product-family overlap scores.
 */
export function scoreProductOverlap(
  analysisA: ArticleAnalysis,
  analysisB: ArticleAnalysis
): { exactProductScore: number; productFamilyScore: number } {
  const prodsA = analysisA.products?.map((p) => p.canonicalName || p.matchedText) || [];
  const prodsB = analysisB.products?.map((p) => p.canonicalName || p.matchedText) || [];

  if (prodsA.length === 0 || prodsB.length === 0) {
    return { exactProductScore: 0.0, productFamilyScore: 0.0 };
  }

  let exactMatch = false;
  let familyMatch = false;
  let generationalLineMatch = false;

  const familiesA = prodsA.map(extractProductFamily);
  const familiesB = prodsB.map(extractProductFamily);

  for (const fa of familiesA) {
    for (const fb of familiesB) {
      if (fa.exact && fb.exact && fa.exact === fb.exact) {
        exactMatch = true;
      }
      if (fa.family && fb.family && fa.family === fb.family) {
        familyMatch = true;
      } else if (
        fa.family &&
        fb.family &&
        (fa.family.replace(/\d+/g, '').trim() === fb.family.replace(/\d+/g, '').trim())
      ) {
        generationalLineMatch = true;
      }
    }
  }

  const exactProductScore = exactMatch ? 1.0 : 0.0;
  let productFamilyScore = 0.0;

  if (exactMatch || familyMatch) {
    productFamilyScore = 1.0;
  } else if (generationalLineMatch) {
    productFamilyScore = 0.40;
  }

  return { exactProductScore, productFamilyScore };
}

/**
 * Computes newsType compatibility score (0.0 - 1.0).
 * Enforces semantic separation between different event intents (e.g. REVIEW vs LAUNCH).
 */
export function scoreNewsTypeCompatibility(
  articleA: Article,
  analysisA: ArticleAnalysis,
  articleB: Article,
  analysisB: ArticleAnalysis
): { newsTypeScore: number; reason: string } {
  const typeA = analysisA.newsType;
  const typeB = analysisB.newsType;

  const isLifestyleA = isLifestyleOrEditorial(articleA, analysisA);
  const isLifestyleB = isLifestyleOrEditorial(articleB, analysisB);

  // Case 1: Incompatible intents: REVIEW vs PRODUCT_LAUNCH
  if (
    (typeA === 'REVIEW' && typeB === 'PRODUCT_LAUNCH') ||
    (typeA === 'PRODUCT_LAUNCH' && typeB === 'REVIEW')
  ) {
    return {
      newsTypeScore: 0.15,
      reason: 'Incompatible event intents: Product launch announcement vs Device evaluation review',
    };
  }

  // Case 2: Both are REVIEWs
  if (typeA === 'REVIEW' && typeB === 'REVIEW') {
    if (isLifestyleA !== isLifestyleB) {
      return {
        newsTypeScore: 0.35,
        reason: 'Editorial divergence: Technical hardware evaluation vs Personal wellness/lifestyle narrative',
      };
    }
    return {
      newsTypeScore: 0.85,
      reason: 'Compatible event intent: Independent device evaluation reviews',
    };
  }

  // Case 3: Both are PRODUCT_LAUNCH
  if (typeA === 'PRODUCT_LAUNCH' && typeB === 'PRODUCT_LAUNCH') {
    return {
      newsTypeScore: 1.0,
      reason: 'Compatible event intent: Regional product launch / availability coverage',
    };
  }

  // Case 4: Other identical types
  if (typeA === typeB) {
    return {
      newsTypeScore: 0.75,
      reason: `Identical news classification: ${typeA}`,
    };
  }

  // Case 5: Disjoint / incompatible types
  return {
    newsTypeScore: 0.20,
    reason: `Disjoint news classifications: ${typeA} vs ${typeB}`,
  };
}

/**
 * Evaluates a pair of articles + analyses using the deterministic scoring model.
 */
export function evaluateArticlePair(
  articleA: Article,
  analysisA: ArticleAnalysis,
  articleB: Article,
  analysisB: ArticleAnalysis,
  customConfig?: Partial<ClusteringEngineConfig>
): PairwiseMatchResult {
  const config = { ...DEFAULT_CLUSTERING_CONFIG, ...customConfig };
  const weights = config.weights;
  const thresholds = config.thresholds;

  // 1. Component scores
  const temporalScore = scoreTemporalProximity(articleA.publishedAt, articleB.publishedAt);
  const companyScore = scoreCompanyOverlap(analysisA, analysisB);
  const { exactProductScore, productFamilyScore } = scoreProductOverlap(analysisA, analysisB);
  const { newsTypeScore, reason: newsTypeReason } = scoreNewsTypeCompatibility(
    articleA,
    analysisA,
    articleB,
    analysisB
  );

  // Topic overlap (Jaccard)
  const normTopicsA = (analysisA.topics || []).map(normalizeText);
  const normTopicsB = (analysisB.topics || []).map(normalizeText);
  const topicScore = calculateTokenJaccard(normTopicsA, normTopicsB);

  // Market alignment
  const marketA = normalizeText(articleA.market || analysisA.market || 'Global');
  const marketB = normalizeText(articleB.market || analysisB.market || 'Global');
  const marketScore =
    marketA === marketB || marketA === 'global' || marketB === 'global' ? 1.0 : 0.40;

  // Title token similarity
  const tokensA = tokenizeText(articleA.title);
  const tokensB = tokenizeText(articleB.title);
  const titleSimilarity = calculateTokenJaccard(tokensA, tokensB);

  const scores: PairwiseScoreComponents = {
    temporalScore,
    companyScore,
    exactProductScore,
    productFamilyScore,
    newsTypeScore,
    topicScore,
    marketScore,
    titleSimilarity,
  };

  // 2. Weighted total score
  const totalScore = Number(
    (
      scores.temporalScore * weights.temporal +
      scores.companyScore * weights.company +
      scores.exactProductScore * weights.exactProduct +
      scores.productFamilyScore * weights.productFamily +
      scores.newsTypeScore * weights.newsType +
      scores.topicScore * weights.topic +
      scores.marketScore * weights.market +
      scores.titleSimilarity * weights.titleSimilarity
    ).toFixed(4)
  );

  // 3. Deterministic Decision & Explanations with Hard Gates
  let decision: ClusteringDecision;
  let explanation = '';

  // Hard Gate 1: Completely disjoint companies
  if (companyScore === 0.0) {
    decision = 'CLEAR_SEPARATE';
    explanation = 'Hard Gate: Disjoint company entities cannot belong to the same product story.';
  }
  // Hard Gate 2: Distant publication dates (> 30 days)
  else if (temporalScore === 0.0) {
    decision = 'CLEAR_SEPARATE';
    explanation = 'Hard Gate: Publication dates are separated by more than 30 days.';
  }
  // Hard Gate 3: Disjoint product lines
  else if (exactProductScore === 0.0 && productFamilyScore === 0.0) {
    decision = 'CLEAR_SEPARATE';
    explanation = 'Hard Gate: No shared product or product family detected.';
  }
  // Hard Gate 4: Incompatible event types (e.g. REVIEW vs PRODUCT_LAUNCH)
  else if (newsTypeScore <= 0.20) {
    decision = 'CLEAR_SEPARATE';
    explanation = `Hard Gate: ${newsTypeReason}.`;
  }
  // Gate 5: Editorial Divergence (Technical Device Review vs Lifestyle / Wellbeing Narrative)
  else if (newsTypeScore === 0.35) {
    decision = 'AMBIGUOUS';
    explanation = `Ambiguous Editorial Divergence: ${newsTypeReason}. Technical evaluation and lifestyle/wellbeing coverage are preserved as ambiguous pending Stage 2 review.`;
  }
  // Threshold-based classification
  else if (totalScore >= thresholds.clearMatchThreshold) {
    decision = 'CLEAR_MATCH';
    explanation = `Score ${totalScore.toFixed(3)} >= threshold ${thresholds.clearMatchThreshold}. Strong multi-dimensional coherence (Company, Product, Event Intent).`;
  } else if (
    companyScore >= 0.80 &&
    productFamilyScore >= 0.50 &&
    newsTypeScore >= 0.60 &&
    temporalScore >= 0.65
  ) {
    decision = 'AMBIGUOUS';
    explanation = `Score ${totalScore.toFixed(3)} in ambiguous range. High entity alignment (Company, Product Family, Compatible Intent, Close Dates) requires Stage 2 semantic adjudication to distinguish single-event coverage from distinct events.`;
  } else if (totalScore < thresholds.clearSeparateThreshold) {
    decision = 'CLEAR_SEPARATE';
    explanation = `Score ${totalScore.toFixed(3)} < threshold ${thresholds.clearSeparateThreshold}. Insufficient correlation to form a single story.`;
  } else {
    decision = 'AMBIGUOUS';
    explanation = `Score ${totalScore.toFixed(3)} falls in ambiguous range [${thresholds.clearSeparateThreshold}, ${thresholds.clearMatchThreshold}). ${newsTypeReason}. Requires Stage 2 LLM adjudication or human review.`;
  }

  const confidence = Number(
    (
      (analysisA.confidence || 0.85) * 0.5 +
      (analysisB.confidence || 0.85) * 0.5
    ).toFixed(3)
  );

  return {
    articleAId: articleA.id,
    articleBId: articleB.id,
    articleATitle: articleA.title,
    articleBTitle: articleB.title,
    scores,
    totalScore,
    confidence,
    decision,
    explanation,
  };
}

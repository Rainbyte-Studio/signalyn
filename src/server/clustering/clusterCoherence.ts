/**
 * Cluster-Level Coherence Validator (Phase 4A.2)
 * 
 * Enforces cluster admission rules preventing transitive false merges:
 * A MATCH B, B MATCH C, A SEPARATE C -> C must NOT be admitted to {A, B}.
 */

import { Article, ArticleAnalysis } from '../../types';
import {
  PairwiseMatchResult,
  SemanticAdjudicationResult,
  TransitiveConflict,
} from './types';
import { extractProductFamily } from './normalizer';

export function makePairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

export interface ClusterCoherenceCheckResult {
  canAdmit: boolean;
  conflict?: TransitiveConflict;
}

/**
 * Validates whether candidateArticleId can safely be admitted into an existing cluster
 * containing clusterMembers, ensuring transitive coherence and event compatibility.
 */
export function validateClusterAdmission(
  candidateId: string,
  clusterMembers: string[],
  clusterId: string,
  stage1Map: Map<string, PairwiseMatchResult>,
  stage2Map: Map<string, SemanticAdjudicationResult>,
  articlesMap: Map<string, Article>,
  analysesMap: Map<string, ArticleAnalysis>
): ClusterCoherenceCheckResult {
  const candidateArt = articlesMap.get(candidateId);
  const candidateAn = analysesMap.get(candidateId);

  if (!candidateArt || !candidateAn) {
    return {
      canAdmit: false,
      conflict: {
        clusterId,
        candidateArticleId: candidateId,
        conflictWithArticleId: 'UNKNOWN',
        conflictType: 'CLEAR_SEPARATE',
        reason: `Candidate article ${candidateId} missing from provided articles map.`,
      },
    };
  }

  // Check relationship with EVERY existing member of the cluster
  for (const memberId of clusterMembers) {
    if (memberId === candidateId) continue;

    const pairKey = makePairKey(candidateId, memberId);
    const stage1Result = stage1Map.get(pairKey);
    const stage2Result = stage2Map.get(pairKey);
    const memberArt = articlesMap.get(memberId);
    const memberAn = analysesMap.get(memberId);

    // Rule A: Candidate must not have a CLEAR_SEPARATE relationship with any existing member
    if (stage1Result && stage1Result.decision === 'CLEAR_SEPARATE') {
      return {
        canAdmit: false,
        conflict: {
          clusterId,
          candidateArticleId: candidateId,
          conflictWithArticleId: memberId,
          conflictType: 'CLEAR_SEPARATE',
          reason: `Stage 1 hard separation with member ${memberId}: ${stage1Result.explanation}`,
        },
      };
    }

    // Rule B: Candidate must not have a SEMANTIC_SEPARATE relationship with any existing member
    if (stage2Result && stage2Result.mappedDecision === 'SEMANTIC_SEPARATE') {
      return {
        canAdmit: false,
        conflict: {
          clusterId,
          candidateArticleId: candidateId,
          conflictWithArticleId: memberId,
          conflictType: 'SEMANTIC_SEPARATE',
          reason: `Stage 2 semantic separation with member ${memberId}: ${stage2Result.rationale}`,
        },
      };
    }

    // Rule D: Incompatible event intent must block cluster admission
    if (memberAn) {
      if (
        (candidateAn.newsType === 'REVIEW' && memberAn.newsType === 'PRODUCT_LAUNCH') ||
        (candidateAn.newsType === 'PRODUCT_LAUNCH' && memberAn.newsType === 'REVIEW')
      ) {
        return {
          canAdmit: false,
          conflict: {
            clusterId,
            candidateArticleId: candidateId,
            conflictWithArticleId: memberId,
            conflictType: 'INCOMPATIBLE_EVENT_INTENT',
            reason: `Incompatible event intent between candidate (${candidateAn.newsType}) and member ${memberId} (${memberAn.newsType}).`,
          },
        };
      }
    }

    // Rule C: Exact product mismatch vs family (unless explicitly verified as SEMANTIC_MATCH by Stage 2)
    if (memberAn && stage2Result?.mappedDecision !== 'SEMANTIC_MATCH') {
      const candidateProds = (candidateAn.products || []).map((p) => p.canonicalName);
      const memberProds = (memberAn.products || []).map((p) => p.canonicalName);
      if (candidateProds.length > 0 && memberProds.length > 0) {
        const candidateFamilies = candidateProds.map(extractProductFamily);
        const memberFamilies = memberProds.map(extractProductFamily);

        const hasExactMatch = candidateFamilies.some((cf) =>
          memberFamilies.some((mf) => cf.exact === mf.exact)
        );
        const hasFamilyMatch = candidateFamilies.some((cf) =>
          memberFamilies.some((mf) => cf.family === mf.family)
        );

        // If in same family but different variants (e.g. Pro vs Base) and no exact match
        if (!hasExactMatch && hasFamilyMatch) {
          // If neither article is a series launch, keep separate
          if (
            candidateAn.newsType !== 'PRODUCT_LAUNCH' &&
            memberAn.newsType !== 'PRODUCT_LAUNCH'
          ) {
            return {
              canAdmit: false,
              conflict: {
                clusterId,
                candidateArticleId: candidateId,
                conflictWithArticleId: memberId,
                conflictType: 'CLEAR_SEPARATE',
                reason: `Product variant mismatch: candidate has ${candidateFamilies[0]?.variant} vs member has ${memberFamilies[0]?.variant}`,
              },
            };
          }
        }
      }
    }
  }

  return { canAdmit: true };
}

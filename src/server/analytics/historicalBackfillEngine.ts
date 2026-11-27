/**
 * Signalyn Historical Analytics Backfill Engine (Phase 5B)
 * 
 * Supports:
 * 1. DRY_RUN: Pure read-only simulation. Performs 0 writes and 0 Gemini calls.
 * 2. APPLY: Protected batch updater requiring explicit authorization parameter.
 *    (NOT EXECUTED IN PRODUCTION DURING PHASE 5B).
 */

import { getServerDb } from '../serverFirestoreAdapter';
import {
  Article,
  ArticleAnalysis,
  DailyAggregate,
  ArticleContributionLedger,
  UNDATED_DATE_KEY,
} from '../../types';
import {
  computeArticleContribution,
  createEmptyDailyAggregate,
  applyContributionDelta,
} from './historicalAggregationEngine';
import { recordArticleContributionInFirestore } from './firestoreAggregationAdapter';

export interface BackfillDryRunReport {
  mode: 'DRY_RUN';
  articlesExamined: number;
  validAnalysesCount: number;
  missingArticleReferences: string[];
  missingPublicationDatesCount: number;
  duplicateContributionCandidates: number;
  dailyBucketsAffected: {
    totalBuckets: number;
    dateRange: { oldest: string; newest: string };
    bucketDistribution: Record<string, number>;
  };
  expectedAggregateWrites: number;
  estimatedFirestoreReads: number;
  estimatedFirestoreWrites: number;
  generatedAt: string;
}

export interface BackfillApplyReport {
  mode: 'APPLY';
  authorized: boolean;
  articlesProcessed: number;
  successfulContributions: number;
  failedArticles: Array<{ articleId: string; error: string }>;
  dailyBucketsUpdated: number;
  totalFirestoreWrites: number;
  completedAt: string;
}

/**
 * Executes a read-only Dry Run audit across existing ArticleAnalysis records.
 * 
 * Guarantees:
 * - 0 Firestore writes
 * - 0 Gemini calls
 * - 0 Story mutations
 * - 0 EntityReview mutations
 */
export async function runHistoricalBackfillDryRun(
  options?: { maxArticles?: number; batchSize?: number }
): Promise<BackfillDryRunReport> {
  const maxArticles = options?.maxArticles || 500;
  const batchSize = Math.min(options?.batchSize || 50, 50);
  const db = getServerDb();

  let articlesExamined = 0;
  let validAnalysesCount = 0;
  const missingArticleReferences: string[] = [];
  let missingPublicationDatesCount = 0;
  const bucketCounts: Record<string, number> = {};
  const seenArticleIds = new Set<string>();
  let duplicateContributionCandidates = 0;

  let lastDoc: any = null;
  let hasMore = true;

  while (hasMore && articlesExamined < maxArticles) {
    const fetchLimit = Math.min(batchSize, maxArticles - articlesExamined);
    let q = db.collection('articleAnalysis').limit(fetchLimit);
    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snap = await q.get();
    if (snap.empty) {
      hasMore = false;
      break;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    hasMore = snap.docs.length >= fetchLimit;

    for (const docSnap of snap.docs) {
      articlesExamined++;
      const analysis = docSnap.data() as ArticleAnalysis;

      if (seenArticleIds.has(analysis.articleId)) {
        duplicateContributionCandidates++;
      } else {
        seenArticleIds.add(analysis.articleId);
      }

      // Check originating Article document for publication date provenance
      let publishedAt = analysis.publishedAt;
      if (!publishedAt) {
        const artSnap = await db.collection('articles').doc(analysis.articleId).get();
        if (artSnap.exists) {
          const article = artSnap.data() as Article;
          publishedAt = article.publishedAt;
        } else {
          missingArticleReferences.push(analysis.articleId);
        }
      }

      if (!publishedAt) {
        missingPublicationDatesCount++;
      }

      // Compute simulated contribution
      const contrib = computeArticleContribution(analysis, publishedAt);
      validAnalysesCount++;

      const bucketKey = contrib.dateKey;
      bucketCounts[bucketKey] = (bucketCounts[bucketKey] || 0) + 1;
    }
  }

  const datedKeys = Object.keys(bucketCounts)
    .filter((k) => k !== UNDATED_DATE_KEY)
    .sort();

  const oldest = datedKeys.length > 0 ? datedKeys[0] : 'N/A';
  const newest = datedKeys.length > 0 ? datedKeys[datedKeys.length - 1] : 'N/A';
  const totalBuckets = Object.keys(bucketCounts).length;

  // Expected Writes in APPLY mode:
  // 1 write per ledger document (validAnalysesCount) + 1 write per unique daily bucket (totalBuckets)
  const expectedAggregateWrites = totalBuckets;
  const estimatedFirestoreWrites = validAnalysesCount + totalBuckets;

  // Estimated Reads:
  // Reading analyses (articlesExamined) + reading article docs where publishedAt missing (missingArticleReferences.length + validAnalysesCount)
  const estimatedFirestoreReads = articlesExamined + validAnalysesCount;

  return {
    mode: 'DRY_RUN',
    articlesExamined,
    validAnalysesCount,
    missingArticleReferences,
    missingPublicationDatesCount,
    duplicateContributionCandidates,
    dailyBucketsAffected: {
      totalBuckets,
      dateRange: { oldest, newest },
      bucketDistribution: bucketCounts,
    },
    expectedAggregateWrites,
    estimatedFirestoreReads,
    estimatedFirestoreWrites,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Executes historical backfill APPLY mode.
 * 
 * CRITICAL SAFETY GUARD:
 * Requires explicit `{ authorized: true }`. Default is false.
 * Must NOT be run during Phase 5B.
 */
export async function runHistoricalBackfillApply(
  options: { authorized: boolean; maxArticles?: number; batchSize?: number }
): Promise<BackfillApplyReport> {
  if (options?.authorized !== true) {
    throw new Error(
      'Execution Denied: Historical Backfill APPLY mode requires explicit authorization. Phase 5B authorization is restricted to DRY_RUN.'
    );
  }

  const maxArticles = options?.maxArticles || 500;
  const batchSize = Math.min(options?.batchSize || 25, 25);
  const db = getServerDb();

  let articlesProcessed = 0;
  let successfulContributions = 0;
  const failedArticles: Array<{ articleId: string; error: string }> = [];
  const modifiedBuckets = new Set<string>();
  let totalFirestoreWrites = 0;

  let lastDoc: any = null;
  let hasMore = true;

  while (hasMore && articlesProcessed < maxArticles) {
    const fetchLimit = Math.min(batchSize, maxArticles - articlesProcessed);
    let q = db.collection('articleAnalysis').limit(fetchLimit);
    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snap = await q.get();
    if (snap.empty) {
      hasMore = false;
      break;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    hasMore = snap.docs.length >= fetchLimit;

    for (const docSnap of snap.docs) {
      articlesProcessed++;
      const analysis = docSnap.data() as ArticleAnalysis;

      try {
        let publishedAt = analysis.publishedAt;
        if (!publishedAt) {
          const artSnap = await db.collection('articles').doc(analysis.articleId).get();
          if (artSnap.exists) {
            publishedAt = (artSnap.data() as Article).publishedAt;
          }
        }

        const res = await recordArticleContributionInFirestore(analysis, publishedAt);
        successfulContributions++;
        modifiedBuckets.add(res.targetDateKey);
        if (res.sourceDateKey) modifiedBuckets.add(res.sourceDateKey);
        totalFirestoreWrites += res.writesPerformed;
      } catch (err: any) {
        failedArticles.push({
          articleId: analysis.articleId,
          error: err.message || String(err),
        });
      }
    }
  }

  return {
    mode: 'APPLY',
    authorized: true,
    articlesProcessed,
    successfulContributions,
    failedArticles,
    dailyBucketsUpdated: modifiedBuckets.size,
    totalFirestoreWrites,
    completedAt: new Date().toISOString(),
  };
}

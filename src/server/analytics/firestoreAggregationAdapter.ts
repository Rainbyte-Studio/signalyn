/**
 * Signalyn Firestore Aggregation Adapter (Phase 5B)
 * 
 * Manages atomic/transactional read and write operations for:
 * - /analyticsDaily/{dateKey} (Daily rollups)
 * - /analyticsLedger/{articleId} (Per-article contribution ledger)
 */

import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import {
  DailyAggregate,
  ArticleContributionLedger,
  ArticleAnalysis,
} from '../../types';
import {
  createEmptyDailyAggregate,
  planLedgerTransition,
  applyContributionDelta,
} from './historicalAggregationEngine';

export const DAILY_AGGREGATES_COLLECTION = 'analyticsDaily';
export const ARTICLE_LEDGER_COLLECTION = 'analyticsLedger';

function cleanFirestoreData<T extends Record<string, any>>(obj: T): any {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Reads a DailyAggregate document for a given dateKey.
 * Returns an initialized empty aggregate if not found.
 */
export async function getDailyAggregate(dateKey: string): Promise<DailyAggregate> {
  const db = getServerDb();
  const snap = await db.collection(DAILY_AGGREGATES_COLLECTION).doc(dateKey).get();
  if (!snap.exists) {
    return createEmptyDailyAggregate(dateKey);
  }
  return snap.data() as DailyAggregate;
}

/**
 * Reads the contribution ledger for a specific articleId.
 */
export async function getArticleLedger(
  articleId: string
): Promise<ArticleContributionLedger | null> {
  const db = getServerDb();
  const snap = await db.collection(ARTICLE_LEDGER_COLLECTION).doc(articleId).get();
  return snap.exists ? (snap.data() as ArticleContributionLedger) : null;
}

export interface ApplyContributionResult {
  articleId: string;
  action: 'NO_OP' | 'FIRST_TIME_INSERT' | 'RE_ANALYSIS_SAME_BUCKET' | 'RE_ANALYSIS_MOVED_BUCKET';
  targetDateKey: string;
  sourceDateKey?: string;
  writesPerformed: number;
}

/**
 * Atomically records or updates an article's aggregate contribution in Cloud Firestore.
 * 
 * Safety & Performance Guarantees:
 * - Idempotency: exact duplicate analyses return action: 'NO_OP' with 0 writes.
 * - Negative-count protection: all math operations bound counts at 0.
 * - Minimum Firestore operations: exactly 1 transaction covering ledger + aggregate(s).
 */
export async function recordArticleContributionInFirestore(
  analysis: ArticleAnalysis,
  originatingPublishedAt?: string | null
): Promise<ApplyContributionResult> {
  const db = getServerDb();
  const ledgerRef = db.collection(ARTICLE_LEDGER_COLLECTION).doc(analysis.articleId);

  // Read existing ledger first to check for instant NO_OP before starting transaction
  const existingLedgerSnap = await ledgerRef.get();
  const existingLedger = existingLedgerSnap.exists
    ? (existingLedgerSnap.data() as ArticleContributionLedger)
    : null;

  const plan = planLedgerTransition(analysis, existingLedger, originatingPublishedAt);

  if (plan.action === 'NO_OP') {
    return {
      articleId: analysis.articleId,
      action: 'NO_OP',
      targetDateKey: plan.targetDateKey,
      writesPerformed: 0,
    };
  }

  // Transactionally update ledger and target aggregate document(s)
  await db.runTransaction(async (transaction) => {
    // 1. If moved bucket, read both source and target aggregates
    if (plan.action === 'RE_ANALYSIS_MOVED_BUCKET' && plan.sourceDateKey) {
      const sourceRef = db.collection(DAILY_AGGREGATES_COLLECTION).doc(plan.sourceDateKey);
      const targetRef = db.collection(DAILY_AGGREGATES_COLLECTION).doc(plan.targetDateKey);

      const [sourceSnap, targetSnap] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(targetRef),
      ]);

      const sourceAgg = sourceSnap.exists
        ? (sourceSnap.data() as DailyAggregate)
        : createEmptyDailyAggregate(plan.sourceDateKey);
      const targetAgg = targetSnap.exists
        ? (targetSnap.data() as DailyAggregate)
        : createEmptyDailyAggregate(plan.targetDateKey);

      // Subtract old contribution from source aggregate
      const updatedSourceAgg = applyContributionDelta(
        sourceAgg,
        plan.existingContribution!,
        -1
      );
      // Add new contribution to target aggregate
      const updatedTargetAgg = applyContributionDelta(
        targetAgg,
        plan.newContribution,
        1
      );

      transaction.set(sourceRef, cleanServerData(updatedSourceAgg));
      transaction.set(targetRef, cleanServerData(updatedTargetAgg));
      transaction.set(ledgerRef, cleanServerData(plan.newContribution));
      return;
    }

    // 2. Otherwise, single aggregate modified (FIRST_TIME_INSERT or RE_ANALYSIS_SAME_BUCKET)
    const targetRef = db.collection(DAILY_AGGREGATES_COLLECTION).doc(plan.targetDateKey);
    const targetSnap = await transaction.get(targetRef);

    let agg = targetSnap.exists
      ? (targetSnap.data() as DailyAggregate)
      : createEmptyDailyAggregate(plan.targetDateKey);

    if (plan.action === 'RE_ANALYSIS_SAME_BUCKET' && plan.existingContribution) {
      // Subtract previous contribution
      agg = applyContributionDelta(agg, plan.existingContribution, -1);
    }

    // Apply new contribution
    agg = applyContributionDelta(agg, plan.newContribution, 1);

    transaction.set(targetRef, cleanServerData(agg));
    transaction.set(ledgerRef, cleanServerData(plan.newContribution));
  });

  const writesPerformed = plan.action === 'RE_ANALYSIS_MOVED_BUCKET' ? 3 : 2;

  return {
    articleId: analysis.articleId,
    action: plan.action,
    targetDateKey: plan.targetDateKey,
    sourceDateKey: plan.sourceDateKey,
    writesPerformed,
  };
}

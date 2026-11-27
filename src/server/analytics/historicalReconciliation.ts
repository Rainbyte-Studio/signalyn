/**
 * Signalyn Historical Aggregation Reconciliation Service (Phase 5B)
 * 
 * Verifies mathematical integrity between:
 * A. ArticleContributionLedger records (ground-truth leaf contributions)
 * B. DailyAggregate documents (/analyticsDaily/{dateKey})
 * 
 * Flags any deviation in volume, company mentions, category, or sentiment.
 */

import { DailyAggregate, ArticleContributionLedger } from '../../types';
import {
  createEmptyDailyAggregate,
  applyContributionDelta,
} from './historicalAggregationEngine';

export interface ReconciliationBucketResult {
  dateKey: string;
  isMatched: boolean;
  actualArticlesCount: number;
  expectedArticlesCount: number;
  actualTotalMentions: number;
  expectedTotalMentions: number;
  mismatches: string[];
}

export interface ReconciliationReport {
  status: 'RECONCILED' | 'MISMATCH';
  totalBucketsEvaluated: number;
  matchedBucketsCount: number;
  mismatchedBucketsCount: number;
  totalLedgersEvaluated: number;
  bucketResults: ReconciliationBucketResult[];
  errors: string[];
  reconciledAt: string;
}

/**
 * Reconciles stored DailyAggregate documents against ground-truth ArticleContributionLedgers.
 */
export function reconcileAggregates(
  actualAggregates: DailyAggregate[],
  ledgers: ArticleContributionLedger[]
): ReconciliationReport {
  // 1. Group ledgers by dateKey and construct expected aggregates from scratch
  const expectedMap = new Map<string, DailyAggregate>();
  const actualMap = new Map<string, DailyAggregate>();

  actualAggregates.forEach((agg) => actualMap.set(agg.dateKey, agg));

  ledgers.forEach((ledger) => {
    let exp = expectedMap.get(ledger.dateKey);
    if (!exp) {
      exp = createEmptyDailyAggregate(ledger.dateKey);
      expectedMap.set(ledger.dateKey, exp);
    }
    expectedMap.set(ledger.dateKey, applyContributionDelta(exp, ledger, 1));
  });

  // Collect all unique dateKeys across both actual and expected
  const allDateKeys = Array.from(new Set([...actualMap.keys(), ...expectedMap.keys()])).sort();

  const bucketResults: ReconciliationBucketResult[] = [];
  const errors: string[] = [];

  allDateKeys.forEach((dateKey) => {
    const actual = actualMap.get(dateKey) || createEmptyDailyAggregate(dateKey);
    const expected = expectedMap.get(dateKey) || createEmptyDailyAggregate(dateKey);

    const bucketMismatches: string[] = [];

    // Articles volume
    if (actual.articlesCount !== expected.articlesCount) {
      bucketMismatches.push(
        `articlesCount: actual ${actual.articlesCount} != expected ${expected.articlesCount}`
      );
    }

    if (actual.articlesWithTrackedCompaniesCount !== expected.articlesWithTrackedCompaniesCount) {
      bucketMismatches.push(
        `articlesWithTrackedCompaniesCount: actual ${actual.articlesWithTrackedCompaniesCount} != expected ${expected.articlesWithTrackedCompaniesCount}`
      );
    }

    // Company mentions
    const allCompanyKeys = Array.from(
      new Set([
        ...Object.keys(actual.companyMentions || {}),
        ...Object.keys(expected.companyMentions || {}),
      ])
    );

    allCompanyKeys.forEach((cid) => {
      const act = actual.companyMentions?.[cid] || 0;
      const exp = expected.companyMentions?.[cid] || 0;
      if (act !== exp) {
        bucketMismatches.push(`company[${cid}]: actual ${act} != expected ${exp}`);
      }
    });

    if (actual.totalCompanyMentions !== expected.totalCompanyMentions) {
      bucketMismatches.push(
        `totalCompanyMentions: actual ${actual.totalCompanyMentions} != expected ${expected.totalCompanyMentions}`
      );
    }

    // Category distribution
    ['SMARTPHONE', 'WEARABLE', 'AUDIO', 'TABLET', 'OTHER'].forEach((cat) => {
      const act = actual.categoryDistribution?.[cat] || 0;
      const exp = expected.categoryDistribution?.[cat] || 0;
      if (act !== exp) {
        bucketMismatches.push(`category[${cat}]: actual ${act} != expected ${exp}`);
      }
    });

    // Sentiment distribution
    (['positive', 'neutral', 'negative', 'mixed'] as const).forEach((sent) => {
      const act = actual.sentimentDistribution?.[sent] || 0;
      const exp = expected.sentimentDistribution?.[sent] || 0;
      if (act !== exp) {
        bucketMismatches.push(`sentiment[${sent}]: actual ${act} != expected ${exp}`);
      }
    });

    const isMatched = bucketMismatches.length === 0;
    bucketResults.push({
      dateKey,
      isMatched,
      actualArticlesCount: actual.articlesCount,
      expectedArticlesCount: expected.articlesCount,
      actualTotalMentions: actual.totalCompanyMentions,
      expectedTotalMentions: expected.totalCompanyMentions,
      mismatches: bucketMismatches,
    });

    if (!isMatched) {
      errors.push(`Bucket [${dateKey}] mismatch: ${bucketMismatches.join('; ')}`);
    }
  });

  const matchedBucketsCount = bucketResults.filter((b) => b.isMatched).length;
  const mismatchedBucketsCount = bucketResults.length - matchedBucketsCount;

  return {
    status: mismatchedBucketsCount === 0 ? 'RECONCILED' : 'MISMATCH',
    totalBucketsEvaluated: bucketResults.length,
    matchedBucketsCount,
    mismatchedBucketsCount,
    totalLedgersEvaluated: ledgers.length,
    bucketResults,
    errors,
    reconciledAt: new Date().toISOString(),
  };
}

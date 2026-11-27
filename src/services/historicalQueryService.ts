/**
 * Signalyn Historical Query Service (Phase 5B)
 * 
 * Provides bounded, high-performance historical queries for analytics and trends.
 * Reads directly from /analyticsDaily without loading raw leaf ArticleAnalysis documents.
 * 
 * Read Cost Guarantee:
 * - 7-day query: <= 7 reads
 * - 30-day query: <= 30 reads
 * - 90-day query: <= 90 reads
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  documentId,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  DailyAggregate,
  HistoricalQueryFilter,
  HistoricalQueryResult,
  HistoricalCompanyMetrics,
  HistoricalDailyPoint,
  AGGREGATION_VERSION,
  UNDATED_DATE_KEY,
} from '../types';
import {
  TRACKED_COMPANIES,
  TrackedCompanyConfig,
} from './competitiveAnalytics';

export const DAILY_AGGREGATES_COLLECTION = 'analyticsDaily';

/**
 * Generates an inclusive array of "YYYY-MM-DD" date strings between two UTC dates.
 */
export function generateDateRangeKeys(startDateStr: string, endDateStr: string): string[] {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [];
  }

  const keys: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cur <= endUtc) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    keys.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return keys;
}

/**
 * Helper to compute date range presets (7d, 30d, 90d, 180d, ytd, all) anchored to a reference date.
 */
export function getDateRangePreset(
  preset: '7d' | '30d' | '90d' | '180d' | 'ytd' | 'all',
  now = new Date()
): { startDate: string; endDate: string } {
  const endDate = now.toISOString().slice(0, 10);
  const start = new Date(now);

  switch (preset) {
    case '7d':
      start.setUTCDate(start.getUTCDate() - 6);
      break;
    case '30d':
      start.setUTCDate(start.getUTCDate() - 29);
      break;
    case '90d':
      start.setUTCDate(start.getUTCDate() - 89);
      break;
    case '180d':
      start.setUTCDate(start.getUTCDate() - 179);
      break;
    case 'ytd':
      start.setUTCMonth(0, 1);
      break;
    case 'all':
      return { startDate: '2025-01-01', endDate };
  }

  const startDate = start.toISOString().slice(0, 10);
  return { startDate, endDate };
}

/**
 * In-memory calculation of HistoricalQueryResult given an array of DailyAggregate documents.
 * Can be reused across frontend and test suites with zero network latency.
 */
export function aggregateDailyMetrics(
  aggregates: DailyAggregate[],
  filter: HistoricalQueryFilter,
  readCount = aggregates.length
): HistoricalQueryResult {
  const allDateKeys = generateDateRangeKeys(filter.startDate, filter.endDate);
  const aggregateMap = new Map<string, DailyAggregate>();
  aggregates.forEach((a) => aggregateMap.set(a.dateKey, a));

  const isCategoryFiltered = Boolean(filter.category && filter.category !== 'ALL_STRATEGIC');
  const targetCategory = isCategoryFiltered ? filter.category! : null;
  let categoryBreakdownAvailable = true;

  let totalArticlesAnalyzed = 0;
  let articlesWithTrackedCompanies = 0;
  let totalCompanyMentions = 0;
  let importanceSum = 0;
  let importanceCount = 0;

  const companyMentionTotals: Record<string, number> = {};
  const companySentimentTotals: Record<string, { positive: number; neutral: number; negative: number; mixed: number }> = {};
  const categoryDistribution: Record<string, number> = {
    SMARTPHONE: 0,
    WEARABLE: 0,
    AUDIO: 0,
    TABLET: 0,
    OTHER: 0,
  };
  const languageDistribution: Record<string, number> = {};
  const marketDistribution: Record<string, number> = {};
  const productMentions: Record<string, number> = {};
  const overallSentiment = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  const topicFrequencyMap = new Map<string, number>();

  TRACKED_COMPANIES.forEach((c) => {
    companyMentionTotals[c.id] = 0;
    companySentimentTotals[c.id] = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  });

  const dailyTimeSeries: HistoricalDailyPoint[] = [];
  let availableBucketDays = 0;

  allDateKeys.forEach((dateStr) => {
    const agg = aggregateMap.get(dateStr);
    if (agg) {
      availableBucketDays++;

      if (isCategoryFiltered && targetCategory) {
        // Category-Specific Filtering (Phase 5C.1)
        if (agg.byCategory) {
          const catMetrics = agg.byCategory[targetCategory];
          if (catMetrics) {
            totalArticlesAnalyzed += catMetrics.articlesCount;
            articlesWithTrackedCompanies += catMetrics.articlesWithTrackedCompaniesCount;
            totalCompanyMentions += catMetrics.totalCompanyMentions;
            importanceSum += catMetrics.importanceSum;
            importanceCount += catMetrics.importanceCount;

            categoryDistribution[targetCategory] =
              (categoryDistribution[targetCategory] || 0) + catMetrics.articlesCount;

            overallSentiment.positive += catMetrics.sentimentDistribution?.positive || 0;
            overallSentiment.neutral += catMetrics.sentimentDistribution?.neutral || 0;
            overallSentiment.negative += catMetrics.sentimentDistribution?.negative || 0;
            overallSentiment.mixed += catMetrics.sentimentDistribution?.mixed || 0;

            Object.entries(catMetrics.companyMentions || {}).forEach(([cid, count]) => {
              companyMentionTotals[cid] = (companyMentionTotals[cid] || 0) + count;
            });

            dailyTimeSeries.push({
              date: dateStr,
              articlesCount: catMetrics.articlesCount,
              articlesWithTrackedCompaniesCount: catMetrics.articlesWithTrackedCompaniesCount,
              companyMentions: { ...catMetrics.companyMentions },
              totalCompanyMentions: catMetrics.totalCompanyMentions,
              categoryDistribution: { [targetCategory]: catMetrics.articlesCount },
              sentimentDistribution: { ...catMetrics.sentimentDistribution },
              topTopics: [],
            });
          } else {
            // Migrated daily document, but 0 articles for this specific category on this day
            dailyTimeSeries.push({
              date: dateStr,
              articlesCount: 0,
              articlesWithTrackedCompaniesCount: 0,
              companyMentions: {},
              totalCompanyMentions: 0,
              categoryDistribution: { [targetCategory]: 0 },
              sentimentDistribution: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
              topTopics: [],
            });
          }
        } else {
          // Unmigrated daily document: multidimensional breakdown pending
          if ((agg.categoryDistribution?.[targetCategory] || 0) > 0) {
            categoryBreakdownAvailable = false;
          }
          const catCount = agg.categoryDistribution?.[targetCategory] || 0;
          totalArticlesAnalyzed += catCount;
          categoryDistribution[targetCategory] =
            (categoryDistribution[targetCategory] || 0) + catCount;

          dailyTimeSeries.push({
            date: dateStr,
            articlesCount: catCount,
            articlesWithTrackedCompaniesCount: 0,
            companyMentions: {},
            totalCompanyMentions: 0,
            categoryDistribution: { [targetCategory]: catCount },
            sentimentDistribution: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
            topTopics: [],
          });
        }
      } else {
        // Global / All Strategic Mode
        totalArticlesAnalyzed += agg.articlesCount;
        articlesWithTrackedCompanies += agg.articlesWithTrackedCompaniesCount;
        totalCompanyMentions += agg.totalCompanyMentions;
        importanceSum += agg.importanceSum;
        importanceCount += agg.importanceCount;

        // Category
        Object.entries(agg.categoryDistribution || {}).forEach(([cat, count]) => {
          categoryDistribution[cat] = (categoryDistribution[cat] || 0) + count;
        });

        // Overall Sentiment
        overallSentiment.positive += agg.sentimentDistribution?.positive || 0;
        overallSentiment.neutral += agg.sentimentDistribution?.neutral || 0;
        overallSentiment.negative += agg.sentimentDistribution?.negative || 0;
        overallSentiment.mixed += agg.sentimentDistribution?.mixed || 0;

        // Company mentions
        Object.entries(agg.companyMentions || {}).forEach(([cid, count]) => {
          companyMentionTotals[cid] = (companyMentionTotals[cid] || 0) + count;
        });

        // Topics
        Object.entries(agg.topicFrequencies || {}).forEach(([t, count]) => {
          topicFrequencyMap.set(t, (topicFrequencyMap.get(t) || 0) + count);
        });

        // Language distribution
        Object.entries(agg.languageDistribution || {}).forEach(([lang, count]) => {
          languageDistribution[lang] = (languageDistribution[lang] || 0) + count;
        });

        // Market distribution
        Object.entries(agg.marketDistribution || {}).forEach(([mkt, count]) => {
          marketDistribution[mkt] = (marketDistribution[mkt] || 0) + count;
        });

        // Product mentions
        Object.entries(agg.productMentions || {}).forEach(([prod, count]) => {
          productMentions[prod] = (productMentions[prod] || 0) + count;
        });

        // Add to time series
        dailyTimeSeries.push({
          date: dateStr,
          articlesCount: agg.articlesCount,
          articlesWithTrackedCompaniesCount: agg.articlesWithTrackedCompaniesCount,
          companyMentions: { ...agg.companyMentions },
          totalCompanyMentions: agg.totalCompanyMentions,
          categoryDistribution: { ...agg.categoryDistribution },
          sentimentDistribution: { ...agg.sentimentDistribution },
          topTopics: Object.entries(agg.topicFrequencies || {})
            .map(([topic, count]) => ({ topic, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3),
        });
      }
    } else {
      // Empty zero-point for missing day in coverage
      dailyTimeSeries.push({
        date: dateStr,
        articlesCount: 0,
        articlesWithTrackedCompaniesCount: 0,
        companyMentions: {},
        totalCompanyMentions: 0,
        categoryDistribution: {},
        sentimentDistribution: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
        topTopics: [],
      });
    }
  });

  // Include UNDATED bucket if explicitly requested
  if (filter.includeUndated && aggregateMap.has(UNDATED_DATE_KEY)) {
    const agg = aggregateMap.get(UNDATED_DATE_KEY)!;
    if (isCategoryFiltered && targetCategory) {
      if (agg.byCategory) {
        const catMetrics = agg.byCategory[targetCategory];
        if (catMetrics) {
          totalArticlesAnalyzed += catMetrics.articlesCount;
          articlesWithTrackedCompanies += catMetrics.articlesWithTrackedCompaniesCount;
          totalCompanyMentions += catMetrics.totalCompanyMentions;
          importanceSum += catMetrics.importanceSum;
          importanceCount += catMetrics.importanceCount;

          categoryDistribution[targetCategory] =
            (categoryDistribution[targetCategory] || 0) + catMetrics.articlesCount;

          overallSentiment.positive += catMetrics.sentimentDistribution?.positive || 0;
          overallSentiment.neutral += catMetrics.sentimentDistribution?.neutral || 0;
          overallSentiment.negative += catMetrics.sentimentDistribution?.negative || 0;
          overallSentiment.mixed += catMetrics.sentimentDistribution?.mixed || 0;

          Object.entries(catMetrics.companyMentions || {}).forEach(([cid, count]) => {
            companyMentionTotals[cid] = (companyMentionTotals[cid] || 0) + count;
          });
        }
      } else {
        if ((agg.categoryDistribution?.[targetCategory] || 0) > 0) {
          categoryBreakdownAvailable = false;
        }
        const catCount = agg.categoryDistribution?.[targetCategory] || 0;
        totalArticlesAnalyzed += catCount;
        categoryDistribution[targetCategory] =
          (categoryDistribution[targetCategory] || 0) + catCount;
      }
    } else {
      totalArticlesAnalyzed += agg.articlesCount;
      articlesWithTrackedCompanies += agg.articlesWithTrackedCompaniesCount;
      totalCompanyMentions += agg.totalCompanyMentions;
      importanceSum += agg.importanceSum;
      importanceCount += agg.importanceCount;

      Object.entries(agg.categoryDistribution || {}).forEach(([cat, count]) => {
        categoryDistribution[cat] = (categoryDistribution[cat] || 0) + count;
      });
      overallSentiment.positive += agg.sentimentDistribution?.positive || 0;
      overallSentiment.neutral += agg.sentimentDistribution?.neutral || 0;
      overallSentiment.negative += agg.sentimentDistribution?.negative || 0;
      overallSentiment.mixed += agg.sentimentDistribution?.mixed || 0;

      Object.entries(agg.companyMentions || {}).forEach(([cid, count]) => {
        companyMentionTotals[cid] = (companyMentionTotals[cid] || 0) + count;
      });
      Object.entries(agg.topicFrequencies || {}).forEach(([t, count]) => {
        topicFrequencyMap.set(t, (topicFrequencyMap.get(t) || 0) + count);
      });
    }
  }

  // Company Metrics & Share of Voice
  const companyMetrics: HistoricalCompanyMetrics[] = TRACKED_COMPANIES.map((config) => {
    const mentions = companyMentionTotals[config.id] || 0;
    const mentionsShareSov =
      totalCompanyMentions > 0
        ? Math.round((mentions / totalCompanyMentions) * 1000) / 10
        : 0;
    const coverageRatioSov =
      articlesWithTrackedCompanies > 0
        ? Math.round((mentions / articlesWithTrackedCompanies) * 1000) / 10
        : 0;

    return {
      companyId: config.id,
      companyName: config.name,
      isPrimary: config.isPrimary,
      color: config.color,
      mentions,
      mentionsShareSov,
      coverageRatioSov,
      sentiment: companySentimentTotals[config.id] || {
        positive: 0,
        neutral: 0,
        negative: 0,
        mixed: 0,
      },
    };
  });

  // Top Topics
  const topTopics = Array.from(topicFrequencyMap.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalDays = allDateKeys.length;
  const missingDays = Math.max(0, totalDays - availableBucketDays);
  const coverageStatus =
    availableBucketDays === 0
      ? 'EMPTY'
      : missingDays === 0
      ? 'COMPLETE'
      : 'PARTIAL';

  return {
    period: {
      startDate: filter.startDate,
      endDate: filter.endDate,
      totalDays,
      availableBucketDays,
      missingDays,
      coverageStatus,
    },
    metrics: {
      totalArticlesAnalyzed,
      articlesWithTrackedCompanies,
      totalCompanyMentions,
      averageImportance:
        importanceCount > 0 ? Math.round(importanceSum / importanceCount) : 0,
      companies: companyMetrics,
      categoryDistribution,
      overallSentiment,
      topTopics,
      languageDistribution,
      marketDistribution,
      productMentions,
      dailyTimeSeries,
    },
    metadata: {
      methodologyVersion: 'v1.mentionsShare + v2.coverageRatio',
      aggregationVersion: AGGREGATION_VERSION,
      queriedAt: new Date().toISOString(),
      readDocumentCount: readCount,
      categoryBreakdownAvailable: isCategoryFiltered ? categoryBreakdownAvailable : true,
      appliedCategoryFilter: filter.category || 'ALL_STRATEGIC',
    },
  };
}

// In-memory query cache with 60-second TTL
const historicalQueryCache = new Map<string, { result: HistoricalQueryResult; expiresAt: number }>();

export function clearHistoricalQueryCache(): void {
  historicalQueryCache.clear();
}

/**
 * Queries historical analytics across a bounded date range from Cloud Firestore.
 * Bounded read cost: reads only documents in the range [startDate, endDate].
 */
export async function queryHistoricalAnalytics(
  filter: HistoricalQueryFilter,
  options?: { bypassCache?: boolean }
): Promise<HistoricalQueryResult> {
  const cacheKey = `${filter.startDate}|${filter.endDate}|${filter.category || 'ALL_STRATEGIC'}|${filter.includeUndated ?? false}`;
  const now = Date.now();

  if (!options?.bypassCache && historicalQueryCache.has(cacheKey)) {
    const cached = historicalQueryCache.get(cacheKey)!;
    if (cached.expiresAt > now) {
      return cached.result;
    }
    historicalQueryCache.delete(cacheKey);
  }

  const colRef = collection(db, DAILY_AGGREGATES_COLLECTION);
  const dateKeys = generateDateRangeKeys(filter.startDate, filter.endDate);

  if (dateKeys.length === 0) {
    return aggregateDailyMetrics([], filter, 0);
  }

  // Use documentId range query for clean bounded range scan
  const q = query(
    colRef,
    where(documentId(), '>=', filter.startDate),
    where(documentId(), '<=', filter.endDate)
  );

  const snap = await getDocs(q);
  const aggregates: DailyAggregate[] = [];
  snap.forEach((d) => aggregates.push(d.data() as DailyAggregate));

  // If undated is requested, fetch UNDATED document explicitly (1 read)
  let extraReads = 0;
  if (filter.includeUndated) {
    const undatedSnap = await getDoc(doc(db, DAILY_AGGREGATES_COLLECTION, UNDATED_DATE_KEY));
    extraReads++;
    if (undatedSnap.exists()) {
      aggregates.push(undatedSnap.data() as DailyAggregate);
    }
  }

  const result = aggregateDailyMetrics(aggregates, filter, snap.size + extraReads);
  historicalQueryCache.set(cacheKey, { result, expiresAt: now + 60_000 });
  return result;
}

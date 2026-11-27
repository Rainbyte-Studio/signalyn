/**
 * Signalyn Historical Aggregation Engine (Phase 5B)
 * 
 * Implements deterministic, idempotent, zero-duplicate aggregation for historical analytics.
 * Manages /analyticsDaily/{YYYY-MM-DD} and /analyticsLedger/{articleId}.
 */

import {
  ArticleAnalysis,
  DailyAggregate,
  ArticleContributionLedger,
  CategoryAggregateMetrics,
  AGGREGATION_VERSION,
  UNDATED_DATE_KEY,
  SentimentType,
} from '../../types';
import {
  StrategicCategory,
  getArticleStrategicCategory,
  resolveTrackedCompanyId,
  TRACKED_COMPANIES,
} from '../../services/competitiveAnalytics';
import { normalizeTopic } from '../../services/trendAnalytics';
import crypto from 'crypto';

/**
 * Normalizes any published date string into a consistent UTC "YYYY-MM-DD" key.
 * If the date is missing, unparseable, or falls outside the reasonable window [2000-2100],
 * it is classified explicitly as UNDATED to prevent silent temporal pollution.
 */
export function normalizeUtcDateKey(publishedAt?: string | null): {
  dateKey: string;
  isReliable: boolean;
  originalPublishedAt: string | null;
} {
  if (!publishedAt || typeof publishedAt !== 'string' || !publishedAt.trim()) {
    return {
      dateKey: UNDATED_DATE_KEY,
      isReliable: false,
      originalPublishedAt: null,
    };
  }

  const parsed = new Date(publishedAt.trim());
  const timestamp = parsed.getTime();

  if (isNaN(timestamp)) {
    return {
      dateKey: UNDATED_DATE_KEY,
      isReliable: false,
      originalPublishedAt: publishedAt,
    };
  }

  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > 2100) {
    return {
      dateKey: UNDATED_DATE_KEY,
      isReliable: false,
      originalPublishedAt: publishedAt,
    };
  }

  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;

  return {
    dateKey,
    isReliable: true,
    originalPublishedAt: publishedAt,
  };
}

/**
 * Creates an empty CategoryAggregateMetrics record.
 */
export function createEmptyCategoryAggregateMetrics(): CategoryAggregateMetrics {
  const companyMentions: Record<string, number> = {};
  TRACKED_COMPANIES.forEach((c) => {
    companyMentions[c.id] = 0;
  });
  return {
    articlesCount: 0,
    articlesWithTrackedCompaniesCount: 0,
    totalCompanyMentions: 0,
    companyMentions,
    sentimentDistribution: {
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0,
    },
    competitiveSignalTypes: {},
    importanceSum: 0,
    importanceCount: 0,
  };
}

/**
 * Creates an empty, initialized DailyAggregate record for a given dateKey.
 */
export function createEmptyDailyAggregate(dateKey: string): DailyAggregate {
  const companyMentions: Record<string, number> = {};
  TRACKED_COMPANIES.forEach((c) => {
    companyMentions[c.id] = 0;
  });

  return {
    dateKey,
    articlesCount: 0,
    articlesWithTrackedCompaniesCount: 0,
    companyMentions,
    totalCompanyMentions: 0,
    productMentions: {},
    categoryDistribution: {
      SMARTPHONE: 0,
      WEARABLE: 0,
      AUDIO: 0,
      TABLET: 0,
      OTHER: 0,
    },
    sentimentDistribution: {
      positive: 0,
      neutral: 0,
      negative: 0,
      mixed: 0,
    },
    importanceSum: 0,
    importanceCount: 0,
    averageImportance: 0,
    topicFrequencies: {},
    competitiveSignalTypes: {},
    languageDistribution: {},
    marketDistribution: {},
    byCategory: {},
    lastUpdatedAt: new Date().toISOString(),
    aggregationVersion: AGGREGATION_VERSION,
  };
}

/**
 * Computes the discrete historical contribution of a single ArticleAnalysis.
 * Generates a deterministic hash for rapid idempotency checks.
 */
export function computeArticleContribution(
  analysis: ArticleAnalysis,
  originatingPublishedAt?: string | null
): ArticleContributionLedger {
  const effectivePublishedAt = analysis.publishedAt || originatingPublishedAt;
  const { dateKey, isReliable, originalPublishedAt } = normalizeUtcDateKey(effectivePublishedAt);

  // 1. Deduplicate credited companies per article (max 1 mention per company per article)
  const seenCompanies = new Set<string>();
  (analysis.companies || []).forEach((c) => {
    const trackedId = resolveTrackedCompanyId(c);
    if (trackedId) {
      seenCompanies.add(trackedId);
    } else if (c.companyId) {
      seenCompanies.add(c.companyId);
    }
  });
  const companiesCredited = Array.from(seenCompanies).sort();

  // 2. Deduplicate credited products
  const seenProducts = new Set<string>();
  (analysis.products || []).forEach((p) => {
    const prodKey = p.productId || p.canonicalName?.toLowerCase().trim();
    if (prodKey) {
      seenProducts.add(prodKey);
    }
  });
  const productsCredited = Array.from(seenProducts).sort();

  // 3. Strategic Category
  const strategicCategory = getArticleStrategicCategory(analysis) || 'OTHER';

  // 4. Sentiment
  const sentiment = (analysis.sentiment || 'NEUTRAL').toUpperCase() as SentimentType;

  // 5. Importance Score
  const importanceScore =
    typeof analysis.importanceScore === 'number'
      ? Math.min(Math.max(Math.round(analysis.importanceScore), 0), 100)
      : 50;

  // 6. Topics
  const topicsCredited = Array.from(
    new Set(
      (analysis.topics || [])
        .map((t) => normalizeTopic(t).canonicalKey)
        .filter((k) => Boolean(k) && k !== 'unknown')
    )
  ).sort();

  // 7. Competitive Signal Types
  const signalTypesCredited = Array.from(
    new Set(
      (analysis.competitiveSignals || [])
        .map((s) => s.type?.toUpperCase().trim())
        .filter(Boolean)
    )
  ).sort();

  const language = (analysis.language || 'el').toLowerCase().trim();
  const market = (analysis.market || 'Greece').trim();

  // Deterministic Fingerprint
  const rawFingerprint = JSON.stringify({
    articleId: analysis.articleId,
    dateKey,
    strategicCategory,
    companiesCredited,
    productsCredited,
    sentiment,
    importanceScore,
    topicsCredited,
    signalTypesCredited,
    language,
    market,
  });
  const contributionHash = crypto.createHash('sha256').update(rawFingerprint).digest('hex');

  return {
    articleId: analysis.articleId,
    dateKey,
    appliedAt: new Date().toISOString(),
    analysisVersion: analysis.analysisVersion || 'signalyn-analysis-v1',
    hasReliablePublishedAt: isReliable,
    originalPublishedAt,
    strategicCategory,
    companiesCredited,
    productsCredited,
    sentiment,
    importanceScore,
    topicsCredited,
    signalTypesCredited,
    language,
    market,
    contributionHash,
  };
}

/**
 * Applies a contribution delta (+1 to add, -1 to subtract) onto a DailyAggregate object.
 * Enforces non-negative integer bounds and re-calculates arithmetic averages.
 */
export function applyContributionDelta(
  aggregate: DailyAggregate,
  contribution: ArticleContributionLedger,
  multiplier: 1 | -1
): DailyAggregate {
  const result: DailyAggregate = {
    ...aggregate,
    companyMentions: { ...aggregate.companyMentions },
    productMentions: { ...aggregate.productMentions },
    categoryDistribution: { ...aggregate.categoryDistribution },
    sentimentDistribution: { ...aggregate.sentimentDistribution },
    topicFrequencies: { ...aggregate.topicFrequencies },
    competitiveSignalTypes: { ...aggregate.competitiveSignalTypes },
    languageDistribution: { ...aggregate.languageDistribution },
    marketDistribution: { ...aggregate.marketDistribution },
    lastUpdatedAt: new Date().toISOString(),
  };

  // 1. Articles volume
  result.articlesCount = Math.max(0, result.articlesCount + multiplier);

  // Tracked company article indicator
  if (contribution.companiesCredited.length > 0) {
    result.articlesWithTrackedCompaniesCount = Math.max(
      0,
      result.articlesWithTrackedCompaniesCount + multiplier
    );
  }

  // 2. Company mentions
  contribution.companiesCredited.forEach((cid) => {
    const cur = result.companyMentions[cid] || 0;
    const next = Math.max(0, cur + multiplier);
    result.companyMentions[cid] = next;
  });
  result.totalCompanyMentions = Math.max(
    0,
    result.totalCompanyMentions + multiplier * contribution.companiesCredited.length
  );

  // 3. Product mentions
  contribution.productsCredited.forEach((p) => {
    const cur = result.productMentions[p] || 0;
    const next = Math.max(0, cur + multiplier);
    if (next > 0) {
      result.productMentions[p] = next;
    } else {
      delete result.productMentions[p];
    }
  });

  // 4. Category distribution
  const cat = contribution.strategicCategory;
  const curCat = result.categoryDistribution[cat] || 0;
  result.categoryDistribution[cat] = Math.max(0, curCat + multiplier);

  // 5. Sentiment distribution
  const sentKey = contribution.sentiment.toLowerCase() as keyof DailyAggregate['sentimentDistribution'];
  if (result.sentimentDistribution[sentKey] !== undefined) {
    result.sentimentDistribution[sentKey] = Math.max(
      0,
      result.sentimentDistribution[sentKey] + multiplier
    );
  }

  // 6. Importance
  result.importanceSum = Math.max(
    0,
    result.importanceSum + multiplier * contribution.importanceScore
  );
  result.importanceCount = Math.max(0, result.importanceCount + multiplier);
  result.averageImportance =
    result.importanceCount > 0
      ? Math.round(result.importanceSum / result.importanceCount)
      : 0;

  // 7. Topics
  contribution.topicsCredited.forEach((topic) => {
    const cur = result.topicFrequencies[topic] || 0;
    const next = Math.max(0, cur + multiplier);
    if (next > 0) {
      result.topicFrequencies[topic] = next;
    } else {
      delete result.topicFrequencies[topic];
    }
  });

  // 8. Signals
  contribution.signalTypesCredited.forEach((sig) => {
    const cur = result.competitiveSignalTypes[sig] || 0;
    const next = Math.max(0, cur + multiplier);
    if (next > 0) {
      result.competitiveSignalTypes[sig] = next;
    } else {
      delete result.competitiveSignalTypes[sig];
    }
  });

  // 9. Language & Market
  if (contribution.language) {
    const curLang = result.languageDistribution[contribution.language] || 0;
    const nextLang = Math.max(0, curLang + multiplier);
    if (nextLang > 0) result.languageDistribution[contribution.language] = nextLang;
    else delete result.languageDistribution[contribution.language];
  }

  if (contribution.market) {
    const curMkt = result.marketDistribution[contribution.market] || 0;
    const nextMkt = Math.max(0, curMkt + multiplier);
    if (nextMkt > 0) result.marketDistribution[contribution.market] = nextMkt;
    else delete result.marketDistribution[contribution.market];
  }

  // 10. Multidimensional Category × Company Breakdown (Phase 5C.1)
  const categoryKey = contribution.strategicCategory;
  if (!result.byCategory) {
    result.byCategory = {};
  } else {
    result.byCategory = { ...result.byCategory };
  }

  const existingCatMetrics = result.byCategory[categoryKey] || createEmptyCategoryAggregateMetrics();
  const catMetrics: CategoryAggregateMetrics = {
    ...existingCatMetrics,
    companyMentions: { ...existingCatMetrics.companyMentions },
    sentimentDistribution: { ...existingCatMetrics.sentimentDistribution },
    competitiveSignalTypes: { ...existingCatMetrics.competitiveSignalTypes },
  };

  catMetrics.articlesCount = Math.max(0, catMetrics.articlesCount + multiplier);
  if (contribution.companiesCredited.length > 0) {
    catMetrics.articlesWithTrackedCompaniesCount = Math.max(
      0,
      catMetrics.articlesWithTrackedCompaniesCount + multiplier
    );
  }

  contribution.companiesCredited.forEach((cid) => {
    const cur = catMetrics.companyMentions[cid] || 0;
    const next = Math.max(0, cur + multiplier);
    catMetrics.companyMentions[cid] = next;
  });
  catMetrics.totalCompanyMentions = Math.max(
    0,
    catMetrics.totalCompanyMentions + multiplier * contribution.companiesCredited.length
  );

  if (catMetrics.sentimentDistribution[sentKey] !== undefined) {
    catMetrics.sentimentDistribution[sentKey] = Math.max(
      0,
      catMetrics.sentimentDistribution[sentKey] + multiplier
    );
  }

  catMetrics.importanceSum = Math.max(
    0,
    catMetrics.importanceSum + multiplier * contribution.importanceScore
  );
  catMetrics.importanceCount = Math.max(0, catMetrics.importanceCount + multiplier);

  contribution.signalTypesCredited.forEach((sig) => {
    const cur = catMetrics.competitiveSignalTypes[sig] || 0;
    const next = Math.max(0, cur + multiplier);
    if (next > 0) catMetrics.competitiveSignalTypes[sig] = next;
    else delete catMetrics.competitiveSignalTypes[sig];
  });

  result.byCategory[categoryKey] = catMetrics;

  return result;
}

/**
 * State Transition Decision for Idempotent Updates:
 * - NO_OP: identical contribution already recorded in ledger (0 mutations)
 * - FIRST_TIME_INSERT: ledger does not exist, add (+1) to target aggregate
 * - RE_ANALYSIS_SAME_BUCKET: ledger exists in same dateKey, update deltas (-1 old, +1 new)
 * - RE_ANALYSIS_MOVED_BUCKET: ledger exists in different dateKey, migrate (-1 old bucket, +1 new bucket)
 */
export type LedgerTransitionAction =
  | 'NO_OP'
  | 'FIRST_TIME_INSERT'
  | 'RE_ANALYSIS_SAME_BUCKET'
  | 'RE_ANALYSIS_MOVED_BUCKET';

export interface LedgerTransitionPlan {
  action: LedgerTransitionAction;
  newContribution: ArticleContributionLedger;
  existingContribution?: ArticleContributionLedger;
  targetDateKey: string;
  sourceDateKey?: string;
}

export function planLedgerTransition(
  analysis: ArticleAnalysis,
  existingLedger?: ArticleContributionLedger | null,
  originatingPublishedAt?: string | null
): LedgerTransitionPlan {
  const newContribution = computeArticleContribution(analysis, originatingPublishedAt);

  if (!existingLedger) {
    return {
      action: 'FIRST_TIME_INSERT',
      newContribution,
      targetDateKey: newContribution.dateKey,
    };
  }

  // Idempotency check: exact same content and date key
  if (existingLedger.contributionHash === newContribution.contributionHash) {
    return {
      action: 'NO_OP',
      newContribution,
      existingContribution: existingLedger,
      targetDateKey: newContribution.dateKey,
    };
  }

  // Publication date bucket changed
  if (existingLedger.dateKey !== newContribution.dateKey) {
    return {
      action: 'RE_ANALYSIS_MOVED_BUCKET',
      newContribution,
      existingContribution: existingLedger,
      targetDateKey: newContribution.dateKey,
      sourceDateKey: existingLedger.dateKey,
    };
  }

  // Same date bucket, but attributes changed (sentiment, category, companies, etc.)
  return {
    action: 'RE_ANALYSIS_SAME_BUCKET',
    newContribution,
    existingContribution: existingLedger,
    targetDateKey: newContribution.dateKey,
    sourceDateKey: existingLedger.dateKey,
  };
}

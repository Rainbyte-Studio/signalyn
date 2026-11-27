/**
 * Signalyn Phase 4C.4: Live Market Trends & Topic Velocity Service
 * 
 * Provides deterministic, real-time topic velocity, momentum classification,
 * and trend ranking derived from existing production ArticleAnalysis and Story data.
 * 
 * Quota-Safe / Zero Gemini / Purely Deterministic.
 */

import { ArticleAnalysis, Story, isProductionStory } from '../types';
import {
  StrategicCategory,
  getArticleStrategicCategory,
  resolveTrackedCompanyId,
  TRACKED_COMPANIES,
  TrackedCompanyConfig,
} from './competitiveAnalytics';

export type TrendMomentum = 'NEW' | 'RISING' | 'STABLE' | 'DECLINING';
export type TimeRangeFilter = '7d' | '30d' | 'all';
export type CategoryFilter = 'ALL_STRATEGIC' | 'SMARTPHONE' | 'WEARABLE' | 'AUDIO' | 'TABLET';

export interface NormalizedTopic {
  canonicalKey: string;
  displayName: string;
}

const TRACKED_COMPANY_MAP = new Map<string, TrackedCompanyConfig>();
TRACKED_COMPANIES.forEach((c) => TRACKED_COMPANY_MAP.set(c.id, c));

/**
 * Deterministic topic normalization dictionary and rules.
 * Normalizes punctuation, casing, plurals, and safe synonyms without Gemini or semantic drift.
 */
const CANONICAL_TOPIC_DICTIONARY: Record<string, NormalizedTopic> = {
  // Mobile devices & form factors
  smartphones: { canonicalKey: 'smartphones', displayName: 'Smartphones' },
  smartphone: { canonicalKey: 'smartphones', displayName: 'Smartphones' },
  phones: { canonicalKey: 'smartphones', displayName: 'Smartphones' },
  phone: { canonicalKey: 'smartphones', displayName: 'Smartphones' },
  foldables: { canonicalKey: 'foldables', displayName: 'Foldable Devices' },
  foldable: { canonicalKey: 'foldables', displayName: 'Foldable Devices' },
  'foldable phone': { canonicalKey: 'foldables', displayName: 'Foldable Devices' },
  'foldable phones': { canonicalKey: 'foldables', displayName: 'Foldable Devices' },
  'foldable smartphone': { canonicalKey: 'foldables', displayName: 'Foldable Devices' },
  'foldable smartphones': { canonicalKey: 'foldables', displayName: 'Foldable Devices' },

  // Wearables & Fitness
  wearables: { canonicalKey: 'wearables', displayName: 'Wearables' },
  wearable: { canonicalKey: 'wearables', displayName: 'Wearables' },
  smartwatch: { canonicalKey: 'wearables', displayName: 'Wearables' },
  smartwatches: { canonicalKey: 'wearables', displayName: 'Wearables' },

  // Tablets & Computing
  tablets: { canonicalKey: 'tablets', displayName: 'Tablets' },
  tablet: { canonicalKey: 'tablets', displayName: 'Tablets' },
  laptops: { canonicalKey: 'laptops', displayName: 'Laptops' },
  laptop: { canonicalKey: 'laptops', displayName: 'Laptops' },

  // Components & Hardware
  battery: { canonicalKey: 'battery', displayName: 'Battery & Charging' },
  batteries: { canonicalKey: 'battery', displayName: 'Battery & Charging' },
  charging: { canonicalKey: 'battery', displayName: 'Battery & Charging' },
  'battery & charging': { canonicalKey: 'battery', displayName: 'Battery & Charging' },
  'battery charging': { canonicalKey: 'battery', displayName: 'Battery & Charging' },
  display: { canonicalKey: 'display', displayName: 'Display & Screen' },
  displays: { canonicalKey: 'display', displayName: 'Display & Screen' },
  'display & screen': { canonicalKey: 'display', displayName: 'Display & Screen' },
  'display screen': { canonicalKey: 'display', displayName: 'Display & Screen' },
  camera: { canonicalKey: 'camera', displayName: 'Camera Systems' },
  cameras: { canonicalKey: 'camera', displayName: 'Camera Systems' },
  'camera systems': { canonicalKey: 'camera', displayName: 'Camera Systems' },
  chipsets: { canonicalKey: 'chipsets', displayName: 'Chipsets & Silicon' },
  chipset: { canonicalKey: 'chipsets', displayName: 'Chipsets & Silicon' },
  'chipsets & silicon': { canonicalKey: 'chipsets', displayName: 'Chipsets & Silicon' },
  processor: { canonicalKey: 'chipsets', displayName: 'Chipsets & Silicon' },
  processors: { canonicalKey: 'chipsets', displayName: 'Chipsets & Silicon' },
  design: { canonicalKey: 'design', displayName: 'Hardware Design' },
  'hardware design': { canonicalKey: 'design', displayName: 'Hardware Design' },
  health: { canonicalKey: 'health', displayName: 'Health Tracking' },
  'health tracking': { canonicalKey: 'health', displayName: 'Health Tracking' },
  fitness: { canonicalKey: 'fitness', displayName: 'Fitness & Sports' },
  'fitness & sports': { canonicalKey: 'fitness', displayName: 'Fitness & Sports' },

  // Commercial & Ecosystem
  pricing: { canonicalKey: 'pricing', displayName: 'Pricing & Value' },
  price: { canonicalKey: 'pricing', displayName: 'Pricing & Value' },
  'pricing & value': { canonicalKey: 'pricing', displayName: 'Pricing & Value' },
  audio: { canonicalKey: 'audio', displayName: 'Audio & Acoustics' },
  'audio & acoustics': { canonicalKey: 'audio', displayName: 'Audio & Acoustics' },
  software: { canonicalKey: 'software', displayName: 'Software & OS' },
  'software & os': { canonicalKey: 'software', displayName: 'Software & OS' },
  security: { canonicalKey: 'security', displayName: 'Security & Privacy' },
  'security & privacy': { canonicalKey: 'security', displayName: 'Security & Privacy' },
  ai: { canonicalKey: 'ai', displayName: 'On-Device AI' },
  'on-device ai': { canonicalKey: 'ai', displayName: 'On-Device AI' },
  'ondevice ai': { canonicalKey: 'ai', displayName: 'On-Device AI' },
  telecom: { canonicalKey: 'telecom', displayName: 'Telecom & Connectivity' },
  'telecom & connectivity': { canonicalKey: 'telecom', displayName: 'Telecom & Connectivity' },
};

/**
 * Normalizes a raw topic string into a clean canonical representation.
 */
export function normalizeTopic(rawTopic: string): NormalizedTopic {
  if (!rawTopic) return { canonicalKey: 'unknown', displayName: 'Unknown' };
  const trimmed = rawTopic.trim();
  const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

  if (CANONICAL_TOPIC_DICTIONARY[lower]) {
    return CANONICAL_TOPIC_DICTIONARY[lower];
  }

  // Also try with stripped punctuation
  const stripped = lower.replace(/[.,/#!$%^*;:{}=\-_`~()]/g, '').replace(/\s+/g, ' ');
  if (CANONICAL_TOPIC_DICTIONARY[stripped]) {
    return CANONICAL_TOPIC_DICTIONARY[stripped];
  }

  // Fallback: title case formatting
  const display = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return { canonicalKey: stripped, displayName: display };
}

export interface TrendingTopic {
  canonicalKey: string;
  topic: string;
  momentum: TrendMomentum;
  currentCount: number;
  previousCount: number;
  absoluteDelta: number;
  velocityPercent: number | null; // null if previousCount === 0 or timeRange === 'all'
  companies: { id: string; name: string; isPrimary: boolean; color: string }[];
  storyCount: number;
  averageImportance: number;
  categories: StrategicCategory[];
  latestSeenAt: string;
  representativeArticleId?: string;
  rankScore: number;
  isQualifying: boolean;
}

export interface TrendAnalyticsResult {
  trends: TrendingTopic[];
  topTrends: TrendingTopic[];
  currentWindowArticlesCount: number;
  previousWindowArticlesCount: number;
  filterStats: {
    timeRange: TimeRangeFilter;
    category: CategoryFilter;
    totalAvailableAnalyses: number;
    filteredAnalysesCount: number;
  };
}

/**
 * Calculates deterministic trend velocity, momentum status, and ranked topic trends.
 * 
 * Windows:
 * - 7 Days: current [now - 7d, now], comparison [now - 14d, now - 7d]
 * - 30 Days: current [now - 30d, now], comparison [now - 60d, now - 30d]
 * - All: current [0, now], comparison none (velocity is null)
 */
export function calculateTrendAnalytics(
  analyses: ArticleAnalysis[],
  stories: Story[],
  options?: {
    timeRange?: TimeRangeFilter;
    category?: CategoryFilter;
    now?: Date;
  }
): TrendAnalyticsResult {
  const timeRange = options?.timeRange || '30d';
  const categoryFilter = options?.category || 'ALL_STRATEGIC';
  const now = options?.now || new Date();
  const nowMs = now.getTime();
  const dayMs = 24 * 3600 * 1000;

  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 0;
  const currentStart = days > 0 ? nowMs - days * dayMs : 0;
  const prevStart = days > 0 ? nowMs - (days * 2) * dayMs : 0;

  // 1. Filter analyses to Strategic Categories only
  const strategicItems = analyses
    .map((a) => ({ analysis: a, category: getArticleStrategicCategory(a) }))
    .filter((item): item is { analysis: ArticleAnalysis; category: StrategicCategory } => item.category !== null);

  // 2. Partition into current vs previous comparison windows
  const currentItems = strategicItems.filter(({ analysis, category }) => {
    if (categoryFilter !== 'ALL_STRATEGIC' && category !== categoryFilter) return false;
    if (days > 0) {
      const t = new Date(analysis.analyzedAt || 0).getTime();
      return t >= currentStart && t <= nowMs;
    }
    return true;
  });

  const prevItems = strategicItems.filter(({ analysis, category }) => {
    if (categoryFilter !== 'ALL_STRATEGIC' && category !== categoryFilter) return false;
    if (days > 0) {
      const t = new Date(analysis.analyzedAt || 0).getTime();
      return t >= prevStart && t < currentStart;
    }
    return false;
  });

  // 3. Aggregate current period topics (deduplicated per article)
  const currentTopicMap = new Map<string, {
    canonicalKey: string;
    displayName: string;
    count: number;
    companies: Set<string>;
    stories: Set<string>;
    categories: Set<StrategicCategory>;
    totalImportance: number;
    latestSeenAt: string;
    representativeArticleId?: string;
  }>();

  currentItems.forEach(({ analysis, category }) => {
    const seenInArticle = new Set<string>();
    (analysis.topics || []).forEach((rawTopic) => {
      const { canonicalKey, displayName } = normalizeTopic(rawTopic);
      if (!seenInArticle.has(canonicalKey)) {
        seenInArticle.add(canonicalKey);

        if (!currentTopicMap.has(canonicalKey)) {
          currentTopicMap.set(canonicalKey, {
            canonicalKey,
            displayName,
            count: 0,
            companies: new Set(),
            stories: new Set(),
            categories: new Set(),
            totalImportance: 0,
            latestSeenAt: analysis.analyzedAt || '',
            representativeArticleId: analysis.articleId,
          });
        }

        const entry = currentTopicMap.get(canonicalKey)!;
        entry.count++;
        entry.categories.add(category);
        entry.totalImportance += (analysis.importanceScore || 0);

        if (analysis.storyId) {
          entry.stories.add(analysis.storyId);
        }

        (analysis.companies || []).forEach((c) => {
          const cid = resolveTrackedCompanyId(c);
          if (cid) entry.companies.add(cid);
        });

        const artTime = new Date(analysis.analyzedAt || 0).getTime();
        const latestTime = new Date(entry.latestSeenAt || 0).getTime();
        if (artTime >= latestTime) {
          entry.latestSeenAt = analysis.analyzedAt || '';
          entry.representativeArticleId = analysis.articleId;
        }
      }
    });
  });

  // 4. Aggregate previous period topics (deduplicated per article)
  const prevTopicMap = new Map<string, number>();
  prevItems.forEach(({ analysis }) => {
    const seenInArticle = new Set<string>();
    (analysis.topics || []).forEach((rawTopic) => {
      const { canonicalKey } = normalizeTopic(rawTopic);
      if (!seenInArticle.has(canonicalKey)) {
        seenInArticle.add(canonicalKey);
        prevTopicMap.set(canonicalKey, (prevTopicMap.get(canonicalKey) || 0) + 1);
      }
    });
  });

  // 5. Exclude legacy stories when counting story corroboration
  const prodStoryIdSet = new Set(stories.filter(isProductionStory).map((s) => s.id));

  // 6. Calculate Velocity, Momentum, and Explainable Ranking
  const allTrends: TrendingTopic[] = [];

  currentTopicMap.forEach((entry, canonicalKey) => {
    const currentCount = entry.count;
    const prevCount = prevTopicMap.get(canonicalKey) || 0;
    const absoluteDelta = currentCount - prevCount;
    let momentum: TrendMomentum = 'STABLE';
    let velocityPercent: number | null = null;

    if (days === 0) {
      // All Analyzed Data: no meaningful previous comparison window exists
      momentum = 'STABLE';
      velocityPercent = null;
    } else if (prevCount === 0) {
      // First observation with no previous baseline
      const minNewThreshold = days === 7 ? 2 : 3;
      momentum = currentCount >= minNewThreshold ? 'NEW' : 'STABLE';
      velocityPercent = null;
    } else {
      velocityPercent = Math.round(((currentCount - prevCount) / prevCount) * 100);
      if (absoluteDelta >= 2 && velocityPercent >= 20) {
        momentum = 'RISING';
      } else if (absoluteDelta <= -2 && velocityPercent <= -20) {
        momentum = 'DECLINING';
      } else {
        momentum = 'STABLE';
      }
    }

    // Filter valid production stories only
    const validProdStoryCount = Array.from(entry.stories).filter((sid) => prodStoryIdSet.has(sid)).length;

    // Small-sample qualification check
    const minThreshold = days === 7 ? 2 : days === 30 ? 3 : 2;
    const hasEvidence =
      absoluteDelta >= 2 ||
      (momentum === 'NEW' && currentCount >= minThreshold) ||
      entry.companies.size >= 2 ||
      validProdStoryCount >= 2;
    const isQualifying = currentCount >= minThreshold && hasEvidence;

    const avgImportance = Math.round(entry.totalImportance / currentCount);
    const comps = Array.from(entry.companies)
      .map((cid) => TRACKED_COMPANY_MAP.get(cid))
      .filter((c): c is TrackedCompanyConfig => Boolean(c));

    // Transparent, explainable ranking formula
    // A. Frequency
    let rankScore = currentCount * 10;
    // B. Growth & Momentum
    if (prevCount > 0 && absoluteDelta > 0) {
      rankScore += absoluteDelta * 8;
    } else if (momentum === 'NEW') {
      rankScore += currentCount >= 3 ? 15 : 5;
    }
    // C. Company breadth
    if (entry.companies.size >= 3) rankScore += 15;
    else if (entry.companies.size >= 2) rankScore += 8;
    // D. Story corroboration
    if (validProdStoryCount >= 3) rankScore += 12;
    else if (validProdStoryCount >= 2) rankScore += 6;
    // E. Average importance
    rankScore += (avgImportance / 100) * 10;
    // F. Target target (HUAWEI) involvement
    if (entry.companies.has('comp-huawei')) rankScore += 5;

    allTrends.push({
      canonicalKey,
      topic: entry.displayName,
      momentum,
      currentCount,
      previousCount: prevCount,
      absoluteDelta,
      velocityPercent,
      companies: comps,
      storyCount: validProdStoryCount,
      averageImportance: avgImportance,
      categories: Array.from(entry.categories),
      latestSeenAt: entry.latestSeenAt,
      representativeArticleId: entry.representativeArticleId,
      rankScore: Math.round(rankScore),
      isQualifying,
    });
  });

  // Sort qualifying trends descending by rankScore
  const qualifyingTrends = allTrends
    .filter((t) => t.isQualifying)
    .sort((a, b) => b.rankScore - a.rankScore);

  return {
    trends: allTrends.sort((a, b) => b.rankScore - a.rankScore),
    topTrends: qualifyingTrends,
    currentWindowArticlesCount: currentItems.length,
    previousWindowArticlesCount: prevItems.length,
    filterStats: {
      timeRange,
      category: categoryFilter,
      totalAvailableAnalyses: analyses.length,
      filteredAnalysesCount: currentItems.length,
    },
  };
}

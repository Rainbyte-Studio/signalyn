/**
 * Signalyn Phase 4C.3: Live Competitive Analytics Service
 * 
 * Provides deterministic, real-time competitive intelligence aggregations
 * derived from existing production ArticleAnalysis and Story data in Firestore.
 * 
 * Quota-Safe / Zero Gemini / Purely Deterministic.
 */

import { ArticleAnalysis, Story, isProductionStory } from '../types';

export type StrategicCategory = 'SMARTPHONE' | 'WEARABLE' | 'AUDIO' | 'TABLET';

export type TimeRangeFilter = '7d' | '30d' | 'all';
export type CategoryFilter = 'ALL_STRATEGIC' | 'SMARTPHONE' | 'WEARABLE' | 'AUDIO' | 'TABLET';

export interface TrackedCompanyConfig {
  id: string;
  name: string;
  isPrimary: boolean;
  aliases: string[];
  color: string;
}

export const TRACKED_COMPANIES: TrackedCompanyConfig[] = [
  { id: 'comp-huawei', name: 'HUAWEI', isPrimary: true, aliases: ['huawei'], color: '#6366F1' },
  { id: 'comp-samsung', name: 'Samsung', isPrimary: false, aliases: ['samsung', 'samsung electronics'], color: '#3B82F6' },
  { id: 'comp-apple', name: 'Apple', isPrimary: false, aliases: ['apple', 'apple inc'], color: '#8B5CF6' },
  { id: 'comp-xiaomi', name: 'Xiaomi', isPrimary: false, aliases: ['xiaomi'], color: '#F59E0B' },
  { id: 'comp-honor', name: 'HONOR', isPrimary: false, aliases: ['honor'], color: '#10B981' },
  { id: 'comp-google', name: 'Google', isPrimary: false, aliases: ['google', 'alphabet', 'google pixel', 'pixel'], color: '#06B6D4' },
  { id: 'comp-garmin', name: 'Garmin', isPrimary: false, aliases: ['garmin'], color: '#14B8A6' },
  { id: 'comp-oppo', name: 'OPPO', isPrimary: false, aliases: ['oppo'], color: '#84CC16' },
  { id: 'comp-vivo', name: 'vivo', isPrimary: false, aliases: ['vivo'], color: '#A855F7' },
  { id: 'comp-motorola', name: 'Motorola', isPrimary: false, aliases: ['motorola', 'moto'], color: '#EC4899' },
  { id: 'comp-nothing', name: 'Nothing', isPrimary: false, aliases: ['nothing', 'cmf'], color: '#71717A' },
];

const TRACKED_COMPANY_MAP = new Map<string, TrackedCompanyConfig>();
TRACKED_COMPANIES.forEach((c) => TRACKED_COMPANY_MAP.set(c.id, c));

const NOTHING_EXACT_BRAND_FORMS = new Set([
  'nothing',
  'nothing technology',
  'nothing tech',
  'nothing technology limited',
  'nothing technology ltd',
  'nothing inc',
  'nothing ltd',
  'cmf',
  'cmf by nothing',
]);

const NOTHING_QUALIFIED_BRAND_REGEX =
  /\b(nothing\s+(phone|ear|watch|os|technology|tech|audio|buds|headphone|headphones|mobile|device|devices)|cmf(\s+by\s+nothing|\s+phone|\s+watch|\s+buds|\s+pro)?)\b/i;

/**
 * Determines whether a raw entity label refers to the consumer hardware brand "Nothing"
 * rather than the ordinary English word "nothing" in prose.
 */
export function isCanonicalNothingBrandMention(rawText: string): boolean {
  if (!rawText) return false;
  const cleaned = rawText
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:()[\]"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return false;
  if (NOTHING_EXACT_BRAND_FORMS.has(cleaned)) return true;
  if (NOTHING_QUALIFIED_BRAND_REGEX.test(cleaned)) return true;
  return false;
}

/**
 * Resolves any company mention, ID, or alias to a canonical tracked company ID.
 * Protects against false positives from the English word "nothing" and substring collisions (e.g. "Vivobook" != "vivo").
 */
export function resolveTrackedCompanyId(mention: {
  companyId?: string;
  canonicalName?: string;
  matchedAlias?: string;
  name?: string;
}): string | null {
  if (mention.companyId && TRACKED_COMPANY_MAP.has(mention.companyId)) {
    return mention.companyId;
  }

  const candidateFields = [
    mention.canonicalName,
    mention.matchedAlias,
    mention.name,
  ].filter((v): v is string => Boolean(v && v.trim()));

  if (candidateFields.length === 0) {
    return null;
  }

  for (const comp of TRACKED_COMPANIES) {
    if (mention.companyId === comp.id) return comp.id;

    if (comp.id === 'comp-nothing') {
      if (candidateFields.some((field) => isCanonicalNothingBrandMention(field))) {
        return 'comp-nothing';
      }
      continue;
    }

    for (const alias of comp.aliases) {
      const escaped = alias.toLowerCase().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const boundaryRegex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      if (candidateFields.some((field) => boundaryRegex.test(field))) {
        return comp.id;
      }
    }
  }

  return null;
}

/**
 * Maps an ArticleAnalysis to its primary strategic category.
 * Defaults strictly to: SMARTPHONE, WEARABLE, AUDIO, TABLET.
 * Returns null if the item belongs to non-strategic categories (e.g. OTHER, AI, UNKNOWN).
 */
export function getArticleStrategicCategory(analysis: ArticleAnalysis): StrategicCategory | null {
  const rawCats: string[] = [
    ...(analysis.competitiveRelevance?.categories || []),
    ...(analysis.products?.map((p) => p.category) || []),
    ...(analysis.topics || []),
  ].map((c) => String(c).toUpperCase());

  for (const c of rawCats) {
    if (c.includes('SMARTPHONE') || c === 'PHONES') return 'SMARTPHONE';
    if (c.includes('WEARABLE') || c.includes('WATCH') || c.includes('BAND') || c.includes('FITNESS TRACKER')) return 'WEARABLE';
    if (c.includes('AUDIO') || c.includes('EARBUD') || c.includes('HEADPHONE') || c.includes('TWS')) return 'AUDIO';
    if (c.includes('TABLET') || c.includes('PAD') || c.includes('E-READER')) return 'TABLET';
  }

  return null;
}

export interface CompanyPerformanceRow {
  companyId: string;
  companyName: string;
  isPrimary: boolean;
  color: string;
  shareOfVoice: number; // 0 - 100 percentage
  analyzedMentions: number;
  storyPresence: number; // Distinct production stories containing this company
  averageImportance: number | null;
  positiveSentiment: number;
  neutralSentiment: number;
  negativeSentiment: number;
}

export interface CategoryCompetitiveSummary {
  category: StrategicCategory;
  categoryLabel: string;
  analyzedCount: number;
  leadingCompany: { name: string; mentions: number } | null;
  huaweiMentions: number;
  competitorMentions: number;
}

export interface CompetitiveAnalyticsResult {
  totalStrategicAnalyses: number;
  totalEligibleMentions: number;
  companyRows: CompanyPerformanceRow[];
  categorySummaries: Record<StrategicCategory, CategoryCompetitiveSummary>;
  languageBreakdown: Record<string, number>;
  filterStats: {
    timeRange: TimeRangeFilter;
    category: CategoryFilter;
    totalAvailableAnalyses: number;
    filteredAnalysesCount: number;
  };
}

/**
 * Calculates deterministic competitive analytics across eligible analyzed intelligence.
 * 
 * Rules:
 * 1. Scope: Strategic categories only by default (SMARTPHONE, WEARABLE, AUDIO, TABLET).
 * 2. SOV: Mentions of company / Total tracked-company mentions in eligible dataset.
 * 3. Mentions: Deduplicated per article (max 1 mention per company per article). Multi-company comparisons credit 1 to each.
 * 4. Story Presence: Number of distinct production Phase 4 stories (excludes legacy story-001..003).
 * 5. Sentiment: Attributed from ArticleAnalysis.sentiment to each company mentioned in that article.
 */
export function calculateCompetitiveAnalytics(
  analyses: ArticleAnalysis[],
  stories: Story[],
  options?: {
    timeRange?: TimeRangeFilter;
    category?: CategoryFilter;
    now?: Date;
  }
): CompetitiveAnalyticsResult {
  const timeRange = options?.timeRange || 'all';
  const categoryFilter = options?.category || 'ALL_STRATEGIC';
  const refTime = (options?.now || new Date()).getTime();

  // 1. Filter analyses by Strategic Scope and Filters
  const strategicItemsWithCategory = analyses
    .map((a) => ({ analysis: a, category: getArticleStrategicCategory(a) }))
    .filter((item): item is { analysis: ArticleAnalysis; category: StrategicCategory } => item.category !== null);

  const filteredItems = strategicItemsWithCategory.filter(({ analysis, category }) => {
    // Category filter
    if (categoryFilter !== 'ALL_STRATEGIC' && category !== categoryFilter) {
      return false;
    }

    // Time filter
    if (timeRange !== 'all') {
      const dateStr = analysis.analyzedAt || (analysis as any).createdAt || (analysis as any).publishedAt;
      if (dateStr) {
        const itemTime = new Date(dateStr).getTime();
        const diffDays = Math.max(0, (refTime - itemTime) / (1000 * 60 * 60 * 24));
        if (timeRange === '7d' && diffDays > 7) return false;
        if (timeRange === '30d' && diffDays > 30) return false;
      }
    }

    return true;
  });

  // 2. Company Stats Aggregation
  const companyMap = new Map<string, {
    config: TrackedCompanyConfig;
    mentions: number;
    totalImportance: number;
    positive: number;
    neutral: number;
    negative: number;
  }>();

  TRACKED_COMPANIES.forEach((c) => {
    companyMap.set(c.id, {
      config: c,
      mentions: 0,
      totalImportance: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
    });
  });

  let totalEligibleMentions = 0;
  const langCounts: Record<string, number> = {};

  filteredItems.forEach(({ analysis }) => {
    // Language counting for the filtered analyzed intelligence
    const lang = analysis.language || 'unknown';
    langCounts[lang] = (langCounts[lang] || 0) + 1;

    // Deduplicated companies in this article
    const seenInArticle = new Set<string>();

    (analysis.companies || []).forEach((m) => {
      const cid = resolveTrackedCompanyId(m);
      if (cid && companyMap.has(cid)) {
        seenInArticle.add(cid);
      }
    });

    const sentiment = (analysis.sentiment || 'NEUTRAL').toUpperCase();
    const importance = typeof analysis.importanceScore === 'number' ? analysis.importanceScore : 0;

    seenInArticle.forEach((cid) => {
      const entry = companyMap.get(cid)!;
      entry.mentions++;
      totalEligibleMentions++;
      entry.totalImportance += importance;

      if (sentiment === 'POSITIVE') entry.positive++;
      else if (sentiment === 'NEGATIVE') entry.negative++;
      else entry.neutral++;
    });
  });

  // 3. Story Presence: Calculate distinct production Phase 4 stories mentioning each company
  const prodStories = stories.filter(isProductionStory);
  const storyPresenceMap = new Map<string, number>();
  TRACKED_COMPANIES.forEach((c) => storyPresenceMap.set(c.id, 0));

  prodStories.forEach((story) => {
    const companiesInStory = new Set<string>();

    if (story.primaryCompanyId && TRACKED_COMPANY_MAP.has(story.primaryCompanyId)) {
      companiesInStory.add(story.primaryCompanyId);
    }

    (story.companies || []).forEach((c) => {
      const cid = resolveTrackedCompanyId({ companyId: c.companyId, name: c.name });
      if (cid && TRACKED_COMPANY_MAP.has(cid)) {
        companiesInStory.add(cid);
      }
    });

    companiesInStory.forEach((cid) => {
      storyPresenceMap.set(cid, (storyPresenceMap.get(cid) || 0) + 1);
    });
  });

  // 4. Build Company Performance Rows
  const companyRows: CompanyPerformanceRow[] = TRACKED_COMPANIES.map((config) => {
    const entry = companyMap.get(config.id)!;
    const mentions = entry.mentions;
    const shareOfVoice = totalEligibleMentions > 0
      ? Math.round((mentions / totalEligibleMentions) * 1000) / 10
      : 0;
    const averageImportance = mentions > 0
      ? Math.round(entry.totalImportance / mentions)
      : null;
    const storyPresence = storyPresenceMap.get(config.id) || 0;

    return {
      companyId: config.id,
      companyName: config.name,
      isPrimary: config.isPrimary,
      color: config.color,
      shareOfVoice,
      analyzedMentions: mentions,
      storyPresence,
      averageImportance,
      positiveSentiment: entry.positive,
      neutralSentiment: entry.neutral,
      negativeSentiment: entry.negative,
    };
  });

  // Sort primarily by Share of Voice / mentions descending, keeping non-zero before zero
  companyRows.sort((a, b) => {
    if (b.analyzedMentions !== a.analyzedMentions) {
      return b.analyzedMentions - a.analyzedMentions;
    }
    if (b.storyPresence !== a.storyPresence) {
      return b.storyPresence - a.storyPresence;
    }
    // If tied, HUAWEI primary first
    if (a.isPrimary) return -1;
    if (b.isPrimary) return 1;
    return a.companyName.localeCompare(b.companyName);
  });

  // 5. Category Competitive Breakdown
  const categoryConfigs: { key: StrategicCategory; label: string }[] = [
    { key: 'SMARTPHONE', label: 'Smartphones' },
    { key: 'WEARABLE', label: 'Wearables' },
    { key: 'AUDIO', label: 'Audio' },
    { key: 'TABLET', label: 'Tablets' },
  ];

  const categorySummaries = {} as Record<StrategicCategory, CategoryCompetitiveSummary>;

  categoryConfigs.forEach(({ key, label }) => {
    const itemsInCat = strategicItemsWithCategory.filter((item) => item.category === key);
    const mentionsByCompany = new Map<string, number>();
    let huawei = 0;
    let competitor = 0;

    itemsInCat.forEach(({ analysis }) => {
      const seen = new Set<string>();
      (analysis.companies || []).forEach((m) => {
        const cid = resolveTrackedCompanyId(m);
        if (cid && TRACKED_COMPANY_MAP.has(cid)) {
          seen.add(cid);
        }
      });

      seen.forEach((cid) => {
        mentionsByCompany.set(cid, (mentionsByCompany.get(cid) || 0) + 1);
        if (cid === 'comp-huawei') {
          huawei++;
        } else {
          competitor++;
        }
      });
    });

    let leadingCompany: { name: string; mentions: number } | null = null;
    let topMentions = 0;

    mentionsByCompany.forEach((cnt, cid) => {
      if (cnt > topMentions) {
        topMentions = cnt;
        leadingCompany = {
          name: TRACKED_COMPANY_MAP.get(cid)?.name || cid,
          mentions: cnt,
        };
      }
    });

    categorySummaries[key] = {
      category: key,
      categoryLabel: label,
      analyzedCount: itemsInCat.length,
      leadingCompany,
      huaweiMentions: huawei,
      competitorMentions: competitor,
    };
  });

  return {
    totalStrategicAnalyses: strategicItemsWithCategory.length,
    totalEligibleMentions,
    companyRows,
    categorySummaries,
    languageBreakdown: langCounts,
    filterStats: {
      timeRange,
      category: categoryFilter,
      totalAvailableAnalyses: analyses.length,
      filteredAnalysesCount: filteredItems.length,
    },
  };
}

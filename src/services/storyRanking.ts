/**
 * Signalyn Phase 7B.3: Authoritative Canonical Story Intelligence Ranking Service
 * 
 * Provides:
 * 1. isProductionStory: Isolates authentic production stories from legacy Phase 1 bootstrap stories
 * 2. rankCanonicalPriorityStories: Canonical, explainable, and deterministic ranking shared by
 *    Overview Top Priority Stories and Stories views.
 * 3. Strict lifecycle filtering: Excludes ARCHIVED, STALE, and superseded/merged-away stories.
 * 4. Grounded Phase 7B.2 intelligence evaluation: Decouples Strategic Importance (0-100)
 *    from Evidence Confidence (0.00-1.00), while providing safe, non-fabricated fallbacks
 *    for historical stories missing these fields.
 * 5. Deterministic tie-breaking: Priority Score -> Strategic Importance -> Material Recency -> Independent Sources -> Stable Story ID.
 * 
 * Quota-Safe / Zero Gemini / Purely Deterministic.
 */

import {
  Story,
  isLegacyStory,
  EvidenceClassification,
  CompetitiveThreatLevel,
  StoryStatus,
} from '../types';
import {
  CanonicalDeviceCategory,
  getStoryCanonicalCategories,
} from '../utils/categoryModel';

export const STRATEGIC_HARDWARE_CATEGORIES = new Set<CanonicalDeviceCategory>([
  'SMARTPHONE',
  'WEARABLE',
  'AUDIO',
  'TABLET',
]);

export const TRACKED_COMPETITOR_IDS = new Set([
  'comp-apple',
  'comp-samsung',
  'comp-xiaomi',
  'comp-honor',
  'comp-google',
  'comp-garmin',
  'comp-oppo',
  'comp-vivo',
]);

/**
 * Validates whether a story is an authentic production intelligence story.
 * Strictly excludes legacy Phase 1 bootstrap stories (story-001, story-002, story-003).
 */
export function isProductionStory(story: {
  id?: string;
  isLegacy?: boolean;
  clusteringVersion?: string;
  canonicalTitle?: string;
  title?: string;
}): boolean {
  if (isLegacyStory(story)) return false;
  if (!story.id || !story.id.startsWith('story-cluster-')) return false;
  if (!story.canonicalTitle && !story.title) return false;
  return true;
}

export interface CanonicalRankedStory {
  rank: number; // 1-indexed true ordinal ranking position (1, 2, 3...)
  story: Story;
  priorityScore: number; // Aggregate priority score (for sorting)
  totalScore: number; // Kept for backwards compatibility
  strategicImportance: number; // 0 - 100
  evidenceConfidence: number; // 0.00 - 1.00
  evidenceClassification: EvidenceClassification | 'UNVERIFIED';
  lifecycleStatus: StoryStatus;
  independentSources: number;
  totalOutlets: number;
  hardwareCategory: CanonicalDeviceCategory;
  lastMaterialUpdate: string;
  competitiveThreatLevel?: CompetitiveThreatLevel;
  huaweiRelevance?: string;
  reasons: string[];
  primaryHighlight: string;
  primaryReason: string; // Kept for backwards compatibility
}

export interface RankedStoryResult {
  story: Story;
  totalScore: number;
  reasons: string[];
  primaryReason: string;
  rank?: number;
}

/**
 * Deterministically ranks production stories using Phase 7B.2 Story Intelligence.
 * Shared authoritative service for Overview Dashboard and Stories page.
 * 
 * Rules:
 * 1. Candidate Qualification:
 *    - Must be authentic production story (isProductionStory).
 *    - Must have at least 1 article and a valid canonical title.
 *    - Excludes ARCHIVED, STALE, and superseded/merged-away stories.
 *    - Must belong to the 4 core categories: SMARTPHONE, WEARABLE, AUDIO, TABLET.
 * 
 * 2. Scoring Formula:
 *    - Base Strategic Importance: story.strategicImportanceScore ?? story.importanceScore ?? 50
 *    - Evidence Classification Bonus:
 *        OFFICIAL_ANNOUNCEMENT: +25
 *        VERIFIED_REPORT: +20
 *        MULTI_SOURCE_CORROBORATED: +18
 *        RUMOR_OR_LEAK: +5 (only if base strategic score >= 70, else 0; never confirmed)
 *        CONTRADICTED: -25
 *        Historical fallback (missing classification):
 *          >= 3 sources/articles: +12
 *          >= 2 sources/articles: +6
 *          1 source: 0
 *    - Independent Source Breadth: +4 per independent source (capped at +16)
 *    - HUAWEI Strategic & Competitive Weight:
 *        Primary Target HUAWEI: +15
 *        Competitive Threat HIGH: +12
 *        Competitive Threat MEDIUM / Tracked Competitor: +6
 *    - Material Recency:
 *        <= 24h: +15
 *        <= 48h: +8
 *        <= 7d: 0
 *        > 7d: -10
 */
export function rankCanonicalPriorityStories(
  stories: Story[],
  limitCount = 3
): CanonicalRankedStory[] {
  // 1. Candidate Pool: Active production stories belonging to strategic categories
  const candidates = stories.filter((story) => {
    if (!isProductionStory(story)) return false;
    if ((story.articleCount ?? story.articleIds?.length ?? 0) <= 0) return false;
    if (!story.canonicalTitle && !story.title) return false;

    // Strict Lifecycle Exclusion: Exclude ARCHIVED and STALE stories
    const status = story.status || 'DEVELOPING';
    if (status === 'ARCHIVED' || status === 'STALE') return false;

    // Exclude superseded / merged-away stories
    if (story.mergeMetadata && (story.mergeMetadata as any).isMergedAway === true) {
      return false;
    }

    // Strategic Category Filter: Must match Smartphones, Wearables, Audio, or Tablets
    const canonicalCats = getStoryCanonicalCategories(story);
    const hasStrategicCat = Array.from(canonicalCats).some((cat) =>
      STRATEGIC_HARDWARE_CATEGORIES.has(cat)
    );
    if (!hasStrategicCat) return false;

    return true;
  });

  if (candidates.length === 0) return [];

  // Determine corpus reference time for deterministic age calculation
  const timestamps = candidates.map((s) => {
    const timeStr = s.lastMaterialUpdateAt || s.lastSeenAt || s.lastUpdatedAt || s.updatedAt || s.firstSeenAt || s.createdAt;
    const t = new Date(timeStr || 0).getTime();
    return isNaN(t) ? 0 : t;
  });
  const refTime = Math.max(...timestamps, Date.now() - 86400000);

  const scoredCandidates: Array<{
    story: Story;
    priorityScore: number;
    strategicImportance: number;
    evidenceConfidence: number;
    evidenceClassification: EvidenceClassification | 'UNVERIFIED';
    lifecycleStatus: StoryStatus;
    independentSources: number;
    totalOutlets: number;
    hardwareCategory: CanonicalDeviceCategory;
    lastMaterialUpdate: string;
    competitiveThreatLevel?: CompetitiveThreatLevel;
    huaweiRelevance?: string;
    reasons: string[];
    primaryHighlight: string;
  }> = candidates.map((story) => {
    const reasons: string[] = [];

    // A. Base Strategic Importance (Decoupled from confidence)
    const has7b2StrategicScore = typeof story.strategicImportanceScore === 'number';
    const strategicImportance = has7b2StrategicScore
      ? Math.min(Math.max(story.strategicImportanceScore!, 0), 100)
      : typeof story.importanceScore === 'number'
      ? Math.min(Math.max(story.importanceScore, 0), 100)
      : 50;

    let priorityScore = strategicImportance;
    reasons.push(
      has7b2StrategicScore
        ? `Strategic Importance: ${strategicImportance}`
        : `Importance Baseline (Historical): ${strategicImportance}`
    );

    // B. Evidence Classification & Source Reliability
    const has7b2Evidence = Boolean(story.evidenceClassification);
    const evidenceClassification: EvidenceClassification | 'UNVERIFIED' =
      story.evidenceClassification || 'UNVERIFIED';

    const evidenceConfidence = typeof story.evidenceConfidence === 'number'
      ? Math.min(Math.max(story.evidenceConfidence, 0), 1)
      : typeof story.confidence === 'number'
      ? Math.min(Math.max(story.confidence, 0), 1)
      : 0.8;

    const sourceCount = story.sourceCount ?? story.sourceIds?.length ?? 1;
    const articleCount = story.articleCount ?? story.articleIds?.length ?? 1;
    const independentSources = typeof story.independentSourceCount === 'number'
      ? story.independentSourceCount
      : sourceCount;

    if (has7b2Evidence) {
      if (evidenceClassification === 'OFFICIAL_ANNOUNCEMENT') {
        priorityScore += 25;
        reasons.push('Official Manufacturer Announcement (+25)');
      } else if (evidenceClassification === 'VERIFIED_REPORT') {
        priorityScore += 20;
        reasons.push('Verified Reporting (+20)');
      } else if (evidenceClassification === 'MULTI_SOURCE_CORROBORATED') {
        priorityScore += 18;
        reasons.push('Multi-Source Corroborated (+18)');
      } else if (evidenceClassification === 'RUMOR_OR_LEAK') {
        // High-impact rumors only
        if (strategicImportance >= 70) {
          priorityScore += 5;
          reasons.push('High-Impact Leak/Rumor (+5)');
        } else {
          reasons.push('Unverified Rumor (+0)');
        }
      } else if (evidenceClassification === 'CONTRADICTED') {
        priorityScore -= 25;
        reasons.push('Contradicted / Debunked (-25)');
      } else {
        reasons.push('Single Source Reporting (+0)');
      }
    } else {
      // Historical fallback based on verified outlet corroboration
      if (independentSources >= 3 || articleCount >= 3) {
        priorityScore += 12;
        reasons.push(`Corroborated by ${independentSources} Outlets (+12)`);
      } else if (independentSources >= 2 || articleCount >= 2) {
        priorityScore += 6;
        reasons.push(`Corroborated by ${independentSources} Outlets (+6)`);
      }
    }

    // C. Independent Source Breadth Bonus (max +16)
    const breadthBonus = Math.min(independentSources * 4, 16);
    if (breadthBonus > 0) {
      priorityScore += breadthBonus;
      reasons.push(`Independent Source Breadth (${independentSources}) (+${breadthBonus})`);
    }

    // D. HUAWEI Strategic & Competitive Weight
    const isPrimaryHuawei =
      story.primaryCompanyId === 'comp-huawei' ||
      story.huaweiRelevance === 'PRIMARY_TARGET' ||
      (story.companies || []).some(
        (c) => c.companyId === 'comp-huawei' && c.relevance === 'PRIMARY'
      );

    const isTrackedCompetitor =
      Boolean(story.primaryCompanyId && TRACKED_COMPETITOR_IDS.has(story.primaryCompanyId)) ||
      (story.companies || []).some((c) => c.companyId && TRACKED_COMPETITOR_IDS.has(c.companyId));

    if (isPrimaryHuawei) {
      priorityScore += 15;
      reasons.push('Primary Target HUAWEI (+15)');
    } else if (story.competitiveThreatLevel === 'HIGH') {
      priorityScore += 12;
      reasons.push('High Competitive Threat (+12)');
    } else if (story.competitiveThreatLevel === 'MEDIUM') {
      priorityScore += 6;
      reasons.push('Medium Competitive Threat (+6)');
    } else if (isTrackedCompetitor) {
      priorityScore += 6;
      reasons.push('Tracked Rival Move (+6)');
    }

    // E. Material Development Recency (Freshness without Syndication Distortion)
    const materialTimeStr =
      story.lastMaterialUpdateAt ||
      story.lastSeenAt ||
      story.lastUpdatedAt ||
      story.updatedAt ||
      story.firstSeenAt ||
      story.createdAt;

    const materialTimeMs = new Date(materialTimeStr || 0).getTime();
    const ageHours = Math.max(0, (refTime - materialTimeMs) / (1000 * 60 * 60));

    if (ageHours <= 24) {
      priorityScore += 15;
      reasons.push('Breaking Development (≤24h) (+15)');
    } else if (ageHours <= 48) {
      priorityScore += 8;
      reasons.push('Recent Development (≤48h) (+8)');
    } else if (ageHours > 168) {
      priorityScore -= 10;
      reasons.push('Dormant Development (>7d) (-10)');
    }

    // Determine primary highlight reason for UI badge
    let primaryHighlight = 'High Strategic Priority';
    if (evidenceClassification === 'CONTRADICTED') {
      primaryHighlight = 'Contradicted Claim (Unconfirmed)';
    } else if (evidenceClassification === 'RUMOR_OR_LEAK') {
      primaryHighlight = isPrimaryHuawei
        ? 'HUAWEI Speculation (Unconfirmed)'
        : 'Unconfirmed Rumor / Leak';
    } else if (evidenceClassification === 'OFFICIAL_ANNOUNCEMENT') {
      primaryHighlight = 'Official Announcement';
    } else if (isPrimaryHuawei) {
      primaryHighlight = 'Primary Target Move';
    } else if (story.competitiveThreatLevel === 'HIGH') {
      primaryHighlight = 'High Threat Move';
    } else if (independentSources >= 2) {
      primaryHighlight = `Multi-Source (${independentSources} outlets)`;
    } else if (ageHours <= 24) {
      primaryHighlight = 'Breaking Development';
    }

    // Hardware category resolution
    const canonicalCats = getStoryCanonicalCategories(story);
    const hardwareCategory: CanonicalDeviceCategory =
      Array.from(canonicalCats).find((c) => STRATEGIC_HARDWARE_CATEGORIES.has(c)) ||
      'SMARTPHONE';

    return {
      story,
      priorityScore,
      strategicImportance,
      evidenceConfidence,
      evidenceClassification,
      lifecycleStatus: story.status || 'DEVELOPING',
      independentSources,
      totalOutlets: sourceCount,
      hardwareCategory,
      lastMaterialUpdate: materialTimeStr || new Date().toISOString(),
      competitiveThreatLevel: story.competitiveThreatLevel,
      huaweiRelevance: story.huaweiRelevance,
      reasons,
      primaryHighlight,
    };
  });

  // Deterministic Sorting with Stable Tie-Breakers:
  // 1. Priority score descending
  // 2. Strategic importance score descending
  // 3. Material recency timestamp descending
  // 4. Independent sources descending
  // 5. Stable Story ID alphabetically
  scoredCandidates.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    if (b.strategicImportance !== a.strategicImportance) {
      return b.strategicImportance - a.strategicImportance;
    }
    const timeB = new Date(b.lastMaterialUpdate).getTime();
    const timeA = new Date(a.lastMaterialUpdate).getTime();
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    if (b.independentSources !== a.independentSources) {
      return b.independentSources - a.independentSources;
    }
    return a.story.id.localeCompare(b.story.id);
  });

  // Assign 1-indexed true ordinal ranking
  return scoredCandidates.slice(0, limitCount).map((item, index) => ({
    ...item,
    rank: index + 1,
    totalScore: item.priorityScore,
    primaryReason: item.primaryHighlight,
  }));
}

/**
 * Backward-compatible wrapper for rankTopPriorityStories.
 * Ensures existing callers receive deterministic results with ordinal rank.
 */
export function rankTopPriorityStories(
  stories: Story[],
  limitCount = 3
): RankedStoryResult[] {
  const ranked = rankCanonicalPriorityStories(stories, limitCount);
  return ranked.map((r) => ({
    story: r.story,
    totalScore: r.priorityScore,
    reasons: r.reasons,
    primaryReason: r.primaryHighlight,
    rank: r.rank,
  }));
}

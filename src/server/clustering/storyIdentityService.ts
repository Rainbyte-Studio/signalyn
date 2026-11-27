/**
 * Signalyn Phase 7B.2 Intelligent Story Identity & Deduplication Service
 *
 * Implements authoritative story identity modeling, cross-language event normalization,
 * material development detection, and safe historical duplicate auditing.
 */

import {
  Article,
  ArticleAnalysis,
  EvidenceClassification,
  Story,
  StoryDevelopment,
  StoryDevelopmentType,
  StoryType,
} from '../../types';
import { CanonicalDeviceCategory, getStoryCanonicalCategories, resolveCanonicalCategories } from '../../utils/categoryModel';

export interface StoryIdentityProfile {
  companyId: string;
  category: CanonicalDeviceCategory;
  productId: string | null;
  eventType: StoryType;
  eventSignature: string;
  normalizedTitleTokens: Set<string>;
}

// Common Greek transliteration mappings to English tech tokens
const GREEK_TECH_TRANSLITERATIONS: Record<string, string> = {
  'αιφον': 'iphone',
  'γαλαξυ': 'galaxy',
  'σαμσουνγκ': 'samsung',
  'σαμσουνκ': 'samsung',
  'γουατσ': 'watch',
  'χουαγουει': 'huawei',
  'χουαβει': 'huawei',
  'ξιαομι': 'xiaomi',
  'σιομι': 'xiaomi',
  'ονερ': 'honor',
  'ονορ': 'honor',
  'πιξελ': 'pixel',
  'γκαρμιν': 'garmin',
  'ταμπλετ': 'tablet',
  'ταμπλετα': 'tablet',
  'ανακοινωσε': 'announced',
  'ανακοινωση': 'announcement',
  'αποκαλυψε': 'unveiled',
  'αποκαλυψη': 'unveiled',
  'παρουσιασε': 'unveiled',
  'παρουσιαση': 'unveiled',
  'επισημα': 'official',
  'επισημη': 'official',
  'επισημο': 'official',
  'κυκλοφορια': 'launch',
  'κυκλοφορησε': 'launch',
  'λανσαρισμα': 'launch',
  'διαθεσιμο': 'available',
  'διαθεση': 'availability',
  'σειρα': 'series',
  'τιμη': 'price',
  'τιμες': 'pricing',
  'κοστος': 'price',
  'διαρροη': 'leak',
  'διαρροες': 'leak',
  'φημες': 'rumors',
  'φημη': 'rumors',
  'ανασκοπηση': 'review',
  'δοκιμη': 'review',
  'νεο': 'new',
  'νεα': 'new',
  'νεος': 'new',
  'εξυπνο': 'smart',
  'ρολοι': 'watch',
  'ρολογια': 'watch',
  'αισθητηρες': 'sensors',
  'αισθητηρας': 'sensors',
  'αισθητηρα': 'sensors',
  'προηγμενους': 'advanced',
  'προηγμενος': 'advanced',
  'προηγμενα': 'advanced',
  'υγειας': 'health',
  'υγεια': 'health',
  'μπαταρια': 'battery',
  'παγκοσμια': 'worldwide',
  'παγκοσμιως': 'worldwide',
};

// English stem mappings for cross-comparison
const ENGLISH_STEM_MAP: Record<string, string> = {
  'unveils': 'unveiled',
  'unveil': 'unveiled',
  'unveiling': 'unveiled',
  'announces': 'announced',
  'announce': 'announced',
  'announcement': 'announced',
  'officially': 'official',
  'sensors': 'sensors',
  'sensor': 'sensors',
  'watches': 'watch',
  'smartwatch': 'watch',
  'smartwatches': 'watch',
  'leaks': 'leak',
  'rumor': 'rumors',
};

/**
 * Normalizes title text across Greek and English for semantic token comparison.
 */
export function normalizeCrossLanguageTokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();

  const strippedDiacritics = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const rawTokens = strippedDiacritics
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const normalized = new Set<string>();
  for (const t of rawTokens) {
    if (GREEK_TECH_TRANSLITERATIONS[t]) {
      normalized.add(GREEK_TECH_TRANSLITERATIONS[t]);
    } else if (ENGLISH_STEM_MAP[t]) {
      normalized.add(ENGLISH_STEM_MAP[t]);
    } else {
      normalized.add(t);
    }
  }

  return normalized;
}

/**
 * Calculates Jaccard token similarity between two token sets.
 */
export function calculateTokenSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let inter = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) inter++;
  });
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Computes deterministic canonical event signature for a story or article.
 */
export function computeEventSignature(
  companyId: string | null | undefined,
  category: CanonicalDeviceCategory,
  productId: string | null | undefined,
  eventType: string | null | undefined
): string {
  const normComp = (companyId || 'comp-other').toLowerCase().trim();
  const normCat = category.toUpperCase();
  const normProd = (productId || 'general').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normType = (eventType || 'ANNOUNCEMENT').toUpperCase().trim();

  return `${normComp}:${normCat}:${normProd}:${normType}`;
}

export type IdentityComparisonDecision =
  | 'DEFINITE_SAME_DEVELOPMENT'
  | 'DEFINITE_SEPARATE_DEVELOPMENT'
  | 'AMBIGUOUS_CANDIDATE';

export interface IdentityComparisonResult {
  decision: IdentityComparisonDecision;
  confidence: number; // 0.00 - 1.00
  similarityScore: number;
  reason: string;
  isCrossLanguageMatch: boolean;
  ruleTriggered?: string;
}

/**
 * Evaluates whether two stories (or an incoming article and an existing story)
 * represent the exact same real-world development.
 *
 * Enforces all Phase 7B.2 invariants:
 * - Product launch vs independent review: SEPARATE
 * - Unrelated announcements from same company: SEPARATE
 * - Different categories with similar names: SEPARATE
 * - Greek and English covering same announcement: SAME
 * - Leak/rumor vs official launch: linked evidence stages, but distinguishable
 */
export function compareStoryIdentities(
  storyA: Story,
  storyB: Story
): IdentityComparisonResult {
  const compA = storyA.primaryCompanyId || storyA.companies?.[0]?.companyId || 'comp-a';
  const compB = storyB.primaryCompanyId || storyB.companies?.[0]?.companyId || 'comp-b';

  // Invariant 1: Different primary companies are NEVER the same development
  if (compA && compB && compA !== compB) {
    return {
      decision: 'DEFINITE_SEPARATE_DEVELOPMENT',
      confidence: 1.0,
      similarityScore: 0,
      reason: `Distinct corporate entities (${compA} vs ${compB}).`,
      isCrossLanguageMatch: false,
      ruleTriggered: 'DISTINCT_COMPANY',
    };
  }

  // Invariant 2: Hardware category boundaries
  const catsA = getStoryCanonicalCategories(storyA);
  const catsB = getStoryCanonicalCategories(storyB);
  let shareCategory = false;
  catsA.forEach((cA) => {
    if (catsB.has(cA) && cA !== 'UNKNOWN' && cA !== 'OTHER') {
      shareCategory = true;
    }
  });

  // If one is clearly WEARABLE and other is SMARTPHONE, never merge even if text matches
  if (!shareCategory && !catsA.has('UNKNOWN') && !catsB.has('UNKNOWN')) {
    return {
      decision: 'DEFINITE_SEPARATE_DEVELOPMENT',
      confidence: 0.98,
      similarityScore: 0,
      reason: `Cross-category boundary enforced (${Array.from(catsA).join('/')} vs ${Array.from(catsB).join('/')}).`,
      isCrossLanguageMatch: false,
      ruleTriggered: 'CROSS_CATEGORY_COLLISION_PREVENTED',
    };
  }

  // Invariant 3: Product Launch vs Independent Product Review must be kept separate
  const titleA = (storyA.canonicalTitle || storyA.title || '').toLowerCase();
  const titleB = (storyB.canonicalTitle || storyB.title || '').toLowerCase();
  const isReviewA = storyA.storyType === 'REVIEW' || titleA.includes('review') || titleA.includes('δοκιμη') || titleA.includes('hands-on');
  const isReviewB = storyB.storyType === 'REVIEW' || titleB.includes('review') || titleB.includes('δοκιμη') || titleB.includes('hands-on');

  if (isReviewA !== isReviewB) {
    return {
      decision: 'DEFINITE_SEPARATE_DEVELOPMENT',
      confidence: 0.96,
      similarityScore: 0.25,
      reason: 'Product Launch / News vs Independent Editorial Hardware Review must remain separate developments.',
      isCrossLanguageMatch: false,
      ruleTriggered: 'LAUNCH_VS_REVIEW_SEPARATION',
    };
  }

  // Invariant 4: Chronology window (events > 21 days apart are separate updates or lifecycles)
  const timeA = new Date(storyA.lastSeenAt || storyA.firstSeenAt || 0).getTime();
  const timeB = new Date(storyB.lastSeenAt || storyB.firstSeenAt || 0).getTime();
  const diffDays = Math.abs(timeA - timeB) / (1000 * 60 * 60 * 24);

  if (diffDays > 21) {
    return {
      decision: 'DEFINITE_SEPARATE_DEVELOPMENT',
      confidence: 0.90,
      similarityScore: 0.20,
      reason: `Temporal distance (${diffDays.toFixed(1)} days) exceeds multi-source announcement window.`,
      isCrossLanguageMatch: false,
      ruleTriggered: 'TEMPORAL_WINDOW_EXCEEDED',
    };
  }

  // Check product identity overlap
  const prodA = (storyA.primaryProductId || storyA.products?.[0]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const prodB = (storyB.primaryProductId || storyB.products?.[0]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sameProduct = Boolean(prodA && prodB && (prodA === prodB || prodA.includes(prodB) || prodB.includes(prodA)));

  // Cross-language token similarity
  const tokensA = normalizeCrossLanguageTokens(storyA.canonicalTitle || storyA.title);
  const tokensB = normalizeCrossLanguageTokens(storyB.canonicalTitle || storyB.title);
  const tokenSim = calculateTokenSimilarity(tokensA, tokensB);

  const isCrossLang = (
    (storyA.languages?.includes('el') && storyB.languages?.includes('en')) ||
    (storyA.languages?.includes('en') && storyB.languages?.includes('el'))
  );

  // Invariant 5: Clear match for multi-source coverage of same event
  const isDirectEventMatch = sameProduct && (
    tokenSim >= 0.35 ||
    (isCrossLang && tokenSim >= 0.25) ||
    (prodA && prodA === prodB && tokenSim >= 0.25 && storyA.storyType === storyB.storyType)
  );

  if (isDirectEventMatch && diffDays <= 7) {
    return {
      decision: 'DEFINITE_SAME_DEVELOPMENT',
      confidence: Math.min(0.98, 0.80 + tokenSim * 0.2),
      similarityScore: parseFloat((tokenSim * 100).toFixed(1)),
      reason: `Identical product (${prodA}) and high event semantic similarity (${(tokenSim * 100).toFixed(0)}%) within ${diffDays.toFixed(1)} days.`,
      isCrossLanguageMatch: isCrossLang,
      ruleTriggered: 'SAME_PRODUCT_AND_EVENT',
    };
  }

  // High token similarity even with slight product string difference
  if (tokenSim >= 0.55 && diffDays <= 5) {
    return {
      decision: 'DEFINITE_SAME_DEVELOPMENT',
      confidence: 0.92,
      similarityScore: parseFloat((tokenSim * 100).toFixed(1)),
      reason: `High cross-reporting title and entity similarity (${(tokenSim * 100).toFixed(0)}%) within ${diffDays.toFixed(1)} days.`,
      isCrossLanguageMatch: isCrossLang,
      ruleTriggered: 'HIGH_TOKEN_SIMILARITY_MATCH',
    };
  }

  // Ambiguous match needing admin / algorithmic review
  if (tokenSim >= 0.25 || sameProduct) {
    return {
      decision: 'AMBIGUOUS_CANDIDATE',
      confidence: 0.60,
      similarityScore: parseFloat((tokenSim * 100).toFixed(1)),
      reason: `Related company and product activity within ${diffDays.toFixed(1)}d with moderate similarity (${(tokenSim * 100).toFixed(0)}%). Flagged for review.`,
      isCrossLanguageMatch: isCrossLang,
      ruleTriggered: 'AMBIGUOUS_CANDIDATE',
    };
  }

  return {
    decision: 'DEFINITE_SEPARATE_DEVELOPMENT',
    confidence: 0.85,
    similarityScore: parseFloat((tokenSim * 100).toFixed(1)),
    reason: `Low semantic overlap (${(tokenSim * 100).toFixed(0)}%) between independent developments.`,
    isCrossLanguageMatch: isCrossLang,
    ruleTriggered: 'LOW_SIMILARITY_SEPARATE',
  };
}

/**
 * Detects whether an incoming article adds a GENUINE material development to an existing story,
 * or is simply duplicate / repetitive coverage.
 */
export function detectMaterialDevelopment(
  incomingArticle: Article,
  incomingAnalysis: ArticleAnalysis,
  existingStory: Story,
  evidenceClassification: EvidenceClassification
): {
  isMaterialUpdate: boolean;
  developmentType?: StoryDevelopmentType;
  description?: string;
  reason: string;
} {
  const summaryLower = ((incomingAnalysis as any).summary || (incomingAnalysis as any).executiveSummary || '').toLowerCase();
  const storySummaryLower = (existingStory.summary || '').toLowerCase();

  // 1. Official Confirmation of Rumor
  if (
    (existingStory.evidenceClassification === 'RUMOR_OR_LEAK' || existingStory.evidenceClassification === 'UNVERIFIED') &&
    (evidenceClassification === 'OFFICIAL_ANNOUNCEMENT' || evidenceClassification === 'VERIFIED_REPORT')
  ) {
    return {
      isMaterialUpdate: true,
      developmentType: 'OFFICIAL_ANNOUNCEMENT',
      description: `Official confirmation received from ${incomingArticle.sourceName || 'authoritative source'}.`,
      reason: 'Transition from unconfirmed rumor to verified official announcement.',
    };
  }

  // 2. Pricing & Availability Update
  if (
    summaryLower.includes('pricing') ||
    summaryLower.includes('available on') ||
    summaryLower.includes('pre-order') ||
    summaryLower.includes('shipping date') ||
    summaryLower.includes('cost') ||
    summaryLower.includes('retail price')
  ) {
    if (!storySummaryLower.includes('pricing') && !storySummaryLower.includes('pre-order')) {
      return {
        isMaterialUpdate: true,
        developmentType: 'PRICING_AVAILABILITY',
        description: `Retail pricing and market availability details announced.`,
        reason: 'New commercial pricing and availability disclosures.',
      };
    }
  }

  // 3. Correction / Retraction / Debunking
  if (
    summaryLower.includes('correction') ||
    summaryLower.includes('retraction') ||
    summaryLower.includes('clarification') ||
    summaryLower.includes('debunked')
  ) {
    return {
      isMaterialUpdate: true,
      developmentType: 'CORRECTION_RETRACTION',
      description: `Material correction or clarification issued regarding initial reporting.`,
      reason: 'Factual retraction or clarification.',
    };
  }

  // 4. Launch Postponement or Delay
  if (
    summaryLower.includes('delayed') ||
    summaryLower.includes('postponed') ||
    summaryLower.includes('pushed back')
  ) {
    if (!storySummaryLower.includes('delayed') && !storySummaryLower.includes('postponed')) {
      return {
        isMaterialUpdate: true,
        developmentType: 'LAUNCH_POSTPONEMENT',
        description: `Expected launch window postponed.`,
        reason: 'Schedule change or postponement confirmed.',
      };
    }
  }

  // 5. Corroborating Second Independent Source
  const existingSourceIds = new Set(existingStory.sourceIds || []);
  if (!existingSourceIds.has(incomingArticle.sourceId) && existingStory.articleCount === 1) {
    return {
      isMaterialUpdate: true,
      developmentType: 'CORROBORATION',
      description: `Corroborated by independent reporting from ${incomingArticle.sourceName || incomingArticle.sourceId}.`,
      reason: 'Independent corroboration added to single-source story.',
    };
  }

  // Otherwise, it is repetitive or supplemental coverage
  return {
    isMaterialUpdate: false,
    reason: 'Repetitive coverage of established facts without material new disclosures.',
  };
}

export interface DuplicateAuditReport {
  totalStoriesAudited: number;
  suspectedDuplicatePairsCount: number;
  clearMergesCount: number;
  flaggedForReviewCount: number;
  keptSeparateCount: number;
  candidatePairs: Array<{
    pairId: string;
    storyA: { id: string; title: string; company: string; category: string; date: string; articles: number };
    storyB: { id: string; title: string; company: string; category: string; date: string; articles: number };
    similarityScore: number;
    decision: IdentityComparisonDecision;
    proposedAction: 'MERGE' | 'FLAG_FOR_REVIEW' | 'KEEP_SEPARATE';
    reason: string;
    isCrossLanguageMatch: boolean;
  }>;
}

/**
 * Runs a deterministic read-only duplicate audit across a collection of stories.
 */
export function auditDuplicateStories(stories: Story[]): DuplicateAuditReport {
  const prodStories = stories.filter((s) => !s.isLegacy && s.id?.startsWith('story-cluster-'));
  const candidatePairs: DuplicateAuditReport['candidatePairs'] = [];

  let clearMerges = 0;
  let flaggedReview = 0;
  let keptSeparate = 0;

  for (let i = 0; i < prodStories.length; i++) {
    for (let j = i + 1; j < prodStories.length; j++) {
      const sA = prodStories[i];
      const sB = prodStories[j];

      const compA = sA.primaryCompanyId || sA.companies?.[0]?.companyId || '';
      const compB = sB.primaryCompanyId || sB.companies?.[0]?.companyId || '';

      if (!compA || !compB || compA !== compB) continue;

      const compResult = compareStoryIdentities(sA, sB);

      if (compResult.decision === 'DEFINITE_SAME_DEVELOPMENT') {
        clearMerges++;
        candidatePairs.push({
          pairId: `pair-${sA.id}-${sB.id}`,
          storyA: {
            id: sA.id,
            title: sA.canonicalTitle || sA.title || '',
            company: compA,
            category: Array.from(getStoryCanonicalCategories(sA))[0] || 'SMARTPHONE',
            date: sA.lastSeenAt || '',
            articles: sA.articleCount || 1,
          },
          storyB: {
            id: sB.id,
            title: sB.canonicalTitle || sB.title || '',
            company: compB,
            category: Array.from(getStoryCanonicalCategories(sB))[0] || 'SMARTPHONE',
            date: sB.lastSeenAt || '',
            articles: sB.articleCount || 1,
          },
          similarityScore: compResult.similarityScore,
          decision: compResult.decision,
          proposedAction: 'MERGE',
          reason: compResult.reason,
          isCrossLanguageMatch: compResult.isCrossLanguageMatch,
        });
      } else if (compResult.decision === 'AMBIGUOUS_CANDIDATE') {
        flaggedReview++;
        candidatePairs.push({
          pairId: `pair-${sA.id}-${sB.id}`,
          storyA: {
            id: sA.id,
            title: sA.canonicalTitle || sA.title || '',
            company: compA,
            category: Array.from(getStoryCanonicalCategories(sA))[0] || 'SMARTPHONE',
            date: sA.lastSeenAt || '',
            articles: sA.articleCount || 1,
          },
          storyB: {
            id: sB.id,
            title: sB.canonicalTitle || sB.title || '',
            company: compB,
            category: Array.from(getStoryCanonicalCategories(sB))[0] || 'SMARTPHONE',
            date: sB.lastSeenAt || '',
            articles: sB.articleCount || 1,
          },
          similarityScore: compResult.similarityScore,
          decision: compResult.decision,
          proposedAction: 'FLAG_FOR_REVIEW',
          reason: compResult.reason,
          isCrossLanguageMatch: compResult.isCrossLanguageMatch,
        });
      } else if (compResult.ruleTriggered === 'LAUNCH_VS_REVIEW_SEPARATION') {
        keptSeparate++;
      }
    }
  }

  return {
    totalStoriesAudited: prodStories.length,
    suspectedDuplicatePairsCount: candidatePairs.length,
    clearMergesCount: clearMerges,
    flaggedForReviewCount: flaggedReview,
    keptSeparateCount: keptSeparate,
    candidatePairs,
  };
}

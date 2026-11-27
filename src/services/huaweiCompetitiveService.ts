/**
 * Signalyn Phase 7B.2 HUAWEI Competitive Intelligence Service
 *
 * Implements dedicated competitive intelligence analysis focused on HUAWEI:
 * - Strategic hardware categories: Smartphones, Watches / Wearables, Audio, Tablets
 * - Key competitors: HUAWEI, Apple, Samsung, Xiaomi, HONOR, Garmin, Google / Fitbit, OPPO, vivo, OnePlus
 * - Decoupled Strategic Importance (0-100) vs Evidence Confidence (0.00-1.00)
 * - Transparent scoring factors
 * - Calibrated Competitive Threat Levels (HIGH, MEDIUM, LOW, NOT_APPLICABLE)
 * - Actionable competitive implications and monitoring recommendations
 */

import {
  Article,
  ArticleAnalysis,
  CompetitiveThreatLevel,
  EvidenceClassification,
  Story,
} from '../types';
import { CanonicalDeviceCategory, getStoryCanonicalCategories } from '../utils/categoryModel';

export interface HuaweiCompetitiveAssessment {
  primaryCompanyId: string | null;
  primaryCompanyName: string;
  hardwareCategory: CanonicalDeviceCategory;
  strategicImportanceScore: number; // 0 - 100
  competitiveThreatLevel: CompetitiveThreatLevel;
  huaweiRelevance: string;
  competitiveImplication: string;
  strategicRecommendation?: string;
  strategicScoringFactors: {
    categoryWeight: number;
    competitorTier: string;
    noveltyScore: number;
    marketImpact: number;
    explanation: string;
  };
}

// Strategic category weights (0-30 points)
const CATEGORY_WEIGHTS: Record<CanonicalDeviceCategory, number> = {
  SMARTPHONE: 30, // Primary volume & revenue driver
  WEARABLE: 28,   // Key Huawei ecosystem stronghold
  AUDIO: 22,      // Competitive accessories tier
  TABLET: 24,     // Key productivity & enterprise overlap
  OTHER: 10,      // Secondary ecosystem
  UNKNOWN: 8,
};

// Competitor tier weights (0-30 points)
interface CompetitorProfile {
  tier: 'PRIMARY_DIRECT' | 'DIRECT_CHALLENGER' | 'NICHE_LEADER' | 'HUAWEI_SELF';
  weight: number;
}

const COMPETITOR_TIERS: Record<string, CompetitorProfile> = {
  'comp-apple': { tier: 'PRIMARY_DIRECT', weight: 30 },
  'comp-samsung': { tier: 'PRIMARY_DIRECT', weight: 30 },
  'comp-xiaomi': { tier: 'PRIMARY_DIRECT', weight: 28 },
  'comp-honor': { tier: 'DIRECT_CHALLENGER', weight: 26 },
  'comp-garmin': { tier: 'NICHE_LEADER', weight: 24 }, // Wearables/fitness specialist
  'comp-google': { tier: 'DIRECT_CHALLENGER', weight: 22 },
  'comp-huawei': { tier: 'HUAWEI_SELF', weight: 30 },
  'comp-oppo': { tier: 'DIRECT_CHALLENGER', weight: 20 },
  'comp-vivo': { tier: 'DIRECT_CHALLENGER', weight: 20 },
  'comp-oneplus': { tier: 'DIRECT_CHALLENGER', weight: 18 },
};

/**
 * Derives structured HUAWEI competitive intelligence for a Story.
 */
export function deriveHuaweiCompetitiveIntelligence(
  story: Partial<Story>,
  articles: Article[],
  analyses: ArticleAnalysis[],
  evidenceClassification: EvidenceClassification
): HuaweiCompetitiveAssessment {
  // 1. Identify Primary Company
  let primaryCompanyId = story.primaryCompanyId || null;
  let primaryCompanyName = 'Unknown';

  if (!primaryCompanyId && analyses.length > 0) {
    const comp = analyses[0]?.companies?.find((c) => c.relevance === 'PRIMARY') || analyses[0]?.companies?.[0];
    if (comp) {
      primaryCompanyId = comp.companyId || null;
      primaryCompanyName = comp.canonicalName || 'Competitor';
    }
  }

  if (story.companies && story.companies.length > 0) {
    const c = story.companies[0];
    primaryCompanyName = c.name;
    if (!primaryCompanyId) primaryCompanyId = c.companyId || null;
  }

  // Normalize company ID prefix
  if (primaryCompanyId && !primaryCompanyId.startsWith('comp-')) {
    primaryCompanyId = `comp-${primaryCompanyId.toLowerCase()}`;
  }

  // Fallback company heuristic from story text and company list if unknown
  if (!primaryCompanyId || primaryCompanyId === 'comp-unknown') {
    const textToScan = [
      story.canonicalTitle || '',
      story.title || '',
      ...(story.companies || []).map((c) => c.name || c.companyId || ''),
    ].join(' ').toLowerCase();

    if (textToScan.includes('huawei')) {
      primaryCompanyId = 'comp-huawei';
      primaryCompanyName = 'HUAWEI';
    } else if (textToScan.includes('apple') || textToScan.includes('iphone') || textToScan.includes('ipad') || textToScan.includes('airpods')) {
      primaryCompanyId = 'comp-apple';
      primaryCompanyName = 'Apple';
    } else if (textToScan.includes('samsung') || textToScan.includes('galaxy')) {
      primaryCompanyId = 'comp-samsung';
      primaryCompanyName = 'Samsung';
    } else if (textToScan.includes('xiaomi')) {
      primaryCompanyId = 'comp-xiaomi';
      primaryCompanyName = 'Xiaomi';
    } else if (textToScan.includes('honor')) {
      primaryCompanyId = 'comp-honor';
      primaryCompanyName = 'HONOR';
    } else if (textToScan.includes('google') || textToScan.includes('pixel') || textToScan.includes('fitbit')) {
      primaryCompanyId = 'comp-google';
      primaryCompanyName = 'Google';
    } else if (textToScan.includes('garmin')) {
      primaryCompanyId = 'comp-garmin';
      primaryCompanyName = 'Garmin';
    } else if (textToScan.includes('vivo')) {
      primaryCompanyId = 'comp-vivo';
      primaryCompanyName = 'vivo';
    } else if (textToScan.includes('oppo')) {
      primaryCompanyId = 'comp-oppo';
      primaryCompanyName = 'OPPO';
    } else if (textToScan.includes('oneplus')) {
      primaryCompanyId = 'comp-oneplus';
      primaryCompanyName = 'OnePlus';
    }
  }

  // 2. Identify Hardware Category
  const canonicalCats = getStoryCanonicalCategories(story as Story);
  let hardwareCategory: CanonicalDeviceCategory = 'SMARTPHONE';
  for (const cat of ['SMARTPHONE', 'WEARABLE', 'AUDIO', 'TABLET'] as CanonicalDeviceCategory[]) {
    if (canonicalCats.has(cat)) {
      hardwareCategory = cat;
      break;
    }
  }
  if (!canonicalCats.has(hardwareCategory)) {
    hardwareCategory = (Array.from(canonicalCats)[0] || 'SMARTPHONE') as CanonicalDeviceCategory;
  }

  // 3. Category & Competitor Base Scoring
  const categoryWeight = CATEGORY_WEIGHTS[hardwareCategory] ?? 15;
  const compProfile = primaryCompanyId ? COMPETITOR_TIERS[primaryCompanyId] : undefined;
  const compWeight = compProfile ? compProfile.weight : 14;
  const compTierName = compProfile ? compProfile.tier : 'OTHER_COMPETITOR';

  // 4. Novelty & Market Impact Evaluation (from analyses + story text)
  const combinedSummary = [
    ...analyses.map((a) => (a as any).summary || (a as any).executiveSummary || ''),
    story.summary || '',
    story.canonicalSummary || '',
    story.canonicalTitle || story.title || '',
  ].join(' ').toLowerCase();
  const storyType = story.storyType || analyses[0]?.newsType || 'OTHER';

  const isMinorAccessory = (
    hardwareCategory === 'OTHER' ||
    combinedSummary.includes('case') ||
    combinedSummary.includes('cover') ||
    combinedSummary.includes('cable') ||
    combinedSummary.includes('strap')
  );

  let noveltyScore = isMinorAccessory ? 5 : 15;
  let marketImpact = isMinorAccessory ? 5 : 15;

  // Flagship or breakthrough signals
  if (
    !isMinorAccessory && (
      combinedSummary.includes('flagship') ||
      combinedSummary.includes('ultra') ||
      combinedSummary.includes('pro max') ||
      combinedSummary.includes('breakthrough') ||
      combinedSummary.includes('foldable') ||
      combinedSummary.includes('satellite')
    )
  ) {
    noveltyScore += 10;
    marketImpact += 10;
  }

  // Event type modifiers
  if (!isMinorAccessory) {
    if (storyType === 'PRODUCT_LAUNCH' || storyType === 'ANNOUNCEMENT') {
      marketImpact += 8;
    } else if (storyType === 'LEAK' || storyType === 'RUMOR') {
      noveltyScore += 6;
      marketImpact += 2;
    } else if (storyType === 'PRICING') {
      marketImpact += 6;
    } else if (storyType === 'REVIEW') {
      noveltyScore += 2;
      marketImpact += 4;
    }
  } else {
    if (storyType === 'PRODUCT_LAUNCH' || storyType === 'ANNOUNCEMENT') {
      marketImpact += 3;
    }
  }

  // Cap sub-scores
  noveltyScore = Math.min(25, noveltyScore);
  marketImpact = Math.min(25, marketImpact);

  // Strategic Importance Score (0 - 100)
  // Strictly decoupled from evidence confidence!
  const rawScore = categoryWeight + compWeight + noveltyScore + marketImpact;
  // Scale rawScore [40 - 110] into [20 - 100]
  const strategicImportanceScore = Math.min(100, Math.max(15, Math.round(rawScore * 0.95)));

  // 5. Threat Level Determination
  let competitiveThreatLevel: CompetitiveThreatLevel = 'LOW';
  const isSelfHuawei = primaryCompanyId === 'comp-huawei';

  if (isSelfHuawei) {
    competitiveThreatLevel = 'NOT_APPLICABLE';
  } else if (
    (primaryCompanyId === 'comp-apple' || primaryCompanyId === 'comp-samsung') &&
    strategicImportanceScore >= 70 &&
    (hardwareCategory === 'SMARTPHONE' || hardwareCategory === 'WEARABLE')
  ) {
    competitiveThreatLevel = 'HIGH';
  } else if (
    (primaryCompanyId === 'comp-xiaomi' || primaryCompanyId === 'comp-honor') &&
    strategicImportanceScore >= 75
  ) {
    competitiveThreatLevel = 'HIGH';
  } else if (
    (primaryCompanyId === 'comp-oppo' || primaryCompanyId === 'comp-vivo' || primaryCompanyId === 'comp-oneplus' || primaryCompanyId === 'comp-google') &&
    strategicImportanceScore >= 75
  ) {
    competitiveThreatLevel = 'HIGH';
  } else if (
    primaryCompanyId === 'comp-garmin' &&
    hardwareCategory === 'WEARABLE' &&
    strategicImportanceScore >= 65
  ) {
    competitiveThreatLevel = 'HIGH'; // Direct wearable health threat
  } else if (strategicImportanceScore >= 50) {
    competitiveThreatLevel = 'MEDIUM';
  } else {
    competitiveThreatLevel = 'LOW';
  }

  // 6. Relevance & Implication Synthesis
  let huaweiRelevance = '';
  let competitiveImplication = '';
  let strategicRecommendation = '';

  if (isSelfHuawei) {
    huaweiRelevance = `First-party development directly impacting HUAWEI's ${hardwareCategory.toLowerCase()} roadmap and market execution.`;
    competitiveImplication = `Monitors channel adoption, consumer reception, and counter-positioning from tier-1 competitors.`;
    strategicRecommendation = `Track initial market reception across European and Asian tech media.`;
  } else if (primaryCompanyId === 'comp-apple') {
    huaweiRelevance = `Directly challenges HUAWEI premium tier in ${hardwareCategory.toLowerCase()} segment across international markets.`;
    competitiveImplication = `Applies competitive pricing and feature pressure against HUAWEI P/Mate and Watch lines.`;
    strategicRecommendation = `Monitor consumer sentiment on battery/camera differentials to reinforce HUAWEI value proposition.`;
  } else if (primaryCompanyId === 'comp-samsung') {
    huaweiRelevance = `Key Android competitor in ${hardwareCategory.toLowerCase()} space contesting European market share.`;
    competitiveImplication = `Direct spec-for-spec comparison in hardware display, zoom imaging, and ecosystem integration.`;
    strategicRecommendation = `Benchmark camera performance and trade-in promotion mechanics against Galaxy positioning.`;
  } else if (primaryCompanyId === 'comp-xiaomi' || primaryCompanyId === 'comp-honor') {
    huaweiRelevance = `High overlap in domestic Chinese and European mid-to-high ${hardwareCategory.toLowerCase()} consumer bases.`;
    competitiveImplication = `Aggressive hardware specifications and price-performance ratio competing directly with nova and Watch GT series.`;
    strategicRecommendation = `Audit fast charging and display specifications against HUAWEI roadmap.`;
  } else if (primaryCompanyId === 'comp-garmin' && hardwareCategory === 'WEARABLE') {
    huaweiRelevance = `Primary sports science and endurance benchmark for HUAWEI WATCH GT and Ultimate series.`;
    competitiveImplication = `Garmin maintains high athlete mindshare; directly contests HUAWEI's premium outdoor tracking features.`;
    strategicRecommendation = `Benchmark GPS accuracy, diving metrics, and health sensors against Garmin's latest release.`;
  } else if (primaryCompanyId === 'comp-google') {
    huaweiRelevance = `Direct competitor in mobile operating systems, Pixel hardware, and Wear OS / Fitbit health ecosystem.`;
    competitiveImplication = `Pressures HUAWEI software independence (HarmonyOS NEXT) and smart wearable fitness analytics.`;
    strategicRecommendation = `Benchmark HarmonyOS ecosystem parity and health algorithm accuracy against Google / Fitbit releases.`;
  } else if (primaryCompanyId === 'comp-oppo' || primaryCompanyId === 'comp-vivo' || primaryCompanyId === 'comp-oneplus') {
    huaweiRelevance = `Direct hardware competitor across Chinese domestic channels and European distribution in ${hardwareCategory.toLowerCase()}.`;
    competitiveImplication = `Aggressive pricing, fast-charging innovations, and imaging systems directly challenging nova, P, and Mate series.`;
    strategicRecommendation = `Audit price-to-spec ratio, camera benchmark comparisons, and regional channel promotions.`;
  } else if (strategicImportanceScore >= 70) {
    huaweiRelevance = `High-priority competitor development in ${hardwareCategory.toLowerCase()} impacting European / regional competitive dynamics.`;
    competitiveImplication = `Strategic competitor advancement with substantial market footprint; exerts competitive pressure in ${hardwareCategory.toLowerCase()}.`;
    strategicRecommendation = `Prioritize in competitive review and monitor channel reception across European and Asian tech media.`;
  } else {
    huaweiRelevance = `Secondary market activity in ${hardwareCategory.toLowerCase()} segment.`;
    competitiveImplication = `General industry movement; indirect competitive pressure on standard product lines.`;
    strategicRecommendation = `Maintain routine intelligence tracking in daily brief.`;
  }

  const explanation = `${primaryCompanyName} in ${hardwareCategory} (Tier: ${compTierName}, Base: ${compWeight}pts, Category: ${categoryWeight}pts, Novelty: ${noveltyScore}pts, Impact: ${marketImpact}pts).`;

  return {
    primaryCompanyId,
    primaryCompanyName,
    hardwareCategory,
    strategicImportanceScore,
    competitiveThreatLevel,
    huaweiRelevance,
    competitiveImplication,
    strategicRecommendation,
    strategicScoringFactors: {
      categoryWeight,
      competitorTier: compTierName,
      noveltyScore,
      marketImpact,
      explanation,
    },
  };
}

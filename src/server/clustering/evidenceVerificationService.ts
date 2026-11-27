/**
 * Signalyn Phase 7B.2 Evidence Verification & Source Reliability Service
 *
 * Implements rigorous evidentiary modeling:
 * - Evidence Classifications:
 *     OFFICIAL_ANNOUNCEMENT, VERIFIED_REPORT, MULTI_SOURCE_CORROBORATED,
 *     SINGLE_SOURCE_REPORT, RUMOR_OR_LEAK, UNVERIFIED, CONTRADICTED
 * - Primary vs secondary source distinction & provenance tracking
 * - Independent source counting (detects syndicated / replicated wire reporting)
 * - Evidence confidence calculation with transparent explanations
 * - Rumor-to-confirmation transitions
 * - Contradiction signal detection
 */

import { Article, ArticleAnalysis, EvidenceClassification, Story, StorySourceProvenance } from '../../types';

// Manufacturer official domains
const OFFICIAL_MANUFACTURER_DOMAINS = new Set<string>([
  'huawei.com',
  'consumer.huawei.com',
  'apple.com',
  'samsung.com',
  'samsungmobilepress.com',
  'mi.com',
  'hihonor.com',
  'honor.com',
  'garmin.com',
  'google.com',
  'blog.google',
  'fitbit.com',
  'oneplus.com',
  'oppo.com',
  'vivo.com',
  'qualcomm.com',
  'mediatek.com',
]);

// Known syndication groups / network clones that share content
const SYNDICATION_PAIRS: Array<[string, string]> = [
  ['gsmarena.com', 'arenaev.com'],
  ['androidpolice.com', 'pocket-lint.com'],
  ['digitaltrends.com', 'themanual.com'],
  ['newsbomb.gr', 'in.gr'],
];

/**
 * Extracts normalized root domain from URL.
 */
export function extractDomain(url: string | null | undefined): string {
  if (!url) return 'unknown';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host;
  } catch {
    return 'unknown';
  }
}

export const COMPANY_OFFICIAL_DOMAINS: Record<string, string[]> = {
  'comp-huawei': ['huawei.com', 'consumer.huawei.com'],
  'comp-apple': ['apple.com'],
  'comp-samsung': ['samsung.com', 'samsungmobilepress.com'],
  'comp-xiaomi': ['mi.com'],
  'comp-honor': ['hihonor.com', 'honor.com'],
  'comp-garmin': ['garmin.com'],
  'comp-google': ['google.com', 'blog.google', 'fitbit.com'],
  'comp-oneplus': ['oneplus.com'],
  'comp-oppo': ['oppo.com'],
  'comp-vivo': ['vivo.com'],
  'comp-qualcomm': ['qualcomm.com'],
  'comp-mediatek': ['mediatek.com'],
};

/**
 * Checks if a domain or source is an official manufacturer source.
 * When companyId is provided, validates domain relationship to the specific company.
 */
export function isOfficialManufacturerSource(domainOrUrl: string, companyId?: string | null): boolean {
  const domain = extractDomain(domainOrUrl);
  if (companyId && COMPANY_OFFICIAL_DOMAINS[companyId]) {
    const allowed = COMPANY_OFFICIAL_DOMAINS[companyId];
    return allowed.some((off) => domain === off || domain.endsWith('.' + off));
  }
  if (OFFICIAL_MANUFACTURER_DOMAINS.has(domain)) return true;
  for (const off of OFFICIAL_MANUFACTURER_DOMAINS) {
    if (domain.endsWith('.' + off)) return true;
  }
  return false;
}

/**
 * Evaluates whether two sources are syndicated duplicates rather than independent corroboration.
 */
export function areSourcesSyndicated(domainA: string, domainB: string): boolean {
  const normA = extractDomain(domainA);
  const normB = extractDomain(domainB);
  if (normA === normB) return true;

  for (const [s1, s2] of SYNDICATION_PAIRS) {
    if ((normA === s1 && normB === s2) || (normA === s2 && normB === s1)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculates independent source count across articles, pruning syndicated duplicates.
 */
export function calculateIndependentSourceCount(
  articles: Article[],
  provenances?: StorySourceProvenance[]
): number {
  const domains = new Set<string>();
  const independentDomains: string[] = [];

  for (const art of articles) {
    const artUrl = art.canonicalUrl || (art as any).url;
    const dom = extractDomain(artUrl);
    if (dom === 'unknown') continue;

    // Check if domain is syndicated with any already collected independent domain
    let syndicated = false;
    for (const existing of independentDomains) {
      if (areSourcesSyndicated(dom, existing)) {
        syndicated = true;
        break;
      }
    }

    if (!syndicated) {
      independentDomains.push(dom);
      domains.add(dom);
    }
  }

  return Math.max(1, independentDomains.length);
}

export interface EvidenceEvaluationResult {
  evidenceClassification: EvidenceClassification;
  evidenceConfidence: number; // 0.00 - 1.00
  evidenceReasons: string[];
  independentSourceCount: number;
  sourceProvenances: StorySourceProvenance[];
  hasContradiction: boolean;
  isRumorConfirmed: boolean;
}

/**
 * Evaluates evidence reliability and credibility for a story and its member articles.
 */
export function evaluateStoryEvidence(
  articles: Article[],
  analyses: ArticleAnalysis[],
  existingStory?: Story | null
): EvidenceEvaluationResult {
  const evidenceReasons: string[] = [];
  let isRumorConfirmed = false;

  // Empty / Missing Evidence Check (Task 6: Preserve unverified rather than fabricating certainty)
  if (!articles || articles.length === 0 || !analyses || analyses.length === 0) {
    return {
      evidenceClassification: existingStory?.evidenceClassification || 'UNVERIFIED',
      evidenceConfidence: existingStory?.evidenceConfidence || existingStory?.confidence || 0.50,
      evidenceReasons: ['Insufficient or unlinked article evidence; classification preserved as UNVERIFIED.'],
      independentSourceCount: 1,
      sourceProvenances: [],
      hasContradiction: false,
      isRumorConfirmed: false,
    };
  }

  // 1. Build source provenances with company relationship check (Task 5)
  const storyCompanyId = existingStory?.primaryCompanyId || existingStory?.companies?.[0]?.companyId;
  const sourceProvenances: StorySourceProvenance[] = articles.map((art, idx) => {
    const artUrl = art.canonicalUrl || (art as any).url;
    const domain = extractDomain(artUrl);
    const analysis = analyses[idx] || analyses.find((a) => a.articleId === art.id);
    const targetCompId = analysis?.companies?.[0]?.companyId || storyCompanyId;
    const isPrimaryDomain = isOfficialManufacturerSource(domain, targetCompId);
    const isLeakOrRumor = analysis?.newsType === 'PRODUCT_LEAK' || analysis?.newsType === 'RUMOR' || (analysis?.newsType as string) === 'LEAK';
    const isPrimary = isPrimaryDomain && !isLeakOrRumor;
    return {
      sourceId: art.sourceId,
      sourceName: art.sourceName || art.sourceId,
      domain,
      isPrimarySource: isPrimary,
      isSyndicated: false,
      canonicalUrl: artUrl,
      firstReportedAt: art.publishedAt || new Date().toISOString(),
    };
  });

  // Mark syndicated sources
  for (let i = 0; i < sourceProvenances.length; i++) {
    for (let j = i + 1; j < sourceProvenances.length; j++) {
      if (areSourcesSyndicated(sourceProvenances[i].domain, sourceProvenances[j].domain)) {
        sourceProvenances[j].isSyndicated = true;
      }
    }
  }

  const independentSourceCount = calculateIndependentSourceCount(articles, sourceProvenances);

  // 2. Detect Contradictions across analyses
  let hasContradiction = false;
  const launchStatuses = new Set<string>();
  for (const an of analyses) {
    const text = ((an as any).summary || (an as any).executiveSummary || '').toLowerCase() + ' ' + (an.topics || []).join(' ').toLowerCase();
    if (text.includes('delay') || text.includes('cancelled') || text.includes('postponed') || text.includes('shelved')) {
      launchStatuses.add('DELAYED_OR_CANCELLED');
    }
    if (text.includes('launched') || text.includes('available now') || text.includes('official release')) {
      launchStatuses.add('RELEASED');
    }
    if (text.includes('debunked') || text.includes('false rumor') || text.includes('retraction') || text.includes('corrected')) {
      launchStatuses.add('DEBUNKED');
    }
  }

  if (launchStatuses.has('DELAYED_OR_CANCELLED') && launchStatuses.has('RELEASED')) {
    hasContradiction = true;
    evidenceReasons.push('Conflicting reporting detected: contradictory release availability and postponement signals across sources.');
  } else if (launchStatuses.has('DEBUNKED')) {
    hasContradiction = true;
    evidenceReasons.push('Correction or debunking signal detected in reporting.');
  }

  // 3. Official Announcement Check
  const hasOfficialSource = sourceProvenances.some((p) => p.isPrimarySource);
  const hasOfficialNewsType = analyses.some(
    (an) => (an.newsType as string) === 'ANNOUNCEMENT' || an.newsType === 'PRODUCT_LAUNCH'
  );
  const hasOfficialClaimInSummary = analyses.some((an) => {
    const s = ((an as any).summary || (an as any).executiveSummary || '').toLowerCase();
    return s.includes('officially announced') || s.includes('press release') || s.includes('official statement');
  });

  // 4. Rumor / Leak Check
  const hasRumorSignal = analyses.some((an) => {
    const s = ((an as any).summary || (an as any).executiveSummary || '').toLowerCase() + ' ' + (an.topics || []).join(' ').toLowerCase();
    const isLeakType = an.newsType === 'PRODUCT_LEAK' || an.newsType === 'RUMOR' || (an.newsType as string) === 'LEAK';
    return isLeakType || s.includes('leak') || s.includes('rumor') || s.includes('tipster') || s.includes('alleged') || s.includes('benchmark spotting');
  });

  // 5. Rumor-to-Confirmation Transition
  const previousClassification = existingStory?.evidenceClassification;
  const wasPreviouslyRumor = previousClassification === 'RUMOR_OR_LEAK' || previousClassification === 'UNVERIFIED';

  if (wasPreviouslyRumor && (hasOfficialSource || (hasOfficialNewsType && hasOfficialClaimInSummary && independentSourceCount >= 2))) {
    isRumorConfirmed = true;
    evidenceReasons.push('Rumor-to-confirmation transition: previously unconfirmed rumor verified by official announcement.');
  }

  // Determine Classification & Confidence
  let classification: EvidenceClassification;
  let confidence: number;

  if (hasContradiction) {
    classification = 'CONTRADICTED';
    confidence = 0.45;
  } else if (hasOfficialSource && (!hasRumorSignal || isRumorConfirmed)) {
    classification = 'OFFICIAL_ANNOUNCEMENT';
    confidence = 0.98;
    evidenceReasons.push('Direct official manufacturer announcement confirmed from authoritative domain.');
  } else if (hasOfficialNewsType && hasOfficialClaimInSummary && independentSourceCount >= 2 && (!hasRumorSignal || isRumorConfirmed)) {
    classification = 'OFFICIAL_ANNOUNCEMENT';
    confidence = 0.94;
    evidenceReasons.push('Official manufacturer statement corroborated across multiple independent outlets.');
  } else if (hasRumorSignal && !isRumorConfirmed) {
    // Task 4: Multiple independent publications repeating the same rumor do NOT automatically verify it
    classification = 'RUMOR_OR_LEAK';
    confidence = independentSourceCount >= 3 ? 0.65 : independentSourceCount === 2 ? 0.55 : 0.45;
    evidenceReasons.push(
      independentSourceCount > 1
        ? `Pre-release rumor/leak reported across ${independentSourceCount} independent outlets (unverified until official announcement).`
        : 'Single-source pre-release leak or analyst speculation.'
    );
  } else if (independentSourceCount >= 2) {
    classification = 'MULTI_SOURCE_CORROBORATED';
    confidence = Math.min(0.92, 0.75 + independentSourceCount * 0.05);
    evidenceReasons.push(`Corroborated across ${independentSourceCount} independent tech media outlets.`);
  } else {
    const repAnalysis = analyses[0];
    const isReview = repAnalysis?.newsType === 'REVIEW' || ((repAnalysis as any)?.summary || '').toLowerCase().includes('review');
    if (isReview) {
      classification = 'VERIFIED_REPORT';
      confidence = 0.88;
      evidenceReasons.push('Independent editorial hardware review and hands-on testing.');
    } else {
      classification = 'SINGLE_SOURCE_REPORT';
      confidence = 0.70;
      evidenceReasons.push('Reported by single tech publication; awaiting independent corroboration.');
    }
  }

  // Transparent uncertainty caveat if single-source rumor
  if (classification === 'RUMOR_OR_LEAK' && independentSourceCount === 1) {
    evidenceReasons.push('Evidentiary limitation: Single unverified report; high variance in spec/pricing claims.');
  }

  return {
    evidenceClassification: classification,
    evidenceConfidence: parseFloat(confidence.toFixed(2)),
    evidenceReasons,
    independentSourceCount,
    sourceProvenances,
    hasContradiction,
    isRumorConfirmed,
  };
}

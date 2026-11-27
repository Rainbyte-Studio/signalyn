import {
  ActionableRecommendationItem,
  BriefEvidenceClassification,
  CriticalIntelligenceAlert,
  DailyBriefContent,
  DailyBriefDevelopment,
} from '../types/dailyBrief';

export interface ConsolidatedPriorityDevelopment {
  key: string;
  storyId?: string;
  title: string;
  manufacturer: string;
  category: string;
  productName?: string;
  geographicRelevance?: string;
  evidenceClassification: BriefEvidenceClassification;
  evidenceLabel: string;
  isUnconfirmedRumor: boolean;
  evidenceConfidencePct: number;
  strategicImportanceScore: number;
  competitiveThreatLevel: 'HIGH' | 'ELEVATED' | 'MEDIUM' | 'LOW';
  priorityNatureLabel: string;
  isCriticalAlert: boolean;
  alertType?: 'VERIFIED_CRITICAL_DEVELOPMENT' | 'HIGH_IMPACT_UNCONFIRMED_SIGNAL';
  executiveTakeaway: string;
  whyItMatters: string;
  strategicRecommendation?: string;
  productPositioning?: string;
  strategicAnalysis: string[];
  independentSourceCount: number;
  totalArticlesCount?: number;
  groundedCitations: Array<{
    articleId: string;
    title: string;
    sourceName: string;
    url: string;
    publishedAt: string;
  }>;
}

export type RecommendationBucket = 'IMMEDIATE' | 'MONITOR_INVESTIGATE' | 'OPPORTUNITIES';

export interface ConsolidatedRecommendationItem {
  key: string;
  action: string;
  strategicRationale: string;
  bucket: RecommendationBucket;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  timeHorizon: 'IMMEDIATE' | 'NEAR_TERM' | 'MONITOR';
  confidencePct: number;
  isConditionalInvestigative: boolean;
  actionNatureLabel: string;
  ownerLabel: string;
  geographicScope?: string;
  supportingStoryIds: string[];
  supportingContextLabels: string[];
}

export function normalizeBriefTextKey(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9α-ωάέήίόύώ]+/gi, ' ')
    .trim();
}

export function getEvidenceDisplayMeta(
  classification?: BriefEvidenceClassification,
  confidence?: number
): {
  classification: BriefEvidenceClassification;
  label: string;
  isRumor: boolean;
  confidencePct: number;
} {
  const cls: BriefEvidenceClassification = classification || 'SINGLE_SOURCE_REPORT';
  const isRumor = cls === 'RUMOR_OR_LEAK' || cls === 'CONTRADICTED';
  const defaultConf =
    cls === 'OFFICIAL_ANNOUNCEMENT'
      ? 95
      : cls === 'VERIFIED_REPORT'
      ? 85
      : cls === 'MULTI_SOURCE_CORROBORATED'
      ? 80
      : cls === 'RUMOR_OR_LEAK'
      ? 45
      : 65;

  const confidencePct =
    typeof confidence === 'number'
      ? confidence <= 1
        ? Math.round(confidence * 100)
        : Math.round(confidence)
      : defaultConf;

  const label =
    cls === 'OFFICIAL_ANNOUNCEMENT'
      ? 'Official Announcement'
      : cls === 'VERIFIED_REPORT'
      ? 'Verified Report'
      : cls === 'MULTI_SOURCE_CORROBORATED'
      ? 'Multi-Source Corroborated'
      : cls === 'RUMOR_OR_LEAK'
      ? 'Unverified Rumor / Leak'
      : cls === 'CONTRADICTED'
      ? 'Contradicted / Debunked'
      : 'Single-Source Report';

  return {
    classification: cls,
    label,
    isRumor,
    confidencePct,
  };
}

function inferManufacturerFromText(title: string, fallback?: string): string {
  if (fallback && fallback.trim() && fallback.toLowerCase() !== 'unknown') {
    return fallback.trim();
  }
  const t = (title || '').toUpperCase();
  if (t.includes('SAMSUNG') || t.includes('GALAXY')) return 'Samsung';
  if (t.includes('APPLE') || t.includes('IPHONE') || t.includes('IPAD') || t.includes('AIRPODS')) return 'Apple';
  if (t.includes('XIAOMI') || t.includes('REDMI') || t.includes('POCO')) return 'Xiaomi';
  if (t.includes('HONOR') || t.includes('MAGIC')) return 'HONOR';
  if (t.includes('GOOGLE') || t.includes('PIXEL')) return 'Google';
  if (t.includes('GARMIN') || t.includes('FENIX') || t.includes('FORERUNNER')) return 'Garmin';
  if (t.includes('OPPO') || t.includes('FIND X')) return 'OPPO';
  if (t.includes('ONEPLUS')) return 'OnePlus';
  if (t.includes('VIVO')) return 'vivo';
  if (t.includes('SONY')) return 'Sony';
  if (t.includes('MOTOROLA') || t.includes('RAZR')) return 'Motorola';
  if (t.includes('NOTHING')) return 'Nothing';
  if (t.includes('LENOVO')) return 'Lenovo';
  if (t.includes('HUAWEI') || t.includes('PURA') || t.includes('MATE')) return 'HUAWEI';
  return 'Industry / Multi-Vendor';
}

/**
 * Consolidates and deduplicates `criticalAlerts` and `headlineDevelopments`
 * so each story or development appears once in the Priority Developments section
 * with separated Evidence Confidence vs. Potential Strategic Impact.
 */
export function buildConsolidatedPriorityDevelopments(
  content: DailyBriefContent | null | undefined
): ConsolidatedPriorityDevelopment[] {
  if (!content) return [];

  const byKey = new Map<string, ConsolidatedPriorityDevelopment>();
  const alerts: CriticalIntelligenceAlert[] = content.criticalAlerts || [];
  const devs: DailyBriefDevelopment[] = content.headlineDevelopments || [];

  // Map critical alerts by storyId and normalized headline
  const alertByStoryId = new Map<string, CriticalIntelligenceAlert>();
  const alertByHeadline = new Map<string, CriticalIntelligenceAlert>();
  for (const alert of alerts) {
    if (alert.storyId) alertByStoryId.set(alert.storyId, alert);
    alertByHeadline.set(normalizeBriefTextKey(alert.headline), alert);
  }

  // 1. Ingest full headlineDevelopments first (richer citations & analysis)
  for (const dev of devs) {
    const key = dev.storyId || `title:${normalizeBriefTextKey(dev.title)}`;
    if (byKey.has(key)) continue;

    const matchedAlert =
      (dev.storyId ? alertByStoryId.get(dev.storyId) : undefined) ||
      alertByHeadline.get(normalizeBriefTextKey(dev.title));

    const evMeta = getEvidenceDisplayMeta(
      dev.evidenceClassification || matchedAlert?.evidenceClassification,
      dev.evidenceConfidence ?? matchedAlert?.evidenceConfidence
    );

    const score =
      dev.strategicImportanceScore ??
      matchedAlert?.strategicImportanceScore ??
      (dev.competitiveThreatLevel === 'HIGH' ? 85 : dev.competitiveThreatLevel === 'ELEVATED' ? 72 : 60);

    const isCriticalAlert = Boolean(matchedAlert) || score >= 80 || dev.competitiveThreatLevel === 'HIGH';
    const alertType =
      matchedAlert?.alertType ||
      (evMeta.isRumor ? 'HIGH_IMPACT_UNCONFIRMED_SIGNAL' : 'VERIFIED_CRITICAL_DEVELOPMENT');

    const priorityNatureLabel = evMeta.isRumor
      ? 'Monitor / Investigate (Unconfirmed Signal)'
      : isCriticalAlert
      ? 'Verified Priority Development'
      : 'Tracked Industry Development';

    byKey.set(key, {
      key,
      storyId: dev.storyId || matchedAlert?.storyId,
      title: dev.title,
      manufacturer: inferManufacturerFromText(dev.title, matchedAlert?.competitorName),
      category: dev.category || matchedAlert?.category || 'Strategic Hardware',
      productName: dev.productName || matchedAlert?.productName,
      geographicRelevance: dev.geographicRelevance,
      evidenceClassification: evMeta.classification,
      evidenceLabel: evMeta.label,
      isUnconfirmedRumor: evMeta.isRumor,
      evidenceConfidencePct: evMeta.confidencePct,
      strategicImportanceScore: score,
      competitiveThreatLevel:
        (dev.competitiveThreatLevel as any) ||
        (matchedAlert as any)?.competitiveThreatLevel ||
        (matchedAlert as any)?.threatLevel ||
        'MEDIUM',
      priorityNatureLabel,
      isCriticalAlert,
      alertType,
      executiveTakeaway:
        dev.executiveTakeaway ||
        matchedAlert?.whyItMatters ||
        (matchedAlert as any)?.whyItMattersToHuawei ||
        '',
      whyItMatters:
        dev.implicationForHuawei ||
        matchedAlert?.whyItMatters ||
        (matchedAlert as any)?.whyItMattersToHuawei ||
        '',
      strategicRecommendation: dev.strategicRecommendation || matchedAlert?.recommendedAction,
      productPositioning: dev.productPositioning,
      strategicAnalysis: dev.strategicAnalysis || [],
      independentSourceCount:
        dev.reportingBreadth?.independentSources ??
        dev.independentSourceCount ??
        matchedAlert?.independentSourceCount ??
        1,
      totalArticlesCount: dev.reportingBreadth?.totalArticles,
      groundedCitations: dev.groundedCitations || [],
    });
  }

  // 2. Add any criticalAlerts that were not already in headlineDevelopments
  for (const alert of alerts) {
    const key = alert.storyId || `title:${normalizeBriefTextKey(alert.headline)}`;
    const titleKey = `title:${normalizeBriefTextKey(alert.headline)}`;
    const alreadyExists =
      byKey.has(key) ||
      Array.from(byKey.values()).some(
        (existing) =>
          (alert.storyId && existing.storyId === alert.storyId) ||
          normalizeBriefTextKey(existing.title) === normalizeBriefTextKey(alert.headline) ||
          existing.key === titleKey
      );
    if (alreadyExists) continue;

    const evMeta = getEvidenceDisplayMeta(alert.evidenceClassification as any, alert.evidenceConfidence);
    const whyText = alert.whyItMatters || (alert as any).whyItMattersToHuawei || '';
    const threatLvl = (alert.competitiveThreatLevel || (alert as any).threatLevel || 'HIGH') as
      | 'HIGH'
      | 'ELEVATED'
      | 'MEDIUM'
      | 'LOW';
    byKey.set(key, {
      key,
      storyId: alert.storyId,
      title: alert.headline,
      manufacturer: inferManufacturerFromText(alert.headline, alert.competitorName),
      category: alert.category,
      productName: alert.productName,
      evidenceClassification: evMeta.classification,
      evidenceLabel: evMeta.label,
      isUnconfirmedRumor: evMeta.isRumor,
      evidenceConfidencePct: evMeta.confidencePct,
      strategicImportanceScore: alert.strategicImportanceScore,
      competitiveThreatLevel: threatLvl,
      priorityNatureLabel: evMeta.isRumor
        ? 'Monitor / Investigate (Unconfirmed Signal)'
        : 'Verified Priority Development',
      isCriticalAlert: true,
      alertType: alert.alertType,
      executiveTakeaway: whyText,
      whyItMatters: whyText,
      strategicRecommendation: alert.recommendedAction,
      strategicAnalysis: [],
      independentSourceCount: alert.independentSourceCount,
      groundedCitations: alert.groundedCitations || [],
    });
  }

  return Array.from(byKey.values()).sort((a, b) => {
    // Sort verified critical developments first, then by strategicImportanceScore descending
    if (a.isCriticalAlert !== b.isCriticalAlert) {
      return a.isCriticalAlert ? -1 : 1;
    }
    return b.strategicImportanceScore - a.strategicImportanceScore;
  });
}

function formatOwnerTeam(team?: ActionableRecommendationItem['targetTeam']): string {
  if (team === 'RETAIL_CHANNEL') return 'Retail & Channel';
  if (team === 'MARKETING_PR') return 'Marketing & PR';
  if (team === 'PRODUCT_STRATEGY') return 'Product Strategy';
  if (team === 'COMPETITIVE_WATCH') return 'Competitive Watch';
  return 'Strategy & Competitive Watch';
}

/**
 * Consolidates and deduplicates recommendations across `actionableRecommendations`
 * and `strategicImplicationsForHuawei`, grouping them into Immediate Actions,
 * Monitor / Investigate, and Longer-Term Opportunities while distinguishing
 * verified actions from investigative/conditional actions for low-confidence rumors.
 */
export function buildConsolidatedRecommendations(
  content: DailyBriefContent | null | undefined,
  priorityDevelopments?: ConsolidatedPriorityDevelopment[]
): ConsolidatedRecommendationItem[] {
  if (!content) return [];

  const devs = priorityDevelopments || buildConsolidatedPriorityDevelopments(content);
  const devByStoryId = new Map<string, ConsolidatedPriorityDevelopment>();
  for (const d of devs) {
    if (d.storyId) devByStoryId.set(d.storyId, d);
  }

  const byActionKey = new Map<string, ConsolidatedRecommendationItem>();

  for (const rec of content.actionableRecommendations || []) {
    const normAction = normalizeBriefTextKey(rec.action);
    if (!normAction) continue;

    // Determine if any supporting story is an unconfirmed rumor
    const linkedDevs = (rec.supportingStoryIds || [])
      .map((id) => devByStoryId.get(id))
      .filter(Boolean) as ConsolidatedPriorityDevelopment[];

    const isBackedOnlyByRumor =
      linkedDevs.length > 0 && linkedDevs.every((d) => d.isUnconfirmedRumor);

    const rawConfidencePct =
      typeof rec.confidenceLevel === 'number'
        ? rec.confidenceLevel <= 1
          ? Math.round(rec.confidenceLevel * 100)
          : Math.round(rec.confidenceLevel)
        : isBackedOnlyByRumor
        ? 45
        : 80;

    const isConditionalInvestigative =
      isBackedOnlyByRumor ||
      rawConfidencePct < 65 ||
      rec.timeHorizon === 'MONITOR' ||
      rec.action.toLowerCase().includes('monitor') ||
      rec.action.toLowerCase().includes('verify');

    const bucket: RecommendationBucket = isConditionalInvestigative
      ? 'MONITOR_INVESTIGATE'
      : rec.timeHorizon === 'IMMEDIATE'
      ? 'IMMEDIATE'
      : 'OPPORTUNITIES';

    const contextLabel = `${rec.competitorName}${rec.productName ? ` (${rec.productName})` : ''} • ${rec.category}`;

    if (byActionKey.has(normAction)) {
      const existing = byActionKey.get(normAction)!;
      for (const sid of rec.supportingStoryIds || []) {
        if (!existing.supportingStoryIds.includes(sid)) {
          existing.supportingStoryIds.push(sid);
        }
      }
      if (!existing.supportingContextLabels.includes(contextLabel)) {
        existing.supportingContextLabels.push(contextLabel);
      }
      continue;
    }

    byActionKey.set(normAction, {
      key: normAction,
      action: rec.action,
      strategicRationale: rec.strategicRationale,
      bucket,
      priority: rec.priority as any,
      timeHorizon: rec.timeHorizon,
      confidencePct: rawConfidencePct,
      isConditionalInvestigative,
      actionNatureLabel: isConditionalInvestigative
        ? 'Investigative / Conditional on Signal Confirmation'
        : 'Verified Strategic Action',
      ownerLabel: formatOwnerTeam(rec.targetTeam),
      geographicScope: rec.geographicScope,
      supportingStoryIds: [...(rec.supportingStoryIds || [])],
      supportingContextLabels: [contextLabel],
    });
  }

  // Also fold in unique items from strategicImplicationsForHuawei if no structured recommendations exist
  if (byActionKey.size === 0 && content.strategicImplicationsForHuawei) {
    const playbook = content.strategicImplicationsForHuawei;
    for (const act of playbook.immediateActions || []) {
      const key = normalizeBriefTextKey(act);
      if (!key || byActionKey.has(key)) continue;
      byActionKey.set(key, {
        key,
        action: act,
        strategicRationale: 'Immediate tactical action from Executive Playbook synthesis.',
        bucket: 'IMMEDIATE',
        priority: 'HIGH',
        timeHorizon: 'IMMEDIATE',
        confidencePct: 80,
        isConditionalInvestigative: false,
        actionNatureLabel: 'Verified Strategic Action',
        ownerLabel: 'Retail & Channel / Marketing',
        supportingStoryIds: [],
        supportingContextLabels: ['Executive Playbook'],
      });
    }
    for (const watch of playbook.mediumTermWatch || []) {
      const key = normalizeBriefTextKey(watch);
      if (!key || byActionKey.has(key)) continue;
      byActionKey.set(key, {
        key,
        action: watch,
        strategicRationale: 'Medium-term competitive watch item.',
        bucket: 'MONITOR_INVESTIGATE',
        priority: 'MEDIUM',
        timeHorizon: 'MONITOR',
        confidencePct: 60,
        isConditionalInvestigative: true,
        actionNatureLabel: 'Investigative / Conditional on Signal Confirmation',
        ownerLabel: 'Competitive Watch',
        supportingStoryIds: [],
        supportingContextLabels: ['Executive Playbook'],
      });
    }
    for (const opp of playbook.opportunities || []) {
      const key = normalizeBriefTextKey(opp);
      if (!key || byActionKey.has(key)) continue;
      byActionKey.set(key, {
        key,
        action: opp,
        strategicRationale: 'Strategic positioning opportunity identified in 24h window.',
        bucket: 'OPPORTUNITIES',
        priority: 'HIGH',
        timeHorizon: 'NEAR_TERM',
        confidencePct: 75,
        isConditionalInvestigative: false,
        actionNatureLabel: 'Verified Strategic Action',
        ownerLabel: 'Product Strategy',
        supportingStoryIds: [],
        supportingContextLabels: ['Executive Playbook'],
      });
    }
  }

  return Array.from(byActionKey.values());
}

// ============================================================================
// Phase P2.3.1 F01: Daily Brief Read Reliability & 5-State Resolution Helpers
// ============================================================================

export type DailyBriefViewState =
  | 'LOADING'
  | 'LOADED'
  | 'NOT_FOUND'
  | 'READ_ERROR'
  | 'PUBLISHED_METADATA_MISMATCH';

export type DailyBriefReadErrorKind =
  | 'HTML_FALLBACK'
  | 'UNAUTHORIZED'
  | 'SERVER_ERROR'
  | 'INVALID_JSON'
  | 'UNEXPECTED_DATE'
  | 'NETWORK_ERROR';

export interface DailyBriefReadErrorInfo {
  kind: DailyBriefReadErrorKind;
  status?: number;
  userMessage: string;
  diagnosticDetail: string;
}

export interface DailyBriefHttpClassification {
  outcome: 'LOADED' | 'NOT_FOUND' | 'PUBLISHED_METADATA_MISMATCH' | 'READ_ERROR';
  brief: any | null;
  resolvedDate?: string;
  error?: DailyBriefReadErrorInfo;
}

/**
 * Resolves localized DailyBriefContent (`en` / `el`) from either the canonical
 * Firestore schema (`briefDoc.en` / `briefDoc.el`) or legacy client schema (`contentEn` / `contentEl`).
 */
export function resolveBriefLocalizedContent(
  briefDoc: any | null | undefined,
  language: 'en' | 'el'
): DailyBriefContent | null {
  if (!briefDoc || typeof briefDoc !== 'object') return null;
  if (language === 'el') {
    return briefDoc.el || briefDoc.contentEl || briefDoc.en || briefDoc.contentEn || null;
  }
  return briefDoc.en || briefDoc.contentEn || briefDoc.el || briefDoc.contentEl || null;
}

/**
 * Normalizes `dayOverDayDelta` across both canonical `DailyBriefDelta` (`summary`, `changes`)
 * and legacy fixture shapes (`newDevelopments`, `materialUpdates`, `escalatingDevelopments`, `resolvedOrDeEscalated`).
 */
export interface NormalizedBriefDeltaDisplay {
  hasBaselineData: boolean;
  previousBriefDate?: string;
  summaryStatement: string;
  counts: {
    newCount: number;
    materialUpdateCount: number;
    escalatingCount: number;
    resolvedCount: number;
  };
  items: Array<{
    storyId: string;
    headline: string;
    deltaClassification:
      | 'NEW_DEVELOPMENT'
      | 'MATERIAL_UPDATE'
      | 'ESCALATING_DEVELOPMENT'
      | 'RESOLVED_OR_DE_ESCALATED';
    deltaReason: string;
    previousImportanceScore?: number;
    currentImportanceScore: number;
  }>;
}

export function normalizeBriefDeltaForDisplay(delta: any | null | undefined): NormalizedBriefDeltaDisplay | null {
  if (!delta || typeof delta !== 'object') return null;

  // Canonical schema (`summary` + `changes`)
  if (Array.isArray(delta.changes) || delta.summary) {
    const changes: any[] = Array.isArray(delta.changes) ? delta.changes : [];
    const newCount =
      delta.summary?.newCount ?? changes.filter((c) => c.deltaType === 'NEW_DEVELOPMENT').length;
    const materialUpdateCount =
      delta.summary?.materialUpdateCount ??
      changes.filter((c) => c.deltaType === 'MATERIAL_UPDATE').length;
    const escalatingCount =
      delta.summary?.escalatingCount ??
      changes.filter((c) => c.deltaType === 'ESCALATING_DEVELOPMENT').length;
    const resolvedCount =
      delta.summary?.resolvedCount ??
      changes.filter((c) => c.deltaType === 'RESOLVED_OR_DE_ESCALATED').length;

    const summaryStatement =
      delta.summaryStatement ||
      (delta.hasBaselineData
        ? `Compared against ${delta.previousBriefDate || 'prior baseline'}: ${newCount} new developments, ${materialUpdateCount} material updates, ${escalatingCount} escalations, and ${resolvedCount} de-escalations.`
        : delta.insufficientDataReason ||
          'Insufficient historical baseline data for day-over-day comparison.');

    const items = changes.map((c) => ({
      storyId: c.storyId || '',
      headline: c.title || c.headline || 'Tracked Development',
      deltaClassification: (c.deltaType || c.deltaClassification || 'NEW_DEVELOPMENT') as
        | 'NEW_DEVELOPMENT'
        | 'MATERIAL_UPDATE'
        | 'ESCALATING_DEVELOPMENT'
        | 'RESOLVED_OR_DE_ESCALATED',
      deltaReason: c.description || c.deltaReason || '',
      previousImportanceScore:
        c.previousState?.strategicImportanceScore ?? c.previousImportanceScore,
      currentImportanceScore:
        c.currentState?.strategicImportanceScore ?? c.currentImportanceScore ?? 0,
    }));

    return {
      hasBaselineData: Boolean(delta.hasBaselineData),
      previousBriefDate: delta.previousBriefDate,
      summaryStatement,
      counts: {
        newCount,
        materialUpdateCount,
        escalatingCount,
        resolvedCount,
      },
      items,
    };
  }

  // Legacy fixture schema (`newDevelopments`, `materialUpdates`, `escalatingDevelopments`, `resolvedOrDeEscalated`)
  const escalating = Array.isArray(delta.escalatingDevelopments) ? delta.escalatingDevelopments : [];
  const newDevs = Array.isArray(delta.newDevelopments) ? delta.newDevelopments : [];
  const updates = Array.isArray(delta.materialUpdates) ? delta.materialUpdates : [];
  const resolved = Array.isArray(delta.resolvedOrDeEscalated) ? delta.resolvedOrDeEscalated : [];
  const combined = [...escalating, ...newDevs, ...updates, ...resolved];

  return {
    hasBaselineData: Boolean(delta.hasBaselineData),
    previousBriefDate: delta.previousBriefDate,
    summaryStatement:
      delta.summaryStatement ||
      (delta.hasBaselineData
        ? `Compared against ${delta.previousBriefDate || 'prior baseline'}: ${newDevs.length} new, ${updates.length} updated, ${escalating.length} escalations.`
        : 'Insufficient historical baseline data for day-over-day comparison.'),
    counts: {
      newCount: newDevs.length,
      materialUpdateCount: updates.length,
      escalatingCount: escalating.length,
      resolvedCount: resolved.length,
    },
    items: combined.map((item: any) => ({
      storyId: item.storyId || '',
      headline: item.headline || item.title || 'Tracked Development',
      deltaClassification: (item.deltaClassification || item.deltaType || 'NEW_DEVELOPMENT') as
        | 'NEW_DEVELOPMENT'
        | 'MATERIAL_UPDATE'
        | 'ESCALATING_DEVELOPMENT'
        | 'RESOLVED_OR_DE_ESCALATED',
      deltaReason: item.deltaReason || item.description || '',
      previousImportanceScore: item.previousImportanceScore ?? item.previousState?.strategicImportanceScore,
      currentImportanceScore: item.currentImportanceScore ?? item.currentState?.strategicImportanceScore ?? 0,
    })),
  };
}

/**
 * Checks whether a target date is marked as PUBLISHED in the archive metadata list.
 */
export function isDateMarkedPublishedInArchive(
  targetDate: string | undefined,
  archiveList: Array< { date?: string; status?: string } > | undefined
): boolean {
  if (!targetDate || !Array.isArray(archiveList)) return false;
  return archiveList.some(
    (entry) => entry.date === targetDate && entry.status === 'PUBLISHED'
  );
}

/**
 * Safely classifies a Daily Brief HTTP response before attempting to render.
 * Explicitly detects HTML fallback responses (`<!doctype html>`), 401/403, 404, 5xx,
 * malformed JSON, and Published Metadata Mismatch without exposing raw HTML to users.
 */
export function classifyDailyBriefHttpResponse(input: {
  status: number;
  ok: boolean;
  contentType: string | null;
  rawBody: string;
  requestedDate?: string;
  archiveList?: Array<{ date?: string; status?: string }>;
}): DailyBriefHttpClassification {
  const { status, ok, contentType, rawBody, requestedDate, archiveList } = input;
  const trimmedBody = (rawBody || '').trim();
  const lowerContentType = (contentType || '').toLowerCase();
  const isHtmlPayload =
    lowerContentType.includes('text/html') ||
    trimmedBody.toLowerCase().startsWith('<!doctype') ||
    trimmedBody.toLowerCase().startsWith('<html');

  // 1. Guard against HTML fallback (e.g. SPA index.html returned on unmatched route)
  if (isHtmlPayload) {
    return {
      outcome: 'READ_ERROR',
      brief: null,
      resolvedDate: requestedDate,
      error: {
        kind: 'HTML_FALLBACK',
        status,
        userMessage:
          'Unable to load Daily Intelligence Brief: the server returned an HTML fallback response instead of JSON brief data.',
        diagnosticDetail: `Expected application/json from Daily Brief endpoint, received ${
          contentType || 'HTML document'
        } (HTTP ${status}).`,
      },
    };
  }

  // 2. Explicit 401 / 403 authentication / authorization error
  if (status === 401 || status === 403) {
    return {
      outcome: 'READ_ERROR',
      brief: null,
      resolvedDate: requestedDate,
      error: {
        kind: 'UNAUTHORIZED',
        status,
        userMessage:
          'Unable to load Daily Intelligence Brief due to an authentication or access permission check (HTTP ' +
          status +
          ').',
        diagnosticDetail: `HTTP ${status} returned while reading Daily Brief.`,
      },
    };
  }

  // 3. Explicit 404 Not Found
  if (status === 404) {
    const isPublishedInArchive = isDateMarkedPublishedInArchive(requestedDate, archiveList);
    return {
      outcome: isPublishedInArchive ? 'PUBLISHED_METADATA_MISMATCH' : 'NOT_FOUND',
      brief: null,
      resolvedDate: requestedDate,
    };
  }

  // 4. Server 5xx or other non-OK HTTP status
  if (!ok || status >= 500) {
    return {
      outcome: 'READ_ERROR',
      brief: null,
      resolvedDate: requestedDate,
      error: {
        kind: 'SERVER_ERROR',
        status,
        userMessage: `Unable to load Daily Intelligence Brief from authoritative storage (HTTP ${status}).`,
        diagnosticDetail: `Server returned HTTP ${status} while reading Daily Brief.`,
      },
    };
  }

  // 5. Parse JSON safely
  let parsed: any;
  try {
    parsed = JSON.parse(trimmedBody);
  } catch {
    return {
      outcome: 'READ_ERROR',
      brief: null,
      resolvedDate: requestedDate,
      error: {
        kind: 'INVALID_JSON',
        status,
        userMessage:
          'Unable to load Daily Intelligence Brief: received a malformed JSON response from the server.',
        diagnosticDetail: `JSON.parse failed on HTTP ${status} response payload.`,
      },
    };
  }

  // 6. Unwrap either `{ found, brief }` envelope or direct `DailyBriefDocument`
  if (parsed && typeof parsed === 'object') {
    const responseDate = parsed.brief?.date ?? parsed.date;
    if (requestedDate && responseDate && requestedDate !== responseDate) {
      return {
        outcome: 'READ_ERROR',
        brief: null,
        resolvedDate: requestedDate,
        error: {
          kind: 'UNEXPECTED_DATE',
          status,
          userMessage: 'The server returned a different Daily Brief date. Retry to load the selected date.',
          diagnosticDetail: `Expected ${requestedDate}, received ${responseDate}.`,
        },
      };
    }
    if (parsed.found === false && !parsed.brief) {
      const targetDate = parsed.date || requestedDate;
      const isPublishedInArchive = isDateMarkedPublishedInArchive(targetDate, archiveList);
      return {
        outcome: isPublishedInArchive ? 'PUBLISHED_METADATA_MISMATCH' : 'NOT_FOUND',
        brief: null,
        resolvedDate: targetDate,
      };
    }

    const candidateBrief = parsed.brief && typeof parsed.brief === 'object' ? parsed.brief : parsed;
    const hasContent = Boolean(
      resolveBriefLocalizedContent(candidateBrief, 'en') ||
        resolveBriefLocalizedContent(candidateBrief, 'el')
    );

    if (candidateBrief && candidateBrief.date && hasContent) {
      return {
        outcome: 'LOADED',
        brief: candidateBrief,
        resolvedDate: candidateBrief.date,
      };
    }

    // Document returned without localized content
    const targetDate = candidateBrief?.date || requestedDate;
    if (isDateMarkedPublishedInArchive(targetDate, archiveList) || candidateBrief?.status === 'PUBLISHED') {
      return {
        outcome: 'PUBLISHED_METADATA_MISMATCH',
        brief: null,
        resolvedDate: targetDate,
      };
    }

    return {
      outcome: 'NOT_FOUND',
      brief: null,
      resolvedDate: targetDate,
    };
  }

  return {
    outcome: 'NOT_FOUND',
    brief: null,
    resolvedDate: requestedDate,
  };
}

/**
 * Resolves the authoritative 5-state UI state for `DailyBriefView.tsx`.
 */
export function resolveDailyBriefViewState(params: {
  isLoading: boolean;
  briefDoc: any | null;
  activeContent: DailyBriefContent | null;
  readError: DailyBriefReadErrorInfo | null;
  selectedDate: string;
  archiveList: Array<{ date?: string; status?: string }>;
}): DailyBriefViewState {
  if (params.isLoading) {
    return 'LOADING';
  }
  if (params.readError) {
    return 'READ_ERROR';
  }
  if (params.briefDoc && params.activeContent) {
    return 'LOADED';
  }
  const effectiveDate = params.selectedDate || params.archiveList?.[0]?.date;
  if (isDateMarkedPublishedInArchive(effectiveDate, params.archiveList)) {
    return 'PUBLISHED_METADATA_MISMATCH';
  }
  return 'NOT_FOUND';
}

/**
 * Resolves the synchronized Reporting Date label for the header bar so it never
 * displays `Latest` when a specific archive date is selected or loaded.
 */
export function resolveBriefReportingDate(params: {
  briefDoc: { date?: string } | null;
  selectedDate: string;
  archiveList: Array<{ date?: string }>;
}): string {
  if (params.briefDoc?.date) {
    return params.briefDoc.date;
  }
  if (params.selectedDate && params.selectedDate.trim()) {
    return params.selectedDate.trim();
  }
  if (params.archiveList && params.archiveList.length > 0 && params.archiveList[0]?.date) {
    return params.archiveList[0].date;
  }
  return 'Latest';
}


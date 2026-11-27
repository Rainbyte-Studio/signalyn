/**
 * SIGNALYN — Daily Brief Delta & Executive Intelligence Service (Phase P1)
 *
 * Deterministic domain service providing:
 * 1. Critical Intelligence Alerts derivation with rumor safeguarding.
 * 2. Day-over-Day Delta calculation (calculateBriefDelta) with safe historical baselines.
 * 3. Prioritized Opportunities & Threats tiering (Critical, High, Medium, Monitoring).
 * 4. Structured Actionable Recommendations for HUAWEI.
 * 5. Strategic Hardware Domain Overview across 4 canonical hardware categories.
 * 6. Story snapshot creation for deterministic persistence and future delta comparisons.
 */

import {
  DailyBriefDocument,
  DailyBriefSectionContent,
  CriticalIntelligenceAlert,
  DailyBriefDelta,
  BriefDeltaItem,
  PrioritizedOpportunitiesThreats,
  PrioritizedStrategicItem,
  ActionableRecommendation,
  StrategicHardwareDomainOverview,
  BriefStorySnapshot,
} from '../types/dailyBrief';
import { Story, EvidenceClassification } from '../types';
import { getStoryCanonicalCategories, CanonicalDeviceCategory } from '../utils/categoryModel';

function isWithinAthensReportingWindow(
  isoTimestamp?: string | null,
  windowStartIso?: string | null,
  windowEndIso?: string | null
): boolean {
  if (!isoTimestamp || !windowStartIso || !windowEndIso) return false;
  const time = new Date(isoTimestamp).getTime();
  if (isNaN(time)) return false;
  const start = new Date(windowStartIso).getTime();
  const end = new Date(windowEndIso).getTime();
  return time >= start && time <= end;
}

const STRATEGIC_CATEGORIES = new Set<CanonicalDeviceCategory>([
  'SMARTPHONE',
  'WEARABLE',
  'AUDIO',
  'TABLET',
]);

/**
 * Derives Critical Intelligence Alerts from current candidate Stories,
 * or fallback developments when in ARTICLE_FALLBACK mode.
 * Eligibility:
 * - strategicImportanceScore >= 80 OR competitiveThreatLevel === 'HIGH'
 * - Belongs to 4 strategic hardware domains
 * - Deduplicated by story ID
 * Safeguards:
 * - Distinguishes 'VERIFIED_CRITICAL_DEVELOPMENT' from 'HIGH_IMPACT_UNCONFIRMED_SIGNAL'
 * - Rumors and leaks remain visibly labeled as unconfirmed
 * - Returns [] if no stories qualify (never manufactures artificial alerts)
 */
export function deriveCriticalAlerts(
  stories: Story[],
  targetCompanyId: string = 'comp-huawei',
  fallbackDevelopments?: DailyBriefSectionContent[]
): CriticalIntelligenceAlert[] {
  const alerts: CriticalIntelligenceAlert[] = [];
  const seenStoryIds = new Set<string>();

  if (stories && stories.length > 0) {
    for (const story of stories) {
      if (!story.id || seenStoryIds.has(story.id)) continue;

      // Check strategic hardware category scope
      const cats = Array.from(getStoryCanonicalCategories(story));
      const isStrategic = cats.some((c) => STRATEGIC_CATEGORIES.has(c));
      if (!isStrategic) continue;

      const strategicScore = typeof story.strategicImportanceScore === 'number'
        ? story.strategicImportanceScore
        : (story.importanceScore || 0);

      const threatLevel = story.competitiveThreatLevel || 'MEDIUM';

      // Eligibility condition: score >= 80 OR threat === HIGH
      const isEligible = strategicScore >= 80 || threatLevel === 'HIGH';
      if (!isEligible) continue;

      seenStoryIds.add(story.id);

      const evClass = (story.evidenceClassification || 'SINGLE_SOURCE_REPORT') as EvidenceClassification | 'UNVERIFIED';
      const evConfidence = typeof story.evidenceConfidence === 'number' ? story.evidenceConfidence : 0.75;
      const isRumorOrUnverified = evClass === 'RUMOR_OR_LEAK' || evClass === 'UNVERIFIED' || evConfidence < 0.60;

      const compName = (story.companies && story.companies[0]?.name) ||
        (story as any).primaryCompany ||
        (story.primaryCompanyId ? story.primaryCompanyId.replace(/^comp-/, '').toUpperCase() : 'Competitor');
      const compId = story.primaryCompanyId || (story.companies && story.companies[0]?.companyId);

      const mainCategory = cats[0] || 'SMARTPHONE';
      const categoryLabel =
        mainCategory === 'SMARTPHONE' ? 'Smartphones & Foldables'
        : mainCategory === 'WEARABLE' ? 'Wearables & Smartwatches'
        : mainCategory === 'AUDIO' ? 'Audio & TWS'
        : 'Tablets';

      const alertType: 'VERIFIED_CRITICAL_DEVELOPMENT' | 'HIGH_IMPACT_UNCONFIRMED_SIGNAL' =
        isRumorOrUnverified ? 'HIGH_IMPACT_UNCONFIRMED_SIGNAL' : 'VERIFIED_CRITICAL_DEVELOPMENT';

      const headline = story.canonicalTitle || story.title || 'Critical Strategic Development';

      // Detect product name and geographic scope from story headline/summary
      const titleText = story.canonicalTitle || story.title || '';
      const productMatch = titleText.match(/(?:Galaxy\s+(?:S|Z|Fold|Flip|A|M|F)\d+(?:\s+(?:Ultra|Plus|Pro|FE|Max))?|Pura\s+\d+(?:\s+(?:Ultra|Pro|Plus))?|Mate\s+\d+(?:\s+(?:Pro|RS|X\d*))?|Pixel\s+\d+(?:\s+(?:Pro|a|Fold))?|iPhone\s+\d+(?:\s+(?:Pro\s+Max|Pro|Plus|mini))?|Xiaomi\s+\d+(?:\s+(?:Ultra|Pro|T))?|LinkBuds(?:\s+(?:Open|Fit|S))?|QuietComfort(?:\s+(?:Ultra|Earbuds))?|Pad\s+\d+(?:\s+(?:Pro|Plus))?|Fenix\s+\d+(?:\s+Pro)?|Honor\s+\d+(?:\s+Pro)?)/i);
      const productName = productMatch ? productMatch[0].trim() : undefined;
      const geographicScope = /europe|eu|greece|greek|athens/i.test(titleText + ' ' + (story.summary || '')) ? 'Europe' : 'Global';

      const whyItMatters = story.huaweiRelevance ||
        story.competitiveImplication ||
        `Direct competitive pressure in ${categoryLabel} requiring active market response.`;

      const recommendedAction = story.strategicRecommendation ||
        `Evaluate EU retail channel positioning, promotional cadence, and feature differentiation against ${compName}.`;

      alerts.push({
        storyId: story.id,
        headline,
        competitorName: compName,
        competitorId: compId,
        productName,
        geographicScope,
        category: categoryLabel,
        strategicImportanceScore: strategicScore,
        competitiveThreatLevel: threatLevel,
        evidenceClassification: evClass,
        evidenceConfidence: evConfidence,
        independentSourceCount: story.independentSourceCount || story.sourceCount || 1,
        whyItMatters,
        recommendedAction,
        isUnconfirmedSignal: isRumorOrUnverified,
        alertType,
      });
    }
  } else if (fallbackDevelopments && fallbackDevelopments.length > 0) {
    // Fallback derivation for ARTICLE_FALLBACK mode when no multi-article story clusters exist
    for (const dev of fallbackDevelopments) {
      const strategicScore = typeof dev.strategicImportanceScore === 'number'
        ? dev.strategicImportanceScore
        : 50;
      const threatLevel = dev.competitiveThreatLevel || 'MEDIUM';
      const isEligible = strategicScore >= 80 || threatLevel === 'HIGH';
      if (!isEligible) continue;

      const compName = (dev.trackedCompetitors && dev.trackedCompetitors[0]) || 'Competitor';
      const evClass = (dev.evidenceClassification || 'SINGLE_SOURCE_REPORT') as EvidenceClassification | 'UNVERIFIED';
      const evConfidence = typeof dev.evidenceConfidence === 'number' ? dev.evidenceConfidence : 0.75;
      const isRumorOrUnverified = evClass === 'RUMOR_OR_LEAK' || evClass === 'UNVERIFIED' || evConfidence < 0.60;

      const alertType = isRumorOrUnverified ? 'HIGH_IMPACT_UNCONFIRMED_SIGNAL' : 'VERIFIED_CRITICAL_DEVELOPMENT';
      const idKey = dev.storyId || dev.title;
      if (seenStoryIds.has(idKey)) continue;
      seenStoryIds.add(idKey);

      alerts.push({
        storyId: dev.storyId,
        headline: dev.title,
        competitorName: compName,
        category: dev.category,
        strategicImportanceScore: strategicScore,
        competitiveThreatLevel: threatLevel,
        evidenceClassification: evClass,
        evidenceConfidence: evConfidence,
        independentSourceCount: dev.independentSourceCount || 1,
        whyItMatters: dev.implicationForHuawei || `Strategic development in ${dev.category}.`,
        recommendedAction: dev.strategicRecommendation || `Monitor competitor movement from ${compName}.`,
        isUnconfirmedSignal: isRumorOrUnverified,
        alertType,
      });
    }
  }

  // Sort alerts by strategic importance score descending
  alerts.sort((a, b) => b.strategicImportanceScore - a.strategicImportanceScore);

  return alerts;
}

/**
 * Calculates deterministic Day-over-Day changes between the current brief and a previous brief.
 * When previous brief data is unavailable or empty, safely returns hasBaselineData: false.
 */
export function calculateBriefDelta(
  currentStories: Story[],
  previousBrief: DailyBriefDocument | null | undefined,
  windowStartIso: string,
  windowEndIso: string,
  fallbackDevelopments?: DailyBriefSectionContent[]
): DailyBriefDelta {
  // Safe baseline check: If no previous brief exists or no story records were captured
  if (!previousBrief) {
    return {
      hasBaselineData: false,
      insufficientDataReason: 'Insufficient historical data for comparison.',
      summary: {
        newCount: 0,
        materialUpdateCount: 0,
        escalatingCount: 0,
        resolvedCount: 0,
      },
      changes: [],
    };
  }

  // Build map of previous story states from storySnapshots or previous brief sections
  const prevStoryMap = new Map<string, BriefStorySnapshot>();

  if (previousBrief.storySnapshots) {
    if (Array.isArray(previousBrief.storySnapshots)) {
      for (const snap of previousBrief.storySnapshots as any[]) {
        const sid = snap.storyId || snap.id;
        if (sid) prevStoryMap.set(sid, snap);
      }
    } else if (typeof previousBrief.storySnapshots === 'object') {
      for (const [id, snap] of Object.entries(previousBrief.storySnapshots)) {
        const sid = (snap as any).storyId || id;
        if (sid) prevStoryMap.set(sid, snap);
      }
    }
  } else {
    // Reconstruct baseline from headlineDevelopments & competitorMoves if storySnapshots absent (e.g. Phase P0 brief)
    if (previousBrief.en?.headlineDevelopments) {
      for (const dev of previousBrief.en.headlineDevelopments) {
        const idKey = dev.storyId || dev.title;
        if (idKey) {
          prevStoryMap.set(idKey, {
            id: idKey,
            title: dev.title,
            category: dev.category,
            strategicImportanceScore: dev.strategicImportanceScore || 50,
            competitiveThreatLevel: dev.competitiveThreatLevel || 'MEDIUM',
            status: 'DEVELOPING',
            evidenceClassification: dev.evidenceClassification || 'SINGLE_SOURCE_REPORT',
            evidenceConfidence: dev.evidenceConfidence || 0.8,
            independentSourceCount: dev.independentSourceCount || 1,
          });
        }
      }
    }
    if (previousBrief.en?.competitorMoves) {
      for (const move of previousBrief.en.competitorMoves) {
        const moveKey = move.storyId || move.headline;
        if (moveKey && !prevStoryMap.has(moveKey)) {
          prevStoryMap.set(moveKey, {
            id: moveKey,
            title: move.headline,
            category: 'Smartphones',
            strategicImportanceScore: move.strategicImportanceScore || 50,
            competitiveThreatLevel: move.threatLevel || 'MEDIUM',
            status: 'DEVELOPING',
            evidenceClassification: move.evidenceClassification || 'SINGLE_SOURCE_REPORT',
            evidenceConfidence: move.evidenceConfidence || 0.8,
            independentSourceCount: move.independentSourceCount || 1,
          });
        }
      }
    }
  }

  // If after inspecting the previous brief we found zero valid story records, report insufficient data
  if (prevStoryMap.size === 0) {
    return {
      hasBaselineData: false,
      previousBriefDate: previousBrief.date,
      insufficientDataReason: 'Insufficient historical data for comparison.',
      summary: {
        newCount: 0,
        materialUpdateCount: 0,
        escalatingCount: 0,
        resolvedCount: 0,
      },
      changes: [],
    };
  }

  const changes: BriefDeltaItem[] = [];
  const processedStoryIds = new Set<string>();

  if (currentStories && currentStories.length > 0) {
    for (const story of currentStories) {
      if (!story.id || processedStoryIds.has(story.id)) continue;
      processedStoryIds.add(story.id);
    processedStoryIds.add(story.id);

    const cats = Array.from(getStoryCanonicalCategories(story));
    const mainCategory = cats[0] || 'SMARTPHONE';
    const categoryLabel =
      mainCategory === 'SMARTPHONE' ? 'Smartphones'
      : mainCategory === 'WEARABLE' ? 'Wearables'
      : mainCategory === 'AUDIO' ? 'Audio'
      : 'Tablets';

    const compName = (story.companies && story.companies[0]?.name) ||
      (story.primaryCompanyId ? story.primaryCompanyId.replace(/^comp-/, '').toUpperCase() : 'Competitor');

    const currentScore = typeof story.strategicImportanceScore === 'number'
      ? story.strategicImportanceScore
      : (story.importanceScore || 50);

    const currentThreat = story.competitiveThreatLevel || 'MEDIUM';
    const currentStatus = story.status || 'DEVELOPING';
    const currentEvClass = (story.evidenceClassification || 'SINGLE_SOURCE_REPORT') as EvidenceClassification;
    const currentConf = typeof story.evidenceConfidence === 'number' ? story.evidenceConfidence : 0.8;
    const currentSources = story.independentSourceCount || story.sourceCount || 1;

    const prev = prevStoryMap.get(story.id);

    if (!prev) {
      // 1. NEW DEVELOPMENT: Newly tracked storyline not present in previous brief
      changes.push({
        storyId: story.id,
        title: story.canonicalTitle || story.title || 'New Market Development',
        deltaType: 'NEW_DEVELOPMENT',
        category: categoryLabel,
        competitorName: compName,
        description: `New competitive development emerged in current reporting window (${currentSources} independent outlet${currentSources === 1 ? '' : 's'}).`,
        currentState: {
          strategicImportanceScore: currentScore,
          competitiveThreatLevel: currentThreat,
          status: currentStatus,
          evidenceClassification: currentEvClass,
          lastMaterialUpdateAt: story.lastMaterialUpdateAt,
        },
        evidenceClassification: currentEvClass,
        evidenceConfidence: currentConf,
        independentSourceCount: currentSources,
      });
    } else {
      // Story was previously tracked: Check for escalation, material update, or de-escalation
      const prevScore = prev.strategicImportanceScore;
      const prevThreat = prev.competitiveThreatLevel;
      const prevEvClass = prev.evidenceClassification;
      const prevSources = prev.independentSourceCount;

      const isThreatEscalated =
        (prevThreat === 'LOW' && (currentThreat === 'MEDIUM' || currentThreat === 'HIGH')) ||
        (prevThreat === 'MEDIUM' && currentThreat === 'HIGH');

      const isScoreEscalated = currentScore >= prevScore + 5;

      const isRumorConfirmed =
        prevEvClass === 'RUMOR_OR_LEAK' &&
        (currentEvClass === 'OFFICIAL_ANNOUNCEMENT' || currentEvClass === 'VERIFIED_REPORT' || currentEvClass === 'MULTI_SOURCE_CORROBORATED');

      const isSourceExpanded = currentSources > prevSources;

      const hasMaterialTimestamp = Boolean(
        story.lastMaterialUpdateAt &&
        isWithinAthensReportingWindow(story.lastMaterialUpdateAt, windowStartIso, windowEndIso)
      );

      const isThreatDeEscalated =
        (prevThreat === 'HIGH' && (currentThreat === 'MEDIUM' || currentThreat === 'LOW')) ||
        (prevThreat === 'MEDIUM' && currentThreat === 'LOW');

      const isLifecycleResolved =
        currentStatus === 'RESOLVED' ||
        currentStatus === 'ARCHIVED' ||
        currentStatus === 'STABLE';

      if (isThreatEscalated || isScoreEscalated) {
        // 2. ESCALATING DEVELOPMENT
        changes.push({
          storyId: story.id,
          title: story.canonicalTitle || story.title || 'Escalating Competitive Threat',
          deltaType: 'ESCALATING_DEVELOPMENT',
          category: categoryLabel,
          competitorName: compName,
          description: `Competitive impact intensified: Strategic score shifted from ${prevScore} to ${currentScore}/100; threat level evaluated at ${currentThreat}.`,
          previousState: {
            strategicImportanceScore: prevScore,
            competitiveThreatLevel: prevThreat,
            status: prev.status,
            evidenceClassification: prevEvClass,
            lastMaterialUpdateAt: prev.lastMaterialUpdateAt,
          },
          currentState: {
            strategicImportanceScore: currentScore,
            competitiveThreatLevel: currentThreat,
            status: currentStatus,
            evidenceClassification: currentEvClass,
            lastMaterialUpdateAt: story.lastMaterialUpdateAt,
          },
          evidenceClassification: currentEvClass,
          evidenceConfidence: currentConf,
          independentSourceCount: currentSources,
        });
      } else if (isRumorConfirmed || isSourceExpanded || hasMaterialTimestamp) {
        // 3. MATERIAL UPDATE
        const updateReason = isRumorConfirmed
          ? `Prior unconfirmed leak officially corroborated (${prevEvClass} -> ${currentEvClass}).`
          : isSourceExpanded
          ? `Reporting expanded from ${prevSources} to ${currentSources} independent reporting outlets.`
          : `Material product/pricing disclosure recorded in reporting window.`;

        changes.push({
          storyId: story.id,
          title: story.canonicalTitle || story.title || 'Material Story Update',
          deltaType: 'MATERIAL_UPDATE',
          category: categoryLabel,
          competitorName: compName,
          description: updateReason,
          previousState: {
            strategicImportanceScore: prevScore,
            competitiveThreatLevel: prevThreat,
            status: prev.status,
            evidenceClassification: prevEvClass,
            lastMaterialUpdateAt: prev.lastMaterialUpdateAt,
          },
          currentState: {
            strategicImportanceScore: currentScore,
            competitiveThreatLevel: currentThreat,
            status: currentStatus,
            evidenceClassification: currentEvClass,
            lastMaterialUpdateAt: story.lastMaterialUpdateAt,
          },
          evidenceClassification: currentEvClass,
          evidenceConfidence: currentConf,
          independentSourceCount: currentSources,
        });
      } else if (isThreatDeEscalated || (isLifecycleResolved && prev.status === 'DEVELOPING')) {
        // 4. RESOLVED OR DE-ESCALATED
        changes.push({
          storyId: story.id,
          title: story.canonicalTitle || story.title || 'De-escalated Development',
          deltaType: 'RESOLVED_OR_DE_ESCALATED',
          category: categoryLabel,
          competitorName: compName,
          description: `Competitive urgency subsided: Story transitioned to ${currentStatus} (threat level: ${currentThreat}).`,
          previousState: {
            strategicImportanceScore: prevScore,
            competitiveThreatLevel: prevThreat,
            status: prev.status,
            evidenceClassification: prevEvClass,
            lastMaterialUpdateAt: prev.lastMaterialUpdateAt,
          },
          currentState: {
            strategicImportanceScore: currentScore,
            competitiveThreatLevel: currentThreat,
            status: currentStatus,
            evidenceClassification: currentEvClass,
            lastMaterialUpdateAt: story.lastMaterialUpdateAt,
          },
          evidenceClassification: currentEvClass,
          evidenceConfidence: currentConf,
          independentSourceCount: currentSources,
        });
      }
    }
  }
} else if (fallbackDevelopments && fallbackDevelopments.length > 0) {
    for (const dev of fallbackDevelopments) {
      const idKey = dev.storyId || dev.title;
      if (!idKey || processedStoryIds.has(idKey)) continue;
      processedStoryIds.add(idKey);

      const prev = prevStoryMap.get(idKey) ||
        (dev.title ? Array.from(prevStoryMap.values()).find((p) => p.title.toLowerCase() === dev.title.toLowerCase()) : undefined);

      const currentScore = typeof dev.strategicImportanceScore === 'number'
        ? dev.strategicImportanceScore
        : 50;
      const currentThreat = dev.competitiveThreatLevel || 'MEDIUM';
      const currentEvClass = (dev.evidenceClassification || 'SINGLE_SOURCE_REPORT') as EvidenceClassification;
      const currentConf = typeof dev.evidenceConfidence === 'number' ? dev.evidenceConfidence : 0.75;
      const currentSources = dev.independentSourceCount || 1;
      const compName = (dev.trackedCompetitors && dev.trackedCompetitors[0]) || 'Competitor';
      const categoryLabel = dev.category || 'Smartphones';

      if (!prev) {
        changes.push({
          storyId: dev.storyId || idKey,
          title: dev.title || 'Market Development',
          deltaType: 'NEW_DEVELOPMENT',
          category: categoryLabel,
          competitorName: compName,
          description: `New competitive development emerged in current reporting window (${currentSources} independent source${currentSources === 1 ? '' : 's'}).`,
          currentState: {
            strategicImportanceScore: currentScore,
            competitiveThreatLevel: currentThreat,
            status: 'DEVELOPING',
            evidenceClassification: currentEvClass,
          },
          evidenceClassification: currentEvClass,
          evidenceConfidence: currentConf,
          independentSourceCount: currentSources,
        });
      } else {
        const prevScore = prev.strategicImportanceScore;
        const prevThreat = prev.competitiveThreatLevel;
        const isThreatEscalated =
          (prevThreat === 'LOW' && (currentThreat === 'MEDIUM' || currentThreat === 'HIGH')) ||
          (prevThreat === 'MEDIUM' && currentThreat === 'HIGH');
        const isScoreEscalated = currentScore >= prevScore + 5;

        if (isThreatEscalated || isScoreEscalated) {
          changes.push({
            storyId: dev.storyId || idKey,
            title: dev.title || 'Escalating Market Development',
            deltaType: 'ESCALATING_DEVELOPMENT',
            category: categoryLabel,
            competitorName: compName,
            description: `Competitive impact intensified: Strategic score shifted from ${prevScore} to ${currentScore}/100; threat level evaluated at ${currentThreat}.`,
            previousState: {
              strategicImportanceScore: prevScore,
              competitiveThreatLevel: prevThreat,
              status: prev.status,
              evidenceClassification: prev.evidenceClassification,
              lastMaterialUpdateAt: prev.lastMaterialUpdateAt,
            },
            currentState: {
              strategicImportanceScore: currentScore,
              competitiveThreatLevel: currentThreat,
              status: 'DEVELOPING',
              evidenceClassification: currentEvClass,
            },
            evidenceClassification: currentEvClass,
            evidenceConfidence: currentConf,
            independentSourceCount: currentSources,
          });
        } else {
          changes.push({
            storyId: dev.storyId || idKey,
            title: dev.title || 'Market Development Update',
            deltaType: 'MATERIAL_UPDATE',
            category: categoryLabel,
            competitorName: compName,
            description: `Ongoing coverage of development updated in reporting window.`,
            previousState: {
              strategicImportanceScore: prevScore,
              competitiveThreatLevel: prevThreat,
              status: prev.status,
              evidenceClassification: prev.evidenceClassification,
              lastMaterialUpdateAt: prev.lastMaterialUpdateAt,
            },
            currentState: {
              strategicImportanceScore: currentScore,
              competitiveThreatLevel: currentThreat,
              status: 'DEVELOPING',
              evidenceClassification: currentEvClass,
            },
            evidenceClassification: currentEvClass,
            evidenceConfidence: currentConf,
            independentSourceCount: currentSources,
          });
        }
      }
    }
  }

  // Count summaries
  let newCount = 0;
  let materialUpdateCount = 0;
  let escalatingCount = 0;
  let resolvedCount = 0;

  for (const c of changes) {
    if (c.deltaType === 'NEW_DEVELOPMENT') newCount++;
    else if (c.deltaType === 'MATERIAL_UPDATE') materialUpdateCount++;
    else if (c.deltaType === 'ESCALATING_DEVELOPMENT') escalatingCount++;
    else if (c.deltaType === 'RESOLVED_OR_DE_ESCALATED') resolvedCount++;
  }

  return {
    hasBaselineData: true,
    previousBriefDate: previousBrief.date,
    summary: {
      newCount,
      materialUpdateCount,
      escalatingCount,
      resolvedCount,
    },
    changes,
  };
}

/**
 * Derives Prioritized Opportunities & Threats tiered by Critical, High, Medium, Monitoring.
 * Supports canonical Stories or fallbackDevelopments in ARTICLE_FALLBACK mode.
 */
export function derivePrioritizedOpportunitiesAndThreats(
  stories: Story[],
  targetCompanyId: string = 'comp-huawei',
  fallbackDevelopments?: DailyBriefSectionContent[]
): PrioritizedOpportunitiesThreats {
  const critical: PrioritizedStrategicItem[] = [];
  const high: PrioritizedStrategicItem[] = [];
  const medium: PrioritizedStrategicItem[] = [];
  const monitoring: PrioritizedStrategicItem[] = [];

  if (stories && stories.length > 0) {
    for (const story of stories) {
      const score = typeof story.strategicImportanceScore === 'number'
        ? story.strategicImportanceScore
        : (story.importanceScore || 50);

      const threat = story.competitiveThreatLevel || 'MEDIUM';
      const evClass = (story.evidenceClassification || 'SINGLE_SOURCE_REPORT') as EvidenceClassification;
      const evConf = typeof story.evidenceConfidence === 'number' ? story.evidenceConfidence : 0.8;

      const cats = Array.from(getStoryCanonicalCategories(story));
      const mainCategory = cats[0] || 'SMARTPHONE';
      const categoryLabel =
        mainCategory === 'SMARTPHONE' ? 'Smartphones'
        : mainCategory === 'WEARABLE' ? 'Wearables'
        : mainCategory === 'AUDIO' ? 'Audio'
        : 'Tablets';

      const compName = (story.companies && story.companies[0]?.name) ||
        (story.primaryCompanyId ? story.primaryCompanyId.replace(/^comp-/, '').toUpperCase() : 'Competitor');

      const isHuawei = story.primaryCompanyId === targetCompanyId || /huawei/i.test(compName);

      // Huawei 1P development or clear market opening constitutes an Opportunity; competitor moves constitute Threats
      const type: 'OPPORTUNITY' | 'THREAT' = isHuawei ? 'OPPORTUNITY' : 'THREAT';

      const headline = story.canonicalTitle || story.title || 'Key Strategic Development';
      const implication = story.competitiveImplication || story.huaweiRelevance || 'Monitor channel pricing and product parity.';

      let priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITORING';
      let rationale = '';

      if (score >= 80 || threat === 'HIGH') {
        priority = 'CRITICAL';
        rationale = `High-impact tier-1 development (Score: ${score}/100, Threat: ${threat}) demanding immediate executive evaluation.`;
      } else if (score >= 65) {
        priority = 'HIGH';
        rationale = `Substantial competitive movement in ${categoryLabel} (Score: ${score}/100) affecting premium market share.`;
      } else if (score >= 45 || threat === 'MEDIUM') {
        priority = 'MEDIUM';
        rationale = `Moderate segment update (Score: ${score}/100); routine monitoring and retail channel observation recommended.`;
      } else {
        priority = 'MONITORING';
        rationale = `Peripheral signal or low-urgency release (Score: ${score}/100); watch for further corroboration.`;
      }

      const item: PrioritizedStrategicItem = {
        type,
        priority,
        headline,
        category: categoryLabel,
        competitorName: compName,
        strategicImportanceScore: score,
        threatLevel: threat,
        evidenceClassification: evClass,
        evidenceConfidence: evConf,
        rationale,
        implication,
        storyId: story.id,
      };

      if (priority === 'CRITICAL') critical.push(item);
      else if (priority === 'HIGH') high.push(item);
      else if (priority === 'MEDIUM') medium.push(item);
      else monitoring.push(item);
    }
  } else if (fallbackDevelopments && fallbackDevelopments.length > 0) {
    for (const dev of fallbackDevelopments) {
      const score = typeof dev.strategicImportanceScore === 'number' ? dev.strategicImportanceScore : 50;
      const threat = dev.competitiveThreatLevel || 'MEDIUM';
      const evClass = (dev.evidenceClassification || 'SINGLE_SOURCE_REPORT') as EvidenceClassification;
      const evConf = typeof dev.evidenceConfidence === 'number' ? dev.evidenceConfidence : 0.75;
      const compName = (dev.trackedCompetitors && dev.trackedCompetitors[0]) || 'Competitor';
      const isHuawei = /huawei/i.test(compName) || /huawei/i.test(dev.title);
      const type: 'OPPORTUNITY' | 'THREAT' = isHuawei ? 'OPPORTUNITY' : 'THREAT';

      let priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITORING';
      let rationale = '';

      if (score >= 80 || threat === 'HIGH') {
        priority = 'CRITICAL';
        rationale = `High-impact development (Score: ${score}/100, Threat: ${threat}) requiring immediate strategic evaluation.`;
      } else if (score >= 65) {
        priority = 'HIGH';
        rationale = `Substantial competitive movement in ${dev.category} (Score: ${score}/100) affecting market share.`;
      } else if (score >= 45 || threat === 'MEDIUM') {
        priority = 'MEDIUM';
        rationale = `Moderate segment update (Score: ${score}/100); routine monitoring and retail channel observation recommended.`;
      } else {
        priority = 'MONITORING';
        rationale = `Peripheral signal (Score: ${score}/100); monitor for further corroboration.`;
      }

      const item: PrioritizedStrategicItem = {
        type,
        priority,
        headline: dev.title,
        category: dev.category,
        competitorName: compName,
        strategicImportanceScore: score,
        threatLevel: threat,
        evidenceClassification: evClass,
        evidenceConfidence: evConf,
        rationale,
        implication: dev.implicationForHuawei || 'Monitor channel pricing and product parity.',
        storyId: dev.storyId,
      };

      if (priority === 'CRITICAL') critical.push(item);
      else if (priority === 'HIGH') high.push(item);
      else if (priority === 'MEDIUM') medium.push(item);
      else monitoring.push(item);
    }
  }

  return { critical, high, medium, monitoring };
}

/**
 * Derives Actionable Recommendations for HUAWEI from Story Intelligence
 * or fallbackDevelopments in ARTICLE_FALLBACK mode.
 */
export function deriveActionableRecommendations(
  stories: Story[],
  targetCompanyId: string = 'comp-huawei',
  fallbackDevelopments?: DailyBriefSectionContent[]
): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];
  const seenStories = new Set<string>();

  if (stories && stories.length > 0) {
    for (const story of stories) {
      if (!story.id || seenStories.has(story.id)) continue;
      seenStories.add(story.id);

      const score = typeof story.strategicImportanceScore === 'number'
        ? story.strategicImportanceScore
        : (story.importanceScore || 50);

      const threat = story.competitiveThreatLevel || 'MEDIUM';
      const evClass = story.evidenceClassification || 'SINGLE_SOURCE_REPORT';

      const cats = Array.from(getStoryCanonicalCategories(story));
      const mainCategory = cats[0] || 'SMARTPHONE';
      const categoryLabel =
        mainCategory === 'SMARTPHONE' ? 'Smartphones'
        : mainCategory === 'WEARABLE' ? 'Wearables'
        : mainCategory === 'AUDIO' ? 'Audio'
        : 'Tablets';

      const compName = (story.companies && story.companies[0]?.name) ||
        (story as any).primaryCompany ||
        (story.primaryCompanyId ? story.primaryCompanyId.replace(/^comp-/, '').toUpperCase() : 'Competitors');

      const priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITORING' =
        score >= 80 || threat === 'HIGH' ? 'CRITICAL'
        : score >= 65 ? 'HIGH'
        : score >= 45 ? 'MEDIUM'
        : 'MONITORING';

      const timeHorizon: 'IMMEDIATE' | 'NEAR_TERM' | 'MONITOR' =
        priority === 'CRITICAL' ? 'IMMEDIATE'
        : priority === 'HIGH' ? 'NEAR_TERM'
        : 'MONITOR';

      const evidenceReliability: 'OFFICIAL' | 'VERIFIED' | 'CORROBORATED' | 'SPECULATIVE_LEAK' | 'UNVERIFIED' =
        evClass === 'OFFICIAL_ANNOUNCEMENT' ? 'OFFICIAL'
        : evClass === 'VERIFIED_REPORT' ? 'VERIFIED'
        : evClass === 'MULTI_SOURCE_CORROBORATED' ? 'CORROBORATED'
        : evClass === 'RUMOR_OR_LEAK' ? 'SPECULATIVE_LEAK'
        : 'UNVERIFIED';

      const titleText = story.canonicalTitle || story.title || '';
      const productMatch = titleText.match(/(?:Galaxy\s+(?:S|Z|Fold|Flip|A|M|F)\d+(?:\s+(?:Ultra|Plus|Pro|FE|Max))?|Pura\s+\d+(?:\s+(?:Ultra|Pro|Plus))?|Mate\s+\d+(?:\s+(?:Pro|RS|X\d*))?|Pixel\s+\d+(?:\s+(?:Pro|a|Fold))?|iPhone\s+\d+(?:\s+(?:Pro\s+Max|Pro|Plus|mini))?|Xiaomi\s+\d+(?:\s+(?:Ultra|Pro|T))?|LinkBuds(?:\s+(?:Open|Fit|S))?|QuietComfort(?:\s+(?:Ultra|Earbuds))?|Pad\s+\d+(?:\s+(?:Pro|Plus))?|Fenix\s+\d+(?:\s+Pro)?|Honor\s+\d+(?:\s+Pro)?)/i);
      const productName = story.primaryProductId || (story.products && story.products[0]?.name) || (productMatch ? productMatch[0].trim() : undefined);

      const actionText = story.strategicRecommendation ||
        ((story as any).actionableRecommendations && (story as any).actionableRecommendations[0]) ||
        `Reinforce ${categoryLabel} product differentiation, highlight battery and craftsmanship advantages, and review partner retail promotions against ${compName}.`;

      const actionLower = actionText.toLowerCase();
      const targetTeam: 'RETAIL_CHANNEL' | 'MARKETING_PR' | 'PRODUCT_STRATEGY' | 'COMPETITIVE_WATCH' =
        /retail|channel|pos|bundle|carrier|distribution|pricing|discount|promo|telco|partnership/i.test(actionLower)
          ? 'RETAIL_CHANNEL'
          : /messaging|campaign|pr|highlight|showcase|awareness|advertis|differenti/i.test(actionLower)
          ? 'MARKETING_PR'
          : /feature|ecosystem|firmware|display|optics|sensor|battery|spec|upgrade|hardware/i.test(actionLower)
          ? 'PRODUCT_STRATEGY'
          : 'COMPETITIVE_WATCH';

      const confidenceLevel = typeof story.evidenceConfidence === 'number'
        ? story.evidenceConfidence
        : evClass === 'OFFICIAL_ANNOUNCEMENT' ? 0.95
        : evClass === 'VERIFIED_REPORT' ? 0.85
        : evClass === 'MULTI_SOURCE_CORROBORATED' ? 0.80
        : 0.55;

      const textBlob = `${story.canonicalTitle || story.title || ''} ${story.huaweiRelevance || ''} ${story.summary || ''} ${actionText}`;
      const geographicScope = (/greece|greek|athens|techblog|insomnia|plaisio|kotsovolos/i.test(textBlob) && /europe|eu\b/i.test(textBlob))
        ? 'Europe / Greece'
        : /greece|greek|athens|techblog|insomnia|plaisio|kotsovolos/i.test(textBlob)
        ? 'Greece'
        : /europe|european|eu\b|eec|ce mark|germany|france|italy/i.test(textBlob)
        ? 'Europe'
        : 'Global';

      const strategicRationale = story.huaweiRelevance ||
        `Addresses direct competitive pressure from ${compName} in ${categoryLabel} (Threat Level: ${threat}, Score: ${score}/100).`;

      recommendations.push({
        action: actionText,
        competitorName: compName,
        category: categoryLabel,
        priority,
        strategicRationale,
        supportingStoryIds: [story.id],
        evidenceReliability,
        timeHorizon,
        targetTeam,
        confidenceLevel,
        productName,
        geographicScope,
      });
    }
  } else if (fallbackDevelopments && fallbackDevelopments.length > 0) {
    for (const dev of fallbackDevelopments) {
      const score = typeof dev.strategicImportanceScore === 'number' ? dev.strategicImportanceScore : 50;
      const threat = dev.competitiveThreatLevel || 'MEDIUM';
      const evClass = dev.evidenceClassification || 'SINGLE_SOURCE_REPORT';
      const compName = (dev as any).competitorName || (dev.trackedCompetitors && dev.trackedCompetitors[0]) || 'Competitor';
      const categoryLabel = dev.category || 'Smartphones';

      const priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITORING' =
        score >= 80 || threat === 'HIGH' ? 'CRITICAL'
        : score >= 65 ? 'HIGH'
        : score >= 45 ? 'MEDIUM'
        : 'MONITORING';

      const timeHorizon: 'IMMEDIATE' | 'NEAR_TERM' | 'MONITOR' =
        priority === 'CRITICAL' ? 'IMMEDIATE'
        : priority === 'HIGH' ? 'NEAR_TERM'
        : 'MONITOR';

      const evidenceReliability: 'OFFICIAL' | 'VERIFIED' | 'CORROBORATED' | 'SPECULATIVE_LEAK' | 'UNVERIFIED' =
        evClass === 'OFFICIAL_ANNOUNCEMENT' ? 'OFFICIAL'
        : evClass === 'VERIFIED_REPORT' ? 'VERIFIED'
        : evClass === 'MULTI_SOURCE_CORROBORATED' ? 'CORROBORATED'
        : evClass === 'RUMOR_OR_LEAK' ? 'SPECULATIVE_LEAK'
        : 'UNVERIFIED';

      const actionLower = (dev.strategicRecommendation || '').toLowerCase();
      const targetTeam: 'RETAIL_CHANNEL' | 'MARKETING_PR' | 'PRODUCT_STRATEGY' | 'COMPETITIVE_WATCH' =
        /retail|channel|pos|bundle|carrier|distribution|pricing|discount/i.test(actionLower)
          ? 'RETAIL_CHANNEL'
          : /messaging|campaign|pr|highlight|showcase|awareness/i.test(actionLower)
          ? 'MARKETING_PR'
          : /feature|ecosystem|firmware|display|optics|sensor|battery/i.test(actionLower)
          ? 'PRODUCT_STRATEGY'
          : 'COMPETITIVE_WATCH';

      const confidenceLevel = typeof dev.evidenceConfidence === 'number'
        ? dev.evidenceConfidence
        : evClass === 'OFFICIAL_ANNOUNCEMENT' ? 0.95
        : evClass === 'VERIFIED_REPORT' ? 0.85
        : 0.60;

      const actionText = dev.strategicRecommendation ||
        `Reinforce ${categoryLabel} product differentiation and monitor retail promotions against ${compName}.`;

      const strategicRationale = dev.implicationForHuawei ||
        `Addresses competitive activity from ${compName} in ${categoryLabel} (Threat Level: ${threat}, Score: ${score}/100).`;

      const idKey = dev.storyId || dev.title;
      if (seenStories.has(idKey)) continue;
      seenStories.add(idKey);

      recommendations.push({
        action: actionText,
        competitorName: compName,
        category: categoryLabel,
        priority,
        strategicRationale,
        supportingStoryIds: dev.storyId ? [dev.storyId] : [],
        evidenceReliability,
        timeHorizon,
        targetTeam,
        confidenceLevel,
        productName: dev.productName,
        geographicScope: dev.geographicRelevance || 'Europe',
      });
    }
  }

  // Sort recommendations by priority: CRITICAL first, then HIGH, then MEDIUM, then MONITORING
  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, MONITORING: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}

/**
 * Derives Strategic Hardware Domain Overview across the 4 canonical categories:
 * Smartphones, Wearables, Audio, Tablets.
 */
export function deriveStrategicHardwareOverview(
  stories: Story[],
  targetCompanyId: string = 'comp-huawei',
  fallbackDevelopments?: DailyBriefSectionContent[]
): StrategicHardwareDomainOverview[] {
  const domains: Array<{
    domain: 'SMARTPHONES' | 'WEARABLES' | 'AUDIO' | 'TABLETS';
    canonicalCat: CanonicalDeviceCategory;
    title: string;
    matcher: RegExp;
  }> = [
    { domain: 'SMARTPHONES', canonicalCat: 'SMARTPHONE', title: 'Smartphones & Foldables', matcher: /phone|foldable|smartphone/i },
    { domain: 'WEARABLES', canonicalCat: 'WEARABLE', title: 'Wearables & Smartwatches', matcher: /wearable|watch|ring|band/i },
    { domain: 'AUDIO', canonicalCat: 'AUDIO', title: 'Audio & TWS', matcher: /audio|earbud|headphone|tws/i },
    { domain: 'TABLETS', canonicalCat: 'TABLET', title: 'Tablets & Productivity Slates', matcher: /tablet|pad|slate/i },
  ];

  return domains.map(({ domain, canonicalCat, title, matcher }) => {
    let domainStories = stories.filter((s) => {
      const cats = getStoryCanonicalCategories(s);
      return cats.has(canonicalCat);
    });

    if (domainStories.length === 0 && fallbackDevelopments && fallbackDevelopments.length > 0) {
      const matchingDevs = fallbackDevelopments.filter((d) => matcher.test(d.category || '') || matcher.test(d.title || ''));
      if (matchingDevs.length > 0) {
        let highestThreat: 'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_APPLICABLE' = 'LOW';
        for (const d of matchingDevs) {
          if (d.competitiveThreatLevel === 'HIGH') {
            highestThreat = 'HIGH';
            break;
          }
          if (d.competitiveThreatLevel === 'MEDIUM') {
            highestThreat = 'MEDIUM';
          }
        }

        const titles = matchingDevs.map((d) => d.title).slice(0, 3).join('; ');
        const competitorDevelopmentsSummary = `${matchingDevs.length} development${matchingDevs.length === 1 ? '' : 's'} tracked: ${titles}.`;

        const implicationsList = matchingDevs.map((d) => d.implicationForHuawei).filter(Boolean);
        const huaweiImplications = implicationsList[0] ||
          `Monitor competitive pricing and feature messaging across European retail channels in ${title}.`;

        const actions = matchingDevs
          .map((d) => d.strategicRecommendation)
          .filter((a): a is string => Boolean(a));
        const recommendedActions = actions.length > 0
          ? Array.from(new Set(actions)).slice(0, 3)
          : ['Maintain active European channel presence and monitor competitor retail promotions.'];

        return {
          domain,
          title,
          competitorDevelopmentsSummary,
          highestThreatLevel: highestThreat,
          huaweiImplications,
          recommendedActions,
          supportingStoryIds: matchingDevs.map((d) => d.storyId).filter(Boolean) as string[],
          storyCount: matchingDevs.length,
        };
      }
    }

    if (domainStories.length === 0) {
      return {
        domain,
        title,
        competitorDevelopmentsSummary: 'No direct new hardware announcements or developments tracked in this 24-hour reporting window.',
        highestThreatLevel: 'NOT_APPLICABLE',
        huaweiImplications: 'Stable competitive environment. Maintain planned retail and marketing operations.',
        recommendedActions: ['Continue scheduled promotional cadence and channel inventory monitoring.'],
        supportingStoryIds: [],
        storyCount: 0,
      };
    }

    // Determine highest threat level
    let highestThreat: 'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_APPLICABLE' = 'LOW';
    for (const s of domainStories) {
      const t = s.competitiveThreatLevel;
      if (t === 'HIGH') {
        highestThreat = 'HIGH';
        break;
      }
      if (t === 'MEDIUM' && highestThreat === 'LOW') {
        highestThreat = 'MEDIUM';
      }
    }

    const titles = domainStories.map((s) => s.canonicalTitle || s.title).slice(0, 3).join('; ');
    const competitorDevelopmentsSummary = `${domainStories.length} development${domainStories.length === 1 ? '' : 's'} tracked: ${titles}.`;

    const implicationsList = domainStories
      .map((s) => s.competitiveImplication || s.huaweiRelevance)
      .filter(Boolean);
    const huaweiImplications = implicationsList[0] ||
      `Monitor competitive pricing and feature messaging across European retail channels in ${title}.`;

    const actions = domainStories
      .map((s) => s.strategicRecommendation)
      .filter((a): a is string => Boolean(a));
    const recommendedActions = actions.length > 0
      ? Array.from(new Set(actions)).slice(0, 3)
      : ['Maintain active European channel presence and monitor competitor retail promotions.'];

    return {
      domain,
      title,
      competitorDevelopmentsSummary,
      highestThreatLevel: highestThreat,
      huaweiImplications,
      recommendedActions,
      supportingStoryIds: domainStories.map((s) => s.id).filter(Boolean),
      storyCount: domainStories.length,
    };
  });
}

/**
 * Creates serializable story snapshots for DailyBriefDocument persistence.
 */
export function createStorySnapshots(
  stories: Story[],
  fallbackDevelopments?: DailyBriefSectionContent[]
): Record<string, BriefStorySnapshot> {
  const snapshots: Record<string, BriefStorySnapshot> = {};

  if (stories && stories.length > 0) {
    for (const s of stories) {
      if (!s.id) continue;
      const cats = Array.from(getStoryCanonicalCategories(s));
      snapshots[s.id] = {
        id: s.id,
        title: s.canonicalTitle || s.title || 'Untitled Story',
        category: cats[0] || 'SMARTPHONE',
        strategicImportanceScore: typeof s.strategicImportanceScore === 'number'
          ? s.strategicImportanceScore
          : (s.importanceScore || 50),
        competitiveThreatLevel: s.competitiveThreatLevel || 'MEDIUM',
        status: s.status || 'DEVELOPING',
        evidenceClassification: s.evidenceClassification || 'SINGLE_SOURCE_REPORT',
        evidenceConfidence: typeof s.evidenceConfidence === 'number' ? s.evidenceConfidence : 0.8,
        independentSourceCount: s.independentSourceCount || s.sourceCount || 1,
        lastMaterialUpdateAt: s.lastMaterialUpdateAt,
        lastSeenAt: s.lastSeenAt,
      };
    }
  } else if (fallbackDevelopments && fallbackDevelopments.length > 0) {
    for (const dev of fallbackDevelopments) {
      const idKey = dev.storyId || dev.title;
      if (!idKey) continue;
      snapshots[idKey] = {
        id: idKey,
        title: dev.title || 'Untitled Development',
        category: dev.category || 'Smartphones',
        strategicImportanceScore: typeof dev.strategicImportanceScore === 'number'
          ? dev.strategicImportanceScore
          : 50,
        competitiveThreatLevel: dev.competitiveThreatLevel || 'MEDIUM',
        status: 'DEVELOPING',
        evidenceClassification: dev.evidenceClassification || 'SINGLE_SOURCE_REPORT',
        evidenceConfidence: typeof dev.evidenceConfidence === 'number' ? dev.evidenceConfidence : 0.75,
        independentSourceCount: dev.independentSourceCount || 1,
      };
    }
  }

  return snapshots;
}

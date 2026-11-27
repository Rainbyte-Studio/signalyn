/**
 * Signalyn Phase P1 Executive Intelligence & Day-over-Day Analysis Test Suite
 *
 * Validates:
 * 1. calculateBriefDelta: Deterministic day-over-day changes across:
 *    - NEW_DEVELOPMENT
 *    - MATERIAL_UPDATE
 *    - ESCALATING_DEVELOPMENT
 *    - RESOLVED_OR_DE_ESCALATED
 * 2. deriveCriticalAlerts:
 *    - Strategic score >= 80 OR threat level === HIGH
 *    - Decoupling of strategic importance and factual certainty
 *    - Verified Critical Development vs High-Impact Unconfirmed Signal
 * 3. deriveStrategicHardwareOverview:
 *    - Complete 4-domain coverage (Smartphones, Wearables, Audio, Tablets)
 *    - Threat level evaluation and surveillance status
 * 4. derivePrioritizedOpportunitiesAndThreats:
 *    - Tiers: Critical, High, Medium, Monitoring
 *    - Threat vs Opportunity distinction for HUAWEI
 * 5. deriveActionableRecommendations:
 *    - Concrete recommendations, priorities, time horizons, and supporting story IDs
 * 6. Fallback derivations when in ARTICLE_FALLBACK mode
 */

import {
  deriveCriticalAlerts,
  calculateBriefDelta,
  deriveStrategicHardwareOverview,
  derivePrioritizedOpportunitiesAndThreats,
  deriveActionableRecommendations,
} from '../src/services/briefDeltaService';
import { Story } from '../src/types';
import { DailyBriefDocument, DailyBriefSectionContent } from '../src/types/dailyBrief';

function runTests() {
  console.log('===============================================================');
  console.log('SIGNALYN PHASE P1: EXECUTIVE INTELLIGENCE & DAY-OVER-DAY TESTS');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  }

  // Sample stories for testing
  const storyPhoneLeak = {
    id: 'story-leak-01',
    title: 'Samsung Galaxy S26 Ultra Camera Specifications Leaked',
    canonicalTitle: 'Samsung Galaxy S26 Ultra Camera Specifications Leaked',
    canonicalSummary: 'Multiple leak sources report Samsung upgrading to 1-inch sensor.',
    summary: 'Multiple leak sources report Samsung upgrading to 1-inch sensor.',
    primaryCompanyId: 'comp-samsung',
    companies: [{ companyId: 'comp-samsung', name: 'Samsung' }],
    primaryCategory: 'SMARTPHONE',
    categories: ['Smartphones'],
    strategicImportanceScore: 85,
    competitiveThreatLevel: 'HIGH',
    evidenceClassification: 'RUMOR_OR_LEAK',
    evidenceConfidence: 0.55,
    independentSourceCount: 1,
    status: 'DEVELOPING',
    lastMaterialUpdateAt: '2026-10-20T04:00:00Z',
    huaweiRelevance: 'Direct optics rivalry against HUAWEI Pura XMAGE.',
    strategicRecommendation: 'Accelerate retail messaging emphasizing XMAGE aperture advantage.',
    competitiveImplication: 'Pressures premium mobile photography segment.',
  } as unknown as Story;

  const storyWatchConfirmed = {
    id: 'story-watch-02',
    title: 'Apple Watch Series 11 Officially Announced with Solar Screen',
    canonicalTitle: 'Apple Watch Series 11 Officially Announced with Solar Screen',
    summary: 'Apple Watch Series 11 Officially Announced with Solar Screen',
    primaryCompanyId: 'comp-apple',
    companies: [{ companyId: 'comp-apple', name: 'Apple' }],
    primaryCategory: 'WEARABLE',
    categories: ['Wearables'],
    strategicImportanceScore: 90,
    competitiveThreatLevel: 'HIGH',
    evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
    evidenceConfidence: 0.98,
    independentSourceCount: 4,
    status: 'DEVELOPING',
    lastMaterialUpdateAt: '2026-10-20T05:00:00Z',
    huaweiRelevance: 'Direct flagship smartwatch competition with Watch GT 5.',
    strategicRecommendation: 'Showcase Watch GT 5 two-week battery life superiority at retail POS.',
    competitiveImplication: 'Major European holiday season competitor entry.',
  } as unknown as Story;

  const storyTabletModerate = {
    id: 'story-tab-03',
    title: 'Xiaomi Pad 7 Series Receives European EEC Certification',
    canonicalTitle: 'Xiaomi Pad 7 Series Receives European EEC Certification',
    summary: 'Xiaomi Pad 7 Series Receives European EEC Certification',
    primaryCompanyId: 'comp-xiaomi',
    companies: [{ companyId: 'comp-xiaomi', name: 'Xiaomi' }],
    primaryCategory: 'TABLET',
    categories: ['Tablets'],
    strategicImportanceScore: 60,
    competitiveThreatLevel: 'MEDIUM',
    evidenceClassification: 'VERIFIED_REPORT',
    evidenceConfidence: 0.85,
    independentSourceCount: 2,
    status: 'DEVELOPING',
    lastMaterialUpdateAt: '2026-10-20T06:00:00Z',
  } as unknown as Story;

  const storyHuawei1P = {
    id: 'story-huawei-04',
    title: 'HUAWEI Launches MatePad Pro 12.2 PaperMatte Edition in Europe',
    canonicalTitle: 'HUAWEI Launches MatePad Pro 12.2 PaperMatte Edition in Europe',
    summary: 'HUAWEI Launches MatePad Pro 12.2 PaperMatte Edition in Europe',
    primaryCompanyId: 'comp-huawei',
    companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
    primaryCategory: 'TABLET',
    categories: ['Tablets'],
    strategicImportanceScore: 78,
    competitiveThreatLevel: 'NOT_APPLICABLE',
    evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
    evidenceConfidence: 0.99,
    independentSourceCount: 3,
    status: 'DEVELOPING',
    lastMaterialUpdateAt: '2026-10-20T07:00:00Z',
  } as unknown as Story;

  // --- Suite 1: Critical Intelligence Alerts ---
  console.log('\n[Suite 1: Critical Intelligence Alerts]');
  const alerts = deriveCriticalAlerts([storyPhoneLeak, storyWatchConfirmed, storyTabletModerate, storyHuawei1P]);

  assert(alerts.length === 2, 'Only stories with strategicScore >= 80 or threat === HIGH qualify (found 2)');
  const unconfirmedAlert = alerts.find((a) => a.storyId === 'story-leak-01');
  const confirmedAlert = alerts.find((a) => a.storyId === 'story-watch-02');

  assert(unconfirmedAlert !== undefined, 'High-threat leak qualifies as Critical Alert');
  assert(unconfirmedAlert?.alertType === 'HIGH_IMPACT_UNCONFIRMED_SIGNAL', 'High-threat leak labeled as HIGH_IMPACT_UNCONFIRMED_SIGNAL');
  assert(unconfirmedAlert?.isUnconfirmedSignal === true, 'Leak is visibly marked isUnconfirmedSignal: true');

  assert(confirmedAlert !== undefined, 'Confirmed high-score announcement qualifies');
  assert(confirmedAlert?.alertType === 'VERIFIED_CRITICAL_DEVELOPMENT', 'Official announcement labeled as VERIFIED_CRITICAL_DEVELOPMENT');
  assert(confirmedAlert?.isUnconfirmedSignal === false, 'Official announcement is marked isUnconfirmedSignal: false');

  // --- Suite 2: Day-over-Day Delta & Comparisons ---
  console.log('\n[Suite 2: Changes Since Yesterday / Day-over-Day Delta]');
  // Case A: Missing previous brief baseline
  const deltaNoBaseline = calculateBriefDelta([storyPhoneLeak, storyWatchConfirmed], null, '2026-10-19T21:00:00Z', '2026-10-20T20:59:59.999Z');
  assert(deltaNoBaseline.hasBaselineData === false, 'Safely returns hasBaselineData: false when no prior brief exists');
  assert(deltaNoBaseline.insufficientDataReason?.includes('Insufficient historical data') === true, 'Explicitly informs user of insufficient historical data');

  // Case B: Prior brief baseline with changes
  const mockPrevBrief: DailyBriefDocument = {
    id: 'brief-2026-10-19',
    date: '2026-10-19',
    windowStart: '2026-10-18T21:00:00Z',
    windowEnd: '2026-10-19T20:59:59Z',
    status: 'PUBLISHED',
    version: 1,
    generatedAt: '2026-10-19T22:00:00Z',
    lastUpdatedAt: '2026-10-19T22:00:00Z',
    generatedBy: 'SYSTEM_AUTOMATION',
    targetCompanyId: 'comp-huawei',
    targetCompanyName: 'HUAWEI',
    en: {} as any,
    storySnapshots: {
      'story-leak-01': {
        id: 'story-leak-01',
        title: 'Samsung Galaxy S26 Leak',
        category: 'Smartphones',
        strategicImportanceScore: 70,
        competitiveThreatLevel: 'MEDIUM',
        status: 'DEVELOPING',
        evidenceClassification: 'RUMOR_OR_LEAK',
        evidenceConfidence: 0.55,
        independentSourceCount: 1,
      },
    },
    groundingMetrics: {} as any,
  };

  const deltaWithBaseline = calculateBriefDelta(
    [storyPhoneLeak, storyWatchConfirmed],
    mockPrevBrief,
    '2026-10-19T21:00:00Z',
    '2026-10-20T20:59:59.999Z'
  );

  assert(deltaWithBaseline.hasBaselineData === true, 'Evaluates hasBaselineData: true when prior brief snapshot is available');
  assert(deltaWithBaseline.summary.newCount === 1, 'Correctly identifies storyWatchConfirmed as NEW_DEVELOPMENT (1)');
  assert(deltaWithBaseline.summary.escalatingCount === 1, 'Correctly identifies storyPhoneLeak as ESCALATING_DEVELOPMENT (threat raised to HIGH, score +15)');

  // --- Suite 3: Strategic Hardware Overview (4 Domains) ---
  console.log('\n[Suite 3: Strategic Hardware Overview across 4 Canonical Domains]');
  const overview = deriveStrategicHardwareOverview([storyPhoneLeak, storyWatchConfirmed, storyTabletModerate]);
  assert(overview.length === 4, 'Always returns exactly 4 canonical domains');
  const domains = overview.map((d) => d.domain);
  assert(domains.includes('SMARTPHONES'), 'Includes SMARTPHONES domain');
  assert(domains.includes('WEARABLES'), 'Includes WEARABLES domain');
  assert(domains.includes('AUDIO'), 'Includes AUDIO domain');
  assert(domains.includes('TABLETS'), 'Includes TABLETS domain');

  const phoneDom = overview.find((d) => d.domain === 'SMARTPHONES');
  const audioDom = overview.find((d) => d.domain === 'AUDIO');
  assert(phoneDom?.highestThreatLevel === 'HIGH', 'Smartphones domain evaluates highestThreatLevel as HIGH');
  assert(phoneDom?.storyCount === 1, 'Smartphones domain tracks 1 story');
  assert(audioDom?.storyCount === 0, 'Audio domain has 0 stories and shows transparent surveillance status');
  assert(audioDom?.highestThreatLevel === 'NOT_APPLICABLE', 'Empty audio domain threat level is NOT_APPLICABLE');

  // --- Suite 4: Prioritized Opportunities & Threats ---
  console.log('\n[Suite 4: Prioritized Opportunities & Threats]');
  const pot = derivePrioritizedOpportunitiesAndThreats([storyPhoneLeak, storyWatchConfirmed, storyTabletModerate, storyHuawei1P]);
  assert(pot.critical.length === 2, 'Tiers score >= 80 or HIGH threat as Critical (found 2)');
  assert(pot.high.length === 1, 'Tiers score 78 (Huawei MatePad launch) as High (found 1)');
  assert(pot.medium.length === 1, 'Tiers score 60 (Xiaomi Pad 7) as Medium (found 1)');

  const huaweiItem = pot.high.find((i) => i.storyId === 'story-huawei-04');
  assert(huaweiItem?.type === 'OPPORTUNITY', 'HUAWEI 1P development is classified as an OPPORTUNITY');
  const appleItem = pot.critical.find((i) => i.storyId === 'story-watch-02');
  assert(appleItem?.type === 'THREAT', 'Competitor Apple development is classified as a THREAT');

  // --- Suite 5: Actionable Recommendations ---
  console.log('\n[Suite 5: Actionable Recommendations]');
  const recs = deriveActionableRecommendations([storyPhoneLeak, storyWatchConfirmed]);
  assert(recs.length === 2, 'Generates actionable recommendations for tracked competitor developments');
  assert(recs[0].priority === 'CRITICAL', 'First recommendation has CRITICAL priority');
  assert(Boolean(recs[0].timeHorizon), 'Each recommendation specifies a suggested time horizon');
  assert(Boolean(recs[0].supportingStoryIds && recs[0].supportingStoryIds.length > 0), 'Recommendations include supporting Story IDs');

  // --- Suite 6: Fallback Derivations (ARTICLE_FALLBACK Mode) ---
  console.log('\n[Suite 6: ARTICLE_FALLBACK Mode Resiliency]');
  const fallbackDevs: DailyBriefSectionContent[] = [
    {
      title: 'Realme 15 Pro Plus Specs Disclosed Ahead of European Launch',
      executiveTakeaway: 'Aggressive pricing leak in mid-range segment.',
      strategicAnalysis: ['Pressures nova series positioning in Greece.'],
      category: 'Smartphones',
      competitiveThreatLevel: 'MEDIUM',
      strategicImportanceScore: 65,
      implicationForHuawei: 'Price aggression in mid-tier European market.',
      strategicRecommendation: 'Track channel bundle promotions against nova series.',
      trackedCompetitors: ['Realme'],
      groundedCitations: [],
    },
    {
      title: 'Motorola Moto G47 Power Battery Leak Shows 7000mAh Cell',
      executiveTakeaway: 'Budget high-capacity battery leak.',
      strategicAnalysis: ['Competes directly on endurance value proposition.'],
      category: 'Smartphones',
      competitiveThreatLevel: 'HIGH',
      strategicImportanceScore: 82,
      implicationForHuawei: 'Competes with budget battery endurance proposition.',
      strategicRecommendation: 'Highlight HUAWEI battery safety certification.',
      trackedCompetitors: ['Motorola'],
      groundedCitations: [],
    },
  ];

  const fallbackAlerts = deriveCriticalAlerts([], 'comp-huawei', fallbackDevs);
  assert(fallbackAlerts.length === 1, 'Derives Critical Alert from fallback development with score >= 80 or threat HIGH');
  assert(fallbackAlerts[0].competitorName === 'Motorola', 'Fallback alert competitor is Motorola');

  const fallbackOverview = deriveStrategicHardwareOverview([], 'comp-huawei', fallbackDevs);
  assert(fallbackOverview.length === 4, 'Fallback mode still outputs all 4 canonical hardware domains');
  const fallbackPhoneDom = fallbackOverview.find((d) => d.domain === 'SMARTPHONES');
  assert(fallbackPhoneDom?.storyCount === 2, 'Fallback smartphone domain contains 2 developments');

  const fallbackPot = derivePrioritizedOpportunitiesAndThreats([], 'comp-huawei', fallbackDevs);
  assert(fallbackPot.critical.length === 1, 'Fallback prioritized items have 1 Critical (Moto G47)');
  assert(fallbackPot.high.length === 1, 'Fallback prioritized items have 1 High (Realme 15 Pro)');

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

runTests();

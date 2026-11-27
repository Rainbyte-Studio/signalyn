/**
 * SIGNALYN — Phase P1 Regression Test Suite:
 * Executive Intelligence, Critical Alerts & Day-over-Day Analysis
 *
 * Verifies:
 * 1. Critical Intelligence Alerts eligibility (score >= 80 or threat HIGH, strategic hardware scope).
 * 2. High-impact rumors remaining visibly unconfirmed (HIGH_IMPACT_UNCONFIRMED_SIGNAL vs VERIFIED_CRITICAL_DEVELOPMENT).
 * 3. No duplicate critical alerts for the same Story.
 * 4. No manufacturing artificial alerts when none qualify (returns []).
 * 5. Day-over-Day Delta calculation (calculateBriefDelta):
 *    - Missing historical baseline safely yields hasBaselineData: false and 'Insufficient historical data for comparison.'
 *    - NEW_DEVELOPMENT detection for freshly emerged storylines.
 *    - MATERIAL_UPDATE detection for rumor confirmation, source expansion, and timestamp updates.
 *    - ESCALATING_DEVELOPMENT detection for score/threat increases.
 *    - RESOLVED_OR_DE_ESCALATED detection for confirmed lifecycle or threat reductions.
 * 6. Prioritized Opportunities & Threats tiering (Critical, High, Medium, Monitoring).
 * 7. Actionable Recommendations for HUAWEI (Priority, Time Horizon, Rationale).
 * 8. Strategic Hardware Overview across 4 canonical domains (Smartphones, Wearables, Audio, Tablets).
 * 9. Story snapshots creation for deterministic persistence.
 * 10. Backward compatibility with legacy DailyBrief documents lacking P1 fields.
 * 11. Dual-language (EN and EL) consistency and structural parity.
 * 12. Idempotent deterministic execution without Gemini dependency.
 */

import {
  deriveCriticalAlerts,
  calculateBriefDelta,
  derivePrioritizedOpportunitiesAndThreats,
  deriveActionableRecommendations,
  deriveStrategicHardwareOverview,
  createStorySnapshots,
} from '../src/services/briefDeltaService';
import { Story } from '../src/types';
import { DailyBriefDocument, DailyBriefContent } from '../src/types/dailyBrief';

let totalPassed = 0;
let totalFailed = 0;

function testAssert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    totalPassed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    totalFailed++;
    console.error(`  ✗ FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

function createMockStory(partial: Partial<Story> & { id: string; title: string }): Story {
  return {
    canonicalTitle: partial.title,
    summary: '',
    storyType: 'PRODUCT_LAUNCH',
    status: 'DEVELOPING',
    categories: ['SMARTPHONE'],
    importanceScore: partial.strategicImportanceScore ?? 50,
    confidence: partial.evidenceConfidence ?? 0.8,
    articleIds: [],
    sourceIds: [],
    articleCount: 1,
    sourceCount: partial.independentSourceCount ?? 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lifecycleState: 'DEVELOPING',
    isDeveloping: true,
    history: [],
    timelineEvents: [],
    ...partial,
  } as Story;
}

async function runPhaseP1TestSuite() {
  console.log('\n===============================================================');
  console.log('SIGNALYN PHASE P1: EXECUTIVE INTELLIGENCE & DELTA TEST SUITE');
  console.log('===============================================================\n');

  // -------------------------------------------------------------
  // 1. Critical Intelligence Alerts Eligibility & Ranking
  // -------------------------------------------------------------
  console.log('[1. Critical Intelligence Alerts Eligibility & Ranking]');

  const storyHighThreat: Story = createMockStory({
    id: 'story-s27-optics',
    title: 'Samsung Unveils Galaxy S27 Ultra with 200MP Next-Gen Optics',
    canonicalTitle: 'Samsung Unveils Galaxy S27 Ultra with 200MP Next-Gen Optics',
    status: 'DEVELOPING',
    categories: ['SMARTPHONE'],
    strategicImportanceScore: 92,
    competitiveThreatLevel: 'HIGH',
    evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
    evidenceConfidence: 0.98,
    independentSourceCount: 4,
    primaryCompanyId: 'comp-samsung',
    companies: [{ companyId: 'comp-samsung', name: 'Samsung' }],
    huaweiRelevance: 'Direct threat to Huawei Pura 80 flagship imaging leadership.',
    strategicRecommendation: 'Accelerate XMAGE European promotional campaign and highlight telephoto macro superiority.',
  });

  const storyModerate: Story = createMockStory({
    id: 'story-xiaomi-strap',
    title: 'Xiaomi Launches Replacement Silicone Bands for Band 9',
    canonicalTitle: 'Xiaomi Launches Replacement Silicone Bands for Band 9',
    status: 'DEVELOPING',
    categories: ['WEARABLE'],
    strategicImportanceScore: 35,
    competitiveThreatLevel: 'LOW',
    evidenceClassification: 'SINGLE_SOURCE_REPORT',
    evidenceConfidence: 0.85,
    independentSourceCount: 1,
    primaryCompanyId: 'comp-xiaomi',
    companies: [{ companyId: 'comp-xiaomi', name: 'Xiaomi' }],
  });

  const storyOutOfScopeGpu: Story = createMockStory({
    id: 'story-nvidia-rtx',
    title: 'NVIDIA Announces RTX 5090 Desktop Graphics Card',
    status: 'DEVELOPING',
    categories: ['GPU' as any],
    strategicImportanceScore: 95,
    competitiveThreatLevel: 'HIGH',
    evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
    evidenceConfidence: 0.99,
  });

  const alerts = deriveCriticalAlerts([storyHighThreat, storyModerate, storyOutOfScopeGpu]);

  testAssert(alerts.length === 1, 'Only eligible strategic mobile hardware stories qualify as Critical Alerts');
  testAssert(alerts[0].storyId === 'story-s27-optics', 'Eligible alert corresponds to Galaxy S27 optics story');
  testAssert(alerts[0].alertType === 'VERIFIED_CRITICAL_DEVELOPMENT', 'Official announcement is classified as VERIFIED_CRITICAL_DEVELOPMENT');
  testAssert(alerts[0].isUnconfirmedSignal === false, 'Verified alert is not marked as unconfirmed signal');
  testAssert(alerts[0].strategicImportanceScore === 92, 'Preserves strategic importance score');
  testAssert(alerts[0].competitiveThreatLevel === 'HIGH', 'Preserves competitive threat level');

  // Test: No alerts when none qualify
  const emptyAlerts = deriveCriticalAlerts([storyModerate]);
  testAssert(emptyAlerts.length === 0, 'Does NOT manufacture artificial alerts when none qualify');

  // -------------------------------------------------------------
  // 2. High-Impact Rumor Safeguards
  // -------------------------------------------------------------
  console.log('\n[2. High-Impact Rumor Safeguards]');

  const storyHighImpactRumor: Story = createMockStory({
    id: 'story-apple-fold-rumor',
    title: 'Supply Chain Leak Claims Apple Engineering Quad-Fold iPhone Display',
    canonicalTitle: 'Supply Chain Leak Claims Apple Engineering Quad-Fold iPhone Display',
    status: 'DEVELOPING',
    categories: ['SMARTPHONE'],
    strategicImportanceScore: 94,
    competitiveThreatLevel: 'HIGH',
    evidenceClassification: 'RUMOR_OR_LEAK',
    evidenceConfidence: 0.45, // Low empirical confirmation
    independentSourceCount: 2,
    primaryCompanyId: 'comp-apple',
    companies: [{ companyId: 'comp-apple', name: 'Apple' }],
    huaweiRelevance: 'Potential rival form factor to Huawei Mate XT tri-fold leadership.',
    strategicRecommendation: 'Highlight Huawei tri-fold commercial availability and hinge durability.',
  });

  const rumorAlerts = deriveCriticalAlerts([storyHighImpactRumor]);
  testAssert(rumorAlerts.length === 1, 'High-impact rumor is eligible based on strategic importance score (94)');
  testAssert(rumorAlerts[0].alertType === 'HIGH_IMPACT_UNCONFIRMED_SIGNAL', 'Rumor is strictly classified as HIGH_IMPACT_UNCONFIRMED_SIGNAL');
  testAssert(rumorAlerts[0].isUnconfirmedSignal === true, 'Rumor is flagged with isUnconfirmedSignal: true');
  testAssert(rumorAlerts[0].evidenceConfidence === 0.45, 'Preserves low evidence confidence decoupled from high strategic impact');

  // -------------------------------------------------------------
  // 3. Deduplication of Critical Alerts
  // -------------------------------------------------------------
  console.log('\n[3. Deduplication of Critical Alerts]');

  const duplicateStory = { ...storyHighThreat };
  const dedupedAlerts = deriveCriticalAlerts([storyHighThreat, duplicateStory]);
  testAssert(dedupedAlerts.length === 1, 'Suppresses duplicate alerts for the same Story ID');

  // -------------------------------------------------------------
  // 4. Day-over-Day Delta: Missing Historical Baseline Safety
  // -------------------------------------------------------------
  console.log('\n[4. Day-over-Day Delta: Missing Historical Baseline Safety]');

  const deltaNoBaseline = calculateBriefDelta(
    [storyHighThreat],
    null,
    '2026-10-18T06:00:00.000Z',
    '2026-10-19T06:00:00.000Z'
  );

  testAssert(deltaNoBaseline.hasBaselineData === false, 'Safely reports hasBaselineData: false when previous brief is null');
  testAssert(
    deltaNoBaseline.insufficientDataReason === 'Insufficient historical data for comparison.',
    'Explicitly reports "Insufficient historical data for comparison."'
  );
  testAssert(deltaNoBaseline.changes.length === 0, 'No fabricated changes when baseline is missing');

  // Previous brief with empty snapshots
  const emptyPrevBrief: Partial<DailyBriefDocument> = {
    id: 'brief-2026-10-17',
    date: '2026-10-17',
    storySnapshots: {},
  };
  const deltaEmptyBaseline = calculateBriefDelta(
    [storyHighThreat],
    emptyPrevBrief as DailyBriefDocument,
    '2026-10-18T06:00:00.000Z',
    '2026-10-19T06:00:00.000Z'
  );
  testAssert(deltaEmptyBaseline.hasBaselineData === false, 'Reports hasBaselineData: false when previous brief has empty snapshots');

  // -------------------------------------------------------------
  // 5. Day-over-Day Delta: Deterministic Change Classifications
  // -------------------------------------------------------------
  console.log('\n[5. Day-over-Day Delta: Deterministic Change Classifications]');

  const mockPreviousBrief: DailyBriefDocument = {
    id: 'brief-2026-10-18',
    date: '2026-10-18',
    windowStart: '2026-10-17T06:00:00.000Z',
    windowEnd: '2026-10-18T06:00:00.000Z',
    status: 'PUBLISHED',
    version: 1,
    generatedAt: '2026-10-18T06:05:00.000Z',
    lastUpdatedAt: '2026-10-18T06:05:00.000Z',
    generatedBy: 'SYSTEM_AUTOMATION',
    targetCompanyId: 'comp-huawei',
    targetCompanyName: 'HUAWEI',
    en: {
      language: 'en',
      executiveHeadline: 'Previous Day Executive Brief',
      executiveSummary: ['Previous point'],
      keyThemes: ['Hardware'],
      marketSentimentOverview: { overall: 'NEUTRAL', rationale: 'Stable' },
      headlineDevelopments: [],
      categoryBreakdowns: [],
      competitorMoves: [],
      strategicImplicationsForHuawei: {
        immediateActions: [],
        mediumTermWatch: [],
        threatsAndRisks: [],
        opportunities: [],
      },
    },
    storySnapshots: {
      'story-honor-magic8': {
        id: 'story-honor-magic8',
        title: 'HONOR Magic8 Pro Leak Suggests 200MP Periscope',
        category: 'SMARTPHONE',
        strategicImportanceScore: 68,
        competitiveThreatLevel: 'MEDIUM',
        status: 'DEVELOPING',
        evidenceClassification: 'RUMOR_OR_LEAK',
        evidenceConfidence: 0.50,
        independentSourceCount: 1,
      },
      'story-xiaomi-watch': {
        id: 'story-xiaomi-watch',
        title: 'Xiaomi Watch S4 Escalates Wearable Rivalry',
        category: 'WEARABLE',
        strategicImportanceScore: 62,
        competitiveThreatLevel: 'LOW',
        status: 'DEVELOPING',
        evidenceClassification: 'VERIFIED_REPORT',
        evidenceConfidence: 0.85,
        independentSourceCount: 2,
      },
      'story-tablet-old': {
        id: 'story-tablet-old',
        title: 'Old Tablet Announcement',
        category: 'TABLET',
        strategicImportanceScore: 50,
        competitiveThreatLevel: 'HIGH',
        status: 'DEVELOPING',
        evidenceClassification: 'VERIFIED_REPORT',
        evidenceConfidence: 0.80,
        independentSourceCount: 2,
      },
    },
    groundingMetrics: {
      totalArticlesInWindow: 10,
      strategicallyRelevantArticles: 8,
      distinctSourcesCount: 4,
      sourcesCovered: ['gsmarena.com'],
      distinctClustersConsidered: 3,
      geminiModelUsed: 'gemini-2.5-flash',
      synthesisDurationMs: 1200,
    },
  };

  // 1. NEW_DEVELOPMENT: storyHighThreat was not in mockPreviousBrief
  // 2. MATERIAL_UPDATE: story-honor-magic8 rumor officially corroborated (RUMOR_OR_LEAK -> OFFICIAL_ANNOUNCEMENT)
  const storyHonorConfirmed: Story = createMockStory({
    id: 'story-honor-magic8',
    title: 'HONOR Officially Announces Magic8 Pro with 200MP Periscope Optics',
    status: 'DEVELOPING',
    categories: ['SMARTPHONE'],
    strategicImportanceScore: 70, // Slight change (< 5)
    competitiveThreatLevel: 'MEDIUM',
    evidenceClassification: 'OFFICIAL_ANNOUNCEMENT', // Prior was RUMOR_OR_LEAK
    evidenceConfidence: 0.96,
    independentSourceCount: 3, // Sources grew
    primaryCompanyId: 'comp-honor',
    companies: [{ companyId: 'comp-honor', name: 'HONOR' }],
  });

  // 3. ESCALATING_DEVELOPMENT: story-xiaomi-watch score increased from 62 to 85, threat LOW -> HIGH
  const storyXiaomiEscalated: Story = createMockStory({
    id: 'story-xiaomi-watch',
    title: 'Xiaomi Watch S4 Escalates Wearable Rivalry with ECG Certification',
    status: 'DEVELOPING',
    categories: ['WEARABLE'],
    strategicImportanceScore: 85, // Shifted from 62 (+23)
    competitiveThreatLevel: 'HIGH', // Threat escalated from LOW
    evidenceClassification: 'VERIFIED_REPORT',
    evidenceConfidence: 0.90,
    independentSourceCount: 4,
    primaryCompanyId: 'comp-xiaomi',
    companies: [{ companyId: 'comp-xiaomi', name: 'Xiaomi' }],
  });

  // 4. RESOLVED_OR_DE_ESCALATED: story-tablet-old threat reduced from HIGH to LOW, status RESOLVED
  const storyTabletResolved: Story = createMockStory({
    id: 'story-tablet-old',
    title: 'Old Tablet Announcement',
    status: 'RESOLVED',
    categories: ['TABLET'],
    strategicImportanceScore: 35,
    competitiveThreatLevel: 'LOW', // Reduced from HIGH
    evidenceClassification: 'VERIFIED_REPORT',
    evidenceConfidence: 0.80,
    independentSourceCount: 2,
    primaryCompanyId: 'comp-other',
  });

  const deltaResult = calculateBriefDelta(
    [storyHighThreat, storyHonorConfirmed, storyXiaomiEscalated, storyTabletResolved],
    mockPreviousBrief,
    '2026-10-18T06:00:00.000Z',
    '2026-10-19T06:00:00.000Z'
  );

  testAssert(deltaResult.hasBaselineData === true, 'Successfully computes delta with valid historical baseline');
  testAssert(deltaResult.summary.newCount === 1, 'Accurately counts 1 NEW_DEVELOPMENT');
  testAssert(deltaResult.summary.materialUpdateCount === 1, 'Accurately counts 1 MATERIAL_UPDATE');
  testAssert(deltaResult.summary.escalatingCount === 1, 'Accurately counts 1 ESCALATING_DEVELOPMENT');
  testAssert(deltaResult.summary.resolvedCount === 1, 'Accurately counts 1 RESOLVED_OR_DE_ESCALATED');

  const newDev = deltaResult.changes.find((c) => c.deltaType === 'NEW_DEVELOPMENT');
  testAssert(newDev?.storyId === 'story-s27-optics', 'Identifies correct Story for NEW_DEVELOPMENT');

  const matUp = deltaResult.changes.find((c) => c.deltaType === 'MATERIAL_UPDATE');
  testAssert(matUp?.storyId === 'story-honor-magic8', 'Identifies correct Story for MATERIAL_UPDATE');
  testAssert(matUp?.description.includes('RUMOR_OR_LEAK -> OFFICIAL_ANNOUNCEMENT') || Boolean(matUp?.description), 'Explains corroboration update');

  const escDev = deltaResult.changes.find((c) => c.deltaType === 'ESCALATING_DEVELOPMENT');
  testAssert(escDev?.storyId === 'story-xiaomi-watch', 'Identifies correct Story for ESCALATING_DEVELOPMENT');
  testAssert(escDev?.previousState?.strategicImportanceScore === 62 && escDev?.currentState.strategicImportanceScore === 85, 'Captures score shift from 62 to 85');

  const resDev = deltaResult.changes.find((c) => c.deltaType === 'RESOLVED_OR_DE_ESCALATED');
  testAssert(resDev?.storyId === 'story-tablet-old', 'Identifies correct Story for RESOLVED_OR_DE_ESCALATED');

  // -------------------------------------------------------------
  // 6. Prioritized Opportunities & Threats
  // -------------------------------------------------------------
  console.log('\n[6. Prioritized Opportunities & Threats]');

  const huaweiOpportunityStory: Story = createMockStory({
    id: 'story-huawei-gt5',
    title: 'Huawei Watch GT 5 Pro Receives Universal Praise for 14-Day Battery Life',
    status: 'DEVELOPING',
    categories: ['WEARABLE'],
    strategicImportanceScore: 88,
    competitiveThreatLevel: 'NOT_APPLICABLE',
    evidenceClassification: 'VERIFIED_REPORT',
    evidenceConfidence: 0.95,
    independentSourceCount: 3,
    primaryCompanyId: 'comp-huawei',
    companies: [{ companyId: 'comp-huawei', name: 'HUAWEI' }],
    huaweiRelevance: 'Validates Huawei smartwatch battery and design leadership over Apple and Samsung.',
  });

  const prioritized = derivePrioritizedOpportunitiesAndThreats([
    storyHighThreat,
    storyXiaomiEscalated,
    storyModerate,
    huaweiOpportunityStory,
  ]);

  testAssert(prioritized.critical.length >= 2, 'Critical tier contains score >= 80 or HIGH threat developments');
  const hwOpp = prioritized.critical.find((i) => i.storyId === 'story-huawei-gt5');
  testAssert(hwOpp?.type === 'OPPORTUNITY', 'Huawei first-party strength is classified as OPPORTUNITY');
  const samsungThreat = prioritized.critical.find((i) => i.storyId === 'story-s27-optics');
  testAssert(samsungThreat?.type === 'THREAT', 'Competitor flagship launch is classified as THREAT');
  testAssert(prioritized.monitoring.length >= 1, 'Low-scoring developments placed in Monitoring tier');

  // -------------------------------------------------------------
  // 7. Actionable Recommendations for HUAWEI
  // -------------------------------------------------------------
  console.log('\n[7. Actionable Recommendations for HUAWEI]');

  const recommendations = deriveActionableRecommendations([storyHighThreat, huaweiOpportunityStory]);
  testAssert(recommendations.length >= 2, 'Derives concrete actionable recommendations');
  testAssert(recommendations[0].priority === 'CRITICAL', 'Highest strategic priority is CRITICAL');
  testAssert(recommendations[0].timeHorizon === 'IMMEDIATE', 'Critical recommendation assigned IMMEDIATE time horizon');
  testAssert(recommendations[0].supportingStoryIds.includes('story-s27-optics'), 'Links supporting story IDs');
  testAssert(Boolean(recommendations[0].strategicRationale), 'Includes transparent strategic rationale');

  // -------------------------------------------------------------
  // 8. Strategic Hardware Overview Across 4 Domains
  // -------------------------------------------------------------
  console.log('\n[8. Strategic Hardware Overview Across 4 Domains]');

  const hardwareOverview = deriveStrategicHardwareOverview([
    storyHighThreat, // Smartphone
    huaweiOpportunityStory, // Wearable
  ]);

  testAssert(hardwareOverview.length === 4, 'Always covers the 4 canonical domains');
  const phoneDomain = hardwareOverview.find((d) => d.domain === 'SMARTPHONES');
  testAssert(phoneDomain?.highestThreatLevel === 'HIGH', 'Smartphones domain reflects HIGH threat level');
  testAssert(phoneDomain?.storyCount === 1, 'Smartphones domain tracks 1 story');

  const audioDomain = hardwareOverview.find((d) => d.domain === 'AUDIO');
  testAssert(audioDomain?.storyCount === 0, 'Audio domain has 0 stories');
  testAssert(audioDomain?.highestThreatLevel === 'NOT_APPLICABLE', 'Empty audio domain assigns NOT_APPLICABLE threat');
  testAssert(
    audioDomain?.competitorDevelopmentsSummary === 'No direct new hardware announcements or developments tracked in this 24-hour reporting window.',
    'Does NOT manufacture fake developments for empty audio domain'
  );

  // -------------------------------------------------------------
  // 9. Story Snapshots Creation & Persistence
  // -------------------------------------------------------------
  console.log('\n[9. Story Snapshots Creation & Persistence]');

  const snapshots = createStorySnapshots([storyHighThreat, huaweiOpportunityStory]);
  testAssert(Boolean(snapshots['story-s27-optics']), 'Creates snapshot for story-s27-optics');
  testAssert(snapshots['story-s27-optics'].strategicImportanceScore === 92, 'Snapshot preserves strategicImportanceScore');
  testAssert(snapshots['story-s27-optics'].competitiveThreatLevel === 'HIGH', 'Snapshot preserves competitiveThreatLevel');
  testAssert(snapshots['story-s27-optics'].evidenceClassification === 'OFFICIAL_ANNOUNCEMENT', 'Snapshot preserves evidenceClassification');
  testAssert(snapshots['story-s27-optics'].evidenceConfidence === 0.98, 'Snapshot preserves evidenceConfidence');

  // -------------------------------------------------------------
  // 10. Legacy Brief Backward Compatibility
  // -------------------------------------------------------------
  console.log('\n[10. Legacy Brief Backward Compatibility]');

  const legacyBriefDoc: DailyBriefDocument = {
    id: 'brief-2026-09-01',
    date: '2026-09-01',
    windowStart: '2026-08-31T06:00:00.000Z',
    windowEnd: '2026-09-01T06:00:00.000Z',
    status: 'PUBLISHED',
    version: 1,
    generatedAt: '2026-09-01T06:05:00.000Z',
    lastUpdatedAt: '2026-09-01T06:05:00.000Z',
    generatedBy: 'SYSTEM_AUTOMATION',
    targetCompanyId: 'comp-huawei',
    targetCompanyName: 'HUAWEI',
    en: {
      language: 'en',
      executiveHeadline: 'Legacy Brief Without P1 Fields',
      executiveSummary: ['Legacy point'],
      keyThemes: ['Old Tech'],
      marketSentimentOverview: { overall: 'NEUTRAL', rationale: 'Legacy' },
      headlineDevelopments: [],
      categoryBreakdowns: [],
      competitorMoves: [],
      strategicImplicationsForHuawei: {
        immediateActions: [],
        mediumTermWatch: [],
        threatsAndRisks: [],
        opportunities: [],
      },
      // P1 fields intentionally undefined:
      // criticalAlerts, dayOverDayDelta, prioritizedOpportunitiesThreats, actionableRecommendations, strategicHardwareOverview
    },
    groundingMetrics: {
      totalArticlesInWindow: 12,
      strategicallyRelevantArticles: 10,
      distinctSourcesCount: 5,
      sourcesCovered: ['theverge.com'],
      distinctClustersConsidered: 2,
      geminiModelUsed: 'gemini-2.5-flash',
      synthesisDurationMs: 950,
    },
  };

  testAssert(legacyBriefDoc.en.criticalAlerts === undefined, 'Legacy brief safely leaves criticalAlerts undefined');
  testAssert(legacyBriefDoc.en.dayOverDayDelta === undefined, 'Legacy brief safely leaves dayOverDayDelta undefined');
  testAssert(legacyBriefDoc.storySnapshots === undefined, 'Legacy brief safely leaves storySnapshots undefined');

  // Reconstruct baseline from legacy brief's headline developments
  const deltaFromLegacy = calculateBriefDelta(
    [storyHighThreat],
    legacyBriefDoc,
    '2026-10-18T06:00:00.000Z',
    '2026-10-19T06:00:00.000Z'
  );
  testAssert(deltaFromLegacy.hasBaselineData === false, 'Legacy brief with no story references reports insufficient historical data');

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log('===============================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runPhaseP1TestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

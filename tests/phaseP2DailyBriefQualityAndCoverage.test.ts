/**
 * SIGNALYN — Phase P2 Regression Test Suite:
 * Daily Brief Intelligence Quality & Coverage
 *
 * Verifies:
 * 1. P2.1 Intelligence Coverage Optimization:
 *    - Strategic relevance gate admits Sony (Audio), Lenovo (Tablets), Nothing (Audio/Smartphones), Honor (Smartphones).
 *    - Eliminates false negatives from mobile cross-device comparison articles (e.g. tablet vs laptop, earbuds connecting to PC).
 *    - Strictly excludes non-mobile domains: GPUs (RTX 5090), automotive/EVs (Tesla), aerospace (Boeing), enterprise servers.
 * 2. P2.2 Competitive Intelligence Depth:
 *    - Multi-domain competitor coverage across Smartphones, Watches & Wearables, Audio Devices, Tablets.
 *    - Evaluation of product name, geographic relevance (Europe/Greece), product positioning, differentiation factors.
 * 3. P2.3 Executive Recommendations:
 *    - Actionable Strategic Playbook populates targetTeam (RETAIL_CHANNEL, MARKETING_PR, PRODUCT_STRATEGY, COMPETITIVE_WATCH).
 *    - Explicit confidenceLevel, geographicScope, productName, business rationale.
 *    - Recommendations grounded in cited stories/developments.
 * 4. P2.4 Daily Brief Quality Controls (validateDailyBriefQuality):
 *    - 10-point pre-persistence quality validation gate.
 *    - Validates valid brief passes with 10/10 rules.
 *    - Detects score out of bounds (> 100 or < 0).
 *    - Detects unconfirmed rumors mislabeled as verified.
 *    - Detects invalid/fabricated citation URLs.
 *    - Detects ungrounded recommendations.
 *    - Detects bilingual EN/EL section count divergence.
 * 5. P2.5 Story Intelligence Integration:
 *    - Prioritizes eligible multi-source stories over standalone articles.
 *    - Preserves fallbackDevelopments when 0 stories exist.
 *    - Story ID navigation linking preserved.
 * 6. P2.7 Production Security & Historical Immutability:
 *    - firestore.rules enforces `allow write: if false;` on dailyBriefs.
 *    - No client SDK write fallbacks in server modules.
 *    - Retrieval of historical briefs is strictly read-only.
 */

import { classifyStrategicRelevance } from '../src/server/strategicRelevanceGate';
import {
  validateDailyBriefQuality,
} from '../src/server/dailyBriefGenerator';
import {
  deriveCriticalAlerts,
  deriveActionableRecommendations,
  deriveStrategicHardwareOverview,
  derivePrioritizedOpportunitiesAndThreats,
} from '../src/services/briefDeltaService';
import { Story } from '../src/types';
import { DailyBriefDocument, DailyBriefContent } from '../src/types/dailyBrief';
import * as fs from 'fs';
import * as path from 'path';

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
    importanceScore: partial.strategicImportanceScore ?? 65,
    confidence: partial.evidenceConfidence ?? 0.85,
    articleIds: ['art-1', 'art-2'],
    sourceIds: ['src-1', 'src-2'],
    articleCount: 2,
    sourceCount: partial.independentSourceCount ?? 2,
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

function createValidBriefDoc(): DailyBriefDocument {
  const contentEn: DailyBriefContent = {
    language: 'en',
    executiveHeadline: 'Strategic Intelligence Summary',
    executiveSummary: ['Executive summary covering 24-hour competitive movements.'],
    keyThemes: ['Foldables', 'Audio'],
    marketSentimentOverview: {
      overall: 'CAUTIOUS',
      rationale: 'Rapid foldable adoption in Europe countered by component cost inflation.',
    },
    categoryBreakdowns: [],
    competitorMoves: [],
    strategicImplicationsForHuawei: {
      overall: 'Maintain high promotional awareness in flagship channels.',
      categoryImplications: {} as any,
    },
    criticalAlerts: [
      {
        category: 'SMARTPHONES',
        competitorName: 'Samsung',
        productName: 'Galaxy S25 Ultra',
        geographicScope: 'Europe',
        headline: 'Samsung Galaxy S25 Ultra Announced in Europe',
        whyItMatters: 'Direct flagship rival to HUAWEI Pura 70 series in Europe retail channels.',
        recommendedAction: 'Target Greek telco retail bundles highlighting Pura 70 camera zoom advantage.',
        strategicImportanceScore: 85,
        evidenceConfidence: 0.95,
        competitiveThreatLevel: 'HIGH',
        isUnconfirmedSignal: false,
        evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
        storyId: 'story-s25',
        independentSourceCount: 3,
      },
    ],
    headlineDevelopments: [
      {
        title: 'Samsung Galaxy S25 Ultra Announced in Europe',
        category: 'SMARTPHONES',
        productName: 'Galaxy S25 Ultra',
        geographicRelevance: 'Europe / Greece',
        productPositioning: 'Ultra-premium AI flagship with 200MP camera and Snapdragon 8 Elite',
        strategicAnalysis: ['Aggressive pre-order bundling with Galaxy Watch 7', 'Focus on retail promotions'],
        executiveTakeaway: 'Flagship price point unchanged; competitive retail subsidies expected.',
        implicationForHuawei: 'Pressure on Greek retail carrier promotions for Pura 70 series.',
        strategicRecommendation: 'Strengthen independent retail margin incentives.',
        competitiveThreatLevel: 'HIGH',
        strategicImportanceScore: 85,
        evidenceConfidence: 0.95,
        evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
        storyId: 'story-s25',
        independentSourceCount: 3,
        trackedCompetitors: ['Samsung'],
        groundedCitations: [
          {
            title: 'Samsung Unveils Galaxy S25 Series',
            sourceName: 'GSMArena',
            url: 'https://www.gsmarena.com/samsung_s25_official-news.php',
            articleId: 'art-1',
            sourceId: 'src-1',
            publishedAt: new Date().toISOString(),
          },
        ],
      },
      {
        title: 'Sony LinkBuds Open Released Across European Markets',
        category: 'AUDIO',
        productName: 'LinkBuds Open',
        geographicRelevance: 'Europe',
        productPositioning: 'Open-ear acoustic ring driver design targeting active users',
        strategicAnalysis: ['Direct competition to HUAWEI FreeClip open-ear design', 'Priced at €199 in EU'],
        executiveTakeaway: 'Open-ear segment validation by tier-1 Japanese audio brand.',
        implicationForHuawei: 'Validates FreeClip form factor but creates premium shelf competition.',
        strategicRecommendation: 'Highlight FreeClip 36-hour total battery life versus 22 hours on LinkBuds.',
        competitiveThreatLevel: 'MEDIUM',
        strategicImportanceScore: 72,
        evidenceConfidence: 0.90,
        evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
        storyId: 'story-linkbuds',
        independentSourceCount: 2,
        trackedCompetitors: ['Sony'],
        groundedCitations: [
          {
            title: 'Sony LinkBuds Open Review',
            sourceName: 'WhatHiFi',
            url: 'https://www.whathifi.com/reviews/sony-linkbuds-open',
            articleId: 'art-2',
            sourceId: 'src-2',
            publishedAt: new Date().toISOString(),
          },
        ],
      },
    ],
    strategicHardwareOverview: [
      {
        domain: 'SMARTPHONES',
        title: 'Smartphones',
        storyCount: 1,
        highestThreatLevel: 'HIGH',
        competitorDevelopmentsSummary: 'Samsung S25 Ultra flagship launch.',
        huaweiImplications: 'Flagship positioning defense.',
        recommendedActions: ['Target retail carrier promotions.'],
        supportingStoryIds: ['story-s25'],
      },
      {
        domain: 'AUDIO',
        title: 'Audio Devices',
        storyCount: 1,
        highestThreatLevel: 'MEDIUM',
        competitorDevelopmentsSummary: 'Sony LinkBuds Open launch.',
        huaweiImplications: 'Open-ear market competition.',
        recommendedActions: ['Emphasize FreeClip battery longevity.'],
        supportingStoryIds: ['story-linkbuds'],
      },
    ],
    prioritizedOpportunitiesThreats: {
      critical: [],
      high: [
        {
          type: 'THREAT',
          priority: 'HIGH',
          headline: 'Samsung Galaxy S25 Ultra Launch',
          rationale: 'Direct premium smartphone launch in Europe.',
          implication: 'Competitor retail push in Greece.',
          strategicImportanceScore: 85,
          storyId: 'story-s25',
          category: 'Smartphones',
          threatLevel: 'HIGH',
          evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
          evidenceConfidence: 0.95,
        },
      ],
      medium: [],
      monitoring: [],
    },
    actionableRecommendations: [
      {
        action: 'Reinforce Greek carrier partnerships for HUAWEI Pura 70 series.',
        strategicRationale: 'Direct flagship competitor launched with heavy telco subsidies.',
        priority: 'HIGH',
        timeHorizon: 'IMMEDIATE',
        targetTeam: 'RETAIL_CHANNEL',
        confidenceLevel: 0.95,
        productName: 'Galaxy S25 Ultra',
        geographicScope: 'Europe / Greece',
        competitorName: 'Samsung',
        category: 'SMARTPHONES',
        supportingStoryIds: ['story-s25'],
        evidenceReliability: 'OFFICIAL',
      },
    ],
    keyCompetitorsCovered: ['Samsung', 'Sony'],
    generationTimestamp: new Date().toISOString(),
  } as any;

  const contentEl: DailyBriefContent = {
    ...contentEn,
    language: 'el',
    executiveSummary: ['Σύνοψη ημερήσιας ανταγωνιστικής πληροφόρησης για τις τελευταίες 24 ώρες.'],
  } as any;

  return {
    id: 'brief-2026-10-23',
    briefDate: '2026-10-23',
    date: '2026-10-23',
    generatedAt: new Date().toISOString(),
    reportingWindowStart: '2026-10-22T00:00:00.000Z',
    reportingWindowEnd: '2026-10-23T00:00:00.000Z',
    status: 'PUBLISHED',
    en: contentEn,
    el: contentEl,
    contentEn,
    contentEl,
    summaryMetrics: {
      totalStoriesConsidered: 2,
      criticalAlertsCount: 1,
      highThreatCount: 1,
      activeCompetitorsCount: 2,
      hardwareCategoryBreadth: 2,
      averageStrategicScore: 78.5,
      averageEvidenceConfidence: 0.925,
      materialDeltasCount: 1,
    },
    groundingMetrics: {
      totalArticlesInWindow: 4,
      strategicallyRelevantArticles: 4,
      distinctSourcesCount: 2,
      sourcesCovered: ['GSMArena', 'WhatHiFi'],
      distinctClustersConsidered: 2,
      storyIntegrationMode: 'STORY_ENRICHED',
      storiesUsed: 2,
      storiesEligible: 2,
      storiesQueried: 2,
      storiesExcludedArchived: 0,
      storiesExcludedOutOfScope: 0,
      sourceArticlesGrounded: 4,
      geminiModelUsed: 'gemini-2.5-flash',
      synthesisDurationMs: 1200,
    },
    briefStatus: 'COMPLETE',
    generatorVersion: '4.0.0-phase-p2',
  } as any;
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('SIGNALYN — PHASE P2 TEST SUITE: INTELLIGENCE QUALITY & COVERAGE');
  console.log('===============================================================\n');

  // =========================================================================
  // SUITE 1: P2.1 Intelligence Coverage Optimization & Classification Gate
  // =========================================================================
  console.log('--- Suite 1: Intelligence Coverage Optimization (P2.1) ---');

  // Test 1.1: Sony Audio Devices recognized
  const sonyAudio = classifyStrategicRelevance({
    title: 'Sony LinkBuds Open launch in Europe with open-ring acoustic driver',
    excerpt: 'Sony has announced the LinkBuds Open wireless earbuds featuring an open-ear design priced at €199 across EU markets.',
  });
  testAssert(
    sonyAudio.decision === 'IN_SCOPE' && sonyAudio.category === 'AUDIO',
    'Sony LinkBuds Open recognized as AUDIO in-scope',
    `Expected IN_SCOPE/AUDIO, got ${sonyAudio.decision}/${sonyAudio.category}`
  );

  // Test 1.2: Lenovo Tablets recognized
  const lenovoTablet = classifyStrategicRelevance({
    title: 'Lenovo Tab Plus launched with eight JBL speakers and kickstand',
    excerpt: 'Lenovo introduces the new Tab Plus Android tablet featuring high-end speakers and a 11.5-inch 2K display.',
  });
  testAssert(
    lenovoTablet.decision === 'IN_SCOPE' && lenovoTablet.category === 'TABLET',
    'Lenovo Tab Plus recognized as TABLET in-scope',
    `Expected IN_SCOPE/TABLET, got ${lenovoTablet.decision}/${lenovoTablet.category}`
  );

  // Test 1.3: Nothing Ear earbuds recognized
  const nothingAudio = classifyStrategicRelevance({
    title: 'Nothing Ear (a) wireless earbuds review: Affordable ANC champion',
    excerpt: 'The Nothing Ear (a) earbuds deliver excellent active noise cancellation and distinctive transparent design.',
  });
  testAssert(
    nothingAudio.decision === 'IN_SCOPE' && nothingAudio.category === 'AUDIO',
    'Nothing Ear (a) recognized as AUDIO in-scope',
    `Expected IN_SCOPE/AUDIO, got ${nothingAudio.decision}/${nothingAudio.category}`
  );

  // Test 1.4: Honor 200 Pro smartphone recognized
  const honorPhone = classifyStrategicRelevance({
    title: 'Honor 200 Pro brings Harcourt studio portraits to European smartphone buyers',
    excerpt: 'Honor expands in Europe with the Honor 200 Pro smartphone featuring Snapdragon 8s Gen 3 and AI portrait engine.',
  });
  testAssert(
    honorPhone.decision === 'IN_SCOPE' && honorPhone.category === 'SMARTPHONE',
    'Honor 200 Pro recognized as SMARTPHONE in-scope',
    `Expected IN_SCOPE/SMARTPHONE, got ${honorPhone.decision}/${honorPhone.category}`
  );

  // Test 1.5: Tablet comparison vs laptop NOT falsely excluded by "laptop" token
  const tabletVsLaptop = classifyStrategicRelevance({
    title: 'Lenovo productivity tablet aims to replace laptops for mobile business travelers',
    excerpt: 'The new Android tablet offers desktop productivity mode and keyboard folio as a lightweight laptop alternative.',
  });
  testAssert(
    tabletVsLaptop.decision === 'IN_SCOPE' && tabletVsLaptop.category === 'TABLET',
    'Tablet vs laptop comparison article preserved in-scope (no false negative)',
    `Expected IN_SCOPE/TABLET, got ${tabletVsLaptop.decision}/${tabletVsLaptop.category}`
  );

  // Test 1.6: Earbuds audio switching to PC/laptop NOT falsely excluded
  const budsSwitching = classifyStrategicRelevance({
    title: 'Samsung Galaxy Buds 3 Pro update improves seamless audio switching with Windows laptops',
    excerpt: 'Samsung releases new firmware for Galaxy Buds 3 Pro wireless earbuds to switch audio between phones and PC laptops effortlessly.',
  });
  testAssert(
    budsSwitching.decision === 'IN_SCOPE' && budsSwitching.category === 'AUDIO',
    'Earbuds multi-point switching with laptop preserved in-scope (no false negative)',
    `Expected IN_SCOPE/AUDIO, got ${budsSwitching.decision}/${budsSwitching.category}`
  );

  // Test 1.7: Irrelevant GPU benchmark excluded
  const gpuArticle = classifyStrategicRelevance({
    title: 'Nvidia GeForce RTX 5090 GPU benchmarks leak with massive power consumption',
    excerpt: 'The upcoming Blackwell desktop graphics card RTX 5090 is slated to demand 600W power draw for gaming rigs.',
  });
  testAssert(
    gpuArticle.decision === 'OUT_OF_SCOPE',
    'Nvidia RTX 5090 GPU strictly excluded as OUT_OF_SCOPE',
    `Expected OUT_OF_SCOPE, got ${gpuArticle.decision}`
  );

  // Test 1.8: Irrelevant Automotive EV crash test excluded
  const evArticle = classifyStrategicRelevance({
    title: 'Tesla Model 3 electric vehicle undergoes European NCAP crash safety test',
    excerpt: 'Euro NCAP tests the latest Tesla Model 3 sedan automated emergency braking and occupant safety.',
  });
  testAssert(
    evArticle.decision === 'OUT_OF_SCOPE',
    'Tesla Model 3 EV car test strictly excluded as OUT_OF_SCOPE',
    `Expected OUT_OF_SCOPE, got ${evArticle.decision}`
  );

  // Test 1.9: Irrelevant Aerospace satellite excluded
  const aerospaceArticle = classifyStrategicRelevance({
    title: 'Boeing Starliner spacecraft undocks from International Space Station for orbital descent',
    excerpt: 'The uncrewed Boeing capsule performs orbital maneuvers over the Pacific Ocean.',
  });
  testAssert(
    aerospaceArticle.decision === 'OUT_OF_SCOPE',
    'Boeing aerospace spacecraft strictly excluded as OUT_OF_SCOPE',
    `Expected OUT_OF_SCOPE, got ${aerospaceArticle.decision}`
  );

  // =========================================================================
  // SUITE 2: P2.2 & P2.3 Competitive Intelligence Depth & Executive Recommendations
  // =========================================================================
  console.log('\n--- Suite 2: Competitive Depth & Executive Recommendations (P2.2 & P2.3) ---');

  const mockStories: Story[] = [
    createMockStory({
      id: 'story-s25',
      title: 'Samsung Galaxy S25 Ultra flagship launch in Europe',
      categories: ['SMARTPHONE'],
      primaryCompany: 'Samsung',
      strategicImportanceScore: 88,
      evidenceConfidence: 0.95,
      competitiveThreatLevel: 'HIGH',
      evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
      independentSourceCount: 4,
      whyItMatters: 'Samsung locks down premium carrier retail contracts in Europe and Greece.',
      actionableRecommendations: [
        'Secure co-op marketing agreements with Greek telco chains for HUAWEI Pura 70 series.',
      ],
    } as any),
    createMockStory({
      id: 'story-linkbuds',
      title: 'Sony LinkBuds Open launch expands open-ear wireless audio segment',
      categories: ['AUDIO'],
      primaryCompany: 'Sony',
      strategicImportanceScore: 74,
      evidenceConfidence: 0.90,
      competitiveThreatLevel: 'MEDIUM',
      evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
      independentSourceCount: 3,
      whyItMatters: 'Direct competition to HUAWEI FreeClip open-ear design across European retail.',
      actionableRecommendations: [
        'Emphasize HUAWEI FreeClip 36-hour battery advantage vs Sony LinkBuds 22 hours.',
      ],
    } as any),
  ];

  // Test 2.1: Critical Alerts derive product and geographic metadata
  const alerts = deriveCriticalAlerts(mockStories, 'en');
  testAssert(alerts.length === 1, 'Critical alert derived for high-threat flagship story', `Count: ${alerts.length}`);
  testAssert(alerts[0].productName === 'Galaxy S25 Ultra', 'Product name extracted for critical alert', `Got: ${alerts[0].productName}`);
  testAssert(alerts[0].geographicScope === 'Europe', 'Geographic scope extracted for critical alert', `Got: ${alerts[0].geographicScope}`);

  // Test 2.2: Actionable Recommendations populate targetTeam, confidenceLevel, geographicScope
  const recommendations = deriveActionableRecommendations(mockStories, 'en');
  testAssert(recommendations.length >= 2, 'Actionable recommendations generated', `Count: ${recommendations.length}`);
  const s25Rec = recommendations.find((r) => r.competitorName === 'Samsung');
  testAssert(Boolean(s25Rec), 'Recommendation exists for Samsung story');
  if (s25Rec) {
    testAssert(
      s25Rec.targetTeam === 'RETAIL_CHANNEL',
      'Target team assigned appropriately (RETAIL_CHANNEL for carrier co-op)',
      `Got: ${s25Rec.targetTeam}`
    );
    testAssert(
      s25Rec.confidenceLevel === 0.95,
      'Confidence level matches story evidence confidence',
      `Got: ${s25Rec.confidenceLevel}`
    );
    testAssert(
      s25Rec.geographicScope === 'Europe / Greece',
      'Geographic scope set to Europe / Greece',
      `Got: ${s25Rec.geographicScope}`
    );
    testAssert(
      s25Rec.productName === 'Galaxy S25 Ultra',
      'Product name populated on recommendation',
      `Got: ${s25Rec.productName}`
    );
  }

  // =========================================================================
  // SUITE 3: P2.4 Daily Brief Quality Controls (validateDailyBriefQuality)
  // =========================================================================
  console.log('\n--- Suite 3: Daily Brief Pre-Persistence Quality Controls (P2.4) ---');

  // Test 3.1: Valid brief passes all 10 quality checks
  const validDoc = createValidBriefDoc();
  const validReport = validateDailyBriefQuality(validDoc);
  testAssert(validReport.passed, 'Valid brief passes quality gate', `Errors: ${validReport.errors.join('; ')}`);
  testAssert(validReport.checksPassed === 10, 'All 10 quality rules pass', `Passed: ${validReport.checksPassed}/10`);
  testAssert(validReport.errors.length === 0, 'No quality errors detected');

  // Test 3.2: Rule 6 violation - Strategic score out of bounds (> 100)
  const invalidScoreDoc = createValidBriefDoc();
  invalidScoreDoc.en.headlineDevelopments[0].strategicImportanceScore = 125;
  const scoreReport = validateDailyBriefQuality(invalidScoreDoc);
  testAssert(!scoreReport.passed, 'Quality gate fails when strategic score > 100');
  testAssert(
    scoreReport.errors.some((e) => e.includes('Score Integrity')),
    'Score Integrity boundary violation recorded',
    `Errors: ${scoreReport.errors.join('; ')}`
  );

  // Test 3.3: Rule 3 violation - Rumor without unconfirmed signal banner
  const rumorDoc = createValidBriefDoc();
  if (rumorDoc.en.criticalAlerts?.[0]) {
    rumorDoc.en.criticalAlerts[0].evidenceClassification = 'RUMOR_OR_LEAK';
    rumorDoc.en.criticalAlerts[0].isUnconfirmedSignal = false; // VIOLATION: Rumor marked as confirmed!
  }
  const rumorReport = validateDailyBriefQuality(rumorDoc);
  testAssert(!rumorReport.passed, 'Quality gate fails when rumor is presented without unconfirmed banner');
  testAssert(
    rumorReport.errors.some((e) => e.includes('Rumor Safeguards')),
    'Rumor Safeguards violation recorded',
    `Errors: ${rumorReport.errors.join('; ')}`
  );

  // Test 3.4: Rule 4 violation - Fabricated citation URL (invalid format)
  const fakeUrlDoc = createValidBriefDoc();
  fakeUrlDoc.en.headlineDevelopments[0].groundedCitations = [
    { title: 'Fake Announcement', sourceName: 'Unknown', url: 'not-a-valid-url', articleId: 'fake-art', sourceId: 'fake-src', publishedAt: new Date().toISOString() },
  ];
  const urlReport = validateDailyBriefQuality(fakeUrlDoc);
  testAssert(!urlReport.passed, 'Quality gate fails on fabricated/invalid citation URL');
  testAssert(
    urlReport.errors.some((e) => e.includes('Citation Grounding')),
    'Citation Grounding authenticity violation recorded',
    `Errors: ${urlReport.errors.join('; ')}`
  );

  // Test 3.5: Rule 8 violation - Bilingual content divergence (Greek missing critical alerts)
  const divergentDoc = createValidBriefDoc();
  if (divergentDoc.el) {
    divergentDoc.el.criticalAlerts = []; // Missing Greek critical alerts
  }
  const divReport = validateDailyBriefQuality(divergentDoc);
  testAssert(!divReport.passed, 'Quality gate fails when Greek translation diverges structurally from English');
  testAssert(
    divReport.errors.some((e) => e.includes('Bilingual Consistency')),
    'Bilingual Consistency parity violation recorded',
    `Errors: ${divReport.errors.join('; ')}`
  );

  // =========================================================================
  // SUITE 4: P2.5 Story Intelligence Integration
  // =========================================================================
  console.log('\n--- Suite 4: Story Intelligence Integration (P2.5) ---');

  // Test 4.1: STORY_ENRICHED mode is active when stories exist
  testAssert(
    validDoc.groundingMetrics.storyIntegrationMode === 'STORY_ENRICHED',
    'STORY_ENRICHED mode specified in grounding metrics'
  );
  testAssert(
    validDoc.en.criticalAlerts?.[0]?.storyId === 'story-s25',
    'Direct story navigation preserved on critical alerts'
  );

  // Test 4.2: Fallback developments function when no stories are provided
  const fallbackRecs = deriveActionableRecommendations(
    [],
    'en',
    [
      {
        title: 'Xiaomi Pad 7 Series enters European tablet market',
        category: 'TABLETS',
        competitorName: 'Xiaomi',
        trackedCompetitors: ['Xiaomi'],
        productName: 'Pad 7 Pro',
        geographicRelevance: 'Europe',
        strategicAnalysis: ['Aggressive mid-tier tablet pricing'],
        executiveTakeaway: 'Xiaomi targets budget-conscious students and remote workers.',
        implicationForHuawei: 'Price competition for MatePad 11.5S PaperMatte edition in Greece.',
        strategicRecommendation: 'Highlight HUAWEI M-Pencil latency and PaperMatte anti-glare display advantage in retail displays.',
        competitiveThreatLevel: 'MEDIUM',
      } as any,
    ]
  );
  testAssert(fallbackRecs.length === 1, 'Actionable recommendations generated from fallback developments when stories = 0');
  testAssert(fallbackRecs[0].competitorName === 'Xiaomi', 'Competitor assigned on fallback recommendation');
  testAssert(fallbackRecs[0].productName === 'Pad 7 Pro', 'Product name assigned on fallback recommendation');
  testAssert(fallbackRecs[0].targetTeam === 'RETAIL_CHANNEL', 'Target team assigned on fallback recommendation');

  // =========================================================================
  // SUITE 5: P2.7 Production Security & Data Integrity
  // =========================================================================
  console.log('\n--- Suite 5: Production Security & Data Integrity (P2.7) ---');

  // Test 5.1: Verify firestore.rules strictly forbids client writes to dailyBriefs
  const firestoreRulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const firestoreRulesContent = fs.readFileSync(firestoreRulesPath, 'utf-8');
  const dailyBriefRuleMatch = firestoreRulesContent.match(/match\s+\/dailyBriefs\/\{briefId\}\s*\{([\s\S]*?)\}/);
  testAssert(Boolean(dailyBriefRuleMatch), 'match /dailyBriefs/{briefId} block exists in firestore.rules');
  if (dailyBriefRuleMatch) {
    const ruleBody = dailyBriefRuleMatch[1];
    testAssert(
      ruleBody.includes('allow write: if false;') || ruleBody.includes('allow create: if false;'),
      'firestore.rules enforces write: if false on dailyBriefs'
    );
  }

  // Test 5.2: Verify no client SDK write fallbacks exist in server files
  const dailyBriefGenPath = path.resolve(process.cwd(), 'src/server/dailyBriefGenerator.ts');
  const dailyBriefGenCode = fs.readFileSync(dailyBriefGenPath, 'utf-8');
  testAssert(
    !dailyBriefGenCode.includes("import { db } from '../firebase'") &&
    !dailyBriefGenCode.includes("from '../firebase'") &&
    !dailyBriefGenCode.includes('setDoc('),
    'dailyBriefGenerator.ts contains zero client SDK write fallbacks'
  );

  // Test 5.3: Verify getDailyBrief retrieval preserves immutability (does not call set or update)
  const getDailyBriefMatch = dailyBriefGenCode.match(/export async function getDailyBrief[\s\S]*?^}/m);
  if (getDailyBriefMatch) {
    const getBriefFunc = getDailyBriefMatch[0];
    testAssert(
      !getBriefFunc.includes('.set(') &&
      !getBriefFunc.includes('.update(') &&
      !getBriefFunc.includes('generateDailyBrief('),
      'getDailyBrief is strictly read-only and does not mutate or regenerate Firestore docs'
    );
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n===============================================================');
  console.log(`PHASE P2 TEST RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log('===============================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test runner failure:', err);
  process.exit(1);
});

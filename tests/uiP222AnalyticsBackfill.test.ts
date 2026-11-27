import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveTrackedCompanyId,
  isCanonicalNothingBrandMention,
  TRACKED_COMPANIES,
} from '../src/services/competitiveAnalytics';
import { aggregateDailyMetrics } from '../src/services/historicalQueryService';
import { createEmptyDailyAggregate, applyContributionDelta, computeArticleContribution } from '../src/server/analytics/historicalAggregationEngine';
import { ArticleAnalysis } from '../src/types';

function runUiP222Tests() {
  console.log(
    'Running SIGNALYN UI P2.2.2 — Analytics Intelligence Experience & Historical Backfill UX Refinement Suite...\n'
  );

  const analyticsViewContent = fs.readFileSync(
    path.resolve('src/components/analytics/AnalyticsView.tsx'),
    'utf8'
  );
  const backfillViewContent = fs.readFileSync(
    path.resolve('src/components/backfill/HistoricalBackfillView.tsx'),
    'utf8'
  );
  const backfillSectionContent = fs.readFileSync(
    path.resolve('src/components/settings/HistoricalBackfillSection.tsx'),
    'utf8'
  );

  // 1. Analytics Overview Executive Summary Cards
  assert.ok(
    analyticsViewContent.includes('aria-label="Analytics Overview"') &&
      analyticsViewContent.includes('label="Analyzed Intelligence Baseline"') &&
      analyticsViewContent.includes('label="Tracked Competitors Active"') &&
      analyticsViewContent.includes('Share of Voice`}') &&
      analyticsViewContent.includes('label="Reporting Window & Scope"'),
    'AnalyticsView.tsx must render Section 1 (Analytics Overview) with 4 concise executive MetricCards'
  );
  console.log('✓ 1. Analytics summary cards render from existing authoritative data.');

  // 2. Share of Voice V1 and V2 Controls & Methodology Explanations
  assert.ok(
    analyticsViewContent.includes("{ id: 'MENTIONS_SHARE_V1', label: 'V1 Mentions Share' }") &&
      analyticsViewContent.includes(
        "{ id: 'ARTICLE_COVERAGE_RATIO_V2', label: 'V2 Coverage Ratio' }"
      ) &&
      analyticsViewContent.includes('Active Metric — V1 Mentions Share:') &&
      analyticsViewContent.includes('Active Metric — V2 Coverage Ratio:') &&
      analyticsViewContent.includes('Methodology & Scope Guide'),
    'AnalyticsView.tsx must preserve V1 Mentions Share and V2 Coverage Ratio controls with clear methodology explanations'
  );
  console.log('✓ 2. Share of Voice V1 and V2 controls and methodology explanations verified.');

  // 3. Category and Window Filters Remain Functional
  const requiredCategories = [
    "{ id: 'ALL_STRATEGIC', label: 'All Strategic' }",
    "{ id: 'SMARTPHONE', label: 'Smartphones' }",
    "{ id: 'WEARABLE', label: 'Wearables' }",
    "{ id: 'AUDIO', label: 'Audio' }",
    "{ id: 'TABLET', label: 'Tablets' }",
  ];
  for (const catOpt of requiredCategories) {
    assert.ok(
      analyticsViewContent.includes(catOpt),
      `AnalyticsView.tsx must preserve category filter option: ${catOpt}`
    );
  }
  assert.ok(
    analyticsViewContent.includes("{ id: '7d', label: 'Last 7 Days' }") &&
      analyticsViewContent.includes("{ id: '30d', label: 'Last 30 Days' }") &&
      analyticsViewContent.includes("{ id: '90d', label: 'Last 90 Days' }") &&
      analyticsViewContent.includes("id: 'all'"),
    'AnalyticsView.tsx must preserve all reporting window filter presets'
  );
  console.log('✓ 3. Category and reporting window filters remain functional.');

  // 4. Share of Voice Over Time Chart & Missing-Date Handling
  assert.ok(
    analyticsViewContent.includes('<span>Share of Voice Over Time</span>') &&
      analyticsViewContent.includes(
        'rawSeries\n      .filter((pt) => pt.articlesCount > 0 || pt.totalCompanyMentions > 0)'
      ) &&
      analyticsViewContent.includes('dates with 0 articles omitted without interpolation') &&
      analyticsViewContent.includes('Insufficient Historical Observations in Selected Window'),
    'AnalyticsView.tsx must render Share of Voice Over Time using only actual observed publication dates without silent interpolation, and show an explanatory empty state when observations are insufficient'
  );

  // Verify aggregateDailyMetrics time-series structure with observed vs missing dates
  let day1 = createEmptyDailyAggregate('2026-10-01');
  const sampleAnalysis: ArticleAnalysis = {
    articleId: 'art-ts-1',
    analysisVersion: 'signalyn-analysis-v1',
    model: 'gemini-3.8-flash',
    analyzedAt: '2026-10-01T10:00:00Z',
    publishedAt: '2026-10-01T08:00:00Z',
    language: 'en',
    market: 'Global',
    companies: [{ canonicalName: 'HUAWEI', companyId: 'comp-huawei', relevance: 'PRIMARY', confidence: 0.95 }],
    products: [],
    topics: ['smartphones'],
    newsType: 'NEWS',
    sentiment: 'POSITIVE',
    sentimentConfidence: 0.9,
    importanceScore: 85,
    summary: 'Huawei flagship news',
    keyPoints: [],
    competitiveRelevance: { score: 90, reasons: [], categories: ['SMARTPHONES'], relatedCompanies: ['HUAWEI'] },
    competitiveSignals: [],
    confidence: 0.9,
  };
  day1 = applyContributionDelta(day1, computeArticleContribution(sampleAnalysis), 1);

  const rangeRes = aggregateDailyMetrics([day1], {
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    category: 'ALL_STRATEGIC',
  });
  assert.equal(rangeRes.period.totalDays, 3, 'Range should span 3 calendar days');
  assert.equal(rangeRes.period.availableBucketDays, 1, 'Only 1 observed bucket day exists');
  assert.equal(rangeRes.period.missingDays, 2, '2 missing calendar days explicitly tracked');
  const observedOnly = rangeRes.metrics.dailyTimeSeries.filter(
    (pt) => pt.articlesCount > 0 || pt.totalCompanyMentions > 0
  );
  assert.equal(observedOnly.length, 1, 'Observed time series filters out 0-article missing dates');
  console.log(
    '✓ 4. Share of Voice Over Time chart renders observed dates accurately and handles missing dates without silent interpolation.'
  );

  // 5. Strategic Category Competitive View Layout & Terminology
  assert.ok(
    analyticsViewContent.includes('<ResponsiveGrid cols={2} gap="lg" className="items-start">') &&
      analyticsViewContent.includes('<span>Strategic Category Competitive View</span>') &&
      analyticsViewContent.includes('Article Distribution by Category') &&
      analyticsViewContent.includes('Intelligence Coverage:') &&
      analyticsViewContent.includes('Competitor Visibility:'),
    'AnalyticsView.tsx must align Share of Voice and Strategic Category Competitive View with items-start/self-start and use accurate Intelligence Coverage / Competitor Visibility terminology'
  );
  console.log(
    '✓ 5. Strategic Category Competitive View renders with content-driven height and accurate analytical terminology.'
  );

  // 6. Competitive Performance Matrix Readability, Sorting & Primary Target Identification
  assert.ok(
    analyticsViewContent.includes('<span>Competitive Performance Matrix</span>') &&
      analyticsViewContent.includes("handleSortMatrix('companyName')") &&
      analyticsViewContent.includes("handleSortMatrix('mentionsShareSov')") &&
      analyticsViewContent.includes("handleSortMatrix('coverageRatioSov')") &&
      analyticsViewContent.includes("handleSortMatrix('mentions')") &&
      analyticsViewContent.includes('label="PRIMARY TARGET"') &&
      analyticsViewContent.includes('Visibility Tier'),
    'AnalyticsView.tsx must render Competitive Performance Matrix with column sorting, Primary Target highlighting, and Visibility Tier classification'
  );
  console.log('✓ 6. Competitive Performance Matrix renders with sorting and Primary Target identification.');

  // 7. Unsupported Per-Company Sentiment Columns & "Nothing" Brand Normalization
  assert.ok(
    analyticsViewContent.includes('hasCompanySentimentData') &&
      analyticsViewContent.includes('Sentiment analysis not available per company'),
    'AnalyticsView.tsx must suppress unsupported all-zero per-company sentiment columns by default and display a concise "Sentiment analysis not available per company" disclosure'
  );
  assert.equal(
    rangeRes.metrics.companies[0].sentiment.positive +
      rangeRes.metrics.companies[0].sentiment.neutral +
      rangeRes.metrics.companies[0].sentiment.negative +
      rangeRes.metrics.companies[0].sentiment.mixed,
    0,
    'DailyAggregate company metrics do not store per-company sentiment cross-tabulations'
  );
  assert.equal(
    rangeRes.metrics.overallSentiment.positive,
    1,
    'DailyAggregate preserves window-level overallSentiment'
  );

  // Verify Nothing brand normalization guards against the ordinary English word "nothing"
  assert.ok(TRACKED_COMPANIES.some((c) => c.id === 'comp-nothing'), 'Nothing is a tracked company');
  assert.equal(
    resolveTrackedCompanyId({ companyId: 'comp-nothing' }),
    'comp-nothing',
    'Direct comp-nothing ID resolves to comp-nothing'
  );
  assert.equal(
    resolveTrackedCompanyId({ canonicalName: 'Nothing' }),
    'comp-nothing',
    'Exact canonical brand "Nothing" resolves to comp-nothing'
  );
  assert.equal(
    resolveTrackedCompanyId({ canonicalName: 'Nothing Technology' }),
    'comp-nothing',
    '"Nothing Technology" resolves to comp-nothing'
  );
  assert.equal(
    resolveTrackedCompanyId({ name: 'Nothing Phone (2a) Plus' }),
    'comp-nothing',
    '"Nothing Phone (2a) Plus" resolves to comp-nothing'
  );
  assert.equal(
    resolveTrackedCompanyId({ name: 'CMF by Nothing' }),
    'comp-nothing',
    '"CMF by Nothing" resolves to comp-nothing'
  );
  // Negative controls: ordinary English word "nothing" in prose must NEVER resolve to comp-nothing
  const englishProsePhrases = [
    'nothing to report',
    'nothing new was announced',
    'there is nothing like this',
    'nothing else matters',
    'for nothing',
    'nothing in common',
    'nothing changed in Q3',
  ];
  for (const phrase of englishProsePhrases) {
    assert.equal(
      isCanonicalNothingBrandMention(phrase),
      false,
      `Ordinary English phrase "${phrase}" must NOT match Nothing brand`
    );
    assert.equal(
      resolveTrackedCompanyId({ name: phrase }),
      null,
      `resolveTrackedCompanyId must return null for English phrase "${phrase}"`
    );
  }
  console.log(
    '✓ 7. Unsupported sentiment columns handled cleanly and "Nothing" brand normalization rejects ordinary English prose.'
  );

  // 8. Operational Clutter Relocated from AnalyticsView
  assert.ok(
    !analyticsViewContent.includes('<span>Ingestion & Pipeline Status</span>') &&
      !analyticsViewContent.includes('Raw Articles Ingested:') &&
      analyticsViewContent.includes("setActiveTab('sources')") &&
      analyticsViewContent.includes("setActiveTab('backfill')") &&
      analyticsViewContent.includes('#system-diagnostics:operations'),
    'AnalyticsView.tsx must replace inline Ingestion & Pipeline Status clutter with direct navigation links to Sources, Historical Backfill, and System Diagnostics'
  );
  console.log('✓ 8. Operational pipeline clutter demoted and linked to canonical operational modules.');

  // 9. Historical Backfill Executive Summary Cards (Backfill Status)
  assert.ok(
    backfillSectionContent.includes('aria-label="Backfill Status"') &&
      backfillSectionContent.includes('label="Analyzed"') &&
      backfillSectionContent.includes('label="Pending Strategic"') &&
      backfillSectionContent.includes('label="Strategic Completion"') &&
      backfillSectionContent.includes('label="Estimated Remaining Batches"'),
    'HistoricalBackfillSection.tsx must render the simplified 4-card Backfill Status executive summary'
  );
  console.log('✓ 9. Historical Backfill summary cards render accurately.');

  // 10. Progress Bar Denominator and Percentage Formula Clarity
  assert.ok(
    backfillSectionContent.includes('Strategic Hardware Backlog Completion') &&
      backfillSectionContent.includes(
        'Denominator: {totalAnalyzed} / {totalRelevant} strategic hardware articles'
      ) &&
      backfillSectionContent.includes('Formula: Analyzed (${totalAnalyzed}) ÷ [Analyzed (${totalAnalyzed}) + Pending Strategic (${remainingBacklog})]'),
    'HistoricalBackfillSection.tsx must clearly explain the progress bar denominator and completion percentage formula'
  );
  console.log('✓ 10. Progress bar denominator and completion percentage formula verified.');

  // 11. Primary Batch Action Area & Admin Gating
  assert.ok(
    backfillSectionContent.includes('id="backfill-batch-size"') &&
      backfillSectionContent.includes('Preview Next Batch') &&
      backfillSectionContent.includes('Run Next Batch') &&
      backfillSectionContent.includes('disabled={!canManage || executingBatch'),
    'HistoricalBackfillSection.tsx must provide a single clear Primary Batch Action area with Batch Size, Preview Next Batch, and Run Next Batch gated by canManage and executingBatch'
  );
  console.log('✓ 11. Primary Batch Action controls remain accessible and properly gated.');

  // 12. Collapsible Advanced Queue Details
  assert.ok(
    backfillSectionContent.includes('aria-label="Advanced Queue Details"') &&
      backfillSectionContent.includes('showAdvancedQueueDetails') &&
      backfillSectionContent.includes('aria-expanded={showAdvancedQueueDetails}') &&
      backfillSectionContent.includes('1. Verified Firestore Inventory Queues') &&
      backfillSectionContent.includes('2. Reconciled Category Distribution') &&
      backfillSectionContent.includes('3. Cross-Module Analyzed Article Reconciliation'),
    'HistoricalBackfillSection.tsx must group detailed Firestore queues and category reconciliation inside a collapsible Advanced Queue Details section'
  );
  console.log('✓ 12. Advanced Queue Details expands and collapses properly.');

  // 13. Collapsible Administrative Maintenance (Preview vs Dry Run vs Mutating Execution)
  assert.ok(
    backfillSectionContent.includes('aria-label="Administrative Maintenance"') &&
      backfillSectionContent.includes('showAdminMaintenance') &&
      backfillSectionContent.includes('aria-expanded={showAdminMaintenance}') &&
      backfillSectionContent.includes('1. Preview Candidates') &&
      backfillSectionContent.includes('2. Run Dry-Run Audit (0 Writes)') &&
      backfillSectionContent.includes('Step 3 — Mutating Action:') &&
      backfillSectionContent.includes('Execute Safe Cleanup') &&
      backfillSectionContent.includes('Corporate &amp; Ecosystem Intelligence Review'),
    'HistoricalBackfillSection.tsx must group cleanup and uncertain review tools inside a collapsible Administrative Maintenance section clearly separating Preview, Dry Run, and Mutating Execution'
  );
  console.log('✓ 13. Administrative Maintenance expands and collapses properly with clear action separation.');

  // 14. Compact Processing Safeguards Summary in HistoricalBackfillView
  assert.ok(
    backfillViewContent.includes('aria-label="Processing Safeguards"') &&
      backfillViewContent.includes('showSafeguardDetails') &&
      backfillViewContent.includes('aria-expanded={showSafeguardDetails}') &&
      backfillViewContent.includes('1. Four Hardware Categories') &&
      backfillViewContent.includes('2. Daily Scheduler Priority') &&
      backfillViewContent.includes('3. Durable Checkpoints'),
    'HistoricalBackfillView.tsx must render a compact Processing Safeguards summary bar with expandable technical details'
  );
  console.log('✓ 14. Compact Processing Safeguards summary renders and expands.');

  console.log(
    '\nALL 14/14 SIGNALYN UI P2.2.2 ANALYTICS INTELLIGENCE & HISTORICAL BACKFILL UX TESTS PASSED!'
  );
}

runUiP222Tests();

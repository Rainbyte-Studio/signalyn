/**
 * Signalyn Phase 7B.3 Stage 2A: Historical Story Intelligence Dry-Run Enrichment
 *
 * Implements a read-only, deterministic, idempotent pre-flight enrichment
 * evaluation for all production stories in Firestore.
 *
 * Constraints:
 * - NO Firestore writes (read-only execution)
 * - NO Gemini API calls
 * - Reuses canonical Phase 7B.2 evidence verification & Huawei competitive intelligence
 * - Distinguishes independent reporting from independent factual confirmation
 * - Strictly prevents false official confirmation from leaked claims
 * - Distinguishes lastMaterialUpdateAt from updatedAt
 * - Produces comprehensive dry-run report with recovery and cost analysis
 */

import { db } from '../src/firebase';
import { collection, getDocs } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';
import {
  Story,
  Article,
  ArticleAnalysis,
  EvidenceClassification,
  CompetitiveThreatLevel,
  isProductionStory,
} from '../src/types';
import {
  evaluateStoryEvidence,
  EvidenceEvaluationResult,
} from '../src/server/clustering/evidenceVerificationService';
import {
  deriveHuaweiCompetitiveIntelligence,
  HuaweiCompetitiveAssessment,
} from '../src/server/clustering/huaweiCompetitiveService';
import { detectMaterialDevelopment } from '../src/server/clustering/storyIdentityService';

export interface StoryEnrichmentProposal {
  storyId: string;
  canonicalTitle: string;
  category: string;
  primaryCompanyId: string | null;
  status: string;
  articleCount: number;
  currentFields: {
    strategicImportanceScore?: number;
    evidenceClassification?: EvidenceClassification;
    evidenceConfidence?: number;
    independentSourceCount?: number;
    lastMaterialUpdateAt?: string;
    updatedAt: string;
    createdAt: string;
  };
  proposedFields: {
    strategicImportanceScore: number;
    evidenceClassification: EvidenceClassification;
    evidenceConfidence: number;
    independentSourceCount: number;
    lastMaterialUpdateAt: string;
    competitiveThreatLevel: CompetitiveThreatLevel;
    huaweiRelevance: string;
    competitiveImplication: string;
    evidenceReasons: string[];
    hasContradiction: boolean;
  };
  materialUpdateRationale: string;
  requiresManualReview: boolean;
  reviewReasons: string[];
}

export interface DryRunReport {
  timestamp: string;
  phase: string;
  executionMode: 'DRY_RUN_READ_ONLY';
  databaseId: string;
  summary: {
    totalStoriesInDatabase: number;
    productionEligibleStories: number;
    excludedLegacyStories: number;
    storiesWithZeroArticles: number;
    storiesRequiringManualReview: number;
  };
  evidenceDistribution: Record<EvidenceClassification, number>;
  competitiveThreatDistribution: Record<CompetitiveThreatLevel, number>;
  scoreRangeDistribution: {
    tier1_high_80_100: number;
    tier2_medium_60_79: number;
    tier3_moderate_40_59: number;
    tier4_low_0_39: number;
  };
  manualReviewStories: Array<{
    storyId: string;
    title: string;
    reasons: string[];
    evidenceClassification: EvidenceClassification;
    strategicImportanceScore: number;
  }>;
  operationalCosts: {
    estimatedReads: number;
    estimatedWritesOnBackfill: number;
    batchesRequired: number;
    batchSize: number;
  };
  rollbackStrategy: {
    safetyGuarantees: string[];
    backupPlan: string;
    idempotentReruns: string;
  };
  proposalsSample: StoryEnrichmentProposal[];
}

/**
 * Computes deterministic lastMaterialUpdateAt for a story based on chronological article evidence.
 * Strictly separates material developments from updatedAt or routine polling.
 */
export function deriveStoryMaterialUpdateTimestamp(
  story: Story,
  articles: Article[],
  analyses: ArticleAnalysis[],
  evidenceClassification: EvidenceClassification
): { lastMaterialUpdateAt: string; rationale: string } {
  if (articles.length === 0) {
    const fallback = story.firstSeenAt || story.createdAt || new Date().toISOString();
    return {
      lastMaterialUpdateAt: fallback,
      rationale: 'No articles linked; defaulted to story creation timestamp.',
    };
  }

  // Sort articles chronologically by publishedAt / firstReportedAt
  const sorted = [...articles].sort((a, b) => {
    const tA = new Date(a.publishedAt || (a as any).firstReportedAt || 0).getTime();
    const tB = new Date(b.publishedAt || (b as any).firstReportedAt || 0).getTime();
    return tA - tB;
  });

  const analysisMap = new Map<string, ArticleAnalysis>();
  for (const an of analyses) {
    analysisMap.set(an.articleId, an);
  }

  const firstArt = sorted[0];
  let materialTimestamp = firstArt.publishedAt || story.firstSeenAt || story.createdAt;
  let materialReason = 'Initial reporting established storyline.';

  // If single article, initial reporting is the material update
  if (sorted.length === 1) {
    return {
      lastMaterialUpdateAt: materialTimestamp,
      rationale: materialReason,
    };
  }

  // Iterate subsequent articles to detect genuine material updates
  for (let i = 1; i < sorted.length; i++) {
    const art = sorted[i];
    const an = analysisMap.get(art.id);
    if (!an) continue;

    const development = detectMaterialDevelopment(art, an, story, evidenceClassification);
    if (development.isMaterialUpdate) {
      materialTimestamp = art.publishedAt || materialTimestamp;
      materialReason = `Material development (${development.developmentType || 'UPDATE'}): ${development.reason}`;
    }
  }

  return {
    lastMaterialUpdateAt: materialTimestamp,
    rationale: materialReason,
  };
}

/**
 * Executes full dry run enrichment against production Firestore snapshot.
 */
export async function runHistoricalStoryEnrichmentDryRun(): Promise<DryRunReport> {
  console.log('=== SIGNALYN: PHASE 7B.3 STAGE 2A HISTORICAL STORY ENRICHMENT DRY RUN ===\n');

  // 1. Fetch collections in parallel
  console.log('[1/4] Fetching Firestore stories, articles, and analyses...');
  const [storiesSnap, articlesSnap, analysesSnap] = await Promise.all([
    getDocs(collection(db, 'stories')),
    getDocs(collection(db, 'articles')),
    getDocs(collection(db, 'articleAnalysis')),
  ]);

  console.log(`  Fetched ${storiesSnap.size} stories`);
  console.log(`  Fetched ${articlesSnap.size} articles`);
  console.log(`  Fetched ${analysesSnap.size} analyses\n`);

  // Index articles and analyses by ID
  const articlesMap = new Map<string, Article>();
  articlesSnap.forEach((d) => articlesMap.set(d.id, { id: d.id, ...d.data() } as Article));

  const analysesMap = new Map<string, ArticleAnalysis>();
  analysesSnap.forEach((d) => analysesMap.set(d.id, { articleId: d.id, ...d.data() } as ArticleAnalysis));

  const allStories: Story[] = [];
  storiesSnap.forEach((d) => allStories.push({ id: d.id, ...d.data() } as Story));

  // 2. Identify Production Eligible Stories
  const productionStories = allStories.filter(isProductionStory);
  const legacyStories = allStories.filter((s) => !isProductionStory(s));

  console.log(`[2/4] Cohort Segmentation:`);
  console.log(`  Total Stories:       ${allStories.length}`);
  console.log(`  Production Eligible: ${productionStories.length}`);
  console.log(`  Excluded Legacy:     ${legacyStories.length}\n`);

  // 3. Process each production story deterministically
  console.log(`[3/4] Processing ${productionStories.length} production stories with Phase 7B.2 Intelligence Engine...`);

  const proposals: StoryEnrichmentProposal[] = [];
  const evidenceDist: Record<EvidenceClassification, number> = {
    OFFICIAL_ANNOUNCEMENT: 0,
    VERIFIED_REPORT: 0,
    MULTI_SOURCE_CORROBORATED: 0,
    SINGLE_SOURCE_REPORT: 0,
    RUMOR_OR_LEAK: 0,
    UNVERIFIED: 0,
    CONTRADICTED: 0,
  };

  const threatDist: Record<CompetitiveThreatLevel, number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    NOT_APPLICABLE: 0,
  };

  const scoreRanges = {
    tier1_high_80_100: 0,
    tier2_medium_60_79: 0,
    tier3_moderate_40_59: 0,
    tier4_low_0_39: 0,
  };

  let zeroArticlesCount = 0;
  const manualReviewItems: DryRunReport['manualReviewStories'] = [];

  for (const story of productionStories) {
    const artIds = story.articleIds || [];
    const memberArticles: Article[] = [];
    const memberAnalyses: ArticleAnalysis[] = [];

    for (const id of artIds) {
      const art = articlesMap.get(id);
      if (art) memberArticles.push(art);
      const an = analysesMap.get(id);
      if (an) memberAnalyses.push(an);
    }

    if (memberArticles.length === 0) {
      zeroArticlesCount++;
    }

    // A. Evaluate Evidence
    const evidenceResult: EvidenceEvaluationResult = evaluateStoryEvidence(
      memberArticles,
      memberAnalyses,
      story
    );

    // B. Derive Huawei Competitive Intelligence
    const competitiveResult: HuaweiCompetitiveAssessment = deriveHuaweiCompetitiveIntelligence(
      story,
      memberArticles,
      memberAnalyses,
      evidenceResult.evidenceClassification
    );

    // C. Derive Material Update Timestamp
    const materialUpdate = deriveStoryMaterialUpdateTimestamp(
      story,
      memberArticles,
      memberAnalyses,
      evidenceResult.evidenceClassification
    );

    // D. Check for Manual Review triggers
    const reviewReasons: string[] = [];
    if (evidenceResult.hasContradiction) {
      reviewReasons.push('Contradictory reporting detected (e.g. launch vs cancellation).');
    }
    if (evidenceResult.evidenceClassification === 'RUMOR_OR_LEAK' && competitiveResult.strategicImportanceScore >= 80) {
      reviewReasons.push('High-importance rumor (score >= 80) requires editorial awareness.');
    }
    if (memberArticles.length === 0) {
      reviewReasons.push('Story has zero resolved member articles.');
    }
    if (evidenceResult.evidenceConfidence < 0.50) {
      reviewReasons.push(`Low evidence confidence (${evidenceResult.evidenceConfidence.toFixed(2)}).`);
    }

    const requiresManualReview = reviewReasons.length > 0;
    if (requiresManualReview) {
      manualReviewItems.push({
        storyId: story.id,
        title: story.canonicalTitle || story.title || 'Untitled',
        reasons: reviewReasons,
        evidenceClassification: evidenceResult.evidenceClassification,
        strategicImportanceScore: competitiveResult.strategicImportanceScore,
      });
    }

    // Aggregations
    evidenceDist[evidenceResult.evidenceClassification] =
      (evidenceDist[evidenceResult.evidenceClassification] || 0) + 1;
    threatDist[competitiveResult.competitiveThreatLevel] =
      (threatDist[competitiveResult.competitiveThreatLevel] || 0) + 1;

    const score = competitiveResult.strategicImportanceScore;
    if (score >= 80) scoreRanges.tier1_high_80_100++;
    else if (score >= 60) scoreRanges.tier2_medium_60_79++;
    else if (score >= 40) scoreRanges.tier3_moderate_40_59++;
    else scoreRanges.tier4_low_0_39++;

    proposals.push({
      storyId: story.id,
      canonicalTitle: story.canonicalTitle || story.title || 'Untitled',
      category: story.categories?.[0] || story.category || 'OTHER',
      primaryCompanyId: competitiveResult.primaryCompanyId,
      status: story.status || 'UNKNOWN',
      articleCount: memberArticles.length,
      currentFields: {
        strategicImportanceScore: story.strategicImportanceScore,
        evidenceClassification: story.evidenceClassification,
        evidenceConfidence: story.evidenceConfidence,
        independentSourceCount: story.independentSourceCount,
        lastMaterialUpdateAt: story.lastMaterialUpdateAt,
        updatedAt: story.updatedAt || story.lastUpdatedAt || 'N/A',
        createdAt: story.createdAt || 'N/A',
      },
      proposedFields: {
        strategicImportanceScore: competitiveResult.strategicImportanceScore,
        evidenceClassification: evidenceResult.evidenceClassification,
        evidenceConfidence: evidenceResult.evidenceConfidence,
        independentSourceCount: evidenceResult.independentSourceCount,
        lastMaterialUpdateAt: materialUpdate.lastMaterialUpdateAt,
        competitiveThreatLevel: competitiveResult.competitiveThreatLevel,
        huaweiRelevance: competitiveResult.huaweiRelevance,
        competitiveImplication: competitiveResult.competitiveImplication,
        evidenceReasons: evidenceResult.evidenceReasons,
        hasContradiction: evidenceResult.hasContradiction,
      },
      materialUpdateRationale: materialUpdate.rationale,
      requiresManualReview,
      reviewReasons,
    });
  }

  // 4. Assemble Report
  console.log('[4/4] Assembling dry-run validation report...');

  const report: DryRunReport = {
    timestamp: new Date().toISOString(),
    phase: 'Phase 7B.3 Stage 2A',
    executionMode: 'DRY_RUN_READ_ONLY',
    databaseId: 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34',
    summary: {
      totalStoriesInDatabase: allStories.length,
      productionEligibleStories: productionStories.length,
      excludedLegacyStories: legacyStories.length,
      storiesWithZeroArticles: zeroArticlesCount,
      storiesRequiringManualReview: manualReviewItems.length,
    },
    evidenceDistribution: evidenceDist,
    competitiveThreatDistribution: threatDist,
    scoreRangeDistribution: scoreRanges,
    manualReviewStories: manualReviewItems,
    operationalCosts: {
      estimatedReads: storiesSnap.size + articlesSnap.size + analysesSnap.size,
      estimatedWritesOnBackfill: productionStories.length,
      batchesRequired: Math.ceil(productionStories.length / 250),
      batchSize: 250,
    },
    rollbackStrategy: {
      safetyGuarantees: [
        '1. Zero destructive mutations: Backfill performs exclusively atomic update() on existing documents without deleting or replacing them.',
        '2. Preservation of historical keys: story.id, createdAt, articleIds, sourceIds, categories, products, companies are strictly preserved.',
        '3. Fail-closed server-side execution: Admin SDK privileged writes reject any unverified schemas.',
        '4. Idempotent re-runs: Running enrichment repeatedly yields identical outputs.',
      ],
      backupPlan: 'Export full pre-migration JSON snapshot of the /stories collection before executing write batches.',
      idempotentReruns: 'All proposed fields are derived purely from canonical articles and analyses; re-running produces the exact same cryptographic and evidentiary values.',
    },
    proposalsSample: proposals.slice(0, 10),
  };

  const reportPath = path.resolve(process.cwd(), 'scripts/historical_enrichment_dryrun_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`✓ Report successfully written to ${reportPath}\n`);

  console.log('--- DRY-RUN SUMMARY ---');
  console.log(`Total Stories Evaluated:       ${report.summary.totalStoriesInDatabase}`);
  console.log(`Production Stories Eligible:   ${report.summary.productionEligibleStories}`);
  console.log(`Excluded Legacy Stories:       ${report.summary.excludedLegacyStories}`);
  console.log(`Stories Requiring Review:      ${report.summary.storiesRequiringManualReview}`);
  console.log('\n--- EVIDENCE CLASSIFICATION DISTRIBUTION ---');
  console.table(report.evidenceDistribution);
  console.log('\n--- COMPETITIVE THREAT DISTRIBUTION ---');
  console.table(report.competitiveThreatDistribution);
  console.log('\n--- STRATEGIC IMPORTANCE TIERS ---');
  console.table(report.scoreRangeDistribution);

  return report;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runHistoricalStoryEnrichmentDryRun()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error in dry-run:', err);
      process.exit(1);
    });
}

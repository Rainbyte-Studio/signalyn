/**
 * Signalyn Daily Intelligence Brief & Pipeline Domain Types (Phase 6)
 *
 * Fully typed, grounded schemas for:
 * 1. Strategic Focus Categories & Competitors
 * 2. Daily Intelligence Brief Document Structure (Versions & Languages)
 * 3. Daily Automated Pipeline Orchestration & Lease Management
 */

export type StrategicCategory =
  | 'Smartphones'
  | 'Foldables'
  | 'Wearables & Smartwatches'
  | 'AR/VR & XR'
  | 'AI Hardware & Smart Home'
  | 'Tablets & PCs'
  | 'Semiconductors & Silicon'
  | 'Software, OS & Ecosystem';

export type CompetitorTier = 'TIER_1_DIRECT' | 'TIER_2_CHALLENGER' | 'ECOSYSTEM_GIANT';

export interface GroundedArticleCitation {
  articleId: string;
  title: string;
  sourceId: string;
  sourceName: string;
  url: string;
  publishedAt: string;
  sentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
}

import { EvidenceClassification } from '../types';

export interface DailyBriefSectionContent {
  title: string;
  subtitle?: string;
  category: string;
  executiveTakeaway: string;
  strategicAnalysis: string[];
  competitiveThreatLevel: 'LOW' | 'MEDIUM' | 'ELEVATED' | 'HIGH' | 'NOT_APPLICABLE';
  implicationForHuawei: string;
  trackedCompetitors: string[];
  groundedCitations: GroundedArticleCitation[];

  // Phase P0 Story Intelligence Integration (decoupled, backward-compatible)
  storyId?: string;
  strategicImportanceScore?: number; // 0 - 100
  strategicScoringFactors?: {
    categoryWeight?: number;
    competitorTier?: string;
    noveltyScore?: number;
    marketImpact?: number;
    explanation?: string;
  };
  huaweiRelevance?: string;
  strategicRecommendation?: string;
  evidenceClassification?: EvidenceClassification | 'UNVERIFIED';
  evidenceConfidence?: number; // 0.00 - 1.00
  independentSourceCount?: number;
  reportingBreadth?: {
    independentSources: number;
    totalArticles: number;
  };

  // Phase P2 Competitive Intelligence Depth & Positioning
  productName?: string;
  geographicRelevance?: string;
  productPositioning?: string;
  differentiationFactors?: string[];
}

export interface CompetitorMoveSummary {
  companyId: string;
  companyName: string;
  threatLevel: 'LOW' | 'MEDIUM' | 'ELEVATED' | 'HIGH' | 'NOT_APPLICABLE';
  moveType: 'PRODUCT_LAUNCH' | 'LEAK_RUMOR' | 'STRATEGY_SHIFT' | 'ECOSYSTEM' | 'PRICING';
  headline: string;
  analysis: string;
  groundedArticles: GroundedArticleCitation[];

  // Phase P0 Story Intelligence Integration (optional)
  storyId?: string;
  strategicImportanceScore?: number;
  evidenceClassification?: EvidenceClassification | 'UNVERIFIED';
  evidenceConfidence?: number;
  independentSourceCount?: number;

  // Phase P2 Competitive Depth
  productName?: string;
  geographicRelevance?: string;
}

// ============================================================================
// Phase P1: Executive Intelligence & Day-over-Day Analysis Types
// ============================================================================

export interface CriticalIntelligenceAlert {
  storyId?: string;
  headline: string;
  competitorName: string;
  competitorId?: string;
  category: string;
  strategicImportanceScore: number;
  competitiveThreatLevel: 'LOW' | 'MEDIUM' | 'ELEVATED' | 'HIGH' | 'NOT_APPLICABLE';
  evidenceClassification: EvidenceClassification | 'UNVERIFIED';
  evidenceConfidence: number;
  independentSourceCount: number;
  whyItMatters: string;
  recommendedAction: string;
  isUnconfirmedSignal: boolean;
  alertType: 'VERIFIED_CRITICAL_DEVELOPMENT' | 'HIGH_IMPACT_UNCONFIRMED_SIGNAL';
  groundedCitations?: GroundedArticleCitation[];

  // Phase P2 Product & Geography
  productName?: string;
  geographicScope?: string;
}

export type BriefDeltaType =
  | 'NEW_DEVELOPMENT'
  | 'MATERIAL_UPDATE'
  | 'ESCALATING_DEVELOPMENT'
  | 'RESOLVED_OR_DE_ESCALATED';

export interface BriefDeltaItem {
  storyId: string;
  title: string;
  deltaType: BriefDeltaType;
  category: string;
  competitorName?: string;
  description: string;
  previousState?: {
    strategicImportanceScore?: number;
    competitiveThreatLevel?: string;
    status?: string;
    evidenceClassification?: string;
    lastMaterialUpdateAt?: string;
  };
  currentState: {
    strategicImportanceScore: number;
    competitiveThreatLevel: string;
    status: string;
    evidenceClassification: string;
    lastMaterialUpdateAt?: string;
  };
  evidenceClassification: EvidenceClassification | 'UNVERIFIED';
  evidenceConfidence: number;
  independentSourceCount: number;
}

export interface DailyBriefDelta {
  hasBaselineData: boolean;
  previousBriefDate?: string;
  insufficientDataReason?: string;
  summary: {
    newCount: number;
    materialUpdateCount: number;
    escalatingCount: number;
    resolvedCount: number;
  };
  changes: BriefDeltaItem[];
}

export interface PrioritizedStrategicItem {
  type: 'OPPORTUNITY' | 'THREAT';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITORING';
  headline: string;
  category: string;
  competitorName?: string;
  strategicImportanceScore: number;
  threatLevel: 'LOW' | 'MEDIUM' | 'ELEVATED' | 'HIGH' | 'NOT_APPLICABLE';
  evidenceClassification: EvidenceClassification | 'UNVERIFIED';
  evidenceConfidence: number;
  rationale: string;
  implication: string;
  storyId?: string;
}

export interface PrioritizedOpportunitiesThreats {
  critical: PrioritizedStrategicItem[];
  high: PrioritizedStrategicItem[];
  medium: PrioritizedStrategicItem[];
  monitoring: PrioritizedStrategicItem[];
}

export interface ActionableRecommendation {
  action: string;
  competitorName: string;
  category: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'MONITORING';
  strategicRationale: string;
  supportingStoryIds: string[];
  evidenceReliability: 'OFFICIAL' | 'VERIFIED' | 'CORROBORATED' | 'SPECULATIVE_LEAK' | 'UNVERIFIED';
  timeHorizon: 'IMMEDIATE' | 'NEAR_TERM' | 'MONITOR';

  // Phase P2 Actionable Playbook Attributes
  targetTeam?: 'RETAIL_CHANNEL' | 'MARKETING_PR' | 'PRODUCT_STRATEGY' | 'COMPETITIVE_WATCH';
  confidenceLevel?: number; // 0.00 - 1.00 explicit uncertainty metric
  productName?: string;
  geographicScope?: string; // 'Europe' | 'Greece' | 'Global'
}

export interface StrategicHardwareDomainOverview {
  domain: 'SMARTPHONES' | 'WEARABLES' | 'AUDIO' | 'TABLETS';
  title: string;
  competitorDevelopmentsSummary: string;
  highestThreatLevel: 'LOW' | 'MEDIUM' | 'ELEVATED' | 'HIGH' | 'NOT_APPLICABLE';
  huaweiImplications: string;
  recommendedActions: string[];
  supportingStoryIds: string[];
  storyCount: number;
}

export interface BriefStorySnapshot {
  id: string;
  title: string;
  category: string;
  strategicImportanceScore: number;
  competitiveThreatLevel: string;
  status: string;
  evidenceClassification: string;
  evidenceConfidence: number;
  independentSourceCount: number;
  lastMaterialUpdateAt?: string;
  lastSeenAt?: string;
}

export interface DailyBriefContent {
  language: 'en' | 'el';
  executiveHeadline: string;
  executiveSummary: string[];
  keyThemes: string[];
  marketSentimentOverview: {
    overall: 'BULLISH' | 'NEUTRAL' | 'CAUTIOUS' | 'VOLATILE';
    rationale: string;
  };
  headlineDevelopments: DailyBriefSectionContent[];
  /** Older archive documents used this field for headline developments. */
  topDevelopments?: DailyBriefSectionContent[];
  categoryBreakdowns: DailyBriefSectionContent[];
  competitorMoves: CompetitorMoveSummary[];
  strategicImplicationsForHuawei: {
    immediateActions: string[];
    mediumTermWatch: string[];
    threatsAndRisks: string[];
    opportunities: string[];
  };

  // Phase P1 Executive Intelligence & Day-over-Day Analysis
  criticalAlerts?: CriticalIntelligenceAlert[];
  dayOverDayDelta?: DailyBriefDelta;
  prioritizedOpportunitiesThreats?: PrioritizedOpportunitiesThreats;
  actionableRecommendations?: ActionableRecommendation[];
  strategicHardwareOverview?: StrategicHardwareDomainOverview[];
}

export interface DailyBriefDocument {
  id: string; // e.g., 'brief-2026-10-13' or 'brief-YYYY-MM-DD'
  date: string; // 'YYYY-MM-DD' in Europe/Athens
  windowStart: string; // ISO 8601
  windowEnd: string; // ISO 8601
  status: 'DRAFT' | 'PUBLISHED' | 'PARTIAL' | 'ARCHIVED';
  version: number;
  generatedAt: string; // ISO 8601
  lastUpdatedAt: string; // ISO 8601
  generatedBy: 'SYSTEM_AUTOMATION' | 'ADMIN_MANUAL';
  targetCompanyId: string; // 'comp-huawei'
  targetCompanyName: string; // 'HUAWEI'
  
  // Dual-language localized contents
  en: DailyBriefContent;
  el?: DailyBriefContent;

  // Phase P1 Story Snapshots & Delta Baseline
  storySnapshots?: Record<string, BriefStorySnapshot>;
  previousBriefId?: string | null;
  previousBriefDate?: string | null;

  // Grounding & Metadata
  groundingMetrics: {
    totalArticlesInWindow: number;
    strategicallyRelevantArticles: number;
    successfullyAnalyzedRelevantArticles?: number;
    distinctSourcesCount: number;
    sourcesCovered: string[];
    distinctClustersConsidered: number;
    geminiModelUsed: string;
    synthesisDurationMs: number;
    coverageStatus?: 'FULL' | 'PARTIAL';
    pendingRelevantArticlesCount?: number;
    failedArticlesCount?: number;
    unrelatedArticlesSkipped?: number;
    lastSuccessfulPipelineExecution?: string | null;
    coverageNotes?: string;
    // Phase 7B.1 Story Intelligence & Daily Brief Integration Metrics
    storiesQueried?: number;
    storiesEligible?: number;
    storiesUsed?: number;
    storiesExcludedOutOfScope?: number;
    storiesExcludedArchived?: number;
    sourceArticlesGrounded?: number;
    storyIntegrationMode?: 'STORY_ENRICHED' | 'ARTICLE_FALLBACK';
  };
}

export interface PipelineStageResult {
  stage: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  details?: Record<string, any>;
  errors?: string[];
}

export interface PipelineRunRecord {
  id: string;
  runId: string;
  dateStr: string; // Target Europe/Athens date (YYYY-MM-DD)
  startedAt: string;
  completedAt: string;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  trigger: 'SCHEDULED' | 'MANUAL_ADMIN' | 'RETRY' | 'EXTERNAL_CRON';
  stages: Record<string, PipelineStageResult>;
  summary: {
    totalDurationMs: number;
    articlesDiscovered: number;
    articlesPersisted: number;
    articlesSelectedForAnalysis: number;
    articlesAnalyzed: number;
    clustersUpdated: number;
    briefGenerated: boolean;
    briefId?: string;
    // Phase 7B.1 Story Lifecycle Telemetry
    lifecycleEvaluated?: number;
    lifecycleUpdated?: number;
  };
  errors: string[];
}

export interface PipelineLeaseRecord {
  leaseHolder: string; // Instance or run ID
  acquiredAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  heartbeatAt: string; // ISO 8601
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
  purpose: string;
}
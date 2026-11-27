/**
 * Signalyn Domain Data Types & Interfaces
 * 
 * Strict decoupled models for:
 * 1. Sources & Source Groups
 * 2. Raw Articles & Ingestion Lifecycle
 * 3. AI-Derived Article Intelligence (Phase 3)
 * 4. Company & Product Competitive Intelligence Landscape
 * 5. Entity Review Queue & AI Telemetry
 * 6. Intelligence Settings
 */

// ---------------------------------------------------------------------------
// 1. Source & Ingestion Taxonomy
// ---------------------------------------------------------------------------

export type CollectionMethod = 'RSS' | 'ATOM' | 'API' | 'WEB' | 'UNKNOWN';
export type SourceStatus = 'ACTIVE' | 'PAUSED' | 'ERROR' | 'SETUP_REQUIRED' | 'NEEDS_CONFIGURATION';
export type FeedStatus = 'ACTIVE' | 'PAUSED' | 'ERROR';
export type SourceHealth = 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'PAUSED' | 'NEEDS_CONFIGURATION';
export type FeedCoverageRole = 'PRIMARY_COVERAGE' | 'CATEGORY' | 'SUPPLEMENTAL';

export type ArticleDiagnosisStatus =
  | 'LIVE_FEED_AVAILABLE'
  | 'HISTORICAL_FEED_LIMIT'
  | 'NO_SYNDICATION_COVERAGE'
  | 'ALREADY_INGESTED'
  | 'FILTERED_FROM_UI'
  | 'INGESTION_ERROR';

export interface ArticleDiagnosticReport {
  targetUrl: string;
  normalizedUrl: string;
  status: ArticleDiagnosisStatus;
  headline: string;
  explanation: string;
  articleId?: string;
  foundArticleTitle?: string;
  publishedAt?: string;
  matchedFeedTitle?: string;
  matchedFeedUrl?: string;
  feedStatus?: FeedStatus;
  isFeedConfigured?: boolean;
  feedOldestItemDate?: string;
  feedNewestItemDate?: string;
  sourceId?: string;
  sourceName?: string;
  suggestedAction?: string;
}

export interface SourceFeed {
  id: string;
  title: string;
  url: string;
  feedType: CollectionMethod;
  categories: string[]; // Feed-level specific categories (e.g. ["Smartphones"])
  coverageRole?: FeedCoverageRole; // Broad main feed vs specific section vs supplemental
  status: FeedStatus;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  lastCollectedAt?: string | null;
  lastSuccessfulCollectionAt?: string | null;
  failureCount: number;
  articlesCollected: number;
  lastError?: string | null;
  oldestItemDate?: string | null;
  newestItemDate?: string | null;
}

export interface Source {
  id: string;
  name: string;
  websiteUrl: string;
  normalizedDomain?: string; // Normalized hostname without protocol/www (e.g. "insomnia.gr")
  feeds?: SourceFeed[]; // Multiple RSS/Atom syndication feeds under one publication/domain
  health?: SourceHealth; // Aggregated health based on feed operational states
  feedUrl?: string; // Backward compatibility with legacy single-feed model
  feedType?: CollectionMethod; // Explicit syndication protocol (legacy fallback)
  collectionMethod: CollectionMethod;
  sourceGroupId?: string; // Valid Firestore sourceGroups document ID
  sourceGroup?: string; // Legacy / display label fallback
  logoUrl?: string;
  country?: string;
  market?: string; // e.g. "Greece", "Global", "US", "China"
  language: string; // ISO 639-1: "el", "en", etc.
  categories: string[]; // Source-level publication categories (e.g. ["Tech", "Mobile", "Business", "Telecom"])
  status: SourceStatus;
  lastSuccessfulCollection?: string; // ISO 8601 string
  lastSuccessfulCollectionAt?: string; // ISO 8601 string
  lastCollectionAttempt?: string; // ISO 8601 string
  lastCollectedAt?: string; // ISO 8601 string
  articlesCollected?: number;
  errorCount?: number;
  failureCount?: number; // Explicit failure counter
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceGroup {
  id: string;
  name: string;
  description: string;
  color?: string; // Hex or CSS color token
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeletedSource {
  id: string; // Original sourceId
  name: string;
  websiteUrl: string;
  normalizedDomain: string;
  deletedAt: string; // ISO 8601
  deletionReason?: string;
  articleCount: number;
  feedCount: number;
  restoredAt?: string;
}

// ---------------------------------------------------------------------------
// 2. Article & Ingestion Types
// ---------------------------------------------------------------------------

export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'ANALYZED' | 'FAILED' | 'ARCHIVED' | 'SKIPPED_STRATEGIC_SCOPE';

export interface Article {
  id: string;
  sourceId: string;
  sourceName?: string; // Denormalized for rapid query display
  feedId?: string; // Originating primary syndication feed ID
  feedTitle?: string; // Originating feed title
  discoveredViaFeeds?: string[]; // Provenance: All feeds across which this identical canonical article was observed
  canonicalUrl: string;
  title: string;
  author?: string;
  publishedAt: string; // ISO 8601 string
  collectedAt: string; // ISO 8601 string
  updatedAt: string;
  language: string;
  market: string;
  excerpt: string;
  imageUrl?: string;
  rawCategories: string[];
  contentHash: string; // SHA-256 or deduplication hash
  processingStatus: ProcessingStatus;
  needsReanalysis?: boolean;
  analysisError?: string | null;
  analysisAttemptCount?: number;
  lastAnalysisAttemptAt?: string | null;
  retryEligible?: boolean;

  // Strategic Relevance Gate Metadata (Phase 4C.1C)
  relevanceDecision?: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'UNCERTAIN';
  relevanceCategory?: string;
  relevanceReason?: string;
  relevanceEvaluatedAt?: string;
  relevanceGateVersion?: string;
  relevanceMatchedKeywords?: string[];
  relevanceMatchedCompanies?: string[];
}

// ---------------------------------------------------------------------------
// 3. Story Clustering & Intelligence Types (Phase 4)
// ---------------------------------------------------------------------------

export type StoryStatus =
  | 'NEW'
  | 'DEVELOPING'
  | 'STABLE'
  | 'RESOLVED'
  | 'ARCHIVED'
  | 'ACTIVE' // Legacy backward compatibility
  | 'STALE';  // Legacy backward compatibility

export interface LifecycleTransition {
  fromStatus: StoryStatus;
  toStatus: StoryStatus;
  transitionedAt: string; // ISO 8601
  reason: string;
}

export type StoryType =
  | 'PRODUCT_LAUNCH'
  | 'ANNOUNCEMENT'
  | 'REVIEW'
  | 'LEAK'
  | 'RUMOR'
  | 'PRICING'
  | 'PARTNERSHIP'
  | 'FINANCIAL'
  | 'REGULATORY'
  | 'SOFTWARE_UPDATE'
  | 'MARKET_ACTIVITY'
  | 'OTHER';

export interface StoryCompanyRef {
  companyId?: string;
  name: string;
  relevance?: EntityRelevance;
}

export interface StoryProductRef {
  productId?: string;
  name: string;
  category?: string;
}

export type EvidenceClassification =
  | 'OFFICIAL_ANNOUNCEMENT'
  | 'VERIFIED_REPORT'
  | 'MULTI_SOURCE_CORROBORATED'
  | 'SINGLE_SOURCE_REPORT'
  | 'RUMOR_OR_LEAK'
  | 'UNVERIFIED'
  | 'CONTRADICTED';

export type CompetitiveThreatLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_APPLICABLE';

export type StoryDevelopmentType =
  | 'OFFICIAL_ANNOUNCEMENT'
  | 'CORROBORATION'
  | 'SPEC_LEAK'
  | 'PRICING_AVAILABILITY'
  | 'MATERIAL_UPDATE'
  | 'CORRECTION_RETRACTION'
  | 'LAUNCH_POSTPONEMENT'
  | 'INITIAL_COVERAGE';

export interface StoryDevelopment {
  id: string;
  timestamp: string; // ISO 8601
  developmentType: StoryDevelopmentType;
  description: string;
  articleIds: string[];
  sourceUrls: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidenceClassification: EvidenceClassification;
}

export interface StorySourceProvenance {
  sourceId: string;
  sourceName: string;
  domain: string;
  isPrimarySource: boolean;
  isSyndicated: boolean;
  canonicalUrl: string;
  firstReportedAt: string;
}

export interface Story {
  id: string;
  canonicalTitle: string;
  title?: string; // Kept for backward compatibility
  summary: string;
  presentationLanguage?: string; // Canonical presentation language ("en")
  canonicalSummary?: string; // Canonical English executive summary
  status: StoryStatus;
  storyType: StoryType;
  importanceScore: number; // 0 - 100
  confidence: number; // 0.00 - 1.00
  firstSeenAt: string; // ISO 8601
  lastSeenAt: string; // ISO 8601
  lastUpdatedAt?: string; // ISO 8601
  articleCount: number;
  articleIds: string[];
  sourceIds: string[];
  sourceCount: number;
  companies: StoryCompanyRef[];
  products: StoryProductRef[];
  categories: string[];
  topics: string[];
  markets: string[];
  languages: string[];
  primaryCompanyId: string | null;
  primaryProductId: string | null;
  representativeArticleId: string | null;
  createdAt: string;
  updatedAt: string;
  clusteringVersion: string;
  mergeMetadata?: {
    mergedAt: string;
    mergedStoryIds: string[];
  };
  category?: string; // Legacy compatibility
  isLegacy?: boolean; // Runtime isolation flag: marks Phase 1 bootstrap stories
  // Phase 7B.1 Lifecycle Governance Fields
  lifecycleTransitions?: LifecycleTransition[];
  lastLifecycleEvaluationAt?: string;
  terminalReason?: string;
  // Phase 7B.2 Evidence Verification & Provenance Fields
  evidenceClassification?: EvidenceClassification;
  evidenceConfidence?: number; // 0.00 - 1.00
  evidenceReasons?: string[];
  independentSourceCount?: number;
  sourceProvenances?: StorySourceProvenance[];
  lastMaterialUpdateAt?: string; // ISO 8601
  timeline?: StoryDevelopment[];
  eventSignature?: string;
  // Phase 7B.2 HUAWEI Competitive Intelligence Layer
  strategicImportanceScore?: number; // 0 - 100
  competitiveThreatLevel?: CompetitiveThreatLevel;
  huaweiRelevance?: string;
  competitiveImplication?: string;
  strategicRecommendation?: string;
  strategicScoringFactors?: {
    categoryWeight?: number;
    competitorTier?: string;
    noveltyScore?: number;
    marketImpact?: number;
    explanation?: string;
  };
}

export function isLegacyStory(story: { id?: string; isLegacy?: boolean; clusteringVersion?: string; canonicalTitle?: string }): boolean {
  if (story.isLegacy === true) return true;
  if (story.id && /^story-00[1-9]$/.test(story.id)) return true;
  if (story.clusteringVersion === 'legacy-bootstrap') return true;
  if (!story.canonicalTitle && (!story.clusteringVersion || story.clusteringVersion === 'legacy-bootstrap')) return true;
  return false;
}

export function isProductionStory(story: { id?: string; isLegacy?: boolean; clusteringVersion?: string; canonicalTitle?: string; title?: string }): boolean {
  if (isLegacyStory(story)) return false;
  if (!story.id || !story.id.startsWith('story-cluster-')) return false;
  if (!story.canonicalTitle && !story.title) return false;
  return true;
}

export interface StoryMembership {
  articleId: string;
  storyId?: string;
  sourceId: string;
  publishedAt: string;
  similarityScore: number; // 0.00 - 1.00
  membershipConfidence: number; // 0.00 - 1.00
  addedAt: string;
  headline?: string;
  sentiment?: SentimentType;
  sourceName?: string;
}

export interface StoryReview {
  id: string;
  articleId: string;
  articleTitle: string;
  suggestedStoryId?: string;
  candidateStoryIds?: string[];
  reason: 'LOW_CONFIDENCE' | 'POTENTIAL_DUPLICATE_STORY' | 'AMBIGUOUS_MULTI_CANDIDATE';
  confidence: number;
  status: 'PENDING' | 'RESOLVED' | 'DISMISSED';
  createdAt: string;
  resolvedAt?: string;
  resolutionAction?: 'ASSIGN_TO_STORY' | 'CREATE_NEW_STORY' | 'MERGE_STORIES' | 'DISMISS';
}

export interface StoryRun {
  runId: string;
  startedAt: string;
  completedAt?: string;
  articlesProcessed: number;
  storiesCreated: number;
  storiesUpdated: number;
  matches: number;
  newStories: number;
  ambiguous: number;
  failed: number;
  geminiCalls: number;
  durationMs: number;
  trigger: string;
  // Phase 4 Extended Telemetry
  clusteringVersion?: string;
  articlesEvaluated?: number;
  theoreticalPairs?: number;
  pairsPruned?: number;
  pairsScored?: number;
  stage1Matches?: number;
  stage1Separates?: number;
  stage1Ambiguous?: number;
  stage2Matches?: number;
  stage2Separates?: number;
  stage2ReviewsRequired?: number;
  membershipsCreated?: number;
  articleAnalysisUpdated?: number;
  storyReviewsCreated?: number;
}

// ---------------------------------------------------------------------------
// 4. Backfill Engine Types (Phase 4B.2)
// ---------------------------------------------------------------------------

export type BackfillStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'PAUSING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELLED';

export type BackfillItemStatus =
  | 'QUEUED'
  | 'ANALYZING'
  | 'ANALYZED'
  | 'CLUSTERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'REVIEW_REQUIRED';

export interface BacklogInventory {
  totalStoredArticles: number;
  alreadyAnalyzedArticles: number;
  pendingStrategicallyRelevantArticles: number;
  pendingHistoricalStrategicArticles?: number;
  pendingTodayStrategicArticles?: number;
  pendingUncertainArticles?: number;
  pendingOutOfScopeArticles: number;
  alreadySkippedArticles?: number;
  rawPendingArticles?: number;
  failedArticlesEligibleForRetry: number;
  permanentFailures: number;
  countsByCategory: Record<string, number>;
  countsByCompany: Record<string, number>;
  countsBySource: Record<string, number>;
  publicationDateDistribution: Record<string, number>;
  lastAuditedAt: string;
}

export interface OutOfScopeCleanupCandidate {
  id: string;
  title: string;
  sourceName: string;
  publishedAt: string;
  skipReason: string;
}

export interface OutOfScopeCleanupPreview {
  totalPendingScanned: number;
  outOfScopeCandidatesCount: number;
  sampleCandidates: OutOfScopeCleanupCandidate[];
}

export interface OutOfScopeCleanupResult {
  dryRun: boolean;
  totalPendingScanned: number;
  eligibleOutOfScopeCount: number;
  updatedCount: number;
  skippedAlreadyAnalyzed: number;
  skippedNonOutOfScope: number;
  batchesCommitted: number;
  auditId: string;
  sampleUpdatedIds: string[];
  message: string;
  executedAt: string;
}

export interface UncertainArticleCandidate {
  id: string;
  title: string;
  sourceName: string;
  publishedAt: string;
  company: string;
  recommendation: 'CONSUMER_ECOSYSTEM_REVIEW' | 'ENTERPRISE_EXCLUDED' | 'AUTOMOTIVE_EXCLUDED' | 'GENERAL_CORPORATE_EXCLUDED';
  supplyChainRelevance: boolean;
  notes: string;
}

export interface UncertainArticlesPreview {
  totalUncertain: number;
  candidates: UncertainArticleCandidate[];
}

export interface BackfillBatchResult {
  runId: string;
  batchNumber: number;
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  itemsSkipped: number;
  geminiCallsUsed: number;
  durationMs: number;
  isPaused: boolean;
  isCompleted: boolean;
  remainingEligible: number;
  errors: string[];
}

export interface BackfillRun {
  runId: string;
  status: BackfillStatus;
  mode: 'CANARY' | 'FULL' | 'CATEGORY_SCOPED' | 'STORY_ONLY_REPAIR' | 'ROLLOUT_50' | 'HISTORICAL_INTELLIGENCE';
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;

  selectionStrategy: string;
  categoryScope?: string[];
  companyScope?: string[];

  requestedLimit: number;
  batchSize: number;

  articlesSelected: number;
  articlesAttempted: number;
  articlesAnalyzed: number;
  articlesFailed: number;
  articlesSkipped: number;

  storiesCreated: number;
  storiesJoined: number;
  storyReviewsCreated: number;

  phase3GeminiCalls: number;
  stage2GeminiCalls: number;

  currentBatch: number;
  totalBatches: number;

  processedArticleIds: string[];
  lastProcessedArticleId?: string | null;

  pauseRequested: boolean;
  cancelRequested: boolean;

  failureCount: number;
  lastError?: string | null;

  clusteringVersion: string;
  analysisVersion?: string;

  durationMs: number;
}

export interface BackfillItem {
  id: string; // articleId
  articleId: string;
  runId: string;
  status: BackfillItemStatus;
  attemptCount: number;
  startedAt?: string;
  completedAt?: string;
  phase3GeminiCalls: number;
  stage2GeminiCalls: number;
  storyDecision?: string;
  storyId?: string;
  reviewId?: string;
  error?: string | null;
  category?: string;
  company?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// 5. Company & Product Competitive Intelligence Types
// ---------------------------------------------------------------------------

export type ProductLifecycleStatus =
  | 'RELEASED'
  | 'ANNOUNCED'
  | 'RUMORED'
  | 'DISCONTINUED'
  | 'PROTOTYPE'
  | 'UNKNOWN';

export type ProductEntryType =
  | 'INDIVIDUAL_MODEL'
  | 'PRODUCT_SERIES'
  | 'PRODUCT_FAMILY'
  | 'PLACEHOLDER';

export type ProductEntityLevel = 'PRODUCT_FAMILY' | 'PRODUCT_SERIES' | 'PRODUCT_MODEL';

export type ProductLifecycleFilter =
  | 'ALL'
  | 'VERIFIED_ACTIVE' // RELEASED + ANNOUNCED
  | 'RUMORED_OR_UNVERIFIED'; // RUMORED + PROTOTYPE + UNKNOWN

export interface Company {
  id: string;
  name: string;
  aliases: string[];
  website: string;
  logoUrl?: string;
  isMyCompany: boolean; // Configurable (e.g. HUAWEI by default, but completely flexible)
  isCompetitor: boolean;
  categories: string[]; // e.g. ["Smartphones", "Wearables", "Tablets", "Audio", "Laptops", "5G Infrastructure"]
  active: boolean;
  hqCountry?: string;
  createdAt?: string;
  updatedAt?: string;
  provenance?: string;
}

export interface Product {
  id: string;
  companyId: string;
  name: string;
  aliases: string[];
  category: string; // e.g. "SMARTPHONES", "WEARABLES", "TABLETS", "AUDIO", "LAPTOPS", "AI", "SOFTWARE", "CHIPSETS", "TELECOM", "SMART_HOME", "AUTOMOTIVE", "OTHER"
  subcategory?: string; // e.g. "Flagship Smartphone", "Foldable", "Smartwatch"
  active: boolean;
  launchDate?: string;
  lifecycle?: ProductLifecycleStatus;
  entryType?: ProductEntryType;
  evidenceType?: string;
  evidenceUrl?: string;
  evidenceRationale?: string;
  greekMarketAvailability?: {
    status: MarketAvailabilityStatus;
    details?: string;
    sourceUrl?: string;
  };
  entityLevel?: ProductEntityLevel;
  createdAt?: string;
  updatedAt?: string;
  provenance?: string;
}

// ---------------------------------------------------------------------------
// 5. Phase 3: AI-Derived Structured Intelligence (ArticleAnalysis)
// ---------------------------------------------------------------------------

export type NewsType =
  | 'NEWS'
  | 'PRODUCT_LAUNCH'
  | 'PRODUCT_LEAK'
  | 'RUMOR'
  | 'REVIEW'
  | 'HANDS_ON'
  | 'SOFTWARE_UPDATE'
  | 'NEW_FEATURE'
  | 'PRICE_CHANGE'
  | 'PARTNERSHIP'
  | 'MARKETING_CAMPAIGN'
  | 'MARKET_EXPANSION'
  | 'BUSINESS'
  | 'LEGAL_REGULATORY'
  | 'AWARD'
  | 'OTHER';

export type SentimentType = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'MIXED';

export type EntityRelevance = 'PRIMARY' | 'SECONDARY' | 'MENTION';

export interface AnalyzedCompany {
  companyId?: string; // Matched canonical company ID if registered
  canonicalName: string;
  matchedAlias?: string;
  relevance: EntityRelevance;
  confidence: number; // 0 - 1
}

export interface AnalyzedProduct {
  productId?: string; // Matched canonical product ID if registered
  canonicalName: string;
  companyId?: string;
  matchedText: string;
  category: string; // Supported category e.g. "SMARTPHONES", "WEARABLES", etc.
  subcategory?: string;
  relevance: EntityRelevance;
  confidence: number; // 0 - 1
}

export interface UnresolvedEntity {
  detectedName: string;
  confidence: number;
  context?: string;
  category?: string;
}

export interface CompetitiveSignal {
  type: string; // e.g. PRODUCT_LAUNCH, FEATURE_ADVANTAGE, PRICING_MOVE, CAMERA_STRATEGY, etc.
  company: string;
  product?: string;
  description: string;
  confidence: number; // 0 - 1
  evidence?: string; // Short supporting excerpt from the article
}

export interface CompetitiveRelevance {
  score: number; // 0 - 100
  reasons: string[];
  categories: string[];
  relatedCompanies: string[];
}

export interface EntitySentiment {
  companyId?: string;
  companyName: string;
  sentiment: SentimentType;
  confidence: number;
}

export interface ArticleAnalysis {
  articleId: string;
  storyId?: string; // Phase 4: Story reference
  storyAssignmentStatus?: 'UNASSIGNED' | 'ASSIGNED' | 'REVIEW_REQUIRED' | 'FAILED';
  storyAssignmentError?: string | null;
  storyAssignedAt?: string | null;
  clusteringMetadata?: Record<string, any>;
  sourceId?: string;
  analysisVersion: string; // e.g. "signalyn-analysis-v1"
  model: string; // e.g. "gemini-3.8-flash"
  analyzedAt: string; // ISO 8601
  language: string;
  market: string;

  // Historical & Provenance Metadata (Phase 5B)
  publishedAt?: string; // ISO 8601 published date of originating article
  hasReliablePublishedAt?: boolean;
  strategicCategory?: string;

  // Extracted Entities
  companies: AnalyzedCompany[];
  unresolvedCompanies?: UnresolvedEntity[];
  products: AnalyzedProduct[];
  unresolvedProducts?: UnresolvedEntity[];
  topics: string[];

  // Classifications & Scoring
  newsType: NewsType;
  secondaryNewsTypes?: NewsType[];
  sentiment: SentimentType;
  sentimentConfidence: number;
  entitySentiment?: EntitySentiment[];
  importanceScore: number; // 0 - 100

  // Narrative & Evidence
  summary: string;
  keyPoints: string[];

  // Competitive Strategy
  competitiveRelevance: CompetitiveRelevance;
  competitiveSignals: CompetitiveSignal[];

  // Overall Confidence & System Metrics
  confidence: number; // 0 - 1
  processingMetadata?: {
    executionTimeMs?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

// ---------------------------------------------------------------------------
// 6. Entity Review Queue & Telemetry
// ---------------------------------------------------------------------------

export type ReviewStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'RESOLVED_EXISTING'
  | 'PROMOTED_NEW'
  | 'DISMISSED_NON_STRATEGIC'
  | 'REJECTED'
  | 'MERGED';

export interface EntityReview {
  id: string;
  type: 'COMPANY' | 'PRODUCT';
  entityType?: 'COMPANY' | 'PRODUCT'; // Canonical alias for diagnostic/audit compatibility
  detectedName: string;
  rawText?: string; // Canonical alias for diagnostic/audit compatibility
  reason?: string; // e.g. 'UNRESOLVED_COMPANY' | 'UNRESOLVED_PRODUCT' | 'LOW_CONFIDENCE'
  articleId: string;
  articleTitle: string;
  suggestedCompany?: string;
  suggestedProduct?: string;
  category?: string;
  confidence: number;
  status: ReviewStatus;
  createdAt: string;
  reviewedAt?: string;
  resolvedAt?: string;
  canonicalId?: string;
  canonicalName?: string;
  resolutionType?: 'EXISTING' | 'PROMOTED_NEW' | 'NON_STRATEGIC' | 'REJECTED';
  resolutionMethod?: 'MANUAL_LINK' | 'MANUAL_PROMOTION' | 'DETERMINISTIC' | 'DISMISS';
  nonStrategicReason?: string;
  occurrences?: number;
  articleIds?: string[];
  articleTitles?: string[];
}

export interface AIRun {
  id: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  model: string;
  articlesAttempted: number;
  articlesSucceeded: number;
  articlesFailed: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  errors: Array<{ articleId?: string; error: string }>;
  triggeredBy: string; // 'MANUAL' | 'BATCH' | 'AUTO_INGEST'
}

// ---------------------------------------------------------------------------
// 7. Competitive Settings & Mappings
// ---------------------------------------------------------------------------

export interface CompetitorCategoryMapping {
  category: string;
  competitorCompanyIds: string[];
}

export interface IntelligenceSettings {
  myCompanyId: string; // ID of company designated as primary (e.g. "comp-huawei")
  myCompanyName: string; // e.g. "HUAWEI"
  competitorSets: Record<string, string[]>; // e.g. "Smartphones" -> ["comp-samsung", "comp-apple", "comp-xiaomi"]
  defaultMarket: string;
  autoAnalyzeArticles: boolean; // Controls auto-triggering on ingestion
  collectionIntervalMinutes: number;
  retentionDays: number;
}

// ---------------------------------------------------------------------------
// 8. Navigation & UI State
// ---------------------------------------------------------------------------

export type NavigationTab =
  | 'overview'
  | 'feed'
  | 'stories'
  | 'companies'
  | 'products'
  | 'competitors'
  | 'trends'
  | 'daily-brief'
  | 'retail-prices'
  | 'service'
  | 'voc'
  | 'analytics'
  | 'backfill'
  | 'sources'
  | 'reviews'
  | 'settings';

export interface DashboardMetrics {
  articlesCollectedTotal: number;
  storiesDetected: number;
  activeSources: number;
  totalSources: number;
  companiesTracked: number;
  highPriorityStories: number;
  articlesToday: number;
  errorSourcesCount: number;
  // Phase 3 Intelligence Metrics
  articlesAnalyzedCount?: number;
  pendingAnalysisCount?: number;
  unresolvedReviewsCount?: number;
}

export interface FeedFilterOptions {
  searchQuery: string;
  sourceId?: string;
  groupId?: string;
  language?: string;
  market?: string;
  category?: string;
  newsType?: string;
  dateRange?: 'all' | 'today' | 'week' | 'month';
  // Phase 3 Filters
  analysisStatus?: 'ALL' | 'ANALYZED' | 'PENDING' | 'PROCESSING' | 'FAILED' | 'SKIPPED_STRATEGIC_SCOPE';
  companyId?: string;
  productCategory?: string;
  minImportance?: number;
  minCompetitiveScore?: number;
}

// ---------------------------------------------------------------------------
// 9. Phase 4: Competitive Intelligence & Analytics Models
// ---------------------------------------------------------------------------

export type TrendDirection = 'RISING' | 'STABLE' | 'DECLINING' | 'SPIKE';

export interface PeriodDelta {
  current: number;
  previous: number;
  absoluteChange: number;
  percentageChange: number;
  percentagePointChange?: number;
}

export interface ShareOfVoiceItem {
  companyId: string;
  companyName: string;
  count: number;
  totalTracked: number;
  percentage: number;
  delta?: PeriodDelta;
  isMyCompany: boolean;
}

export interface CompetitiveTimelineEvent {
  id: string;
  storyId: string;
  title: string;
  summary: string;
  storyType: StoryType;
  date: string;
  importance: number;
  companyId: string;
  companyName: string;
  productName?: string;
  articleCount: number;
  sourceCount: number;
  sources: string[];
}

export interface CompanyComparisonData {
  company: Company;
  articleCount: number;
  storyCount: number;
  articleSov: number; // 0 - 100 percentage
  storySov: number; // 0 - 100 percentage
  avgImportance: number;
  coverageSentiment: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
    total: number;
    positivePct: number;
    neutralPct: number;
    negativePct: number;
  };
  productActivity: { name: string; storyCount: number; articleCount: number }[];
  topTopics: { topic: string; count: number }[];
  topStoryTypes: { type: StoryType; count: number }[];
  trend: TrendDirection;
}

export interface CompetitiveAnalyticsSummary {
  period: {
    startDate: string;
    endDate: string;
    previousStartDate: string;
    previousEndDate: string;
    label: string;
  };
  coverage: {
    totalArticles: number;
    analyzedArticles: number;
    coveragePct: number;
    clusteredArticles: number;
    unclusteredArticles: number;
    totalStories: number;
  };
  articleSov: ShareOfVoiceItem[];
  storySov: ShareOfVoiceItem[];
  categorySov: {
    category: string;
    totalArticles: number;
    totalStories: number;
    companies: ShareOfVoiceItem[];
  }[];
  trendingCompanies: {
    companyId: string;
    name: string;
    trend: TrendDirection;
    currentCount: number;
    previousCount: number;
    percentageChange: number;
    isSpike: boolean;
  }[];
  trendingProducts: {
    productName: string;
    companyName: string;
    trend: TrendDirection;
    currentCount: number;
    previousCount: number;
    percentageChange: number;
    isSpike: boolean;
  }[];
  timeline: CompetitiveTimelineEvent[];
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
}

// ---------------------------------------------------------------------------
// 10. Phase 5B: Historical Intelligence & Persistent Aggregation Models
// ---------------------------------------------------------------------------

export const AGGREGATION_VERSION = 'signalyn-agg-v1';
export const UNDATED_DATE_KEY = 'UNDATED';

export interface CategoryAggregateMetrics {
  articlesCount: number;
  articlesWithTrackedCompaniesCount: number;
  totalCompanyMentions: number;
  companyMentions: Record<string, number>;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  competitiveSignalTypes: Record<string, number>;
  importanceSum: number;
  importanceCount: number;
}

export interface DailyAggregate {
  dateKey: string; // "YYYY-MM-DD" in UTC, or "UNDATED"
  articlesCount: number; // Total unique analyzed articles in this bucket
  articlesWithTrackedCompaniesCount: number; // Articles mentioning >=1 tracked company
  companyMentions: Record<string, number>; // companyId -> count of unique articles
  totalCompanyMentions: number; // Sum of company mentions (for mentions-share denominator)
  productMentions: Record<string, number>; // productId/canonicalName -> count
  categoryDistribution: Record<string, number>; // SMARTPHONE, WEARABLE, AUDIO, TABLET, OTHER
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  importanceSum: number;
  importanceCount: number;
  averageImportance: number;
  topicFrequencies: Record<string, number>; // canonicalTopicKey -> count
  competitiveSignalTypes: Record<string, number>; // signalType -> count
  languageDistribution: Record<string, number>; // language -> count
  marketDistribution: Record<string, number>; // market -> count
  byCategory?: Record<string, CategoryAggregateMetrics>; // Date × Category multidimensional breakdown
  lastUpdatedAt: string; // ISO 8601
  aggregationVersion: string;
}

export interface ArticleContributionLedger {
  articleId: string;
  dateKey: string; // "YYYY-MM-DD" or "UNDATED"
  appliedAt: string; // ISO 8601
  analysisVersion: string;
  hasReliablePublishedAt: boolean;
  originalPublishedAt: string | null;
  strategicCategory: string; // SMARTPHONE, WEARABLE, AUDIO, TABLET, or OTHER
  companiesCredited: string[]; // Deduplicated company IDs
  productsCredited: string[]; // Deduplicated product IDs or names
  sentiment: SentimentType;
  importanceScore: number;
  topicsCredited: string[];
  signalTypesCredited: string[];
  language: string;
  market: string;
  contributionHash: string; // SHA or deterministic fingerprint for fast no-op checks
}

export type ShareOfVoiceMethodology =
  | 'MENTIONS_SHARE_V1' // mentions / totalCompanyMentions * 100 (sums to 100%)
  | 'ARTICLE_COVERAGE_RATIO_V2'; // mentions / articlesWithTrackedCompaniesCount * 100 (can sum >100%)

export interface HistoricalQueryFilter {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
  preset?: '7d' | '30d' | '90d' | '180d' | 'ytd' | 'all';
  category?: 'ALL_STRATEGIC' | 'SMARTPHONE' | 'WEARABLE' | 'AUDIO' | 'TABLET';
  companyId?: string; // Optional single company focus
  includeUndated?: boolean;
}

export interface HistoricalDailyPoint {
  date: string; // YYYY-MM-DD
  articlesCount: number;
  articlesWithTrackedCompaniesCount: number;
  companyMentions: Record<string, number>;
  totalCompanyMentions: number;
  categoryDistribution: Record<string, number>;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
  topTopics: { topic: string; count: number }[];
}

export interface HistoricalCompanyMetrics {
  companyId: string;
  companyName: string;
  isPrimary: boolean;
  color: string;
  mentions: number;
  mentionsShareSov: number; // Methodology V1
  coverageRatioSov: number; // Methodology V2
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  };
}

export interface HistoricalQueryResult {
  period: {
    startDate: string;
    endDate: string;
    totalDays: number;
    availableBucketDays: number;
    missingDays: number;
    coverageStatus: 'COMPLETE' | 'PARTIAL' | 'EMPTY';
  };
  metrics: {
    totalArticlesAnalyzed: number;
    articlesWithTrackedCompanies: number;
    totalCompanyMentions: number;
    averageImportance: number;
    companies: HistoricalCompanyMetrics[];
    categoryDistribution: Record<string, number>;
    overallSentiment: {
      positive: number;
      neutral: number;
      negative: number;
      mixed: number;
    };
    topTopics: { topic: string; count: number }[];
    languageDistribution?: Record<string, number>;
    marketDistribution?: Record<string, number>;
    productMentions?: Record<string, number>;
    dailyTimeSeries: HistoricalDailyPoint[];
  };
  metadata: {
    methodologyVersion: string;
    aggregationVersion: string;
    queriedAt: string;
    readDocumentCount: number;
    categoryBreakdownAvailable?: boolean;
    appliedCategoryFilter?: string;
  };
}

// ---------------------------------------------------------------------------
// 10. Phase 5S-C1.2: Market Intelligence & Competitor Discovery Types
// ---------------------------------------------------------------------------

export type MarketAvailabilityStatus =
  | 'OFFICIAL'
  | 'RETAIL_CONFIRMED'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

export interface MarketEvidence {
  companyId: string;
  productId?: string;
  market: 'GR' | 'GLOBAL';
  status: MarketAvailabilityStatus;
  evidenceType: string;
  sourceUrl?: string;
  details?: string;
  observedAt?: string;
  verifiedAt?: string;
}

export type CompetitorScope = 'ALL_RELEVANT' | 'SELECTED_ONLY';
export type MarketFilterOption = 'GLOBAL' | 'GR';

// Daily Brief Intelligence Types
export * from './dailyBrief';

// Voice of Customer (VOC P1.0) Intelligence Types
export * from './vocIntelligence';



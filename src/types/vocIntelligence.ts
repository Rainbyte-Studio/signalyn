/**
 * Signalyn Voice of Customer (VOC) Intelligence Types (Phase VOC P1.0)
 *
 * Strict decoupled models for:
 * 1. Source Feasibility Audit & Source Health Registry (vocSources)
 * 2. Customer Complaint & Experience Reports (vocReports)
 * 3. Complaint Classification Taxonomy (15 Categories, Bilingual EL/EN, Multi-Label)
 * 4. Conservative Canonical Product Matching (vocProductMatches)
 * 5. Repeated & Emerging Issue Clusters (vocIssueClusters)
 * 6. Service Intelligence Cross-Referencing & Correlation Status
 * 7. Collection Runs & Persistence Telemetry (vocCollectionRuns)
 */

import { PersistenceStorageMode, ServiceAdvisoryType, ServiceSeverity } from './serviceIntelligence';

// ---------------------------------------------------------------------------
// 1. Source Feasibility & Governance Taxonomy (Phase 1)
// ---------------------------------------------------------------------------

export type VocSourceFeasibilityStatus =
  | 'VERIFIED_ACCESSIBLE'
  | 'ACCESSIBLE_WITH_RESTRICTIONS'
  | 'REQUIRES_AUTHORIZATION'
  | 'NOT_SUPPORTED'
  | 'NOT_YET_VERIFIED';

export type VocSourceCategory =
  | 'OFFICIAL_COMMUNITY'
  | 'OFFICIAL_SUPPORT'
  | 'PUBLIC_FORUM'
  | 'GREEK_RETAILER_REVIEWS'
  | 'APP_STORE_REVIEWS'
  | 'CONSUMER_REVIEW_PLATFORM'
  | 'DEVELOPER_ISSUE_TRACKER';

export type VocAccessMethod =
  | 'PUBLIC_REST_API'
  | 'OAUTH2_API'
  | 'FIRST_PARTY_DEVELOPER_API'
  | 'PUBLIC_HTML_SSR'
  | 'DYNAMIC_CSR_GATEWAY'
  | 'WAF_PROTECTED_HTML'
  | 'CAPTCHA_GATED_HTML';

export interface VocSource {
  id: string; // e.g. 'voc-src-huawei-community-en', 'voc-src-reddit-huawei'
  name: string;
  sourceCategory: VocSourceCategory;
  targetManufacturers: string[]; // e.g. ['Huawei'] or ['Huawei', 'Samsung', 'Apple', 'Xiaomi']
  officialUrl: string;
  auditedEndpointUrl: string;
  robotsTxtUrl: string;
  feasibilityStatus: VocSourceFeasibilityStatus;
  contentAvailability: string;
  permittedAccessMethod: VocAccessMethod;
  authenticationRequired: boolean;
  authenticationDetails: string;
  rateLimits: string;
  termsOfServiceRestrictions: string;
  robotsTxtStatus: {
    httpStatus: number;
    targetPathAllowed: boolean;
    disallowedPathsSample: string[];
    summary: string;
  };
  antiBotProtection: {
    detected: boolean;
    provider?: string; // e.g. 'AkamaiGHost', 'Cloudflare Turnstile', 'snooserv Rate/Auth Gate'
    details: string;
  };
  availableDataFields: string[];
  productModelIdentificationPossible: boolean;
  productModelIdentificationNotes: string;
  publicationTimestampsAvailable: boolean;
  technicallyFeasible: boolean;
  legallyFeasible: boolean;
  collectionEnabledInP1_0: boolean; // Always false in P1.0 per Phase 8 boundaries
  lastVerifiedAt: string; // ISO 8601
  lastHttpStatus: number;
  verificationEvidence: string;
  recommendedP1_1Action: string;
}

// ---------------------------------------------------------------------------
// 2. Complaint Classification Taxonomy (Phase 3)
// ---------------------------------------------------------------------------

export type VocComplaintCategory =
  | 'BATTERY_DRAIN'
  | 'OVERHEATING'
  | 'CHARGING_PROBLEMS'
  | 'DISPLAY_DEFECTS'
  | 'CAMERA_ISSUES'
  | 'CONNECTIVITY_PROBLEMS'
  | 'BLUETOOTH_PROBLEMS'
  | 'WIFI_ISSUES'
  | 'SOFTWARE_BUGS'
  | 'FIRMWARE_UPDATE_PROBLEMS'
  | 'PERFORMANCE_DEGRADATION'
  | 'APP_COMPATIBILITY'
  | 'DEVICE_RELIABILITY'
  | 'REPAIR_WARRANTY_COMPLAINTS'
  | 'CUSTOMER_SUPPORT_EXPERIENCE';

export interface VocComplaintCategoryDescriptor {
  id: VocComplaintCategory;
  labelEn: string;
  labelEl: string;
  description: string;
  severityWeight: number; // 1 (low friction) to 5 (critical hardware/safety/reliability)
  isHardwareRelated: boolean;
  isSoftwareUpdateRelated: boolean;
  keywordsEn: string[];
  keywordsEl: string[];
}

export type VocSentiment = 'NEGATIVE' | 'MIXED' | 'NEUTRAL' | 'POSITIVE';

export type VocLanguage = 'el' | 'en' | 'mixed' | 'other';

export type VocReportVerificationStatus =
  | 'INGESTED_UNVERIFIED'
  | 'SOURCE_VERIFIED'
  | 'DUPLICATE_SUPPRESSED'
  | 'FLAGGED_FOR_REVIEW';

// ---------------------------------------------------------------------------
// 3. Conservative Product Matching (Phase 4)
// ---------------------------------------------------------------------------

export type VocProductMatchConfidence =
  | 'VERIFIED_MODEL'
  | 'LIKELY_MODEL'
  | 'AMBIGUOUS_REVIEW'
  | 'UNMATCHED';

export interface VocProductMatch {
  id: string; // deterministic: voc-match-{reportId}-{canonicalProductId}
  reportId: string;
  canonicalProductId: string | null;
  canonicalProductName: string | null;
  manufacturer: string;
  detectedModelText: string;
  detectedGenerationOrVariant?: string;
  confidence: VocProductMatchConfidence;
  confidenceScore: number; // 0.0 to 1.0
  matchedTokens: string[];
  missingVariantTokens: string[];
  candidateProductIds: string[];
  candidateProductNames: string[];
  matchRationale: string;
  manufacturerOnlyRejected: boolean;
  matchedAt: string;
  matcherVersion: string;
}

// ---------------------------------------------------------------------------
// 4. Service Intelligence Cross-Referencing (Phase 6)
// ---------------------------------------------------------------------------

export type VocAdvisoryCorrelationStatus =
  | 'CUSTOMER_REPORTED'
  | 'CORRELATED_WITH_OFFICIAL_ADVISORY'
  | 'OFFICIALLY_CONFIRMED_ISSUE'
  | 'UNVERIFIED_CLAIM';

export interface VocRelatedAdvisoryLink {
  advisoryId: string;
  advisoryTitle: string;
  manufacturer: string;
  advisoryType: ServiceAdvisoryType;
  severity: ServiceSeverity;
  sourceUrl: string;
  publishedAt: string;
  correlationStatus: VocAdvisoryCorrelationStatus;
  correlationReason: string;
  sharedProductIds: string[];
  sharedCategories: VocComplaintCategory[];
}

// ---------------------------------------------------------------------------
// 5. Customer Complaint Record (Phase 2 — vocReports)
// ---------------------------------------------------------------------------

export interface VocDuplicateMetadata {
  contentHash: string; // SHA-256 hex of exact trimmed text
  normalizedTextHash: string; // SHA-256 hex of lowercase punctuation-stripped tokens
  sourceExternalIdHash: string; // Deterministic hash of sourceId + externalId
  isDuplicate: boolean;
  duplicateOfReportId?: string | null;
  duplicateClusterSize?: number;
}

export interface VocReport {
  id: string; // Deterministic ID: voc-rep-{sourceId}-{externalIdHash}
  sourceId: string;
  sourceName: string;
  sourceSpecificId: string; // Stable upstream post/comment/review ID
  sourceUrl: string;
  publishedAt: string; // ISO 8601
  collectedAt: string; // ISO 8601
  manufacturer: string; // e.g. 'Huawei', 'Samsung', 'Apple', 'Xiaomi'
  reportedProductName: string; // Raw model name extracted from text/context
  reportedModelVariant?: string;
  canonicalProductId: string | null; // Populated only when VERIFIED_MODEL
  canonicalProductName: string | null;
  productMatchConfidence: VocProductMatchConfidence;
  productMatchRationale: string;
  primaryCategory: VocComplaintCategory;
  categories: VocComplaintCategory[]; // Multi-category classification support
  sentiment: VocSentiment;
  sentimentScore: number; // -1.0 (strong negative) to +1.0 (strong positive)
  originalLanguage: VocLanguage;
  evidenceExcerpt: string; // Bounded, PII-sanitized excerpt (<= 280 chars)
  piiRedacted: boolean;
  redactedItemsCount: number;
  classificationConfidence: number; // 0.0 to 1.0
  verificationStatus: VocReportVerificationStatus;
  advisoryCorrelationStatus: VocAdvisoryCorrelationStatus;
  relatedAdvisoryIds: string[];
  duplicateMetadata: VocDuplicateMetadata;
  clusterId?: string | null;
}

// ---------------------------------------------------------------------------
// 6. Issue Clusters & Emerging Issue Detection (Phase 5 — vocIssueClusters)
// ---------------------------------------------------------------------------

export type VocIssueTrendStatus =
  | 'EMERGING_SPIKE'
  | 'RISING'
  | 'STABLE_RECURRING'
  | 'LOW_SAMPLE_MONITORING'
  | 'SUBSIDING';

export interface VocIssueCluster {
  id: string; // Deterministic: voc-cluster-{manufacturer}-{productIdOrFamily}-{primaryCategory}
  title: string;
  manufacturer: string;
  canonicalProductId: string | null;
  canonicalProductName: string | null;
  productFamily: string;
  primaryCategory: VocComplaintCategory;
  secondaryCategories: VocComplaintCategory[];
  uniqueReportCount: number; // Deduplicated report count
  totalRawMentionsCount: number; // Including suppressed duplicates
  duplicateSuppressedCount: number;
  distinctSourceCount: number;
  sourceIds: string[];
  dominantSentiment: VocSentiment;
  averageSentimentScore: number;
  firstObservedAt: string;
  lastObservedAt: string;
  recent7dCount: number;
  baseline7dAvgCount: number;
  velocityRatio: number; // recent7dCount / max(1, baseline7dAvgCount)
  isEmergingIssue: boolean;
  isSoftwareUpdatePattern: boolean;
  trendStatus: VocIssueTrendStatus;
  sampleSizeSufficient: boolean;
  minimumSampleThreshold: number;
  advisoryCorrelationStatus: VocAdvisoryCorrelationStatus;
  relatedAdvisories: VocRelatedAdvisoryLink[];
  methodologyNote: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 7. Collection Runs (Phase 2 — vocCollectionRuns)
// ---------------------------------------------------------------------------

export interface VocCollectionRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  triggeredBy: 'FEASIBILITY_AUDIT' | 'MANUAL_DIAGNOSTIC' | 'DISABLED_IN_P1_0';
  status: 'SUCCESS' | 'PARTIAL' | 'SKIPPED_GOVERNANCE_LOCK' | 'FAILED';
  sourcesAudited: number;
  reportsDiscovered: number;
  reportsCreated: number;
  duplicatesSuppressed: number;
  piiItemsRedacted: number;
  storageMode: PersistenceStorageMode;
  notes: string;
}

// ---------------------------------------------------------------------------
// 8. Dashboard & Diagnostic API Contracts (Phase 7 & Phase 8)
// ---------------------------------------------------------------------------

export interface VocMethodologyDisclosure {
  version: string;
  minimumClusterSampleSize: number;
  emergingIssueMinUniqueReports: number;
  emergingVelocityRatioThreshold: number;
  deduplicationPolicy: string;
  piiMinimizationPolicy: string;
  coreDisclaimer: string;
  correlationVsConfirmationRule: string;
  collectionGovernanceLock: string;
}

export interface VocProductComplaintSummary {
  canonicalProductId: string;
  canonicalProductName: string;
  manufacturer: string;
  category: string;
  verifiedComplaintCount: number;
  likelyComplaintCount: number;
  ambiguousReviewCount: number;
  topCategories: { category: VocComplaintCategory; count: number }[];
  dominantSentiment: VocSentiment | 'NO_DATA';
  relatedOfficialAdvisoriesCount: number;
  advisoryCorrelationStatus: VocAdvisoryCorrelationStatus;
}

export interface VocOverviewPayload {
  generatedAt: string;
  storageMode: PersistenceStorageMode;
  firestoreCollections: {
    vocSources: number;
    vocReports: number;
    vocIssueClusters: number;
    vocCollectionRuns: number;
    vocProductMatches: number;
  };
  catalogContext: {
    totalCanonicalProducts: number;
    huaweiCanonicalProducts: number;
    totalOfficialAdvisories: number;
    huaweiOfficialAdvisories: number;
  };
  selectedManufacturer: string;
  availableManufacturers: string[];
  isEmptyState: boolean;
  emptyStateReason: string;
  kpis: {
    totalUniqueComplaints: number;
    totalRawReports: number;
    duplicatesSuppressed: number;
    emergingIssuesCount: number;
    verifiedModelMatchesCount: number;
    likelyModelMatchesCount: number;
    ambiguousMatchesCount: number;
    correlatedWithAdvisoryCount: number;
    officiallyConfirmedCount: number;
    verifiedAccessibleSourcesCount: number;
    restrictedOrAuthSourcesCount: number;
    unsupportedSourcesCount: number;
  };
  categoryBreakdown: {
    category: VocComplaintCategory;
    labelEn: string;
    labelEl: string;
    uniqueReportsCount: number;
    percentageOfReports: number;
    isHardwareRelated: boolean;
    isSoftwareUpdateRelated: boolean;
  }[];
  sentimentBreakdown: {
    negative: number;
    mixed: number;
    neutral: number;
    positive: number;
    total: number;
  };
  trendSeries: {
    date: string;
    uniqueComplaints: number;
    emergingSpikes: number;
  }[];
  sources: VocSource[];
  clusters: VocIssueCluster[];
  reports: VocReport[];
  productSummaries: VocProductComplaintSummary[];
  relatedServiceAdvisories: VocRelatedAdvisoryLink[];
  taxonomy: VocComplaintCategoryDescriptor[];
  methodology: VocMethodologyDisclosure;
}

export interface VocDiagnosticEvaluationRequest {
  text: string;
  manufacturerHint?: string;
  sourceId?: string;
  sourceUrl?: string;
  publishedAt?: string;
}

export interface VocDiagnosticEvaluationResponse {
  evaluatedAt: string;
  persistedToFirestore: false; // Explicitly guaranteed dry-run
  detectedLanguage: VocLanguage;
  sanitizedExcerpt: string;
  piiRedacted: boolean;
  redactedItemsCount: number;
  primaryCategory: VocComplaintCategory;
  categories: {
    category: VocComplaintCategory;
    labelEn: string;
    labelEl: string;
    confidence: number;
    matchedKeywords: string[];
  }[];
  sentiment: VocSentiment;
  sentimentScore: number;
  duplicateMetadata: VocDuplicateMetadata;
  productMatch: VocProductMatch;
  advisoryCorrelation: {
    status: VocAdvisoryCorrelationStatus;
    explanation: string;
    relatedAdvisories: VocRelatedAdvisoryLink[];
  };
}

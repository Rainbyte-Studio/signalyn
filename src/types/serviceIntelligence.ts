/**
 * Signalyn Service Intelligence Types (Phase S1.1 - Hardened Data Integrity)
 * 
 * Strict decoupled models for:
 * 1. Official Service & Security Sources (Huawei, Apple, Samsung, NIST NVD, CISA KEV)
 * 2. Service Advisories (Security Updates, Bulletins, Repair Programs, Recalls)
 * 3. Security Vulnerabilities (CVE, CVSS, CWE, Exploitation status)
 * 4. Product Matching & Confidence Tiering (VERIFIED vs LIKELY vs AMBIGUOUS)
 * 5. Source Synchronization Runs & Health Auditing
 */

export type ServiceSourceId =
  | 'huawei-security'
  | 'apple-security'
  | 'samsung-security'
  | 'nvd-api'
  | 'cisa-kev';

export type ServiceManufacturer =
  | 'Apple'
  | 'Samsung'
  | 'Huawei'
  | 'Cross-Vendor'
  | 'Other';

export type ServiceAdvisoryType =
  | 'SECURITY_UPDATE'
  | 'SECURITY_BULLETIN'
  | 'VULNERABILITY'
  | 'KNOWN_EXPLOITED'
  | 'REPAIR_PROGRAM'
  | 'PRODUCT_RECALL'
  | 'END_OF_SUPPORT'
  | 'UPDATE_SCHEDULE'
  | 'GENERAL_MAINTENANCE_INFORMATION';

export type ServiceSeverity =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INFORMATIONAL'
  | 'UNKNOWN'
  | 'NOT_AVAILABLE';

export type VerificationStatus =
  | 'OFFICIALLY_CONFIRMED'
  | 'INFERRED_LIKELY'
  | 'AMBIGUOUS_UNVERIFIED'
  | 'SOURCE_UNVERIFIABLE';

export type ProductMatchConfidence =
  | 'VERIFIED'
  | 'LIKELY'
  | 'AMBIGUOUS_REVIEW'
  | 'UNMATCHED';

export type UpdateFrequency =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'BIANNUAL'
  | 'AS_NEEDED'
  | 'DISCONTINUED';

export type PersistenceStorageMode =
  | 'FIRESTORE_AUTHORITATIVE'
  | 'PREVIEW_IN_MEMORY_ONLY'
  | 'FIRESTORE_WRITE_ERROR';

export type DerivedProductCategory =
  | 'SMARTPHONE'
  | 'TABLET'
  | 'WEARABLE'
  | 'LAPTOP'
  | 'AUDIO'
  | 'ACCESSORY'
  | 'UNKNOWN';

export interface ServiceSource {
  id: ServiceSourceId;
  name: string;
  manufacturerOrAuthority: string;
  sourceType: 'MANUFACTURER_BULLETIN' | 'MANUFACTURER_RELEASES' | 'CYBERSECURITY_AUTHORITY';
  officialUrl: string;
  additionalUrls?: string[];
  enabled: boolean;
  status: 'ACTIVE' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'ERROR';
  lastSuccessfulSync?: string;
  lastAttemptedSync?: string;
  collectionStatus: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  recordsDiscovered: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsUnchanged?: number;
  recordsRejectedOrFailed?: number;
  persistedAdvisoriesCount?: number;
  lastSyncTerminalStatus?: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NOT_RUN';
  totalCatalogCount?: number; // E.g. total 1,758 CISA KEV entries
  filteredCatalogCount?: number; // E.g. 40 target vendor entries
  persistenceStatus?: PersistenceStorageMode;
  lastError?: string;
  provenanceDescription: string;
}

export interface ServiceAdvisory {
  id: string; // e.g. "adv-apple-ios-27-2" or "adv-huawei-bulletin-2026-10"
  deterministicId?: string;
  sourceId: ServiceSourceId;
  manufacturer: ServiceManufacturer;
  advisoryType: ServiceAdvisoryType;
  title: string;
  summary: string;
  publishedAt: string; // ISO 8601 or YYYY-MM-DD
  updatedAt: string;
  sourceUrl: string;
  normalizedSourceUrl?: string;
  bulletinReference?: string; // e.g. "SMR Oct-2026", "2026/10", "HT201222", "121999"
  affectedProductsText?: string; // Original vendor text
  affectedProducts: string[]; // Parsed product families or devices
  affectedVersions: string[];
  fixedVersions: string[];
  cveIds: string[];
  sveIds?: string[]; // Samsung SVE identifiers (e.g. SVE-2026-1001)
  isZeroCveRelease?: boolean;
  sourceVerifiedAt?: string;
  severity: ServiceSeverity;
  verificationStatus: VerificationStatus;
  ingestionTimestamp: string;
  updateFrequency?: UpdateFrequency;
  notes?: string;
  status?: 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED';
  supersededByAdvisoryId?: string;
  reprocessedAt?: string;
  reprocessingVersion?: string;

  // S1.1 Independent Exploitation & CVSS Fields (No false conflation)
  isKnownExploited?: boolean;
  cisaKevStatus?: 'ACTIVE_EXPLOITED' | 'NOT_EXPLOITED' | 'UNKNOWN';
  cisaDueDate?: string;
  cisaRequiredAction?: string;
  cisaDateAdded?: string;
  knownRansomwareCampaignUse?: string;
  
  // Independent technical metrics
  cvssScore?: number;
  cvssVersion?: string;
  cvssSeverity?: ServiceSeverity;
  severitySource?: 'NIST_NVD' | 'OFFICIAL_VENDOR' | 'UNSPECIFIED';
  severityVerificationStatus?: 'OFFICIALLY_CONFIRMED' | 'UNVERIFIED';
}

export interface ServiceVulnerability {
  cveId: string; // e.g. "CVE-2026-21492"
  title?: string;
  description: string;
  sourceUrl: string;
  firstDiscoveredAt: string;
  lastUpdatedAt: string;
  
  // Independent technical CVSS metrics
  cvssV3Score?: number;
  cvssVersion?: string;
  severity: ServiceSeverity;
  severitySource: 'NIST_NVD' | 'OFFICIAL_VENDOR' | 'UNSPECIFIED';
  severityVerificationStatus: 'OFFICIALLY_CONFIRMED' | 'UNVERIFIED';
  
  // Independent CISA KEV exploitation priority (decoupled from CVSS)
  isKnownExploited: boolean;
  cisaKevStatus: 'ACTIVE_EXPLOITED' | 'NOT_EXPLOITED' | 'UNKNOWN';
  cisaDateAdded?: string;
  cisaDueDate?: string;
  cisaRequiredAction?: string;
  knownRansomwareCampaignUse?: 'Known' | 'Unknown';
  
  affectedVendors: string[];
  affectedProducts: string[];
  references: string[];
}

export type MatchRelationshipType =
  | 'OFFICIAL_UPDATE_ELIGIBILITY'
  | 'SECURITY_BULLETIN_APPLICABILITY'
  | 'CONFIRMED_VULNERABILITY_APPLICABILITY'
  | 'CONFIRMED_VULNERABILITY'
  | 'GENERAL_MAINTENANCE_INFORMATION'
  | 'GENERAL_SECURITY_INFORMATION';

export type MatchEvidenceStrength =
  | 'DIRECT_OFFICIAL_EVIDENCE'
  | 'STRUCTURED_MANUFACTURER_APPLICABILITY'
  | 'INFERRED_FAMILY_APPLICABILITY'
  | 'HEURISTIC_SIMILARITY';

export type QualityGateReadinessStatus =
  | 'READY_FOR_ADMIN_REVIEW'
  | 'QUALITY_GATE_FAILED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'PRODUCTION_NOT_VERIFIED';

export type RecommendedMatchReviewAction =
  | 'APPROVE_LINK'
  | 'KEEP_PENDING_REVIEW'
  | 'DISMISS_CANDIDATE'
  | 'VERIFY_MODEL_VARIANT';

export interface ServiceProductMatch {
  id: string; // Deterministic ID: "match-<canonicalProductId>-<advisoryId>"
  advisoryId: string;
  advisoryTitle?: string;
  advisoryType?: ServiceAdvisoryType;
  canonicalProductId: string; // Foreign key into retailProducts
  productTitle: string;
  canonicalProductName?: string; // Alias for UI compatibility
  brand: string;
  manufacturer?: ServiceManufacturer;
  productFamily?: string;
  exactModel?: string | null;
  derivedDeviceCategory?: DerivedProductCategory;
  affectedOsOrFirmware?: string | null;
  affectedSoftwareVersions?: string[];
  applicableRegion?: string | null;
  confidence: ProductMatchConfidence;
  status: 'CONFIRMED' | 'PENDING_REVIEW' | 'DISMISSED';
  relationshipType?: MatchRelationshipType;
  evidenceStrength?: MatchEvidenceStrength;
  matcherRuleId?: string;
  matcherVersion?: string;
  evidence: string[];
  matchEvidence?: string[]; // Alias for UI compatibility
  evidenceSummary?: string;
  evidenceSourceFields?: string[];
  missingEvidence?: string[];
  classificationRationale?: string;
  potentialConflicts?: string[];
  recommendedReviewAction?: RecommendedMatchReviewAction;
  officialSourceUrl?: string;
  sourceUrl?: string;
  bulletinReference?: string;
  // S1.2.4 & S1.2.5 Official Source Authenticity & Product Applicability Audit fields
  authenticityClassification?: MatchAuthenticityClassification;
  sourcePublishedAt?: string;
  sourceVerifiedAt?: string;
  attributableExcerpt?: string;
  sourceAuthenticityStatus?: AdvisoryAuthenticityStatus;
  sourceAuthenticityWarnings?: string[];
  qualifiesForAutomaticConfirmation?: boolean;
  matchedAt: string;
  lastEvaluatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export type MatchAuthenticityClassification =
  | 'OFFICIAL_CONFIRMED'
  | 'OFFICIAL_FAMILY_CONFIRMED'
  | 'INFERRED_NEEDS_REVIEW'
  | 'SOURCE_UNVERIFIABLE'
  | 'SOURCE_CONTRADICTED'
  | 'NOT_APPLICABLE';

export type AdvisoryAuthenticityStatus =
  | 'VERIFIED_AUTHENTIC'
  | 'AUTHENTIC_WITH_PARSING_CAVEATS'
  | 'GENERIC_MAINTENANCE_SCHEDULE'
  | 'UNVERIFIABLE'
  | 'CONTRADICTED';

export interface AdvisoryAuthenticityAuditRecord {
  advisoryId: string;
  sourceId: ServiceSourceId;
  manufacturer: ServiceManufacturer;
  advisoryType: ServiceAdvisoryType;
  storedTitle: string;
  officialPageTitle?: string;
  sourceUrl: string;
  expectedAuthorityDomain: string;
  domainVerified: boolean;
  httpStatus?: number;
  liveVerificationMode: 'LIVE_HTTP_VERIFIED' | 'STRUCTURAL_AUDIT_ONLY' | 'LIVE_BLOCKED_OR_UNREACHABLE';
  verifiedAt: string;
  publishedAt: string;
  authenticityStatus: AdvisoryAuthenticityStatus;
  titleMatchesSource: boolean;
  versionSupportedBySource: boolean;
  affectedScopeSupportedBySource: boolean;
  isMaintenanceScheduleOrGenericPage: boolean;
  isZeroCveRelease: boolean;
  hasPublishedCvesInRecord: boolean;
  storedCveCount: number;
  livePageCveCount?: number;
  attributableExcerpt: string;
  findings: string[];
  missingOrCaveatReasons: string[];
  eligibleForProductMatching: boolean;
  candidateMatchCount: number;
  exclusionReasonIfZeroMatches?: string;
}

export interface CandidateCountReconciliationReport {
  totalAdvisoriesExamined: number;
  advisoriesEligibleForMatching: number;
  advisoriesGeneratingMatches: number;
  advisoriesWithZeroMatches: number;
  advisoriesExcludedWithReasons: Array<{
    category: string;
    count: number;
    advisoryIds: string[];
    reason: string;
  }>;
  totalCanonicalProductsExamined: number;
  productsByManufacturer: Record<
    string,
    {
      total: number;
      smartphones: number;
      tablets: number;
      wearables: number;
      laptops?: number;
      audio: number;
      other: number;
      excludedAccessoriesOrBundled: number;
    }
  >;
  totalCandidateCombinationsEvaluated: number;
  candidateMatchesGenerated: number;
  candidateMatchesRejected: number;
  deduplicationRulesApplied: string[];
  discrepancyExplanation531Vs762: {
    earlierS122CandidateCount: number;
    s123AndS124CandidateCount?: number;
    currentCandidateCount: number;
    totalDelta: number;
    s125RestoredCandidatesDelta?: number;
    summaryExplanation: string;
    breakdownOf231ExcludedCandidates: Array<{
      category: string;
      excludedCandidateCount: number;
      affectedSkuCount: number;
      affectedAdvisoryCount: number;
      technicalCause: string;
      s125ResolutionStatus?: string;
    }>;
  };
}

export interface SourceAuthenticityAuditSummary {
  auditedAt: string;
  auditorVersion: string;
  liveProbesExecuted: boolean;
  advisoryCounts: {
    total: number;
    verifiedAuthentic: number;
    authenticWithCaveats: number;
    genericMaintenanceSchedule: number;
    unverifiable: number;
    contradicted: number;
  };
  matchAuthenticityCounts: Record<MatchAuthenticityClassification, number>;
  verified221AuditBreakdown: {
    totalCurrentlyVerified: number;
    officialConfirmed: number;
    officialFamilyConfirmed: number;
    downgradedToInferredNeedsReview: number;
    sourceUnverifiable: number;
    sourceContradicted: number;
    notApplicable: number;
    explanation: string;
  };
  manufacturerFindings: Record<
    'Apple' | 'Huawei' | 'Samsung' | 'CISA_KEV' | 'NIST_NVD',
    {
      advisoriesCount: number;
      verifiedAuthenticCount: number;
      caveatOrScheduleCount: number;
      unverifiableCount: number;
      contradictedCount: number;
      summaryFinding: string;
      keyRisks: string[];
    }
  >;
  candidateCountReconciliation: CandidateCountReconciliationReport;
  advisoryAudits: AdvisoryAuthenticityAuditRecord[];
  goNoGoRecommendation: 'GO' | 'CONDITIONAL_GO_AFTER_REMEDIATION' | 'NO_GO';
  goNoGoJustification: string[];
}

export interface MatcherRuleAuditDescriptor {
  ruleId: string;
  manufacturer: ServiceManufacturer;
  targetConfidence: ProductMatchConfidence;
  evidenceStrength: MatchEvidenceStrength;
  defaultRelationshipType: MatchRelationshipType;
  requiredEvidence: string[];
  sourceFieldsUsed: string[];
  productIdentityRequirements: string;
  softwareApplicabilityRequirements: string;
  confidenceLimitations: string;
  falsePositiveRisks: string;
}

export interface StratifiedAuditItem {
  sampleIndex: number;
  stratumId: string;
  stratumLabel: string;
  candidateId: string;
  canonicalProductId: string;
  canonicalProductName: string;
  productCategory: string;
  advisoryId: string;
  advisoryTitle: string;
  advisoryType: ServiceAdvisoryType;
  manufacturer: ServiceManufacturer;
  sourceUrl: string;
  actualConfidence: ProductMatchConfidence;
  expectedConfidence: ProductMatchConfidence;
  relationshipType: MatchRelationshipType;
  evidenceStrength: MatchEvidenceStrength;
  matcherRuleId: string;
  authenticityClassification?: MatchAuthenticityClassification;
  evidenceSummary: string;
  missingEvidence: string[];
  auditVerdict: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
  verdictReason: string;
}

export interface ServiceSyncRun {
  id: string;
  sourceId: ServiceSourceId;
  sourceName: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  advisoriesDiscovered: number;
  advisoriesCreated: number;
  advisoriesUpdated: number;
  advisoriesUnchanged?: number;
  advisoriesRejectedOrFailed?: number;
  vulnerabilitiesDiscovered: number;
  vulnerabilitiesCreated?: number;
  vulnerabilitiesUpdated?: number;
  productMatchesCreated: number;
  matchingStageStatus?: 'DEFERRED_TO_RECOMPUTE' | 'COMPLETED' | 'SKIPPED';
  stages?: {
    sourceExtraction: 'SUCCESS' | 'FAILED';
    advisoryPersistence: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    vulnerabilityPersistence: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    productMatching: 'DEFERRED_TO_RECOMPUTE' | 'SUCCESS' | 'SKIPPED';
  };
  persistenceStorageMode: PersistenceStorageMode;
  error?: string;
  triggeredBy: 'SCHEDULED_JOB' | 'MANUAL_ADMIN';
}

export interface MatchRecomputeSummary {
  mode: 'DRY_RUN' | 'PERSIST';
  status: 'DRY_RUN_READY' | 'PERSISTED_VERIFIED' | 'PERSISTENCE_FAILED' | 'QUALITY_GATE_BLOCKED';
  timestamp: string;
  matcherVersion: string;
  catalogSource: 'FIRESTORE_AUTHORITATIVE' | 'PREVIEW_MEMORY_FALLBACK';
  advisoriesExamined: number;
  canonicalProductsExamined: number;
  candidateMatchesGenerated: number;
  verifiedCandidates: number;
  likelyCandidates: number;
  ambiguousReviewCandidates: number;
  rejectedCandidates: number;
  unmatchedCount?: number;
  verifiedWithDirectEvidence?: number;
  verifiedWithStructuredApplicability?: number;
  verifiedMissingRequiredEvidence?: number;
  candidatesMissingEvidenceCount?: number;
  potentialIdentityCollisions?: number;
  adminConfirmedCount?: number;
  matcherVerifiedPendingAdminCount?: number;
  relationshipBreakdown?: Record<MatchRelationshipType, number>;
  evidenceStrengthBreakdown?: Record<MatchEvidenceStrength, number>;
  authenticityBreakdown?: Record<MatchAuthenticityClassification, number>;
  downgradedFromLegacyVerified: number;
  downgradeReasons: string[];
  existingPersistedMatches: number;
  plannedCreates: number;
  plannedUpdates: number;
  plannedUnchanged: number;
  preservedAdminDecisions: number;
  potentialConflicts: number;
  persistenceExecuted: boolean;
  persistedTotalCount: number | 'UNAVAILABLE';
  persistedVerifiedCount: number | 'UNAVAILABLE';
  persistedPendingReviewCount: number | 'UNAVAILABLE';
  persistedDismissedCount: number | 'UNAVAILABLE';
  batchesCommitted: number;
  writeErrors: string[];
  // S1.2.3 & S1.2.5 Quality Gate & Snapshot Verification
  qualityGateStatus?: QualityGateReadinessStatus;
  s125QualityGateOverallStatus?: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
  qualityGatePassed?: boolean;
  qualityGateBlockingReasons?: string[];
  qualityGateWarnings?: string[];
  dryRunSnapshotHash?: string;
  // Backward-compatible summary fields
  totalMatches: number;
  verifiedCount: number;
  likelyCount: number;
  reviewCount: number;
}

export interface MatchEvidenceReviewResponse {
  matcherVersion: string;
  evaluatedAt: string;
  dryRunSnapshotHash: string;
  snapshotId?: string;
  snapshotCreatedAt?: string;
  snapshotExpiresAt?: string;
  isSnapshotExpired?: boolean;
  totalCandidatesInSnapshot?: number;
  verifiedCountInSnapshot?: number;
  likelyCountInSnapshot?: number;
  ambiguousCountInSnapshot?: number;
  auditSectionErrors?: Array<{ subsystem: string; error: string }>;
  qualityGateStatus: QualityGateReadinessStatus;
  qualityGatePassed: boolean;
  qualityGateBlockingReasons: string[];
  qualityGateWarnings: string[];
  summary: MatchRecomputeSummary;
  candidates: ServiceProductMatch[];
  rejectedSample: ServiceProductMatch[];
  stratifiedAudit: {
    samplingMethodology: string;
    totalSampled: number;
    passCount: number;
    failCount: number;
    needsReviewCount: number;
    items: StratifiedAuditItem[];
  };
  ruleRegistry: MatcherRuleAuditDescriptor[];
  sourceAuthenticityAudit?: SourceAuthenticityAuditSummary;
  s125IntegrityAudit?: OfficialAdapterAndIntegrityAuditReport;
}

export interface ServiceDashboardStats {
  totalAdvisories: number;
  totalPersistedAdvisories?: number;
  activeAdvisoriesCount?: number;
  visibleAdvisoriesUnderFilterCount?: number;
  totalVulnerabilities: number;
  cisaKevCount: number;
  totalPersistedCisaKevCount?: number;
  latestSyncRecordsCreated?: number;
  latestSyncRecordsUpdated?: number;
  latestSyncRecordsUnchanged?: number;
  latestSyncRecordsRejectedOrFailed?: number;
  latestCompletedSyncStatus?: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NOT_VERIFIED';
  highSeverityCount: number;
  criticalSeverityCount: number;
  unknownSeverityCount: number;
  verifiedProductMatchesCount: number;
  pendingReviewMatchesCount: number;
  persistedMatchesStatus?: 'FIRESTORE_AUTHORITATIVE' | 'UNAVAILABLE';
  persistedVerifiedProductMatchesCount?: number | 'UNAVAILABLE';
  persistedPendingReviewMatchesCount?: number | 'UNAVAILABLE';
  catalogCandidateStatus?: 'NOT_RUN' | 'AVAILABLE' | 'UNAVAILABLE';
  computedCandidateMatchesCount?: number;
  computedVerifiedCandidatesCount?: number;
  computedPendingCandidatesCount?: number;
  unmatchedAdvisoriesCount: number;
  sourcesOperational: number;
  totalSources: number;
  persistenceStorageMode: PersistenceStorageMode;
  
  // Mutually exclusive manufacturer breakdown (Sum === totalAdvisories)
  manufacturerBreakdown: {
    Apple: number;
    Samsung: number;
    Huawei: number;
    CrossVendor: number;
  };
  
  // Breakdown by Source
  sourceBreakdown: Record<ServiceSourceId, number>;
  
  // Breakdown by Advisory Type
  advisoryTypeBreakdown: Record<ServiceAdvisoryType, number>;
  
  // Distinct CVE count
  uniqueCveCount: number;
  
  lastSyncTimestamp?: string;
}

export interface ServiceFilterOptions {
  manufacturer?: ServiceManufacturer | 'ALL';
  advisoryType?: ServiceAdvisoryType | 'ALL';
  severity?: ServiceSeverity | 'ALL';
  knownExploitedOnly?: boolean;
  searchQuery?: string;
  limit?: number;
}

// ============================================================
// Phase S1.2.1 & S1.2.2 Production Diagnostics Types
// ============================================================

export type FirestoreConnectionStatus =
  | 'CONNECTED'
  | 'PERMISSION_DENIED'
  | 'UNAVAILABLE'
  | 'NOT_VERIFIED';

export type DiagnosticVerificationStatus =
  | 'PRODUCTION_VERIFIED'
  | 'PRODUCTION_NOT_VERIFIED'
  | 'PERSISTENCE_FAILED'
  | 'PARTIAL_VERIFICATION';

export interface PersistenceProbeStepResult {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  durationMs?: number;
  error?: string;
}

export interface PersistenceProbeReport {
  probeDocId: string;
  timestamp: string;
  write: PersistenceProbeStepResult;
  readBack: PersistenceProbeStepResult;
  contentVerification: PersistenceProbeStepResult;
  cleanup: PersistenceProbeStepResult;
  overallResult: 'VERIFIED' | 'FAILED' | 'INCOMPLETE';
  remainingDocument?: string;
  summaryMessage: string;
}

export interface FirestoreCollectionCountReport {
  serviceSources: number | 'UNAVAILABLE';
  activeSourcesCount?: number | 'UNAVAILABLE';
  serviceAdvisories: number | 'UNAVAILABLE';
  cisaKevAdvisoriesCount?: number | 'UNAVAILABLE';
  serviceVulnerabilities: number | 'UNAVAILABLE';
  serviceProductMatches: number | 'UNAVAILABLE';
  productMatchesBreakdown: {
    VERIFIED: number | 'UNAVAILABLE';
    LIKELY: number | 'UNAVAILABLE';
    AMBIGUOUS_REVIEW: number | 'UNAVAILABLE';
    UNMATCHED: number | 'UNAVAILABLE';
  };
  productMatchesStatusBreakdown?: {
    CONFIRMED: number | 'UNAVAILABLE';
    PENDING_REVIEW: number | 'UNAVAILABLE';
    DISMISSED: number | 'UNAVAILABLE';
  };
  serviceSyncRuns: number | 'UNAVAILABLE';
  serviceAlerts: number | 'UNAVAILABLE';
}

export interface LastPersistedSyncAudit {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOT_VERIFIED';
  sourceId?: string;
  syncRunId?: string;
  completionTimestamp?: string;
  recordsCreated?: number;
  recordsUpdated?: number;
  persistenceStatus?: string;
  notes?: string;
}

export interface MetricConsistencyItem {
  metric: string;
  dashboardCount: number | 'UNAVAILABLE';
  firestoreCount: number | 'UNAVAILABLE';
  difference: number | 'N/A';
  status: 'RECONCILED' | 'DESYNC_PREVIEW_MEMORY' | 'UNAVAILABLE';
}

export interface MatchReconciliationDiagnosticStatus {
  lastRecomputationAt?: string;
  lastPersistenceStatus: 'NOT_RUN' | 'DRY_RUN_ONLY' | 'PERSISTED_VERIFIED' | 'FAILED';
  lastMatchError?: string;
  matcherVersion: string;
  computedCandidatesCount: number;
  computedVerifiedCandidatesCount: number;
  computedPendingCandidatesCount: number;
  lastSummary?: MatchRecomputeSummary;
}

export interface ReconciledCountersReport {
  totalPersistedAdvisories: number;
  activeAdvisoriesCount: number;
  visibleAdvisoriesUnderFilterCount: number;
  totalPersistedCisaKevCount: number;
  latestSyncRecordsCreated: number;
  latestSyncRecordsUpdated: number;
  latestSyncRecordsUnchanged: number;
  latestSyncRecordsRejectedOrFailed: number;
  latestCompletedSyncStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NOT_VERIFIED';
  discrepancyExplanations: {
    advisoryCount93Vs94: string;
    cisaKevCount40Vs1: string;
    syncStatusPartialVsOperational: string;
  };
}

export interface ProductionSubsystemStatuses {
  firestoreConnectionStatus: FirestoreConnectionStatus;
  persistenceProbeStatus: 'VERIFIED' | 'INCOMPLETE' | 'FAILED' | 'NOT_RUN';
  sourceSyncStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NOT_VERIFIED';
  matchComputationStatus: 'READY' | 'STALE' | 'FAILED' | 'NOT_RUN';
  matchInspectorStatus: 'READY' | 'EMPTY_OR_FAILED' | 'STALE_SNAPSHOT' | 'NOT_LOADED';
  qualityGateStatus: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED' | 'NOT_EVALUATED';
}

export interface SourceSyncSchemaAuditItem {
  sourceId: ServiceSourceId;
  providerName: string;
  totalPersistedRecords: number;
  currentSchemaCount: number;
  stalePreS125SchemaCount: number;
  incompleteMissingDetailCvesCount: number;
  supersededDuplicateCount?: number;
  requiresReprocessingCount: number;
  reprocessingRecordIds: string[];
  syncReadinessStatus: 'CURRENT' | 'REQUIRES_SELECTIVE_REPROCESSING';
  summaryNotes: string[];
}

export interface SourceSyncSchemaAuditSummary {
  auditedAt: string;
  readOnlyMode: true;
  totalAdvisoriesAudited: number;
  totalVulnerabilitiesAudited: number;
  totalCurrentSchemaRecords: number;
  totalStalePreS125SchemaRecords: number;
  totalIncompleteDetailExtractionRecords: number;
  totalRequiringReprocessing: number;
  sources: SourceSyncSchemaAuditItem[];
}

export interface ProductionDiagnosticsReport {
  runtimeInfo: {
    environment: 'Cloud Run' | 'AI Studio Preview' | 'Unknown';
    cloudRunService?: string;
    cloudRunRegion?: string;
    firebaseProjectId: string;
    firestoreDatabaseId: string;
    timestamp: string;
  };
  firestoreConnection: FirestoreConnectionStatus;
  storageMode: PersistenceStorageMode | 'FIRESTORE_UNAVAILABLE' | 'UNKNOWN';
  overallVerificationStatus: DiagnosticVerificationStatus;
  subsystemStatuses?: ProductionSubsystemStatuses;
  subsystemErrors?: Array<{ subsystem: string; error: string }>;
  reconciledCounters?: ReconciledCountersReport;
  sourceSyncAudit?: SourceSyncSchemaAuditSummary;
  probeReport?: PersistenceProbeReport;
  firestoreCounts: FirestoreCollectionCountReport;
  lastPersistedSync: LastPersistedSyncAudit;
  consistencyChecks: MetricConsistencyItem[];
  matchReconciliation?: MatchReconciliationDiagnosticStatus;
  s125IntegrityAudit?: OfficialAdapterAndIntegrityAuditReport;
  instructions: string[];
}

// ============================================================
// Phase S1.2.5 — Official Source Adapter Corrections,
// Advisory Integrity & Evidence-Based Product Matching Types
// ============================================================

export interface ProductClassificationAuditItem {
  canonicalProductId: string;
  productId?: string;
  canonicalName: string;
  productName?: string;
  brand: string;
  storedRetailCategory: string;
  legacyWasAccessoryExcluded: boolean;
  derivedCategory: DerivedProductCategory;
  derivedDeviceCategory?: DerivedProductCategory;
  eligibleForOsSecurityMatching: boolean;
  isExcludedFromMatching?: boolean;
  classificationCorrected: boolean;
  restoredFromLegacyExclusion?: boolean;
  correctionReason?: string;
  reason?: string;
  classificationEvidence: string;
}

export interface DuplicateAdvisoryGroup {
  dedupeKey: string;
  manufacturer: ServiceManufacturer;
  normalizedSourceUrl: string;
  bulletinReference: string;
  publishedAt: string;
  advisoryIds: string[];
  recommendedPrimaryId: string;
  reason: string;
}

export interface ProviderAdapterHealthAudit {
  provider: 'Apple' | 'Huawei' | 'Samsung' | 'CISA_KEV' | 'NIST_NVD';
  sourceId: ServiceSourceId;
  officialEndpoint: string;
  adapterVersion: string;
  status: 'HEALTHY' | 'PARSING_CAVEATS_DETECTED' | 'RATE_LIMITED' | 'DEGRADED';
  persistedAdvisoriesCount: number;
  verifiedAuthenticCount: number;
  caveatsOrLegacyArtifactsCount: number;
  unverifiableCount: number;
  advisoriesWithExtractedCvesCount: number;
  zeroCveOrScheduleAdvisoriesCount: number;
  totalExtractedCveLinks: number;
  adapterFixesApplied: string[];
  discrepanciesFoundInPersistedData: string[];
}

export type S125QualityGateCheckId =
  | 'CHECK_01_SOURCE_AUTHENTICITY'
  | 'CHECK_02_ADVISORY_IDENTITY_INTEGRITY'
  | 'CHECK_03_BULLETIN_TITLE_CONSISTENCY'
  | 'CHECK_04_PUBLICATION_DATE_VALIDITY'
  | 'CHECK_05_CVE_EXTRACTION_PROVENANCE'
  | 'CHECK_06_PRODUCT_CLASSIFICATION_CORRECTNESS'
  | 'CHECK_07_MANUFACTURER_AND_GENERATION_MATCHING'
  | 'CHECK_08_UPDATE_ELIGIBILITY_VS_VULNERABILITY_SEPARATION'
  | 'CHECK_09_UNSUPPORTED_VERIFIED_MATCHES'
  | 'CHECK_10_DUPLICATE_ADVISORY_DETECTION'
  | 'CHECK_11_SOURCE_SPECIFIC_EXTRACTION_FAILURES'
  | 'CHECK_12_PRODUCTION_DATASET_RECONCILIATION';

export interface S125QualityGateCheckItem {
  checkNumber: number;
  checkId: S125QualityGateCheckId;
  name: string;
  status: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
  summary: string;
  failureOrReviewReasons: string[];
  affectedRecordIds: string[];
}

export interface S125QualityGateReport {
  overallStatus: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
  evaluatedAt: string;
  totalChecks?: number;
  passCount: number;
  needsReviewCount: number;
  blockedCount: number;
  bulkPersistenceSafe?: boolean;
  blockingReasons: string[];
  reviewWarnings: string[];
  checks: S125QualityGateCheckItem[];
}

export interface AdvisoryProposedCorrectionItem {
  advisoryId: string;
  deterministicId?: string;
  manufacturer?: ServiceManufacturer;
  sourceId: ServiceSourceId;
  officialUrl?: string;
  currentTitle: string;
  proposedTitle?: string;
  proposedCleanTitle?: string;
  currentAdvisoryType: ServiceAdvisoryType;
  proposedAdvisoryType: ServiceAdvisoryType;
  currentCveCount: number;
  expectedOfficialCveCount?: number | null;
  proposedCveNote?: string;
  proposedChanges?: string[];
  discrepancyCategories?: string[];
  requiresLiveDetailResync?: boolean;
}

export interface ProductionReconciliationPreview {
  generatedAt: string;
  readOnlyMode: boolean;
  advisoriesExamined?: number;
  advisoriesRequiringCorrectionCount?: number;
  existingPersistedAdvisoriesCount?: number;
  unchangedAdvisoriesCount?: number;
  advisoriesRequiringAdapterCorrectionCount?: number;
  suspectedDuplicateGroupsCount?: number;
  duplicateAdvisoryGroupsCount?: number;
  unverifiableAdvisoriesCount?: number;
  cveAssociationsInPersistedStore?: number;
  advisoriesMissingDetailPageCveExtractionCount?: number;
  canonicalProductsAuditedCount?: number;
  productClassificationCorrectionsCount?: number;
  restoredPrimaryHardwareSkuCount?: number;
  productClassificationBreakdown?: Record<DerivedProductCategory, number>;
  candidateMatchComparison?: {
    s122LegacyCount: number;
    s124PreviousCount: number;
    s125CurrentCandidateCount: number;
    s125VerifiedCount: number;
    s125LikelyCount: number;
    s125AmbiguousReviewCount: number;
    restoredFromFalseAccessoryExclusionCount: number;
    downgradedScheduleOrZeroCveCount: number;
  };
  candidateMatchesSummary?: {
    totalCandidates: number;
    verifiedCount: number;
    likelyCount: number;
    ambiguousReviewCount: number;
    scheduleMatchesInVerifiedCount: number;
  };
  proposedAdvisoryCorrections: AdvisoryProposedCorrectionItem[];
  productClassificationCorrections?: ProductClassificationAuditItem[];
  duplicateGroups?: DuplicateAdvisoryGroup[];
  duplicateAdvisoryGroups?: DuplicateAdvisoryGroup[];
}

export interface OfficialAdapterAndIntegrityAuditReport {
  auditedAt: string;
  version: string;
  providerHealth?: ProviderAdapterHealthAudit[];
  providerAdapterHealth?: any[];
  productClassificationAudit?: any;
  duplicateAdvisoriesAudit?: any;
  qualityGate12Check: S125QualityGateReport;
  reconciliationPreview: ProductionReconciliationPreview;
  sourceSyncAudit?: SourceSyncSchemaAuditSummary;
  candidateCountReconciliation?: CandidateCountReconciliationReport;
  candidateCountComparison?: {
    s122Count: number;
    s123AndS124Count: number;
    s125CurrentCount: number;
    s125VerifiedCount: number;
    s125LikelyCount: number;
    s125AmbiguousReviewCount: number;
    restoredByClassificationAndParserFixes: number;
    explanation: string;
  };
}

// ============================================================
// Phase S1.2.6 — Selective Apple Advisory Reprocessing &
// Production Quality Gate Closure Types
// ============================================================

export interface AppleSelectiveReprocessRecordChange {
  advisoryId: string;
  preservedExistingId: true;
  sourceUrl: string;
  publishedAt: string;
  category:
    | 'STALE_ZERO_CVE_SCHEMA_AND_DUPLICATE_RESOLUTION'
    | 'MISSING_DETAIL_PAGE_CVE_EXTRACTION'
    | 'METADATA_NORMALIZATION_ONLY'
    | 'INSUFFICIENT_OFFICIAL_EVIDENCE_RETAINED';
  actionTaken:
    | 'NORMALIZE_ZERO_CVE_AND_MARK_SUPERSEDED'
    | 'NORMALIZE_ZERO_CVE_ACTIVE'
    | 'EXTRACT_OFFICIAL_DETAIL_CVES'
    | 'NORMALIZE_METADATA'
    | 'RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE'
    | 'NO_CHANGE_ALREADY_NORMALIZED';
  before: {
    title: string;
    advisoryType: ServiceAdvisoryType;
    severity: ServiceSeverity;
    isZeroCveRelease?: boolean;
    cveIds: string[];
    affectedProducts: string[];
    fixedVersions: string[];
    bulletinReference?: string;
    verificationStatus: VerificationStatus;
    status?: 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED';
    supersededByAdvisoryId?: string;
  };
  after: {
    title: string;
    advisoryType: ServiceAdvisoryType;
    severity: ServiceSeverity;
    isZeroCveRelease?: boolean;
    cveIds: string[];
    affectedProducts: string[];
    fixedVersions: string[];
    bulletinReference?: string;
    verificationStatus: VerificationStatus;
    status: 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED';
    supersededByAdvisoryId?: string;
  };
  officialEvidenceSummary: string;
  fieldsChanged: string[];
}

export interface AppleSelectiveReprocessReport {
  mode: 'DRY_RUN' | 'PERSIST';
  status: 'DRY_RUN_PREVIEW_READY' | 'PERSISTED_AND_VERIFIED' | 'NO_CHANGES_REQUIRED' | 'FAILED';
  evaluatedAt: string;
  reprocessingVersion: string;
  snapshotHashBefore: string;
  snapshotHashAfter: string;
  totalAdvisoriesInStore: number;
  totalAppleAdvisoriesExamined: number;
  activeAppleAdvisoriesAfter: number;
  supersededAppleAdvisoriesAfter: number;
  targetAdvisoriesIdentifiedCount: number;
  staleSchemaAdvisoriesTargetedCount: number;
  missingDetailCveAdvisoriesTargetedCount: number;
  metadataNormalizedCount: number;
  insufficientEvidenceRetainedCount: number;
  recordsPlannedForUpdateCount: number;
  recordsPersistedCount: number;
  batchesCommitted: number;
  readBackVerified: boolean;
  nonAppleRecordsTouchedCount: 0;
  recordChanges: AppleSelectiveReprocessRecordChange[];
  beforeMetrics: {
    totalAdvisories: number;
    activeAdvisories: number;
    appleStalePreS125Count: number;
    appleMissingDetailCvesCount: number;
    appleRequiresReprocessingCount: number;
    duplicateGroupsCount: number;
    candidateMatchesTotal: number;
    verifiedCandidates: number;
    likelyCandidates: number;
    ambiguousReviewCandidates: number;
    qualityGateOverallStatus: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
    qualityGatePassCount: number;
    qualityGateNeedsReviewCount: number;
    qualityGateBlockedCount: number;
  };
  afterMetrics: {
    totalAdvisories: number;
    activeAdvisories: number;
    appleStalePreS125Count: number;
    appleMissingDetailCvesCount: number;
    appleRequiresReprocessingCount: number;
    duplicateGroupsCount: number;
    candidateMatchesTotal: number;
    verifiedCandidates: number;
    likelyCandidates: number;
    ambiguousReviewCandidates: number;
    qualityGateOverallStatus: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
    qualityGatePassCount: number;
    qualityGateNeedsReviewCount: number;
    qualityGateBlockedCount: number;
  };
  qualityGateAfter: S125QualityGateReport;
  sourceSyncAuditAfter: SourceSyncSchemaAuditSummary;
  warnings: string[];
  errors: string[];
}





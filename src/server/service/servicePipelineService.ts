/**
 * Signalyn Service Intelligence - Pipeline Orchestration & Authoritative Aggregation Service
 * Phase S1.2.2 - Service Product Matching Persistence & Sync Integrity Fix
 * 
 * Objectives:
 * 1. Synchronizes official manufacturer and cybersecurity sources idempotently with accurateCOMPLETED sync status.
 * 2. Loads canonical retail products directly from authoritative Firestore (retailProducts) without pilot-only fallback.
 * 3. Strictly separates persisted Firestore product matches from in-memory computed candidates.
 * 4. Provides safe Dry-Run -> Admin Confirmation -> Bounded Batch Persistence -> Read-Back Verification for matches.
 * 5. Preserves administrator review decisions (CONFIRMED / DISMISSED) across recomputations.
 * 6. Dashboard counters for Confirmed Product Links and Pending Review Matches come strictly from Firestore.
 */

import { createHash } from 'crypto';
import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, collection as clientCollection, getDocs as clientGetDocs, setLogLevel as setClientLogLevel } from 'firebase/firestore';
import firebaseAppletConfig from '../../../firebase-applet-config.json' with { type: 'json' };

setClientLogLevel('silent');
import {
  ServiceSource,
  ServiceSourceId,
  ServiceAdvisory,
  ServiceVulnerability,
  ServiceProductMatch,
  ServiceSyncRun,
  ServiceDashboardStats,
  ServiceFilterOptions,
  PersistenceStorageMode,
  FirestoreConnectionStatus,
  DiagnosticVerificationStatus,
  PersistenceProbeReport,
  FirestoreCollectionCountReport,
  LastPersistedSyncAudit,
  MetricConsistencyItem,
  ProductionDiagnosticsReport,
  MatchRecomputeSummary,
  MatchReconciliationDiagnosticStatus,
  MatchRelationshipType,
  MatchEvidenceStrength,
  QualityGateReadinessStatus,
  MatchEvidenceReviewResponse,
  MatchAuthenticityClassification,
  SourceAuthenticityAuditSummary,
  OfficialAdapterAndIntegrityAuditReport,
  SourceSyncSchemaAuditSummary,
  ProductionSubsystemStatuses,
  ReconciledCountersReport,
  AppleSelectiveReprocessRecordChange,
  AppleSelectiveReprocessReport,
} from '../../types/serviceIntelligence';
import { RetailProduct } from '../../types/retailPrice';
import { OFFICIAL_SERVICE_SOURCES, getOfficialServiceSources } from './serviceSourceRegistry';
import {
  fetchAppleSecurityReleases,
  cleanAppleReleaseTitle,
  extractAppleBulletinIdFromUrl,
  normalizeAppleSourceUrl,
  parseAppleSecurityDetailHtml,
  applyDetailExtractionToAdvisory,
} from './adapters/appleSecurityAdapter';
import { fetchHuaweiSecurityBulletins } from './adapters/huaweiSecurityAdapter';
import { fetchSamsungSecurityBulletins } from './adapters/samsungSecurityAdapter';
import { fetchCisaKevFeed } from './adapters/cisaKevAdapter';
import { batchEnrichCvesWithNvd } from './adapters/nvdAdapter';
import {
  matchAdvisoriesToCatalog,
  SERVICE_MATCHER_VERSION,
  MATCHER_RULE_REGISTRY,
  buildStratifiedQualityAuditSample,
  validateCandidateEvidenceGate,
  detectDuplicateAdvisories,
} from './serviceProductMatcher';
import {
  runOfficialSourceAuthenticityAudit,
  runOfficialAdapterAndIntegrityAudit,
  buildSourceSyncSchemaAudit,
  evaluateS125QualityGate,
  buildProductionReconciliationPreview,
  auditSingleAdvisoryAuthenticity,
  validateAdvisoryVersionAuthenticity,
} from './serviceAuthenticityAuditor';
import { getMemCatalog, seedPilotCatalog } from '../retail/retailPipelineService';
import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import { TARGET_PROJECT_ID, TARGET_DATABASE_ID } from '../firestoreAdmin';

// In-Memory caches:
// CRITICAL S1.2.2 / S1.2.3 SEPARATION:
// - memPersistedMatches holds ONLY matches verified in Firestore `serviceProductMatches`.
// - memComputedCandidates holds in-memory candidate matches (Not Yet Persisted).
const memSources = new Map<ServiceSourceId, ServiceSource>();
const memAdvisories = new Map<string, ServiceAdvisory>();
const memVulnerabilities = new Map<string, ServiceVulnerability>();
const memPersistedMatches = new Map<string, ServiceProductMatch>();
const memComputedCandidates = new Map<string, ServiceProductMatch>();
const memSyncRuns = new Map<string, ServiceSyncRun>();
const activeSyncLocks = new Set<ServiceSourceId>();

export interface ActiveDryRunSnapshot {
  snapshotHash: string;
  createdAt: string;
  expiresAt: string;
  advisories: ServiceAdvisory[];
  catalogProducts: RetailProduct[];
  candidates: ServiceProductMatch[];
  rejectedSample: ServiceProductMatch[];
  summary: MatchRecomputeSummary;
}

const DRY_RUN_SNAPSHOT_TTL_MS = 30 * 60 * 1000; // 30 minutes

let isInitialized = false;
let isRecomputeRunning = false;
let inFlightDryRunPromise: Promise<MatchRecomputeSummary> | undefined;
let globalPersistenceMode: PersistenceStorageMode = 'PREVIEW_IN_MEMORY_ONLY';
let lastFirestorePersistenceError: string | undefined;
let catalogCandidateStatus: 'NOT_RUN' | 'AVAILABLE' | 'UNAVAILABLE' = 'NOT_RUN';
let lastAuthoritativeRefreshAt = 0;

// Match Recomputation & Persistence Diagnostic State (Objective 8)
let lastMatchRecomputationAt: string | undefined;
let lastMatchPersistenceStatus: 'NOT_RUN' | 'DRY_RUN_ONLY' | 'PERSISTED_VERIFIED' | 'FAILED' = 'NOT_RUN';
let lastMatchError: string | undefined;
let lastMatchSummary: MatchRecomputeSummary | undefined;
let lastDryRunSnapshotHash: string | undefined;
let lastDryRunSnapshot: ActiveDryRunSnapshot | undefined;

export function getActiveDryRunSnapshot(customDb?: any): ActiveDryRunSnapshot | undefined {
  if (customDb && (customDb as any)._lastDryRunSnapshot) {
    return (customDb as any)._lastDryRunSnapshot as ActiveDryRunSnapshot;
  }
  return lastDryRunSnapshot;
}

export function expireActiveDryRunSnapshotForTests(customDb?: any): void {
  const pastIso = new Date(Date.now() - 60_000).toISOString();
  if (customDb && (customDb as any)._lastDryRunSnapshot) {
    (customDb as any)._lastDryRunSnapshot.expiresAt = pastIso;
  }
  if (lastDryRunSnapshot) {
    lastDryRunSnapshot.expiresAt = pastIso;
  }
}

export function resetServiceStateForTests(): void {
  memSources.clear();
  memAdvisories.clear();
  memVulnerabilities.clear();
  memPersistedMatches.clear();
  memComputedCandidates.clear();
  memSyncRuns.clear();
  activeSyncLocks.clear();
  isInitialized = false;
  isRecomputeRunning = false;
  inFlightDryRunPromise = undefined;
  lastAuthoritativeRefreshAt = 0;
  lastMatchRecomputationAt = undefined;
  lastMatchPersistenceStatus = 'NOT_RUN';
  lastMatchError = undefined;
  lastMatchSummary = undefined;
  lastDryRunSnapshotHash = undefined;
  lastDryRunSnapshot = undefined;
}

/**
 * Reconciles in-memory `memAdvisories`, `memVulnerabilities`, and `memSources` with authoritative
 * Firestore collections so that `getServiceAdvisories`, `getServiceDashboardStats`, and
 * `getPersistenceDiagnostic` never drift out of sync (e.g. 93 vs 94 advisories).
 */
async function refreshAuthoritativeStateFromFirestore(options?: {
  customDb?: any;
  force?: boolean;
}): Promise<void> {
  const now = Date.now();
  if (!options?.customDb && !options?.force && now - lastAuthoritativeRefreshAt < 2500) {
    return;
  }
  try {
    const db = options?.customDb || getServerDb();
    const [advSnap, vulnSnap, srcSnap] = await Promise.all([
      db.collection('serviceAdvisories').get(),
      db.collection('serviceVulnerabilities').get(),
      db.collection('serviceSources').get(),
    ]);
    if (!options?.customDb) {
      lastAuthoritativeRefreshAt = now;
      globalPersistenceMode = 'FIRESTORE_AUTHORITATIVE';
      if (Array.isArray(advSnap?.docs) && advSnap.docs.length > 0) {
        memAdvisories.clear();
        for (const d of advSnap.docs) {
          if (String(d.id || '').startsWith('_diag_probe_')) continue;
          const data = (typeof d.data === 'function' ? d.data() : d.data) as ServiceAdvisory;
          if (data && (data.id || d.id)) {
            memAdvisories.set(data.id || d.id, { ...data, id: data.id || d.id });
          }
        }
      }
      if (Array.isArray(vulnSnap?.docs) && vulnSnap.docs.length > 0) {
        memVulnerabilities.clear();
        for (const d of vulnSnap.docs) {
          if (String(d.id || '').startsWith('_diag_probe_')) continue;
          const data = (typeof d.data === 'function' ? d.data() : d.data) as ServiceVulnerability;
          if (data && (data.cveId || d.id)) {
            memVulnerabilities.set(data.cveId || d.id, { ...data, cveId: data.cveId || d.id });
          }
        }
      }
      if (Array.isArray(srcSnap?.docs) && srcSnap.docs.length > 0) {
        for (const d of srcSnap.docs) {
          if (String(d.id || '').startsWith('_diag_probe_')) continue;
          const data = (typeof d.data === 'function' ? d.data() : d.data) as ServiceSource;
          if (data && data.id) {
            memSources.set(data.id, data);
          }
        }
      }
    }
  } catch {
    // Keep existing memAdvisories fallback when Firestore is unreachable in preview
  }
}

/**
 * Computes a deterministic cryptographic hash of the examined advisories and canonical products
 * so that Confirm & Persist can verify the underlying dataset has not changed since the reviewed Dry Run.
 */
export function computeDatasetSnapshotHash(
  advisories: ServiceAdvisory[],
  catalogProducts: RetailProduct[],
): string {
  const advKeys = advisories
    .map(a => `${a.id}:${a.updatedAt || a.publishedAt || ''}:${(a.cveIds || []).length}`)
    .sort()
    .join('|');
  const prodKeys = catalogProducts
    .map(p => `${p.id}:${p.brand}:${p.name || (p as any).title || ''}`)
    .sort()
    .join('|');
  const digest = createHash('sha256')
    .update(`${SERVICE_MATCHER_VERSION}::${advKeys}::${prodKeys}`)
    .digest('hex')
    .slice(0, 16);
  return `snap-s123-${digest}`;
}

/**
 * Loads canonical retail products directly from authoritative Firestore (`retailProducts`).
 * 
 * S1.2.2 Objective 2 Rules:
 * - Never calls seedPilotCatalog() or modifies retailProducts.
 * - Never silently falls back to partial pilot-only memory when authoritative Firestore is required.
 * - Preserves all product variants and SKUs across all brands.
 */
export async function loadAuthoritativeCatalogProducts(options?: {
  customDb?: any;
  allowClientReadFallbackInPreview?: boolean;
}): Promise<{
  products: RetailProduct[];
  loadedCount: number;
  source: 'FIRESTORE_AUTHORITATIVE';
}> {
  const db = options?.customDb || getServerDb();

  let docs: any[] = [];
  try {
    const snap = await db.collection('retailProducts').get();
    docs = snap?.docs || [];
  } catch (adminErr: any) {
    // If a customDb was supplied (e.g. unit test testing permission-denied or failure), fail closed immediately
    if (options?.customDb || !options?.allowClientReadFallbackInPreview) {
      const msg = adminErr instanceof Error ? adminErr.message : String(adminErr);
      throw new Error(`Authoritative Firestore catalog read failed on retailProducts: ${msg}`);
    }

    // Optional read-only client SDK fallback against the SAME authoritative Firestore database in preview
    try {
      const app = getClientApps().length === 0 ? initClientApp(firebaseAppletConfig) : getClientApp();
      const clientDb = getClientFirestore(app, TARGET_DATABASE_ID);
      const clientSnap = await clientGetDocs(clientCollection(clientDb, 'retailProducts'));
      docs = clientSnap.docs;
    } catch (clientErr: any) {
      const msg = adminErr instanceof Error ? adminErr.message : String(adminErr);
      throw new Error(`Authoritative Firestore catalog read failed on retailProducts: ${msg}`);
    }
  }

  const products: RetailProduct[] = [];
  for (const doc of docs) {
    const id = doc.id;
    if (String(id || '').startsWith('_diag_probe_')) continue;
    const raw = typeof doc.data === 'function' ? doc.data() : doc.data;
    if (!raw || !raw.name || !raw.brand) continue;
    products.push({
      ...raw,
      id: raw.id || id,
    } as RetailProduct);
  }

  if (products.length === 0) {
    throw new Error(
      'Authoritative Firestore retailProducts collection returned 0 canonical products. Refusing to fall back to partial pilot-only catalog.'
    );
  }

  return {
    products,
    loadedCount: products.length,
    source: 'FIRESTORE_AUTHORITATIVE',
  };
}

/**
 * Helper to commit Firestore operations in bounded batches (<= 200 operations per batch)
 */
async function commitBoundedFirestoreBatches(
  db: any,
  operations: Array<{ collection: string; docId: string; data: any; merge?: boolean }>,
  batchSize = 200
): Promise<{ batchesCommitted: number; documentsWritten: number }> {
  let batchesCommitted = 0;
  let documentsWritten = 0;

  for (let i = 0; i < operations.length; i += batchSize) {
    const slice = operations.slice(i, i + batchSize);
    const batch = db.batch();
    for (const op of slice) {
      const ref = db.collection(op.collection).doc(op.docId);
      batch.set(ref, cleanServerData(op.data), { merge: op.merge !== false });
    }
    await batch.commit();
    batchesCommitted++;
    documentsWritten += slice.length;
  }

  return { batchesCommitted, documentsWritten };
}

/**
 * Computes candidate matches in memory for diagnostic preview (does NOT persist to Firestore
 * and does NOT populate memPersistedMatches).
 */
export async function recomputeCatalogMatches(): Promise<{
  totalMatches: number;
  verifiedCount: number;
  likelyCount: number;
  reviewCount: number;
}> {
  const production = Boolean(process.env.K_SERVICE) || process.env.NODE_ENV === 'production';
  let catalogList: RetailProduct[] = [];
  try {
    const authCat = await loadAuthoritativeCatalogProducts({ allowClientReadFallbackInPreview: !production });
    catalogList = authCat.products;
  } catch (error) {
    if (production) {
      catalogCandidateStatus = 'UNAVAILABLE';
      memComputedCandidates.clear();
      throw error;
    }
    if (getMemCatalog().size === 0) {
      try {
        await seedPilotCatalog();
      } catch {
        // Ignore seed notice in preview
      }
    }
    catalogList = Array.from(getMemCatalog().values());
  }

  catalogCandidateStatus = 'AVAILABLE';
  const advisoryList = Array.from(memAdvisories.values());
  if (catalogList.length === 0 || advisoryList.length === 0) {
    const cands = Array.from(memComputedCandidates.values());
    return {
      totalMatches: cands.length,
      verifiedCount: cands.filter((m) => m.confidence === 'VERIFIED').length,
      likelyCount: cands.filter((m) => m.confidence === 'LIKELY').length,
      reviewCount: cands.filter((m) => m.confidence === 'AMBIGUOUS_REVIEW' || m.confidence === 'LIKELY').length,
    };
  }

  const result = matchAdvisoriesToCatalog(advisoryList, catalogList);
  memComputedCandidates.clear();
  for (const m of result.matches) {
    memComputedCandidates.set(m.id, m);
  }

  console.log(
    `[ServiceIntelligence] Computed candidate matches in memory (Not Persisted): ${result.matches.length} total (${result.verifiedCount} VERIFIED, ${result.likelyCount} LIKELY, ${result.ambiguousReviewCount} AMBIGUOUS_REVIEW).`
  );

  return {
    totalMatches: result.matches.length,
    verifiedCount: result.verifiedCount,
    likelyCount: result.likelyCount,
    reviewCount: result.reviewCount,
  };
}

/**
 * Authoritative Service Product Match Reconciliation & Persistence Engine (Objectives 2, 3, 4, 5)
 * 
 * - Reads persisted advisories from Firestore (`serviceAdvisories`) without triggering external syncs.
 * - Reads canonical products from authoritative Firestore (`retailProducts`) without pilot-only fallback.
 * - Reads existing persisted matches from Firestore (`serviceProductMatches`) and preserves admin decisions.
 * - In DRY_RUN mode (default): computes reconciliation plan with zero Firestore writes.
 * - In PERSIST mode (requires confirmPersistence === true): writes in bounded batches and verifies persisted counts.
 */
export async function recomputeServiceProductMatches(options?: {
  mode?: 'DRY_RUN' | 'PERSIST';
  confirmPersistence?: boolean;
  customDb?: any;
  reviewedBy?: string;
  expectedSnapshotHash?: string;
  requirePriorDryRun?: boolean;
  candidatesOverrideForTest?: ServiceProductMatch[];
}): Promise<MatchRecomputeSummary> {
  await initializeServiceIntelligence();

  if (isRecomputeRunning) {
    throw new Error('Product match recomputation is already in progress. Concurrency locked.');
  }

  isRecomputeRunning = true;
  const timestamp = new Date().toISOString();
  const shouldPersist = options?.confirmPersistence === true && options?.mode === 'PERSIST';
  lastMatchRecomputationAt = timestamp;

  try {
    const db = options?.customDb || getServerDb();

    // 1. Load persisted advisories from authoritative Firestore (with read-only preview fallback ONLY for non-customDb DRY_RUN)
    let advisories: ServiceAdvisory[] = [];
    try {
      const advSnap = await db.collection('serviceAdvisories').get();
      const docs = advSnap?.docs || [];
      for (const d of docs) {
        if (String(d.id || '').startsWith('_diag_probe_')) continue;
        const data = typeof d.data === 'function' ? d.data() : d.data;
        if (data && (data.id || d.id)) {
          advisories.push({ ...data, id: data.id || d.id } as ServiceAdvisory);
        }
      }
    if (!options?.customDb && advisories.length > 0) {
      memAdvisories.clear();
      for (const adv of advisories) {
        memAdvisories.set(adv.id, adv);
      }
      lastAuthoritativeRefreshAt = Date.now();
    }
    } catch (advErr: any) {
      if (!options?.customDb && !shouldPersist && memAdvisories.size > 0) {
        advisories = Array.from(memAdvisories.values());
      } else {
        const msg = advErr instanceof Error ? advErr.message : String(advErr);
        throw new Error(`Failed to read persisted advisories from Firestore serviceAdvisories: ${msg}`);
      }
    }

    // 2. Load canonical products from authoritative Firestore (no pilot-only fallback)
    const catalogLoad = await loadAuthoritativeCatalogProducts({
      customDb: options?.customDb,
      allowClientReadFallbackInPreview: !options?.customDb && !shouldPersist,
    });
    const catalogProducts = catalogLoad.products;

    // 3. Load existing persisted matches from Firestore to preserve admin review decisions and ensure idempotency
    const existingMatchesMap = new Map<string, ServiceProductMatch>();
    try {
      const matchSnap = await db.collection('serviceProductMatches').get();
      const docs = matchSnap?.docs || [];
      for (const d of docs) {
        if (String(d.id || '').startsWith('_diag_probe_')) continue;
        const data = typeof d.data === 'function' ? d.data() : d.data;
        if (data && (data.id || d.id)) {
          existingMatchesMap.set(data.id || d.id, { ...data, id: data.id || d.id } as ServiceProductMatch);
        }
      }
    } catch (matchReadErr: any) {
      if (options?.customDb || shouldPersist) {
        const msg = matchReadErr instanceof Error ? matchReadErr.message : String(matchReadErr);
        throw new Error(`Failed to read existing serviceProductMatches from Firestore: ${msg}`);
      }
    }

    // 4. Generate candidate matches with S1.2.3 evidence & quality gate safeguards
    const matchResult = matchAdvisoriesToCatalog(advisories, catalogProducts);
    const candidateMatches = options?.candidatesOverrideForTest
      ? options.candidatesOverrideForTest
      : matchResult.matches;

    const verifiedCandidatesCount = candidateMatches.filter((m) => m.confidence === 'VERIFIED').length;
    const likelyCandidatesCount = candidateMatches.filter((m) => m.confidence === 'LIKELY').length;
    const ambiguousCandidatesCount = candidateMatches.filter((m) => m.confidence === 'AMBIGUOUS_REVIEW').length;
    const reviewCandidatesCount = likelyCandidatesCount + ambiguousCandidatesCount;

    // Update in-memory candidate cache for diagnostic display
    if (!options?.candidatesOverrideForTest) {
      memComputedCandidates.clear();
      for (const m of candidateMatches) {
        memComputedCandidates.set(m.id, m);
      }
    }

    // 4b. Compute S1.2.3 Quality Gate & Evidence Breakdown Metrics
    const dryRunSnapshotHash = computeDatasetSnapshotHash(advisories, catalogProducts);

    let verifiedWithDirectEvidence = 0;
    let verifiedWithStructuredApplicability = 0;
    let verifiedMissingRequiredEvidence = 0;
    let candidatesMissingEvidenceCount = 0;
    let potentialIdentityCollisions = 0;

    const relationshipBreakdown: Record<MatchRelationshipType, number> = {
      OFFICIAL_UPDATE_ELIGIBILITY: 0,
      SECURITY_BULLETIN_APPLICABILITY: 0,
      CONFIRMED_VULNERABILITY_APPLICABILITY: 0,
      CONFIRMED_VULNERABILITY: 0,
      GENERAL_SECURITY_INFORMATION: 0,
      GENERAL_MAINTENANCE_INFORMATION: 0,
    };

    const evidenceStrengthBreakdown: Record<MatchEvidenceStrength, number> = {
      DIRECT_OFFICIAL_EVIDENCE: 0,
      STRUCTURED_MANUFACTURER_APPLICABILITY: 0,
      INFERRED_FAMILY_APPLICABILITY: 0,
      HEURISTIC_SIMILARITY: 0,
    };

    const authenticityBreakdown: Record<MatchAuthenticityClassification, number> = {
      OFFICIAL_CONFIRMED: 0,
      OFFICIAL_FAMILY_CONFIRMED: 0,
      INFERRED_NEEDS_REVIEW: 0,
      SOURCE_UNVERIFIABLE: 0,
      SOURCE_CONTRADICTED: 0,
      NOT_APPLICABLE: matchResult.rejectedCount,
    };

    for (const m of candidateMatches) {
      const rel = m.relationshipType || 'SECURITY_BULLETIN_APPLICABILITY';
      relationshipBreakdown[rel] = (relationshipBreakdown[rel] || 0) + 1;

      const str = m.evidenceStrength || 'STRUCTURED_MANUFACTURER_APPLICABILITY';
      evidenceStrengthBreakdown[str] = (evidenceStrengthBreakdown[str] || 0) + 1;

      const authClass = m.authenticityClassification || 'INFERRED_NEEDS_REVIEW';
      authenticityBreakdown[authClass] = (authenticityBreakdown[authClass] || 0) + 1;

      const hasMissing = Boolean(m.missingEvidence && m.missingEvidence.length > 0);
      const hasConflicts = Boolean(m.potentialConflicts && m.potentialConflicts.length > 0);
      if (hasMissing) candidatesMissingEvidenceCount++;
      if (hasConflicts) potentialIdentityCollisions++;

      if (m.confidence === 'VERIFIED') {
        if (str === 'DIRECT_OFFICIAL_EVIDENCE' && !hasMissing && !hasConflicts) {
          verifiedWithDirectEvidence++;
        } else if (str === 'STRUCTURED_MANUFACTURER_APPLICABILITY' && !hasMissing && !hasConflicts) {
          verifiedWithStructuredApplicability++;
        } else {
          verifiedMissingRequiredEvidence++;
        }
      }
    }

    const qualityGateBlockingReasons: string[] = [];
    const qualityGateWarnings: string[] = [];

    if (advisories.length === 0 || catalogProducts.length === 0) {
      qualityGateBlockingReasons.push(
        `Insufficient dataset loaded (${advisories.length} advisories, ${catalogProducts.length} canonical products).`,
      );
    }
    if (verifiedMissingRequiredEvidence > 0) {
      qualityGateBlockingReasons.push(
        `Quality gate detected ${verifiedMissingRequiredEvidence} VERIFIED candidate(s) with missing required evidence or inferred/heuristic applicability.`,
      );
    }
    if (candidatesMissingEvidenceCount > 0) {
      qualityGateWarnings.push(
        `${candidatesMissingEvidenceCount} candidate(s) have incomplete or inferred evidence and are held in LIKELY / AMBIGUOUS_REVIEW (${reviewCandidatesCount} total pending review).`,
      );
    }

    const qualityGatePassed = qualityGateBlockingReasons.length === 0;
    let qualityGateStatus: QualityGateReadinessStatus = 'READY_FOR_ADMIN_REVIEW';
    if (!qualityGatePassed) {
      qualityGateStatus =
        advisories.length === 0 || catalogProducts.length === 0
          ? 'INSUFFICIENT_EVIDENCE'
          : 'QUALITY_GATE_FAILED';
    } else if (!options?.customDb && globalPersistenceMode !== 'FIRESTORE_AUTHORITATIVE') {
      qualityGateStatus = 'PRODUCTION_NOT_VERIFIED';
    }

    // 5. Compute reconciliation plan (Creates, Updates, Unchanged, Preserved Admin Decisions, Conflicts)
    let plannedCreates = 0;
    let plannedUpdates = 0;
    let plannedUnchanged = 0;
    let preservedAdminDecisions = 0;
    let potentialConflicts = potentialIdentityCollisions;
    let adminConfirmedCount = 0;
    const toWrite: ServiceProductMatch[] = [];

    for (const candidate of candidateMatches) {
      const existing = existingMatchesMap.get(candidate.id);
      if (!existing) {
        plannedCreates++;
        toWrite.push(candidate);
        continue;
      }

      if (existing.status === 'CONFIRMED' && existing.reviewedBy) {
        adminConfirmedCount++;
      }

      const hasAdminDecision =
        Boolean(existing.reviewedBy) ||
        Boolean(existing.reviewedAt) ||
        existing.status === 'DISMISSED' ||
        (existing.status === 'CONFIRMED' && existing.confidence !== 'VERIFIED');

      if (hasAdminDecision) {
        preservedAdminDecisions++;
        plannedUnchanged++;
        if (
          (existing.status === 'DISMISSED' && candidate.confidence === 'VERIFIED') ||
          (existing.status === 'CONFIRMED' && candidate.confidence !== existing.confidence)
        ) {
          potentialConflicts++;
        }
        continue;
      }

      const sameConfidence = existing.confidence === candidate.confidence;
      const sameStatus = existing.status === candidate.status;
      const sameVersion = existing.matcherVersion === candidate.matcherVersion;
      const sameEvidence =
        JSON.stringify(existing.evidence || []) === JSON.stringify(candidate.evidence || []);

      if (sameConfidence && sameStatus && sameVersion && sameEvidence) {
        plannedUnchanged++;
      } else {
        plannedUpdates++;
        toWrite.push({
          ...candidate,
          matchedAt: existing.matchedAt || existing.createdAt || timestamp,
          createdAt: existing.createdAt || existing.matchedAt || timestamp,
          updatedAt: timestamp,
        });
      }
    }

    const matcherVerifiedPendingAdminCount = Math.max(0, verifiedCandidatesCount - adminConfirmedCount);

    // 6. If DRY_RUN, record snapshot hash and return full summary without modifying Firestore
    if (!shouldPersist) {
      lastDryRunSnapshotHash = dryRunSnapshotHash;
      if (db && typeof db === 'object') {
        (db as any)._lastDryRunSnapshotHash = dryRunSnapshotHash;
      }

      let existingVerified = 0;
      let existingPending = 0;
      let existingDismissed = 0;
      existingMatchesMap.forEach((m) => {
        if (m.status === 'DISMISSED') existingDismissed++;
        else if (m.status === 'CONFIRMED' || m.confidence === 'VERIFIED') existingVerified++;
        else existingPending++;
      });

      const drySummary: MatchRecomputeSummary = {
        mode: 'DRY_RUN',
        status: qualityGatePassed ? 'DRY_RUN_READY' : 'QUALITY_GATE_BLOCKED',
        timestamp,
        matcherVersion: SERVICE_MATCHER_VERSION,
        catalogSource: catalogLoad.source,
        advisoriesExamined: advisories.length,
        canonicalProductsExamined: catalogProducts.length,
        candidateMatchesGenerated: candidateMatches.length,
        verifiedCandidates: verifiedCandidatesCount,
        likelyCandidates: likelyCandidatesCount,
        ambiguousReviewCandidates: ambiguousCandidatesCount,
        rejectedCandidates: matchResult.rejectedCount,
        unmatchedCount: matchResult.rejectedCount,
        verifiedWithDirectEvidence,
        verifiedWithStructuredApplicability,
        verifiedMissingRequiredEvidence,
        candidatesMissingEvidenceCount,
        potentialIdentityCollisions,
        adminConfirmedCount,
        matcherVerifiedPendingAdminCount,
        relationshipBreakdown,
        evidenceStrengthBreakdown,
        authenticityBreakdown,
        downgradedFromLegacyVerified: matchResult.downgradedFromLegacyVerified,
        downgradeReasons: matchResult.downgradeReasons,
        existingPersistedMatches: existingMatchesMap.size,
        plannedCreates,
        plannedUpdates,
        plannedUnchanged,
        preservedAdminDecisions,
        potentialConflicts,
        persistenceExecuted: false,
        persistedTotalCount: existingMatchesMap.size,
        persistedVerifiedCount: existingVerified,
        persistedPendingReviewCount: existingPending,
        persistedDismissedCount: existingDismissed,
        batchesCommitted: 0,
        writeErrors: [],
        qualityGateStatus,
        qualityGatePassed,
        qualityGateBlockingReasons,
        qualityGateWarnings,
        dryRunSnapshotHash,
        totalMatches: candidateMatches.length,
        verifiedCount: verifiedCandidatesCount,
        likelyCount: likelyCandidatesCount,
        reviewCount: reviewCandidatesCount,
      };

      const snapshotObj: ActiveDryRunSnapshot = {
        snapshotHash: dryRunSnapshotHash,
        createdAt: timestamp,
        expiresAt: new Date(Date.now() + DRY_RUN_SNAPSHOT_TTL_MS).toISOString(),
        advisories: [...advisories],
        catalogProducts: [...catalogProducts],
        candidates: [...candidateMatches],
        rejectedSample: [...(matchResult.rejectedSample || [])],
        summary: drySummary,
      };
      if (!options?.customDb) {
        lastDryRunSnapshot = snapshotObj;
      }
      if (db && typeof db === 'object') {
        (db as any)._lastDryRunSnapshot = snapshotObj;
      }

      lastMatchPersistenceStatus = 'DRY_RUN_ONLY';
      lastMatchError = undefined;
      lastMatchSummary = drySummary;
      return drySummary;
    }

    // 6b. S1.2.3 & S1.2.5.1 Objective 5/6: Enforce Snapshot Hash, Snapshot Expiration & Quality Gate before bulk PERSIST
    const recordedHash = (db as any)?._lastDryRunSnapshotHash || lastDryRunSnapshotHash;
    const activeSnap = (db as any)?._lastDryRunSnapshot || lastDryRunSnapshot;

    if (options?.expectedSnapshotHash && options.expectedSnapshotHash !== dryRunSnapshotHash) {
      const staleMsg = `STALE_DRY_RUN_SNAPSHOT: Reviewed dry-run snapshot (${options.expectedSnapshotHash}) does not match current dataset snapshot (${dryRunSnapshotHash}). Please re-run Dry Run before persisting.`;
      lastMatchPersistenceStatus = 'FAILED';
      lastMatchError = staleMsg;
      throw new Error(staleMsg);
    }
    if (options?.requirePriorDryRun && (!recordedHash || recordedHash !== dryRunSnapshotHash)) {
      const staleMsg = `STALE_DRY_RUN_SNAPSHOT: No matching Dry Run snapshot found for current dataset (${dryRunSnapshotHash}). Please run Dry Run first.`;
      lastMatchPersistenceStatus = 'FAILED';
      lastMatchError = staleMsg;
      throw new Error(staleMsg);
    }
    if (
      activeSnap &&
      activeSnap.snapshotHash === dryRunSnapshotHash &&
      new Date(activeSnap.expiresAt).getTime() < Date.now()
    ) {
      const expiredMsg = `EXPIRED_DRY_RUN_SNAPSHOT: Reviewed dry-run snapshot (${activeSnap.snapshotHash}) expired at ${activeSnap.expiresAt}. Please re-run Dry Run before persisting.`;
      lastMatchPersistenceStatus = 'FAILED';
      lastMatchError = expiredMsg;
      throw new Error(expiredMsg);
    }
    if (!qualityGatePassed) {
      const gateMsg = `QUALITY_GATE_BLOCKED: Bulk persistence blocked because ${qualityGateBlockingReasons.join(' ')}`;
      lastMatchPersistenceStatus = 'FAILED';
      lastMatchError = gateMsg;
      throw new Error(gateMsg);
    }

    // 7. PERSIST Mode: Execute bounded Firestore batches (<= 200 docs per batch)
    const writeErrors: string[] = [];
    let batchesCommitted = 0;

    try {
      const ops = toWrite.map((m) => ({
        collection: 'serviceProductMatches',
        docId: m.id,
        data: m,
        merge: true,
      }));
      const batchResult = await commitBoundedFirestoreBatches(db, ops, 200);
      batchesCommitted = batchResult.batchesCommitted;
    } catch (batchErr: any) {
      const errMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      writeErrors.push(errMsg);
      lastMatchPersistenceStatus = 'FAILED';
      lastMatchError = `Firestore batch commit failed after ${batchesCommitted} batch(es): ${errMsg}`;

      const failedSummary: MatchRecomputeSummary = {
        mode: 'PERSIST',
        status: 'PERSISTENCE_FAILED',
        timestamp,
        matcherVersion: SERVICE_MATCHER_VERSION,
        catalogSource: catalogLoad.source,
        advisoriesExamined: advisories.length,
        canonicalProductsExamined: catalogProducts.length,
        candidateMatchesGenerated: candidateMatches.length,
        verifiedCandidates: verifiedCandidatesCount,
        likelyCandidates: likelyCandidatesCount,
        ambiguousReviewCandidates: ambiguousCandidatesCount,
        rejectedCandidates: matchResult.rejectedCount,
        unmatchedCount: matchResult.rejectedCount,
        verifiedWithDirectEvidence,
        verifiedWithStructuredApplicability,
        verifiedMissingRequiredEvidence,
        candidatesMissingEvidenceCount,
        potentialIdentityCollisions,
        adminConfirmedCount,
        matcherVerifiedPendingAdminCount,
        relationshipBreakdown,
        evidenceStrengthBreakdown,
        authenticityBreakdown,
        downgradedFromLegacyVerified: matchResult.downgradedFromLegacyVerified,
        downgradeReasons: matchResult.downgradeReasons,
        existingPersistedMatches: existingMatchesMap.size,
        plannedCreates,
        plannedUpdates,
        plannedUnchanged,
        preservedAdminDecisions,
        potentialConflicts,
        persistenceExecuted: false,
        persistedTotalCount: 'UNAVAILABLE',
        persistedVerifiedCount: 'UNAVAILABLE',
        persistedPendingReviewCount: 'UNAVAILABLE',
        persistedDismissedCount: 'UNAVAILABLE',
        batchesCommitted,
        writeErrors,
        qualityGateStatus,
        qualityGatePassed,
        qualityGateBlockingReasons,
        qualityGateWarnings,
        dryRunSnapshotHash,
        totalMatches: candidateMatches.length,
        verifiedCount: verifiedCandidatesCount,
        likelyCount: likelyCandidatesCount,
        reviewCount: reviewCandidatesCount,
      };
      lastMatchSummary = failedSummary;
      throw new Error(lastMatchError);
    }

    // 8. Post-Write Read-Back Verification from Firestore
    const verifySnap = await db.collection('serviceProductMatches').get();
    const verifiedDocs = (verifySnap?.docs || []).filter(
      (d: any) => !String(d.id || '').startsWith('_diag_probe_')
    );

    if (!options?.customDb) {
      memPersistedMatches.clear();
    }
    let persistedVerifiedCount = 0;
    let persistedPendingReviewCount = 0;
    let persistedDismissedCount = 0;

    for (const d of verifiedDocs) {
      const m = (typeof d.data === 'function' ? d.data() : d.data) as ServiceProductMatch;
      if (!m) continue;
      const hydrated = { ...m, id: m.id || d.id };
      if (!options?.customDb) {
        memPersistedMatches.set(hydrated.id, hydrated);
      }
      if (hydrated.status === 'DISMISSED') {
        persistedDismissedCount++;
      } else if (hydrated.status === 'CONFIRMED') {
        persistedVerifiedCount++;
      } else if (hydrated.status === 'PENDING_REVIEW') {
        persistedPendingReviewCount++;
      }
    }

    const expectedMinCount = existingMatchesMap.size + plannedCreates;
    if (verifiedDocs.length < expectedMinCount) {
      const mismatchMsg = `Post-write verification mismatch: expected at least ${expectedMinCount} persisted matches, found ${verifiedDocs.length}.`;
      writeErrors.push(mismatchMsg);
      lastMatchPersistenceStatus = 'FAILED';
      lastMatchError = mismatchMsg;
      throw new Error(mismatchMsg);
    }

    const persistedSummary: MatchRecomputeSummary = {
      mode: 'PERSIST',
      status: 'PERSISTED_VERIFIED',
      timestamp,
      matcherVersion: SERVICE_MATCHER_VERSION,
      catalogSource: catalogLoad.source,
      advisoriesExamined: advisories.length,
      canonicalProductsExamined: catalogProducts.length,
      candidateMatchesGenerated: candidateMatches.length,
      verifiedCandidates: verifiedCandidatesCount,
      likelyCandidates: likelyCandidatesCount,
      ambiguousReviewCandidates: ambiguousCandidatesCount,
      rejectedCandidates: matchResult.rejectedCount,
      unmatchedCount: matchResult.rejectedCount,
      verifiedWithDirectEvidence,
      verifiedWithStructuredApplicability,
      verifiedMissingRequiredEvidence,
      candidatesMissingEvidenceCount,
      potentialIdentityCollisions,
      adminConfirmedCount,
      matcherVerifiedPendingAdminCount: 0,
      relationshipBreakdown,
      evidenceStrengthBreakdown,
      authenticityBreakdown,
      downgradedFromLegacyVerified: matchResult.downgradedFromLegacyVerified,
      downgradeReasons: matchResult.downgradeReasons,
      existingPersistedMatches: existingMatchesMap.size,
      plannedCreates,
      plannedUpdates,
      plannedUnchanged,
      preservedAdminDecisions,
      potentialConflicts,
      persistenceExecuted: true,
      persistedTotalCount: verifiedDocs.length,
      persistedVerifiedCount,
      persistedPendingReviewCount,
      persistedDismissedCount,
      batchesCommitted,
      writeErrors: [],
      qualityGateStatus,
      qualityGatePassed,
      qualityGateBlockingReasons,
      qualityGateWarnings,
      dryRunSnapshotHash,
      totalMatches: verifiedDocs.length,
      verifiedCount: persistedVerifiedCount,
      likelyCount: likelyCandidatesCount,
      reviewCount: persistedPendingReviewCount,
    };

    lastMatchPersistenceStatus = 'PERSISTED_VERIFIED';
    lastMatchError = undefined;
    lastMatchSummary = persistedSummary;
    return persistedSummary;
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    lastMatchPersistenceStatus = 'FAILED';
    lastMatchError = msg;
    throw err;
  } finally {
    isRecomputeRunning = false;
  }
}

/**
 * S1.2.3, S1.2.4, S1.2.5 & S1.2.5.1: Read-Only Match Evidence Review, Stratified Quality Audit &
 * Official Source Authenticity Audit Service.
 *
 * S1.2.5.1 Objective 2 Guarantees:
 * - Reuses the immutable `ActiveDryRunSnapshot` generated by `recomputeServiceProductMatches` so
 *   that `review.candidates` (`686` total: `278` VERIFIED, `198` LIKELY, `210` AMBIGUOUS_REVIEW)
 *   and `review.summary` come from the exact same dataset snapshot and never diverge.
 * - Isolates `runOfficialSourceAuthenticityAudit` and `runOfficialAdapterAndIntegrityAudit` inside
 *   independent `try/catch` blocks so any error in an auxiliary audit section is surfaced in
 *   `auditSectionErrors` without ever wiping out `review.candidates` or failing the inspector.
 */
export async function getMatchEvidenceReview(options?: {
  customDb?: any;
  performLiveProbes?: boolean;
  customFetch?: typeof fetch;
  reuseSnapshotIfValid?: boolean;
  forceAuditFailureForTest?: boolean;
}): Promise<MatchEvidenceReviewResponse> {
  await initializeServiceIntelligence();

  let activeSnap = getActiveDryRunSnapshot(options?.customDb);
  const nowMs = Date.now();
  const isSnapReusable =
    options?.reuseSnapshotIfValid === true &&
    activeSnap &&
    new Date(activeSnap.expiresAt).getTime() > nowMs &&
    activeSnap.candidates.length === activeSnap.summary.candidateMatchesGenerated;

  let summary: MatchRecomputeSummary;
  if (isSnapReusable && activeSnap) {
    summary = activeSnap.summary;
  } else {
    if (isRecomputeRunning && inFlightDryRunPromise && !options?.customDb) {
      summary = await inFlightDryRunPromise;
    } else {
      const p = recomputeServiceProductMatches({
        mode: 'DRY_RUN',
        confirmPersistence: false,
        customDb: options?.customDb,
      });
      if (!options?.customDb) {
        inFlightDryRunPromise = p;
      }
      try {
        summary = await p;
      } finally {
        if (!options?.customDb) {
          inFlightDryRunPromise = undefined;
        }
      }
    }
    activeSnap = getActiveDryRunSnapshot(options?.customDb);
  }

  // Fallback if activeSnap wasn't populated (should never happen, but defensive)
  const advisories = activeSnap ? activeSnap.advisories : Array.from(memAdvisories.values());
  let catalogProducts = activeSnap ? activeSnap.catalogProducts : [];
  if (catalogProducts.length === 0) {
    try {
      const catLoad = await loadAuthoritativeCatalogProducts({
        customDb: options?.customDb,
        allowClientReadFallbackInPreview: !options?.customDb,
      });
      catalogProducts = catLoad.products;
    } catch {
      catalogProducts = [];
    }
  }

  const candidates = activeSnap
    ? activeSnap.candidates
    : matchAdvisoriesToCatalog(advisories, catalogProducts).matches;
  const rejectedSample = activeSnap
    ? activeSnap.rejectedSample
    : matchAdvisoriesToCatalog(advisories, catalogProducts).rejectedSample;

  const auditItems = buildStratifiedQualityAuditSample(candidates, catalogProducts);
  const passCount = auditItems.filter((i) => i.auditVerdict === 'PASS').length;
  const failCount = auditItems.filter((i) => i.auditVerdict === 'FAIL').length;
  const needsReviewCount = auditItems.filter((i) => i.auditVerdict === 'NEEDS_REVIEW').length;

  const auditSectionErrors: Array<{ subsystem: string; error: string }> = [];
  let sourceAuthenticityAudit: SourceAuthenticityAuditSummary | undefined;
  let s125IntegrityAudit: OfficialAdapterAndIntegrityAuditReport | undefined;

  try {
    if (options?.forceAuditFailureForTest) {
      throw new Error('Simulated auxiliary audit failure for fault isolation test');
    }
    sourceAuthenticityAudit = await runOfficialSourceAuthenticityAudit({
      advisories,
      catalogProducts,
      matches: candidates,
      performLiveProbes: Boolean(options?.performLiveProbes),
      customFetch: options?.customFetch,
    });
  } catch (authAuditErr: any) {
    const msg = authAuditErr instanceof Error ? authAuditErr.message : String(authAuditErr);
    auditSectionErrors.push({
      subsystem: 'sourceAuthenticityAudit',
      error: msg,
    });
  }

  try {
    if (options?.forceAuditFailureForTest) {
      throw new Error('Simulated S1.2.5 integrity audit failure for fault isolation test');
    }
    s125IntegrityAudit = await runOfficialAdapterAndIntegrityAudit({
      advisories,
      catalogProducts,
      matches: candidates,
      existingAudit: sourceAuthenticityAudit,
    });
    summary.s125QualityGateOverallStatus = s125IntegrityAudit.qualityGate12Check.overallStatus;
  } catch (s125Err: any) {
    const msg = s125Err instanceof Error ? s125Err.message : String(s125Err);
    auditSectionErrors.push({
      subsystem: 's125IntegrityAudit',
      error: msg,
    });
  }

  const snapshotCreatedAt = activeSnap?.createdAt || summary.timestamp;
  const snapshotExpiresAt =
    activeSnap?.expiresAt || new Date(Date.now() + DRY_RUN_SNAPSHOT_TTL_MS).toISOString();
  const isSnapshotExpired = new Date(snapshotExpiresAt).getTime() < Date.now();

  const verifiedCountInSnapshot = candidates.filter((c) => c.confidence === 'VERIFIED').length;
  const likelyCountInSnapshot = candidates.filter((c) => c.confidence === 'LIKELY').length;
  const ambiguousCountInSnapshot = candidates.filter(
    (c) => c.confidence === 'AMBIGUOUS_REVIEW',
  ).length;

  return {
    matcherVersion: SERVICE_MATCHER_VERSION,
    evaluatedAt: summary.timestamp,
    dryRunSnapshotHash: summary.dryRunSnapshotHash || '',
    snapshotId: summary.dryRunSnapshotHash || '',
    snapshotCreatedAt,
    snapshotExpiresAt,
    isSnapshotExpired,
    totalCandidatesInSnapshot: candidates.length,
    verifiedCountInSnapshot,
    likelyCountInSnapshot,
    ambiguousCountInSnapshot,
    auditSectionErrors: auditSectionErrors.length > 0 ? auditSectionErrors : undefined,
    qualityGateStatus: summary.qualityGateStatus || 'READY_FOR_ADMIN_REVIEW',
    qualityGatePassed: summary.qualityGatePassed ?? true,
    qualityGateBlockingReasons: summary.qualityGateBlockingReasons || [],
    qualityGateWarnings: [
      ...(summary.qualityGateWarnings || []),
      ...(s125IntegrityAudit?.qualityGate12Check.reviewWarnings || []),
    ],
    summary,
    candidates,
    rejectedSample,
    stratifiedAudit: {
      samplingMethodology:
        'Deterministic 15-stratum sampling across Apple (iPhone, iPad, Mac, Watch, Safari, Zero-CVE), Samsung (Galaxy S, Z Fold/Flip, A/Tab), Huawei (Pura, MatePad 11.5 vs 11.5S, Monthly EMUI), and CISA KEV.',
      totalSampled: auditItems.length,
      passCount,
      failCount,
      needsReviewCount,
      items: auditItems,
    },
    ruleRegistry: MATCHER_RULE_REGISTRY,
    sourceAuthenticityAudit,
    s125IntegrityAudit,
  };
}

/**
 * S1.2.4 Objective 1–4: Admin-only read-only Official Source Authenticity & Product Applicability Audit endpoint helper.
 */
export async function getOfficialSourceAuthenticityAudit(options?: {
  performLiveProbes?: boolean;
  customDb?: any;
  customFetch?: typeof fetch;
}): Promise<SourceAuthenticityAuditSummary> {
  const review = await getMatchEvidenceReview({
    customDb: options?.customDb,
    performLiveProbes: options?.performLiveProbes,
    customFetch: options?.customFetch,
  });
  return review.sourceAuthenticityAudit!;
}

/**
 * S1.2.5 Objective H/I/J: Admin-only read-only Official Source Adapter & Data Integrity Audit endpoint helper.
 */
export async function getOfficialAdapterAndIntegrityAudit(options?: {
  customDb?: any;
}): Promise<OfficialAdapterAndIntegrityAuditReport> {
  const review = await getMatchEvidenceReview({
    customDb: options?.customDb,
    performLiveProbes: false,
  });
  return review.s125IntegrityAudit!;
}

/**
 * S1.2.5.1 Objective 4: Admin-only read-only Source Synchronization Schema Audit endpoint helper.
 */
export async function getSourceSyncSchemaAudit(options?: {
  customDb?: any;
}): Promise<SourceSyncSchemaAuditSummary> {
  await initializeServiceIntelligence();
  await refreshAuthoritativeStateFromFirestore({ customDb: options?.customDb, force: true });
  let advisories = Array.from(memAdvisories.values());
  let vulnsCount = memVulnerabilities.size;
  if (options?.customDb) {
    try {
      const [advSnap, vulnSnap] = await Promise.all([
        options.customDb.collection('serviceAdvisories').get(),
        options.customDb.collection('serviceVulnerabilities').get(),
      ]);
      if (Array.isArray(advSnap?.docs)) {
        advisories = advSnap.docs
          .filter((d: any) => !String(d.id || '').startsWith('_diag_probe_'))
          .map((d: any) => (typeof d.data === 'function' ? d.data() : d.data));
      }
      if (Array.isArray(vulnSnap?.docs)) {
        vulnsCount = vulnSnap.docs.filter(
          (d: any) => !String(d.id || '').startsWith('_diag_probe_'),
        ).length;
      }
    } catch {
      // Fallback to in-memory
    }
  }
  return buildSourceSyncSchemaAudit(advisories, vulnsCount);
}

/**
 * Initializes Service Intelligence state and hydrates persisted records from Firestore
 */
export async function initializeServiceIntelligence(): Promise<void> {
  if (isInitialized) return;

  // 1. Populate registered official sources
  for (const src of getOfficialServiceSources()) {
    memSources.set(src.id, {
      ...src,
      persistenceStatus: globalPersistenceMode,
    });
  }

  // 2. Probe Firestore reachability and hydrate authoritative records
  try {
    const db = getServerDb();
    const [srcSnap, advSnap, vulnSnap, matchSnap] = await Promise.all([
      db.collection('serviceSources').get(),
      db.collection('serviceAdvisories').get(),
      db.collection('serviceVulnerabilities').get(),
      db.collection('serviceProductMatches').get(),
    ]);

    globalPersistenceMode = 'FIRESTORE_AUTHORITATIVE';
    lastFirestorePersistenceError = undefined;

    if (!srcSnap.empty) {
      srcSnap.docs.forEach((doc: any) => {
        if (String(doc.id || '').startsWith('_diag_probe_')) return;
        const data = doc.data() as ServiceSource;
        if (data?.id) memSources.set(data.id, data);
      });
    }

    if (!advSnap.empty) {
      advSnap.docs.forEach((doc: any) => {
        if (String(doc.id || '').startsWith('_diag_probe_')) return;
        const data = doc.data() as ServiceAdvisory;
        if (data?.id) memAdvisories.set(data.id, data);
      });
    }

    if (!vulnSnap.empty) {
      vulnSnap.docs.forEach((doc: any) => {
        if (String(doc.id || '').startsWith('_diag_probe_')) return;
        const data = doc.data() as ServiceVulnerability;
        if (data?.cveId) memVulnerabilities.set(data.cveId, data);
      });
    }

    memPersistedMatches.clear();
    if (!matchSnap.empty) {
      matchSnap.docs.forEach((doc: any) => {
        if (String(doc.id || '').startsWith('_diag_probe_')) return;
        const data = doc.data() as ServiceProductMatch;
        if (data?.id) memPersistedMatches.set(data.id, data);
      });
    }

    console.log(
      `[ServiceIntelligence] Hydrated from Firestore: ${memSources.size} sources, ${memAdvisories.size} advisories, ${memVulnerabilities.size} vulnerabilities, ${memPersistedMatches.size} persisted matches.`
    );
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    globalPersistenceMode = 'PREVIEW_IN_MEMORY_ONLY';
    lastFirestorePersistenceError = errorMsg;
    console.warn(
      `[ServiceIntelligence] Firestore hydration notice (operating in ${globalPersistenceMode}):`,
      errorMsg
    );
  }

  // 3. Compute in-memory candidate matches ONLY into memComputedCandidates (never into memPersistedMatches)
  if (memAdvisories.size > 0 && memComputedCandidates.size === 0) {
    try {
      await recomputeCatalogMatches();
    } catch (error) {
      console.warn('[ServiceIntelligence] Startup catalog matching unavailable:', error instanceof Error ? error.message : String(error));
    }
  }

  isInitialized = true;
}

/**
 * Executes an audited synchronization cycle for a specific source (Objective 7: Sync Run Status Integrity)
 * 
 * Completion Semantics:
 * - Source extraction + Advisory/Vulnerability persistence = COMPLETED when Firestore commit succeeds.
 * - Product matching is recorded as an independent stage (`DEFERRED_TO_RECOMPUTE`) so source sync completion
 *   is never misrepresented or truncated.
 * - Finalizes `syncRun.status`, `syncRun.completedAt`, `syncRun.durationMs`, and `syncRun.persistenceStorageMode`
 *   BEFORE committing the `serviceSyncRuns` document to Firestore.
 */
export async function syncServiceSource(
  sourceId: ServiceSourceId,
  triggeredBy: 'MANUAL_ADMIN' | 'SCHEDULED_JOB' = 'MANUAL_ADMIN',
  options?: { customDb?: any }
): Promise<ServiceSyncRun> {
  await initializeServiceIntelligence();

  if (activeSyncLocks.has(sourceId)) {
    throw new Error(`Synchronization already active for source: ${sourceId}. Concurrency locked.`);
  }

  activeSyncLocks.add(sourceId);
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const runId = `sync-${sourceId}-${Date.now()}`;
  const source = memSources.get(sourceId) || { ...OFFICIAL_SERVICE_SOURCES[sourceId] };

  const syncRun: ServiceSyncRun = {
    id: runId,
    sourceId,
    sourceName: source.name,
    status: 'STARTED',
    startedAt,
    advisoriesDiscovered: 0,
    advisoriesCreated: 0,
    advisoriesUpdated: 0,
    vulnerabilitiesDiscovered: 0,
    vulnerabilitiesCreated: 0,
    vulnerabilitiesUpdated: 0,
    productMatchesCreated: 0,
    matchingStageStatus: 'DEFERRED_TO_RECOMPUTE',
    stages: {
      sourceExtraction: 'FAILED',
      advisoryPersistence: 'SKIPPED',
      vulnerabilityPersistence: 'SKIPPED',
      productMatching: 'DEFERRED_TO_RECOMPUTE',
    },
    persistenceStorageMode: globalPersistenceMode,
    triggeredBy,
  };

  memSyncRuns.set(runId, syncRun);
  source.collectionStatus = 'SYNCING';
  source.lastAttemptedSync = startedAt;

  const pendingAdvisories: ServiceAdvisory[] = [];
  const pendingVulnerabilities: ServiceVulnerability[] = [];

  try {
    // -------------------------------------------------------------
    // Stage 1: Official Source Extraction
    // -------------------------------------------------------------
    if (sourceId === 'apple-security') {
      const result = await fetchAppleSecurityReleases({ maxReleases: 30, timeoutMs: 15000 });
      if (result.error && result.advisories.length === 0) {
        throw new Error(result.error);
      }
      syncRun.advisoriesDiscovered = result.discoveredCount;
      pendingAdvisories.push(...result.advisories);
    } else if (sourceId === 'huawei-security') {
      const result = await fetchHuaweiSecurityBulletins({ maxBulletins: 10, timeoutMs: 15000 });
      if (result.error && result.advisories.length === 0) {
        throw new Error(result.error);
      }
      syncRun.advisoriesDiscovered = result.discoveredCount;
      pendingAdvisories.push(...result.advisories);
    } else if (sourceId === 'samsung-security') {
      const result = await fetchSamsungSecurityBulletins({ maxBulletins: 10, timeoutMs: 15000 });
      if (result.error && result.advisories.length === 0) {
        throw new Error(result.error);
      }
      syncRun.advisoriesDiscovered = result.discoveredCount;
      pendingAdvisories.push(...result.advisories);
    } else if (sourceId === 'cisa-kev') {
      const result = await fetchCisaKevFeed({ maxRecords: 40, timeoutMs: 15000 });
      if (result.error && result.advisories.length === 0) {
        throw new Error(result.error);
      }
      syncRun.advisoriesDiscovered = result.advisories.length;
      syncRun.vulnerabilitiesDiscovered = result.vulnerabilities.length;
      source.totalCatalogCount = result.totalKevCatalogCount;
      source.filteredCatalogCount = result.filteredCount;
      pendingAdvisories.push(...result.advisories);
      pendingVulnerabilities.push(...result.vulnerabilities);
    } else if (sourceId === 'nvd-api') {
      const cvesToEnrich: string[] = [];
      memAdvisories.forEach((adv) => {
        adv.cveIds.forEach((c) => {
          const existing = memVulnerabilities.get(c);
          if (!existing || existing.cvssV3Score === undefined) cvesToEnrich.push(c);
        });
      });

      const targetCves = Array.from(new Set(cvesToEnrich)).slice(0, 6);
      if (targetCves.length > 0) {
        const result = await batchEnrichCvesWithNvd(targetCves, 6);
        syncRun.vulnerabilitiesDiscovered = result.discoveredCount;
        pendingVulnerabilities.push(...result.vulnerabilities);
      }
    }

    syncRun.stages!.sourceExtraction = 'SUCCESS';

    // -------------------------------------------------------------
    // Stage 2: Idempotent Merge & Delta Counting (Preserving Valid CVEs)
    // -------------------------------------------------------------
    const wasAuthoritativeBeforeSync = globalPersistenceMode === 'FIRESTORE_AUTHORITATIVE';
    const mergedAdvisoriesToCommit: ServiceAdvisory[] = [];
    let advisoriesUnchanged = 0;

    for (const adv of pendingAdvisories) {
      const existing = memAdvisories.get(adv.id);
      if (existing) {
        // S1.2.5.1 Objective 4: Never overwrite existing valid CVEs with an empty array if detail fetch timed out
        const preservedCveIds =
          (!adv.cveIds || adv.cveIds.length === 0) &&
          !adv.isZeroCveRelease &&
          Array.isArray(existing.cveIds) &&
          existing.cveIds.length > 0
            ? existing.cveIds
            : adv.cveIds;
        const mergedAdv: ServiceAdvisory = {
          ...existing,
          ...adv,
          cveIds: preservedCveIds,
        };
        const isIdentical =
          existing.title === mergedAdv.title &&
          existing.summary === mergedAdv.summary &&
          existing.advisoryType === mergedAdv.advisoryType &&
          existing.publishedAt === mergedAdv.publishedAt &&
          (existing.affectedProductsText || '') === (mergedAdv.affectedProductsText || '') &&
          JSON.stringify(existing.cveIds || []) === JSON.stringify(mergedAdv.cveIds || []);
        if (isIdentical) {
          advisoriesUnchanged++;
        } else {
          syncRun.advisoriesUpdated++;
        }
        mergedAdvisoriesToCommit.push(mergedAdv);
      } else {
        syncRun.advisoriesCreated++;
        mergedAdvisoriesToCommit.push(adv);
      }
    }
    syncRun.advisoriesUnchanged = advisoriesUnchanged;
    syncRun.advisoriesRejectedOrFailed = 0;

    let vulnCreated = 0;
    let vulnUpdated = 0;
    for (const vuln of pendingVulnerabilities) {
      if (memVulnerabilities.has(vuln.cveId)) {
        vulnUpdated++;
      } else {
        vulnCreated++;
      }
    }
    syncRun.vulnerabilitiesCreated = vulnCreated;
    syncRun.vulnerabilitiesUpdated = vulnUpdated;

    const completedTimestamp = new Date().toISOString();
    source.recordsDiscovered =
      sourceId === 'nvd-api' ? pendingVulnerabilities.length : mergedAdvisoriesToCommit.length;
    source.recordsCreated =
      sourceId === 'nvd-api' ? vulnCreated : syncRun.advisoriesCreated;
    source.recordsUpdated =
      sourceId === 'nvd-api' ? vulnUpdated : syncRun.advisoriesUpdated;
    source.recordsUnchanged = sourceId === 'nvd-api' ? 0 : advisoriesUnchanged;
    source.recordsRejectedOrFailed = 0;

    // -------------------------------------------------------------
    // Stage 3: Bounded Firestore Commit with Finalized SyncRun Status
    // -------------------------------------------------------------
    try {
      const db = options?.customDb || getServerDb();

      const ops: Array<{ collection: string; docId: string; data: any; merge?: boolean }> = [];
      for (const adv of mergedAdvisoriesToCommit) {
        ops.push({ collection: 'serviceAdvisories', docId: adv.id, data: adv, merge: true });
      }
      for (const vuln of pendingVulnerabilities) {
        ops.push({ collection: 'serviceVulnerabilities', docId: vuln.cveId, data: vuln, merge: true });
      }

      if (ops.length > 0) {
        await commitBoundedFirestoreBatches(db, ops, 200);
      }

      // Apply committed records to in-memory cache ONLY after Firestore commit succeeds
      for (const adv of mergedAdvisoriesToCommit) {
        memAdvisories.set(adv.id, adv);
      }
      for (const vuln of pendingVulnerabilities) {
        memVulnerabilities.set(vuln.cveId, vuln);
      }

      syncRun.stages!.advisoryPersistence =
        mergedAdvisoriesToCommit.length > 0 ? 'SUCCESS' : 'SKIPPED';
      syncRun.stages!.vulnerabilityPersistence =
        pendingVulnerabilities.length > 0 ? 'SUCCESS' : 'SKIPPED';

      // CRITICAL S1.2.2 & S1.2.5.1 FIX: Finalize source & syncRun status ONLY after Firestore commit succeeds
      globalPersistenceMode = 'FIRESTORE_AUTHORITATIVE';
      source.status = 'ACTIVE';
      source.collectionStatus = 'SUCCESS';
      source.lastSyncTerminalStatus = 'COMPLETED';
      source.lastSuccessfulSync = completedTimestamp;
      source.persistenceStatus = 'FIRESTORE_AUTHORITATIVE';
      source.persistedAdvisoriesCount = Array.from(memAdvisories.values()).filter(
        (a) => a.sourceId === sourceId,
      ).length;
      delete source.lastError;

      syncRun.persistenceStorageMode = 'FIRESTORE_AUTHORITATIVE';
      syncRun.status = 'COMPLETED';
      syncRun.completedAt = new Date().toISOString();
      syncRun.durationMs = Date.now() - startTime;
      delete syncRun.error;

      const metaBatch = db.batch();
      metaBatch.set(db.collection('serviceSources').doc(sourceId), cleanServerData(source), { merge: true });
      metaBatch.set(db.collection('serviceSyncRuns').doc(runId), cleanServerData(syncRun), { merge: true });
      await metaBatch.commit();

      try {
        await recomputeCatalogMatches();
        syncRun.productMatchesCreated = 0;
      } catch {
        // Ignore candidate preview errors during source sync
      }

      console.log(`[ServiceIntelligence] Firestore commit SUCCEEDED for ${sourceId} (status: COMPLETED).`);
    } catch (dbErr: any) {
      const dbError = dbErr instanceof Error ? dbErr.message : String(dbErr);
      lastFirestorePersistenceError = dbError;

      // S1.2.5.1 Objective 3/4: If we already hydrated authoritative Firestore advisories (e.g. 93 records),
      // do NOT pollute memAdvisories with unpersisted records when Firestore write fails!
      // Only populate memAdvisories on pure preview boot when memAdvisories was empty.
      if (!wasAuthoritativeBeforeSync && !options?.customDb) {
        globalPersistenceMode = 'PREVIEW_IN_MEMORY_ONLY';
        for (const adv of mergedAdvisoriesToCommit) {
          memAdvisories.set(adv.id, adv);
        }
        for (const vuln of pendingVulnerabilities) {
          memVulnerabilities.set(vuln.cveId, vuln);
        }
        try {
          await recomputeCatalogMatches();
        } catch {
          // Ignore preview candidate error
        }
      }

      source.persistenceStatus = wasAuthoritativeBeforeSync
        ? 'FIRESTORE_WRITE_ERROR'
        : 'PREVIEW_IN_MEMORY_ONLY';
      source.collectionStatus = 'PARTIAL';
      source.lastSyncTerminalStatus = 'PARTIAL';
      source.recordsRejectedOrFailed =
        sourceId === 'nvd-api' ? pendingVulnerabilities.length : mergedAdvisoriesToCommit.length;
      source.lastError = `Source extraction succeeded, but Firestore write failed (${dbError}).`;

      syncRun.persistenceStorageMode = wasAuthoritativeBeforeSync
        ? 'FIRESTORE_WRITE_ERROR'
        : 'PREVIEW_IN_MEMORY_ONLY';
      syncRun.advisoriesRejectedOrFailed = mergedAdvisoriesToCommit.length;
      syncRun.stages!.advisoryPersistence =
        mergedAdvisoriesToCommit.length > 0 ? 'FAILED' : 'SKIPPED';
      syncRun.stages!.vulnerabilityPersistence =
        pendingVulnerabilities.length > 0 ? 'FAILED' : 'SKIPPED';
      syncRun.status = 'PARTIAL';
      syncRun.completedAt = new Date().toISOString();
      syncRun.durationMs = Date.now() - startTime;
      syncRun.error = `Source extraction succeeded, but Firestore write failed (${dbError}). Authoritative Firestore counts remain unchanged.`;
      console.warn(`[ServiceIntelligence] Firestore persistence notice for ${sourceId}:`, dbError);
    }

    memSources.set(sourceId, source);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    syncRun.status = 'FAILED';
    syncRun.error = errorMsg;
    syncRun.completedAt = new Date().toISOString();
    syncRun.durationMs = Date.now() - startTime;
    source.collectionStatus = 'FAILED';
    source.lastSyncTerminalStatus = 'FAILED';
    source.status = errorMsg.includes('403') || errorMsg.includes('429') ? 'RATE_LIMITED' : 'ERROR';
    source.lastError = errorMsg;
    console.error(`[ServiceIntelligence] Sync cycle failed for ${sourceId}:`, errorMsg);
    memSources.set(sourceId, source);

    // Attempt to persist FAILED syncRun record to Firestore if reachable
    try {
      const db = options?.customDb || getServerDb();
      await db.collection('serviceSyncRuns').doc(runId).set(cleanServerData(syncRun), { merge: true });
    } catch {
      // Ignore if Firestore is unreachable
    }
  } finally {
    activeSyncLocks.delete(sourceId);
  }

  return syncRun;
}

/**
 * Synchronizes all 5 official service sources sequentially
 */
export async function syncAllServiceSources(
  triggeredBy: 'MANUAL_ADMIN' | 'SCHEDULED_JOB' = 'MANUAL_ADMIN'
): Promise<ServiceSyncRun[]> {
  const sources: ServiceSourceId[] = [
    'cisa-kev',
    'apple-security',
    'huawei-security',
    'samsung-security',
    'nvd-api',
  ];

  const results: ServiceSyncRun[] = [];
  for (const src of sources) {
    try {
      const run = await syncServiceSource(src, triggeredBy);
      results.push(run);
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      console.error(`[ServiceIntelligence] Error in syncAll for ${src}:`, err);
    }
  }

  return results;
}

/**
 * Returns filtered list of Service Advisories
 */
export async function getServiceAdvisories(
  options: ServiceFilterOptions = {}
): Promise<ServiceAdvisory[]> {
  await initializeServiceIntelligence();
  await refreshAuthoritativeStateFromFirestore();

  let list = Array.from(memAdvisories.values());

  if (options.manufacturer && options.manufacturer !== 'ALL') {
    list = list.filter((a) => a.manufacturer === options.manufacturer);
  }

  if (options.advisoryType && options.advisoryType !== 'ALL') {
    list = list.filter((a) => a.advisoryType === options.advisoryType);
  }

  if (options.severity && options.severity !== 'ALL') {
    list = list.filter((a) => a.severity === options.severity);
  }

  if (options.knownExploitedOnly) {
    list = list.filter((a) => a.isKnownExploited === true || a.cisaKevStatus === 'ACTIVE_EXPLOITED');
  }

  if (options.searchQuery && options.searchQuery.trim().length > 0) {
    const q = options.searchQuery.toLowerCase().trim();
    list = list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        (a.affectedProductsText && a.affectedProductsText.toLowerCase().includes(q)) ||
        a.cveIds.some((c) => c.toLowerCase().includes(q)) ||
        (a.bulletinReference && a.bulletinReference.toLowerCase().includes(q))
    );
  }

  return list.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
}

/**
 * Returns filtered list of Vulnerabilities
 */
export async function getServiceVulnerabilities(options: {
  vendor?: string;
  isCisaKevOnly?: boolean;
  limit?: number;
} = {}): Promise<ServiceVulnerability[]> {
  await initializeServiceIntelligence();

  let list = Array.from(memVulnerabilities.values());

  if (options.isCisaKevOnly) {
    list = list.filter((v) => v.isKnownExploited === true || v.cisaKevStatus === 'ACTIVE_EXPLOITED');
  }

  if (options.vendor && options.vendor !== 'ALL') {
    const rx = new RegExp(`\\b${options.vendor}\\b`, 'i');
    list = list.filter((v) => v.affectedVendors.some((vnd) => rx.test(vnd)));
  }

  const limit = options.limit || 100;
  return list
    .sort((a, b) => (b.lastUpdatedAt || '').localeCompare(a.lastUpdatedAt || ''))
    .slice(0, limit);
}

/**
 * Returns list of Persisted Product Matches from Firestore (or optional computed candidates if requested)
 */
export async function getServiceProductMatches(options: {
  advisoryId?: string;
  productId?: string;
  confidence?: string;
  includeUnpersistedCandidates?: boolean;
  customDb?: any;
} = {}): Promise<ServiceProductMatch[]> {
  await initializeServiceIntelligence();

  // Attempt fresh read from Firestore so persisted matches are always authoritative
  try {
    const db = options.customDb || getServerDb();
    const snap = await db.collection('serviceProductMatches').get();
    if (!options.customDb) {
      memPersistedMatches.clear();
    }
    const persistedList: ServiceProductMatch[] = [];
    for (const d of snap.docs || []) {
      if (String(d.id || '').startsWith('_diag_probe_')) continue;
      const m = (typeof d.data === 'function' ? d.data() : d.data) as ServiceProductMatch;
      if (m) {
        const item = { ...m, id: m.id || d.id };
        if (!options.customDb) {
          memPersistedMatches.set(item.id, item);
        }
        persistedList.push(item);
      }
    }
    let list = options.includeUnpersistedCandidates && persistedList.length === 0
      ? Array.from(memComputedCandidates.values())
      : persistedList;

    if (options.advisoryId) {
      list = list.filter((m) => m.advisoryId === options.advisoryId);
    }
    if (options.productId) {
      list = list.filter((m) => m.canonicalProductId === options.productId);
    }
    if (options.confidence && options.confidence !== 'ALL') {
      list = list.filter((m) => m.confidence === options.confidence);
    }
    return list;
  } catch {
    // When Firestore is unreachable, only return persisted cache (which is empty in preview unless populated)
    let list = options.includeUnpersistedCandidates
      ? Array.from(memComputedCandidates.values())
      : Array.from(memPersistedMatches.values());

    if (options.advisoryId) {
      list = list.filter((m) => m.advisoryId === options.advisoryId);
    }
    if (options.productId) {
      list = list.filter((m) => m.canonicalProductId === options.productId);
    }
    if (options.confidence && options.confidence !== 'ALL') {
      list = list.filter((m) => m.confidence === options.confidence);
    }
    return list;
  }
}

/**
 * Resolves a product match review (APPROVE or REJECT) and persists the admin decision to Firestore
 */
export async function resolveServiceProductMatch(
  matchId: string,
  action: 'APPROVE' | 'REJECT',
  reviewedBy = 'Administrator',
  options?: { customDb?: any }
): Promise<ServiceProductMatch | null> {
  await initializeServiceIntelligence();

  const db = options?.customDb || getServerDb();
  let match = memPersistedMatches.get(matchId) || memComputedCandidates.get(matchId);

  if (!match) {
    try {
      const docSnap = await db.collection('serviceProductMatches').doc(matchId).get();
      if (docSnap && docSnap.exists) {
        const data = typeof docSnap.data === 'function' ? docSnap.data() : docSnap.data;
        if (data) match = { ...data, id: data.id || matchId } as ServiceProductMatch;
      }
    } catch {
      // Ignore lookup error
    }
  }

  if (!match) return null;

  const now = new Date().toISOString();
  const updatedMatch: ServiceProductMatch = {
    ...match,
    status: action === 'APPROVE' ? 'CONFIRMED' : 'DISMISSED',
    reviewedBy,
    reviewedAt: now,
    updatedAt: now,
  };

  // Persist admin review decision to Firestore (fail-closed if Firestore write fails in production)
  await db.collection('serviceProductMatches').doc(matchId).set(cleanServerData(updatedMatch), { merge: true });

  if (!options?.customDb) {
    memPersistedMatches.set(matchId, updatedMatch);
    memComputedCandidates.set(matchId, updatedMatch);
  }

  return updatedMatch;
}

/**
 * Authoritative Aggregation Service (S1.2.2 Reconciled Multi-Dimensional Metrics)
 * 
 * Objective 6 Guarantees:
 * - Confirmed Catalog Product Links and Pending Review Matches come strictly from persisted Firestore records.
 * - Never presents unpersisted in-memory candidates as confirmed Firestore links.
 * - When Firestore query fails, reports persistedVerifiedProductMatchesCount = 'UNAVAILABLE'.
 * - Separately reports computedCandidateMatchesCount (Not Yet Persisted).
 */
export async function getServiceDashboardStats(options?: {
  customDb?: any;
}): Promise<ServiceDashboardStats> {
  await initializeServiceIntelligence();
  if (!options?.customDb) {
    await refreshAuthoritativeStateFromFirestore();
  }

  let allAdv = Array.from(memAdvisories.values());
  let allVuln = Array.from(memVulnerabilities.values());
  let allSources = Array.from(memSources.values());

  // Query authoritative persisted matches from Firestore
  let persistedMatchesStatus: 'FIRESTORE_AUTHORITATIVE' | 'UNAVAILABLE' = 'UNAVAILABLE';
  let persistedVerifiedCount = 0;
  let persistedPendingCount = 0;
  const persistedConfirmedAdvisoryIds = new Set<string>();

  try {
    const db = options?.customDb || getServerDb();
    const matchSnap = await db.collection('serviceProductMatches').get();
    persistedMatchesStatus = 'FIRESTORE_AUTHORITATIVE';

    if (options?.customDb) {
      // Also read advisories/sources/vulns from customDb when provided for isolated unit tests
      try {
        const [advSnap, vulnSnap, srcSnap] = await Promise.all([
          db.collection('serviceAdvisories').get(),
          db.collection('serviceVulnerabilities').get(),
          db.collection('serviceSources').get(),
        ]);
        if (Array.isArray(advSnap?.docs) && advSnap.docs.length > 0) {
          allAdv = advSnap.docs
            .filter((d: any) => !String(d.id || '').startsWith('_diag_probe_'))
            .map((d: any) => (typeof d.data === 'function' ? d.data() : d.data));
        }
        if (Array.isArray(vulnSnap?.docs) && vulnSnap.docs.length > 0) {
          allVuln = vulnSnap.docs
            .filter((d: any) => !String(d.id || '').startsWith('_diag_probe_'))
            .map((d: any) => (typeof d.data === 'function' ? d.data() : d.data));
        }
        if (Array.isArray(srcSnap?.docs) && srcSnap.docs.length > 0) {
          allSources = srcSnap.docs
            .filter((d: any) => !String(d.id || '').startsWith('_diag_probe_'))
            .map((d: any) => (typeof d.data === 'function' ? d.data() : d.data));
        }
      } catch {
        // Fallback to mem lists if customDb doesn't mock all collections
      }
    } else {
      memPersistedMatches.clear();
    }

    for (const d of matchSnap?.docs || []) {
      if (String(d.id || '').startsWith('_diag_probe_')) continue;
      const m = (typeof d.data === 'function' ? d.data() : d.data) as ServiceProductMatch;
      if (!m) continue;
      const item = { ...m, id: m.id || d.id };
      if (!options?.customDb) {
        memPersistedMatches.set(item.id, item);
      }

      if (item.status === 'CONFIRMED') {
        persistedVerifiedCount++;
        persistedConfirmedAdvisoryIds.add(item.advisoryId);
      } else if (item.status === 'PENDING_REVIEW') {
        persistedPendingCount++;
      }
    }
  } catch {
    persistedMatchesStatus = 'UNAVAILABLE';
    persistedVerifiedCount = 0;
    persistedPendingCount = 0;
  }

  // Computed in-memory candidates (explicitly separated from persisted Firestore links)
  const allCandidates = Array.from(memComputedCandidates.values());
  const computedVerifiedCandidatesCount = allCandidates.filter((m) => m.confidence === 'VERIFIED').length;
  const computedPendingCandidatesCount = allCandidates.filter(
    (m) => m.confidence === 'LIKELY' || m.confidence === 'AMBIGUOUS_REVIEW'
  ).length;

  // 1. Mutually Exclusive Manufacturer Breakdown
  const manufacturerBreakdown = {
    Apple: allAdv.filter((a) => a.manufacturer === 'Apple').length,
    Samsung: allAdv.filter((a) => a.manufacturer === 'Samsung').length,
    Huawei: allAdv.filter((a) => a.manufacturer === 'Huawei').length,
    CrossVendor: allAdv.filter((a) => a.manufacturer === 'Cross-Vendor').length,
  };

  // 2. Breakdown by Source
  const sourceBreakdown: Record<ServiceSourceId, number> = {
    'apple-security': allAdv.filter((a) => a.sourceId === 'apple-security').length,
    'huawei-security': allAdv.filter((a) => a.sourceId === 'huawei-security').length,
    'samsung-security': allAdv.filter((a) => a.sourceId === 'samsung-security').length,
    'cisa-kev': allAdv.filter((a) => a.sourceId === 'cisa-kev').length,
    'nvd-api': allAdv.filter((a) => a.sourceId === 'nvd-api').length,
  };

  // 3. Breakdown by Advisory Type
  const advisoryTypeBreakdown: Record<any, number> = {
    SECURITY_UPDATE: allAdv.filter((a) => a.advisoryType === 'SECURITY_UPDATE').length,
    KNOWN_EXPLOITED: allAdv.filter((a) => a.advisoryType === 'KNOWN_EXPLOITED').length,
    UPDATE_SCHEDULE: allAdv.filter((a) => a.advisoryType === 'UPDATE_SCHEDULE').length,
    VULNERABILITY: allAdv.filter((a) => a.advisoryType === 'VULNERABILITY').length,
    REPAIR_PROGRAM: allAdv.filter((a) => a.advisoryType === 'REPAIR_PROGRAM').length,
    PRODUCT_RECALL: allAdv.filter((a) => a.advisoryType === 'PRODUCT_RECALL').length,
    END_OF_SUPPORT: allAdv.filter((a) => a.advisoryType === 'END_OF_SUPPORT').length,
  };

  // 4. Distinct CVE collection
  const cveSet = new Set<string>();
  allAdv.forEach((a) => a.cveIds?.forEach((c) => cveSet.add(c.toUpperCase())));
  allVuln.forEach((v) => {
    if (v?.cveId) cveSet.add(v.cveId.toUpperCase());
  });

  // 5. Severity distribution (Decoupled from KEV)
  const criticalSeverityCount = allAdv.filter((a) => a.severity === 'CRITICAL').length;
  const highSeverityCount = allAdv.filter((a) => a.severity === 'HIGH').length;
  const unknownSeverityCount = allAdv.filter(
    (a) => a.severity === 'UNKNOWN' || a.severity === 'NOT_AVAILABLE'
  ).length;

  // 6. CISA KEV exploitation count
  const cisaKevCount = allAdv.filter(
    (a) => a.isKnownExploited === true || a.cisaKevStatus === 'ACTIVE_EXPLOITED'
  ).length;

  // 7. Unmatched advisories count against persisted confirmed matches
  const unmatchedAdvisoriesCount = allAdv.filter((a) => !persistedConfirmedAdvisoryIds.has(a.id)).length;

  // 8. Operational sources count
  const operationalSources = allSources.filter(
    (s) => s.status === 'ACTIVE' || s.collectionStatus === 'SUCCESS' || (s.recordsDiscovered ?? 0) > 0
  ).length;

  let lastSyncTimestamp: string | undefined;
  let latestSyncSource: ServiceSource | undefined;
  for (const s of allSources) {
    if (s.lastSuccessfulSync && (!lastSyncTimestamp || s.lastSuccessfulSync > lastSyncTimestamp)) {
      lastSyncTimestamp = s.lastSuccessfulSync;
      latestSyncSource = s;
    }
  }

  const activeAdvisoriesCount = allAdv.filter(
    (a) =>
      a.advisoryType !== 'END_OF_SUPPORT' &&
      a.status !== 'SUPERSEDED' &&
      a.status !== 'ARCHIVED',
  ).length;

  return {
    totalAdvisories: allAdv.length,
    totalPersistedAdvisories: allAdv.length,
    activeAdvisoriesCount,
    visibleAdvisoriesUnderFilterCount: allAdv.length,
    totalVulnerabilities: allVuln.length,
    cisaKevCount,
    totalPersistedCisaKevCount: cisaKevCount,
    latestSyncRecordsCreated: latestSyncSource?.recordsCreated ?? 0,
    latestSyncRecordsUpdated: latestSyncSource?.recordsUpdated ?? 0,
    latestSyncRecordsUnchanged: latestSyncSource?.recordsUnchanged ?? 0,
    latestSyncRecordsRejectedOrFailed: latestSyncSource?.recordsRejectedOrFailed ?? 0,
    latestCompletedSyncStatus:
      latestSyncSource?.lastSyncTerminalStatus &&
      latestSyncSource.lastSyncTerminalStatus !== 'NOT_RUN'
        ? latestSyncSource.lastSyncTerminalStatus
        : operationalSources > 0
        ? 'COMPLETED'
        : 'NOT_VERIFIED',
    highSeverityCount,
    criticalSeverityCount,
    unknownSeverityCount,
    verifiedProductMatchesCount: persistedVerifiedCount,
    pendingReviewMatchesCount: persistedPendingCount,
    persistedMatchesStatus,
    persistedVerifiedProductMatchesCount:
      persistedMatchesStatus === 'FIRESTORE_AUTHORITATIVE' ? persistedVerifiedCount : 'UNAVAILABLE',
    persistedPendingReviewMatchesCount:
      persistedMatchesStatus === 'FIRESTORE_AUTHORITATIVE' ? persistedPendingCount : 'UNAVAILABLE',
    catalogCandidateStatus,
    computedCandidateMatchesCount: allCandidates.length,
    computedVerifiedCandidatesCount,
    computedPendingCandidatesCount,
    unmatchedAdvisoriesCount,
    sourcesOperational: operationalSources,
    totalSources: allSources.length,
    persistenceStorageMode:
      persistedMatchesStatus === 'FIRESTORE_AUTHORITATIVE'
        ? 'FIRESTORE_AUTHORITATIVE'
        : globalPersistenceMode,
    manufacturerBreakdown,
    sourceBreakdown,
    advisoryTypeBreakdown,
    uniqueCveCount: cveSet.size,
    lastSyncTimestamp,
  };
}

/**
 * Returns list of registered sources with health, authoritative persisted advisory counts, and persistence storage mode
 */
export async function getServiceSources(): Promise<ServiceSource[]> {
  await initializeServiceIntelligence();
  await refreshAuthoritativeStateFromFirestore();

  const allAdv = Array.from(memAdvisories.values());
  const allVuln = Array.from(memVulnerabilities.values());

  return Array.from(memSources.values()).map((src) => {
    const persistedCount =
      src.id === 'nvd-api'
        ? allVuln.length
        : allAdv.filter((a) => a.sourceId === src.id).length;
    return {
      ...src,
      persistedAdvisoriesCount: persistedCount,
    };
  });
}

/**
 * Concurrency-locked, rate-limited Persistence Probe
 * Performs controlled write -> read-back -> content verification -> cleanup lifecycle
 */
let lastProbeReport: PersistenceProbeReport | undefined;
let isProbeRunning = false;
let lastProbeTimestamp = 0;

export function resetDiagnosticProbeStateForTests(): void {
  lastProbeReport = undefined;
  isProbeRunning = false;
  lastProbeTimestamp = 0;
}

export async function runPersistenceProbe(options?: {
  customDb?: any;
  bypassRateLimit?: boolean;
}): Promise<PersistenceProbeReport> {
  await initializeServiceIntelligence();

  if (isProbeRunning) {
    throw new Error('Persistence probe is already running. Concurrency locked.');
  }

  const now = Date.now();
  if (!options?.bypassRateLimit && now - lastProbeTimestamp < 10000) {
    throw new Error('Persistence probe rate-limited: please wait 10 seconds between test executions.');
  }

  isProbeRunning = true;
  lastProbeTimestamp = now;

  const probeDocId = `_diag_probe_${now}_${Math.random().toString(36).substring(2, 8)}`;
  const probeTimestamp = new Date().toISOString();
  const testNonce = `nonce_${Math.random().toString(36).substring(2, 12)}`;

  const report: PersistenceProbeReport = {
    probeDocId,
    timestamp: probeTimestamp,
    write: { status: 'FAILED', error: 'Not executed' },
    readBack: { status: 'FAILED', error: 'Not reached because write did not succeed' },
    contentVerification: { status: 'FAILED', error: 'Not reached because read-back did not succeed' },
    cleanup: { status: 'FAILED', error: 'Not reached because write did not create document' },
    overallResult: 'FAILED',
    summaryMessage: 'Probe execution failed during lifecycle.',
  };

  try {
    const db = options?.customDb || getServerDb();
    const probeDocRef = db.collection('_serviceDiagnostics').doc(probeDocId);

    // Step 1: Write
    const writeStart = Date.now();
    try {
      await probeDocRef.set({
        probeId: probeDocId,
        probeTimestamp,
        nonce: testNonce,
        agent: 'Signalyn-S1.2.2-Diagnostic-Probe',
        purpose: 'Non-business temporary persistence probe',
      });
      report.write = { status: 'SUCCESS', durationMs: Date.now() - writeStart };
    } catch (writeErr: any) {
      const sanitizedMsg = String(writeErr?.message || writeErr).replace(/Bearer\s+[^\s]+/gi, '[REDACTED]');
      report.write = {
        status: 'FAILED',
        durationMs: Date.now() - writeStart,
        error: sanitizedMsg,
      };
      report.overallResult = 'FAILED';
      report.summaryMessage = `Probe write failed: ${sanitizedMsg}`;
      if (!options?.customDb) {
        lastProbeReport = report;
      }
      return report;
    }

    // Step 2: Read-Back
    const readStart = Date.now();
    let snap: any;
    try {
      snap = await probeDocRef.get();
      if (snap && snap.exists) {
        report.readBack = { status: 'SUCCESS', durationMs: Date.now() - readStart };
      } else {
        report.readBack = {
          status: 'FAILED',
          durationMs: Date.now() - readStart,
          error: 'Document not found in Firestore after write.',
        };
      }
    } catch (readErr: any) {
      const sanitizedMsg = String(readErr?.message || readErr).replace(/Bearer\s+[^\s]+/gi, '[REDACTED]');
      report.readBack = {
        status: 'FAILED',
        durationMs: Date.now() - readStart,
        error: sanitizedMsg,
      };
    }

    // Step 3: Content Verification
    if (report.readBack.status === 'SUCCESS' && snap?.exists) {
      const data = typeof snap.data === 'function' ? snap.data() : snap.data;
      if (data?.nonce === testNonce && data?.probeId === probeDocId) {
        report.contentVerification = { status: 'SUCCESS' };
      } else {
        report.contentVerification = {
          status: 'FAILED',
          error: 'Content verification failed: Written nonce did not match read payload.',
        };
      }
    } else {
      report.contentVerification = {
        status: 'FAILED',
        error: 'Content verification could not run because read-back failed.',
      };
    }

    // Step 4: Cleanup
    const cleanStart = Date.now();
    try {
      await probeDocRef.delete();
      report.cleanup = { status: 'SUCCESS', durationMs: Date.now() - cleanStart };
    } catch (cleanErr: any) {
      const sanitizedMsg = String(cleanErr?.message || cleanErr).replace(/Bearer\s+[^\s]+/gi, '[REDACTED]');
      report.cleanup = {
        status: 'FAILED',
        durationMs: Date.now() - cleanStart,
        error: sanitizedMsg,
      };
      report.remainingDocument = `_serviceDiagnostics/${probeDocId}`;
    }

    // Step 5: Overall Result
    if (
      report.write.status === 'SUCCESS' &&
      report.readBack.status === 'SUCCESS' &&
      report.contentVerification.status === 'SUCCESS' &&
      report.cleanup.status === 'SUCCESS'
    ) {
      report.overallResult = 'VERIFIED';
      report.summaryMessage =
        'Write, read-back, content verification, and cleanup succeeded cleanly in authoritative Firestore.';
    } else if (
      report.write.status === 'SUCCESS' &&
      report.readBack.status === 'SUCCESS' &&
      report.contentVerification.status === 'SUCCESS' &&
      report.cleanup.status === 'FAILED'
    ) {
      report.overallResult = 'INCOMPLETE';
      report.summaryMessage = `Write, read-back, and verification succeeded, but cleanup failed. Remaining document: ${report.remainingDocument}`;
    } else {
      report.overallResult = 'FAILED';
      report.summaryMessage = 'Persistence probe failed at one or more lifecycle stages.';
    }
  } catch (err: any) {
    const sanitizedMsg = String(err?.message || err).replace(/Bearer\s+[^\s]+/gi, '[REDACTED]');
    report.summaryMessage = `Unexpected probe error: ${sanitizedMsg}`;
  } finally {
    isProbeRunning = false;
  }

  if (!options?.customDb) {
    lastProbeReport = report;
  }
  return report;
}

/**
 * Helper to execute server-side count query when supported, with snapshot size fallback
 */
async function queryFirestoreCount(collectionOrQuery: any): Promise<number> {
  if (typeof collectionOrQuery.count === 'function') {
    const aggSnap = await collectionOrQuery.count().get();
    const data = typeof aggSnap.data === 'function' ? aggSnap.data() : aggSnap.data;
    if (data && typeof data.count === 'number') {
      return data.count;
    }
  }
  const snap = await collectionOrQuery.get();
  if (Array.isArray(snap.docs)) {
    return snap.docs.filter((d: any) => !String(d.id || '').startsWith('_diag_probe_')).length;
  }
  return typeof snap.size === 'number' ? snap.size : 0;
}

/**
 * Admin-Only Production Persistence Diagnostic Service (S1.2.1 & S1.2.2)
 * Audits runtime identity, named database connectivity, real Firestore collection counts,
 * match reconciliation status, and consistency against dashboard metrics.
 */
export async function getPersistenceDiagnostic(
  runProbe = false,
  options?: { customDb?: any; bypassRateLimit?: boolean }
): Promise<ProductionDiagnosticsReport> {
  await initializeServiceIntelligence();
  const timestamp = new Date().toISOString();
  const firebaseProjectId = TARGET_PROJECT_ID || 'signalyn-5406e';
  const firestoreDatabaseId =
    TARGET_DATABASE_ID || 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34';

  // 1. Runtime Detection
  let environment: 'Cloud Run' | 'AI Studio Preview' | 'Unknown' = 'Unknown';
  let cloudRunService: string | undefined = undefined;
  let cloudRunRegion: string | undefined = undefined;

  const isDeployedCloudRun =
    process.env.K_SERVICE === 'signalyn' ||
    Boolean(process.env.K_SERVICE && process.env.NODE_ENV === 'production' && !process.env.AIS_DEV_APP_URL);

  if (isDeployedCloudRun) {
    environment = 'Cloud Run';
    cloudRunService = process.env.K_SERVICE || undefined;
    cloudRunRegion =
      process.env.CLOUD_RUN_REGION || process.env.GOOGLE_CLOUD_REGION || undefined;
  } else if (
    process.env.AIS_DEV_APP_URL ||
    process.env.AIS_SHARED_APP_URL ||
    process.cwd().includes('/app/applet')
  ) {
    environment = 'AI Studio Preview';
  }

  // 2. Optional Probe Execution
  let currentProbeReport = options?.customDb ? undefined : lastProbeReport;
  if (runProbe) {
    try {
      currentProbeReport = await runPersistenceProbe(options);
    } catch (probeRunErr) {
      console.warn('[ServiceIntelligence] Diagnostic probe run error:', probeRunErr);
    }
  }

  // 3. Real Firestore Connection Audit & Collection Counts
  let firestoreConnection: FirestoreConnectionStatus = 'NOT_VERIFIED';
  let storageMode: PersistenceStorageMode | 'FIRESTORE_UNAVAILABLE' | 'UNKNOWN' = 'UNKNOWN';

  const firestoreCounts: FirestoreCollectionCountReport = {
    serviceSources: 'UNAVAILABLE',
    activeSourcesCount: 'UNAVAILABLE',
    serviceAdvisories: 'UNAVAILABLE',
    cisaKevAdvisoriesCount: 'UNAVAILABLE',
    serviceVulnerabilities: 'UNAVAILABLE',
    serviceProductMatches: 'UNAVAILABLE',
    productMatchesBreakdown: {
      VERIFIED: 'UNAVAILABLE',
      LIKELY: 'UNAVAILABLE',
      AMBIGUOUS_REVIEW: 'UNAVAILABLE',
      UNMATCHED: 'UNAVAILABLE',
    },
    productMatchesStatusBreakdown: {
      CONFIRMED: 'UNAVAILABLE',
      PENDING_REVIEW: 'UNAVAILABLE',
      DISMISSED: 'UNAVAILABLE',
    },
    serviceSyncRuns: 'UNAVAILABLE',
    serviceAlerts: 'UNAVAILABLE',
  };

  let lastPersistedSync: LastPersistedSyncAudit = {
    status: 'NOT_VERIFIED',
    notes: 'No persisted sync runs verified in authoritative Firestore.',
  };

  try {
    const db = options?.customDb || getServerDb();

    // Probe read connection with an actual Firestore operation
    try {
      await db.collection('serviceSources').limit(1).get();
      firestoreConnection = 'CONNECTED';
    } catch (connErr: any) {
      if (
        connErr?.code === 7 ||
        connErr?.code === 'PERMISSION_DENIED' ||
        (connErr?.message && String(connErr.message).includes('PERMISSION_DENIED'))
      ) {
        firestoreConnection = 'PERMISSION_DENIED';
        storageMode = 'PREVIEW_IN_MEMORY_ONLY';
      } else {
        firestoreConnection = 'UNAVAILABLE';
        storageMode = 'FIRESTORE_UNAVAILABLE';
      }
    }

    // If connected, query actual counts from Firestore
    if (firestoreConnection === 'CONNECTED') {
      try {
        const [
          sourcesTotal,
          advisoriesTotal,
          vulnsTotal,
          matchesTotal,
          runsTotal,
          alertsTotal,
          srcSnap,
          advSnap,
          matchSnap,
        ] = await Promise.all([
          queryFirestoreCount(db.collection('serviceSources')),
          queryFirestoreCount(db.collection('serviceAdvisories')),
          queryFirestoreCount(db.collection('serviceVulnerabilities')),
          queryFirestoreCount(db.collection('serviceProductMatches')),
          queryFirestoreCount(db.collection('serviceSyncRuns')),
          queryFirestoreCount(db.collection('serviceAlerts')),
          db.collection('serviceSources').get(),
          db.collection('serviceAdvisories').get(),
          db.collection('serviceProductMatches').get(),
        ]);

        firestoreCounts.serviceSources = sourcesTotal;
        firestoreCounts.serviceAdvisories = advisoriesTotal;
        firestoreCounts.serviceVulnerabilities = vulnsTotal;
        firestoreCounts.serviceProductMatches = matchesTotal;
        firestoreCounts.serviceSyncRuns = runsTotal;
        firestoreCounts.serviceAlerts = alertsTotal;

        // Active sources in Firestore
        let activeSrc = 0;
        if (Array.isArray(srcSnap?.docs)) {
          srcSnap.docs.forEach((d: any) => {
            if (String(d.id || '').startsWith('_diag_probe_')) return;
            const s = typeof d.data === 'function' ? d.data() : d.data;
            if (s && (s.status === 'ACTIVE' || s.collectionStatus === 'SUCCESS' || (s.recordsDiscovered ?? 0) > 0)) {
              activeSrc++;
            }
          });
        }
        firestoreCounts.activeSourcesCount = activeSrc;

        // CISA KEV advisories in Firestore
        let kevAdvCount = 0;
        if (Array.isArray(advSnap?.docs)) {
          advSnap.docs.forEach((d: any) => {
            const a = typeof d.data === 'function' ? d.data() : d.data;
            if (a && (a.isKnownExploited === true || a.cisaKevStatus === 'ACTIVE_EXPLOITED')) {
              kevAdvCount++;
            }
          });
        }
        firestoreCounts.cisaKevAdvisoriesCount = kevAdvCount;

        // Breakdown for serviceProductMatches (Confidence AND Review Status tracked distinctly)
        let vCount = 0;
        let lCount = 0;
        let rCount = 0;
        let uCount = 0;
        let confirmedStatusCount = 0;
        let pendingStatusCount = 0;
        let dismissedStatusCount = 0;

        if (Array.isArray(matchSnap?.docs)) {
          matchSnap.docs.forEach((d: any) => {
            if (String(d.id || '').startsWith('_diag_probe_')) return;
            const m = typeof d.data === 'function' ? d.data() : d.data;
            if (!m) return;
            if (m.confidence === 'VERIFIED') vCount++;
            else if (m.confidence === 'LIKELY') lCount++;
            else if (m.confidence === 'AMBIGUOUS_REVIEW') rCount++;
            else uCount++;

            if (m.status === 'CONFIRMED') confirmedStatusCount++;
            else if (m.status === 'PENDING_REVIEW') pendingStatusCount++;
            else if (m.status === 'DISMISSED') dismissedStatusCount++;
          });
        }

        firestoreCounts.productMatchesBreakdown = {
          VERIFIED: vCount,
          LIKELY: lCount,
          AMBIGUOUS_REVIEW: rCount,
          UNMATCHED: uCount,
        };

        firestoreCounts.productMatchesStatusBreakdown = {
          CONFIRMED: confirmedStatusCount,
          PENDING_REVIEW: pendingStatusCount,
          DISMISSED: dismissedStatusCount,
        };
      } catch {
        // Leave failed collection counts as UNAVAILABLE
      }

      // 4. Last Persisted Sync Audit (Read strictly from persisted serviceSyncRuns in Firestore)
      try {
        let runDocs: any[] = [];
        try {
          const orderedSnap = await db
            .collection('serviceSyncRuns')
            .orderBy('startedAt', 'desc')
            .limit(10)
            .get();
          runDocs = orderedSnap?.docs || [];
        } catch {
          const allRunsSnap = await db.collection('serviceSyncRuns').get();
          runDocs = (allRunsSnap?.docs || []).sort((a: any, b: any) => {
            const da = typeof a.data === 'function' ? a.data() : a.data;
            const dbData = typeof b.data === 'function' ? b.data() : b.data;
            return String(dbData?.startedAt || '').localeCompare(String(da?.startedAt || ''));
          });
        }

        const validRunDocs = runDocs.filter(
          (d: any) => !String(d.id || '').startsWith('_diag_probe_')
        );

        if (validRunDocs.length > 0) {
          const data =
            typeof validRunDocs[0].data === 'function'
              ? validRunDocs[0].data()
              : validRunDocs[0].data;
          const isFullyPersistedSuccess =
            data.status === 'COMPLETED' &&
            data.persistenceStorageMode === 'FIRESTORE_AUTHORITATIVE';
          const isLegacyPreCommitStartedRecord =
            data.status === 'STARTED' && !data.completedAt && !data.error;

          const createdCount =
            data.sourceId === 'nvd-api'
              ? (data.vulnerabilitiesCreated ?? data.vulnerabilitiesDiscovered ?? 0)
              : (data.advisoriesCreated ?? 0);
          const updatedCount =
            data.sourceId === 'nvd-api'
              ? (data.vulnerabilitiesUpdated ?? 0)
              : (data.advisoriesUpdated ?? 0);

          lastPersistedSync = {
            status: isFullyPersistedSuccess
              ? 'SUCCESS'
              : data.status === 'FAILED'
              ? 'FAILED'
              : 'PARTIAL',
            sourceId: data.sourceId,
            syncRunId: data.id || validRunDocs[0].id,
            completionTimestamp: data.completedAt || data.startedAt,
            recordsCreated: createdCount,
            recordsUpdated: updatedCount,
            persistenceStatus: data.persistenceStorageMode || 'UNKNOWN',
            notes: isFullyPersistedSuccess
              ? 'Verified from COMPLETED serviceSyncRuns record in authoritative Firestore.'
              : isLegacyPreCommitStartedRecord
              ? 'Historical sync record was written before completion in pre-S1.2.2 (status: STARTED). Run any source sync to record a finalized COMPLETED run.'
              : data.error || 'Sync run record found, but persistence was partial or incomplete.',
          };
        } else {
          lastPersistedSync = {
            status: 'NOT_VERIFIED',
            notes: 'Firestore connected, but 0 sync run records exist in serviceSyncRuns.',
          };
        }
      } catch {
        lastPersistedSync = {
          status: 'NOT_VERIFIED',
          notes: 'Could not query serviceSyncRuns collection in Firestore.',
        };
      }
    }
  } catch {
    firestoreConnection = 'UNAVAILABLE';
    storageMode = 'FIRESTORE_UNAVAILABLE';
  }

  // If Firestore was not connected, never claim a persisted sync succeeded
  if (firestoreConnection !== 'CONNECTED') {
    const memList = Array.from(memSyncRuns.values()).sort((a, b) =>
      (b.startedAt || '').localeCompare(a.startedAt || '')
    );
    const latestMem = memList[0];
    lastPersistedSync = {
      status: latestMem ? 'PARTIAL' : 'NOT_VERIFIED',
      sourceId: latestMem?.sourceId,
      syncRunId: latestMem?.id,
      completionTimestamp: latestMem?.completedAt || latestMem?.startedAt,
      recordsCreated: latestMem?.advisoriesCreated,
      recordsUpdated: latestMem?.advisoriesUpdated,
      persistenceStatus: latestMem?.persistenceStorageMode || 'PREVIEW_IN_MEMORY_ONLY',
      notes: latestMem
        ? 'Source extraction ran in preview memory only; Firestore write was blocked (NOT persisted in Firestore).'
        : 'Firestore unreachable from current runtime; no persisted sync runs verified.',
    };
  }

  // 5. Storage Mode & Overall Verification Status Determination
  let overallVerificationStatus: DiagnosticVerificationStatus = 'PRODUCTION_NOT_VERIFIED';

  if (currentProbeReport?.overallResult === 'VERIFIED') {
    storageMode = 'FIRESTORE_AUTHORITATIVE';
    overallVerificationStatus = 'PRODUCTION_VERIFIED';
  } else if (currentProbeReport?.overallResult === 'INCOMPLETE') {
    storageMode = firestoreConnection === 'CONNECTED' ? 'FIRESTORE_AUTHORITATIVE' : 'UNKNOWN';
    overallVerificationStatus = 'PARTIAL_VERIFICATION';
  } else if (currentProbeReport?.overallResult === 'FAILED') {
    storageMode =
      firestoreConnection === 'PERMISSION_DENIED'
        ? 'PREVIEW_IN_MEMORY_ONLY'
        : 'FIRESTORE_UNAVAILABLE';
    overallVerificationStatus = 'PERSISTENCE_FAILED';
  } else if (firestoreConnection === 'CONNECTED') {
    if (lastPersistedSync.status === 'SUCCESS') {
      storageMode = 'FIRESTORE_AUTHORITATIVE';
      overallVerificationStatus = 'PARTIAL_VERIFICATION';
    } else {
      storageMode = 'FIRESTORE_AUTHORITATIVE';
      overallVerificationStatus = 'PARTIAL_VERIFICATION';
    }
  } else if (firestoreConnection === 'PERMISSION_DENIED') {
    storageMode = 'PREVIEW_IN_MEMORY_ONLY';
    overallVerificationStatus = 'PRODUCTION_NOT_VERIFIED';
  } else {
    storageMode = 'FIRESTORE_UNAVAILABLE';
    overallVerificationStatus = 'PRODUCTION_NOT_VERIFIED';
  }

  // 6. Dashboard Consistency Comparison (Uses identical authoritative aggregation rules)
  const dashboardStats = await getServiceDashboardStats({ customDb: options?.customDb });
  const fsConfirmedMatches =
    firestoreCounts.productMatchesStatusBreakdown?.CONFIRMED ??
    firestoreCounts.productMatchesBreakdown.VERIFIED;
  const fsPendingReviewCount =
    firestoreCounts.productMatchesStatusBreakdown?.PENDING_REVIEW ?? 'UNAVAILABLE';
  const fsActiveSourcesCount =
    firestoreCounts.activeSourcesCount !== 'UNAVAILABLE' &&
    firestoreCounts.activeSourcesCount !== undefined
      ? firestoreCounts.activeSourcesCount
      : firestoreCounts.serviceSources;
  const fsKevCount =
    firestoreCounts.cisaKevAdvisoriesCount !== 'UNAVAILABLE' &&
    firestoreCounts.cisaKevAdvisoriesCount !== undefined
      ? firestoreCounts.cisaKevAdvisoriesCount
      : firestoreCounts.serviceVulnerabilities;

  const dashConfirmedDisplay =
    dashboardStats.persistedVerifiedProductMatchesCount !== undefined
      ? dashboardStats.persistedVerifiedProductMatchesCount
      : dashboardStats.verifiedProductMatchesCount;
  const dashPendingDisplay =
    dashboardStats.persistedPendingReviewMatchesCount !== undefined
      ? dashboardStats.persistedPendingReviewMatchesCount
      : dashboardStats.pendingReviewMatchesCount;

  const consistencyChecks: MetricConsistencyItem[] = [
    {
      metric: 'Total Advisories',
      dashboardCount: dashboardStats.totalAdvisories,
      firestoreCount: firestoreCounts.serviceAdvisories,
      difference:
        typeof firestoreCounts.serviceAdvisories === 'number'
          ? dashboardStats.totalAdvisories - firestoreCounts.serviceAdvisories
          : 'N/A',
      status:
        typeof firestoreCounts.serviceAdvisories === 'number'
          ? dashboardStats.totalAdvisories === firestoreCounts.serviceAdvisories
            ? 'RECONCILED'
            : 'DESYNC_PREVIEW_MEMORY'
          : 'UNAVAILABLE',
    },
    {
      metric: 'CISA KEV Records',
      dashboardCount: dashboardStats.cisaKevCount,
      firestoreCount: fsKevCount,
      difference:
        typeof fsKevCount === 'number' ? dashboardStats.cisaKevCount - fsKevCount : 'N/A',
      status:
        typeof fsKevCount === 'number'
          ? dashboardStats.cisaKevCount === fsKevCount
            ? 'RECONCILED'
            : 'DESYNC_PREVIEW_MEMORY'
          : 'UNAVAILABLE',
    },
    {
      metric: 'Confirmed Product Links',
      dashboardCount: dashConfirmedDisplay,
      firestoreCount: fsConfirmedMatches,
      difference:
        typeof dashConfirmedDisplay === 'number' && typeof fsConfirmedMatches === 'number'
          ? dashConfirmedDisplay - fsConfirmedMatches
          : 'N/A',
      status:
        typeof dashConfirmedDisplay === 'number' && typeof fsConfirmedMatches === 'number'
          ? dashConfirmedDisplay === fsConfirmedMatches
            ? 'RECONCILED'
            : 'DESYNC_PREVIEW_MEMORY'
          : 'UNAVAILABLE',
    },
    {
      metric: 'Pending Review Matches',
      dashboardCount: dashPendingDisplay,
      firestoreCount: fsPendingReviewCount,
      difference:
        typeof dashPendingDisplay === 'number' && typeof fsPendingReviewCount === 'number'
          ? dashPendingDisplay - fsPendingReviewCount
          : 'N/A',
      status:
        typeof dashPendingDisplay === 'number' && typeof fsPendingReviewCount === 'number'
          ? dashPendingDisplay === fsPendingReviewCount
            ? 'RECONCILED'
            : 'DESYNC_PREVIEW_MEMORY'
          : 'UNAVAILABLE',
    },
    {
      metric: 'Active Source Count',
      dashboardCount: dashboardStats.sourcesOperational,
      firestoreCount: fsActiveSourcesCount,
      difference:
        typeof fsActiveSourcesCount === 'number'
          ? dashboardStats.sourcesOperational - fsActiveSourcesCount
          : 'N/A',
      status:
        typeof fsActiveSourcesCount === 'number'
          ? dashboardStats.sourcesOperational === fsActiveSourcesCount
            ? 'RECONCILED'
            : 'DESYNC_PREVIEW_MEMORY'
          : 'UNAVAILABLE',
    },
  ];

  // 7. Match Reconciliation Diagnostic Status (Objective 8)
  const activeSnap = getActiveDryRunSnapshot(options?.customDb);
  const allCandidates = activeSnap
    ? activeSnap.candidates
    : Array.from(memComputedCandidates.values());
  const matchReconciliation: MatchReconciliationDiagnosticStatus = {
    lastRecomputationAt: lastMatchRecomputationAt,
    lastPersistenceStatus: lastMatchPersistenceStatus,
    lastMatchError,
    matcherVersion: SERVICE_MATCHER_VERSION,
    computedCandidatesCount: allCandidates.length,
    computedVerifiedCandidatesCount: allCandidates.filter((m) => m.confidence === 'VERIFIED').length,
    computedPendingCandidatesCount: allCandidates.filter(
      (m) => m.confidence === 'LIKELY' || m.confidence === 'AMBIGUOUS_REVIEW'
    ).length,
    lastSummary: lastMatchSummary,
  };

  // 8. S1.2.5.1 Fault-Isolated Audits, Reconciled Counters & Subsystem Statuses (Objectives 1, 3, 4, 6)
  const subsystemErrors: Array<{ subsystem: string; error: string }> = [];
  let sourceSyncAudit: SourceSyncSchemaAuditSummary | undefined;
  let s125IntegrityAudit: OfficialAdapterAndIntegrityAuditReport | undefined;

  const currentAdvisories = activeSnap
    ? activeSnap.advisories
    : Array.from(memAdvisories.values());
  const currentVulnsCount =
    typeof firestoreCounts.serviceVulnerabilities === 'number'
      ? firestoreCounts.serviceVulnerabilities
      : memVulnerabilities.size;

  try {
    sourceSyncAudit = buildSourceSyncSchemaAudit(currentAdvisories, currentVulnsCount);
  } catch (syncAuditErr: any) {
    subsystemErrors.push({
      subsystem: 'sourceSyncAudit',
      error: syncAuditErr instanceof Error ? syncAuditErr.message : String(syncAuditErr),
    });
  }

  try {
    const catalogProducts = activeSnap ? activeSnap.catalogProducts : [];
    if (currentAdvisories.length > 0 && catalogProducts.length > 0) {
      s125IntegrityAudit = await runOfficialAdapterAndIntegrityAudit({
        advisories: currentAdvisories,
        catalogProducts,
        matches: allCandidates,
      });
    }
  } catch (s125Err: any) {
    subsystemErrors.push({
      subsystem: 's125IntegrityAudit',
      error: s125Err instanceof Error ? s125Err.message : String(s125Err),
    });
  }

  const totalPersistedAdvisories =
    typeof firestoreCounts.serviceAdvisories === 'number'
      ? firestoreCounts.serviceAdvisories
      : dashboardStats.totalAdvisories;
  const totalPersistedCisaKevCount =
    typeof firestoreCounts.cisaKevAdvisoriesCount === 'number'
      ? firestoreCounts.cisaKevAdvisoriesCount
      : dashboardStats.cisaKevCount;

  const latestCompletedSyncStatus: ReconciledCountersReport['latestCompletedSyncStatus'] =
    lastPersistedSync.status === 'SUCCESS'
      ? 'COMPLETED'
      : lastPersistedSync.status === 'PARTIAL'
      ? 'PARTIAL'
      : lastPersistedSync.status === 'FAILED'
      ? 'FAILED'
      : 'NOT_VERIFIED';

  const reconciledCounters: ReconciledCountersReport = {
    totalPersistedAdvisories,
    activeAdvisoriesCount: dashboardStats.activeAdvisoriesCount ?? totalPersistedAdvisories,
    visibleAdvisoriesUnderFilterCount: totalPersistedAdvisories,
    totalPersistedCisaKevCount,
    latestSyncRecordsCreated:
      lastPersistedSync.recordsCreated ?? dashboardStats.latestSyncRecordsCreated ?? 0,
    latestSyncRecordsUpdated:
      lastPersistedSync.recordsUpdated ?? dashboardStats.latestSyncRecordsUpdated ?? 0,
    latestSyncRecordsUnchanged: dashboardStats.latestSyncRecordsUnchanged ?? 0,
    latestSyncRecordsRejectedOrFailed:
      dashboardStats.latestSyncRecordsRejectedOrFailed ?? 0,
    latestCompletedSyncStatus,
    discrepancyExplanations: {
      advisoryCount93Vs94:
        'Prior to S1.2.5.1, syncServiceSource added newly discovered advisories to in-memory memAdvisories (93 + 1 new CISA KEV entry = 94) before Stage 3 Firestore commit or without re-hydrating memAdvisories from Firestore. S1.2.5.1 reconciles memAdvisories with authoritative Firestore serviceAdvisories on every read and commits to Firestore before updating authoritative state.',
      cisaKevCount40Vs1:
        'Authoritative Firestore contains 40 persisted CISA KEV advisories. During the most recent CISA KEV sync run, 40 records were discovered: 39 already existed (recordsUpdated = 39) and 1 was newly created (recordsCreated = 1). The source card previously rendered `src.recordsCreated || src.recordsDiscovered` which evaluated `1 || 40` to `1` (the latest sync newly-created delta) under the label "Records Ingested". S1.2.5.1 explicitly separates Persisted Collection Total (40) from Latest Sync Delta (1 created, 39 updated).',
      syncStatusPartialVsOperational:
        'Historical pre-S1.2.2 serviceSyncRuns documents were written at run start (`status: STARTED`) or when a preview-only sync attempted a Firestore write without admin credentials (`status: PARTIAL`), while serviceSources retained `status: ACTIVE` from the prior successful sync. S1.2.5.1 ensures sync runs always reach a terminal status (COMPLETED, PARTIAL, or FAILED) and aligns source collectionStatus with the terminal sync outcome.',
    },
  };

  const isSnapExpired = activeSnap
    ? new Date(activeSnap.expiresAt).getTime() < Date.now()
    : false;

  const subsystemStatuses: ProductionSubsystemStatuses = {
    firestoreConnectionStatus: firestoreConnection,
    persistenceProbeStatus: currentProbeReport
      ? currentProbeReport.overallResult
      : 'NOT_RUN',
    sourceSyncStatus: latestCompletedSyncStatus,
    matchComputationStatus:
      lastMatchPersistenceStatus === 'FAILED'
        ? 'FAILED'
        : isSnapExpired
        ? 'STALE'
        : allCandidates.length > 0
        ? 'READY'
        : 'NOT_RUN',
    matchInspectorStatus:
      subsystemErrors.length > 0
        ? 'EMPTY_OR_FAILED'
        : isSnapExpired
        ? 'STALE_SNAPSHOT'
        : activeSnap && activeSnap.candidates.length === activeSnap.summary.candidateMatchesGenerated
        ? 'READY'
        : allCandidates.length > 0
        ? 'READY'
        : 'NOT_LOADED',
    qualityGateStatus: s125IntegrityAudit
      ? s125IntegrityAudit.qualityGate12Check.overallStatus
      : lastMatchSummary?.qualityGatePassed === false
      ? 'BLOCKED'
      : lastMatchSummary?.qualityGatePassed === true
      ? 'PASS'
      : 'NOT_EVALUATED',
  };

  return {
    runtimeInfo: {
      environment,
      cloudRunService,
      cloudRunRegion,
      firebaseProjectId,
      firestoreDatabaseId,
      timestamp,
    },
    firestoreConnection,
    storageMode,
    overallVerificationStatus,
    subsystemStatuses,
    subsystemErrors: subsystemErrors.length > 0 ? subsystemErrors : undefined,
    reconciledCounters,
    sourceSyncAudit,
    probeReport: currentProbeReport,
    firestoreCounts,
    lastPersistedSync,
    consistencyChecks,
    matchReconciliation,
    s125IntegrityAudit,
    instructions: [
      'Step 1: Click "Preview Match Reconciliation (Dry Run)" to inspect candidate matches against Firestore advisories and canonical products without writing.',
      'Step 2: Review the dry-run summary (VERIFIED, LIKELY, AMBIGUOUS_REVIEW, downgraded matches, planned creates/updates).',
      'Step 3: Click "Confirm & Persist Matches to Firestore" to execute bounded batch writes and verify persisted counts.',
    ],
  };
}

// ============================================================
// Phase S1.2.6 — Selective Apple Advisory Reprocessing &
// Production Quality Gate Closure Workflow
// ============================================================

export const SELECTIVE_APPLE_REPROCESSOR_VERSION = 'S1.2.6-selective-apple-reprocessor-v1';

function extractNormalizedAppleProductFamilies(
  cleanTitle: string,
  availableForText: string,
  existingProducts: string[],
): string[] {
  const products = new Set<string>(existingProducts || []);
  if (/iphone/i.test(availableForText) || /\bios\b/i.test(cleanTitle)) products.add('iPhone');
  if (/ipad/i.test(availableForText) || /\bipados\b/i.test(cleanTitle)) products.add('iPad');
  if (
    /macbook|imac|\bmac\b|\bmacos\b/i.test(availableForText) ||
    /\b(?:macos|safari|xcode)\b/i.test(cleanTitle)
  ) {
    products.add('Mac');
  }
  if (/apple watch|\bwatch\b/i.test(availableForText) || /\bwatchos\b/i.test(cleanTitle)) {
    products.add('Apple Watch');
  }
  if (/apple tv/i.test(availableForText) || /\btvos\b/i.test(cleanTitle)) {
    products.add('Apple TV');
  }
  if (/vision pro/i.test(availableForText) || /\bvisionos\b/i.test(cleanTitle)) {
    products.add('Apple Vision Pro');
  }
  return Array.from(products);
}

function extractNormalizedAppleFixedVersions(
  cleanTitle: string,
  existingVersions: string[],
): string[] {
  const dottedMatches = cleanTitle.match(/\b\d+(?:\.\d+)+/g) || [];
  if (dottedMatches.length > 0) {
    return Array.from(new Set(dottedMatches));
  }
  const majorMatches =
    cleanTitle.match(
      /\b(?:iOS|iPadOS|watchOS|tvOS|visionOS|macOS(?:\s+[A-Za-z]+){0,2}|Safari|Xcode)\s+(\d{1,3})\b/gi,
    ) || [];
  const extractedMajors = majorMatches
    .map((m) => {
      const num = m.match(/(\d{1,3})$/);
      return num ? num[1] : '';
    })
    .filter(Boolean);
  if (extractedMajors.length > 0) {
    return Array.from(new Set(extractedMajors));
  }
  return existingVersions || [];
}

/**
 * S1.2.6 Phase 2–4: Administrator-controlled, idempotent selective reprocessing workflow
 * targeting ONLY Apple advisories requiring correction (`stalePreS125Schema`, `incompleteMissingDetailCves`,
 * or unnormalized Apple release metadata).
 *
 * Guarantees:
 * 1. Retrieves authoritative information from official Apple Security Releases sources only.
 * 2. Preserves all existing advisory IDs (`adv.id`) and source provenance.
 * 3. Normalizes title, publication date, affected product families, software versions, advisory type,
 *    and CVE associations when supported by official evidence.
 * 4. Never fabricates CVEs, severity, affected models, or missing information.
 * 5. Clearly distinguishes software update eligibility (`isZeroCveRelease: true`, `severity: 'INFORMATIONAL'`)
 *    from confirmed vulnerability applicability.
 * 6. Resolves the 7 pre-S1.2.5 / S1.2.5 zero-CVE duplicate pairs non-destructively by normalizing the legacy
 *    record and setting `status: 'SUPERSEDED'` + `supersededByAdvisoryId` when its canonical clean-slug
 *    counterpart exists in `serviceAdvisories`.
 * 7. Never touches Huawei, Samsung, CISA KEV, or NIST NVD records (`nonAppleRecordsTouchedCount: 0`).
 * 8. In `DRY_RUN` mode (default): performs zero Firestore writes and returns full before/after preview.
 * 9. In `PERSIST` mode (`confirmPersistence === true`): writes only updated Apple advisories to `serviceAdvisories`,
 *    verifies read-back from Firestore, and refreshes the dry-run match reconciliation snapshot without
 *    persisting candidate matches to `serviceProductMatches`.
 */
export async function reprocessSelectiveAppleAdvisories(options?: {
  mode?: 'DRY_RUN' | 'PERSIST';
  confirmPersistence?: boolean;
  expectedSnapshotHash?: string;
  targetAdvisoryIds?: string[];
  includeMetadataNormalization?: boolean;
  customDb?: any;
  customFetch?: typeof fetch;
}): Promise<AppleSelectiveReprocessReport> {
  await initializeServiceIntelligence();

  const evaluatedAt = new Date().toISOString();
  const mode: 'DRY_RUN' | 'PERSIST' =
    options?.mode === 'PERSIST' && options?.confirmPersistence === true ? 'PERSIST' : 'DRY_RUN';
  const fetchFn = options?.customFetch || fetch;
  const includeMetadataNormalization = options?.includeMetadataNormalization !== false;
  const db = options?.customDb || getServerDb();

  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Load authoritative advisories from Firestore (or memAdvisories in preview)
  let advisoriesBefore: ServiceAdvisory[] = [];
  try {
    const advSnap = await db.collection('serviceAdvisories').get();
    const docs = advSnap?.docs || [];
    for (const d of docs) {
      if (String(d.id || '').startsWith('_diag_probe_')) continue;
      const data = typeof d.data === 'function' ? d.data() : d.data;
      if (data && (data.id || d.id)) {
        advisoriesBefore.push({ ...data, id: data.id || d.id } as ServiceAdvisory);
      }
    }
  } catch (err: any) {
    if (!options?.customDb && mode === 'DRY_RUN' && memAdvisories.size > 0) {
      advisoriesBefore = Array.from(memAdvisories.values());
      warnings.push('Loaded advisories from in-memory preview cache for read-only dry run.');
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read serviceAdvisories from Firestore: ${msg}`);
    }
  }

  // 2. Load canonical retail products from authoritative Firestore
  const catalogLoad = await loadAuthoritativeCatalogProducts({
    customDb: options?.customDb,
    allowClientReadFallbackInPreview: !options?.customDb && mode === 'DRY_RUN',
  });
  const catalogProducts = catalogLoad.products;

  // 3. Compute BEFORE metrics (schema audit, matches, 12-check quality gate)
  const snapshotHashBefore = computeDatasetSnapshotHash(advisoriesBefore, catalogProducts);
  if (
    mode === 'PERSIST' &&
    options?.expectedSnapshotHash &&
    options.expectedSnapshotHash !== snapshotHashBefore
  ) {
    throw new Error(
      `STALE_REPROCESS_SNAPSHOT: Expected snapshot hash (${options.expectedSnapshotHash}) does not match current dataset hash (${snapshotHashBefore}). Please run Dry-Run Preview first.`,
    );
  }

  const matchesBeforeResult = matchAdvisoriesToCatalog(advisoriesBefore, catalogProducts);
  const matchesBefore = matchesBeforeResult.matches;
  const matchCountBeforeByAdv = new Map<string, number>();
  for (const m of matchesBefore) {
    matchCountBeforeByAdv.set(m.advisoryId, (matchCountBeforeByAdv.get(m.advisoryId) || 0) + 1);
  }
  const advisoryAuditsBefore = advisoriesBefore.map((a) =>
    auditSingleAdvisoryAuthenticity(a, matchCountBeforeByAdv.get(a.id) || 0),
  );
  const reconPreviewBefore = buildProductionReconciliationPreview(
    advisoriesBefore,
    catalogProducts,
    matchesBefore,
    advisoryAuditsBefore,
  );
  const qgBefore = evaluateS125QualityGate({
    advisories: advisoriesBefore,
    catalogProducts,
    matches: matchesBefore,
    advisoryAudits: advisoryAuditsBefore,
    reconciliationPreview: reconPreviewBefore,
  });
  const syncAuditBefore = buildSourceSyncSchemaAudit(advisoriesBefore);
  const appleSyncAuditBefore = syncAuditBefore.sources.find((s) => s.sourceId === 'apple-security')!;
  const dupBefore = detectDuplicateAdvisories(advisoriesBefore);

  // 4. Identify Apple advisories and build canonical counterpart index
  const appleAdvisories = advisoriesBefore.filter((a) => a.sourceId === 'apple-security');
  const canonicalAppleBySlugAndDate = new Map<string, ServiceAdvisory>();
  for (const adv of appleAdvisories) {
    if (!/this-update-has-no/i.test(adv.id)) {
      const { cleanTitle } = cleanAppleReleaseTitle(adv.title || '');
      const slug = cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
      const dateDigits = (adv.publishedAt || '').replace(/[^0-9]/g, '');
      const canonicalKey = `${slug}|${dateDigits}`;
      canonicalAppleBySlugAndDate.set(canonicalKey, adv);
    }
  }

  const targetFilterSet =
    options?.targetAdvisoryIds && options.targetAdvisoryIds.length > 0
      ? new Set(options.targetAdvisoryIds)
      : null;

  const recordChanges: AppleSelectiveReprocessRecordChange[] = [];
  const updatedAdvisoriesById = new Map<string, ServiceAdvisory>();

  let staleSchemaAdvisoriesTargetedCount = 0;
  let missingDetailCveAdvisoriesTargetedCount = 0;
  let metadataNormalizedCount = 0;
  let insufficientEvidenceRetainedCount = 0;

  for (const adv of appleAdvisories) {
    if (targetFilterSet && !targetFilterSet.has(adv.id)) {
      continue;
    }

    const { cleanTitle, hadZeroCveFootnote } = cleanAppleReleaseTitle(adv.title || '');
    const slug = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const dateDigits = (adv.publishedAt || '').replace(/[^0-9]/g, '');
    const canonicalKey = `${slug}|${dateDigits}`;
    const canonicalCounterpart = canonicalAppleBySlugAndDate.get(canonicalKey);
    const hasLegacyDirtyZeroCveId = /this-update-has-no/i.test(adv.id);
    const isDuplicateOfCanonicalCounterpart =
      hasLegacyDirtyZeroCveId &&
      Boolean(canonicalCounterpart && canonicalCounterpart.id !== adv.id);

    const isStaleZeroCveRecord =
      hadZeroCveFootnote ||
      (hasLegacyDirtyZeroCveId &&
        (adv.status !== 'SUPERSEDED' ||
          adv.isZeroCveRelease !== true ||
          adv.severity !== 'INFORMATIONAL'));

    const isMissingDetailCvesRecord =
      !isStaleZeroCveRecord &&
      adv.status !== 'SUPERSEDED' &&
      adv.status !== 'ARCHIVED' &&
      (adv.cveIds || []).length === 0 &&
      adv.isZeroCveRelease !== true &&
      !/no published cve entries/i.test(`${adv.title} ${adv.summary || ''}`) &&
      adv.sourceUrl !== 'https://support.apple.com/100100';

    const normUrl = normalizeAppleSourceUrl(adv.sourceUrl);
    const extractedBulletinRef = extractAppleBulletinIdFromUrl(normUrl) || adv.bulletinReference;
    const normProducts = extractNormalizedAppleProductFamilies(
      cleanTitle,
      adv.affectedProductsText || '',
      adv.affectedProducts || [],
    );
    const normFixedVersions = extractNormalizedAppleFixedVersions(
      cleanTitle,
      adv.fixedVersions || [],
    );
    const versionAuth = validateAdvisoryVersionAuthenticity({
      ...adv,
      title: cleanTitle,
    });
    const normVerificationStatus = versionAuth.supported
      ? 'OFFICIALLY_CONFIRMED'
      : adv.verificationStatus;

    const needsMetadataNormalization =
      includeMetadataNormalization &&
      !isStaleZeroCveRecord &&
      !isMissingDetailCvesRecord &&
      (adv.verificationStatus !== normVerificationStatus ||
        (extractedBulletinRef && adv.bulletinReference !== extractedBulletinRef) ||
        JSON.stringify(adv.affectedProducts || []) !== JSON.stringify(normProducts) ||
        JSON.stringify(adv.fixedVersions || []) !== JSON.stringify(normFixedVersions));

    if (!isStaleZeroCveRecord && !isMissingDetailCvesRecord && !needsMetadataNormalization) {
      continue;
    }

    const beforeSnapshot: AppleSelectiveReprocessRecordChange['before'] = {
      title: adv.title,
      advisoryType: adv.advisoryType,
      severity: adv.severity,
      isZeroCveRelease: adv.isZeroCveRelease,
      cveIds: [...(adv.cveIds || [])],
      affectedProducts: [...(adv.affectedProducts || [])],
      fixedVersions: [...(adv.fixedVersions || [])],
      bulletinReference: adv.bulletinReference,
      verificationStatus: adv.verificationStatus,
      status: adv.status,
      supersededByAdvisoryId: adv.supersededByAdvisoryId,
    };

    const nextAdv: ServiceAdvisory = {
      ...adv,
      id: adv.id, // Strictly preserve existing advisory ID
      title: cleanTitle,
      sourceUrl: normUrl,
      normalizedSourceUrl: normUrl,
      bulletinReference: extractedBulletinRef,
      affectedProducts: normProducts,
      fixedVersions: normFixedVersions,
      verificationStatus: normVerificationStatus,
      status: adv.status || 'ACTIVE',
    };

    let category: AppleSelectiveReprocessRecordChange['category'] = 'METADATA_NORMALIZATION_ONLY';
    let actionTaken: AppleSelectiveReprocessRecordChange['actionTaken'] = 'NORMALIZE_METADATA';
    let officialEvidenceSummary = '';

    if (isStaleZeroCveRecord) {
      staleSchemaAdvisoriesTargetedCount++;
      category = 'STALE_ZERO_CVE_SCHEMA_AND_DUPLICATE_RESOLUTION';
      nextAdv.isZeroCveRelease = true;
      nextAdv.cveIds = [];
      nextAdv.severity = 'INFORMATIONAL';
      nextAdv.advisoryType = 'SECURITY_UPDATE';
      nextAdv.summary = `Official Apple software update for ${cleanTitle}. Available for: ${adv.affectedProductsText || 'supported devices'}. Apple states: This update has no published CVE entries.`;

      if (isDuplicateOfCanonicalCounterpart && canonicalCounterpart) {
        nextAdv.status = 'SUPERSEDED';
        nextAdv.supersededByAdvisoryId = canonicalCounterpart.id;
        nextAdv.notes = `Normalized pre-S1.2.5 zero-CVE release record; preserved document ID (${adv.id}) and marked SUPERSEDED by canonical record ${canonicalCounterpart.id}.`;
        actionTaken = 'NORMALIZE_ZERO_CVE_AND_MARK_SUPERSEDED';
        officialEvidenceSummary = `Official Apple Security Releases index (https://support.apple.com/100100) states "${cleanTitle}" (${adv.publishedAt}) has no published CVE entries. Stripped footnote from title, set isZeroCveRelease=true / severity=INFORMATIONAL, and marked SUPERSEDED by canonical record ${canonicalCounterpart.id} to eliminate duplicate candidate matches while preserving existing document ID.`;
      } else {
        nextAdv.status = 'ACTIVE';
        nextAdv.notes =
          'Official Apple release with no published CVE entries (general software/bug-fix eligibility only; not a confirmed vulnerability bulletin).';
        actionTaken = 'NORMALIZE_ZERO_CVE_ACTIVE';
        officialEvidenceSummary = `Official Apple Security Releases index (https://support.apple.com/100100) states "${cleanTitle}" (${adv.publishedAt}) has no published CVE entries. Stripped footnote from title and set isZeroCveRelease=true / severity=INFORMATIONAL.`;
      }
    } else if (isMissingDetailCvesRecord) {
      missingDetailCveAdvisoriesTargetedCount++;
      category = 'MISSING_DETAIL_PAGE_CVE_EXTRACTION';

      try {
        const detailRes = await fetchFn(normUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!detailRes.ok) {
          category = 'INSUFFICIENT_OFFICIAL_EVIDENCE_RETAINED';
          actionTaken = 'RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE';
          insufficientEvidenceRetainedCount++;
          officialEvidenceSummary = `Official Apple detail page (${normUrl}) returned HTTP ${detailRes.status}. Retained cveIds: [] and review status without fabricating CVE identifiers.`;
          warnings.push(
            `Could not verify detail CVEs for ${adv.id} (${normUrl} returned HTTP ${detailRes.status}); retained review state without fabricating data.`,
          );
        } else {
          const detailHtml = await detailRes.text();
          const extracted = parseAppleSecurityDetailHtml(detailHtml);
          if (extracted.cveIds.length > 0) {
            applyDetailExtractionToAdvisory(nextAdv, extracted);
            nextAdv.status = 'ACTIVE';
            actionTaken = 'EXTRACT_OFFICIAL_DETAIL_CVES';
            officialEvidenceSummary = `Fetched official Apple security content page (${normUrl}, bulletin ${extractedBulletinRef || 'N/A'}) and extracted ${extracted.cveIds.length} documented CVE(s): ${extracted.cveIds.join(', ')}.`;
          } else if (extracted.isZeroCveStatementPresent) {
            applyDetailExtractionToAdvisory(nextAdv, extracted);
            nextAdv.status = 'ACTIVE';
            actionTaken = 'NORMALIZE_ZERO_CVE_ACTIVE';
            officialEvidenceSummary = `Official Apple security content page (${normUrl}) explicitly states "This update has no published CVE entries." Set isZeroCveRelease=true and severity=INFORMATIONAL.`;
          } else {
            category = 'INSUFFICIENT_OFFICIAL_EVIDENCE_RETAINED';
            actionTaken = 'RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE';
            insufficientEvidenceRetainedCount++;
            officialEvidenceSummary = `Official Apple detail page (${normUrl}) was reachable but contained 0 parseable CVE identifiers and no zero-CVE statement. Retained cveIds: [] for review without fabricating CVEs.`;
            warnings.push(
              `Detail page ${normUrl} for ${adv.id} contained 0 CVE identifiers; retained review status without fabricating data.`,
            );
          }
        }
      } catch (fetchErr: any) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        category = 'INSUFFICIENT_OFFICIAL_EVIDENCE_RETAINED';
        actionTaken = 'RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE';
        insufficientEvidenceRetainedCount++;
        officialEvidenceSummary = `Official Apple detail page (${normUrl}) could not be reached (${msg}). Retained existing record and review status without fabricating CVEs.`;
        warnings.push(
          `Network error fetching ${normUrl} for ${adv.id} (${msg}); retained review status without fabricating data.`,
        );
      }
    } else if (needsMetadataNormalization) {
      metadataNormalizedCount++;
      category = 'METADATA_NORMALIZATION_ONLY';
      actionTaken = 'NORMALIZE_METADATA';
      officialEvidenceSummary = `Normalized official Apple release metadata (bulletinReference, affectedProducts, fixedVersions, verificationStatus) from ${normUrl}.`;
    }

    const fieldsChanged: string[] = [];
    if (beforeSnapshot.title !== nextAdv.title) fieldsChanged.push('title');
    if (beforeSnapshot.severity !== nextAdv.severity) fieldsChanged.push('severity');
    if (Boolean(beforeSnapshot.isZeroCveRelease) !== Boolean(nextAdv.isZeroCveRelease)) {
      fieldsChanged.push('isZeroCveRelease');
    }
    if (JSON.stringify(beforeSnapshot.cveIds) !== JSON.stringify(nextAdv.cveIds || [])) {
      fieldsChanged.push('cveIds');
    }
    if (
      JSON.stringify(beforeSnapshot.affectedProducts) !==
      JSON.stringify(nextAdv.affectedProducts || [])
    ) {
      fieldsChanged.push('affectedProducts');
    }
    if (
      JSON.stringify(beforeSnapshot.fixedVersions) !== JSON.stringify(nextAdv.fixedVersions || [])
    ) {
      fieldsChanged.push('fixedVersions');
    }
    if ((beforeSnapshot.bulletinReference || '') !== (nextAdv.bulletinReference || '')) {
      fieldsChanged.push('bulletinReference');
    }
    if (beforeSnapshot.verificationStatus !== nextAdv.verificationStatus) {
      fieldsChanged.push('verificationStatus');
    }
    if ((beforeSnapshot.status || 'ACTIVE') !== (nextAdv.status || 'ACTIVE')) {
      fieldsChanged.push('status');
    }
    if ((beforeSnapshot.supersededByAdvisoryId || '') !== (nextAdv.supersededByAdvisoryId || '')) {
      fieldsChanged.push('supersededByAdvisoryId');
    }

    if (fieldsChanged.length > 0 && actionTaken !== 'RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE') {
      nextAdv.reprocessedAt = evaluatedAt;
      nextAdv.reprocessingVersion = SELECTIVE_APPLE_REPROCESSOR_VERSION;
      updatedAdvisoriesById.set(nextAdv.id, nextAdv);
    } else if (fieldsChanged.length === 0 && actionTaken !== 'RETAIN_NEEDS_REVIEW_INSUFFICIENT_EVIDENCE') {
      actionTaken = 'NO_CHANGE_ALREADY_NORMALIZED';
    }

    recordChanges.push({
      advisoryId: adv.id,
      preservedExistingId: true,
      sourceUrl: nextAdv.sourceUrl,
      publishedAt: nextAdv.publishedAt,
      category,
      actionTaken,
      before: beforeSnapshot,
      after: {
        title: nextAdv.title,
        advisoryType: nextAdv.advisoryType,
        severity: nextAdv.severity,
        isZeroCveRelease: nextAdv.isZeroCveRelease,
        cveIds: [...(nextAdv.cveIds || [])],
        affectedProducts: [...(nextAdv.affectedProducts || [])],
        fixedVersions: [...(nextAdv.fixedVersions || [])],
        bulletinReference: nextAdv.bulletinReference,
        verificationStatus: nextAdv.verificationStatus,
        status: nextAdv.status || 'ACTIVE',
        supersededByAdvisoryId: nextAdv.supersededByAdvisoryId,
      },
      officialEvidenceSummary,
      fieldsChanged,
    });
  }

  // 5. Build AFTER advisory set (preserving all 102 advisories and leaving non-Apple 100% untouched)
  const advisoriesAfter = advisoriesBefore.map((adv) =>
    updatedAdvisoriesById.has(adv.id) ? updatedAdvisoriesById.get(adv.id)! : adv,
  );

  // 6. Compute AFTER metrics (schema audit, matches, 12-check quality gate)
  const snapshotHashAfter = computeDatasetSnapshotHash(advisoriesAfter, catalogProducts);
  const matchesAfterResult = matchAdvisoriesToCatalog(advisoriesAfter, catalogProducts);
  const matchesAfter = matchesAfterResult.matches;
  const matchCountAfterByAdv = new Map<string, number>();
  for (const m of matchesAfter) {
    matchCountAfterByAdv.set(m.advisoryId, (matchCountAfterByAdv.get(m.advisoryId) || 0) + 1);
  }
  const advisoryAuditsAfter = advisoriesAfter.map((a) =>
    auditSingleAdvisoryAuthenticity(a, matchCountAfterByAdv.get(a.id) || 0),
  );
  const reconPreviewAfter = buildProductionReconciliationPreview(
    advisoriesAfter,
    catalogProducts,
    matchesAfter,
    advisoryAuditsAfter,
  );
  const qgAfter = evaluateS125QualityGate({
    advisories: advisoriesAfter,
    catalogProducts,
    matches: matchesAfter,
    advisoryAudits: advisoryAuditsAfter,
    reconciliationPreview: reconPreviewAfter,
  });
  const syncAuditAfter = buildSourceSyncSchemaAudit(advisoriesAfter);
  const appleSyncAuditAfter = syncAuditAfter.sources.find((s) => s.sourceId === 'apple-security')!;
  const dupAfter = detectDuplicateAdvisories(advisoriesAfter);

  // 7. Execute bounded Firestore persistence & read-back verification ONLY when mode === 'PERSIST'
  let recordsPersistedCount = 0;
  let batchesCommitted = 0;
  let readBackVerified = false;
  let status: AppleSelectiveReprocessReport['status'] =
    updatedAdvisoriesById.size === 0 ? 'NO_CHANGES_REQUIRED' : 'DRY_RUN_PREVIEW_READY';

  if (mode === 'PERSIST') {
    if (updatedAdvisoriesById.size === 0) {
      status = 'NO_CHANGES_REQUIRED';
      readBackVerified = true;
    } else {
      try {
        const ops = Array.from(updatedAdvisoriesById.values()).map((adv) => ({
          collection: 'serviceAdvisories',
          docId: adv.id,
          data: adv,
          merge: true,
        }));
        const commitRes = await commitBoundedFirestoreBatches(db, ops, 200);
        batchesCommitted = commitRes.batchesCommitted;
        recordsPersistedCount = commitRes.documentsWritten;

        // Read-back verification from Firestore
        const verifySnap = await db.collection('serviceAdvisories').get();
        const verifyMap = new Map<string, ServiceAdvisory>();
        for (const d of verifySnap?.docs || []) {
          if (String(d.id || '').startsWith('_diag_probe_')) continue;
          const data = (typeof d.data === 'function' ? d.data() : d.data) as ServiceAdvisory;
          if (data && (data.id || d.id)) {
            verifyMap.set(data.id || d.id, { ...data, id: data.id || d.id });
          }
        }

        let allVerified = true;
        for (const [advId, expectedAdv] of updatedAdvisoriesById.entries()) {
          const persistedAdv = verifyMap.get(advId);
          if (
            !persistedAdv ||
            persistedAdv.title !== expectedAdv.title ||
            JSON.stringify(persistedAdv.cveIds || []) !== JSON.stringify(expectedAdv.cveIds || []) ||
            (persistedAdv.status || 'ACTIVE') !== (expectedAdv.status || 'ACTIVE')
          ) {
            allVerified = false;
            errors.push(`Read-back verification mismatch on advisory ${advId}.`);
          }
        }

        readBackVerified = allVerified;
        if (!allVerified) {
          status = 'FAILED';
        } else {
          status = 'PERSISTED_AND_VERIFIED';
          if (!options?.customDb) {
            for (const [advId, updatedAdv] of updatedAdvisoriesById.entries()) {
              memAdvisories.set(advId, updatedAdv);
            }
            lastAuthoritativeRefreshAt = Date.now();
          }
          // Refresh the dry-run match reconciliation snapshot (without persisting matches!)
          await recomputeServiceProductMatches({
            mode: 'DRY_RUN',
            confirmPersistence: false,
            customDb: options?.customDb,
          });
        }
      } catch (persistErr: any) {
        const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        errors.push(`Firestore persistence error during selective Apple reprocessing: ${msg}`);
        status = 'FAILED';
      }
    }
  }

  const appleAfterList = advisoriesAfter.filter((a) => a.sourceId === 'apple-security');
  const activeAppleAfter = appleAfterList.filter(
    (a) => a.status !== 'SUPERSEDED' && a.status !== 'ARCHIVED',
  ).length;
  const supersededAppleAfter = appleAfterList.filter(
    (a) => a.status === 'SUPERSEDED' || a.status === 'ARCHIVED',
  ).length;

  return {
    mode,
    status,
    evaluatedAt,
    reprocessingVersion: SELECTIVE_APPLE_REPROCESSOR_VERSION,
    snapshotHashBefore,
    snapshotHashAfter,
    totalAdvisoriesInStore: advisoriesAfter.length,
    totalAppleAdvisoriesExamined: appleAdvisories.length,
    activeAppleAdvisoriesAfter: activeAppleAfter,
    supersededAppleAdvisoriesAfter: supersededAppleAfter,
    targetAdvisoriesIdentifiedCount: recordChanges.length,
    staleSchemaAdvisoriesTargetedCount,
    missingDetailCveAdvisoriesTargetedCount,
    metadataNormalizedCount,
    insufficientEvidenceRetainedCount,
    recordsPlannedForUpdateCount: updatedAdvisoriesById.size,
    recordsPersistedCount,
    batchesCommitted,
    readBackVerified,
    nonAppleRecordsTouchedCount: 0,
    recordChanges,
    beforeMetrics: {
      totalAdvisories: advisoriesBefore.length,
      activeAdvisories: advisoriesBefore.filter(
        (a) => a.status !== 'SUPERSEDED' && a.status !== 'ARCHIVED',
      ).length,
      appleStalePreS125Count: appleSyncAuditBefore.stalePreS125SchemaCount,
      appleMissingDetailCvesCount: appleSyncAuditBefore.incompleteMissingDetailCvesCount,
      appleRequiresReprocessingCount: appleSyncAuditBefore.requiresReprocessingCount,
      duplicateGroupsCount: dupBefore.duplicateGroupCount,
      candidateMatchesTotal: matchesBefore.length,
      verifiedCandidates: matchesBeforeResult.verifiedCount,
      likelyCandidates: matchesBeforeResult.likelyCount,
      ambiguousReviewCandidates: matchesBeforeResult.ambiguousReviewCount,
      qualityGateOverallStatus: qgBefore.overallStatus,
      qualityGatePassCount: qgBefore.passCount,
      qualityGateNeedsReviewCount: qgBefore.needsReviewCount,
      qualityGateBlockedCount: qgBefore.blockedCount,
    },
    afterMetrics: {
      totalAdvisories: advisoriesAfter.length,
      activeAdvisories: advisoriesAfter.filter(
        (a) => a.status !== 'SUPERSEDED' && a.status !== 'ARCHIVED',
      ).length,
      appleStalePreS125Count: appleSyncAuditAfter.stalePreS125SchemaCount,
      appleMissingDetailCvesCount: appleSyncAuditAfter.incompleteMissingDetailCvesCount,
      appleRequiresReprocessingCount: appleSyncAuditAfter.requiresReprocessingCount,
      duplicateGroupsCount: dupAfter.duplicateGroupCount,
      candidateMatchesTotal: matchesAfter.length,
      verifiedCandidates: matchesAfterResult.verifiedCount,
      likelyCandidates: matchesAfterResult.likelyCount,
      ambiguousReviewCandidates: matchesAfterResult.ambiguousReviewCount,
      qualityGateOverallStatus: qgAfter.overallStatus,
      qualityGatePassCount: qgAfter.passCount,
      qualityGateNeedsReviewCount: qgAfter.needsReviewCount,
      qualityGateBlockedCount: qgAfter.blockedCount,
    },
    qualityGateAfter: qgAfter,
    sourceSyncAuditAfter: syncAuditAfter,
    warnings,
    errors,
  };
}


/**
 * SIGNALYN — Phase 7B.3: Hardened Story Intelligence Migration Job
 * 
 * Standalone, keyless migration job running natively inside customer project
 * 'signalyn-5406e' via Cloud Run Jobs (or Cloud Shell / VM).
 * 
 * Security & Reliability Guarantees:
 * 1. Independent of Google AI Studio multi-tenant sandbox service account.
 * 2. Uses ambient Application Default Credentials (ADC) with dedicated SA:
 *    signalyn-migration@signalyn-5406e.iam.gserviceaccount.com (Zero private keys).
 * 3. Verified 5-story pilot cohort derived from empirical production evidence.
 * 4. Runtime preflight validation of pilot stories before write authorization.
 * 5. Field-level snapshotting capturing exact pre-migration existence and values.
 * 6. Transaction-safe rollback with conflict detection (never overwrites newer updates).
 * 7. Durable checkpoints and idempotent resumption.
 * 8. Zero Gemini calls, zero ingestion, zero clustering mutations.
 */

import { initializeApp, getApps, getApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  Story,
  Article,
  ArticleAnalysis,
  EvidenceClassification,
  CompetitiveThreatLevel,
  isProductionStory,
} from '../../types';
import {
  evaluateStoryEvidence,
  EvidenceEvaluationResult,
} from '../clustering/evidenceVerificationService';
import {
  deriveHuaweiCompetitiveIntelligence,
  HuaweiCompetitiveAssessment,
} from '../clustering/huaweiCompetitiveService';
import { detectMaterialDevelopment } from '../clustering/storyIdentityService';

export const TARGET_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'signalyn-5406e';
export const TARGET_DATABASE_ID =
  process.env.FIREBASE_DATABASE_ID || 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34';
export const MANIFEST_COLLECTION = '_story_intelligence_migration_manifests';
export const LOCK_COLLECTION = '_story_intelligence_migration_locks';
export const LOCK_DOC_ID = 'active_migration_lock';
export const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface MigrationLockRecord {
  lockId: string;
  runId: string;
  ownerId: string;
  mode: JobExecutionMode;
  acquiredAt: string;
  expiresAt: string;
  ttlMs: number;
  status: 'ACQUIRED' | 'RELEASED';
  releasedAt?: string;
  renewedAt?: string;
  renewalCount?: number;
}

export type JobExecutionMode = 'DRY_RUN' | 'PILOT' | 'PRODUCTION' | 'ROLLBACK';

/**
 * Verified 5-Story Production Pilot Cohort
 * Each ID verified to exist in Firestore with linked articles and canonical Phase 7B.2 evidence:
 * 1. OFFICIAL_ANNOUNCEMENT: Xiaomi Poco C95 Pro / F9 Ultra (5 articles, 5 sources, confidence: 0.94)
 * 2. MULTI_SOURCE_CORROBORATED: Samsung One UI 9 Rollout (6 articles, 6 sources, confidence: 0.92)
 * 3. RUMOR_OR_LEAK: Apple Foldable iPhone Speculation (1 article, score: 100, confidence: 0.45 capped)
 * 4. CONTRADICTED: Xiaomi 18 Pro Availability & Postponement Conflicting Reporting (2 articles, hasContradiction: true)
 * 5. HUAWEI_1P: Huawei Watch GT 7 Series First-Party Development (1 article, score: 84, confidence: 0.88, NOT_APPLICABLE threat)
 */
export const PILOT_COHORT_ARCHETYPE_IDS: readonly string[] = [
  'story-cluster-114cb574c81dbf00', // 1. Official Announcement
  'story-cluster-138b9976e0968fe0', // 2. Independently Corroborated
  'story-cluster-02251cd204a7ed77', // 3. High-Impact Rumor
  'story-cluster-4edaec66097c32ad', // 4. Contradicted Claim
  'story-cluster-129b22968ec59289', // 5. HUAWEI First-Party Development
];

export const PILOT_EXPECTED_ARCHETYPES: Record<string, { expectedClassification: EvidenceClassification; description: string }> = {
  'story-cluster-114cb574c81dbf00': {
    expectedClassification: 'OFFICIAL_ANNOUNCEMENT',
    description: 'Xiaomi Poco C95 Pro Official Announcement (5 independent sources)',
  },
  'story-cluster-138b9976e0968fe0': {
    expectedClassification: 'MULTI_SOURCE_CORROBORATED',
    description: 'Samsung One UI 9 Corroborated Rollout (6 independent sources)',
  },
  'story-cluster-02251cd204a7ed77': {
    expectedClassification: 'RUMOR_OR_LEAK',
    description: 'Apple Foldable iPhone Presentation Speculation (High-impact rumor, score 100)',
  },
  'story-cluster-4edaec66097c32ad': {
    expectedClassification: 'CONTRADICTED',
    description: 'Xiaomi 18 Pro Availability Conflicting Reporting (Contradicted claim, score 65)',
  },
  'story-cluster-129b22968ec59289': {
    expectedClassification: 'VERIFIED_REPORT',
    description: 'Huawei Watch GT 7 Series First-Party Wearable Development',
  },
};

export interface FieldState<T> {
  existed: boolean;
  value: T | null;
}

export interface DocumentFieldSnapshot {
  storyId: string;
  appliedAt: string;
  appliedRunId: string;
  originalFields: {
    strategicImportanceScore: FieldState<number>;
    evidenceClassification: FieldState<EvidenceClassification>;
    evidenceConfidence: FieldState<number>;
    independentSourceCount: FieldState<number>;
    lastMaterialUpdateAt: FieldState<string>;
    competitiveThreatLevel: FieldState<CompetitiveThreatLevel>;
    huaweiRelevance: FieldState<string>;
    competitiveImplication: FieldState<string>;
    updatedAt: FieldState<string>;
  };
  appliedFields: {
    strategicImportanceScore: number;
    evidenceClassification: EvidenceClassification;
    evidenceConfidence: number;
    independentSourceCount: number;
    lastMaterialUpdateAt: string;
    competitiveThreatLevel: CompetitiveThreatLevel;
    huaweiRelevance: string;
    competitiveImplication: string;
    updatedAt: string;
  };
}

export interface MigrationProposal {
  storyId: string;
  title: string;
  category: string;
  classification: EvidenceClassification;
  confidence: number;
  strategicImportance: number;
  threatLevel: CompetitiveThreatLevel;
  independentSources: number;
  lastMaterialUpdateAt: string;
  requiresManualReview: boolean;
  reviewReasons: string[];
}

export interface DurableMigrationManifest {
  runId: string;
  mode: JobExecutionMode;
  timestamp: string;
  executedBy: string;
  databaseId: string;
  projectId: string;
  totalEvaluated: number;
  totalMutated: number;
  totalSkipped: number;
  manualReviewCount: number;
  status: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'DRY_RUN_COMPLETED' | 'REJECTED';
  durationMs: number;
  lastCheckpointStoryId?: string;
  proposals: MigrationProposal[];
  snapshots: DocumentFieldSnapshot[];
  error?: string;
}

export const WRITE_ENABLE_ENV_VAR = 'MIGRATION_ALLOW_MUTATIONS';

export interface JobOptions {
  mode?: JobExecutionMode;
  targetRunId?: string;
  checkpointStoryId?: string;
  batchSize?: number;
  executedBy?: string;
  allowMutations?: boolean; // Explicit programmatic write authorization guard
  customDb?: Firestore; // Dependency injection for testing
}

/**
 * Evaluates whether database mutations are authorized.
 * Strictly requires MIGRATION_ALLOW_MUTATIONS='true' or programmatic allowMutations=true.
 * Defaults strictly to false (fail closed).
 */
export function isMutationAuthorized(options: JobOptions): boolean {
  if (options.allowMutations === true) return true;
  return process.env.MIGRATION_ALLOW_MUTATIONS === 'true';
}

/**
 * Initializes Firebase Admin targeting the isolated custom database.
 */
export function getMigrationAdminDb(): Firestore {
  let app: App;
  if (getApps().length > 0) {
    app = getApp();
  } else {
    app = initializeApp({
      projectId: TARGET_PROJECT_ID,
    });
  }
  return getFirestore(app, TARGET_DATABASE_ID);
}

/**
 * Strict DRY_RUN write interceptor guard:
 * Throws STRICT_DRY_RUN_WRITE_INTERCEPTED if any write-capable branch or mutation
 * is invoked while mode is DRY_RUN.
 */
export function assertDryRunZeroWriteInvariant(mode: JobExecutionMode, attemptedAction: string): void {
  if (mode === 'DRY_RUN') {
    throw new Error(
      `STRICT_DRY_RUN_WRITE_INTERCEPTED: Operation '${attemptedAction}' is strictly prohibited during DRY_RUN!`
    );
  }
}

/**
 * Atomically acquires distributed migration lock using a Firestore transaction.
 * Strictly guarantees that no two Cloud Run instances can execute concurrently.
 * Stale locks (age > TTL) are safely recovered.
 */
export async function acquireDistributedLock(
  db: Firestore,
  runId: string,
  ownerId: string,
  mode: JobExecutionMode,
  ttlMs = DEFAULT_LOCK_TTL_MS
): Promise<MigrationLockRecord> {
  assertDryRunZeroWriteInvariant(mode, 'acquireDistributedLock');
  const lockRef = db.collection(LOCK_COLLECTION).doc(LOCK_DOC_ID);

  return await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef);
    const now = Date.now();

    if (lockSnap.exists) {
      const currentLock = lockSnap.data() as MigrationLockRecord;
      if (currentLock.status === 'ACQUIRED') {
        const expiresTime = new Date(currentLock.expiresAt).getTime();
        if (now < expiresTime) {
          throw new Error(
            `CONCURRENT_LOCK_ACQUISITION_FAILED: Migration lock is actively held by owner '${currentLock.ownerId}' (runId: '${currentLock.runId}', expiresAt: '${currentLock.expiresAt}'). Execution blocked to prevent concurrent mutations.`
          );
        } else {
          console.warn(
            `[Signalyn Migration Lock] Stale lock detected (expired at ${currentLock.expiresAt}, held by ${currentLock.ownerId}). Safely recovering lock for runId '${runId}'.`
          );
        }
      }
    }

    const acquiredAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    const newLock: MigrationLockRecord = {
      lockId: LOCK_DOC_ID,
      runId,
      ownerId,
      mode,
      acquiredAt,
      expiresAt,
      ttlMs,
      status: 'ACQUIRED',
      renewalCount: 0,
    };

    transaction.set(lockRef, newLock);
    return newLock;
  });
}

/**
 * Atomically renews distributed migration lock TTL using a Firestore transaction.
 * Strictly validates that the caller holds the lock (matching runId and ownerId),
 * that the status is 'ACQUIRED', and that the lock has not already expired.
 * Throws if ownership is lost or lock has expired, failing closed.
 */
export async function renewDistributedLock(
  db: Firestore,
  runId: string,
  ownerId: string,
  mode: JobExecutionMode,
  ttlMs = DEFAULT_LOCK_TTL_MS
): Promise<MigrationLockRecord> {
  assertDryRunZeroWriteInvariant(mode, 'renewDistributedLock');
  const lockRef = db.collection(LOCK_COLLECTION).doc(LOCK_DOC_ID);

  return await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef);
    if (!lockSnap.exists) {
      throw new Error(`LOCK_NOT_FOUND: Lock document '${LOCK_DOC_ID}' does not exist for runId '${runId}'.`);
    }

    const currentLock = lockSnap.data() as MigrationLockRecord;
    if (currentLock.runId !== runId || currentLock.ownerId !== ownerId || currentLock.status !== 'ACQUIRED') {
      throw new Error(
        `LOCK_OWNERSHIP_LOST: Cannot renew lock. Held by runId '${currentLock.runId}', owner '${currentLock.ownerId}', status '${currentLock.status}' (expected runId '${runId}', owner '${ownerId}').`
      );
    }

    const now = Date.now();
    const expiresTime = new Date(currentLock.expiresAt).getTime();
    if (now >= expiresTime) {
      throw new Error(
        `LOCK_EXPIRED: Cannot renew lock for runId '${runId}' because lock expired at ${currentLock.expiresAt} (current time: ${new Date(now).toISOString()}).`
      );
    }

    const renewedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    const renewalCount = (currentLock.renewalCount || 0) + 1;

    const updatedLock: MigrationLockRecord = {
      ...currentLock,
      expiresAt,
      renewedAt,
      renewalCount,
    };

    transaction.update(lockRef, {
      expiresAt,
      renewedAt,
      renewalCount,
    });

    return updatedLock;
  });
}

/**
 * Validates lock ownership and active expiry inside an ongoing transaction.
 * Ensures the lock is held by runId and ownerId, status is 'ACQUIRED', and expiresAt is in the future.
 * Optionally refreshes the lock expiry atomically within the same transaction.
 * Fails closed by throwing an Error if lock does not exist, ownership is lost, or lock is expired.
 */
export async function validateLockInTransaction(
  transaction: FirebaseFirestore.Transaction,
  db: Firestore,
  runId: string,
  ownerId: string,
  ttlMs = DEFAULT_LOCK_TTL_MS,
  refreshExpiry = true
): Promise<MigrationLockRecord> {
  const lockRef = db.collection(LOCK_COLLECTION).doc(LOCK_DOC_ID);
  const lockSnap = await transaction.get(lockRef);

  if (!lockSnap.exists) {
    throw new Error(
      `LOCK_NOT_FOUND_IN_TRANSACTION: Migration lock '${LOCK_DOC_ID}' missing during transactional mutation for runId '${runId}'.`
    );
  }

  const currentLock = lockSnap.data() as MigrationLockRecord;
  if (currentLock.runId !== runId || currentLock.ownerId !== ownerId || currentLock.status !== 'ACQUIRED') {
    throw new Error(
      `LOCK_OWNERSHIP_LOST_IN_TRANSACTION: Migration lock has been lost or taken over (current runId: '${currentLock.runId}', owner: '${currentLock.ownerId}', status: '${currentLock.status}'). Aborting transaction for runId '${runId}'.`
    );
  }

  const now = Date.now();
  const expiresTime = new Date(currentLock.expiresAt).getTime();
  if (now >= expiresTime) {
    throw new Error(
      `LOCK_EXPIRED_IN_TRANSACTION: Migration lock expired at '${currentLock.expiresAt}' (current time: '${new Date(now).toISOString()}'). Aborting transaction for runId '${runId}'.`
    );
  }

  if (refreshExpiry) {
    const renewedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    const renewalCount = (currentLock.renewalCount || 0) + 1;
    transaction.update(lockRef, {
      expiresAt,
      renewedAt,
      renewalCount,
    });
    return {
      ...currentLock,
      expiresAt,
      renewedAt,
      renewalCount,
    };
  }

  return currentLock;
}

/**
 * Releases distributed migration lock using a Firestore transaction.
 * Strictly verifies runId and owner identity so that an old execution cannot
 * release a lock acquired by a newer execution.
 */
export async function releaseDistributedLock(
  db: Firestore,
  runId: string,
  ownerId?: string
): Promise<boolean> {
  const lockRef = db.collection(LOCK_COLLECTION).doc(LOCK_DOC_ID);

  try {
    return await db.runTransaction(async (transaction) => {
      const lockSnap = await transaction.get(lockRef);
      if (!lockSnap.exists) return false;
      const currentLock = lockSnap.data() as MigrationLockRecord;

      if (currentLock.runId !== runId) {
        console.warn(
          `[Signalyn Migration Lock] Cannot release lock: held by different runId '${currentLock.runId}' (current caller: '${runId}'). Preserving active lock.`
        );
        return false;
      }

      if (ownerId && currentLock.ownerId !== ownerId) {
        console.warn(
          `[Signalyn Migration Lock] Cannot release lock: held by different owner '${currentLock.ownerId}' (current caller: '${ownerId}'). Preserving active lock.`
        );
        return false;
      }

      if (currentLock.status === 'ACQUIRED') {
        transaction.update(lockRef, {
          status: 'RELEASED',
          releasedAt: new Date().toISOString(),
        });
        return true;
      }
      return false;
    });
  } catch (err) {
    console.warn(`[Signalyn Migration Lock] Non-fatal error releasing lock for runId '${runId}':`, err);
    return false;
  }
}

export interface LockHeartbeat {
  stop: () => void;
  getLastError: () => Error | null;
}

/**
 * Starts background heartbeat for renewing distributed lock at periodic intervals.
 * Automatically unrefs timers so node process can exit naturally.
 */
export function startLockHeartbeat(
  db: Firestore,
  runId: string,
  ownerId: string,
  mode: JobExecutionMode,
  intervalMs = 60 * 1000,
  ttlMs = DEFAULT_LOCK_TTL_MS
): LockHeartbeat {
  if (mode === 'DRY_RUN') {
    return {
      stop: () => {},
      getLastError: () => null,
    };
  }

  let active = true;
  let lastError: Error | null = null;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = () => {
    if (!active) return;
    timer = setTimeout(async () => {
      if (!active) return;
      try {
        await renewDistributedLock(db, runId, ownerId, mode, ttlMs);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[Signalyn Lock Heartbeat] Renewal error for runId '${runId}':`, lastError.message);
      } finally {
        if (active) {
          scheduleNext();
        }
      }
    }, intervalMs);

    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
  };

  scheduleNext();

  return {
    stop: () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    getLastError: () => lastError,
  };
}

/**
 * Registers clean shutdown handlers for SIGTERM and SIGINT to release distributed lock.
 */
export function registerGracefulShutdownHandler(
  db: Firestore,
  runId: string,
  ownerId: string
): () => void {
  const onSignal = async (signal: string) => {
    console.warn(`[Signalyn Migration Job] Received ${signal}. Performing clean shutdown and releasing lock for runId '${runId}'...`);
    try {
      await releaseDistributedLock(db, runId, ownerId);
    } catch (err) {
      console.error(`[Signalyn Migration Job] Error during graceful shutdown lock release:`, err);
    }
    process.exit(143);
  };

  const sigtermListener = () => onSignal('SIGTERM');
  const sigintListener = () => onSignal('SIGINT');

  process.once('SIGTERM', sigtermListener);
  process.once('SIGINT', sigintListener);

  return () => {
    process.removeListener('SIGTERM', sigtermListener);
    process.removeListener('SIGINT', sigintListener);
  };
}

/**
 * Derives material update timestamp for a story.
 */
export function deriveMaterialUpdateTimestamp(
  story: Story,
  articles: Article[],
  analyses: ArticleAnalysis[],
  classification: EvidenceClassification
): { lastMaterialUpdateAt: string; rationale: string } {
  if (!articles || articles.length === 0) {
    return {
      lastMaterialUpdateAt: story.lastSeenAt || story.lastUpdatedAt || story.updatedAt || story.createdAt,
      rationale: 'No linked articles; preserved existing timestamp.',
    };
  }

  const sorted = [...articles].sort((a, b) => {
    const tA = new Date(a.publishedAt || (a as any).firstReportedAt || 0).getTime();
    const tB = new Date(b.publishedAt || (b as any).firstReportedAt || 0).getTime();
    return tA - tB;
  });

  const analysisMap = new Map<string, ArticleAnalysis>();
  for (const an of analyses) {
    analysisMap.set(an.articleId, an);
  }

  let materialTimestamp = sorted[0].publishedAt || story.firstSeenAt || story.createdAt;
  let materialReason = 'Initial reporting established storyline.';

  for (let i = 1; i < sorted.length; i++) {
    const art = sorted[i];
    const an = analysisMap.get(art.id);
    if (!an) continue;

    const development = detectMaterialDevelopment(art, an, story, classification);
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
 * Evaluates candidate story and produces enrichment payload, proposal, and exact field snapshot.
 */
export function evaluateCandidateStory(
  story: Story,
  articlesMap: Map<string, Article>,
  analysesMap: Map<string, ArticleAnalysis>,
  runId: string
): {
  proposal: MigrationProposal;
  snapshot: DocumentFieldSnapshot;
  requiresReview: boolean;
} {
  const memberArticles: Article[] = [];
  const memberAnalyses: ArticleAnalysis[] = [];

  for (const id of story.articleIds || []) {
    const art = articlesMap.get(id);
    if (art) memberArticles.push(art);
    const an = analysesMap.get(id);
    if (an) memberAnalyses.push(an);
  }

  const evidenceResult: EvidenceEvaluationResult = evaluateStoryEvidence(
    memberArticles,
    memberAnalyses,
    story
  );

  const competitiveResult: HuaweiCompetitiveAssessment = deriveHuaweiCompetitiveIntelligence(
    story,
    memberArticles,
    memberAnalyses,
    evidenceResult.evidenceClassification
  );

  const materialUpdate = deriveMaterialUpdateTimestamp(
    story,
    memberArticles,
    memberAnalyses,
    evidenceResult.evidenceClassification
  );

  const reviewReasons: string[] = [];
  if (evidenceResult.hasContradiction) {
    reviewReasons.push('Contradictory reporting detected.');
  }
  if (evidenceResult.evidenceClassification === 'RUMOR_OR_LEAK' && competitiveResult.strategicImportanceScore >= 80) {
    reviewReasons.push('High-importance rumor (score >= 80) requires editorial review.');
  }
  if (memberArticles.length === 0) {
    reviewReasons.push('Story has zero resolved member articles.');
  }
  if (evidenceResult.evidenceConfidence < 0.5) {
    reviewReasons.push(`Low evidence confidence (${evidenceResult.evidenceConfidence.toFixed(2)}).`);
  }

  const requiresReview = reviewReasons.length > 0;
  const nowIso = new Date().toISOString();

  const proposal: MigrationProposal = {
    storyId: story.id,
    title: story.canonicalTitle || story.title || 'Untitled',
    category: story.category || 'UNKNOWN',
    classification: evidenceResult.evidenceClassification,
    confidence: evidenceResult.evidenceConfidence,
    strategicImportance: competitiveResult.strategicImportanceScore,
    threatLevel: competitiveResult.competitiveThreatLevel,
    independentSources: evidenceResult.independentSourceCount,
    lastMaterialUpdateAt: materialUpdate.lastMaterialUpdateAt,
    requiresManualReview: requiresReview,
    reviewReasons,
  };

  const getFieldState = <T>(val: T | undefined): FieldState<T> => ({
    existed: val !== undefined,
    value: val !== undefined ? val : null,
  });

  const snapshot: DocumentFieldSnapshot = {
    storyId: story.id,
    appliedAt: nowIso,
    appliedRunId: runId,
    originalFields: {
      strategicImportanceScore: getFieldState(story.strategicImportanceScore),
      evidenceClassification: getFieldState(story.evidenceClassification),
      evidenceConfidence: getFieldState(story.evidenceConfidence),
      independentSourceCount: getFieldState(story.independentSourceCount),
      lastMaterialUpdateAt: getFieldState(story.lastMaterialUpdateAt),
      competitiveThreatLevel: getFieldState(story.competitiveThreatLevel),
      huaweiRelevance: getFieldState(story.huaweiRelevance),
      competitiveImplication: getFieldState(story.competitiveImplication),
      updatedAt: getFieldState(story.updatedAt || story.lastUpdatedAt),
    },
    appliedFields: {
      strategicImportanceScore: competitiveResult.strategicImportanceScore,
      evidenceClassification: evidenceResult.evidenceClassification,
      evidenceConfidence: evidenceResult.evidenceConfidence,
      independentSourceCount: evidenceResult.independentSourceCount,
      lastMaterialUpdateAt: materialUpdate.lastMaterialUpdateAt,
      competitiveThreatLevel: competitiveResult.competitiveThreatLevel,
      huaweiRelevance: competitiveResult.huaweiRelevance,
      competitiveImplication: competitiveResult.competitiveImplication,
      updatedAt: nowIso,
    },
  };

  return { proposal, snapshot, requiresReview };
}

/**
 * Mandatory Preflight Validation of Pilot Cohort
 * Re-validates existence, production eligibility, and evidence classification before allowing writes.
 */
export async function preflightValidatePilotCohort(
  db: Firestore,
  pilotIds: readonly string[],
  articlesMap: Map<string, Article>,
  analysesMap: Map<string, ArticleAnalysis>
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (pilotIds.length !== 5) {
    errors.push(`Pilot Preflight Failure: Expected exactly 5 pilot archetypes, received ${pilotIds.length}.`);
  }

  const verifiedArchetypes = new Set<EvidenceClassification>();

  for (const id of pilotIds) {
    const docRef = db.collection('stories').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      errors.push(`Pilot Preflight Failure: Story ${id} does not exist in collection 'stories'.`);
      continue;
    }

    const story = { id: snap.id, ...snap.data() } as Story;
    if (!isProductionStory(story)) {
      errors.push(`Pilot Preflight Failure: Story ${id} is not an eligible production story (status: ${story.status}).`);
      continue;
    }

    const expected = PILOT_EXPECTED_ARCHETYPES[id];
    if (!expected) {
      errors.push(`Pilot Preflight Failure: Story ${id} has no registered expected archetype.`);
      continue;
    }

    const memberArticles: Article[] = [];
    const memberAnalyses: ArticleAnalysis[] = [];
    for (const aid of story.articleIds || []) {
      const art = articlesMap.get(aid);
      if (art) memberArticles.push(art);
      const an = analysesMap.get(aid);
      if (an) memberAnalyses.push(an);
    }

    // Canonical Phase 7B.2 evidence verification engine (no title keyword heuristics)
    const ev = evaluateStoryEvidence(memberArticles, memberAnalyses, story);
    if (ev.evidenceClassification !== expected.expectedClassification) {
      errors.push(
        `Pilot Preflight Failure: Story ${id} classified as ${ev.evidenceClassification}, expected ${expected.expectedClassification} (evidence count: ${memberArticles.length}).`
      );
    } else {
      verifiedArchetypes.add(ev.evidenceClassification);
    }

    // For Huawei first-party development archetype, verify primary company association
    if (id === 'story-cluster-129b22968ec59289' && story.primaryCompanyId !== 'comp-huawei') {
      errors.push(`Pilot Preflight Failure: Story ${id} is not associated with Huawei (company: ${story.primaryCompanyId}).`);
    }
  }

  // Ensure all 5 distinct required archetypes were satisfied
  const requiredArchetypes: EvidenceClassification[] = [
    'OFFICIAL_ANNOUNCEMENT',
    'MULTI_SOURCE_CORROBORATED',
    'RUMOR_OR_LEAK',
    'CONTRADICTED',
    'VERIFIED_REPORT',
  ];

  for (const req of requiredArchetypes) {
    if (!verifiedArchetypes.has(req)) {
      errors.push(`Pilot Preflight Failure: Required archetype '${req}' was not satisfied by any pilot story.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Main Migration Job Executor
 */
export async function runStoryIntelligenceMigrationJob(
  options: JobOptions = {}
): Promise<DurableMigrationManifest> {
  const mode: JobExecutionMode = options.mode || 'DRY_RUN';
  const startTime = Date.now();
  const runId = `job-${mode.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const executedBy = options.executedBy || process.env.JOB_EXECUTED_BY || 'cloud-run-job:dedicated-sa';
  const batchSize = Math.min(options.batchSize || (mode === 'PILOT' ? 5 : 25), 50);

  const db = options.customDb || getMigrationAdminDb();

  console.log(`[Signalyn Migration Job] Starting Run ID: ${runId}`);
  console.log(`[Signalyn Migration Job] Mode: ${mode} | Project: ${TARGET_PROJECT_ID} | Database: ${TARGET_DATABASE_ID}`);

  // Write-Enable Guard: Any mode performing database mutations (PILOT, PRODUCTION, ROLLBACK)
  // strictly requires MIGRATION_ALLOW_MUTATIONS=true or programmatic allowMutations=true
  if (mode !== 'DRY_RUN' && !isMutationAuthorized(options)) {
    const errorMsg = `MUTATIONS_PROHIBITED_GUARD: Execution mode '${mode}' performs database mutations, but write authorization '${WRITE_ENABLE_ENV_VAR}' is false or unset. To prevent accidental writes, execution is blocked. Default to DRY_RUN or explicitly supply ${WRITE_ENABLE_ENV_VAR}=true in the environment.`;
    console.error(`[Signalyn Migration Job] ERROR: ${errorMsg}`);
    return {
      runId,
      mode,
      timestamp: new Date().toISOString(),
      executedBy,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      totalEvaluated: 0,
      totalMutated: 0,
      totalSkipped: 0,
      manualReviewCount: 0,
      status: 'REJECTED',
      durationMs: Date.now() - startTime,
      proposals: [],
      snapshots: [],
      error: errorMsg,
    };
  }

  // Handle ROLLBACK mode
  if (mode === 'ROLLBACK') {
    return await executeMigrationRollback(db, options, runId, executedBy, startTime);
  }

  let lockAcquired = false;
  let unregisterShutdown: (() => void) | null = null;
  let heartbeat: LockHeartbeat | null = null;
  let eligibleStories: Story[] = [];
  const proposals: MigrationProposal[] = [];
  const snapshots: DocumentFieldSnapshot[] = [];
  let manualReviewCount = 0;
  let mutatedCount = 0;
  let skippedCount = 0;
  let lastCheckpointId: string | undefined = undefined;

  try {
    // 1. Acquire Atomic Distributed Lock (PILOT and PRODUCTION only; NEVER in DRY_RUN)
    if (mode === 'PILOT' || mode === 'PRODUCTION') {
      await acquireDistributedLock(db, runId, executedBy, mode);
      lockAcquired = true;
      unregisterShutdown = registerGracefulShutdownHandler(db, runId, executedBy);
      heartbeat = startLockHeartbeat(db, runId, executedBy, mode);
    }

    // 2. Fetch stories, articles, and article analyses using Admin SDK
    console.log('[Signalyn Migration Job] Fetching stories, articles, and analyses from Firestore...');
    const [storiesSnap, articlesSnap, analysesSnap] = await Promise.all([
      db.collection('stories').get(),
      db.collection('articles').get(),
      db.collection('articleAnalysis').get(),
    ]);

    const articlesMap = new Map<string, Article>();
    articlesSnap.forEach((doc) => articlesMap.set(doc.id, { id: doc.id, ...doc.data() } as Article));

    const analysesMap = new Map<string, ArticleAnalysis>();
    analysesSnap.forEach((doc) =>
      analysesMap.set(doc.id, { articleId: doc.id, ...doc.data() } as ArticleAnalysis)
    );

    const allStories: Story[] = [];
    storiesSnap.forEach((doc) => allStories.push({ id: doc.id, ...doc.data() } as Story));

    // Filter production eligible stories and sort deterministically by id
    eligibleStories = allStories
      .filter(isProductionStory)
      .sort((a, b) => a.id.localeCompare(b.id));

    console.log(`[Signalyn Migration Job] Total stories: ${allStories.length}, Eligible production: ${eligibleStories.length}`);

    // Mode-specific selection
    if (mode === 'PILOT') {
      const pilotSet = new Set(PILOT_COHORT_ARCHETYPE_IDS);
      eligibleStories = eligibleStories.filter((s) => pilotSet.has(s.id));

      console.log(`[Signalyn Migration Job] PILOT mode selected ${eligibleStories.length} archetype stories.`);

      // Mandatory runtime preflight validation
      const preflight = await preflightValidatePilotCohort(
        db,
        PILOT_COHORT_ARCHETYPE_IDS,
        articlesMap,
        analysesMap
      );

      if (!preflight.valid) {
        throw new Error(`Pilot Preflight Failed:\n${preflight.errors.join('\n')}`);
      }
      console.log('[Signalyn Migration Job] Pilot preflight validation: 100% PASSED');
    }

    // Checkpoint filtering (resumable)
    if (options.checkpointStoryId) {
      const checkIdx = eligibleStories.findIndex((s) => s.id === options.checkpointStoryId);
      if (checkIdx !== -1) {
        console.log(
          `[Signalyn Migration Job] Resuming from checkpoint story: ${options.checkpointStoryId} (skipping ${checkIdx + 1} stories)`
        );
        eligibleStories = eligibleStories.slice(checkIdx + 1);
      }
    }

    // 3. Evaluate enrichments
    for (const story of eligibleStories) {
      const { proposal, snapshot, requiresReview } = evaluateCandidateStory(
        story,
        articlesMap,
        analysesMap,
        runId
      );
      proposals.push(proposal);
      snapshots.push(snapshot);
      if (requiresReview) manualReviewCount++;
    }

    mutatedCount = 0;
    skippedCount = 0;
    lastCheckpointId = undefined;

    // 4. Execution Phase
    if (mode === 'PILOT' || mode === 'PRODUCTION') {
      assertDryRunZeroWriteInvariant(mode, 'manifest_initial_write');
      // Record initial manifest with IN_PROGRESS status
      const initialManifest: DurableMigrationManifest = {
        runId,
        mode,
        timestamp: new Date().toISOString(),
        executedBy,
        databaseId: TARGET_DATABASE_ID,
        projectId: TARGET_PROJECT_ID,
        totalEvaluated: eligibleStories.length,
        totalMutated: 0,
        totalSkipped: 0,
        manualReviewCount,
        status: 'IN_PROGRESS',
        durationMs: 0,
        proposals,
        snapshots,
      };
      await db.collection(MANIFEST_COLLECTION).doc(runId).set(initialManifest);

      console.log(`[Signalyn Migration Job] Executing write-capable mode (${mode}) across ${snapshots.length} stories in batches of ${batchSize}...`);

      for (let i = 0; i < snapshots.length; i += batchSize) {
        if (heartbeat?.getLastError()) {
          throw new Error(
            `LOCK_HEARTBEAT_FAILED: Background lock renewal failed: ${heartbeat.getLastError()?.message}`
          );
        }

        const slice = snapshots.slice(i, i + batchSize);

        assertDryRunZeroWriteInvariant(mode, 'story_batch_mutation');
        const outcome = await db.runTransaction(async (transaction) => {
          // ATOMIC LOCK VALIDATION & RENEWAL: Validate lock ownership and expiry in the exact same transaction
          await validateLockInTransaction(transaction, db, runId, executedBy, DEFAULT_LOCK_TTL_MS, true);

          const manifestRef = db.collection(MANIFEST_COLLECTION).doc(runId);

          // Concurrently read all story documents in this batch slice inside transaction
          const storyDocSnaps = await Promise.all(
            slice.map((snap) => transaction.get(db.collection('stories').doc(snap.storyId)))
          );

          let batchMutated = 0;
          let batchSkipped = 0;
          let latestCommittedId = lastCheckpointId;

          for (let j = 0; j < slice.length; j++) {
            const snap = slice[j];
            const storySnap = storyDocSnaps[j];

            if (!storySnap.exists) {
              console.warn(`[Signalyn Migration Job] Story '${snap.storyId}' missing during mutation phase; skipping.`);
              batchSkipped++;
              continue;
            }

            const currentData = storySnap.data() as Story;
            const originalUpdatedAt = snap.originalFields.updatedAt?.value;
            const currentUpdatedAt = currentData.updatedAt || currentData.lastSeenAt || null;

            // Concurrency Check: If document was updated concurrently after evaluation,
            // never overwrite newer production data!
            if (originalUpdatedAt && currentUpdatedAt && currentUpdatedAt !== originalUpdatedAt) {
              console.warn(
                `[Signalyn Migration Job] Story '${snap.storyId}': SKIPPED_CONCURRENT_UPDATE - Current document updatedAt (${currentUpdatedAt}) differs from pre-migration evaluation state (${originalUpdatedAt}). Overwrite prevented.`
              );
              batchSkipped++;
              continue;
            }

            const docRef = db.collection('stories').doc(snap.storyId);
            transaction.update(docRef, {
              ...snap.appliedFields,
            });
            batchMutated++;
            latestCommittedId = snap.storyId;
          }

          const nextMutatedCount = mutatedCount + batchMutated;
          const nextSkippedCount = skippedCount + batchSkipped;

          // ATOMIC CHECKPOINT: Manifest checkpoint is updated inside the EXACT SAME transaction as story mutations.
          transaction.update(manifestRef, {
            totalMutated: nextMutatedCount,
            totalSkipped: nextSkippedCount,
            lastCheckpointStoryId: latestCommittedId,
          });

          return {
            mutatedCount: nextMutatedCount,
            skippedCount: nextSkippedCount,
            lastCheckpointId: latestCommittedId,
          };
        });

        mutatedCount = outcome.mutatedCount;
        skippedCount = outcome.skippedCount;
        lastCheckpointId = outcome.lastCheckpointId;

        console.log(
          `[Signalyn Migration Job] Committed batch atomically: ${mutatedCount}/${snapshots.length} mutated, ${skippedCount} skipped (Checkpoint: ${lastCheckpointId || 'none'})`
        );
      }
    } else {
      skippedCount = snapshots.length;
      console.log(`[Signalyn Migration Job] DRY_RUN mode: Evaluated ${snapshots.length} stories, 0 mutations performed.`);
    }

    const durationMs = Date.now() - startTime;
    const finalStatus = mode === 'DRY_RUN' ? 'DRY_RUN_COMPLETED' : 'SUCCESS';

    const finalManifest: DurableMigrationManifest = {
      runId,
      mode,
      timestamp: new Date().toISOString(),
      executedBy,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      totalEvaluated: eligibleStories.length,
      totalMutated: mutatedCount,
      totalSkipped: skippedCount,
      manualReviewCount,
      status: finalStatus,
      durationMs,
      lastCheckpointStoryId: lastCheckpointId,
      proposals,
      snapshots,
    };

    // Update manifest to final status
    if (mode === 'PILOT' || mode === 'PRODUCTION') {
      assertDryRunZeroWriteInvariant(mode, 'manifest_final_write');
      await db.collection(MANIFEST_COLLECTION).doc(runId).set(finalManifest);
      console.log(`[Signalyn Migration Job] Manifest finalized: doc(${runId}) with status ${finalStatus}`);
    }

    return finalManifest;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Signalyn Migration Job] ERROR: ${errorMsg}`);
    const failedManifest: DurableMigrationManifest = {
      runId,
      mode,
      timestamp: new Date().toISOString(),
      executedBy,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      totalEvaluated: eligibleStories.length,
      totalMutated: mutatedCount,
      totalSkipped: skippedCount,
      manualReviewCount,
      status: 'FAILED',
      durationMs: Date.now() - startTime,
      lastCheckpointStoryId: lastCheckpointId,
      proposals,
      snapshots,
      error: errorMsg,
    };

    if (mode === 'PILOT' || mode === 'PRODUCTION') {
      try {
        await db.collection(MANIFEST_COLLECTION).doc(runId).update({
          status: 'FAILED',
          error: errorMsg,
          durationMs: Date.now() - startTime,
        });
      } catch {
        try {
          await db.collection(MANIFEST_COLLECTION).doc(runId).set(failedManifest);
        } catch {
          // Suppress secondary write failure
        }
      }
    }

    return failedManifest;
  } finally {
    if (heartbeat) {
      heartbeat.stop();
    }
    if (unregisterShutdown) {
      unregisterShutdown();
    }
    if (lockAcquired) {
      await releaseDistributedLock(db, runId, executedBy);
    }
  }
}

/**
 * Transaction-Safe Concurrency-Guarded Rollback Executor
 * 
 * Invariants:
 * 1. Executes inside individual Firestore transactions per document.
 * 2. Compares current values against migration-written values.
 * 3. Skips conflicts if document has newer updatedAt or modified values (NEVER_OVERWRITE_NEWER_LEGITIMATE_UPDATE).
 * 4. Restores exact pre-migration field presence (deletes field if it was nonexistent; restores if existed).
 * 5. Idempotent: If document is already in original state, marks as ALREADY_RESTORED without failure.
 * 6. Never deletes or corrupts updatedAt.
 */
async function executeMigrationRollback(
  db: Firestore,
  options: JobOptions,
  runId: string,
  executedBy: string,
  startTime: number
): Promise<DurableMigrationManifest> {
  assertDryRunZeroWriteInvariant(options.mode || 'ROLLBACK', 'executeMigrationRollback');
  const targetRunId = options.targetRunId;
  console.log(`[Signalyn Rollback] Initiating rollback for target run: ${targetRunId || 'LATEST'}`);

  if (!isMutationAuthorized(options)) {
    const errorMsg = `MUTATIONS_PROHIBITED_GUARD: Execution mode 'ROLLBACK' performs database mutations, but '${WRITE_ENABLE_ENV_VAR}' is false or unset. To prevent accidental rollback writes, execution is blocked. Explicitly supply ${WRITE_ENABLE_ENV_VAR}=true in the environment.`;
    console.error(`[Signalyn Rollback] ERROR: ${errorMsg}`);
    return {
      runId,
      mode: 'ROLLBACK',
      timestamp: new Date().toISOString(),
      executedBy,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      totalEvaluated: 0,
      totalMutated: 0,
      totalSkipped: 0,
      manualReviewCount: 0,
      status: 'REJECTED',
      durationMs: Date.now() - startTime,
      proposals: [],
      snapshots: [],
      error: errorMsg,
    };
  }

  let lockAcquired = false;
  let unregisterShutdown: (() => void) | null = null;
  let heartbeat: LockHeartbeat | null = null;

  try {
    // Acquire distributed lock for rollback mutations
    await acquireDistributedLock(db, runId, executedBy, 'ROLLBACK');
    lockAcquired = true;
    unregisterShutdown = registerGracefulShutdownHandler(db, runId, executedBy);
    heartbeat = startLockHeartbeat(db, runId, executedBy, 'ROLLBACK');

    let manifestDocSnap: FirebaseFirestore.DocumentSnapshot | null = null;

    if (targetRunId) {
      manifestDocSnap = await db.collection(MANIFEST_COLLECTION).doc(targetRunId).get();
    } else {
      const querySnap = await db
        .collection(MANIFEST_COLLECTION)
        .where('status', '==', 'SUCCESS')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      if (!querySnap.empty) {
        manifestDocSnap = querySnap.docs[0];
      }
    }

    if (!manifestDocSnap || !manifestDocSnap.exists) {
      const errorMsg = `No durable migration manifest found for rollback (target: ${targetRunId || 'LATEST'}).`;
      console.error(`[Signalyn Rollback] ${errorMsg}`);
      return {
        runId,
        mode: 'ROLLBACK',
        timestamp: new Date().toISOString(),
        executedBy,
        databaseId: TARGET_DATABASE_ID,
        projectId: TARGET_PROJECT_ID,
        totalEvaluated: 0,
        totalMutated: 0,
        totalSkipped: 0,
        manualReviewCount: 0,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        proposals: [],
        snapshots: [],
        error: errorMsg,
      };
    }

    const targetManifest = manifestDocSnap.data() as DurableMigrationManifest;
    const snapshots = targetManifest.snapshots || [];
    console.log(`[Signalyn Rollback] Found ${snapshots.length} snapshots in manifest ${manifestDocSnap.id}`);

    let restoredCount = 0;
    let skippedCount = 0;
    let alreadyRestoredCount = 0;

    for (const snap of snapshots) {
      if (heartbeat?.getLastError()) {
        throw new Error(
          `LOCK_HEARTBEAT_FAILED: Background lock renewal failed during rollback: ${heartbeat.getLastError()?.message}`
        );
      }

      const docRef = db.collection('stories').doc(snap.storyId);

      // Transaction-safe single-document evaluation and restore
      const outcome = await db.runTransaction(async (transaction) => {
        // ATOMIC LOCK VALIDATION & RENEWAL: Validate lock ownership and expiry in the exact same transaction
        await validateLockInTransaction(transaction, db, runId, executedBy, DEFAULT_LOCK_TTL_MS, true);

        const currentSnap = await transaction.get(docRef);
        if (!currentSnap.exists) {
          return { status: 'DOC_NOT_FOUND', reason: 'Document does not exist in collection stories' };
        }

        const currentData = currentSnap.data() as Story;
        const currentUpdateTime = new Date(currentData.updatedAt || currentData.lastUpdatedAt || 0).getTime();
        const appliedTime = new Date(snap.appliedAt).getTime();

        // Check for Idempotency: Is the document already in pre-migration state?
        const checkFieldMatchesOriginal = (fieldName: keyof DocumentFieldSnapshot['originalFields'], currentVal: any) => {
          const origState = snap.originalFields[fieldName];
          if (!origState.existed) {
            return currentVal === undefined || currentVal === null;
          }
          return currentVal === origState.value;
        };

        const isAlreadyRestored =
          checkFieldMatchesOriginal('strategicImportanceScore', currentData.strategicImportanceScore) &&
          checkFieldMatchesOriginal('evidenceClassification', currentData.evidenceClassification) &&
          checkFieldMatchesOriginal('evidenceConfidence', currentData.evidenceConfidence) &&
          checkFieldMatchesOriginal('independentSourceCount', currentData.independentSourceCount) &&
          checkFieldMatchesOriginal('lastMaterialUpdateAt', currentData.lastMaterialUpdateAt) &&
          checkFieldMatchesOriginal('competitiveThreatLevel', currentData.competitiveThreatLevel) &&
          checkFieldMatchesOriginal('huaweiRelevance', currentData.huaweiRelevance) &&
          checkFieldMatchesOriginal('competitiveImplication', currentData.competitiveImplication);

        if (isAlreadyRestored) {
          return { status: 'ALREADY_RESTORED', reason: 'Document is already in pre-migration state' };
        }

        // Concurrency Guard: Has document been legitimately updated after migration?
        if (currentUpdateTime > appliedTime) {
          return {
            status: 'SKIPPED_CONFLICT',
            reason: `Document updatedAt (${currentData.updatedAt}) is newer than migration appliedAt (${snap.appliedAt})`,
          };
        }

        // Value Guard: Did an external process modify ANY of the migration-applied fields?
        const checkFieldMatchesApplied = (fieldName: keyof DocumentFieldSnapshot['appliedFields'], currentVal: any) => {
          return currentVal === snap.appliedFields[fieldName];
        };

        const matchesAllApplied =
          checkFieldMatchesApplied('strategicImportanceScore', currentData.strategicImportanceScore) &&
          checkFieldMatchesApplied('evidenceClassification', currentData.evidenceClassification) &&
          checkFieldMatchesApplied('evidenceConfidence', currentData.evidenceConfidence) &&
          checkFieldMatchesApplied('independentSourceCount', currentData.independentSourceCount) &&
          checkFieldMatchesApplied('lastMaterialUpdateAt', currentData.lastMaterialUpdateAt) &&
          checkFieldMatchesApplied('competitiveThreatLevel', currentData.competitiveThreatLevel) &&
          checkFieldMatchesApplied('huaweiRelevance', currentData.huaweiRelevance) &&
          checkFieldMatchesApplied('competitiveImplication', currentData.competitiveImplication);

        if (!matchesAllApplied) {
          return {
            status: 'SKIPPED_CONFLICT',
            reason: 'Current document values differ from migration-applied values (unrelated external modification detected)',
          };
        }

        // Prepare exact field restoration payload
        const restorePayload: Record<string, any> = {};

        const restoreField = (fieldName: string, state: FieldState<any>) => {
          if (state.existed) {
            restorePayload[fieldName] = state.value;
          } else {
            restorePayload[fieldName] = FieldValue.delete();
          }
        };

        restoreField('strategicImportanceScore', snap.originalFields.strategicImportanceScore);
        restoreField('evidenceClassification', snap.originalFields.evidenceClassification);
        restoreField('evidenceConfidence', snap.originalFields.evidenceConfidence);
        restoreField('independentSourceCount', snap.originalFields.independentSourceCount);
        restoreField('lastMaterialUpdateAt', snap.originalFields.lastMaterialUpdateAt);
        restoreField('competitiveThreatLevel', snap.originalFields.competitiveThreatLevel);
        restoreField('huaweiRelevance', snap.originalFields.huaweiRelevance);
        restoreField('competitiveImplication', snap.originalFields.competitiveImplication);

        // Preserve updatedAt: If original existed, restore it; otherwise preserve current
        if (snap.originalFields.updatedAt.existed && snap.originalFields.updatedAt.value) {
          restorePayload.updatedAt = snap.originalFields.updatedAt.value;
        }

        transaction.update(docRef, restorePayload);
        return { status: 'RESTORED' };
      });

      if (outcome.status === 'RESTORED') {
        restoredCount++;
      } else if (outcome.status === 'ALREADY_RESTORED') {
        alreadyRestoredCount++;
      } else {
        skippedCount++;
        console.warn(`[Signalyn Rollback] Story ${snap.storyId}: ${outcome.status} - ${outcome.reason}`);
      }
    }

    console.log(
      `[Signalyn Rollback] Completed: ${restoredCount} restored, ${alreadyRestoredCount} already in original state, ${skippedCount} skipped conflicts.`
    );

    const rollbackManifest: DurableMigrationManifest = {
      runId,
      mode: 'ROLLBACK',
      timestamp: new Date().toISOString(),
      executedBy,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      totalEvaluated: snapshots.length,
      totalMutated: restoredCount,
      totalSkipped: skippedCount + alreadyRestoredCount,
      manualReviewCount: 0,
      status: 'SUCCESS',
      durationMs: Date.now() - startTime,
      proposals: [],
      snapshots: [],
    };

    await db.collection(MANIFEST_COLLECTION).doc(runId).set(rollbackManifest);
    return rollbackManifest;
  } finally {
    if (heartbeat) {
      heartbeat.stop();
    }
    if (unregisterShutdown) {
      unregisterShutdown();
    }
    if (lockAcquired) {
      await releaseDistributedLock(db, runId, executedBy);
    }
  }
}

// CLI Execution Entrypoint
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith('--mode='))?.split('=')[1] as JobExecutionMode | undefined;
  const targetRunIdArg = args.find((a) => a.startsWith('--target-run-id='))?.split('=')[1];
  const checkpointArg = args.find((a) => a.startsWith('--checkpoint='))?.split('=')[1];
  const allowMutationsArg = args.find((a) => a.startsWith('--allow-mutations='))?.split('=')[1];
  const allowMutations =
    allowMutationsArg !== undefined
      ? allowMutationsArg === 'true'
      : process.env.MIGRATION_ALLOW_MUTATIONS === 'true';

  const mode = modeArg || (process.env.MIGRATION_MODE as JobExecutionMode) || 'DRY_RUN';

  runStoryIntelligenceMigrationJob({
    mode,
    targetRunId: targetRunIdArg || process.env.TARGET_RUN_ID,
    checkpointStoryId: checkpointArg || process.env.CHECKPOINT_STORY_ID,
    allowMutations,
  })
    .then((result) => {
      console.log('[Signalyn Migration Job] Result Summary:', JSON.stringify({
        runId: result.runId,
        mode: result.mode,
        status: result.status,
        evaluated: result.totalEvaluated,
        mutated: result.totalMutated,
        skipped: result.totalSkipped,
        durationMs: result.durationMs,
        checkpoint: result.lastCheckpointStoryId,
      }, null, 2));
      process.exit(result.status === 'FAILED' ? 1 : 0);
    })
    .catch((err) => {
      console.error('[Signalyn Migration Job] Fatal Error:', err);
      process.exit(1);
    });
}

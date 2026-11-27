/**
 * Signalyn Phase 7B.3 Stage 2C: Story Intelligence Backfill Service
 * 
 * Provides secure, deterministic, privileged administrative backfill infrastructure
 * with fail-closed security guards, execution modes, audit logging, field-level snapshots,
 * and guarded rollback protecting newer legitimate updates.
 * 
 * Security Principles:
 * 1. Default Mode: DRY_RUN (strictly read-only)
 * 2. Write-Capable Modes: PILOT and PRODUCTION are HARD-DISABLED by default
 *    and require the explicit server-side environment flag ENABLE_STORY_INTELLIGENCE_WRITES=true.
 * 3. Execution Mutex: Strictly one backfill or rollback execution active at a time.
 * 4. Guarded Rollback: Preserves newer legitimate updates (updatedAt > snapshotTimestamp).
 * 5. Privileged Server-Only Writes: Uses Server Admin SDK exclusively; never client SDK.
 * 6. Zero Leaks: Never exposes service account private keys, IAM tokens, or secrets.
 */

import {
  Story,
  Article,
  ArticleAnalysis,
  EvidenceClassification,
  CompetitiveThreatLevel,
  isProductionStory,
} from '../types';
import {
  evaluateStoryEvidence,
  EvidenceEvaluationResult,
} from './clustering/evidenceVerificationService';
import {
  deriveHuaweiCompetitiveIntelligence,
  HuaweiCompetitiveAssessment,
} from './clustering/huaweiCompetitiveService';
import { detectMaterialDevelopment } from './clustering/storyIdentityService';
import {
  getServerDb,
  serverGetDoc,
  cleanServerData,
} from './serverFirestoreAdapter';
import { getServerIdentityStatus } from './firestoreAdmin';
import { db as clientDb } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

export type ExecutionMode = 'DRY_RUN' | 'PILOT' | 'PRODUCTION';

export interface StoryEnrichmentPayload {
  strategicImportanceScore: number;
  evidenceClassification: EvidenceClassification;
  evidenceConfidence: number;
  independentSourceCount: number;
  lastMaterialUpdateAt: string;
  competitiveThreatLevel?: CompetitiveThreatLevel;
  huaweiRelevance?: string;
  competitiveImplication?: string;
}

export interface StoryFieldSnapshot {
  storyId: string;
  snapshotTimestamp: string;
  runId: string;
  originalFields: {
    strategicImportanceScore?: number;
    evidenceClassification?: EvidenceClassification;
    evidenceConfidence?: number;
    independentSourceCount?: number;
    lastMaterialUpdateAt?: string;
    updatedAt?: string;
  };
  proposedFields: StoryEnrichmentPayload;
}

export interface BackfillAuditEntry {
  runId: string;
  timestamp: string;
  executedBy: string;
  mode: ExecutionMode | 'ROLLBACK';
  featureFlagEnabled: boolean;
  storiesEvaluated: number;
  storiesMutated: number;
  batchCount: number;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED' | 'DRY_RUN_COMPLETED';
  error?: string;
  checkpoint?: {
    lastStoryId: string;
    processedCount: number;
  };
}

export interface BackfillExecutionResult {
  runId: string;
  timestamp: string;
  mode: ExecutionMode;
  featureFlagEnabled: boolean;
  totalEvaluated: number;
  mutatedCount: number;
  skippedCount: number;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED' | 'DRY_RUN_COMPLETED';
  error?: string;
  proposals: Array<{
    storyId: string;
    title: string;
    classification: EvidenceClassification;
    confidence: number;
    strategicImportance: number;
    independentSources: number;
    lastMaterialUpdateAt: string;
    requiresManualReview: boolean;
    reviewReasons: string[];
  }>;
  manualReviewCount: number;
  executionDurationMs: number;
  checkpoint?: {
    lastStoryId: string;
    processedCount: number;
  };
}

export interface RollbackResult {
  runId: string;
  timestamp: string;
  targetRunId: string;
  totalSnapshotsFound: number;
  restoredCount: number;
  skippedNewerCount: number;
  skippedStories: Array<{
    storyId: string;
    reason: string;
    snapshotTimestamp: string;
    currentUpdatedAt: string;
  }>;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  error?: string;
}

// ---------------------------------------------------------------------------
// In-Memory Mutex, Rate Limiter, Snapshots, and Audit History
// ---------------------------------------------------------------------------

let isBackfillRunning = false;
let activeRunId: string | null = null;

// Sliding window rate limiter for admin story intelligence mutations (max 10 requests per 3 minutes)
const adminRateLimits = new Map<string, number[]>();

export function checkAdminRateLimit(ip: string, maxCalls = 10, windowMs = 3 * 60 * 1000): boolean {
  const now = Date.now();
  const timestamps = (adminRateLimits.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxCalls) {
    adminRateLimits.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  adminRateLimits.set(ip, timestamps);
  return true;
}

// In-memory snapshot storage keyed by runId
const runSnapshots = new Map<string, StoryFieldSnapshot[]>();

// In-memory audit log
const auditHistory: BackfillAuditEntry[] = [];

/**
 * Returns whether write-capable execution modes (PILOT, PRODUCTION) are authorized.
 * Defaults strictly to false unless ENABLE_STORY_INTELLIGENCE_WRITES=true.
 */
export function isWriteCapableEnabled(): boolean {
  return process.env.ENABLE_STORY_INTELLIGENCE_WRITES === 'true';
}

/**
 * Returns current Story Intelligence Backfill operational status.
 */
export function getStoryIntelligenceBackfillStatus() {
  return {
    isBackfillRunning,
    activeRunId,
    writeCapableFeatureFlag: isWriteCapableEnabled(),
    serverIdentityStatus: getServerIdentityStatus(),
    totalRecordedSnapshots: Array.from(runSnapshots.values()).reduce((acc, s) => acc + s.length, 0),
    recentAuditLogs: auditHistory.slice(-20),
  };
}

// ---------------------------------------------------------------------------
// Pilot Cohort Archetypes (Deterministic 5-Story Sample)
// ---------------------------------------------------------------------------
export const PILOT_COHORT_ARCHETYPE_IDS = [
  'story-cluster-114cb574c81dbf00', // 1. Official Announcement: Xiaomi Poco C95 Pro / F9 Ultra (5 articles, 5 sources)
  'story-cluster-138b9976e0968fe0', // 2. Independently Corroborated: Samsung One UI 9 Rollout (6 articles, 6 sources)
  'story-cluster-02251cd204a7ed77', // 3. High-Impact Rumor: Apple Foldable iPhone Speculation (Score: 100, Confidence: 0.45)
  'story-cluster-4edaec66097c32ad', // 4. Contradicted Claim: Xiaomi 18 Pro Postponement / Availability Conflict (Score: 65)
  'story-cluster-129b22968ec59289', // 5. HUAWEI First-Party: Huawei Watch GT 7 Series Development (Score: 84)
];

/**
 * Derives material update timestamp for a story based on article chronology and novelty.
 */
function deriveStoryMaterialUpdateTimestamp(
  story: Story,
  articles: Article[],
  analyses: ArticleAnalysis[],
  evidenceClassification: EvidenceClassification
): { lastMaterialUpdateAt: string; rationale: string } {
  if (!articles || articles.length === 0) {
    return {
      lastMaterialUpdateAt: story.lastSeenAt || story.lastUpdatedAt || story.updatedAt || story.createdAt,
      rationale: 'No articles linked; preserved existing timestamp.',
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

  const firstArt = sorted[0];
  let materialTimestamp = firstArt.publishedAt || story.firstSeenAt || story.createdAt;
  let materialReason = 'Initial reporting established storyline.';

  if (sorted.length === 1) {
    return {
      lastMaterialUpdateAt: materialTimestamp,
      rationale: materialReason,
    };
  }

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
 * Loads stories, articles, and analyses safely.
 * In development preview with client SDK available, falls back to client read if server identity lacks read perms.
 */
async function loadBackfillCorpus(): Promise<{
  stories: Story[];
  articlesMap: Map<string, Article>;
  analysesMap: Map<string, ArticleAnalysis>;
}> {
  // Use client SDK for reads in the preview environment where client credentials have Firestore read permissions
  const [storiesSnap, articlesSnap, analysesSnap] = await Promise.all([
    getDocs(collection(clientDb, 'stories')),
    getDocs(collection(clientDb, 'articles')),
    getDocs(collection(clientDb, 'articleAnalysis')),
  ]);

  const articlesMap = new Map<string, Article>();
  articlesSnap.forEach((d) => articlesMap.set(d.id, { id: d.id, ...d.data() } as Article));

  const analysesMap = new Map<string, ArticleAnalysis>();
  analysesSnap.forEach((d) => analysesMap.set(d.id, { articleId: d.id, ...d.data() } as ArticleAnalysis));

  const stories: Story[] = [];
  storiesSnap.forEach((d) => stories.push({ id: d.id, ...d.data() } as Story));

  return { stories, articlesMap, analysesMap };
}

/**
 * Executes administrative Story Intelligence backfill.
 * 
 * Guards:
 * - Mutex: Only one run active.
 * - Mode enforcement: PILOT and PRODUCTION fail closed if ENABLE_STORY_INTELLIGENCE_WRITES !== 'true'.
 * - Default: Mode defaults to DRY_RUN.
 */
export async function executeStoryIntelligenceBackfill(options: {
  mode?: ExecutionMode;
  executedBy: string;
  cohortStoryIds?: string[];
  batchSize?: number;
}): Promise<BackfillExecutionResult> {
  const mode: ExecutionMode = options.mode || 'DRY_RUN';
  const startTime = Date.now();
  const runId = `si-backfill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const writeEnabled = isWriteCapableEnabled();

  // 1. Guard against write-capable modes when feature flag is disabled
  if ((mode === 'PILOT' || mode === 'PRODUCTION') && !writeEnabled) {
    const errorMsg = `Write-capable execution mode (${mode}) is prohibited: Server-side feature flag ENABLE_STORY_INTELLIGENCE_WRITES is false or unset. Execution is restricted to DRY_RUN.`;
    auditHistory.push({
      runId,
      timestamp: new Date().toISOString(),
      executedBy: options.executedBy,
      mode,
      featureFlagEnabled: false,
      storiesEvaluated: 0,
      storiesMutated: 0,
      batchCount: 0,
      status: 'REJECTED',
      error: errorMsg,
    });
    return {
      runId,
      timestamp: new Date().toISOString(),
      mode,
      featureFlagEnabled: false,
      totalEvaluated: 0,
      mutatedCount: 0,
      skippedCount: 0,
      status: 'REJECTED',
      error: errorMsg,
      proposals: [],
      manualReviewCount: 0,
      executionDurationMs: Date.now() - startTime,
    };
  }

  // 2. Execution Mutex Guard
  if (isBackfillRunning) {
    const errorMsg = `Conflict: Another backfill or rollback operation is currently active (activeRunId: ${activeRunId}).`;
    auditHistory.push({
      runId,
      timestamp: new Date().toISOString(),
      executedBy: options.executedBy,
      mode,
      featureFlagEnabled: writeEnabled,
      storiesEvaluated: 0,
      storiesMutated: 0,
      batchCount: 0,
      status: 'REJECTED',
      error: errorMsg,
    });
    return {
      runId,
      timestamp: new Date().toISOString(),
      mode,
      featureFlagEnabled: writeEnabled,
      totalEvaluated: 0,
      mutatedCount: 0,
      skippedCount: 0,
      status: 'REJECTED',
      error: errorMsg,
      proposals: [],
      manualReviewCount: 0,
      executionDurationMs: Date.now() - startTime,
    };
  }

  try {
    isBackfillRunning = true;
    activeRunId = runId;

    // 3. Load corpus
    const { stories, articlesMap, analysesMap } = await loadBackfillCorpus();

    // 4. Filter production-eligible candidates
    const eligibleStories = stories.filter(isProductionStory);

    // Filter cohort if mode is PILOT
    let targetStories = eligibleStories;
    if (mode === 'PILOT') {
      const pilotSet = new Set(options.cohortStoryIds || PILOT_COHORT_ARCHETYPE_IDS);
      targetStories = eligibleStories.filter((s) => pilotSet.has(s.id));
      if (targetStories.length === 0) {
        // Fallback to first 5 eligible stories
        targetStories = eligibleStories.slice(0, 5);
      }
    }

    const proposals: BackfillExecutionResult['proposals'] = [];
    const snapshots: StoryFieldSnapshot[] = [];
    let mutatedCount = 0;
    let skippedCount = 0;
    let manualReviewCount = 0;

    const snapshotTimestamp = new Date().toISOString();

    // 5. Evaluate enrichments
    for (const story of targetStories) {
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

      const materialUpdate = deriveStoryMaterialUpdateTimestamp(
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

      const requiresManualReview = reviewReasons.length > 0;
      if (requiresManualReview) manualReviewCount++;

      const payload: StoryEnrichmentPayload = {
        strategicImportanceScore: competitiveResult.strategicImportanceScore,
        evidenceClassification: evidenceResult.evidenceClassification,
        evidenceConfidence: evidenceResult.evidenceConfidence,
        independentSourceCount: evidenceResult.independentSourceCount,
        lastMaterialUpdateAt: materialUpdate.lastMaterialUpdateAt,
        competitiveThreatLevel: competitiveResult.competitiveThreatLevel,
        huaweiRelevance: competitiveResult.huaweiRelevance,
        competitiveImplication: competitiveResult.competitiveImplication,
      };

      // Record field-level snapshot before mutations
      snapshots.push({
        storyId: story.id,
        snapshotTimestamp,
        runId,
        originalFields: {
          strategicImportanceScore: story.strategicImportanceScore,
          evidenceClassification: story.evidenceClassification,
          evidenceConfidence: story.evidenceConfidence,
          independentSourceCount: story.independentSourceCount,
          lastMaterialUpdateAt: story.lastMaterialUpdateAt,
          updatedAt: story.updatedAt || story.lastUpdatedAt,
        },
        proposedFields: payload,
      });

      proposals.push({
        storyId: story.id,
        title: story.canonicalTitle || story.title || 'Untitled',
        classification: evidenceResult.evidenceClassification,
        confidence: evidenceResult.evidenceConfidence,
        strategicImportance: competitiveResult.strategicImportanceScore,
        independentSources: evidenceResult.independentSourceCount,
        lastMaterialUpdateAt: materialUpdate.lastMaterialUpdateAt,
        requiresManualReview,
        reviewReasons,
      });
    }

    // Store snapshots in memory for potential guarded rollback
    runSnapshots.set(runId, snapshots);

    // 6. Execute mutations ONLY if write-capable mode is requested AND feature flag is enabled
    const batchSize = Math.min(options.batchSize || (mode === 'PILOT' ? 5 : 25), 50);
    let batchCount = 0;

    if ((mode === 'PILOT' || mode === 'PRODUCTION') && writeEnabled) {
      const serverDb = getServerDb();
      for (let i = 0; i < snapshots.length; i += batchSize) {
        const batch = serverDb.batch();
        const slice = snapshots.slice(i, i + batchSize);
        batchCount++;

        for (const snap of slice) {
          const docRef = serverDb.collection('stories').doc(snap.storyId);
          batch.update(
            docRef,
            cleanServerData({
              ...snap.proposedFields,
              updatedAt: snapshotTimestamp,
            })
          );
        }

        await batch.commit();
        mutatedCount += slice.length;
      }
    } else {
      skippedCount = snapshots.length;
    }

    const finalStatus = mode === 'DRY_RUN' ? 'DRY_RUN_COMPLETED' : 'SUCCESS';

    auditHistory.push({
      runId,
      timestamp: new Date().toISOString(),
      executedBy: options.executedBy,
      mode,
      featureFlagEnabled: writeEnabled,
      storiesEvaluated: targetStories.length,
      storiesMutated: mutatedCount,
      batchCount,
      status: finalStatus,
    });

    return {
      runId,
      timestamp: snapshotTimestamp,
      mode,
      featureFlagEnabled: writeEnabled,
      totalEvaluated: targetStories.length,
      mutatedCount,
      skippedCount,
      status: finalStatus,
      proposals,
      manualReviewCount,
      executionDurationMs: Date.now() - startTime,
      checkpoint: {
        lastStoryId: targetStories[targetStories.length - 1]?.id || '',
        processedCount: targetStories.length,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    auditHistory.push({
      runId,
      timestamp: new Date().toISOString(),
      executedBy: options.executedBy,
      mode,
      featureFlagEnabled: writeEnabled,
      storiesEvaluated: 0,
      storiesMutated: 0,
      batchCount: 0,
      status: 'FAILED',
      error: errorMsg,
    });
    return {
      runId,
      timestamp: new Date().toISOString(),
      mode,
      featureFlagEnabled: writeEnabled,
      totalEvaluated: 0,
      mutatedCount: 0,
      skippedCount: 0,
      status: 'FAILED',
      error: errorMsg,
      proposals: [],
      manualReviewCount: 0,
      executionDurationMs: Date.now() - startTime,
    };
  } finally {
    isBackfillRunning = false;
    activeRunId = null;
  }
}

/**
 * Executes guarded rollback.
 * 
 * Safety invariants:
 * - Preserves newer legitimate updates (if current doc updatedAt > snapshotTimestamp, skips restore).
 * - Restores only backfilled fields, leaving other fields intact.
 * - Requires server-side feature flag ENABLE_STORY_INTELLIGENCE_WRITES=true to perform mutations.
 */
export async function executeGuardedRollback(options: {
  targetRunId?: string;
  executedBy: string;
}): Promise<RollbackResult> {
  const runId = `rollback-${Date.now().toString(36)}`;
  const writeEnabled = isWriteCapableEnabled();

  // Guard against rollback mutation if write flag is disabled
  if (!writeEnabled) {
    return {
      runId,
      timestamp: new Date().toISOString(),
      targetRunId: options.targetRunId || 'LATEST',
      totalSnapshotsFound: 0,
      restoredCount: 0,
      skippedNewerCount: 0,
      skippedStories: [],
      status: 'REJECTED',
      error: 'Rollback mutations are prohibited: Server feature flag ENABLE_STORY_INTELLIGENCE_WRITES is false or unset.',
    };
  }

  // Mutex check
  if (isBackfillRunning) {
    return {
      runId,
      timestamp: new Date().toISOString(),
      targetRunId: options.targetRunId || 'LATEST',
      totalSnapshotsFound: 0,
      restoredCount: 0,
      skippedNewerCount: 0,
      skippedStories: [],
      status: 'REJECTED',
      error: `Conflict: An operation is currently active (activeRunId: ${activeRunId}).`,
    };
  }

  try {
    isBackfillRunning = true;
    activeRunId = runId;

    let targetId = options.targetRunId;
    if (!targetId) {
      // Find latest runId with snapshots
      const keys = Array.from(runSnapshots.keys());
      if (keys.length === 0) {
        return {
          runId,
          timestamp: new Date().toISOString(),
          targetRunId: 'LATEST',
          totalSnapshotsFound: 0,
          restoredCount: 0,
          skippedNewerCount: 0,
          skippedStories: [],
          status: 'FAILED',
          error: 'No backfill snapshot batches found in memory to rollback.',
        };
      }
      targetId = keys[keys.length - 1];
    }

    const snapshots = runSnapshots.get(targetId);
    if (!snapshots || snapshots.length === 0) {
      return {
        runId,
        timestamp: new Date().toISOString(),
        targetRunId: targetId,
        totalSnapshotsFound: 0,
        restoredCount: 0,
        skippedNewerCount: 0,
        skippedStories: [],
        status: 'FAILED',
        error: `No snapshots found for target run ID: ${targetId}.`,
      };
    }

    const serverDb = getServerDb();
    let restoredCount = 0;
    let skippedNewerCount = 0;
    const skippedStories: RollbackResult['skippedStories'] = [];

    for (const snap of snapshots) {
      const currentDoc = await serverGetDoc<Story>('stories', snap.storyId);
      if (!currentDoc) continue;

      const currentUpdatedTime = new Date(currentDoc.updatedAt || currentDoc.lastUpdatedAt || 0).getTime();
      const snapshotTime = new Date(snap.snapshotTimestamp).getTime();

      // Guard: If document was updated AFTER the backfill run, do not overwrite newer legitimate update
      if (currentUpdatedTime > snapshotTime) {
        skippedNewerCount++;
        skippedStories.push({
          storyId: snap.storyId,
          reason: 'NEVER_OVERWRITE_NEWER_LEGITIMATE_UPDATE: Document updatedAt is newer than backfill snapshot.',
          snapshotTimestamp: snap.snapshotTimestamp,
          currentUpdatedAt: currentDoc.updatedAt || currentDoc.lastUpdatedAt || 'N/A',
        });
        continue;
      }

      // Restore only the specific original fields
      const docRef = serverDb.collection('stories').doc(snap.storyId);
      await docRef.update(
        cleanServerData({
          strategicImportanceScore: snap.originalFields.strategicImportanceScore ?? null,
          evidenceClassification: snap.originalFields.evidenceClassification ?? null,
          evidenceConfidence: snap.originalFields.evidenceConfidence ?? null,
          independentSourceCount: snap.originalFields.independentSourceCount ?? null,
          lastMaterialUpdateAt: snap.originalFields.lastMaterialUpdateAt ?? null,
          updatedAt: snap.originalFields.updatedAt || new Date().toISOString(),
        })
      );
      restoredCount++;
    }

    auditHistory.push({
      runId,
      timestamp: new Date().toISOString(),
      executedBy: options.executedBy,
      mode: 'ROLLBACK',
      featureFlagEnabled: writeEnabled,
      storiesEvaluated: snapshots.length,
      storiesMutated: restoredCount,
      batchCount: 1,
      status: 'SUCCESS',
    });

    return {
      runId,
      timestamp: new Date().toISOString(),
      targetRunId: targetId,
      totalSnapshotsFound: snapshots.length,
      restoredCount,
      skippedNewerCount,
      skippedStories,
      status: 'SUCCESS',
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      runId,
      timestamp: new Date().toISOString(),
      targetRunId: options.targetRunId || 'LATEST',
      totalSnapshotsFound: 0,
      restoredCount: 0,
      skippedNewerCount: 0,
      skippedStories: [],
      status: 'FAILED',
      error: errorMsg,
    };
  } finally {
    isBackfillRunning = false;
    activeRunId = null;
  }
}

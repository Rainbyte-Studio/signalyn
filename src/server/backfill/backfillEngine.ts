/**
 * Signalyn Phase 6D: Production Historical Intelligence Backfill Engine
 *
 * Implements:
 * 1. Read-only Backlog Assessment & Inventory across actual Firestore articles
 * 2. Historical Strategic Relevance Triage (Smartphones, Wearables, Audio, Tablets)
 * 3. Dedicated Admin-only Batch Processing with bounded synchronous execution
 * 4. Isolation & Priority: Scheduled 06:00 Europe/Athens Daily Pipeline has absolute priority
 * 5. Bounded Gemini concurrency & run-level cost / token budgets
 * 6. Resumable execution loop with durable Firestore checkpoints
 * 7. Idempotence: Zero duplicate Gemini calls for already analyzed articles
 * 8. Non-destructive raw article preservation
 */

import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import {
  Article,
  ArticleAnalysis,
  BackfillItem,
  BackfillItemStatus,
  BackfillRun,
  BackfillStatus,
  BacklogInventory,
  BackfillBatchResult,
} from '../../types';
import { analyzeArticle } from '../analysisEngine';
import { classifyStrategicRelevance } from '../strategicRelevanceGate';
import { processArticleForStory } from '../clustering/incrementalStoryService';
import { CLUSTERING_VERSION } from '../clustering/storyPersistenceService';
import { getPipelineLeaseStatus } from '../pipelineLease';
import { getAthensReportingWindow, isWithinAthensReportingWindow } from '../reportingWindow';

export const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_BATCH_SIZE = 20;
export const MAX_SERVER_BATCH_SIZE = 50;
export const HARD_CANARY_LIMIT = 20;
export const MAX_CONCURRENCY = 2;
export const MAX_STAGE2_CALLS_DEFAULT = 40;
export const MAX_PHASE3_RETRIES = 2;

/**
 * Legacy preliminary categorization helper for backwards test compatibility
 */
export function classifyPreliminaryCategory(article: Article): { category: string; company?: string } {
  const text = `${article.title || ''} ${(article.rawCategories || []).join(' ')} ${article.excerpt || ''}`.toLowerCase();
  let category = 'GENERAL';
  if (/bud|earbud|headphone|earphone|audio|freebud|airpod/i.test(text)) {
    category = 'AUDIO';
  } else if (/watch|band|ring|wearable|fitbit/i.test(text)) {
    category = 'WEARABLE';
  } else if (/tab|tablet|pad|matepad|ipad/i.test(text)) {
    category = 'TABLET';
  } else if (/phone|smartphone|foldable|mate|pura|galaxy s|galaxy z|iphone/i.test(text)) {
    category = 'SMARTPHONE';
  }

  let company: string | undefined;
  if (/huawei/i.test(text)) company = 'HUAWEI';
  else if (/apple/i.test(text)) company = 'APPLE';
  else if (/samsung/i.test(text)) company = 'SAMSUNG';
  else if (/xiaomi/i.test(text)) company = 'XIAOMI';

  return { category, company };
}

export interface StartBackfillOptions {
  mode?: 'CANARY' | 'FULL' | 'CATEGORY_SCOPED' | 'STORY_ONLY_REPAIR' | 'ROLLOUT_50' | 'HISTORICAL_INTELLIGENCE';
  requestedLimit?: number;
  batchSize?: number;
  categoryScope?: string[];
  companyScope?: string[];
  delayBetweenBatchesMs?: number;
  explicitArticleIds?: string[];
  maxStage2Calls?: number;
}

export interface CandidateCategoryClassification {
  article: Article;
  category: string;
  company?: string;
  isRetry?: boolean;
}

import {
  classifyCorporateEcosystemSubtype,
  previewOutOfScopeCleanup,
  executeOutOfScopeCleanup,
  previewUncertainArticles,
  fetchArticlesForReadOnlyAudit,
} from './backlogCleanupEngine';

export {
  classifyCorporateEcosystemSubtype,
  previewOutOfScopeCleanup,
  executeOutOfScopeCleanup,
  previewUncertainArticles,
};

/**
 * 1. BACKLOG ASSESSMENT (Read-Only Inventory)
 *
 * Audits actual stored Firestore articles to calculate exact backlog metrics.
 * Does not guess or estimate counts. Uses actual Firestore documents and statuses.
 * Reconciles the 6 canonical categories and distinct backlog queues without double-counting.
 */
export async function getBacklogInventory(): Promise<BacklogInventory> {
  const articles = await fetchArticlesForReadOnlyAudit();

  let totalStoredArticles = 0;
  let alreadyAnalyzedArticles = 0;
  let pendingStrategicallyRelevantArticles = 0;
  let pendingHistoricalStrategicArticles = 0;
  let pendingTodayStrategicArticles = 0;
  let pendingUncertainArticles = 0;
  let pendingOutOfScopeArticles = 0;
  let alreadySkippedArticles = 0;
  let rawPendingArticles = 0;
  let failedArticlesEligibleForRetry = 0;
  let permanentFailures = 0;

  const reportingWindow = getAthensReportingWindow();

  const countsByCategory: Record<string, number> = {
    SMARTPHONE: 0,
    WEARABLE: 0,
    AUDIO: 0,
    TABLET: 0,
    CORPORATE_UNCERTAIN: 0,
    OUT_OF_SCOPE: 0,
    LEGACY_UNCLASSIFIED: 0,
  };

  const countsByCompany: Record<string, number> = {};
  const countsBySource: Record<string, number> = {};
  const publicationDateDistribution: Record<string, number> = {};

  articles.forEach((art) => {
    totalStoredArticles++;

    const status = art.processingStatus || 'PENDING';
    const source = art.sourceName || art.sourceId || 'Unknown Source';
    countsBySource[source] = (countsBySource[source] || 0) + 1;

    // Publication date distribution (YYYY-MM)
    if (art.publishedAt) {
      try {
        const monthKey = art.publishedAt.slice(0, 7); // e.g. '2026-10'
        publicationDateDistribution[monthKey] = (publicationDateDistribution[monthKey] || 0) + 1;
      } catch {
        // Fallback for unparseable dates
        publicationDateDistribution['undated'] = (publicationDateDistribution['undated'] || 0) + 1;
      }
    }

    if (status === 'ANALYZED') {
      alreadyAnalyzedArticles++;
      const cat = (art.relevanceCategory as string)?.toUpperCase();
      if (cat && countsByCategory[cat] !== undefined) {
        countsByCategory[cat]++;
      } else if (cat === 'SMARTPHONES') {
        countsByCategory.SMARTPHONE++;
      } else if (cat === 'WEARABLES') {
        countsByCategory.WEARABLE++;
      } else if (cat === 'TABLETS') {
        countsByCategory.TABLET++;
      } else {
        // Explicit LEGACY_UNCLASSIFIED state: Never silently default to SMARTPHONE!
        countsByCategory.LEGACY_UNCLASSIFIED++;
      }
      if (art.relevanceMatchedCompanies && art.relevanceMatchedCompanies.length > 0) {
        const comp = art.relevanceMatchedCompanies[0];
        countsByCompany[comp] = (countsByCompany[comp] || 0) + 1;
      }
    } else if (status === 'SKIPPED_STRATEGIC_SCOPE') {
      alreadySkippedArticles++;
      countsByCategory.OUT_OF_SCOPE++;
    } else if (status === 'FAILED') {
      const attempts = art.analysisAttemptCount || 0;
      const isRetryEligible = attempts < 3 && art.retryEligible !== false;
      if (isRetryEligible) {
        failedArticlesEligibleForRetry++;
      } else {
        permanentFailures++;
      }
      const cat = (art.relevanceCategory as string)?.toUpperCase();
      if (cat && countsByCategory[cat] !== undefined) {
        countsByCategory[cat]++;
      } else {
        countsByCategory.LEGACY_UNCLASSIFIED++;
      }
    } else if (status === 'PENDING') {
      rawPendingArticles++;
      // Evaluate StrategicRelevanceGate
      const rel = classifyStrategicRelevance({
        title: art.title,
        excerpt: art.excerpt,
        rawCategories: art.rawCategories,
        sourceName: art.sourceName,
        canonicalUrl: art.canonicalUrl,
      });

      if (rel.decision === 'OUT_OF_SCOPE') {
        pendingOutOfScopeArticles++;
        countsByCategory.OUT_OF_SCOPE++;
      } else if (rel.decision === 'UNCERTAIN') {
        // 62 Uncertain corporate/ecosystem articles
        pendingUncertainArticles++;
        countsByCategory.CORPORATE_UNCERTAIN++;
        if (rel.matchedCompanies.length > 0) {
          const comp = rel.matchedCompanies[0];
          countsByCompany[comp] = (countsByCompany[comp] || 0) + 1;
        }
      } else {
        // IN_SCOPE confirmed strategic hardware
        pendingStrategicallyRelevantArticles++;
        const isToday = art.publishedAt
          ? isWithinAthensReportingWindow(art.publishedAt, reportingWindow.windowStartIso, reportingWindow.windowEndIso)
          : false;

        if (isToday) {
          pendingTodayStrategicArticles++;
        } else {
          pendingHistoricalStrategicArticles++;
        }

        const cat = rel.category !== 'UNKNOWN' ? rel.category : 'LEGACY_UNCLASSIFIED';
        if (countsByCategory[cat] !== undefined) {
          countsByCategory[cat]++;
        } else {
          countsByCategory.LEGACY_UNCLASSIFIED++;
        }
        if (rel.matchedCompanies.length > 0) {
          const comp = rel.matchedCompanies[0];
          countsByCompany[comp] = (countsByCompany[comp] || 0) + 1;
        }
      }
    } else {
      countsByCategory.LEGACY_UNCLASSIFIED++;
    }
  });

  return {
    totalStoredArticles,
    alreadyAnalyzedArticles,
    pendingStrategicallyRelevantArticles,
    pendingHistoricalStrategicArticles,
    pendingTodayStrategicArticles,
    pendingUncertainArticles,
    pendingOutOfScopeArticles,
    alreadySkippedArticles,
    rawPendingArticles,
    failedArticlesEligibleForRetry,
    permanentFailures,
    countsByCategory,
    countsByCompany,
    countsBySource,
    publicationDateDistribution,
    lastAuditedAt: new Date().toISOString(),
  };
}

/**
 * 2. PREVIEW ELIGIBLE ARTICLES
 *
 * Inspects candidate articles that would be selected for the next backfill batch.
 * Reuses StrategicRelevanceGate and excludes today's 24h Europe/Athens window.
 */
export async function previewEligibleArticles(limit = 20): Promise<Array<{
  id: string;
  title: string;
  category: string;
  company?: string;
  publishedAt: string;
  sourceName: string;
  isRetry?: boolean;
}>> {
  const clampedLimit = Math.max(1, Math.min(limit, MAX_SERVER_BATCH_SIZE));
  const reportingWindow = getAthensReportingWindow();

  // Query pending articles pool
  const poolArticles = await fetchArticlesForReadOnlyAudit({
    statusIn: ['PENDING', 'FAILED'],
    maxDocs: 100,
  });

  const candidates: Array<{
    id: string;
    title: string;
    category: string;
    company?: string;
    publishedAt: string;
    sourceName: string;
    isRetry?: boolean;
  }> = [];

  for (const art of poolArticles) {
    // Strict isolation: Never select articles in today's Europe/Athens daily reporting window
    if (art.publishedAt && isWithinAthensReportingWindow(art.publishedAt, reportingWindow.windowStartIso, reportingWindow.windowEndIso)) {
      continue;
    }

    if (art.processingStatus === 'FAILED') {
      const attempts = art.analysisAttemptCount || 0;
      if (attempts >= 3 || art.retryEligible === false) continue;
    }

    const rel = classifyStrategicRelevance({
      title: art.title,
      excerpt: art.excerpt,
      rawCategories: art.rawCategories,
      sourceName: art.sourceName,
      canonicalUrl: art.canonicalUrl,
    });

    if (rel.decision === 'OUT_OF_SCOPE') continue;

    // Only 4 strategic categories
    if (!['SMARTPHONE', 'WEARABLE', 'AUDIO', 'TABLET'].includes(rel.category)) continue;

    candidates.push({
      id: art.id,
      title: art.title,
      category: rel.category,
      company: rel.matchedCompanies[0] || 'Competitor',
      publishedAt: art.publishedAt || '',
      sourceName: art.sourceName || art.sourceId || '',
      isRetry: art.processingStatus === 'FAILED',
    });

    if (candidates.length >= clampedLimit) break;
  }

  return candidates;
}

/**
 * 3. EXECUTE BACKFILL BATCH
 *
 * Synchronous bounded execution of a single backfill batch.
 * Strictly respects:
 * - Daily Pipeline priority lock (yields if pipeline lease is held)
 * - Server-enforced batch limits (default 20, max 50)
 * - Concurrency bounding (2 workers)
 * - Cost and token ceiling
 * - Durable progress checkpointing in Firestore
 */
export async function executeBackfillBatch(options: {
  batchSize?: number;
  runId?: string;
  maxStage2Calls?: number;
}): Promise<BackfillBatchResult> {
  const startTime = Date.now();
  const db = getServerDb();

  // 1. ISOLATION CHECK: The scheduled Daily Pipeline has absolute priority
  const leaseStatus = await getPipelineLeaseStatus();
  if (leaseStatus.active) {
    console.warn(
      `[Backfill Engine] Scheduled Daily Pipeline is currently active (lease held by '${leaseStatus.lease?.leaseHolder}'). Yielding.`
    );
    throw new Error(
      `PIPELINE_ACTIVE_PRIORITY: The scheduled Daily Intelligence Pipeline is currently running. Historical backfill yielded to prioritize production daily briefing.`
    );
  }

  // 2. Validate and clamp batch parameters
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_SERVER_BATCH_SIZE));
  const maxGeminiCalls = options.maxStage2Calls ?? MAX_STAGE2_CALLS_DEFAULT;

  // 3. Load or create persistent BackfillRun record
  let runId = options.runId;
  let runDocRef: any = null;
  let runRecord: BackfillRun;

  if (runId) {
    runDocRef = db.collection('system').doc('backfillRuns').collection('runs').doc(runId);
    const runSnap = await runDocRef.get();
    if (!runSnap.exists) {
      throw new Error(`Backfill run '${runId}' not found.`);
    }
    runRecord = runSnap.data() as BackfillRun;
    if (runRecord.status === 'PAUSED' || runRecord.pauseRequested) {
      return {
        runId,
        batchNumber: runRecord.currentBatch,
        itemsProcessed: 0,
        itemsSucceeded: 0,
        itemsFailed: 0,
        itemsSkipped: 0,
        geminiCallsUsed: 0,
        durationMs: 0,
        isPaused: true,
        isCompleted: false,
        remainingEligible: 0,
        errors: ['Run is currently paused.'],
      };
    }
  } else {
    runId = `backfill-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    runDocRef = db.collection('system').doc('backfillRuns').collection('runs').doc(runId);
    runRecord = {
      runId,
      status: 'RUNNING',
      mode: 'HISTORICAL_INTELLIGENCE',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      selectionStrategy: 'PHASE_6D_STRATEGIC_BACKLOG',
      requestedLimit: 500,
      batchSize,
      articlesSelected: 0,
      articlesAttempted: 0,
      articlesAnalyzed: 0,
      articlesFailed: 0,
      articlesSkipped: 0,
      storiesCreated: 0,
      storiesJoined: 0,
      storyReviewsCreated: 0,
      phase3GeminiCalls: 0,
      stage2GeminiCalls: 0,
      currentBatch: 0,
      totalBatches: 0,
      processedArticleIds: [],
      pauseRequested: false,
      cancelRequested: false,
      failureCount: 0,
      clusteringVersion: CLUSTERING_VERSION,
      durationMs: 0,
    };
    await runDocRef.set(cleanServerData(runRecord));
  }

  // 4. Select candidate articles for this batch
  const reportingWindow = getAthensReportingWindow();
  const processedSet = new Set(runRecord.processedArticleIds || []);

  const candidatesSnap = await db.collection('articles')
    .where('processingStatus', 'in', ['PENDING', 'FAILED'])
    .limit(100)
    .get();

  const eligibleBatch: Article[] = [];
  const outOfScopeToUpdate: Article[] = [];

  for (const doc of candidatesSnap.docs) {
    const art = doc.data() as Article;
    if (processedSet.has(art.id)) continue;

    // Exclude today's 24h Europe/Athens window
    if (art.publishedAt && isWithinAthensReportingWindow(art.publishedAt, reportingWindow.windowStartIso, reportingWindow.windowEndIso)) {
      continue;
    }

    if (art.processingStatus === 'FAILED') {
      const attempts = art.analysisAttemptCount || 0;
      if (attempts >= 3 || art.retryEligible === false) continue;
    }

    const rel = classifyStrategicRelevance({
      title: art.title,
      excerpt: art.excerpt,
      rawCategories: art.rawCategories,
      sourceName: art.sourceName,
      canonicalUrl: art.canonicalUrl,
    });

    if (rel.decision === 'OUT_OF_SCOPE') {
      outOfScopeToUpdate.push(art);
      continue;
    }

    // Must match one of 4 strategic hardware categories
    if (!['SMARTPHONE', 'WEARABLE', 'AUDIO', 'TABLET'].includes(rel.category)) {
      continue;
    }

    eligibleBatch.push(art);
    if (eligibleBatch.length >= batchSize) break;
  }

  // Asynchronously clean up out-of-scope articles in Firestore
  for (const oos of outOfScopeToUpdate) {
    db.collection('articles').doc(oos.id).update(cleanServerData({
      processingStatus: 'SKIPPED_STRATEGIC_SCOPE',
      relevanceDecision: 'OUT_OF_SCOPE',
      needsReanalysis: false,
    })).catch(() => {});
  }

  let itemsSucceeded = 0;
  let itemsFailed = 0;
  let itemsSkipped = outOfScopeToUpdate.length;
  let geminiCallsThisBatch = 0;
  const errors: string[] = [];

  // 5. Process eligible batch with bounded concurrency (2 workers)
  const batchItemIds = eligibleBatch.map((a) => a.id);

  for (let i = 0; i < eligibleBatch.length; i += MAX_CONCURRENCY) {
    // Check pause request before launching sub-batch
    const currentRunSnap = await runDocRef.get();
    if (currentRunSnap.exists && (currentRunSnap.data()?.pauseRequested || currentRunSnap.data()?.status === 'PAUSED')) {
      console.log(`[Backfill Engine] Pause requested for run '${runId}'. Stopping batch execution gracefully.`);
      await runDocRef.update(cleanServerData({ status: 'PAUSED', updatedAt: new Date().toISOString() }));
      break;
    }

    // Check Gemini API limit budget
    if (runRecord.stage2GeminiCalls + geminiCallsThisBatch >= maxGeminiCalls) {
      console.warn(`[Backfill Engine] Reached configured Stage 2 Gemini limit (${maxGeminiCalls}). Stopping batch.`);
      errors.push(`Budget ceiling reached: Maximum ${maxGeminiCalls} Gemini calls allowed for run.`);
      break;
    }

    const chunk = eligibleBatch.slice(i, i + MAX_CONCURRENCY);
    await Promise.all(
      chunk.map(async (art) => {
        try {
          // Idempotency safeguard: Do not re-analyze if analysis already exists
          const existingSnap = await db.collection('articleAnalysis').doc(art.id).get();
          if (existingSnap.exists) {
            console.log(`[Backfill Engine] Article '${art.id}' already analyzed. Skipping duplicate.`);
            itemsSkipped++;
            processedSet.add(art.id);
            return;
          }

          // Execute Phase 3 Article Analysis
          const analysisRes = await analyzeArticle(art.id, { trigger: 'HISTORICAL_BACKFILL' });
          geminiCallsThisBatch++;

          if (analysisRes.success) {
            itemsSucceeded++;
            processedSet.add(art.id);

            // Integrate into story clusters / canonical context
            if (analysisRes.analysis) {
              await processArticleForStory(art.id).catch((e) =>
                console.warn(`Notice processing story for backfill item ${art.id}:`, e)
              );
            }
          } else {
            itemsFailed++;
            errors.push(`Analysis failed for article ${art.id}: ${analysisRes.skipReason || 'Unknown error'}`);
          }
        } catch (err: unknown) {
          itemsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Error analyzing article ${art.id}: ${msg}`);
        }
      })
    );
  }

  const durationMs = Date.now() - startTime;
  const currentBatchNum = runRecord.currentBatch + 1;
  const isCompleted = eligibleBatch.length === 0;

  // 6. Update persistent BackfillRun checkpoint
  const updatedRunData = {
    currentBatch: currentBatchNum,
    articlesAttempted: runRecord.articlesAttempted + eligibleBatch.length,
    articlesAnalyzed: runRecord.articlesAnalyzed + itemsSucceeded,
    articlesFailed: runRecord.articlesFailed + itemsFailed,
    articlesSkipped: runRecord.articlesSkipped + itemsSkipped,
    stage2GeminiCalls: runRecord.stage2GeminiCalls + geminiCallsThisBatch,
    phase3GeminiCalls: runRecord.phase3GeminiCalls + geminiCallsThisBatch,
    processedArticleIds: Array.from(processedSet),
    status: isCompleted ? 'COMPLETED' : runRecord.pauseRequested ? 'PAUSED' : 'RUNNING',
    completedAt: isCompleted ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
    durationMs: runRecord.durationMs + durationMs,
    lastError: errors.length > 0 ? errors[errors.length - 1] : runRecord.lastError,
  };

  await runDocRef.update(cleanServerData(updatedRunData));

  return {
    runId,
    batchNumber: currentBatchNum,
    itemsProcessed: eligibleBatch.length,
    itemsSucceeded,
    itemsFailed,
    itemsSkipped,
    geminiCallsUsed: geminiCallsThisBatch,
    durationMs,
    isPaused: runRecord.pauseRequested || false,
    isCompleted,
    remainingEligible: Math.max(0, candidatesSnap.size - eligibleBatch.length),
    errors,
  };
}

/**
 * 4. PAUSE BACKFILL
 *
 * Gracefully marks a run as PAUSED.
 */
export async function pauseBackfill(runId: string): Promise<BackfillRun> {
  const db = getServerDb();
  const ref = db.collection('system').doc('backfillRuns').collection('runs').doc(runId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Backfill run '${runId}' not found.`);

  const run = snap.data() as BackfillRun;
  await ref.update(
    cleanServerData({
      status: 'PAUSED',
      pauseRequested: true,
      updatedAt: new Date().toISOString(),
    })
  );

  return { ...run, status: 'PAUSED', pauseRequested: true };
}

/**
 * 5. RESUME BACKFILL
 *
 * Sets run status back to RUNNING from its persisted checkpoint.
 */
export async function resumeBackfill(runId: string): Promise<BackfillRun> {
  const db = getServerDb();
  const ref = db.collection('system').doc('backfillRuns').collection('runs').doc(runId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Backfill run '${runId}' not found.`);

  const run = snap.data() as BackfillRun;

  // Priority check: Daily Pipeline takes priority
  const leaseStatus = await getPipelineLeaseStatus();
  if (leaseStatus.active) {
    throw new Error(
      `Cannot resume backfill: Scheduled Daily Intelligence Pipeline is active. Yielding.`
    );
  }

  await ref.update(
    cleanServerData({
      status: 'RUNNING',
      pauseRequested: false,
      updatedAt: new Date().toISOString(),
    })
  );

  return { ...run, status: 'RUNNING', pauseRequested: false };
}

/**
 * Reads the current active backfill run. Stale checkpoints remain available
 * for explicit administrative recovery.
 */
export async function getActiveBackfillRun(): Promise<BackfillRun | null> {
  const db = getServerDb();
  const runsSnap = await db.collection('system').doc('backfillRuns').collection('runs').get();
  const now = Date.now();

  for (const docSnap of runsSnap.docs) {
    const run = { runId: docSnap.id, ...docSnap.data() } as BackfillRun;
    if (run.status === 'RUNNING' || run.status === 'PAUSING') {
      const updatedAtTime = new Date(run.updatedAt || run.startedAt || 0).getTime();
      if (now - updatedAtTime <= STALE_THRESHOLD_MS) return run;
    }
  }

  return null;
}

/** Reads the latest historical checkpoint, including a paused or stale run. */
export async function getHistoricalBackfillCheckpoint(): Promise<Pick<BackfillRun, 'runId'> & { isPaused: boolean } | null> {
  const db = getServerDb();
  const snapshot = await db.collection('system').doc('backfillRuns').collection('runs')
    .where('mode', '==', 'HISTORICAL_INTELLIGENCE').get();
  const checkpoints = snapshot.docs.map((doc) => ({ ...doc.data(), runId: doc.id }) as BackfillRun);
  const checkpointTime = (run: BackfillRun) => Date.parse(run.updatedAt || run.startedAt || run.createdAt) || 0;
  checkpoints.sort((a, b) => checkpointTime(b) - checkpointTime(a) || b.runId.localeCompare(a.runId));
  const latest = checkpoints[0];
  if (!latest || !['RUNNING', 'PAUSING', 'PAUSED'].includes(latest.status)) return null;
  return {
    runId: latest.runId,
    isPaused: Boolean(latest.pauseRequested || latest.status !== 'RUNNING' ||
      Date.now() - checkpointTime(latest) > STALE_THRESHOLD_MS),
  };
}

/**
 * Backward-compatible canary start
 */
export async function startBackfill(options: StartBackfillOptions): Promise<BackfillRun> {
  const batchResult = await executeBackfillBatch({
    batchSize: options.batchSize || DEFAULT_BATCH_SIZE,
    maxStage2Calls: options.maxStage2Calls || MAX_STAGE2_CALLS_DEFAULT,
  });

  const db = getServerDb();
  const snap = await db.collection('system').doc('backfillRuns').collection('runs').doc(batchResult.runId).get();
  return snap.data() as BackfillRun;
}

/**
 * Cancels an active or paused run.
 */
export async function cancelBackfill(runId: string): Promise<BackfillRun> {
  const db = getServerDb();
  const ref = db.collection('system').doc('backfillRuns').collection('runs').doc(runId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Run ${runId} not found.`);

  const run = snap.data() as BackfillRun;
  await ref.update(
    cleanServerData({
      status: 'CANCELLED',
      cancelRequested: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  );

  return { ...run, status: 'CANCELLED', cancelRequested: true };
}

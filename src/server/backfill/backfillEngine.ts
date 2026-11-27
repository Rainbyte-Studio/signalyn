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
import { randomUUID } from 'node:crypto';
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
      if (isBackfillRetryEligible(art)) {
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
export async function previewEligibleArticles(limit = 20, runId?: string): Promise<Array<{
  id: string;
  title: string;
  category: string;
  company?: string;
  publishedAt: string;
  sourceName: string;
  isRetry?: boolean;
}>> {
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), MAX_SERVER_BATCH_SIZE)) : DEFAULT_BATCH_SIZE;
  const processed = new Set<string>();
  if (runId) {
    const snap = await getServerDb().collection('system').doc('backfillRuns').collection('runs').doc(runId).get();
    if (!snap.exists) throw new Error('Backfill checkpoint not found.');
    for (const id of (snap.data() as BackfillRun).processedArticleIds || []) processed.add(id);
  }
  const candidates = await selectHistoricalCandidates(count, processed);
  return candidates.map(({ article, category, company, isRetry }) => ({
    id: article.id,
    title: article.title,
    category,
    company,
    publishedAt: article.publishedAt || '',
    sourceName: article.sourceName || article.sourceId || '',
    isRetry,
  }));
}

function isBackfillRetryEligible(article: Article): boolean {
  return (article.analysisAttemptCount || 0) < 3 && article.retryEligible !== false;
}

async function selectHistoricalCandidates(limit: number, processed: Set<string>) {
  const pageSize = 100;
  // Include legacy articles without processingStatus, which inventory treats as pending.
  const query = getServerDb().collection('articles').limit(pageSize);
  const window = getAthensReportingWindow();
  const candidates: CandidateCategoryClassification[] = [];
  const outOfScope: Article[] = [];
  let page = await query.get();
  while (page.docs.length > 0) {
    for (const doc of page.docs) {
      const article = { ...doc.data(), id: doc.id } as Article;
      const status = article.processingStatus || 'PENDING';
      if (processed.has(article.id) || (status !== 'PENDING' && status !== 'FAILED')) continue;
      if (status === 'FAILED' && !isBackfillRetryEligible(article)) continue;
      if (article.publishedAt && isWithinAthensReportingWindow(article.publishedAt, window.windowStartIso, window.windowEndIso)) continue;

      const relevance = classifyStrategicRelevance({
        title: article.title,
        excerpt: article.excerpt,
        rawCategories: article.rawCategories,
        sourceName: article.sourceName,
        canonicalUrl: article.canonicalUrl,
      });
      if (relevance.decision === 'OUT_OF_SCOPE') continue;
      if (!['SMARTPHONE', 'WEARABLE', 'AUDIO', 'TABLET'].includes(relevance.category)) continue;
      candidates.push({ article, category: relevance.category, company: relevance.matchedCompanies[0] || 'Competitor', isRetry: status === 'FAILED' });
      if (candidates.length === limit) return candidates;
    }
    if (page.docs.length < pageSize) break;
    page = await query.startAfter(page.docs[page.docs.length - 1]).get();
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
 * - Article-analysis dispatch limit
 * - Durable progress checkpointing in Firestore
 */
type BatchOptions = {
  batchSize?: number;
  runId?: string;
  maxStage2Calls?: number;
};

export async function executeBackfillBatch(options: BatchOptions): Promise<BackfillBatchResult> {
  const db = getServerDb();
  const lock = db.doc('system/historicalBackfillBatchLease');
  const owner = randomUUID();
  // A crashed worker can be replaced after the maximum Cloud Run request duration.
  const leaseDurationMs = 65 * 60 * 1000;
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.get(lock)).data();
    if (current && current.expiresAt > Date.now()) {
      throw new Error('A Historical Backfill batch is already running.');
    }
    transaction.set(lock, { owner, expiresAt: Date.now() + leaseDurationMs });
  });

  try {
    return await executeClaimedBatch(options, lock, owner);
  } finally {
    try {
      await db.runTransaction(async (transaction) => {
        if ((await transaction.get(lock)).data()?.owner === owner) transaction.delete(lock);
      });
    } catch (error) {
      console.warn('[Backfill Engine] Could not release batch lease:', error);
    }
  }
}

async function executeClaimedBatch(
  options: BatchOptions,
  lock: FirebaseFirestore.DocumentReference,
  owner: string,
): Promise<BackfillBatchResult> {
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
  const requestedBatchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchSize = Number.isFinite(requestedBatchSize) ? Math.max(1, Math.min(Math.floor(requestedBatchSize), MAX_SERVER_BATCH_SIZE)) : DEFAULT_BATCH_SIZE;
  const maxGeminiCalls = options.maxStage2Calls ?? MAX_STAGE2_CALLS_DEFAULT;

  if (!Number.isSafeInteger(maxGeminiCalls) || maxGeminiCalls < 1) {
    throw new Error('The article-analysis dispatch limit must be a positive integer.');
  }

  // 3. Load or create persistent BackfillRun record
  let runId = options.runId;
  let runDocRef: FirebaseFirestore.DocumentReference;
  let runRecord: BackfillRun;

  if (runId) {
    runDocRef = db.collection('system').doc('backfillRuns').collection('runs').doc(runId);
    const runSnap = await runDocRef.get();
    if (!runSnap.exists) {
      throw new Error(`Backfill run '${runId}' not found.`);
    }
    runRecord = runSnap.data() as BackfillRun;
    if (runRecord.cancelRequested || ['CANCELLED', 'COMPLETED', 'FAILED'].includes(runRecord.status)) {
      throw new Error('This backfill run has ended. Reload to start a new run.');
    }
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
  const processedSet = new Set(runRecord.processedArticleIds || []);
  const remainingBudget = Math.max(0, maxGeminiCalls - (runRecord.stage2GeminiCalls || 0));
  const selectionLimit = Math.min(batchSize, remainingBudget);
  const candidates = await selectHistoricalCandidates(selectionLimit + 1, processedSet);
  const eligibleBatch = candidates.slice(0, selectionLimit).map(({ article }) => article);

  let itemsSucceeded = 0;
  let itemsFailed = 0;
  let itemsSkipped = 0;
  let geminiCallsThisBatch = 0;
  const errors: string[] = [];

  // 5. Process eligible batch with bounded concurrency (2 workers)
  let itemsProcessed = 0;
  let isPaused = false;

  for (let i = 0; i < eligibleBatch.length; i += MAX_CONCURRENCY) {
    // Check pause request before launching sub-batch
    const currentRunSnap = await runDocRef.get();
    const control = currentRunSnap.data();
    if (control?.cancelRequested || control?.status === 'CANCELLED') break;
    if (control?.pauseRequested || control?.status === 'PAUSED') {
      console.log(`[Backfill Engine] Pause requested for run '${runId}'. Stopping batch execution gracefully.`);
      isPaused = true;
      break;
    }

    const chunk = eligibleBatch.slice(i, i + MAX_CONCURRENCY);
    itemsProcessed += chunk.length;
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
          geminiCallsThisBatch++;
          const analysisRes = await analyzeArticle(art.id, { trigger: 'HISTORICAL_BACKFILL' });

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
  const budgetExhausted = geminiCallsThisBatch >= remainingBudget;
  if (budgetExhausted) {
    errors.push('This run reached its article-analysis dispatch limit. Select Run Next Batch if historical work remains.');
  }
  // Completion closes this checkpoint. A new run still requires an explicit batch request.
  let isCompleted = !isPaused && (candidates.length === 0 || budgetExhausted);

  // 6. Update persistent BackfillRun checkpoint
  const updatedRunData = {
    currentBatch: currentBatchNum,
    articlesAttempted: runRecord.articlesAttempted + itemsProcessed,
    articlesAnalyzed: runRecord.articlesAnalyzed + itemsSucceeded,
    articlesFailed: runRecord.articlesFailed + itemsFailed,
    articlesSkipped: runRecord.articlesSkipped + itemsSkipped,
    stage2GeminiCalls: (runRecord.stage2GeminiCalls || 0) + geminiCallsThisBatch,
    phase3GeminiCalls: runRecord.phase3GeminiCalls + geminiCallsThisBatch,
    processedArticleIds: Array.from(processedSet),
    status: isCompleted ? 'COMPLETED' : isPaused ? 'PAUSED' : 'RUNNING',
    completedAt: isCompleted ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
    durationMs: runRecord.durationMs + durationMs,
    lastError: errors.length > 0 ? errors[errors.length - 1] : runRecord.lastError,
  };

  await db.runTransaction(async (transaction) => {
    const lease = (await transaction.get(lock)).data();
    if (lease?.owner !== owner) throw new Error('Historical Backfill batch lease was lost.');
    const control = (await transaction.get(runDocRef)).data();
    if (control?.cancelRequested || control?.status === 'CANCELLED') {
      isCompleted = false;
      updatedRunData.status = 'CANCELLED';
      updatedRunData.completedAt = control.completedAt ?? updatedRunData.updatedAt;
    } else if (control?.pauseRequested || control?.status === 'PAUSED') {
      isPaused = true;
      isCompleted = false;
      updatedRunData.status = 'PAUSED';
      updatedRunData.completedAt = null;
    }
    transaction.update(runDocRef, cleanServerData(updatedRunData));
  });

  return {
    runId,
    batchNumber: currentBatchNum,
    itemsProcessed,
    itemsSucceeded,
    itemsFailed,
    itemsSkipped,
    geminiCallsUsed: geminiCallsThisBatch,
    durationMs,
    isPaused,
    isCompleted,
    // Selection reads one extra candidate to indicate remaining work without scanning the full queue.
    remainingEligible: Math.max(0, candidates.length - itemsProcessed),
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
  if (run.cancelRequested || ['CANCELLED', 'COMPLETED', 'FAILED'].includes(run.status)) {
    throw new Error('This backfill run has ended. Reload to start a new run.');
  }

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

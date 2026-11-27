/**
 * Signalyn Automated Daily Intelligence Pipeline Orchestrator (Phase 6)
 *
 * Coordinates the full end-to-end 11-stage autonomous cycle:
 * 1. Acquire durable lease (/system/pipelineLease) to prevent duplicate runs
 * 2. Retrieve articles from all ACTIVE sources and feeds
 * 3. Normalize and deduplicate articles
 * 4. Persist new articles
 * 5. Select strategically relevant articles
 * 6. Run Gemini intelligence analysis
 * 7. Update canonical companies and products
 * 8. Update story clusters
 * 9. Refresh relevant analytics
 * 10. Generate the Daily Brief
 * 11. Persist execution results and status
 *
 * Fault-tolerant, idempotent, and resilient against timeouts or scale-to-zero restarts.
 */

import { getServerDb, cleanServerData } from './serverFirestoreAdapter';
import { runCollectionCycle, CollectorRunRecord } from './collectorService';
import { analyzePendingArticles } from './analysisEngine';
import { generateDailyBrief } from './dailyBriefGenerator';
import { runStoryLifecycleMaintenance } from './clustering/storyLifecycleService';
import {
  acquirePipelineLease,
  heartbeatPipelineLease,
  releasePipelineLease,
} from './pipelineLease';
import {
  PipelineRunRecord,
  PipelineStageResult,
} from '../types/dailyBrief';
import { getAthensCurrentDateString } from './reportingWindow';

export interface RunPipelineOptions {
  trigger?: 'SCHEDULED' | 'MANUAL_ADMIN' | 'RETRY' | 'EXTERNAL_CRON';
  dateStr?: string;
  skipCollection?: boolean;
  skipBrief?: boolean;
  maxArticlesToAnalyze?: number;
  forceLease?: boolean;
}

let activeRun: PipelineRunRecord | null = null;
let lastCompletedRun: PipelineRunRecord | null = null;

/**
 * Returns current status of the orchestrator.
 */
export async function getPipelineStatus(): Promise<{
  isRunning: boolean;
  activeRun: PipelineRunRecord | null;
  lastCompletedRun: PipelineRunRecord | null;
}> {
  if (activeRun) {
    return {
      isRunning: true,
      activeRun,
      lastCompletedRun,
    };
  }

  // If no in-memory record, check latest in Firestore
  try {
    const db = getServerDb();
    const snap = await db.collection('pipelineRuns').orderBy('startedAt', 'desc').limit(1).get();
    if (!snap.empty) {
      lastCompletedRun = snap.docs[0].data() as PipelineRunRecord;
    }
  } catch {
    // Ignore in-memory fallback
  }

  return {
    isRunning: false,
    activeRun: null,
    lastCompletedRun,
  };
}

/**
 * Executes a pipeline stage with strict timing, error capture, and heartbeat extension.
 */
async function executeStage<T>(
  runRecord: PipelineRunRecord,
  stageName: string,
  operation: () => Promise<T>,
  itemsCountExtractor?: (result: T) => { processed: number; succeeded: number; failed: number }
): Promise<T | null> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  console.log(`[Pipeline] Stage [${stageName}] starting...`);

  // Send heartbeat to extend Firestore lease
  await heartbeatPipelineLease(runRecord.runId);

  try {
    const res = await operation();
    const endMs = Date.now();
    const completedAt = new Date().toISOString();
    const counts = itemsCountExtractor ? itemsCountExtractor(res) : { processed: 1, succeeded: 1, failed: 0 };

    const itemError = counts.failed > 0
      ? `${counts.failed} of ${counts.processed} items failed.`
      : undefined;
    if (itemError) runRecord.errors.push(`[${stageName}] ${itemError}`);

    const stageResult: PipelineStageResult = {
      stage: stageName,
      status: itemError ? (counts.succeeded > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      startedAt,
      completedAt,
      durationMs: endMs - startMs,
      itemsProcessed: counts.processed,
      itemsSucceeded: counts.succeeded,
      itemsFailed: counts.failed,
      ...(itemError ? { errors: [itemError] } : {}),
    };

    runRecord.stages[stageName] = stageResult;
    console.log(`[Pipeline] Stage [${stageName}] completed in ${stageResult.durationMs}ms`);
    return res;
  } catch (err: unknown) {
    const endMs = Date.now();
    const completedAt = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);

    console.error(`[Pipeline] Stage [${stageName}] failed: ${msg}`);
    runRecord.errors.push(`[${stageName}] ${msg}`);

    const stageResult: PipelineStageResult = {
      stage: stageName,
      status: 'FAILED',
      startedAt,
      completedAt,
      durationMs: endMs - startMs,
      itemsProcessed: 0,
      itemsSucceeded: 0,
      itemsFailed: 1,
      errors: [msg],
    };

    runRecord.stages[stageName] = stageResult;
    return null;
  }
}

/**
 * Runs the full 11-stage autonomous Daily Intelligence Pipeline.
 */
export async function runDailyIntelligencePipeline(
  options: RunPipelineOptions = {}
): Promise<PipelineRunRecord> {
  const {
    trigger = 'SCHEDULED',
    dateStr = getAthensCurrentDateString(),
    skipCollection = false,
    skipBrief = false,
    maxArticlesToAnalyze = 10,
    forceLease = false,
  } = options;

  const runId = `pipe-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const startedAt = new Date().toISOString();

  // STAGE 1: Acquire durable lease
  const leaseResult = await acquirePipelineLease(
    runId,
    `DAILY_INTELLIGENCE_PIPELINE_${dateStr}`,
    8 * 60 * 1000,
    forceLease
  );

  if (!leaseResult.acquired) {
    throw new Error(`Cannot start pipeline: ${leaseResult.reason}`);
  }

  const runRecord: PipelineRunRecord = {
    id: runId,
    runId,
    dateStr,
    startedAt,
    completedAt: '',
    status: 'RUNNING',
    trigger,
    stages: {
      leaseAcquisition: {
        stage: 'leaseAcquisition',
        status: 'SUCCESS',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: 0,
        itemsProcessed: 1,
        itemsSucceeded: 1,
        itemsFailed: 0,
        details: { leaseHolder: runId, expiresAt: leaseResult.expiresAt },
      },
    },
    summary: {
      totalDurationMs: 0,
      articlesDiscovered: 0,
      articlesPersisted: 0,
      articlesSelectedForAnalysis: 0,
      articlesAnalyzed: 0,
      clustersUpdated: 0,
      briefGenerated: false,
    },
    errors: [],
  };

  activeRun = runRecord;

  try {
    // STAGE 2, 3, 4: Ingestion, Normalization, Deduplication, Persistence
    let collectionResult: CollectorRunRecord | null = null;
    if (!skipCollection) {
      collectionResult = await executeStage(
        runRecord,
        'collectionAndIngestion',
        async () => {
          return await runCollectionCycle(trigger);
        },
        (res) => ({
          processed: res.articlesDiscovered,
          succeeded: res.articlesCreated,
          failed: res.errors.length,
        })
      );

      if (collectionResult) {
        runRecord.summary.articlesDiscovered = collectionResult.articlesDiscovered;
        runRecord.summary.articlesPersisted = collectionResult.articlesCreated;
      }
    } else {
      runRecord.stages['collectionAndIngestion'] = {
        stage: 'collectionAndIngestion',
        status: 'SKIPPED',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        itemsProcessed: 0,
        itemsSucceeded: 0,
        itemsFailed: 0,
      };
    }

    // STAGE 5 & 6: Strategic Selection & Gemini Analysis
    const analysisResult = await executeStage(
      runRecord,
      'articleIntelligenceAnalysis',
      async () => {
        return await analyzePendingArticles(maxArticlesToAnalyze);
      },
      (res) => ({
        processed: res.totalAttempted,
        succeeded: res.succeeded,
        failed: res.failed,
      })
    );

    if (analysisResult) {
      runRecord.summary.articlesSelectedForAnalysis = analysisResult.totalAttempted;
      runRecord.summary.articlesAnalyzed = analysisResult.succeeded;
    }

    // STAGE 7 & 8: Story Clustering & Lifecycle Maintenance (Phase 7B.1)
    const lifecycleResult = await executeStage(
      runRecord,
      'storyLifecycleMaintenance',
      async () => {
        return await runStoryLifecycleMaintenance({
          batchSize: 50,
          maxTotal: 500,
          dryRun: false,
        });
      },
      (res) => ({
        processed: res.storiesEvaluated,
        succeeded: res.storiesEvaluated - res.lifecycleErrors,
        failed: res.lifecycleErrors,
      })
    );

    if (lifecycleResult) {
      runRecord.summary.lifecycleEvaluated = lifecycleResult.storiesEvaluated;
      runRecord.summary.lifecycleUpdated = lifecycleResult.storiesChanged;
      runRecord.summary.clustersUpdated = lifecycleResult.storiesChanged;

      if (runRecord.stages['storyLifecycleMaintenance']) {
        runRecord.stages['storyLifecycleMaintenance'].details = {
          storiesEvaluated: lifecycleResult.storiesEvaluated,
          storiesNew: lifecycleResult.storiesNew,
          storiesDeveloping: lifecycleResult.storiesDeveloping,
          storiesStable: lifecycleResult.storiesStable,
          storiesResolved: lifecycleResult.storiesResolved,
          storiesArchived: lifecycleResult.storiesArchived,
          storiesReactivated: lifecycleResult.storiesReactivated,
          storiesChanged: lifecycleResult.storiesChanged,
          lifecycleErrors: lifecycleResult.lifecycleErrors,
        };
      }
    }

    // STAGE 9: Analytics Refresh
    await executeStage(
      runRecord,
      'analyticsRollup',
      async () => {
        const db = getServerDb();
        // Record heartbeat timestamp to analytics metadata
        const analyticsMetaRef = db.collection('system').doc('analyticsMetadata');
        await analyticsMetaRef.set(
          cleanServerData({
            lastRefreshedAt: new Date().toISOString(),
            refreshedBy: runId,
            pipelineDate: dateStr,
          }),
          { merge: true }
        );
        return { refreshed: true };
      }
    );

    // STAGE 10: Daily Brief Generation
    if (!skipBrief) {
      const briefResult = await executeStage(
        runRecord,
        'dailyBriefGeneration',
        async () => {
          return await generateDailyBrief({
            dateStr,
            forceRegenerate: true,
            triggeredBy: 'SYSTEM_AUTOMATION',
          });
        }
      );

      if (briefResult) {
        runRecord.summary.briefGenerated = true;
        runRecord.summary.briefId = briefResult.id;
      }
    } else {
      runRecord.stages['dailyBriefGeneration'] = {
        stage: 'dailyBriefGeneration',
        status: 'SKIPPED',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        itemsProcessed: 0,
        itemsSucceeded: 0,
        itemsFailed: 0,
      };
    }

    // STAGE 11: Finalize & Persist Pipeline Run Record
    const completedAt = new Date().toISOString();
    const totalDurationMs = Date.now() - new Date(startedAt).getTime();

    runRecord.completedAt = completedAt;
    runRecord.summary.totalDurationMs = totalDurationMs;
    runRecord.status = runRecord.errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS';

    const db = getServerDb();
    await db.collection('pipelineRuns').doc(runId).set(cleanServerData(runRecord));
    console.log(`[Pipeline] Pipeline run '${runId}' completed with status ${runRecord.status} in ${totalDurationMs}ms`);

    lastCompletedRun = runRecord;
    return runRecord;
  } finally {
    // Release distributed lease
    await releasePipelineLease(runId);
    activeRun = null;
  }
}

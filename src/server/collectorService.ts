/**
 * Signalyn Backend Ingestion & Collector Engine
 * 
 * Executes server-side scheduled or manual news ingestion:
 * SOURCE → DISCOVERY → INGESTION → NORMALIZATION → DEDUPLICATION → FIRESTORE
 * 
 * Idempotent, fault-tolerant, resilient to individual source outages.
 * Backed exclusively by Firebase Admin SDK via getServerDb.
 */

import { getServerDb, cleanServerData } from './serverFirestoreAdapter';
import { Source, Article, SourceFeed, SourceHealth } from '../types';
import { parseSyndicationXml, ParsedFeed } from './feedParser';
import { normalizeCanonicalUrl, generateContentHash, normalizeArticleText } from './urlNormalizer';
import { getSourceFeeds, computeSourceHealth } from '../utils/urlUtils';
import { classifyStrategicRelevance } from './strategicRelevanceGate';
import { storeCollectedArticle } from './articleDeletionTombstones';

export interface CollectorRunRecord {
  id: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  articlesDiscovered: number;
  articlesCreated: number;
  articlesUpdated: number;
  duplicatesSkipped: number;
  errors: Array<{ sourceId?: string; sourceName?: string; error: string }>;
  triggeredBy: string; // 'MANUAL' | 'SCHEDULED' | 'SINGLE_SOURCE'
}

export const STALE_RUN_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes (29 feeds * 12s timeout = 348s max)

let isRunning = false;
let activeRunStartedAt: number | null = null;
let activeRunRecord: CollectorRunRecord | null = null;
let lastRunRecord: CollectorRunRecord | null = null;
let currentRunStatus: CollectorRunRecord['status'] = 'SUCCESS';
let lastSuccessfulGlobalCollection: string | null = null;
let scheduledTimer: NodeJS.Timeout | null = null;
let collectionIntervalMinutes = 120; // 2 hours default

/**
 * Checks if an active run has exceeded the maximum execution window without completing.
 * If exceeded, terminates the active lock and marks the run as FAILED to prevent
 * permanent application deadlocks.
 */
export function checkStaleRunRecovery(): boolean {
  if (!isRunning || !activeRunStartedAt) {
    return false;
  }

  const now = Date.now();
  const elapsed = now - activeRunStartedAt;

  if (elapsed > STALE_RUN_TIMEOUT_MS) {
    console.warn(
      `[Collector Deadlock Prevention] Active run exceeded timeout (${elapsed}ms > ${STALE_RUN_TIMEOUT_MS}ms). Releasing stale execution lock.`
    );

    if (activeRunRecord) {
      activeRunRecord.status = 'FAILED';
      activeRunRecord.completedAt = new Date().toISOString();
      activeRunRecord.errors.push({
        error: `Execution timed out after ${Math.round(elapsed / 1000)}s. Active lock terminated automatically.`,
      });
      lastRunRecord = activeRunRecord;
      currentRunStatus = 'FAILED';
    }

    isRunning = false;
    activeRunStartedAt = null;
    activeRunRecord = null;
    return true;
  }

  return false;
}

/**
 * Executes a collection cycle across active sources.
 * Can be triggered globally or targeting a single source or specific feed.
 */
export async function runCollectionCycle(
  triggeredBy: string = 'MANUAL',
  specificSourceId?: string,
  specificFeedId?: string
): Promise<CollectorRunRecord> {
  // Check and recover from stale runs before checking active lock
  checkStaleRunRecovery();

  if (isRunning) {
    throw new Error('A collection cycle is already active. Please wait for it to complete.');
  }

  isRunning = true;
  activeRunStartedAt = Date.now();
  const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const startedAt = new Date().toISOString();

  const runRecord: CollectorRunRecord = {
    id: runId,
    runId,
    startedAt,
    completedAt: '',
    status: 'RUNNING',
    sourcesAttempted: 0,
    sourcesSucceeded: 0,
    sourcesFailed: 0,
    articlesDiscovered: 0,
    articlesCreated: 0,
    articlesUpdated: 0,
    duplicatesSkipped: 0,
    errors: [],
    triggeredBy,
  };

  activeRunRecord = runRecord;

  try {
    const db = getServerDb();
    // 1. Fetch target sources from Firestore
    let sourcesToProcess: Source[] = [];

    if (specificSourceId) {
      const sourceSnap = await db.collection('sources').doc(specificSourceId).get();
      const isSourceExists = typeof sourceSnap.exists === 'function'
        ? (sourceSnap as any).exists()
        : Boolean(sourceSnap.exists);

      if (isSourceExists) {
        sourcesToProcess.push(sourceSnap.data() as Source);
      } else {
        const tombstoneSnap = await db.collection('deletedSources').doc(specificSourceId).get();
        const isTombstoneExists = typeof tombstoneSnap.exists === 'function'
          ? (tombstoneSnap as any).exists()
          : Boolean(tombstoneSnap.exists);

        if (isTombstoneExists) {
          console.log(`[Collector] Bypassing collection: Source "${specificSourceId}" was intentionally deleted.`);
          runRecord.status = 'SUCCESS';
          runRecord.completedAt = new Date().toISOString();
          return runRecord;
        }
        throw new Error(`Source not found with ID: ${specificSourceId}`);
      }
    } else {
      const querySnap = await db.collection('sources').where('status', '==', 'ACTIVE').get();
      querySnap.forEach((d) => {
        sourcesToProcess.push(d.data() as Source);
      });
    }

    runRecord.sourcesAttempted = sourcesToProcess.length;

    // 2. Process each source
    for (const source of sourcesToProcess) {
      const now = new Date().toISOString();
      const allFeeds = getSourceFeeds(source);

      // If source has no configured feeds, set health and skip
      if (allFeeds.length === 0) {
        await db.collection('sources').doc(source.id).update(cleanServerData({
          health: 'NEEDS_CONFIGURATION',
          status: 'NEEDS_CONFIGURATION',
          lastCollectedAt: now,
          lastCollectionAttempt: now,
          updatedAt: now,
        })).catch(() => {});
        continue;
      }

      const feedsToCollect = specificFeedId
        ? allFeeds.filter((f) => f.id === specificFeedId)
        : allFeeds.filter((f) => f.status === 'ACTIVE');

      if (feedsToCollect.length === 0) {
        if (!specificFeedId) {
          await db.collection('sources').doc(source.id).update(cleanServerData({
            health: 'PAUSED',
            lastCollectedAt: now,
            lastCollectionAttempt: now,
            updatedAt: now,
          })).catch(() => {});
        }
        continue;
      }

      let sourceArticlesCreated = 0;
      let feedSuccessCount = 0;
      let feedErrorCount = 0;

      const updatedFeeds: SourceFeed[] = [...allFeeds];

      // Process each targeted feed sequentially (with 12s bounded timeout each)
      for (const feed of feedsToCollect) {
        const feedIdx = updatedFeeds.findIndex((f) => f.id === feed.id);
        const feedNow = new Date().toISOString();
        let feedArticlesCreated = 0;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);

          const response = await fetch(feed.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Signalyn-Collector/1.0',
              'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1',
            },
            signal: controller.signal,
            redirect: 'follow',
          });
          clearTimeout(timeout);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }

          const xmlText = await response.text();
          const parsedFeed: ParsedFeed = parseSyndicationXml(xmlText);

          runRecord.articlesDiscovered += parsedFeed.items.length;

          // Ingest and deduplicate each item
          for (const item of parsedFeed.items) {
            const canonicalUrl = normalizeCanonicalUrl(item.link);
            if (!canonicalUrl) continue;

            const cleanTitle = normalizeArticleText(item.title, { maxLength: 500 });
            const cleanExcerpt = normalizeArticleText(item.excerpt, { maxLength: 5000 });
            const cleanAuthor = item.author ? normalizeArticleText(item.author, { maxLength: 200 }) : undefined;
            const articleLanguage = (item.language || parsedFeed.language || source.language || 'en').slice(0, 10);

            const contentHash = generateContentHash(
              canonicalUrl,
              cleanTitle,
              item.publishedAt,
              cleanExcerpt
            );

            const articleId = `art-${contentHash.slice(0, 24)}`;
            const rawCategories =
              feed.categories && feed.categories.length > 0
                ? feed.categories
                : item.categories.length > 0
                ? item.categories
                : source.categories;

            // Phase 6C: Evaluate deterministic strategic relevance immediately upon collection
            // Excludes non-strategic GPU, automotive, gaming, PC components from cluttering PENDING queue
            const relevance = classifyStrategicRelevance({
              title: cleanTitle,
              excerpt: cleanExcerpt,
              rawCategories,
              sourceName: source.name,
              canonicalUrl,
            });

            const isOutOfScope = relevance.decision === 'OUT_OF_SCOPE';
            const initialStatus = isOutOfScope ? 'SKIPPED_STRATEGIC_SCOPE' : 'PENDING';

            const newArticle: Article = {
              id: articleId,
              sourceId: source.id,
              sourceName: normalizeArticleText(source.name).slice(0, 200),
              feedId: feed.id,
              feedTitle: normalizeArticleText(feed.title).slice(0, 200),
              discoveredViaFeeds: [feed.id],
              canonicalUrl: canonicalUrl.slice(0, 2000),
              title: cleanTitle,
              author: cleanAuthor,
              publishedAt: item.publishedAt || now,
              collectedAt: now,
              updatedAt: now,
              language: articleLanguage,
              market: (source.market || 'Global').slice(0, 100),
              excerpt: cleanExcerpt,
              imageUrl: item.imageUrl ? item.imageUrl.trim().slice(0, 2000) : undefined,
              rawCategories,
              contentHash: contentHash.slice(0, 128),
              processingStatus: initialStatus,
              relevanceDecision: relevance.decision,
              relevanceCategory: relevance.category,
              relevanceReason: relevance.reason,
              relevanceEvaluatedAt: now,
              relevanceGateVersion: 'v1.1',
              relevanceMatchedKeywords: relevance.matchedKeywords,
              relevanceMatchedCompanies: relevance.matchedCompanies,
              needsReanalysis: false,
            };

            if (!await storeCollectedArticle(db, newArticle, feedNow)) {
              runRecord.duplicatesSkipped++;
              continue;
            }
            runRecord.articlesCreated++;
            sourceArticlesCreated++;
            feedArticlesCreated++;
          }

          if (feedIdx !== -1) {
            const feedDates = parsedFeed.items.map((it) => it.publishedAt).filter(Boolean).sort();
            updatedFeeds[feedIdx] = {
              ...updatedFeeds[feedIdx],
              status: updatedFeeds[feedIdx].status === 'ERROR' ? 'ACTIVE' : updatedFeeds[feedIdx].status,
              lastCollectedAt: feedNow,
              lastSuccessfulCollectionAt: feedNow,
              articlesCollected: (updatedFeeds[feedIdx].articlesCollected || 0) + feedArticlesCreated,
              failureCount: 0,
              lastError: null,
              feedType: parsedFeed.type,
              oldestItemDate: feedDates[0] || updatedFeeds[feedIdx].oldestItemDate || null,
              newestItemDate: feedDates[feedDates.length - 1] || updatedFeeds[feedIdx].newestItemDate || null,
              updatedAt: feedNow,
            };
          }
          feedSuccessCount++;
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          feedErrorCount++;

          runRecord.errors.push({
            sourceId: source.id,
            sourceName: `${source.name} [${feed.title}]`,
            error: errorMessage,
          });

          if (feedIdx !== -1) {
            const newFeedFailureCount = (updatedFeeds[feedIdx].failureCount || 0) + 1;
            updatedFeeds[feedIdx] = {
              ...updatedFeeds[feedIdx],
              lastCollectedAt: feedNow,
              failureCount: newFeedFailureCount,
              lastError: errorMessage.slice(0, 300),
              status: newFeedFailureCount >= 5 ? 'ERROR' : updatedFeeds[feedIdx].status,
              updatedAt: feedNow,
            };
          }
        }
      }

      const sourceHealth = computeSourceHealth(updatedFeeds, source.status);
      const hasAnySuccess = feedSuccessCount > 0;
      if (hasAnySuccess) {
        runRecord.sourcesSucceeded++;
      } else {
        runRecord.sourcesFailed++;
      }

      const primaryFeed = updatedFeeds.find((f) => f.isPrimary) || updatedFeeds[0];

      await db.collection('sources').doc(source.id).update(cleanServerData({
        feeds: updatedFeeds,
        health: sourceHealth,
        lastCollectionAttempt: now,
        lastCollectedAt: now,
        lastSuccessfulCollection: hasAnySuccess ? now : (source.lastSuccessfulCollection || undefined),
        lastSuccessfulCollectionAt: hasAnySuccess ? now : (source.lastSuccessfulCollectionAt || undefined),
        articlesCollected: (source.articlesCollected || 0) + sourceArticlesCreated,
        failureCount: sourceHealth === 'ERROR' ? (source.failureCount || 0) + 1 : 0,
        errorCount: sourceHealth === 'ERROR' ? (source.errorCount || 0) + 1 : 0,
        lastError: sourceHealth === 'ERROR' ? updatedFeeds.find((f) => f.lastError)?.lastError : null,
        feedUrl: primaryFeed?.url,
        feedType: primaryFeed?.feedType,
        updatedAt: now,
      })).catch((e) => console.error(`Failed to update source ${source.id} telemetry:`, e));
    }

    // Determine overall run status
    if (runRecord.sourcesFailed === 0) {
      runRecord.status = 'SUCCESS';
      lastSuccessfulGlobalCollection = new Date().toISOString();
    } else if (runRecord.sourcesSucceeded > 0) {
      runRecord.status = 'PARTIAL_SUCCESS';
    } else {
      runRecord.status = 'FAILED';
    }

    runRecord.completedAt = new Date().toISOString();
    currentRunStatus = runRecord.status;

    // Persist run telemetry in /system/run-{runId}
    await db.collection('system').doc(`run-${runId}`).set(cleanServerData(runRecord)).catch((e) => {
      console.warn('Could not persist run telemetry document:', e);
    });

    // Also update current collector state
    await db.collection('system').doc('collectorState').set(cleanServerData({
      lastRun: runRecord,
      lastSuccessfulGlobalCollection,
      updatedAt: runRecord.completedAt,
    })).catch(() => {});

    return runRecord;
  } finally {
    isRunning = false;
    activeRunStartedAt = null;
    activeRunRecord = null;
    lastRunRecord = runRecord;
  }
}

/**
 * Returns current status of the collector engine.
 */
export async function getCollectorStatus() {
  const staleRecovered = checkStaleRunRecovery();

  if (!lastRunRecord) {
    try {
      const db = getServerDb();
      const snap = await db.collection('system').doc('collectorState').get();
      const isSnapExists = typeof snap.exists === 'function' ? (snap as any).exists() : Boolean(snap.exists);
      if (isSnapExists) {
        const data = snap.data();
        if (data?.lastRun) {
          lastRunRecord = data.lastRun as CollectorRunRecord;
          if (!isRunning) {
            currentRunStatus = lastRunRecord.status;
          }
        }
        if (data?.lastSuccessfulGlobalCollection) {
          lastSuccessfulGlobalCollection = data.lastSuccessfulGlobalCollection;
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return {
    isRunning,
    currentRunStatus,
    lastSuccessfulGlobalCollection,
    collectionIntervalMinutes,
    isSchedulerActive: Boolean(scheduledTimer),
    schedulingAuthority: scheduledTimer ? 'IN_PROCESS_TIMER' : 'EXTERNAL_CLOUD_SCHEDULER',
    activeRun: isRunning ? activeRunRecord : null,
    lastRun: lastRunRecord,
    staleRunRecovered: staleRecovered,
  };
}

/**
 * Starts the server-side recurring collection scheduler.
 * Note: In production (Cloud Run), external Google Cloud Scheduler invoking
 * POST /api/pipeline/scheduled-run is the single scheduling authority and
 * this in-process timer remains disabled unless explicitly opted in during
 * local non-production development.
 */
export function initializeScheduler(intervalMinutes = 120) {
  if (scheduledTimer) {
    clearInterval(scheduledTimer);
  }

  collectionIntervalMinutes = intervalMinutes;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`[Signalyn Scheduler] Starting recurring collector every ${intervalMinutes} minutes.`);

  scheduledTimer = setInterval(async () => {
    try {
      console.log('[Signalyn Scheduler] Executing scheduled collection cycle...');
      await runCollectionCycle('SCHEDULED');
    } catch (err) {
      console.error('[Signalyn Scheduler] Error during scheduled cycle:', err);
    }
  }, intervalMs);
}

/**
 * Stops the in-process collection timer if active.
 */
export function stopScheduler() {
  if (scheduledTimer) {
    clearInterval(scheduledTimer);
    scheduledTimer = null;
  }
}

/**
 * Server-side trusted migration for Source multi-feed schema.
 * Operates purely via Firebase Admin SDK.
 */
export async function migrateLegacySourcesAdmin(): Promise<{
  migratedCount: number;
  alreadyMigratedCount: number;
  total: number;
}> {
  const db = getServerDb();
  const snap = await db.collection('sources').get();
  let migratedCount = 0;
  let alreadyMigratedCount = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Source;
    if (!Array.isArray(data.feeds) || data.feeds.length === 0) {
      const feeds = getSourceFeeds(data);
      const health = computeSourceHealth(feeds, data.status);
      await db.collection('sources').doc(docSnap.id).update(
        cleanServerData({
          feeds,
          health,
          updatedAt: new Date().toISOString(),
        })
      );
      migratedCount++;
    } else {
      alreadyMigratedCount++;
    }
  }

  return {
    migratedCount,
    alreadyMigratedCount,
    total: snap.size,
  };
}

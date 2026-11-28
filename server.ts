/**
 * Signalyn Full-Stack Production Server
 * 
 * Express backend running on Port 3000, serving:
 * 1. Feed Discovery APIs (/api/discovery/*)
 * 2. Ingestion & Collector Execution (/api/collector/*)
 * 3. Gemini Structured Intelligence Analysis (/api/analysis/*)
 * 4. Vite middleware for frontend SPA in development
 * 5. Static production bundle in production
 */

import { PermanentArticleDeletionDisabledError } from './src/server/backfill/permanentArticleDeletion';
import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { createServer as createViteServer } from 'vite';
import { setLogLevel as setFirestoreClientLogLevel } from 'firebase/firestore';

// Suppress internal @firebase/firestore Node gRPC idle stream disconnect warnings
setFirestoreClientLogLevel('silent');

// Configure Node.js to prefer IPv4 egress over IPv6 for consistent CDN edge routing
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {
  // Graceful fallback if not supported
}
import { discoverWebsiteFeeds, validateFeedEndpoint } from './src/server/feedDiscovery';
import { diagnoseArticleUrl } from './src/server/articleDiagnosticService';
import {
  runCollectionCycle,
  getCollectorStatus,
  initializeScheduler,
  migrateLegacySourcesAdmin,
} from './src/server/collectorService';
import { repairCorruptedArticles } from './src/server/articleRepairService';
import {
  analyzeArticle,
  analyzeArticlesBatch,
  analyzePendingArticles,
} from './src/server/analysisEngine';
import {
  startBackfill,
  getActiveBackfillRun,
  getHistoricalBackfillCheckpoint,
  pauseBackfill,
  resumeBackfill,
  cancelBackfill,
  getBacklogInventory,
  previewEligibleArticles,
  executeBackfillBatch,
  previewOutOfScopeCleanup,
  executeOutOfScopeCleanup,
  previewUncertainArticles,
  getHistoricalBackfillConfig,
  setHistoricalBackfillEnabled,
} from './src/server/backfill/backfillEngine';
import {
  previewFailedArticlesRecovery,
  requeueRecoverableFailedArticles,
  dismissResolvedFailedArticles,
  archiveFailedArticles,
  deleteObsoleteFailedArticles,
} from './src/server/backfill/failedArticleRecoveryService';
import {
  previewHistoricalBacklogCleanup,
  executeHistoricalBacklogCleanup,
} from './src/server/backfill/historicalBacklogCleanupService';
import {
  getGeminiQuotaStatus,
  GeminiQuotaExceededError,
} from './src/server/geminiQuotaGuard';
import {
  isGeminiConfigured,
  GEMINI_ANALYSIS_MODEL,
  SIGNALYN_ANALYSIS_VERSION,
} from './src/server/geminiClient';
import {
  queryHistoricalAnalytics,
  getDateRangePreset,
} from './src/services/historicalQueryService';
import { runHistoricalBackfillDryRun } from './src/server/analytics/historicalBackfillEngine';
import {
  initializeServerIdentity,
  getServerIdentityStatus,
  verifyServerDatabaseAccess,
} from './src/server/firestoreAdmin';
import {
  requireAdminOrAuthorizedClient,
  requireStrictAdminUser,
} from './src/server/authMiddleware';
import { getServerDb } from './src/server/serverFirestoreAdapter';
import {
  generateDailyBrief,
  getDailyBrief,
  listDailyBriefs,
} from './src/server/dailyBriefGenerator';
import {
  createGetDailyBriefHandler,
  createPostDailyBriefGenerateHandler,
  createPostPipelineRunHandler,
} from './src/server/dailyBriefRouteContract';
import {
  runDailyIntelligencePipeline,
  getPipelineStatus,
} from './src/server/dailyPipelineOrchestrator';
import { getPipelineLeaseStatus } from './src/server/pipelineLease';
import { requireSchedulerAuth } from './src/server/schedulerAuth';
import {
  evaluateStartupSchedulerPolicy,
  evaluateStartupServiceHydrationGate,
} from './src/server/schedulerSafetyGate';
import { resolveServerReleaseProvenance } from './src/server/sourceFingerprint';
import { getAthensCurrentDateString } from './src/server/reportingWindow';
import {
  executeLifecycleDryRun,
  runStoryLifecycleMaintenance,
} from './src/server/clustering/storyLifecycleService';
import { auditDuplicateStories } from './src/server/clustering/storyIdentityService';
import { isLegacyStory, isProductionStory, Story } from './src/types';
import {
  getStoryIntelligenceBackfillStatus,
  executeStoryIntelligenceBackfill,
  executeGuardedRollback,
  checkAdminRateLimit,
} from './src/server/storyIntelligenceBackfillService';
import {
  seedPilotCatalog,
  executeRetailCollection,
  getRetailDashboardStats,
  getRetailTrackedProducts,
  getRetailProductHistory,
  getRetailMatchReviews,
  resolveMatchReview,
  getRetailSources,
  runRetailIntegrityAudit,
} from './src/server/retail/retailPipelineService';
import {
  collectTargetedRetailer,
  DISCOVERY_RETAILERS,
  RetailCollectionError,
  withLegacyRetailWriter,
} from './src/server/retail/targetedCollection';
import {
  getRetailSourceConfigs,
  getRetailSourceConfig,
  updateRetailSourceConfig,
  resetRetailSourceDefaults,
  testRetailSourceConnection,
} from './src/server/retail/retailSourceService';
import {
  createDiscoveryJob,
  executeDiscoveryJobStep,
  getDiscoveryJob,
  getLatestDiscoveryJobForRetailer,
  abortDiscoveryJob,
  getRetailScheduleConfig,
  updateRetailScheduleConfig,
} from './src/server/retail/discoveryJobService';
import {
  getPersistenceDiagnostic as getRetailPersistenceDiagnostic,
  getMigrationPlan,
  executeCatalogMigration,
  performBoundedPersistenceTest,
  RECOVERY_BACKUP_PATH,
  ARTIFACT_BACKUP_PATH,
} from './src/server/retail/retailMigrationService';
import { auditBrandDuplicates } from './src/server/retail/brandNormalizer';
import {
  auditProductDuplicates,
  executeProductDeduplication,
} from './src/server/retail/productDeduplicationService';
import { RetailSourceId, RetailCategory } from './src/types/retailPrice';
import {
  getServiceSources,
  getServiceAdvisories,
  getServiceVulnerabilities,
  getServiceProductMatches,
  getServiceDashboardStats,
  getPersistenceDiagnostic as getServicePersistenceDiagnostic,
  runPersistenceProbe,
  recomputeCatalogMatches,
  recomputeServiceProductMatches,
  getMatchEvidenceReview,
  getOfficialSourceAuthenticityAudit,
  getOfficialAdapterAndIntegrityAudit,
  getSourceSyncSchemaAudit,
  reprocessSelectiveAppleAdvisories,
  syncServiceSource,
  syncAllServiceSources,
  resolveServiceProductMatch,
} from './src/server/service/servicePipelineService';
import { ServiceSourceId } from './src/types/serviceIntelligence';
import {
  getVocOverview,
  runVocSourceFeasibilityAudit,
  evaluateVocSampleDiagnostic,
} from './src/server/voc/vocPipelineService';
import {
  resolveSanitizedReleaseMetadata,
  SIGNALYN_APP_VERSION,
} from './src/utils/releaseMetadata';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  // Bind to port 3000 by default; respect CLI --port or APP_PORT, avoid Nginx collision on 8080
  const portArgIndex = process.argv.indexOf('--port');
  const cliPort = portArgIndex !== -1 ? parseInt(process.argv[portArgIndex + 1], 10) : null;
  const PORT = cliPort || (process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : (process.env.PORT && process.env.PORT !== '8080' ? parseInt(process.env.PORT, 10) : 3000));
  const isProduction = process.env.NODE_ENV === 'production';

  const identityStatus = initializeServerIdentity();
  console.log(
    `[Signalyn Identity] Initialized: ${identityStatus.initialized} (Mode: ${identityStatus.credentialMode}, Database: ${identityStatus.databaseId})`
  );

  app.use(express.json());

  // -------------------------------------------------------------
  // API Routes
  // -------------------------------------------------------------

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Signalyn Ingestion & Intelligence Platform',
      geminiConfigured: isGeminiConfigured(),
      serverIdentity: getServerIdentityStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  // Read-only Release & Build Traceability Endpoint (P2.3.2.2 R01)
  // Exposes only sanitized public build/deployment identifiers; never secrets, keys, or file paths.
  app.get('/api/system/release', (req, res) => {
    let manifestData: Record<string, string> = {};
    try {
      const manifestPath = path.join(__dirname, 'dist', 'release-metadata.json');
      if (fs.existsSync(manifestPath)) {
        manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      }
    } catch {
      // Ignore read errors and fall back to env / UNKNOWN
    }

    let pkgVersion = SIGNALYN_APP_VERSION;
    try {
      const pkgPath = path.join(__dirname, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg.version === 'string' && pkg.version.trim()) {
          pkgVersion = pkg.version.trim();
        }
      }
    } catch {
      // Fallback to SIGNALYN_APP_VERSION
    }

    const provenance = resolveServerReleaseProvenance({
      rootDir: __dirname,
      manifestData,
      env: process.env,
    });

    const resolvedAppVersion =
      process.env.SIGNALYN_APP_VERSION || manifestData.appVersion || pkgVersion;

    const releasePayload = resolveSanitizedReleaseMetadata({
      appVersion: resolvedAppVersion,
      buildId:
        process.env.SIGNALYN_BUILD_ID ||
        process.env.VITE_BUILD_ID ||
        process.env.BUILD_ID ||
        process.env.CLOUD_BUILD_ID ||
        manifestData.buildId ||
        process.env.K_REVISION ||
        (provenance.sourceFingerprint !== 'UNKNOWN'
          ? `signalyn-v${resolvedAppVersion}-${provenance.sourceFingerprint}`
          : null),
      commitSha: provenance.commitSha,
      sourceFingerprint: provenance.sourceFingerprint,
      buildTimestamp:
        process.env.SIGNALYN_BUILD_TIMESTAMP ||
        process.env.VITE_BUILD_TIMESTAMP ||
        process.env.BUILD_TIMESTAMP ||
        manifestData.buildTimestamp ||
        null,
      environment:
        process.env.K_SERVICE === 'signalyn'
          ? 'cloud-run-production'
          : process.env.SIGNALYN_ENV ||
            process.env.VITE_DEPLOYMENT_ENV ||
            process.env.DEPLOYMENT_ENV ||
            (process.env.NODE_ENV === 'production' ? 'production' : undefined) ||
            manifestData.environment ||
            'ai-studio-preview',
      serverReleaseId:
        process.env.K_REVISION ||
        process.env.SIGNALYN_SERVER_RELEASE_ID ||
        process.env.SIGNALYN_BUILD_ID ||
        manifestData.serverReleaseId ||
        manifestData.buildId ||
        (provenance.sourceFingerprint !== 'UNKNOWN'
          ? `signalyn-v${resolvedAppVersion}-${provenance.sourceFingerprint}`
          : null),
    });

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(releasePayload);
  });

  // Post-Publish Database Authorization Verification (Protected, Read-Only, Fail-Closed)
  app.get('/api/admin/verify-database-access', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const report = await verifyServerDatabaseAccess();
      res.json(report);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message });
    }
  });

  // -------------------------------------------------------------
  // Story Intelligence Backfill Administrative Endpoints (Phase 7B.3 Stage 2C)
  // Protected with strict owner-only authentication, CSRF checks, and rate limiting.
  // Execution modes: DRY_RUN (default), PILOT, PRODUCTION.
  // PILOT & PRODUCTION require server-side feature flag ENABLE_STORY_INTELLIGENCE_WRITES=true.
  // -------------------------------------------------------------

  // Status Endpoint (Read-Only)
  app.get('/api/admin/story-intelligence/status', requireAdminOrAuthorizedClient, (req, res) => {
    res.json(getStoryIntelligenceBackfillStatus());
  });

  // Story Intelligence Backfill Execution Endpoint
  app.post('/api/admin/story-intelligence/backfill', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      if (!checkAdminRateLimit(clientIp)) {
        res.status(429).json({ error: 'Rate limit exceeded for administrative story intelligence backfill.' });
        return;
      }

      const { mode = 'DRY_RUN', cohortStoryIds, batchSize } = req.body || {};
      const executedBy = (req as any).user?.email || (req as any).user?.uid || 'admin';

      const result = await executeStoryIntelligenceBackfill({
        mode,
        executedBy,
        cohortStoryIds,
        batchSize,
      });

      if (result.status === 'REJECTED') {
        res.status(403).json(result);
        return;
      }

      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'FAILED', error: message });
    }
  });

  // Story Intelligence Guarded Rollback Endpoint
  app.post('/api/admin/story-intelligence/rollback', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      if (!checkAdminRateLimit(clientIp)) {
        res.status(429).json({ error: 'Rate limit exceeded for administrative story intelligence rollback.' });
        return;
      }

      const { targetRunId } = req.body || {};
      const executedBy = (req as any).user?.email || (req as any).user?.uid || 'admin';

      const result = await executeGuardedRollback({
        targetRunId,
        executedBy,
      });

      if (result.status === 'REJECTED') {
        res.status(403).json(result);
        return;
      }

      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'FAILED', error: message });
    }
  });

  // Deprecated Handshake Endpoint (Requirement 3: Removed as authorization mechanism)
  app.post('/api/auth/handshake', (req, res) => {
    res.status(410).json({
      error: 'Gone: The unauthenticated session handshake mechanism has been decommissioned. Use verified Firebase ID tokens with explicit administrator privileges.',
    });
  });

  // Feed Discovery Endpoint: Real server-side HTML scraping and candidate probing (Protected)
  app.post('/api/discovery/inspect', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { websiteUrl } = req.body;
      if (!websiteUrl || typeof websiteUrl !== 'string') {
        res.status(400).json({ error: 'websiteUrl string is required.' });
        return;
      }

      console.log(`[API /discovery/inspect] Inspecting: ${websiteUrl}`);
      const discoveryResult = await discoverWebsiteFeeds(websiteUrl);
      res.json(discoveryResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Feed discovery failed.';
      console.error('[API /discovery/inspect] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Feed Manual Endpoint Validation: Probe single RSS/Atom feed URL (Protected)
  app.post('/api/discovery/validate', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { feedUrl } = req.body;
      if (!feedUrl || typeof feedUrl !== 'string') {
        res.status(400).json({ valid: false, error: 'feedUrl string is required.' });
        return;
      }

      console.log(`[API /discovery/validate] Validating single endpoint: ${feedUrl}`);
      const result = await validateFeedEndpoint(feedUrl);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Feed validation failed.';
      console.error('[API /discovery/validate] Error:', message);
      res.status(500).json({ valid: false, error: message });
    }
  });

  // Missing Article URL Diagnosis Endpoint (Requirement 11, Protected)
  app.post('/api/discovery/diagnose-article', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { url, sourceId } = req.body || {};
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'url string is required.' });
        return;
      }

      console.log(`[API /discovery/diagnose-article] Diagnosing article: ${url}`);
      const report = await diagnoseArticleUrl(url, sourceId);
      res.json(report);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Article diagnosis failed.';
      console.error('[API /discovery/diagnose-article] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Collector Trigger Endpoint: Trigger manual, single-source, or single-feed collection run
  app.post('/api/collector/run', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { sourceId, feedId, triggeredBy } = req.body || {};
      const status = await getCollectorStatus();

      // If already running, return the active run metadata without throwing an error
      if (status.isRunning) {
        console.log('[API /collector/run] Run already active. Returning current run status.');
        res.json({
          isRunning: true,
          message: 'A collection cycle is already active.',
          status: status.activeRun?.status || 'RUNNING',
          ...(status.activeRun || {}),
        });
        return;
      }

      console.log(
        `[API /collector/run] Triggering collection cycle (Source: ${sourceId || 'ALL'}, Feed: ${feedId || 'ALL'}, Type: ${triggeredBy || 'MANUAL'})`
      );

      // If client requests synchronous execution (e.g. test scripts):
      if (req.query.sync === 'true') {
        const runRecord = await runCollectionCycle(
          triggeredBy || (feedId ? 'SINGLE_FEED' : sourceId ? 'SINGLE_SOURCE' : 'MANUAL'),
          sourceId,
          feedId
        );
        res.json(runRecord);
        return;
      }

      // Default non-blocking async execution: Start run in background, respond immediately
      runCollectionCycle(
        triggeredBy || (feedId ? 'SINGLE_FEED' : sourceId ? 'SINGLE_SOURCE' : 'MANUAL'),
        sourceId,
        feedId
      ).catch((err) => {
        console.error('[API /collector/run] Background collector cycle error:', err);
      });

      // Brief tick to ensure runRecord initialization
      await new Promise((r) => setTimeout(r, 60));
      const freshStatus = await getCollectorStatus();

      res.json({
        isRunning: true,
        message: 'Collection cycle initiated in background.',
        status: freshStatus.activeRun?.status || 'RUNNING',
        ...(freshStatus.activeRun || {
          runId: `run-${Date.now().toString(36)}`,
          startedAt: new Date().toISOString(),
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Collector cycle execution failed.';
      console.error('[API /collector/run] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Collector Status Endpoint
  app.get('/api/collector/status', async (req, res) => {
    try {
      const status = await getCollectorStatus();
      res.json(status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to retrieve collector status.';
      res.status(500).json({ error: message });
    }
  });

  // Article Normalization & Entity Repair Endpoint
  app.post('/api/collector/repair-articles', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const maxArticles = req.body?.maxArticles ? parseInt(req.body.maxArticles, 10) : 500;
      console.log(`[API /collector/repair-articles] Triggering controlled batch repair (max: ${maxArticles})...`);
      const report = await repairCorruptedArticles({ maxArticles });
      res.json(report);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Article repair failed.';
      console.error('[API /collector/repair-articles] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Source Multi-Feed Schema Migration Endpoint
  app.post('/api/collector/migrate-sources', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      console.log('[API /collector/migrate-sources] Running idempotent Source feeds[] migration...');
      const result = await migrateLegacySourcesAdmin();
      console.log('[API /collector/migrate-sources] Migration result:', result);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Source migration failed.';
      console.error('[API /collector/migrate-sources] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // -------------------------------------------------------------
  // Phase 3: Gemini Intelligence Endpoints (/api/analysis/*)
  // -------------------------------------------------------------

  // Analysis status check
  app.get('/api/analysis/status', (req, res) => {
    res.json({
      configured: isGeminiConfigured(),
      model: GEMINI_ANALYSIS_MODEL,
      version: SIGNALYN_ANALYSIS_VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  // Fetch analysis for a specific article
  app.get('/api/analysis/article/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const snap = await getServerDb().collection('articleAnalysis').doc(id).get();
      if (!snap.exists) {
        res.status(404).json({ error: `No analysis found for article: ${id}` });
        return;
      }
      res.json(snap.data());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch article analysis.';
      res.status(500).json({ error: message });
    }
  });

  // Analyze or re-analyze single article (Protected)
  app.post('/api/analysis/article/:id', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { id } = req.params;
      const { forceReanalyze } = req.body || {};

      console.log(`[API /analysis/article/${id}] Triggering analysis (forceReanalyze: ${Boolean(forceReanalyze)})`);
      const result = await analyzeArticle(id, {
        forceReanalyze: Boolean(forceReanalyze),
        trigger: 'MANUAL_SINGLE',
      });

      if (!result.success) {
        res.status(500).json({ error: result.error, articleId: id });
        return;
      }

      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Article analysis failed.';
      console.error('[API /analysis/article] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Analyze batch of selected articles (Protected)
  app.post('/api/analysis/batch', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { articleIds, forceReanalyze } = req.body || {};
      if (!Array.isArray(articleIds) || articleIds.length === 0) {
        res.status(400).json({ error: 'articleIds array is required.' });
        return;
      }

      console.log(`[API /analysis/batch] Triggering batch analysis for ${articleIds.length} articles`);
      const batchResult = await analyzeArticlesBatch(articleIds, {
        forceReanalyze: Boolean(forceReanalyze),
        trigger: 'MANUAL_BATCH',
      });

      res.json(batchResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Batch analysis failed.';
      console.error('[API /analysis/batch] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Analyze pending articles (Protected)
  app.post('/api/analysis/pending', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const maxCount = req.body?.maxCount ? parseInt(req.body.maxCount, 10) : 5;
      console.log(`[API /analysis/pending] Triggering analysis for up to ${maxCount} pending articles`);

      const batchResult = await analyzePendingArticles(maxCount, {
        trigger: 'PENDING_BATCH',
      });

      res.json(batchResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Pending articles analysis failed.';
      console.error('[API /analysis/pending] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // -------------------------------------------------------------
  // Backfill Engine Routes (Phase 6D: Historical Intelligence Backfill)
  // -------------------------------------------------------------
  // Admin-only: Read-only inventory of actual Firestore articles and backlog categorization
  app.get('/api/backfill/inventory', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const inventory = await getBacklogInventory();
      res.json({ success: true, inventory });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('permission') || lower.includes('insufficient permissions')) {
        console.warn('[API /backfill/inventory] Permission notice:', msg);
        res.status(403).json({ success: false, error: msg });
        return;
      }
      console.error('[API /backfill/inventory] Error:', msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Admin-only: Preview upcoming eligible candidate articles
  app.get('/api/backfill/preview', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '20', 10);
      const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
      const candidates = await previewEligibleArticles(limit, runId);
      res.json({ success: true, candidates });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('permission') || lower.includes('insufficient permissions')) {
        console.warn('[API /backfill/preview] Permission notice:', msg);
        res.status(403).json({ success: false, error: msg });
        return;
      }
      console.error('[API /backfill/preview] Error:', msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Admin-only: Preview legacy out-of-scope candidates for safe cleanup (Phase 6E)
  app.get('/api/backfill/cleanup/preview', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '100', 10);
      const preview = await previewOutOfScopeCleanup(limit);
      res.json({ success: true, preview });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('permission') || lower.includes('insufficient permissions')) {
        console.warn('[API /backfill/cleanup/preview] Permission notice:', msg);
        res.status(403).json({ success: false, error: msg });
        return;
      }
      console.error('[API /backfill/cleanup/preview] Error:', msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Admin-only: Execute safe cleanup of legacy out-of-scope articles (dry-run by default)
  app.post('/api/backfill/cleanup/execute', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const result = await executeOutOfScopeCleanup(req.body || {});
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('PIPELINE_ACTIVE_PRIORITY')) {
        res.status(409).json({ success: false, error: msg, pipelineActive: true });
        return;
      }
      console.error('[API /backfill/cleanup/execute] Error:', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  // Admin-only: Preview uncertain corporate/ecosystem articles (Phase 6E)
  app.get('/api/backfill/uncertain/preview', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '62', 10);
      const preview = await previewUncertainArticles(limit);
      res.json({ success: true, preview });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('permission') || lower.includes('insufficient permissions')) {
        console.warn('[API /backfill/uncertain/preview] Permission notice:', msg);
        res.status(403).json({ success: false, error: msg });
        return;
      }
      console.error('[API /backfill/uncertain/preview] Error:', msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Admin-only: Read / update Historical Backfill enablement config (disabled by default)
  app.get('/api/backfill/config', requireAdminOrAuthorizedClient, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const config = await getHistoricalBackfillConfig();
      res.json({ success: true, config });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.post('/api/backfill/config', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { enabled, note } = req.body || {};
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ success: false, error: 'Boolean "enabled" flag is required.' });
        return;
      }
      const actor =
        (req as any).userEmail ||
        (req as any).user?.email ||
        (req as any).user?.uid ||
        'admin';
      const config = await setHistoricalBackfillEnabled(enabled, actor, typeof note === 'string' ? note : undefined);
      res.json({ success: true, config });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Read-only: Gemini API Quota Protection & True Provider-Request Accounting Status
  app.get('/api/quota/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const status = await getGeminiQuotaStatus();
      res.json({ success: true, quota: status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Admin-only: Comprehensive Historical Backlog Cleanup Preview (non-destructive, 0 Gemini calls)
  app.get('/api/backfill/backlog-cleanup/preview', requireStrictAdminUser, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const sampleLimit = parseInt((req.query.sampleLimit as string) || '10', 10);
      const preview = await previewHistoricalBacklogCleanup({
        sampleLimit: Number.isFinite(sampleLimit) ? sampleLimit : 10,
        confirmedByUid: (req as any).user.uid,
      });
      res.json({ success: true, preview });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('permission') || lower.includes('insufficient permissions')) {
        res.status(403).json({ success: false, error: msg });
        return;
      }
      console.error('[API /backfill/backlog-cleanup/preview] Error:', msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Strict Firebase Admin-only: Execute Bounded, Atomic, Preview-Bound Historical Backlog Cleanup (dry-run by default)
  app.post('/api/backfill/backlog-cleanup/execute', requireStrictAdminUser, async (req, res) => {
    try {
      const { dryRun, confirmCleanup, previewFingerprint, confirmationToken, categories, maxDeletions } = req.body || {};
      const executedBy =
        (req as any).userEmail ||
        (req as any).user?.email ||
        (req as any).user?.uid ||
        'admin';
      const result = await executeHistoricalBacklogCleanup({
        dryRun: dryRun !== false,
        confirmCleanup: confirmCleanup === true,
        previewFingerprint: typeof previewFingerprint === 'string' ? previewFingerprint : undefined,
        confirmationToken: typeof confirmationToken === 'string' ? confirmationToken : undefined,
        confirmedByUid: (req as any).user.uid,
        executedBy,
        categories: Array.isArray(categories) ? categories : undefined,
        maxDeletions: typeof maxDeletions === 'number' ? maxDeletions : undefined,
      });
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof PermanentArticleDeletionDisabledError) {
        res.status(503).json({ success: false, code: err.code, error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('PIPELINE_ACTIVE_PRIORITY') ||
        msg.includes('BACKFILL_LEASE_CONFLICT') ||
        msg.includes('HISTORICAL_CLEANUP_ACTIVE') ||
        msg.includes('PREVIEW_STALE_RECONFIRM_REQUIRED')
      ) {
        res.status(409).json({
          success: false,
          error: msg,
          pipelineActive: msg.includes('PIPELINE_ACTIVE_PRIORITY'),
          cleanupActive: msg.includes('HISTORICAL_CLEANUP_ACTIVE'),
          stalePreview: msg.includes('PREVIEW_STALE_RECONFIRM_REQUIRED'),
        });
        return;
      }
      console.error('[API /backfill/backlog-cleanup/execute] Error:', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  // Admin-only: Execute a bounded synchronous backfill batch
  app.post('/api/backfill/batch', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { batchSize, runId, maxStage2Calls } = req.body || {};
      const result = await executeBackfillBatch({
        batchSize,
        runId,
        maxStage2Calls,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof GeminiQuotaExceededError) {
        res.status(429).json({
          success: false,
          error: err.userMessage,
          code: err.code,
          retryAfterIso: err.retryAfterIso,
          quotaSuspended: true,
        });
        return;
      }
      if (msg.includes('HISTORICAL_BACKFILL_DISABLED')) {
        res.status(409).json({
          success: false,
          error: msg.replace(/^HISTORICAL_BACKFILL_DISABLED:\s*/, ''),
          code: 'HISTORICAL_BACKFILL_DISABLED',
          disabledByDefault: true,
        });
        return;
      }
      if (msg.includes('PIPELINE_ACTIVE_PRIORITY') || msg.includes('HISTORICAL_CLEANUP_ACTIVE')) {
        res.status(409).json({
          success: false,
          error: msg,
          pipelineActive: msg.includes('PIPELINE_ACTIVE_PRIORITY'),
          cleanupActive: msg.includes('HISTORICAL_CLEANUP_ACTIVE'),
        });
        return;
      }
      console.error('[API /backfill/batch] Error:', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.post('/api/backfill/start', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const run = await startBackfill(req.body || {});
      res.json({ success: true, run });
    } catch (err: any) {
      if (err instanceof GeminiQuotaExceededError) {
        res.status(429).json({ success: false, error: err.userMessage, code: err.code, quotaSuspended: true });
        return;
      }
      const msg = err?.message || String(err);
      if (msg.includes('HISTORICAL_BACKFILL_DISABLED')) {
        res.status(409).json({ success: false, error: msg.replace(/^HISTORICAL_BACKFILL_DISABLED:\s*/, ''), code: 'HISTORICAL_BACKFILL_DISABLED' });
        return;
      }
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.get('/api/backfill/status', async (req, res) => {
    try {
      const activeRun = await getActiveBackfillRun();
      if (activeRun) {
        return res.status(200).json({
          success: true,
          status: 'RUNNING',
          activeRun,
        });
      }
      return res.status(200).json({
        success: true,
        status: 'IDLE',
        activeRun: null,
      });
    } catch (err: any) {
      const rawMessage = (err?.message || String(err)).toLowerCase();
      const code = err?.code || '';

      // Authenticated/permission denial inspection
      if (
        code === 'permission-denied' ||
        code === 7 ||
        code === 403 ||
        rawMessage.includes('permission') ||
        rawMessage.includes('insufficient permissions') ||
        rawMessage.includes('unauthorized')
      ) {
        return res.status(403).json({
          success: false,
          status: 'UNKNOWN',
          error: {
            code: 'BACKFILL_STATUS_PERMISSION_DENIED',
            message: 'Backfill status cannot be verified with the current backend permissions.',
          },
        });
      }

      // Network / availability errors
      if (
        code === 'unavailable' ||
        code === 14 ||
        rawMessage.includes('network') ||
        rawMessage.includes('timeout') ||
        rawMessage.includes('econnrefused') ||
        rawMessage.includes('enotfound')
      ) {
        return res.status(503).json({
          success: false,
          status: 'UNKNOWN',
          error: {
            code: 'BACKFILL_STATUS_NETWORK_ERROR',
            message: 'Backfill status check failed due to a backend network or database availability issue.',
          },
        });
      }

      // Other unexpected server-side query errors
      return res.status(500).json({
        success: false,
        status: 'UNKNOWN',
        error: {
          code: 'BACKFILL_STATUS_UNEXPECTED_ERROR',
          message: 'An unexpected error occurred while verifying backfill status.',
        },
      });
    }
  });

  app.get('/api/backfill/checkpoint', requireAdminOrAuthorizedClient, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ checkpoint: await getHistoricalBackfillCheckpoint() });
    } catch {
      res.status(503).json({ error: 'Could not read the historical backfill checkpoint.' });
    }
  });

  app.post('/api/backfill/:runId/pause', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const run = await pauseBackfill(req.params.runId);
      res.json({ success: true, run });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || String(err) });
    }
  });

  app.post('/api/backfill/:runId/resume', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const run = await resumeBackfill(req.params.runId);
      res.json({ success: true, run });
    } catch (err: any) {
      if (err instanceof GeminiQuotaExceededError) {
        res.status(429).json({ success: false, error: err.userMessage, code: err.code, quotaSuspended: true });
        return;
      }
      const msg = err?.message || String(err);
      if (msg.includes('HISTORICAL_BACKFILL_DISABLED')) {
        res.status(409).json({ success: false, error: msg.replace(/^HISTORICAL_BACKFILL_DISABLED:\s*/, ''), code: 'HISTORICAL_BACKFILL_DISABLED' });
        return;
      }
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.post('/api/backfill/:runId/cancel', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const run = await cancelBackfill(req.params.runId);
      res.json({ success: true, run });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || String(err) });
    }
  });

  // Admin-only: Historical Failed Article Recovery & Cleanup Endpoints
  app.get('/api/backfill/failures/preview', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '100', 10);
      const category = typeof req.query.category === 'string' ? (req.query.category as any) : 'ALL';
      const includeArchived = req.query.includeArchived === 'true';
      const preview = await previewFailedArticlesRecovery({
        limit: Number.isFinite(limit) ? limit : 100,
        category,
        includeArchived,
      });
      res.json({ success: true, preview });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('permission') || lower.includes('insufficient permissions')) {
        res.status(403).json({ success: false, error: msg });
        return;
      }
      console.error('[API /backfill/failures/preview] Error:', msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.post('/api/backfill/failures/recover', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const actor = (req as any).userEmail || (req as any).user?.email || (req as any).user?.uid || 'admin';
      const result = await requeueRecoverableFailedArticles({
        ...(req.body || {}),
        executedBy: actor,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('PIPELINE_ACTIVE_PRIORITY') || msg.includes('HISTORICAL_CLEANUP_ACTIVE')) {
        res.status(409).json({
          success: false,
          error: msg,
          pipelineActive: msg.includes('PIPELINE_ACTIVE_PRIORITY'),
          cleanupActive: msg.includes('HISTORICAL_CLEANUP_ACTIVE'),
        });
        return;
      }
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.post('/api/backfill/failures/dismiss-resolved', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const actor = (req as any).userEmail || (req as any).user?.email || (req as any).user?.uid || 'admin';
      const result = await dismissResolvedFailedArticles({
        ...(req.body || {}),
        executedBy: actor,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('HISTORICAL_CLEANUP_ACTIVE')) {
        res.status(409).json({ success: false, error: msg, cleanupActive: true });
        return;
      }
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.post('/api/backfill/failures/archive', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const actor = (req as any).userEmail || (req as any).user?.email || (req as any).user?.uid || 'admin';
      const result = await archiveFailedArticles({
        ...(req.body || {}),
        executedBy: actor,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('HISTORICAL_CLEANUP_ACTIVE')) {
        res.status(409).json({ success: false, error: msg, cleanupActive: true });
        return;
      }
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.post('/api/backfill/failures/delete', requireStrictAdminUser, async (req, res) => {
    try {
      const actor = (req as any).user.uid;
      const result = await deleteObsoleteFailedArticles({
        ...(req.body || {}),
        executedBy: actor,
      });
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof PermanentArticleDeletionDisabledError) {
        res.status(503).json({ success: false, code: err.code, error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('HISTORICAL_CLEANUP_ACTIVE') || msg.includes('PREVIEW_STALE_RECONFIRM_REQUIRED')) {
        res.status(409).json({ success: false, error: msg });
        return;
      }
      res.status(400).json({ success: false, error: msg });
    }
  });

  // -------------------------------------------------------------
  // Historical Analytics Routes (Phase 5B)
  // -------------------------------------------------------------
  app.get('/api/analytics/historical', async (req, res) => {
    try {
      const { preset, startDate, endDate, category, companyId, includeUndated } = req.query as Record<string, string>;

      let rangeStart = startDate;
      let rangeEnd = endDate;

      if (preset && ['7d', '30d', '90d', '180d', 'ytd', 'all'].includes(preset)) {
        const computed = getDateRangePreset(preset as any);
        rangeStart = computed.startDate;
        rangeEnd = computed.endDate;
      }

      if (!rangeStart || !rangeEnd) {
        const default30 = getDateRangePreset('30d');
        rangeStart = default30.startDate;
        rangeEnd = default30.endDate;
      }

      const result = await queryHistoricalAnalytics({
        startDate: rangeStart,
        endDate: rangeEnd,
        category: category as any,
        companyId,
        includeUndated: includeUndated === 'true',
      });

      res.json(result);
    } catch (err: any) {
      console.error('[API /analytics/historical] Error:', err);
      res.status(500).json({ error: err.message || 'Historical query failed.' });
    }
  });

  app.get('/api/analytics/backfill-dry-run', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const maxArticles = req.query.maxArticles ? parseInt(String(req.query.maxArticles), 10) : 500;
      const report = await runHistoricalBackfillDryRun({ maxArticles });
      res.json(report);
    } catch (err: any) {
      console.error('[API /analytics/backfill-dry-run] Error:', err);
      res.status(500).json({ error: err.message || 'Backfill dry run failed.' });
    }
  });


  // -------------------------------------------------------------
  // Phase 6: Daily Intelligence Brief & Automated Pipeline Endpoints
  // -------------------------------------------------------------

  // Public: Get latest or date-specific Daily Brief (canonical /api/daily-brief/latest + /api/daily-brief alias)
  const handleGetDailyBrief = createGetDailyBriefHandler({ getDailyBrief });

  app.get('/api/daily-brief/latest', handleGetDailyBrief);
  app.get('/api/daily-brief', handleGetDailyBrief);

  // Public: List brief archives
  app.get('/api/daily-brief/archive', async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 30;
      const briefs = await listDailyBriefs(limit);
      res.json({ briefs });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve brief archive.';
      res.status(500).json({ error: msg });
    }
  });

  // Admin-only: Trigger Daily Brief generation / regeneration
  app.post(
    '/api/daily-brief/generate',
    requireAdminOrAuthorizedClient,
    createPostDailyBriefGenerateHandler({ generateDailyBrief })
  );

  // Admin-only: Trigger end-to-end Daily Intelligence Pipeline
  app.post(
    '/api/pipeline/run',
    requireAdminOrAuthorizedClient,
    createPostPipelineRunHandler({ runDailyIntelligencePipeline, getPipelineStatus })
  );

  // Dedicated Google Cloud Scheduler Endpoint: Trigger Synchronous Scheduled Intelligence Pipeline
  app.post('/api/pipeline/scheduled-run', requireSchedulerAuth, async (req, res) => {
    const schedulerIdentity = (req as any).schedulerIdentity;
    const callerRole = (req as any).authenticatedRole;
    console.log(
      `[API /pipeline/scheduled-run] Verified scheduled invocation by ${callerRole} (${schedulerIdentity?.email || 'Admin'})`
    );

    // Enforce server-side execution configuration - callers CANNOT override privileged pipeline settings
    const serverMaxArticles = parseInt(process.env.SCHEDULED_PIPELINE_MAX_ARTICLES || '15', 10);
    const executionDeadlineMs = parseInt(process.env.SCHEDULED_PIPELINE_DEADLINE_MS || '240000', 10); // 4 minutes

    try {
      // Proactively check lease before execution
      const leaseStatus = await getPipelineLeaseStatus();
      if (leaseStatus.active) {
        console.warn(
          `[API /pipeline/scheduled-run] Concurrent execution prevented. Active lease held by '${leaseStatus.lease?.leaseHolder}'`
        );
        res.status(409).json({
          status: 'SKIPPED_DUPLICATE',
          message: 'Pipeline lease is currently active. Concurrency locked.',
          activeLeaseHolder: leaseStatus.lease?.leaseHolder,
          expiresAt: leaseStatus.lease?.expiresAt,
          timeRemainingSeconds: leaseStatus.timeRemainingSeconds,
        });
        return;
      }

      // Execute pipeline synchronously within the active HTTP request with bounded deadline
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Scheduled pipeline execution timed out after ${executionDeadlineMs}ms.`)),
          executionDeadlineMs
        );
      });

      const pipelinePromise = runDailyIntelligencePipeline({
        trigger: 'SCHEDULED',
        dateStr: getAthensCurrentDateString(),
        skipCollection: false,
        skipBrief: false,
        maxArticlesToAnalyze: serverMaxArticles,
        forceLease: false,
      });

      const record = await Promise.race([pipelinePromise, timeoutPromise]);

      console.log(
        `[API /pipeline/scheduled-run] Completed scheduled execution ${record.runId} with status ${record.status}`
      );
      res.json({
        status: record.status,
        runId: record.runId,
        dateStr: record.dateStr,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        durationMs: record.summary.totalDurationMs,
        summary: record.summary,
        errors: record.errors,
        schedulerIdentity: schedulerIdentity?.email,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[API /pipeline/scheduled-run] Execution error:', msg);

      if (msg.includes('Cannot start pipeline: Pipeline lease currently held')) {
        res.status(409).json({
          status: 'SKIPPED_DUPLICATE',
          message: 'Pipeline lease acquisition conflict.',
          detail: msg,
        });
        return;
      }

      if (msg.includes('timed out')) {
        res.status(504).json({
          status: 'EXECUTION_TIMEOUT',
          error: msg,
        });
        return;
      }

      res.status(500).json({
        status: 'FAILED',
        error: msg,
      });
    }
  });

  // Public/Admin: Get pipeline status & durable lease info
  app.get('/api/pipeline/status', async (req, res) => {
    try {
      const [pipeStatus, leaseStatus] = await Promise.all([
        getPipelineStatus(),
        getPipelineLeaseStatus(),
      ]);
      res.json({
        ...pipeStatus,
        lease: leaseStatus,
        schedulerPolicy: evaluateStartupSchedulerPolicy(process.env),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve pipeline status.';
      res.status(500).json({ error: msg });
    }
  });

  // -------------------------------------------------------------
  // Phase 7B.1: Story Lifecycle Governance & Reconciliation Endpoints
  // -------------------------------------------------------------

  // Admin-only: Execute read-only lifecycle dry-run across production stories
  app.post('/api/stories/lifecycle/dry-run', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      console.log('[API /stories/lifecycle/dry-run] Running read-only lifecycle evaluation audit...');
      const report = await executeLifecycleDryRun();
      res.json(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lifecycle dry-run failed.';
      console.error('[API /stories/lifecycle/dry-run] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Admin-only: Execute bounded, write-conserving lifecycle maintenance reconciliation
  app.post('/api/stories/lifecycle/reconcile', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { batchSize, limit } = req.body || {};
      console.log(`[API /stories/lifecycle/reconcile] Executing bounded reconciliation (BatchSize: ${batchSize || 50}, Limit: ${limit || 500})...`);
      const result = await runStoryLifecycleMaintenance({
        batchSize: batchSize ? parseInt(String(batchSize), 10) : 50,
        maxTotal: limit ? parseInt(String(limit), 10) : 500,
        dryRun: false,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lifecycle reconciliation failed.';
      console.error('[API /stories/lifecycle/reconcile] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Admin-only: Execute read-only duplicate story audit across production stories (Phase 7B.2)
  app.get('/api/stories/audit/duplicates', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      console.log('[API /stories/audit/duplicates] Running read-only duplicate candidate audit...');
      const db = getServerDb();
      const snap = await db.collection('stories').get();
      const stories: Story[] = [];
      snap.forEach((d) => {
        const data = d.data() as Story;
        stories.push({ ...data, id: d.id });
      });

      const auditReport = auditDuplicateStories(stories);
      res.json(auditReport);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Duplicate audit failed.';
      console.error('[API /stories/audit/duplicates] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Admin-only: Execute bounded, atomic merge of two confirmed duplicate stories (Phase 7B.2)
  app.post('/api/stories/reconcile/merge', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { targetStoryId, sourceStoryId, reason } = req.body || {};
      if (!targetStoryId || !sourceStoryId) {
        res.status(400).json({ error: 'Both targetStoryId and sourceStoryId are required.' });
        return;
      }
      if (targetStoryId === sourceStoryId) {
        res.status(400).json({ error: 'Cannot merge a story into itself.' });
        return;
      }

      console.log(`[API /stories/reconcile/merge] Merging duplicate Story ${sourceStoryId} into ${targetStoryId}...`);
      const db = getServerDb();
      const targetRef = db.collection('stories').doc(targetStoryId);
      const sourceRef = db.collection('stories').doc(sourceStoryId);

      const [targetSnap, sourceSnap] = await Promise.all([targetRef.get(), sourceRef.get()]);
      if (!targetSnap.exists || !sourceSnap.exists) {
        res.status(404).json({ error: 'One or both story records could not be found.' });
        return;
      }

      const targetData = { ...targetSnap.data(), id: targetSnap.id } as Story;
      const sourceData = { ...sourceSnap.data(), id: sourceSnap.id } as Story;

      if (isLegacyStory(targetData) || isLegacyStory(sourceData)) {
        res.status(400).json({ error: 'Cannot merge legacy bootstrap stories.' });
        return;
      }

      const now = new Date().toISOString();
      const mergedArticleIds = Array.from(new Set([...(targetData.articleIds || []), ...(sourceData.articleIds || [])]));
      const mergedSourceIds = Array.from(new Set([...(targetData.sourceIds || []), ...(sourceData.sourceIds || [])]));
      const mergedCategories = Array.from(new Set([...(targetData.categories || []), ...(sourceData.categories || [])]));
      const mergedTopics = Array.from(new Set([...(targetData.topics || []), ...(sourceData.topics || [])]));

      const previousMerged = targetData.mergeMetadata?.mergedStoryIds || [];
      const updatedMergeMetadata = {
        mergedAt: now,
        mergedStoryIds: Array.from(new Set([...previousMerged, sourceStoryId])),
      };

      const mergeTimelineItem = {
        id: `dev-merge-${Date.now()}`,
        timestamp: now,
        developmentType: 'CORROBORATION',
        description: `Consolidated corroborating reporting from duplicate cluster (${sourceData.canonicalTitle || sourceData.title}). ${reason || ''}`.trim(),
        articleIds: sourceData.articleIds || [],
        sourceUrls: [],
        confidence: 'HIGH',
        evidenceClassification: targetData.evidenceClassification || 'MULTI_SOURCE_CORROBORATED',
      };

      const existingTimeline = Array.isArray(targetData.timeline) ? targetData.timeline : [];
      const updatedTimeline = [mergeTimelineItem, ...existingTimeline].slice(0, 10);

      const batch = db.batch();

      // 1. Update target story
      batch.update(targetRef, {
        articleIds: mergedArticleIds,
        articleCount: mergedArticleIds.length,
        sourceIds: mergedSourceIds,
        sourceCount: mergedSourceIds.length,
        categories: mergedCategories,
        topics: mergedTopics,
        mergeMetadata: updatedMergeMetadata,
        timeline: updatedTimeline,
        lastMaterialUpdateAt: now,
        updatedAt: now,
      });

      // 2. Soft-resolve source story with pointer (zero destruction of history!)
      batch.update(sourceRef, {
        status: 'RESOLVED',
        terminalReason: `Merged into authoritative cluster ${targetStoryId}`,
        mergedIntoStoryId: targetStoryId,
        updatedAt: now,
      });

      await batch.commit();

      console.log(`[API /stories/reconcile/merge] Successfully merged ${sourceStoryId} into ${targetStoryId} (${mergedArticleIds.length} articles).`);
      res.json({
        success: true,
        targetStoryId,
        sourceStoryId,
        mergedArticleCount: mergedArticleIds.length,
        mergedSourceCount: mergedSourceIds.length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Merge reconciliation failed.';
      console.error('[API /stories/reconcile/merge] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // -------------------------------------------------------------
  // Retail Price Intelligence (Phase P0) Endpoints
  // -------------------------------------------------------------
  app.get('/api/retail/dashboard', async (req, res) => {
    try {
      const stats = await getRetailDashboardStats();
      res.json(stats);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve retail dashboard stats.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/retail/products', async (req, res) => {
    try {
      const products = await getRetailTrackedProducts();
      res.json({ products });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve retail tracked products.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/retail/sources', async (req, res) => {
    try {
      const sources = await getRetailSources();
      res.json({ sources });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve retail sources.';
      res.status(500).json({ error: msg });
    }
  });

  // Retail Sources Configuration (P0.8: Read-only preview for all, full edit for admins)
  app.get('/api/retail/sources/config', async (req, res) => {
    try {
      const sources = await getRetailSourceConfigs();
      res.json({ success: true, sources });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve retail source configs.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Update Retailer Configuration (Protected, Admin-only)
  app.put('/api/retail/sources/:id', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const retailerId = req.params.id as RetailSourceId;
      if (!['public-gr', 'kotsovolos-gr', 'plaisio-gr'].includes(retailerId)) {
        res.status(400).json({ success: false, error: `Invalid retailer ID: ${retailerId}` });
        return;
      }

      const { confirmOverwriteValidUrl, ...updates } = req.body || {};
      const updated = await withLegacyRetailWriter(() => updateRetailSourceConfig(retailerId, updates, {
        confirmOverwriteValidUrl: Boolean(confirmOverwriteValidUrl),
      }));
      res.json({ success: true, source: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update retail source config.';
      console.error(`[API PUT /api/retail/sources/${req.params.id}] Error:`, msg);
      res.status(err instanceof RetailCollectionError ? err.statusCode : 400).json({ success: false, error: msg });
    }
  });

  // Reset Retailer Configuration to Verified Defaults (Protected, Admin-only)
  app.post('/api/retail/sources/:id/reset', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const retailerId = req.params.id as RetailSourceId;
      if (!['public-gr', 'kotsovolos-gr', 'plaisio-gr'].includes(retailerId)) {
        res.status(400).json({ success: false, error: `Invalid retailer ID: ${retailerId}` });
        return;
      }

      const confirmOverwriteValidUrl =
        req.body?.confirmOverwriteValidUrl !== undefined ? Boolean(req.body.confirmOverwriteValidUrl) : true;
      const resetSource = await withLegacyRetailWriter(() => resetRetailSourceDefaults(retailerId, { confirmOverwriteValidUrl }));
      res.json({ success: true, source: resetSource });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset retail source defaults.';
      res.status(err instanceof RetailCollectionError ? err.statusCode : 400).json({ success: false, error: msg });
    }
  });

  // Test Retailer Connection or Category Endpoint (Protected, Admin-only)
  app.post('/api/retail/sources/:id/test', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const retailerId = req.params.id as RetailSourceId;
      if (!['public-gr', 'kotsovolos-gr', 'plaisio-gr'].includes(retailerId)) {
        res.status(400).json({ success: false, error: `Invalid retailer ID: ${retailerId}` });
        return;
      }

      const { category, customUrl, timeoutSeconds } = req.body || {};
      const result = await withLegacyRetailWriter(() => testRetailSourceConnection(retailerId, {
        category: category as RetailCategory | undefined,
        customUrl,
        timeoutSeconds: timeoutSeconds ? Number(timeoutSeconds) : undefined,
      }));

      res.json({
        success: true,
        diagnostic: result.diagnostic,
        source: result.source,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connectivity diagnostic failed.';
      console.error(`[API POST /api/retail/sources/${req.params.id}/test] Error:`, msg);
      res.status(err instanceof RetailCollectionError ? err.statusCode : 500).json({ success: false, error: msg });
    }
  });

  app.get('/api/retail/history/:productId', async (req, res) => {
    try {
      const history = await getRetailProductHistory(req.params.productId);
      res.json({ history });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve retail price history.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/retail/reviews', async (req, res) => {
    try {
      const reviews = await getRetailMatchReviews();
      res.json({ reviews });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve match reviews.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/retail/integrity-audit', async (req, res) => {
    try {
      const audit = await runRetailIntegrityAudit();
      res.json({ success: true, audit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to execute retail integrity audit.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.post('/api/retail/reviews/:id/resolve', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { action, targetProductId } = req.body || {};
      const resolved = await withLegacyRetailWriter(() => resolveMatchReview(req.params.id, action, targetProductId));
      if (!resolved) {
        res.status(404).json({ error: 'Review not found' });
        return;
      }
      res.json({ success: true, review: resolved });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to resolve match review.';
      res.status(err instanceof RetailCollectionError ? err.statusCode : 500).json({ error: msg });
    }
  });

  app.post('/api/retail/collect', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1) {
        res.status(400).json({ error: 'Specify retailerId or explicitly request scope "all".' });
        return;
      }
      const run = body.scope === 'all'
        ? await withLegacyRetailWriter(() => executeRetailCollection('MANUAL'))
        : await collectTargetedRetailer(body.retailerId, req.get('Idempotency-Key'));
      res.json({ success: true, run });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retail collection execution failed.';
      res.status(err instanceof RetailCollectionError ? err.statusCode : 500).json({ error: msg });
    }
  });

  app.post('/api/retail/seed', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const counts = await withLegacyRetailWriter(() => seedPilotCatalog(true));
      res.json({ success: true, counts });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retail seed failed.';
      res.status(err instanceof RetailCollectionError ? err.statusCode : 500).json({ error: msg });
    }
  });

  // Retail Persistence Diagnostics & Database Targeting (Phase P1.5)
  app.get('/api/retail/persistence/diagnostics', async (req, res) => {
    try {
      const diagnostics = await getRetailPersistenceDiagnostic();
      res.json({ success: true, diagnostics });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve persistence diagnostics.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Bounded Write/Read/Verify/Delete Persistence Test Probe (Phase P1.5)
  app.post('/api/retail/persistence/test', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const probeResult = await performBoundedPersistenceTest();
      res.json({ success: probeResult.success, probe: probeResult });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Persistence probe execution failed.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Download Complete Retail Recovery Backup (JSON with Manifest & Checksums, Phase P1.5)
  app.get('/api/retail/migration/backup/download', (req, res) => {
    try {
      const backupPath = fs.existsSync(RECOVERY_BACKUP_PATH)
        ? RECOVERY_BACKUP_PATH
        : fs.existsSync(ARTIFACT_BACKUP_PATH)
        ? ARTIFACT_BACKUP_PATH
        : null;

      if (!backupPath) {
        res.status(404).json({ success: false, error: 'Recovery backup file not found.' });
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="signalyn_retail_recovery_backup_p1.5.json"');
      const fileStream = fs.createReadStream(backupPath);
      fileStream.pipe(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to download recovery backup.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Retail Data Migration Plan & Execution permanently disabled in P1.6
  app.get('/api/retail/migration/plan', async (_req, res) => {
    res.json({
      success: true,
      disabled: true,
      status: 'DISABLED_IN_P1.6',
      message: 'Migration workflow disabled per P1.6 simplification. Signalyn operates with fresh collection directly into Firestore.',
    });
  });

  // Execute Retail Data Migration to Firestore (Disabled in P1.6)
  app.post('/api/retail/migration/execute', requireAdminOrAuthorizedClient, async (_req, res) => {
    res.status(410).json({
      success: false,
      status: 'DISABLED_IN_P1.6',
      error: 'Legacy catalog migration workflow has been permanently disabled in Signalyn P1.6. The administrator has elected not to migrate previously scraped observations. Retail intelligence starts fresh with direct collection into Cloud Firestore.',
    });
  });

  // Retail Brand Duplicate Audit (Phase P1.7)
  app.get('/api/retail/brands/audit', async (req, res) => {
    try {
      const products = await getRetailTrackedProducts();
      const audit = auditBrandDuplicates(
        products.map((p) => ({ brand: p.product.brand, productId: p.product.id }))
      );
      res.json({ success: true, audit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Brand duplicate audit failed.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Retail Product Duplicate Audit (Phase P1.7)
  app.get('/api/retail/products/duplicates', async (req, res) => {
    try {
      const audit = auditProductDuplicates();
      res.json({ success: true, audit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Product duplicate audit failed.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Consolidate Duplicate Canonical Products (Phase P1.7, Protected, Admin-only)
  app.post('/api/retail/products/consolidate', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { isDryRun, approvedCandidateIds } = req.body || {};
      const result = await withLegacyRetailWriter(() => executeProductDeduplication({
        isDryRun: Boolean(isDryRun),
        approvedCandidateIds: Array.isArray(approvedCandidateIds) ? approvedCandidateIds : undefined,
      }));
      res.json({ success: true, result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Product consolidation failed.';
      res.status(err instanceof RetailCollectionError ? err.statusCode : 500).json({ success: false, error: msg });
    }
  });

  // -------------------------------------------------------------
  // Service Intelligence (Phase S1.0) Endpoints
  // -------------------------------------------------------------

  // List all registered official service sources & sync statuses
  app.get('/api/service/sources', async (req, res) => {
    try {
      const sources = await getServiceSources();
      res.json({ success: true, sources });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve service sources.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Query service advisories with rich filters
  app.get('/api/service/advisories', async (req, res) => {
    try {
      const { manufacturer, advisoryType, severity, isCisaKevOnly, verifiedOnly, searchQuery } = req.query;
      const advisories = await getServiceAdvisories({
        manufacturer: manufacturer ? String(manufacturer) : undefined,
        advisoryType: advisoryType ? String(advisoryType) : undefined,
        severity: severity ? String(severity) : undefined,
        isCisaKevOnly: isCisaKevOnly === 'true',
        verifiedOnly: verifiedOnly === 'true',
        searchQuery: searchQuery ? String(searchQuery) : undefined,
      });
      res.json({ success: true, advisories });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve service advisories.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Query security vulnerabilities (CVE / KEV)
  app.get('/api/service/vulnerabilities', async (req, res) => {
    try {
      const { vendor, isCisaKevOnly, limit } = req.query;
      const vulnerabilities = await getServiceVulnerabilities({
        vendor: vendor ? String(vendor) : undefined,
        isCisaKevOnly: isCisaKevOnly === 'true',
        limit: limit ? parseInt(String(limit), 10) : undefined,
      });
      res.json({ success: true, vulnerabilities });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve vulnerabilities.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Query product matches (defaults to authoritative persisted matches; includeCandidates=true includes unpersisted candidates)
  app.get('/api/service/product-matches', async (req, res) => {
    try {
      const { advisoryId, productId, confidence, includeCandidates } = req.query;
      const matches = await getServiceProductMatches({
        advisoryId: advisoryId ? String(advisoryId) : undefined,
        productId: productId ? String(productId) : undefined,
        confidence: confidence ? String(confidence) : undefined,
        includeCandidates: includeCandidates === 'true',
      });
      res.json({ success: true, matches });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve product matches.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Resolve product match review (Approve / Reject) (Protected, Admin-only)
  app.post('/api/service/matches/:id/resolve', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { action } = req.body || {};
      if (!action || !['APPROVE', 'REJECT'].includes(action)) {
        res.status(400).json({ success: false, error: 'Valid action (APPROVE | REJECT) is required.' });
        return;
      }
      const reviewedBy = (req as any).user?.email || (req as any).user?.uid || 'admin';
      const resolved = await resolveServiceProductMatch(req.params.id, action, reviewedBy);
      if (!resolved) {
        res.status(404).json({ success: false, error: 'Product match not found.' });
        return;
      }
      res.json({ success: true, match: resolved });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to resolve product match.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Production Persistence Diagnostic (Admin-only)
  app.get('/api/service/diagnostic/persistence', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const diagnostic = await getServicePersistenceDiagnostic(false);
      res.json({ success: true, diagnostic });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Diagnostic failed.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Execute Controlled Persistence Probe (Admin-only, Rate-limited, Concurrency-locked)
  app.post('/api/service/diagnostic/probe', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const probeReport = await runPersistenceProbe();
      res.json({ success: true, probeReport });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Persistence probe failed.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // S1.2.3, S1.2.4, S1.2.5 & S1.2.5.1 Admin-only Read-Only Match Evidence Review, Stratified Quality Audit & Source Authenticity Audit
  app.get('/api/service/matches/evidence-review', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const performLiveProbes = String(req.query.live || '').toLowerCase() === 'true';
      const reuseSnapshotIfValid =
        String(req.query.reuseSnapshot || 'true').toLowerCase() !== 'false';
      const authClassFilter = req.query.authenticityClassification
        ? String(req.query.authenticityClassification)
        : undefined;
      const review = await getMatchEvidenceReview({
        performLiveProbes,
        reuseSnapshotIfValid,
      });
      if (authClassFilter && authClassFilter !== 'ALL') {
        review.candidates = review.candidates.filter(
          (c) => c.authenticityClassification === authClassFilter,
        );
      }
      res.json({ success: true, review });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load match evidence review.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // S1.2.4 Admin-only Read-Only Official Source Authenticity & Product Applicability Audit Endpoint
  app.get('/api/service/audit/source-authenticity', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const performLiveProbes = String(req.query.live || '').toLowerCase() === 'true';
      const audit = await getOfficialSourceAuthenticityAudit({ performLiveProbes });
      res.json({ success: true, audit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to run official source authenticity audit.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // S1.2.5 Admin-only Read-Only Official Source Adapter & Data Integrity Audit Endpoint
  app.get('/api/service/audit/adapter-integrity', requireAdminOrAuthorizedClient, async (_req, res) => {
    try {
      const audit = await getOfficialAdapterAndIntegrityAudit();
      res.json({ success: true, audit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to run official adapter and integrity audit.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // S1.2.5.1 Objective 4: Admin-only Read-Only Source Synchronization Schema Audit Endpoint
  app.get('/api/service/audit/source-sync', requireAdminOrAuthorizedClient, async (_req, res) => {
    try {
      const audit = await getSourceSyncSchemaAudit();
      res.json({ success: true, audit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to run source synchronization schema audit.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // S1.2.6 Phase 2: Admin-only Read-Only Dry-Run Preview of Selective Apple Advisory Reprocessing
  app.get('/api/service/advisories/reprocess-apple/preview', requireAdminOrAuthorizedClient, async (_req, res) => {
    try {
      const report = await reprocessSelectiveAppleAdvisories({
        mode: 'DRY_RUN',
        confirmPersistence: false,
      });
      res.json({ success: true, report });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to preview selective Apple advisory reprocessing.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // S1.2.6 Phase 2: Admin-only Selective Apple Advisory Reprocessing (DRY_RUN by default; PERSIST requires confirmPersistence=true)
  app.post('/api/service/advisories/reprocess-apple', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const {
        mode = 'DRY_RUN',
        confirmPersistence = false,
        expectedSnapshotHash,
        targetAdvisoryIds,
        includeMetadataNormalization = true,
      } = req.body || {};
      const normalizedMode = mode === 'PERSIST' && confirmPersistence === true ? 'PERSIST' : 'DRY_RUN';
      const report = await reprocessSelectiveAppleAdvisories({
        mode: normalizedMode,
        confirmPersistence: Boolean(confirmPersistence),
        expectedSnapshotHash: expectedSnapshotHash ? String(expectedSnapshotHash) : undefined,
        targetAdvisoryIds: Array.isArray(targetAdvisoryIds) ? targetAdvisoryIds.map(String) : undefined,
        includeMetadataNormalization: Boolean(includeMetadataNormalization),
      });
      res.json({ success: report.status !== 'FAILED', report });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Selective Apple advisory reprocessing failed.';
      const statusCode = msg.includes('STALE_REPROCESS_SNAPSHOT') ? 409 : 500;
      res.status(statusCode).json({ success: false, error: msg });
    }
  });

  // Recompute Product Matches (Protected, Admin-only; defaults to DRY_RUN unless mode=PERSIST and confirmPersistence=true)
  app.post('/api/service/matches/recompute', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const {
        mode = 'DRY_RUN',
        confirmPersistence = false,
        expectedSnapshotHash,
        requirePriorDryRun = false,
      } = req.body || {};
      const normalizedMode = mode === 'PERSIST' && confirmPersistence === true ? 'PERSIST' : 'DRY_RUN';
      const reviewedBy = (req as any).user?.email || (req as any).user?.uid || 'admin';
      const summary = await recomputeServiceProductMatches({
        mode: normalizedMode,
        confirmPersistence: Boolean(confirmPersistence),
        reviewedBy,
        expectedSnapshotHash: expectedSnapshotHash ? String(expectedSnapshotHash) : undefined,
        requirePriorDryRun: Boolean(requirePriorDryRun),
      });
      res.json({ success: summary.status !== 'PERSISTENCE_FAILED', summary });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to recompute matches.';
      const statusCode =
        msg.includes('STALE_DRY_RUN_SNAPSHOT') || msg.includes('QUALITY_GATE_BLOCKED') ? 409 : 500;
      res.status(statusCode).json({ success: false, error: msg });
    }
  });

  // Get overview KPI statistics
  app.get('/api/service/dashboard-stats', async (req, res) => {
    try {
      const stats = await getServiceDashboardStats();
      res.json({ success: true, stats });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve service dashboard stats.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Synchronize single service source (Protected, Admin-only)
  app.post('/api/service/sync/:id', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const sourceId = req.params.id as ServiceSourceId;
      const validSources: ServiceSourceId[] = [
        'apple-security',
        'huawei-security',
        'samsung-security',
        'cisa-kev',
        'nvd-api',
      ];
      if (!validSources.includes(sourceId)) {
        res.status(400).json({ success: false, error: `Invalid source ID: ${sourceId}` });
        return;
      }
      const syncRun = await syncServiceSource(sourceId, 'MANUAL_ADMIN');
      res.json({ success: syncRun.status === 'COMPLETED', syncRun });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Service synchronization failed.';
      const statusCode = msg.includes('Concurrency locked') ? 409 : 500;
      res.status(statusCode).json({ success: false, error: msg });
    }
  });

  // Synchronize all official sources (Protected, Admin-only)
  app.post('/api/service/sync-all', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const runs = await syncAllServiceSources('MANUAL_ADMIN');
      res.json({ success: true, runs });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Service sync-all failed.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // -------------------------------------------------------------
  // Retail Product Discovery & Scraping Engine (Phase P1.0) Endpoints
  // -------------------------------------------------------------

  // Start Discovery Job (Protected, Admin-only)
  app.post('/api/retail/discovery/start', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { retailerId, categories, maxPages, maxProducts, requestDelaySeconds, timeoutSeconds, strategy } = req.body || {};
      if (!DISCOVERY_RETAILERS.includes(retailerId)) {
        res.status(400).json({ success: false, error: `Invalid or missing retailerId: ${retailerId}` });
        return;
      }

      const job = await withLegacyRetailWriter(() => createDiscoveryJob(retailerId as RetailSourceId, {
        categories: categories as RetailCategory[] | undefined,
        maxPages: maxPages ? Number(maxPages) : undefined,
        maxProducts: maxProducts ? Number(maxProducts) : undefined,
        requestDelaySeconds: requestDelaySeconds ? Number(requestDelaySeconds) : undefined,
        timeoutSeconds: timeoutSeconds ? Number(timeoutSeconds) : undefined,
        strategy: strategy || 'AUTO',
        triggeredBy: 'MANUAL',
      }));

      res.json({ success: true, job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start discovery job.';
      console.error('[API /retail/discovery/start] Error:', msg);
      const statusCode = err instanceof RetailCollectionError ? err.statusCode : msg.includes('Concurrency locked') ? 409 : 400;
      res.status(statusCode).json({ success: false, error: msg });
    }
  });

  // Execute Step of Discovery Job (Protected, Admin-only, bounded per category)
  app.post('/api/retail/discovery/step', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const { jobId } = req.body || {};
      if (!jobId) {
        res.status(400).json({ success: false, error: 'Missing jobId in request body.' });
        return;
      }

      const job = await withLegacyRetailWriter(() => executeDiscoveryJobStep(jobId));
      res.json({ success: true, job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to execute discovery job step.';
      console.error('[API /retail/discovery/step] Error:', msg);
      res.status(err instanceof RetailCollectionError ? err.statusCode : 500).json({ success: false, error: msg });
    }
  });

  // Get Discovery Job by ID (Protected, Read-only)
  app.get('/api/retail/discovery/job/:id', async (req, res) => {
    try {
      const job = await getDiscoveryJob(req.params.id);
      if (!job) {
        res.status(404).json({ success: false, error: 'Discovery job not found.' });
        return;
      }
      res.json({ success: true, job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve discovery job.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Get Latest Discovery Job for Retailer (Read-only)
  app.get('/api/retail/discovery/latest/:retailerId', async (req, res) => {
    try {
      const retailerId = req.params.retailerId as RetailSourceId;
      if (!['public-gr', 'kotsovolos-gr', 'plaisio-gr'].includes(retailerId)) {
        res.status(400).json({ success: false, error: `Invalid retailer ID: ${retailerId}` });
        return;
      }

      const job = await getLatestDiscoveryJobForRetailer(retailerId);
      res.json({ success: true, job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve latest discovery job.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Abort Discovery Job (Protected, Admin-only)
  app.post('/api/retail/discovery/abort/:id', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const job = await withLegacyRetailWriter(() => abortDiscoveryJob(req.params.id));
      if (!job) {
        res.status(404).json({ success: false, error: 'Discovery job not found.' });
        return;
      }
      res.json({ success: true, job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to abort discovery job.';
      res.status(err instanceof RetailCollectionError ? err.statusCode : 500).json({ success: false, error: msg });
    }
  });

  // Get Daily Schedule Configuration
  app.get('/api/retail/schedule', async (req, res) => {
    try {
      const config = await getRetailScheduleConfig();
      res.json({ success: true, config });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve schedule config.';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Update Daily Schedule Configuration (Protected, Admin-only)
  app.put('/api/retail/schedule', requireAdminOrAuthorizedClient, async (req, res) => {
    try {
      const callerEmail = (req as any).userEmail || (req as any).schedulerIdentity?.email || 'admin';
      const updated = await updateRetailScheduleConfig(req.body || {}, callerEmail);
      res.json({ success: true, config: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update schedule config.';
      res.status(400).json({ success: false, error: msg });
    }
  });

  // Cloud Scheduler Dedicated Daily Run Endpoint (Protected by requireSchedulerAuth)
  app.post('/api/retail/schedule/daily-run', requireSchedulerAuth, async (req, res) => {
    try {
      const config = await getRetailScheduleConfig();
      if (!config.enabled || !config.approvedByAdmin) {
        console.warn('[API /retail/schedule/daily-run] Scheduled run skipped: Schedule is not enabled or approved by administrator.');
        res.status(403).json({
          success: false,
          status: 'SKIPPED_NOT_APPROVED',
          message: 'Retail scheduled collection is disabled or pending administrator approval.',
        });
        return;
      }

      if (!Array.isArray(config.targetRetailers) || !config.targetRetailers.length ||
          !config.targetRetailers.every((retailer) => DISCOVERY_RETAILERS.includes(retailer))) {
        res.status(400).json({ success: false, error: 'Schedule contains an unsupported retailer selection.' });
        return;
      }
      console.log(`[API /retail/schedule/daily-run] Executing scheduled discovery across retailers: ${config.targetRetailers.join(', ')}`);
      const jobs: any[] = [];
      for (const retailerId of config.targetRetailers) {
        try {
          const job = await withLegacyRetailWriter(() => createDiscoveryJob(retailerId, {
            maxPages: config.maxPagesPerCategory,
            maxProducts: config.maxProductsPerCategory,
            requestDelaySeconds: config.requestDelaySeconds,
            triggeredBy: 'SCHEDULED',
          }));
          jobs.push(job);
        } catch (err) {
          console.error(`[API /retail/schedule/daily-run] Failed to start job for ${retailerId}:`, err);
        }
      }

      res.json({
        success: jobs.length === config.targetRetailers.length,
        status: jobs.length === config.targetRetailers.length ? 'SCHEDULED_JOBS_INITIATED' : 'SCHEDULED_JOBS_INCOMPLETE',
        jobsCount: jobs.length,
        jobs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scheduled discovery run failed.';
      console.error('[API /retail/schedule/daily-run] Error:', msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // -------------------------------------------------------------
  // Voice of Customer (VOC P1.0) Intelligence Endpoints (/api/voc/*)
  // -------------------------------------------------------------

  // Get VOC Overview (Dashboard metrics, sources, clusters, reports, product summaries, advisory correlations)
  app.get('/api/voc/overview', async (req, res) => {
    try {
      const manufacturer = typeof req.query.manufacturer === 'string' ? req.query.manufacturer : 'Huawei';
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const searchQuery = typeof req.query.searchQuery === 'string' ? req.query.searchQuery : undefined;
      const payload = await getVocOverview({ manufacturer, category, searchQuery });
      res.json(payload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load Voice of Customer overview.';
      console.error('[API /voc/overview] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Get VOC Source Feasibility Matrix & Optional Live HTTP Probe
  app.get('/api/voc/sources/feasibility', async (req, res) => {
    try {
      const liveProbe = req.query.liveProbe === 'true';
      const report = await runVocSourceFeasibilityAudit({ liveProbe, timeoutMs: 4500 });
      res.json(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to execute VOC source feasibility audit.';
      console.error('[API /voc/sources/feasibility] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Dry-Run Diagnostic Evaluator (Taxonomy + PII Redactor + Conservative Product Matcher + Advisory Correlator)
  app.post('/api/voc/diagnostic/evaluate-sample', async (req, res) => {
    try {
      const { text, manufacturerHint, sourceId, sourceUrl, publishedAt } = req.body || {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Sample complaint text is required for diagnostic evaluation.' });
        return;
      }
      const evaluation = await evaluateVocSampleDiagnostic({
        text,
        manufacturerHint,
        sourceId,
        sourceUrl,
        publishedAt,
      });
      res.json(evaluation);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to evaluate VOC diagnostic sample.';
      console.error('[API /voc/diagnostic/evaluate-sample] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // P2.3.2.4 Scheduler Safety Gate: External Cloud Scheduler (POST /api/pipeline/scheduled-run)
  // is the single production scheduling authority. In-process timer is disabled in Cloud Run /
  // production and by default to prevent multi-instance duplicate runs and lock conflicts.
  const startupSchedulerPolicy = evaluateStartupSchedulerPolicy(process.env);
  if (startupSchedulerPolicy.enableInProcessCollectorTimer) {
    try {
      initializeScheduler(120);
    } catch (err) {
      console.warn('[Collector Scheduler] Warning: Scheduler initialization notice:', err);
    }
  } else {
    console.log(
      `[Collector Scheduler] In-process interval timer disabled (${startupSchedulerPolicy.rationale}). Authority: ${startupSchedulerPolicy.schedulingAuthority}`
    );
  }

  // Startup initialization note: maintenance mutations (repair/migration) are disabled on startup
  // and must be invoked exclusively via authenticated admin endpoints (/api/collector/repair-articles, etc.)
  console.log('[Signalyn Server] Startup complete. Maintenance mutations disabled on startup; public read-only and authenticated operations active.');

  // -------------------------------------------------------------
  // API 404 Guard: Ensure unmatched /api/* routes never fall through to SPA HTML
  // -------------------------------------------------------------
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // -------------------------------------------------------------
  // Frontend Mounting: Vite dev middleware or static dist
  // -------------------------------------------------------------
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : true,
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Bind to 0.0.0.0 on port 3000
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Signalyn Server] Operating on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
    
    // P2.3.2.4 Startup Service Intelligence Gate:
    // Perform read-only state hydration from Firestore. Automatic external scraping / sync on
    // container boot is disabled in production and by default, and fails closed if Firestore
    // reachability is not FIRESTORE_AUTHORITATIVE.
    setTimeout(async () => {
      try {
        const {
          initializeServiceIntelligence,
          getServiceDashboardStats,
          syncAllServiceSources,
        } = await import('./src/server/service/servicePipelineService');
        await initializeServiceIntelligence();

        const policy = evaluateStartupSchedulerPolicy(process.env);
        if (!policy.enableStartupServiceAutoSync) {
          return;
        }

        const stats = await getServiceDashboardStats();
        const gate = evaluateStartupServiceHydrationGate({
          policy,
          persistenceStatus: stats.persistedMatchesStatus,
          totalAdvisories: stats.totalAdvisories,
        });

        if (gate.shouldTriggerSync) {
          console.log('[Signalyn Server] Performing explicit non-production Service Intelligence baseline hydration...');
          await syncAllServiceSources();
          console.log('[Signalyn Server] Service Intelligence baseline hydration completed.');
        } else {
          console.log(`[Signalyn Server] Startup Service auto-sync skipped (${gate.reason}).`);
        }
      } catch (err) {
        console.warn('[Signalyn Server] Initial service hydration notice:', err);
      }
    }, 2000);
  });
}

startServer().catch((err) => {
  console.error('[Signalyn Server] Fatal error starting server:', err);
  process.exit(1);
});

# SIGNALYN — Final Pre-Deployment Scheduler Safety Gate Report

**Target Production Environment**

- **Application**: https\://hw-signalyn.ai.studio/
- **Firebase Project**: signalyn-5406e
- **Authoritative Named Firestore Database**: ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34
- **Cloud Run Service**: signalyn (us-west1)

---

## 1. Actual Scheduler Execution Architecture

Prior to hardening in this gate, three background/scheduled execution paths existed in the codebase:

| **Execution Path**                                   | **Entry Point**                                                                                                        | **Trigger Mechanism**                                                                                                  | **Scope of Operations**                                                                                                                                               | **Concurrency / Lease Mechanism**                                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Path 1: External Cloud Scheduler (Authoritative)** | POST /api/pipeline/scheduled-run (server.ts) -> runDailyIntelligencePipeline (src/server/dailyPipelineOrchestrator.ts) | Google Cloud Scheduler HTTP POST with OIDC Bearer token verified by requireSchedulerAuth (src/server/schedulerAuth.ts) | Full 5-stage pipeline: Source Repair -> RSS Collection (runCollectionCycle) -> Gemini Article Analysis -> Story Clustering & Lifecycle -> Executive Daily Brief       | **Distributed Firestore transactional lease** (system/pipelineLease, TTL 12 min) via getPipelineLeaseStatus() and acquirePipelineLease() (src/server/pipelineLease.ts). Returns HTTP 409 SKIPPED_DUPLICATE on overlap. |
| **Path 2: In-Process RSS Interval Timer**            | initializeScheduler(120) (server.ts -> src/server/collectorService.ts)                                                 | Unconditional Node.js setInterval(..., 120 \* 60 \* 1000) registered on server startup                                 | RSS/Atom feed collection across active sources (runCollectionCycle('SCHEDULED')), writing to articles, sources, and system/collectorState                             | **Process-local memory boolean only** (let isRunning = false in collectorService.ts). Did **not** check or acquire system/pipelineLease.                                                                               |
| **Path 3: Startup Service Intelligence Auto-Sync**   | app.listen setTimeout(..., 2000) (server.ts) -> syncAllServiceSources() (src/server/service/servicePipelineService.ts) | Automatic 2-second post-boot timer checking if (stats.totalAdvisories === 0)                                           | Live external scraping of Apple, Huawei, Samsung, CISA KEV, and NIST NVD and writes to serviceAdvisories, serviceVulnerabilities, serviceSources, and serviceSyncRuns | **Process-local Set\<ServiceSourceId> (activeSyncLocks) only**. No distributed cross-instance lock and no fail-closed check on Firestore read health.                                                                  |

---

## 2. Duplicate Execution and Startup Side-Effect Risks Identified

Tracing all six required investigation vectors confirmed **two pre-deployment operational risks**:

1. **Can multiple Cloud Run instances independently trigger the in-process timer?**
   - **Yes (Confirmed Risk prior to fix).** Because initializeScheduler(120) used a per-process setInterval and a process-local isRunning flag, every warm Cloud Run container instance would independently execute runCollectionCycle('SCHEDULED') every 120 minutes.
2. **Do the in-process timer and Cloud Scheduler share the same lease or concurrency protection?**
   - **No (Confirmed Risk prior to fix).** External Cloud Scheduler (POST /api/pipeline/scheduled-run) acquires the distributed Firestore lease system/pipelineLease, whereas initializeScheduler(120) bypassed system/pipelineLease and called runCollectionCycle('SCHEDULED') directly:
     - **Cross-instance collision:** Instance A running the in-process timer and Instance B handling POST /api/pipeline/scheduled-run could scrape the same 17 RSS sources and write to sources, articles, and system/collectorState simultaneously.
     - **Same-instance pipeline failure:** If the in-process timer was mid-collection when POST /api/pipeline/scheduled-run arrived on the same instance, Stage 2 (collectionAndIngestion) of the official scheduled pipeline would throw 'A collection cycle is already active' and mark the stage FAILED.
3. **Can Cloud Run restarts or transient Firestore read errors trigger unintended Service Intelligence synchronization?**
   - **Yes (Critical Risk prior to fix).** On container boot, getServiceDashboardStats() called initializeServiceIntelligence() and refreshAuthoritativeStateFromFirestore(). In servicePipelineService.ts, if a cold-starting container experienced a transient Firestore read error or credential initialization delay, the catch block set globalPersistenceMode = 'PREVIEW_IN_MEMORY_ONLY' while leaving memAdvisories empty (size === 0). getServiceDashboardStats() then returned totalAdvisories: 0 (alongside persistedMatchesStatus: 'UNAVAILABLE'), causing if (stats.totalAdvisories === 0) in server.ts to mistake a failed Firestore read for an empty database and trigger syncAllServiceSources() on startup.
4. **Does disabling in-process scheduling and automatic startup Service sync affect any required production functionality?**
   - **No.**
     - Scheduled RSS ingestion, article analysis, clustering, and Daily Brief generation are executed end-to-end by external Cloud Scheduler via POST /api/pipeline/scheduled-run.
     - Read-only in-memory hydration of existing Service Intelligence records from Firestore is still performed on startup via initializeServiceIntelligence().
     - Manual administrator operations remain available on demand via authenticated endpoints (POST /api/collector/run, POST /api/pipeline/run, POST /api/daily-brief/generate, POST /api/service/sync/:id, and POST /api/service/sync-all).

---

## 3. Minimal Code Changes Made (Before & After Behavior)

### A. Created /src/server/schedulerSafetyGate.ts

- Added evaluateStartupSchedulerPolicy(env):
  - When running in Cloud Run (K_SERVICE set) or production (NODE_ENV === 'production'), unconditionally sets schedulingAuthority: 'EXTERNAL_CLOUD_SCHEDULER', enableInProcessCollectorTimer: false, and enableStartupServiceAutoSync: false—even if opt-in environment variables are accidentally set.
  - In non-production environments (AI Studio Preview / local dev), defaults both enableInProcessCollectorTimer and enableStartupServiceAutoSync to false unless explicitly opted in (ENABLE_IN_PROCESS_SCHEDULER=true / ENABLE_STARTUP_SERVICE_AUTO_SYNC=true).
- Added evaluateStartupServiceHydrationGate({ policy, persistenceStatus, totalAdvisories }):
  - **Fails closed** (shouldTriggerSync: false) if startup auto-sync is disabled by policy (STARTUP_AUTO_SYNC_DISABLED_BY_POLICY), if persistenceStatus !== 'FIRESTORE_AUTHORITATIVE' (FIRESTORE_NOT_AUTHORITATIVE_FAIL_CLOSED), or if totalAdvisories !== 0 (ADVISORIES_ALREADY_POPULATED_OR_UNAVAILABLE).

### B. Updated /src/server/collectorService.ts

- Added stopScheduler() to cleanly clear any active interval timer.
- Updated getCollectorStatus() to report schedulingAuthority: scheduledTimer ? 'IN_PROCESS_TIMER' : 'EXTERNAL_CLOUD_SCHEDULER'.

### C. Updated /server.ts

- **Before**: Unconditionally called initializeScheduler(120) on server startup and ran if (stats.totalAdvisories === 0) { await syncAllServiceSources(); } 2 seconds after app.listen().
- **After**:
  1. Evaluates evaluateStartupSchedulerPolicy(process.env) and only invokes initializeScheduler(120) when enableInProcessCollectorTimer is true (never in Cloud Run or production, and off by default everywhere).
  2. In the post-listen startup hook, runs read-only initializeServiceIntelligence() to hydrate caches from Firestore, and skips syncAllServiceSources() unless enableStartupServiceAutoSync is explicitly enabled outside production **and** evaluateStartupServiceHydrationGate verifies persistenceStatus === 'FIRESTORE_AUTHORITATIVE' with totalAdvisories === 0.
  3. Exposes schedulerPolicy in GET /api/pipeline/status for operational transparency.

---

## 4. Test Results

All isolated test suites and the production TypeScript/Vite build passed with zero external network calls and zero Firestore writes:

| **Verification Suite**                          | **Command**                                                          | **Result**          |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| **P2.3.2.4 Scheduler Safety Gate Suite**        | npx tsx tests/p2324SchedulerSafetyGate.test.ts                       | **10 / 10 PASS**    |
| **Phase 6B Scheduler OIDC & Lease Reliability** | npx tsx tests/phase6bSchedulerSecurityAndReliability.test.ts         | **11 / 11 PASS**    |
| **P2.3.2.3 Consolidated Readiness Review**      | npx tsx tests/p2323DeploymentReadinessReview\.test.ts                | **17 / 17 PASS**    |
| **P2.3.2.2 Operational Consistency & Release**  | npx tsx tests/p2322OperationalConsistencyReleaseTraceability.test.ts | **14 / 14 PASS**    |
| **P2.3.2 Data Integrity & Metrics Reliability** | npx tsx tests/p232DataIntegrityMetrics.test.ts                       | **29 / 29 PASS**    |
| **P2.3.1 & P2.3.1.1 Functional & Safety Gate**  | npx tsx tests/p231CriticalFunctionalRecovery.test.ts                 | **28 / 28 PASS**    |
| **API Authorization & Rate-Limit Audit**        | npx tsx tests/apiAuthorizationAudit.test.ts                          | **9 / 9 PASS**      |
| **Full Application Build (tsc + vite build)**   | npm run build (compile_applet)                                       | **PASS (0 errors)** |

---

## 5. Whether Cloud Scheduler Alone Can Safely Operate Production Scheduling

**Yes.** External Google Cloud Scheduler invoking POST /api/pipeline/scheduled-run is completely self-sufficient for production scheduling:

1. **End-to-End Orchestration**: runDailyIntelligencePipeline (trigger: 'SCHEDULED', skipCollection: false, skipBrief: false) executes Stage 1 (Source & Article Repair), Stage 2 (RSS Feed Collection via runCollectionCycle), Stage 3 (Pending Article Gemini Analysis with fresh-strategic prioritization), Stage 4 (Story Clustering & Lifecycle Maintenance), and Stage 5 (Executive Daily Brief Generation for the Europe/Athens date).
2. **Cryptographic Authentication**: Protected by requireSchedulerAuth, which verifies the Google-signed OIDC Bearer token (iss, aud, expiry, and authorized scheduler service account email) or verified administrator token.
3. **Distributed Concurrency Protection**: Protected by the transactional Firestore lease at system/pipelineLease (12-minute TTL), returning HTTP 409 SKIPPED_DUPLICATE if another scheduled or manual pipeline run is already active across any Cloud Run instance.

---

## 6. Remaining Operational Dependencies

When performing the controlled production deployment to Cloud Run (signalyn in us-west1), verify the following standard runtime settings remain in place:

1. SCHEDULER_SERVICE_ACCOUNT_EMAIL: Set to the authorized Cloud Scheduler OIDC service account email (e.g., signalyn-scheduler\@signalyn-5406e.iam.gserviceaccount.com) so requireSchedulerAuth can validate scheduled OIDC tokens (fails closed with HTTP 503 if unset).
2. SCHEDULER_EXPECTED_AUDIENCE (optional override): Defaults to https\://hw-signalyn.ai.studio/api/pipeline/scheduled-run.
3. GEMINI_API_KEY: Required for server-side article analysis and Daily Brief synthesis during scheduled and manual runs.
4. Build-time/runtime release metadata (APP_VERSION, BUILD_ID, GIT_COMMIT_SHA, BUILD_TIMESTAMP, VITE_BUILD_ID, VITE_GIT_COMMIT_SHA, VITE_BUILD_TIMESTAMP) injected consistently so GET /api/system/release and the frontend bundle report MATCH.

---

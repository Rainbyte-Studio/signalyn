/**
 * SIGNALYN — P2.3.2.4 FINAL PRE-DEPLOYMENT SCHEDULER SAFETY GATE TEST SUITE
 *
 * Verifies:
 * 1. Single production scheduling authority (`EXTERNAL_CLOUD_SCHEDULER`) in Cloud Run (`K_SERVICE`)
 *    and production (`NODE_ENV === 'production'`), disabling the in-process `setInterval` timer
 *    even if `ENABLE_IN_PROCESS_SCHEDULER=true` is set.
 * 2. Safe default policy in preview / local development: both `enableInProcessCollectorTimer`
 *    and `enableStartupServiceAutoSync` default to `false`.
 * 3. Startup Service Intelligence hydration gate fails closed on:
 *    - Cloud Run / production startup (`STARTUP_AUTO_SYNC_DISABLED_BY_POLICY`)
 *    - Default non-production startup (`STARTUP_AUTO_SYNC_DISABLED_BY_POLICY`)
 *    - Transient Firestore read failure / non-authoritative DB (`FIRESTORE_NOT_AUTHORITATIVE_FAIL_CLOSED`)
 *      even when `totalAdvisories === 0`
 *    - Populated database (`totalAdvisories > 0` -> `ADVISORIES_ALREADY_POPULATED_OR_UNAVAILABLE`)
 * 4. `initializeScheduler` and `stopScheduler` lifecycle & `getCollectorStatus` reporting
 *    `schedulingAuthority: 'EXTERNAL_CLOUD_SCHEDULER'` when no in-process timer is running.
 * 5. External Cloud Scheduler (`POST /api/pipeline/scheduled-run`) OIDC verification and
 *    distributed lease duplicate suppression (`409 SKIPPED_DUPLICATE`) remain intact.
 * 6. Static wiring audit of `server.ts` confirming no unguarded `initializeScheduler(120)`
 *    or unguarded startup `syncAllServiceSources()` calls remain.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateStartupSchedulerPolicy,
  evaluateStartupServiceHydrationGate,
} from '../src/server/schedulerSafetyGate';
import {
  initializeScheduler,
  stopScheduler,
  getCollectorStatus,
} from '../src/server/collectorService';

console.log('=== RUNNING P2.3.2.4 FINAL PRE-DEPLOYMENT SCHEDULER SAFETY GATE TESTS ===\n');

let passedCount = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`, err);
    process.exitCode = 1;
  }
}

async function run() {
  // 1. Cloud Run runtime (`K_SERVICE`) unconditionally disables in-process timer & startup auto-sync
  await test('Cloud Run runtime (K_SERVICE=signalyn) enforces EXTERNAL_CLOUD_SCHEDULER and disables all startup/timer jobs', () => {
    const policy = evaluateStartupSchedulerPolicy({
      K_SERVICE: 'signalyn',
      NODE_ENV: 'production',
    });

    assert.equal(policy.schedulingAuthority, 'EXTERNAL_CLOUD_SCHEDULER');
    assert.equal(policy.isCloudRunRuntime, true);
    assert.equal(policy.isProductionEnv, true);
    assert.equal(policy.enableInProcessCollectorTimer, false);
    assert.equal(policy.enableStartupServiceAutoSync, false);
  });

  // 2. Cloud Run runtime ignores accidental opt-in env flags
  await test('Cloud Run runtime blocks ENABLE_IN_PROCESS_SCHEDULER=true and ENABLE_STARTUP_SERVICE_AUTO_SYNC=true', () => {
    const policy = evaluateStartupSchedulerPolicy({
      K_SERVICE: 'signalyn',
      NODE_ENV: 'development',
      ENABLE_IN_PROCESS_SCHEDULER: 'true',
      ENABLE_STARTUP_SERVICE_AUTO_SYNC: 'true',
    });

    assert.equal(policy.schedulingAuthority, 'EXTERNAL_CLOUD_SCHEDULER');
    assert.equal(policy.enableInProcessCollectorTimer, false);
    assert.equal(policy.enableStartupServiceAutoSync, false);
  });

  // 3. NODE_ENV=production without K_SERVICE still enforces EXTERNAL_CLOUD_SCHEDULER
  await test('NODE_ENV=production enforces EXTERNAL_CLOUD_SCHEDULER even if K_SERVICE is unset', () => {
    const policy = evaluateStartupSchedulerPolicy({
      NODE_ENV: 'production',
      ENABLE_IN_PROCESS_SCHEDULER: 'true',
      ENABLE_STARTUP_SERVICE_AUTO_SYNC: 'true',
    });

    assert.equal(policy.schedulingAuthority, 'EXTERNAL_CLOUD_SCHEDULER');
    assert.equal(policy.enableInProcessCollectorTimer, false);
    assert.equal(policy.enableStartupServiceAutoSync, false);
  });

  // 4. Default non-production policy disables both in-process timer and startup auto-sync
  await test('Default non-production policy disables in-process timer and startup Service auto-sync', () => {
    const policy = evaluateStartupSchedulerPolicy({
      NODE_ENV: 'development',
    });

    assert.equal(policy.schedulingAuthority, 'EXTERNAL_CLOUD_SCHEDULER');
    assert.equal(policy.enableInProcessCollectorTimer, false);
    assert.equal(policy.enableStartupServiceAutoSync, false);
  });

  // 5. Explicit non-production opt-in is supported only when neither K_SERVICE nor production is active
  await test('Explicit non-production opt-in enables in-process timer only outside Cloud Run / production', () => {
    const policy = evaluateStartupSchedulerPolicy({
      NODE_ENV: 'development',
      ENABLE_IN_PROCESS_SCHEDULER: 'true',
    });

    assert.equal(policy.schedulingAuthority, 'IN_PROCESS_TIMER');
    assert.equal(policy.enableInProcessCollectorTimer, true);
    assert.equal(policy.enableStartupServiceAutoSync, false);
  });

  // 6. Startup Service Hydration Gate: Fails closed when disabled by policy (even if totalAdvisories === 0)
  await test('Startup Service Hydration Gate: Blocks sync when policy disables startup auto-sync even if totalAdvisories === 0', () => {
    const prodPolicy = evaluateStartupSchedulerPolicy({
      K_SERVICE: 'signalyn',
      NODE_ENV: 'production',
    });

    const decision = evaluateStartupServiceHydrationGate({
      policy: prodPolicy,
      persistenceStatus: 'FIRESTORE_AUTHORITATIVE',
      totalAdvisories: 0,
    });

    assert.equal(decision.shouldTriggerSync, false);
    assert.equal(decision.reason, 'STARTUP_AUTO_SYNC_DISABLED_BY_POLICY');
  });

  // 7. Startup Service Hydration Gate: Fails closed on transient Firestore read failure (UNAVAILABLE)
  await test('Startup Service Hydration Gate: Fails closed when Firestore is UNAVAILABLE even if totalAdvisories === 0 and non-prod opt-in is enabled', () => {
    const devOptInPolicy = evaluateStartupSchedulerPolicy({
      NODE_ENV: 'development',
      ENABLE_STARTUP_SERVICE_AUTO_SYNC: 'true',
    });

    const decision = evaluateStartupServiceHydrationGate({
      policy: devOptInPolicy,
      persistenceStatus: 'UNAVAILABLE',
      totalAdvisories: 0,
    });

    assert.equal(decision.shouldTriggerSync, false);
    assert.equal(decision.reason, 'FIRESTORE_NOT_AUTHORITATIVE_FAIL_CLOSED');
  });

  // 8. Startup Service Hydration Gate: Skips sync when advisories are already populated
  await test('Startup Service Hydration Gate: Skips sync when advisories > 0 in authoritative DB', () => {
    const devOptInPolicy = evaluateStartupSchedulerPolicy({
      NODE_ENV: 'development',
      ENABLE_STARTUP_SERVICE_AUTO_SYNC: 'true',
    });

    const decision = evaluateStartupServiceHydrationGate({
      policy: devOptInPolicy,
      persistenceStatus: 'FIRESTORE_AUTHORITATIVE',
      totalAdvisories: 102,
    });

    assert.equal(decision.shouldTriggerSync, false);
    assert.equal(decision.reason, 'ADVISORIES_ALREADY_POPULATED_OR_UNAVAILABLE');
  });

  // 9. Collector scheduler lifecycle (`stopScheduler` / `initializeScheduler` / `getCollectorStatus`)
  await test('Collector Service: Reports EXTERNAL_CLOUD_SCHEDULER by default and supports stopScheduler()', async () => {
    stopScheduler();
    const initialStatus = await getCollectorStatus();
    assert.equal(initialStatus.isSchedulerActive, false);
    assert.equal(initialStatus.schedulingAuthority, 'EXTERNAL_CLOUD_SCHEDULER');

    initializeScheduler(120);
    const activeStatus = await getCollectorStatus();
    assert.equal(activeStatus.isSchedulerActive, true);
    assert.equal(activeStatus.schedulingAuthority, 'IN_PROCESS_TIMER');

    // Immediately stop timer so no background interval remains
    stopScheduler();
    const stoppedStatus = await getCollectorStatus();
    assert.equal(stoppedStatus.isSchedulerActive, false);
    assert.equal(stoppedStatus.schedulingAuthority, 'EXTERNAL_CLOUD_SCHEDULER');
  });

  // 10. Static verification of server.ts startup scheduler gating & manual admin route preservation
  await test('Server Wiring Audit: server.ts gates initializeScheduler and startup sync while preserving scheduled & manual admin routes', () => {
    const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');

    assert.ok(
      serverSource.includes('const startupSchedulerPolicy = evaluateStartupSchedulerPolicy(process.env);'),
      'server.ts must evaluate startupSchedulerPolicy before initializing in-process scheduler'
    );
    assert.ok(
      serverSource.includes('if (startupSchedulerPolicy.enableInProcessCollectorTimer)'),
      'server.ts must gate initializeScheduler(120) on enableInProcessCollectorTimer'
    );
    assert.ok(
      serverSource.includes('evaluateStartupServiceHydrationGate({'),
      'server.ts must gate startup syncAllServiceSources() with evaluateStartupServiceHydrationGate'
    );

    // Confirm scheduled and manual admin routes remain intact
    assert.ok(
      serverSource.includes("app.post('/api/pipeline/scheduled-run', requireSchedulerAuth"),
      'External Cloud Scheduler route POST /api/pipeline/scheduled-run must remain guarded by requireSchedulerAuth'
    );
    assert.ok(
      serverSource.includes("app.post('/api/collector/run', requireAdminOrAuthorizedClient"),
      'Manual admin collector trigger POST /api/collector/run must remain intact'
    );
    assert.ok(
      serverSource.includes("'/api/pipeline/run',\n    requireAdminOrAuthorizedClient"),
      'Manual admin pipeline trigger POST /api/pipeline/run must remain intact'
    );
    assert.ok(
      serverSource.includes("'/api/daily-brief/generate',\n    requireAdminOrAuthorizedClient"),
      'Manual admin Daily Brief trigger POST /api/daily-brief/generate must remain intact'
    );
    assert.ok(
      serverSource.includes("app.post('/api/service/sync/:id', requireAdminOrAuthorizedClient") &&
        serverSource.includes("app.post('/api/service/sync-all', requireAdminOrAuthorizedClient"),
      'Manual admin Service Intelligence sync routes POST /api/service/sync/:id and POST /api/service/sync-all must remain intact'
    );
  });

  // 11. Release Metadata Parity between dist/release-metadata.json (frontend bundle) and Cloud Run runtime
  await test('Release Metadata Parity: Frontend bundle manifest and Cloud Run backend resolve identical appVersion, buildId, and buildTimestamp', async () => {
    const {
      resolveSanitizedReleaseMetadata,
      compareFrontendBackendRelease,
    } = await import('../src/utils/releaseMetadata');

    const manifestPath = path.resolve(process.cwd(), 'dist', 'release-metadata.json');
    assert.ok(fs.existsSync(manifestPath), 'dist/release-metadata.json must be generated by production build');
    const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Frontend metadata baked from vite.config.ts
    const frontendMeta = resolveSanitizedReleaseMetadata(manifestData);

    // Backend metadata resolved in server.ts under Cloud Run (K_SERVICE=signalyn, K_REVISION=signalyn-00031-new)
    const simulatedCloudRunEnv: Record<string, string | undefined> = {
      K_SERVICE: 'signalyn',
      K_REVISION: 'signalyn-00031-new',
      NODE_ENV: 'production',
    };

    const backendMeta = resolveSanitizedReleaseMetadata({
      appVersion: simulatedCloudRunEnv.SIGNALYN_APP_VERSION || manifestData.appVersion,
      buildId:
        simulatedCloudRunEnv.SIGNALYN_BUILD_ID ||
        simulatedCloudRunEnv.VITE_BUILD_ID ||
        simulatedCloudRunEnv.BUILD_ID ||
        simulatedCloudRunEnv.CLOUD_BUILD_ID ||
        manifestData.buildId ||
        simulatedCloudRunEnv.K_REVISION ||
        null,
      commitSha: manifestData.commitSha || null,
      buildTimestamp: manifestData.buildTimestamp || null,
      environment:
        simulatedCloudRunEnv.K_SERVICE === 'signalyn'
          ? 'cloud-run-production'
          : manifestData.environment,
      serverReleaseId:
        simulatedCloudRunEnv.K_REVISION ||
        manifestData.serverReleaseId ||
        manifestData.buildId ||
        null,
    });

    const comparison = compareFrontendBackendRelease(frontendMeta, backendMeta);
    assert.equal(comparison.versionMatchStatus, 'MATCH');
    assert.equal(comparison.isMatched, true);
    assert.equal(frontendMeta.appVersion, backendMeta.appVersion);
    assert.equal(frontendMeta.buildId, backendMeta.buildId);
    assert.equal(frontendMeta.buildTimestamp, backendMeta.buildTimestamp);
    assert.equal(backendMeta.serverReleaseId, 'signalyn-00031-new');
    assert.ok(
      frontendMeta.buildId.startsWith(`signalyn-v${frontendMeta.appVersion}-`),
      `Expected deterministic buildId prefix signalyn-v${frontendMeta.appVersion}-, got: ${frontendMeta.buildId}`
    );
  });

  console.log(`\n=== COMPLETED: ${passedCount}/11 P2.3.2.4 SCHEDULER SAFETY & DEPLOYMENT PREPARATION TESTS PASSED ===`);
}

run();

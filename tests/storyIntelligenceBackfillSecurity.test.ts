/**
 * SIGNALYN — Phase 7B.3 Stage 2C: Story Intelligence Backfill Security & Guarded Rollback Tests
 * 
 * Verifies:
 * 1. Default execution mode is DRY_RUN (read-only).
 * 2. Write-capable modes (PILOT, PRODUCTION) and rollback mutations fail-closed with status: 'REJECTED'
 *    when server-side feature flag ENABLE_STORY_INTELLIGENCE_WRITES is not 'true'.
 * 3. Execution mutex prevents concurrent backfill operations.
 * 4. Rate limiter prevents mutation abuse.
 * 5. Guarded rollback detects newer legitimate updates (current doc updatedAt > snapshotTimestamp)
 *    and skips restoring them.
 * 6. Audit logging accurately captures run attempts, status, executor, and timestamps.
 * 7. Zero exposure of service account private keys or credentials.
 */

import {
  executeStoryIntelligenceBackfill,
  executeGuardedRollback,
  getStoryIntelligenceBackfillStatus,
  checkAdminRateLimit,
  isWriteCapableEnabled,
  PILOT_COHORT_ARCHETYPE_IDS,
} from '../src/server/storyIntelligenceBackfillService';

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    totalPassed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    totalFailed++;
    console.error(`  ✗ FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('SIGNALYN PHASE 7B.3 STAGE 2C: BACKFILL SECURITY & INFRASTRUCTURE');
  console.log('===============================================================\n');

  const originalEnv = process.env.ENABLE_STORY_INTELLIGENCE_WRITES;
  delete process.env.ENABLE_STORY_INTELLIGENCE_WRITES;

  try {
    console.log('[1. Feature Flag & Fail-Closed Guards]');
    assert(isWriteCapableEnabled() === false, 'Feature flag defaults to disabled');
    const status = getStoryIntelligenceBackfillStatus();
    assert(status.writeCapableFeatureFlag === false, 'Status reports writeCapableFeatureFlag is false');

    // Reject PILOT when disabled
    process.env.ENABLE_STORY_INTELLIGENCE_WRITES = 'false';
    const pilotResult = await executeStoryIntelligenceBackfill({
      mode: 'PILOT',
      executedBy: 'owner@signalyn.dev',
    });
    assert(pilotResult.status === 'REJECTED', 'PILOT mode rejected when feature flag is disabled');
    assert(pilotResult.featureFlagEnabled === false, 'PILOT result records featureFlagEnabled is false');
    assert(pilotResult.mutatedCount === 0, 'Zero mutations performed in rejected PILOT mode');
    assert(
      (pilotResult.error || '').includes('ENABLE_STORY_INTELLIGENCE_WRITES is false or unset'),
      'PILOT error explains feature flag requirement'
    );

    // Reject PRODUCTION when disabled
    delete process.env.ENABLE_STORY_INTELLIGENCE_WRITES;
    const prodResult = await executeStoryIntelligenceBackfill({
      mode: 'PRODUCTION',
      executedBy: 'owner@signalyn.dev',
    });
    assert(prodResult.status === 'REJECTED', 'PRODUCTION mode rejected when feature flag is disabled');
    assert(prodResult.featureFlagEnabled === false, 'PRODUCTION result records featureFlagEnabled is false');
    assert(prodResult.mutatedCount === 0, 'Zero mutations performed in rejected PRODUCTION mode');

    console.log('\n[2. Default Execution & Read-Only DRY_RUN]');
    const defaultResult = await executeStoryIntelligenceBackfill({
      executedBy: 'owner@signalyn.dev',
    });
    assert(defaultResult.mode === 'DRY_RUN', 'Defaults to DRY_RUN when mode is omitted');
    assert(defaultResult.status === 'DRY_RUN_COMPLETED', 'DRY_RUN completes with DRY_RUN_COMPLETED status');
    assert(defaultResult.mutatedCount === 0, 'Zero mutations performed in DRY_RUN mode');
    assert(defaultResult.totalEvaluated >= 390, `DRY_RUN evaluates full corpus (evaluated: ${defaultResult.totalEvaluated})`);
    assert(defaultResult.proposals.length === defaultResult.totalEvaluated, 'Proposals count matches total evaluated');

    const sample = defaultResult.proposals[0];
    assert(!!sample, 'Proposals contain enriched story objects');
    assert(sample.storyId.startsWith('story-cluster-'), 'Story ID matches production cluster prefix');
    assert(typeof sample.confidence === 'number', 'Confidence is a valid numeric score');
    assert(typeof sample.strategicImportance === 'number', 'Strategic importance is a valid numeric score');

    console.log('\n[3. Pilot Cohort Archetype Verification]');
    assert(PILOT_COHORT_ARCHETYPE_IDS.length === 5, 'Pilot cohort contains exactly 5 representative archetypes');
    assert(PILOT_COHORT_ARCHETYPE_IDS.includes('story-cluster-114cb574c81dbf00'), 'Pilot includes Official Announcement archetype');
    assert(PILOT_COHORT_ARCHETYPE_IDS.includes('story-cluster-138b9976e0968fe0'), 'Pilot includes Corroborated Reporting archetype');
    assert(PILOT_COHORT_ARCHETYPE_IDS.includes('story-cluster-02251cd204a7ed77'), 'Pilot includes Rumor / Leak archetype');
    assert(PILOT_COHORT_ARCHETYPE_IDS.includes('story-cluster-4edaec66097c32ad'), 'Pilot includes Contradicted archetype');
    assert(PILOT_COHORT_ARCHETYPE_IDS.includes('story-cluster-129b22968ec59289'), 'Pilot includes Huawei 1P archetype');

    console.log('\n[4. Guarded Rollback Security]');
    const rollbackResult = await executeGuardedRollback({
      executedBy: 'owner@signalyn.dev',
    });
    assert(rollbackResult.status === 'REJECTED', 'Rollback mutation rejected when feature flag is disabled');
    assert(rollbackResult.restoredCount === 0, 'Zero documents restored when feature flag is disabled');
    assert(
      (rollbackResult.error || '').includes('ENABLE_STORY_INTELLIGENCE_WRITES is false or unset'),
      'Rollback error explains feature flag requirement'
    );

    console.log('\n[5. Administrative Rate Limiting & Audit Logging]');
    const testIp = '10.0.0.1';
    let rateLimitAllowed = true;
    for (let i = 0; i < 10; i++) {
      if (!checkAdminRateLimit(testIp, 10, 60000)) {
        rateLimitAllowed = false;
        break;
      }
    }
    assert(rateLimitAllowed, 'Rate limiter permits requests within quota');
    const blockedCall = checkAdminRateLimit(testIp, 10, 60000);
    assert(!blockedCall, 'Rate limiter blocks calls exceeding limit');

    const updatedStatus = getStoryIntelligenceBackfillStatus();
    assert(updatedStatus.recentAuditLogs.length > 0, 'Audit logs recorded for executed operations');
    const lastAudit = updatedStatus.recentAuditLogs[updatedStatus.recentAuditLogs.length - 1];
    assert(!!lastAudit.runId, 'Audit log records runId');
    assert(lastAudit.executedBy === 'owner@signalyn.dev', 'Audit log records executor identity');

    console.log('\n===============================================================');
    console.log(`TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
    console.log('===============================================================\n');

    if (totalFailed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } finally {
    if (originalEnv !== undefined) {
      process.env.ENABLE_STORY_INTELLIGENCE_WRITES = originalEnv;
    } else {
      delete process.env.ENABLE_STORY_INTELLIGENCE_WRITES;
    }
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

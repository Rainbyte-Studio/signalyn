/**
 * SIGNALYN — P2.3.2.4 Final Pre-Deployment Scheduler Safety Gate
 *
 * Enforces a single production scheduling authority (External Google Cloud Scheduler
 * invoking POST /api/pipeline/scheduled-run with OIDC verification and distributed
 * Firestore lease protection) and prevents container startup or multi-instance
 * scaling from triggering duplicate in-process RSS collection timers or unintended
 * Service Intelligence synchronization.
 */

export type SchedulingAuthorityMode = 'EXTERNAL_CLOUD_SCHEDULER' | 'IN_PROCESS_TIMER';

export interface StartupSchedulerPolicy {
  schedulingAuthority: SchedulingAuthorityMode;
  isCloudRunRuntime: boolean;
  isProductionEnv: boolean;
  enableInProcessCollectorTimer: boolean;
  enableStartupServiceAutoSync: boolean;
  rationale: string;
}

export interface StartupServiceHydrationGateInput {
  policy: StartupSchedulerPolicy;
  persistenceStatus: 'FIRESTORE_AUTHORITATIVE' | 'UNAVAILABLE' | string;
  totalAdvisories: number | 'UNAVAILABLE';
}

export interface StartupServiceHydrationGateDecision {
  shouldTriggerSync: boolean;
  reason:
    | 'STARTUP_AUTO_SYNC_DISABLED_BY_POLICY'
    | 'FIRESTORE_NOT_AUTHORITATIVE_FAIL_CLOSED'
    | 'ADVISORIES_ALREADY_POPULATED_OR_UNAVAILABLE'
    | 'EXPLICIT_NON_PROD_OPT_IN_EMPTY_AUTHORITATIVE_DB';
}

/**
 * Evaluates whether in-process timers or startup auto-sync jobs are permitted.
 *
 * Rules:
 * 1. In Cloud Run (`K_SERVICE` set) or production (`NODE_ENV === 'production'`),
 *    in-process interval timers and startup Service Intelligence auto-sync are
 *    unconditionally disabled (`false`) even if opt-in env vars are present.
 *    External Cloud Scheduler (`POST /api/pipeline/scheduled-run`) is the sole
 *    production scheduling authority.
 * 2. In non-production environments (AI Studio Preview / local dev), both remain
 *    disabled by default (`false`) unless explicitly opted in via
 *    `ENABLE_IN_PROCESS_SCHEDULER === 'true'` or
 *    `ENABLE_STARTUP_SERVICE_AUTO_SYNC === 'true'`.
 */
export function evaluateStartupSchedulerPolicy(
  env: Record<string, string | undefined> = process.env
): StartupSchedulerPolicy {
  const isCloudRunRuntime = Boolean(env.K_SERVICE && env.K_SERVICE.trim().length > 0);
  const isProductionEnv = env.NODE_ENV === 'production';

  if (isCloudRunRuntime || isProductionEnv) {
    return {
      schedulingAuthority: 'EXTERNAL_CLOUD_SCHEDULER',
      isCloudRunRuntime,
      isProductionEnv,
      enableInProcessCollectorTimer: false,
      enableStartupServiceAutoSync: false,
      rationale:
        'Cloud Run / production runtime detected; in-process timers and startup auto-sync are disabled to prevent multi-instance duplicate runs and cold-start write storms.',
    };
  }

  const enableInProcessCollectorTimer = env.ENABLE_IN_PROCESS_SCHEDULER === 'true';
  const enableStartupServiceAutoSync = env.ENABLE_STARTUP_SERVICE_AUTO_SYNC === 'true';

  return {
    schedulingAuthority: enableInProcessCollectorTimer
      ? 'IN_PROCESS_TIMER'
      : 'EXTERNAL_CLOUD_SCHEDULER',
    isCloudRunRuntime: false,
    isProductionEnv: false,
    enableInProcessCollectorTimer,
    enableStartupServiceAutoSync,
    rationale: enableInProcessCollectorTimer
      ? 'Explicit non-production opt-in (ENABLE_IN_PROCESS_SCHEDULER=true).'
      : 'Default safe policy: external Cloud Scheduler is the single scheduling authority.',
  };
}

/**
 * Evaluates whether container startup may trigger `syncAllServiceSources()`.
 *
 * Fails closed whenever:
 * - `policy.enableStartupServiceAutoSync` is false (always false in production and by default)
 * - Firestore is not verified as `FIRESTORE_AUTHORITATIVE` (prevents transient read errors,
 *   cold-start credential latency, or wrong DB bindings from masquerading as 0 advisories)
 * - `totalAdvisories` is `'UNAVAILABLE'` or `> 0`
 */
export function evaluateStartupServiceHydrationGate(
  input: StartupServiceHydrationGateInput
): StartupServiceHydrationGateDecision {
  if (!input.policy.enableStartupServiceAutoSync) {
    return {
      shouldTriggerSync: false,
      reason: 'STARTUP_AUTO_SYNC_DISABLED_BY_POLICY',
    };
  }

  if (input.persistenceStatus !== 'FIRESTORE_AUTHORITATIVE') {
    return {
      shouldTriggerSync: false,
      reason: 'FIRESTORE_NOT_AUTHORITATIVE_FAIL_CLOSED',
    };
  }

  if (typeof input.totalAdvisories !== 'number' || input.totalAdvisories !== 0) {
    return {
      shouldTriggerSync: false,
      reason: 'ADVISORIES_ALREADY_POPULATED_OR_UNAVAILABLE',
    };
  }

  return {
    shouldTriggerSync: true,
    reason: 'EXPLICIT_NON_PROD_OPT_IN_EMPTY_AUTHORITATIVE_DB',
  };
}

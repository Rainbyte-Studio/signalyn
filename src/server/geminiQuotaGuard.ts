/**
 * Signalyn Centralized Gemini Quota Protection & Atomic Provider-Request Accounting
 *
 * Enforces an application-level daily request budget atomically in Firestore
 * (`system/geminiQuotaUsage/days/{YYYY-MM-DD}`) using `db.runTransaction` so
 * concurrent Cloud Run instances cannot exceed the configured application budget
 * or consume capacity reserved for Daily Intelligence, Stories, and the Daily Brief.
 *
 * Distinction between budgets & provider quota:
 * - Application Daily Request Budget: SIGNALYN's own configurable daily request cap
 *   and daily-intelligence reserve enforced atomically in Firestore.
 * - Google Gemini API Provider Quota: Externally enforced by Google's Gemini API
 *   (cannot be queried directly; detected via HTTP 429 / RESOURCE_EXHAUSTED,
 *   which immediately activates a shared Firestore cooldown and halts retries).
 */

import { getServerDb, cleanServerData } from './serverFirestoreAdapter';
import { db as clientDb } from '../firebase';
import { doc as clientDoc, getDoc as clientGetDoc } from 'firebase/firestore';
import { GeminiQuotaLane, GeminiQuotaStatus } from '../types';

export const DEFAULT_GEMINI_DAILY_REQUEST_BUDGET = 300;
export const DEFAULT_GEMINI_DAILY_RESERVED_CAPACITY = 220;
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const MIN_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

export const BUDGET_SCOPE_LABEL = 'SIGNALYN Application Daily Request Budget';
export const PROVIDER_QUOTA_NOTE =
  'Tracks SIGNALYN application-level daily request reservations atomically in Firestore. Google Gemini API provider quota is enforced externally by Google (detected on HTTP 429 / RESOURCE_EXHAUSTED).';

const HIGH_PRIORITY_LANES = new Set<GeminiQuotaLane>([
  'DAILY_INTELLIGENCE',
  'LIVE_ARTICLE',
  'STORY_INTELLIGENCE',
  'DAILY_BRIEF',
]);

export type GeminiQuotaBlockCode =
  | 'GEMINI_QUOTA_EXHAUSTED'
  | 'GEMINI_DAILY_BUDGET_EXHAUSTED'
  | 'GEMINI_RESERVED_FOR_DAILY_INTELLIGENCE';

export class GeminiQuotaExceededError extends Error {
  readonly code: GeminiQuotaBlockCode;
  readonly lane: GeminiQuotaLane;
  readonly retryAfterIso: string | null;
  readonly userMessage: string;
  readonly isQuotaProtection = true;

  constructor(params: {
    code: GeminiQuotaBlockCode;
    lane: GeminiQuotaLane;
    retryAfterIso?: string | null;
    userMessage: string;
  }) {
    super(`${params.code}: ${params.userMessage}`);
    this.name = 'GeminiQuotaExceededError';
    this.code = params.code;
    this.lane = params.lane;
    this.retryAfterIso = params.retryAfterIso ?? null;
    this.userMessage = params.userMessage;
  }
}

export interface GeminiQuotaConfig {
  dailyRequestBudget: number;
  dailyReservedCapacity: number;
  rateLimitCooldownMs: number;
}

interface DailyQuotaLedger {
  dateKey: string;
  totalProviderRequests: number;
  requestsByLane: Record<GeminiQuotaLane, number>;
  requestsByModel: Record<string, number>;
  retryRequests: number;
  fallbackRequests: number;
  rateLimit429Count: number;
  quotaExhaustedUntil: string | null;
  lastRateLimitAt: string | null;
  lastRateLimitReason: string | null;
  updatedAt: string;
}

function emptyLaneCounts(): Record<GeminiQuotaLane, number> {
  return {
    DAILY_INTELLIGENCE: 0,
    LIVE_ARTICLE: 0,
    STORY_INTELLIGENCE: 0,
    DAILY_BRIEF: 0,
    HISTORICAL_BACKFILL: 0,
    DIAGNOSTIC: 0,
  };
}

/**
 * Returns the YYYY-MM-DD date bucket in Europe/Athens timezone so daily
 * application budgets reset aligned with SIGNALYN's 06:00 Europe/Athens reporting day.
 */
export function getAthensDateKey(now: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Athens',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function createEmptyLedger(dateKey: string): DailyQuotaLedger {
  return {
    dateKey,
    totalProviderRequests: 0,
    requestsByLane: emptyLaneCounts(),
    requestsByModel: {},
    retryRequests: 0,
    fallbackRequests: 0,
    rateLimit429Count: 0,
    quotaExhaustedUntil: null,
    lastRateLimitAt: null,
    lastRateLimitReason: null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeRemoteLedger(dateKey: string, remote: any): DailyQuotaLedger {
  if (!remote || remote.dateKey !== dateKey || typeof remote.totalProviderRequests !== 'number') {
    return createEmptyLedger(dateKey);
  }
  const lanes = emptyLaneCounts();
  for (const lane of Object.keys(lanes) as GeminiQuotaLane[]) {
    lanes[lane] = Math.max(0, Number(remote.requestsByLane?.[lane] || 0));
  }
  const models: Record<string, number> = {};
  if (remote.requestsByModel && typeof remote.requestsByModel === 'object') {
    for (const [m, count] of Object.entries(remote.requestsByModel)) {
      models[m] = Math.max(0, Number(count || 0));
    }
  }
  return {
    dateKey,
    totalProviderRequests: Math.max(0, Number(remote.totalProviderRequests || 0)),
    requestsByLane: lanes,
    requestsByModel: models,
    retryRequests: Math.max(0, Number(remote.retryRequests || 0)),
    fallbackRequests: Math.max(0, Number(remote.fallbackRequests || 0)),
    rateLimit429Count: Math.max(0, Number(remote.rateLimit429Count || 0)),
    quotaExhaustedUntil: typeof remote.quotaExhaustedUntil === 'string' ? remote.quotaExhaustedUntil : null,
    lastRateLimitAt: typeof remote.lastRateLimitAt === 'string' ? remote.lastRateLimitAt : null,
    lastRateLimitReason: typeof remote.lastRateLimitReason === 'string' ? remote.lastRateLimitReason : null,
    updatedAt: typeof remote.updatedAt === 'string' ? remote.updatedAt : new Date().toISOString(),
  };
}

// In-process fallback state (used ONLY when Firestore transactions are unavailable, e.g. read-only preview or minimal test stubs)
let fallbackLedger: DailyQuotaLedger | null = null;
let lastAccountingMode: 'FIRESTORE_TRANSACTION' | 'IN_PROCESS_FALLBACK' = 'FIRESTORE_TRANSACTION';
let configOverrideForTests: Partial<GeminiQuotaConfig> | null = null;
let inProcessMutex: Promise<void> = Promise.resolve();

async function runInProcessExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = inProcessMutex;
  inProcessMutex = prev.then(() => gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function getOrCreateFallbackLedger(dateKey: string): DailyQuotaLedger {
  if (!fallbackLedger || fallbackLedger.dateKey !== dateKey) {
    fallbackLedger = createEmptyLedger(dateKey);
  }
  return fallbackLedger;
}

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = Number.parseInt(val, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getEffectiveQuotaConfig(): GeminiQuotaConfig {
  const envBudget = parsePositiveInt(
    process.env.GEMINI_DAILY_REQUEST_BUDGET,
    DEFAULT_GEMINI_DAILY_REQUEST_BUDGET
  );
  const envReserved = parsePositiveInt(
    process.env.GEMINI_DAILY_RESERVED_CAPACITY,
    DEFAULT_GEMINI_DAILY_RESERVED_CAPACITY
  );
  const envCooldown = parsePositiveInt(
    process.env.GEMINI_RATE_LIMIT_COOLDOWN_MS,
    DEFAULT_RATE_LIMIT_COOLDOWN_MS
  );

  const dailyRequestBudget = Math.max(
    1,
    configOverrideForTests?.dailyRequestBudget ?? envBudget
  );
  const dailyReservedCapacity = Math.min(
    dailyRequestBudget,
    Math.max(0, configOverrideForTests?.dailyReservedCapacity ?? envReserved)
  );
  const rateLimitCooldownMs = Math.max(
    1_000,
    configOverrideForTests?.rateLimitCooldownMs ?? envCooldown
  );

  return {
    dailyRequestBudget,
    dailyReservedCapacity,
    rateLimitCooldownMs,
  };
}

/**
 * Test helper: resets fallback quota state and optional budget overrides.
 */
export function resetGeminiQuotaStateForTests(override?: Partial<GeminiQuotaConfig> | null): void {
  fallbackLedger = null;
  lastAccountingMode = 'FIRESTORE_TRANSACTION';
  configOverrideForTests = override ?? null;
  inProcessMutex = Promise.resolve();
}

/**
 * Detects HTTP 429 / RESOURCE_EXHAUSTED / provider quota exhaustion errors.
 */
export function isQuotaOrRateLimitError(err: unknown): boolean {
  if (err instanceof GeminiQuotaExceededError) {
    return true;
  }
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.code ?? anyErr?.response?.status;
  if (status === 429 || status === 'RESOURCE_EXHAUSTED') {
    return true;
  }
  const msg = (anyErr?.message || String(err || '')).toLowerCase();
  return (
    /\b429\b/.test(msg) ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('gemini_quota_exhausted')
  );
}

/**
 * Extracts a bounded retry delay from provider error metadata if available.
 */
export function extractRetryDelayMs(err: unknown, defaultMs: number): number {
  const msg = err instanceof Error ? err.message : String(err || '');
  const secondsMatch = msg.match(/retry\s*(?:in|after)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*s(?:ec|econds?)?/i);
  if (secondsMatch) {
    const parsedMs = Math.ceil(Number.parseFloat(secondsMatch[1]) * 1000);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, parsedMs));
    }
  }
  return defaultMs;
}

function getTransactionalQuotaHandle(dateKey: string): { db: any; dayRef: any } | null {
  try {
    const db = getServerDb();
    if (!db || typeof db.collection !== 'function') return null;
    const sysCol = db.collection('system');
    if (!sysCol || typeof sysCol.doc !== 'function') return null;
    const quotaDoc = sysCol.doc('geminiQuotaUsage');
    if (!quotaDoc || typeof quotaDoc.collection !== 'function') return null;
    const daysCol = quotaDoc.collection('days');
    if (!daysCol || typeof daysCol.doc !== 'function') return null;
    const dayRef = daysCol.doc(dateKey);
    // Require both .get and .set on dayRef plus db.runTransaction so minimal test stubs
    // (such as backfillStatusReadOnly.test.ts) safely use fallback without corrupting mocks.
    if (
      !dayRef ||
      typeof dayRef.get !== 'function' ||
      typeof dayRef.set !== 'function' ||
      typeof db.runTransaction !== 'function'
    ) {
      return null;
    }
    return { db, dayRef };
  } catch {
    return null;
  }
}

export interface GeminiQuotaAllowance {
  allowed: boolean;
  code?: GeminiQuotaBlockCode;
  userMessage?: string;
  retryAfterIso?: string | null;
  status: GeminiQuotaStatus;
}

function buildStatusSnapshot(
  ledger: DailyQuotaLedger,
  config: GeminiQuotaConfig,
  accountingMode: 'FIRESTORE_TRANSACTION' | 'IN_PROCESS_FALLBACK'
): GeminiQuotaStatus {
  const nowMs = Date.now();
  const exhaustedUntilMs = ledger.quotaExhaustedUntil ? Date.parse(ledger.quotaExhaustedUntil) : 0;
  const isCooldownActive = Boolean(exhaustedUntilMs && exhaustedUntilMs > nowMs);

  const remainingTotalBudget = Math.max(0, config.dailyRequestBudget - ledger.totalProviderRequests);
  const historicalDailyAllowance = Math.max(
    0,
    config.dailyRequestBudget - config.dailyReservedCapacity
  );
  const remainingForHistorical = isCooldownActive
    ? 0
    : Math.max(0, remainingTotalBudget - config.dailyReservedCapacity);
  const remainingDailyReserved = isCooldownActive
    ? 0
    : Math.min(config.dailyReservedCapacity, remainingTotalBudget);

  const isDailyBudgetExhausted = remainingTotalBudget <= 0;
  const isQuotaExhausted = isCooldownActive || isDailyBudgetExhausted;
  const historicalAllowed = !isQuotaExhausted && remainingForHistorical > 0;
  const dailyIntelligenceAllowed = !isQuotaExhausted;

  let statusLevel: GeminiQuotaStatus['statusLevel'] = 'HEALTHY';
  let userMessage =
    'Application daily request budget is healthy. Daily market intelligence has priority reserve protection.';

  if (isCooldownActive) {
    statusLevel = 'EXHAUSTED';
    const retryTime = new Date(exhaustedUntilMs).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Athens',
    });
    userMessage = `Google Gemini API provider quota limit reached (HTTP 429). Historical processing is suspended and retries are paused until ${retryTime} (Athens time).`;
  } else if (isDailyBudgetExhausted) {
    statusLevel = 'EXHAUSTED';
    userMessage =
      'SIGNALYN application daily request budget has been reached for today. Processing will resume automatically on the next reporting day.';
  } else if (!historicalAllowed) {
    statusLevel = 'RESERVED_ONLY';
    userMessage =
      'Remaining SIGNALYN daily request budget is reserved for current market intelligence, Stories, and the Daily Brief. Historical backfill is suspended.';
  }

  return {
    dateKey: ledger.dateKey,
    dailyRequestBudget: config.dailyRequestBudget,
    dailyReservedCapacity: config.dailyReservedCapacity,
    historicalDailyAllowance,
    totalProviderRequests: ledger.totalProviderRequests,
    remainingTotalBudget,
    remainingForHistorical,
    remainingDailyReserved,
    requestsByLane: { ...ledger.requestsByLane },
    requestsByModel: { ...ledger.requestsByModel },
    retryRequests: ledger.retryRequests,
    fallbackRequests: ledger.fallbackRequests,
    rateLimit429Count: ledger.rateLimit429Count,
    isQuotaExhausted,
    quotaExhaustedUntil: isCooldownActive ? ledger.quotaExhaustedUntil : null,
    lastRateLimitAt: ledger.lastRateLimitAt,
    lastRateLimitReason: ledger.lastRateLimitReason,
    historicalAllowed,
    dailyIntelligenceAllowed,
    statusLevel,
    userMessage,
    accountingMode,
    budgetScopeLabel: BUDGET_SCOPE_LABEL,
    providerQuotaNote: PROVIDER_QUOTA_NOTE,
    updatedAt: ledger.updatedAt,
  };
}

function evaluateAllowanceFromSnapshot(
  status: GeminiQuotaStatus,
  lane: GeminiQuotaLane
): GeminiQuotaAllowance {
  if (status.quotaExhaustedUntil) {
    return {
      allowed: false,
      code: 'GEMINI_QUOTA_EXHAUSTED',
      retryAfterIso: status.quotaExhaustedUntil,
      userMessage: status.userMessage,
      status,
    };
  }

  if (status.remainingTotalBudget <= 0) {
    return {
      allowed: false,
      code: 'GEMINI_DAILY_BUDGET_EXHAUSTED',
      retryAfterIso: null,
      userMessage: status.userMessage,
      status,
    };
  }

  if (lane === 'HISTORICAL_BACKFILL' && status.remainingForHistorical <= 0) {
    return {
      allowed: false,
      code: 'GEMINI_RESERVED_FOR_DAILY_INTELLIGENCE',
      retryAfterIso: null,
      userMessage:
        'Historical analysis paused: remaining SIGNALYN daily request budget is reserved for current market intelligence and the Daily Brief.',
      status,
    };
  }

  return { allowed: true, status };
}

async function readCurrentLedgerFresh(): Promise<{
  ledger: DailyQuotaLedger;
  accountingMode: 'FIRESTORE_TRANSACTION' | 'IN_PROCESS_FALLBACK';
}> {
  const dateKey = getAthensDateKey();
  const handle = getTransactionalQuotaHandle(dateKey);

  if (handle) {
    try {
      const snap = await handle.dayRef.get();
      if (snap && snap.exists && typeof snap.data === 'function') {
        const normalized = normalizeRemoteLedger(dateKey, snap.data());
        fallbackLedger = normalized;
        lastAccountingMode = 'FIRESTORE_TRANSACTION';
        return { ledger: normalized, accountingMode: 'FIRESTORE_TRANSACTION' };
      }
      // Doc doesn't exist yet today — authoritative empty ledger backed by Firestore transactions
      const empty = createEmptyLedger(dateKey);
      fallbackLedger = empty;
      lastAccountingMode = 'FIRESTORE_TRANSACTION';
      return { ledger: empty, accountingMode: 'FIRESTORE_TRANSACTION' };
    } catch {
      // Fallback to read-only client SDK if Admin SDK lacks preview IAM
      try {
        const snap = await clientGetDoc(clientDoc(clientDb, 'system', 'geminiQuotaUsage', 'days', dateKey));
        if (snap.exists()) {
          const normalized = normalizeRemoteLedger(dateKey, snap.data());
          fallbackLedger = normalized;
          lastAccountingMode = 'IN_PROCESS_FALLBACK';
          return { ledger: normalized, accountingMode: 'IN_PROCESS_FALLBACK' };
        }
      } catch {
        // Use in-process ledger
      }
    }
  }

  lastAccountingMode = 'IN_PROCESS_FALLBACK';
  return {
    ledger: getOrCreateFallbackLedger(dateKey),
    accountingMode: 'IN_PROCESS_FALLBACK',
  };
}

/**
 * Read-only fresh snapshot of today's SIGNALYN application daily request budget
 * and provider rate-limit status.
 */
export async function getGeminiQuotaStatus(): Promise<GeminiQuotaStatus> {
  const { ledger, accountingMode } = await readCurrentLedgerFresh();
  const config = getEffectiveQuotaConfig();
  return buildStatusSnapshot(ledger, config, accountingMode);
}

/**
 * Non-mutating pre-flight allowance check (used for fast pre-flight UI/batch checks).
 * Actual outbound provider calls MUST use `reserveGeminiProviderRequest()` so
 * check-and-increment happens atomically in a single Firestore transaction.
 */
export async function checkGeminiQuotaAllowance(
  lane: GeminiQuotaLane
): Promise<GeminiQuotaAllowance> {
  const status = await getGeminiQuotaStatus();
  return evaluateAllowanceFromSnapshot(status, lane);
}

/**
 * Non-mutating pre-flight assertion that throws GeminiQuotaExceededError when blocked.
 */
export async function assertGeminiQuotaAllowance(lane: GeminiQuotaLane): Promise<GeminiQuotaStatus> {
  const allowance = await checkGeminiQuotaAllowance(lane);
  if (!allowance.allowed) {
    throw new GeminiQuotaExceededError({
      code: allowance.code || 'GEMINI_QUOTA_EXHAUSTED',
      lane,
      retryAfterIso: allowance.retryAfterIso,
      userMessage: allowance.userMessage || allowance.status.userMessage,
    });
  }
  return allowance.status;
}

/**
 * ATOMIC PRE-REQUEST RESERVATION (Firestore Transaction):
 *
 * Atomically reads today's quota document, verifies cooldown + application daily budget +
 * reserved daily-intelligence capacity, and reserves 1 provider request slot BEFORE the
 * outbound `ai.models.generateContent` request is sent.
 *
 * Prevents concurrent Cloud Run instances or parallel workers from exceeding
 * `dailyRequestBudget` or dipping into `dailyReservedCapacity` for historical backfill.
 */
export async function reserveGeminiProviderRequest(params: {
  lane: GeminiQuotaLane;
  model: string;
  isRetry?: boolean;
  isFallback?: boolean;
}): Promise<GeminiQuotaStatus> {
  const dateKey = getAthensDateKey();
  const config = getEffectiveQuotaConfig();
  const handle = getTransactionalQuotaHandle(dateKey);

  const applyReservation = (
    ledger: DailyQuotaLedger,
    mode: 'FIRESTORE_TRANSACTION' | 'IN_PROCESS_FALLBACK'
  ): DailyQuotaLedger => {
    const status = buildStatusSnapshot(ledger, config, mode);
    const allowance = evaluateAllowanceFromSnapshot(status, params.lane);
    if (!allowance.allowed) {
      throw new GeminiQuotaExceededError({
        code: allowance.code || 'GEMINI_QUOTA_EXHAUSTED',
        lane: params.lane,
        retryAfterIso: allowance.retryAfterIso,
        userMessage: allowance.userMessage || status.userMessage,
      });
    }

    ledger.totalProviderRequests += 1;
    ledger.requestsByLane[params.lane] = (ledger.requestsByLane[params.lane] || 0) + 1;
    ledger.requestsByModel[params.model] = (ledger.requestsByModel[params.model] || 0) + 1;
    if (params.isRetry) ledger.retryRequests += 1;
    if (params.isFallback) ledger.fallbackRequests += 1;
    ledger.updatedAt = new Date().toISOString();
    return ledger;
  };

  if (handle) {
    try {
      const committed = await handle.db.runTransaction(async (transaction: any) => {
        const snap = await transaction.get(handle.dayRef);
        const current =
          snap && snap.exists && typeof snap.data === 'function'
            ? normalizeRemoteLedger(dateKey, snap.data())
            : createEmptyLedger(dateKey);

        const next = applyReservation(current, 'FIRESTORE_TRANSACTION');
        transaction.set(handle.dayRef, cleanServerData(next));
        return next;
      });

      fallbackLedger = committed;
      lastAccountingMode = 'FIRESTORE_TRANSACTION';
      return buildStatusSnapshot(committed, config, 'FIRESTORE_TRANSACTION');
    } catch (err) {
      // Never swallow an intentional quota denial!
      if (err instanceof GeminiQuotaExceededError) {
        throw err;
      }
      // Preview / read-only IAM fallback: strictly serialized in-process atomic reservation
    }
  }

  return runInProcessExclusive(() => {
    const ledger = getOrCreateFallbackLedger(dateKey);
    const next = applyReservation(ledger, 'IN_PROCESS_FALLBACK');
    fallbackLedger = next;
    lastAccountingMode = 'IN_PROCESS_FALLBACK';
    return buildStatusSnapshot(next, config, 'IN_PROCESS_FALLBACK');
  });
}

/**
 * Legacy-compatible helper that atomically records a provider request
 * (new code should prefer `reserveGeminiProviderRequest` prior to outbound calls).
 */
export async function recordGeminiProviderRequest(params: {
  lane: GeminiQuotaLane;
  model: string;
  isRetry?: boolean;
  isFallback?: boolean;
  outcome?: 'SUCCESS' | 'RATE_LIMITED' | 'ERROR';
}): Promise<GeminiQuotaStatus> {
  const dateKey = getAthensDateKey();
  const config = getEffectiveQuotaConfig();
  const handle = getTransactionalQuotaHandle(dateKey);

  const mutate = (ledger: DailyQuotaLedger): DailyQuotaLedger => {
    ledger.totalProviderRequests += 1;
    ledger.requestsByLane[params.lane] = (ledger.requestsByLane[params.lane] || 0) + 1;
    ledger.requestsByModel[params.model] = (ledger.requestsByModel[params.model] || 0) + 1;
    if (params.isRetry) ledger.retryRequests += 1;
    if (params.isFallback) ledger.fallbackRequests += 1;
    if (params.outcome === 'RATE_LIMITED') ledger.rateLimit429Count += 1;
    ledger.updatedAt = new Date().toISOString();
    return ledger;
  };

  if (handle) {
    try {
      const committed = await handle.db.runTransaction(async (transaction: any) => {
        const snap = await transaction.get(handle.dayRef);
        const current =
          snap && snap.exists && typeof snap.data === 'function'
            ? normalizeRemoteLedger(dateKey, snap.data())
            : createEmptyLedger(dateKey);
        const next = mutate(current);
        transaction.set(handle.dayRef, cleanServerData(next));
        return next;
      });
      fallbackLedger = committed;
      lastAccountingMode = 'FIRESTORE_TRANSACTION';
      return buildStatusSnapshot(committed, config, 'FIRESTORE_TRANSACTION');
    } catch {
      // Fall through to serialized in-process fallback
    }
  }

  return runInProcessExclusive(() => {
    const ledger = mutate(getOrCreateFallbackLedger(dateKey));
    fallbackLedger = ledger;
    lastAccountingMode = 'IN_PROCESS_FALLBACK';
    return buildStatusSnapshot(ledger, config, 'IN_PROCESS_FALLBACK');
  });
}

/**
 * Handles a live HTTP 429 / RESOURCE_EXHAUSTED response from Google's Gemini API:
 * - Atomically updates the shared Firestore cooldown & 429 counter so all Cloud Run
 *   instances immediately halt retries and suspend historical backfill.
 * - Returns a structured GeminiQuotaExceededError so callers stop retrying immediately.
 */
export async function handleGeminiRateLimitError(
  lane: GeminiQuotaLane,
  err: unknown,
  model?: string
): Promise<GeminiQuotaExceededError> {
  const dateKey = getAthensDateKey();
  const config = getEffectiveQuotaConfig();
  const now = Date.now();
  const cooldownMs = extractRetryDelayMs(err, config.rateLimitCooldownMs);
  const retryAfterIso = new Date(now + cooldownMs).toISOString();
  const handle = getTransactionalQuotaHandle(dateKey);

  const applyCooldown = (ledger: DailyQuotaLedger): DailyQuotaLedger => {
    ledger.rateLimit429Count += 1;
    ledger.lastRateLimitAt = new Date(now).toISOString();
    ledger.lastRateLimitReason = `Google Gemini API HTTP 429 / RESOURCE_EXHAUSTED on ${lane}${model ? ` (${model})` : ''}`;
    if (!ledger.quotaExhaustedUntil || Date.parse(ledger.quotaExhaustedUntil) < now + cooldownMs) {
      ledger.quotaExhaustedUntil = retryAfterIso;
    }
    ledger.updatedAt = new Date(now).toISOString();
    return ledger;
  };

  let finalLedger: DailyQuotaLedger;
  let mode: 'FIRESTORE_TRANSACTION' | 'IN_PROCESS_FALLBACK' = lastAccountingMode;

  if (handle) {
    try {
      finalLedger = await handle.db.runTransaction(async (transaction: any) => {
        const snap = await transaction.get(handle.dayRef);
        const current =
          snap && snap.exists && typeof snap.data === 'function'
            ? normalizeRemoteLedger(dateKey, snap.data())
            : createEmptyLedger(dateKey);
        const next = applyCooldown(current);
        transaction.set(handle.dayRef, cleanServerData(next));
        return next;
      });
      fallbackLedger = finalLedger;
      mode = 'FIRESTORE_TRANSACTION';
      lastAccountingMode = mode;
    } catch {
      finalLedger = await runInProcessExclusive(() => {
        const next = applyCooldown(getOrCreateFallbackLedger(dateKey));
        fallbackLedger = next;
        lastAccountingMode = 'IN_PROCESS_FALLBACK';
        return next;
      });
      mode = 'IN_PROCESS_FALLBACK';
    }
  } else {
    finalLedger = await runInProcessExclusive(() => {
      const next = applyCooldown(getOrCreateFallbackLedger(dateKey));
      fallbackLedger = next;
      lastAccountingMode = 'IN_PROCESS_FALLBACK';
      return next;
    });
    mode = 'IN_PROCESS_FALLBACK';
  }

  const status = buildStatusSnapshot(finalLedger, config, mode);
  const effectiveRetryIso = finalLedger.quotaExhaustedUntil || retryAfterIso;

  const userMessage = HIGH_PRIORITY_LANES.has(lane)
    ? `Google Gemini API provider quota is temporarily exhausted (HTTP 429). Automatic retries have been paused across instances until ${new Date(
        effectiveRetryIso
      ).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens' })} (Athens time).`
    : status.userMessage;

  return new GeminiQuotaExceededError({
    code: 'GEMINI_QUOTA_EXHAUSTED',
    lane,
    retryAfterIso: effectiveRetryIso,
    userMessage,
  });
}

/**
 * Maps an article analysis trigger string to its appropriate Gemini quota priority lane.
 */
export function resolveArticleQuotaLane(trigger?: string): GeminiQuotaLane {
  if (trigger === 'HISTORICAL_BACKFILL') return 'HISTORICAL_BACKFILL';
  if (trigger === 'DAILY_PIPELINE' || trigger === 'SCHEDULED_DAILY') return 'DAILY_INTELLIGENCE';
  return 'LIVE_ARTICLE';
}

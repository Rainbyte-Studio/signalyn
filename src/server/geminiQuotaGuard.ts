/**
 * Signalyn Centralized Gemini Quota Protection & True Provider-Request Accounting
 *
 * Ensures daily market intelligence (newly collected articles, Daily Pipeline,
 * Story Intelligence, Daily Brief) always takes priority over optional Historical
 * Backfill, tracks EVERY actual provider HTTP call (including retries, fallback
 * models, and story generation), and cleanly stops aggressive retries on HTTP 429
 * / RESOURCE_EXHAUSTED responses.
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
 * request budgets reset aligned with SIGNALYN's 06:00 Europe/Athens reporting day.
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

// Authoritative in-process state (synced to/from Firestore when available)
let cachedLedger: DailyQuotaLedger | null = null;
let lastLedgerHydrateMs = 0;
let configOverrideForTests: Partial<GeminiQuotaConfig> | null = null;
const LEDGER_HYDRATE_TTL_MS = 15_000;

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
 * Test helper: resets in-memory quota state and optional budget overrides.
 */
export function resetGeminiQuotaStateForTests(override?: Partial<GeminiQuotaConfig> | null): void {
  cachedLedger = null;
  lastLedgerHydrateMs = 0;
  configOverrideForTests = override ?? null;
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

function getQuotaDayDocRef(dateKey: string): any | null {
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
    if (!dayRef || typeof dayRef.get !== 'function') return null;
    return dayRef;
  } catch {
    return null;
  }
}

function mergeLedgers(local: DailyQuotaLedger, remote: Partial<DailyQuotaLedger>): DailyQuotaLedger {
  const mergedLanes = emptyLaneCounts();
  for (const lane of Object.keys(mergedLanes) as GeminiQuotaLane[]) {
    mergedLanes[lane] = Math.max(
      local.requestsByLane[lane] || 0,
      Number(remote.requestsByLane?.[lane] || 0)
    );
  }
  const mergedModels: Record<string, number> = { ...local.requestsByModel };
  if (remote.requestsByModel && typeof remote.requestsByModel === 'object') {
    for (const [model, count] of Object.entries(remote.requestsByModel)) {
      mergedModels[model] = Math.max(mergedModels[model] || 0, Number(count || 0));
    }
  }
  const pickLaterIso = (a: string | null, b: string | null | undefined): string | null => {
    if (!a) return b || null;
    if (!b) return a;
    return Date.parse(b) > Date.parse(a) ? b : a;
  };
  return {
    dateKey: local.dateKey,
    totalProviderRequests: Math.max(
      local.totalProviderRequests,
      Number(remote.totalProviderRequests || 0)
    ),
    requestsByLane: mergedLanes,
    requestsByModel: mergedModels,
    retryRequests: Math.max(local.retryRequests, Number(remote.retryRequests || 0)),
    fallbackRequests: Math.max(local.fallbackRequests, Number(remote.fallbackRequests || 0)),
    rateLimit429Count: Math.max(local.rateLimit429Count, Number(remote.rateLimit429Count || 0)),
    quotaExhaustedUntil: pickLaterIso(local.quotaExhaustedUntil, remote.quotaExhaustedUntil),
    lastRateLimitAt: pickLaterIso(local.lastRateLimitAt, remote.lastRateLimitAt),
    lastRateLimitReason: remote.lastRateLimitReason || local.lastRateLimitReason,
    updatedAt: new Date().toISOString(),
  };
}

async function getOrHydrateLedger(forceRefresh = false): Promise<DailyQuotaLedger> {
  const dateKey = getAthensDateKey();
  if (!cachedLedger || cachedLedger.dateKey !== dateKey) {
    cachedLedger = createEmptyLedger(dateKey);
    lastLedgerHydrateMs = 0;
  }

  const now = Date.now();
  if (!forceRefresh && lastLedgerHydrateMs > 0 && now - lastLedgerHydrateMs < LEDGER_HYDRATE_TTL_MS) {
    return cachedLedger;
  }

  // Skip Firestore hydration under Vitest when using synthetic mocks that don't store quota docs
  if (process.env.VITEST === 'true' && configOverrideForTests) {
    lastLedgerHydrateMs = now;
    return cachedLedger;
  }

  const dayRef = getQuotaDayDocRef(dateKey);
  if (dayRef) {
    try {
      const snap = await dayRef.get();
      if (snap && snap.exists && typeof snap.data === 'function') {
        const remote = snap.data();
        // Verify this is actually a quota ledger document (guards against generic mock returns)
        if (remote && remote.dateKey === dateKey && typeof remote.totalProviderRequests === 'number') {
          cachedLedger = mergeLedgers(cachedLedger, remote);
        }
      }
      lastLedgerHydrateMs = now;
      return cachedLedger;
    } catch {
      // Fallback to read-only client SDK if Admin SDK lacks preview IAM
      try {
        const snap = await clientGetDoc(clientDoc(clientDb, 'system', 'geminiQuotaUsage', 'days', dateKey));
        if (snap.exists()) {
          const remote = snap.data() as Partial<DailyQuotaLedger>;
          if (remote && remote.dateKey === dateKey) {
            cachedLedger = mergeLedgers(cachedLedger, remote);
          }
        }
      } catch {
        // Keep authoritative in-memory ledger
      }
    }
  }

  lastLedgerHydrateMs = now;
  return cachedLedger;
}

async function persistLedgerBestEffort(ledger: DailyQuotaLedger): Promise<void> {
  if (process.env.VITEST === 'true') return;
  const dayRef = getQuotaDayDocRef(ledger.dateKey);
  if (!dayRef || typeof dayRef.set !== 'function') return;
  try {
    await dayRef.set(cleanServerData(ledger), { merge: true });
  } catch {
    // Non-fatal in preview environments without Admin write permissions
  }
}

export interface GeminiQuotaAllowance {
  allowed: boolean;
  code?: GeminiQuotaBlockCode;
  userMessage?: string;
  retryAfterIso?: string | null;
  status: GeminiQuotaStatus;
}

function buildStatusSnapshot(ledger: DailyQuotaLedger, config: GeminiQuotaConfig): GeminiQuotaStatus {
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
    'Gemini API capacity is healthy. Daily market intelligence has priority reserve protection.';

  if (isCooldownActive) {
    statusLevel = 'EXHAUSTED';
    const retryTime = new Date(exhaustedUntilMs).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Athens',
    });
    userMessage = `Gemini API quota limit reached. Historical processing is suspended and retries are paused until ${retryTime} (Athens time).`;
  } else if (isDailyBudgetExhausted) {
    statusLevel = 'EXHAUSTED';
    userMessage =
      'Daily Gemini request budget has been reached for today. Processing will resume automatically on the next reporting day.';
  } else if (!historicalAllowed) {
    statusLevel = 'RESERVED_ONLY';
    userMessage =
      'Remaining daily Gemini capacity is reserved for current market intelligence, Stories, and the Daily Brief. Historical backfill is suspended.';
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
    updatedAt: ledger.updatedAt,
  };
}

/**
 * Read-only snapshot of today's Gemini quota status and true provider-request accounting.
 */
export async function getGeminiQuotaStatus(forceRefresh = false): Promise<GeminiQuotaStatus> {
  const ledger = await getOrHydrateLedger(forceRefresh);
  const config = getEffectiveQuotaConfig();
  return buildStatusSnapshot(ledger, config);
}

/**
 * Checks whether a Gemini provider request is permitted for the specified lane.
 * Protects reserved capacity strictly for Daily Intelligence, Stories, and Daily Briefs.
 */
export async function checkGeminiQuotaAllowance(
  lane: GeminiQuotaLane
): Promise<GeminiQuotaAllowance> {
  const ledger = await getOrHydrateLedger();
  const config = getEffectiveQuotaConfig();
  const status = buildStatusSnapshot(ledger, config);

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
        'Historical analysis paused: remaining daily Gemini quota is reserved for current market intelligence and the Daily Brief.',
      status,
    };
  }

  return { allowed: true, status };
}

/**
 * Asserts quota allowance and throws GeminiQuotaExceededError when blocked.
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
 * Records an ACTUAL outbound Gemini provider HTTP request (never assuming 1 article = 1 call).
 * Call this for every primary request, retry attempt, fallback model call, story call, and brief call.
 */
export async function recordGeminiProviderRequest(params: {
  lane: GeminiQuotaLane;
  model: string;
  isRetry?: boolean;
  isFallback?: boolean;
  outcome?: 'SUCCESS' | 'RATE_LIMITED' | 'ERROR';
}): Promise<GeminiQuotaStatus> {
  const ledger = await getOrHydrateLedger();
  const config = getEffectiveQuotaConfig();

  ledger.totalProviderRequests += 1;
  ledger.requestsByLane[params.lane] = (ledger.requestsByLane[params.lane] || 0) + 1;
  ledger.requestsByModel[params.model] = (ledger.requestsByModel[params.model] || 0) + 1;
  if (params.isRetry) ledger.retryRequests += 1;
  if (params.isFallback) ledger.fallbackRequests += 1;
  if (params.outcome === 'RATE_LIMITED') ledger.rateLimit429Count += 1;
  ledger.updatedAt = new Date().toISOString();

  await persistLedgerBestEffort(ledger);
  return buildStatusSnapshot(ledger, config);
}

/**
 * Handles a live HTTP 429 / RESOURCE_EXHAUSTED response from Gemini:
 * - Activates quota cooldown immediately
 * - Suspends historical processing
 * - Returns a structured GeminiQuotaExceededError so callers stop retrying immediately
 */
export async function handleGeminiRateLimitError(
  lane: GeminiQuotaLane,
  err: unknown,
  model?: string
): Promise<GeminiQuotaExceededError> {
  const ledger = await getOrHydrateLedger();
  const config = getEffectiveQuotaConfig();
  const now = Date.now();
  const cooldownMs = extractRetryDelayMs(err, config.rateLimitCooldownMs);
  const retryAfterIso = new Date(now + cooldownMs).toISOString();

  ledger.rateLimit429Count += 1;
  ledger.lastRateLimitAt = new Date(now).toISOString();
  ledger.lastRateLimitReason = `HTTP 429 / RESOURCE_EXHAUSTED on ${lane}${model ? ` (${model})` : ''}`;
  if (!ledger.quotaExhaustedUntil || Date.parse(ledger.quotaExhaustedUntil) < now + cooldownMs) {
    ledger.quotaExhaustedUntil = retryAfterIso;
  }
  ledger.updatedAt = new Date(now).toISOString();

  await persistLedgerBestEffort(ledger);
  const status = buildStatusSnapshot(ledger, config);

  const userMessage = HIGH_PRIORITY_LANES.has(lane)
    ? `Gemini API quota is temporarily exhausted. Automatic retries have been paused to protect capacity until ${new Date(
        retryAfterIso
      ).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens' })} (Athens time).`
    : status.userMessage;

  return new GeminiQuotaExceededError({
    code: 'GEMINI_QUOTA_EXHAUSTED',
    lane,
    retryAfterIso,
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

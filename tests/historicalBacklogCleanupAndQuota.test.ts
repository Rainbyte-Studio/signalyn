/**
 * Isolated Regression Suite:
 * Historical Backlog Cleanup, Dependency Protection, Disabled-by-Default Backfill,
 * Gemini Quota Protection & True Provider-Request Accounting.
 *
 * Uses strictly isolated in-memory Firestore & Gemini mocks — zero production writes,
 * zero external Gemini API calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted in-memory Firestore & Gemini mock store
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => {
  type DocMap = Map<string, Record<string, any>>;

  const collections = new Map<string, DocMap>();
  const systemDocs = new Map<string, Record<string, any>>();
  const backfillRuns = new Map<string, Record<string, any>>();
  const cleanupAudits = new Map<string, Record<string, any>>();

  let batchCommitCount = 0;
  let lastBatchWriteSizes: number[] = [];

  const getCol = (name: string): DocMap => {
    let col = collections.get(name);
    if (!col) {
      col = new Map();
      collections.set(name, col);
    }
    return col;
  };

  const reset = () => {
    collections.clear();
    systemDocs.clear();
    backfillRuns.clear();
    cleanupAudits.clear();
    batchCommitCount = 0;
    lastBatchWriteSizes = [];
  };

  const makeDocRef = (colName: string, docId: string, subStore?: DocMap) => {
    const store = subStore || getCol(colName);
    return {
      __path: `${colName}/${docId}`,
      id: docId,
      get: async () => {
        const val = store.get(docId);
        return {
          exists: val !== undefined,
          id: docId,
          data: () => (val ? structuredClone(val) : undefined),
        };
      },
      set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
        if (opts?.merge && store.has(docId)) {
          store.set(docId, { ...store.get(docId)!, ...structuredClone(data) });
        } else {
          store.set(docId, structuredClone(data));
        }
      },
      update: async (data: Record<string, any>) => {
        const prev = store.get(docId) || {};
        store.set(docId, { ...prev, ...structuredClone(data) });
      },
      delete: async () => {
        store.delete(docId);
      },
    };
  };

  const makeSystemDocRef = (path: string) => ({
    __path: path,
    get: async () => {
      const val = systemDocs.get(path);
      return {
        exists: val !== undefined,
        data: () => (val ? structuredClone(val) : undefined),
      };
    },
    set: async (data: Record<string, any>, opts?: { merge?: boolean }) => {
      if (opts?.merge && systemDocs.has(path)) {
        systemDocs.set(path, { ...systemDocs.get(path)!, ...structuredClone(data) });
      } else {
        systemDocs.set(path, structuredClone(data));
      }
    },
    delete: async () => {
      systemDocs.delete(path);
    },
  });

  const db = {
    doc: (path: string) => makeSystemDocRef(path),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, val: any) => {
          systemDocs.set(ref.__path, structuredClone(val));
        },
        update: (ref: any, val: any) => {
          ref.update(val);
        },
        delete: (ref: any) => {
          systemDocs.delete(ref.__path);
        },
      };
      return fn(tx);
    },
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        delete: (ref: any) => {
          ops.push(() => {
            const [col, id] = String(ref.__path).split('/');
            getCol(col).delete(id);
          });
        },
        update: (ref: any, data: Record<string, any>) => {
          ops.push(() => {
            ref.update(data);
          });
        },
        commit: async () => {
          batchCommitCount += 1;
          lastBatchWriteSizes.push(ops.length);
          for (const op of ops) op();
        },
      };
    },
    collection: (name: string) => {
      if (name === 'system') {
        return {
          doc: (docId: string) => {
            if (docId === 'backfillRuns') {
              return {
                collection: () => ({
                  get: async () => ({
                    docs: Array.from(backfillRuns.entries()).map(([id, data]) => ({
                      id,
                      data: () => structuredClone(data),
                    })),
                  }),
                  where: () => ({
                    get: async () => ({
                      docs: Array.from(backfillRuns.entries()).map(([id, data]) => ({
                        id,
                        data: () => structuredClone(data),
                      })),
                    }),
                  }),
                  doc: (runId: string) => makeDocRef('backfillRuns', runId, backfillRuns),
                }),
              };
            }
            if (docId === 'historicalBacklogCleanupAudit') {
              return {
                collection: () => ({
                  doc: (auditId: string) => makeDocRef('cleanupAudits', auditId, cleanupAudits),
                }),
              };
            }
            if (docId === 'geminiQuotaUsage') {
              const quotaDays = getCol('__geminiQuotaDays');
              return {
                collection: () => ({
                  doc: (dayKey: string) => makeDocRef('__geminiQuotaDays', dayKey, quotaDays),
                }),
              };
            }
            return makeSystemDocRef(`system/${docId}`);
          },
        };
      }

      const store = getCol(name);
      return {
        doc: (id: string) => makeDocRef(name, id, store),
        get: async () => {
          const docs = Array.from(store.entries()).map(([id, data]) => ({
            id,
            data: () => structuredClone(data),
          }));
          return {
            docs,
            forEach: (cb: (doc: any) => void) => docs.forEach(cb),
          };
        },
        limit: (n: number) => ({
          get: async () => ({
            docs: Array.from(store.entries())
              .slice(0, n)
              .map(([id, data]) => ({ id, data: () => structuredClone(data) })),
          }),
          startAfter: () => ({ get: async () => ({ docs: [] }) }),
        }),
      };
    },
  };

  return {
    collections,
    systemDocs,
    backfillRuns,
    cleanupAudits,
    getCol,
    reset,
    db,
    getBatchStats: () => ({ batchCommitCount, lastBatchWriteSizes: [...lastBatchWriteSizes] }),
    generateContent: vi.fn(),
    getPipelineLeaseStatus: vi.fn(),
  };
});

vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: () => mockState.db,
  cleanServerData: (v: unknown) => v,
}));

vi.mock('../src/server/pipelineLease', () => ({
  getPipelineLeaseStatus: mockState.getPipelineLeaseStatus,
}));

vi.mock('../src/server/geminiClient', () => ({
  isGeminiConfigured: () => true,
  getGeminiClient: () => ({ models: { generateContent: mockState.generateContent } }),
  GEMINI_ANALYSIS_MODEL: 'gemini-3.1-flash-lite',
  GEMINI_FALLBACK_MODEL: 'gemini-3.8-flash',
  SIGNALYN_ANALYSIS_VERSION: 'test-v1',
}));

vi.mock('../src/server/entityResolution/canonicalContextCache', () => ({
  getCanonicalContext: async () => ({
    canonicalCompanies: [{ id: 'comp-huawei', name: 'Huawei', aliases: [] }],
    canonicalProducts: [],
    settings: { myCompanyName: 'Huawei', competitors: ['Apple', 'Samsung', 'Xiaomi'] },
  }),
}));

vi.mock('../src/server/analytics/firestoreAggregationAdapter', () => ({
  recordArticleContributionInFirestore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/server/clustering/incrementalStoryService', () => ({
  processArticleForStory: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildFullDependencyGraph,
  classifyArticlesForHistoricalCleanup,
  previewHistoricalBacklogCleanup,
  executeHistoricalBacklogCleanup,
} from '../src/server/backfill/historicalBacklogCleanupService';
import {
  getHistoricalBackfillConfig,
  setHistoricalBackfillEnabled,
  executeBackfillBatch,
  resumeBackfill,
  getBacklogInventory,
} from '../src/server/backfill/backfillEngine';
import {
  assertGeminiQuotaAllowance,
  checkGeminiQuotaAllowance,
  GeminiQuotaExceededError,
  getGeminiQuotaStatus,
  handleGeminiRateLimitError,
  recordGeminiProviderRequest,
  resetGeminiQuotaStateForTests,
} from '../src/server/geminiQuotaGuard';
import { analyzeArticle } from '../src/server/analysisEngine';
import { generateCanonicalPresentation } from '../src/server/clustering/storyPresentationService';
import { adjudicateAmbiguousPair } from '../src/server/clustering/ambiguousAdjudicator';
import { Article } from '../src/types';

function makeArticle(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    title: 'Samsung Galaxy S26 Ultra smartphone benchmark leaked',
    excerpt: 'Hardware smartphone launch specs and camera review.',
    canonicalUrl: `https://example.com/articles/${id}`,
    sourceId: 'src-1',
    sourceName: 'TechSource',
    publishedAt: '2026-09-01T10:00:00.000Z',
    createdAt: '2026-09-01T10:05:00.000Z',
    processingStatus: 'PENDING',
    ...overrides,
  } as Article;
}

beforeEach(() => {
  mockState.reset();
  resetGeminiQuotaStateForTests({
    dailyRequestBudget: 300,
    dailyReservedCapacity: 220,
    rateLimitCooldownMs: 15 * 60 * 1000,
  });
  mockState.generateContent.mockReset();
  mockState.getPipelineLeaseStatus.mockReset();
  mockState.getPipelineLeaseStatus.mockResolvedValue({ active: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Historical Backlog Cleanup & Full 6-Collection Dependency Protection
// ---------------------------------------------------------------------------
describe('Historical Backlog Cleanup & Dependency Protection', () => {
  it('classifies every article into a single mutually exclusive disposition and protects all 6 dependency types', () => {
    const nowIso = new Date().toISOString();
    const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const windowEndIso = new Date(Date.now() + 60 * 1000).toISOString();

    const articles: Article[] = [
      // Protected articles
      makeArticle('art-analyzed', { processingStatus: 'ANALYZED' }),
      makeArticle('art-has-analysis-doc', { processingStatus: 'FAILED' }), // stale failed status but has articleAnalysis
      makeArticle('art-processing', { processingStatus: 'PROCESSING' }),
      makeArticle('art-story-ref', { processingStatus: 'FAILED' }),
      makeArticle('art-ledger-ref', { processingStatus: 'PENDING' }),
      makeArticle('art-daily-agg-ref', { processingStatus: 'SKIPPED_STRATEGIC_SCOPE' }),
      makeArticle('art-brief-ref', { processingStatus: 'PENDING' }),
      makeArticle('art-review-ref', { processingStatus: 'FAILED' }),
      makeArticle('art-today-window', { processingStatus: 'PENDING', publishedAt: nowIso }),
      makeArticle('art-corp-uncertain', {
        processingStatus: 'PENDING',
        title: 'Apple quarterly earnings and global corporate restructuring update',
        excerpt: 'Huawei and Samsung supply chain executive strategy shifts.',
      }),

      // Eligible articles
      makeArticle('art-hist-pending', { processingStatus: 'PENDING' }),
      makeArticle('art-hist-failed', { processingStatus: 'FAILED', analysisError: '401 invalid key' }),
      makeArticle('art-hist-archived-failed', { processingStatus: 'ARCHIVED_FAILED' }),
      makeArticle('art-out-of-scope-skipped', {
        processingStatus: 'SKIPPED_STRATEGIC_SCOPE',
        title: 'Premier League football standings update',
        excerpt: 'Match highlights.',
      }),
      makeArticle('art-out-of-scope-pending', {
        processingStatus: 'PENDING',
        title: 'Best coffee recipes for Sunday brunch',
        excerpt: 'Espresso and cappuccino tips.',
      }),
      makeArticle('art-dup-of-analyzed', {
        processingStatus: 'PENDING',
        canonicalUrl: 'https://example.com/articles/art-analyzed',
      }),
      makeArticle('art-empty-unusable', {
        processingStatus: 'PENDING',
        title: '   ',
        excerpt: '',
      }),
    ];

    const graph = buildFullDependencyGraph({
      articleAnalysis: [{ id: 'art-has-analysis-doc', data: { articleId: 'art-has-analysis-doc' } }],
      stories: [{ id: 'story-1', data: { articleIds: ['art-story-ref', 'art-analyzed'] } }],
      analyticsLedger: [{ id: 'art-ledger-ref', data: { articleId: 'art-ledger-ref' } }],
      analyticsDaily: [{ id: '2026-09-01', data: { sampleArticleIds: ['art-daily-agg-ref'] } }],
      dailyBriefs: [
        {
          id: 'brief-2026-09-01',
          data: {
            english: {
              headlineDevelopments: [{ groundedArticles: [{ articleId: 'art-brief-ref' }] }],
            },
          },
        },
      ],
      entityReview: [{ id: 'rev-1', data: { articleId: 'art-review-ref' } }],
      sources: [{ id: 'src-1', data: { name: 'TechSource' } }],
    });

    const classified = classifyArticlesForHistoricalCleanup(articles, graph, {
      windowStartIso,
      windowEndIso,
    });

    const byId = new Map(classified.map((c) => [c.article.id, c]));
    const eligibleCount = classified.filter((c) => c.eligibleForDeletion).length;
    const protectedCount = classified.filter((c) => !c.eligibleForDeletion).length;

    // Strict disjoint partition
    expect(eligibleCount + protectedCount).toBe(articles.length);
    expect(protectedCount).toBe(10);
    expect(eligibleCount).toBe(7);

    // Verify all 10 protected reasons
    expect(byId.get('art-analyzed')?.disposition).toBe('PROTECTED_ANALYZED');
    expect(byId.get('art-has-analysis-doc')?.disposition).toBe('PROTECTED_ANALYZED');
    expect(byId.get('art-processing')?.disposition).toBe('PROTECTED_ACTIVE_PROCESSING');
    expect(byId.get('art-story-ref')?.disposition).toBe('PROTECTED_REFERENCED_DEPENDENCY');
    expect(byId.get('art-ledger-ref')?.disposition).toBe('PROTECTED_REFERENCED_DEPENDENCY');
    expect(byId.get('art-daily-agg-ref')?.disposition).toBe('PROTECTED_REFERENCED_DEPENDENCY');
    expect(byId.get('art-brief-ref')?.disposition).toBe('PROTECTED_REFERENCED_DEPENDENCY');
    expect(byId.get('art-review-ref')?.disposition).toBe('PROTECTED_REFERENCED_DEPENDENCY');
    expect(byId.get('art-today-window')?.disposition).toBe('PROTECTED_DAILY_PIPELINE_WINDOW');
    expect(byId.get('art-corp-uncertain')?.disposition).toBe('PROTECTED_CORPORATE_UNCERTAIN');

    // Verify all 7 eligible reasons
    expect(byId.get('art-hist-pending')?.disposition).toBe('ELIGIBLE_HISTORICAL_PENDING');
    expect(byId.get('art-hist-failed')?.disposition).toBe('ELIGIBLE_HISTORICAL_FAILED');
    expect(byId.get('art-hist-archived-failed')?.disposition).toBe('ELIGIBLE_HISTORICAL_FAILED');
    expect(byId.get('art-out-of-scope-skipped')?.disposition).toBe('ELIGIBLE_OBSOLETE_OUT_OF_SCOPE');
    expect(byId.get('art-out-of-scope-pending')?.disposition).toBe('ELIGIBLE_OBSOLETE_OUT_OF_SCOPE');
    expect(byId.get('art-dup-of-analyzed')?.disposition).toBe('ELIGIBLE_DUPLICATE_OR_UNUSABLE');
    expect(byId.get('art-empty-unusable')?.disposition).toBe('ELIGIBLE_DUPLICATE_OR_UNUSABLE');
  });

  it('enforces dry-run default, explicit confirmation, concurrent lock safety, bounded idempotent deletion, audit logging, and zero Gemini calls', async () => {
    const articlesCol = mockState.getCol('articles');
    articlesCol.set('keep-analyzed', makeArticle('keep-analyzed', { processingStatus: 'ANALYZED' }));
    articlesCol.set('keep-today', makeArticle('keep-today', { processingStatus: 'PENDING', publishedAt: new Date().toISOString() }));
    articlesCol.set('keep-story-dep', makeArticle('keep-story-dep', { processingStatus: 'FAILED' }));
    mockState.getCol('stories').set('story-keep', { articleIds: ['keep-story-dep'] });
    mockState.getCol('analyticsDaily').set('2026-10-01', { totalArticles: 5 });
    mockState.getCol('sources').set('src-1', { name: 'TechSource' });

    // Seed 135 unreferenced historical articles to test bounded chunking (100 + 35)
    for (let i = 0; i < 120; i++) {
      articlesCol.set(`del-pending-${i}`, makeArticle(`del-pending-${i}`, { processingStatus: 'PENDING' }));
    }
    for (let i = 0; i < 15; i++) {
      articlesCol.set(`del-failed-${i}`, makeArticle(`del-failed-${i}`, { processingStatus: 'FAILED' }));
    }

    // Open historical backfill checkpoint that must be stopped safely
    mockState.backfillRuns.set('run-open-1', {
      runId: 'run-open-1',
      status: 'PAUSED',
      mode: 'HISTORICAL_INTELLIGENCE',
    });

    // 1. Read-only preview
    const preview = await previewHistoricalBacklogCleanup();
    expect(preview.totalStoredArticles).toBe(138);
    expect(preview.totalEligibleForDeletion).toBe(135);
    expect(preview.totalProtectedFromDeletion).toBe(3);
    expect(preview.expectedRemainingInventory.totalArticles).toBe(3);
    expect(preview.expectedRemainingInventory.preservedCollections.analyticsDaily).toBe(1);
    expect(preview.expectedRemainingInventory.preservedCollections.sources).toBe(1);
    expect(preview.activeBackfillRunsCount).toBe(1);

    // 2. Requires explicit confirmCleanup when dryRun === false
    await expect(
      executeHistoricalBacklogCleanup({ dryRun: false, confirmCleanup: false })
    ).rejects.toThrow('EXPLICIT_ADMIN_CONFIRMATION_REQUIRED');

    // 3. Blocks when Daily Pipeline is active
    mockState.getPipelineLeaseStatus.mockResolvedValueOnce({ active: true });
    await expect(
      executeHistoricalBacklogCleanup({ dryRun: false, confirmCleanup: true })
    ).rejects.toThrow('PIPELINE_ACTIVE_PRIORITY');

    // 4. Blocks when another backfill batch lease is held
    mockState.systemDocs.set('system/historicalBackfillBatchLease', {
      owner: 'other-worker',
      expiresAt: Date.now() + 60_000,
    });
    await expect(
      executeHistoricalBacklogCleanup({ dryRun: false, confirmCleanup: true })
    ).rejects.toThrow('BACKFILL_LEASE_CONFLICT');
    mockState.systemDocs.delete('system/historicalBackfillBatchLease');

    // 5. Dry-run deletes nothing
    const dryRes = await executeHistoricalBacklogCleanup({ dryRun: true });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.deletedCount).toBe(135);
    expect(dryRes.geminiCallsUsed).toBe(0);
    expect(articlesCol.size).toBe(138);

    // 6. Confirmed cleanup deletes in bounded batches (100 + 35), cancels open backfill run, preserves dependencies & writes audit
    const execRes = await executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      executedBy: 'nick@rainbyte.studio',
    });
    expect(execRes.dryRun).toBe(false);
    expect(execRes.deletedCount).toBe(135);
    expect(execRes.protectedCount).toBe(3);
    expect(execRes.geminiCallsUsed).toBe(0);
    expect(execRes.stoppedBackfillRunIds).toEqual(['run-open-1']);
    expect(mockState.backfillRuns.get('run-open-1')?.status).toBe('CANCELLED');
    expect(mockState.getBatchStats().lastBatchWriteSizes).toEqual([100, 35]);
    expect(articlesCol.size).toBe(3);
    expect(articlesCol.has('keep-analyzed')).toBe(true);
    expect(articlesCol.has('keep-today')).toBe(true);
    expect(articlesCol.has('keep-story-dep')).toBe(true);
    expect(mockState.cleanupAudits.has(execRes.auditId)).toBe(true);
    expect(mockState.generateContent).not.toHaveBeenCalled();

    // 7. Idempotency: re-running cleanup is a clean 0-delete no-op
    const secondRes = await executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      executedBy: 'nick@rainbyte.studio',
    });
    expect(secondRes.deletedCount).toBe(0);
    expect(secondRes.protectedCount).toBe(3);

    // 8. Post-cleanup counter reconciliation via getBacklogInventory
    // Remove keep-story-dep failure to verify clean 0-backlog, 0-failure empty state counters
    articlesCol.delete('keep-story-dep');
    const postInventory = await getBacklogInventory();
    expect(postInventory.totalStoredArticles).toBe(2);
    expect(postInventory.alreadyAnalyzedArticles).toBe(1);
    expect(postInventory.pendingHistoricalStrategicArticles).toBe(0);
    expect(postInventory.pendingTodayStrategicArticles).toBe(1);
    expect(postInventory.actionableFailedArticles).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Historical Backfill Disabled by Default & Explicit Activation
// ---------------------------------------------------------------------------
describe('Historical Backfill Disabled by Default', () => {
  it('defaults to disabled and blocks executeBackfillBatch and resumeBackfill until explicitly enabled', async () => {
    const initialCfg = await getHistoricalBackfillConfig();
    expect(initialCfg.enabled).toBe(false);
    expect(initialCfg.source).toBe('default_disabled');

    mockState.backfillRuns.set('checkpoint-1', {
      runId: 'checkpoint-1',
      status: 'PAUSED',
      mode: 'HISTORICAL_INTELLIGENCE',
    });

    await expect(executeBackfillBatch({ batchSize: 10 })).rejects.toThrow('HISTORICAL_BACKFILL_DISABLED');
    await expect(resumeBackfill('checkpoint-1')).rejects.toThrow('HISTORICAL_BACKFILL_DISABLED');
    expect(mockState.generateContent).not.toHaveBeenCalled();

    // Explicit administrator activation
    const enabledCfg = await setHistoricalBackfillEnabled(true, 'nick@rainbyte.studio');
    expect(enabledCfg.enabled).toBe(true);
    expect(enabledCfg.updatedBy).toBe('nick@rainbyte.studio');

    const resumed = await resumeBackfill('checkpoint-1');
    expect(resumed.status).toBe('RUNNING');

    // Disabling again re-blocks historical execution
    await setHistoricalBackfillEnabled(false, 'nick@rainbyte.studio');
    await expect(executeBackfillBatch({ batchSize: 10 })).rejects.toThrow('HISTORICAL_BACKFILL_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// 3. Gemini Quota Protection, True Provider Accounting & HTTP 429 Handling
// ---------------------------------------------------------------------------
describe('Gemini Quota Protection & True Provider-Request Accounting', () => {
  it('counts every actual provider request (primary, retry, fallback, story) and reserves daily capacity for current intelligence', async () => {
    resetGeminiQuotaStateForTests({
      dailyRequestBudget: 10,
      dailyReservedCapacity: 8, // Only 2 surplus requests available for Historical Backfill
    });

    // Simulate 1 article taking 2 provider calls (503 primary + fallback success)
    await recordGeminiProviderRequest({
      lane: 'HISTORICAL_BACKFILL',
      model: 'gemini-3.1-flash-lite',
      outcome: 'ERROR',
    });
    await recordGeminiProviderRequest({
      lane: 'HISTORICAL_BACKFILL',
      model: 'gemini-3.8-flash',
      isRetry: true,
      isFallback: true,
      outcome: 'SUCCESS',
    });

    const status = await getGeminiQuotaStatus();
    expect(status.totalProviderRequests).toBe(2);
    expect(status.retryRequests).toBe(1);
    expect(status.fallbackRequests).toBe(1);
    expect(status.remainingTotalBudget).toBe(8);
    expect(status.remainingForHistorical).toBe(0);
    expect(status.historicalAllowed).toBe(false);
    expect(status.dailyIntelligenceAllowed).toBe(true);
    expect(status.statusLevel).toBe('RESERVED_ONLY');

    // Historical lane is blocked immediately
    await expect(assertGeminiQuotaAllowance('HISTORICAL_BACKFILL')).rejects.toThrow(
      'GEMINI_RESERVED_FOR_DAILY_INTELLIGENCE'
    );

    // High-priority daily intelligence lanes remain allowed
    await expect(assertGeminiQuotaAllowance('DAILY_INTELLIGENCE')).resolves.toBeTruthy();
    await expect(assertGeminiQuotaAllowance('LIVE_ARTICLE')).resolves.toBeTruthy();
    await expect(assertGeminiQuotaAllowance('STORY_INTELLIGENCE')).resolves.toBeTruthy();
    await expect(assertGeminiQuotaAllowance('DAILY_BRIEF')).resolves.toBeTruthy();
  });

  it('stops aggressive retries immediately on HTTP 429 / RESOURCE_EXHAUSTED, suspends historical lane, and preserves article as PENDING', async () => {
    const articlesCol = mockState.getCol('articles');
    articlesCol.set('art-429', makeArticle('art-429', { processingStatus: 'PENDING' }));

    mockState.generateContent.mockRejectedValue(
      new Error('429 RESOURCE_EXHAUSTED: Quota exceeded for model gemini-3.1-flash-lite')
    );

    const result = await analyzeArticle('art-429', { trigger: 'HISTORICAL_BACKFILL' });

    // Must stop after EXACTLY 1 provider call — NO retry loop and NO fallback model call!
    expect(mockState.generateContent).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.quotaSuspended).toBe(true);
    expect(result.quotaCode).toBe('GEMINI_QUOTA_EXHAUSTED');

    // Article stays safely PENDING & retryEligible (not burned as permanent failure)
    const updatedArt = articlesCol.get('art-429');
    expect(updatedArt?.processingStatus).toBe('PENDING');
    expect(updatedArt?.retryEligible).toBe(true);

    // Quota status reflects active 429 cooldown
    const status = await getGeminiQuotaStatus();
    expect(status.isQuotaExhausted).toBe(true);
    expect(status.rateLimit429Count).toBeGreaterThanOrEqual(1);
    expect(status.historicalAllowed).toBe(false);
    expect(status.statusLevel).toBe('EXHAUSTED');

    // Story presentation gracefully degrades to deterministic English without calling Gemini during cooldown
    const presentation = await generateCanonicalPresentation({
      articles: [makeArticle('art-429')],
      analyses: [
        {
          articleId: 'art-429',
          summary: 'Samsung Galaxy S26 Ultra camera leak details.',
          companies: [{ canonicalName: 'Samsung', detectedName: 'Samsung', confidence: 0.9 }],
          products: [{ canonicalName: 'Galaxy S26 Ultra', detectedName: 'Galaxy S26 Ultra', confidence: 0.9 }],
          topics: ['Camera'],
          newsType: 'LEAK_RUMOR',
        } as any,
      ],
    });
    expect(presentation.presentationLanguage).toBe('en');
    expect(mockState.generateContent).toHaveBeenCalledTimes(1);

    // Ambiguous adjudicator also respects active cooldown without burning provider calls
    await expect(
      adjudicateAmbiguousPair(
        makeArticle('a1'),
        { summary: 'A', companies: [], products: [], topics: [] } as any,
        makeArticle('a2'),
        { summary: 'B', companies: [], products: [], topics: [] } as any,
        { decision: 'AMBIGUOUS', totalScore: 0.5, scores: {}, explanation: 'test' } as any
      )
    ).rejects.toBeInstanceOf(GeminiQuotaExceededError);
    expect(mockState.generateContent).toHaveBeenCalledTimes(1);
  });

  it('suspends an enabled historical backfill batch cleanly if quota cooldown triggers before execution', async () => {
    await setHistoricalBackfillEnabled(true, 'nick@rainbyte.studio');
    await handleGeminiRateLimitError('HISTORICAL_BACKFILL', new Error('429 RESOURCE_EXHAUSTED'), 'gemini-3.1-flash-lite');

    await expect(executeBackfillBatch({ batchSize: 10 })).rejects.toBeInstanceOf(GeminiQuotaExceededError);
    expect(mockState.generateContent).not.toHaveBeenCalled();

    const allowance = await checkGeminiQuotaAllowance('HISTORICAL_BACKFILL');
    expect(allowance.allowed).toBe(false);
    expect(allowance.code).toBe('GEMINI_QUOTA_EXHAUSTED');
  });
});

import { deleteObsoleteFailedArticles } from '../src/server/backfill/failedArticleRecoveryService';
import { readArticleDependencyFences, storeCollectedArticle, writeArticleDependencies } from '../src/server/articleDeletionTombstones';
/**
 * Isolated Regression Suite:
 * Historical Backlog Cleanup, Dependency Protection, Disabled-by-Default Backfill,
 * Gemini Quota Protection & True Provider-Request Accounting.
 *
 * Uses strictly isolated in-memory Firestore & Gemini mocks — zero production writes,
 * zero external Gemini API calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Hoisted in-memory Firestore & Gemini mock store
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => {
  type DocMap = Map<string, Record<string, any>>;

  const collections = new Map<string, DocMap>();
  const systemDocs = new Map<string, Record<string, any>>();
  const backfillRuns = new Map<string, Record<string, any>>();
  const cleanupAudits = new Map<string, Record<string, any>>();

  const previewTokens = new Map<string, Record<string, any>>();
  const tombstoneItems = new Map<string, Record<string, any>>();
  const tombstoneUrls = new Map<string, Record<string, any>>();
  let txMutex: Promise<void> = Promise.resolve();
  let beforeTxHook: ((txIndex: number) => void) | null = null;
  let txCount = 0;

  let batchCommitCount = 0;
  let lastBatchWriteSizes: number[] = [];
  let txDeleteChunkSizes: number[] = [];

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
    previewTokens.clear();
    tombstoneItems.clear();
    tombstoneUrls.clear();
    batchCommitCount = 0;
    lastBatchWriteSizes = [];
    txDeleteChunkSizes = [];
    txCount = 0;
    beforeTxHook = null;
    txMutex = Promise.resolve();
  };

  const makeDocRef = (colName: string, docId: string, subStore?: DocMap) => {
    const store = subStore || getCol(colName);
    return {
      __path: `${colName}/${docId}`,
      __col: colName,
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
    __col: 'system',
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
    update: async (data: Record<string, any>) => {
      const prev = systemDocs.get(path) || {};
      systemDocs.set(path, { ...prev, ...structuredClone(data) });
    },
    delete: async () => {
      systemDocs.delete(path);
    },
  });

  const db = {
    doc: (path: string) => makeSystemDocRef(path),
    collectionGroup: () => ({
      get: async () => ({
        docs: [...collections.entries()].flatMap(([path, docs]) =>
          path === 'articles' || path.endsWith('/articles') ? [...docs.entries()].map(([id, data]) => ({
            id, ref: { path: path + '/' + id, parent: { id: 'articles', parent: path === 'articles' ? null : {} } }, data: () => data,
          })) : []),
      }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prev = txMutex;
      txMutex = prev.then(() => gate);
      await prev;

      try {
        txCount += 1;
        if (beforeTxHook) beforeTxHook(txCount);

        const stagedWrites: Array<() => Promise<void>> = [];
        let articleDeletesInTx = 0;

        const tx = {
          get: async (ref: any) => ref.get(),
          set: (ref: any, val: any, opts?: { merge?: boolean }) => {
            stagedWrites.push(() => ref.set(val, opts));
          },
          update: (ref: any, val: any) => {
            stagedWrites.push(() => ref.update(val));
          },
          delete: (ref: any) => {
            if (ref.__col === 'articles') articleDeletesInTx += 1;
            stagedWrites.push(() => ref.delete());
          },
        };

        const result = await fn(tx);
        for (const write of stagedWrites) {
          await write();
        }
        if (articleDeletesInTx > 0) {
          txDeleteChunkSizes.push(articleDeletesInTx);
        }
        return result;
      } finally {
        release();
      }
    },
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        delete: (ref: any) => {
          ops.push(() => {
            ref.delete();
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
            if (docId === 'backfillRecoveryAudit') {
              return { collection: () => ({ doc: (id: string) => makeDocRef('recoveryAudits', id) }) };
            }
            if (docId === 'historicalBacklogCleanupAudit') {
              return {
                collection: () => ({
                  doc: (auditId: string) => makeDocRef('cleanupAudits', auditId, cleanupAudits),
                }),
              };
            }
            if (docId === 'historicalBacklogCleanupPreviews' || docId === 'failedArticleDeletionPreviews') {
              return {
                collection: () => ({
                  doc: (token: string) => makeDocRef('previewTokens', token, previewTokens),
                }),
              };
            }
            if (docId === 'deletedArticleTombstones') {
              return {
                collection: (sub: string) => {
                  const target = sub === 'urls' ? tombstoneUrls : tombstoneItems;
                  return {
                    doc: (id: string) => makeDocRef(`tombstone_${sub}`, id, target),
                  };
                },
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
    previewTokens,
    tombstoneItems,
    tombstoneUrls,
    getCol,
    reset,
    db,
    getBatchStats: () => ({ batchCommitCount, lastBatchWriteSizes: [...lastBatchWriteSizes], txDeleteChunkSizes: [...txDeleteChunkSizes] }),
    setBeforeTxHook: (hook: ((txIndex: number) => void) | null) => {
      beforeTxHook = hook;
    },
    generateContent: vi.fn(),
    identityInitialized: true,
    verifiedToken: null as any,
  };
});

vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: () => mockState.db,
  cleanServerData: (v: unknown) => v,
}));

vi.mock('../src/server/firestoreAdmin', () => ({
  getServerIdentityStatus: () => ({
    initialized: mockState.identityInitialized,
    credentialMode: mockState.identityInitialized ? 'ADC' : 'NONE',
  }),
  verifyFirebaseIdToken: async (token: string) => {
    if (!mockState.verifiedToken || token !== mockState.verifiedToken.__raw) {
      throw new Error('Invalid Firebase ID token');
    }
    return mockState.verifiedToken;
  },
  isAuthorizedOwner: ({ email, emailVerified }: { email?: string; emailVerified?: boolean }) =>
    Boolean(email && emailVerified && ['nick@rainbyte.studio', 'n.kalogerogiannis@gmail.com'].includes(email.toLowerCase())),
  getServerFirestore: () => mockState.db,
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

import {
  buildFullDependencyGraph,
  classifyArticlesForHistoricalCleanup,
  previewHistoricalBacklogCleanup,
  executeHistoricalBacklogCleanup,
  isDeletedArticleTombstoned,
  validateHistoricalCleanupManifest,
} from '../src/server/backfill/historicalBacklogCleanupService';
import {
  getHistoricalBackfillConfig,
  setHistoricalBackfillEnabled,
  executeBackfillBatch,
  resumeBackfill,
  getBacklogInventory,
  previewEligibleArticles,
} from '../src/server/backfill/backfillEngine';
import {
  assertGeminiQuotaAllowance,
  checkGeminiQuotaAllowance,
  GeminiQuotaExceededError,
  getGeminiQuotaStatus,
  handleGeminiRateLimitError,
  recordGeminiProviderRequest,
  reserveGeminiProviderRequest,
  resetGeminiQuotaStateForTests,
} from '../src/server/geminiQuotaGuard';
import { analyzeArticle } from '../src/server/analysisEngine';
import { generateCanonicalPresentation } from '../src/server/clustering/storyPresentationService';
import { adjudicateAmbiguousPair } from '../src/server/clustering/ambiguousAdjudicator';
import { processArticleForStory } from '../src/server/clustering/incrementalStoryService';
import { requeueRecoverableFailedArticles } from '../src/server/backfill/failedArticleRecoveryService';
import { acquireHistoricalCleanupLease, releaseHistoricalCleanupLease } from '../src/server/maintenanceLock';
import { acquirePipelineLease } from '../src/server/pipelineLease';
import { requireAdminOrAuthorizedClient, requireStrictAdminUser } from '../src/server/authMiddleware';
import { getAthensReportingWindow } from '../src/server/reportingWindow';
import { Article, HistoricalCleanupManifestSelection } from '../src/types';

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
  vi.stubEnv('SIGNALYN_ENABLE_PERMANENT_ARTICLE_DELETION', 'true');
  mockState.reset();
  resetGeminiQuotaStateForTests({
    dailyRequestBudget: 300,
    dailyReservedCapacity: 220,
    rateLimitCooldownMs: 15 * 60 * 1000,
  });
  mockState.generateContent.mockReset();
  mockState.identityInitialized = true;
  mockState.verifiedToken = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Exact Historical Backlog Cleanup manifest', () => {
  function selection(ids: string[]): HistoricalCleanupManifestSelection {
    const candidates = [...ids].sort((a, b) => a.localeCompare(b))
      .map(id => ({ id, category: 'ELIGIBLE_HISTORICAL_PENDING' as const }));
    const selectionSha256 = createHash('sha256')
      .update(candidates.map(({ id, category }) => `${id}:${category}`).join('\n')).digest('hex');
    return { candidates, selectionSha256, candidateCount: candidates.length };
  }

  async function confirmation(manifest: HistoricalCleanupManifestSelection) {
    const confirmedByUid = 'manifest-admin';
    const preview = await executeHistoricalBacklogCleanup({ manifest, confirmedByUid });
    return { manifest, dryRun: false, confirmCleanup: true, confirmedByUid,
      confirmationToken: preview.confirmationToken, previewFingerprint: preview.previewFingerprint };
  }

  it('accepts a full-size manifest in the HTTP budget and revalidates all rows in dry-run', async () => {
    const articles = mockState.getCol('articles');
    const ids = Array.from({ length: 5763 }, (_, i) => 'approved-fixture-' + i.toString().padStart(5, '0'));
    const excluded = Array.from({ length: 9 }, (_, i) => 'excluded-fixture-' + i);
    for (const id of [...ids, ...excluded]) articles.set(id, makeArticle(id));
    const manifest = selection(ids);
    expect(Buffer.byteLength(JSON.stringify({ manifest }))).toBeLessThan(2 * 1024 * 1024);
    expect(await executeHistoricalBacklogCleanup({ manifest, confirmedByUid: 'manifest-admin' }))
      .toMatchObject({ plannedDeletionCount: 5763, protectedCount: 9, deletedCount: 0, geminiCallsUsed: 0 });
    expect(mockState.generateContent).not.toHaveBeenCalled();
  });

  const approvedFixture = process.env.SIGNALYN_APPROVED_MANIFEST_FIXTURE;
  it.skipIf(!approvedFixture)('validates the preserved, approved production manifest offline', () => {
    const manifest = validateHistoricalCleanupManifest(JSON.parse(readFileSync(approvedFixture!, 'utf8')));
    expect(manifest.candidateCount).toBe(5763);
    expect(manifest.selectionSha256).toBe('f924826e6fbc62de4daad3efe1e6688b3d31b31eb59bbd035252a7ba2cdcbd5f');
    expect(Buffer.byteLength(JSON.stringify({ manifest }))).toBeLessThan(2 * 1024 * 1024);
  });

  it('deletes only selected IDs and leaves all nine eligible exclusions and their URLs alone', async () => {
    const articles = mockState.getCol('articles');
    const excluded = Array.from({ length: 9 }, (_, i) => 'excluded-' + i);
    for (const id of ['selected', ...excluded]) articles.set(id, makeArticle(id));
    const result = await executeHistoricalBacklogCleanup(await confirmation(selection(['selected'])));
    expect(result).toMatchObject({ success: true, deletedCount: 1, protectedCount: 9, geminiCallsUsed: 0 });
    expect([...articles.keys()]).toEqual(excluded);
    expect([...mockState.tombstoneItems.keys()]).toEqual(['selected']);
    expect(mockState.generateContent).not.toHaveBeenCalled();
  });

  it('rejects invalid, duplicate, additional or substituted rows and a token presented without its manifest', async () => {
    const articles = mockState.getCol('articles');
    for (const id of ['selected', 'other']) articles.set(id, makeArticle(id));
    const manifest = selection(['selected']);
    const request = await confirmation(manifest);
    await expect(executeHistoricalBacklogCleanup({ manifest: { ...manifest, selectionSha256: '0'.repeat(64) } }))
      .rejects.toThrow('INVALID_CLEANUP_MANIFEST');
    await expect(executeHistoricalBacklogCleanup({ manifest: selection(['selected', 'selected']) }))
      .rejects.toThrow('INVALID_CLEANUP_MANIFEST');
    for (const changed of [selection(['selected', 'other']), selection(['other'])]) {
      await expect(executeHistoricalBacklogCleanup({ ...request, manifest: changed, previewFingerprint: changed.selectionSha256 }))
        .rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
    }
    await expect(executeHistoricalBacklogCleanup({ ...request, manifest: undefined, maxDeletions: 1 }))
      .rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
    expect(articles.size).toBe(2);
  });

  it('rejects a newly protected row before any deletion and remains disabled by default', async () => {
    const articles = mockState.getCol('articles');
    for (const id of ['changed', 'selected']) articles.set(id, makeArticle(id));
    const request = await confirmation(selection(['changed', 'selected']));
    mockState.getCol('entityReview').set('protect', { articleId: 'changed' });
    await expect(executeHistoricalBacklogCleanup(request)).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
    vi.stubEnv('SIGNALYN_ENABLE_PERMANENT_ARTICLE_DELETION', undefined);
    await expect(executeHistoricalBacklogCleanup(request)).rejects.toMatchObject({ code: 'PERMANENT_ARTICLE_DELETION_DISABLED' });
    expect(articles.size).toBe(2);
    expect(mockState.generateContent).not.toHaveBeenCalled();
  });

  it('stops before writing the affected chunk when a dependency appears after preflight', async () => {
    const articles = mockState.getCol('articles');
    for (const id of ['changed', 'selected']) articles.set(id, makeArticle(id));
    const request = await confirmation(selection(['changed', 'selected']));
    mockState.setBeforeTxHook((index) => {
      if (index === 5) mockState.getCol('stories').set('late', { representativeArticleId: 'changed' });
    });
    expect(await executeHistoricalBacklogCleanup(request)).toMatchObject({
      success: false, deletedCount: 0, skippedDueToConcurrentChange: 1, unprocessedSelectedCount: 1, partialExecution: false,
    });
    expect(articles.size).toBe(2);
    expect(mockState.tombstoneItems.size).toBe(0);
  });

  it('reports earlier commits when a later chunk detects a new dependency', async () => {
    const ids = Array.from({ length: 102 }, (_, i) => 'row-' + String(i).padStart(3, '0'));
    const articles = mockState.getCol('articles');
    for (const id of ids) articles.set(id, makeArticle(id));
    const request = await confirmation(selection(ids));
    mockState.setBeforeTxHook((index) => {
      if (index === 6) mockState.getCol('dailyBriefs').set('late', { articleIds: [ids[100]] });
    });
    const result = await executeHistoricalBacklogCleanup(request);
    expect(result).toMatchObject({ success: false, partialExecution: true, deletedCount: 100,
      skippedDueToConcurrentChange: 1, unprocessedSelectedCount: 1, remainingArticlesEstimate: 2 });
    expect([...articles.keys()]).toEqual(ids.slice(100));
    expect(mockState.systemDocs.get(`system/historicalBacklogCleanupAudit/runs/${result.auditId}/chunks/0`))
      .toMatchObject({ chunkDeleted: 100 });
  });
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

    // 3. Blocks when Daily Pipeline is active (real pipelineLease transaction conflict)
    mockState.systemDocs.set('system/pipelineLease', {
      leaseHolder: 'daily-pipeline-worker',
      status: 'ACTIVE',
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      purpose: 'DAILY_INTELLIGENCE_PIPELINE',
    });
    await expect(
      executeHistoricalBacklogCleanup({
        dryRun: false,
        confirmCleanup: true,
        previewFingerprint: preview.previewFingerprint,
        confirmationToken: preview.confirmationToken,
      })
    ).rejects.toThrow('PIPELINE_ACTIVE_PRIORITY');
    mockState.systemDocs.delete('system/pipelineLease');

    // 4. Blocks when another backfill batch lease is held
    mockState.systemDocs.set('system/historicalBackfillBatchLease', {
      owner: 'other-worker',
      expiresAt: Date.now() + 60_000,
    });
    await expect(
      executeHistoricalBacklogCleanup({
        dryRun: false,
        confirmCleanup: true,
        previewFingerprint: preview.previewFingerprint,
        confirmationToken: preview.confirmationToken,
      })
    ).rejects.toThrow('BACKFILL_LEASE_CONFLICT');
    mockState.systemDocs.delete('system/historicalBackfillBatchLease');

    // 5. Dry-run deletes nothing
    const dryRes = await executeHistoricalBacklogCleanup({ dryRun: true });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.deletedCount).toBe(0);
    expect(dryRes.plannedDeletionCount).toBe(135);
    expect(dryRes.geminiCallsUsed).toBe(0);
    expect(dryRes.previewFingerprint).toBe(preview.previewFingerprint);
    expect(articlesCol.size).toBe(138);

    // 5b. Permanent cleanup without previewFingerprint MUST fail closed
    await expect(
      executeHistoricalBacklogCleanup({ dryRun: false, confirmCleanup: true })
    ).rejects.toThrow('PREVIEW_CONFIRMATION_REQUIRED');

    // 6. Confirmed cleanup deletes in bounded atomic transactions (25/tx: 25,25,25,25,25,10), cancels open backfill run, preserves dependencies & writes audit + tombstones
    const execRes = await executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      previewFingerprint: preview.previewFingerprint,
      confirmationToken: preview.confirmationToken,
      executedBy: 'nick@rainbyte.studio',
    });
    expect(execRes.dryRun).toBe(false);
    expect(execRes.deletedCount).toBe(135);
    expect(execRes.protectedCount).toBe(3);
    expect(execRes.tombstonesWritten).toBeGreaterThanOrEqual(135);
    expect(execRes.geminiCallsUsed).toBe(0);
    expect(execRes.stoppedBackfillRunIds).toEqual(['run-open-1']);
    expect(mockState.backfillRuns.get('run-open-1')?.status).toBe('CANCELLED');
    expect(mockState.getBatchStats().txDeleteChunkSizes).toEqual([100, 35]);
    expect(articlesCol.size).toBe(3);
    expect(articlesCol.has('keep-analyzed')).toBe(true);
    expect(articlesCol.has('keep-today')).toBe(true);
    expect(articlesCol.has('keep-story-dep')).toBe(true);
    expect(mockState.cleanupAudits.has(execRes.auditId)).toBe(true);
    expect(mockState.generateContent).not.toHaveBeenCalled();

    // 7. Idempotency: re-preview + re-running cleanup is a clean 0-delete no-op
    const postPreview = await previewHistoricalBacklogCleanup();
    expect(postPreview.totalEligibleForDeletion).toBe(0);
    // Protected story-dep article is FAILED -> dynamic remaining failure counter MUST be 1 (not hardcoded 0!)
    expect(postPreview.expectedRemainingInventory.actionableFailuresRemaining).toBe(1);

    const secondRes = await executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      previewFingerprint: postPreview.previewFingerprint,
      confirmationToken: postPreview.confirmationToken,
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

  it('blocks outbound Gemini requests when a Cloud Run reservation cannot commit', async () => {
    vi.stubEnv('K_SERVICE', 'signalyn-fixture');
    mockState.setBeforeTxHook(() => { throw new Error('quota ledger unavailable'); });

    try {
      await expect(reserveGeminiProviderRequest({
        lane: 'LIVE_ARTICLE',
        model: 'gemini-3.1-flash-lite',
      })).rejects.toMatchObject({ code: 'GEMINI_QUOTA_ACCOUNTING_UNAVAILABLE' });
      await expect(adjudicateAmbiguousPair(
        makeArticle('a1'),
        { summary: 'A', companies: [], products: [], topics: [] } as any,
        makeArticle('a2'),
        { summary: 'B', companies: [], products: [], topics: [] } as any,
        { decision: 'AMBIGUOUS', totalScore: 0.5, scores: {}, explanation: 'test' } as any,
      )).rejects.toMatchObject({ code: 'GEMINI_QUOTA_ACCOUNTING_UNAVAILABLE' });
      expect(mockState.generateContent).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('atomically serializes concurrent Firestore quota reservations across parallel workers/instances', async () => {
    resetGeminiQuotaStateForTests({
      dailyRequestBudget: 5,
      dailyReservedCapacity: 2, // Strictly 3 surplus for historical, 2 reserved for daily intelligence
    });

    // 10 concurrent Historical Backfill reservations -> strictly 3 succeed, 7 rejected
    const histResults = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        reserveGeminiProviderRequest({
          lane: 'HISTORICAL_BACKFILL',
          model: 'gemini-3.1-flash-lite',
        })
      )
    );
    const histFulfilled = histResults.filter((r) => r.status === 'fulfilled');
    const histRejected = histResults.filter((r) => r.status === 'rejected');
    expect(histFulfilled.length).toBe(3);
    expect(histRejected.length).toBe(7);

    // 6 concurrent Daily Intelligence reservations against remaining 2 budget -> strictly 2 succeed, 4 rejected
    const dailyResults = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        reserveGeminiProviderRequest({
          lane: 'DAILY_INTELLIGENCE',
          model: 'gemini-3.8-flash',
        })
      )
    );
    expect(dailyResults.filter((r) => r.status === 'fulfilled').length).toBe(2);
    expect(dailyResults.filter((r) => r.status === 'rejected').length).toBe(4);

    const status = await getGeminiQuotaStatus();
    expect(status.totalProviderRequests).toBe(5);
    expect(status.accountingMode).toBe('FIRESTORE_TRANSACTION');
    expect(status.budgetScopeLabel).toContain('Application Daily Request Budget');
    expect(status.providerQuotaNote).toContain('Google Gemini API provider quota');
  });
});

// ---------------------------------------------------------------------------
// 4. Final Pre-Publish Hardening Verification (Auth, Overlap, Races, Preview Binding, Tombstones, Brief Exclusion)
// ---------------------------------------------------------------------------
describe('Pre-Publish Cleanup Safety Hardening', () => {
  it('requireStrictAdminUser blocks unauthenticated, CSRF, API-key-only, non-admin, and fail-closed requests while allowing verified Firebase Admin users', async () => {
    const prevKey = process.env.ANALYSIS_ADMIN_KEY;
    process.env.ANALYSIS_ADMIN_KEY = 'secret-server-key-123';
    mockState.identityInitialized = true;

    const invoke = async (mw: any, headers: Record<string, string>) => {
      const req: any = { headers, ip: `10.0.0.${Math.floor(Math.random() * 200) + 1}` };
      let statusCode = 200;
      let body: any = null;
      let nextCalled = false;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: any) {
          body = payload;
          return this;
        },
      };
      await mw(req, res, () => {
        nextCalled = true;
      });
      return { statusCode, body, nextCalled, req };
    };

    try {
      // 1. Missing bearer -> 401
      const noAuth = await invoke(requireStrictAdminUser, {});
      expect(noAuth.statusCode).toBe(401);
      expect(noAuth.nextCalled).toBe(false);

      // 2. Cross-site CSRF -> 403
      const csrf = await invoke(requireStrictAdminUser, {
        'sec-fetch-site': 'cross-site',
        authorization: 'Bearer any',
      });
      expect(csrf.statusCode).toBe(403);

      // 3. ANALYSIS_ADMIN_KEY MUST be rejected on permanent cleanup (403) while accepted on standard admin middleware
      const apiKeyOnStrict = await invoke(requireStrictAdminUser, {
        authorization: 'Bearer secret-server-key-123',
      });
      expect(apiKeyOnStrict.statusCode).toBe(403);
      expect(apiKeyOnStrict.nextCalled).toBe(false);

      const apiKeyOnStandard = await invoke(requireAdminOrAuthorizedClient, {
        authorization: 'Bearer secret-server-key-123',
      });
      expect(apiKeyOnStandard.nextCalled).toBe(true);
      expect(apiKeyOnStandard.req.authMode).toBe('ADMIN_API_KEY');

      // 4. Non-admin Firebase user -> 403
      mockState.verifiedToken = {
        __raw: 'tok-regular-user',
        uid: 'uid-regular',
        email: 'viewer@example.com',
        email_verified: true,
      };
      const nonAdmin = await invoke(requireStrictAdminUser, {
        authorization: 'Bearer tok-regular-user',
      });
      expect(nonAdmin.statusCode).toBe(403);
      expect(nonAdmin.nextCalled).toBe(false);

      // 5. Uninitialized Admin SDK -> 503 fail closed
      mockState.identityInitialized = false;
      const failClosed = await invoke(requireStrictAdminUser, {
        authorization: 'Bearer tok-admin',
      });
      expect(failClosed.statusCode).toBe(503);
      expect(failClosed.nextCalled).toBe(false);

      // 6. Verified Firebase Admin owner -> passes and attaches userEmail
      mockState.identityInitialized = true;
      mockState.verifiedToken = {
        __raw: 'tok-admin',
        uid: 'uid-owner',
        email: 'nick@rainbyte.studio',
        email_verified: true,
      };
      const verifiedAdmin = await invoke(requireStrictAdminUser, {
        authorization: 'Bearer tok-admin',
      });
      expect(verifiedAdmin.nextCalled).toBe(true);
      expect(verifiedAdmin.req.userEmail).toBe('nick@rainbyte.studio');
      expect(verifiedAdmin.req.authMode).toBe('FIREBASE_ADMIN_USER');
    } finally {
      if (prevKey === undefined) delete process.env.ANALYSIS_ADMIN_KEY;
      else process.env.ANALYSIS_ADMIN_KEY = prevKey;
    }
  });

  it('blocks manual analysis, Story assignment, failure recovery, backfill, and Daily Pipeline while historical cleanup lock is active', async () => {
    await setHistoricalBackfillEnabled(true, 'nick@rainbyte.studio');
    await acquireHistoricalCleanupLease('cleanup-owner-1', 'HISTORICAL_BACKLOG_CLEANUP', 60_000);
    const pipeLock = await acquirePipelineLease('cleanup-owner-1', 'HISTORICAL_BACKLOG_CLEANUP', 60_000, false, true);
    expect(pipeLock.acquired).toBe(true);

    try {
      await expect(analyzeArticle('any-article')).rejects.toThrow('HISTORICAL_CLEANUP_ACTIVE');
      await expect(processArticleForStory('any-article')).rejects.toThrow('HISTORICAL_CLEANUP_ACTIVE');
      await expect(
        requeueRecoverableFailedArticles({ dryRun: true })
      ).rejects.toThrow('HISTORICAL_CLEANUP_ACTIVE');
      await expect(executeBackfillBatch({ batchSize: 10 })).rejects.toThrow('HISTORICAL_CLEANUP_ACTIVE');

      // Daily Pipeline cannot acquire pipelineLease while cleanup holds it
      const concurrentPipeline = await acquirePipelineLease('daily-pipeline-1', 'DAILY_INTELLIGENCE_PIPELINE', 60_000, false, true);
      expect(concurrentPipeline.acquired).toBe(false);
    } finally {
      await releaseHistoricalCleanupLease('cleanup-owner-1');
    }
  });

  it('aborts with PREVIEW_STALE_RECONFIRM_REQUIRED and 0 deletions if the eligible set drifts after preview', async () => {
    const articlesCol = mockState.getCol('articles');
    articlesCol.set('hist-1', makeArticle('hist-1', { processingStatus: 'PENDING' }));
    articlesCol.set('hist-2', makeArticle('hist-2', { processingStatus: 'PENDING' }));

    const preview = await previewHistoricalBacklogCleanup();
    expect(preview.totalEligibleForDeletion).toBe(2);

    // Drift: a new eligible article arrives after preview
    articlesCol.set('hist-3', makeArticle('hist-3', { processingStatus: 'PENDING' }));

    await expect(
      executeHistoricalBacklogCleanup({
        dryRun: false,
        confirmCleanup: true,
        previewFingerprint: preview.previewFingerprint,
        confirmationToken: preview.confirmationToken,
      })
    ).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');

    // Zero articles deleted on drift
    expect(articlesCol.size).toBe(3);
  });

  it('preserves articles cited by canonical and legacy Brief sections or as Story representatives', async () => {
    const articles = mockState.getCol('articles');
    for (const id of ['canonical-citation', 'legacy-citation', 'story-representative']) {
      articles.set(id, makeArticle(id, { processingStatus: 'FAILED' }));
    }
    mockState.getCol('dailyBriefs').set('brief', {
      en: {
        headlineDevelopments: [{ groundedCitations: [{ articleId: 'canonical-citation' }] }],
        topDevelopments: [{ groundedCitations: [{ articleId: 'legacy-citation' }] }],
      },
    });
    mockState.getCol('stories').set('story', { representativeArticleId: 'story-representative' });

    const preview = await previewHistoricalBacklogCleanup();
    expect(preview.totalEligibleForDeletion).toBe(0);
    expect(preview.protectedCounts.PROTECTED_REFERENCED_DEPENDENCY).toBe(3);
  });

  it.each(['backlog', 'failed-article'])('preserves dependencies added after planning in the %s deletion', async (mode) => {
    const articles = mockState.getCol('articles');
    const protectedIds = ['race-story', 'race-brief', 'race-review', 'race-rollup', 'race-ledger', 'race-member'];
    const requestedIds = [...protectedIds, 'safe-to-delete', 'already-gone'];
    for (const id of requestedIds) {
      articles.set(id, makeArticle(id, { processingStatus: 'FAILED', analysisError: 'Unsupported or corrupt content' }));
    }
    const historical = mode === 'backlog' ? await previewHistoricalBacklogCleanup() : undefined;
    const failed = mode === 'failed-article' ? await deleteObsoleteFailedArticles({ articleIds: requestedIds }) : undefined;
    expect(historical?.totalEligibleForDeletion ?? failed?.plannedCount).toBe(requestedIds.length);
    mockState.setBeforeTxHook((index) => {
      if (index !== (mode === 'backlog' ? 5 : 3)) return;
      mockState.getCol('stories').set('late-story', { articleIds: ['race-story'] });
      mockState.getCol('dailyBriefs').set('late-brief', { en: { headlineDevelopments: [{ groundedCitations: [{ articleId: 'race-brief' }] }] } });
      mockState.getCol('entityReview').set('late-review', { articleIds: ['race-review'] });
      mockState.getCol('analyticsDaily').set('late-rollup', { sampleArticleIds: ['race-rollup'] });
      mockState.getCol('analyticsLedger').set('late-ledger', { articleId: 'race-ledger' });
      mockState.getCol('stories/member-only/articles').set('race-member', {});
      articles.delete('already-gone');
    });

    if (historical) {
      const result = await executeHistoricalBacklogCleanup({
        dryRun: false, confirmCleanup: true, previewFingerprint: historical.previewFingerprint,
        confirmationToken: historical.confirmationToken,
      });
      expect(result).toMatchObject({ deletedCount: 1, skippedDueToConcurrentChange: 7, retainedAfterConcurrentChange: 6, missingAtExecution: 1, remainingArticlesEstimate: 6 });
    } else {
      const result = await deleteObsoleteFailedArticles({
        articleIds: requestedIds, dryRun: false, confirmDelete: true, confirmationToken: failed?.confirmationToken,
      });
      expect(result).toMatchObject({ processedCount: 1, blockedCount: 6, skippedCount: 1, affectedArticleIds: ['safe-to-delete'] });
    }
    expect([...articles.keys()]).toEqual(protectedIds);
    expect([...mockState.tombstoneItems.keys()]).toEqual(['safe-to-delete']);
    expect(mockState.generateContent).not.toHaveBeenCalled();
  });

  it('rejects a stale dependency writer and a collector retry after deletion commits', async () => {
    const article = makeArticle('removed', { canonicalUrl: 'https://example.com/obsolete' });
    const articles = mockState.getCol('articles');
    articles.set(article.id, article);
    const preview = await previewHistoricalBacklogCleanup();
    await executeHistoricalBacklogCleanup({
      dryRun: false, confirmCleanup: true, previewFingerprint: preview.previewFingerprint,
      confirmationToken: preview.confirmationToken,
    });
    const write = vi.fn();
    await expect(writeArticleDependencies(mockState.db as unknown as FirebaseFirestore.Firestore, [article.id], write))
      .rejects.toThrow('ARTICLE_DELETED_DURING_OPERATION');
    expect(write).not.toHaveBeenCalled();
    expect(await storeCollectedArticle(mockState.db as unknown as FirebaseFirestore.Firestore, article, article.updatedAt)).toBe(false);
    expect(await storeCollectedArticle(mockState.db as unknown as FirebaseFirestore.Firestore, { ...article, id: 'new-content-hash' }, article.updatedAt)).toBe(false);
    expect(articles.size).toBe(0);
  });

  it('fails closed when the collector cannot read the tombstone in its write transaction', async () => {
    const article = makeArticle('test-collector');
    mockState.setBeforeTxHook(() => { throw new Error('Firestore unavailable'); });
    await expect(storeCollectedArticle(mockState.db as unknown as FirebaseFirestore.Firestore, article, article.updatedAt)).rejects.toThrow('Firestore unavailable');
    expect(mockState.getCol('articles').size).toBe(0);
  });

  it('retains the canonical URL when another article at that URL appears before deletion', async () => {
    const article = makeArticle('remove-id', { canonicalUrl: 'https://example.com/shared-url' });
    const articles = mockState.getCol('articles');
    articles.set(article.id, article);
    const preview = await previewHistoricalBacklogCleanup();
    mockState.setBeforeTxHook((index) => {
      if (index === 5) articles.set('keep-id', { ...article, id: 'keep-id', processingStatus: 'ANALYZED' });
    });
    const result = await executeHistoricalBacklogCleanup({
      dryRun: false, confirmCleanup: true, previewFingerprint: preview.previewFingerprint,
      confirmationToken: preview.confirmationToken,
    });
    expect(result).toMatchObject({ deletedCount: 1, tombstonesWritten: 1 });
    expect(articles.has('keep-id')).toBe(true);
    expect(mockState.tombstoneItems.has(article.id)).toBe(true);
    expect(mockState.tombstoneUrls.size).toBe(0);
  });

  it('reads the same dependency fence that a server writer changes', async () => {
    const db = mockState.db as unknown as FirebaseFirestore.Firestore;
    await writeArticleDependencies(db, ['article-fence'], (transaction) => {
      transaction.set(db.collection('stories').doc('story-fence'), { articleIds: ['article-fence'] });
    });
    const fences = [...mockState.systemDocs.keys()].filter((path) => path.startsWith('system/articleDependencyFences/'));
    expect(fences).toHaveLength(1);
    const read = vi.fn(async (ref: { __path: string }) => {
      expect(ref.__path).toBe(fences[0]);
    });
    await readArticleDependencyFences(db, { get: read } as unknown as FirebaseFirestore.Transaction, ['article-fence']);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps failed articles that still require manual review out of permanent deletion', async () => {
    const articles = mockState.getCol('articles');
    articles.set('manual-review', makeArticle('manual-review', {
      processingStatus: 'FAILED', analysisError: 'Unknown failure', analysisAttemptCount: 3,
    }));
    const options = { articleIds: ['manual-review'] };
    const preview = await deleteObsoleteFailedArticles(options);
    expect(preview).toMatchObject({ plannedCount: 0, blockedCount: 1 });
    const result = await deleteObsoleteFailedArticles({
      ...options, dryRun: false, confirmDelete: true, confirmationToken: preview.confirmationToken,
    });
    expect(result.processedCount).toBe(0);
    expect(articles.has('manual-review')).toBe(true);
  });

  it('binds failed-article confirmation to the administrator and consumes it even for an unchanged empty plan', async () => {
    const options = { articleIds: ['already-gone'], executedBy: 'admin-one' };
    const preview = await deleteObsoleteFailedArticles(options);
    const execution = { ...options, dryRun: false, confirmDelete: true, confirmationToken: preview.confirmationToken };
    await expect(deleteObsoleteFailedArticles({ ...execution, executedBy: 'admin-two' })).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
    expect((await deleteObsoleteFailedArticles(execution)).processedCount).toBe(0);
    await expect(deleteObsoleteFailedArticles(execution)).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
  });

  it('binds a bounded cleanup dry-run to its own selection and administrator', async () => {
    const articles = mockState.getCol('articles');
    articles.set('a', makeArticle('a'));
    articles.set('b', makeArticle('b'));
    const options = { maxDeletions: 1, confirmedByUid: 'admin-one' };
    const preview = await executeHistoricalBacklogCleanup(options);
    expect(preview).toMatchObject({ deletedCount: 0, plannedDeletionCount: 1 });
    const execution = {
      ...options, dryRun: false, confirmCleanup: true,
      confirmationToken: preview.confirmationToken, previewFingerprint: preview.previewFingerprint,
    };
    await expect(executeHistoricalBacklogCleanup({ ...execution, confirmedByUid: 'admin-two' })).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
    expect((await executeHistoricalBacklogCleanup(execution)).deletedCount).toBe(1);
    expect([...articles.keys()]).toEqual(['b']);
  });

  it.each([undefined, '', 'false', 'TRUE', '1'])('blocks both permanent paths with deployment setting %s', async (value) => {
    const articles = mockState.getCol('articles');
    const article = makeArticle('deployment-fixture', {
      processingStatus: 'FAILED', analysisError: 'Unsupported or corrupt content',
    });
    articles.set(article.id, article);
    vi.stubEnv('SIGNALYN_ENABLE_PERMANENT_ARTICLE_DELETION', value);
    const backlogPreview = await previewHistoricalBacklogCleanup({ confirmedByUid: 'admin' });
    const backlogDryRun = await executeHistoricalBacklogCleanup({ confirmedByUid: 'admin' });
    const failedPreview = await deleteObsoleteFailedArticles({ articleIds: [article.id] });
    expect(backlogDryRun).toMatchObject({ deletedCount: 0, plannedDeletionCount: 1 });
    expect(failedPreview).toMatchObject({ processedCount: 0, plannedCount: 1 });
    const transaction = vi.fn(() => { throw new Error('Disabled requests must not start a transaction'); });
    mockState.setBeforeTxHook(transaction);

    await expect(executeHistoricalBacklogCleanup({
      dryRun: false, confirmCleanup: true, previewFingerprint: backlogPreview.previewFingerprint,
      confirmationToken: backlogPreview.confirmationToken, confirmedByUid: 'admin',
    })).rejects.toMatchObject({ code: 'PERMANENT_ARTICLE_DELETION_DISABLED' });
    await expect(deleteObsoleteFailedArticles({
      dryRun: false, confirmDelete: true, articleIds: [article.id], confirmationToken: failedPreview.confirmationToken,
    })).rejects.toMatchObject({ code: 'PERMANENT_ARTICLE_DELETION_DISABLED' });

    expect(transaction).not.toHaveBeenCalled();
    expect(mockState.previewTokens.get(backlogPreview.confirmationToken)?.consumed).toBe(false);
    expect(mockState.previewTokens.get(failedPreview.confirmationToken!)?.consumed).toBe(false);
    expect(articles.has(article.id)).toBe(true);
    expect(mockState.tombstoneItems.size).toBe(0);
    expect(mockState.generateContent).not.toHaveBeenCalled();
  });

  it('requires a persisted confirmation and rejects replay against an unchanged eligible set', async () => {
    const preview = await previewHistoricalBacklogCleanup();
    const options = { dryRun: false, confirmCleanup: true, previewFingerprint: preview.previewFingerprint };
    await expect(executeHistoricalBacklogCleanup(options)).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
    await expect(executeHistoricalBacklogCleanup({
      ...options, confirmationToken: 'cleanup-preview-00000000-0000-0000-0000-000000000000',
    })).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
    const confirmed = { ...options, confirmationToken: preview.confirmationToken };
    expect((await executeHistoricalBacklogCleanup(confirmed)).deletedCount).toBe(0);
    await expect(executeHistoricalBacklogCleanup(confirmed)).rejects.toThrow('PREVIEW_STALE_RECONFIRM_REQUIRED');
  });

  it('aborts a deletion transaction when an acquired maintenance lease has expired', async () => {
    const articles = mockState.getCol('articles');
    articles.set('hist-expired-lease', makeArticle('hist-expired-lease', { processingStatus: 'PENDING' }));
    const preview = await previewHistoricalBacklogCleanup();
    mockState.setBeforeTxHook((txNum) => {
      const lease = mockState.systemDocs.get('system/historicalCleanupLease');
      if (txNum === 5 && lease) lease.expiresAtMs = Date.now() - 1;
    });
    await expect(executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      previewFingerprint: preview.previewFingerprint,
      confirmationToken: preview.confirmationToken,
    })).rejects.toThrow('Cleanup no longer holds all maintenance leases');
    expect(articles.has('hist-expired-lease')).toBe(true);
    expect(mockState.getBatchStats().txDeleteChunkSizes).toEqual([]);
  });

  it('atomically revalidates each article inside the deletion transaction and skips articles that gain dependencies or ANALYZED status concurrently', async () => {
    const articlesCol = mockState.getCol('articles');
    const analysisCol = mockState.getCol('articleAnalysis');
    articlesCol.set('race-safe-delete', makeArticle('race-safe-delete', { processingStatus: 'PENDING' }));
    articlesCol.set('race-became-analyzed', makeArticle('race-became-analyzed', { processingStatus: 'PENDING' }));
    articlesCol.set('race-gained-analysis-doc', makeArticle('race-gained-analysis-doc', { processingStatus: 'PENDING' }));

    const preview = await previewHistoricalBacklogCleanup();
    expect(preview.totalEligibleForDeletion).toBe(3);

    // Inject concurrent mutations right before the first deletion transaction after the three locks and confirmation
    mockState.setBeforeTxHook((txNum) => {
      if (txNum === 5) {
        const flipped = articlesCol.get('race-became-analyzed');
        if (flipped) articlesCol.set('race-became-analyzed', { ...flipped, processingStatus: 'ANALYZED' });
        analysisCol.set('race-gained-analysis-doc', { articleId: 'race-gained-analysis-doc', summary: 'Just finished' });
      }
    });

    const result = await executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      previewFingerprint: preview.previewFingerprint,
      confirmationToken: preview.confirmationToken,
    });

    expect(result.deletedCount).toBe(1);
    expect(result.skippedDueToConcurrentChange).toBe(2);
    expect(articlesCol.has('race-safe-delete')).toBe(false);
    expect(articlesCol.has('race-became-analyzed')).toBe(true);
    expect(articlesCol.has('race-gained-analysis-doc')).toBe(true);
  });

  it('suppresses RSS re-collection of deleted obsolete articles via tombstones without blocking canonical URLs of retained articles', async () => {
    const articlesCol = mockState.getCol('articles');
    const retainedUrl = 'https://example.com/huawei-pura-90-flagship';
    const obsoleteUrl = 'https://example.com/rtx-5090-pc-gaming-deal';

    articlesCol.set('art-retained-canonical', makeArticle('art-retained-canonical', {
      processingStatus: 'ANALYZED',
      canonicalUrl: retainedUrl,
    }));
    articlesCol.set('art-duplicate-of-retained', makeArticle('art-duplicate-of-retained', {
      processingStatus: 'PENDING',
      canonicalUrl: retainedUrl,
    }));
    articlesCol.set('art-obsolete-oos', makeArticle('art-obsolete-oos', {
      processingStatus: 'SKIPPED_STRATEGIC_SCOPE',
      title: 'RTX 5090 Gaming PC Deal',
      canonicalUrl: obsoleteUrl,
    }));

    const preview = await previewHistoricalBacklogCleanup();
    const res = await executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      previewFingerprint: preview.previewFingerprint,
      confirmationToken: preview.confirmationToken,
    });

    expect(res.deletedCount).toBe(2);
    expect(articlesCol.has('art-retained-canonical')).toBe(true);
    expect(articlesCol.has('art-duplicate-of-retained')).toBe(false);
    expect(articlesCol.has('art-obsolete-oos')).toBe(false);

    // Obsolete article & its URL are tombstoned (RSS collector will skip re-collection)
    expect(await isDeletedArticleTombstoned(mockState.db as unknown as FirebaseFirestore.Firestore, 'art-obsolete-oos', obsoleteUrl)).toBe(true);
    expect(await isDeletedArticleTombstoned(mockState.db as unknown as FirebaseFirestore.Firestore, 'art-new-hash-same-url', obsoleteUrl)).toBe(true);

    // Canonical URL of the retained analyzed article MUST NOT be tombstoned!
    expect(await isDeletedArticleTombstoned(mockState.db as unknown as FirebaseFirestore.Firestore, 'art-retained-canonical', retainedUrl)).toBe(false);
    expect(await isDeletedArticleTombstoned(mockState.db as unknown as FirebaseFirestore.Firestore, 'art-different-id', retainedUrl)).toBe(false);
  });

  it('preserves Daily Brief-referenced non-analyzed articles, excludes them from Historical Backfill queue, and keeps remaining failure counts honest', async () => {
    const articlesCol = mockState.getCol('articles');
    const briefsCol = mockState.getCol('dailyBriefs');
    const window = getAthensReportingWindow();

    articlesCol.set('art-analyzed-1', makeArticle('art-analyzed-1', { processingStatus: 'ANALYZED' }));
    articlesCol.set('art-today-1', makeArticle('art-today-1', { processingStatus: 'PENDING', publishedAt: window.windowEndIso }));
    articlesCol.set('art-brief-pending-1', makeArticle('art-brief-pending-1', { processingStatus: 'PENDING' }));
    articlesCol.set('art-brief-pending-2', makeArticle('art-brief-pending-2', { processingStatus: 'PENDING' }));
    articlesCol.set('art-brief-failed-1', makeArticle('art-brief-failed-1', { processingStatus: 'FAILED', analysisAttemptCount: 1 }));
    articlesCol.set('art-cleanable-1', makeArticle('art-cleanable-1', { processingStatus: 'PENDING' }));

    briefsCol.set('brief-2026-11-15', {
      en: {
        headlineDevelopments: [
          { groundedArticles: ['art-brief-pending-1', 'art-brief-pending-2', 'art-brief-failed-1'] },
        ],
      },
    });

    const preview = await previewHistoricalBacklogCleanup();
    expect(preview.totalEligibleForDeletion).toBe(1);
    expect(preview.protectedCounts.PROTECTED_REFERENCED_DEPENDENCY).toBe(3);
    expect(preview.expectedRemainingInventory.preservedReferenceArticles).toBe(2);
    expect(preview.expectedRemainingInventory.actionableFailuresRemaining).toBe(1);
    expect(preview.expectedRemainingInventory.historicalFailedRemaining).toBe(1);

    const execRes = await executeHistoricalBacklogCleanup({
      dryRun: false,
      confirmCleanup: true,
      previewFingerprint: preview.previewFingerprint,
      confirmationToken: preview.confirmationToken,
    });
    expect(execRes.deletedCount).toBe(1);
    expect(execRes.briefReferencesExcludedCount).toBe(2);

    // Preserved brief-referenced PENDING articles stay PENDING (never marked ANALYZED) with backfillExcluded: true
    expect(articlesCol.get('art-brief-pending-1')?.processingStatus).toBe('PENDING');
    expect(articlesCol.get('art-brief-pending-1')?.backfillExcluded).toBe(true);
    expect(articlesCol.get('art-brief-pending-2')?.processingStatus).toBe('PENDING');
    expect(articlesCol.get('art-brief-pending-2')?.backfillExcluded).toBe(true);

    // Inventory & candidate selector exclude preserved brief references from backfill queue while keeping counts honest
    const inventory = await getBacklogInventory();
    expect(inventory.alreadyAnalyzedArticles).toBe(1);
    expect(inventory.pendingHistoricalStrategicArticles).toBe(0);
    expect(inventory.preservedReferenceArticles).toBe(2);
    expect(inventory.actionableFailedArticles).toBe(1);

    const candidates = await previewEligibleArticles(20);
    expect(candidates).toEqual([]);
  });
});

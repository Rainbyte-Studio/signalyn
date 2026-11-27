import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../src/types';

const {
  mockGetServerDb,
  mockAnalyzeArticle,
  mockProcessArticleForStory,
  mockGetPipelineLeaseStatus,
  mockIsGeminiConfigured,
} = vi.hoisted(() => ({
  mockGetServerDb: vi.fn(),
  mockAnalyzeArticle: vi.fn(),
  mockProcessArticleForStory: vi.fn(),
  mockGetPipelineLeaseStatus: vi.fn(),
  mockIsGeminiConfigured: vi.fn(),
}));

vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: mockGetServerDb,
  cleanServerData: (data: unknown) => data,
}));

vi.mock('../src/server/analysisEngine', () => ({
  analyzeArticle: mockAnalyzeArticle,
}));

vi.mock('../src/server/clustering/incrementalStoryService', () => ({
  processArticleForStory: mockProcessArticleForStory,
}));

vi.mock('../src/server/pipelineLease', () => ({
  getPipelineLeaseStatus: mockGetPipelineLeaseStatus,
}));

vi.mock('../src/server/geminiClient', () => ({
  isGeminiConfigured: mockIsGeminiConfigured,
}));

import {
  executeBackfillBatch,
  getBacklogInventory,
} from '../src/server/backfill/backfillEngine';
import {
  classifyFailedArticle,
  summarizeFailureError,
  previewFailedArticlesRecovery,
  requeueRecoverableFailedArticles,
  dismissResolvedFailedArticles,
  archiveFailedArticles,
  deleteObsoleteFailedArticles,
} from '../src/server/backfill/failedArticleRecoveryService';

interface InMemoryStore {
  articles: Map<string, Record<string, any>>;
  articleAnalysis: Map<string, Record<string, any>>;
  stories: Map<string, Record<string, any>>;
  dailyBriefs: Map<string, Record<string, any>>;
  entityReview: Map<string, Record<string, any>>;
  backfillRuns: Map<string, Record<string, any>>;
  recoveryAudits: Map<string, Record<string, any>>;
  batchLease: Record<string, any> | undefined;
}

function createInMemoryFirestore(store: InMemoryStore) {
  const leaseRef = { __type: 'lease' };

  const makeDocRef = (col: string, id: string, map: Map<string, Record<string, any>>) => ({
    __type: 'doc',
    col,
    id,
    map,
    async get() {
      const data = map.get(id);
      return { id, exists: data !== undefined, data: () => data };
    },
    async set(data: Record<string, any>) {
      map.set(id, { ...data });
    },
    async update(data: Record<string, any>) {
      const prev = map.get(id) || {};
      map.set(id, { ...prev, ...data });
    },
    async delete() {
      map.delete(id);
    },
  });

  const makeCollection = (name: string, map: Map<string, Record<string, any>>) => {
    const buildQuery = (docsFilter?: (doc: Record<string, any>) => boolean, limitVal?: number, startAfterId?: string) => ({
      where(field: string, op: string, val: any) {
        const nextFilter = (d: Record<string, any>) => {
          const prevOk = docsFilter ? docsFilter(d) : true;
          if (!prevOk) return false;
          if (op === '==') return d[field] === val;
          if (op === 'in' && Array.isArray(val)) return val.includes(d[field]);
          return true;
        };
        return buildQuery(nextFilter, limitVal, startAfterId);
      },
      limit(n: number) {
        return buildQuery(docsFilter, n, startAfterId);
      },
      startAfter(docSnap: { id: string }) {
        return buildQuery(docsFilter, limitVal, docSnap.id);
      },
      async get() {
        let entries = Array.from(map.entries());
        if (startAfterId) {
          const idx = entries.findIndex(([id]) => id === startAfterId);
          entries = idx >= 0 ? entries.slice(idx + 1) : [];
        }
        if (docsFilter) {
          entries = entries.filter(([, data]) => docsFilter(data));
        }
        if (typeof limitVal === 'number') {
          entries = entries.slice(0, limitVal);
        }
        const docs = entries.map(([id, data]) => ({
          id,
          exists: true,
          ref: makeDocRef(name, id, map),
          data: () => ({ ...data }),
        }));
        return {
          docs,
          empty: docs.length === 0,
          forEach(cb: (doc: any) => void) {
            docs.forEach(cb);
          },
        };
      },
    });

    return {
      doc: (id: string) => makeDocRef(name, id, map),
      ...buildQuery(),
    };
  };

  return {
    doc(path: string) {
      if (path === 'system/historicalBackfillBatchLease') return leaseRef;
      throw new Error(`Unexpected doc path: ${path}`);
    },
    collection(name: string) {
      if (name === 'articles') return makeCollection('articles', store.articles);
      if (name === 'articleAnalysis') return makeCollection('articleAnalysis', store.articleAnalysis);
      if (name === 'stories') return makeCollection('stories', store.stories);
      if (name === 'dailyBriefs') return makeCollection('dailyBriefs', store.dailyBriefs);
      if (name === 'entityReview') return makeCollection('entityReview', store.entityReview);
      if (name === 'system') {
        return {
          doc(docName: string) {
            return {
              collection(sub: string) {
                if (docName === 'backfillRuns' && sub === 'runs') {
                  return makeCollection('backfillRuns', store.backfillRuns);
                }
                if (docName === 'backfillRecoveryAudit' && sub === 'runs') {
                  return makeCollection('recoveryAudits', store.recoveryAudits);
                }
                throw new Error(`Unexpected system subcollection: ${docName}/${sub}`);
              },
            };
          },
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
    batch() {
      const ops: Array<() => void> = [];
      return {
        update(ref: any, data: Record<string, any>) {
          ops.push(() => {
            const prev = ref.map.get(ref.id) || {};
            ref.map.set(ref.id, { ...prev, ...data });
          });
        },
        set(ref: any, data: Record<string, any>) {
          ops.push(() => {
            ref.map.set(ref.id, { ...data });
          });
        },
        delete(ref: any) {
          ops.push(() => {
            ref.map.delete(ref.id);
          });
        },
        async commit() {
          ops.forEach((op) => op());
        },
      };
    },
    async runTransaction(fn: (tx: any) => Promise<any>) {
      const tx = {
        async get(ref: any) {
          if (ref === leaseRef) {
            return { exists: store.batchLease !== undefined, data: () => store.batchLease };
          }
          return ref.get();
        },
        set(ref: any, data: Record<string, any>) {
          if (ref === leaseRef) {
            store.batchLease = { ...data };
            return;
          }
          ref.map.set(ref.id, { ...data });
        },
        update(ref: any, data: Record<string, any>) {
          if (ref === leaseRef) {
            store.batchLease = { ...(store.batchLease || {}), ...data };
            return;
          }
          const prev = ref.map.get(ref.id) || {};
          ref.map.set(ref.id, { ...prev, ...data });
        },
        delete(ref: any) {
          if (ref === leaseRef) {
            store.batchLease = undefined;
            return;
          }
          ref.map.delete(ref.id);
        },
      };
      return fn(tx);
    },
  };
}

function makeBaseArticle(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    sourceId: 'src-1',
    sourceName: 'TechSource',
    canonicalUrl: `https://example.com/${id}`,
    title: 'Samsung Galaxy S26 smartphone camera preview',
    publishedAt: '2026-10-15T10:00:00.000Z',
    collectedAt: '2026-10-15T10:05:00.000Z',
    updatedAt: '2026-10-15T10:05:00.000Z',
    language: 'en',
    market: 'Global',
    excerpt: 'Samsung Galaxy S26 flagship smartphone camera details.',
    rawCategories: ['Smartphones'],
    contentHash: `hash-${id}`,
    processingStatus: 'FAILED',
    analysisAttemptCount: 1,
    retryEligible: false,
    analysisError: '{"error":{"code":401,"message":"API key not valid.","status":"UNAUTHENTICATED"}}',
    ...overrides,
  };
}

describe('Historical Backfill Engine Hardening & Failed Article Recovery', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      articles: new Map(),
      articleAnalysis: new Map(),
      stories: new Map(),
      dailyBriefs: new Map(),
      entityReview: new Map(),
      backfillRuns: new Map(),
      recoveryAudits: new Map(),
      batchLease: undefined,
    };
    mockGetServerDb.mockReturnValue(createInMemoryFirestore(store));
    mockGetPipelineLeaseStatus.mockResolvedValue({ active: false });
    mockIsGeminiConfigured.mockReturnValue(true);
    mockProcessArticleForStory.mockResolvedValue(undefined);
  });

  it('stops dispatching subsequent chunks immediately if the batch lease is lost mid-batch', async () => {
    for (let i = 1; i <= 4; i++) {
      store.articles.set(`art-${i}`, makeBaseArticle(`art-${i}`, { processingStatus: 'PENDING', analysisError: null }));
    }

    let calls = 0;
    mockAnalyzeArticle.mockImplementation(async (id: string) => {
      calls++;
      // Simulate lease hijacked by another worker during first chunk (concurrency 2)
      if (calls === 2) {
        store.batchLease = { owner: 'other-worker', expiresAt: Date.now() + 60_000 };
      }
      return { success: true, analysis: { articleId: id, storyId: 'story-1', storyAssignmentStatus: 'ASSIGNED' } };
    });

    await expect(executeBackfillBatch({ batchSize: 4 })).rejects.toThrow('Historical Backfill batch lease was lost.');
    // Only the first chunk (2 articles) should have been dispatched; chunk 2 must NOT run
    expect(mockAnalyzeArticle).toHaveBeenCalledTimes(2);
    // Avoid redundant duplicate story clustering when analyzeArticle already assigned story
    expect(mockProcessArticleForStory).not.toHaveBeenCalled();
  });

  it('yields and pauses cleanly mid-batch if the scheduled Daily Pipeline starts', async () => {
    for (let i = 1; i <= 4; i++) {
      store.articles.set(`art-${i}`, makeBaseArticle(`art-${i}`, { processingStatus: 'PENDING', analysisError: null }));
    }

    let leaseChecks = 0;
    mockGetPipelineLeaseStatus.mockImplementation(async () => {
      leaseChecks++;
      // Initial check + chunk 1 check: inactive; chunk 2 check: Daily Pipeline started!
      if (leaseChecks >= 3) {
        return { active: true, lease: { leaseHolder: 'cloud-scheduler-0600' } };
      }
      return { active: false };
    });

    mockAnalyzeArticle.mockResolvedValue({
      success: true,
      analysis: { articleId: 'art', storyId: 'story-1', storyAssignmentStatus: 'ASSIGNED' },
    });

    const result = await executeBackfillBatch({ batchSize: 4 });
    expect(result.yieldedToDailyPipeline).toBe(true);
    expect(result.isPaused).toBe(true);
    expect(result.isCompleted).toBe(false);
    expect(result.itemsSucceeded).toBe(2);
    expect(mockAnalyzeArticle).toHaveBeenCalledTimes(2);
  });

  it('excludes ARCHIVED_FAILED articles from active failure counts while preserving 7-category reconciliation', async () => {
    store.articles.set('a1', makeBaseArticle('a1', { processingStatus: 'ANALYZED', relevanceCategory: 'SMARTPHONE' }));
    store.articles.set('a2', makeBaseArticle('a2', { processingStatus: 'FAILED', retryEligible: false, relevanceCategory: 'SMARTPHONE' }));
    store.articles.set('a3', makeBaseArticle('a3', { processingStatus: 'ARCHIVED_FAILED', relevanceCategory: 'AUDIO' }));
    store.articles.set('a4', makeBaseArticle('a4', { processingStatus: 'PENDING', analysisError: null }));

    const inv = await getBacklogInventory();
    expect(inv.totalStoredArticles).toBe(4);
    expect(inv.alreadyAnalyzedArticles).toBe(1);
    expect(inv.permanentFailures).toBe(1);
    expect(inv.archivedFailedArticles).toBe(1);
    expect(inv.actionableFailedArticles).toBe(1);

    const categorySum = Object.values(inv.countsByCategory).reduce((a, b) => a + b, 0);
    expect(categorySum).toBe(inv.totalStoredArticles);
  });

  it('classifies failed articles accurately across all 10 categories and redacts sensitive tokens', () => {
    const context = {
      analyzedArticleIds: new Set(['already-analyzed']),
      canonicalUrlOwners: new Map([['example.com/dup', 'canonical-owner']]),
      dependenciesByArticleId: new Map(),
    };

    expect(classifyFailedArticle(makeBaseArticle('already-analyzed'), context).category).toBe(
      'ALREADY_ANALYZED_STALE_FAILURE'
    );
    expect(
      classifyFailedArticle(makeBaseArticle('auth-1', { analysisError: '401 UNAUTHENTICATED API key not valid' }), context)
        .category
    ).toBe('AUTH_ERROR_RECOVERABLE');
    expect(
      classifyFailedArticle(makeBaseArticle('quota-1', { analysisError: '429 RESOURCE_EXHAUSTED quota' }), context).category
    ).toBe('QUOTA_LIMIT_RECOVERABLE');
    expect(
      classifyFailedArticle(makeBaseArticle('transient-1', { analysisError: '503 Service Unavailable timeout' }), context)
        .category
    ).toBe('TRANSIENT_PROVIDER_RECOVERABLE');
    expect(
      classifyFailedArticle(
        makeBaseArticle('oos-1', { title: 'Best electric SUV car review 2026', excerpt: 'EV motor specs', rawCategories: ['Auto'] }),
        context
      ).category
    ).toBe('OUT_OF_SCOPE');
    expect(
      classifyFailedArticle(makeBaseArticle('dup-1', { canonicalUrl: 'https://www.example.com/dup/' }), context).category
    ).toBe('DUPLICATE_ARTICLE');
    expect(
      classifyFailedArticle(makeBaseArticle('empty-1', { title: '', excerpt: '   ' }), context).category
    ).toBe('INVALID_OR_MISSING_CONTENT');
    expect(
      classifyFailedArticle(makeBaseArticle('corrupt-1', { analysisError: '400 INVALID_ARGUMENT malformed schema' }), context)
        .category
    ).toBe('UNSUPPORTED_OR_CORRUPT');
    expect(
      classifyFailedArticle(
        makeBaseArticle('exhausted-1', { analysisAttemptCount: 3, analysisError: 'Unexpected failure' }),
        context
      ).category
    ).toBe('EXHAUSTED_RETRIES_REVIEW');
    expect(
      classifyFailedArticle(
        makeBaseArticle('other-1', { analysisAttemptCount: 1, analysisError: 'Custom provider exception' }),
        context
      ).category
    ).toBe('OTHER_PERMANENT_REVIEW');

    // Secret redaction check
    const summary = summarizeFailureError('Error with key AIzaSySecretKey1234567890 and Bearer mysecrettoken');
    expect(summary).not.toContain('AIzaSySecretKey1234567890');
    expect(summary).not.toContain('mysecrettoken');
  });

  it('blocks auth-error requeue when Gemini is unconfigured, and safely requeues with audit history when configured', async () => {
    store.articles.set('auth-ok', makeBaseArticle('auth-ok'));
    store.articles.set('already-done', makeBaseArticle('already-done'));
    store.articleAnalysis.set('already-done', { articleId: 'already-done' });

    // Unconfigured Gemini must block auth recovery
    mockIsGeminiConfigured.mockReturnValue(false);
    await expect(
      requeueRecoverableFailedArticles({ dryRun: true })
    ).rejects.toThrow('GEMINI_NOT_CONFIGURED');

    // Configured Gemini: dryRun makes zero mutations
    mockIsGeminiConfigured.mockReturnValue(true);
    const dryRes = await requeueRecoverableFailedArticles({ dryRun: true });
    expect(dryRes.processedCount).toBe(1);
    expect(dryRes.blockedCount).toBe(1);
    expect(store.articles.get('auth-ok')?.processingStatus).toBe('FAILED');

    // Confirmed execution requeues only auth-ok, preserves failure history, writes audit log
    const execRes = await requeueRecoverableFailedArticles({ dryRun: false, confirm: true, executedBy: 'admin@test' });
    expect(execRes.processedCount).toBe(1);
    expect(execRes.affectedArticleIds).toEqual(['auth-ok']);
    const updated = store.articles.get('auth-ok')!;
    expect(updated.processingStatus).toBe('PENDING');
    expect(updated.retryEligible).toBe(true);
    expect(updated.analysisAttemptCount).toBe(0);
    expect(updated.originalFailureHistory).toHaveLength(1);
    expect(updated.originalFailureHistory[0].recoveryAction).toBe('REQUEUED');
    expect(store.recoveryAudits.size).toBe(1);
    // Already-analyzed article untouched by requeue
    expect(store.articles.get('already-done')?.processingStatus).toBe('FAILED');
  });

  it('reconciles stale already-analyzed failures without Gemini calls', async () => {
    store.articles.set('stale-1', makeBaseArticle('stale-1'));
    store.articleAnalysis.set('stale-1', { articleId: 'stale-1' });

    const res = await dismissResolvedFailedArticles({ dryRun: false, confirm: true, executedBy: 'admin@test' });
    expect(res.processedCount).toBe(1);
    expect(store.articles.get('stale-1')?.processingStatus).toBe('ANALYZED');
    expect(mockAnalyzeArticle).not.toHaveBeenCalled();
  });

  it('archives failed articles non-destructively while blocking ANALYZED and PENDING articles', async () => {
    store.articles.set('fail-1', makeBaseArticle('fail-1', { processingStatus: 'FAILED' }));
    store.articles.set('analyzed-1', makeBaseArticle('analyzed-1', { processingStatus: 'ANALYZED' }));
    store.articles.set('pending-1', makeBaseArticle('pending-1', { processingStatus: 'PENDING' }));

    const res = await archiveFailedArticles({
      articleIds: ['fail-1', 'analyzed-1', 'pending-1'],
      dryRun: false,
      confirm: true,
      executedBy: 'admin@test',
    });

    expect(res.processedCount).toBe(1);
    expect(res.blockedCount).toBe(2);
    expect(store.articles.get('fail-1')?.processingStatus).toBe('ARCHIVED_FAILED');
    expect(store.articles.get('analyzed-1')?.processingStatus).toBe('ANALYZED');
    expect(store.articles.get('pending-1')?.processingStatus).toBe('PENDING');
  });

  it('strictly blocks permanent deletion of analyzed, pending, recoverable, and referenced articles', async () => {
    // 1. Protected ANALYZED
    store.articles.set('prot-analyzed', makeBaseArticle('prot-analyzed', { processingStatus: 'ANALYZED' }));
    // 2. Protected PENDING
    store.articles.set('prot-pending', makeBaseArticle('prot-pending', { processingStatus: 'PENDING' }));
    // 3. Protected recoverable auth failure
    store.articles.set('prot-recoverable', makeBaseArticle('prot-recoverable', { processingStatus: 'FAILED' }));
    // 4. Protected by Story reference
    store.articles.set(
      'prot-story-ref',
      makeBaseArticle('prot-story-ref', { processingStatus: 'FAILED', title: '', excerpt: '' })
    );
    store.stories.set('story-99', { articleIds: ['prot-story-ref'] });
    // 5. Protected by EntityReview reference
    store.articles.set(
      'prot-review-ref',
      makeBaseArticle('prot-review-ref', { processingStatus: 'FAILED', title: '', excerpt: '' })
    );
    store.entityReview.set('rev-1', { articleId: 'prot-review-ref' });
    // 6. Truly obsolete & unreferenced
    store.articles.set(
      'obsolete-ok',
      makeBaseArticle('obsolete-ok', { processingStatus: 'FAILED', title: '', excerpt: '' })
    );

    // Requires explicit confirmDelete: true
    await expect(
      deleteObsoleteFailedArticles({ articleIds: ['obsolete-ok'], dryRun: false, confirmDelete: false })
    ).rejects.toThrow('EXPLICIT_DELETE_CONFIRMATION_REQUIRED');

    const preview = await previewFailedArticlesRecovery();
    expect(preview.safeToDeleteCount).toBe(1);

    const res = await deleteObsoleteFailedArticles({
      articleIds: [
        'prot-analyzed',
        'prot-pending',
        'prot-recoverable',
        'prot-story-ref',
        'prot-review-ref',
        'obsolete-ok',
      ],
      dryRun: false,
      confirmDelete: true,
      executedBy: 'admin@test',
    });

    expect(res.processedCount).toBe(1);
    expect(res.blockedCount).toBe(5);
    expect(res.affectedArticleIds).toEqual(['obsolete-ok']);
    expect(store.articles.has('obsolete-ok')).toBe(false);
    expect(store.articles.has('prot-analyzed')).toBe(true);
    expect(store.articles.has('prot-pending')).toBe(true);
    expect(store.articles.has('prot-recoverable')).toBe(true);
    expect(store.articles.has('prot-story-ref')).toBe(true);
    expect(store.articles.has('prot-review-ref')).toBe(true);
  });
});

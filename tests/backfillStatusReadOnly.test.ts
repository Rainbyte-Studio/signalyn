import { afterEach, expect, it, vi } from 'vitest';
import {
  executeBackfillBatch,
  getBacklogInventory,
  previewEligibleArticles,
  getActiveBackfillRun,
  getHistoricalBackfillCheckpoint,
  pauseBackfill,
  resumeBackfill,
  STALE_THRESHOLD_MS,
} from '../src/server/backfill/backfillEngine';

const { generateContent, articleUpdate, getRuns, getRun, update, getPipelineLeaseStatus, getArticlePage, analyzeArticle, inventory } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  articleUpdate: vi.fn(),
  getArticlePage: vi.fn(),
  analyzeArticle: vi.fn(),
  inventory: vi.fn(),
  getRuns: vi.fn(),
  getRun: vi.fn(),
  update: vi.fn(),
  getPipelineLeaseStatus: vi.fn(),
}));

const fakeFirestore = vi.hoisted(() => {
  const lock = {};
  let lease: object | undefined;
  let pending = Promise.resolve();
  return {
    lock,
    reset: () => { lease = undefined; },
    runTransaction: (callback: (transaction: any) => unknown) => {
      const operation = pending.then(() => callback({
        get: (ref: any) => ref === lock ? { data: () => lease } : ref.get(),
        set: (_ref: unknown, value: object) => { lease = value; },
        delete: () => { lease = undefined; },
        update: (ref: any, value: object) => ref.update(value),
      }));
      pending = operation.then(() => {}, () => {});
      return operation;
    },
  };
});

vi.mock('../src/server/geminiClient', () => ({
  isGeminiConfigured: () => true,
  getGeminiClient: () => ({ models: { generateContent } }),
  GEMINI_ANALYSIS_MODEL: 'primary-fixture',
  GEMINI_FALLBACK_MODEL: 'fallback-fixture',
}));
vi.mock('../src/server/entityResolution/canonicalContextCache', () => ({
  getCanonicalContext: async () => ({ canonicalCompanies: [], canonicalProducts: [], settings: {} }),
}));
vi.mock('../src/server/analysisEngine', () => ({ analyzeArticle }));
vi.mock('../src/server/backfill/backlogCleanupEngine', () => ({ fetchArticlesForReadOnlyAudit: inventory }));
vi.mock('../src/server/pipelineLease', () => ({ getPipelineLeaseStatus }));
vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: () => ({
    doc: () => fakeFirestore.lock,
    runTransaction: fakeFirestore.runTransaction,
    collection: (name: string) => {
      if (name === 'articles') return { doc: () => ({ update: articleUpdate, get: async () => ({ exists: true, data: fixtureArticle('eligible').data }) }), limit: (limit: number) => ({
        get: () => getArticlePage(limit),
        startAfter: (doc: unknown) => ({ get: () => getArticlePage(limit, doc) }),
      }) };
      if (name === 'articleAnalysis') return { doc: () => ({ get: async () => ({ exists: false }) }) };
      return {
        doc: () => ({
          collection: () => ({
            get: getRuns,
            where: () => ({ get: getRuns }),
            doc: () => ({ get: getRun, update }),
          }),
        }),
      };
    },
  }),
  cleanServerData: (value: unknown) => value,
}));

afterEach(() => { vi.resetAllMocks(); fakeFirestore.reset(); });

it('skips stale and paused records without changing their persisted state', async () => {
  const stale = { status: 'RUNNING', updatedAt: new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString() };
  const fresh = { status: 'PAUSING', updatedAt: new Date().toISOString() };
  getRuns.mockResolvedValueOnce({ docs: [{ id: 'stale', data: () => stale }] });
  getRuns.mockResolvedValueOnce({ docs: [
    { id: 'stale', data: () => stale },
    { id: 'paused', data: () => ({ ...fresh, status: 'PAUSED' }) },
    { id: 'fresh', data: () => fresh },
  ] });

  await expect(getActiveBackfillRun()).resolves.toBeNull();
  await expect(getActiveBackfillRun()).resolves.toEqual({ runId: 'fresh', ...fresh });
  expect(update).not.toHaveBeenCalled();

  getRun.mockResolvedValue({ exists: true, data: () => ({ runId: 'stale', ...stale }) });
  await expect(pauseBackfill('stale')).resolves.toMatchObject({ status: 'PAUSED', pauseRequested: true });
  expect(update).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED', pauseRequested: true }));
});

it('propagates database read errors to the status handler', async () => {
  getRuns.mockRejectedValue(new Error('fixture unavailable'));
  await expect(getActiveBackfillRun()).rejects.toThrow('fixture unavailable');
  expect(update).not.toHaveBeenCalled();
});

it('restores a stale checkpoint without writing and resumes it explicitly with progress preserved', async () => {
  const stale = {
    runId: 'stale',
    status: 'RUNNING',
    updatedAt: new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString(),
    currentBatch: 3,
    processedArticleIds: ['article-1'],
  };
  getRuns.mockResolvedValue({ docs: [{ id: 'stale', data: () => stale }] });
  await expect(getHistoricalBackfillCheckpoint()).resolves.toEqual({ runId: 'stale', isPaused: true });
  expect(update).not.toHaveBeenCalled();

  getRun.mockResolvedValue({ exists: true, data: () => stale });
  getPipelineLeaseStatus.mockResolvedValueOnce({ active: true }).mockResolvedValueOnce({ active: false });
  await expect(resumeBackfill('stale')).rejects.toThrow('Pipeline is active');
  expect(update).not.toHaveBeenCalled();
  await expect(resumeBackfill('stale')).resolves.toMatchObject({ ...stale, status: 'RUNNING', pauseRequested: false });
  expect(update).toHaveBeenCalledExactlyOnceWith({
    status: 'RUNNING',
    pauseRequested: false,
    updatedAt: expect.any(String),
  });
});

it('does not resurrect an older run after the latest checkpoint completed', async () => {
  const docs = [
    { id: 'older', data: () => ({ status: 'PAUSED', updatedAt: '2026-11-26T00:00:00Z' }) },
    { id: 'latest', data: () => ({ status: 'COMPLETED', updatedAt: '2026-11-27T00:00:00Z' }) },
  ];
  getRuns.mockResolvedValue({ docs });
  await expect(getHistoricalBackfillCheckpoint()).resolves.toBeNull();
  expect(update).not.toHaveBeenCalled();
});

function fixtureArticle(id: string, fields: Record<string, unknown> = {}) {
  return { id, data: () => ({
    title: 'Samsung Galaxy S26 smartphone launches',
    publishedAt: '2020-01-01T12:00:00Z',
    ...fields,
  }) };
}

function fixtureRun(stage2GeminiCalls: number) {
  getPipelineLeaseStatus.mockResolvedValue({ active: false });
  getRun.mockResolvedValue({
    exists: true,
    data: () => ({
      status: 'RUNNING', currentBatch: 2, processedArticleIds: ['processed'],
      articlesAttempted: 40, articlesAnalyzed: 38, articlesFailed: 2, articlesSkipped: 0,
      stage2GeminiCalls, phase3GeminiCalls: stage2GeminiCalls, durationMs: 100,
    }),
  });
}

it('passes a page of exhausted failures and gives the same checkpoint-aware candidates to preview and execution', async () => {
  fixtureRun(39);
  const rejected = Array.from({ length: 100 }, (_, i) => fixtureArticle('exhausted-' + i, {
    processingStatus: 'FAILED', analysisAttemptCount: 3,
  }));
  const eligible = [
    fixtureArticle('processed', { processingStatus: 'PENDING' }),
    fixtureArticle('daily', { processingStatus: 'PENDING', publishedAt: new Date().toISOString() }),
    fixtureArticle('legacy'),
    fixtureArticle('next', { processingStatus: 'PENDING' }),
  ];
  getArticlePage.mockImplementation(async (_limit, cursor) => ({ docs: cursor ? eligible : rejected }));
  analyzeArticle.mockResolvedValue({ success: true });

  await expect(previewEligibleArticles(1, 'run')).resolves.toMatchObject([{ id: 'legacy' }]);
  expect(getArticlePage).toHaveBeenLastCalledWith(100, rejected[99]);
  expect(update).not.toHaveBeenCalled();
  expect(analyzeArticle).not.toHaveBeenCalled();

  await expect(executeBackfillBatch({ runId: 'run', batchSize: 20 })).resolves.toMatchObject({
    itemsProcessed: 1, geminiCallsUsed: 1, isCompleted: true, remainingEligible: 1,
  });
  expect(analyzeArticle).toHaveBeenCalledExactlyOnceWith('legacy', { trigger: 'HISTORICAL_BACKFILL' });
  expect(update).toHaveBeenCalledWith(expect.objectContaining({
    status: 'COMPLETED', articlesAttempted: 41, stage2GeminiCalls: 40,
  }));
});

it('ends an already exhausted checkpoint with an explicit message and zero attempts', async () => {
  fixtureRun(40);
  getArticlePage.mockResolvedValue({ docs: [fixtureArticle('pending', { processingStatus: 'PENDING' })] });
  const result = await executeBackfillBatch({ runId: 'run' });
  expect(result).toMatchObject({ itemsProcessed: 0, isCompleted: true, remainingEligible: 1 });
  expect(result.errors[0]).toContain('article-analysis dispatch limit');
  expect(analyzeArticle).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ articlesAttempted: 40, stage2GeminiCalls: 40 }));
});

it('keeps permanent failures separate from pending and counts retries disabled below the attempt cap', async () => {
  inventory.mockResolvedValue([
    fixtureArticle('auth-failure', { processingStatus: 'FAILED', retryEligible: false, analysisAttemptCount: 1 }),
    fixtureArticle('exhausted', { processingStatus: 'FAILED', retryEligible: true, analysisAttemptCount: 3 }),
    fixtureArticle('historic', { processingStatus: 'PENDING' }),
  ].map(({ id, data }) => ({ id, ...data() })));
  await expect(getBacklogInventory()).resolves.toMatchObject({
    permanentFailures: 2, failedArticlesEligibleForRetry: 0, pendingStrategicallyRelevantArticles: 1,
    pendingHistoricalStrategicArticles: 1,
  });
});

it('leaves out-of-scope articles untouched while processing eligible articles', async () => {
  fixtureRun(0);
  getArticlePage.mockResolvedValue({ docs: [
    fixtureArticle('unrelated', { title: 'Premier League football results', processingStatus: 'PENDING' }),
    fixtureArticle('eligible', { processingStatus: 'PENDING' }),
  ] });
  articleUpdate.mockResolvedValue(undefined);
  analyzeArticle.mockResolvedValue({ success: true });

  const result = await executeBackfillBatch({ runId: 'run', batchSize: 1 });
  expect(articleUpdate).not.toHaveBeenCalled();
  expect(result).toMatchObject({ itemsProcessed: 1, itemsSkipped: 0 });
});

it('serializes overlapping batch requests and retains a pause made during analysis', async () => {
  fixtureRun(0);
  getArticlePage.mockResolvedValue({ docs: [fixtureArticle('eligible', { processingStatus: 'PENDING' })] });
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => { finish = resolve; });
  analyzeArticle.mockImplementation(async () => {
    notifyStarted();
    await hold;
    return { success: true };
  });

  const first = executeBackfillBatch({ runId: 'run', batchSize: 1 });
  await started;
  try {
    const duplicate = executeBackfillBatch({ runId: 'run', batchSize: 1 });
    // The old implementation completes the duplicate analysis as soon as we release the mock.
    await Promise.race([duplicate.catch(() => {}), new Promise<void>((resolve) => setImmediate(resolve))]);
    expect(analyzeArticle).toHaveBeenCalledTimes(1);
    await expect(duplicate).rejects.toThrow('already running');
    getRun.mockResolvedValue({ exists: true, data: () => ({ status: 'PAUSED', pauseRequested: true }) });
  } finally {
    finish();
    await first;
  }
  await expect(first).resolves.toMatchObject({ isPaused: true, itemsSucceeded: 1 });
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'PAUSED' }));
});

it('counts one analysis dispatch even when the article analyzer calls Gemini twice', async () => {
  const actual = await vi.importActual<typeof import('../src/server/analysisEngine')>('../src/server/analysisEngine');
  fixtureRun(0);
  getArticlePage.mockResolvedValue({ docs: [fixtureArticle('eligible', { processingStatus: 'PENDING' })] });
  articleUpdate.mockResolvedValue(undefined);
  analyzeArticle.mockImplementation(actual.analyzeArticle);
  generateContent.mockRejectedValueOnce(new Error('503 overloaded'))
    .mockResolvedValueOnce({ text: '{}' });

  await expect(executeBackfillBatch({ runId: 'run', maxStage2Calls: 1 })).resolves.toMatchObject({
    geminiCallsUsed: 1, isCompleted: true,
  });
  expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual(['primary-fixture', 'fallback-fixture']);
});

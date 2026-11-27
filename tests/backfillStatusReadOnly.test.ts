import { afterEach, expect, it, vi } from 'vitest';
import {
  getActiveBackfillRun,
  getHistoricalBackfillCheckpoint,
  pauseBackfill,
  resumeBackfill,
  STALE_THRESHOLD_MS,
} from '../src/server/backfill/backfillEngine';

const { getRuns, getRun, update, getPipelineLeaseStatus } = vi.hoisted(() => ({
  getRuns: vi.fn(),
  getRun: vi.fn(),
  update: vi.fn(),
  getPipelineLeaseStatus: vi.fn(),
}));

vi.mock('../src/server/pipelineLease', () => ({ getPipelineLeaseStatus }));
vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: () => ({
    collection: () => ({ doc: () => ({
      collection: () => ({
        get: getRuns,
        where: () => ({ get: getRuns }),
        doc: () => ({ get: getRun, update }),
      }),
    }) }),
  }),
  cleanServerData: (value: unknown) => value,
}));

afterEach(() => vi.resetAllMocks());

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

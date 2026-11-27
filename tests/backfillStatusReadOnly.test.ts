import { afterEach, expect, it, vi } from 'vitest';
import { getActiveBackfillRun, pauseBackfill, STALE_THRESHOLD_MS } from '../src/server/backfill/backfillEngine';

const { getRuns, getRun, update } = vi.hoisted(() => ({
  getRuns: vi.fn(),
  getRun: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: () => ({
    collection: () => ({ doc: () => ({
      collection: () => ({ get: getRuns, doc: () => ({ get: getRun, update }) }),
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

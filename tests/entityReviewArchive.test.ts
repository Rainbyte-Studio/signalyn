import { beforeEach, expect, it, vi } from 'vitest';
import { FirestoreEntityReviewRepository } from '../src/repositories/firestore/firestoreRepositories';

const { getDocs } = vi.hoisted(() => ({ getDocs: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  getDocs,
}));
vi.mock('../src/firebase', () => ({
  db: {},
  withTimeout: (result: Promise<unknown>) => result,
}));

beforeEach(() => getDocs.mockReset());

it('includes pending reviews older than the first 20 and orders the full queue newest first', async () => {
  const docs = Array.from({ length: 24 }, (_, i) => ({
    id: `review-${i}`,
    data: () => ({
      createdAt: new Date(Date.UTC(2026, 10, i + 1)).toISOString(),
      status: i < 4 ? 'PENDING' : 'RESOLVED_EXISTING',
    }),
  }));
  getDocs.mockResolvedValue({ docs: [...docs, { id: 'legacy', data: () => ({ status: 'PENDING' }) }] });

  const reviews = await new FirestoreEntityReviewRepository().getArchive();
  expect(getDocs).toHaveBeenCalledWith('entityReview');
  expect(reviews).toHaveLength(25);
  expect(reviews[0].id).toBe('review-23');
  expect(reviews.filter((review) => review.status === 'PENDING').map((review) => review.id))
    .toEqual(['review-3', 'review-2', 'review-1', 'review-0', 'legacy']);
});

it('propagates read failures distinctly from an empty queue', async () => {
  const repository = new FirestoreEntityReviewRepository();
  getDocs.mockResolvedValueOnce({ docs: [] }).mockRejectedValueOnce(new Error('fixture unavailable'));
  await expect(repository.getArchive()).resolves.toEqual([]);
  await expect(repository.getArchive()).rejects.toThrow('fixture unavailable');
});

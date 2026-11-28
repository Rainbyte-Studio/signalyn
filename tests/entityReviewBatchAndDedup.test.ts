import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityReview } from '../src/types';

const { mockGetServerDb } = vi.hoisted(() => ({
  mockGetServerDb: vi.fn(),
}));

vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: mockGetServerDb,
  cleanServerData: (data: unknown) => data,
}));

import {
  recordEntityReview,
  batchLinkEntityReviews,
  batchDismissEntityReviews,
} from '../src/server/entityResolution/entityReviewService';
import { deriveEntityFamilyGroupKey } from '../src/services/entityReviewClientService';

function createMockReviewDb() {
  const reviews = new Map<string, Record<string, any>>();
  const companies = new Map<string, Record<string, any>>();
  const products = new Map<string, Record<string, any>>();

  companies.set('comp-samsung', {
    id: 'comp-samsung',
    name: 'Samsung',
    aliases: [],
    active: true,
  });

  const makeDocRef = (map: Map<string, Record<string, any>>, id: string) => ({
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
  });

  const system = new Map<string, Record<string, any>>();
  const db = {
    doc: (path: string) => makeDocRef(system, path),
    runTransaction: async (run: (transaction: any) => Promise<unknown>) => {
      const writes: Array<() => Promise<void>> = [];
      const result = await run({
        get: (ref: any) => ref.get(),
        set: (ref: any, data: any) => writes.push(() => ref.set(data)),
        update: (ref: any, data: any) => writes.push(() => ref.update(data)),
      });
      for (const write of writes) await write();
      return result;
    },
    collection(name: string) {
      if (name === 'system') return { doc: () => ({ collection: () => ({ doc: (id: string) => makeDocRef(system, id) }) }) };
      const map = name === 'entityReview' ? reviews : name === 'companies' ? companies : products;
      return {
        doc: (id: string) => makeDocRef(map, id),
        where(field: string, op: string, val: any) {
          return {
            async get() {
              const docs = Array.from(map.entries())
                .filter(([, data]) => (op === '==' ? data[field] === val : false))
                .map(([id, data]) => ({
                  id,
                  exists: true,
                  ref: makeDocRef(map, id),
                  data: () => ({ ...data }),
                }));
              return { docs, empty: docs.length === 0 };
            },
          };
        },
        async get() {
          const docs = Array.from(map.entries()).map(([id, data]) => ({
            id,
            exists: true,
            ref: makeDocRef(map, id),
            data: () => ({ ...data }),
          }));
          return { docs, empty: docs.length === 0 };
        },
      };
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
        async commit() {
          ops.forEach((op) => op());
        },
      };
    },
  };

  return { db, reviews, companies, products };
}

describe('Entity Reviews Deduplication, Grouping, and Batch Resolution', () => {
  let reviews: Map<string, Record<string, any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockReviewDb();
    reviews = mock.reviews;
    mockGetServerDb.mockReturnValue(mock.db);
  });

  it('prevents cross-category duplicate pending reviews for the same normalized product', async () => {
    const firstId = await recordEntityReview({
      entityType: 'PRODUCT',
      detectedName: 'Apple Vision Pro',
      category: 'OTHER',
      confidence: 0.78,
      articleId: 'art-1',
      articleTitle: 'Apple Vision Pro update',
    });

    const secondId = await recordEntityReview({
      entityType: 'PRODUCT',
      detectedName: 'Apple Vision Pro',
      category: 'WEARABLE',
      confidence: 0.91,
      articleId: 'art-2',
      articleTitle: 'Apple Vision Pro wearable headset report',
    });

    // Must reuse the existing review document instead of creating a duplicate under rev-prod-wearable-*
    expect(secondId).toBe(firstId);
    expect(reviews.size).toBe(1);
    const saved = reviews.get(firstId)!;
    expect(saved.occurrences).toBe(2);
    expect(saved.articleIds).toEqual(['art-1', 'art-2']);
    // Upgrades vague OTHER category to specific WEARABLE category
    expect(saved.category).toBe('WEARABLE');
  });

  it('does not recreate a pending review when the same entity was already dismissed under another category', async () => {
    const firstId = await recordEntityReview({
      entityType: 'PRODUCT',
      detectedName: 'Apple TV 4K',
      category: 'OTHER',
      confidence: 0.85,
      articleId: 'art-1',
      articleTitle: 'Apple TV 4K specs',
    });

    // Dismiss it
    await batchDismissEntityReviews([firstId], { reason: 'NON_HARDWARE_MEDIA_BOX', confirmed: true });
    expect(reviews.get(firstId)?.status).toBe('DISMISSED_NON_STRATEGIC');

    // Attempt to record again under a different category
    const secondId = await recordEntityReview({
      entityType: 'PRODUCT',
      detectedName: 'Apple TV 4K',
      category: 'SMART_HOME',
      confidence: 0.88,
      articleId: 'art-2',
      articleTitle: 'Apple TV 4K streaming box',
    });

    expect(secondId).toBe(firstId);
    expect(reviews.size).toBe(1);
    expect(reviews.get(firstId)?.status).toBe('DISMISSED_NON_STRATEGIC');
  });

  it('requires explicit confirmation for batch link and batch dismiss and preserves audit metadata', async () => {
    reviews.set('rev-1', {
      id: 'rev-1',
      type: 'COMPANY',
      detectedName: 'Samsung Electronics',
      status: 'PENDING',
    });
    reviews.set('rev-2', {
      id: 'rev-2',
      type: 'COMPANY',
      detectedName: 'Samsung Mobile',
      status: 'PENDING',
    });
    reviews.set('rev-unselected', {
      id: 'rev-unselected',
      type: 'COMPANY',
      detectedName: 'Uncertain Org',
      status: 'PENDING',
    });

    await expect(
      batchLinkEntityReviews(['rev-1', 'rev-2'], {
        canonicalId: 'comp-samsung',
        canonicalName: 'Samsung',
        entityType: 'COMPANY',
        confirmed: false,
      })
    ).rejects.toThrow('Explicit administrator confirmation');

    const linkRes = await batchLinkEntityReviews(['rev-1', 'rev-2'], {
      canonicalId: 'comp-samsung',
      canonicalName: 'Samsung',
      entityType: 'COMPANY',
      confirmed: true,
    });

    expect(linkRes.linkedIds).toEqual(['rev-1', 'rev-2']);
    expect(reviews.get('rev-1')?.status).toBe('RESOLVED_EXISTING');
    expect(reviews.get('rev-2')?.status).toBe('RESOLVED_EXISTING');
    expect(reviews.get('rev-1')?.resolutionMethod).toBe('MANUAL_LINK');
    // Unselected review must remain untouched
    expect(reviews.get('rev-unselected')?.status).toBe('PENDING');

    await expect(
      batchDismissEntityReviews(['rev-unselected'], { confirmed: false })
    ).rejects.toThrow('Explicit administrator confirmation');

    const dismissRes = await batchDismissEntityReviews(['rev-unselected'], {
      reason: 'OUT_OF_SCOPE_ORG',
      confirmed: true,
    });
    expect(dismissRes.dismissedIds).toEqual(['rev-unselected']);
    expect(reviews.get('rev-unselected')?.status).toBe('DISMISSED_NON_STRATEGIC');
    expect(reviews.get('rev-unselected')?.nonStrategicReason).toBe('OUT_OF_SCOPE_ORG');
  });

  it('groups entities deterministically by brand and product family', () => {
    const sampleProduct = {
      id: 'r1',
      type: 'PRODUCT',
      detectedName: 'Samsung Galaxy S26 Ultra',
      articleId: 'a1',
      articleTitle: 'Title',
      confidence: 0.9,
      status: 'PENDING',
      createdAt: '2026-11-27T00:00:00Z',
    } as EntityReview;

    const sampleCompany = {
      id: 'r2',
      type: 'COMPANY',
      detectedName: 'Foxconn Industrial Internet',
      articleId: 'a2',
      articleTitle: 'Title',
      confidence: 0.8,
      status: 'PENDING',
      createdAt: '2026-11-27T00:00:00Z',
    } as EntityReview;

    expect(deriveEntityFamilyGroupKey(sampleProduct)).toBe('Samsung Galaxy');
    expect(deriveEntityFamilyGroupKey(sampleCompany)).toBe('FOXCONN');
  });
});

import { expect, it, vi } from 'vitest';
import { generateDailyBrief } from '../src/server/dailyBriefGenerator';

const { set } = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock('../src/server/geminiClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/server/geminiClient')>(),
  isGeminiConfigured: () => false,
}));
vi.mock('../src/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDoc: async () => ({ exists: () => false }),
  getDocs: async () => ({ forEach: () => {} }),
}));
vi.mock('../src/server/serverFirestoreAdapter', () => ({
  cleanServerData: (value: unknown) => value,
  getServerDb: () => ({
    doc: () => ({}),
    runTransaction: async (run: (transaction: any) => Promise<void>) => {
      const writes: Array<() => void> = [];
      await run({
        get: (ref: any) => ref.get(),
        set: (ref: any, data: unknown) => {
          if (ref.set) writes.push(() => ref.set(data));
        },
      });
      writes.forEach((write) => write());
    },
    collection(name: string) {
      if (name === 'system') {
        return { doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) };
      }
      const article = {
        id: 'fixture-ipad',
        title: 'Apple foldable iPad',
        publishedAt: '2026-11-27T12:00:00Z',
        canonicalUrl: 'https://example.invalid/ipad',
        sourceId: 'fixture-source',
        sourceName: 'Fixture',
        processingStatus: 'FAILED',
      };
      const docs = name === 'articles' ? [{ data: () => article }] : [];
      const query = {
        orderBy: () => query,
        where: () => query,
        limit: () => query,
        get: async () => ({ docs, empty: !docs.length, forEach: docs.forEach.bind(docs) }),
        doc: () => ({ get: async () => ({ exists: false }), set }),
      };
      return query;
    },
  }),
}));

it('reports a cited but failed article consistently in both versions and in the saved brief', async () => {
  const brief = await generateDailyBrief({ dateStr: '2026-11-27', forceRegenerate: true });
  expect(brief.status).toBe('PARTIAL');
  expect(brief.groundingMetrics).toMatchObject({
    strategicallyRelevantArticles: 1,
    successfullyAnalyzedRelevantArticles: 0,
    pendingRelevantArticlesCount: 0,
    failedArticlesCount: 1,
  });
  expect(brief.en.executiveSummary).toEqual(expect.arrayContaining([
    expect.stringContaining('0 completed, 0 pending, 1 failed'),
    expect.stringContaining('articles covered in this 24-hour brief: 1'),
  ]));
  expect(brief.el?.executiveSummary).toEqual(expect.arrayContaining([
    expect.stringContaining('0 ολοκληρωμένες, 0 σε εκκρεμότητα, 1 αποτυχημένες'),
    expect.stringContaining('άρθρα που καλύπτει η 24ωρη αναφορά: 1'),
  ]));
  expect(set).toHaveBeenCalledExactlyOnceWith(brief);
});

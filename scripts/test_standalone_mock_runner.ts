/**
 * Verification of Standalone Migration Entrypoint with Mock Firestore
 */
import { runStoryIntelligenceMigrationJob } from '../src/server/migration/storyIntelligenceJob';
import { Story } from '../src/types';

async function testMockStandalone() {
  console.log('Testing standalone entrypoint against mocked Firestore credentials and fixtures...');
  
  const mockStories: Story[] = [
    {
      id: 'story-cluster-114cb574c81dbf00',
      canonicalTitle: 'Xiaomi Poco C95 Pro Official Launch',
      category: 'SMARTPHONE',
      status: 'ACTIVE',
      lifecycleState: 'STABLE',
      articleIds: ['art-1'],
      primaryCompanyId: 'comp-xiaomi',
      updatedAt: '2026-03-01T10:00:00Z',
      createdAt: '2026-03-01T08:00:00Z',
    } as unknown as Story,
  ];

  const storyStore = new Map<string, any>([
    ['story-cluster-114cb574c81dbf00', mockStories[0]],
  ]);
  const manifestStore = new Map<string, any>();
  const articleStore = new Map<string, any>([
    ['art-1', { id: 'art-1', title: 'Launch', url: 'https://mi.com/p', sourceDomain: 'mi.com' }],
  ]);
  const analysisStore = new Map<string, any>([
    ['art-1', { articleId: 'art-1', newsType: 'PRODUCT_LAUNCH', isOfficialAnnouncement: true, confidence: 0.95 }],
  ]);

  const mockDb: any = {
    collection: (name: string) => {
      const store = name === '_story_intelligence_migration_manifests' ? manifestStore : 
                    name === 'articles' ? articleStore :
                    name === 'articleAnalysis' ? analysisStore : storyStore;
      return {
        where: () => mockDb.collection(name),
        orderBy: () => mockDb.collection(name),
        limit: () => mockDb.collection(name),
        get: async () => ({
          empty: store.size === 0,
          docs: Array.from(store.entries()).map(([id, data]) => ({ id, exists: true, data: () => ({ ...data }) })),
          forEach: (cb: (doc: any) => void) => {
            for (const [id, data] of store.entries()) cb({ id, data: () => ({ ...data }) });
          },
        }),
        doc: (id: string) => ({
          id,
          get: async () => ({ id, exists: store.has(id), data: () => store.get(id) }),
          set: async (d: any) => { store.set(id, d); },
          update: async (d: any) => { store.set(id, { ...store.get(id), ...d }); },
        }),
      };
    },
    batch: () => ({
      update: (ref: any, data: any) => ref.update(data),
      commit: async () => {},
    }),
    runTransaction: async (fn: any) => fn({
      get: async (ref: any) => ref.get(),
      update: (ref: any, data: any) => ref.update(data),
    }),
  };

  const result = await runStoryIntelligenceMigrationJob({
    mode: 'DRY_RUN',
    customDb: mockDb,
    executedBy: 'mock-test-runner',
  });

  console.log('Mock Standalone Result:', JSON.stringify({
    runId: result.runId,
    mode: result.mode,
    status: result.status,
    totalEvaluated: result.totalEvaluated,
    totalMutated: result.totalMutated,
    proposalsCount: result.proposals.length,
  }, null, 2));

  if (result.status !== 'DRY_RUN_COMPLETED' || result.totalEvaluated !== 1) {
    throw new Error('Standalone mock execution failed validation');
  }
  console.log('✓ Mock Standalone Runner: Verified successfully!');
}

testMockStandalone().catch((err) => {
  console.error('✗ Mock Standalone Runner Failed:', err);
  process.exit(1);
});

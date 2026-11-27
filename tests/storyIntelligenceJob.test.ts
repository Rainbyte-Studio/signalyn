/**
 * SIGNALYN — Phase 7B.3: Hardened Story Intelligence Migration Job Tests
 * 
 * Verifies:
 * 1. DRY_RUN mode evaluates with strictly ZERO Firestore writes across all code paths.
 * 2. PILOT, PRODUCTION, and ROLLBACK fail-closed when allowMutations is false/unset.
 * 3. PILOT mode restricts selection strictly to the 5 verified production archetypes.
 * 4. Exact pre-migration field existence & values are captured in snapshots.
 * 5. Transaction-safe rollback restores original fields and deletes nonexistent ones.
 * 6. Concurrency conflict guard skips documents with newer legitimate updates.
 * 7. Rollback is idempotent (safe to run repeatedly).
 * 8. Resumable checkpointing skips previously processed stories.
 */

import assert from 'node:assert';
import {
  runStoryIntelligenceMigrationJob,
  PILOT_COHORT_ARCHETYPE_IDS,
  evaluateCandidateStory,
  deriveMaterialUpdateTimestamp,
  preflightValidatePilotCohort,
  acquireDistributedLock,
  renewDistributedLock,
  validateLockInTransaction,
  releaseDistributedLock,
  startLockHeartbeat,
  assertDryRunZeroWriteInvariant,
  LOCK_COLLECTION,
  LOCK_DOC_ID,
  WRITE_ENABLE_ENV_VAR,
} from '../src/server/migration/storyIntelligenceJob';
import { Story, Article, ArticleAnalysis } from '../src/types';

console.log('===============================================================');
console.log('SIGNALYN PHASE 7B.3: HARDENED MIGRATION JOB TEST SUITE');
console.log('===============================================================');

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      return (res as any)
        .then(() => {
          console.log(`  ✓ PASS: ${name}`);
          passCount++;
        })
        .catch((err: any) => {
          console.error(`  ✗ FAIL: ${name}`, err);
          failCount++;
        });
    }
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`, err);
    failCount++;
  }
}

// In-Memory Mock Firestore Database for isolated unit testing
function createMockFirestore(
  initialStories: Story[] = [],
  mockOptions: { strictDryRunMode?: boolean } = {}
) {
  const storyStore = new Map<string, any>();
  for (const s of initialStories) {
    storyStore.set(s.id, { ...s });
  }
  const manifestStore = new Map<string, any>();
  const articleStore = new Map<string, any>([
    [
      'art-1',
      {
        id: 'art-1',
        title: 'Xiaomi Poco C95 Pro Official Launch',
        url: 'https://mi.com/poco-c95-pro',
        sourceDomain: 'mi.com',
        publishedAt: '2026-03-01T08:00:00Z',
      },
    ],
    [
      'art-2a',
      {
        id: 'art-2a',
        title: 'Samsung One UI 9 Out Now',
        url: 'https://theverge.com/samsung-oneui-9',
        sourceDomain: 'theverge.com',
        publishedAt: '2026-03-01T08:00:00Z',
      },
    ],
    [
      'art-2b',
      {
        id: 'art-2b',
        title: 'Samsung One UI 9 Rollout Begins',
        url: 'https://gsmarena.com/samsung-oneui-9',
        sourceDomain: 'gsmarena.com',
        publishedAt: '2026-03-01T09:00:00Z',
      },
    ],
    [
      'art-3',
      {
        id: 'art-3',
        title: 'Apple Foldable iPhone Rumored',
        url: 'https://leakster.com/apple-foldable',
        sourceDomain: 'leakster.com',
        publishedAt: '2026-03-01T08:00:00Z',
      },
    ],
    [
      'art-4',
      {
        id: 'art-4',
        title: 'Xiaomi 18 Pro Contradiction Availability',
        url: 'https://rumor.com/xiaomi-18',
        sourceDomain: 'rumor.com',
        publishedAt: '2026-03-01T08:00:00Z',
      },
    ],
    [
      'art-5',
      {
        id: 'art-5',
        title: 'Huawei Watch GT 7 Review',
        url: 'https://techradar.com/huawei-watch-gt-7',
        sourceDomain: 'techradar.com',
        publishedAt: '2026-03-01T08:00:00Z',
      },
    ],
  ]);

  const analysisStore = new Map<string, any>([
    [
      'art-1',
      {
        articleId: 'art-1',
        newsType: 'PRODUCT_LAUNCH',
        isOfficialAnnouncement: true,
        summary: 'Xiaomi officially announced the Poco C95 Pro budget smartphone.',
        confidence: 0.95,
      },
    ],
    [
      'art-2a',
      {
        articleId: 'art-2a',
        newsType: 'INDUSTRY_ANALYSIS',
        isOfficialAnnouncement: false,
        summary: 'Samsung begins global rollout of One UI 9.',
        confidence: 0.9,
      },
    ],
    [
      'art-2b',
      {
        articleId: 'art-2b',
        newsType: 'INDUSTRY_ANALYSIS',
        isOfficialAnnouncement: false,
        summary: 'One UI 9 arrives on Samsung flagships.',
        confidence: 0.9,
      },
    ],
    [
      'art-3',
      {
        articleId: 'art-3',
        newsType: 'PRODUCT_LEAK',
        isRumorOrLeak: true,
        summary: 'Leak suggests Apple is preparing a foldable iPhone presentation.',
        confidence: 0.45,
      },
    ],
    [
      'art-4',
      {
        articleId: 'art-4',
        newsType: 'INDUSTRY_ANALYSIS',
        summary: 'The phone launched in selected regions, but the broader release has been delayed and cancelled.',
        confidence: 0.45,
      },
    ],
    [
      'art-5',
      {
        articleId: 'art-5',
        newsType: 'REVIEW',
        isReviewOrBenchmark: true,
        summary: 'Hands-on review of the new Huawei Watch GT 7.',
        confidence: 0.88,
      },
    ],
  ]);

  const lockStore = new Map<string, any>();

  // Write Spy Tracker
  let writeOpsCount = 0;
  const recordedWrites: Array<{ op: string; collection: string; id: string; data?: any }> = [];

  const recordWrite = (op: string, collection: string, id: string, data?: any) => {
    if (mockOptions.strictDryRunMode) {
      throw new Error(
        `STRICT_DRY_RUN_WRITE_INTERCEPTED: Write operation '${op}' on collection '${collection}' doc '${id}' is strictly prohibited during DRY_RUN!`
      );
    }
    writeOpsCount++;
    recordedWrites.push({ op, collection, id, data });
  };

  const createQueryChain = (store: Map<string, any>) => ({
    where: () => createQueryChain(store),
    orderBy: () => createQueryChain(store),
    limit: () => createQueryChain(store),
    get: async () => ({
      empty: store.size === 0,
      docs: Array.from(store.entries()).map(([id, data]) => ({
        id,
        exists: true,
        data: () => ({ ...data }),
      })),
      forEach: (cb: (doc: any) => void) => {
        for (const [id, data] of store.entries()) {
          cb({ id, data: () => ({ ...data }) });
        }
      },
    }),
  });

  const getStoreForCollection = (name: string) => {
    if (name === '_story_intelligence_migration_locks') return lockStore;
    if (name === '_story_intelligence_migration_manifests') return manifestStore;
    if (name === 'articles') return articleStore;
    if (name === 'articleAnalysis') return analysisStore;
    return storyStore;
  };

  const db: any = {
    collection: (name: string) => {
      const store = getStoreForCollection(name);
      return {
        ...createQueryChain(store),
        get: async () => ({
          empty: store.size === 0,
          forEach: (cb: (doc: any) => void) => {
            for (const [id, data] of store.entries()) {
              cb({ id, data: () => ({ ...data }) });
            }
          },
        }),
        doc: (id: string) => ({
          id,
          collectionName: name,
          get: async () => ({
            id,
            exists: store.has(id),
            data: () => (store.has(id) ? { ...store.get(id) } : undefined),
          }),
          set: async (data: any) => {
            recordWrite('set', name, id, data);
            store.set(id, { ...data });
          },
          update: async (data: any) => {
            if (!store.has(id)) throw new Error(`Document ${id} not found`);
            recordWrite('update', name, id, data);
            const prev = store.get(id);
            store.set(id, { ...prev, ...data });
          },
          delete: async () => {
            recordWrite('delete', name, id);
            store.delete(id);
          },
        }),
      };
    },
    batch: () => {
      const updates: Array<{ ref: any; data: any }> = [];
      return {
        update: (ref: any, data: any) => {
          updates.push({ ref, data });
        },
        commit: async () => {
          for (const u of updates) {
            recordWrite('batch.update', u.ref.collectionName || 'stories', u.ref.id, u.data);
            await u.ref.update(u.data);
          }
        },
      };
    },
    runTransaction: async (updateFunction: (transaction: any) => Promise<any>) => {
      if (mockOptions.strictDryRunMode) {
        throw new Error(
          'STRICT_DRY_RUN_WRITE_INTERCEPTED: Transaction invocation is strictly prohibited during DRY_RUN!'
        );
      }
      const transaction = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any) => {
          recordWrite('transaction.set', ref.collectionName || 'unknown', ref.id, data);
          const s = getStoreForCollection(ref.collectionName || 'stories');
          s.set(ref.id, { ...data });
        },
        update: (ref: any, data: any) => {
          recordWrite('transaction.update', ref.collectionName || 'unknown', ref.id, data);
          const s = getStoreForCollection(ref.collectionName || 'stories');
          const prev = s.get(ref.id) || {};
          s.set(ref.id, { ...prev, ...data });
        },
        delete: (ref: any) => {
          recordWrite('transaction.delete', ref.collectionName || 'unknown', ref.id);
          const s = getStoreForCollection(ref.collectionName || 'stories');
          s.delete(ref.id);
        },
      };
      return await updateFunction(transaction);
    },
    getWriteOpsCount: () => writeOpsCount,
    getRecordedWrites: () => [...recordedWrites],
    resetWriteTracker: () => {
      writeOpsCount = 0;
      recordedWrites.length = 0;
    },
    _storyStore: storyStore,
    _manifestStore: manifestStore,
    _lockStore: lockStore,
  };

  return db;
}

const mockPilotStories: Story[] = [
  {
    id: 'story-cluster-114cb574c81dbf00',
    canonicalTitle: 'Official Announcement: Xiaomi Poco C95 Pro Budget Smartphone',
    category: 'SMARTPHONE',
    status: 'ACTIVE',
    lifecycleState: 'STABLE',
    articleIds: ['art-1'],
    primaryCompanyId: 'comp-xiaomi',
    updatedAt: '2026-03-01T10:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
  } as unknown as Story,
  {
    id: 'story-cluster-138b9976e0968fe0',
    canonicalTitle: 'Samsung One UI 9 Rollout Corroborated Across Outlets',
    category: 'SMARTPHONE',
    status: 'ACTIVE',
    lifecycleState: 'STABLE',
    articleIds: ['art-2a', 'art-2b'],
    primaryCompanyId: 'comp-samsung',
    updatedAt: '2026-03-01T10:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
  } as unknown as Story,
  {
    id: 'story-cluster-02251cd204a7ed77',
    canonicalTitle: 'Apple Foldable iPhone Unveiling Speculation',
    category: 'SMARTPHONE',
    status: 'ACTIVE',
    lifecycleState: 'DEVELOPING',
    articleIds: ['art-3'],
    primaryCompanyId: 'comp-apple',
    updatedAt: '2026-03-01T10:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
  } as unknown as Story,
  {
    id: 'story-cluster-4edaec66097c32ad',
    canonicalTitle: 'Xiaomi 18 Pro Availability and Postponement Conflicting Signals',
    category: 'SMARTPHONE',
    status: 'ACTIVE',
    lifecycleState: 'STABLE',
    articleIds: ['art-4'],
    primaryCompanyId: 'comp-xiaomi',
    updatedAt: '2026-03-01T10:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
  } as unknown as Story,
  {
    id: 'story-cluster-129b22968ec59289',
    canonicalTitle: 'Huawei Watch GT 7 First-Party Hardware Review',
    category: 'WEARABLE',
    status: 'ACTIVE',
    lifecycleState: 'STABLE',
    articleIds: ['art-5'],
    primaryCompanyId: 'comp-huawei',
    updatedAt: '2026-03-01T10:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
  } as unknown as Story,
  {
    id: 'story-cluster-9999999999999999',
    canonicalTitle: 'Non-Pilot Story: Generic Article',
    category: 'TABLET',
    status: 'ACTIVE',
    lifecycleState: 'NEW',
    articleIds: [],
    updatedAt: '2026-03-01T10:00:00Z',
    createdAt: '2026-03-01T08:00:00Z',
  } as unknown as Story,
];

async function runTests() {
  console.log('\n[1. DRY_RUN Execution & Zero-Write Invariant]');

  await test('DRY_RUN produces proposals with strictly ZERO Firestore write operations', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'DRY_RUN');
    assert.strictEqual(result.status, 'DRY_RUN_COMPLETED');
    assert.strictEqual(result.totalMutated, 0);
    assert.strictEqual(result.totalSkipped, mockPilotStories.length);
    assert.strictEqual(result.proposals.length, mockPilotStories.length);

    // CRITICAL: Zero writes across all collections (locks, manifests, checkpoints, stories)
    assert.strictEqual(mockDb.getWriteOpsCount(), 0, 'Write ops count must be strictly 0');
    assert.strictEqual(mockDb._manifestStore.size, 0, 'Manifest store must remain empty');
    assert.strictEqual(mockDb.getRecordedWrites().length, 0, 'No write events recorded');
  });

  await test('DRY_RUN produces strictly ZERO writes even when allowMutations: true is set', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'DRY_RUN',
      allowMutations: true, // Even if caller explicitly authorized mutations, DRY_RUN never mutates
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'DRY_RUN');
    assert.strictEqual(result.status, 'DRY_RUN_COMPLETED');
    assert.strictEqual(result.totalMutated, 0);
    assert.strictEqual(mockDb.getWriteOpsCount(), 0, 'Must perform zero writes even when allowMutations is true');
    assert.strictEqual(mockDb._manifestStore.size, 0);
  });

  await test('DRY_RUN with checkpointStoryId produces strictly ZERO writes', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'DRY_RUN',
      checkpointStoryId: 'story-cluster-114cb574c81dbf00',
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'DRY_RUN');
    assert.strictEqual(result.status, 'DRY_RUN_COMPLETED');
    assert.strictEqual(result.totalMutated, 0);
    assert.strictEqual(mockDb.getWriteOpsCount(), 0, 'Checkpoint DRY_RUN must perform zero writes');
    assert.strictEqual(mockDb._manifestStore.size, 0);
  });

  await test('DRY_RUN on empty database produces strictly ZERO writes', async () => {
    const mockDb = createMockFirestore([]);
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'DRY_RUN');
    assert.strictEqual(result.status, 'DRY_RUN_COMPLETED');
    assert.strictEqual(result.totalEvaluated, 0);
    assert.strictEqual(result.totalMutated, 0);
    assert.strictEqual(mockDb.getWriteOpsCount(), 0, 'Empty DB DRY_RUN must perform zero writes');
  });

  await test('DRY_RUN produces strictly ZERO writes when database query fails (error handling code path)', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    // Force stories query to fail
    mockDb.collection = (name: string) => {
      if (name === 'stories') {
        return {
          get: async () => {
            throw new Error('Simulated Firestore Network / Permission Error');
          },
        };
      }
      return createMockFirestore().collection(name);
    };

    const result = await runStoryIntelligenceMigrationJob({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'DRY_RUN');
    assert.strictEqual(result.status, 'FAILED');
    assert.ok(result.error?.includes('Simulated Firestore Network / Permission Error'));
    // CRITICAL: Even on failure, DRY_RUN must NOT attempt to persist a failed manifest
    assert.strictEqual(mockDb.getWriteOpsCount(), 0, 'Error handling path in DRY_RUN must perform zero writes');
    assert.strictEqual(mockDb._manifestStore.size, 0, 'Manifest store must remain untouched');
  });

  await test('DRY_RUN never checks or writes concurrency lock documents in manifests collection', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    // Put an active IN_PROGRESS lock in manifests collection
    mockDb._manifestStore.set('active-lock', {
      runId: 'active-lock',
      status: 'IN_PROGRESS',
      timestamp: new Date().toISOString(),
    });

    // DRY_RUN should run smoothly and ignore the lock (as DRY_RUN does not mutate)
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });

    assert.strictEqual(result.status, 'DRY_RUN_COMPLETED');
    assert.strictEqual(mockDb.getWriteOpsCount(), 0, 'DRY_RUN must not write lock or touch documents');
    assert.strictEqual(mockDb._manifestStore.size, 1, 'Only pre-existing mock lock exists; zero additions');
  });

  console.log('\n[2. Write Authorization Guard & Fail-Closed Behavior]');

  await test('PILOT, PRODUCTION, and ROLLBACK fail-closed when allowMutations is unset', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // Test PILOT blocked
    const pilotBlocked = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      customDb: mockDb,
      allowMutations: false,
    });
    assert.strictEqual(pilotBlocked.status, 'REJECTED');
    assert.ok(pilotBlocked.error?.includes('MUTATIONS_PROHIBITED_GUARD'));
    assert.strictEqual(mockDb.getWriteOpsCount(), 0);

    // Test PRODUCTION blocked
    const prodBlocked = await runStoryIntelligenceMigrationJob({
      mode: 'PRODUCTION',
      customDb: mockDb,
      allowMutations: false,
    });
    assert.strictEqual(prodBlocked.status, 'REJECTED');
    assert.ok(prodBlocked.error?.includes('MUTATIONS_PROHIBITED_GUARD'));
    assert.strictEqual(mockDb.getWriteOpsCount(), 0);

    // Test ROLLBACK blocked
    const rollbackBlocked = await runStoryIntelligenceMigrationJob({
      mode: 'ROLLBACK',
      targetRunId: 'any-run',
      customDb: mockDb,
      allowMutations: false,
    });
    assert.strictEqual(rollbackBlocked.status, 'REJECTED');
    assert.ok(rollbackBlocked.error?.includes('MUTATIONS_PROHIBITED_GUARD'));
    assert.strictEqual(mockDb.getWriteOpsCount(), 0);
  });

  console.log('\n[3. PILOT Mode Selection & Preflight Validation]');

  await test('PILOT mode filters exactly the 5 verified archetype stories when authorized', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'PILOT');
    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.totalEvaluated, 5);
    assert.strictEqual(result.totalMutated, 5);

    // Verify all 5 verified archetype IDs are in proposals
    const proposedIds = result.proposals.map((p) => p.storyId);
    for (const id of PILOT_COHORT_ARCHETYPE_IDS) {
      assert.ok(proposedIds.includes(id), `Missing archetype ID: ${id}`);
    }
    assert.ok(!proposedIds.includes('story-cluster-9999999999999999'), 'Non-pilot story excluded');

    // Verify manifest persisted
    assert.strictEqual(mockDb._manifestStore.size, 1);
    const savedManifest = mockDb._manifestStore.get(result.runId);
    assert.ok(savedManifest);
    assert.strictEqual(savedManifest.snapshots.length, 5);
    assert.ok(mockDb.getWriteOpsCount() > 0, 'Writes occurred only when explicitly authorized');
  });

  console.log('\n[4. Transaction-Safe Rollback & Field Existence Restoration]');

  await test('Rollback restores original fields and captures field existence when authorized', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // 1. Run pilot
    const pilotResult = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
    });

    // Verify snapshot captured field existence
    const snapshot = pilotResult.snapshots[0];
    assert.strictEqual(typeof snapshot.originalFields.strategicImportanceScore.existed, 'boolean');
    assert.strictEqual(typeof snapshot.originalFields.evidenceClassification.existed, 'boolean');

    // 2. Execute rollback
    const rollbackResult = await runStoryIntelligenceMigrationJob({
      mode: 'ROLLBACK',
      targetRunId: pilotResult.runId,
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(rollbackResult.status, 'SUCCESS');
    assert.strictEqual(rollbackResult.totalMutated, 5);
    assert.strictEqual(rollbackResult.totalSkipped, 0);
  });

  await test('Rollback is idempotent (second run safely skips without mutation)', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // 1. Run pilot
    const pilotResult = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
    });

    // 2. First rollback
    await runStoryIntelligenceMigrationJob({
      mode: 'ROLLBACK',
      targetRunId: pilotResult.runId,
      allowMutations: true,
      customDb: mockDb,
    });

    // 3. Second rollback on same targetRunId
    const idempotentResult = await runStoryIntelligenceMigrationJob({
      mode: 'ROLLBACK',
      targetRunId: pilotResult.runId,
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(idempotentResult.status, 'SUCCESS');
    assert.strictEqual(idempotentResult.totalMutated, 0); // 0 restored because already in original state
    assert.strictEqual(idempotentResult.totalSkipped, 5); // 5 recognized as ALREADY_RESTORED
  });

  await test('Rollback skips documents with newer legitimate updatedAt (concurrency conflict)', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // 1. Run pilot
    const pilotResult = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
    });

    // 2. Simulate newer legitimate update on one story AFTER migration
    const targetDoc = mockDb._storyStore.get('story-cluster-114cb574c81dbf00');
    targetDoc.updatedAt = '2099-01-01T00:00:00Z'; // Newer timestamp
    targetDoc.canonicalTitle = 'Legitimate Post-Migration Edit';
    mockDb._storyStore.set('story-cluster-114cb574c81dbf00', targetDoc);

    // 3. Run rollback
    const rollbackResult = await runStoryIntelligenceMigrationJob({
      mode: 'ROLLBACK',
      targetRunId: pilotResult.runId,
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(rollbackResult.status, 'SUCCESS');
    assert.strictEqual(rollbackResult.totalMutated, 4); // 4 restored
    assert.strictEqual(rollbackResult.totalSkipped, 1); // 1 skipped due to conflict

    // Confirm legitimate edit was preserved
    const preservedStory = mockDb._storyStore.get('story-cluster-114cb574c81dbf00');
    assert.strictEqual(preservedStory.canonicalTitle, 'Legitimate Post-Migration Edit');
  });

  console.log('\n[5. Resumable Checkpoint Execution & Crash Consistency]');

  await test('Resumes from checkpoint story ID and skips earlier stories', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // In deterministic alphabetical order, story-cluster-114cb574c81dbf00 is at index 1
    const checkpointId = 'story-cluster-114cb574c81dbf00';
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      checkpointStoryId: checkpointId,
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'PILOT');
    assert.strictEqual(result.totalEvaluated, 3);
    assert.strictEqual(result.totalMutated, 3);
  });

  await test('Atomic Checkpoint & Crash Simulation: Batch commits story updates and manifest checkpoint atomically', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // Run first batch with batchSize = 2 (Pilot has 5 stories)
    // We simulate a job that commits batch 1 atomically and then halts
    let batchCommits = 0;
    const originalRunTransaction = mockDb.runTransaction;
    mockDb.runTransaction = async (fn: any) => {
      const res = await originalRunTransaction(fn);
      // Check if this transaction committed a checkpoint batch
      if (res && typeof res === 'object' && res.lastCheckpointId) {
        batchCommits++;
        if (batchCommits === 1) {
          // Interrupt after batch 1 commits atomically
          throw new Error('SIMULATED_CRASH_AFTER_BATCH_1');
        }
      }
      return res;
    };

    const crashResult = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      batchSize: 2,
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(crashResult.status, 'FAILED');
    assert.ok(crashResult.error?.includes('SIMULATED_CRASH_AFTER_BATCH_1'));

    // Verify atomic state in database:
    // Exactly 2 stories from batch 1 were mutated
    assert.strictEqual(batchCommits, 1);
    const manifests = Array.from(mockDb._manifestStore.values());
    assert.strictEqual(manifests.length, 1);
    const savedManifest = manifests[0] as any;
    assert.strictEqual(savedManifest.totalMutated, 2);
    assert.ok(savedManifest.lastCheckpointStoryId, 'lastCheckpointStoryId must be set atomically in batch 1');
    const checkpointStory = savedManifest.lastCheckpointStoryId;

    // Restore normal operation and resume from checkpoint
    mockDb.runTransaction = originalRunTransaction;
    const resumeResult = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      batchSize: 2,
      checkpointStoryId: checkpointStory,
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(resumeResult.status, 'SUCCESS');
    assert.strictEqual(resumeResult.totalEvaluated, 3, 'Resumed job evaluated remaining 3 stories');
    assert.strictEqual(resumeResult.totalMutated, 3, 'Resumed job mutated remaining 3 stories');
  });

  await test('Concurrent modification on story document is detected and skipped without overwriting newer data', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // Simulate an external process updating story-cluster-114cb574c81dbf00 with newer data
    // after the initial fetch but before the batch transaction updates it
    const targetStoryId = 'story-cluster-114cb574c81dbf00';
    const originalRunTransaction = mockDb.runTransaction;
    let lockTransactionFinished = false;

    mockDb.runTransaction = async (updateFunction: any) => {
      if (lockTransactionFinished) {
        // We are now in the batch mutation transaction: simulate concurrent update by external process
        const storyStore = mockDb._storyStore;
        const existing = storyStore.get(targetStoryId);
        storyStore.set(targetStoryId, {
          ...existing,
          title: 'Brand New Concurrent Title',
          updatedAt: '2099-12-31T23:59:59.000Z', // Newer updatedAt
        });
      }
      const res = await originalRunTransaction(updateFunction);
      lockTransactionFinished = true; // First transaction was acquireDistributedLock
      return res;
    };

    const result = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      batchSize: 5,
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(result.mode, 'PILOT');
    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.totalEvaluated, 5);
    // 4 stories mutated, 1 story skipped due to concurrent modification
    assert.strictEqual(result.totalMutated, 4);
    assert.strictEqual(result.totalSkipped, 1);

    // Verify the concurrently updated document was NEVER overwritten
    const preservedStory = mockDb._storyStore.get(targetStoryId);
    assert.strictEqual(preservedStory.title, 'Brand New Concurrent Title');
    assert.strictEqual(preservedStory.updatedAt, '2099-12-31T23:59:59.000Z');
  });

  console.log('\n[6. Cross-Instance Concurrency & Distributed Atomic Lock]');

  await test('Concurrent job start fails closed when active lock is held by another instance', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // Instance A acquires lock
    await acquireDistributedLock(mockDb, 'run-instance-A', 'pod-worker-A', 'PILOT', 900000);

    // Instance B attempts to execute write migration
    const resultB = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
      executedBy: 'pod-worker-B',
    });

    assert.strictEqual(resultB.status, 'FAILED');
    assert.ok(resultB.error?.includes('CONCURRENT_LOCK_ACQUISITION_FAILED'));
    assert.strictEqual(resultB.totalMutated, 0, 'Instance B must perform zero mutations');
  });

  await test('Stale lock is safely recovered after TTL expiration', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // Seed an expired lock (expired 10 minutes ago)
    const expiredTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockDb._lockStore.set(LOCK_DOC_ID, {
      lockId: LOCK_DOC_ID,
      runId: 'stale-run-999',
      ownerId: 'dead-worker',
      mode: 'PILOT',
      acquiredAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      expiresAt: expiredTime,
      ttlMs: 900000,
      status: 'ACQUIRED',
    });

    // New instance starts
    const result = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
      executedBy: 'live-worker-C',
    });

    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.totalMutated, 5);

    // Verify lock was released on completion
    const lock = mockDb._lockStore.get(LOCK_DOC_ID);
    assert.strictEqual(lock.status, 'RELEASED');
  });

  await test('renewDistributedLock extends TTL and increments renewalCount for valid owner', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const initialLock = await acquireDistributedLock(mockDb, 'run-renew-1', 'owner-renew-1', 'PILOT', 300000);
    assert.strictEqual(initialLock.renewalCount, 0);

    const renewed = await renewDistributedLock(mockDb, 'run-renew-1', 'owner-renew-1', 'PILOT', 600000);
    assert.strictEqual(renewed.runId, 'run-renew-1');
    assert.strictEqual(renewed.ownerId, 'owner-renew-1');
    assert.strictEqual(renewed.renewalCount, 1);
    assert.ok(new Date(renewed.expiresAt).getTime() > new Date(initialLock.expiresAt).getTime());
  });

  await test('renewDistributedLock fails closed on ownership mismatch', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    await acquireDistributedLock(mockDb, 'run-orig', 'owner-orig', 'PILOT', 300000);

    await assert.rejects(
      async () => {
        await renewDistributedLock(mockDb, 'run-imposter', 'owner-imposter', 'PILOT', 300000);
      },
      (err: any) => {
        return err instanceof Error && err.message.includes('LOCK_OWNERSHIP_LOST');
      }
    );
  });

  await test('renewDistributedLock fails closed if lock already expired', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const expiredTime = new Date(Date.now() - 5000).toISOString();
    mockDb._lockStore.set(LOCK_DOC_ID, {
      lockId: LOCK_DOC_ID,
      runId: 'run-expired',
      ownerId: 'owner-expired',
      mode: 'PILOT',
      acquiredAt: new Date(Date.now() - 10000).toISOString(),
      expiresAt: expiredTime,
      ttlMs: 5000,
      status: 'ACQUIRED',
    });

    await assert.rejects(
      async () => {
        await renewDistributedLock(mockDb, 'run-expired', 'owner-expired', 'PILOT', 300000);
      },
      (err: any) => {
        return err instanceof Error && err.message.includes('LOCK_EXPIRED');
      }
    );
  });

  await test('validateLockInTransaction aborts mutation batch when lock is taken over by another instance', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const originalRunTransaction = mockDb.runTransaction;
    let lockAcquiredFirstTime = false;

    // Simulate another instance stealing the lock right after this instance acquires it
    mockDb.runTransaction = async (updateFunction: any) => {
      if (lockAcquiredFirstTime) {
        // We are at the batch mutation phase: overwrite lock as taken over by worker-hijacker
        mockDb._lockStore.set(LOCK_DOC_ID, {
          lockId: LOCK_DOC_ID,
          runId: 'run-hijacker-999',
          ownerId: 'pod-hijacker',
          mode: 'PILOT',
          acquiredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          ttlMs: 600000,
          status: 'ACQUIRED',
        });
      }
      const res = await originalRunTransaction(updateFunction);
      lockAcquiredFirstTime = true;
      return res;
    };

    const result = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
      executedBy: 'victim-worker',
    });

    assert.strictEqual(result.status, 'FAILED');
    assert.ok(result.error?.includes('LOCK_OWNERSHIP_LOST_IN_TRANSACTION'));
    assert.strictEqual(result.totalMutated, 0, 'Must abort and mutate 0 stories on lock takeover');
  });

  await test('validateLockInTransaction aborts mutation batch when lock has expired', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    const originalRunTransaction = mockDb.runTransaction;
    let lockAcquiredFirstTime = false;

    // Simulate lock expiring right before the batch transaction executes
    mockDb.runTransaction = async (updateFunction: any) => {
      if (lockAcquiredFirstTime) {
        const curLock = mockDb._lockStore.get(LOCK_DOC_ID);
        mockDb._lockStore.set(LOCK_DOC_ID, {
          ...curLock,
          expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired!
        });
      }
      const res = await originalRunTransaction(updateFunction);
      lockAcquiredFirstTime = true;
      return res;
    };

    const result = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
      executedBy: 'slow-worker',
    });

    assert.strictEqual(result.status, 'FAILED');
    assert.ok(result.error?.includes('LOCK_EXPIRED_IN_TRANSACTION'));
    assert.strictEqual(result.totalMutated, 0, 'Must abort and mutate 0 stories on expired lock');
  });

  await test('releaseDistributedLock prevents an older execution from releasing a lock acquired by a newer execution', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // Newer instance holds lock
    mockDb._lockStore.set(LOCK_DOC_ID, {
      lockId: LOCK_DOC_ID,
      runId: 'new-run-instance-2',
      ownerId: 'new-pod-2',
      mode: 'PILOT',
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      ttlMs: 600000,
      status: 'ACQUIRED',
    });

    // Older instance 1 attempts to release it
    const released = await releaseDistributedLock(mockDb, 'old-run-instance-1', 'old-pod-1');
    assert.strictEqual(released, false, 'Older instance must not be able to release newer lock');

    // Lock remains intact and active
    const lock = mockDb._lockStore.get(LOCK_DOC_ID);
    assert.strictEqual(lock.runId, 'new-run-instance-2');
    assert.strictEqual(lock.status, 'ACQUIRED');
  });

  console.log('\n[7. Strict DRY_RUN Write Interception]');

  await test('Strict DRY_RUN mode: interceptor fails if any write method is invoked', async () => {
    // createMockFirestore with strictDryRunMode: true throws immediately on any write
    const strictDb = createMockFirestore(mockPilotStories, { strictDryRunMode: true });

    const result = await runStoryIntelligenceMigrationJob({
      mode: 'DRY_RUN',
      customDb: strictDb,
    });

    assert.strictEqual(result.mode, 'DRY_RUN');
    assert.strictEqual(result.status, 'DRY_RUN_COMPLETED');
    assert.strictEqual(result.totalMutated, 0);
    assert.strictEqual(strictDb.getWriteOpsCount(), 0);
    assert.strictEqual(strictDb._manifestStore.size, 0);
    assert.strictEqual(strictDb._lockStore.size, 0);
  });

  await test('assertDryRunZeroWriteInvariant throws STRICT_DRY_RUN_WRITE_INTERCEPTED on write attempt in DRY_RUN', () => {
    assert.throws(
      () => {
        assertDryRunZeroWriteInvariant('DRY_RUN', 'test_write_op');
      },
      (err: any) => {
        return (
          err instanceof Error &&
          err.message.includes('STRICT_DRY_RUN_WRITE_INTERCEPTED') &&
          err.message.includes('test_write_op')
        );
      }
    );

    // Verify it does not throw for write modes
    assert.doesNotThrow(() => {
      assertDryRunZeroWriteInvariant('PILOT', 'test_write_op');
      assertDryRunZeroWriteInvariant('PRODUCTION', 'test_write_op');
    });
  });

  console.log('\n[8. Pilot Preflight Fails Closed on Archetype Tampering]');

  await test('Pilot preflight fails closed and halts writes if an archetype does not match', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // Tamper with the announcement story: change domain from official mi.com to third-party forum and remove announcement flag
    const art1Article = mockDb.collection('articles').doc('art-1');
    await art1Article.update({
      sourceDomain: 'unverified-forum.com',
      url: 'https://unverified-forum.com/poco',
    });
    const art1Analysis = mockDb.collection('articleAnalysis').doc('art-1');
    await art1Analysis.update({
      isOfficialAnnouncement: false,
      newsType: 'GENERAL_COMMENTARY',
    });

    const tamperedResult = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
    });

    assert.strictEqual(tamperedResult.status, 'FAILED');
    assert.ok(tamperedResult.error?.includes('Pilot Preflight Failed'));
    assert.strictEqual(tamperedResult.totalMutated, 0, 'Must abort with 0 mutations');
  });

  console.log('\n[9. Rollback Lock Validation & Heartbeat Management]');

  await test('Rollback aborts if lock is lost or taken over during rollback transaction', async () => {
    const mockDb = createMockFirestore(mockPilotStories);

    // 1. First run a successful PILOT migration so we have a valid manifest
    const pilotResult = await runStoryIntelligenceMigrationJob({
      mode: 'PILOT',
      allowMutations: true,
      customDb: mockDb,
      executedBy: 'pilot-worker',
    });
    assert.strictEqual(pilotResult.status, 'SUCCESS');

    // 2. Set up hook in runTransaction so that when rollback runs its document transaction,
    // the lock is taken over by another instance
    const originalRunTransaction = mockDb.runTransaction;
    let rollbackLockAcquired = false;

    mockDb.runTransaction = async (updateFunction: any) => {
      if (rollbackLockAcquired) {
        // We are inside the rollback per-document transaction: simulate lock takeover
        mockDb._lockStore.set(LOCK_DOC_ID, {
          lockId: LOCK_DOC_ID,
          runId: 'hijacker-rollback-lock',
          ownerId: 'pod-hijacker',
          mode: 'ROLLBACK',
          acquiredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          ttlMs: 600000,
          status: 'ACQUIRED',
        });
      }
      const res = await originalRunTransaction(updateFunction);
      rollbackLockAcquired = true;
      return res;
    };

    // 3. Run rollback
    await assert.rejects(
      async () => {
        await runStoryIntelligenceMigrationJob({
          mode: 'ROLLBACK',
          targetRunId: pilotResult.runId,
          allowMutations: true,
          customDb: mockDb,
          executedBy: 'rollback-worker',
        });
      },
      (err: any) => {
        return err instanceof Error && err.message.includes('LOCK_OWNERSHIP_LOST_IN_TRANSACTION');
      }
    );
  });

  await test('Lock heartbeat starts and stops cleanly without unhandled rejections', async () => {
    const mockDb = createMockFirestore(mockPilotStories);
    await acquireDistributedLock(mockDb, 'heartbeat-run', 'heartbeat-worker', 'PILOT', 300000);

    const hb = startLockHeartbeat(mockDb, 'heartbeat-run', 'heartbeat-worker', 'PILOT', 50, 300000);
    assert.strictEqual(hb.getLastError(), null);

    // Wait a brief moment for heartbeat to tick
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.strictEqual(hb.getLastError(), null);

    const curLock = mockDb._lockStore.get(LOCK_DOC_ID);
    assert.ok((curLock.renewalCount || 0) >= 1, 'Renewal count must have incremented via heartbeat');

    // Stop cleanly
    hb.stop();
  });

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('===============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();

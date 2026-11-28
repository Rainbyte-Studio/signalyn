import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';
import { initializeApp as initClient, deleteApp as deleteClient } from 'firebase/app';
import { connectFirestoreEmulator, doc, getFirestore as getClientDb, setDoc, terminate } from 'firebase/firestore';
import type { Article } from '../src/types';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8493');
assert.equal(process.env.GEMINI_API_KEY || '', '');
const { _resetTestOverrides, _setTestFirestoreDb } = await import('../src/server/firestoreAdmin');
const { previewHistoricalBacklogCleanup, executeHistoricalBacklogCleanup } =
  await import('../src/server/backfill/historicalBacklogCleanupService');
const { deleteObsoleteFailedArticles } = await import('../src/server/backfill/failedArticleRecoveryService');
const { storeCollectedArticle, writeArticleDependencies } = await import('../src/server/articleDeletionTombstones');
const projectId = 'demo-signalyn-pr16';
const deletionSetting = 'SIGNALYN_ENABLE_PERMANENT_ARTICLE_DELETION';
const adminApp = initializeApp({ projectId }, 'pr16-admin-emulator');
const db = getFirestore(adminApp);
const clientApp = initClient({ projectId }, 'pr16-browser-emulator');
const client = getClientDb(clientApp);
connectFirestoreEmulator(client, '127.0.0.1', 8493, { mockUserToken: { sub: 'fixture-admin', email: 'fixture@example.invalid', email_verified: true } });

const article = (id: string): Article => ({
  id, title: 'Historical Samsung phone', sourceId: 'fixture-source', processingStatus: 'FAILED',
  canonicalUrl: 'https://example.invalid/' + id, publishedAt: '2020-01-01T00:00:00Z',
  updatedAt: '2020-01-01T00:00:00Z', analysisError: 'Unsupported or corrupt content',
} as Article);

async function verifyDefaultOff() {
  delete process.env[deletionSetting];
  _setTestFirestoreDb(db);
  const fixture = article('disabled-gate');
  const ref = db.collection('articles').doc(fixture.id);
  await ref.set(fixture);
  const preview = await previewHistoricalBacklogCleanup({ confirmedByUid: 'fixture-admin' });
  const failed = await deleteObsoleteFailedArticles({ articleIds: [fixture.id], executedBy: 'fixture-admin' });
  assert.equal(preview.totalEligibleForDeletion, 1);
  assert.equal(failed.plannedCount, 1);
  await assert.rejects(executeHistoricalBacklogCleanup({
    dryRun: false, confirmCleanup: true, confirmedByUid: 'fixture-admin',
    previewFingerprint: preview.previewFingerprint, confirmationToken: preview.confirmationToken,
  }), { code: 'PERMANENT_ARTICLE_DELETION_DISABLED' });
  await assert.rejects(deleteObsoleteFailedArticles({
    articleIds: [fixture.id], dryRun: false, confirmDelete: true,
    confirmationToken: failed.confirmationToken, executedBy: 'fixture-admin',
  }), { code: 'PERMANENT_ARTICLE_DELETION_DISABLED' });
  assert.equal((await ref.get()).exists, true);
  assert.equal((await db.doc('system/historicalCleanupLease').get()).exists, false);
  assert.equal((await db.doc('system/deletedArticleTombstones/items/' + fixture.id).get()).exists, false);
  await ref.delete();
  console.log('Both permanent deletion paths reject valid confirmations by default');
}

async function runRace(mode: 'bulk' | 'failed') {
  const ids = ['story', 'brief', 'review', 'analytics', 'member', 'delete'].map((id) => mode + '-' + id);
  await Promise.all(ids.map((id) => db.collection('articles').doc(id).set(article(id))));
  _setTestFirestoreDb(db);
  const preview = mode === 'bulk' ? await previewHistoricalBacklogCleanup() : undefined;
  const failed = mode === 'failed' ? await deleteObsoleteFailedArticles({ articleIds: ids }) : undefined;
  assert.equal(preview?.totalEligibleForDeletion ?? failed?.plannedCount, 6);
  let tx = 0;
  _setTestFirestoreDb(new Proxy(db, {
    get(target, property) {
      if (property === 'runTransaction') return async (callback: (transaction: Transaction) => Promise<unknown>) => {
        tx++;
        if (tx === (mode === 'bulk' ? 5 : 3)) {
          await writeArticleDependencies(db, ids.slice(0, 5), (writer) => {
            writer.set(db.doc('stories/' + mode), { articleIds: [ids[0]] });
            writer.set(db.doc('dailyBriefs/' + mode), { en: { headlineDevelopments: [{ groundedCitations: [{ articleId: ids[1] }] }] } });
            writer.set(db.doc('entityReview/' + mode), { articleId: ids[2] });
            writer.set(db.doc('analyticsDaily/' + mode), { sampleArticleIds: [ids[3]] });
            writer.set(db.doc('stories/' + mode + '/articles/' + ids[4]), { articleId: ids[4] });
          });
        }
        return target.runTransaction(callback);
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
  const result = preview
    ? await executeHistoricalBacklogCleanup({
        dryRun: false, confirmCleanup: true, previewFingerprint: preview.previewFingerprint, confirmationToken: preview.confirmationToken,
      })
    : await deleteObsoleteFailedArticles({
        articleIds: ids, dryRun: false, confirmDelete: true, confirmationToken: failed?.confirmationToken,
      });
  assert.equal('deletedCount' in result ? result.deletedCount : result.processedCount, 1);
  assert.deepEqual(await Promise.all(ids.map(async (id) => (await db.doc('articles/' + id).get()).exists)), [true, true, true, true, true, false]);
  const deletedId = ids[5];
  await assert.rejects(writeArticleDependencies(db, [deletedId], (t) => t.set(db.doc('stories/rejected'), { articleIds: [deletedId] })), /ARTICLE_DELETED_DURING_OPERATION/);
  assert.equal(await storeCollectedArticle(db, article(deletedId), new Date().toISOString()), false);
  assert.equal(await storeCollectedArticle(db, { ...article(deletedId), id: mode + '-new-hash' }, new Date().toISOString()), false);
  console.log(mode + ' endpoint preserved all five new dependencies and blocked stale writers and collectors');
}

try {
  await verifyDefaultOff();
  process.env[deletionSetting] = 'true';
  await runRace('bulk');
  await runRace('failed');
  await db.doc('admins/fixture-admin').set({ enabled: true });
  for (const collection of ['articles', 'articleAnalysis', 'analyticsDaily', 'analyticsLedger', 'dailyBriefs']) {
    await assert.rejects(setDoc(doc(client, collection, 'direct-write'), { id: 'direct-write' }), { code: 'permission-denied' });
  }
  console.log('Deployed rules file denies direct browser writes to server-owned collections');
  const review = { id: 'fixture-review', articleId: 'bulk-story', status: 'PENDING', detectedName: 'Test', createdAt: new Date().toISOString() };
  const clientReview = doc(client, 'entityReview', review.id);
  const story = {
    id: 'fixture-story', canonicalTitle: 'Fixture', summary: 'Fixture', status: 'ACTIVE',
    storyType: 'EVENT', articleCount: 1, createdAt: review.createdAt, articleIds: ['bulk-story'],
  };
  const membership = {
    articleId: 'bulk-story', sourceId: 'source-1', publishedAt: review.createdAt, addedAt: review.createdAt,
    similarityScore: 1, membershipConfidence: 1,
  };
  const browserWrites = [
    () => setDoc(clientReview, review),
    () => setDoc(doc(client, 'stories', story.id), story),
    () => setDoc(doc(client, 'stories', story.id, 'articles', membership.articleId), membership),
  ];
  for (const write of browserWrites) await write();
  await db.doc('system/historicalCleanupLease').set({ status: 'ACTIVE', expiresAtMs: Date.now() + 60_000 });
  for (const write of browserWrites) await assert.rejects(write(), { code: 'permission-denied' });
  await db.doc('system/historicalCleanupLease').set({ status: 'RELEASED', expiresAtMs: Date.now() });
  for (const write of browserWrites) await write();
  console.log('Firestore Rules block authenticated browser dependency writes while the cleanup lease is active');
} finally {
  _resetTestOverrides();
  delete process.env[deletionSetting];
  await terminate(client);
  await deleteClient(clientApp);
  await db.terminate();
  await deleteApp(adminApp);
}

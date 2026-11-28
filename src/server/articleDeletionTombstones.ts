import { createHash } from 'node:crypto';
import type { Article } from '../types';
import { cleanServerData } from './serverFirestoreAdapter';

export function normalizeCanonicalUrlKey(url?: string | null): string {
  if (!url) return '';
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${cleanPath.toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}


export function normalizeCanonicalUrlHash(url?: string | null): string | null {
  if (!url?.trim()) return null;
  const key = normalizeCanonicalUrlKey(url);
  return key ? createHash('sha256').update(key).digest('hex').slice(0, 32) : null;
}

function tombstones(db: FirebaseFirestore.Firestore) {
  return db.collection('system').doc('deletedArticleTombstones');
}

export async function isDeletedArticleTombstoned(
  db: FirebaseFirestore.Firestore,
  articleId: string,
  canonicalUrl?: string | null,
  transaction?: FirebaseFirestore.Transaction,
): Promise<boolean> {
  const parent = tombstones(db);
  const idRef = parent.collection('items').doc(articleId);
  const urlHash = normalizeCanonicalUrlHash(canonicalUrl);
  const refs = urlHash ? [idRef, parent.collection('urls').doc(urlHash)] : [idRef];
  const snapshots = await Promise.all(refs.map((ref) => transaction ? transaction.get(ref) : ref.get()));
  return snapshots.some((snapshot) => snapshot.exists);
}

/** Resolve collection races and tombstones in the transaction that creates the article. */
export async function storeCollectedArticle(
  db: FirebaseFirestore.Firestore,
  article: Article,
  seenAt: string,
): Promise<boolean> {
  const ref = db.collection('articles').doc(article.id);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      const data = existing.data() as Article;
      const feeds = data.discoveredViaFeeds ?? (data.feedId ? [data.feedId] : []);
      if (article.feedId && !feeds.includes(article.feedId)) {
        transaction.update(ref, {
          discoveredViaFeeds: [...feeds, article.feedId],
          updatedAt: seenAt,
        });
      }
      return false;
    }
    if (await isDeletedArticleTombstoned(db, article.id, article.canonicalUrl, transaction)) return false;
    transaction.set(ref, cleanServerData(article));
    for (const fence of dependencyFenceRefs(db, articleDeletionFenceKeys([article]))) {
      transaction.set(fence, { changedAt: seenAt });
    }
    return true;
  });
}

export function stageArticleDeletion(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  article: Article,
  details: { auditId: string; deletedAt: string; disposition: string },
  tombstoneUrl: boolean,
): number {
  const parent = tombstones(db);
  transaction.delete(db.collection('articles').doc(article.id));
  transaction.set(parent.collection('items').doc(article.id), { articleId: article.id, ...details });
  const urlHash = tombstoneUrl ? normalizeCanonicalUrlHash(article.canonicalUrl) : null;
  if (!urlHash) return 1;
  transaction.set(parent.collection('urls').doc(urlHash), { urlHash, articleId: article.id, ...details });
  return 2;
}

/** Reject stale evidence from work that started before an article was deleted. */
export async function assertArticlesNotDeleted(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  articleIds: Iterable<string>,
): Promise<void> {
  const items = tombstones(db).collection('items');
  const ids = [...new Set(articleIds)];
  const snapshots = await Promise.all(ids.map((id) => transaction.get(items.doc(id))));
  const deleted = snapshots.findIndex((snapshot) => snapshot.exists);
  if (deleted >= 0) {
    throw new Error('ARTICLE_DELETED_DURING_OPERATION: Evidence article ' + ids[deleted] + ' was permanently deleted.');
  }
}

export function writeArticleDependencies<T>(
  db: FirebaseFirestore.Firestore,
  articleIds: Iterable<string>,
  write: (transaction: FirebaseFirestore.Transaction) => T | Promise<T>,
): Promise<T> {
  const ids = [...new Set(articleIds)];
  return db.runTransaction(async (transaction) => {
    await assertArticlesNotDeleted(db, transaction, ids);
    const result = await write(transaction);
    for (const ref of dependencyFenceRefs(db, ids)) {
      transaction.set(ref, { changedAt: new Date().toISOString() });
    }
    return result;
  });
}

// A shared point read/write conflict protects deletes even when a writer inserts
// a brand-new dependency document that did not exist in the previous query.
function dependencyFenceRefs(db: FirebaseFirestore.Firestore, articleIds: Iterable<string>) {
  const shards = new Set(
    Array.from(articleIds, (id) => createHash('sha256').update(id).digest('hex')[0]),
  );
  return [...shards].sort().map((shard) => db.doc('system/articleDependencyFences/shards/' + shard));
}

export function articleDeletionFenceKeys(articles: Article[]): string[] {
  return articles.flatMap((article) => {
    const url = normalizeCanonicalUrlKey(article.canonicalUrl);
    return url ? [article.id, 'url:' + url] : [article.id];
  });
}

export async function readArticleDependencyFences(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  articleIds: Iterable<string>,
): Promise<void> {
  await Promise.all(dependencyFenceRefs(db, articleIds).map((ref) => transaction.get(ref)));
}

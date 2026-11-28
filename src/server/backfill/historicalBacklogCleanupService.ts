/**
 * Signalyn Safe Administrator-Only Historical Backlog Cleanup Service
 *
 * Inspects ALL article dependencies across:
 *   - articleAnalysis
 *   - stories
 *   - analyticsLedger
 *   - analyticsDaily
 *   - dailyBriefs
 *   - entityReview
 *   - sources (verified intact, never modified)
 *
 * Classifies every stored article into EXACTLY ONE mutually exclusive disposition
 * so eligibleForDeletion + protectedFromDeletion === totalStoredArticles.
 *
 * Safeguards:
 * - Zero Gemini API calls
 * - Non-destructive preview with a persisted single-use confirmation
 * - Confirmation bound to exact previewed eligible article set (HTTP 409 on drift)
 * - Dry-run default on execution; requires explicit confirmCleanup: true + previewFingerprint
 * - Exclusive distributed locking across:
 *     1. system/historicalCleanupLease (blocks manual analysis, stories, failure recovery, backfill)
 *     2. system/pipelineLease (fail-closed; prevents overlap with Daily Intelligence Pipeline)
 *     3. system/historicalBackfillBatchLease (blocks concurrent backfill batches)
 * - Atomic Firestore transactions revalidate article state and all intelligence dependencies
 * - Lightweight tombstones under system/deletedArticleTombstones to stop RSS feeds
 *   from re-collecting deleted obsolete articles while never blocking canonical URLs
 *   of retained articles
 * - Non-destructive backfill exclusion for preserved Daily Brief–referenced articles
 */

import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import { db as clientDb } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import {
  Article,
  HistoricalBacklogCleanupPreview,
  HistoricalBacklogCleanupResult,
  HistoricalCleanupArticleDependencies,
  HistoricalCleanupDisposition,
  HistoricalCleanupEligibleDisposition,
  HistoricalCleanupProtectedDisposition,
  HistoricalCleanupSampleItem,
} from '../../types';
import { classifyStrategicRelevance } from '../strategicRelevanceGate';
import { getAthensReportingWindow, isWithinAthensReportingWindow } from '../reportingWindow';
import {
  acquirePipelineLease,
  LEASE_DOC_PATH,
  getPipelineLeaseStatus,
  releasePipelineLease,
} from '../pipelineLease';
import {
  acquireHistoricalCleanupLease,
  HISTORICAL_CLEANUP_LEASE_PATH,
  releaseHistoricalCleanupLease,
} from '../maintenanceLock';
import { fetchArticlesForReadOnlyAudit } from './backlogCleanupEngine';
import { articleDeletionFenceKeys, normalizeCanonicalUrlKey, readArticleDependencyFences, stageArticleDeletion } from '../articleDeletionTombstones';

export const ELIGIBLE_DISPOSITIONS: HistoricalCleanupEligibleDisposition[] = [
  'ELIGIBLE_HISTORICAL_PENDING',
  'ELIGIBLE_HISTORICAL_FAILED',
  'ELIGIBLE_OBSOLETE_OUT_OF_SCOPE',
  'ELIGIBLE_DUPLICATE_OR_UNUSABLE',
];

export const PROTECTED_DISPOSITIONS: HistoricalCleanupProtectedDisposition[] = [
  'PROTECTED_ANALYZED',
  'PROTECTED_REFERENCED_DEPENDENCY',
  'PROTECTED_DAILY_PIPELINE_WINDOW',
  'PROTECTED_CORPORATE_UNCERTAIN',
  'PROTECTED_ACTIVE_PROCESSING',
];

export const ALL_CLEANUP_DISPOSITIONS: HistoricalCleanupDisposition[] = [
  ...ELIGIBLE_DISPOSITIONS,
  ...PROTECTED_DISPOSITIONS,
];

const ZERO_DELETIONS = {
  ELIGIBLE_HISTORICAL_PENDING: 0,
  ELIGIBLE_HISTORICAL_FAILED: 0,
  ELIGIBLE_OBSOLETE_OUT_OF_SCOPE: 0,
  ELIGIBLE_DUPLICATE_OR_UNUSABLE: 0,
};

export function articleChangedSincePlan(planned: Article, live: Article): boolean {
  return !isDeepStrictEqual(planned, live);
}

const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function isPermissionDeniedError(err: unknown): boolean {
  const anyErr = err as any;
  const code = anyErr?.code;
  const msg = (anyErr?.message || String(err)).toLowerCase();
  return (
    code === 7 ||
    code === 'permission-denied' ||
    code === 403 ||
    msg.includes('permission') ||
    msg.includes('insufficient permissions') ||
    msg.includes('security exception')
  );
}

export { isDeletedArticleTombstoned, normalizeCanonicalUrlHash } from '../articleDeletionTombstones';

async function fetchCollectionReadOnly(
  collectionName: string
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  try {
    const db = getServerDb();
    const snap = await db.collection(collectionName).get();
    return snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} }));
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      throw err;
    }
    const snap = await getDocs(collection(clientDb, collectionName));
    return snap.docs.map((d) => ({ id: d.id, data: (d.data() as Record<string, any>) || {} }));
  }
}

export function collectGroundedArticleIds(container: any, out: Set<string>): void {
  if (!container || typeof container !== 'object') return;
  if (Array.isArray(container.sourceArticleIds)) {
    for (const id of container.sourceArticleIds) if (typeof id === 'string') out.add(id);
  }
  if (Array.isArray(container.articleIds)) {
    for (const id of container.articleIds) if (typeof id === 'string') out.add(id);
  }
  for (const key of ['citations', 'groundedCitations']) {
    if (Array.isArray(container[key])) {
      for (const citation of container[key]) {
        if (typeof citation?.articleId === 'string') out.add(citation.articleId);
      }
    }
  }
  if (Array.isArray(container.groundedArticles)) {
    for (const ga of container.groundedArticles) {
      if (typeof ga === 'string') out.add(ga);
      else if (ga && typeof ga.articleId === 'string') out.add(ga.articleId);
    }
  }
  for (const key of ['headlineDevelopments', 'topDevelopments', 'categoryBreakdowns', 'competitorMoves', 'developments']) {
    if (Array.isArray(container[key])) {
      for (const entry of container[key]) {
        collectGroundedArticleIds(entry, out);
      }
    }
  }
  if (container.en) collectGroundedArticleIds(container.en, out);
  if (container.el) collectGroundedArticleIds(container.el, out);
  if (container.english) collectGroundedArticleIds(container.english, out);
  if (container.greek) collectGroundedArticleIds(container.greek, out);
  if (container.canonicalContent) collectGroundedArticleIds(container.canonicalContent, out);
  if (container.localizedContent) collectGroundedArticleIds(container.localizedContent, out);
}

/**
 * Fetches all article IDs grounded in persisted Daily Briefs so Historical Backfill
 * inventory and candidate selection exclude preserved Daily Brief–referenced articles
 * rather than re-queuing them for historical analysis.
 */
export async function fetchBriefReferencedArticleIds(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const briefs = await fetchCollectionReadOnly('dailyBriefs');
    for (const brief of briefs) {
      collectGroundedArticleIds(brief.data, out);
    }
  } catch {
    // Graceful empty fallback in minimal unit-test stubs without a dailyBriefs collection
  }
  return out;
}

export interface FullDependencyGraph {
  counts: {
    articleAnalysisDocs: number;
    storiesDocs: number;
    analyticsLedgerDocs: number;
    analyticsDailyDocs: number;
    dailyBriefsDocs: number;
    entityReviewDocs: number;
    sourcesDocs: number;
  };
  dependenciesByArticleId: Map<string, HistoricalCleanupArticleDependencies>;
  analyzedArticleIds: Set<string>;
  articleIdsByCanonicalUrl?: Map<string, string[]>;
}

/**
 * Pure builder for full dependency graph across all 6 intelligence collections + sources.
 */
export function buildFullDependencyGraph(collections: {
  articleAnalysis: Array<{ id: string; data: Record<string, any> }>;
  stories: Array<{ id: string; data: Record<string, any> }>;
  analyticsLedger: Array<{ id: string; data: Record<string, any> }>;
  analyticsDaily: Array<{ id: string; data: Record<string, any> }>;
  dailyBriefs: Array<{ id: string; data: Record<string, any> }>;
  entityReview: Array<{ id: string; data: Record<string, any> }>;
  sources: Array<{ id: string; data: Record<string, any> }>;
  storyMemberships?: Array<{ articleId: string; storyId: string }>;
}): FullDependencyGraph {
  const dependenciesByArticleId = new Map<string, HistoricalCleanupArticleDependencies>();
  const analyzedArticleIds = new Set<string>();

  const ensure = (articleId: string): HistoricalCleanupArticleDependencies => {
    let entry = dependenciesByArticleId.get(articleId);
    if (!entry) {
      entry = {
        hasArticleAnalysis: false,
        referencedByStories: [],
        referencedByAnalyticsLedger: false,
        referencedByAnalyticsDaily: [],
        referencedByDailyBriefs: [],
        referencedByEntityReviews: [],
        hasAnyDependency: false,
      };
      dependenciesByArticleId.set(articleId, entry);
    }
    return entry;
  };

  // 1. articleAnalysis
  for (const doc of collections.articleAnalysis) {
    const ids = new Set<string>([doc.id]);
    if (typeof doc.data?.articleId === 'string') ids.add(doc.data.articleId);
    for (const aid of ids) {
      analyzedArticleIds.add(aid);
      const dep = ensure(aid);
      dep.hasArticleAnalysis = true;
      dep.hasAnyDependency = true;
    }
  }

  // 2. stories
  for (const story of collections.stories) {
    const ids = new Set<string>();
    if (typeof story.data?.representativeArticleId === 'string') {
      ids.add(story.data.representativeArticleId);
    }
    if (Array.isArray(story.data?.articleIds)) {
      for (const aid of story.data.articleIds) if (typeof aid === 'string') ids.add(aid);
    }
    if (Array.isArray(story.data?.articles)) {
      for (const a of story.data.articles) {
        if (typeof a === 'string') ids.add(a);
        else if (a && typeof a.articleId === 'string') ids.add(a.articleId);
      }
    }
    if (Array.isArray(story.data?.developments)) {
      for (const d of story.data.developments) {
        if (Array.isArray(d?.articleIds)) {
          for (const aid of d.articleIds) if (typeof aid === 'string') ids.add(aid);
        }
      }
    }
    for (const aid of ids) {
      const dep = ensure(aid);
      dep.referencedByStories.push(story.id);
      dep.hasAnyDependency = true;
    }
  }

  for (const { articleId, storyId } of collections.storyMemberships || []) {
    const dep = ensure(articleId);
    if (!dep.referencedByStories.includes(storyId)) dep.referencedByStories.push(storyId);
    dep.hasAnyDependency = true;
  }

  // 3. analyticsLedger
  for (const entry of collections.analyticsLedger) {
    const ids = new Set<string>([entry.id]);
    if (typeof entry.data?.articleId === 'string') ids.add(entry.data.articleId);
    for (const aid of ids) {
      const dep = ensure(aid);
      dep.referencedByAnalyticsLedger = true;
      dep.hasAnyDependency = true;
    }
  }

  // 4. analyticsDaily (daily rollups are always preserved; inspect any direct article ID refs too)
  for (const daily of collections.analyticsDaily) {
    const ids = new Set<string>();
    if (Array.isArray(daily.data?.articleIds)) {
      for (const aid of daily.data.articleIds) if (typeof aid === 'string') ids.add(aid);
    }
    if (Array.isArray(daily.data?.sampleArticleIds)) {
      for (const aid of daily.data.sampleArticleIds) if (typeof aid === 'string') ids.add(aid);
    }
    for (const aid of ids) {
      const dep = ensure(aid);
      dep.referencedByAnalyticsDaily.push(daily.id);
      dep.hasAnyDependency = true;
    }
  }

  // 5. dailyBriefs
  for (const brief of collections.dailyBriefs) {
    const ids = new Set<string>();
    collectGroundedArticleIds(brief.data, ids);
    for (const aid of ids) {
      const dep = ensure(aid);
      dep.referencedByDailyBriefs.push(brief.id);
      dep.hasAnyDependency = true;
    }
  }

  // 6. entityReview
  for (const rev of collections.entityReview) {
    const ids = new Set<string>();
    if (typeof rev.data?.articleId === 'string') ids.add(rev.data.articleId);
    if (typeof rev.data?.sourceArticleId === 'string') ids.add(rev.data.sourceArticleId);
    if (Array.isArray(rev.data?.articleIds)) {
      for (const aid of rev.data.articleIds) if (typeof aid === 'string') ids.add(aid);
    }
    if (Array.isArray(rev.data?.evidenceArticleIds)) {
      for (const aid of rev.data.evidenceArticleIds) if (typeof aid === 'string') ids.add(aid);
    }
    for (const aid of ids) {
      const dep = ensure(aid);
      dep.referencedByEntityReviews.push(rev.id);
      dep.hasAnyDependency = true;
    }
  }

  return {
    counts: {
      articleAnalysisDocs: collections.articleAnalysis.length,
      storiesDocs: collections.stories.length,
      analyticsLedgerDocs: collections.analyticsLedger.length,
      analyticsDailyDocs: collections.analyticsDaily.length,
      dailyBriefsDocs: collections.dailyBriefs.length,
      entityReviewDocs: collections.entityReview.length,
      sourcesDocs: collections.sources.length,
    },
    dependenciesByArticleId,
    analyzedArticleIds,
  };
}

export interface ClassifiedCleanupArticle {
  article: Article;
  disposition: HistoricalCleanupDisposition;
  eligibleForDeletion: boolean;
  reason: string;
  strategicDecision?: string;
  strategicCategory?: string;
  duplicateOfArticleId: string | null;
  dependencies: HistoricalCleanupArticleDependencies;
}

const EMPTY_DEPS: HistoricalCleanupArticleDependencies = {
  hasArticleAnalysis: false,
  referencedByStories: [],
  referencedByAnalyticsLedger: false,
  referencedByAnalyticsDaily: [],
  referencedByDailyBriefs: [],
  referencedByEntityReviews: [],
  hasAnyDependency: false,
};

function describeDependencies(deps: HistoricalCleanupArticleDependencies): string {
  const parts: string[] = [];
  if (deps.hasArticleAnalysis) parts.push('articleAnalysis');
  if (deps.referencedByStories.length > 0) parts.push(`${deps.referencedByStories.length} story(ies)`);
  if (deps.referencedByAnalyticsLedger) parts.push('analyticsLedger');
  if (deps.referencedByAnalyticsDaily.length > 0) parts.push(`${deps.referencedByAnalyticsDaily.length} analyticsDaily bucket(s)`);
  if (deps.referencedByDailyBriefs.length > 0) parts.push(`${deps.referencedByDailyBriefs.length} daily brief(s)`);
  if (deps.referencedByEntityReviews.length > 0) parts.push(`${deps.referencedByEntityReviews.length} entity review(s)`);
  return parts.join(', ');
}

/**
 * Deterministic SHA-256 fingerprint binding administrator confirmation to the exact
 * set of eligible article IDs and their dispositions (and optional category/limit scope).
 */
export function computeEligiblePreviewFingerprint(
  classified: ClassifiedCleanupArticle[],
  options?: {
    allowedCategories?: Set<HistoricalCleanupEligibleDisposition>;
    maxDeletions?: number;
  }
): string {
  const eligible = classified
    .filter((item) => {
      if (!item.eligibleForDeletion) return false;
      if (
        options?.allowedCategories &&
        !options.allowedCategories.has(item.disposition as HistoricalCleanupEligibleDisposition)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.article.id.localeCompare(b.article.id));

  const bounded =
    options?.maxDeletions !== undefined ? eligible.slice(0, options.maxDeletions) : eligible;

  const payload = bounded.map((item) => `${item.article.id}:${item.disposition}`).join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Pure, deterministic, mutually exclusive classifier for ALL stored articles.
 * Every article receives exactly one disposition; protection rules ALWAYS take precedence.
 */
export function classifyArticlesForHistoricalCleanup(
  articles: Article[],
  graph: FullDependencyGraph,
  reportingWindow: { windowStartIso: string; windowEndIso: string }
): ClassifiedCleanupArticle[] {
  // Pre-compute deterministic strategic relevance once per article so Pass 1 and Pass 2 agree
  const relByArticleId = new Map<string, ReturnType<typeof classifyStrategicRelevance>>();
  for (const art of articles) {
    relByArticleId.set(
      art.id,
      classifyStrategicRelevance({
        title: art.title,
        excerpt: art.excerpt,
        rawCategories: art.rawCategories,
        sourceName: art.sourceName,
        canonicalUrl: art.canonicalUrl,
      })
    );
  }

  // Pass 1: Identify canonical URL owners, strictly prioritizing protected articles first
  const canonicalUrlOwners = new Map<string, string>();
  const registerOwner = (art: Article) => {
    const key = normalizeCanonicalUrlKey(art.canonicalUrl);
    if (key && !canonicalUrlOwners.has(key)) {
      canonicalUrlOwners.set(key, art.id);
    }
  };

  // Priority 1: Analyzed / processing / referenced dependency owners win canonical ownership first
  for (const art of articles) {
    const status = art.processingStatus || 'PENDING';
    const deps = graph.dependenciesByArticleId.get(art.id);
    if (status === 'ANALYZED' || status === 'PROCESSING' || deps?.hasAnyDependency) {
      registerOwner(art);
    }
  }
  // Priority 2: Daily Pipeline window owners
  for (const art of articles) {
    const status = art.processingStatus || 'PENDING';
    if (status === 'PENDING') {
      const inWindow = art.publishedAt
        ? isWithinAthensReportingWindow(
            art.publishedAt,
            reportingWindow.windowStartIso,
            reportingWindow.windowEndIso
          )
        : false;
      if (inWindow) registerOwner(art);
    }
  }
  // Priority 3: Protected Corporate / Uncertain articles pending strategic review
  for (const art of articles) {
    const status = art.processingStatus || 'PENDING';
    const rel = relByArticleId.get(art.id);
    if (status === 'PENDING' && rel?.decision === 'UNCERTAIN') {
      registerOwner(art);
    }
  }
  // Priority 4: Earliest non-duplicate historical record to detect duplicate historical rows
  const sortedForDup = [...articles].sort((a, b) =>
    (a.collectedAt || a.publishedAt || a.id).localeCompare(b.collectedAt || b.publishedAt || b.id)
  );
  for (const art of sortedForDup) {
    registerOwner(art);
  }

  // Pass 2: Mutually exclusive disposition assignment (Protection checks ALWAYS first)
  return articles.map((article) => {
    const status = article.processingStatus || 'PENDING';
    const deps = graph.dependenciesByArticleId.get(article.id) || EMPTY_DEPS;
    const rel = relByArticleId.get(article.id)!;

    const urlKey = normalizeCanonicalUrlKey(article.canonicalUrl);
    const canonicalOwner = urlKey ? canonicalUrlOwners.get(urlKey) : undefined;
    const duplicateOfArticleId = canonicalOwner && canonicalOwner !== article.id ? canonicalOwner : null;

    // 1. PROTECTED: Analyzed articles (status === ANALYZED or persisted articleAnalysis record)
    if (status === 'ANALYZED' || deps.hasArticleAnalysis) {
      return {
        article,
        disposition: 'PROTECTED_ANALYZED',
        eligibleForDeletion: false,
        reason:
          status === 'ANALYZED'
            ? 'Preserved: Successfully analyzed article.'
            : 'Preserved: Linked articleAnalysis intelligence record exists.',
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId,
        dependencies: deps,
      };
    }

    // 2. PROTECTED: Currently processing articles
    if (status === 'PROCESSING') {
      return {
        article,
        disposition: 'PROTECTED_ACTIVE_PROCESSING',
        eligibleForDeletion: false,
        reason: 'Preserved: Article is currently marked as actively processing.',
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId,
        dependencies: deps,
      };
    }

    // 3. PROTECTED: Any intelligence dependency (Stories, analyticsLedger, analyticsDaily, Daily Briefs, Entity Reviews)
    if (deps.hasAnyDependency) {
      return {
        article,
        disposition: 'PROTECTED_REFERENCED_DEPENDENCY',
        eligibleForDeletion: false,
        reason: `Preserved: Referenced by existing intelligence dependencies (${describeDependencies(deps)}).`,
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId,
        dependencies: deps,
      };
    }

    const isWithinDailyWindow = article.publishedAt
      ? isWithinAthensReportingWindow(
          article.publishedAt,
          reportingWindow.windowStartIso,
          reportingWindow.windowEndIso
        )
      : false;

    const isMissingContent =
      (!article.title || !article.title.trim()) && (!article.excerpt || !article.excerpt.trim());

    // 4. PROTECTED: Articles reserved for the current Daily Pipeline (24h Europe/Athens window)
    if (status === 'PENDING' && isWithinDailyWindow && rel.decision !== 'OUT_OF_SCOPE' && !duplicateOfArticleId && !isMissingContent) {
      return {
        article,
        disposition: 'PROTECTED_DAILY_PIPELINE_WINDOW',
        eligibleForDeletion: false,
        reason: 'Preserved: Reserved for the current Daily Pipeline 24h Europe/Athens reporting window.',
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId: null,
        dependencies: deps,
      };
    }

    // 5. PROTECTED: Corporate & uncertain articles pending strategic review
    if (status === 'PENDING' && rel.decision === 'UNCERTAIN' && !duplicateOfArticleId && !isMissingContent) {
      return {
        article,
        disposition: 'PROTECTED_CORPORATE_UNCERTAIN',
        eligibleForDeletion: false,
        reason: 'Preserved: Corporate / ecosystem article held for strategic review.',
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId: null,
        dependencies: deps,
      };
    }

    // --- ELIGIBLE FOR SAFE DELETION (strictly unreferenced, non-analyzed, outside daily reserve) ---

    // 6. ELIGIBLE: Duplicate or unusable historical records
    if (duplicateOfArticleId || isMissingContent) {
      return {
        article,
        disposition: 'ELIGIBLE_DUPLICATE_OR_UNUSABLE',
        eligibleForDeletion: true,
        reason: duplicateOfArticleId
          ? `Eligible: Duplicate historical record matching canonical article ${duplicateOfArticleId} with zero intelligence dependencies.`
          : 'Eligible: Unusable historical record missing both title and excerpt with zero intelligence dependencies.',
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId,
        dependencies: deps,
      };
    }

    // 7. ELIGIBLE: Historical failed articles (FAILED, ARCHIVED_FAILED, ARCHIVED)
    if (status === 'FAILED' || status === 'ARCHIVED_FAILED' || status === 'ARCHIVED') {
      return {
        article,
        disposition: 'ELIGIBLE_HISTORICAL_FAILED',
        eligibleForDeletion: true,
        reason:
          status === 'FAILED'
            ? 'Eligible: Unreferenced historical failed article.'
            : `Eligible: Unreferenced archived historical failure (${status}).`,
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId: null,
        dependencies: deps,
      };
    }

    // 8. ELIGIBLE: Obsolete out-of-scope articles without intelligence dependencies
    if (status === 'SKIPPED_STRATEGIC_SCOPE' || rel.decision === 'OUT_OF_SCOPE') {
      return {
        article,
        disposition: 'ELIGIBLE_OBSOLETE_OUT_OF_SCOPE',
        eligibleForDeletion: true,
        reason:
          status === 'SKIPPED_STRATEGIC_SCOPE'
            ? 'Eligible: Previously skipped out-of-scope article with zero intelligence dependencies.'
            : 'Eligible: Unanalyzed out-of-scope article with zero intelligence dependencies.',
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId: null,
        dependencies: deps,
      };
    }

    // 9. ELIGIBLE: Unanalyzed historical pending articles (outside current 24h Daily Pipeline window)
    if (status === 'PENDING') {
      return {
        article,
        disposition: 'ELIGIBLE_HISTORICAL_PENDING',
        eligibleForDeletion: true,
        reason: 'Eligible: Unanalyzed historical pending article outside the current Daily Pipeline reporting window with zero intelligence dependencies.',
        strategicDecision: rel.decision,
        strategicCategory: rel.category,
        duplicateOfArticleId: null,
        dependencies: deps,
      };
    }

    // Any remaining unknown non-analyzed unreferenced legacy status
    return {
      article,
      disposition: 'ELIGIBLE_DUPLICATE_OR_UNUSABLE',
      eligibleForDeletion: true,
      reason: `Eligible: Unreferenced legacy historical record with unrecognized status '${status}'.`,
      strategicDecision: rel.decision,
      strategicCategory: rel.category,
      duplicateOfArticleId: null,
      dependencies: deps,
    };
  });
}

/** Reads the same dependency schema in preview and inside the deletion transaction. */
export async function readCleanupDependencyGraph(
  db: FirebaseFirestore.Firestore,
  transaction?: FirebaseFirestore.Transaction,
): Promise<FullDependencyGraph> {
  const read = async (name: string) => {
    const ref = db.collection(name);
    const snap = await (transaction ? transaction.get(ref) : ref.get());
    return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  };
  const membershipQuery = db.collectionGroup('articles');
  const [articleAnalysis, stories, analyticsLedger, analyticsDaily, dailyBriefs, entityReview, sources, members] =
    await Promise.all([
      read('articleAnalysis'), read('stories'), read('analyticsLedger'), read('analyticsDaily'),
      read('dailyBriefs'), read('entityReview'), transaction ? Promise.resolve([]) : read('sources'),
      transaction ? transaction.get(membershipQuery) : membershipQuery.get(),
    ]);
  const storyMemberships = members.docs.flatMap((member) => {
    const path = member.ref.path.split('/');
    return path.length === 4 && path[0] === 'stories'
      ? [{ storyId: path[1], articleId: path[3] }]
      : [];
  });
  const graph = buildFullDependencyGraph({
    articleAnalysis, stories, analyticsLedger, analyticsDaily, dailyBriefs, entityReview, sources, storyMemberships,
  });
  if (transaction) {
    graph.articleIdsByCanonicalUrl = new Map<string, string[]>();
    for (const document of members.docs) {
      if (document.ref.parent.id !== 'articles' || document.ref.parent.parent !== null) continue;
      const key = normalizeCanonicalUrlKey(document.data().canonicalUrl);
      if (!key) continue;
      const owners = graph.articleIdsByCanonicalUrl.get(key) ?? [];
      owners.push(document.id);
      graph.articleIdsByCanonicalUrl.set(key, owners);
    }
  }
  return graph;
}

export function shouldTombstoneDeletedUrl(
  graph: FullDependencyGraph,
  url: string | null | undefined,
  deletedIds: Set<string>,
  tombstonedUrls: Set<string>,
): boolean {
  const key = normalizeCanonicalUrlKey(url);
  const owners = graph.articleIdsByCanonicalUrl?.get(key);
  if (!owners?.length || tombstonedUrls.has(key) || owners.some((id) => !deletedIds.has(id))) return false;
  tombstonedUrls.add(key);
  return true;
}

async function fetchLiveAuditSnapshot() {
  const [articles, graph] = await Promise.all([
    fetchArticlesForReadOnlyAudit(),
    readCleanupDependencyGraph(getServerDb()),
  ]);
  const reportingWindow = getAthensReportingWindow();
  const classified = classifyArticlesForHistoricalCleanup(articles, graph, reportingWindow);

  return { articles, graph, reportingWindow, classified };
}

async function listActiveOrPausedBackfillRunIds(): Promise<string[]> {
  try {
    const db = getServerDb();
    const snap = await db.collection('system').doc('backfillRuns').collection('runs').get();
    const activeIds: string[] = [];
    for (const d of snap.docs) {
      const data = d.data() || {};
      if (['RUNNING', 'PAUSING', 'PAUSED'].includes(data.status)) {
        activeIds.push(d.id);
      }
    }
    return activeIds;
  } catch {
    return [];
  }
}

/**
 * Safely cancels all active or paused historical backfill runs prior to cleanup
 * so no checkpoint can resume over deleted backlog documents.
 */
export async function cancelActiveHistoricalBackfillRuns(reason: string): Promise<string[]> {
  const db = getServerDb();
  const col = db.collection('system').doc('backfillRuns').collection('runs');
  const snap = await col.get();
  const stoppedIds: string[] = [];
  const nowIso = new Date().toISOString();

  for (const d of snap.docs) {
    const data = d.data() || {};
    if (['RUNNING', 'PAUSING', 'PAUSED'].includes(data.status)) {
      await col.doc(d.id).update(
        cleanServerData({
          status: 'CANCELLED',
          cancelRequested: true,
          pauseRequested: false,
          completedAt: nowIso,
          updatedAt: nowIso,
          lastError: reason,
        })
      );
      stoppedIds.push(d.id);
    }
  }
  return stoppedIds;
}

/**
 * Historical backlog preview and confirmation issuance
 *
 * Computes fresh, mutually exclusive counts, dependency checks, dynamic post-cleanup
 * remaining inventory (never hardcoding 0 for protected failures), and a deterministic
 * SHA-256 previewFingerprint + confirmationToken binding permanent execution to this exact set.
 */
async function issueCleanupConfirmation(previewFingerprint: string, confirmedByUid?: string) {
  const confirmationToken = `cleanup-preview-${randomUUID()}`;
  const previewExpiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString();

  await getServerDb().collection('system').doc('historicalBacklogCleanupPreviews')
    .collection('tokens').doc(confirmationToken).set({
      previewFingerprint,
      confirmedByUid: confirmedByUid ?? null,
      expiresAt: previewExpiresAt,
      consumed: false,
    });
  return { confirmationToken, previewExpiresAt };
}

export async function previewHistoricalBacklogCleanup(options?: {
  sampleLimit?: number;
  confirmedByUid?: string;
}): Promise<HistoricalBacklogCleanupPreview> {
  const sampleLimit = Math.max(1, Math.min(options?.sampleLimit ?? 10, 50));
  const [{ graph, reportingWindow, classified }, activeRunIds, pipelineStatus] = await Promise.all([
    fetchLiveAuditSnapshot(),
    listActiveOrPausedBackfillRunIds(),
    getPipelineLeaseStatus().catch(() => ({ active: false })),
  ]);

  const eligibleCounts: Record<HistoricalCleanupEligibleDisposition, number> = {
    ELIGIBLE_HISTORICAL_PENDING: 0,
    ELIGIBLE_HISTORICAL_FAILED: 0,
    ELIGIBLE_OBSOLETE_OUT_OF_SCOPE: 0,
    ELIGIBLE_DUPLICATE_OR_UNUSABLE: 0,
  };

  const protectedCounts: Record<HistoricalCleanupProtectedDisposition, number> = {
    PROTECTED_ANALYZED: 0,
    PROTECTED_REFERENCED_DEPENDENCY: 0,
    PROTECTED_DAILY_PIPELINE_WINDOW: 0,
    PROTECTED_CORPORATE_UNCERTAIN: 0,
    PROTECTED_ACTIVE_PROCESSING: 0,
  };

  const samplesByDisposition = Object.fromEntries(
    ALL_CLEANUP_DISPOSITIONS.map((d) => [d, [] as HistoricalCleanupSampleItem[]])
  ) as Record<HistoricalCleanupDisposition, HistoricalCleanupSampleItem[]>;

  let articlesWithArticleAnalysis = 0;
  let articlesReferencedByStories = 0;
  let articlesReferencedByAnalyticsLedger = 0;
  let articlesReferencedByAnalyticsDaily = 0;
  let articlesReferencedByDailyBriefs = 0;
  let articlesReferencedByEntityReviews = 0;
  let nonAnalyzedArticlesProtectedByDependencies = 0;

  // Dynamically compute expected remaining statuses among protected articles (NEVER hardcode 0!)
  let historicalPendingRemaining = 0;
  let historicalFailedRemaining = 0;
  let actionableFailuresRemaining = 0;
  let preservedReferenceArticles = 0;

  for (const item of classified) {
    if (item.eligibleForDeletion) {
      eligibleCounts[item.disposition as HistoricalCleanupEligibleDisposition]++;
    } else {
      protectedCounts[item.disposition as HistoricalCleanupProtectedDisposition]++;

      const status = item.article.processingStatus || 'PENDING';
      const isToday = item.article.publishedAt
        ? isWithinAthensReportingWindow(
            item.article.publishedAt,
            reportingWindow.windowStartIso,
            reportingWindow.windowEndIso
          )
        : false;

      if (item.disposition === 'PROTECTED_REFERENCED_DEPENDENCY') {
        if (status === 'FAILED') {
          historicalFailedRemaining++;
          actionableFailuresRemaining++;
        } else if (status === 'PENDING' && !isToday) {
          // Protected Daily Brief / dependency references outside today's window are
          // excluded from Historical Backfill queue & counted transparently as preserved references
          if (item.dependencies.referencedByDailyBriefs.length > 0 || item.article.backfillExcluded) {
            preservedReferenceArticles++;
          } else {
            historicalPendingRemaining++;
          }
        }
      }
    }

    const d = item.dependencies;
    if (d.hasArticleAnalysis) articlesWithArticleAnalysis++;
    if (d.referencedByStories.length > 0) articlesReferencedByStories++;
    if (d.referencedByAnalyticsLedger) articlesReferencedByAnalyticsLedger++;
    if (d.referencedByAnalyticsDaily.length > 0) articlesReferencedByAnalyticsDaily++;
    if (d.referencedByDailyBriefs.length > 0) articlesReferencedByDailyBriefs++;
    if (d.referencedByEntityReviews.length > 0) articlesReferencedByEntityReviews++;
    if (item.disposition === 'PROTECTED_REFERENCED_DEPENDENCY') {
      nonAnalyzedArticlesProtectedByDependencies++;
    }

    if (samplesByDisposition[item.disposition].length < sampleLimit) {
      samplesByDisposition[item.disposition].push({
        id: item.article.id,
        title: item.article.title || '(Untitled article)',
        sourceName: item.article.sourceName || item.article.sourceId || 'Unknown Source',
        publishedAt: item.article.publishedAt || '',
        processingStatus: item.article.processingStatus || 'PENDING',
        disposition: item.disposition,
        reason: item.reason,
        strategicDecision: item.strategicDecision,
        strategicCategory: item.strategicCategory,
        duplicateOfArticleId: item.duplicateOfArticleId,
        dependencies: {
          hasArticleAnalysis: d.hasArticleAnalysis,
          storiesCount: d.referencedByStories.length,
          hasAnalyticsLedger: d.referencedByAnalyticsLedger,
          analyticsDailyCount: d.referencedByAnalyticsDaily.length,
          dailyBriefsCount: d.referencedByDailyBriefs.length,
          entityReviewsCount: d.referencedByEntityReviews.length,
        },
      });
    }
  }

  const totalEligibleForDeletion = Object.values(eligibleCounts).reduce((s, v) => s + v, 0);
  const totalProtectedFromDeletion = Object.values(protectedCounts).reduce((s, v) => s + v, 0);

  const auditedAt = new Date().toISOString();
  const previewFingerprint = computeEligiblePreviewFingerprint(classified);
  const { confirmationToken, previewExpiresAt } = await issueCleanupConfirmation(previewFingerprint, options?.confirmedByUid);

  return {
    auditedAt,
    reportingWindowStartIso: reportingWindow.windowStartIso,
    reportingWindowEndIso: reportingWindow.windowEndIso,
    totalStoredArticles: classified.length,
    totalEligibleForDeletion,
    totalProtectedFromDeletion,
    eligibleCounts,
    protectedCounts,
    dependenciesSummary: {
      ...graph.counts,
      articlesWithArticleAnalysis,
      articlesReferencedByStories,
      articlesReferencedByAnalyticsLedger,
      articlesReferencedByAnalyticsDaily,
      articlesReferencedByDailyBriefs,
      articlesReferencedByEntityReviews,
      nonAnalyzedArticlesProtectedByDependencies,
    },
    expectedRemainingInventory: {
      totalArticles: totalProtectedFromDeletion,
      analyzedArticles: protectedCounts.PROTECTED_ANALYZED,
      dailyPipelineReservedArticles: protectedCounts.PROTECTED_DAILY_PIPELINE_WINDOW,
      corporateUncertainArticles: protectedCounts.PROTECTED_CORPORATE_UNCERTAIN,
      referencedProtectedArticles: protectedCounts.PROTECTED_REFERENCED_DEPENDENCY,
      preservedReferenceArticles,
      activeProcessingArticles: protectedCounts.PROTECTED_ACTIVE_PROCESSING,
      historicalPendingRemaining,
      historicalFailedRemaining,
      actionableFailuresRemaining,
      preservedCollections: {
        stories: graph.counts.storiesDocs,
        articleAnalysis: graph.counts.articleAnalysisDocs,
        analyticsLedger: graph.counts.analyticsLedgerDocs,
        analyticsDaily: graph.counts.analyticsDailyDocs,
        dailyBriefs: graph.counts.dailyBriefsDocs,
        entityReview: graph.counts.entityReviewDocs,
        sources: graph.counts.sourcesDocs,
      },
    },
    samplesByDisposition,
    activeBackfillRunsCount: activeRunIds.length,
    dailyPipelineActive: Boolean(pipelineStatus?.active),
    previewFingerprint,
    confirmationToken,
    previewExpiresAt,
  };
}

/**
 * 2. BOUNDED, ATOMIC, PREVIEW-BOUND, ADMIN-ONLY HISTORICAL BACKLOG CLEANUP EXECUTION
 *
 * Defaults to dryRun: true. When dryRun === false:
 * - Requires confirmCleanup === true AND previewFingerprint matching the live eligible set
 * - Acquires 3 exclusive locks:
 *     1. system/historicalCleanupLease (blocks manual analysis, story assignment, failure recovery, backfill)
 *     2. system/pipelineLease (fail-closed; prevents overlap with Daily Intelligence Pipeline)
 *     3. system/historicalBackfillBatchLease (prevents concurrent backfill batches)
 * - Cancels any open historical backfill checkpoints
 * - Re-scans all 6 dependency collections under the locks and verifies liveFingerprint === previewFingerprint
 *   (if drifted, aborts with PREVIEW_STALE_RECONFIRM_REQUIRED and deletes 0 articles)
 * - Executes bounded atomic Firestore transactions (up to 100 articles/tx) that re-read live
 *   article state, writer fences, and the full dependency graph right before delete
 * - Writes lightweight deletion tombstones so RSS feeds never re-collect deleted obsolete records
 *   while preserving canonical URLs of all retained articles
 * - Marks protected Daily Brief–referenced historical pending articles with backfillExcluded: true
 *   so they never re-enter the Historical Backfill queue (without marking them ANALYZED)
 */
export async function executeHistoricalBacklogCleanup(options: {
  dryRun?: boolean;
  confirmCleanup?: boolean;
  previewFingerprint?: string;
  confirmationToken?: string;
  confirmedByUid?: string;
  executedBy?: string;
  categories?: HistoricalCleanupEligibleDisposition[];
  maxDeletions?: number;
}): Promise<HistoricalBacklogCleanupResult> {
  const dryRun = options.dryRun !== false;
  const confirmCleanup = options.confirmCleanup === true;
  const executedBy = options.executedBy || 'admin';
  const maxDeletions =
    options.maxDeletions !== undefined && Number.isFinite(options.maxDeletions)
      ? Math.max(1, Math.min(Math.floor(options.maxDeletions), 10000))
      : undefined;

  if (!dryRun && !confirmCleanup) {
    throw new Error(
      'EXPLICIT_ADMIN_CONFIRMATION_REQUIRED: Confirmed historical cleanup requires confirmCleanup: true after preview.'
    );
  }

  if (!dryRun && (!options.previewFingerprint || typeof options.previewFingerprint !== 'string' || !options.previewFingerprint.trim())) {
    throw new Error(
      'PREVIEW_CONFIRMATION_REQUIRED: Confirmed cleanup must bind to a previewFingerprint generated by previewHistoricalBacklogCleanup().'
    );
  }

  const allowedCategories =
    Array.isArray(options.categories) && options.categories.length > 0
      ? new Set<HistoricalCleanupEligibleDisposition>(options.categories)
      : new Set<HistoricalCleanupEligibleDisposition>(ELIGIBLE_DISPOSITIONS);

  const auditId = `backlog-cleanup-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const nowIso = new Date().toISOString();

  // Helper to partition a freshly fetched live audit snapshot
  const partitionLive = async () => {
    const { classified, reportingWindow } = await fetchLiveAuditSnapshot();
    const toDelete: ClassifiedCleanupArticle[] = [];
    const briefReferencesToExclude: ClassifiedCleanupArticle[] = [];
    const deletedByCategory: Record<HistoricalCleanupEligibleDisposition, number> = {
      ELIGIBLE_HISTORICAL_PENDING: 0,
      ELIGIBLE_HISTORICAL_FAILED: 0,
      ELIGIBLE_OBSOLETE_OUT_OF_SCOPE: 0,
      ELIGIBLE_DUPLICATE_OR_UNUSABLE: 0,
    };
    const protectedByCategory: Record<HistoricalCleanupProtectedDisposition, number> = {
      PROTECTED_ANALYZED: 0,
      PROTECTED_REFERENCED_DEPENDENCY: 0,
      PROTECTED_DAILY_PIPELINE_WINDOW: 0,
      PROTECTED_CORPORATE_UNCERTAIN: 0,
      PROTECTED_ACTIVE_PROCESSING: 0,
    };
    let skippedCount = 0;

    // Sort deterministically by article ID so maxDeletions matches computeEligiblePreviewFingerprint
    const sorted = [...classified].sort((a, b) => a.article.id.localeCompare(b.article.id));

    for (const item of sorted) {
      if (!item.eligibleForDeletion) {
        protectedByCategory[item.disposition as HistoricalCleanupProtectedDisposition]++;

        // Identify historical PENDING articles preserved for Daily Brief references
        if (
          item.disposition === 'PROTECTED_REFERENCED_DEPENDENCY' &&
          (item.article.processingStatus || 'PENDING') === 'PENDING' &&
          item.dependencies.referencedByDailyBriefs.length > 0 &&
          item.article.backfillExcluded !== true
        ) {
          const isToday = item.article.publishedAt
            ? isWithinAthensReportingWindow(
                item.article.publishedAt,
                reportingWindow.windowStartIso,
                reportingWindow.windowEndIso
              )
            : false;
          if (!isToday) {
            briefReferencesToExclude.push(item);
          }
        }
        continue;
      }

      const disp = item.disposition as HistoricalCleanupEligibleDisposition;
      if (!allowedCategories.has(disp)) {
        skippedCount++;
        continue;
      }
      if (maxDeletions !== undefined && toDelete.length >= maxDeletions) {
        skippedCount++;
        continue;
      }
      toDelete.push(item);
      deletedByCategory[disp]++;
    }

    const protectedCount = Object.values(protectedByCategory).reduce((s, v) => s + v, 0);
    const liveFingerprint = computeEligiblePreviewFingerprint(classified, {
      allowedCategories,
      maxDeletions,
    });

    return {
      totalStored: classified.length,
      toDelete,
      briefReferencesToExclude,
      deletedByCategory,
      protectedByCategory,
      protectedCount,
      skippedCount,
      liveFingerprint,
    };
  };

  if (dryRun) {
    const pipelineStatus = await getPipelineLeaseStatus();
    if (pipelineStatus.active) {
      throw new Error(
        'PIPELINE_ACTIVE_PRIORITY: The scheduled Daily Intelligence Pipeline is currently running. Historical cleanup cannot run during an active daily update.'
      );
    }

    const plan = await partitionLive();
    const confirmation = await issueCleanupConfirmation(plan.liveFingerprint, options.confirmedByUid);
    return {
      ...confirmation,
      success: true,
      dryRun: true,
      auditId,
      executedAt: nowIso,
      executedBy,
      previewFingerprint: plan.liveFingerprint,
      stoppedBackfillRunIds: [],
      deletedCount: 0,
      deletedByCategory: { ...ZERO_DELETIONS },
      plannedDeletionCount: plan.toDelete.length,
      plannedDeletionByCategory: plan.deletedByCategory,
      protectedCount: plan.protectedCount,
      protectedByCategory: plan.protectedByCategory,
      skippedCount: plan.skippedCount,
      skippedDueToConcurrentChange: 0,
      tombstonesWritten: 0,
      briefReferencesExcludedCount: 0,
      plannedBriefExclusionCount: plan.briefReferencesToExclude.length,
      remainingArticlesEstimate: plan.totalStored - plan.toDelete.length,
      geminiCallsUsed: 0,
      message: `Dry-run complete: ${plan.toDelete.length} unreferenced historical article(s) are eligible for cleanup and ${plan.protectedCount} article(s) are protected. No records were deleted.`,
    };
  }

  const db = getServerDb();

  if (!options.confirmationToken || !/^cleanup-preview-[0-9a-f-]{36}$/.test(options.confirmationToken)) {
    throw new Error('PREVIEW_STALE_RECONFIRM_REQUIRED: Generate a fresh cleanup preview before executing.');
  }
  const tokenRef = db.collection('system').doc('historicalBacklogCleanupPreviews')
    .collection('tokens').doc(options.confirmationToken);

  // Acquire ALL THREE exclusive distributed locks before performing any mutation
  const owner = `cleanup-${auditId}`;
  const leaseDurationMs = 15 * 60 * 1000;
  const backfillLock = db.doc('system/historicalBackfillBatchLease');

  let cleanupLeaseAcquired = false;
  let pipelineLeaseAcquired = false;
  let backfillLeaseAcquired = false;

  try {
    // Lock 1: Exclusive historical cleanup maintenance lease (blocks analysis, stories, recovery, backfill)
    await acquireHistoricalCleanupLease(owner, 'HISTORICAL_BACKLOG_CLEANUP', leaseDurationMs);
    cleanupLeaseAcquired = true;

    // Lock 2: Exclusive Daily Pipeline lease (failClosed: true so Daily Pipeline cannot start during cleanup
    // AND cleanup aborts immediately if Daily Pipeline already holds the lease!)
    const pipelineAcquire = await acquirePipelineLease(
      owner,
      'HISTORICAL_BACKLOG_CLEANUP',
      leaseDurationMs,
      false,
      true
    );
    if (!pipelineAcquire.acquired) {
      throw new Error(
        `PIPELINE_ACTIVE_PRIORITY: The scheduled Daily Intelligence Pipeline is currently running (${pipelineAcquire.reason || 'lease held'}). Historical cleanup cannot overlap with the Daily Pipeline.`
      );
    }
    pipelineLeaseAcquired = true;

    // Lock 3: Exclusive Historical Backfill batch lease
    await db.runTransaction(async (transaction: any) => {
      const current = (await transaction.get(backfillLock)).data();
      if (current && current.expiresAt > Date.now()) {
        throw new Error(
          'BACKFILL_LEASE_CONFLICT: A Historical Backfill batch or cleanup is currently executing. Wait for it to finish or cancel it before running cleanup.'
        );
      }
      transaction.set(backfillLock, {
        owner,
        purpose: 'HISTORICAL_BACKLOG_CLEANUP',
        expiresAt: Date.now() + leaseDurationMs,
      });
    });
    backfillLeaseAcquired = true;

    // 4. Re-compute live candidate & full 6-collection dependency snapshot under all 3 exclusive locks
    const plan = await partitionLive();

    // 5. Preview-bound confirmation check: abort with 0 deletions if eligible set changed!
    const expectedFingerprint = options.previewFingerprint || '';
    if (plan.liveFingerprint !== expectedFingerprint) {
      throw new Error(
        `PREVIEW_STALE_RECONFIRM_REQUIRED: The eligible historical article set changed after your preview (expected fingerprint ${expectedFingerprint.slice(0, 12)}, live ${plan.liveFingerprint.slice(0, 12)}). Zero articles were deleted. Please refresh the preview and re-confirm.`
      );
    }

    const assertCleanupOwnsLeases = async (transaction: any) => {
      const [maintenance, pipeline, backfill] = await Promise.all([
        transaction.get(db.doc(HISTORICAL_CLEANUP_LEASE_PATH)),
        transaction.get(db.doc(LEASE_DOC_PATH)),
        transaction.get(backfillLock),
      ]);
      const maintenanceLease = maintenance.data();
      const pipelineLease = pipeline.data();
      const backfillLease = backfill.data();
      const now = Date.now();
      if (
        maintenanceLease?.owner !== owner || maintenanceLease.status !== 'ACTIVE' ||
        !(maintenanceLease.expiresAtMs > now) ||
        pipelineLease?.leaseHolder !== owner || pipelineLease.status !== 'ACTIVE' ||
        !(Date.parse(pipelineLease.expiresAt) > now) ||
        backfillLease?.owner !== owner || !(backfillLease.expiresAt > now)
      ) {
        throw new Error('HISTORICAL_CLEANUP_ACTIVE: Cleanup no longer holds all maintenance leases. Generate a fresh preview.');
      }
    };

    // Consume the stored confirmation before any cleanup side effect.
    await db.runTransaction(async (transaction: any) => {
      await assertCleanupOwnsLeases(transaction);
      const token = (await transaction.get(tokenRef)).data();
      if (
        token?.consumed !== false ||
        token.previewFingerprint !== expectedFingerprint ||
        token.confirmedByUid !== (options.confirmedByUid ?? null) ||
        !(Date.parse(token.expiresAt) > Date.now())
      ) {
        throw new Error('PREVIEW_STALE_RECONFIRM_REQUIRED: The cleanup preview is unavailable, expired, or already used. Generate a fresh preview.');
      }
      transaction.update(tokenRef, { consumed: true, consumedAt: new Date().toISOString(), auditId });
    });

    // Stop any active or paused historical backfill checkpoints before deleting
    const stoppedBackfillRunIds = await cancelActiveHistoricalBackfillRuns(
      `Cancelled automatically prior to administrator Historical Backlog Cleanup (${auditId}).`
    );

    // Revalidate and write tombstones in the transaction that deletes each chunk.
    const TX_CHUNK_SIZE = 100;
    let actualDeletedCount = 0;
    let skippedDueToConcurrentChange = 0;
    let missingAtExecution = 0;
    let retainedAfterConcurrentChange = 0;
    let tombstonesWritten = 0;
    const actualDeletedByCategory: Record<HistoricalCleanupEligibleDisposition, number> = {
      ELIGIBLE_HISTORICAL_PENDING: 0,
      ELIGIBLE_HISTORICAL_FAILED: 0,
      ELIGIBLE_OBSOLETE_OUT_OF_SCOPE: 0,
      ELIGIBLE_DUPLICATE_OR_UNUSABLE: 0,
    };
    const deletedSample: Array<{
      id: string;
      title: string;
      sourceName: string;
      processingStatus: string;
      disposition: HistoricalCleanupDisposition;
      publishedAt: string;
    }> = [];

    for (let i = 0; i < plan.toDelete.length; i += TX_CHUNK_SIZE) {
      const chunk = plan.toDelete.slice(i, i + TX_CHUNK_SIZE);

      const chunkStats = await db.runTransaction(async (transaction: any) => {
        await assertCleanupOwnsLeases(transaction);
        await readArticleDependencyFences(db, transaction, articleDeletionFenceKeys(chunk.map(({ article }) => article)));
        const graph = await readCleanupDependencyGraph(db, transaction);
        const checks = await Promise.all(chunk.map(async (item) => {
          const artRef = db.collection('articles').doc(item.article.id);
          return { item, artSnap: await transaction.get(artRef) };
        }));

        let chunkDeleted = 0;
        let chunkSkipped = 0;
        let chunkTombstones = 0;
        const chunkCats: Record<HistoricalCleanupEligibleDisposition, number> = {
          ELIGIBLE_HISTORICAL_PENDING: 0,
          ELIGIBLE_HISTORICAL_FAILED: 0,
          ELIGIBLE_OBSOLETE_OUT_OF_SCOPE: 0,
          ELIGIBLE_DUPLICATE_OR_UNUSABLE: 0,
        };
        const chunkDeletedItems: ClassifiedCleanupArticle[] = [];

        let chunkMissing = 0;
        const deletions: Array<{ item: ClassifiedCleanupArticle; article: Article }> = [];
        for (const { item, artSnap } of checks) {
          if (!artSnap.exists) {
            chunkMissing++;
            continue;
          }
          const liveArticle = { ...artSnap.data(), id: item.article.id } as Article;
          if (articleChangedSincePlan(item.article, liveArticle) ||
              graph.dependenciesByArticleId.get(liveArticle.id)?.hasAnyDependency) {
            chunkSkipped++;
            continue;
          }

          deletions.push({ item, article: liveArticle });
          chunkDeleted++;
          chunkCats[item.disposition as HistoricalCleanupEligibleDisposition]++;
          chunkDeletedItems.push(item);
        }

        const deletedIds = new Set(deletions.map(({ article }) => article.id));
        const tombstonedUrls = new Set<string>();
        for (const { item, article } of deletions) {
          chunkTombstones += stageArticleDeletion(db, transaction, article, {
            deletedAt: nowIso, auditId, disposition: item.disposition,
          }, shouldTombstoneDeletedUrl(graph, article.canonicalUrl, deletedIds, tombstonedUrls));
        }

        return { chunkDeleted, chunkSkipped, chunkMissing, chunkTombstones, chunkCats, chunkDeletedItems };
      });

      actualDeletedCount += chunkStats.chunkDeleted;
      skippedDueToConcurrentChange += chunkStats.chunkSkipped + chunkStats.chunkMissing;
      missingAtExecution += chunkStats.chunkMissing;
      retainedAfterConcurrentChange += chunkStats.chunkSkipped;
      tombstonesWritten += chunkStats.chunkTombstones;
      for (const disp of ELIGIBLE_DISPOSITIONS) {
        actualDeletedByCategory[disp] += chunkStats.chunkCats[disp];
      }
      for (const item of chunkStats.chunkDeletedItems) {
        if (deletedSample.length < 100) {
          deletedSample.push({
            id: item.article.id,
            title: item.article.title || '',
            sourceName: item.article.sourceName || item.article.sourceId || '',
            processingStatus: item.article.processingStatus || 'PENDING',
            disposition: item.disposition,
            publishedAt: item.article.publishedAt || '',
          });
        }
      }
    }

    // 7. Non-destructively exclude preserved Daily Brief–referenced historical PENDING articles
    // from future Historical Backfill queue (without marking them ANALYZED)
    let briefReferencesExcludedCount = 0;
    const EXCLUDE_CHUNK = 100;
    for (let i = 0; i < plan.briefReferencesToExclude.length; i += EXCLUDE_CHUNK) {
      const chunk = plan.briefReferencesToExclude.slice(i, i + EXCLUDE_CHUNK);
      briefReferencesExcludedCount += await db.runTransaction(async (transaction) => {
        await assertCleanupOwnsLeases(transaction);
        const graph = await readCleanupDependencyGraph(db, transaction);
        const refs = chunk.map((item) => db.collection('articles').doc(item.article.id));
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        let excluded = 0;
        for (const [index, snapshot] of snapshots.entries()) {
          if (!snapshot.exists) continue;
          const planned = chunk[index].article;
          const live = { ...snapshot.data(), id: planned.id } as Article;
          if (articleChangedSincePlan(planned, live) || live.backfillExcluded ||
              !graph.dependenciesByArticleId.get(live.id)?.referencedByDailyBriefs.length) continue;
          transaction.update(refs[index], {
            backfillExcluded: true,
            backfillExclusionReason: 'PRESERVED_DAILY_BRIEF_REFERENCE',
            updatedAt: nowIso,
          });
          excluded++;
        }
        return excluded;
      });
    }

    // 9. Persist durable audit record
    await db
      .collection('system')
      .doc('historicalBacklogCleanupAudit')
      .collection('runs')
      .doc(auditId)
      .set(
        cleanServerData({
          auditId,
          executedBy,
          executedAt: nowIso,
          previewFingerprint: plan.liveFingerprint,
          stoppedBackfillRunIds,
          deletedCount: actualDeletedCount,
          deletedByCategory: actualDeletedByCategory,
          protectedCount: plan.protectedCount,
          protectedByCategory: plan.protectedByCategory,
          skippedCount: plan.skippedCount,
          skippedDueToConcurrentChange,
          missingAtExecution,
          retainedAfterConcurrentChange,
          tombstonesWritten,
          briefReferencesExcludedCount,
          remainingArticlesEstimate: plan.totalStored - actualDeletedCount - missingAtExecution,
          geminiCallsUsed: 0,
          deletedSample,
        })
      );

    return {
      success: true,
      dryRun: false,
      auditId,
      executedAt: nowIso,
      executedBy,
      previewFingerprint: plan.liveFingerprint,
      stoppedBackfillRunIds,
      deletedCount: actualDeletedCount,
      deletedByCategory: actualDeletedByCategory,
      protectedCount: plan.protectedCount,
      protectedByCategory: plan.protectedByCategory,
      skippedCount: plan.skippedCount,
      skippedDueToConcurrentChange,
      missingAtExecution,
      retainedAfterConcurrentChange,
      tombstonesWritten,
      briefReferencesExcludedCount,
      remainingArticlesEstimate: plan.totalStored - actualDeletedCount - missingAtExecution,
      geminiCallsUsed: 0,
      message:
        actualDeletedCount > 0
          ? `Historical backlog cleanup complete: removed ${actualDeletedCount} unreferenced historical article(s) while preserving ${plan.protectedCount} protected article(s) and all intelligence collections.${
              skippedDueToConcurrentChange > 0
                ? ` (${skippedDueToConcurrentChange} article(s) skipped due to concurrent state/dependency updates.)`
                : ''
            }`
          : `No articles were deleted (${plan.protectedCount} protected article(s) preserved).`,
    };
  } finally {
    if (backfillLeaseAcquired) {
      try {
        await db.runTransaction(async (transaction: any) => {
          if ((await transaction.get(backfillLock)).data()?.owner === owner) {
            transaction.delete(backfillLock);
          }
        });
      } catch (releaseErr) {
        console.warn('[Historical Backlog Cleanup] Could not release batch lease:', releaseErr);
      }
    }
    if (pipelineLeaseAcquired) {
      await releasePipelineLease(owner);
    }
    if (cleanupLeaseAcquired) {
      await releaseHistoricalCleanupLease(owner);
    }
  }
}

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
 * - Read-only preview with exact fresh counts & reasons before confirmation
 * - Dry-run default on execution; requires explicit confirmCleanup: true
 * - Yields if Daily Pipeline is active
 * - Safely cancels active historical backfill runs & acquires batch lease before deleting
 * - Re-verifies every candidate live against Firestore dependencies before deleting
 * - Bounded, idempotent Firestore batch deletions with durable audit records
 */

import { randomUUID } from 'node:crypto';
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
import { getPipelineLeaseStatus } from '../pipelineLease';
import { fetchArticlesForReadOnlyAudit } from './backlogCleanupEngine';
import { normalizeCanonicalUrlKey } from './failedArticleRecoveryService';

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

function collectGroundedArticleIds(container: any, out: Set<string>): void {
  if (!container || typeof container !== 'object') return;
  if (Array.isArray(container.sourceArticleIds)) {
    for (const id of container.sourceArticleIds) if (typeof id === 'string') out.add(id);
  }
  if (Array.isArray(container.articleIds)) {
    for (const id of container.articleIds) if (typeof id === 'string') out.add(id);
  }
  if (Array.isArray(container.citations)) {
    for (const c of container.citations) {
      if (c && typeof c.articleId === 'string') out.add(c.articleId);
    }
  }
  if (Array.isArray(container.groundedArticles)) {
    for (const ga of container.groundedArticles) {
      if (typeof ga === 'string') out.add(ga);
      else if (ga && typeof ga.articleId === 'string') out.add(ga.articleId);
    }
  }
  for (const key of ['headlineDevelopments', 'categoryBreakdowns', 'competitorMoves', 'developments']) {
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
 * Pure, deterministic, mutually exclusive classifier for ALL stored articles.
 * Every article receives exactly one disposition; protection rules ALWAYS take precedence.
 */
export function classifyArticlesForHistoricalCleanup(
  articles: Article[],
  graph: FullDependencyGraph,
  reportingWindow: { windowStartIso: string; windowEndIso: string }
): ClassifiedCleanupArticle[] {
  // Pass 1: Identify canonical URL owners, prioritizing protected articles first
  const canonicalUrlOwners = new Map<string, string>();
  const registerOwner = (art: Article) => {
    const key = normalizeCanonicalUrlKey(art.canonicalUrl);
    if (key && !canonicalUrlOwners.has(key)) {
      canonicalUrlOwners.set(key, art.id);
    }
  };

  // Analyzed / referenced / processing / daily-window / uncertain owners win canonical ownership first
  for (const art of articles) {
    const status = art.processingStatus || 'PENDING';
    const deps = graph.dependenciesByArticleId.get(art.id);
    if (status === 'ANALYZED' || status === 'PROCESSING' || deps?.hasAnyDependency) {
      registerOwner(art);
    }
  }
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
  // Then register earliest non-duplicate pending/failed records to detect duplicate historical rows
  const sortedForDup = [...articles].sort((a, b) =>
    (a.fetchedAt || a.publishedAt || a.id).localeCompare(b.fetchedAt || b.publishedAt || b.id)
  );
  for (const art of sortedForDup) {
    registerOwner(art);
  }

  // Pass 2: Mutually exclusive disposition assignment (Protection checks ALWAYS first)
  return articles.map((article) => {
    const status = article.processingStatus || 'PENDING';
    const deps = graph.dependenciesByArticleId.get(article.id) || EMPTY_DEPS;

    const rel = classifyStrategicRelevance({
      title: article.title,
      excerpt: article.excerpt,
      rawCategories: article.rawCategories,
      sourceName: article.sourceName,
      canonicalUrl: article.canonicalUrl,
    });

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

async function fetchLiveAuditSnapshot() {
  const [
    articles,
    articleAnalysis,
    stories,
    analyticsLedger,
    analyticsDaily,
    dailyBriefs,
    entityReview,
    sources,
  ] = await Promise.all([
    fetchArticlesForReadOnlyAudit(),
    fetchCollectionReadOnly('articleAnalysis'),
    fetchCollectionReadOnly('stories'),
    fetchCollectionReadOnly('analyticsLedger'),
    fetchCollectionReadOnly('analyticsDaily'),
    fetchCollectionReadOnly('dailyBriefs'),
    fetchCollectionReadOnly('entityReview'),
    fetchCollectionReadOnly('sources'),
  ]);

  const graph = buildFullDependencyGraph({
    articleAnalysis,
    stories,
    analyticsLedger,
    analyticsDaily,
    dailyBriefs,
    entityReview,
    sources,
  });

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
 * 1. STRICTLY READ-ONLY HISTORICAL BACKLOG CLEANUP PREVIEW
 *
 * Computes fresh, mutually exclusive counts and dependency checks across
 * all collections without performing any writes or Gemini calls.
 */
export async function previewHistoricalBacklogCleanup(options?: {
  sampleLimit?: number;
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

  for (const item of classified) {
    if (item.eligibleForDeletion) {
      eligibleCounts[item.disposition as HistoricalCleanupEligibleDisposition]++;
    } else {
      protectedCounts[item.disposition as HistoricalCleanupProtectedDisposition]++;
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

  return {
    auditedAt: new Date().toISOString(),
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
      activeProcessingArticles: protectedCounts.PROTECTED_ACTIVE_PROCESSING,
      historicalPendingRemaining: 0,
      historicalFailedRemaining: 0,
      actionableFailuresRemaining: 0,
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
  };
}

/**
 * 2. BOUNDED, IDEMPOTENT, ADMIN-ONLY HISTORICAL BACKLOG CLEANUP EXECUTION
 *
 * Defaults to dryRun: true. When dryRun === false, requires confirmCleanup === true,
 * checks Daily Pipeline priority lock, safely stops any active historical backfill
 * runs, acquires the backfill batch lease, re-verifies all candidates and dependencies
 * live, deletes strictly unreferenced eligible articles in bounded Firestore batches,
 * and writes a durable audit record. Zero Gemini API calls.
 */
export async function executeHistoricalBacklogCleanup(options: {
  dryRun?: boolean;
  confirmCleanup?: boolean;
  executedBy?: string;
  categories?: HistoricalCleanupEligibleDisposition[];
  maxDeletions?: number;
}): Promise<HistoricalBacklogCleanupResult> {
  const dryRun = options.dryRun !== false;
  const confirmCleanup = options.confirmCleanup === true;
  const executedBy = options.executedBy || 'admin';
  const maxDeletions =
    options.maxDeletions !== undefined && Number.isFinite(options.maxDeletions)
      ? Math.max(1, Math.min(Math.floor(options.maxDeletions), 5000))
      : 5000;

  if (!dryRun && !confirmCleanup) {
    throw new Error(
      'EXPLICIT_ADMIN_CONFIRMATION_REQUIRED: Confirmed historical cleanup requires confirmCleanup: true after preview.'
    );
  }

  // 1. Daily Pipeline priority guard
  const pipelineStatus = await getPipelineLeaseStatus();
  if (pipelineStatus.active) {
    throw new Error(
      'PIPELINE_ACTIVE_PRIORITY: The scheduled Daily Intelligence Pipeline is currently running. Historical cleanup cannot run during an active daily update.'
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
    const { classified } = await fetchLiveAuditSnapshot();
    const toDelete: ClassifiedCleanupArticle[] = [];
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

    for (const item of classified) {
      if (!item.eligibleForDeletion) {
        protectedByCategory[item.disposition as HistoricalCleanupProtectedDisposition]++;
        continue;
      }
      const disp = item.disposition as HistoricalCleanupEligibleDisposition;
      if (!allowedCategories.has(disp)) {
        skippedCount++;
        continue;
      }
      if (toDelete.length >= maxDeletions) {
        skippedCount++;
        continue;
      }
      toDelete.push(item);
      deletedByCategory[disp]++;
    }

    const protectedCount = Object.values(protectedByCategory).reduce((s, v) => s + v, 0);
    return {
      totalStored: classified.length,
      toDelete,
      deletedByCategory,
      protectedByCategory,
      protectedCount,
      skippedCount,
    };
  };

  if (dryRun) {
    const plan = await partitionLive();
    return {
      success: true,
      dryRun: true,
      auditId,
      executedAt: nowIso,
      executedBy,
      stoppedBackfillRunIds: [],
      deletedCount: plan.toDelete.length,
      deletedByCategory: plan.deletedByCategory,
      protectedCount: plan.protectedCount,
      protectedByCategory: plan.protectedByCategory,
      skippedCount: plan.skippedCount,
      remainingArticlesEstimate: plan.totalStored - plan.toDelete.length,
      geminiCallsUsed: 0,
      message: `Dry-run complete: ${plan.toDelete.length} unreferenced historical article(s) are eligible for cleanup and ${plan.protectedCount} article(s) are protected. No records were deleted.`,
    };
  }

  // 2. Acquire exclusive historical backfill batch lease so no backfill batch can run concurrently
  const db = getServerDb();
  const lock = db.doc('system/historicalBackfillBatchLease');
  const owner = `cleanup-${auditId}`;
  const leaseDurationMs = 15 * 60 * 1000;

  await db.runTransaction(async (transaction: any) => {
    const current = (await transaction.get(lock)).data();
    if (current && current.expiresAt > Date.now()) {
      throw new Error(
        'BACKFILL_LEASE_CONFLICT: A Historical Backfill batch or cleanup is currently executing. Wait for it to finish or cancel it before running cleanup.'
      );
    }
    transaction.set(lock, { owner, purpose: 'HISTORICAL_BACKLOG_CLEANUP', expiresAt: Date.now() + leaseDurationMs });
  });

  try {
    // 3. Safely stop any active or paused historical backfill checkpoints before deleting
    const stoppedBackfillRunIds = await cancelActiveHistoricalBackfillRuns(
      `Cancelled automatically prior to administrator Historical Backlog Cleanup (${auditId}).`
    );

    // 4. Re-verify Daily Pipeline lock and re-compute fresh live candidate & dependency checks under the lease
    const recheckedPipeline = await getPipelineLeaseStatus();
    if (recheckedPipeline.active) {
      throw new Error(
        'PIPELINE_ACTIVE_PRIORITY: The scheduled Daily Intelligence Pipeline started before cleanup began. Aborting cleanup safely.'
      );
    }

    const plan = await partitionLive();

    // 5. Bounded, idempotent Firestore batch deletions (CHUNK_SIZE = 100)
    const CHUNK_SIZE = 100;
    for (let i = 0; i < plan.toDelete.length; i += CHUNK_SIZE) {
      const chunk = plan.toDelete.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      for (const item of chunk) {
        batch.delete(db.collection('articles').doc(item.article.id));
      }
      await batch.commit();
    }

    // 6. Persist durable audit record
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
          stoppedBackfillRunIds,
          deletedCount: plan.toDelete.length,
          deletedByCategory: plan.deletedByCategory,
          protectedCount: plan.protectedCount,
          protectedByCategory: plan.protectedByCategory,
          skippedCount: plan.skippedCount,
          remainingArticlesEstimate: plan.totalStored - plan.toDelete.length,
          geminiCallsUsed: 0,
          deletedSample: plan.toDelete.slice(0, 100).map((item) => ({
            id: item.article.id,
            title: item.article.title || '',
            sourceName: item.article.sourceName || item.article.sourceId || '',
            processingStatus: item.article.processingStatus || 'PENDING',
            disposition: item.disposition,
            publishedAt: item.article.publishedAt || '',
          })),
        })
      );

    return {
      success: true,
      dryRun: false,
      auditId,
      executedAt: nowIso,
      executedBy,
      stoppedBackfillRunIds,
      deletedCount: plan.toDelete.length,
      deletedByCategory: plan.deletedByCategory,
      protectedCount: plan.protectedCount,
      protectedByCategory: plan.protectedByCategory,
      skippedCount: plan.skippedCount,
      remainingArticlesEstimate: plan.totalStored - plan.toDelete.length,
      geminiCallsUsed: 0,
      message:
        plan.toDelete.length > 0
          ? `Historical backlog cleanup complete: removed ${plan.toDelete.length} unreferenced historical article(s) while preserving ${plan.protectedCount} protected article(s) and all intelligence collections.`
          : `Historical backlog is already clean (${plan.protectedCount} protected article(s) preserved).`,
    };
  } finally {
    try {
      await db.runTransaction(async (transaction: any) => {
        if ((await transaction.get(lock)).data()?.owner === owner) {
          transaction.delete(lock);
        }
      });
    } catch (releaseErr) {
      console.warn('[Historical Backlog Cleanup] Could not release batch lease:', releaseErr);
    }
  }
}

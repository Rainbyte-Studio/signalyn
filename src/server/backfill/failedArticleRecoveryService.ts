/**
 * Signalyn Historical Failed Article Recovery & Cleanup Service
 *
 * Admin-only workflow for auditing, classifying, recovering, archiving, and
 * safely cleaning up historical failed articles without risking analyzed
 * intelligence, pending daily updates, or referenced records.
 */

import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import {
  Article,
  ArticleFailureHistoryEntry,
  FailedArticleActionResult,
  FailedArticleCategory,
  FailedArticleDependencyRefs,
  FailedArticlePreviewItem,
  FailedArticlesRecoveryPreview,
} from '../../types';
import { classifyStrategicRelevance } from '../strategicRelevanceGate';
import { getPipelineLeaseStatus } from '../pipelineLease';
import { assertNoHistoricalCleanupActive } from '../maintenanceLock';
import { isGeminiConfigured } from '../geminiClient';
import { fetchArticlesForReadOnlyAudit } from './backlogCleanupEngine';
import { db as clientDb } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

const RECOVERABLE_CATEGORIES = new Set<FailedArticleCategory>([
  'AUTH_ERROR_RECOVERABLE',
  'QUOTA_LIMIT_RECOVERABLE',
  'TRANSIENT_PROVIDER_RECOVERABLE',
]);

const ALL_CATEGORIES: FailedArticleCategory[] = [
  'ALREADY_ANALYZED_STALE_FAILURE',
  'AUTH_ERROR_RECOVERABLE',
  'QUOTA_LIMIT_RECOVERABLE',
  'TRANSIENT_PROVIDER_RECOVERABLE',
  'OUT_OF_SCOPE',
  'DUPLICATE_ARTICLE',
  'INVALID_OR_MISSING_CONTENT',
  'UNSUPPORTED_OR_CORRUPT',
  'EXHAUSTED_RETRIES_REVIEW',
  'OTHER_PERMANENT_REVIEW',
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

/**
 * Redacts potential secrets and turns verbose API error JSON into a concise summary.
 */
export function summarizeFailureError(rawError?: string | null): string {
  if (!rawError || !rawError.trim()) {
    return 'No error details recorded';
  }

  // Never expose API keys or bearer tokens
  const sanitized = rawError
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .trim();

  if (/401|unauthenticated|api key not valid|access_token_type_unsupported/i.test(sanitized)) {
    return 'Historical AI authentication failure (invalid or unsupported API key at time of run)';
  }
  if (/429|resource_exhausted|quota|rate limit|too many requests/i.test(sanitized)) {
    return 'Temporary AI provider quota or rate-limit failure';
  }
  if (/500|502|503|504|timeout|timed out|econnreset|etimedout|enotfound|overloaded|unavailable|fetch failed/i.test(sanitized)) {
    return 'Temporary AI provider availability or network timeout';
  }
  if (/400|invalid_argument|malformed|safety|blocked|unsupported/i.test(sanitized)) {
    return 'Unsupported or malformed article payload rejected by analysis engine';
  }

  return sanitized.length > 180 ? `${sanitized.slice(0, 177)}...` : sanitized;
}

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

export interface FailureClassificationContext {
  analyzedArticleIds: Set<string>;
  canonicalUrlOwners: Map<string, string>;
  dependenciesByArticleId: Map<string, FailedArticleDependencyRefs>;
}

/**
 * Pure deterministic classifier for failed historical articles.
 */
export function classifyFailedArticle(
  article: Article,
  context: FailureClassificationContext
): FailedArticlePreviewItem {
  const deps: FailedArticleDependencyRefs = context.dependenciesByArticleId.get(article.id) || {
    hasArticleAnalysis: context.analyzedArticleIds.has(article.id),
    referencedByStories: [],
    referencedByDailyBriefs: [],
    referencedByEntityReviews: [],
    hasAnyDependency: context.analyzedArticleIds.has(article.id),
  };

  const rel = classifyStrategicRelevance({
    title: article.title,
    excerpt: article.excerpt,
    rawCategories: article.rawCategories,
    sourceName: article.sourceName,
    canonicalUrl: article.canonicalUrl,
  });

  const rawError = article.analysisError || '';
  const attempts = article.analysisAttemptCount || 0;
  const normalizedUrl = normalizeCanonicalUrlKey(article.canonicalUrl);
  const canonicalOwner = normalizedUrl ? context.canonicalUrlOwners.get(normalizedUrl) : undefined;
  const duplicateOfArticleId = canonicalOwner && canonicalOwner !== article.id ? canonicalOwner : null;

  const titleMissing = !article.title || !article.title.trim();
  const excerptMissing = !article.excerpt || !article.excerpt.trim();

  let category: FailedArticleCategory;
  let recommendedAction: FailedArticlePreviewItem['recommendedAction'];
  let recoverable = false;
  let safeToArchive = true;

  if (deps.hasArticleAnalysis) {
    category = 'ALREADY_ANALYZED_STALE_FAILURE';
    recommendedAction = 'DISMISS_RESOLVED';
    recoverable = false;
    safeToArchive = false;
  } else if (titleMissing && excerptMissing) {
    category = 'INVALID_OR_MISSING_CONTENT';
    recommendedAction = 'ARCHIVE';
    recoverable = false;
    safeToArchive = true;
  } else if (duplicateOfArticleId) {
    category = 'DUPLICATE_ARTICLE';
    recommendedAction = 'ARCHIVE';
    recoverable = false;
    safeToArchive = true;
  } else if (rel.decision === 'OUT_OF_SCOPE') {
    category = 'OUT_OF_SCOPE';
    recommendedAction = 'ARCHIVE';
    recoverable = false;
    safeToArchive = true;
  } else if (/401|unauthenticated|api key not valid|access_token_type_unsupported|permission_denied|api_key_invalid|invalid api key/i.test(rawError)) {
    category = 'AUTH_ERROR_RECOVERABLE';
    recommendedAction = 'RETRY_RECOVERABLE';
    recoverable = true;
    safeToArchive = true;
  } else if (/429|resource_exhausted|quota|rate limit|too many requests/i.test(rawError)) {
    category = 'QUOTA_LIMIT_RECOVERABLE';
    recommendedAction = 'RETRY_RECOVERABLE';
    recoverable = true;
    safeToArchive = true;
  } else if (/500|502|503|504|timeout|timed out|network|econnreset|etimedout|enotfound|overloaded|unavailable|fetch failed|socket hang up/i.test(rawError)) {
    category = 'TRANSIENT_PROVIDER_RECOVERABLE';
    recommendedAction = 'RETRY_RECOVERABLE';
    recoverable = true;
    safeToArchive = true;
  } else if (/400|invalid_argument|malformed|safety|blocked|unsupported|json|schema|parse/i.test(rawError)) {
    category = 'UNSUPPORTED_OR_CORRUPT';
    recommendedAction = 'ARCHIVE';
    recoverable = false;
    safeToArchive = true;
  } else if (attempts >= 3) {
    category = 'EXHAUSTED_RETRIES_REVIEW';
    recommendedAction = 'MANUAL_REVIEW';
    recoverable = false;
    safeToArchive = true;
  } else {
    category = 'OTHER_PERMANENT_REVIEW';
    recommendedAction = 'MANUAL_REVIEW';
    recoverable = false;
    safeToArchive = true;
  }

  const obsoleteForDeletion =
    category === 'INVALID_OR_MISSING_CONTENT' ||
    category === 'DUPLICATE_ARTICLE' ||
    category === 'OUT_OF_SCOPE' ||
    category === 'UNSUPPORTED_OR_CORRUPT';

  const safeToDelete =
    (article.processingStatus === 'FAILED' || article.processingStatus === 'ARCHIVED_FAILED') &&
    !deps.hasAnyDependency &&
    obsoleteForDeletion;

  return {
    id: article.id,
    title: article.title || '(Untitled article)',
    sourceName: article.sourceName || article.sourceId || 'Unknown Source',
    publishedAt: article.publishedAt || '',
    canonicalUrl: article.canonicalUrl || '',
    processingStatus: article.processingStatus || 'FAILED',
    analysisAttemptCount: attempts,
    retryEligible: article.retryEligible !== false,
    lastAnalysisAttemptAt: article.lastAnalysisAttemptAt || null,
    errorSummary: summarizeFailureError(rawError),
    category,
    strategicDecision: rel.decision,
    strategicCategory: rel.category,
    recommendedAction,
    recoverable,
    safeToArchive,
    safeToDelete,
    duplicateOfArticleId,
    dependencies: deps,
  };
}

async function fetchCollectionDocsReadOnly(collectionName: string): Promise<Array<{ id: string; data: Record<string, any> }>> {
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

/**
 * Builds dependency maps across articleAnalysis, stories, dailyBriefs, and entityReview.
 */
async function buildDependencyContext(allArticles: Article[]): Promise<FailureClassificationContext> {
  const [analysisDocs, storyDocs, briefDocs, reviewDocs] = await Promise.all([
    fetchCollectionDocsReadOnly('articleAnalysis').catch(() => []),
    fetchCollectionDocsReadOnly('stories').catch(() => []),
    fetchCollectionDocsReadOnly('dailyBriefs').catch(() => []),
    fetchCollectionDocsReadOnly('entityReview').catch(() => []),
  ]);

  const analyzedArticleIds = new Set<string>(analysisDocs.map((d) => d.id));
  const canonicalUrlOwners = new Map<string, string>();

  // Prefer ANALYZED or PENDING articles as canonical owners for duplicate detection
  for (const art of allArticles) {
    const status = art.processingStatus || 'PENDING';
    if (status === 'ANALYZED' || status === 'PENDING') {
      const key = normalizeCanonicalUrlKey(art.canonicalUrl);
      if (key && !canonicalUrlOwners.has(key)) {
        canonicalUrlOwners.set(key, art.id);
      }
    }
  }

  const dependenciesByArticleId = new Map<string, FailedArticleDependencyRefs>();
  const ensureDeps = (articleId: string): FailedArticleDependencyRefs => {
    let existing = dependenciesByArticleId.get(articleId);
    if (!existing) {
      const hasAnalysis = analyzedArticleIds.has(articleId);
      existing = {
        hasArticleAnalysis: hasAnalysis,
        referencedByStories: [],
        referencedByDailyBriefs: [],
        referencedByEntityReviews: [],
        hasAnyDependency: hasAnalysis,
      };
      dependenciesByArticleId.set(articleId, existing);
    }
    return existing;
  };

  for (const id of analyzedArticleIds) {
    ensureDeps(id);
  }

  for (const story of storyDocs) {
    const ids = new Set<string>();
    if (Array.isArray(story.data.articleIds)) {
      for (const aid of story.data.articleIds) if (typeof aid === 'string') ids.add(aid);
    }
    if (Array.isArray(story.data.articles)) {
      for (const a of story.data.articles) {
        if (typeof a === 'string') ids.add(a);
        else if (a && typeof a.articleId === 'string') ids.add(a.articleId);
      }
    }
    for (const aid of ids) {
      const dep = ensureDeps(aid);
      dep.referencedByStories.push(story.id);
      dep.hasAnyDependency = true;
    }
  }

  for (const brief of briefDocs) {
    const ids = new Set<string>();
    if (Array.isArray(brief.data.sourceArticleIds)) {
      for (const aid of brief.data.sourceArticleIds) if (typeof aid === 'string') ids.add(aid);
    }
    if (Array.isArray(brief.data.articleIds)) {
      for (const aid of brief.data.articleIds) if (typeof aid === 'string') ids.add(aid);
    }
    if (Array.isArray(brief.data.citations)) {
      for (const c of brief.data.citations) {
        if (c && typeof c.articleId === 'string') ids.add(c.articleId);
      }
    }
    for (const aid of ids) {
      const dep = ensureDeps(aid);
      dep.referencedByDailyBriefs.push(brief.id);
      dep.hasAnyDependency = true;
    }
  }

  for (const rev of reviewDocs) {
    const ids = new Set<string>();
    if (typeof rev.data.articleId === 'string') ids.add(rev.data.articleId);
    if (Array.isArray(rev.data.articleIds)) {
      for (const aid of rev.data.articleIds) if (typeof aid === 'string') ids.add(aid);
    }
    for (const aid of ids) {
      const dep = ensureDeps(aid);
      dep.referencedByEntityReviews.push(rev.id);
      dep.hasAnyDependency = true;
    }
  }

  return {
    analyzedArticleIds,
    canonicalUrlOwners,
    dependenciesByArticleId,
  };
}

/**
 * 1. READ-ONLY PREVIEW & CLASSIFICATION OF FAILED HISTORICAL ARTICLES
 */
export async function previewFailedArticlesRecovery(options?: {
  limit?: number;
  category?: FailedArticleCategory | 'ALL';
  includeArchived?: boolean;
}): Promise<FailedArticlesRecoveryPreview> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
  const allArticles = await fetchArticlesForReadOnlyAudit();
  const context = await buildDependencyContext(allArticles);

  const failedArticles = allArticles.filter((a) => a.processingStatus === 'FAILED');
  const archivedFailedArticles = allArticles.filter((a) => a.processingStatus === 'ARCHIVED_FAILED');

  const countsByCategory = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<
    FailedArticleCategory,
    number
  >;

  const classifiedAll: FailedArticlePreviewItem[] = failedArticles.map((art) => {
    const item = classifyFailedArticle(art, context);
    countsByCategory[item.category]++;
    return item;
  });

  const archivedItems: FailedArticlePreviewItem[] = options?.includeArchived
    ? archivedFailedArticles.map((art) => classifyFailedArticle(art, context))
    : [];

  const combined = [...classifiedAll, ...archivedItems];
  const filtered =
    options?.category && options.category !== 'ALL'
      ? combined.filter((item) => item.category === options.category)
      : combined;

  filtered.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  const authErrorCount = countsByCategory.AUTH_ERROR_RECOVERABLE;
  const quotaErrorCount = countsByCategory.QUOTA_LIMIT_RECOVERABLE;
  const transientErrorCount = countsByCategory.TRANSIENT_PROVIDER_RECOVERABLE;
  const recoverableCount = authErrorCount + quotaErrorCount + transientErrorCount;
  const alreadyAnalyzedCount = countsByCategory.ALREADY_ANALYZED_STALE_FAILURE;
  const outOfScopeCount = countsByCategory.OUT_OF_SCOPE;
  const duplicateCount = countsByCategory.DUPLICATE_ARTICLE;
  const invalidOrObsoleteCount =
    countsByCategory.INVALID_OR_MISSING_CONTENT +
    countsByCategory.UNSUPPORTED_OR_CORRUPT +
    outOfScopeCount +
    duplicateCount;
  const manualReviewCount =
    countsByCategory.EXHAUSTED_RETRIES_REVIEW + countsByCategory.OTHER_PERMANENT_REVIEW;

  return {
    auditedAt: new Date().toISOString(),
    geminiConfigured: isGeminiConfigured(),
    totalFailed: failedArticles.length,
    totalArchivedFailed: archivedFailedArticles.length,
    recoverableCount,
    authErrorCount,
    quotaErrorCount,
    transientErrorCount,
    alreadyAnalyzedCount,
    outOfScopeCount,
    duplicateCount,
    invalidOrObsoleteCount,
    manualReviewCount,
    eligibleForArchivalCount: classifiedAll.filter((i) => i.safeToArchive).length,
    safeToDeleteCount: classifiedAll.filter((i) => i.safeToDelete).length,
    referencedByDependenciesCount: classifiedAll.filter((i) => i.dependencies.hasAnyDependency).length,
    countsByCategory,
    items: filtered.slice(0, limit),
    totalItemsAvailable: filtered.length,
  };
}

function appendFailureHistory(
  article: Article,
  recoveryAction: ArticleFailureHistoryEntry['recoveryAction'],
  auditId: string,
  nowIso: string
): ArticleFailureHistoryEntry[] {
  const existing = Array.isArray(article.originalFailureHistory) ? [...article.originalFailureHistory] : [];
  existing.push({
    failedAt: article.lastAnalysisAttemptAt || article.updatedAt || nowIso,
    error: summarizeFailureError(article.analysisError),
    attemptCount: article.analysisAttemptCount || 1,
    recoveryAction,
    recoveryAuditId: auditId,
  });
  return existing.slice(-10);
}

async function writeRecoveryAuditRecord(auditId: string, payload: Record<string, any>): Promise<void> {
  const db = getServerDb();
  await db
    .collection('system')
    .doc('backfillRecoveryAudit')
    .collection('runs')
    .doc(auditId)
    .set(cleanServerData({ auditId, ...payload }));
}

/**
 * 2. REQUEUE RECOVERABLE FAILED ARTICLES (Admin-Only, Preview/Dry-Run by Default)
 *
 * Requeues historical auth/quota/transient failures back to PENDING for bounded
 * Historical Backfill processing without re-analyzing already-analyzed articles
 * and preserving original failure audit history.
 */
export async function requeueRecoverableFailedArticles(options: {
  articleIds?: string[];
  categories?: FailedArticleCategory[];
  dryRun?: boolean;
  confirm?: boolean;
  executedBy?: string;
  maxItems?: number;
}): Promise<FailedArticleActionResult> {
  const dryRun = options.dryRun !== false;
  const confirm = options.confirm === true;
  const executedBy = options.executedBy || 'admin';
  const maxItems = Math.max(1, Math.min(options.maxItems ?? 500, 1000));

  await assertNoHistoricalCleanupActive('failed article recovery');

  const leaseStatus = await getPipelineLeaseStatus();
  if (leaseStatus.active) {
    throw new Error(
      'PIPELINE_ACTIVE_PRIORITY: The scheduled Daily Update is currently active. Failed article recovery paused.'
    );
  }

  if (!dryRun && !confirm) {
    throw new Error('EXPLICIT_ADMIN_CONFIRMATION_REQUIRED: Explicit administrator confirmation is required.');
  }

  const allArticles = await fetchArticlesForReadOnlyAudit();
  const context = await buildDependencyContext(allArticles);
  const articleMap = new Map(allArticles.map((a) => [a.id, a]));

  const requestedCategories =
    options.categories && options.categories.length > 0
      ? new Set(options.categories)
      : RECOVERABLE_CATEGORIES;

  const targetArticles: Article[] =
    options.articleIds && options.articleIds.length > 0
      ? options.articleIds.map((id) => articleMap.get(id)).filter((a): a is Article => Boolean(a))
      : allArticles.filter((a) => a.processingStatus === 'FAILED');

  const eligible: Array<{ article: Article; item: FailedArticlePreviewItem }> = [];
  const skippedReasons: Array<{ articleId: string; reason: string }> = [];
  const blockedReasons: Array<{ articleId: string; reason: string }> = [];

  for (const art of targetArticles) {
    if (art.processingStatus !== 'FAILED') {
      skippedReasons.push({ articleId: art.id, reason: `Status is ${art.processingStatus || 'PENDING'}, not FAILED.` });
      continue;
    }

    const classified = classifyFailedArticle(art, context);
    if (classified.dependencies.hasArticleAnalysis) {
      blockedReasons.push({
        articleId: art.id,
        reason: 'Article already has a persisted analysis record. Use Dismiss Resolved instead.',
      });
      continue;
    }

    if (!RECOVERABLE_CATEGORIES.has(classified.category) || !requestedCategories.has(classified.category)) {
      skippedReasons.push({
        articleId: art.id,
        reason: `Category ${classified.category} is not eligible for automatic requeue.`,
      });
      continue;
    }

    if (eligible.length < maxItems) {
      eligible.push({ article: art, item: classified });
    }
  }

  const includesAuthFailures = eligible.some((e) => e.item.category === 'AUTH_ERROR_RECOVERABLE');
  if (includesAuthFailures && !isGeminiConfigured()) {
    throw new Error(
      'GEMINI_NOT_CONFIGURED: Cannot requeue authentication failures while AI provider credentials are not configured.'
    );
  }

  const auditId = `recovery-requeue-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();
  const affectedArticleIds = eligible.map((e) => e.article.id);

  if (dryRun) {
    return {
      success: true,
      action: 'REQUEUE_RECOVERABLE',
      dryRun: true,
      auditId,
      executedAt: nowIso,
      processedCount: eligible.length,
      skippedCount: skippedReasons.length,
      blockedCount: blockedReasons.length,
      affectedArticleIds,
      skippedReasons: skippedReasons.slice(0, 50),
      blockedReasons: blockedReasons.slice(0, 50),
      message: `Preview: ${eligible.length} recoverable failed article(s) are ready to return to the Historical Backfill queue. No changes were written.`,
    };
  }

  const db = getServerDb();
  const CHUNK_SIZE = 100;
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
    const chunk = eligible.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const { article } of chunk) {
      const ref = db.collection('articles').doc(article.id);
      batch.update(
        ref,
        cleanServerData({
          processingStatus: 'PENDING',
          retryEligible: true,
          analysisAttemptCount: 0,
          analysisError: null,
          failureDisposition: 'REQUEUED',
          requeuedAt: nowIso,
          requeuedBy: executedBy,
          originalFailureHistory: appendFailureHistory(article, 'REQUEUED', auditId, nowIso),
          updatedAt: nowIso,
        })
      );
    }
    await batch.commit();
  }

  await writeRecoveryAuditRecord(auditId, {
    action: 'REQUEUE_RECOVERABLE',
    executedBy,
    executedAt: nowIso,
    processedCount: eligible.length,
    skippedCount: skippedReasons.length,
    blockedCount: blockedReasons.length,
    affectedArticleIds: affectedArticleIds.slice(0, 250),
  });

  return {
    success: true,
    action: 'REQUEUE_RECOVERABLE',
    dryRun: false,
    auditId,
    executedAt: nowIso,
    processedCount: eligible.length,
    skippedCount: skippedReasons.length,
    blockedCount: blockedReasons.length,
    affectedArticleIds,
    skippedReasons: skippedReasons.slice(0, 50),
    blockedReasons: blockedReasons.slice(0, 50),
    message: `Returned ${eligible.length} recoverable article(s) to the Historical Backfill queue.`,
  };
}

/**
 * 3. DISMISS RESOLVED FAILURES (Reconciles FAILED -> ANALYZED when articleAnalysis exists)
 */
export async function dismissResolvedFailedArticles(options: {
  articleIds?: string[];
  dryRun?: boolean;
  confirm?: boolean;
  executedBy?: string;
}): Promise<FailedArticleActionResult> {
  const dryRun = options.dryRun !== false;
  const confirm = options.confirm === true;
  const executedBy = options.executedBy || 'admin';

  await assertNoHistoricalCleanupActive('dismiss resolved failed articles');

  if (!dryRun && !confirm) {
    throw new Error('EXPLICIT_ADMIN_CONFIRMATION_REQUIRED: Explicit administrator confirmation is required.');
  }

  const allArticles = await fetchArticlesForReadOnlyAudit();
  const context = await buildDependencyContext(allArticles);
  const articleMap = new Map(allArticles.map((a) => [a.id, a]));

  const targets: Article[] =
    options.articleIds && options.articleIds.length > 0
      ? options.articleIds.map((id) => articleMap.get(id)).filter((a): a is Article => Boolean(a))
      : allArticles.filter((a) => a.processingStatus === 'FAILED');

  const eligible: Article[] = [];
  const skippedReasons: Array<{ articleId: string; reason: string }> = [];

  for (const art of targets) {
    if (art.processingStatus !== 'FAILED') {
      skippedReasons.push({ articleId: art.id, reason: `Status is ${art.processingStatus || 'PENDING'}, not FAILED.` });
      continue;
    }
    if (!context.analyzedArticleIds.has(art.id)) {
      skippedReasons.push({ articleId: art.id, reason: 'No existing analysis record found for this article.' });
      continue;
    }
    eligible.push(art);
  }

  const auditId = `recovery-dismiss-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();
  const affectedArticleIds = eligible.map((a) => a.id);

  if (dryRun) {
    return {
      success: true,
      action: 'DISMISS_RESOLVED',
      dryRun: true,
      auditId,
      executedAt: nowIso,
      processedCount: eligible.length,
      skippedCount: skippedReasons.length,
      blockedCount: 0,
      affectedArticleIds,
      skippedReasons: skippedReasons.slice(0, 50),
      blockedReasons: [],
      message: `Preview: ${eligible.length} stale failure record(s) already have completed analyses and can be marked Analyzed.`,
    };
  }

  const db = getServerDb();
  const CHUNK_SIZE = 100;
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
    const chunk = eligible.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const article of chunk) {
      batch.update(
        db.collection('articles').doc(article.id),
        cleanServerData({
          processingStatus: 'ANALYZED',
          retryEligible: false,
          analysisError: null,
          failureDisposition: 'DISMISSED_RESOLVED',
          originalFailureHistory: appendFailureHistory(article, 'DISMISSED_RESOLVED', auditId, nowIso),
          updatedAt: nowIso,
        })
      );
    }
    await batch.commit();
  }

  await writeRecoveryAuditRecord(auditId, {
    action: 'DISMISS_RESOLVED',
    executedBy,
    executedAt: nowIso,
    processedCount: eligible.length,
    affectedArticleIds: affectedArticleIds.slice(0, 250),
  });

  return {
    success: true,
    action: 'DISMISS_RESOLVED',
    dryRun: false,
    auditId,
    executedAt: nowIso,
    processedCount: eligible.length,
    skippedCount: skippedReasons.length,
    blockedCount: 0,
    affectedArticleIds,
    skippedReasons: skippedReasons.slice(0, 50),
    blockedReasons: [],
    message: `Reconciled ${eligible.length} already-analyzed article(s) to Analyzed status.`,
  };
}

/**
 * 4. NON-DESTRUCTIVE ARCHIVAL OF OBSOLETE OR UNRECOVERABLE FAILED ARTICLES
 */
export async function archiveFailedArticles(options: {
  articleIds?: string[];
  categories?: FailedArticleCategory[];
  reason?: string;
  dryRun?: boolean;
  confirm?: boolean;
  executedBy?: string;
}): Promise<FailedArticleActionResult> {
  const dryRun = options.dryRun !== false;
  const confirm = options.confirm === true;
  const executedBy = options.executedBy || 'admin';
  const reason = options.reason || 'Archived by administrator during historical failure review';

  await assertNoHistoricalCleanupActive('archive failed articles');

  if (!dryRun && !confirm) {
    throw new Error('EXPLICIT_ADMIN_CONFIRMATION_REQUIRED: Explicit administrator confirmation is required.');
  }

  const allArticles = await fetchArticlesForReadOnlyAudit();
  const context = await buildDependencyContext(allArticles);
  const articleMap = new Map(allArticles.map((a) => [a.id, a]));

  const allowedCategories =
    options.categories && options.categories.length > 0 ? new Set(options.categories) : null;

  const targets: Article[] =
    options.articleIds && options.articleIds.length > 0
      ? options.articleIds.map((id) => articleMap.get(id)).filter((a): a is Article => Boolean(a))
      : allArticles.filter((a) => a.processingStatus === 'FAILED');

  const eligible: Article[] = [];
  const skippedReasons: Array<{ articleId: string; reason: string }> = [];
  const blockedReasons: Array<{ articleId: string; reason: string }> = [];

  for (const art of targets) {
    const status = art.processingStatus || 'PENDING';
    if (status === 'ANALYZED' || status === 'PENDING' || status === 'PROCESSING') {
      blockedReasons.push({
        articleId: art.id,
        reason: `Protected status (${status}): analyzed and pending articles cannot be archived as failures.`,
      });
      continue;
    }
    if (status !== 'FAILED') {
      skippedReasons.push({ articleId: art.id, reason: `Article status is already ${status}.` });
      continue;
    }

    const classified = classifyFailedArticle(art, context);
    if (classified.dependencies.hasArticleAnalysis) {
      blockedReasons.push({
        articleId: art.id,
        reason: 'Article has an existing analysis record. Use Dismiss Resolved instead of archiving.',
      });
      continue;
    }
    if (allowedCategories && !allowedCategories.has(classified.category)) {
      skippedReasons.push({ articleId: art.id, reason: `Category ${classified.category} not selected for archival.` });
      continue;
    }

    eligible.push(art);
  }

  const auditId = `recovery-archive-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();
  const affectedArticleIds = eligible.map((a) => a.id);

  if (dryRun) {
    return {
      success: true,
      action: 'ARCHIVE',
      dryRun: true,
      auditId,
      executedAt: nowIso,
      processedCount: eligible.length,
      skippedCount: skippedReasons.length,
      blockedCount: blockedReasons.length,
      affectedArticleIds,
      skippedReasons: skippedReasons.slice(0, 50),
      blockedReasons: blockedReasons.slice(0, 50),
      message: `Preview: ${eligible.length} failed article(s) can be safely archived without deleting historical records.`,
    };
  }

  const db = getServerDb();
  const CHUNK_SIZE = 100;
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
    const chunk = eligible.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const article of chunk) {
      batch.update(
        db.collection('articles').doc(article.id),
        cleanServerData({
          processingStatus: 'ARCHIVED_FAILED',
          retryEligible: false,
          failureDisposition: 'ARCHIVED',
          archivedAt: nowIso,
          archivedBy: executedBy,
          archiveReason: reason,
          originalFailureHistory: appendFailureHistory(article, 'ARCHIVED', auditId, nowIso),
          updatedAt: nowIso,
        })
      );
    }
    await batch.commit();
  }

  await writeRecoveryAuditRecord(auditId, {
    action: 'ARCHIVE',
    executedBy,
    executedAt: nowIso,
    reason,
    processedCount: eligible.length,
    blockedCount: blockedReasons.length,
    affectedArticleIds: affectedArticleIds.slice(0, 250),
  });

  return {
    success: true,
    action: 'ARCHIVE',
    dryRun: false,
    auditId,
    executedAt: nowIso,
    processedCount: eligible.length,
    skippedCount: skippedReasons.length,
    blockedCount: blockedReasons.length,
    affectedArticleIds,
    skippedReasons: skippedReasons.slice(0, 50),
    blockedReasons: blockedReasons.slice(0, 50),
    message: `Archived ${eligible.length} failed article(s). They are excluded from active failure alerts while preserving full history.`,
  };
}

/**
 * 5. STRICTLY GUARDED PERMANENT DELETION OF UNREFERENCED OBSOLETE FAILURES
 *
 * Hard-blocks analyzed articles, pending articles, and any article referenced
 * by Stories, Daily Briefs, Article Analysis, or Entity Reviews.
 */
export async function deleteObsoleteFailedArticles(options: {
  articleIds: string[];
  dryRun?: boolean;
  confirmDelete?: boolean;
  executedBy?: string;
}): Promise<FailedArticleActionResult> {
  const dryRun = options.dryRun !== false;
  const confirmDelete = options.confirmDelete === true;
  const executedBy = options.executedBy || 'admin';

  if (!Array.isArray(options.articleIds) || options.articleIds.length === 0) {
    throw new Error('Explicit articleIds list is required for guarded deletion.');
  }

  await assertNoHistoricalCleanupActive('delete obsolete failed articles');

  if (!dryRun && !confirmDelete) {
    throw new Error(
      'EXPLICIT_DELETE_CONFIRMATION_REQUIRED: Permanent deletion requires confirmDelete: true after preview.'
    );
  }

  const allArticles = await fetchArticlesForReadOnlyAudit();
  const context = await buildDependencyContext(allArticles);
  const articleMap = new Map(allArticles.map((a) => [a.id, a]));

  const eligible: Article[] = [];
  const skippedReasons: Array<{ articleId: string; reason: string }> = [];
  const blockedReasons: Array<{ articleId: string; reason: string }> = [];

  for (const id of Array.from(new Set(options.articleIds))) {
    const art = articleMap.get(id);
    if (!art) {
      skippedReasons.push({ articleId: id, reason: 'Article not found.' });
      continue;
    }

    const status = art.processingStatus || 'PENDING';
    if (status !== 'FAILED' && status !== 'ARCHIVED_FAILED') {
      blockedReasons.push({
        articleId: id,
        reason: `Protected status (${status}): only FAILED or ARCHIVED_FAILED records may be permanently deleted.`,
      });
      continue;
    }

    const deps = context.dependenciesByArticleId.get(id);
    if (deps?.hasAnyDependency) {
      const refParts: string[] = [];
      if (deps.hasArticleAnalysis) refParts.push('analysis');
      if (deps.referencedByStories.length > 0) refParts.push(`${deps.referencedByStories.length} story(ies)`);
      if (deps.referencedByDailyBriefs.length > 0) refParts.push(`${deps.referencedByDailyBriefs.length} daily brief(s)`);
      if (deps.referencedByEntityReviews.length > 0) refParts.push(`${deps.referencedByEntityReviews.length} entity review(s)`);
      blockedReasons.push({
        articleId: id,
        reason: `Blocked by active dependencies: ${refParts.join(', ')}.`,
      });
      continue;
    }

    const classified = classifyFailedArticle(art, context);
    if (classified.recoverable) {
      blockedReasons.push({
        articleId: id,
        reason: `Article is classified as recoverable (${classified.category}). Requeue or archive it instead of deleting.`,
      });
      continue;
    }

    eligible.push(art);
  }

  const auditId = `recovery-delete-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();
  const affectedArticleIds = eligible.map((a) => a.id);

  if (dryRun) {
    return {
      success: true,
      action: 'DELETE_OBSOLETE',
      dryRun: true,
      auditId,
      executedAt: nowIso,
      processedCount: eligible.length,
      skippedCount: skippedReasons.length,
      blockedCount: blockedReasons.length,
      affectedArticleIds,
      skippedReasons: skippedReasons.slice(0, 50),
      blockedReasons: blockedReasons.slice(0, 50),
      message: `Preview: ${eligible.length} unreferenced obsolete failed article(s) passed safety checks (${blockedReasons.length} blocked). No deletions executed.`,
    };
  }

  const db = getServerDb();
  const CHUNK_SIZE = 100;
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
    const chunk = eligible.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const article of chunk) {
      batch.delete(db.collection('articles').doc(article.id));
    }
    await batch.commit();
  }

  await writeRecoveryAuditRecord(auditId, {
    action: 'DELETE_OBSOLETE',
    executedBy,
    executedAt: nowIso,
    processedCount: eligible.length,
    blockedCount: blockedReasons.length,
    deletedArticlesMetadata: eligible.slice(0, 100).map((a) => ({
      id: a.id,
      title: a.title,
      canonicalUrl: a.canonicalUrl,
      sourceName: a.sourceName || a.sourceId || '',
      originalStatus: a.processingStatus,
      errorSummary: summarizeFailureError(a.analysisError),
    })),
  });

  return {
    success: true,
    action: 'DELETE_OBSOLETE',
    dryRun: false,
    auditId,
    executedAt: nowIso,
    processedCount: eligible.length,
    skippedCount: skippedReasons.length,
    blockedCount: blockedReasons.length,
    affectedArticleIds,
    skippedReasons: skippedReasons.slice(0, 50),
    blockedReasons: blockedReasons.slice(0, 50),
    message: `Permanently deleted ${eligible.length} unreferenced obsolete failed article(s). ${blockedReasons.length} protected article(s) were preserved.`,
  };
}

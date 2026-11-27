/**
 * Signalyn Phase 6E: Safe Legacy Out-of-Scope Cleanup & Uncertain Intelligence Engine
 *
 * Provides:
 * 1. Safe legacy out-of-scope article cleanup (transitions 1065 historical non-hardware PENDING articles to SKIPPED_STRATEGIC_SCOPE)
 * 2. Dry-run mode by default with explicit admin confirmation required for database mutation
 * 3. Strict preservation of raw article content, hashes, and existing analyses
 * 4. Zero Gemini LLM calls during cleanup (pure Firestore batch status update)
 * 5. Bounded Firestore write batches with persistent audit logs
 * 6. Preemption by scheduled Daily Pipeline lease
 * 7. Conservative corporate/ecosystem preview and classification for 62 uncertain articles
 */

import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import {
  Article,
  OutOfScopeCleanupPreview,
  OutOfScopeCleanupResult,
  OutOfScopeCleanupCandidate,
  UncertainArticlesPreview,
  UncertainArticleCandidate,
} from '../../types';
import { classifyStrategicRelevance } from '../strategicRelevanceGate';
import { getPipelineLeaseStatus } from '../pipelineLease';
import { db as clientDb } from '../../firebase';
import { collection, getDocs, query, where, limit as firestoreLimit } from 'firebase/firestore';

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
 * Read-only helper to load stored articles for inventory and candidate previews.
 * Uses Admin SDK primary and falls back to read-only client SDK query against the
 * same Firestore database when the preview container's ambient ADC lacks cross-project IAM read roles.
 */
export async function fetchArticlesForReadOnlyAudit(options?: {
  statusIn?: string[];
  maxDocs?: number;
}): Promise<Article[]> {
  try {
    const db = getServerDb();
    let q: any = db.collection('articles');
    if (options?.statusIn && options.statusIn.length === 1) {
      q = q.where('processingStatus', '==', options.statusIn[0]);
    } else if (options?.statusIn && options.statusIn.length > 1) {
      q = q.where('processingStatus', 'in', options.statusIn);
    }
    if (options?.maxDocs) {
      q = q.limit(options.maxDocs);
    }
    const snap = await q.get();
    const articles: Article[] = [];
    snap.forEach((doc: any) => {
      articles.push({ ...(doc.data() as Article), id: doc.id });
    });
    return articles;
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      throw err;
    }
    // Read-only fallback via client SDK (articles has allow read: if true in firestore.rules)
    const constraints: any[] = [];
    if (options?.statusIn && options.statusIn.length === 1) {
      constraints.push(where('processingStatus', '==', options.statusIn[0]));
    } else if (options?.statusIn && options.statusIn.length > 1) {
      constraints.push(where('processingStatus', 'in', options.statusIn));
    }
    if (options?.maxDocs) {
      constraints.push(firestoreLimit(options.maxDocs));
    }
    const q = constraints.length > 0
      ? query(collection(clientDb, 'articles'), ...constraints)
      : collection(clientDb, 'articles');
    const snap = await getDocs(q);
    const articles: Article[] = [];
    snap.forEach((doc) => {
      articles.push({ ...(doc.data() as Article), id: doc.id });
    });
    return articles;
  }
}

/**
 * Classifies Corporate / Ecosystem news lacking explicit mobile hardware models
 * into conservative subcategories.
 */
export function classifyCorporateEcosystemSubtype(text: string): {
  recommendation: 'CONSUMER_ECOSYSTEM_REVIEW' | 'ENTERPRISE_EXCLUDED' | 'AUTOMOTIVE_EXCLUDED' | 'GENERAL_CORPORATE_EXCLUDED';
  supplyChainRelevance: boolean;
  notes: string;
} {
  const lower = text.toLowerCase();

  // Consumer hardware supply-chain / components (chips, displays, sensors, batteries)
  if (
    /chip|soc|semiconductor|wafer|foundry|tsmc|smic|kirin|snapdragon|exynos|display|oled|sensor|lens|camera sensor|battery|modem|5g modem/i.test(
      lower
    )
  ) {
    return {
      recommendation: 'CONSUMER_ECOSYSTEM_REVIEW',
      supplyChainRelevance: true,
      notes: 'Hardware component / supply-chain development relevant to consumer mobile devices',
    };
  }

  // Consumer mobile OS / App ecosystems (HarmonyOS Next, iOS, Android)
  if (
    /harmonyos|harmonyos next|hongmeng|emui|ios 18|ios 19|android 15|android 16|app gallery|app store|play store|wear os/i.test(
      lower
    )
  ) {
    return {
      recommendation: 'CONSUMER_ECOSYSTEM_REVIEW',
      supplyChainRelevance: false,
      notes: 'Consumer mobile operating system or application ecosystem development',
    };
  }

  // Automotive / EV
  if (/auto|ev|electric vehicle|vehicle|car|driving|autonomous|aito|luxeed|stelato|tesla|byd/i.test(lower)) {
    return {
      recommendation: 'AUTOMOTIVE_EXCLUDED',
      supplyChainRelevance: false,
      notes: 'Automotive / EV business line (outside consumer mobile hardware)',
    };
  }

  // Enterprise cloud / B2B telecom networks
  if (/cloud|server|data center|telecom network|base station|ran|carrier|enterprise/i.test(lower)) {
    return {
      recommendation: 'ENTERPRISE_EXCLUDED',
      supplyChainRelevance: false,
      notes: 'Enterprise cloud / B2B telecom infrastructure (outside consumer mobile hardware)',
    };
  }

  return {
    recommendation: 'GENERAL_CORPORATE_EXCLUDED',
    supplyChainRelevance: false,
    notes: 'General corporate/financial announcement with no direct consumer hardware tie',
  };
}

/**
 * Previews upcoming legacy out-of-scope candidate articles without modifying any data.
 */
export async function previewOutOfScopeCleanup(limit: number = 100): Promise<OutOfScopeCleanupPreview> {
  const pendingArticles = await fetchArticlesForReadOnlyAudit({ statusIn: ['PENDING'] });

  let totalPendingScanned = 0;
  let outOfScopeCandidatesCount = 0;
  const sampleCandidates: OutOfScopeCleanupCandidate[] = [];

  for (const art of pendingArticles) {
    totalPendingScanned++;

    const rel = classifyStrategicRelevance({
      title: art.title,
      excerpt: art.excerpt,
      rawCategories: art.rawCategories,
      sourceName: art.sourceName,
      canonicalUrl: art.canonicalUrl,
    });

    if (rel.decision === 'OUT_OF_SCOPE') {
      outOfScopeCandidatesCount++;
      if (sampleCandidates.length < limit) {
        sampleCandidates.push({
          id: art.id,
          title: art.title,
          sourceName: art.sourceName || art.sourceId || 'Unknown Source',
          publishedAt: art.publishedAt || '',
          skipReason: rel.reason || 'Non-strategic domain',
        });
      }
    }
  }

  return {
    totalPendingScanned,
    outOfScopeCandidatesCount,
    sampleCandidates,
  };
}

/**
 * Previews the 62 Uncertain Corporate / Ecosystem articles with heuristic breakdown.
 */
export async function previewUncertainArticles(limit: number = 62): Promise<UncertainArticlesPreview> {
  const pendingArticles = await fetchArticlesForReadOnlyAudit({ statusIn: ['PENDING'] });

  const candidates: UncertainArticleCandidate[] = [];

  for (const art of pendingArticles) {
    const rel = classifyStrategicRelevance({
      title: art.title,
      excerpt: art.excerpt,
      rawCategories: art.rawCategories,
      sourceName: art.sourceName,
      canonicalUrl: art.canonicalUrl,
    });

    if (rel.decision === 'UNCERTAIN') {
      const sub = classifyCorporateEcosystemSubtype(`${art.title} ${art.excerpt || ''}`);
      candidates.push({
        id: art.id,
        title: art.title,
        sourceName: art.sourceName || art.sourceId || 'Unknown Source',
        publishedAt: art.publishedAt || '',
        company: rel.matchedCompanies[0] || 'Tracked Competitor',
        recommendation: sub.recommendation,
        supplyChainRelevance: sub.supplyChainRelevance,
        notes: sub.notes,
      });

      if (candidates.length >= limit) break;
    }
  }

  return {
    totalUncertain: candidates.length,
    candidates,
  };
}

export interface ExecuteCleanupOptions {
  dryRun?: boolean;
  confirmCleanup?: boolean;
  batchLimit?: number;
}

/**
 * Executes a controlled, safe cleanup of legacy out-of-scope articles.
 * Default is strictly dry-run. Requires explicit confirmCleanup: true to mutate.
 */
export async function executeOutOfScopeCleanup(
  options: ExecuteCleanupOptions = {}
): Promise<OutOfScopeCleanupResult> {
  const dryRun = options.dryRun !== false; // dryRun by default!
  const confirmCleanup = options.confirmCleanup === true;
  const batchLimit = Math.min(Math.max(options.batchLimit || 500, 1), 1500);

  // 1. Safety Guard: Check Daily Pipeline lease
  const leaseStatus = await getPipelineLeaseStatus();
  if (leaseStatus.active) {
    throw new Error(
      `PIPELINE_ACTIVE_PRIORITY: The scheduled 06:00 Europe/Athens Daily Pipeline is currently active. Cleanup yielded.`
    );
  }

  // 2. Safety Guard: Require explicit admin confirmation for non-dry-run mutations
  if (!dryRun && !confirmCleanup) {
    throw new Error(
      `EXPLICIT_ADMIN_CONFIRMATION_REQUIRED: You must provide confirmCleanup: true to execute database mutations.`
    );
  }

  const db = getServerDb();
  const snap = await db.collection('articles').where('processingStatus', '==', 'PENDING').get();

  let totalPendingScanned = 0;
  let eligibleOutOfScopeCount = 0;
  let skippedAlreadyAnalyzed = 0;
  let skippedNonOutOfScope = 0;
  let updatedCount = 0;
  let batchesCommitted = 0;

  const eligibleDocs: Array<{ docRef: any; article: Article; skipReason: string }> = [];
  const sampleUpdatedIds: string[] = [];

  for (const doc of snap.docs) {
    totalPendingScanned++;
    const art = doc.data() as Article;

    // Safety checks: Never modify already analyzed or processing articles
    if (art.processingStatus === 'ANALYZED' || art.processingStatus === 'PROCESSING') {
      skippedAlreadyAnalyzed++;
      continue;
    }

    const rel = classifyStrategicRelevance({
      title: art.title,
      excerpt: art.excerpt,
      rawCategories: art.rawCategories,
      sourceName: art.sourceName,
      canonicalUrl: art.canonicalUrl,
    });

    if (rel.decision === 'OUT_OF_SCOPE') {
      eligibleOutOfScopeCount++;
      if (eligibleDocs.length < batchLimit) {
        eligibleDocs.push({
          docRef: doc.ref,
          article: art,
          skipReason: rel.reason || 'Legacy non-hardware backlog item triaged out of scope',
        });
      }
    } else {
      skippedNonOutOfScope++;
    }
  }

  const auditId = `cleanup-audit-${Date.now()}`;
  const nowIso = new Date().toISOString();

  // If dry-run: return simulated metrics without committing any mutations
  if (dryRun) {
    return {
      dryRun: true,
      totalPendingScanned,
      eligibleOutOfScopeCount,
      updatedCount: 0,
      skippedAlreadyAnalyzed,
      skippedNonOutOfScope,
      batchesCommitted: 0,
      auditId,
      sampleUpdatedIds: eligibleDocs.slice(0, 15).map((e) => e.article.id),
      message: `[DRY-RUN SIMULATION] Found ${eligibleOutOfScopeCount} confirmed out-of-scope articles eligible for transition to SKIPPED_STRATEGIC_SCOPE. No database writes performed.`,
      executedAt: nowIso,
    };
  }

  // Non-dry-run: Execute bounded Firestore batches (chunks of 100)
  const FIRESTORE_BATCH_SIZE = 100;
  for (let i = 0; i < eligibleDocs.length; i += FIRESTORE_BATCH_SIZE) {
    const chunk = eligibleDocs.slice(i, i + FIRESTORE_BATCH_SIZE);
    const writeBatch = db.batch();

    for (const item of chunk) {
      writeBatch.update(item.docRef, cleanServerData({
        processingStatus: 'SKIPPED_STRATEGIC_SCOPE',
        relevanceDecision: 'OUT_OF_SCOPE',
        relevanceCategory: 'OUT_OF_SCOPE',
        relevanceReason: item.skipReason,
        relevanceEvaluatedAt: nowIso,
        updatedAt: nowIso,
      }));

      updatedCount++;
      if (sampleUpdatedIds.length < 25) {
        sampleUpdatedIds.push(item.article.id);
      }
    }

    await writeBatch.commit();
    batchesCommitted++;
  }

  // Persist durable audit record
  await db.collection('backfillCleanupAudit').doc(auditId).set(cleanServerData({
    auditId,
    dryRun: false,
    totalPendingScanned,
    eligibleOutOfScopeCount,
    updatedCount,
    skippedAlreadyAnalyzed,
    skippedNonOutOfScope,
    batchesCommitted,
    sampleUpdatedIds,
    executedAt: nowIso,
  }));

  return {
    dryRun: false,
    totalPendingScanned,
    eligibleOutOfScopeCount,
    updatedCount,
    skippedAlreadyAnalyzed,
    skippedNonOutOfScope,
    batchesCommitted,
    auditId,
    sampleUpdatedIds,
    message: `[SAFE CLEANUP COMPLETED] Successfully transitioned ${updatedCount} legacy out-of-scope articles to SKIPPED_STRATEGIC_SCOPE across ${batchesCommitted} Firestore batch transactions.`,
    executedAt: nowIso,
  };
}

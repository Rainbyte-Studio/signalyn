/**
 * SIGNALYN PHASE 5B: HISTORICAL ANALYTICS BACKFILL & PRODUCTION RECONCILIATION
 * 
 * Safety constraints:
 * - 0 Gemini calls
 * - 0 Collector runs
 * - 0 mutations to Articles, ArticleAnalysis, Stories, EntityReviews, Companies, Products
 * - Concurrency = 1
 * - Bounded batches with validation of Batch 1 before continuation
 * - Full mathematical reconciliation post-run
 */

import { db } from '../src/firebase';
import configFile from '../firebase-applet-config.json';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  limit as firestoreLimit,
  startAfter,
  orderBy,
  documentId,
} from 'firebase/firestore';
import {
  Article,
  ArticleAnalysis,
  DailyAggregate,
  ArticleContributionLedger,
  UNDATED_DATE_KEY,
} from '../src/types';
import {
  computeArticleContribution,
  createEmptyDailyAggregate,
  planLedgerTransition,
} from '../src/server/analytics/historicalAggregationEngine';
import {
  recordArticleContributionInFirestore,
  DAILY_AGGREGATES_COLLECTION,
  ARTICLE_LEDGER_COLLECTION,
} from '../src/server/analytics/firestoreAggregationAdapter';
import { reconcileAggregates, ReconciliationReport } from '../src/server/analytics/historicalReconciliation';

interface PreflightReport {
  projectId: string;
  databaseId: string;
  totalArticles: number;
  totalAnalyses: number;
  initialLedgerCount: number;
  initialDailyAggregatesCount: number;
  missingPublishedAtCount: number;
  undatedCount: number;
  dailyBucketsExpected: number;
  expectedWrites: number;
  passed: boolean;
  failures: string[];
}

interface BatchResult {
  batchNumber: number;
  articlesProcessed: number;
  successful: number;
  skippedNoOp: number;
  failed: number;
  writesPerformed: number;
  durationMs: number;
}

async function runPreflight(): Promise<{ preflight: PreflightReport; allAnalyses: ArticleAnalysis[]; articlesMap: Map<string, Article> }> {
  console.log('====================================================');
  console.log('PHASE 5B.1 — PRODUCTION SAFETY PREFLIGHT');
  console.log('====================================================\n');

  const failures: string[] = [];

  // 1. Verify Project ID and Database ID
  const expectedProjectId = 'signalyn-5406e';
  const expectedDbId = 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34';

  const configProjectId = configFile.projectId;
  const configDbId = configFile.firestoreDatabaseId;

  console.log(`[1] Firebase Project ID: ${configProjectId} (Expected: ${expectedProjectId})`);
  console.log(`    Firestore DB ID:     ${configDbId} (Expected: ${expectedDbId})`);

  if (configProjectId !== expectedProjectId) {
    failures.push(`Project ID mismatch: ${configProjectId} != ${expectedProjectId}`);
  }
  if (configDbId !== expectedDbId) {
    failures.push(`Database ID mismatch: ${configDbId} != ${expectedDbId}`);
  }

  // 2. Count existing records in production Firestore
  console.log('\n[2] Reading Firestore collection baselines...');
  const articlesCol = collection(db, 'articles');
  const analysesCol = collection(db, 'articleAnalysis');
  const ledgerCol = collection(db, ARTICLE_LEDGER_COLLECTION);
  const dailyCol = collection(db, DAILY_AGGREGATES_COLLECTION);

  const [articlesCountSnap, analysesCountSnap, ledgerCountSnap, dailyCountSnap] = await Promise.all([
    getCountFromServer(articlesCol),
    getCountFromServer(analysesCol),
    getCountFromServer(ledgerCol),
    getCountFromServer(dailyCol),
  ]);

  const totalArticles = articlesCountSnap.data().count;
  const totalAnalyses = analysesCountSnap.data().count;
  const initialLedgerCount = ledgerCountSnap.data().count;
  const initialDailyAggregatesCount = dailyCountSnap.data().count;

  console.log(`    Total articles:              ${totalArticles}`);
  console.log(`    Total analyzed articles:     ${totalAnalyses}`);
  console.log(`    Initial ledger entries:      ${initialLedgerCount}`);
  console.log(`    Initial daily aggregates:    ${initialDailyAggregatesCount}`);

  if (totalAnalyses !== 193) {
    console.warn(`    [NOTE] Total analyses count is ${totalAnalyses} (Baseline was 193)`);
  }

  // 3. Load all analyses to inspect publication dates and simulate contributions (DRY RUN)
  console.log('\n[3] Dry-run evaluation across all analyzed articles...');
  const analysesSnap = await getDocs(analysesCol);
  const allAnalyses: ArticleAnalysis[] = [];
  analysesSnap.forEach((d) => allAnalyses.push(d.data() as ArticleAnalysis));

  // Also prefetch articles for publishedAt provenance where missing on analysis
  const articlesMap = new Map<string, Article>();
  const missingDateArticleIds: string[] = [];

  for (const a of allAnalyses) {
    if (!a.publishedAt) {
      missingDateArticleIds.push(a.articleId);
    }
  }

  console.log(`    Analyses with missing publishedAt: ${missingDateArticleIds.length}`);

  // Fetch corresponding article docs
  for (const artId of missingDateArticleIds) {
    const artSnap = await getDoc(doc(articlesCol, artId));
    if (artSnap.exists()) {
      articlesMap.set(artId, artSnap.data() as Article);
    }
  }

  let undatedCount = 0;
  const bucketSet = new Set<string>();

  for (const a of allAnalyses) {
    const art = articlesMap.get(a.articleId);
    const pub = a.publishedAt || art?.publishedAt;
    const contrib = computeArticleContribution(a, pub);
    if (contrib.dateKey === UNDATED_DATE_KEY) {
      undatedCount++;
    }
    bucketSet.add(contrib.dateKey);
  }

  console.log(`    Undated articles routed to UNDATED bucket: ${undatedCount}`);
  console.log(`    Unique daily buckets affected:            ${bucketSet.size}`);
  console.log(`    Expected ledger writes:                   ${allAnalyses.length}`);
  console.log(`    Expected daily aggregate writes:          ${bucketSet.size}`);
  console.log(`    Total estimated writes (concurrency 1):   ${allAnalyses.length + bucketSet.size}`);

  const passed = failures.length === 0;

  const preflight: PreflightReport = {
    projectId: configProjectId,
    databaseId: configDbId,
    totalArticles,
    totalAnalyses,
    initialLedgerCount,
    initialDailyAggregatesCount,
    missingPublishedAtCount: missingDateArticleIds.length,
    undatedCount,
    dailyBucketsExpected: bucketSet.size,
    expectedWrites: allAnalyses.length + bucketSet.size,
    passed,
    failures,
  };

  return { preflight, allAnalyses, articlesMap };
}

async function executeControlledBackfill(
  allAnalyses: ArticleAnalysis[],
  articlesMap: Map<string, Article>
) {
  console.log('\n====================================================');
  console.log('PHASE 5B.2 — CONTROLLED BACKFILL EXECUTION');
  console.log('====================================================\n');

  const BATCH_SIZE = 25;
  const totalArticles = allAnalyses.length;
  const totalBatches = Math.ceil(totalArticles / BATCH_SIZE);

  console.log(`Total articles to backfill: ${totalArticles}`);
  console.log(`Batch size:                ${BATCH_SIZE}`);
  console.log(`Total batches:             ${totalBatches}`);
  console.log(`Concurrency:               1 (strictly sequential)`);

  let totalSuccessful = 0;
  let totalSkippedNoOp = 0;
  let totalFailed = 0;
  let totalWrites = 0;
  const failedList: Array<{ articleId: string; error: string }> = [];

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchNum = batchIdx + 1;
    const startIdx = batchIdx * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, totalArticles);
    const batchAnalyses = allAnalyses.slice(startIdx, endIdx);

    console.log(`\n--- Executing Batch ${batchNum}/${totalBatches} (${batchAnalyses.length} articles) ---`);
    const batchStart = Date.now();
    let batchSuccess = 0;
    let batchSkipped = 0;
    let batchFailed = 0;
    let batchWrites = 0;

    for (const analysis of batchAnalyses) {
      try {
        const art = articlesMap.get(analysis.articleId);
        const pub = analysis.publishedAt || art?.publishedAt;

        const res = await recordArticleContributionInFirestore(analysis, pub);
        if (res.action === 'NO_OP') {
          batchSkipped++;
          totalSkippedNoOp++;
        } else {
          batchSuccess++;
          totalSuccessful++;
        }
        batchWrites += res.writesPerformed;
        totalWrites += res.writesPerformed;
      } catch (err: any) {
        batchFailed++;
        totalFailed++;
        const errMsg = err?.message || String(err);
        failedList.push({ articleId: analysis.articleId, error: errMsg });
        console.error(`  [ERROR] Failed to record contribution for ${analysis.articleId}:`, errMsg);
      }
    }

    const batchDuration = Date.now() - batchStart;
    console.log(
      `  Batch ${batchNum} completed in ${batchDuration}ms: Success=${batchSuccess}, Skipped=${batchSkipped}, Failed=${batchFailed}, Writes=${batchWrites}`
    );

    // CRITICAL: Validate Batch 1 before proceeding!
    if (batchNum === 1) {
      console.log('\n>>> VALIDATING BATCH 1 RESULTS BEFORE PROCEEDING <<<');
      if (batchFailed > 0) {
        throw new Error(`Batch 1 had ${batchFailed} failures. Aborting further batches.`);
      }

      // Verify that all articles in Batch 1 exist in analyticsLedger
      console.log('Verifying Batch 1 ledger documents in Firestore...');
      for (const a of batchAnalyses) {
        const ledgerRef = doc(db, ARTICLE_LEDGER_COLLECTION, a.articleId);
        const lSnap = await getDoc(ledgerRef);
        if (!lSnap.exists()) {
          throw new Error(`Verification failed: Ledger document missing for ${a.articleId}`);
        }
      }
      console.log(`  ✓ BATCH 1 VALIDATION PASSED: All ${batchAnalyses.length} articles verified in /${ARTICLE_LEDGER_COLLECTION}`);
    }
  }

  console.log('\n====================================================');
  console.log('BACKFILL EXECUTION SUMMARY');
  console.log('====================================================');
  console.log(`Total Processed:  ${totalArticles}`);
  console.log(`Successful:       ${totalSuccessful}`);
  console.log(`Skipped (NO_OP):  ${totalSkippedNoOp}`);
  console.log(`Failed:           ${totalFailed}`);
  console.log(`Firestore Writes: ${totalWrites}`);

  if (totalFailed > 0) {
    console.error('Failures encountered:', failedList);
    throw new Error(`${totalFailed} articles failed during backfill.`);
  }
}

async function performReconciliation(): Promise<ReconciliationReport> {
  console.log('\n====================================================');
  console.log('PHASE 5B.3 — FULL PRODUCTION RECONCILIATION');
  console.log('====================================================\n');

  console.log('Reading all documents from /analyticsLedger and /analyticsDaily...');
  const ledgerCol = collection(db, ARTICLE_LEDGER_COLLECTION);
  const dailyCol = collection(db, DAILY_AGGREGATES_COLLECTION);

  const [ledgerSnap, dailySnap] = await Promise.all([
    getDocs(ledgerCol),
    getDocs(dailyCol),
  ]);

  const allLedgers: ArticleContributionLedger[] = [];
  ledgerSnap.forEach((d) => allLedgers.push(d.data() as ArticleContributionLedger));

  const allDailyAggregates: DailyAggregate[] = [];
  dailySnap.forEach((d) => allDailyAggregates.push(d.data() as DailyAggregate));

  console.log(`Total Ledgers read:           ${allLedgers.length}`);
  console.log(`Total Daily Aggregates read:  ${allDailyAggregates.length}`);

  const report = reconcileAggregates(allDailyAggregates, allLedgers);

  console.log(`\nReconciliation Status:         ${report.status}`);
  console.log(`Total Buckets Evaluated:       ${report.totalBucketsEvaluated}`);
  console.log(`Matched Buckets:               ${report.matchedBucketsCount}`);
  console.log(`Mismatched Buckets:            ${report.mismatchedBucketsCount}`);
  console.log(`Total Ledgers Reconciled:      ${report.totalLedgersEvaluated}`);

  if (report.mismatchedBucketsCount > 0) {
    console.error('\nMismatches detected:');
    report.errors.forEach((e) => console.error(`  - ${e}`));
  } else {
    console.log('\n✓ ZERO DISCREPANCIES: Mathematical identity verified across all buckets!');
  }

  return report;
}

async function main() {
  try {
    // Step 1: Preflight
    const { preflight, allAnalyses, articlesMap } = await runPreflight();
    if (!preflight.passed) {
      console.error('\nPREFLIGHT FAILED:', preflight.failures);
      process.exit(1);
    }
    console.log('\n✓ PREFLIGHT PASSED: System safe to proceed with controlled backfill.');

    // Step 2: Controlled Backfill
    await executeControlledBackfill(allAnalyses, articlesMap);

    // Step 3: Full Reconciliation
    const recReport = await performReconciliation();
    if (recReport.status !== 'RECONCILED' || recReport.mismatchedBucketsCount > 0) {
      console.error('\nRECONCILIATION FAILED WITH DISCREPANCIES.');
      process.exit(1);
    }

    console.log('\n====================================================');
    console.log('READY_FOR_PHASE_5C');
    console.log('====================================================\n');
  } catch (err: any) {
    console.error('\nEXECUTION ABORTED WITH ERROR:', err);
    process.exit(1);
  }
}

main();

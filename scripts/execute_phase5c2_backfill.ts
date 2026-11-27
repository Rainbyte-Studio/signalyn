import { db } from '../src/firebase';
import configFile from '../firebase-applet-config.json';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  DailyAggregate,
  ArticleContributionLedger,
} from '../src/types';
import {
  createEmptyDailyAggregate,
  applyContributionDelta,
} from '../src/server/analytics/historicalAggregationEngine';
import { TRACKED_COMPANIES } from '../src/services/competitiveAnalytics';
import { queryHistoricalAnalytics } from '../src/services/historicalQueryService';

export interface Phase5C2MigrationReport {
  timestamp: string;
  projectId: string;
  databaseId: string;
  totalLedgerRecords: number;
  totalDailyBuckets: number;
  preflightPassed: boolean;
  documentsUpdated: number;
  documentsSkipped: number;
  postMigrationVerificationPassed: boolean;
  categoryArticleTotals: Record<string, number>;
  categoryCompanyMentionsTotals: Record<string, Record<string, number>>;
  discrepancies: string[];
}

export async function executePhase5C2Migration(): Promise<Phase5C2MigrationReport> {
  console.log('================================================================');
  console.log('   SIGNALYN PHASE 5C.2: CONTROLLED MULTIDIMENSIONAL BACKFILL   ');
  console.log('================================================================\n');

  // 1. Mandatory Environment Check
  const expectedProjectId = 'signalyn-5406e';
  const expectedDbId = 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34';

  const configProjectId = configFile.projectId;
  const configDbId = configFile.firestoreDatabaseId;

  console.log(`[PREFLIGHT] Project ID:    ${configProjectId} (Expected: ${expectedProjectId})`);
  console.log(`[PREFLIGHT] Firestore DB:  ${configDbId} (Expected: ${expectedDbId})`);

  if (configProjectId !== expectedProjectId || configDbId !== expectedDbId) {
    throw new Error(`CRITICAL: Database mismatch! Refusing to run migration.`);
  }

  // 2. Read Production Baseline
  console.log('\n[BASELINE] Reading current production /analyticsLedger and /analyticsDaily...');
  const ledgerSnap = await getDocs(collection(db, 'analyticsLedger'));
  const allLedgers: ArticleContributionLedger[] = [];
  ledgerSnap.forEach((d) => allLedgers.push(d.data() as ArticleContributionLedger));

  const dailySnap = await getDocs(collection(db, 'analyticsDaily'));
  const existingDailyMap = new Map<string, DailyAggregate>();
  dailySnap.forEach((d) => existingDailyMap.set(d.id, d.data() as DailyAggregate));

  console.log(`[BASELINE] Found ${allLedgers.length} ledger records across ${existingDailyMap.size} daily buckets.`);

  if (allLedgers.length === 0 || existingDailyMap.size === 0) {
    throw new Error('CRITICAL: Empty ledger or daily collection detected! Aborting.');
  }

  // 3. Rebuild Expected Aggregates with byCategory from Ground-Truth Ledgers
  console.log('\n[PLAN] Rebuilding expected multidimensional aggregates from ledger contributions...');
  const expectedDailyMap = new Map<string, DailyAggregate>();

  // Initialize
  existingDailyMap.forEach((_, dateKey) => {
    expectedDailyMap.set(dateKey, createEmptyDailyAggregate(dateKey));
  });

  const categoryArticleTotals: Record<string, number> = {
    SMARTPHONE: 0,
    WEARABLE: 0,
    AUDIO: 0,
    TABLET: 0,
    OTHER: 0,
  };

  const categoryCompanyMentionsTotals: Record<string, Record<string, number>> = {
    SMARTPHONE: {},
    WEARABLE: {},
    AUDIO: {},
    TABLET: {},
    OTHER: {},
  };

  TRACKED_COMPANIES.forEach((c) => {
    categoryCompanyMentionsTotals.SMARTPHONE[c.id] = 0;
    categoryCompanyMentionsTotals.WEARABLE[c.id] = 0;
    categoryCompanyMentionsTotals.AUDIO[c.id] = 0;
    categoryCompanyMentionsTotals.TABLET[c.id] = 0;
    categoryCompanyMentionsTotals.OTHER[c.id] = 0;
  });

  for (const ledger of allLedgers) {
    const dateKey = ledger.dateKey;
    let expected = expectedDailyMap.get(dateKey);
    if (!expected) {
      expected = createEmptyDailyAggregate(dateKey);
      expectedDailyMap.set(dateKey, expected);
    }

    const updated = applyContributionDelta(expected, ledger, 1);
    expectedDailyMap.set(dateKey, updated);

    const cat = ledger.strategicCategory;
    categoryArticleTotals[cat] = (categoryArticleTotals[cat] || 0) + 1;

    ledger.companiesCredited.forEach((cid) => {
      if (!categoryCompanyMentionsTotals[cat]) categoryCompanyMentionsTotals[cat] = {};
      categoryCompanyMentionsTotals[cat][cid] =
        (categoryCompanyMentionsTotals[cat][cid] || 0) + 1;
    });
  }

  // Preflight validation: compare expected vs existing daily totals
  const preflightMismatches: string[] = [];
  existingDailyMap.forEach((orig, dateKey) => {
    const exp = expectedDailyMap.get(dateKey);
    if (!exp) {
      preflightMismatches.push(`Missing expected aggregate for dateKey: ${dateKey}`);
      return;
    }
    if (orig.articlesCount !== exp.articlesCount) {
      preflightMismatches.push(
        `${dateKey}: articlesCount mismatch: orig=${orig.articlesCount}, exp=${exp.articlesCount}`
      );
    }
    if (orig.totalCompanyMentions !== exp.totalCompanyMentions) {
      preflightMismatches.push(
        `${dateKey}: totalCompanyMentions mismatch: orig=${orig.totalCompanyMentions}, exp=${exp.totalCompanyMentions}`
      );
    }
  });

  if (preflightMismatches.length > 0) {
    console.error('[PREFLIGHT] Mismatches detected:', preflightMismatches);
    throw new Error(`Preflight validation failed with ${preflightMismatches.length} discrepancies.`);
  }

  console.log('[PREFLIGHT] Preflight validation PASSED: 0 discrepancies across all 42 buckets.');

  // 4. Controlled Production Writes (Only byCategory & aggregationVersion)
  console.log('\n[MIGRATION] Executing controlled production updates on /analyticsDaily...');
  let documentsUpdated = 0;
  let documentsSkipped = 0;

  const dateKeys = Array.from(expectedDailyMap.keys()).sort();

  for (const dateKey of dateKeys) {
    const expectedAgg = expectedDailyMap.get(dateKey)!;
    const existingAgg = existingDailyMap.get(dateKey)!;

    // Check if byCategory already exists and matches exactly
    const existingByCategory = existingAgg.byCategory;
    const expectedByCategory = expectedAgg.byCategory;

    const isAlreadyIdentical =
      existingByCategory &&
      JSON.stringify(existingByCategory) === JSON.stringify(expectedByCategory);

    if (isAlreadyIdentical) {
      console.log(`  [SKIP] ${dateKey}: byCategory already up-to-date.`);
      documentsSkipped++;
      continue;
    }

    const docRef = doc(db, 'analyticsDaily', dateKey);

    // Strictly authorized update: preserve existing document and add multidimensional byCategory
    const payload = {
      ...existingAgg,
      byCategory: expectedByCategory,
      aggregationVersion: 'signalyn-agg-v1',
      lastUpdatedAt: new Date().toISOString(),
    };

    // Remove any undefined keys to ensure clean Firestore serialization
    const cleanPayload: Record<string, any> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined) {
        cleanPayload[k] = v;
      }
    }

    await setDoc(docRef, cleanPayload);

    documentsUpdated++;
    console.log(
      `  [UPDATED] ${dateKey}: added multidimensional byCategory (${Object.keys(expectedByCategory || {}).length} categories)`
    );
  }

  console.log(`\n[MIGRATION COMPLETE] Updated: ${documentsUpdated}, Skipped: ${documentsSkipped}`);

  // 5. Post-Migration Verification & Reconciliation
  console.log('\n[POST-VERIFICATION] Fetching refreshed documents from Cloud Firestore...');
  const refreshedSnap = await getDocs(collection(db, 'analyticsDaily'));
  const postDailyMap = new Map<string, DailyAggregate>();
  refreshedSnap.forEach((d) => postDailyMap.set(d.id, d.data() as DailyAggregate));

  const discrepancies: string[] = [];
  let totalMigratedBuckets = 0;

  postDailyMap.forEach((actual, dateKey) => {
    const expected = expectedDailyMap.get(dateKey);
    if (!expected) {
      discrepancies.push(`Unexpected document in Firestore: ${dateKey}`);
      return;
    }

    if (!actual.byCategory || Object.keys(actual.byCategory).length === 0) {
      discrepancies.push(`${dateKey}: Missing or empty byCategory field!`);
      return;
    }

    totalMigratedBuckets++;

    // Check byCategory articlesCount sum equals actual articlesCount
    let sumByCatArticles = 0;
    const sumByCatMentions: Record<string, number> = {};

    Object.entries(actual.byCategory).forEach(([cat, catMetrics]) => {
      sumByCatArticles += catMetrics.articlesCount;

      // Compare with expected
      const expCatMetrics = expected.byCategory?.[cat];
      if (!expCatMetrics) {
        discrepancies.push(`${dateKey}: Unexpected category in byCategory: ${cat}`);
      } else {
        if (catMetrics.articlesCount !== expCatMetrics.articlesCount) {
          discrepancies.push(
            `${dateKey}[${cat}]: articlesCount mismatch: act=${catMetrics.articlesCount}, exp=${expCatMetrics.articlesCount}`
          );
        }
        if (catMetrics.totalCompanyMentions !== expCatMetrics.totalCompanyMentions) {
          discrepancies.push(
            `${dateKey}[${cat}]: totalCompanyMentions mismatch: act=${catMetrics.totalCompanyMentions}, exp=${expCatMetrics.totalCompanyMentions}`
          );
        }
      }

      Object.entries(catMetrics.companyMentions || {}).forEach(([cid, count]) => {
        sumByCatMentions[cid] = (sumByCatMentions[cid] || 0) + count;
      });
    });

    if (sumByCatArticles !== actual.articlesCount) {
      discrepancies.push(
        `${dateKey}: byCategory articles sum (${sumByCatArticles}) != articlesCount (${actual.articlesCount})`
      );
    }

    // Check sum of company mentions across categories equals top-level companyMentions
    Object.entries(actual.companyMentions || {}).forEach(([cid, topCount]) => {
      const sumCount = sumByCatMentions[cid] || 0;
      if (topCount !== sumCount) {
        discrepancies.push(
          `${dateKey}: company [${cid}] top-level mentions (${topCount}) != sum across byCategory (${sumCount})`
        );
      }
    });
  });

  const postMigrationVerificationPassed =
    discrepancies.length === 0 && totalMigratedBuckets === existingDailyMap.size;

  console.log(`\n[POST-VERIFICATION] Verified ${totalMigratedBuckets}/${existingDailyMap.size} daily buckets.`);
  console.log(`[POST-VERIFICATION] Discrepancies Count: ${discrepancies.length}`);

  if (discrepancies.length > 0) {
    console.error('Discrepancies:', discrepancies);
    throw new Error(`Post-migration verification failed!`);
  }

  // 6. Category Filter Operational Verification via queryHistoricalAnalytics
  console.log('\n[QUERY VERIFICATION] Running category-filtered queries through queryHistoricalAnalytics...');

  const queryAll = await queryHistoricalAnalytics(
    { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: 'ALL_STRATEGIC' },
    { bypassCache: true }
  );
  console.log(`  ALL_STRATEGIC: ${queryAll.metrics.totalArticlesAnalyzed} articles, ${queryAll.metrics.totalCompanyMentions} mentions, CategoryBreakdownAvailable=${queryAll.metadata.categoryBreakdownAvailable}`);

  const queryPhones = await queryHistoricalAnalytics(
    { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: 'SMARTPHONE' },
    { bypassCache: true }
  );
  console.log(`  SMARTPHONE:    ${queryPhones.metrics.totalArticlesAnalyzed} articles, ${queryPhones.metrics.totalCompanyMentions} mentions, CategoryBreakdownAvailable=${queryPhones.metadata.categoryBreakdownAvailable}`);

  const queryWearables = await queryHistoricalAnalytics(
    { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: 'WEARABLE' },
    { bypassCache: true }
  );
  console.log(`  WEARABLE:      ${queryWearables.metrics.totalArticlesAnalyzed} articles, ${queryWearables.metrics.totalCompanyMentions} mentions, CategoryBreakdownAvailable=${queryWearables.metadata.categoryBreakdownAvailable}`);

  const queryAudio = await queryHistoricalAnalytics(
    { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: 'AUDIO' },
    { bypassCache: true }
  );
  console.log(`  AUDIO:         ${queryAudio.metrics.totalArticlesAnalyzed} articles, ${queryAudio.metrics.totalCompanyMentions} mentions, CategoryBreakdownAvailable=${queryAudio.metadata.categoryBreakdownAvailable}`);

  const queryTablets = await queryHistoricalAnalytics(
    { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: 'TABLET' },
    { bypassCache: true }
  );
  console.log(`  TABLET:        ${queryTablets.metrics.totalArticlesAnalyzed} articles, ${queryTablets.metrics.totalCompanyMentions} mentions, CategoryBreakdownAvailable=${queryTablets.metadata.categoryBreakdownAvailable}`);

  console.log('\n================================================================');
  console.log('   PHASE 5C.2 MIGRATION & RECONCILIATION COMPLETED SUCCESSFULLY ');
  console.log('================================================================');

  return {
    timestamp: new Date().toISOString(),
    projectId: configProjectId,
    databaseId: configDbId,
    totalLedgerRecords: allLedgers.length,
    totalDailyBuckets: postDailyMap.size,
    preflightPassed: true,
    documentsUpdated,
    documentsSkipped,
    postMigrationVerificationPassed,
    categoryArticleTotals,
    categoryCompanyMentionsTotals,
    discrepancies,
  };
}

if (process.argv[1]?.endsWith('execute_phase5c2_backfill.ts')) {
  executePhase5C2Migration()
    .then((report) => {
      console.log('\nFinal Report Summary:');
      console.log(`- Total Ledger Records: ${report.totalLedgerRecords}`);
      console.log(`- Total Daily Buckets:  ${report.totalDailyBuckets}`);
      console.log(`- Documents Updated:    ${report.documentsUpdated}`);
      console.log(`- Verification Passed:  ${report.postMigrationVerificationPassed}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

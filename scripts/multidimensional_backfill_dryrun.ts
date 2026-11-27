import { db } from '../src/firebase';
import { collection, getDocs } from 'firebase/firestore';
import {
  DailyAggregate,
  ArticleContributionLedger,
  CategoryAggregateMetrics,
} from '../src/types';
import { TRACKED_COMPANIES } from '../src/services/competitiveAnalytics';
import {
  createEmptyDailyAggregate,
  applyContributionDelta,
} from '../src/server/analytics/historicalAggregationEngine';

export interface MultidimensionalDryRunReport {
  totalLedgerRecords: number;
  totalDailyBuckets: number;
  recordsByCategory: Record<string, number>;
  companyMentionsByCategory: Record<string, Record<string, number>>;
  expectedReads: number;
  expectedWrites: number;
  reconciliationPassed: boolean;
  discrepancies: string[];
}

export async function runMultidimensionalBackfillDryRun(): Promise<MultidimensionalDryRunReport> {
  console.log('=== MULTIDIMENSIONAL AGGREGATION DRY-RUN (READ-ONLY) ===');

  // 1. Fetch all 193 ledger records
  const ledgerSnap = await getDocs(collection(db, 'analyticsLedger'));
  const allContributions: ArticleContributionLedger[] = [];
  ledgerSnap.forEach((d) => allContributions.push(d.data() as ArticleContributionLedger));

  console.log(`Read ${allContributions.length} contribution ledger records from /analyticsLedger.`);

  // 2. Fetch all existing 42 daily aggregate documents
  const dailySnap = await getDocs(collection(db, 'analyticsDaily'));
  const existingDailyMap = new Map<string, DailyAggregate>();
  dailySnap.forEach((d) => existingDailyMap.set(d.id, d.data() as DailyAggregate));

  console.log(`Read ${existingDailyMap.size} daily aggregate documents from /analyticsDaily.`);

  // 3. Simulate building the multidimensional daily aggregates in-memory
  const simulatedDailyMap = new Map<string, DailyAggregate>();

  // Initialize with empty aggregates
  existingDailyMap.forEach((orig, dateKey) => {
    simulatedDailyMap.set(dateKey, createEmptyDailyAggregate(dateKey));
  });

  const recordsByCategory: Record<string, number> = {
    SMARTPHONE: 0,
    WEARABLE: 0,
    AUDIO: 0,
    TABLET: 0,
    OTHER: 0,
  };

  const companyMentionsByCategory: Record<string, Record<string, number>> = {
    SMARTPHONE: {},
    WEARABLE: {},
    AUDIO: {},
    TABLET: {},
    OTHER: {},
  };

  TRACKED_COMPANIES.forEach((c) => {
    recordsByCategory.SMARTPHONE = recordsByCategory.SMARTPHONE || 0;
    companyMentionsByCategory.SMARTPHONE[c.id] = 0;
    companyMentionsByCategory.WEARABLE[c.id] = 0;
    companyMentionsByCategory.AUDIO[c.id] = 0;
    companyMentionsByCategory.TABLET[c.id] = 0;
    companyMentionsByCategory.OTHER[c.id] = 0;
  });

  // Replay all 193 contributions through applyContributionDelta
  for (const contrib of allContributions) {
    const dateKey = contrib.dateKey;
    let agg = simulatedDailyMap.get(dateKey);
    if (!agg) {
      agg = createEmptyDailyAggregate(dateKey);
      simulatedDailyMap.set(dateKey, agg);
    }

    const updated = applyContributionDelta(agg, contrib, 1);
    simulatedDailyMap.set(dateKey, updated);

    const cat = contrib.strategicCategory;
    recordsByCategory[cat] = (recordsByCategory[cat] || 0) + 1;

    contrib.companiesCredited.forEach((cid) => {
      if (!companyMentionsByCategory[cat]) companyMentionsByCategory[cat] = {};
      companyMentionsByCategory[cat][cid] = (companyMentionsByCategory[cat][cid] || 0) + 1;
    });
  }

  // 4. Reconcile simulated aggregates against existing daily documents
  const discrepancies: string[] = [];

  existingDailyMap.forEach((orig, dateKey) => {
    const sim = simulatedDailyMap.get(dateKey);
    if (!sim) {
      discrepancies.push(`Missing simulated bucket for dateKey: ${dateKey}`);
      return;
    }

    if (orig.articlesCount !== sim.articlesCount) {
      discrepancies.push(
        `${dateKey}: articlesCount mismatch: orig=${orig.articlesCount}, sim=${sim.articlesCount}`
      );
    }

    if (orig.totalCompanyMentions !== sim.totalCompanyMentions) {
      discrepancies.push(
        `${dateKey}: totalCompanyMentions mismatch: orig=${orig.totalCompanyMentions}, sim=${sim.totalCompanyMentions}`
      );
    }

    // Verify categoryDistribution totals match
    Object.entries(orig.categoryDistribution || {}).forEach(([cat, origCount]) => {
      const simCount = sim.categoryDistribution[cat] || 0;
      if (origCount !== simCount) {
        discrepancies.push(
          `${dateKey}: category ${cat} mismatch: orig=${origCount}, sim=${simCount}`
        );
      }
    });

    // Verify byCategory sum matches top-level categoryDistribution
    if (sim.byCategory) {
      Object.entries(sim.byCategory).forEach(([cat, catMetrics]) => {
        const topCatCount = sim.categoryDistribution[cat] || 0;
        if (catMetrics.articlesCount !== topCatCount) {
          discrepancies.push(
            `${dateKey}: byCategory[${cat}].articlesCount (${catMetrics.articlesCount}) does not match categoryDistribution (${topCatCount})`
          );
        }
      });
    }
  });

  const reconciliationPassed = discrepancies.length === 0;

  console.log('\n--- MULTIDIMENSIONAL BREAKDOWN SUMMARY ---');
  console.log('Articles by Category:', recordsByCategory);
  console.log('\nCompany Mentions by Category:');
  Object.entries(companyMentionsByCategory).forEach(([cat, compMap]) => {
    const nonZero = Object.entries(compMap)
      .filter(([_, count]) => count > 0)
      .map(([cid, count]) => `${cid}: ${count}`)
      .join(', ');
    console.log(`  ${cat} (${recordsByCategory[cat]} articles): ${nonZero || 'None'}`);
  });

  console.log('\n--- DRY-RUN RECONCILIATION RESULT ---');
  console.log(`Reconciliation Passed: ${reconciliationPassed}`);
  console.log(`Discrepancies Count: ${discrepancies.length}`);
  if (discrepancies.length > 0) {
    console.log('Discrepancies:', discrepancies.slice(0, 5));
  }

  const report: MultidimensionalDryRunReport = {
    totalLedgerRecords: allContributions.length,
    totalDailyBuckets: existingDailyMap.size,
    recordsByCategory,
    companyMentionsByCategory,
    expectedReads: allContributions.length, // 193 reads
    expectedWrites: existingDailyMap.size, // 42 writes (updating existing daily docs)
    reconciliationPassed,
    discrepancies,
  };

  return report;
}

if (process.argv[1]?.endsWith('multidimensional_backfill_dryrun.ts')) {
  runMultidimensionalBackfillDryRun()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

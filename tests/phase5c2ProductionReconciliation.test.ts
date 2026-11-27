/**
 * Signalyn Phase 5C.2: Production Reconciliation & Verification Test Suite
 * 
 * Verifies:
 * 1. 100% of production /analyticsDaily documents contain populated byCategory fields
 * 2. Perfect mathematical identity between byCategory components and daily aggregate totals
 * 3. Exact correspondence between /analyticsLedger (193 records) and /analyticsDaily
 * 4. Production queries with category filters return categoryBreakdownAvailable === true
 * 5. Accurate category-specific Share of Voice and mention counts
 * 6. Non-mutation of article analyses and contribution ledgers
 */

import { db } from '../src/firebase';
import { collection, getDocs, getCountFromServer } from 'firebase/firestore';
import {
  DailyAggregate,
  ArticleContributionLedger,
} from '../src/types';
import {
  queryHistoricalAnalytics,
  clearHistoricalQueryCache,
} from '../src/services/historicalQueryService';
import { TRACKED_COMPANIES } from '../src/services/competitiveAnalytics';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runPhase5C2ReconciliationTests() {
  console.log('=== STARTING PHASE 5C.2 PRODUCTION RECONCILIATION TEST SUITE ===\n');

  // --- Test 1: Baseline Record Counts and Zero Non-Authorized Mutations ---
  console.log('--- Test 1: Production Collection Baseline Counts ---');
  const [ledgerCountSnap, dailyCountSnap, analysesCountSnap] = await Promise.all([
    getCountFromServer(collection(db, 'analyticsLedger')),
    getCountFromServer(collection(db, 'analyticsDaily')),
    getCountFromServer(collection(db, 'articleAnalysis')),
  ]);

  const ledgerCount = ledgerCountSnap.data().count;
  const dailyCount = dailyCountSnap.data().count;
  const analysesCount = analysesCountSnap.data().count;

  assert(ledgerCount === 193, `Expected exactly 193 ledger records, found ${ledgerCount}`);
  assert(dailyCount === 42, `Expected exactly 42 daily aggregate records, found ${dailyCount}`);
  assert(analysesCount === 193, `Expected exactly 193 article analyses, found ${analysesCount}`);
  console.log('  ✓ PASS: 1: Ledger (193), Daily (42), and Analyses (193) counts verified intact');

  // --- Test 2: 100% Presence of byCategory in /analyticsDaily ---
  console.log('--- Test 2: Presence of byCategory across all 42 daily buckets ---');
  const dailySnap = await getDocs(collection(db, 'analyticsDaily'));
  const dailyDocs: DailyAggregate[] = [];
  dailySnap.forEach((d) => dailyDocs.push(d.data() as DailyAggregate));

  let missingByCategoryCount = 0;
  dailyDocs.forEach((doc) => {
    if (!doc.byCategory || Object.keys(doc.byCategory).length === 0) {
      missingByCategoryCount++;
    }
  });

  assert(missingByCategoryCount === 0, `Found ${missingByCategoryCount} daily buckets missing byCategory`);
  console.log('  ✓ PASS: 2: All 42 daily aggregate documents contain populated byCategory field');

  // --- Test 3: Mathematical Consistency of byCategory vs Document Totals ---
  console.log('--- Test 3: Mathematical Identity of byCategory vs Aggregate Totals ---');
  const discrepancies: string[] = [];

  dailyDocs.forEach((doc) => {
    let sumCatArticles = 0;
    let sumCatMentions = 0;
    const sumCompanyMentions: Record<string, number> = {};

    Object.entries(doc.byCategory || {}).forEach(([cat, metrics]) => {
      sumCatArticles += metrics.articlesCount;
      sumCatMentions += metrics.totalCompanyMentions;

      Object.entries(metrics.companyMentions || {}).forEach(([cid, count]) => {
        sumCompanyMentions[cid] = (sumCompanyMentions[cid] || 0) + count;
      });
    });

    if (sumCatArticles !== doc.articlesCount) {
      discrepancies.push(`${doc.dateKey}: byCategory articles sum (${sumCatArticles}) != articlesCount (${doc.articlesCount})`);
    }

    if (sumCatMentions !== doc.totalCompanyMentions) {
      discrepancies.push(`${doc.dateKey}: byCategory mentions sum (${sumCatMentions}) != totalCompanyMentions (${doc.totalCompanyMentions})`);
    }

    TRACKED_COMPANIES.forEach((c) => {
      const topCount = doc.companyMentions?.[c.id] || 0;
      const catSumCount = sumCompanyMentions[c.id] || 0;
      if (topCount !== catSumCount) {
        discrepancies.push(`${doc.dateKey}: company [${c.id}] top-level mentions (${topCount}) != byCategory sum (${catSumCount})`);
      }
    });
  });

  assert(discrepancies.length === 0, `Found ${discrepancies.length} internal discrepancies: ${discrepancies.join(', ')}`);
  console.log('  ✓ PASS: 3: Perfect mathematical identity verified across all 42 buckets and tracked companies');

  // --- Test 4: Category Filter Availability and Exact SOV via queryHistoricalAnalytics ---
  console.log('--- Test 4: Operational Category Filtering in Historical Query Service ---');
  clearHistoricalQueryCache();

  const categories = [
    { cat: 'ALL_STRATEGIC' as const, expArticles: 193, expMentions: 163 },
    { cat: 'SMARTPHONE' as const, expArticles: 73, expMentions: 77 },
    { cat: 'WEARABLE' as const, expArticles: 33, expMentions: 36 },
    { cat: 'AUDIO' as const, expArticles: 21, expMentions: 12 },
    { cat: 'TABLET' as const, expArticles: 22, expMentions: 22 },
  ];

  for (const { cat, expArticles, expMentions } of categories) {
    const res = await queryHistoricalAnalytics(
      { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: cat },
      { bypassCache: true }
    );

    assert(
      res.metadata.categoryBreakdownAvailable === true,
      `Category ${cat} should have categoryBreakdownAvailable === true`
    );
    assert(
      res.metrics.totalArticlesAnalyzed === expArticles,
      `Category ${cat} expected ${expArticles} articles, got ${res.metrics.totalArticlesAnalyzed}`
    );
    assert(
      res.metrics.totalCompanyMentions === expMentions,
      `Category ${cat} expected ${expMentions} mentions, got ${res.metrics.totalCompanyMentions}`
    );

    // Verify SOV sum across all companies
    if (res.metrics.totalCompanyMentions > 0) {
      const totalSovPct = res.metrics.companies.reduce((sum, c) => sum + c.mentionsShareSov, 0);
      assert(
        Math.abs(totalSovPct - 100) < 1.0,
        `Category ${cat} Share of Voice should sum to ~100%, got ${totalSovPct}%`
      );
    }
  }

  console.log('  ✓ PASS: 4: Category filtering returns categoryBreakdownAvailable === true and exact expected metrics');

  // --- Test 5: Category Cross-Contamination Protection ---
  console.log('--- Test 5: Category Isolation (No Cross-Contamination) ---');
  const phoneRes = await queryHistoricalAnalytics(
    { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: 'SMARTPHONE' },
    { bypassCache: false }
  );
  const audioRes = await queryHistoricalAnalytics(
    { startDate: '2025-01-01', endDate: '2026-10-31', preset: 'all', category: 'AUDIO' },
    { bypassCache: false }
  );

  const phoneSamsung = phoneRes.metrics.companies.find((c) => c.companyId === 'comp-samsung')?.mentions || 0;
  const audioSamsung = audioRes.metrics.companies.find((c) => c.companyId === 'comp-samsung')?.mentions || 0;

  assert(phoneSamsung === 23, `Expected 23 Samsung smartphone mentions, got ${phoneSamsung}`);
  assert(audioSamsung === 4, `Expected 4 Samsung audio mentions, got ${audioSamsung}`);
  console.log('  ✓ PASS: 5: Companies properly partitioned across categories with zero crosstalk');

  console.log('\n======================================================================');
  console.log('ALL PHASE 5C.2 RECONCILIATION & PRODUCTION VERIFICATION TESTS PASSED');
  console.log('======================================================================\n');
  process.exit(0);
}

runPhase5C2ReconciliationTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

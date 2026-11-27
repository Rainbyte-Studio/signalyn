import { queryHistoricalAnalytics } from '../src/services/historicalQueryService';

async function verifyCategoryFilteredQueries() {
  console.log('=== VERIFYING CATEGORY-FILTERED QUERIES AFTER PHASE 5C.2 BACKFILL ===\n');

  const categories = ['ALL_STRATEGIC', 'SMARTPHONE', 'WEARABLE', 'AUDIO', 'TABLET'] as const;

  for (const cat of categories) {
    const res = await queryHistoricalAnalytics(
      {
        startDate: '2025-01-01',
        endDate: '2026-10-31',
        preset: 'all',
        category: cat,
      },
      { bypassCache: true }
    );

    console.log(`[Category: ${cat}]`);
    console.log(`  Total Articles:               ${res.metrics.totalArticlesAnalyzed}`);
    console.log(`  Articles w/ Tracked Co:       ${res.metrics.articlesWithTrackedCompanies}`);
    console.log(`  Total Company Mentions:       ${res.metrics.totalCompanyMentions}`);
    console.log(`  Category Breakdown Available: ${res.metadata.categoryBreakdownAvailable}`);
    console.log(`  Read Document Count:          ${res.metadata.readDocumentCount}`);
    
    // Top 3 companies by mentions
    const topCos = res.metrics.companies
      .filter((c) => c.mentions > 0)
      .sort((a, b) => b.mentions - a.mentions);
    
    const coSummary = topCos.map((c) => `${c.companyName}: ${c.mentions} (${c.mentionsShareSov}%)`).join(', ');
    console.log(`  Company Mentions:             ${coSummary || 'None'}`);
    console.log('');
  }

  process.exit(0);
}

verifyCategoryFilteredQueries().catch((err) => {
  console.error(err);
  process.exit(1);
});

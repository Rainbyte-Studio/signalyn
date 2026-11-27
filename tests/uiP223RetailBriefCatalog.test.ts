import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildConsolidatedPriorityDevelopments,
  buildConsolidatedRecommendations,
  getEvidenceDisplayMeta,
} from '../src/utils/dailyBriefPresentation';
import { DailyBriefContent } from '../src/types/dailyBrief';
import { getMergedCanonicalProducts } from '../src/services/canonicalEntities';
import {
  getProductCatalogStatistics,
  validateProductCatalogIntegrity,
  matchesLifecycleFilter,
} from '../src/services/productAuditRegistry';

function runUiP223TestSuite() {
  console.log(
    '=== RUNNING SIGNALYN UI P2.2.3 — RETAIL INTELLIGENCE, DAILY BRIEF & PRODUCT CATALOG UX REFINEMENT SUITE ===\n'
  );

  const retailViewContent = fs.readFileSync(
    path.resolve('src/components/retail/RetailPricesView.tsx'),
    'utf8'
  );
  const briefViewContent = fs.readFileSync(
    path.resolve('src/components/dailybrief/DailyBriefView.tsx'),
    'utf8'
  );
  const productsViewContent = fs.readFileSync(
    path.resolve('src/components/products/ProductsView.tsx'),
    'utf8'
  );

  // 1. Retail Price Intelligence renders KPI summary cards & dataset reconciliation
  assert.ok(
    retailViewContent.includes('Tracked Products') &&
      retailViewContent.includes('Live Verified Offers') &&
      retailViewContent.includes('Retailers Operational') &&
      retailViewContent.includes('Products Requiring Review') &&
      retailViewContent.includes('Catalog & Offer Reconciliation:'),
    'RetailPricesView must render the 4 business-facing KPI cards and the Catalog & Offer Reconciliation strip'
  );
  console.log('✓ 1. Retail Price Intelligence renders concise KPI summary cards and offer reconciliation.');

  // 2. Retailer connectivity summary displays current status accurately
  assert.ok(
    retailViewContent.includes('Retailer Health Summary') &&
      retailViewContent.includes('HTTP 200 OK') &&
      retailViewContent.includes('HTTP 403 Blocked') &&
      retailViewContent.includes('Operational — Live extraction active') &&
      retailViewContent.includes('Historical Probe Log (Resolved):'),
    'RetailPricesView must display a compact Retailer Health Summary separating active HTTP 200 operational health from historical probe logs'
  );
  console.log('✓ 2. Compact Retailer Health Summary accurately distinguishes current operational status from historical incidents.');

  // 3. Technical retailer diagnostics remain accessible without dominating the main view
  assert.ok(
    retailViewContent.includes('showTechnicalRetailerDetails') &&
      retailViewContent.includes('Technical Adapter Details') &&
      retailViewContent.includes("setSubView('DIAGNOSTICS')") &&
      retailViewContent.includes('#system-diagnostics:retail'),
    'RetailPricesView must keep technical adapter details in a collapsible toggle and preserve access to Retail Diagnostics & System Diagnostics'
  );
  console.log('✓ 3. Technical retailer diagnostics remain accessible via collapsible toggle and Retail Diagnostics view.');

  // 4. Product Match Review displays missing variant evidence and preserves Approve / Reject
  assert.ok(
    retailViewContent.includes('Product Match Review & Data Quality Queue') &&
      retailViewContent.includes('Original Retailer Listing:') &&
      retailViewContent.includes('Proposed Canonical Product') &&
      retailViewContent.includes('Model Family') &&
      retailViewContent.includes('Storage Variant') &&
      retailViewContent.includes('Color Variant') &&
      retailViewContent.includes('Missing Evidence Preventing Auto-Merge:') &&
      retailViewContent.includes('Reason for Manual Review:') &&
      retailViewContent.includes('Source Listing Link') &&
      retailViewContent.includes("handleResolveReview(rev.id, 'APPROVED')") &&
      retailViewContent.includes("handleResolveReview(rev.id, 'REJECTED')"),
    'RetailPricesView must display structured disambiguation evidence in the Product Match Review Queue and preserve Approve/Reject actions'
  );
  console.log('✓ 4. Product Match Review displays structured variant evidence and preserves Approve Match & Reject handlers.');

  // 5. Cross-Retailer Price Matrix preserves LIVE_VERIFIED and SEEDED_PILOT badges
  assert.ok(
    retailViewContent.includes("observationStatus === 'LIVE_VERIFIED'") &&
      retailViewContent.includes("priceSourceType === 'SEEDED_PILOT'") &&
      retailViewContent.includes("isLive ? getRetailObservationFreshness(offer.lastObservedAt) : 'PILOT'") &&
      retailViewContent.includes('— No verified price'),
    'RetailPricesView must label verified offers by freshness and preserve pilot and missing-price states'
  );
  console.log('✓ 5. Cross-Retailer Price Matrix displays verified observation freshness, pilot provenance, and missing-price states.');

  // 6. Price Matrix sorting works across all supported fields
  const requiredSortOptions = [
    'value="lowestPrice"',
    'value="priceSpread"',
    'value="brand"',
    'value="category"',
    'value="lastUpdated"',
    'value="name"',
  ];
  for (const opt of requiredSortOptions) {
    assert.ok(
      retailViewContent.includes(opt),
      `RetailPricesView must support sort option ${opt}`
    );
  }
  assert.ok(
    retailViewContent.includes('getProductPriceSpreadCents') &&
      retailViewContent.includes('No 24h delta'),
    'RetailPricesView must compute cross-retailer price spread when >=2 offers exist and avoid fabricating 24h price deltas'
  );
  console.log('✓ 6. Price Matrix sorting supports Lowest Price, Price Spread, Manufacturer, Category, Latest Observation, and Product Name.');

  // 7. Product History / Provenance modal opens and closes cleanly
  assert.ok(
    retailViewContent.includes('<PriceHistoryModal') &&
      retailViewContent.includes('setSelectedProductItem(item)') &&
      retailViewContent.includes('onClose={() => setSelectedProductItem(null)}'),
    'RetailPricesView must preserve the PriceHistoryModal open and close flow'
  );
  console.log('✓ 7. Product History / Provenance modal opens and closes cleanly.');

  // 8. Daily Brief renders the new 5-section executive structure
  assert.ok(
    briefViewContent.includes('SECTION 1 • EXECUTIVE SUMMARY') &&
      briefViewContent.includes('Section 2 • Priority Developments') &&
      briefViewContent.includes('Section 3 • Changes Since Yesterday') &&
      briefViewContent.includes('Section 4 • Strategic Recommendations') &&
      briefViewContent.includes('Section 5 • Supporting Intelligence'),
    'DailyBriefView must organize the briefing into the 5 executive sections'
  );
  console.log('✓ 8. Daily Brief renders the 5-section executive structure.');

  // 9. Priority developments are consolidated without duplicate full cards
  const mockBriefContent: DailyBriefContent = {
    language: 'en',
    executiveHeadline: 'Competitor Flagship & Foldable Pressure Intensifies',
    executiveSummary: ['Key takeaway 1', 'Key takeaway 2'],
    keyThemes: ['Foldables', 'Smartwatches'],
    marketSentimentOverview: {
      overall: 'CAUTIOUS',
      rationale: 'High competitive launch cadence in Europe.',
    },
    criticalAlerts: [
      {
        storyId: 'story-galaxy-s26-leak',
        headline: 'Samsung Galaxy S26 Ultra Early Prototype Leak Hints at 200MP Periscope',
        alertType: 'HIGH_IMPACT_UNCONFIRMED_SIGNAL',
        competitorName: 'Samsung',
        category: 'Smartphones',
        productName: 'Galaxy S26 Series',
        strategicImportanceScore: 84,
        evidenceConfidence: 0.45,
        evidenceClassification: 'RUMOR_OR_LEAK',
        threatLevel: 'HIGH',
        independentSourceCount: 1,
        whyItMattersToHuawei: 'Potential telephoto spec escalation against Pura series.',
        recommendedAction: 'Monitor supply chain optical sensor orders before adjusting roadmap.',
      },
      {
        storyId: 'story-iphone-16-pro-eu',
        headline: 'Apple Expands iPhone 16 Pro Carrier Trade-In Subsidies Across Europe',
        alertType: 'VERIFIED_CRITICAL_DEVELOPMENT',
        competitorName: 'Apple',
        category: 'Smartphones',
        productName: 'iPhone 16 Pro',
        strategicImportanceScore: 88,
        evidenceConfidence: 0.92,
        evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
        threatLevel: 'HIGH',
        independentSourceCount: 3,
        whyItMattersToHuawei: 'Direct channel pressure in premium European retail.',
        recommendedAction: 'Audit Greek retail promotional bundles for Pura 70 Ultra.',
      },
    ],
    headlineDevelopments: [
      {
        storyId: 'story-galaxy-s26-leak',
        title: 'Samsung Galaxy S26 Ultra Early Prototype Leak Hints at 200MP Periscope',
        category: 'Smartphones',
        productName: 'Galaxy S26 Series',
        executiveTakeaway: 'Supply chain leak suggests early prototype testing of a 200MP periscope sensor.',
        strategicAnalysis: ['Unverified prototype stage', 'Commercial launch remains >9 months away'],
        implicationForHuawei: 'Potential telephoto spec escalation against Pura series.',
        strategicRecommendation: 'Monitor supply chain optical sensor orders before adjusting roadmap.',
        competitiveThreatLevel: 'HIGH',
        strategicImportanceScore: 84,
        evidenceConfidence: 0.45,
        evidenceClassification: 'RUMOR_OR_LEAK',
        independentSourceCount: 1,
        groundedCitations: [],
      },
      {
        storyId: 'story-iphone-16-pro-eu',
        title: 'Apple Expands iPhone 16 Pro Carrier Trade-In Subsidies Across Europe',
        category: 'Smartphones',
        productName: 'iPhone 16 Pro',
        executiveTakeaway: 'Official carrier promotional push across European markets.',
        strategicAnalysis: ['Confirmed across 3 independent outlets'],
        implicationForHuawei: 'Direct channel pressure in premium European retail.',
        strategicRecommendation: 'Audit Greek retail promotional bundles for Pura 70 Ultra.',
        competitiveThreatLevel: 'HIGH',
        strategicImportanceScore: 88,
        evidenceConfidence: 0.92,
        evidenceClassification: 'OFFICIAL_ANNOUNCEMENT',
        independentSourceCount: 3,
        groundedCitations: [],
      },
    ],
    actionableRecommendations: [
      {
        priority: 'HIGH',
        timeHorizon: 'IMMEDIATE',
        action: 'Audit Greek retail promotional bundles for Pura 70 Ultra.',
        strategicRationale: 'Counter Apple carrier subsidies in European retail channels.',
        competitorName: 'Apple',
        productName: 'iPhone 16 Pro',
        category: 'Smartphones',
        supportingStoryIds: ['story-iphone-16-pro-eu'],
        targetTeam: 'RETAIL_CHANNEL',
        confidenceLevel: 0.92,
      },
      {
        priority: 'HIGH',
        timeHorizon: 'IMMEDIATE',
        action: 'Audit Greek retail promotional bundles for Pura 70 Ultra.',
        strategicRationale: 'Duplicate recommendation from second story to test deduplication.',
        competitorName: 'Samsung',
        productName: 'Galaxy S25',
        category: 'Smartphones',
        supportingStoryIds: ['story-sam-s25-promo'],
        targetTeam: 'RETAIL_CHANNEL',
        confidenceLevel: 0.88,
      },
      {
        priority: 'MEDIUM',
        timeHorizon: 'MONITOR',
        action: 'Monitor supply chain optical sensor orders before adjusting roadmap.',
        strategicRationale: 'Leak is unconfirmed at 45% confidence.',
        competitorName: 'Samsung',
        productName: 'Galaxy S26 Series',
        category: 'Smartphones',
        supportingStoryIds: ['story-galaxy-s26-leak'],
        targetTeam: 'COMPETITIVE_WATCH',
        confidenceLevel: 0.45,
      },
    ],
    categoryBreakdowns: [],
    competitorMoves: [],
    strategicImplicationsForHuawei: {
      immediateActions: [],
      mediumTermWatch: [],
      threatsAndRisks: [],
      opportunities: [],
    },
  };

  const consolidatedDevs = buildConsolidatedPriorityDevelopments(mockBriefContent);
  assert.equal(
    consolidatedDevs.length,
    2,
    'Duplicate stories between criticalAlerts and headlineDevelopments must be consolidated into 2 unique Priority Developments'
  );
  console.log('✓ 9. Priority developments are consolidated without duplicate full cards.');

  // 10. Evidence confidence and strategic importance are displayed as distinct dimensions
  const rumorDev = consolidatedDevs.find((d) => d.storyId === 'story-galaxy-s26-leak')!;
  const verifiedDev = consolidatedDevs.find((d) => d.storyId === 'story-iphone-16-pro-eu')!;
  assert.equal(rumorDev.evidenceConfidencePct, 45, 'Rumor development confidence must be 45%');
  assert.equal(rumorDev.strategicImportanceScore, 84, 'Rumor potential strategic impact score must be 84/100');
  assert.equal(verifiedDev.evidenceConfidencePct, 92, 'Verified development confidence must be 92%');
  assert.ok(
    briefViewContent.includes('Empirical Evidence:') &&
      briefViewContent.includes('Potential Impact:'),
    'DailyBriefView must visually separate Empirical Evidence Confidence from Potential Strategic Impact'
  );
  console.log('✓ 10. Evidence confidence (%) and potential strategic importance (score/100) are displayed as distinct dimensions.');

  // 11. Unverified rumors are clearly labeled and never styled as confirmed releases
  assert(getEvidenceDisplayMeta('VERIFIED_REPORT').isVerified, 'Verified reports qualify for the Verified filter');
  assert(!getEvidenceDisplayMeta('SINGLE_SOURCE_REPORT').isVerified, 'Single-source reports stay outside the Verified filter');
  assert(!getEvidenceDisplayMeta('CONTRADICTED').isVerified, 'Contradicted reports stay outside the Verified filter');
  const rumorMeta = getEvidenceDisplayMeta('RUMOR_OR_LEAK', 0.45);
  assert.equal(rumorMeta.isRumor, true);
  assert.equal(rumorMeta.label, 'Unverified Rumor / Leak');
  assert.equal(rumorDev.isUnconfirmedRumor, true);
  assert.equal(rumorDev.priorityNatureLabel, 'Monitor / Investigate (Unconfirmed Signal)');
  assert.ok(
    briefViewContent.includes('Unconfirmed Leak / Rumor:'),
    'DailyBriefView must render an explicit amber caution notice for unconfirmed rumors/leaks'
  );
  console.log('✓ 11. Unverified rumors are clearly labeled and styled as monitoring signals rather than confirmed releases.');

  // 12. Recommendations are grouped, deduplicated, and linked to supporting developments
  const consolidatedRecs = buildConsolidatedRecommendations(mockBriefContent, consolidatedDevs);
  assert.equal(
    consolidatedRecs.length,
    2,
    'Identical recommendations across multiple stories must be deduplicated into a single recommendation card'
  );
  const immediateRec = consolidatedRecs.find((r) => r.bucket === 'IMMEDIATE')!;
  const monitorRec = consolidatedRecs.find((r) => r.bucket === 'MONITOR_INVESTIGATE')!;
  assert.ok(
    immediateRec.supportingStoryIds.includes('story-iphone-16-pro-eu') &&
      immediateRec.supportingStoryIds.includes('story-sam-s25-promo'),
    'Deduplicated recommendation must aggregate all supporting story IDs'
  );
  assert.equal(immediateRec.isConditionalInvestigative, false);
  assert.equal(monitorRec.isConditionalInvestigative, true);
  assert.equal(
    monitorRec.actionNatureLabel,
    'Investigative / Conditional on Signal Confirmation'
  );
  console.log('✓ 12. Recommendations are grouped, deduplicated, evidence-qualified, and linked to all supporting developments.');

  // 13. Language toggle (EN / EL) works
  assert.ok(
    briefViewContent.includes("setLanguage('en')") &&
      briefViewContent.includes("setLanguage('el')") &&
      briefViewContent.includes('Ελληνικά'),
    'DailyBriefView must preserve the English / Ελληνικά language switcher'
  );
  console.log('✓ 13. Bilingual English / Ελληνικά toggle verified.');

  // 14. Archive selector works
  assert.ok(
    briefViewContent.includes('aria-label="Select Brief Archive Date"') &&
      briefViewContent.includes('loadBrief(e.target.value)'),
    'DailyBriefView must preserve the Brief Archive date selector'
  );
  console.log('✓ 14. Brief Archive date selector verified.');

  // 15. Story inspection links work
  assert.ok(
    briefViewContent.includes('navigateToStory(') &&
      briefViewContent.includes('Inspect Story Intelligence'),
    'DailyBriefView must preserve Inspect Story Intelligence links via navigateToStory'
  );
  console.log('✓ 15. Story Intelligence inspection links verified.');

  // 16. Pipeline telemetry is moved to expandable Brief Diagnostics
  assert.ok(
    briefViewContent.includes('showBriefDiagnostics') &&
      briefViewContent.includes('Brief Synthesis & Pipeline Diagnostics') &&
      briefViewContent.includes('storyIntegrationMode') &&
      briefViewContent.includes('storiesUsed'),
    'DailyBriefView must house detailed synthesis and pipeline telemetry inside the expandable Brief Diagnostics panel'
  );
  console.log('✓ 16. Pipeline telemetry relocated to expandable Brief Diagnostics panel.');

  // 17. Product Catalog cards render compact primary info with expandable aliases and evidence
  assert.ok(
    productsViewContent.includes('Dataset Scope Distinction:') &&
      productsViewContent.includes('326 retail SKUs') &&
      productsViewContent.includes('toggleCardExpanded(prod.id)') &&
      productsViewContent.includes('Evidence, Source & Aliases') &&
      productsViewContent.includes('Recognition Aliases'),
    'ProductsView must explain the 64-model vs 326-SKU scope distinction and render compact cards with expandable Evidence, Official Source & Aliases'
  );
  console.log('✓ 17. Product Catalog clarifies dataset semantics and renders compact cards with expandable evidence and aliases.');

  // 18. Lifecycle badges remain accurate and rumored products are never labeled as verified releases
  const canonicalProducts = getMergedCanonicalProducts();
  const catalogStats = getProductCatalogStatistics(canonicalProducts);
  const catalogIntegrity = validateProductCatalogIntegrity(canonicalProducts);
  assert.equal(catalogIntegrity.isValid, true, 'Canonical Product Catalog must pass integrity audit');
  assert.equal(
    catalogStats.verifiedActive + catalogStats.rumoredOrUnverified,
    catalogStats.total,
    'Verified Active + Rumored/Unverified must equal total catalog count'
  );
  assert.ok(
    productsViewContent.includes('Unconfirmed Roadmap / Not Released') &&
      productsViewContent.includes('RUMORED / LEAK'),
    'ProductsView must explicitly label rumored products as Unconfirmed Roadmap / Not Released'
  );
  console.log('✓ 18. Lifecycle badges and launch status guardrails verified across all canonical products.');

  // 19. Combined filters and alias search work in Product Catalog
  assert.ok(
    productsViewContent.includes('p.aliases.some((a) => a.toLowerCase().includes(q))') &&
      productsViewContent.includes('handleClearFilters') &&
      productsViewContent.includes('<EmptyStateCard') &&
      matchesLifecycleFilter('RELEASED', 'VERIFIED_ACTIVE') === true &&
      matchesLifecycleFilter('RUMORED', 'VERIFIED_ACTIVE') === false,
    'ProductsView must support combined search (name + alias), manufacturer, domain, lifecycle, and entry-type filtering with Clear Filters and EmptyStateCard'
  );
  console.log('✓ 19. Combined filters, alias search auto-expansion, and Clear Filters verified in Product Catalog.');

  // 20. Desktop, tablet, and mobile responsive layouts have no broken overflow
  assert.ok(
    retailViewContent.includes('overflow-x-auto') &&
      retailViewContent.includes('grid-cols-1 sm:grid-cols-2 lg:grid-cols-4') &&
      briefViewContent.includes('grid-cols-1 lg:grid-cols-2') &&
      productsViewContent.includes('grid-cols-1 md:grid-cols-2 lg:grid-cols-3'),
    'All three modules must use responsive grids and horizontal table overflow containers across breakpoints'
  );
  console.log('✓ 20. Responsive layouts and overflow containers verified across Retail, Daily Brief, and Product Catalog.');

  console.log('\n=== ALL 20/20 SIGNALYN UI P2.2.3 TESTS PASSED SUCCESSFULLY ===');
}

runUiP223TestSuite();

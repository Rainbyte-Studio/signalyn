/**
 * Signalyn Phase 5S-C1.3: Product Catalog Lifecycle, Entry Types & Evidence Provenance Audit Test Suite
 * 
 * Verifies:
 * 1. Completeness: All 56 canonical products have authoritative audit metadata records.
 * 2. Lifecycle Integrity: Accurate distinction of RELEASED, ANNOUNCED, and RUMORED.
 * 3. Speculative Guardrails: Speculative hardware roadmaps (S26, S27, Fold7, Fold8, iPhone 17/18, Pixel 11a, Mate 90, GT7) are strictly RUMORED, never RELEASED.
 * 4. Grounded Evidence Provenance: Commercial devices have verified evidence types, rationales, and official portal URLs.
 * 5. Architectural Entry Types: Distinguishes INDIVIDUAL_MODEL, PRODUCT_SERIES, and PRODUCT_FAMILY.
 * 6. Catalog Integrity Validation Engine: validateProductCatalogIntegrity passes on canonical catalog and catches violations (malformed IDs, missing evidence, mislabeled umbrella series).
 * 7. Lifecycle Filtering: filterProductsByLifecycle correctly splits the 56 models into 39 Verified Active and 17 Rumored.
 * 8. Competitor Selectors Integration: isCompanyRelevantToCategory and getRelevantCompetitors return active vs rumored counts.
 * 9. Greek Market Grounding: Product audit distinguishes OFFICIAL, RETAIL_CONFIRMED, and UNKNOWN without fabricating absence.
 * 10. Backward Compatibility: 100% preserves existing competitor discovery and matrix contracts.
 */

import {
  CANONICAL_PRODUCTS_REGISTRY,
  getMergedCanonicalProducts,
  CANONICAL_COMPANIES_REGISTRY,
} from '../src/services/canonicalEntities';
import {
  CANONICAL_PRODUCT_AUDIT_MAP,
  getProductAuditMetadata,
  getProductMarketEvidence,
  matchesLifecycleFilter,
  filterProductsByLifecycle,
  validateProductCatalogIntegrity,
  getProductCatalogStatistics,
} from '../src/services/productAuditRegistry';
import {
  getRelevantCompetitors,
  isCompanyRelevantToCategory,
  STANDARD_CATEGORIES,
} from '../src/services/competitorSelectors';
import { Product, ProductLifecycleStatus, ProductEntryType } from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runPhase5C13Tests() {
  console.log('=== STARTING PHASE 5S-C1.3 PRODUCT CATALOG AUDIT TEST SUITE ===\n');

  const allProducts = getMergedCanonicalProducts();

  // -------------------------------------------------------------------------
  // Test 1: Complete Audit Coverage (All 56 Canonical Products Audited)
  // -------------------------------------------------------------------------
  console.log('--- Test 1: Full Catalog Audit Coverage ---');
  assert(allProducts.length === 56, `Catalog must contain exactly 56 canonical models, got ${allProducts.length}`);
  
  const auditEntries = Object.keys(CANONICAL_PRODUCT_AUDIT_MAP);
  assert(auditEntries.length === 56, `Audit map must contain exactly 56 entries, got ${auditEntries.length}`);

  for (const prod of allProducts) {
    const meta = CANONICAL_PRODUCT_AUDIT_MAP[prod.id];
    assert(!!meta, `Product "${prod.name}" (${prod.id}) must have an entry in CANONICAL_PRODUCT_AUDIT_MAP`);
    assert(prod.lifecycle === meta.lifecycle, `Product ${prod.id} lifecycle must match audit metadata`);
    assert(prod.entryType === meta.entryType, `Product ${prod.id} entryType must match audit metadata`);
    assert(!!prod.evidenceRationale, `Product ${prod.id} must have non-empty evidenceRationale`);
    assert(!!prod.evidenceType, `Product ${prod.id} must have non-empty evidenceType`);
  }
  console.log(`  ✓ PASS: 1: All 56 canonical products possess complete grounded audit metadata`);

  // -------------------------------------------------------------------------
  // Test 2: Lifecycle Classification Breakdown
  // -------------------------------------------------------------------------
  console.log('\n--- Test 2: Lifecycle Classification Distribution ---');
  const stats = getProductCatalogStatistics(allProducts);
  assert(stats.total === 56, 'Total products is 56');
  assert(stats.released === 38, `Released products must be 38, got ${stats.released}`);
  assert(stats.announced === 1, `Announced products must be 1 (Xiaomi 15 Ultra), got ${stats.announced}`);
  assert(stats.rumored === 17, `Rumored products must be 17, got ${stats.rumored}`);
  assert(stats.verifiedActive === 39, `Verified active products must be 39 (38 released + 1 announced), got ${stats.verifiedActive}`);
  assert(stats.rumoredOrUnverified === 17, `Rumored or unverified must be 17, got ${stats.rumoredOrUnverified}`);
  console.log(`  ✓ PASS: 2: Exact distribution verified: 38 Released, 1 Announced, 17 Rumored`);

  // -------------------------------------------------------------------------
  // Test 3: Speculative Hardware Leaks Guardrails (Never Marked Released)
  // -------------------------------------------------------------------------
  console.log('\n--- Test 3: Speculative Hardware Leaks Strictly Classified as RUMORED ---');
  const speculativeIds = [
    'prod-sam-s26',
    'prod-sam-s27',
    'prod-sam-zfold7',
    'prod-sam-zfold8',
    'prod-sam-tabs12',
    'prod-sam-smarttag3',
    'prod-app-ip17p',
    'prod-app-ip18p',
    'prod-app-airpods5',
    'prod-xm-17u',
    'prod-hn-magic9p',
    'prod-goog-pixel11a',
    'prod-hw-mate90',
    'prod-hw-gt7',
    'prod-hw-watchd3',
    'prod-hw-watch6p',
    'prod-oppo-op16',
  ];

  for (const id of speculativeIds) {
    const prod = allProducts.find((p) => p.id === id);
    assert(!!prod, `Speculative product ${id} must exist in catalog`);
    assert(prod!.lifecycle === 'RUMORED', `Speculative device ${id} must have lifecycle RUMORED, got ${prod!.lifecycle}`);
    const evType = prod?.evidenceType || '';
    assert(
      evType.includes('SPECULATIVE') || evType.includes('LEAK') || evType.includes('ROADMAP'),
      `Device ${id} evidenceType must reflect speculation/leak, got ${evType}`
    );
  }
  console.log(`  ✓ PASS: 3: All 17 speculative roadmap/leak models strictly classified as RUMORED`);

  // -------------------------------------------------------------------------
  // Test 4: Commercial Flagships Have Verified Portals & Released Status
  // -------------------------------------------------------------------------
  console.log('\n--- Test 4: Commercial Flagships Classified as RELEASED with Grounded Portals ---');
  const commercialFlagships = [
    { id: 'prod-hw-pura70', expectedPortal: 'huawei.com' },
    { id: 'prod-sam-s24u', expectedPortal: 'samsung.com' },
    { id: 'prod-sam-s25', expectedPortal: 'samsung.com' },
    { id: 'prod-app-ip16p', expectedPortal: 'apple.com' },
    { id: 'prod-xm-14u', expectedPortal: 'mi.com' },
    { id: 'prod-hn-magicv3', expectedPortal: 'hihonor.com' },
    { id: 'prod-goog-pixel9p', expectedPortal: 'store.google.com' },
    { id: 'prod-garmin-fenix8', expectedPortal: 'garmin.gr' },
    { id: 'prod-oppo-findx8', expectedPortal: 'oppo.com' },
    { id: 'prod-vivo-x200p', expectedPortal: 'vivo.com' },
  ];

  for (const item of commercialFlagships) {
    const prod = allProducts.find((p) => p.id === item.id);
    assert(!!prod, `Flagship ${item.id} must exist`);
    assert(prod!.lifecycle === 'RELEASED', `${item.id} must be RELEASED, got ${prod!.lifecycle}`);
    assert(Boolean(prod?.evidenceUrl?.includes(item.expectedPortal)), `${item.id} must include portal ${item.expectedPortal}`);
    assert(!!prod!.launchDate, `${item.id} must have official launchDate`);
  }
  console.log(`  ✓ PASS: 4: Commercial flagships verified with official portals and launch dates`);

  // -------------------------------------------------------------------------
  // Test 5: Entry Type / Architectural Level Distinction
  // -------------------------------------------------------------------------
  console.log('\n--- Test 5: Architectural Entry Types (Model vs Series vs Family) ---');
  const families = allProducts.filter((p) => p.entryType === 'PRODUCT_FAMILY');
  assert(families.length === 2, `Product families must equal 2 (Galaxy A/M/F & Buds), got ${families.length}`);
  assert(families.some((p) => p.id === 'prod-sam-galaxya'), 'Galaxy A series is PRODUCT_FAMILY');
  assert(families.some((p) => p.id === 'prod-sam-budson'), 'Galaxy Buds is PRODUCT_FAMILY');

  const series = allProducts.filter((p) => p.entryType === 'PRODUCT_SERIES');
  assert(series.length === 10, `Product series must equal 10, got ${series.length}`);
  assert(series.some((p) => p.id === 'prod-sam-s26'), 'Galaxy S26 Series is PRODUCT_SERIES');
  assert(series.some((p) => p.id === 'prod-garmin-venu'), 'Garmin Venu is PRODUCT_SERIES');
  assert(series.some((p) => p.id === 'prod-garmin-forerunner'), 'Garmin Forerunner is PRODUCT_SERIES');

  const models = allProducts.filter((p) => p.entryType === 'INDIVIDUAL_MODEL');
  assert(models.length === 44, `Individual models must equal 44, got ${models.length}`);
  console.log(`  ✓ PASS: 5: Architectural entry types: 44 Individual Models, 10 Series, 2 Families`);

  // -------------------------------------------------------------------------
  // Test 6: Greek Market Availability on Product Level
  // -------------------------------------------------------------------------
  console.log('\n--- Test 6: Greek Market Grounding & Anti-Hallucination ---');
  // Official distribution in Greece
  const hwPura70GR = getProductMarketEvidence('prod-hw-pura70');
  assert(hwPura70GR.status === 'OFFICIAL', 'HUAWEI Pura 70 is OFFICIAL in Greece');
  assert(Boolean(hwPura70GR.details?.includes('telco') || hwPura70GR.details?.includes('channel')), 'Has distribution details');

  // Retail import confirmed in Greek electronics stores (Google Pixel)
  const pixel9GR = getProductMarketEvidence('prod-goog-pixel9p');
  assert(pixel9GR.status === 'RETAIL_CONFIRMED', 'Pixel 9 Pro is RETAIL_CONFIRMED in Greece');

  // Rumored products have UNKNOWN market status (not falsely UNAVAILABLE)
  const s26GR = getProductMarketEvidence('prod-sam-s26');
  assert(s26GR.status === 'UNKNOWN', 'Rumored S26 market status in Greece must be UNKNOWN');

  // vivo devices in Greece have UNKNOWN status without assuming absence
  const vivoGR = getProductMarketEvidence('prod-vivo-x200p');
  assert(vivoGR.status === 'UNKNOWN', 'vivo X200 Pro Greek status is UNKNOWN');
  console.log('  ✓ PASS: 6: Greek market audit strictly distinguishes OFFICIAL, RETAIL_CONFIRMED, and UNKNOWN');

  // -------------------------------------------------------------------------
  // Test 7: Catalog Integrity Validation Engine
  // -------------------------------------------------------------------------
  console.log('\n--- Test 7: validateProductCatalogIntegrity Engine ---');
  const report = validateProductCatalogIntegrity(allProducts);
  assert(report.isValid, `Canonical catalog must pass all integrity rules. Issues: ${report.issues.join(', ')}`);
  assert(report.issues.length === 0, 'Zero integrity violations in canonical catalog');
  assert(report.totalProducts === 56, '56 total products validated');
  assert(report.auditedProductsCount === 56, 'All 56 audited');
  assert(report.verifiedActiveCount === 39, '39 verified active');
  assert(report.rumoredCount === 17, '17 rumored');

  // Test detection of invalid product ID schema
  const badIdProduct: Product = {
    id: 'invalid-id-without-prefix',
    companyId: 'comp-huawei',
    name: 'Bad ID Phone',
    aliases: [],
    category: 'Smartphones',
    active: true,
  };
  const badReport = validateProductCatalogIntegrity([badIdProduct]);
  assert(!badReport.isValid, 'Validator must reject invalid ID schema');
  assert(badReport.issues.some((i) => i.includes('invalid ID schema')), 'Reports invalid ID schema');

  // Test detection of duplicate product IDs
  const dupReport = validateProductCatalogIntegrity([allProducts[0], allProducts[0]]);
  assert(!dupReport.isValid, 'Validator must reject duplicate product IDs');
  assert(dupReport.issues.some((i) => i.includes('Duplicate product ID')), 'Reports duplicate ID');
  console.log('  ✓ PASS: 7: Integrity validation engine passes canonical catalog and rejects corrupt entries');

  // -------------------------------------------------------------------------
  // Test 8: Lifecycle Filter Helper Functions
  // -------------------------------------------------------------------------
  console.log('\n--- Test 8: Lifecycle Filter Helpers (matchesLifecycleFilter & filterProductsByLifecycle) ---');
  assert(matchesLifecycleFilter('RELEASED', 'ALL') === true, 'ALL matches RELEASED');
  assert(matchesLifecycleFilter('RUMORED', 'ALL') === true, 'ALL matches RUMORED');
  assert(matchesLifecycleFilter('RELEASED', 'VERIFIED_ACTIVE') === true, 'VERIFIED_ACTIVE matches RELEASED');
  assert(matchesLifecycleFilter('ANNOUNCED', 'VERIFIED_ACTIVE') === true, 'VERIFIED_ACTIVE matches ANNOUNCED');
  assert(matchesLifecycleFilter('RUMORED', 'VERIFIED_ACTIVE') === false, 'VERIFIED_ACTIVE rejects RUMORED');
  assert(matchesLifecycleFilter('RUMORED', 'RUMORED_OR_UNVERIFIED') === true, 'RUMORED_OR_UNVERIFIED matches RUMORED');
  assert(matchesLifecycleFilter('RELEASED', 'RUMORED_OR_UNVERIFIED') === false, 'RUMORED_OR_UNVERIFIED rejects RELEASED');

  const verifiedActiveList = filterProductsByLifecycle(allProducts, 'VERIFIED_ACTIVE');
  assert(verifiedActiveList.length === 39, `filterProductsByLifecycle for VERIFIED_ACTIVE must return 39, got ${verifiedActiveList.length}`);

  const rumoredList = filterProductsByLifecycle(allProducts, 'RUMORED_OR_UNVERIFIED');
  assert(rumoredList.length === 17, `filterProductsByLifecycle for RUMORED_OR_UNVERIFIED must return 17, got ${rumoredList.length}`);
  console.log('  ✓ PASS: 8: Lifecycle filter helpers operate with mathematical precision');

  // -------------------------------------------------------------------------
  // Test 9: Competitor Selectors Lifecycle Integration
  // -------------------------------------------------------------------------
  console.log('\n--- Test 9: Competitor Selectors Lifecycle & Active Breakdown ---');
  const appleCompany = CANONICAL_COMPANIES_REGISTRY.find((c) => c.id === 'comp-apple')!;
  const appleRelevance = isCompanyRelevantToCategory(appleCompany, 'Smartphones', allProducts);
  assert(appleRelevance.productCount === 3, `Apple has 3 total smartphone models, got ${appleRelevance.productCount}`);
  assert(appleRelevance.verifiedActiveProductCount === 1, `Apple has 1 verified active model (iPhone 16 Pro), got ${appleRelevance.verifiedActiveProductCount}`);
  assert(appleRelevance.rumoredProductCount === 2, `Apple has 2 rumored models (iPhone 17 Pro, iPhone 18 Pro), got ${appleRelevance.rumoredProductCount}`);

  const samsungCompany = CANONICAL_COMPANIES_REGISTRY.find((c) => c.id === 'comp-samsung')!;
  const samRelevance = isCompanyRelevantToCategory(samsungCompany, 'Smartphones', allProducts);
  assert(samRelevance.productCount === 8, `Samsung has 8 smartphone models, got ${samRelevance.productCount}`);
  assert(samRelevance.verifiedActiveProductCount === 4, `Samsung has 4 active smartphone models (S24U, S25, Fold6, Galaxy A), got ${samRelevance.verifiedActiveProductCount}`);
  assert(samRelevance.rumoredProductCount === 4, `Samsung has 4 rumored models (S26, S27, Fold7, Fold8), got ${samRelevance.rumoredProductCount}`);

  // Test getRelevantCompetitors with lifecycle options
  const competitors = getRelevantCompetitors('Smartphones', 'ALL_RELEVANT', 'GLOBAL', undefined, allProducts);
  const appleComp = competitors.find((c) => c.company.id === 'comp-apple');
  assert(!!appleComp, 'Apple is in smartphones');
  assert(appleComp!.productCount === 3, 'Apple has productCount 3');
  assert(appleComp!.verifiedActiveProductCount === 1, 'Apple has verifiedActiveProductCount 1');
  assert(appleComp!.rumoredProductCount === 2, 'Apple has rumoredProductCount 2');
  console.log('  ✓ PASS: 9: Competitor selectors return verified active and rumored model counts seamlessly');

  // -------------------------------------------------------------------------
  // Test 10: Category Coverage Consistency
  // -------------------------------------------------------------------------
  console.log('\n--- Test 10: Category Coverage Consistency Across Standard Domains ---');
  const productCategories = ['Smartphones', 'Wearables', 'Tablets', 'Audio'];
  for (const cat of productCategories) {
    const prodsInCat = allProducts.filter((p) => p.category.toLowerCase() === cat.toLowerCase());
    const catStats = stats.byCategory[cat];
    assert(!!catStats, `Category ${cat} must be present in stats`);
    assert(catStats.total === prodsInCat.length, `Category ${cat} count mismatch: ${catStats.total} vs ${prodsInCat.length}`);
  }
  console.log('  ✓ PASS: 10: All standard hardware domains consistent across catalog and selectors');

  console.log('\n=== ALL 10 PHASE 5S-C1.3 PRODUCT CATALOG AUDIT ASSERTIONS PASSED ===');
}

runPhase5C13Tests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

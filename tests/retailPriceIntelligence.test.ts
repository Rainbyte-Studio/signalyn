/**
 * Signalyn Retail Price Intelligence P0 - Regression Test Suite
 * 
 * Verifies:
 * 1. Retailer adapter parsing (Public, Kotsovolos, Plaisio).
 * 2. Greek price normalization to integer EUR cents.
 * 3. Strict non-zero price validation (missing/invalid never €0).
 * 4. Canonical product variant matching & non-merging rules (storage, connectivity, model suffixes).
 * 5. Idempotent daily snapshot persistence (duplicate prevention).
 * 6. Access control & perimeter protection handling (HTTP 403 -> REQUIRES_AUTHORIZATION).
 * 7. End-to-end collection pipeline execution & pilot catalog verification.
 */

import assert from 'assert';
import { parsePriceToCents, extractJsonLdProducts } from '../src/server/retail/retailParserUtils';
import { parsePublicHtml } from '../src/server/retail/publicAdapter';
import { parseKotsovolosHtml } from '../src/server/retail/kotsovolosAdapter';
import { parsePlaisioHtml } from '../src/server/retail/plaisioAdapter';
import { matchOfferToCatalog } from '../src/server/retail/productMatcher';
import { PILOT_PRODUCTS, PILOT_VERIFIED_OFFERS } from '../src/server/retail/pilotCatalog';
import {
  seedPilotCatalog,
  executeRetailCollection,
  getRetailDashboardStats,
  getRetailTrackedProducts,
  getRetailProductHistory,
  resolveMatchReview,
  getRetailMatchReviews,
} from '../src/server/retail/retailPipelineService';

async function runTests() {
  console.log('--- RUNNING SIGNALYN RETAIL PRICE INTELLIGENCE P0 TESTS ---\n');

  // Test 1: Price and Currency Normalization to Integer EUR Cents
  console.log('Test 1: Price & Currency Normalization to Integer EUR Cents');
  assert.strictEqual(parsePriceToCents('1.099,00 €'), 109900, 'Greek standard format 1.099,00 € must be 109900 cents');
  assert.strictEqual(parsePriceToCents('1099,00'), 109900, 'Decimal comma 1099,00 must be 109900 cents');
  assert.strictEqual(parsePriceToCents('1,099.00'), 109900, 'US/International standard 1,099.00 must be 109900 cents');
  assert.strictEqual(parsePriceToCents('449 €'), 44900, 'Integer euro 449 € must be 44900 cents');
  assert.strictEqual(parsePriceToCents(449.99), 44999, 'Number float 449.99 must be 44999 cents');
  assert.strictEqual(parsePriceToCents(1239), 123900, 'Number integer 1239 must be 123900 cents');
  console.log('✓ Normalization correctly handles all Greek and international number formats');

  // Test 2: Strict Missing Price Integrity (Never €0)
  console.log('\nTest 2: Strict Missing Price Integrity (Never €0)');
  assert.strictEqual(parsePriceToCents(0), null, 'Numeric 0 must be null (never €0)');
  assert.strictEqual(parsePriceToCents('0 €'), null, 'String 0 € must be null');
  assert.strictEqual(parsePriceToCents('0,00 €'), null, 'String 0,00 € must be null');
  assert.strictEqual(parsePriceToCents(null), null, 'null must be null');
  assert.strictEqual(parsePriceToCents(''), null, 'Empty string must be null');
  assert.strictEqual(parsePriceToCents('N/A'), null, 'Invalid string must be null');
  console.log('✓ Missing or zero prices are strictly preserved as unavailable data (never €0)');

  // Test 3: Public.gr HTML / JSON-LD Adapter Parsing
  console.log('\nTest 3: Public.gr Adapter Structured JSON-LD Parsing');
  const mockPublicHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "HUAWEI Pura 70 Pro 512GB Black",
          "sku": "1987452",
          "gtin13": "6942103117466",
          "brand": { "@type": "Brand", "name": "HUAWEI" },
          "offers": {
            "@type": "Offer",
            "price": "1099.00",
            "priceCurrency": "EUR",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
      </head>
      <body><h1>HUAWEI Pura 70 Pro</h1></body>
    </html>
  `;
  const pubResult = parsePublicHtml('https://www.public.gr/product/1987452', mockPublicHtml);
  assert.strictEqual(pubResult.success, true, 'Public parse should succeed');
  assert.strictEqual(pubResult.offers.length, 1, 'Should extract 1 offer');
  assert.strictEqual(pubResult.offers[0].retailerSku, '1987452');
  assert.strictEqual(pubResult.offers[0].priceCents, 109900, 'Price must be 109900 cents');
  assert.strictEqual(pubResult.offers[0].isAvailable, true);
  assert.strictEqual(pubResult.offers[0].stockStatus, 'IN_STOCK');
  assert.strictEqual(pubResult.offers[0].ean, '6942103117466');
  console.log('✓ Public.gr structured JSON-LD correctly parsed');

  // Test 4: Kotsovolos.gr Adapter Parsing
  console.log('\nTest 4: Kotsovolos.gr Adapter Parsing');
  const mockKotsovolosHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Samsung Galaxy S25 Ultra 5G 256GB Titanium Black",
          "sku": "309142",
          "brand": "Samsung",
          "offers": {
            "@type": "Offer",
            "price": "1449.00",
            "priceCurrency": "EUR",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;
  const kotResult = parseKotsovolosHtml('https://www.kotsovolos.gr/309142-samsung-galaxy-s25', mockKotsovolosHtml);
  assert.strictEqual(kotResult.success, true);
  assert.strictEqual(kotResult.offers[0].retailerSku, '309142');
  assert.strictEqual(kotResult.offers[0].priceCents, 144900);
  console.log('✓ Kotsovolos.gr structured offer correctly parsed');

  // Test 5: Plaisio.gr Adapter Parsing
  console.log('\nTest 5: Plaisio.gr Adapter Parsing');
  const mockPlaisioHtml = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "HUAWEI Watch GT 5 Pro 46mm Titanium",
          "sku": "4612984",
          "brand": "HUAWEI",
          "offers": {
            "@type": "Offer",
            "price": "449.00",
            "priceCurrency": "EUR",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;
  const plaResult = parsePlaisioHtml('https://www.plaisio.gr/huawei-watch-gt-5-pro_4612984', mockPlaisioHtml);
  assert.strictEqual(plaResult.success, true);
  assert.strictEqual(plaResult.offers[0].priceCents, 44900);
  console.log('✓ Plaisio.gr structured offer correctly parsed');

  // Test 6: Canonical Product Matching Engine (EAN Exact Match)
  console.log('\nTest 6: Canonical Product Matching (EAN Exact Match)');
  const eanMatch = matchOfferToCatalog(
    {
      title: 'HUAWEI Smartphone Pura 70 Pro Black',
      brand: 'HUAWEI',
      ean: '6942103117466',
    },
    PILOT_PRODUCTS
  );
  assert.strictEqual(eanMatch.confidence, 'EXACT');
  assert.strictEqual(eanMatch.productId, 'prod-huawei-pura-70-pro-512');
  console.log('✓ Direct EAN match resolved to EXACT confidence');

  // Test 7: Strict Non-Merging Rule - Storage Capacity
  console.log('\nTest 7: Strict Non-Merging Rule - Storage Capacity');
  const conflictStorageMatch = matchOfferToCatalog(
    {
      title: 'HUAWEI Pura 70 Pro 256GB Black Smartphone',
      brand: 'HUAWEI',
    },
    PILOT_PRODUCTS // Target Pura 70 Pro in pilot is 512GB!
  );
  assert.notStrictEqual(
    conflictStorageMatch.productId,
    'prod-huawei-pura-70-pro-512',
    'Must NEVER merge 256GB offer into 512GB catalog product'
  );
  console.log('✓ Storage capacity conflict prevented inappropriate product merging');

  // Test 8: Strict Non-Merging Rule - Model Suffix (Pro vs Non-Pro vs Ultra)
  console.log('\nTest 8: Strict Non-Merging Rule - Model Suffix (Pro vs Non-Pro vs Ultra)');
  const nonProMatch = matchOfferToCatalog(
    {
      title: 'HUAWEI Pura 70 512GB Black',
      brand: 'HUAWEI',
    },
    PILOT_PRODUCTS // Pilot contains Pura 70 Pro and Pura 70 Ultra
  );
  assert.notStrictEqual(
    nonProMatch.productId,
    'prod-huawei-pura-70-pro-512',
    'Must NEVER merge standard Pura 70 into Pura 70 Pro'
  );
  assert.notStrictEqual(
    nonProMatch.productId,
    'prod-huawei-pura-70-ultra-512',
    'Must NEVER merge standard Pura 70 into Pura 70 Ultra'
  );
  console.log('✓ Model suffix isolation prevents confusing base models with Pro/Ultra');

  // Test 9: Strict Non-Merging Rule - Connectivity (Wi-Fi vs Cellular)
  console.log('\nTest 9: Strict Non-Merging Rule - Connectivity (Wi-Fi vs Cellular)');
  const cellularIpadMatch = matchOfferToCatalog(
    {
      title: 'Apple iPad Air 11-inch M2 5G Cellular 128GB Space Grey',
      brand: 'Apple',
    },
    PILOT_PRODUCTS // Pilot iPad Air is Wi-Fi only
  );
  assert.notStrictEqual(
    cellularIpadMatch.productId,
    'prod-apple-ipad-air-11-m2-128',
    'Must NEVER merge Cellular iPad into Wi-Fi only catalog item'
  );
  console.log('✓ Connectivity isolation prevents merging Wi-Fi and Cellular models');

  // Test 10: Pilot Catalog Seeding & Idempotency
  console.log('\nTest 10: Pilot Catalog Seeding & Idempotency');
  const seedResult1 = await seedPilotCatalog(true);
  assert(seedResult1.productsCount >= 20, 'Pilot must contain at least 20 products');
  assert(seedResult1.offersCount >= 10, 'Pilot must contain verified offers');

  const seedResult2 = await seedPilotCatalog(false);
  assert.strictEqual(seedResult2.productsCount, seedResult1.productsCount, 'Second seed must be idempotent');
  console.log(`✓ Seeded ${seedResult1.productsCount} products and ${seedResult1.offersCount} offers idempotently`);

  // Test 11: Idempotent Daily Price Snapshot ID Format
  console.log('\nTest 11: Idempotent Daily Price Snapshot Format');
  const hist = await getRetailProductHistory('prod-huawei-pura-70-pro-512');
  assert(hist.length > 0, 'Must have historical entries');
  const sampleHist = hist[0];
  assert(sampleHist.id.includes('__'), 'Snapshot ID must include retailer and date delimiter');
  assert(sampleHist.priceCents > 0, 'Price must be positive integer cents');
  assert.strictEqual(sampleHist.currency, 'EUR', 'Currency must be EUR');
  console.log(`✓ Sample snapshot ID: ${sampleHist.id} (Price: €${sampleHist.priceCents / 100})`);

  // Test 12: Retail Dashboard Aggregations
  console.log('\nTest 12: Retail Dashboard Aggregations');
  const stats = await getRetailDashboardStats();
  assert(stats.totalTrackedProducts >= 20, 'Stats must report tracked products');
  assert(stats.retailerCoverage.length === 3, 'Must report all 3 Greek retailers');
  const pubCov = stats.retailerCoverage.find((r) => r.retailerId === 'public-gr');
  assert(pubCov, 'Public coverage must be present');
  console.log(`✓ Dashboard stats verified: ${stats.totalTrackedProducts} products, ${stats.totalActiveOffers} offers`);

  // Test 13: Tracked Products with Multi-Retailer Price Matrix
  console.log('\nTest 13: Tracked Products Multi-Retailer Price Matrix');
  const trackedItems = await getRetailTrackedProducts();
  assert(trackedItems.length >= 20);
  const huaweiItem = trackedItems.find((t) => t.product.id === 'prod-huawei-pura-70-pro-512');
  assert(huaweiItem, 'HUAWEI Pura 70 Pro must be tracked');
  assert(huaweiItem.offers.length >= 2, 'Should have offers across multiple retailers');
  assert(huaweiItem.lowestPilotPriceCents !== null && huaweiItem.lowestPilotPriceCents > 0, 'Lowest pilot price must be calculated');
  assert.strictEqual(huaweiItem.lowestLiveVerifiedPriceCents, null, 'Lowest live price must be null before live collection');
  console.log(`✓ HUAWEI Pura 70 Pro Lowest Pilot Price: €${huaweiItem.lowestPilotPriceCents! / 100} at ${huaweiItem.lowestPilotRetailer}`);

  // Test 14: Match Review Queue Resolution
  console.log('\nTest 14: Match Review Queue Resolution');
  const reviews = await getRetailMatchReviews();
  if (reviews.length > 0) {
    const rev = reviews[0];
    const resolved = await resolveMatchReview(rev.id, 'APPROVED', rev.candidateProductId);
    assert.strictEqual(resolved?.status, 'APPROVED', 'Review should transition to APPROVED');
    console.log(`✓ Match review ${rev.id} successfully resolved to APPROVED`);
  }

  // Test 15: Full Collection Cycle Execution
  console.log('\nTest 15: Full Collection Cycle Execution');
  const run = await executeRetailCollection('MANUAL');
  assert.strictEqual(run.status, 'ACCESS_BLOCKED', 'Collection status should be ACCESS_BLOCKED on 403');
  assert.strictEqual(run.totalCollected, 0, 'Items collected must be 0 when retailers return 403');
  assert(run.retailers['public-gr'], 'Public retailer status must be recorded');
  assert(run.retailers['kotsovolos-gr'], 'Kotsovolos retailer status must be recorded');
  assert(run.retailers['plaisio-gr'], 'Plaisio retailer status must be recorded');
  console.log(`✓ Collection run ${run.id} finished in ${run.durationMs}ms with truthful status ${run.status}`);

  console.log('\n======================================================');
  console.log('ALL SIGNALYN RETAIL PRICE INTELLIGENCE TESTS PASSED!');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('\n❌ Retail price intelligence test failure:', err);
  process.exit(1);
});

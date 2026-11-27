/**
 * Signalyn Retail Price Intelligence P1.7 - Brand Normalization & Product Deduplication Tests
 */

import assert from 'assert';
import {
  normalizeBrand,
  getCanonicalBrandDisplayName,
  getCanonicalBrandId,
  isSameBrand,
  matchesBrandFilter,
  auditBrandDuplicates,
  normalizeProductTitleForMatching,
} from '../src/utils/brandNormalizer';
import {
  auditProductDuplicates,
  extractStorageAttribute,
  extractColorAttribute,
  extractWatchSizeAttribute,
} from '../src/server/retail/productDeduplicationService';
import { classifyProductTaxonomy } from '../src/server/retail/taxonomyClassifier';
import { DEFAULT_CATEGORY_URLS } from '../src/server/retail/retailSourceDefaults';
import { RetailProduct, RetailOffer } from '../src/types/retailPrice';

async function runP17Tests() {
  console.log('--- RUNNING SIGNALYN P1.7 TESTS ---\n');

  // Test 1: Brand Normalization
  console.log('Test 1: Centralized Brand Normalization & Canonical Display Names');
  const testCases: Array<[string, string, string]> = [
    ['APPLE', 'apple', 'Apple'],
    ['Apple', 'apple', 'Apple'],
    ['apple', 'apple', 'Apple'],
    ['BlackView', 'blackview', 'Blackview'],
    ['blackview', 'blackview', 'Blackview'],
    ['CELLULAR LINE', 'cellular-line', 'Cellular Line'],
    ['Cellular Line', 'cellular-line', 'Cellular Line'],
    ['cellularline', 'cellular-line', 'Cellular Line'],
    ['EDIFIER', 'edifier', 'Edifier'],
    ['Edifier', 'edifier', 'Edifier'],
    ['GARMIN', 'garmin', 'Garmin'],
    ['Garmin', 'garmin', 'Garmin'],
    ['HUAWEI', 'huawei', 'Huawei'],
    ['Huawei', 'huawei', 'Huawei'],
    ['SAMSUNG', 'samsung', 'Samsung'],
    ['Samsung', 'samsung', 'Samsung'],
    ['XIAOMI', 'xiaomi', 'Xiaomi'],
    ['Xiaomi', 'xiaomi', 'Xiaomi'],
    ['SONY', 'sony', 'Sony'],
    ['Sony', 'sony', 'Sony'],
    ['LENOVO', 'lenovo', 'Lenovo'],
    ['Lenovo', 'lenovo', 'Lenovo'],
    ['KIDDOBOO', 'kiddoboo', 'Kiddoboo'],
    ['Kiddoboo', 'kiddoboo', 'Kiddoboo'],
  ];

  for (const [raw, expectedId, expectedDisplay] of testCases) {
    const norm = normalizeBrand(raw);
    assert.strictEqual(norm.id, expectedId, `Brand id for "${raw}" must be "${expectedId}"`);
    assert.strictEqual(norm.displayName, expectedDisplay, `Brand display name for "${raw}" must be "${expectedDisplay}"`);
  }
  console.log('✓ All brand variations normalize to identical canonical IDs and display names.');

  // Test 2: Brand Equality & Filtering
  console.log('\nTest 2: Brand Equality & Filtering');
  assert.ok(isSameBrand('APPLE', 'Apple'), 'APPLE and Apple must be same brand');
  assert.ok(isSameBrand('HUAWEI', 'Huawei'), 'HUAWEI and Huawei must be same brand');
  assert.ok(isSameBrand('CELLULAR LINE', 'Cellular Line'), 'CELLULAR LINE and Cellular Line must be same brand');
  assert.ok(!isSameBrand('Apple', 'Samsung'), 'Apple and Samsung must NOT be same brand');
  assert.ok(!isSameBrand('Huawei', 'Honor'), 'Huawei and Honor must NOT be merged as same brand');

  assert.ok(matchesBrandFilter('APPLE', 'Apple'), 'Filter matching Apple must match APPLE');
  assert.ok(matchesBrandFilter('Cellular Line', 'CELLULAR LINE'), 'Filter matching CELLULAR LINE must match Cellular Line');
  console.log('✓ Brand equality and alias-aware filtering operate accurately.');

  // Test 3: Brand Duplicate Audit
  console.log('\nTest 3: Brand Duplicate Audit');
  const sampleProducts = [
    { brand: 'APPLE', productId: 'p1' },
    { brand: 'Apple', productId: 'p2' },
    { brand: 'HUAWEI', productId: 'p3' },
    { brand: 'Huawei', productId: 'p4' },
    { brand: 'Samsung', productId: 'p5' },
  ];
  const audit = auditBrandDuplicates(sampleProducts);
  assert.strictEqual(audit.totalUniqueRawBrands, 5);
  assert.strictEqual(audit.totalCanonicalBrands, 3);
  assert.strictEqual(audit.duplicateGroupCount, 2);
  console.log('✓ Brand audit correctly aggregates variations into single canonical entries.');

  // Test 4: Terminology Normalization in Product Titles
  console.log('\nTest 4: Product Title Terminology Normalization');
  const t1 = normalizeProductTitleForMatching('Apple AirPods 4 Active Noise Cancellation');
  const t2 = normalizeProductTitleForMatching('Apple Airpods 4 with Active Noise Cancellation');
  const t3 = normalizeProductTitleForMatching('Apple AirPods 4 με Active Noise Cancellation');
  assert.strictEqual(t1, 'apple airpods 4 anc');
  assert.strictEqual(t2, 'apple airpods 4 anc');
  assert.strictEqual(t3, 'apple airpods 4 anc');
  assert.strictEqual(t1, t2, 'Active Noise Cancellation and with Active Noise Cancellation must normalize identically');
  assert.strictEqual(t1, t3, 'Greek "με Active Noise Cancellation" must normalize identically');
  console.log('✓ Terminology normalization accurately equates ANC variations.');

  // Test 5: Strict Variant Isolation Rules
  console.log('\nTest 5: Strict Variant Isolation Rules');
  assert.strictEqual(extractStorageAttribute('Samsung Galaxy S24 Ultra 256GB'), '256GB');
  assert.strictEqual(extractStorageAttribute('Samsung Galaxy S24 Ultra 512GB'), '512GB');
  assert.strictEqual(extractWatchSizeAttribute('Apple Watch Series 10 42mm'), '42mm');
  assert.strictEqual(extractWatchSizeAttribute('Apple Watch Series 10 46mm'), '46mm');
  assert.strictEqual(extractColorAttribute('JBL Tune 520BT Black'), 'black');
  assert.strictEqual(extractColorAttribute('JBL Tune 520BT Blue'), 'blue');

  const productsToAudit: RetailProduct[] = [
    {
      id: 'prod-apple-airpods-4-active-noise-cancellation',
      name: 'Apple AirPods 4 Active Noise Cancellation',
      brand: 'Apple',
      category: 'AUDIO',
      modelFamily: 'AirPods 4',
      isPilot: false,
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    },
    {
      id: 'prod-apple-airpods-4-with-active-noise-cancellation',
      name: 'Apple Airpods 4 with Active Noise Cancellation',
      brand: 'Apple',
      category: 'AUDIO',
      modelFamily: 'Airpods 4',
      isPilot: false,
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    },
    // Distinct variants that must NEVER be merged:
    {
      id: 'prod-apple-airpods-4-standard',
      name: 'Apple AirPods 4', // Standard version (NO ANC)
      brand: 'Apple',
      category: 'AUDIO',
      modelFamily: 'AirPods 4',
      isPilot: false,
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    },
    {
      id: 'prod-samsung-galaxy-s24-256',
      name: 'Samsung Galaxy S24 256GB',
      brand: 'Samsung',
      category: 'SMARTPHONES',
      modelFamily: 'Galaxy S24',
      storage: '256GB',
      isPilot: false,
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    },
    {
      id: 'prod-samsung-galaxy-s24-512',
      name: 'Samsung Galaxy S24 512GB',
      brand: 'Samsung',
      category: 'SMARTPHONES',
      modelFamily: 'Galaxy S24',
      storage: '512GB',
      isPilot: false,
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    },
  ];

  const offers: RetailOffer[] = [
    {
      id: 'kotsovolos-gr__311938',
      retailerId: 'kotsovolos-gr',
      retailerName: 'Kotsovolos',
      canonicalProductId: 'prod-apple-airpods-4-active-noise-cancellation',
      matchConfidence: 'EXACT',
      title: 'Apple AirPods 4 Active Noise Cancellation',
      brand: 'Apple',
      url: 'https://www.kotsovolos.gr/sound-vision/headphones/headsets/311938',
      retailerSku: '311938',
      currentPriceCents: 15999,
      currency: 'EUR',
      isAvailable: true,
      stockStatus: 'IN_STOCK',
      priceSourceType: 'LIVE_SCRAPED',
      observationStatus: 'LIVE_VERIFIED',
      isLiveVerified: true,
      extractedAt: '2026-10-26T00:00:00Z',
      lastObservedAt: '2026-10-26T00:00:00Z',
      status: 'ACTIVE',
    },
    {
      id: 'plaisio-gr__4625633',
      retailerId: 'plaisio-gr',
      retailerName: 'Plaisio',
      canonicalProductId: 'prod-apple-airpods-4-with-active-noise-cancellation',
      matchConfidence: 'EXACT',
      title: 'Apple Airpods 4 with Active Noise Cancellation',
      brand: 'Apple',
      url: 'https://www.plaisio.gr/tilefonia-tablets/aksesouar-kiniton/akoustika/apple-airpods-4-with-active-noise-cancellation_4625633',
      retailerSku: '4625633',
      currentPriceCents: 15900,
      currency: 'EUR',
      isAvailable: true,
      stockStatus: 'IN_STOCK',
      priceSourceType: 'LIVE_SCRAPED',
      observationStatus: 'LIVE_VERIFIED',
      isLiveVerified: true,
      extractedAt: '2026-10-26T00:00:00Z',
      lastObservedAt: '2026-10-26T00:00:00Z',
      status: 'ACTIVE',
    },
  ];

  const dedupAudit = auditProductDuplicates(productsToAudit, offers);
  assert.strictEqual(dedupAudit.exactDuplicatesCount, 1, 'Exactly one exact duplicate candidate must be found');
  const exactPair = dedupAudit.candidates.find((c) => c.confidenceTier === 'EXACT_UNAMBIGUOUS');
  assert.ok(exactPair, 'Exact pair candidate must exist');
  assert.strictEqual(exactPair?.targetProductId, 'prod-apple-airpods-4-active-noise-cancellation');
  assert.strictEqual(exactPair?.duplicateProductId, 'prod-apple-airpods-4-with-active-noise-cancellation');
  assert.strictEqual(exactPair?.consolidationSafe, true);

  // Verify that Standard (No ANC) vs ANC is NEVER matched
  const standardPair = dedupAudit.candidates.find(
    (c) =>
      c.duplicateProductId === 'prod-apple-airpods-4-standard' ||
      c.targetProductId === 'prod-apple-airpods-4-standard'
  );
  assert.strictEqual(standardPair, undefined, 'AirPods 4 standard vs ANC must NEVER be matched as duplicate');

  // Verify that 256GB vs 512GB are NEVER matched
  const storagePair = dedupAudit.candidates.find(
    (c) =>
      c.targetProductId.includes('s24') || c.duplicateProductId.includes('s24')
  );
  assert.strictEqual(storagePair, undefined, 'Distinct storage variants must NEVER be matched as duplicate');
  console.log('✓ Product duplicate audit isolates exact duplicates while strictly enforcing variant guards.');

  // Test 6: Public AUDIO Default URL & Taxonomy Classification
  console.log('\nTest 6: Public AUDIO Default URL & Taxonomy Classification');
  const expectedAudioUrl = 'https://www.public.gr/cat/aksesoyar/tablet/bluetooth';
  assert.strictEqual(
    DEFAULT_CATEGORY_URLS['public-gr']['AUDIO'],
    expectedAudioUrl,
    'Default Public AUDIO URL must be https://www.public.gr/cat/aksesoyar/tablet/bluetooth'
  );

  const audioItem = classifyProductTaxonomy('Apple AirPods Pro 2 Wireless Bluetooth Earbuds', 'AUDIO');
  assert.strictEqual(audioItem.effectiveCategory, 'AUDIO');

  const tabletAccItem = classifyProductTaxonomy('Belkin Bluetooth Keyboard Case for iPad 10.9"', 'AUDIO');
  assert.strictEqual(tabletAccItem.effectiveCategory, 'TABLETS');
  console.log('✓ Public AUDIO default URL is configured and taxonomy classifier separates audio from tablet accessories.');

  console.log('\n--- ALL P1.7 TESTS PASSED SUCCESSFULLY! ---');
}

runP17Tests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

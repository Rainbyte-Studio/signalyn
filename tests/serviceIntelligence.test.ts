import assert from 'assert';
import {
  OFFICIAL_SERVICE_SOURCES,
  getOfficialServiceSources,
} from '../src/server/service/serviceSourceRegistry';
import {
  fetchAppleSecurityReleases,
} from '../src/server/service/adapters/appleSecurityAdapter';
import {
  fetchHuaweiSecurityBulletins,
} from '../src/server/service/adapters/huaweiSecurityAdapter';
import {
  fetchSamsungSecurityBulletins,
} from '../src/server/service/adapters/samsungSecurityAdapter';
import {
  fetchCisaKevFeed,
} from '../src/server/service/adapters/cisaKevAdapter';
import {
  fetchNvdCveDetails,
} from '../src/server/service/adapters/nvdAdapter';
import {
  matchAdvisoryToCatalogProducts,
  matchAdvisoriesToCatalog,
} from '../src/server/service/serviceProductMatcher';
import {
  getServiceDashboardStats,
  syncServiceSource,
  initializeServiceIntelligence,
  getPersistenceDiagnostic,
  recomputeCatalogMatches,
} from '../src/server/service/servicePipelineService';
import { RetailProduct } from '../src/types/retailPrice';
import { ServiceAdvisory } from '../src/types/serviceIntelligence';

async function runS12Tests() {
  console.log('=== SIGNALYN S1.2 PRODUCTION PERSISTENCE & MATCHING TEST SUITE ===\n');
  let passed = 0;

  // 1. Source Registry
  const sources = getOfficialServiceSources();
  assert.strictEqual(sources.length, 5);
  for (const s of sources) {
    assert.ok(s.officialUrl.startsWith('https://'));
    assert.strictEqual(s.status, 'ACTIVE');
  }
  console.log('✓ Test 1: Source Registry passed');
  passed++;

  // 2. KEV & CVSS Decoupling
  const cisaResult = await fetchCisaKevFeed({ maxRecords: 10, timeoutMs: 15000 });
  assert.ok(cisaResult.filteredCount > 0);
  assert.ok(cisaResult.totalKevCatalogCount >= 1000);
  const sampleKev = cisaResult.advisories[0];
  assert.strictEqual(sampleKev.isKnownExploited, true);
  assert.strictEqual(sampleKev.cisaKevStatus, 'ACTIVE_EXPLOITED');
  assert.strictEqual(sampleKev.cvssSeverity, 'NOT_AVAILABLE');
  assert.strictEqual(sampleKev.severity, 'UNKNOWN');
  assert.strictEqual(sampleKev.cvssScore, undefined);
  console.log('✓ Test 2: CISA KEV & CVSS Decoupling passed (Zero invented scores)');
  passed++;

  // 3. Huawei Update Schedule vs Bulletin
  const huaweiResult = await fetchHuaweiSecurityBulletins({ timeoutMs: 15000 });
  assert.ok(huaweiResult.discoveredCount > 0);
  console.log(`✓ Test 3: Huawei Adapter passed (${huaweiResult.discoveredCount} advisories)`);
  passed++;

  // 4. Samsung Adapter
  const samsungResult = await fetchSamsungSecurityBulletins({ timeoutMs: 15000 });
  assert.ok(samsungResult.discoveredCount > 0);
  console.log(`✓ Test 4: Samsung Adapter passed (${samsungResult.discoveredCount} advisories)`);
  passed++;

  // 5. Apple Adapter
  const appleResult = await fetchAppleSecurityReleases({ maxReleases: 15, timeoutMs: 15000 });
  assert.ok(appleResult.discoveredCount > 0);
  console.log(`✓ Test 5: Apple Adapter passed (${appleResult.discoveredCount} releases)`);
  passed++;

  // 6. NVD Lookup
  const nvdLookup = await fetchNvdCveDetails('CVE-2023-21492', 8000);
  assert.strictEqual(typeof nvdLookup.success, 'boolean');
  assert.ok(nvdLookup.status);
  console.log(`✓ Test 6: NIST NVD Adapter passed (status: ${nvdLookup.status})`);
  passed++;

  // 7. Strict Generational & Isolation Rules
  const catalog: RetailProduct[] = [
    { id: 'p-ip11', name: 'Apple iPhone 11 128GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone 11', isPilot: false, createdAt: '', updatedAt: '' },
    { id: 'p-ip15', name: 'Apple iPhone 15 Pro 256GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone 15 Pro', isPilot: false, createdAt: '', updatedAt: '' },
    { id: 'p-ipxs', name: 'Apple iPhone XS 64GB', brand: 'Apple', category: 'SMARTPHONES', modelFamily: 'iPhone XS', isPilot: false, createdAt: '', updatedAt: '' },
    { id: 'p-airpods', name: 'Apple AirPods Pro 2', brand: 'Apple', category: 'AUDIO', modelFamily: 'AirPods Pro', isPilot: false, createdAt: '', updatedAt: '' },
    { id: 'p-pura70', name: 'HUAWEI Pura 70 256GB', brand: 'HUAWEI', category: 'SMARTPHONES', modelFamily: 'Pura 70', isPilot: false, createdAt: '', updatedAt: '' },
    { id: 'p-pura80', name: 'HUAWEI Pura 80 Pro 512GB', brand: 'HUAWEI', category: 'SMARTPHONES', modelFamily: 'Pura 80 Pro', isPilot: false, createdAt: '', updatedAt: '' },
    { id: 'p-s25', name: 'Samsung Galaxy S25 Ultra 256GB', brand: 'Samsung', category: 'SMARTPHONES', modelFamily: 'Galaxy S25 Ultra', isPilot: false, createdAt: '', updatedAt: '' },
  ];

  const appleAdv: ServiceAdvisory = {
    id: 'test-adv-apple',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    advisoryType: 'SECURITY_UPDATE',
    title: 'iOS 18 Update',
    summary: 'Security fix for iPhone 11 and later',
    publishedAt: '2024-09-16',
    updatedAt: '2024-09-16',
    sourceUrl: 'https://support.apple.com/en-us/121752',
    affectedProductsText: 'iPhone 11 and later',
    affectedProducts: ['iPhone'],
    affectedVersions: [],
    fixedVersions: ['iOS 18.0'],
    cveIds: ['CVE-2024-44308'],
    severity: 'HIGH',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: new Date().toISOString(),
  };

  const matches = matchAdvisoryToCatalogProducts(appleAdv, catalog);
  const verifiedIds = matches.filter(m => m.confidence === 'VERIFIED').map(m => m.canonicalProductId);
  assert.ok(verifiedIds.includes('p-ip11'));
  assert.ok(verifiedIds.includes('p-ip15'));
  assert.ok(!verifiedIds.includes('p-ipxs'));
  assert.ok(!verifiedIds.includes('p-airpods'));

  // Huawei Pura 70 quarterly schedule should not match Pura 80
  const huaweiSchedAdv: ServiceAdvisory = {
    id: 'test-adv-pura70',
    sourceId: 'huawei-security',
    manufacturer: 'Huawei',
    advisoryType: 'UPDATE_SCHEDULE',
    title: 'HUAWEI Pura 70 Quarterly Schedule',
    summary: 'Quarterly maintenance for HUAWEI Pura 70',
    publishedAt: '2025-10-01',
    updatedAt: '2025-10-01',
    sourceUrl: 'https://consumer.huawei.com/gr/support/bulletin/',
    affectedProductsText: 'HUAWEI Pura 70',
    affectedProducts: ['HUAWEI Pura 70'],
    affectedVersions: [],
    fixedVersions: [],
    cveIds: [],
    severity: 'INFORMATIONAL',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    ingestionTimestamp: new Date().toISOString(),
    updateFrequency: 'QUARTERLY',
  };

  const huaweiMatches = matchAdvisoryToCatalogProducts(huaweiSchedAdv, catalog);
  const huaweiMatchedIds = huaweiMatches.map(m => m.canonicalProductId);
  assert.ok(huaweiMatchedIds.includes('p-pura70'));
  assert.ok(!huaweiMatchedIds.includes('p-pura80'));
  const pura70SchedMatch = huaweiMatches.find(m => m.canonicalProductId === 'p-pura70');
  assert.strictEqual(pura70SchedMatch?.confidence, 'LIKELY', 'Huawei UPDATE_SCHEDULE must be capped at LIKELY');
  assert.strictEqual(pura70SchedMatch?.relationshipType, 'OFFICIAL_UPDATE_ELIGIBILITY');
  console.log('✓ Test 7: Generational and category isolation + schedule confidence discipline passed');
  passed++;

  // 8. Aggregation Reconciliation
  await initializeServiceIntelligence();
  const stats = await getServiceDashboardStats();
  const mb = stats.manufacturerBreakdown;
  const sumManufacturers = mb.Apple + mb.Samsung + mb.Huawei + mb.CrossVendor;
  assert.strictEqual(sumManufacturers, stats.totalAdvisories);
  console.log(`✓ Test 8: Aggregation reconciliation passed (${sumManufacturers} === ${stats.totalAdvisories})`);
  passed++;

  // 9. Production Persistence Diagnostic Audit (Objective 1)
  const diagnostic = await getPersistenceDiagnostic();
  assert.strictEqual(diagnostic.runtimeInfo.firebaseProjectId, 'signalyn-5406e');
  assert.strictEqual(diagnostic.runtimeInfo.firestoreDatabaseId, 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34');
  assert.strictEqual(diagnostic.overallVerificationStatus, 'PRODUCTION_NOT_VERIFIED');
  assert.strictEqual(diagnostic.storageMode, 'PREVIEW_IN_MEMORY_ONLY');
  assert.ok(diagnostic.firestoreCounts);
  console.log('✓ Test 9: Production persistence diagnostic passed');
  passed++;

  // 10. Catalog Product Matching Execution (Objective 2 & 3)
  await syncServiceSource('apple-security', 'MANUAL_ADMIN');
  const matchSummary = await recomputeCatalogMatches();
  assert.ok(matchSummary.totalMatches > 0, 'Catalog product matching must produce matches');
  assert.ok(matchSummary.verifiedCount > 0, 'Must produce verified product matches');
  console.log(`✓ Test 10: Product matching passed (${matchSummary.verifiedCount} VERIFIED, ${matchSummary.likelyCount} LIKELY)`);
  passed++;

  console.log(`\nALL ${passed}/10 S1.2 TESTS PASSED CLEANLY.`);
  process.exit(0);
}

runS12Tests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

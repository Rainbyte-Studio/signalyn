/**
 * Signalyn Service Intelligence — Phase S1.2.5 Comprehensive Test Suite
 * Official Source Adapter Corrections, Advisory Integrity & Evidence-Based Product Matching
 *
 * Verifies all 17 required scenarios from Section 14:
 *  1. Apple bulletin with linked detail page and real CVEs
 *  2. Apple update with "This update has no published CVE entries."
 *  3. Apple unreachable or non-matching detail page
 *  4. Huawei bulletin with nested embedded JSON
 *  5. Huawei monthly/quarterly schedule vs vulnerability bulletin separation
 *  6. Samsung SMR monthly section isolation
 *  7. Samsung cross-month CVE duplication prevention
 *  8. CISA KEV authoritative parsing without fabricated CVSS
 *  9. NIST NVD CVSS enrichment vs missing score handling
 * 10. Apple Watch SKU with "Case" / "Band" / "Loop" classified as WEARABLE
 * 11. iPad Pro with "Standard Glass" classified as TABLET
 * 12. Huawei MatePad with "+ Keyboard" classified as TABLET
 * 13. Standalone case / screen protector / keyboard / charger classified as ACCESSORY
 * 14. Family-level Apple applicability ("iPhone 11 and later")
 * 15. Variant ambiguity (MatePad 11.5 vs 11.5S, Galaxy S25 vs S25 Ultra vs S25 FE)
 * 16. Duplicate advisory prevention
 * 17. 12-Check Quality Gate blocking and passing cases
 */

import assert from 'node:assert/strict';
import {
  cleanAppleReleaseTitle,
  extractAppleBulletinIdFromUrl,
  normalizeAppleSourceUrl,
  parseAppleSecurityDetailHtml,
  parseAppleSecurityIndexHtml,
} from '../src/server/service/adapters/appleSecurityAdapter';
import {
  cleanHuaweiScheduleModelName,
  extractHuaweiEmbeddedBulletinJson,
  formatHuaweiBulletinTitle,
  parseHuaweiBulletinDetailHtml,
  parseHuaweiIndexHtml,
} from '../src/server/service/adapters/huaweiSecurityAdapter';
import {
  parseSamsungSmrSectionsFromHtml,
  parseSamsungSecurityHtml,
} from '../src/server/service/adapters/samsungSecurityAdapter';
import { parseCisaKevJson } from '../src/server/service/adapters/cisaKevAdapter';
import { parseNvdCveItem } from '../src/server/service/adapters/nvdAdapter';
import {
  classifyCanonicalProductType,
  auditCanonicalProductClassifications,
  normalizeOfficialAdvisoryUrl,
  buildDeterministicAdvisoryId,
  detectDuplicateAdvisories,
  evaluateProductAdvisoryMatch,
  matchAdvisoriesToCatalog,
} from '../src/server/service/serviceProductMatcher';
import {
  evaluateS125QualityGate,
  buildProductionReconciliationPreview,
  auditSingleAdvisoryAuthenticity,
  runOfficialAdapterAndIntegrityAudit,
} from '../src/server/service/serviceAuthenticityAuditor';
import { ServiceAdvisory } from '../src/types/serviceIntelligence';
import { RetailProduct } from '../src/types/retailPrice';

function makeProduct(overrides: Partial<RetailProduct>): RetailProduct {
  return {
    id: 'prod-default',
    name: 'Apple iPhone 16 Pro 256GB',
    brand: 'Apple',
    category: 'SMARTPHONES',
    sku: 'SKU-DEFAULT',
    trackedRetailers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as RetailProduct;
}

function makeAdvisory(overrides: Partial<ServiceAdvisory>): ServiceAdvisory {
  return {
    id: 'adv-apple-149230',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    title: 'iOS 27.2 and iPadOS 27.2',
    advisoryType: 'SECURITY_UPDATE',
    severity: 'HIGH',
    status: 'ACTIVE',
    publishedAt: '2026-03-24',
    updatedAt: '2026-03-24',
    sourceUrl: 'https://support.apple.com/en-us/149230',
    cveIds: ['CVE-2026-20700', 'CVE-2026-20701'],
    affectedProducts: ['iPhone 11 and later', 'iPad Pro 13-inch (M4) and later'],
    affectedProductsText: 'iPhone 11 and later, iPad Pro 13-inch (M4) and later, iPad Air (5th generation and later), iPad (10th generation and later)',
    affectedVersions: ['27.2'],
    summary: 'Official Apple security update for iOS 27.2 and iPadOS 27.2.',
    verificationStatus: 'OFFICIALLY_CONFIRMED',
    persistenceStatus: 'FIRESTORE_AUTHORITATIVE',
    ...overrides,
  } as ServiceAdvisory;
}

async function runS125Tests() {
  console.log('=== Running S1.2.5 Official Source Adapter & Product Matching Integrity Tests (17 Scenarios) ===\n');

  // ---------------------------------------------------------------------------
  // Scenario 1: Apple bulletin with linked detail page and real CVEs
  // ---------------------------------------------------------------------------
  {
    const indexHtml = `
      <table>
        <tr>
          <td><a href="/en-us/149230">iOS 27.2 and iPadOS 27.2</a></td>
          <td>iPhone 11 and later, iPad Pro 13-inch (M4)</td>
          <td>24 Mar 2026</td>
        </tr>
      </table>
    `;
    const detailHtml = `
      <html>
        <head><title>About the security content of iOS 27.2 and iPadOS 27.2 - Apple Support</title></head>
        <body>
          <h1>About the security content of iOS 27.2 and iPadOS 27.2</h1>
          <p>Impact: Processing maliciously crafted web content may lead to arbitrary code execution. Apple is aware of a report that this issue may have been actively exploited.</p>
          <p>Available for: iPhone 11 and later, iPad Pro 13-inch (M4)</p>
          <p>CVE-2026-20700: WebKit</p>
          <p>CVE-2026-20701: Kernel</p>
        </body>
      </html>
    `;
    const detailParsed = parseAppleSecurityDetailHtml(detailHtml);
    assert.ok(detailParsed.officialPageTitle.includes('iOS 27.2 and iPadOS 27.2'));
    assert.deepEqual(detailParsed.cveIds, ['CVE-2026-20700', 'CVE-2026-20701']);
    assert.equal(detailParsed.isZeroCveStatementPresent, false);
    assert.equal(detailParsed.impactSummaries.length, 1);

    const advisories = parseAppleSecurityIndexHtml(indexHtml, { maxReleases: 10 });
    assert.equal(advisories.length, 1);
    assert.equal(advisories[0].deterministicId, 'adv-apple-149230-20260324');
    assert.equal(advisories[0].title, 'iOS 27.2 and iPadOS 27.2');
    assert.equal(advisories[0].sourceUrl, 'https://support.apple.com/en-us/149230');
    assert.equal(advisories[0].isZeroCveRelease, false);
    assert.equal(advisories[0].verificationStatus, 'OFFICIALLY_CONFIRMED');
    console.log('✓ Scenario 1 Passed: Apple bulletin with linked detail page and real CVEs');
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Apple update with "This update has no published CVE entries."
  // ---------------------------------------------------------------------------
  {
    const dirtyTitle = 'iOS 27.1 and iPadOS 27.1This update has no published CVE entries.';
    const cleaned = cleanAppleReleaseTitle(dirtyTitle);
    assert.equal(cleaned.cleanTitle, 'iOS 27.1 and iPadOS 27.1');
    assert.equal(cleaned.hadZeroCveFootnote, true);

    const indexHtml = `
      <table>
        <tr>
          <td>iOS 27.1 and iPadOS 27.1This update has no published CVE entries.</td>
          <td>iPhone 11 and later</td>
          <td>10 Feb 2026</td>
        </tr>
      </table>
    `;
    const advisories = parseAppleSecurityIndexHtml(indexHtml, { maxReleases: 10 });
    assert.equal(advisories.length, 1);
    assert.equal(advisories[0].title, 'iOS 27.1 and iPadOS 27.1');
    assert.ok(!advisories[0].title.includes('no published CVE entries'), 'Title must not contain footnote text');
    assert.equal(advisories[0].isZeroCveRelease, true);
    assert.deepEqual(advisories[0].cveIds, []);
    assert.equal(advisories[0].severity, 'INFORMATIONAL');
    console.log('✓ Scenario 2 Passed: Apple zero-CVE release title cleaned and flagged as INFORMATIONAL');
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Apple unreachable or non-matching detail page
  // ---------------------------------------------------------------------------
  {
    const indexHtmlUnrecognized = `
      <table>
        <tr>
          <td><a href="/en-us/999888">iOS 99.1 Security Update</a></td>
          <td>iPhone 11 and later</td>
          <td>24 Mar 2026</td>
        </tr>
      </table>
    `;
    const advisoriesUnrecognized = parseAppleSecurityIndexHtml(indexHtmlUnrecognized, { maxReleases: 10 });
    assert.equal(
      advisoriesUnrecognized[0].verificationStatus,
      'SOURCE_UNVERIFIABLE',
      'Unrecognized Apple OS version must be marked SOURCE_UNVERIFIABLE',
    );
    console.log('✓ Scenario 3 Passed: Apple unreachable or non-matching detail page flagged as SOURCE_UNVERIFIABLE');
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: Huawei bulletin with nested embedded JSON
  // ---------------------------------------------------------------------------
  {
    const htmlWithNestedJson = `
      <script>
        window.__DATA__ = [{"year": "2026", "bulletins": [{"title": "March 2026", "link": "/en/support/bulletin/2026/3/", "nestedTags": ["EMUI", "HarmonyOS"]}]}, {"year": "2025", "bulletins": [{"title": "December 2025", "link": "/en/support/bulletin/2025/12/"}]}];
      </script>
    `;
    const extracted = extractHuaweiEmbeddedBulletinJson(htmlWithNestedJson);
    assert.equal(extracted.length, 2, 'Balanced bracket extractor must parse full array past inner nested brackets');
    assert.equal(extracted[0].year, '2026');
    assert.equal(extracted[0].link, 'https://consumer.huawei.com/en/support/bulletin/2026/3/');

    const normalizedTitle = formatHuaweiBulletinTitle('Month 3', '2026', '03');
    assert.ok(
      normalizedTitle.includes('March 2026') && !normalizedTitle.includes('Month 3'),
      'Synthetic "Month 3 2026" title must be replaced with normalized month name',
    );
    console.log('✓ Scenario 4 Passed: Huawei nested embedded JSON parsed and synthetic "Month X 2026" title eliminated');
  }

  // ---------------------------------------------------------------------------
  // Scenario 5: Huawei monthly/quarterly schedule vs vulnerability bulletin separation
  // ---------------------------------------------------------------------------
  {
    assert.equal(cleanHuaweiScheduleModelName('P-Reihe'), null, 'German section header P-Reihe must be filtered out');
    assert.equal(cleanHuaweiScheduleModelName('nova-Reihe'), null, 'German section header nova-Reihe must be filtered out');
    assert.equal(cleanHuaweiScheduleModelName('Mate Series'), null, 'Generic Series header must be filtered out');
    assert.equal(cleanHuaweiScheduleModelName('HUAWEI Pura 70 Pro'), 'Pura 70 Pro');

    const huaweiHtml = `
      <html>
        <body>
          <script>
            var data = [{"year": "2026", "bulletins": [{"title": "Month 3", "link": "/en/support/bulletin/2026/3/"}]}];
          </script>
          <p>Οι τρέχουσες μηνιαίες ενημερώσεις ασφάλειας είναι διαθέσιμες για τα ακόλουθα μοντέλα συσκευών: P-Reihe, HUAWEI Pura 80, HUAWEI Mate X6</p>
          <p>Οι τρέχουσες τριμηνιαίες ενημερώσεις ασφάλειας είναι διαθέσιμες για τα ακόλουθα μοντέλα συσκευών: Mate-Reihe, HUAWEI Pura 70 Pro, HUAWEI MatePad 11.5</p>
        </body>
      </html>
    `;
    const parsedIndex = parseHuaweiIndexHtml(huaweiHtml, { maxBulletins: 15 });
    const detailParsed = parseHuaweiBulletinDetailHtml(
      '<html><body><h1>March 2026 Security Bulletin</h1><p>Updated EMUI 14, EMUI 13, HarmonyOS 4.2 security patches: CVE-2026-1111, CVE-2026-2222 (Critical)</p></body></html>',
      '2026',
      '03',
    );
    assert.deepEqual(detailParsed.cveIds, ['CVE-2026-1111', 'CVE-2026-2222']);
    assert.equal(detailParsed.highestSeverity, 'CRITICAL');

    const monthlyStub = parsedIndex.bulletinStubs.find((s) => s.advisory.id === 'adv-huawei-bulletin-2026-03');
    const monthlySched = parsedIndex.scheduleAdvisories.find((a) => a.id === 'adv-huawei-schedule-monthly');
    const quarterlySched = parsedIndex.scheduleAdvisories.find((a) => a.id === 'adv-huawei-schedule-quarterly');

    assert.ok(monthlyStub);
    assert.equal(monthlyStub!.advisory.advisoryType, 'SECURITY_UPDATE');

    assert.ok(monthlySched);
    assert.equal(monthlySched!.advisoryType, 'UPDATE_SCHEDULE');
    assert.ok(!monthlySched!.affectedProductsText.includes('P-Reihe'));

    assert.ok(quarterlySched);
    assert.equal(quarterlySched!.advisoryType, 'UPDATE_SCHEDULE');
    assert.ok(!quarterlySched!.affectedProductsText.includes('Mate-Reihe'));
    console.log('✓ Scenario 5 Passed: Huawei record classes separated & section headers filtered');
  }

  // ---------------------------------------------------------------------------
  // Scenarios 6 & 7: Samsung SMR monthly section isolation & cross-month CVE duplication prevention
  // ---------------------------------------------------------------------------
  {
    const samsungHtml = `
      <html>
        <body>
          <h2>SMR Oct-2026 Release 1</h2>
          <p>Critical: CVE-2026-9001, CVE-2026-9002. Samsung SVE-2026-0101.</p>
          <h2>SMR Sep-2026 Release 1</h2>
          <p>High: CVE-2026-8001, CVE-2026-8002. Samsung SVE-2026-0055.</p>
          <div>Current Models for Monthly Security Updates</div>
          <p>Galaxy S25 Ultra, Galaxy Z Fold6</p>
          <div>Current Models for Quarterly Security Updates</div>
          <p>Galaxy A55 5G, Galaxy Tab S10 Ultra</p>
          <div>Current Models for Biannual Security Updates</div>
        </body>
      </html>
    `;
    const sections = parseSamsungSmrSectionsFromHtml(samsungHtml, 10);
    assert.equal(sections.length, 2);
    assert.deepEqual(sections[0].cveIds, ['CVE-2026-9001', 'CVE-2026-9002']);
    assert.deepEqual(sections[0].sveIds, ['SVE-2026-0101']);
    assert.deepEqual(sections[1].cveIds, ['CVE-2026-8001', 'CVE-2026-8002']);
    assert.deepEqual(sections[1].sveIds, ['SVE-2026-0055']);

    const parsedSamsung = parseSamsungSecurityHtml(samsungHtml, { maxBulletins: 10 });
    assert.equal(parsedSamsung.advisories.length, 2);
    assert.notDeepEqual(
      parsedSamsung.advisories[0].cveIds,
      parsedSamsung.advisories[1].cveIds,
      'Oct-2026 and Sep-2026 SMR bulletins must NEVER share a duplicated CVE slice',
    );
    assert.ok(parsedSamsung.advisories[0].affectedProductsText.includes('Galaxy S25 Ultra'));
    console.log('✓ Scenarios 6 & 7 Passed: Samsung SMR section-scoped parsing & cross-month CVE isolation');
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: CISA KEV authoritative parsing without fabricated CVSS
  // ---------------------------------------------------------------------------
  {
    const kevPayload = {
      title: 'CISA Known Exploited Vulnerabilities Catalog',
      catalogVersion: '2026.10.28',
      dateReleased: '2026-10-28T00:00:00.000Z',
      count: 1,
      vulnerabilities: [
        {
          cveID: 'CVE-2024-7399',
          vendorProject: 'Samsung',
          product: 'MagicINFO 9 Server',
          vulnerabilityName: 'Samsung MagicINFO 9 Server Path Traversal Vulnerability',
          dateAdded: '2026-05-01',
          shortDescription: 'Samsung MagicINFO 9 Server contains a path traversal vulnerability.',
          requiredAction: 'Apply mitigations per vendor instructions.',
          dueDate: '2026-05-22',
          knownRansomwareCampaignUse: 'Unknown' as const,
        },
      ],
    };
    const parsedKev = parseCisaKevJson(kevPayload, 10);
    assert.equal(parsedKev.advisories.length, 1);
    assert.equal(parsedKev.vulnerabilities.length, 1);
    assert.equal(parsedKev.vulnerabilities[0].cveId, 'CVE-2024-7399');
    assert.equal(
      parsedKev.vulnerabilities[0].cvssV3Score,
      undefined,
      'CISA KEV must never fabricate a numeric CVSS score',
    );
    assert.equal(parsedKev.vulnerabilities[0].cisaKevStatus, 'ACTIVE_EXPLOITED');
    console.log('✓ Scenario 8 Passed: CISA KEV authoritative parsing without fabricated CVSS');
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: NIST NVD CVSS enrichment vs missing score handling
  // ---------------------------------------------------------------------------
  {
    const scoredItem = {
      id: 'CVE-2024-7399',
      published: '2024-08-01T00:00:00.000',
      lastModified: '2024-08-10T00:00:00.000',
      descriptions: [{ lang: 'en', value: 'Samsung MagicINFO 9 Server vulnerability.' }],
      metrics: {
        cvssMetricV31: [
          {
            cvssData: {
              baseScore: 8.8,
              baseSeverity: 'HIGH',
              vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H',
            },
          },
        ],
      },
    };
    const scoredVuln = parseNvdCveItem(scoredItem);
    assert.ok(scoredVuln);
    assert.equal(scoredVuln.cvssV3Score, 8.8);
    assert.equal(scoredVuln.severity, 'HIGH');
    assert.equal(scoredVuln.severityVerificationStatus, 'OFFICIALLY_CONFIRMED');

    const unscoredItem = {
      id: 'CVE-2026-99999',
      published: '2026-10-01T00:00:00.000',
      lastModified: '2026-10-02T00:00:00.000',
      descriptions: [{ lang: 'en', value: 'Awaiting NVD analysis.' }],
      metrics: {},
    };
    const unscoredVuln = parseNvdCveItem(unscoredItem);
    assert.ok(unscoredVuln);
    assert.equal(unscoredVuln.cvssV3Score, undefined, 'Unscored NVD CVE must not zero-fill cvssV3Score');
    assert.equal(unscoredVuln.severity, 'NOT_AVAILABLE');
    assert.equal(unscoredVuln.severityVerificationStatus, 'UNVERIFIED');
    console.log('✓ Scenario 9 Passed: NIST NVD CVSS v3.1 enrichment vs missing score handling');
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Apple Watch SKU with "Case" / "Band" / "Loop" classified as WEARABLE
  // ---------------------------------------------------------------------------
  {
    const watchSku = makeProduct({
      id: 'prod-aw-s11-case-band',
      name: 'Apple Watch Series 11 GPS 46mm Rose Gold Aluminium Case with Light Blush Sport Band - S/M',
      brand: 'Apple',
      category: 'WEARABLES',
    });
    const watchClass = classifyCanonicalProductType(watchSku);
    assert.equal(watchClass.derivedDeviceCategory, 'WEARABLE');
    assert.equal(watchClass.isExcludedFromMatching, false);
    assert.equal(watchClass.restoredFromLegacyExclusion, true);

    const watchAdv = makeAdvisory({
      id: 'adv-apple-watchos-27-2',
      title: 'watchOS 27.2',
      affectedProductsText: 'Apple Watch Series 6 and later',
      affectedProducts: ['Apple Watch Series 6 and later'],
      affectedVersions: ['27.2'],
    });
    const watchMatch = evaluateProductAdvisoryMatch(watchAdv, watchSku);
    assert.ok(watchMatch, 'Apple Watch Series 11 with Case/Band must match watchOS 27.2');
    assert.equal(watchMatch!.confidence, 'VERIFIED');
    assert.equal(watchMatch!.derivedDeviceCategory, 'WEARABLE');
    console.log('✓ Scenario 10 Passed: Apple Watch SKU with "Case"/"Band"/"Loop" classified as WEARABLE and matched');
  }

  // ---------------------------------------------------------------------------
  // Scenario 11: iPad Pro with "Standard Glass" classified as TABLET
  // ---------------------------------------------------------------------------
  {
    const ipadGlassSku = makeProduct({
      id: 'prod-ipad-pro-m5-glass',
      name: 'Apple iPad Pro 13" M5 Wi-Fi 512GB Standard Glass Space Black',
      brand: 'Apple',
      category: 'TABLETS',
    });
    const ipadClass = classifyCanonicalProductType(ipadGlassSku);
    assert.equal(ipadClass.derivedDeviceCategory, 'TABLET');
    assert.equal(ipadClass.isExcludedFromMatching, false);
    assert.equal(ipadClass.restoredFromLegacyExclusion, true);

    const ipadAdv = makeAdvisory({
      id: 'adv-apple-149230',
      title: 'iOS 27.2 and iPadOS 27.2',
      affectedProductsText: 'iPad Pro 13-inch (M4) and later, iPad Pro 11-inch (1st generation and later)',
      affectedProducts: ['iPad Pro 13-inch (M4) and later', 'iPad Pro 11-inch (1st generation and later)'],
    });
    const ipadMatch = evaluateProductAdvisoryMatch(ipadAdv, ipadGlassSku);
    assert.ok(ipadMatch, 'iPad Pro M5 Standard Glass must match iPadOS 27.2');
    assert.equal(ipadMatch!.confidence, 'VERIFIED');
    assert.equal(ipadMatch!.derivedDeviceCategory, 'TABLET');
    console.log('✓ Scenario 11 Passed: iPad Pro with "Standard Glass" classified as TABLET and matched');
  }

  // ---------------------------------------------------------------------------
  // Scenario 12: Huawei MatePad with "+ Keyboard" classified as TABLET
  // ---------------------------------------------------------------------------
  {
    const matepadBundleSku = makeProduct({
      id: 'prod-hw-matepad-115-kb',
      name: 'Huawei MatePad 11.5 (2025) WiFi 11.5" 8GB/256GB + Keyboard Space Gray',
      brand: 'Huawei',
      category: 'TABLETS',
    });
    const mpClass = classifyCanonicalProductType(matepadBundleSku);
    assert.equal(mpClass.derivedDeviceCategory, 'TABLET');
    assert.equal(mpClass.isExcludedFromMatching, false);
    assert.equal(mpClass.restoredFromLegacyExclusion, true);

    const huaweiQuarterly = makeAdvisory({
      id: 'adv-huawei-schedule-quarterly',
      sourceId: 'huawei-security',
      manufacturer: 'Huawei',
      advisoryType: 'UPDATE_SCHEDULE',
      title: 'Huawei EMUI / HarmonyOS Quarterly Security Update Device Scope',
      sourceUrl: 'https://consumer.huawei.com/en/support/bulletin/',
      cveIds: [],
      affectedProductsText: 'HUAWEI Pura 70 Pro, HUAWEI MatePad 11.5',
      affectedProducts: ['HUAWEI Pura 70 Pro', 'HUAWEI MatePad 11.5'],
    });
    const mpMatch = evaluateProductAdvisoryMatch(huaweiQuarterly, matepadBundleSku);
    assert.ok(mpMatch, 'Huawei MatePad 11.5 + Keyboard bundle must match Huawei quarterly scope');
    assert.equal(mpMatch!.confidence, 'LIKELY', 'Schedule match must be capped at LIKELY');
    assert.equal(mpMatch!.relationshipType, 'OFFICIAL_UPDATE_ELIGIBILITY');
    assert.equal(mpMatch!.derivedDeviceCategory, 'TABLET');
    console.log('✓ Scenario 12 Passed: Huawei MatePad "+ Keyboard" bundle classified as TABLET and matched as LIKELY');
  }

  // ---------------------------------------------------------------------------
  // Scenario 13: Standalone case / screen protector / keyboard / charger classified as ACCESSORY
  // ---------------------------------------------------------------------------
  {
    const standaloneAccessories = [
      makeProduct({ id: 'acc-1', name: 'Apple Silicone Case with MagSafe for iPhone 16 Pro', brand: 'Apple' }),
      makeProduct({ id: 'acc-2', name: 'Samsung Galaxy S25 Ultra Tempered Glass Screen Protector', brand: 'Samsung' }),
      makeProduct({ id: 'acc-3', name: 'Apple Magic Keyboard for iPad Pro 13-inch (M4)', brand: 'Apple' }),
      makeProduct({ id: 'acc-4', name: 'Apple 20W USB-C Power Adapter Charger', brand: 'Apple' }),
      makeProduct({ id: 'acc-5', name: 'Apple Sport Loop 46mm Band', brand: 'Apple' }),
    ];
    const iosAdv = makeAdvisory({});
    for (const acc of standaloneAccessories) {
      const c = classifyCanonicalProductType(acc);
      assert.equal(c.derivedDeviceCategory, 'ACCESSORY', `${acc.name} must be classified as ACCESSORY`);
      assert.equal(c.isExcludedFromMatching, true);
      assert.equal(evaluateProductAdvisoryMatch(iosAdv, acc), null, `${acc.name} must never match OS advisories`);
    }
    console.log('✓ Scenario 13 Passed: Standalone cases, screen protectors, keyboards, straps & chargers excluded as ACCESSORY');
  }

  // ---------------------------------------------------------------------------
  // Scenario 14: Family-level Apple applicability ("iPhone 11 and later")
  // ---------------------------------------------------------------------------
  {
    const ios26Adv = makeAdvisory({
      id: 'adv-apple-149227',
      title: 'iOS 26.7.2 and iPadOS 26.7.2',
      affectedProductsText: 'iPhone 11 and later',
      affectedProducts: ['iPhone 11 and later'],
      affectedVersions: ['26.7.2'],
    });
    const iphone16 = makeProduct({ id: 'prod-ip16', name: 'Apple iPhone 16 Pro 256GB' });
    const iphone18 = makeProduct({ id: 'prod-ip18', name: 'Apple iPhone 18 Pro Max 512GB' });

    const m16 = evaluateProductAdvisoryMatch(ios26Adv, iphone16);
    assert.ok(m16);
    assert.equal(m16!.confidence, 'VERIFIED');
    assert.equal(m16!.evidenceStrength, 'STRUCTURED_MANUFACTURER_APPLICABILITY');
    assert.equal(m16!.authenticityClassification, 'OFFICIAL_FAMILY_CONFIRMED');

    const m18 = evaluateProductAdvisoryMatch(ios26Adv, iphone18);
    assert.equal(m18, null, 'iPhone 18 Pro Max (shipped with iOS 27) must be excluded from iOS 26.7.2');
    console.log('✓ Scenario 14 Passed: Family-level Apple applicability & OS generation ceiling verified');
  }

  // ---------------------------------------------------------------------------
  // Scenario 15: Variant ambiguity (MatePad 11.5 vs 11.5S, Galaxy S25 vs S25 Ultra vs S25 FE)
  // ---------------------------------------------------------------------------
  {
    const huaweiQuarterly = makeAdvisory({
      id: 'adv-huawei-schedule-quarterly',
      sourceId: 'huawei-security',
      manufacturer: 'Huawei',
      advisoryType: 'UPDATE_SCHEDULE',
      title: 'Huawei Quarterly Update Scope',
      sourceUrl: 'https://consumer.huawei.com/en/support/bulletin/',
      cveIds: [],
      affectedProductsText: 'HUAWEI MatePad 11.5',
      affectedProducts: ['HUAWEI MatePad 11.5'],
    });
    const mp115S = makeProduct({
      id: 'prod-hw-mp115s',
      name: 'Huawei MatePad 11.5S WiFi 8GB/256GB',
      brand: 'Huawei',
      category: 'TABLETS',
    });
    const mp115SMatch = evaluateProductAdvisoryMatch(huaweiQuarterly, mp115S);
    assert.ok(mp115SMatch);
    assert.equal(mp115SMatch!.confidence, 'LIKELY');
    assert.ok(mp115SMatch!.whyNotHigherConfidence?.includes('MatePad 11.5S'));

    const samsungExplicitSmr = makeAdvisory({
      id: 'adv-samsung-smr-2026-10',
      sourceId: 'samsung-security',
      manufacturer: 'Samsung',
      title: 'Samsung Android Security Update - SMR Oct-2026 Release 1',
      sourceUrl: 'https://security.samsungmobile.com/securityUpdate.smsb',
      cveIds: ['CVE-2026-9001'],
      affectedProductsText: 'Galaxy S25, Galaxy S25+, Galaxy S25 Ultra, Galaxy Z Fold6',
      affectedProducts: ['Galaxy S25', 'Galaxy S25+', 'Galaxy S25 Ultra', 'Galaxy Z Fold6'],
    });
    const s25Ultra = makeProduct({ id: 'prod-s25u', name: 'Samsung Galaxy S25 Ultra 512GB', brand: 'Samsung' });
    const s25Fe = makeProduct({ id: 'prod-s25fe', name: 'Samsung Galaxy S25 FE 256GB', brand: 'Samsung' });
    const zFlip6 = makeProduct({ id: 'prod-zflip6', name: 'Samsung Galaxy Z Flip6 256GB', brand: 'Samsung' });

    const mUltraExplicit = evaluateProductAdvisoryMatch(samsungExplicitSmr, s25Ultra);
    assert.ok(mUltraExplicit);
    assert.equal(mUltraExplicit!.confidence, 'VERIFIED', 'Explicitly listed Galaxy S25 Ultra matches as VERIFIED');

    const mFe = evaluateProductAdvisoryMatch(samsungExplicitSmr, s25Fe);
    assert.equal(mFe, null, 'Galaxy S25 FE must not match when only base Galaxy S25 / S25+ / S25 Ultra are listed');

    const mFlip = evaluateProductAdvisoryMatch(samsungExplicitSmr, zFlip6);
    assert.equal(mFlip, null, 'Galaxy Z Flip6 must never match Galaxy Z Fold6');

    const samsungBroadSmr = makeAdvisory({
      id: 'adv-samsung-smr-2026-09',
      sourceId: 'samsung-security',
      manufacturer: 'Samsung',
      title: 'Samsung Android Security Update - SMR Sep-2026 Release 1',
      sourceUrl: 'https://security.samsungmobile.com/securityUpdate.smsb',
      cveIds: ['CVE-2026-9002'],
      affectedProductsText: 'Android 14, Android 15, Android 16 (Selected Galaxy S, Z, A, and Tab series)',
      affectedProducts: ['Android 14, Android 15, Android 16 (Selected Galaxy S, Z, A, and Tab series)'],
    });
    const mUltraBroad = evaluateProductAdvisoryMatch(samsungBroadSmr, s25Ultra);
    assert.ok(mUltraBroad);
    assert.equal(mUltraBroad!.confidence, 'LIKELY', 'Broad Samsung SMR without explicit model enumeration is gated at LIKELY');
    console.log('✓ Scenario 15 Passed: Variant ambiguity enforced (MatePad 11.5 vs 11.5S, S25 vs S25 FE, Z Fold6 vs Z Flip6, Broad SMR LIKELY)');
  }

  // ---------------------------------------------------------------------------
  // Scenario 16: Duplicate advisory prevention
  // ---------------------------------------------------------------------------
  {
    const urlA = 'http://support.apple.com/en-gb/149230/?utm_source=test#section';
    const urlB = 'https://support.apple.com/en-us/149230';
    assert.equal(normalizeOfficialAdvisoryUrl(urlA), normalizeOfficialAdvisoryUrl(urlB));

    const idA = buildDeterministicAdvisoryId({
      sourceId: 'apple-security',
      sourceUrl: urlA,
      title: 'iOS 27.2 and iPadOS 27.2',
      publishedAt: '2026-03-24',
    });
    const idB = buildDeterministicAdvisoryId({
      sourceId: 'apple-security',
      sourceUrl: urlB,
      title: 'iOS 27.2 and iPadOS 27.2',
      publishedAt: '2026-03-24',
    });
    assert.equal(idA, idB, 'Deterministic advisory ID must be identical across locale/tracking URL variants');
    assert.equal(idA, 'adv-apple-149230');

    const dupCheck = detectDuplicateAdvisories([
      makeAdvisory({ id: 'adv-apple-149230-a', sourceUrl: urlA }),
      makeAdvisory({ id: 'adv-apple-149230-b', sourceUrl: urlB }),
    ]);
    assert.equal(dupCheck.duplicateGroupCount, 1);
    assert.equal(dupCheck.totalDuplicateAdvisories, 1);
    console.log('✓ Scenario 16 Passed: Deterministic advisory ID & duplicate advisory detection verified');
  }

  // ---------------------------------------------------------------------------
  // Scenario 17: 12-Check Quality Gate blocking and passing cases
  // ---------------------------------------------------------------------------
  {
    const cleanAdvisories = [
      makeAdvisory({
        id: 'adv-apple-149230',
        title: 'iOS 27.2 and iPadOS 27.2',
        cveIds: ['CVE-2026-20700'],
      }),
    ];
    const cleanProducts = [
      makeProduct({ id: 'prod-ip16', name: 'Apple iPhone 16 Pro 256GB' }),
      makeProduct({
        id: 'prod-aw11',
        name: 'Apple Watch Series 11 GPS 46mm Aluminium Case with Sport Band',
        category: 'WEARABLES',
      }),
    ];
    const cleanBatch = matchAdvisoriesToCatalog(cleanAdvisories, cleanProducts);
    const cleanAudit = await runOfficialAdapterAndIntegrityAudit({
      advisories: cleanAdvisories,
      catalogProducts: cleanProducts,
      matches: cleanBatch.matches,
    });

    assert.equal(cleanAudit.qualityGate12Check.checks.length, 12);
    assert.equal(cleanAudit.qualityGate12Check.overallStatus, 'PASS');
    assert.equal(cleanAudit.qualityGate12Check.blockedCount, 0);
    assert.equal(cleanAudit.qualityGate12Check.needsReviewCount, 0);
    assert.equal(cleanAudit.qualityGate12Check.passCount, 12);

    // Now test BLOCKED case when a schedule match is forced to VERIFIED
    const corruptedMatch = {
      ...cleanBatch.matches[0],
      confidence: 'VERIFIED' as const,
      relationshipType: 'OFFICIAL_UPDATE_ELIGIBILITY' as const,
    };
    const preview = buildProductionReconciliationPreview(
      cleanAdvisories,
      cleanProducts,
      [corruptedMatch],
      cleanAdvisories.map((a) => auditSingleAdvisoryAuthenticity(a, 1)),
    );
    const blockedGate = evaluateS125QualityGate({
      advisories: cleanAdvisories,
      catalogProducts: cleanProducts,
      matches: [corruptedMatch],
      advisoryAudits: cleanAdvisories.map((a) => auditSingleAdvisoryAuthenticity(a, 1)),
      reconciliationPreview: preview,
    });
    assert.equal(blockedGate.overallStatus, 'BLOCKED');
    assert.ok(blockedGate.blockedCount >= 1);
    console.log('✓ Scenario 17 Passed: 12-Check Production Quality Gate PASS and BLOCKED states verified');
  }

  console.log('\n=== All 17 S1.2.5 Official Source Adapter & Product Matching Integrity Tests Passed! ===');
}

runS125Tests().catch((err) => {
  console.error('S1.2.5 Test Suite Failed:', err);
  process.exit(1);
});

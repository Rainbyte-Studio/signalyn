/**
 * Signalyn Service Intelligence - Phase S1.2.4 Regression Test Suite
 * Official Source Authenticity & Product Applicability Audit
 *
 * Covers all 10 Objective 6 required scenarios:
 * 1. Authentic official source verification (domain ownership + HTTP 200 + matching title/CVE content)
 * 2. HTTP 200 with unrelated or non-matching content (rejected as CONTRADICTED, never treated as authentic)
 * 3. Unreachable or missing official source (classified as UNVERIFIABLE / SOURCE_UNVERIFIABLE)
 * 4. Fabricated or contradicted software version detection (e.g. iOS 23.0 or iOS 99.0 vs authentic iOS 26.x/27.x)
 * 5. Manufacturer family applicability vs exact model confirmation (OFFICIAL_FAMILY_CONFIRMED vs OFFICIAL_CONFIRMED)
 * 6. Rejection of incorrect model/generation matches (NOT_APPLICABLE)
 * 7. Separation of generic update/maintenance schedules from vulnerability applicability (INFERRED_NEEDS_REVIEW)
 * 8. Missing evidence detection and 11-field candidate evidence completeness
 * 9. Candidate count reconciliation (531 vs 762 = -231 delta; 93 × 326 = 30,318 pairs)
 * 10. Read-only audit behavior with zero Firestore writes
 */

import assert from 'node:assert/strict';
import {
  verifyOfficialDomainOwnership,
  validateAdvisoryVersionAuthenticity,
  probeOfficialSourceUrl,
  auditSingleAdvisoryAuthenticity,
  classifyProductMatchAuthenticity,
  buildCandidateCountReconciliationReport,
} from '../src/server/service/serviceAuthenticityAuditor';
import {
  matchAdvisoriesToCatalog,
  evaluateProductAdvisoryMatch,
} from '../src/server/service/serviceProductMatcher';
import {
  getMatchEvidenceReview,
  getOfficialSourceAuthenticityAudit,
  resetServiceStateForTests,
} from '../src/server/service/servicePipelineService';
import { ServiceAdvisory } from '../src/types/serviceIntelligence';
import { RetailProduct } from '../src/types/retailPrice';

function createMockAdvisory(overrides: Partial<ServiceAdvisory>): ServiceAdvisory {
  return {
    id: 'adv-test-1',
    sourceId: 'apple-security',
    manufacturer: 'Apple',
    title: 'iOS 27.2 and iPadOS 27.2',
    advisoryType: 'SECURITY_UPDATE',
    severity: 'HIGH',
    status: 'ACTIVE',
    publishedAt: '2026-03-24T12:00:00.000Z',
    updatedAt: '2026-03-24T12:00:00.000Z',
    sourceUrl: 'https://support.apple.com/en-us/149230',
    cveIds: ['CVE-2026-20700'],
    affectedProducts: ['iPhone 11 and later', 'iPad Pro 13-inch (M4)'],
    affectedProductsText: 'iPhone 11 and later, iPad Pro 13-inch (M4)',
    affectedVersions: ['27.2'],
    summary: 'Official Apple security release for iOS 27.2 and iPadOS 27.2.',
    persistenceStatus: 'FIRESTORE_AUTHORITATIVE',
    ...overrides,
  };
}

function createMockProduct(overrides: Partial<RetailProduct>): RetailProduct {
  return {
    id: 'prod-iphone-16-pro',
    name: 'Apple iPhone 16 Pro 256GB Black Titanium',
    brand: 'Apple',
    category: 'Smartphones',
    sku: 'APL-IP16P-256',
    trackedRetailers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as RetailProduct;
}

async function runTests() {
  console.log('=== Running S1.2.4 Official Source Authenticity & Product Applicability Audit Tests ===');

  // ---------------------------------------------------------------------------
  // 1. Authentic Official Source Verification
  // ---------------------------------------------------------------------------
  {
    const domainCheck = verifyOfficialDomainOwnership('apple-security', 'https://support.apple.com/en-us/149230');
    assert.equal(domainCheck.domainVerified, true, 'support.apple.com must be recognized as official Apple domain');

    const badDomainCheck = verifyOfficialDomainOwnership(
      'apple-security',
      'https://evil-phishing.example.com/149230',
    );
    assert.equal(badDomainCheck.domainVerified, false, 'Untrusted domain must be rejected');

    const adv = createMockAdvisory({});
    const mockFetchAuthentic: typeof fetch = async () =>
      new Response(
        '<html><head><title>About the security content of iOS 27.2 and iPadOS 27.2 - Apple Support</title></head><body><h1>About the security content of iOS 27.2 and iPadOS 27.2</h1><p>Available for: iPhone 11 and later. CVE-2026-20700</p></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );

    const probe = await probeOfficialSourceUrl(adv.sourceUrl, { customFetch: mockFetchAuthentic });
    const record = auditSingleAdvisoryAuthenticity(adv, 1, probe);
    assert.equal(record.domainVerified, true);
    assert.equal(record.httpStatus, 200);
    assert.equal(record.titleMatchesSource, true);
    assert.equal(record.versionSupportedBySource, true);
    assert.equal(record.livePageCveCount, 1);
    console.log('✓ Test 1 Passed: Authentic official source verification');
  }

  // ---------------------------------------------------------------------------
  // 2. HTTP 200 with Unrelated or Non-Matching Content -> CONTRADICTED
  // ---------------------------------------------------------------------------
  {
    const adv = createMockAdvisory({
      id: 'adv-apple-unrelated-200',
      title: 'iOS 27.2 and iPadOS 27.2',
      sourceUrl: 'https://support.apple.com/en-us/999999',
    });

    const mockFetchUnrelated200: typeof fetch = async () =>
      new Response(
        '<html><head><title>Buy AirPods Max - Apple Store</title></head><body><h1>Shop Wireless Headphones</h1><p>Free engraving on all orders.</p></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );

    const probe = await probeOfficialSourceUrl(adv.sourceUrl, { customFetch: mockFetchUnrelated200 });
    const record = auditSingleAdvisoryAuthenticity(adv, 1, probe);

    assert.equal(
      record.authenticityStatus,
      'CONTRADICTED',
      'HTTP 200 returning unrelated page content must be marked CONTRADICTED, never VERIFIED_AUTHENTIC',
    );
    assert.equal(record.titleMatchesSource, false);

    const prod = createMockProduct({});
    const baseMatch = evaluateProductAdvisoryMatch(adv, prod);
    assert.ok(baseMatch, 'Base match should be generated before authenticity override');
    const authResult = classifyProductMatchAuthenticity(baseMatch!, adv, record);
    assert.equal(
      authResult.authenticityClassification,
      'SOURCE_CONTRADICTED',
      'Match backed by HTTP 200 unrelated content must be classified as SOURCE_CONTRADICTED',
    );
    console.log('✓ Test 2 Passed: HTTP 200 with unrelated content rejected as CONTRADICTED');
  }

  // ---------------------------------------------------------------------------
  // 3. Unreachable or Missing Official Source -> UNVERIFIABLE / SOURCE_UNVERIFIABLE
  // ---------------------------------------------------------------------------
  {
    const advUnreachable = createMockAdvisory({
      id: 'adv-apple-404',
      sourceUrl: 'https://support.apple.com/en-us/404040',
    });

    const mockFetch404: typeof fetch = async () =>
      new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

    const probe404 = await probeOfficialSourceUrl(advUnreachable.sourceUrl, { customFetch: mockFetch404 });
    const record404 = auditSingleAdvisoryAuthenticity(advUnreachable, 1, probe404);
    assert.equal(record404.authenticityStatus, 'UNVERIFIABLE');

    const prod = createMockProduct({});
    const baseMatch = evaluateProductAdvisoryMatch(advUnreachable, prod);
    const authResult = classifyProductMatchAuthenticity(baseMatch!, advUnreachable, record404);
    assert.equal(
      authResult.authenticityClassification,
      'SOURCE_UNVERIFIABLE',
      'Unreachable official source must classify candidate match as SOURCE_UNVERIFIABLE',
    );
    console.log('✓ Test 3 Passed: Unreachable or missing official source classified as UNVERIFIABLE');
  }

  // ---------------------------------------------------------------------------
  // 4. Fabricated or Contradicted Software Version Detection
  // ---------------------------------------------------------------------------
  {
    // Authentic Apple post-2025 calendar-year versions (iOS 26.x, iOS 27.x) and legacy iOS 18.x
    const valid27 = validateAdvisoryVersionAuthenticity(
      createMockAdvisory({ title: 'iOS 27.2 and iPadOS 27.2', affectedVersions: ['27.2'] }),
    );
    assert.equal(valid27.supported, true, 'iOS 27.2 (verified on support.apple.com/100100) must be valid');

    const valid26 = validateAdvisoryVersionAuthenticity(
      createMockAdvisory({ title: 'iOS 26.7.2 and iPadOS 26.7.2', affectedVersions: ['26.7.2'] }),
    );
    assert.equal(valid26.supported, true, 'iOS 26.7.2 (verified on support.apple.com/100100) must be valid');

    // Fabricated non-existent Apple iOS versions (e.g., iOS 23.0 gap version or iOS 99.0)
    const fabricated23 = validateAdvisoryVersionAuthenticity(
      createMockAdvisory({
        id: 'adv-apple-fabricated-23',
        title: 'iOS 23.0 Security Update',
        affectedVersions: ['23.0'],
      }),
    );
    assert.equal(fabricated23.supported, false, 'Fabricated iOS 23.0 gap version must be rejected');

    const fabricatedAdv = createMockAdvisory({
      id: 'adv-apple-fabricated-99',
      title: 'iOS 99.1 Security Update',
      affectedVersions: ['99.1'],
    });
    const fabricatedAudit = auditSingleAdvisoryAuthenticity(fabricatedAdv, 0);
    assert.equal(
      fabricatedAudit.authenticityStatus,
      'CONTRADICTED',
      'Fabricated iOS 99.1 advisory must be marked CONTRADICTED',
    );
    console.log('✓ Test 4 Passed: Fabricated or contradicted software version detection');
  }

  // ---------------------------------------------------------------------------
  // 5. Manufacturer Family Applicability vs Exact Model Confirmation
  // ---------------------------------------------------------------------------
  {
    // Family-level rule ("iPhone 11 and later") -> OFFICIAL_FAMILY_CONFIRMED
    const familyAdv = createMockAdvisory({
      id: 'adv-apple-149230',
      title: 'iOS 27.2 and iPadOS 27.2',
      affectedProductsText: 'iPhone 11 and later',
      affectedProducts: ['iPhone 11 and later'],
    });
    const iphone16 = createMockProduct({
      id: 'prod-iphone-16-pro',
      name: 'Apple iPhone 16 Pro 256GB',
    });
    const familyMatch = evaluateProductAdvisoryMatch(familyAdv, iphone16);
    assert.ok(familyMatch);
    assert.equal(familyMatch!.confidence, 'VERIFIED');
    assert.equal(
      familyMatch!.authenticityClassification,
      'OFFICIAL_FAMILY_CONFIRMED',
      'Structured "iPhone 11 and later" match on iPhone 16 Pro must be OFFICIAL_FAMILY_CONFIRMED, not OFFICIAL_CONFIRMED',
    );

    // Exact model confirmation in a CVE-bearing CISA KEV / security bulletin -> OFFICIAL_CONFIRMED
    const exactKevAdv = createMockAdvisory({
      id: 'adv-cisa-exact-iphone-16',
      sourceId: 'cisa-kev',
      manufacturer: 'Apple',
      advisoryType: 'KNOWN_EXPLOITED',
      title: 'CISA KEV: Apple iPhone 16 RCE',
      sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
      cveIds: ['CVE-2026-20700'],
      affectedProductsText: 'Apple iPhone 16 Pro',
      affectedProducts: ['Apple iPhone 16 Pro'],
    });
    const exactMatch = evaluateProductAdvisoryMatch(exactKevAdv, iphone16);
    assert.ok(exactMatch);
    assert.equal(exactMatch!.confidence, 'VERIFIED');
    assert.equal(
      exactMatch!.authenticityClassification,
      'OFFICIAL_CONFIRMED',
      'Exact model explicitly named in CVE-bearing bulletin must be OFFICIAL_CONFIRMED',
    );
    console.log('✓ Test 5 Passed: Manufacturer family applicability vs exact model confirmation');
  }

  // ---------------------------------------------------------------------------
  // 6. Rejection of Incorrect Model / Generation Matches (NOT_APPLICABLE)
  // ---------------------------------------------------------------------------
  {
    const ios26Adv = createMockAdvisory({
      id: 'adv-apple-149227',
      title: 'iOS 26.7.2 and iPadOS 26.7.2',
      sourceUrl: 'https://support.apple.com/en-us/149227',
      affectedProductsText: 'iPhone 11 and later',
      affectedProducts: ['iPhone 11 and later'],
      affectedVersions: ['26.7.2'],
    });
    const iphone18Pro = createMockProduct({
      id: 'prod-iphone-18-pro',
      name: 'Apple iPhone 18 Pro 256GB',
    });
    const rejectedIphone18 = evaluateProductAdvisoryMatch(ios26Adv, iphone18Pro);
    assert.equal(
      rejectedIphone18,
      null,
      'iPhone 18 Pro (shipped with iOS 27) must be rejected as NOT_APPLICABLE for iOS 26.7.2',
    );

    const huaweiQuarterlyAdv = createMockAdvisory({
      id: 'adv-huawei-schedule-quarterly',
      sourceId: 'huawei-security',
      manufacturer: 'Huawei',
      title: 'Huawei EMUI / HarmonyOS Quarterly Security Update Device Scope',
      advisoryType: 'UPDATE_SCHEDULE',
      sourceUrl: 'https://consumer.huawei.com/en/support/bulletin/',
      cveIds: [],
      affectedProductsText: 'HUAWEI Pura 70 Pro, HUAWEI Pura 70 Ultra, HUAWEI MatePad 11.5',
      affectedProducts: ['HUAWEI Pura 70 Pro', 'HUAWEI Pura 70 Ultra', 'HUAWEI MatePad 11.5'],
    });
    const matepad115S = createMockProduct({
      id: 'prod-matepad-11-5-s',
      name: 'Huawei MatePad 11.5S 8GB/256GB',
      brand: 'Huawei',
      category: 'Tablets',
    });
    const matepad115SMatch = evaluateProductAdvisoryMatch(huaweiQuarterlyAdv, matepad115S);
    assert.ok(matepad115SMatch);
    assert.equal(
      matepad115SMatch!.confidence,
      'LIKELY',
      'Huawei MatePad 11.5S must be held at LIKELY (PENDING_REVIEW) and never auto-confirmed as VERIFIED against MatePad 11.5',
    );
    assert.equal(matepad115SMatch!.status, 'PENDING_REVIEW');
    assert.equal(matepad115SMatch!.authenticityClassification, 'INFERRED_NEEDS_REVIEW');
    console.log('✓ Test 6 Passed: Rejection of incorrect model/generation matches');
  }

  // ---------------------------------------------------------------------------
  // 7. Separation of Generic Update/Maintenance Schedules from Vulnerability Applicability
  // ---------------------------------------------------------------------------
  {
    const huaweiQuarterlyAdv = createMockAdvisory({
      id: 'adv-huawei-schedule-quarterly',
      sourceId: 'huawei-security',
      manufacturer: 'Huawei',
      title: 'Huawei EMUI / HarmonyOS Quarterly Security Update Device Scope',
      advisoryType: 'UPDATE_SCHEDULE',
      sourceUrl: 'https://consumer.huawei.com/en/support/bulletin/',
      cveIds: [],
      affectedProductsText: 'HUAWEI Pura 70 Pro, HUAWEI Pura 70 Ultra, HUAWEI MatePad 11.5',
      affectedProducts: ['HUAWEI Pura 70 Pro', 'HUAWEI Pura 70 Ultra', 'HUAWEI MatePad 11.5'],
    });
    const pura70Pro = createMockProduct({
      id: 'prod-huawei-pura-70-pro',
      name: 'Huawei Pura 70 Pro 512GB',
      brand: 'Huawei',
    });

    const puraMatch = evaluateProductAdvisoryMatch(huaweiQuarterlyAdv, pura70Pro);
    assert.ok(puraMatch);
    assert.equal(puraMatch!.relationshipType, 'OFFICIAL_UPDATE_ELIGIBILITY');
    assert.equal(
      puraMatch!.authenticityClassification,
      'INFERRED_NEEDS_REVIEW',
      'Generic maintenance schedule with 0 CVEs must be classified as INFERRED_NEEDS_REVIEW and never auto-confirmed as a security vulnerability',
    );
    assert.equal(puraMatch!.qualifiesForAutomaticConfirmation, false);
    console.log('✓ Test 7 Passed: Generic update/maintenance schedules separated from vulnerability applicability');
  }

  // ---------------------------------------------------------------------------
  // 8. Missing Evidence Detection & 11-Field Candidate Completeness
  // ---------------------------------------------------------------------------
  {
    const adv = createMockAdvisory({});
    const prod = createMockProduct({});
    const match = evaluateProductAdvisoryMatch(adv, prod);
    assert.ok(match);

    // Verify all 11 Objective 4 required fields are populated on candidate matches
    assert.ok(match!.productTitle, '1. canonical product title');
    assert.ok(match!.advisoryTitle && match!.advisoryId, '2. advisory title and ID');
    assert.ok(match!.manufacturer, '3. official source authority');
    assert.ok(match!.sourceUrl, '4. official source URL');
    assert.ok(match!.sourcePublishedAt, '5. publication date');
    assert.ok(match!.sourceVerifiedAt, '6. last fetched/verified timestamp');
    assert.ok(match!.attributableExcerpt, '7. exact matched text or structured field');
    assert.ok(match!.matcherRuleId, '8. matcher rule ID');
    assert.ok(match!.confidence, '9. confidence classification');
    assert.ok(match!.authenticityClassification, '10. authenticity classification');
    assert.ok(Array.isArray(match!.missingEvidence), '11. missing evidence array');
    assert.ok(Array.isArray(match!.sourceAuthenticityWarnings), '11b. source authenticity warnings array');
    console.log('✓ Test 8 Passed: 11-field candidate completeness and missing evidence detection');
  }

  // ---------------------------------------------------------------------------
  // 9. Candidate Count Reconciliation (531 vs 762 = -231 Delta) & Zero-Write Audit
  // ---------------------------------------------------------------------------
  {
    const advisories = [
      createMockAdvisory({ id: 'adv-apple-149230', title: 'iOS 27.2 and iPadOS 27.2' }),
      createMockAdvisory({
        id: 'adv-cisa-CVE-2024-7399',
        sourceId: 'cisa-kev',
        manufacturer: 'Cross-Vendor',
        title: 'CISA KEV: Samsung MagicINFO 9 Server CVE-2024-7399',
        advisoryType: 'KNOWN_EXPLOITED',
        sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
        cveIds: ['CVE-2024-7399'],
        affectedProductsText: 'Samsung MagicINFO 9 Server',
        affectedProducts: ['Samsung MagicINFO 9 Server'],
      }),
    ];
    const products = [
      createMockProduct({ id: 'prod-iphone-16-pro', name: 'Apple iPhone 16 Pro 256GB' }),
      createMockProduct({ id: 'prod-sony-xm5', name: 'Sony WH-1000XM5', brand: 'Sony', category: 'Audio' }),
    ];

    const batch = matchAdvisoriesToCatalog(advisories, products);
    const advAudits = advisories.map((a) =>
      auditSingleAdvisoryAuthenticity(
        a,
        batch.matches.filter((m) => m.advisoryId === a.id).length,
      ),
    );
    const reconciliation = buildCandidateCountReconciliationReport(advisories, products, batch.matches, advAudits);

    assert.equal(reconciliation.totalAdvisoriesExamined, 2);
    assert.equal(reconciliation.totalCanonicalProductsExamined, 2);
    assert.equal(reconciliation.totalCandidateCombinationsEvaluated, 4);
    assert.equal(reconciliation.candidateMatchesGenerated, 1);
    assert.equal(reconciliation.candidateMatchesRejected, 3);
    assert.equal(reconciliation.discrepancyExplanation531Vs762.earlierS122CandidateCount, 762);
    assert.equal(reconciliation.discrepancyExplanation531Vs762.currentCandidateCount, 531);
    assert.equal(reconciliation.discrepancyExplanation531Vs762.totalDelta, 231);
    const breakdownSum =
      reconciliation.discrepancyExplanation531Vs762.breakdownOf231ExcludedCandidates.reduce(
        (acc, b) => acc + b.excludedCandidateCount,
        0,
      );
    assert.equal(breakdownSum, 231, '6-part Apple exclusion delta must sum to exactly 231 (762 - 531)');
    console.log('✓ Test 9 Passed: Candidate count reconciliation (531 vs 762 = -231 delta)');
  }

  // ---------------------------------------------------------------------------
  // 10. Read-Only Audit Behavior with Zero Firestore Writes
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    let writeAttempts = 0;

    const readOnlyMockDb = {
      collection(name: string) {
        return {
          async get() {
            if (name === 'serviceAdvisories') {
              return {
                empty: false,
                docs: [
                  {
                    id: 'adv-apple-149230',
                    data: () =>
                      createMockAdvisory({
                        id: 'adv-apple-149230',
                        title: 'iOS 27.2 and iPadOS 27.2',
                        sourceUrl: 'https://support.apple.com/en-us/149230',
                      }),
                  },
                ],
              };
            }
            if (name === 'retailProducts') {
              return {
                empty: false,
                docs: [
                  {
                    id: 'prod-iphone-16-pro',
                    data: () => createMockProduct({ id: 'prod-iphone-16-pro', name: 'Apple iPhone 16 Pro 256GB' }),
                  },
                ],
              };
            }
            return { empty: true, docs: [] };
          },
          doc() {
            return {
              async set() {
                writeAttempts++;
              },
              async update() {
                writeAttempts++;
              },
              async delete() {
                writeAttempts++;
              },
            };
          },
        };
      },
      batch() {
        return {
          set() {
            writeAttempts++;
          },
          async commit() {
            writeAttempts++;
          },
        };
      },
    };

    const review = await getMatchEvidenceReview({ customDb: readOnlyMockDb });
    const audit = await getOfficialSourceAuthenticityAudit({ customDb: readOnlyMockDb });

    assert.equal(writeAttempts, 0, 'S1.2.4 audit and evidence review must perform ZERO Firestore writes');
    assert.ok(review.sourceAuthenticityAudit, 'Evidence review must include sourceAuthenticityAudit');
    assert.equal(audit.advisoryCounts.total, 1);
    assert.equal(
      audit.matchAuthenticityCounts.OFFICIAL_FAMILY_CONFIRMED,
      1,
      'Single iPhone 16 Pro match on iOS 27.2 must be OFFICIAL_FAMILY_CONFIRMED',
    );
    console.log('✓ Test 10 Passed: Read-only audit behavior verified with zero Firestore writes');
  }

  console.log('=== All 10 S1.2.4 Source Authenticity & Product Applicability Audit Tests Passed! ===');
}

runTests().catch((err) => {
  console.error('S1.2.4 Test Suite Failed:', err);
  process.exit(1);
});

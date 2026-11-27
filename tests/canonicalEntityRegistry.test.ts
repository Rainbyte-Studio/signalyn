/**
 * Phase 4C.5 Test Suite: Canonical Entity Registry & Resolution Engine
 * 
 * Verifies:
 * 1. Authoritative Company Registry for all 9 competitors + HUAWEI.
 * 2. Corporate suffix normalization and word-boundary safety.
 * 3. Prevention of partial substring collisions (e.g., "Vivobook" != "vivo").
 * 4. Extended Canonical Product Catalog coverage (Smartphones, Wearables, Tablets, Audio).
 * 5. Category-compatible product matching and cross-category isolation.
 * 6. Generic token collision suppression ("Pro", "Ultra", "Watch", "Air").
 * 7. Product Family & Series resolution (e.g., Galaxy Tab S12 Ultra, Watch GT 7 Pro, Mate 90 RS).
 * 8. Non-hardware concept detection (AI agents, chipsets, operating systems).
 * 9. Review Queue Decision Engine (auto-resolve canonicals, dismiss non-devices, queue genuine unknowns).
 * 10. Review deduplication and citation evidence aggregation.
 * 
 * Hard Constraints:
 * Gemini calls: 0
 * Backfill runs: 0
 * Collector runs: 0
 * Firestore production intelligence writes: 0
 */

import {
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
  classifyNonDeviceConcept,
  evaluateEntityReviewNeed,
  normalizeCompanyName,
  normalizeEntityKey,
  resolveCompanySafe,
  resolveProductSafe,
  isBroadMultiSeriesReference,
} from '../src/services/canonicalEntities';
import { generateCanonicalReviewId } from '../src/server/entityResolution/entityReviewService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export function runCanonicalEntityRegistryTests() {
  console.log('=== STARTING PHASE 4C.5 CANONICAL ENTITY REGISTRY TESTS ===\n');

  // Test 1: Tracked Companies Canonical Registry
  console.log('--- Test 1: Tracked Companies Canonical Registry ---');
  {
    assert(CANONICAL_COMPANIES_REGISTRY.length === 9, '1A: Exactly 9 canonical companies registered');

    const huawei = CANONICAL_COMPANIES_REGISTRY.find((c) => c.id === 'comp-huawei')!;
    assert(huawei.name === 'HUAWEI', '1B: HUAWEI registered');
    assert(huawei.isMyCompany === true, '1C: HUAWEI is configured as primary company');
    assert(huawei.isCompetitor === false, '1D: HUAWEI is not marked as competitor');

    const competitorIds = ['comp-samsung', 'comp-apple', 'comp-xiaomi', 'comp-honor', 'comp-google', 'comp-garmin', 'comp-oppo', 'comp-vivo'];
    for (const cId of competitorIds) {
      const comp = CANONICAL_COMPANIES_REGISTRY.find((c) => c.id === cId);
      assert(!!comp, `1E: Competitor ${cId} is registered`);
      assert(comp?.isCompetitor === true, `1F: ${cId} is marked as competitor`);
      assert(comp?.isMyCompany === false, `1G: ${cId} is not primary company`);
    }
  }

  // Test 2: Safe Corporate Suffix Normalization
  console.log('\n--- Test 2: Safe Corporate Suffix Normalization ---');
  {
    assert(normalizeCompanyName('Huawei Technologies Co., Ltd.') === 'huawei', '2A: Huawei Technologies Co., Ltd. -> huawei');
    assert(normalizeCompanyName('Samsung Electronics Co., Ltd.') === 'samsungelectronics', '2B: Samsung Electronics Co., Ltd. -> samsungelectronics');
    assert(normalizeCompanyName('Apple Inc.') === 'apple', '2C: Apple Inc. -> apple');
    assert(normalizeCompanyName('Xiaomi Corporation') === 'xiaomi', '2D: Xiaomi Corporation -> xiaomi');
    assert(normalizeCompanyName('Honor Device Co., Ltd.') === 'honor', '2E: Honor Device Co., Ltd. -> honor');
    assert(normalizeCompanyName('Garmin Ltd.') === 'garmin', '2F: Garmin Ltd. -> garmin');
  }

  // Test 3: Word-Boundary Collision Prevention
  console.log('\n--- Test 3: Word-Boundary Collision Prevention ---');
  {
    const resVivoExact = resolveCompanySafe('vivo');
    assert(resVivoExact.matchedCompany?.id === 'comp-vivo', '3A: "vivo" resolves to comp-vivo');

    const resVivobook = resolveCompanySafe('ASUS Vivobook S14');
    assert(resVivobook.matchedCompany?.id !== 'comp-vivo', '3B: "ASUS Vivobook" does NOT falsely resolve to comp-vivo');

    const resOppoExact = resolveCompanySafe('OPPO');
    assert(resOppoExact.matchedCompany?.id === 'comp-oppo', '3C: "OPPO" resolves to comp-oppo');

    const resOpportunity = resolveCompanySafe('Global Market Opportunity');
    assert(resOpportunity.matchedCompany?.id !== 'comp-oppo', '3D: "Opportunity" does NOT falsely resolve to comp-oppo');
  }

  // Test 4: Extended Canonical Product Catalog Coverage
  console.log('\n--- Test 4: Extended Canonical Product Catalog Coverage ---');
  {
    assert(CANONICAL_PRODUCTS_REGISTRY.length >= 30, `4A: Canonical products registry has rich coverage (${CANONICAL_PRODUCTS_REGISTRY.length} models)`);

    // Verify all 9 companies have registered products
    const companyIds = CANONICAL_COMPANIES_REGISTRY.map((c) => c.id);
    for (const compId of companyIds) {
      const prods = CANONICAL_PRODUCTS_REGISTRY.filter((p) => p.companyId === compId);
      assert(prods.length > 0, `4B: Company ${compId} has registered products (${prods.length} models)`);
    }

    // Verify all 4 strategic categories have products
    const cats = ['Smartphones', 'Wearables', 'Tablets', 'Audio'];
    for (const cat of cats) {
      const inCat = CANONICAL_PRODUCTS_REGISTRY.filter((p) => p.category.toLowerCase() === cat.toLowerCase());
      assert(inCat.length > 0, `4C: Category ${cat} has registered products (${inCat.length} models)`);
    }
  }

  // Test 5: Category-Compatible Product Resolution & Cross-Category Isolation
  console.log('\n--- Test 5: Category-Compatible Product Resolution & Cross-Category Isolation ---');
  {
    // iPad Air in TABLETS
    const resIpadAir = resolveProductSafe('iPad Air 6', 'TABLETS');
    assert(resIpadAir.matchedProduct?.companyId === 'comp-apple', '5A: iPad Air resolves to Apple');
    assert(resIpadAir.matchedProduct?.category.toLowerCase() === 'tablets', '5B: iPad Air has TABLETS category');

    // AirPods in AUDIO
    const resAirPods = resolveProductSafe('AirPods 4', 'AUDIO');
    assert(resAirPods.matchedProduct?.companyId === 'comp-apple', '5C: AirPods 4 resolves to Apple Audio');
    assert(resAirPods.matchedProduct?.category.toLowerCase() === 'audio', '5D: AirPods 4 has AUDIO category');

    // Cross-category incompatibility check: AirPods queried under SMARTPHONES should not match
    const resMismatched = resolveProductSafe('AirPods Pro', 'SMARTPHONES');
    assert(!resMismatched.matchedProduct, '5E: AirPods Pro in SMARTPHONES category returns unmatched');
  }

  // Test 6: Generic Token Collision Suppression
  console.log('\n--- Test 6: Generic Token Collision Suppression ---');
  {
    const genericQueries = ['Pro', 'Ultra', 'Max', 'Watch', 'Air', 'Pad', 'Buds', 'Plus', 'Mini', 'Band'];
    for (const token of genericQueries) {
      const res = resolveProductSafe(token, 'OTHER');
      assert(!res.matchedProduct, `6A: Generic token "${token}" does not match arbitrary product`);
    }
  }

  // Test 7: Product Family & Series Resolution
  console.log('\n--- Test 7: Product Family & Series Resolution ---');
  {
    // Samsung Galaxy Tab S12 Ultra
    const resTab = resolveProductSafe('Samsung Galaxy Tab S12 Ultra', 'TABLETS');
    assert(resTab.matchedProduct?.id === 'prod-sam-tabs12', '7A: Galaxy Tab S12 Ultra maps to prod-sam-tabs12');
    assert(resTab.matchedProduct?.companyId === 'comp-samsung', '7B: Galaxy Tab S12 Ultra maps to Samsung');

    // Huawei Watch GT 7 Pro
    const resGT7 = resolveProductSafe('Huawei Watch GT 7 Pro', 'WEARABLES');
    assert(resGT7.matchedProduct?.id === 'prod-hw-gt7', '7C: Huawei Watch GT 7 Pro maps to prod-hw-gt7');
    assert(resGT7.matchedProduct?.companyId === 'comp-huawei', '7D: Watch GT 7 Pro maps to Huawei');

    // Mate 90 RS Ultimate Design
    const resMate90 = resolveProductSafe('Mate 90 RS Ultimate Design', 'SMARTPHONES');
    assert(resMate90.matchedProduct?.id === 'prod-hw-mate90', '7E: Mate 90 RS maps to prod-hw-mate90');

    // iPhone 18 Pro Max
    const resIP18 = resolveProductSafe('iPhone 18 Pro Max', 'SMARTPHONES');
    assert(resIP18.matchedProduct?.id === 'prod-app-ip18p', '7F: iPhone 18 Pro Max maps to prod-app-ip18p');

    // Google Pixel 11a
    const resPixel11a = resolveProductSafe('Google Pixel 11a', 'SMARTPHONES');
    assert(resPixel11a.matchedProduct?.id === 'prod-goog-pixel11a', '7G: Pixel 11a maps to prod-goog-pixel11a');

    // Garmin Venu 6
    const resVenu = resolveProductSafe('Garmin Venu 6', 'WEARABLES');
    assert(resVenu.matchedProduct?.id === 'prod-garmin-venu', '7H: Garmin Venu 6 maps to prod-garmin-venu');
  }

  // Test 8: Non-Hardware Concept Guards
  console.log('\n--- Test 8: Non-Hardware Concept Guards ---');
  {
    const aiRes = classifyNonDeviceConcept('AI Agents');
    assert(aiRes?.category === 'AI_SOFTWARE', '8A: "AI Agents" classified as AI_SOFTWARE');

    const geminiRes = classifyNonDeviceConcept('Gemini');
    assert(geminiRes?.category === 'AI_SOFTWARE', '8B: "Gemini" classified as AI_SOFTWARE');

    const m5Res = classifyNonDeviceConcept('Apple M5');
    assert(m5Res?.category === 'CHIPSET_SILICON', '8C: "Apple M5" classified as CHIPSET_SILICON');

    const dimensityRes = classifyNonDeviceConcept('MediaTek Dimensity 9500');
    assert(dimensityRes?.category === 'CHIPSET_SILICON', '8D: "MediaTek Dimensity 9500" classified as CHIPSET_SILICON');

    const ipadosRes = classifyNonDeviceConcept('iPadOS 27');
    assert(ipadosRes?.category === 'OPERATING_SYSTEM', '8E: "iPadOS 27" classified as OPERATING_SYSTEM');
  }

  // Test 9: Review Queue Decision Engine
  console.log('\n--- Test 9: Review Queue Decision Engine ---');
  {
    // Canonical Company -> Auto Resolve
    const evalComp = evaluateEntityReviewNeed('COMPANY', 'Huawei Technologies');
    assert(evalComp.shouldCreateReview === false, '9A: Canonical company does NOT create review');
    assert(evalComp.suggestedAction === 'AUTO_RESOLVE', '9B: Suggested action is AUTO_RESOLVE');

    // Recognized Ecosystem Partner -> Dismiss Non-Device
    const evalEco = evaluateEntityReviewNeed('COMPANY', 'Qualcomm');
    assert(evalEco.shouldCreateReview === false, '9C: Qualcomm does NOT create review queue spam');
    assert(evalEco.suggestedAction === 'DISMISS_NON_DEVICE', '9D: Suggested action is DISMISS_NON_DEVICE');

    // Canonical Product -> Auto Resolve
    const evalProd = evaluateEntityReviewNeed('PRODUCT', 'Galaxy Tab S12 Ultra', 'TABLETS');
    assert(evalProd.shouldCreateReview === false, '9E: Canonical product does NOT create review');
    assert(evalProd.suggestedAction === 'AUTO_RESOLVE', '9F: Suggested action is AUTO_RESOLVE');

    // Non-Hardware Concept -> Dismiss
    const evalConcept = evaluateEntityReviewNeed('PRODUCT', 'iPadOS 27');
    assert(evalConcept.shouldCreateReview === false, '9G: Operating system does NOT create review');
    assert(evalConcept.suggestedAction === 'DISMISS_NON_DEVICE', '9H: Suggested action is DISMISS_NON_DEVICE');

    // Genuinely unknown device -> Queue for review
    const evalUnknown = evaluateEntityReviewNeed('PRODUCT', 'Lemmo 3 Smart E-Bike', 'OTHER');
    assert(evalUnknown.shouldCreateReview === true, '9I: Truly unknown entity is queued for review');
    assert(evalUnknown.suggestedAction === 'QUEUE_FOR_REVIEW', '9J: Suggested action is QUEUE_FOR_REVIEW');
  }

  // Test 10: Deterministic Review ID and Aggregation
  console.log('\n--- Test 10: Deterministic Review ID and Aggregation ---');
  {
    const rev1 = generateCanonicalReviewId('PRODUCT', 'Lemmo 3', 'OTHER');
    const rev2 = generateCanonicalReviewId('PRODUCT', 'lemmo 3', 'OTHER');
    const rev3 = generateCanonicalReviewId('PRODUCT', 'Lemmo-3', 'OTHER');

    assert(rev1.reviewId === 'rev-prod-other-lemmo3', '10A: Product review ID is deterministic');
    assert(rev1.reviewId === rev2.reviewId, '10B: Casing produces identical review ID');
    assert(rev1.reviewId === rev3.reviewId, '10C: Punctuation variation produces identical review ID');
  }

  // Test 11: Automotive Software & Infotainment Platform Non-Device Suppression (Phase 4C.7Q-FIX2)
  console.log('\n--- Test 11: Automotive Software & Infotainment Platform Non-Device Suppression ---');
  {
    const automotiveConcepts = [
      'CarPlay',
      'Apple CarPlay',
      'Android Auto',
      'Android Automotive',
      'Android Automotive OS',
    ];

    for (const name of automotiveConcepts) {
      const concept = classifyNonDeviceConcept(name);
      assert(concept !== null, `11A: ${name} recognized as non-device concept`);
      assert(concept?.category === 'AUTOMOTIVE_SOFTWARE', `11B: ${name} categorized as AUTOMOTIVE_SOFTWARE`);

      const prodRes = resolveProductSafe(name, 'AUTOMOTIVE');
      assert(prodRes.isNonDeviceConcept === true, `11C: resolveProductSafe flags ${name} as non-device concept`);
      assert(prodRes.nonDeviceCategory === 'AUTOMOTIVE_SOFTWARE', `11D: resolveProductSafe preserves AUTOMOTIVE_SOFTWARE for ${name}`);

      const evalNeed = evaluateEntityReviewNeed('PRODUCT', name, 'AUTOMOTIVE');
      assert(evalNeed.shouldCreateReview === false, `11E: ${name} produces shouldCreateReview === false`);
      assert(evalNeed.suggestedAction === 'DISMISS_NON_DEVICE', `11F: ${name} suggestedAction is DISMISS_NON_DEVICE`);
    }
  }

  // Test 12: OS / Software Platform Regression Audit (Phase 4C.7Q-FIX2)
  console.log('\n--- Test 12: OS / Software Platform Regression Audit ---');
  {
    const osPlatforms = [
      'HarmonyOS',
      'HarmonyOS NEXT',
      'Android',
      'Android OS',
      'iOS',
      'One UI',
      'watchOS',
      'Wear OS',
      'HyperOS',
      'Windows',
      'Windows 11',
    ];

    for (const os of osPlatforms) {
      const concept = classifyNonDeviceConcept(os);
      assert(concept !== null, `12A: ${os} recognized as non-device concept`);
      assert(concept?.category === 'OPERATING_SYSTEM', `12B: ${os} categorized as OPERATING_SYSTEM`);

      const prodRes = resolveProductSafe(os);
      assert(prodRes.isNonDeviceConcept === true, `12C: resolveProductSafe flags ${os} as non-device`);

      const evalNeed = evaluateEntityReviewNeed('PRODUCT', os);
      assert(evalNeed.shouldCreateReview === false, `12D: ${os} does NOT create review queue spam`);
    }
  }

  // Test 13: Hardware Negative Controls (Preserve Legitimate Hardware)
  console.log('\n--- Test 13: Hardware Negative Controls ---');
  {
    const hardwareProducts = [
      'HUAWEI WATCH GT 7 Pro',
      'Samsung Galaxy S26',
      'Google Pixel 11 Pro Fold',
      'Apple AirPods',
      'Nothing Headphone 1 Pro',
      'Amazon Fire Tablet',
    ];

    for (const hw of hardwareProducts) {
      const concept = classifyNonDeviceConcept(hw);
      assert(concept === null, `13A: ${hw} is NOT classified as a non-device concept`);

      const prodRes = resolveProductSafe(hw);
      assert(prodRes.isNonDeviceConcept !== true, `13B: ${hw} is NOT suppressed as non-device`);
    }
  }

  // Test 14: Concurrent Company Extraction & Suppression Isolation
  console.log('\n--- Test 14: Concurrent Company Extraction & Suppression Isolation ---');
  {
    // In an article featuring Apple, Google, CarPlay, and Android Auto:
    const appleRes = resolveCompanySafe('Apple');
    assert(appleRes.matchedCompany?.id === 'comp-apple', '14A: Apple resolves deterministically to comp-apple');

    const googleRes = resolveCompanySafe('Google');
    assert(googleRes.matchedCompany?.id === 'comp-google', '14B: Google resolves deterministically to comp-google');

    const carplayEval = evaluateEntityReviewNeed('PRODUCT', 'CarPlay', 'AUTOMOTIVE');
    assert(carplayEval.shouldCreateReview === false, '14C: CarPlay product review suppressed');

    const androidAutoEval = evaluateEntityReviewNeed('PRODUCT', 'Android Auto', 'AUTOMOTIVE');
    assert(androidAutoEval.shouldCreateReview === false, '14D: Android Auto product review suppressed');
  }

  // Test 15: Kirin 9050 Chipset Non-Device Guard (Phase 4C.7)
  console.log('\n--- Test 15: Kirin 9050 Chipset Non-Device Guard ---');
  {
    const kirinChips = ['Kirin 9050', 'Kirin 9020', 'Kirin 9010', 'Kirin 9000S', 'Kirin 9000'];
    for (const chip of kirinChips) {
      const concept = classifyNonDeviceConcept(chip);
      assert(concept !== null, `15A: ${chip} recognized as non-device concept`);
      assert(concept?.category === 'CHIPSET_SILICON', `15B: ${chip} categorized as CHIPSET_SILICON`);

      const prodRes = resolveProductSafe(chip);
      assert(prodRes.isNonDeviceConcept === true, `15C: resolveProductSafe flags ${chip} as non-device`);

      const evalNeed = evaluateEntityReviewNeed('PRODUCT', chip);
      assert(evalNeed.shouldCreateReview === false, `15D: ${chip} does NOT create review queue spam`);
      assert(evalNeed.suggestedAction === 'DISMISS_NON_DEVICE', `15E: ${chip} suggestedAction is DISMISS_NON_DEVICE`);
    }

    // Hardware negative control
    const hwRes = resolveProductSafe('HUAWEI Mate 90 Pro');
    assert(hwRes.isNonDeviceConcept !== true, '15F: HUAWEI Mate 90 Pro is NOT suppressed as non-device');
  }

  // Test 16: Operating System Version Suppression (Phase 4C.7Q-FIX3)
  console.log('\n--- Test 16: Operating System Version Suppression ---');
  {
    const osVersions = [
      'iOS 27',
      'iOS 18',
      'iOS 19',
      'Android 15',
      'Android 16',
      'Android 17',
      'HarmonyOS NEXT',
      'watchOS 12',
      'Wear OS 6',
      'One UI 9',
      'HyperOS 4',
      'Windows 11',
    ];

    for (const os of osVersions) {
      const concept = classifyNonDeviceConcept(os);
      assert(concept !== null, `16A: ${os} recognized as non-device concept`);
      assert(concept?.category === 'OPERATING_SYSTEM', `16B: ${os} categorized as OPERATING_SYSTEM`);

      const prodRes = resolveProductSafe(os);
      assert(prodRes.isNonDeviceConcept === true, `16C: resolveProductSafe flags ${os} as non-device`);

      const evalNeed = evaluateEntityReviewNeed('PRODUCT', os);
      assert(evalNeed.shouldCreateReview === false, `16D: ${os} does NOT create review`);
      assert(evalNeed.suggestedAction === 'DISMISS_NON_DEVICE', `16E: ${os} action is DISMISS_NON_DEVICE`);
    }
  }

  // Test 17: Chipset Variant Pattern Suppression & Negative Controls (Phase 4C.7Q-FIX3)
  console.log('\n--- Test 17: Chipset Variant Pattern Suppression ---');
  {
    const chipsets = [
      'Kirin 9050',
      'Kirin 9050 Pro',
      'Kirin 9020',
      'Kirin 9000S',
      'Snapdragon 8 Gen 3',
      'Apple M5',
    ];

    for (const chip of chipsets) {
      const concept = classifyNonDeviceConcept(chip);
      assert(concept !== null, `17A: ${chip} recognized as non-device concept`);
      assert(concept?.category === 'CHIPSET_SILICON', `17B: ${chip} categorized as CHIPSET_SILICON`);

      const prodRes = resolveProductSafe(chip);
      assert(prodRes.isNonDeviceConcept === true, `17C: resolveProductSafe flags ${chip} as non-device`);

      const evalNeed = evaluateEntityReviewNeed('PRODUCT', chip);
      assert(evalNeed.shouldCreateReview === false, `17D: ${chip} does NOT create review`);
    }

    // Hardware negative controls: must NEVER be suppressed
    const hwControls = [
      'HUAWEI Mate 90 Pro',
      'HUAWEI WATCH GT 7 Pro',
      'Samsung Galaxy S26 Ultra',
      'Google Pixel 11 Pro',
      'Apple iPad Pro',
    ];

    for (const hw of hwControls) {
      const concept = classifyNonDeviceConcept(hw);
      assert(concept === null, `17E: ${hw} is NOT classified as non-device concept`);

      const prodRes = resolveProductSafe(hw);
      assert(prodRes.isNonDeviceConcept !== true, `17F: ${hw} is NOT suppressed as non-device`);
    }
  }

  // Test 18: Software Tool & Utility Suppression (Phase 4C.7Q-FIX3)
  console.log('\n--- Test 18: Software Tool & Utility Suppression ---');
  {
    const concept = classifyNonDeviceConcept('scrcpy');
    assert(concept !== null, '18A: scrcpy recognized as non-device concept');
    assert(concept?.category === 'SOFTWARE_TOOL', '18B: scrcpy categorized as SOFTWARE_TOOL');

    const prodRes = resolveProductSafe('scrcpy');
    assert(prodRes.isNonDeviceConcept === true, '18C: resolveProductSafe flags scrcpy as non-device');

    const evalNeed = evaluateEntityReviewNeed('PRODUCT', 'scrcpy');
    assert(evalNeed.shouldCreateReview === false, '18D: scrcpy does NOT create product review');
    assert(evalNeed.suggestedAction === 'DISMISS_NON_DEVICE', '18E: scrcpy suggestedAction is DISMISS_NON_DEVICE');
  }

  // Test 19: Non-Strategic Automotive Company Filtering (Phase 4C.7Q-FIX3)
  console.log('\n--- Test 19: Non-Strategic Automotive Company Filtering ---');
  {
    const autoCompanies = ['Ford', 'General Motors', 'Honda'];

    for (const co of autoCompanies) {
      const compRes = resolveCompanySafe(co);
      assert(compRes.isRecognizedEcosystem === true, `19A: ${co} recognized as ecosystem company`);
      assert(compRes.ecosystemSector === 'Automotive OEM', `19B: ${co} sector is Automotive OEM`);

      const evalNeed = evaluateEntityReviewNeed('COMPANY', co);
      assert(evalNeed.shouldCreateReview === false, `19C: ${co} does NOT create company onboarding review`);
      assert(evalNeed.suggestedAction === 'DISMISS_NON_DEVICE', `19D: ${co} action is DISMISS_NON_DEVICE`);
    }

    // Strategic companies must still resolve deterministically
    assert(resolveCompanySafe('Apple').matchedCompany?.id === 'comp-apple', '19E: Apple resolves to comp-apple');
    assert(resolveCompanySafe('Google').matchedCompany?.id === 'comp-google', '19F: Google resolves to comp-google');
    assert(resolveCompanySafe('Samsung').matchedCompany?.id === 'comp-samsung', '19G: Samsung resolves to comp-samsung');
    assert(resolveCompanySafe('HUAWEI').matchedCompany?.id === 'comp-huawei', '19H: HUAWEI resolves to comp-huawei');

    // Strategic untracked hardware OEMs must remain eligible for review queue
    const fairphoneEval = evaluateEntityReviewNeed('COMPANY', 'Fairphone');
    assert(fairphoneEval.shouldCreateReview === true, '19I: Fairphone remains eligible for review');
    assert(fairphoneEval.suggestedAction === 'QUEUE_FOR_REVIEW', '19J: Fairphone queued for review');

    const technicsEval = evaluateEntityReviewNeed('COMPANY', 'Technics');
    assert(technicsEval.shouldCreateReview === true, '19K: Technics remains eligible for review');
    assert(technicsEval.suggestedAction === 'QUEUE_FOR_REVIEW', '19L: Technics queued for review');
  }

  // Test 20: Broad Multi-Series Product Family Aggregations (Phase 4C.7Q-FIX3)
  console.log('\n--- Test 20: Broad Multi-Series Product Family Aggregations ---');
  {
    const multiSeries = 'Samsung Galaxy S / A / M / F Series';
    assert(isBroadMultiSeriesReference(multiSeries) === true, '20A: Identified as broad multi-series reference');

    const concept = classifyNonDeviceConcept(multiSeries);
    assert(concept !== null, '20B: Broad multi-series recognized as non-device concept');
    assert(concept?.category === 'TECH_CONCEPT', '20C: Broad multi-series categorized as TECH_CONCEPT');

    const prodRes = resolveProductSafe(multiSeries);
    assert(prodRes.isNonDeviceConcept === true, '20D: resolveProductSafe flags multi-series as non-device');

    const evalNeed = evaluateEntityReviewNeed('PRODUCT', multiSeries);
    assert(evalNeed.shouldCreateReview === false, '20E: Broad multi-series does NOT create exact model review');

    // Negative controls: exact models with series name are NOT broad multi-series
    assert(isBroadMultiSeriesReference('Samsung Galaxy S26 Ultra') === false, '20F: Galaxy S26 Ultra is not broad multi-series');
    assert(isBroadMultiSeriesReference('Motorola Edge 70 Pro') === false, '20G: Motorola Edge 70 Pro is not broad multi-series');
  }

  console.log('\n=== ALL CANONICAL ENTITY REGISTRY TESTS PASSED ===\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCanonicalEntityRegistryTests();
}

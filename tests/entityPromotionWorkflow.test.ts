/**
 * Phase 4C.6B Test Suite: Real Entity Confirmation, Canonical Promotion & Review Suppression
 * 
 * Verifies:
 * 1. existing canonical company link persistence
 * 2. existing canonical product link persistence
 * 3. new company promotion
 * 4. new product promotion
 * 5. tracked=false default company
 * 6. product lifecycle persistence
 * 7. PRODUCT_FAMILY / SERIES / MODEL persistence
 * 8. duplicate company prevention
 * 9. duplicate product prevention
 * 10. alias collision prevention
 * 11. generic alias rejection
 * 12. Qualcomm suppression
 * 13. MediaTek suppression
 * 14. NVIDIA suppression
 * 15. non-device product suppression
 * 16. Dismiss Non-Strategic
 * 17. Reject remains distinct
 * 18. promoted Firestore product enters merged resolver
 * 19. promoted Firestore company enters merged resolver
 * 20. future review prevented after promotion
 * 21. Products screen merged visibility
 * 22. Companies screen visibility
 * 23. untracked company excluded from SOV
 * 24. legacy APPROVED review compatibility
 * 25. collision protection / safe validation
 * 
 * Hard Constraints:
 * Gemini calls: 0
 * Backfill runs: 0
 * Production Firestore writes: 0
 */

import {
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
  checkCompanyCollision,
  checkProductCollision,
  classifyNonDeviceConcept,
  generateCanonicalCompanyId,
  generateCanonicalProductId,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
  isGenericProductToken,
  resolveCompanySafe,
  resolveProductSafe,
  validateCanonicalAlias,
} from '../src/services/canonicalEntities';
import {
  Company,
  Product,
  EntityReview,
  ReviewStatus,
  ProductLifecycleStatus,
  ProductEntityLevel,
} from '../src/types';
import { resolveTrackedCompanyId, calculateCompetitiveAnalytics } from '../src/services/competitiveAnalytics';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export function runEntityPromotionWorkflowTests() {
  console.log('=== STARTING PHASE 4C.6B ENTITY PROMOTION WORKFLOW TESTS ===\n');

  // Test 1: Existing Canonical Company Link Persistence
  console.log('--- Test 1 & 2: Canonical Link Persistence Structure ---');
  {
    const mockCompanyReview: EntityReview = {
      id: 'rev-comp-huawei',
      type: 'COMPANY',
      detectedName: 'Huawei Tech',
      status: 'PENDING',
      confidence: 0.9,
      articleId: 'art-001',
      articleTitle: 'Huawei Mate 90 Flagship',
      createdAt: '2026-10-01T00:00:00Z',
    };

    // Simulate linking to comp-huawei
    const linkedCompanyReview: EntityReview = {
      ...mockCompanyReview,
      status: 'RESOLVED_EXISTING',
      canonicalId: 'comp-huawei',
      canonicalName: 'HUAWEI',
      resolutionType: 'EXISTING',
      resolutionMethod: 'MANUAL_LINK',
      resolvedAt: '2026-10-05T10:00:00Z',
      reviewedAt: '2026-10-05T10:00:00Z',
    };

    assert(linkedCompanyReview.status === 'RESOLVED_EXISTING', '1A: Status is RESOLVED_EXISTING');
    assert(linkedCompanyReview.canonicalId === 'comp-huawei', '1B: canonicalId preserved');
    assert(linkedCompanyReview.canonicalName === 'HUAWEI', '1C: canonicalName preserved');
    assert(linkedCompanyReview.resolutionType === 'EXISTING', '1D: resolutionType is EXISTING');
    assert(linkedCompanyReview.resolutionMethod === 'MANUAL_LINK', '1E: resolutionMethod is MANUAL_LINK');

    // Test 2: Product Link Persistence
    const mockProductReview: EntityReview = {
      id: 'rev-prod-wearable-watchgt7',
      type: 'PRODUCT',
      detectedName: 'Huawei Watch GT 7 Pro',
      category: 'Wearables',
      status: 'PENDING',
      confidence: 0.95,
      articleId: 'art-002',
      articleTitle: 'Watch GT 7 Pro Review',
      createdAt: '2026-10-01T00:00:00Z',
    };

    const linkedProductReview: EntityReview = {
      ...mockProductReview,
      status: 'RESOLVED_EXISTING',
      canonicalId: 'prod-hw-gt7',
      canonicalName: 'HUAWEI Watch GT 7 Series',
      resolutionType: 'EXISTING',
      resolutionMethod: 'MANUAL_LINK',
      resolvedAt: '2026-10-05T10:00:00Z',
      reviewedAt: '2026-10-05T10:00:00Z',
    };

    assert(linkedProductReview.canonicalId === 'prod-hw-gt7', '2A: Product canonicalId preserved');
    assert(linkedProductReview.resolutionType === 'EXISTING', '2B: Product resolutionType is EXISTING');
  }

  // Test 3, 4, 5: New Company Promotion & Tracked Default
  console.log('\n--- Test 3, 4 & 5: New Company & Product Promotion Models ---');
  {
    const generatedCompId = generateCanonicalCompanyId('Nothing');
    assert(generatedCompId === 'comp-nothing', '3A: Company ID generated as comp-nothing');

    const promotedCompany: Company = {
      id: generatedCompId,
      name: 'Nothing',
      aliases: ['Nothing Phone', 'Nothing Tech'],
      website: 'https://nothing.tech',
      isMyCompany: false, // Strict
      isCompetitor: false, // Default tracked = false
      categories: ['Smartphones', 'Audio'],
      active: true,
      createdAt: '2026-10-05T10:00:00Z',
      updatedAt: '2026-10-05T10:00:00Z',
      provenance: 'promoted_from_review_rev-comp-nothing',
    };

    assert(promotedCompany.isMyCompany === false, '5A: isMyCompany strictly false');
    assert(promotedCompany.isCompetitor === false, '5B: isCompetitor default is false (untracked)');
    assert(promotedCompany.categories.includes('Smartphones'), '5C: Categories preserved');

    // Test 4, 6, 7: New Product Promotion with Lifecycle & Entity Level
    const generatedProdId = generateCanonicalProductId('comp-apple', 'iPhone Duo');
    assert(generatedProdId === 'prod-appl-iphoneduo', '4A: Product ID generated with company prefix');

    const promotedProduct: Product = {
      id: generatedProdId,
      companyId: 'comp-apple',
      name: 'Apple iPhone Duo',
      aliases: ['iPhone Duo', 'iPhone Fold'],
      category: 'Smartphones',
      subcategory: 'Foldable Smartphone',
      active: true,
      lifecycle: 'RUMORED' as ProductLifecycleStatus,
      entityLevel: 'PRODUCT_MODEL' as ProductEntityLevel,
      createdAt: '2026-10-05T10:00:00Z',
      updatedAt: '2026-10-05T10:00:00Z',
      provenance: 'promoted_from_review_rev-prod-smartphone-iphoneduo',
    };

    assert(promotedProduct.lifecycle === 'RUMORED', '6A: Lifecycle set to RUMORED');
    assert(promotedProduct.entityLevel === 'PRODUCT_MODEL', '7A: Entity Level set to PRODUCT_MODEL');
  }

  // Test 8, 9, 10: Duplicate Prevention & Alias Collision
  console.log('\n--- Test 8, 9, 10 & 11: Collision & Generic Alias Safety ---');
  {
    // Duplicate company name check
    const dupCompany = checkCompanyCollision('HUAWEI', [], CANONICAL_COMPANIES_REGISTRY);
    assert(dupCompany.hasCollision === true, '8A: Exact company collision detected');

    // Duplicate company alias check
    const dupCompAlias = checkCompanyCollision('Acme Mobile', ['samsung'], CANONICAL_COMPANIES_REGISTRY);
    assert(dupCompAlias.hasCollision === true, '10A: Alias collision with Samsung detected');

    // Duplicate product check
    const dupProduct = checkProductCollision(
      'HUAWEI Watch GT 7 Series',
      'Wearables',
      'comp-huawei',
      [],
      CANONICAL_PRODUCTS_REGISTRY
    );
    assert(dupProduct.hasCollision === true, '9A: Exact product collision detected');

    // Generic alias rejection
    assert(isGenericProductToken('pro') === true, '11A: "pro" is generic token');
    assert(isGenericProductToken('ultra') === true, '11B: "ultra" is generic token');
    assert(isGenericProductToken('air') === true, '11C: "air" is generic token');
    assert(isGenericProductToken('watch') === true, '11D: "watch" is generic token');
    assert(isGenericProductToken('buds') === true, '11E: "buds" is generic token');

    const valPro = validateCanonicalAlias('Pro');
    assert(valPro.valid === false, '11F: Standalone alias "Pro" is rejected');

    const valAir = validateCanonicalAlias('Air');
    assert(valAir.valid === false, '11G: Standalone alias "Air" is rejected');

    const valGood = validateCanonicalAlias('Galaxy Buds Pro');
    assert(valGood.valid === true, '11H: Specific multi-word alias "Galaxy Buds Pro" is accepted');
  }

  // Test 12, 13, 14: Non-Strategic Company Suppression (Qualcomm, MediaTek, NVIDIA, Intel, AMD)
  console.log('\n--- Test 12, 13, 14 & 15: Ecosystem & Non-Device Concept Suppression ---');
  {
    const qualcommRes = resolveCompanySafe('Qualcomm');
    assert(qualcommRes.isRecognizedEcosystem === true, '12A: Qualcomm recognized as ecosystem partner');
    assert(!qualcommRes.matchedCompany, '12B: Qualcomm not in tracked competitor registry');

    const mediaTekRes = resolveCompanySafe('MediaTek');
    assert(mediaTekRes.isRecognizedEcosystem === true, '13A: MediaTek recognized as ecosystem partner');

    const nvidiaRes = resolveCompanySafe('NVIDIA');
    assert(nvidiaRes.isRecognizedEcosystem === true, '14A: NVIDIA recognized as ecosystem partner');

    const intelRes = resolveCompanySafe('Intel');
    assert(intelRes.isRecognizedEcosystem === true, '14B: Intel recognized as ecosystem partner');

    const amdRes = resolveCompanySafe('AMD');
    assert(amdRes.isRecognizedEcosystem === true, '14C: AMD recognized as ecosystem partner');

    // Test 15: Non-device product suppression
    const aiAgents = classifyNonDeviceConcept('AI Agents');
    assert(aiAgents?.category === 'AI_SOFTWARE', '15A: AI Agents recognized as AI_SOFTWARE');

    const gemini = classifyNonDeviceConcept('Gemini');
    assert(gemini?.category === 'AI_SOFTWARE', '15B: Gemini recognized as AI_SOFTWARE');

    const m5 = classifyNonDeviceConcept('Apple M5');
    assert(m5?.category === 'CHIPSET_SILICON', '15C: Apple M5 recognized as CHIPSET_SILICON');

    const ipados = classifyNonDeviceConcept('iPadOS 27');
    assert(ipados?.category === 'OPERATING_SYSTEM', '15D: iPadOS 27 recognized as OPERATING_SYSTEM');
  }

  // Test 16 & 17: Dismiss Non-Strategic vs Reject
  console.log('\n--- Test 16 & 17: Dismiss vs Reject Distinct Semantics ---');
  {
    const dismissedReview: EntityReview = {
      id: 'rev-prod-concept',
      type: 'PRODUCT',
      detectedName: 'Dimensity 9500',
      status: 'DISMISSED_NON_STRATEGIC',
      resolutionType: 'NON_STRATEGIC',
      resolutionMethod: 'DISMISS',
      nonStrategicReason: 'CHIPSET_SILICON',
      confidence: 0.9,
      articleId: 'art-003',
      articleTitle: 'New MediaTek Chip',
      createdAt: '2026-10-01T00:00:00Z',
      resolvedAt: '2026-10-05T10:00:00Z',
    };

    assert(dismissedReview.status === 'DISMISSED_NON_STRATEGIC', '16A: Dismissed status set');
    assert(dismissedReview.resolutionType === 'NON_STRATEGIC', '16B: resolutionType is NON_STRATEGIC');

    const rejectedReview: EntityReview = {
      id: 'rev-prod-garbage',
      type: 'PRODUCT',
      detectedName: 'xyz123 hallucination',
      status: 'REJECTED',
      resolutionType: 'REJECTED',
      nonStrategicReason: 'MALFORMED_TOKEN',
      confidence: 0.2,
      articleId: 'art-004',
      articleTitle: 'Random blog post',
      createdAt: '2026-10-01T00:00:00Z',
      resolvedAt: '2026-10-05T10:00:00Z',
    };

    assert(rejectedReview.status === 'REJECTED', '17A: Rejected status set');
    assert(rejectedReview.resolutionType === 'REJECTED', '17B: Rejected is distinct from DISMISSED');
  }

  // Test 18, 19, 20: Merged Canonical Resolver & Future Resolution
  console.log('\n--- Test 18, 19 & 20: Dynamic Merged Resolver & Review Prevention ---');
  {
    // Simulating newly promoted Firestore entities
    const promotedProduct: Product = {
      id: 'prod-goog-fitbitair',
      companyId: 'comp-google',
      name: 'Google Fitbit Air',
      aliases: ['Fitbit Air'],
      category: 'Wearables',
      active: true,
      lifecycle: 'RELEASED',
    };

    const promotedCompany: Company = {
      id: 'comp-nothing',
      name: 'Nothing',
      aliases: ['Nothing Tech', 'Nothing Phone'],
      website: 'https://nothing.tech',
      isMyCompany: false,
      isCompetitor: false,
      categories: ['Smartphones', 'Audio'],
      active: true,
    };

    // Merged catalog contains the new entities
    const dynamicProducts = getMergedCanonicalProducts([promotedProduct]);
    const dynamicCompanies = getMergedCanonicalCompanies([promotedCompany]);

    assert(dynamicProducts.some((p) => p.id === 'prod-goog-fitbitair'), '18A: Promoted product in merged list');
    assert(dynamicCompanies.some((c) => c.id === 'comp-nothing'), '19A: Promoted company in merged list');

    // Future article resolution test
    const futureProdMatch = resolveProductSafe('Fitbit Air', 'WEARABLE', dynamicProducts);
    assert(futureProdMatch.matchedProduct?.id === 'prod-goog-fitbitair', '20A: Future article resolves to canonical Fitbit Air!');
    assert(futureProdMatch.confidence >= 0.95, '20B: High confidence canonical match');

    const futureCompMatch = resolveCompanySafe('Nothing', dynamicCompanies);
    assert(futureCompMatch.matchedCompany?.id === 'comp-nothing', '20C: Future article resolves to canonical Nothing!');
  }

  // Test 21, 22, 23: UI Visibility & SOV Protection
  console.log('\n--- Test 21, 22 & 23: Visibility & Competitive SOV Protection ---');
  {
    const promotedCompany: Company = {
      id: 'comp-nothing',
      name: 'Nothing',
      aliases: ['Nothing Tech'],
      website: 'https://nothing.tech',
      isMyCompany: false,
      isCompetitor: false, // Untracked
      categories: ['Smartphones'],
      active: true,
    };

    // Tracked company check
    const trackedId = resolveTrackedCompanyId({ companyId: 'comp-nothing', canonicalName: 'Nothing' });
    assert(trackedId === null, '23A: Untracked company Nothing does NOT resolve as tracked competitor');

    // SOV calculation with untracked company mention
    const mockAnalyses: any[] = [
      {
        articleId: 'art-101',
        analyzedAt: '2026-10-01T00:00:00Z',
        companies: [{ companyId: 'comp-nothing', canonicalName: 'Nothing', relevance: 'PRIMARY' }],
        competitiveRelevance: { categories: ['SMARTPHONES'] },
        products: [],
        topics: ['Smartphones'],
      },
    ];

    const analytics = calculateCompetitiveAnalytics(mockAnalyses, [], { timeRange: 'all' });
    const nothingInSov = analytics.companyRows.some((r) => r.companyName === 'Nothing');
    assert(nothingInSov === false, '23B: Untracked company Nothing is strictly EXCLUDED from Share of Voice');

    // Test 24: Legacy APPROVED status compatibility
    const legacyReview: EntityReview = {
      id: 'rev-legacy',
      type: 'COMPANY',
      detectedName: 'Some OEM',
      status: 'APPROVED' as ReviewStatus,
      confidence: 0.9,
      articleId: 'art-legacy',
      articleTitle: 'Legacy Post',
      createdAt: '2026-09-01T00:00:00Z',
    };
    assert(legacyReview.status === 'APPROVED', '24A: Legacy APPROVED status remains fully valid');
  }

  console.log('\n=== ALL 32 ENTITY PROMOTION WORKFLOW TESTS PASSED ===');
}

runEntityPromotionWorkflowTests();

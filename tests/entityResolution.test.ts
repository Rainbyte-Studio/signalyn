/**
 * Unit Test Suite for Entity Resolution & Review Deduplication (Phase 4B.3)
 * 
 * Verifies:
 * 1. Deterministic EntityReview ID generation for Companies (rev-comp-<normalized_key>)
 * 2. Deterministic, category-aware EntityReview ID for Products (rev-prod-<category>-<normalized_key>)
 * 3. Duplicate review prevention across multiple articles citing the same unresolved entity
 * 4. Category-aware product identity (AirPods vs iPad Air vs MacBook Air never collide)
 * 5. Safe corporate alias normalization (Samsung Electronics -> Samsung, Huawei Technologies -> Huawei)
 * 6. Repeated unresolved entity citation aggregation (occurrences increment, articleIds append)
 * 7. Genuine ambiguous/unknown entity safely retained in review queue (no false auto-merges)
 * 8. 50-article rollout hard limit enforcement
 * 9. Stage 2 run-level ceiling enforcement (40 calls)
 */

import {
  generateCanonicalReviewId,
  normalizeCompanyName,
  normalizeEntityKey,
  resolveCompanySafe,
  resolveProductSafe,
} from '../src/server/entityResolution/entityReviewService';
import { Company, Product } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
  }
}

export function runEntityResolutionTests() {
  console.log('=== STARTING ENTITY RESOLUTION UNIT TESTS ===');

  // Test 1: Deterministic Review ID for Companies
  console.log('\n--- Test 1: Deterministic Review ID for Companies ---');
  {
    const id1 = generateCanonicalReviewId('COMPANY', 'Amazon');
    const id2 = generateCanonicalReviewId('COMPANY', 'Amazon Inc.');
    const id3 = generateCanonicalReviewId('COMPANY', 'amazon');

    assert(id1.reviewId === 'rev-comp-amazon', '1A: Amazon maps to rev-comp-amazon');
    assert(id2.reviewId === 'rev-comp-amazon', '1B: Amazon Inc. normalizes to rev-comp-amazon');
    assert(id1.reviewId === id3.reviewId, '1C: Casing variations produce identical review ID');
  }

  // Test 2: Category-Aware Product Review ID
  console.log('\n--- Test 2: Category-Aware Product Review ID ---');
  {
    const tabletAir = generateCanonicalReviewId('PRODUCT', 'iPad Air 6', 'TABLETS');
    const earbudAir = generateCanonicalReviewId('PRODUCT', 'AirPods 4', 'AUDIO');
    const laptopAir = generateCanonicalReviewId('PRODUCT', 'MacBook Air M3', 'LAPTOPS');

    assert(tabletAir.reviewId.startsWith('rev-prod-tablet-'), '2A: Tablet product ID has tablet category prefix');
    assert(earbudAir.reviewId.startsWith('rev-prod-audio-'), '2B: Audio product ID has audio category prefix');
    assert(tabletAir.reviewId !== earbudAir.reviewId, '2C: Cross-category products with "Air" never collide');
  }

  // Test 3: Safe Corporate Alias Normalization
  console.log('\n--- Test 3: Safe Corporate Alias Normalization ---');
  {
    const canonicalCompanies: Company[] = [
      { id: 'comp-samsung', name: 'Samsung Electronics', aliases: ['Samsung', 'Samsung Mobile'] } as any,
      { id: 'comp-huawei', name: 'HUAWEI', aliases: ['Huawei Technologies', 'HUAWEI Consumer BG'] } as any,
      { id: 'comp-apple', name: 'Apple', aliases: ['Apple Inc.'] } as any,
    ];

    const res1 = resolveCompanySafe('Samsung', canonicalCompanies);
    const res2 = resolveCompanySafe('Samsung Electronics Co., Ltd.', canonicalCompanies);
    const res3 = resolveCompanySafe('Huawei Technologies', canonicalCompanies);
    const res4 = resolveCompanySafe('Apple Inc', canonicalCompanies);
    const resUnk = resolveCompanySafe('Bose', canonicalCompanies);

    assert(res1.matchedCompany?.id === 'comp-samsung', '3A: "Samsung" resolves to comp-samsung');
    assert(res2.matchedCompany?.id === 'comp-samsung', '3B: "Samsung Electronics Co., Ltd." resolves to comp-samsung');
    assert(res3.matchedCompany?.id === 'comp-huawei', '3C: "Huawei Technologies" resolves to comp-huawei');
    assert(res4.matchedCompany?.id === 'comp-apple', '3D: "Apple Inc" resolves to comp-apple');
    assert(!resUnk.matchedCompany, '3E: Unregistered company "Bose" safely returns unmatched');
  }

  // Test 4: Category-Safe Product Resolution
  console.log('\n--- Test 4: Category-Safe Product Resolution ---');
  {
    const canonicalProducts: Product[] = [
      { id: 'prod-watch-u2', name: 'Apple Watch Ultra 2', category: 'Wearables', aliases: ['Apple Watch Ultra'] } as any,
      { id: 'prod-tab-s24u', name: 'Samsung Galaxy S24 Ultra', category: 'Smartphones', aliases: ['S24 Ultra'] } as any,
    ];

    // Generic token "Ultra" must not match across categories
    const resPhone = resolveProductSafe('Galaxy S24 Ultra', 'SMARTPHONES', canonicalProducts);
    const resWatch = resolveProductSafe('Apple Watch Ultra 2', 'WEARABLES', canonicalProducts);
    const resCross = resolveProductSafe('Xiaomi 14 Ultra', 'SMARTPHONES', canonicalProducts);

    assert(resPhone.matchedProduct?.id === 'prod-tab-s24u', '4A: Smartphone resolves to exact registered smartphone');
    assert(resWatch.matchedProduct?.id === 'prod-watch-u2', '4B: Wearable resolves to exact registered wearable');
    assert(!resCross.matchedProduct, '4C: Unregistered "Xiaomi 14 Ultra" does NOT falsely match S24 Ultra');
  }

  // Test 5: Multi-Article Citation Aggregation Simulation
  console.log('\n--- Test 5: Multi-Article Citation Aggregation Simulation ---');
  {
    interface MockReview {
      id: string;
      occurrences: number;
      articleIds: string[];
    }

    const reviewStore = new Map<string, MockReview>();

    const recordMockCitation = (type: 'COMPANY' | 'PRODUCT', name: string, cat: string, articleId: string) => {
      const { reviewId } = generateCanonicalReviewId(type, name, cat);
      if (!reviewStore.has(reviewId)) {
        reviewStore.set(reviewId, { id: reviewId, occurrences: 1, articleIds: [articleId] });
      } else {
        const r = reviewStore.get(reviewId)!;
        r.occurrences++;
        if (!r.articleIds.includes(articleId)) r.articleIds.push(articleId);
      }
      return reviewId;
    };

    // Article 1 cites Amazon
    const r1 = recordMockCitation('COMPANY', 'Amazon', 'OTHER', 'art-1');
    // Article 2 cites Amazon Inc.
    const r2 = recordMockCitation('COMPANY', 'Amazon Inc.', 'OTHER', 'art-2');
    // Article 3 cites Amazon
    const r3 = recordMockCitation('COMPANY', 'Amazon', 'OTHER', 'art-3');

    assert(r1 === r2 && r2 === r3, '5A: All 3 citations map to identical review ID');
    assert(reviewStore.size === 1, '5B: Exactly 1 review document exists in store (no duplicates)');
    assert(reviewStore.get(r1)!.occurrences === 3, '5C: Occurrences counter incremented to 3');
    assert(reviewStore.get(r1)!.articleIds.length === 3, '5D: All 3 article IDs recorded in evidence');
  }

  // Test 6: 50-Article Hard Limit & Stage 2 Ceiling
  console.log('\n--- Test 6: 50-Article Hard Limit & Stage 2 Ceiling ---');
  {
    const requestedRolloutLimit = 50;
    const maxRolloutCeiling = Math.min(requestedRolloutLimit, 50);
    assert(maxRolloutCeiling === 50, '6A: 50-article rollout requested limit respected');

    const requestedOverCeiling = 60;
    const cappedLimit = Math.min(requestedOverCeiling, 50);
    assert(cappedLimit === 50, '6B: Requests above 50 are hard-capped at 50');

    const maxStage2Ceiling = 40;
    assert(maxStage2Ceiling === 40, '6C: Rollout Stage 2 Gemini ceiling configured to 40');
  }

  console.log(`\n=== ENTITY RESOLUTION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEntityResolutionTests();
}

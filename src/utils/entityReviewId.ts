/**
 * Signalyn Canonical Entity Review ID Generator
 * 
 * Generates deterministic, category-aware review ID:
 * - COMPANY: rev-comp-<normalized_company_key>
 * - PRODUCT: rev-prod-<canonical_category>-<normalized_product_key>
 */

import { normalizeDeviceCategory } from './categoryModel';
import { normalizeCompanyName, normalizeEntityKey } from '../services/canonicalEntities';

export function generateCanonicalReviewId(
  entityType: 'COMPANY' | 'PRODUCT',
  rawName: string,
  rawCategory?: string
): { reviewId: string; normalizedKey: string; canonicalCategory: string } {
  if (entityType === 'COMPANY') {
    const normalizedKey = normalizeCompanyName(rawName) || normalizeEntityKey(rawName);
    return {
      reviewId: `rev-comp-${normalizedKey}`,
      normalizedKey,
      canonicalCategory: 'OTHER',
    };
  }

  const canonicalCategory = normalizeDeviceCategory(rawCategory || 'OTHER');
  const normalizedKey = normalizeEntityKey(rawName);
  const catSlug = canonicalCategory.toLowerCase().replace(/[^a-z0-9]/g, '');

  return {
    reviewId: `rev-prod-${catSlug}-${normalizedKey}`,
    normalizedKey,
    canonicalCategory,
  };
}

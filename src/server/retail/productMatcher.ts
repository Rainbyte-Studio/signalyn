/**
 * Signalyn Retail Price Intelligence - Canonical Product Matching Engine
 * 
 * Rules:
 * 1. EAN / GTIN exact equality yields EXACT match.
 * 2. MPN (Manufacturer Part Number) equality yields EXACT match.
 * 3. Never merge different storage capacities (e.g. 128GB vs 256GB vs 512GB).
 * 4. Never merge different connectivity variants (e.g. Wi-Fi vs 4G/5G/LTE/Cellular).
 * 5. Never merge different generations or models (e.g. Pura 70 vs Pura 70 Pro vs Pura 70 Ultra; Watch GT 4 vs GT 5).
 * 6. Match confidence tiers:
 *    - EXACT (1.0)
 *    - HIGH_CONFIDENCE (>= 0.85)
 *    - NEEDS_REVIEW (0.50 - 0.84)
 *    - UNMATCHED (< 0.50)
 */

import { RetailProduct, MatchConfidenceLevel } from '../../types/retailPrice';
import { normalizeBrand, isSameBrand, getCanonicalBrandDisplayName } from './brandNormalizer';
import { normalizeProductTitleForMatching } from './productDeduplicationService';

export interface MatchResult {
  productId?: string;
  confidence: MatchConfidenceLevel;
  confidenceScore: number;
  reasons: string[];
  conflictDetected?: boolean;
}

export interface CandidateOfferInput {
  title: string;
  brand: string;
  ean?: string;
  mpn?: string;
  model?: string;
  storage?: string;
  color?: string;
  url?: string;
}

export function matchOfferToCatalog(
  offer: CandidateOfferInput,
  catalog: RetailProduct[]
): MatchResult {
  // 1. EAN / GTIN Match Check
  if (offer.ean) {
    const cleanEan = offer.ean.replace(/[^0-9]/g, '');
    if (cleanEan.length >= 8) {
      const eanMatch = catalog.find((p) => p.ean && p.ean.replace(/[^0-9]/g, '') === cleanEan);
      if (eanMatch) {
        return {
          productId: eanMatch.id,
          confidence: 'EXACT',
          confidenceScore: 1.0,
          reasons: [`Direct EAN/GTIN barcode match: ${offer.ean}`],
        };
      }
    }
  }

  // 2. MPN Match Check
  if (offer.mpn) {
    const cleanMpn = offer.mpn.trim().toLowerCase();
    const mpnMatch = catalog.find((p) => p.mpn && p.mpn.trim().toLowerCase() === cleanMpn);
    if (mpnMatch) {
      return {
        productId: mpnMatch.id,
        confidence: 'EXACT',
        confidenceScore: 1.0,
        reasons: [`Direct Manufacturer Part Number match: ${offer.mpn}`],
      };
    }
  }

  // 3. Multi-Attribute Scoring
  let bestProduct: RetailProduct | null = null;
  let highestScore = 0;
  let bestReasons: string[] = [];

  const offerBrandNorm = normalizeBrand(offer.brand || extractBrand(offer.title)).id;
  const offerTitleNorm = offer.title.toLowerCase();
  const offerTitleNormalized = normalizeProductTitleForMatching(offer.title);

  for (const product of catalog) {
    const reasons: string[] = [];
    const prodBrandNorm = normalizeBrand(product.brand).id;

    // Brand Check: Must match canonical brand ID or title must contain canonical brand name
    if (offerBrandNorm !== prodBrandNorm && !offerTitleNorm.includes(prodBrandNorm)) {
      continue; // Completely different brand
    }
    reasons.push(`Brand matched: ${getCanonicalBrandDisplayName(product.brand)}`);

    // Strict Model Family Check
    const prodTitleNormalized = normalizeProductTitleForMatching(product.name);
    const modelFamilyNorm = normalizeProductTitleForMatching(product.modelFamily);
    const modelTokens = modelFamilyNorm.split(/\s+/).filter((t) => t.length > 1 && !['smartphone', 'smartphones', 'smartwatch', 'tablet', 'tablets', 'bluetooth'].includes(t));
    const hasAllModelTokens = modelTokens.every((token) => offerTitleNormalized.includes(token));

    if (!hasAllModelTokens) {
      // Check if candidate model string matches
      if (!offer.model || !normalizeProductTitleForMatching(offer.model).includes(modelFamilyNorm)) {
        continue; // Model family does not match
      }
    }
    reasons.push(`Model family matched: ${product.modelFamily}`);

    // Strict Standard vs ANC Version Guard: Standard and ANC versions must NEVER be merged!
    const prodHasAnc = /\b(anc|active noise cancellation|active noise cancelling)\b/i.test(product.name);
    const offerHasAnc = /\b(anc|active noise cancellation|active noise cancelling)\b/i.test(offer.title);
    if (prodHasAnc !== offerHasAnc) {
      continue; // Distinct variant: Standard vs ANC
    }

    // Model Suffix Guard (prevent Pura 70 matching Pura 70 Pro or Pura 70 Ultra, iPhone Pro matching Pro Max, etc.)
    const suffixGuards = [
      /\bpro\b/i,
      /\bultra\b/i,
      /\bplus\b|\b\+\b/i,
      /\bmini\b/i,
      /\bmax\b/i,
      /\blite\b/i,
      /\bfe\b/i,
      /\bfold\b/i,
      /\bflip\b/i,
    ];

    let suffixConflict = false;
    for (const rx of suffixGuards) {
      if (rx.test(product.name) !== rx.test(offer.title)) {
        suffixConflict = true;
        break;
      }
    }
    if (suffixConflict) {
      continue;
    }

    // Watch Case Size Guard (e.g., 40mm vs 44mm vs 46mm)
    const prodMm = product.name.match(/\b(38|40|41|42|44|45|46|47|49|51)\s*mm\b/i)?.[1];
    const offerMm = offer.title.match(/\b(38|40|41|42|44|45|46|47|49|51)\s*mm\b/i)?.[1];
    if (prodMm && offerMm && prodMm !== offerMm) {
      continue;
    }

    // Watch Band Size Guard (e.g., S/M vs M/L)
    const prodBand = product.name.match(/\b(s\/m|m\/l)\b/i)?.[1]?.toLowerCase();
    const offerBand = offer.title.match(/\b(s\/m|m\/l)\b/i)?.[1]?.toLowerCase();
    if (prodBand && offerBand && prodBand !== offerBand) {
      continue;
    }

    // RAM Guard when both specify RAM/Storage (e.g., 4GB/128GB vs 8GB/128GB)
    const prodRam = extractRam(product.name);
    const offerRam = extractRam(offer.title);
    if (prodRam && offerRam && prodRam !== offerRam) {
      continue;
    }

    // STRICT NON-MERGE: Storage Capacity Check
    let storageScore = 0.2;
    if (product.storage && product.storage !== 'N/A') {
      const prodStorageNorm = product.storage.toLowerCase().replace(/\s+/g, ''); // "512gb"
      const detectedOfferStorage =
        extractStorage(offer.title) ||
        (offer.storage ? offer.storage.toLowerCase().replace(/\s+/g, '') : null) ||
        (offer.url ? extractStorage(offer.url) : null);

      if (detectedOfferStorage) {
        if (detectedOfferStorage !== prodStorageNorm) {
          // CONFLICT! Never merge different storage capacities!
          continue;
        }
        storageScore = 0.25;
        reasons.push(`Storage matched: ${product.storage}`);
      } else {
        // Storage is unspecified in offer title
        storageScore = 0.05;
        reasons.push('Storage unspecified in offer title');
      }
    }

    // STRICT NON-MERGE: Connectivity Check (Wi-Fi vs Cellular / LTE / 5G)
    let connectivityScore = 0.15;
    if (product.connectivity) {
      const isOfferCellular = /\b(lte|4g|5g|cellular|gps\+cellular)\b/i.test(offer.title);
      const isOfferWifiOnly = /\b(wi-fi|wifi)\b/i.test(offer.title);

      if (product.connectivity === 'Wi-Fi' && isOfferCellular) {
        continue; // Conflict: Wi-Fi model cannot match Cellular offer
      }
      if ((product.connectivity === '5G' || product.connectivity === '4G') && isOfferWifiOnly) {
        continue; // Conflict: 5G/4G model cannot match Wi-Fi only offer
      }
      connectivityScore = 0.15;
      reasons.push(`Connectivity compatible: ${product.connectivity}`);
    }

    // Color Check
    let colorScore = 0.1;
    if (product.color) {
      const prodColorNorm = product.color.toLowerCase();
      if (offerTitleNorm.includes(prodColorNorm)) {
        colorScore = 0.15;
        reasons.push(`Color matched: ${product.color}`);
      } else {
        colorScore = 0.05; // Non-fatal if color isn't mentioned
      }
    }

    // Baseline base score for brand + model family match
    const baseScore = 0.45;
    const totalScore = Math.min(1.0, baseScore + storageScore + connectivityScore + colorScore);

    if (totalScore > highestScore) {
      highestScore = totalScore;
      bestProduct = product;
      bestReasons = reasons;
    }
  }

  if (!bestProduct || highestScore < 0.50) {
    return {
      confidence: 'UNMATCHED',
      confidenceScore: highestScore,
      reasons: ['No catalog product passed brand, model family, and variant compatibility checks.'],
    };
  }

  if (highestScore >= 0.85) {
    return {
      productId: bestProduct.id,
      confidence: 'HIGH_CONFIDENCE',
      confidenceScore: highestScore,
      reasons: bestReasons,
    };
  }

  return {
    productId: bestProduct.id,
    confidence: 'NEEDS_REVIEW',
    confidenceScore: highestScore,
    reasons: bestReasons,
  };
}

function extractBrand(title: string): string {
  const brands = ['HUAWEI', 'Apple', 'Samsung', 'Xiaomi', 'Honor', 'Garmin', 'Sony', 'Bose', 'Lenovo', 'Nothing'];
  for (const b of brands) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(title)) return b;
  }
  return '';
}

function extractRam(title: string): string | null {
  const combo = title.match(/\b(2|3|4|6|8|12|16|24)\s*gb\s*\/\s*(?:32|64|128|256|512|1024)\s*gb\b/i);
  if (combo) return `${combo[1]}gb`;
  return null;
}

function extractStorage(title: string): string | null {
  const combo = title.match(/\b(?:2|3|4|6|8|12|16|24)\s*(?:gb)?\s*\/\s*(32|64|128|256|512)\s*(gb)\b/i);
  if (combo) return `${combo[1].toLowerCase()}${combo[2].toLowerCase()}`;
  const match = title.match(/\b(64|128|256|512)\s*(gb|tb)\b|\b(1|2)\s*(tb)\b/i);
  if (!match) return null;
  return match[0].toLowerCase().replace(/\s+/g, '');
}

/**
 * Signalyn Voice of Customer — Phase 4 Conservative Canonical Product Matcher
 *
 * Matches customer complaint reports to canonical `retailProducts` in strict read-only mode.
 *
 * Governance Rules:
 * - Never modify canonical `retailProducts` records.
 * - Never associate a complaint with a specific device solely because the manufacturer matches.
 * - Strictly enforce generation and variant boundaries (Pro, Ultra, Max, Plus, Lite, SE, FE, Mini, 11.5S, etc.).
 */

import { RetailProduct } from '../../types/retailPrice';
import { VocProductMatch, VocProductMatchConfidence } from '../../types/vocIntelligence';
import { normalizeBilingualText } from './vocTaxonomyClassifier';

export const VOC_PRODUCT_MATCHER_VERSION = 'VOC-P1.0-matcher-v1';

const VARIANT_MODIFIER_TOKENS = new Set([
  'pro',
  'ultra',
  'max',
  'plus',
  'lite',
  'se',
  'fe',
  'mini',
  'air',
  'fold',
  'flip',
  'ultimate',
  'classic',
  'active',
  'fit',
  'gt',
  'paper',
  'papermatte',
]);

const STORAGE_OR_COLOR_NOISE_TOKENS = new Set([
  'huawei',
  'apple',
  'samsung',
  'xiaomi',
  'honor',
  'garmin',
  'sony',
  'bose',
  'lenovo',
  'nothing',
  'phone',
  'smartphone',
  'tablet',
  'smartwatch',
  'earbuds',
  'headphones',
  'ακουστικα',
  'bluetooth',
  'true',
  'wireless',
  'in-ear',
  'dual',
  'sim',
  'ds',
  'edition',
  'series',
  'space',
  'smart',
  'keyboard',
  'us',
  'with',
  '2024',
  '2025',
  '2026',
  '64gb',
  '128gb',
  '256gb',
  '512gb',
  '1tb',
  '2tb',
  '8gb',
  '12gb',
  '16gb',
  '4gb',
  'black',
  'white',
  'silver',
  'gold',
  'green',
  'blue',
  'purple',
  'grey',
  'gray',
  'titanium',
  'pink',
  'brown',
  'ceramic',
  'beige',
  'yellow',
  'milanese',
  'frost',
  'ocean',
  'cyan',
  'natural',
  'titan',
  'fluoroelastomer',
  'leather',
  'woven',
  'strap',
  'wifi',
  'wi-fi',
  '5g',
  '4g',
  'lte',
]);

const KNOWN_MANUFACTURERS: { canonical: string; aliases: string[] }[] = [
  { canonical: 'Huawei', aliases: ['huawei', 'χουαβει', 'emui', 'harmonyos', 'pura', 'matepad', 'matebook', 'freebuds', 'freeclip', 'watch gt', 'watch fit', 'watch ultimate'] },
  { canonical: 'Apple', aliases: ['apple', 'iphone', 'ipad', 'macbook', 'airpods', 'apple watch'] },
  { canonical: 'Samsung', aliases: ['samsung', 'galaxy', 'one ui', 'z fold', 'z flip'] },
  { canonical: 'Xiaomi', aliases: ['xiaomi', 'redmi', 'poco', 'hyperos'] },
  { canonical: 'Honor', aliases: ['honor', 'magic6', 'magic5', 'magic v'] },
  { canonical: 'Garmin', aliases: ['garmin', 'fenix', 'forerunner', 'venu'] },
  { canonical: 'Sony', aliases: ['sony', 'xperia', 'wh-1000xm', 'wf-1000xm'] },
];

export function detectManufacturerFromText(
  text: string,
  manufacturerHint?: string
): string | null {
  const norm = normalizeBilingualText(text);

  for (const m of KNOWN_MANUFACTURERS) {
    for (const alias of m.aliases) {
      const regex = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (regex.test(norm)) {
        return m.canonical;
      }
    }
  }

  if (manufacturerHint && manufacturerHint.trim()) {
    const normHint = normalizeBilingualText(manufacturerHint);
    const found = KNOWN_MANUFACTURERS.find(
      (m) => m.canonical.toLowerCase() === normHint || m.aliases.includes(normHint)
    );
    return found ? found.canonical : manufacturerHint.trim();
  }

  return null;
}

/**
 * Extracts normalized core model tokens from a canonical product's modelFamily / name.
 */
function extractProductSignature(product: RetailProduct): {
  brandNormalized: string;
  coreModelPhrase: string;
  allModelTokens: string[];
  nonVariantTokens: string[];
  variantTokens: string[];
  generationTokens: string[];
  sizeTokens: string[];
} {
  const brandNormalized = normalizeBilingualText(product.brand);
  const rawBase = normalizeBilingualText(product.modelFamily || product.name)
    .replace(new RegExp(`^${brandNormalized}\\s+`, 'i'), '')
    .replace(/\b(?:wi-fi|wifi)\b/g, ' ')
    .replace(/[^\w.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = rawBase
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STORAGE_OR_COLOR_NOISE_TOKENS.has(t));

  const variantTokens: string[] = [];
  const nonVariantTokens: string[] = [];
  const generationTokens: string[] = [];
  const sizeTokens: string[] = [];

  for (const token of rawTokens) {
    if (/^\d{2}mm$/i.test(token)) {
      sizeTokens.push(token);
      continue;
    }
    // Tokens like 11.5s, 5i, 6i, a2, se, pro, ultra
    if (VARIANT_MODIFIER_TOKENS.has(token)) {
      variantTokens.push(token);
    } else if (/^\d+(?:\.\d+)?s$/i.test(token)) {
      variantTokens.push(token);
      generationTokens.push(token);
    } else {
      nonVariantTokens.push(token);
      if (/\d/.test(token)) {
        generationTokens.push(token);
      }
    }
  }

  return {
    brandNormalized,
    coreModelPhrase: rawTokens.join(' '),
    allModelTokens: rawTokens,
    nonVariantTokens,
    variantTokens,
    generationTokens,
    sizeTokens,
  };
}

function hasWholeToken(normalizedText: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9.])${escaped}([^a-z0-9.]|$)`, 'i');
  return re.test(normalizedText);
}

/**
 * Conservatively matches a customer report text to the canonical `retailProducts` catalog.
 * Read-only: never mutates `canonicalProducts`.
 */
export function matchVocReportToCanonicalProduct(params: {
  reportId: string;
  text: string;
  manufacturerHint?: string;
  canonicalProducts: ReadonlyArray<RetailProduct>;
}): VocProductMatch {
  const { reportId, text, manufacturerHint, canonicalProducts } = params;
  const normalizedText = normalizeBilingualText(text);
  const nowIso = new Date().toISOString();

  const detectedManufacturer = detectManufacturerFromText(text, manufacturerHint);

  if (!detectedManufacturer) {
    return {
      id: `voc-match-${reportId}-unmatched`,
      reportId,
      canonicalProductId: null,
      canonicalProductName: null,
      manufacturer: manufacturerHint || 'Unknown',
      detectedModelText: '',
      confidence: 'UNMATCHED',
      confidenceScore: 0,
      matchedTokens: [],
      missingVariantTokens: [],
      candidateProductIds: [],
      candidateProductNames: [],
      matchRationale: 'No manufacturer or recognizable hardware model family detected in report text.',
      manufacturerOnlyRejected: false,
      matchedAt: nowIso,
      matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
    };
  }

  // Filter catalog products to the detected manufacturer (read-only)
  const brandNorm = normalizeBilingualText(detectedManufacturer);
  const brandCatalog = canonicalProducts.filter(
    (p) => normalizeBilingualText(p.brand) === brandNorm
  );

  // Evaluate each canonical product signature against the report text
  interface EvaluatedCandidate {
    product: RetailProduct;
    sig: ReturnType<typeof extractProductSignature>;
    matchedCoreTokens: string[];
    matchedVariantTokens: string[];
    missingVariantTokens: string[];
    conflictingTextVariants: string[];
    hasAllNonVariantTokens: boolean;
    hasGenerationMatch: boolean;
    exactSizeMatch: boolean;
    exactStorageMatch: boolean;
  }

  // Detect any global variant modifiers present in the complaint text
  const textVariantModifiers = Array.from(VARIANT_MODIFIER_TOKENS).filter((vt) =>
    hasWholeToken(normalizedText, vt)
  );
  // Check for "11.5s" vs "11.5" in text
  const textHas11_5s = hasWholeToken(normalizedText, '11.5s');

  const evaluated: EvaluatedCandidate[] = [];

  for (const product of brandCatalog) {
    const sig = extractProductSignature(product);
    if (sig.allModelTokens.length === 0) continue;

    // Special check for 11.5 vs 11.5s
    if (sig.allModelTokens.includes('11.5') && textHas11_5s) {
      continue;
    }
    if (sig.variantTokens.includes('11.5s') && !textHas11_5s) {
      continue;
    }

    const matchedNonVariant = sig.nonVariantTokens.filter((t) => hasWholeToken(normalizedText, t));
    const matchedVariants = sig.variantTokens.filter((t) => hasWholeToken(normalizedText, t));
    const missingVariants = sig.variantTokens.filter((t) => !hasWholeToken(normalizedText, t));

    const hasAllNonVariantTokens =
      sig.nonVariantTokens.length > 0
        ? matchedNonVariant.length === sig.nonVariantTokens.length
        : matchedVariants.length > 0;

    // Require at least one non-generic family/generation token match
    if (!hasAllNonVariantTokens && matchedNonVariant.length === 0) {
      continue;
    }

    const hasGenerationMatch =
      sig.generationTokens.length === 0 ||
      sig.generationTokens.every((gt) => hasWholeToken(normalizedText, gt));

    // Check if the complaint text contains a variant modifier (like "ultra" or "pro") that this product does NOT have
    const conflictingTextVariants = textVariantModifiers.filter(
      (tv) => !sig.variantTokens.includes(tv) && !sig.nonVariantTokens.includes(tv)
    );

    const exactSizeMatch =
      sig.sizeTokens.length > 0 && sig.sizeTokens.some((st) => hasWholeToken(normalizedText, st));
    const exactStorageMatch = Boolean(
      product.storage && hasWholeToken(normalizedText, normalizeBilingualText(product.storage))
    );

    evaluated.push({
      product,
      sig,
      matchedCoreTokens: [...matchedNonVariant, ...matchedVariants],
      matchedVariantTokens: matchedVariants,
      missingVariantTokens: missingVariants,
      conflictingTextVariants,
      hasAllNonVariantTokens,
      hasGenerationMatch,
      exactSizeMatch,
      exactStorageMatch,
    });
  }

  // Case 1: Only manufacturer was mentioned (no model family or generation matched)
  if (evaluated.length === 0) {
    // Check if user mentioned a generic family word without generation (e.g., "MatePad", "FreeBuds", "Watch GT", "iPhone", "Galaxy")
    const genericFamilyWords = ['pura', 'mate', 'nova', 'matepad', 'matebook', 'freebuds', 'watch', 'iphone', 'ipad', 'macbook', 'galaxy', 'redmi', 'poco'];
    const mentionedFamily = genericFamilyWords.find((fw) => hasWholeToken(normalizedText, fw));

    if (mentionedFamily) {
      const familyProducts = brandCatalog.filter((p) =>
        normalizeBilingualText(`${p.modelFamily} ${p.name}`).includes(mentionedFamily)
      );
      if (familyProducts.length > 1) {
        return {
          id: `voc-match-${reportId}-ambiguous-family`,
          reportId,
          canonicalProductId: null,
          canonicalProductName: null,
          manufacturer: detectedManufacturer,
          detectedModelText: `${detectedManufacturer} ${mentionedFamily.toUpperCase()} (unspecified generation)`,
          confidence: 'AMBIGUOUS_REVIEW',
          confidenceScore: 0.4,
          matchedTokens: [mentionedFamily],
          missingVariantTokens: ['generation_number'],
          candidateProductIds: familyProducts.slice(0, 6).map((p) => p.id),
          candidateProductNames: familyProducts.slice(0, 6).map((p) => p.name),
          matchRationale: `Report mentions product family "${mentionedFamily}" without a specific generation or model number across ${familyProducts.length} canonical catalog products.`,
          manufacturerOnlyRejected: false,
          matchedAt: nowIso,
          matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
        };
      }
    }

    return {
      id: `voc-match-${reportId}-unmatched`,
      reportId,
      canonicalProductId: null,
      canonicalProductName: null,
      manufacturer: detectedManufacturer,
      detectedModelText: detectedManufacturer,
      confidence: 'UNMATCHED',
      confidenceScore: 0,
      matchedTokens: [detectedManufacturer.toLowerCase()],
      missingVariantTokens: ['model_family', 'generation'],
      candidateProductIds: [],
      candidateProductNames: [],
      matchRationale: `Rejected manufacturer-only association: report mentions "${detectedManufacturer}" without verifiable model family, generation, or variant evidence.`,
      manufacturerOnlyRejected: true,
      matchedAt: nowIso,
      matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
    };
  }

  // Filter to candidates that matched all non-variant tokens and generation tokens
  const strongGenerationCandidates = evaluated.filter(
    (c) => c.hasAllNonVariantTokens && c.hasGenerationMatch
  );

  if (strongGenerationCandidates.length === 0) {
    // Partial family match without full generation agreement -> AMBIGUOUS_REVIEW
    const topPartial = evaluated.slice(0, 5);
    return {
      id: `voc-match-${reportId}-ambiguous`,
      reportId,
      canonicalProductId: null,
      canonicalProductName: null,
      manufacturer: detectedManufacturer,
      detectedModelText: topPartial[0]. matchedCoreTokens.join(' '),
      confidence: 'AMBIGUOUS_REVIEW',
      confidenceScore: 0.45,
      matchedTokens: topPartial[0].matchedCoreTokens,
      missingVariantTokens: topPartial[0].missingVariantTokens,
      candidateProductIds: topPartial.map((c) => c.product.id),
      candidateProductNames: topPartial.map((c) => c.product.name),
      matchRationale: `Partial model token match (${topPartial[0].matchedCoreTokens.join(' ')}) without complete generation or variant disambiguation.`,
      manufacturerOnlyRejected: false,
      matchedAt: nowIso,
      matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
    };
  }

  // Among strong generation candidates, look for exact variant agreement:
  // missingVariantTokens.length === 0 AND conflictingTextVariants.length === 0
  const exactVariantCandidates = strongGenerationCandidates.filter(
    (c) => c.missingVariantTokens.length === 0 && c.conflictingTextVariants.length === 0
  );

  // Also check if there are sibling variants in strongGenerationCandidates that have EXTRA variant tokens
  // (e.g. user said "Huawei Pura 70", which has 0 missingVariantTokens for base "Pura 70",
  // while "Pura 70 Pro" and "Pura 70 Ultra" have missingVariantTokens: ['pro'] / ['ultra'])
  const siblingHigherTierVariants = strongGenerationCandidates.filter(
    (c) => c.missingVariantTokens.length > 0 && c.conflictingTextVariants.length === 0
  );

  const explicitBaseWordInText = /\b(?:base|standard|vanilla|απλο|βασικο)\b/i.test(normalizedText);

  if (exactVariantCandidates.length > 0) {
    // Prefer exact storage or size match if user specified it
    exactVariantCandidates.sort((a, b) => {
      if (a.exactStorageMatch !== b.exactStorageMatch) return a.exactStorageMatch ? -1 : 1;
      if (a.exactSizeMatch !== b.exactSizeMatch) return a.exactSizeMatch ? -1 : 1;
      return b.matchedVariantTokens.length - a.matchedVariantTokens.length;
    });

    const best = exactVariantCandidates[0];
    const hasExplicitVariantToken = best.matchedVariantTokens.length > 0;

    // Distinct model families among exactVariantCandidates
    const distinctModelFamilies = Array.from(
      new Set(
        exactVariantCandidates.map((c) =>
          normalizeBilingualText(c.product.modelFamily || c.sig.coreModelPhrase)
        )
      )
    );

    // If user specified an explicit variant token (e.g. "Pura 70 Ultra", "Pura 70 Pro", "MatePad 11.5S", "Watch GT 5 Pro", "FreeBuds Pro 3")
    // OR there are no sibling Pro/Ultra variants in the catalog for that generation
    // OR user explicitly wrote "base"/"standard"
    if (
      hasExplicitVariantToken ||
      siblingHigherTierVariants.length === 0 ||
      explicitBaseWordInText
    ) {
      // Check if watch sizes (e.g., 41mm vs 46mm) are different canonical modelFamilies when user didn't specify size
      if (
        distinctModelFamilies.length > 1 &&
        !best.exactSizeMatch &&
        exactVariantCandidates.some((c) => c.sig.sizeTokens.length > 0)
      ) {
        return {
          id: `voc-match-${reportId}-${best.product.id}`,
          reportId,
          canonicalProductId: best.product.id,
          canonicalProductName: best.product.name,
          manufacturer: detectedManufacturer,
          detectedModelText: best.product.modelFamily || best.sig.coreModelPhrase,
          detectedGenerationOrVariant: best.matchedVariantTokens.join(' ') || 'Standard',
          confidence: 'LIKELY_MODEL',
          confidenceScore: 0.82,
          matchedTokens: best.matchedCoreTokens,
          missingVariantTokens: ['case_size_mm'],
          candidateProductIds: exactVariantCandidates.map((c) => c.product.id),
          candidateProductNames: exactVariantCandidates.map((c) => c.product.name),
          matchRationale: `Matched ${detectedManufacturer} ${best.product.modelFamily} with exact generation and variant, but casing size (${exactVariantCandidates.map((c) => c.sig.sizeTokens.join('/')).filter(Boolean).join(' vs ')}) was not specified in text.`,
          manufacturerOnlyRejected: false,
          matchedAt: nowIso,
          matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
        };
      }

      return {
        id: `voc-match-${reportId}-${best.product.id}`,
        reportId,
        canonicalProductId: best.product.id,
        canonicalProductName: best.product.name,
        manufacturer: detectedManufacturer,
        detectedModelText: best.product.modelFamily || best.sig.coreModelPhrase,
        detectedGenerationOrVariant: best.matchedVariantTokens.join(' ') || 'Base',
        confidence: 'VERIFIED_MODEL',
        confidenceScore: 0.96,
        matchedTokens: best.matchedCoreTokens,
        missingVariantTokens: [],
        candidateProductIds: exactVariantCandidates.map((c) => c.product.id),
        candidateProductNames: exactVariantCandidates.map((c) => c.product.name),
        matchRationale: `Verified exact manufacturer (${detectedManufacturer}), model family (${best.product.modelFamily}), generation, and variant tokens (${best.matchedCoreTokens.join(' ')}).`,
        manufacturerOnlyRejected: false,
        matchedAt: nowIso,
        matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
      };
    }

    // Otherwise, user wrote a base series name (e.g., "Huawei Pura 70" or "iPhone 16") without "Pro"/"Ultra" AND without "base",
    // while Pro/Ultra siblings also exist in the catalog. Classify conservatively as LIKELY_MODEL on the base SKU.
    const allSeriesCandidates = [...exactVariantCandidates, ...siblingHigherTierVariants];
    return {
      id: `voc-match-${reportId}-${best.product.id}`,
      reportId,
      canonicalProductId: best.product.id,
      canonicalProductName: best.product.name,
      manufacturer: detectedManufacturer,
      detectedModelText: best.product.modelFamily || best.sig.coreModelPhrase,
      detectedGenerationOrVariant: 'Base / Unqualified Series Mention',
      confidence: 'LIKELY_MODEL',
      confidenceScore: 0.78,
      matchedTokens: best.matchedCoreTokens,
      missingVariantTokens: [],
      candidateProductIds: allSeriesCandidates.slice(0, 6).map((c) => c.product.id),
      candidateProductNames: allSeriesCandidates.slice(0, 6).map((c) => c.product.name),
      matchRationale: `Matched base model ${best.product.name}, but report did not explicitly disambiguate against higher-tier series siblings (${siblingHigherTierVariants.slice(0, 3).map((s) => s.product.modelFamily).join(', ')}). Capped at LIKELY_MODEL.`,
      manufacturerOnlyRejected: false,
      matchedAt: nowIso,
      matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
    };
  }

  // Case where user wrote a series name (e.g., "Mate 50") where ONLY a "Pro" variant exists in the catalog, or multiple variants exist without a base SKU
  if (siblingHigherTierVariants.length === 1) {
    const onlyVariant = siblingHigherTierVariants[0];
    return {
      id: `voc-match-${reportId}-${onlyVariant.product.id}`,
      reportId,
      canonicalProductId: onlyVariant.product.id,
      canonicalProductName: onlyVariant.product.name,
      manufacturer: detectedManufacturer,
      detectedModelText: onlyVariant.matchedCoreTokens.join(' '),
      detectedGenerationOrVariant: onlyVariant.sig.variantTokens.join(' '),
      confidence: 'LIKELY_MODEL',
      confidenceScore: 0.74,
      matchedTokens: onlyVariant.matchedCoreTokens,
      missingVariantTokens: onlyVariant.missingVariantTokens,
      candidateProductIds: [onlyVariant.product.id],
      candidateProductNames: [onlyVariant.product.name],
      matchRationale: `Matched ${detectedManufacturer} generation (${onlyVariant.matchedCoreTokens.join(' ')}), but variant modifier (${onlyVariant.missingVariantTokens.join(', ')}) was omitted in report text.`,
      manufacturerOnlyRejected: false,
      matchedAt: nowIso,
      matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
    };
  }

  return {
    id: `voc-match-${reportId}-ambiguous-variants`,
    reportId,
    canonicalProductId: null,
    canonicalProductName: null,
    manufacturer: detectedManufacturer,
    detectedModelText: strongGenerationCandidates[0].matchedCoreTokens.join(' '),
    confidence: 'AMBIGUOUS_REVIEW',
    confidenceScore: 0.5,
    matchedTokens: strongGenerationCandidates[0].matchedCoreTokens,
    missingVariantTokens: Array.from(
      new Set(strongGenerationCandidates.flatMap((c) => c.missingVariantTokens))
    ),
    candidateProductIds: strongGenerationCandidates.slice(0, 6).map((c) => c.product.id),
    candidateProductNames: strongGenerationCandidates.slice(0, 6).map((c) => c.product.name),
    matchRationale: `Ambiguous variant mention: matches ${strongGenerationCandidates.length} distinct variants (${strongGenerationCandidates.slice(0, 4).map((c) => c.product.modelFamily).join(', ')}) without variant disambiguation.`,
    manufacturerOnlyRejected: false,
    matchedAt: nowIso,
    matcherVersion: VOC_PRODUCT_MATCHER_VERSION,
  };
}

/**
 * Signalyn Retail Price Intelligence - Centralized Brand Normalizer
 * 
 * Objectives:
 * 1. Eliminate duplicate brand entries in catalog and UI filters.
 * 2. Case-insensitive, whitespace-insensitive, punctuation-insensitive, and alias-aware canonical brand resolution.
 * 3. Stable canonical brand identifiers (e.g. "apple", "cellular-line", "huawei").
 * 4. Preservation of original retailer-provided brand strings for provenance.
 * 5. Deterministic title-casing fallback for new or unknown brands.
 * 6. Prevention of duplicate brands during future discovery runs across Plaisio, Public, and Kotsovolos.
 */

export interface CanonicalBrandDefinition {
  id: string; // e.g. "apple", "cellular-line", "huawei"
  displayName: string; // e.g. "Apple", "Cellular Line", "Huawei"
  aliases: string[]; // Known aliases, casing variations, or common retailer spellings
}

export interface CanonicalBrandInfo {
  id: string;
  displayName: string;
  rawBrand: string;
}

export interface BrandDuplicateGroup {
  canonicalId: string;
  canonicalDisplayName: string;
  observedVariations: string[];
  totalProducts: number;
}

export interface BrandAuditReport {
  totalUniqueRawBrands: number;
  totalCanonicalBrands: number;
  duplicateGroupCount: number;
  duplicateGroups: BrandDuplicateGroup[];
  allCanonicalBrandsSorted: string[];
}

/**
 * Authoritative Canonical Brand Registry
 */
const KNOWN_CANONICAL_BRANDS: CanonicalBrandDefinition[] = [
  { id: 'apple', displayName: 'Apple', aliases: ['apple', 'apple inc', 'apple inc.', 'μηλο'] },
  { id: 'blackview', displayName: 'Blackview', aliases: ['blackview', 'black view'] },
  { id: 'bose', displayName: 'Bose', aliases: ['bose', 'bose corp'] },
  { id: 'cellular-line', displayName: 'Cellular Line', aliases: ['cellular line', 'cellularline', 'cellular-line'] },
  { id: 'edifier', displayName: 'Edifier', aliases: ['edifier'] },
  { id: 'egoboo', displayName: 'Egoboo', aliases: ['egoboo', 'ego boo'] },
  { id: 'garmin', displayName: 'Garmin', aliases: ['garmin'] },
  { id: 'google', displayName: 'Google', aliases: ['google', 'google pixel'] },
  { id: 'hifuture', displayName: 'HiFuture', aliases: ['hifuture', 'hi-future', 'hi future'] },
  { id: 'honor', displayName: 'Honor', aliases: ['honor'] },
  { id: 'huawei', displayName: 'Huawei', aliases: ['huawei'] },
  { id: 'jbl', displayName: 'JBL', aliases: ['jbl', 'harman jbl'] },
  { id: 'kiddoboo', displayName: 'Kiddoboo', aliases: ['kiddoboo', 'kiddo boo'] },
  { id: 'lenovo', displayName: 'Lenovo', aliases: ['lenovo'] },
  { id: 'marshall', displayName: 'Marshall', aliases: ['marshall'] },
  { id: 'motorola', displayName: 'Motorola', aliases: ['motorola', 'moto'] },
  { id: 'nothing', displayName: 'Nothing', aliases: ['nothing', 'cmf by nothing', 'cmf'] },
  { id: 'oneplus', displayName: 'OnePlus', aliases: ['oneplus', 'one plus', '1+'] },
  { id: 'oppo', displayName: 'Oppo', aliases: ['oppo'] },
  { id: 'poco', displayName: 'POCO', aliases: ['poco', 'poco by xiaomi'] },
  { id: 'realme', displayName: 'Realme', aliases: ['realme', 'real me'] },
  { id: 'samsung', displayName: 'Samsung', aliases: ['samsung', 'samsung electronics'] },
  { id: 'sentio', displayName: 'Sentio', aliases: ['sentio'] },
  { id: 'shokz', displayName: 'Shokz', aliases: ['shokz', 'aftershokz', 'after shokz'] },
  { id: 'sony', displayName: 'Sony', aliases: ['sony'] },
  { id: 'tcl', displayName: 'TCL', aliases: ['tcl'] },
  { id: 'turbo-x', displayName: 'Turbo-X', aliases: ['turbo-x', 'turbox', 'turbo x'] },
  { id: 'xiaomi', displayName: 'Xiaomi', aliases: ['xiaomi', 'mi'] },
  { id: 'unknown', displayName: 'Unknown', aliases: ['unknown', 'generic', 'n/a', 'other', 'none'] },
  // Common strategic electronics & audio brands
  { id: 'amazfit', displayName: 'Amazfit', aliases: ['amazfit'] },
  { id: 'anker', displayName: 'Anker', aliases: ['anker', 'soundcore', 'soundcore by anker'] },
  { id: 'asus', displayName: 'Asus', aliases: ['asus'] },
  { id: 'audio-technica', displayName: 'Audio-Technica', aliases: ['audio-technica', 'audiotechnica', 'audio technica'] },
  { id: 'bang-olufsen', displayName: 'Bang & Olufsen', aliases: ['bang & olufsen', 'b&o', 'bang and olufsen'] },
  { id: 'baseus', displayName: 'Baseus', aliases: ['baseus'] },
  { id: 'beats', displayName: 'Beats', aliases: ['beats', 'beats by dre', 'beats by dr. dre'] },
  { id: 'belkin', displayName: 'Belkin', aliases: ['belkin'] },
  { id: 'bowers-wilkins', displayName: 'Bowers & Wilkins', aliases: ['bowers & wilkins', 'b&w', 'bowers and wilkins'] },
  { id: 'fitbit', displayName: 'Fitbit', aliases: ['fitbit', 'fitbit by google'] },
  { id: 'havit', displayName: 'Havit', aliases: ['havit'] },
  { id: 'jabra', displayName: 'Jabra', aliases: ['jabra'] },
  { id: 'nokia', displayName: 'Nokia', aliases: ['nokia'] },
  { id: 'panasonic', displayName: 'Panasonic', aliases: ['panasonic'] },
  { id: 'philips', displayName: 'Philips', aliases: ['philips'] },
  { id: 'polar', displayName: 'Polar', aliases: ['polar'] },
  { id: 'sennheiser', displayName: 'Sennheiser', aliases: ['sennheiser'] },
  { id: 'skullcandy', displayName: 'Skullcandy', aliases: ['skullcandy', 'skull candy'] },
  { id: 'suunto', displayName: 'Suunto', aliases: ['suunto'] },
  { id: 'trust', displayName: 'Trust', aliases: ['trust'] },
  { id: 'vivo', displayName: 'Vivo', aliases: ['vivo'] },
  { id: 'zte', displayName: 'ZTE', aliases: ['zte'] },
];

/**
 * Normalizes a raw string into a key for alias lookup (strip non-alphanumeric, lowercase)
 */
function cleanLookupKey(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Pre-compiled lookup map from normalized aliases to CanonicalBrandDefinition
 */
const ALIAS_LOOKUP_MAP = new Map<string, CanonicalBrandDefinition>();

KNOWN_CANONICAL_BRANDS.forEach((brand) => {
  ALIAS_LOOKUP_MAP.set(cleanLookupKey(brand.id), brand);
  ALIAS_LOOKUP_MAP.set(cleanLookupKey(brand.displayName), brand);
  brand.aliases.forEach((alias) => {
    ALIAS_LOOKUP_MAP.set(cleanLookupKey(alias), brand);
  });
});

/**
 * Formats an unlisted brand into standard clean title-case
 */
function formatTitleCaseBrand(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'Unknown';

  // If already standard acronym like TCL, JBL, keep uppercase if 3 letters or fewer
  if (/^[A-Z0-9]{2,3}$/.test(trimmed)) {
    return trimmed;
  }

  // Preserve hyphenated names (e.g. Turbo-X, Bang-Olufsen)
  return trimmed
    .split(/([\s-]+)/)
    .map((part) => {
      if (part === ' ' || part === '-') return part;
      if (!part) return '';
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * Resolves any raw brand string to its canonical brand identity
 */
export function normalizeBrand(rawBrand: string | undefined | null): CanonicalBrandInfo {
  const safeRaw = (rawBrand || '').trim();
  if (!safeRaw) {
    return {
      id: 'unknown',
      displayName: 'Unknown',
      rawBrand: '',
    };
  }

  const key = cleanLookupKey(safeRaw);
  const matched = ALIAS_LOOKUP_MAP.get(key);

  if (matched) {
    return {
      id: matched.id,
      displayName: matched.displayName,
      rawBrand: safeRaw,
    };
  }

  // Fallback for unlisted brands: deterministic ID and title-cased display name
  const fallbackId = safeRaw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

  const fallbackDisplayName = formatTitleCaseBrand(safeRaw);

  return {
    id: fallbackId,
    displayName: fallbackDisplayName,
    rawBrand: safeRaw,
  };
}

/**
 * Returns canonical display name for any brand string
 */
export function getCanonicalBrandDisplayName(rawBrand: string | undefined | null): string {
  return normalizeBrand(rawBrand).displayName;
}

/**
 * Returns canonical brand ID slug for any brand string
 */
export function getCanonicalBrandId(rawBrand: string | undefined | null): string {
  return normalizeBrand(rawBrand).id;
}

/**
 * Determines whether two brand strings resolve to the exact same canonical brand
 */
export function isSameBrand(brandA: string | undefined | null, brandB: string | undefined | null): boolean {
  return getCanonicalBrandId(brandA) === getCanonicalBrandId(brandB);
}

/**
 * Case-insensitive, alias-aware brand filter matcher
 */
export function matchesBrandFilter(productBrand: string | undefined | null, selectedBrand: string | undefined | null): boolean {
  if (!selectedBrand || selectedBrand === 'ALL') return true;
  return getCanonicalBrandId(productBrand) === getCanonicalBrandId(selectedBrand);
}

/**
 * Audits a collection of brand strings and returns duplicate groups
 */
export function auditBrandDuplicates(
  items: Array<{ brand: string; productId?: string }>
): BrandAuditReport {
  const uniqueRawBrands = new Set<string>();
  const canonicalGroups = new Map<string, {
    canonicalId: string;
    canonicalDisplayName: string;
    observedVariations: Set<string>;
    productCount: number;
  }>();

  for (const item of items) {
    const raw = (item.brand || 'Unknown').trim();
    if (!raw) continue;
    uniqueRawBrands.add(raw);

    const norm = normalizeBrand(raw);
    let group = canonicalGroups.get(norm.id);
    if (!group) {
      group = {
        canonicalId: norm.id,
        canonicalDisplayName: norm.displayName,
        observedVariations: new Set<string>(),
        productCount: 0,
      };
      canonicalGroups.set(norm.id, group);
    }
    group.observedVariations.add(raw);
    group.productCount++;
  }

  const duplicateGroups: BrandDuplicateGroup[] = [];
  const allCanonicalBrandsSorted: string[] = [];

  canonicalGroups.forEach((group) => {
    allCanonicalBrandsSorted.push(group.canonicalDisplayName);
    if (group.observedVariations.size > 1) {
      duplicateGroups.push({
        canonicalId: group.canonicalId,
        canonicalDisplayName: group.canonicalDisplayName,
        observedVariations: Array.from(group.observedVariations).sort(),
        totalProducts: group.productCount,
      });
    }
  });

  allCanonicalBrandsSorted.sort((a, b) => a.localeCompare(b, 'el-GR', { sensitivity: 'base' }));
  duplicateGroups.sort((a, b) => b.totalProducts - a.totalProducts);

  return {
    totalUniqueRawBrands: uniqueRawBrands.size,
    totalCanonicalBrands: canonicalGroups.size,
    duplicateGroupCount: duplicateGroups.length,
    duplicateGroups,
    allCanonicalBrandsSorted,
  };
}

export function getAllKnownCanonicalBrands(): CanonicalBrandDefinition[] {
  return [...KNOWN_CANONICAL_BRANDS];
}

/**
 * Normalizes title for canonical comparison, product matching, and search
 */
export function normalizeProductTitleForMatching(title: string): string {
  if (!title) return '';

  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    // Normalize ANC equivalents
    .replace(/\bwith active noise cancellation\b/gi, 'anc')
    .replace(/\bwith active noise cancelling\b/gi, 'anc')
    .replace(/\bme active noise cancellation\b/gi, 'anc')
    .replace(/\bμε active noise cancellation\b/gi, 'anc')
    .replace(/\bactive noise cancellation\b/gi, 'anc')
    .replace(/\bactive noise cancelling\b/gi, 'anc')
    .replace(/\bnoise cancellation\b/gi, 'anc')
    .replace(/\bactive noise\b/gi, 'anc')
    // Normalize Connectivity equivalents
    .replace(/\bwi-fi\b/gi, 'wifi')
    .replace(/\bwlan\b/gi, 'wifi')
    // Normalize Greek category filler words
    .replace(/\b(ακουστικα|ακουστικων|ακουστικα bluetooth|bluetooth)\b/gi, '')
    .replace(/\b(κινητο|κινητα|τηλεφωνο|τηλεφωνα|smartphones?)\b/gi, '')
    .replace(/\b(ρολοι|smartwatch(es)?)\b/gi, '')
    .replace(/\b(ταμπλετ|tablets?)\b/gi, '')
    // Normalize prepositions / filler words
    .replace(/\b(with|me|με|w\/|for|για)\b/gi, ' ')
    // Normalize separators and whitespace
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

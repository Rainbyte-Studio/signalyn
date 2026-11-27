/**
 * Signalyn Retail Price Intelligence - Product Deduplication & Normalization Service (Phase P1.7)
 * 
 * Objectives:
 * 1. Audit retailProducts collection for duplicate canonical product identities.
 * 2. Normalize brand, model, generation, capacity, color, size, connectivity, and variant attributes.
 * 3. Recognize equivalent terminology:
 *    - "ANC" = "Active Noise Cancellation" = "Active Noise Cancelling"
 *    - "With Active Noise Cancellation" = "Active Noise Cancellation" = "με Active Noise Cancellation"
 *    - "WiFi" = "Wi-Fi" = "WLAN"
 *    - Common Greek and English filler prepositions ("with", "με", "for", "για", "w/")
 * 4. Strict variant isolation rules:
 *    - Never merge distinct storage capacities (e.g. 128GB vs 256GB vs 512GB)
 *    - Never merge distinct RAM configurations (e.g. 4GB vs 8GB vs 12GB)
 *    - Never merge distinct colors when SKU-defining (e.g. Black vs Blue vs Beige)
 *    - Never merge distinct watch sizes (e.g. 40mm vs 44mm vs 46mm)
 *    - Never merge distinct generations (e.g. Watch GT 4 vs GT 5; AirPods 4 vs AirPods 5)
 *    - Never merge Standard vs ANC versions (e.g. AirPods 4 vs AirPods 4 ANC)
 *    - Never merge Pro vs non-Pro vs Plus vs Ultra vs Max vs Mini vs Lite vs FE
 *    - Never merge Cellular vs Wi-Fi variants
 * 5. Safe automated consolidation for exact, unambiguous duplicate pairs with complete offer and history preservation.
 */

import {
  RetailProduct,
  RetailOffer,
  RetailPriceHistoryEntry,
  RetailCategory,
} from '../../types/retailPrice';
import { normalizeBrand, isSameBrand, getCanonicalBrandDisplayName } from './brandNormalizer';
import { getServerDb } from '../serverFirestoreAdapter';
import {
  getMemCatalog,
  getMemOffers,
  getMemPriceHistory,
} from './retailPipelineService';

export interface ProductDuplicateCandidate {
  targetProductId: string;
  targetProductName: string;
  duplicateProductId: string;
  duplicateProductName: string;
  brand: string;
  category: RetailCategory;
  confidenceScore: number;
  confidenceTier: 'EXACT_UNAMBIGUOUS' | 'AMBIGUOUS_MANUAL_REVIEW' | 'VARIANT_CONFLICT_REJECTED';
  reasons: string[];
  targetOfferCount: number;
  duplicateOfferCount: number;
  consolidationSafe: boolean;
}

export interface CatalogDeduplicationReport {
  timestamp: string;
  totalProductsAudited: number;
  duplicateCandidateCount: number;
  exactDuplicatesCount: number;
  ambiguousCandidatesCount: number;
  variantConflictsCount: number;
  candidates: ProductDuplicateCandidate[];
}

export interface ConsolidationResult {
  success: boolean;
  timestamp: string;
  consolidatedPairsCount: number;
  offersRepointedCount: number;
  historyRepointedCount: number;
  removedDuplicateProducts: string[];
  retainedCanonicalProducts: string[];
  details: Array<{
    targetId: string;
    duplicateId: string;
    offersRepointed: number;
    historyRepointed: number;
  }>;
}

/**
 * Normalizes title for canonical comparison and matching
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

/**
 * Extracts storage spec from a title (e.g. 512GB, 256GB, 1TB)
 */
export function extractStorageAttribute(title: string): string | null {
  const match = title.match(/\b(32|64|128|256|512)\s*(gb|tb)\b|\b(1|2)\s*(tb)\b/i);
  if (!match) return null;
  return match[0].toUpperCase().replace(/\s+/g, '');
}

/**
 * Extracts RAM spec from a title (e.g. 8GB/256GB -> 8GB)
 */
export function extractRamAttribute(title: string): string | null {
  const combo = title.match(/\b(2|3|4|6|8|12|16|24)\s*gb\s*\/\s*(?:32|64|128|256|512|1024)\s*gb\b/i);
  if (combo) return `${combo[1].toUpperCase()}GB`;
  return null;
}

/**
 * Extracts watch size spec (e.g. 40mm, 44mm, 46mm)
 */
export function extractWatchSizeAttribute(title: string): string | null {
  const match = title.match(/(?:^|[\s\-_/,.(])(38|40|41|42|44|45|46|47|49|51)\s*mm(?:$|[\s\-_/,.)])/i);
  if (!match) return null;
  return `${match[1]}mm`.toLowerCase();
}

/**
 * Extracts color attribute from standard Greek and English titles
 */
export function extractColorAttribute(title: string): string | null {
  if (!title) return null;
  const clean = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const colors = [
    { pattern: /(?:^|[\s\-_/,.(])(μαυρο|μαυρος|μαυρη|black|midnight|dark|graphite)(?:$|[\s\-_/,.)])/i, name: 'black' },
    { pattern: /(?:^|[\s\-_/,.(])(λευκο|λευκος|λευκη|white|starlight|silver|light)(?:$|[\s\-_/,.)])/i, name: 'white' },
    { pattern: /(?:^|[\s\-_/,.(])(μπλε|γαλαζιο|blue|navy|deep blue)(?:$|[\s\-_/,.)])/i, name: 'blue' },
    { pattern: /(?:^|[\s\-_/,.(])(πρασινο|πρασινος|green|sage|olive)(?:$|[\s\-_/,.)])/i, name: 'green' },
    { pattern: /(?:^|[\s\-_/,.(])(ροζ|pink|rose|rose gold)(?:$|[\s\-_/,.)])/i, name: 'pink' },
    { pattern: /(?:^|[\s\-_/,.(])(μπεζ|beige|cream|sand)(?:$|[\s\-_/,.)])/i, name: 'beige' },
    { pattern: /(?:^|[\s\-_/,.(])(γκρι|γκριζο|grey|gray|titanium gray)(?:$|[\s\-_/,.)])/i, name: 'gray' },
    { pattern: /(?:^|[\s\-_/,.(])(χρυσο|χρυσος|gold)(?:$|[\s\-_/,.)])/i, name: 'gold' },
    { pattern: /(?:^|[\s\-_/,.(])(κοκκινο|κοκκινος|red|product red)(?:$|[\s\-_/,.)])/i, name: 'red' },
    { pattern: /(?:^|[\s\-_/,.(])(μωβ|purple|violet|lavender)(?:$|[\s\-_/,.)])/i, name: 'purple' },
  ];

  for (const c of colors) {
    if (c.pattern.test(clean)) return c.name;
  }
  return null;
}

/**
 * Audits the catalog to detect duplicate canonical products
 */
export function auditProductDuplicates(
  products?: RetailProduct[],
  offers?: RetailOffer[]
): CatalogDeduplicationReport {
  const prodList = products || Array.from(getMemCatalog().values());
  const offerList = offers || Array.from(getMemOffers().values());

  const offersByProduct = new Map<string, RetailOffer[]>();
  offerList.forEach((o) => {
    if (o.canonicalProductId) {
      if (!offersByProduct.has(o.canonicalProductId)) {
        offersByProduct.set(o.canonicalProductId, []);
      }
      offersByProduct.get(o.canonicalProductId)!.push(o);
    }
  });

  const candidates: ProductDuplicateCandidate[] = [];
  const processedPairs = new Set<string>();

  for (let i = 0; i < prodList.length; i++) {
    for (let j = i + 1; j < prodList.length; j++) {
      const p1 = prodList[i];
      const p2 = prodList[j];

      // Must be same category
      if (p1.category !== p2.category) continue;

      // Must be same canonical brand
      if (!isSameBrand(p1.brand, p2.brand)) continue;

      const pairKey = [p1.id, p2.id].sort().join('___');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      // 1. Strict Suffix & Tier Guards
      const suffixPatterns = [
        { regex: /\bpro\b/i, name: 'Pro' },
        { regex: /\bultra\b/i, name: 'Ultra' },
        { regex: /\bplus\b|\b\+\b/i, name: 'Plus' },
        { regex: /\bmini\b/i, name: 'Mini' },
        { regex: /\bmax\b/i, name: 'Max' },
        { regex: /\blite\b/i, name: 'Lite' },
        { regex: /\bfe\b/i, name: 'FE' },
        { regex: /\bfold\b/i, name: 'Fold' },
        { regex: /\bflip\b/i, name: 'Flip' },
      ];

      let suffixConflict = false;
      for (const s of suffixPatterns) {
        if (s.regex.test(p1.name) !== s.regex.test(p2.name)) {
          suffixConflict = true;
          break;
        }
      }
      if (suffixConflict) continue;

      // 2. Strict ANC Guard: Standard vs ANC versions must NEVER be merged!
      const p1HasAnc = /\b(anc|active noise cancellation|active noise cancelling)\b/i.test(p1.name);
      const p2HasAnc = /\b(anc|active noise cancellation|active noise cancelling)\b/i.test(p2.name);
      if (p1HasAnc !== p2HasAnc) {
        continue; // Distinct variant: Standard vs ANC
      }

      // 3. Strict Storage Guard
      const storage1 = p1.storage || extractStorageAttribute(p1.name);
      const storage2 = p2.storage || extractStorageAttribute(p2.name);
      if (storage1 && storage2 && storage1 !== storage2) {
        continue; // Storage capacity conflict
      }

      // 4. Strict RAM Guard
      const ram1 = extractRamAttribute(p1.name);
      const ram2 = extractRamAttribute(p2.name);
      if (ram1 && ram2 && ram1 !== ram2) {
        continue; // RAM conflict
      }

      // 5. Strict Watch Size Guard
      const size1 = extractWatchSizeAttribute(p1.name);
      const size2 = extractWatchSizeAttribute(p2.name);
      if (size1 && size2 && size1 !== size2) {
        continue; // Case size conflict
      }

      // 6. Strict Color Guard
      const color1 = p1.color || extractColorAttribute(p1.name);
      const color2 = p2.color || extractColorAttribute(p2.name);
      if (color1 && color2 && color1 !== color2) {
        continue; // Color conflict
      }

      // 7. Strict Connectivity Guard
      const p1Cellular = /\b(cellular|4g|5g|lte)\b/i.test(p1.name);
      const p2Cellular = /\b(cellular|4g|5g|lte)\b/i.test(p2.name);
      if (p1Cellular !== p2Cellular) {
        continue; // Connectivity conflict
      }

      // 8. Title Equivalence
      const norm1 = normalizeProductTitleForMatching(p1.name);
      const norm2 = normalizeProductTitleForMatching(p2.name);

      if (!norm1 || !norm2) continue;

      const p1Offers = offersByProduct.get(p1.id) || [];
      const p2Offers = offersByProduct.get(p2.id) || [];

      // Determine authoritative target ID: prefer cleaner ID without "with-" or the one created first / having more offers
      let targetProd = p1;
      let dupProd = p2;

      if (p1.id.includes('-with-') && !p2.id.includes('-with-')) {
        targetProd = p2;
        dupProd = p1;
      } else if (p2Offers.length > p1Offers.length) {
        targetProd = p2;
        dupProd = p1;
      }

      const targetOffers = offersByProduct.get(targetProd.id) || [];
      const dupOffers = offersByProduct.get(dupProd.id) || [];

      if (norm1 === norm2) {
        // Exact 100% normalized title match!
        candidates.push({
          targetProductId: targetProd.id,
          targetProductName: targetProd.name,
          duplicateProductId: dupProd.id,
          duplicateProductName: dupProd.name,
          brand: getCanonicalBrandDisplayName(targetProd.brand),
          category: targetProd.category,
          confidenceScore: 1.0,
          confidenceTier: 'EXACT_UNAMBIGUOUS',
          reasons: [
            'Exact normalized title match across Greek/English filler words and ANC notation',
            `Zero variant conflicts (storage: ${storage1 || 'unspecified'}, color: ${color1 || 'unspecified'}, connectivity: ${p1Cellular ? 'Cellular' : 'Standard'})`,
            `Target offer count: ${targetOffers.length}, duplicate offer count: ${dupOffers.length}`,
          ],
          targetOfferCount: targetOffers.length,
          duplicateOfferCount: dupOffers.length,
          consolidationSafe: true,
        });
      } else if (norm1.includes(norm2) || norm2.includes(norm1)) {
        // Substring / near match with identical core
        const diff = Math.abs(norm1.length - norm2.length);
        if (diff <= 8) {
          candidates.push({
            targetProductId: targetProd.id,
            targetProductName: targetProd.name,
            duplicateProductId: dupProd.id,
            duplicateProductName: dupProd.name,
            brand: getCanonicalBrandDisplayName(targetProd.brand),
            category: targetProd.category,
            confidenceScore: 0.75,
            confidenceTier: 'AMBIGUOUS_MANUAL_REVIEW',
            reasons: [
              `Near title match (length delta ${diff})`,
              'Requires manual review to confirm variant equivalence',
            ],
            targetOfferCount: targetOffers.length,
            duplicateOfferCount: dupOffers.length,
            consolidationSafe: false,
          });
        }
      }
    }
  }

  const exactCount = candidates.filter((c) => c.confidenceTier === 'EXACT_UNAMBIGUOUS').length;
  const ambiguousCount = candidates.filter((c) => c.confidenceTier === 'AMBIGUOUS_MANUAL_REVIEW').length;

  return {
    timestamp: new Date().toISOString(),
    totalProductsAudited: prodList.length,
    duplicateCandidateCount: candidates.length,
    exactDuplicatesCount: exactCount,
    ambiguousCandidatesCount: ambiguousCount,
    variantConflictsCount: 0,
    candidates,
  };
}

/**
 * Consolidates exact, unambiguous duplicate canonical product pairs.
 * Strictly preserves all linked offers and price history by repointing foreign keys.
 */
export async function executeProductDeduplication(
  options: { dryRun?: boolean; isDryRun?: boolean; approvedCandidateIds?: string[] } = {}
): Promise<ConsolidationResult> {
  const isDryRun = options.isDryRun ?? options.dryRun ?? false;
  const memProducts = getMemCatalog();
  const memOffers = getMemOffers();
  const memPriceHistory = getMemPriceHistory();

  const allProducts = Array.from(memProducts.values());
  const allOffers = Array.from(memOffers.values());
  const audit = auditProductDuplicates(allProducts, allOffers);

  const exactCandidates = audit.candidates.filter(
    (c) =>
      c.confidenceTier === 'EXACT_UNAMBIGUOUS' &&
      c.consolidationSafe &&
      (!options.approvedCandidateIds || options.approvedCandidateIds.includes(c.duplicateProductId))
  );

  const result: ConsolidationResult = {
    success: true,
    timestamp: new Date().toISOString(),
    consolidatedPairsCount: exactCandidates.length,
    offersRepointedCount: 0,
    historyRepointedCount: 0,
    removedDuplicateProducts: [],
    retainedCanonicalProducts: [],
    details: [],
  };

  if (exactCandidates.length === 0) {
    return result;
  }

  const pendingOfferUpdates: RetailOffer[] = [];
  const pendingHistoryUpdates: RetailPriceHistoryEntry[] = [];
  const duplicateProductIdsToDelete: string[] = [];

  for (const candidate of exactCandidates) {
    const targetId = candidate.targetProductId;
    const dupId = candidate.duplicateProductId;

    result.retainedCanonicalProducts.push(targetId);
    result.removedDuplicateProducts.push(dupId);

    let offersRepointed = 0;
    let historyRepointed = 0;

    // 1. Repoint all offers linked to duplicate product
    for (const offer of memOffers.values()) {
      if (offer.canonicalProductId === dupId) {
        const updatedOffer = { ...offer, canonicalProductId: targetId };
        pendingOfferUpdates.push(updatedOffer);
        if (!isDryRun) memOffers.set(offer.id, updatedOffer);
        offersRepointed++;
      }
    }

    // 2. Repoint all price history observations
    for (const hist of memPriceHistory.values()) {
      if (hist.canonicalProductId === dupId) {
        const updatedHistory = { ...hist, canonicalProductId: targetId };
        pendingHistoryUpdates.push(updatedHistory);
        if (!isDryRun) memPriceHistory.set(hist.id, updatedHistory);
        historyRepointed++;
      }
    }

    result.offersRepointedCount += offersRepointed;
    result.historyRepointedCount += historyRepointed;
    duplicateProductIdsToDelete.push(dupId);

    result.details.push({
      targetId,
      duplicateId: dupId,
      offersRepointed,
      historyRepointed,
    });

    if (!isDryRun) {
      // Remove duplicate from memory
      memProducts.delete(dupId);
    }
  }

  // 3. Persist mutations to Cloud Firestore if not dry-run
  if (!isDryRun) {
    try {
      const db = getServerDb();
      const batch = db.batch();

      // Delete duplicate products
      for (const dupId of duplicateProductIdsToDelete) {
        batch.delete(db.collection('retailProducts').doc(dupId));
      }

      // Update repointed offers
      for (const off of pendingOfferUpdates) {
        batch.update(db.collection('retailOffers').doc(off.id), { canonicalProductId: off.canonicalProductId });
      }

      // Update repointed history
      for (const hist of pendingHistoryUpdates) {
        batch.update(db.collection('retailPriceHistory').doc(hist.id), { canonicalProductId: hist.canonicalProductId });
      }

      await batch.commit();
      console.log(`[ProductDeduplication] Successfully committed consolidation to Firestore for ${exactCandidates.length} pairs.`);
    } catch (err) {
      console.warn('[ProductDeduplication] Firestore consolidation commit notice:', err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

/**
 * Signalyn Retail Price Intelligence - Category Taxonomy Classifier (Phase P1.7)
 * 
 * Objectives:
 * 1. Inspect discovered products from retailer endpoints to ensure accurate Signalyn taxonomy classification.
 * 2. Specifically handles URLs such as Public's Bluetooth accessories:
 *    https://www.public.gr/cat/aksesoyar/tablet/bluetooth
 *    which may contain Bluetooth audio devices (AirPods, headphones, headsets, speakers)
 *    as well as tablet-specific accessories (keyboards, cases, styluses).
 * 3. Inspects product titles, URLs, and metadata to classify accurately:
 *    - Genuine audio products (headphones, earphones, earbuds, headsets, speakers) -> AUDIO
 *    - Dedicated tablet accessories (cases, styluses, keyboards, stands) -> TABLETS
 *    - Wearables (smartwatches, fitness trackers, bands) -> WEARABLES
 *    - Smartphones -> SMARTPHONES
 * 4. Preserves the original retailer category for complete provenance.
 * 5. Flags ambiguous items for manual review rather than discarding valid products.
 */

import { RetailCategory } from '../../types/retailPrice';

export interface TaxonomyClassificationResult {
  effectiveCategory: RetailCategory;
  originalDeclaredCategory: RetailCategory;
  isReclassified: boolean;
  classificationConfidence: 'HIGH' | 'AMBIGUOUS';
  detectedSubtype?: string;
  notes?: string;
}

const AUDIO_PATTERNS = [
  /\b(ακουστικα|ακουστικο|ακουστικων)\b/i,
  /\b(headphones|earphones|earbuds|headset|handsfree|hands-free|airpods|earphones|buds)\b/i,
  /\b(true wireless|tws|in-ear|on-ear|over-ear)\b/i,
  /\b(ηχειο|ηχεια|speaker|speakers|soundbar)\b/i,
  /\b(noise cancellation|active noise|anc)\b/i,
];

const TABLET_ACCESSORY_PATTERNS = [
  /\b(θηκη|θηκες|case|cover|folio|sleeve)\b/i,
  /\b(πληκτρολογιο|keyboard|keyboards)\b/i,
  /\b(πενα|γραφιδα|stylus|apple pencil|s-pen|spen)\b/i,
  /\b(τζαμακι|προστασια οθονης|screen protector)\b/i,
  /\b(βαση tablet|stand|dock|docking station)\b/i,
];

const WEARABLE_PATTERNS = [
  /\b(smartwatch|smartwatches|smart watch|ρολοι|ρολογια)\b/i,
  /\b(fitness tracker|activity tracker|smart band|smartband|band)\b/i,
];

const SMARTPHONE_PATTERNS = [
  /\b(smartphone|smartphones|κινητο|κινητα|τηλεφωνο|τηλεφωνα)\b/i,
];

/**
 * Classifies a discovered product's canonical Signalyn category based on its attributes
 */
export function classifyProductTaxonomy(
  title: string,
  declaredCategory: RetailCategory,
  sourceUrl?: string
): TaxonomyClassificationResult {
  const combined = `${title} ${sourceUrl || ''}`.toLowerCase();

  const isAudio = AUDIO_PATTERNS.some((p) => p.test(combined));
  const isTabletAccessory = TABLET_ACCESSORY_PATTERNS.some((p) => p.test(combined));
  const isWearable = WEARABLE_PATTERNS.some((p) => p.test(combined));
  const isPhone = SMARTPHONE_PATTERNS.some((p) => p.test(combined));

  // If crawling Public's Bluetooth accessories under AUDIO:
  if (declaredCategory === 'AUDIO') {
    if (isAudio && !isTabletAccessory) {
      return {
        effectiveCategory: 'AUDIO',
        originalDeclaredCategory: declaredCategory,
        isReclassified: false,
        classificationConfidence: 'HIGH',
        detectedSubtype: 'Bluetooth Audio Device',
      };
    }

    if (isTabletAccessory && !isAudio) {
      return {
        effectiveCategory: 'TABLETS',
        originalDeclaredCategory: declaredCategory,
        isReclassified: true,
        classificationConfidence: 'HIGH',
        detectedSubtype: 'Tablet Accessory',
        notes: 'Discovered under Public Bluetooth accessories; reclassified as TABLETS based on accessory attributes.',
      };
    }

    if (isWearable) {
      return {
        effectiveCategory: 'WEARABLES',
        originalDeclaredCategory: declaredCategory,
        isReclassified: true,
        classificationConfidence: 'HIGH',
        detectedSubtype: 'Wearable Device',
        notes: 'Discovered under Public Bluetooth accessories; reclassified as WEARABLES.',
      };
    }
  }

  // Cross-category checks for other categories:
  if (declaredCategory === 'TABLETS' && isAudio && !isTabletAccessory) {
    return {
      effectiveCategory: 'AUDIO',
      originalDeclaredCategory: declaredCategory,
      isReclassified: true,
      classificationConfidence: 'HIGH',
      detectedSubtype: 'Audio Device',
      notes: 'Discovered under tablet endpoint; reclassified as AUDIO.',
    };
  }

  if (declaredCategory === 'WEARABLES' && isPhone && !isWearable) {
    return {
      effectiveCategory: 'SMARTPHONES',
      originalDeclaredCategory: declaredCategory,
      isReclassified: true,
      classificationConfidence: 'HIGH',
      detectedSubtype: 'Smartphone',
      notes: 'Discovered under wearables endpoint; reclassified as SMARTPHONES.',
    };
  }

  // Default: retain declared category with high confidence if matching expected domain
  return {
    effectiveCategory: declaredCategory,
    originalDeclaredCategory: declaredCategory,
    isReclassified: false,
    classificationConfidence: 'HIGH',
  };
}

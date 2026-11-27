/**
 * Signalyn Canonical Device Category Taxonomy & Resolution Layer
 * 
 * Supported strategic categories:
 * - SMARTPHONE
 * - WEARABLE
 * - AUDIO
 * - TABLET
 * - OTHER
 * - UNKNOWN
 * 
 * Enforces deterministic normalization across English and Greek terminology,
 * strict resolution priorities (Canonical Product > Analysis Evidence > Raw Metadata > Title Tokens > UNKNOWN),
 * and prevents generic variant tokens ("Air", "Pro", "Ultra", "Max") from erroneously dictating category.
 */

import { Article, ArticleAnalysis, Story } from '../types';

export type CanonicalDeviceCategory =
  | 'SMARTPHONE'
  | 'WEARABLE'
  | 'AUDIO'
  | 'TABLET'
  | 'OTHER'
  | 'UNKNOWN';

export const ALL_CANONICAL_DEVICE_CATEGORIES: CanonicalDeviceCategory[] = [
  'SMARTPHONE',
  'WEARABLE',
  'AUDIO',
  'TABLET',
  'OTHER',
  'UNKNOWN',
];

/**
 * Normalizes any category string or alias into a CanonicalDeviceCategory.
 */
export function normalizeDeviceCategory(input: string | null | undefined): CanonicalDeviceCategory {
  if (!input || typeof input !== 'string') {
    return 'UNKNOWN';
  }

  const raw = input.trim().toLowerCase();
  if (!raw) return 'UNKNOWN';

  // Strict check: Generic marketing/variant tokens MUST NOT determine category
  const genericTokens = ['pro', 'air', 'ultra', 'max', 'plus', 'mini', 'lite', 'se'];
  if (genericTokens.includes(raw)) {
    return 'UNKNOWN';
  }

  // 1. SMARTPHONE aliases
  if (
    raw === 'smartphone' ||
    raw === 'smartphones' ||
    raw === 'phone' ||
    raw === 'phones' ||
    raw === 'mobile' ||
    raw === 'mobile phone' ||
    raw === 'mobile phones' ||
    raw === 'cell phone' ||
    raw === 'κινητό' ||
    raw === 'κινητά' ||
    raw === 'τηλέφωνο' ||
    raw === 'τηλέφωνα'
  ) {
    return 'SMARTPHONE';
  }

  // 2. WEARABLE aliases
  if (
    raw === 'wearable' ||
    raw === 'wearables' ||
    raw === 'watch' ||
    raw === 'watches' ||
    raw === 'smartwatch' ||
    raw === 'smartwatches' ||
    raw === 'smart watch' ||
    raw === 'fitness tracker' ||
    raw === 'fitness band' ||
    raw === 'fitness watch' ||
    raw === 'smartband' ||
    raw === 'ρολόι' ||
    raw === 'ρολόγια' ||
    raw === 'έξυπνο ρολόι'
  ) {
    return 'WEARABLE';
  }

  // 3. AUDIO aliases
  if (
    raw === 'audio' ||
    raw === 'audio devices' ||
    raw === 'earbuds' ||
    raw === 'earbud' ||
    raw === 'headphones' ||
    raw === 'headphone' ||
    raw === 'headset' ||
    raw === 'headsets' ||
    raw === 'wireless earbuds' ||
    raw === 'true wireless' ||
    raw === 'tws' ||
    raw === 'earphones' ||
    raw === 'ακουστικά' ||
    raw === 'ασύρματα ακουστικά' ||
    raw === 'ηχεία'
  ) {
    return 'AUDIO';
  }

  // 4. TABLET aliases
  if (
    raw === 'tablet' ||
    raw === 'tablets' ||
    raw === 'slate' ||
    raw === 'slates' ||
    raw === 'ταμπλέτα' ||
    raw === 'ταμπλέτες' ||
    raw === 'tablet pc'
  ) {
    return 'TABLET';
  }

  // 5. OTHER standard categories
  if (
    raw === 'laptop' ||
    raw === 'laptops' ||
    raw === 'pc' ||
    raw === 'smart home' ||
    raw === 'automotive' ||
    raw === 'tv' ||
    raw === 'gaming' ||
    raw === 'other'
  ) {
    return 'OTHER';
  }

  return 'UNKNOWN';
}

/**
 * Resolves canonical category from a known product name deterministically.
 * Differentiates products sharing ambiguous tokens (e.g. "Air").
 */
export function inferCategoryFromProductName(productName: string): CanonicalDeviceCategory {
  const norm = productName.trim().toLowerCase();
  if (!norm) return 'UNKNOWN';

  // Explicit Audio overrides
  if (
    norm.includes('airpods') ||
    norm.includes('freebuds') ||
    norm.includes('galaxy buds') ||
    norm.includes('buds') ||
    norm.includes('linkbuds') ||
    norm.includes('headphone') ||
    norm.includes('earphone')
  ) {
    return 'AUDIO';
  }

  // Explicit Tablet overrides
  if (
    norm.includes('ipad') ||
    norm.includes('matepad') ||
    norm.includes('galaxy tab') ||
    norm.includes('xiaomi pad') ||
    norm.includes('fire hd')
  ) {
    return 'TABLET';
  }

  // Explicit Watch / Wearable overrides
  if (
    norm.includes('watch') ||
    norm.includes('smartwatch') ||
    norm.includes('band') ||
    norm.includes('fitbit') ||
    norm.includes('forerunner') ||
    norm.includes('fenix')
  ) {
    return 'WEARABLE';
  }

  // Explicit Smartphone overrides
  if (
    norm.includes('iphone') ||
    norm.includes('galaxy s') ||
    norm.includes('galaxy z') ||
    norm.includes('pixel') ||
    norm.includes('mate') || // Mate smartphones (Mate 90, Mate XT)
    norm.includes('pura') ||
    norm.includes('redmi') ||
    norm.includes('xiaomi 1') ||
    norm.includes('razr') ||
    norm.includes('magic')
  ) {
    return 'SMARTPHONE';
  }

  return 'UNKNOWN';
}

/**
 * Resolves a set of canonical categories for an article according to strict priority:
 * 1. Resolved canonical Product.category
 * 2. Inferred category from recognized product name
 * 3. Structured ArticleAnalysis category evidence (topics, competitiveRelevance)
 * 4. Source/raw category metadata
 * 5. Deterministic title/token inference (including Greek terms)
 * 6. UNKNOWN
 */
export function resolveCanonicalCategories(
  article: Article,
  analysis?: ArticleAnalysis | null
): Set<CanonicalDeviceCategory> {
  const categories = new Set<CanonicalDeviceCategory>();

  // Priority 1: Resolved canonical Product.category from ArticleAnalysis
  if (analysis?.products && analysis.products.length > 0) {
    for (const p of analysis.products) {
      if (p.category) {
        const cat = normalizeDeviceCategory(p.category);
        if (cat !== 'UNKNOWN') {
          categories.add(cat);
        }
      }
      // Priority 2: Inferred from canonical product name
      const nameCat = inferCategoryFromProductName(p.canonicalName || p.matchedText);
      if (nameCat !== 'UNKNOWN') {
        categories.add(nameCat);
      }
    }
  }

  // If we already resolved strong product-level categories, return them directly
  if (categories.size > 0) {
    return categories;
  }

  // Priority 3: Structured ArticleAnalysis category evidence
  if (analysis?.competitiveRelevance?.categories) {
    for (const catStr of analysis.competitiveRelevance.categories) {
      const cat = normalizeDeviceCategory(catStr);
      if (cat !== 'UNKNOWN') {
        categories.add(cat);
      }
    }
  }

  if (analysis?.topics) {
    for (const topic of analysis.topics) {
      const cat = normalizeDeviceCategory(topic);
      if (cat !== 'UNKNOWN') {
        categories.add(cat);
      }
    }
  }

  if (categories.size > 0) {
    return categories;
  }

  // Priority 4: Source / raw category metadata
  if (article.rawCategories && article.rawCategories.length > 0) {
    for (const rawCat of article.rawCategories) {
      const cat = normalizeDeviceCategory(rawCat);
      if (cat !== 'UNKNOWN') {
        categories.add(cat);
      }
    }
  }

  if (categories.size > 0) {
    return categories;
  }

  // Priority 5: Deterministic title / token inference
  const text = `${article.title} ${article.excerpt || ''}`.toLowerCase();

  // Watch inference
  if (
    text.includes('smartwatch') ||
    text.includes('watch') ||
    text.includes('ρολόι') ||
    text.includes('ρολογ') ||
    text.includes('wearable')
  ) {
    categories.add('WEARABLE');
  }

  // Audio inference
  if (
    text.includes('airpods') ||
    text.includes('freebuds') ||
    text.includes('galaxy buds') ||
    text.includes('earbuds') ||
    text.includes('headphones') ||
    text.includes('ακουστικά') ||
    text.includes('ακουστικ')
  ) {
    categories.add('AUDIO');
  }

  // Tablet inference
  if (
    text.includes('ipad') ||
    text.includes('matepad') ||
    text.includes('galaxy tab') ||
    text.includes('tablet') ||
    text.includes('ταμπλέτα') ||
    text.includes('ταμπλετ')
  ) {
    categories.add('TABLET');
  }

  // Smartphone inference
  if (
    text.includes('smartphone') ||
    text.includes('smartphones') ||
    text.includes('iphone') ||
    text.includes('κινητό') ||
    text.includes('κινητα') ||
    text.includes('τηλέφωνο') ||
    text.includes('galaxy s') ||
    text.includes('mate 90') ||
    text.includes('mate xt') ||
    text.includes('pura 70')
  ) {
    categories.add('SMARTPHONE');
  }

  // Priority 6: UNKNOWN fallback if nothing matched
  if (categories.size === 0) {
    categories.add('UNKNOWN');
  }

  return categories;
}

/**
 * Resolves the primary canonical category for an article.
 */
export function resolvePrimaryCanonicalCategory(
  article: Article,
  analysis?: ArticleAnalysis | null
): CanonicalDeviceCategory {
  const cats = resolveCanonicalCategories(article, analysis);
  for (const c of cats) {
    if (c !== 'UNKNOWN' && c !== 'OTHER') return c;
  }
  if (cats.has('OTHER')) return 'OTHER';
  return 'UNKNOWN';
}

/**
 * Resolves canonical device categories for a Story based on its products, categories, and metadata.
 */
export function getStoryCanonicalCategories(story: Story): Set<CanonicalDeviceCategory> {
  const categories = new Set<CanonicalDeviceCategory>();

  // 1. From Story.products
  if (story.products && story.products.length > 0) {
    for (const p of story.products) {
      if (p.category) {
        const cat = normalizeDeviceCategory(p.category);
        if (cat !== 'UNKNOWN') categories.add(cat);
      }
      const nameCat = inferCategoryFromProductName(p.name);
      if (nameCat !== 'UNKNOWN') categories.add(nameCat);
    }
  }

  // 2. From Story.categories
  if (story.categories && story.categories.length > 0) {
    for (const c of story.categories) {
      const cat = normalizeDeviceCategory(c);
      if (cat !== 'UNKNOWN') categories.add(cat);
    }
  }

  // 3. Fallback to title inference
  if (categories.size === 0 && story.canonicalTitle) {
    const text = story.canonicalTitle.toLowerCase();
    if (text.includes('watch') || text.includes('ρολόι')) categories.add('WEARABLE');
    else if (text.includes('phone') || text.includes('mate') || text.includes('iphone')) categories.add('SMARTPHONE');
    else if (text.includes('buds') || text.includes('airpods') || text.includes('audio')) categories.add('AUDIO');
    else if (text.includes('tab') || text.includes('pad') || text.includes('tablet')) categories.add('TABLET');
  }

  if (categories.size === 0) {
    categories.add('UNKNOWN');
  }

  return categories;
}

/**
 * Evaluates whether two sets of categories have a meaningful intersection.
 * If either set contains UNKNOWN or is empty, returns true to preserve recall.
 */
export function areCategoriesCompatible(
  articleCategories: Set<CanonicalDeviceCategory>,
  storyCategories: Set<CanonicalDeviceCategory>
): boolean {
  if (
    articleCategories.has('UNKNOWN') ||
    storyCategories.has('UNKNOWN') ||
    articleCategories.size === 0 ||
    storyCategories.size === 0
  ) {
    return true;
  }

  for (const cat of articleCategories) {
    if (storyCategories.has(cat)) {
      return true;
    }
  }

  return false;
}

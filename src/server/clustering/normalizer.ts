/**
 * Normalization utilities for deterministic Story clustering.
 * Case-insensitive, punctuation-safe, product-family aware.
 */

import { Article, ArticleAnalysis } from '../../types';

const COMMON_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'is', 'are', 'was', 'were', 'it', 'its', 'this', 'that', 'from', 'as', 'into', 'has', 'have',
  // Greek common stopwords
  'και', 'το', 'τα', 'τη', 'την', 'τον', 'του', 'των', 'τους', 'τις', 'στο', 'στη', 'στην',
  'στον', 'στα', 'στους', 'στις', 'με', 'για', 'απο', 'από', 'σε', 'πως', 'πώς', 'που', 'πού',
  'ειναι', 'είναι', 'εχει', 'έχει', 'νεα', 'νέα', 'νεο', 'νέο', 'σειρα', 'σειρά', 'πλεον', 'πλέον'
]);

/**
 * Normalizes text to lowercase alphanumeric without punctuation or Greek accents.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Strip diacritics / accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenizes text into significant keywords, removing short words and stopwords.
 */
export function tokenizeText(text: string): string[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  return norm
    .split(' ')
    .filter((w) => w.length > 2 && !COMMON_STOPWORDS.has(w));
}

/**
 * Computes Jaccard similarity between two token sets.
 */
export function calculateTokenJaccard(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export interface ProductFamilyInfo {
  exact: string;
  family: string;
  variant: string; // e.g. "pro", "ultra", "plus", "max", "base"
}

/**
 * Decomposes product strings to distinguish exact models from product families.
 * Example:
 *   "HUAWEI WATCH GT 7 Pro" -> { exact: "huawei watch gt 7 pro", family: "huawei watch gt 7", variant: "pro" }
 *   "HUAWEI WATCH GT 7"     -> { exact: "huawei watch gt 7", family: "huawei watch gt 7", variant: "base" }
 */
export function extractProductFamily(productName: string): ProductFamilyInfo {
  const norm = normalizeText(productName);
  if (!norm) {
    return { exact: '', family: '', variant: 'unknown' };
  }

  const VARIANTS = ['pro max', 'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'fe', 'se'];
  let detectedVariant = 'base';
  let family = norm;

  for (const v of VARIANTS) {
    // Check if variant appears at the end of the product name
    const regex = new RegExp(`\\b${v}$`, 'i');
    if (regex.test(norm)) {
      detectedVariant = v;
      family = norm.replace(regex, '').trim();
      break;
    }
  }

  // Handle generic "series" word removal from family
  family = family.replace(/\bseries\b/g, '').replace(/\s+/g, ' ').trim();

  // Strip leading company brand names to allow matching between "Huawei Mate 90" and "Mate 90"
  const BRAND_PREFIXES = [
    'huawei',
    'apple',
    'samsung',
    'xiaomi',
    'google',
    'honor',
    'garmin',
    'oppo',
    'vivo',
    'oneplus',
    'motorola',
    'sony',
    'redmi',
  ];
  for (const bp of BRAND_PREFIXES) {
    if (family.startsWith(bp + ' ')) {
      family = family.slice(bp.length + 1).trim();
      break;
    }
  }

  return {
    exact: norm,
    family,
    variant: detectedVariant,
  };
}

/**
 * Detects whether an article represents a lifestyle / wellbeing / personal editorial angle
 * rather than a standard technical device review or formal market launch.
 */
export function isLifestyleOrEditorial(article: Article, analysis?: ArticleAnalysis): boolean {
  const combinedText = `${article.title} ${article.excerpt || ''} ${analysis?.summary || ''} ${(analysis?.keyPoints || []).join(' ')}`;
  const norm = normalizeText(combinedText);

  const LIFESTYLE_KEYWORDS = [
    'ευεξια', 'ευεξία', 'wellness', 'wellbeing', 'lifestyle', 'ωραρια', 'ωράρια',
    'ισορροπια', 'ισορροπία', 'stress', 'στρες', 'αγχος', 'άγχος', 'προσωπικη εμπειρια',
    'προσωπική εμπειρία', 'επαγγελματικα', 'καθημερινοτητα', 'καθημερινότητα',
    'worklife balance', 'mindfulness'
  ];

  const hasLifestyleTerms = LIFESTYLE_KEYWORDS.some((kw) => norm.includes(normalizeText(kw)));
  const isLowerImportance = (analysis?.importanceScore || 50) <= 35;

  return hasLifestyleTerms && isLowerImportance;
}

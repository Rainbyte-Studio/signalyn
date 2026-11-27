/**
 * URL Normalization and Cryptographic Content Hashing
 * 
 * Enforces canonical URL purity by stripping marketing telemetry
 * (utm_*, fbclid, gclid, etc.) and generates deterministic SHA-256
 * hashes for idempotent article deduplication.
 */

import crypto from 'crypto';
import { normalizeCanonicalUrl, normalizeWebsiteUrl } from '../utils/urlUtils';
import { normalizeArticleText } from '../utils/textNormalizer';

export { normalizeCanonicalUrl, normalizeWebsiteUrl, normalizeArticleText };

/**
 * Generates a deterministic SHA-256 content hash for an article.
 * Applies Unicode and HTML entity normalization BEFORE hashing so that
 * raw entities and decoded Unicode produce identical content hashes.
 */
export function generateContentHash(
  canonicalUrl: string,
  title: string,
  publishedAt?: string,
  excerpt?: string
): string {
  const normUrl = normalizeCanonicalUrl(canonicalUrl);
  const cleanTitle = normalizeArticleText(title);
  const normTitle = cleanTitle.trim().toLowerCase().replace(/\s+/g, ' ');
  const normDate = (publishedAt || '').slice(0, 10); // Date granularity
  const cleanExcerpt = normalizeArticleText(excerpt);
  const normExcerptSnippet = cleanExcerpt.trim().slice(0, 100).toLowerCase().replace(/\s+/g, ' ');

  const hashInput = `${normUrl}|${normTitle}|${normDate}|${normExcerptSnippet}`;
  return crypto.createHash('sha256').update(hashInput, 'utf8').digest('hex');
}

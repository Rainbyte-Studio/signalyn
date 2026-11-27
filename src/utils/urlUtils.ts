import { Source, SourceFeed, SourceHealth, SourceStatus } from '../types';

/**
 * Universal URL Normalization Utilities
 * Client- and server-safe (no Node.js-only imports).
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'mc_cid',
  'mc_eid',
  'yclid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'igshid',
  'ref',
  'source',
]);

/**
 * Normalizes a website domain or page URL for deduplication and canonical matching.
 * Preserves essential paths while removing query tracking tokens and uniformizing protocol/case.
 */
export function normalizeCanonicalUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  let trimmed = rawUrl.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    
    // Normalize protocol
    parsed.protocol = 'https:';
    
    // Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    // Filter out marketing & telemetry query parameters
    const searchParams = new URLSearchParams(parsed.search);
    const keysToRemove: string[] = [];
    searchParams.forEach((_, key) => {
      const lowerKey = key.toLowerCase();
      if (TRACKING_PARAMS.has(lowerKey) || lowerKey.startsWith('utm_')) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach((k) => searchParams.delete(k));

    // Sort remaining query keys for determinism
    searchParams.sort();
    const cleanSearch = searchParams.toString();
    parsed.search = cleanSearch ? `?${cleanSearch}` : '';

    // Remove hash/fragment
    parsed.hash = '';

    // Normalize path: collapse multi-slashes, strip trailing slash if length > 1
    let pathname = parsed.pathname.replace(/\/+/g, '/');
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return trimmed.split('#')[0].replace(/\/+$/, '');
  }
}

/**
 * Ensures a valid http(s) protocol prefix exists on a user-provided URL.
 * Converts bare domains like 'insomnia.gr' to 'https://insomnia.gr'.
 */
export function ensureHttpProtocol(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let trimmed = rawUrl.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * Extracts a normalized domain identifier (e.g. 'insomnia.gr')
 * Strips protocol, www prefix, path, and port.
 * Allows uniform comparison across insomnia.gr, www.insomnia.gr, https://insomnia.gr, https://www.insomnia.gr/
 */
export function extractNormalizedDomain(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const withProtocol = ensureHttpProtocol(rawUrl);
  try {
    const parsed = new URL(withProtocol);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return rawUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split(':')[0];
  }
}

/**
 * Normalizes a base website domain URL for source duplicate prevention.
 */
export function normalizeWebsiteUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const withProtocol = ensureHttpProtocol(rawUrl);
  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\/+$/, '');
    return `https://${hostname}${pathname}`;
  } catch {
    return rawUrl.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

/**
 * Checks whether two URLs represent the exact same news source domain.
 */
export function isSameSourceDomain(url1: string, url2: string): boolean {
  const d1 = extractNormalizedDomain(url1);
  const d2 = extractNormalizedDomain(url2);
  return Boolean(d1 && d2 && d1 === d2);
}

/**
 * Normalizes a feed endpoint URL for deduplication within the same Source.
 * Strips www, uniformizes protocol to https, strips trailing slashes,
 * and maintains essential query parameters (e.g. ?cat=mobile).
 * E.g.:
 * https://example.com/feed
 * https://example.com/feed/
 * https://www.example.com/feed
 * All normalize to https://example.com/feed
 */
export function normalizeFeedUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const withProtocol = ensureHttpProtocol(rawUrl.trim());
  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname.replace(/\/+/g, '/');
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    const search = parsed.search; // Retain query search if used for category filtering
    return `${parsed.protocol}//${hostname}${pathname}${search}`;
  } catch {
    return rawUrl.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

/**
 * Checks whether two feed URLs represent the exact same endpoint.
 */
export function isSameFeedUrl(url1: string, url2: string): boolean {
  if (!url1 || !url2) return false;
  return normalizeFeedUrl(url1) === normalizeFeedUrl(url2);
}

/**
 * Backward-compatible helper to safely resolve the active feeds of any Source.
 * If the source already has `feeds[]`, returns them.
 * If the source only has legacy `feedUrl`, synthesizes a primary SourceFeed.
 */
export function getSourceFeeds(source: Partial<Source> | null | undefined): SourceFeed[] {
  if (!source) return [];

  if (Array.isArray(source.feeds) && source.feeds.length > 0) {
    return source.feeds;
  }

  // Synthesize backward-compatible single feed if legacy feedUrl exists
  if (source.feedUrl && source.feedUrl.trim()) {
    const defaultFeed: SourceFeed = {
      id: `feed-${source.id || 'default'}-primary`,
      title: source.name ? `${source.name} Feed` : 'Main Feed',
      url: normalizeFeedUrl(source.feedUrl),
      feedType: source.feedType || source.collectionMethod || 'RSS',
      categories: Array.isArray(source.categories) ? source.categories : [],
      coverageRole: 'PRIMARY_COVERAGE',
      status: source.status === 'PAUSED' ? 'PAUSED' : source.status === 'ERROR' ? 'ERROR' : 'ACTIVE',
      isPrimary: true,
      createdAt: source.createdAt || new Date().toISOString(),
      updatedAt: source.updatedAt || new Date().toISOString(),
      lastCollectedAt: source.lastCollectedAt || source.lastCollectionAttempt || null,
      lastSuccessfulCollectionAt: source.lastSuccessfulCollectionAt || source.lastSuccessfulCollection || null,
      failureCount: source.failureCount || source.errorCount || 0,
      articlesCollected: source.articlesCollected || 0,
      lastError: source.lastError || null,
    };
    return [defaultFeed];
  }

  return [];
}

/**
 * Derives a Source's operational health from its feeds' statuses and failure counts.
 * 
 * Rules:
 * - If source status is explicitly PAUSED -> PAUSED
 * - If 0 feeds configured -> NEEDS_CONFIGURATION
 * - If all feeds are PAUSED -> PAUSED
 * - If all active feeds working (0 failures) -> HEALTHY
 * - If at least one active feed working and at least one failing -> DEGRADED
 * - If all active feeds are failing -> ERROR
 */
export function computeSourceHealth(
  feeds?: SourceFeed[] | null,
  sourceStatus?: SourceStatus
): SourceHealth {
  if (sourceStatus === 'PAUSED') return 'PAUSED';
  if (!feeds || feeds.length === 0) return 'NEEDS_CONFIGURATION';

  const nonPausedFeeds = feeds.filter((f) => f.status !== 'PAUSED');
  if (nonPausedFeeds.length === 0) return 'PAUSED';

  const workingFeeds = nonPausedFeeds.filter(
    (f) => f.status === 'ACTIVE' && (f.failureCount === 0 || !f.lastError)
  );
  const brokenFeeds = nonPausedFeeds.filter(
    (f) => f.status === 'ERROR' || f.failureCount > 0
  );

  if (workingFeeds.length > 0 && brokenFeeds.length === 0) {
    return 'HEALTHY';
  }
  if (workingFeeds.length > 0 && brokenFeeds.length > 0) {
    return 'DEGRADED';
  }
  if (workingFeeds.length === 0 && brokenFeeds.length > 0) {
    return 'ERROR';
  }

  return 'HEALTHY';
}


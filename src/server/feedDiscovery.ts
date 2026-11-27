/**
 * Real Server-Side Feed Discovery Service
 * 
 * Inspects websites for RSS/Atom syndication feeds by:
 * 1. Fetching website HTML and parsing <link rel="alternate"> tags
 * 2. Probing common syndication endpoints (/feed, /rss.xml, /atom.xml, etc.)
 * 3. Validating candidate responses for legitimate XML syndication structures
 */

import { CollectionMethod, FeedCoverageRole } from '../types';
import { parseSyndicationXml, ParsedFeed } from './feedParser';
import { normalizeWebsiteUrl } from './urlNormalizer';
import { normalizeFeedUrl } from '../utils/urlUtils';

export interface DiscoveredCandidate {
  url: string;
  title: string;
  type: CollectionMethod;
  entryCount: number;
  confidence: number;
  sampleArticleTitle?: string;
  category?: string;
  coverageRole?: FeedCoverageRole;
  oldestItemDate?: string;
  newestItemDate?: string;
}

export interface DiscoveryResponse {
  status: 'FOUND' | 'SETUP_REQUIRED';
  websiteUrl: string;
  suggestedName: string;
  selectedFeed?: DiscoveredCandidate;
  collectionMethod?: CollectionMethod;
  candidates: DiscoveredCandidate[];
  diagnostics: {
    htmlLinkTagsFound: number;
    endpointsProbed: number;
    responseTimeMs: number;
    notes?: string;
  };
}

const COMMON_ENDPOINTS = [
  '/feed',
  '/feed/',
  '/rss',
  '/rss.xml',
  '/feed.xml',
  '/atom.xml',
  '/index.xml',
  '/articles/?rss=1',
  '/articles/various/insomnia-review/?d=1&rss=1',
  '/rss/15-various-news.xml/',
];

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Signalyn-Crawler/1.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,el;q=0.8',
};

/**
 * Validates whether a candidate URL actually returns a valid RSS/Atom feed.
 */
async function validateCandidateFeed(feedUrl: string, timeoutMs = 8000): Promise<DiscoveredCandidate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(feedUrl, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();

    // Verify it resembles XML or syndication
    if (!text.includes('<rss') && !text.includes('<feed') && !text.includes('<channel') && !contentType.includes('xml')) {
      return null;
    }

    const parsed = parseSyndicationXml(text);
    if (!parsed || parsed.items.length === 0) return null;

    // Detect category / topic heuristics
    let detectedCategory = '';
    const titleLower = (parsed.title || '').toLowerCase();
    const urlLower = feedUrl.toLowerCase();
    if (titleLower.includes('hardware') || urlLower.includes('hardware')) detectedCategory = 'Hardware';
    else if (titleLower.includes('various') || urlLower.includes('various') || titleLower.includes('review') || urlLower.includes('review')) detectedCategory = 'Reviews & Various';
    else if (titleLower.includes('smartphone') || titleLower.includes('mobile') || urlLower.includes('mobile') || urlLower.includes('smartphone')) detectedCategory = 'Smartphones';
    else if (titleLower.includes('game') || urlLower.includes('game')) detectedCategory = 'Gaming';
    else if (titleLower.includes('entertainment') || urlLower.includes('entertainment')) detectedCategory = 'Entertainment';
    else if (titleLower.includes('tech') || urlLower.includes('tech')) detectedCategory = 'Technology';
    else if (titleLower.includes('telecom') || urlLower.includes('telecom') || urlLower.includes('provider')) detectedCategory = 'Telecom & Providers';
    else if (titleLower.includes('apple') || urlLower.includes('apple')) detectedCategory = 'Apple Ecosystem';
    else if (titleLower.includes('google') || urlLower.includes('google')) detectedCategory = 'Google Ecosystem';
    else if (titleLower.includes('microsoft') || urlLower.includes('microsoft')) detectedCategory = 'Microsoft Ecosystem';
    else if (titleLower.includes('os') || titleLower.includes('browser') || urlLower.includes('os')) detectedCategory = 'Software & OS';
    else if (titleLower.includes('software') || urlLower.includes('software')) detectedCategory = 'Software';
    else if (titleLower.includes('internet') || urlLower.includes('internet')) detectedCategory = 'Internet & Web';
    else if (titleLower.includes('transport') || urlLower.includes('transport')) detectedCategory = 'Transport & EV';
    else if (titleLower.includes('space') || urlLower.includes('space')) detectedCategory = 'Space & Science';
    else if (parsed.items[0]?.categories && parsed.items[0].categories.length > 0) {
      detectedCategory = parsed.items[0].categories[0];
    }

    // Determine oldest and newest item publication dates
    const dates = parsed.items.map((it) => it.publishedAt).filter(Boolean).sort();
    const oldestItemDate = dates[0] || undefined;
    const newestItemDate = dates[dates.length - 1] || undefined;

    // Infer Feed Coverage Role (Requirement 8)
    let coverageRole: FeedCoverageRole = 'CATEGORY';
    if (
      titleLower.includes('all') ||
      titleLower.includes('main') ||
      titleLower.includes('latest news') ||
      titleLower.includes('frontpage') ||
      titleLower.trim() === 'ειδήσεις' ||
      (!titleLower.includes(':') && titleLower.includes('ειδήσεις')) ||
      urlLower.includes('/articles?rss=1') ||
      urlLower.includes('/articles/?rss=1') ||
      urlLower.endsWith('/feed') ||
      urlLower.endsWith('/rss') ||
      urlLower.includes('all-news')
    ) {
      coverageRole = 'PRIMARY_COVERAGE';
    } else if (
      titleLower.includes('entertainment') ||
      titleLower.includes('game') ||
      titleLower.includes('space') ||
      titleLower.includes('offers') ||
      titleLower.includes('προσφορές') ||
      titleLower.includes('μπλα')
    ) {
      coverageRole = 'SUPPLEMENTAL';
    }

    return {
      url: feedUrl,
      title: parsed.title || 'Syndication Feed',
      type: parsed.type,
      entryCount: parsed.items.length,
      confidence: parsed.items.length > 5 ? 0.95 : 0.8,
      sampleArticleTitle: parsed.items[0]?.title,
      category: detectedCategory || undefined,
      coverageRole,
      oldestItemDate,
      newestItemDate,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates a single user-supplied feed endpoint URL.
 */
export async function validateFeedEndpoint(
  feedUrl: string
): Promise<{ valid: boolean; candidate?: DiscoveredCandidate; error?: string }> {
  const norm = normalizeFeedUrl(feedUrl);
  if (!norm) return { valid: false, error: 'Feed URL is empty or invalid.' };

  try {
    const candidate = await validateCandidateFeed(norm, 10000);
    if (!candidate) {
      return {
        valid: false,
        error: 'Endpoint did not return a valid RSS or Atom XML syndication document.',
      };
    }
    return { valid: true, candidate };
  } catch (err: unknown) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Feed validation failed.',
    };
  }
}

/**
 * Discovers RSS/Atom feeds from a website URL.
 */
export async function discoverWebsiteFeeds(websiteInput: string): Promise<DiscoveryResponse> {
  const startTime = Date.now();
  const normalizedUrl = normalizeWebsiteUrl(websiteInput);

  let targetUrlObj: URL;
  try {
    targetUrlObj = new URL(normalizedUrl);
  } catch {
    throw new Error(`Invalid URL format: "${websiteInput}"`);
  }

  // Derive suggested name from domain
  const hostParts = targetUrlObj.hostname.replace(/^www\./, '').split('.');
  const rawBrand = hostParts[0] || 'Source';
  const suggestedName = rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1);

  const discoveredCandidates: DiscoveredCandidate[] = [];
  const candidateUrlsToProbe = new Set<string>();

  // 1. Fetch the website HTML
  let htmlLinkTagsFound = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const htmlRes = await fetch(targetUrlObj.toString(), {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (htmlRes.ok) {
      const htmlText = await htmlRes.text();

      // Check if the URL provided was directly an XML feed
      if (htmlText.includes('<rss') || (htmlText.includes('<feed') && htmlText.includes('xmlns="http://www.w3.org/2005/Atom"'))) {
        try {
          const directFeed = parseSyndicationXml(htmlText);
          if (directFeed.items.length > 0) {
            return {
              status: 'FOUND',
              websiteUrl: targetUrlObj.origin,
              suggestedName: directFeed.title || suggestedName,
              selectedFeed: {
                url: targetUrlObj.toString(),
                title: directFeed.title,
                type: directFeed.type,
                entryCount: directFeed.items.length,
                confidence: 1.0,
                sampleArticleTitle: directFeed.items[0]?.title,
              },
              candidates: [{
                url: targetUrlObj.toString(),
                title: directFeed.title,
                type: directFeed.type,
                entryCount: directFeed.items.length,
                confidence: 1.0,
                sampleArticleTitle: directFeed.items[0]?.title,
              }],
              diagnostics: {
                htmlLinkTagsFound: 0,
                endpointsProbed: 0,
                responseTimeMs: Date.now() - startTime,
                notes: 'Target URL is directly a syndication feed endpoint.',
              },
            };
          }
        } catch {
          // continue
        }
      }

      // Regex parse <link rel="alternate" ...>
      const linkRegex = /<link\s+[^>]*rel=["']alternate["'][^>]*>/gi;
      const matches = htmlText.match(linkRegex) || [];

      for (const linkTag of matches) {
        const isRssOrAtom = /type=["']application\/(rss\+xml|atom\+xml)["']/i.test(linkTag);
        if (isRssOrAtom) {
          const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
          if (hrefMatch && hrefMatch[1]) {
            try {
              const resolvedUrl = new URL(hrefMatch[1], targetUrlObj.origin).toString();
              candidateUrlsToProbe.add(resolvedUrl);
              htmlLinkTagsFound++;
            } catch {
              // ignore malformed href
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Could not fetch HTML from ${targetUrlObj.origin}:`, err);
  }

  // 2. Add common known endpoints to probe
  for (const endpoint of COMMON_ENDPOINTS) {
    try {
      const candidate = new URL(endpoint, targetUrlObj.origin).toString();
      candidateUrlsToProbe.add(candidate);
    } catch {
      // ignore
    }
  }

  // 3. Concurrently validate candidate endpoints (probe up to 24 candidates)
  const probeList = Array.from(candidateUrlsToProbe).slice(0, 24);
  const validationPromises = probeList.map((url) => validateCandidateFeed(url));
  const validationResults = await Promise.allSettled(validationPromises);

  for (const res of validationResults) {
    if (res.status === 'fulfilled' && res.value) {
      // Avoid duplicate URLs
      if (!discoveredCandidates.some((c) => c.url === res.value!.url)) {
        discoveredCandidates.push(res.value);
      }
    }
  }

  // Sort by confidence and entry count
  discoveredCandidates.sort((a, b) => b.confidence - a.confidence || b.entryCount - a.entryCount);

  const duration = Date.now() - startTime;

  if (discoveredCandidates.length > 0) {
    return {
      status: 'FOUND',
      websiteUrl: targetUrlObj.origin,
      suggestedName,
      selectedFeed: discoveredCandidates[0],
      collectionMethod: discoveredCandidates[0].type,
      candidates: discoveredCandidates,
      diagnostics: {
        htmlLinkTagsFound,
        endpointsProbed: probeList.length,
        responseTimeMs: duration,
        notes: `Successfully discovered ${discoveredCandidates.length} valid feed candidate(s).`,
      },
    };
  }

  return {
    status: 'SETUP_REQUIRED',
    websiteUrl: targetUrlObj.origin,
    suggestedName,
    collectionMethod: 'UNKNOWN',
    candidates: [],
    diagnostics: {
      htmlLinkTagsFound,
      endpointsProbed: probeList.length,
      responseTimeMs: duration,
      notes: 'No automated RSS/Atom endpoint detected. Manual feed URL entry required.',
    },
  };
}

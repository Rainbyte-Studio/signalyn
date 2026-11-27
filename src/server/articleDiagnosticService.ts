/**
 * Signalyn Missing Article Diagnostic Service
 * 
 * Diagnoses why a specific article was not ingested by Signalyn:
 * 1. Checks if already stored in /articles (canonicalUrl, title, contentHash)
 * 2. Checks if exposed in any currently configured feeds (active or paused)
 * 3. Checks if exposed in any discoverable but unconfigured feeds on the publication
 * 4. Compares publication date with RSS history window (identifies HISTORICAL_FEED_LIMIT)
 * 5. Returns structured diagnostic status enum and human-readable explanation
 */

import { getServerDb } from './serverFirestoreAdapter';
import {
  Article,
  Source,
  SourceFeed,
  ArticleDiagnosticReport,
  ArticleDiagnosisStatus,
} from '../types';
import { normalizeCanonicalUrl } from './urlNormalizer';
import {
  extractNormalizedDomain,
  normalizeFeedUrl,
  getSourceFeeds,
} from '../utils/urlUtils';
import { parseSyndicationXml } from './feedParser';
import { discoverWebsiteFeeds, DiscoveredCandidate } from './feedDiscovery';

export async function diagnoseArticleUrl(
  inputUrl: string,
  sourceIdHint?: string
): Promise<ArticleDiagnosticReport> {
  const rawUrl = inputUrl.trim();
  if (!rawUrl) {
    throw new Error('Article URL is required.');
  }

  const normalizedUrl = normalizeCanonicalUrl(rawUrl);
  const targetDomain = extractNormalizedDomain(rawUrl);
  const db = getServerDb();

  // 1. Check Firestore /articles for exact canonical URL or content match
  const snapByCanon = await db.collection('articles')
    .where('canonicalUrl', '==', normalizedUrl)
    .limit(1)
    .get();

  if (!snapByCanon.empty) {
    const existing = snapByCanon.docs[0].data() as Article;
    return {
      targetUrl: rawUrl,
      normalizedUrl,
      status: 'ALREADY_INGESTED',
      headline: 'Article Already Ingested in /articles',
      explanation: `Article already exists but may be hidden by current Feed filters (e.g. date, category, or search query). Document ID: "${existing.id}", Title: "${existing.title}", Published: ${new Date(existing.publishedAt).toLocaleString()}.`,
      articleId: existing.id,
      foundArticleTitle: existing.title,
      publishedAt: existing.publishedAt,
      sourceId: existing.sourceId,
      sourceName: existing.sourceName,
      matchedFeedTitle: existing.feedTitle,
      suggestedAction: 'Clear active UI feed filters or search by title.',
    };
  }

  // Also check normalized URL without trailing slash if different (bounded single query, P1.3)
  const altUrl = normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : `${normalizedUrl}/`;
  const snapAlt = await db.collection('articles')
    .where('canonicalUrl', '==', altUrl)
    .limit(1)
    .get();
  if (!snapAlt.empty) {
    const existing = snapAlt.docs[0].data() as Article;
    return {
      targetUrl: rawUrl,
      normalizedUrl,
      status: 'ALREADY_INGESTED',
      headline: 'Article Already Ingested in /articles',
      explanation: `Article already exists in Signalyn. Document ID: "${existing.id}", Title: "${existing.title}", Published: ${new Date(existing.publishedAt).toLocaleString()}.`,
      articleId: existing.id,
      foundArticleTitle: existing.title,
      publishedAt: existing.publishedAt,
      sourceId: existing.sourceId,
      sourceName: existing.sourceName,
      matchedFeedTitle: existing.feedTitle,
      suggestedAction: 'Clear active UI feed filters or search by title.',
    };
  }

  // 2. Resolve target publication / Source
  let targetSource: Source | null = null;
  if (sourceIdHint) {
    const sDoc = await db.collection('sources').doc(sourceIdHint).get();
    if (sDoc.exists) {
      targetSource = sDoc.data() as Source;
    }
  }

  if (!targetSource) {
    const sourcesSnap = await db.collection('sources').get();
    sourcesSnap.forEach((d) => {
      const s = d.data() as Source;
      if (
        extractNormalizedDomain(s.websiteUrl) === targetDomain ||
        s.normalizedDomain === targetDomain
      ) {
        targetSource = s;
      }
    });
  }

  if (!targetSource) {
    return {
      targetUrl: rawUrl,
      normalizedUrl,
      status: 'NO_SYNDICATION_COVERAGE',
      headline: 'Source Publication Not Registered',
      explanation: `No registered source in Signalyn corresponds to domain "${targetDomain}". Register this publication first to enable RSS syndication.`,
      suggestedAction: `Register "${targetDomain}" in Sources Manager.`,
    };
  }

  const configuredFeeds = getSourceFeeds(targetSource);

  // 3. Inspect currently configured feeds of this source
  let oldestConfiguredDate: string | null = null;
  let newestConfiguredDate: string | null = null;

  for (const feed of configuredFeeds) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Signalyn-Diagnostic/1.0',
          Accept: 'application/rss+xml, application/atom+xml, text/xml, */*',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseSyndicationXml(text);

      const dates = parsed.items.map((it) => it.publishedAt).filter(Boolean).sort();
      if (dates.length > 0) {
        if (!oldestConfiguredDate || dates[0] < oldestConfiguredDate) oldestConfiguredDate = dates[0];
        if (!newestConfiguredDate || dates[dates.length - 1] > newestConfiguredDate) newestConfiguredDate = dates[dates.length - 1];
      }

      // Check if target article is present in this configured feed
      const foundItem = parsed.items.find(
        (it) =>
          normalizeCanonicalUrl(it.link) === normalizedUrl ||
          it.link.includes(normalizedUrl) ||
          normalizedUrl.includes(normalizeCanonicalUrl(it.link))
      );

      if (foundItem) {
        if (feed.status === 'ACTIVE') {
          return {
            targetUrl: rawUrl,
            normalizedUrl,
            status: 'LIVE_FEED_AVAILABLE',
            headline: `Exposed in Configured Feed: "${feed.title}"`,
            explanation: `The article is actively exposed as item in configured feed "${feed.title}" (published: ${foundItem.publishedAt ? new Date(foundItem.publishedAt).toLocaleString() : 'N/A'}), but has not yet completed an ingestion cycle.`,
            matchedFeedTitle: feed.title,
            matchedFeedUrl: feed.url,
            feedStatus: feed.status,
            isFeedConfigured: true,
            sourceId: targetSource.id,
            sourceName: targetSource.name,
            publishedAt: foundItem.publishedAt,
            suggestedAction: `Click "Collect Now" for feed "${feed.title}" in Source Detail.`,
          };
        } else {
          return {
            targetUrl: rawUrl,
            normalizedUrl,
            status: 'INGESTION_ERROR',
            headline: `Found in Configured Feed "${feed.title}", but Feed is ${feed.status}`,
            explanation: `The article exists in "${feed.title}", but this feed is currently ${feed.status}${feed.lastError ? ` (Error: ${feed.lastError})` : ''}.`,
            matchedFeedTitle: feed.title,
            matchedFeedUrl: feed.url,
            feedStatus: feed.status,
            isFeedConfigured: true,
            sourceId: targetSource.id,
            sourceName: targetSource.name,
            publishedAt: foundItem.publishedAt,
            suggestedAction: `Enable or retry feed "${feed.title}" in Source Detail.`,
          };
        }
      }
    } catch {
      // Continue inspecting other feeds
    }
  }

  // 4. Run discovery to check unconfigured feeds on the publication
  let discoveredCandidates: DiscoveredCandidate[] = [];
  try {
    const discoveryResult = await discoverWebsiteFeeds(targetSource.websiteUrl);
    discoveredCandidates = discoveryResult.candidates || [];
  } catch {
    // Continue
  }

  const configuredUrls = new Set(configuredFeeds.map((f) => normalizeFeedUrl(f.url)));
  const unconfiguredCandidates = discoveredCandidates.filter(
    (c) => !configuredUrls.has(normalizeFeedUrl(c.url))
  );

  // Sort candidates so that feeds matching the article's URL section (e.g. "review") or broad feeds are checked first
  const rawUrlLower = rawUrl.toLowerCase();
  unconfiguredCandidates.sort((a, b) => {
    const aTitle = (a.title || '').toLowerCase();
    const bTitle = (b.title || '').toLowerCase();
    const aUrl = (a.url || '').toLowerCase();
    const bUrl = (b.url || '').toLowerCase();

    let aScore = 0;
    let bScore = 0;

    if (rawUrlLower.includes('review') && (aTitle.includes('review') || aUrl.includes('review'))) aScore += 10;
    if (rawUrlLower.includes('review') && (bTitle.includes('review') || bUrl.includes('review'))) bScore += 10;
    if (a.coverageRole === 'PRIMARY_COVERAGE') aScore += 5;
    if (b.coverageRole === 'PRIMARY_COVERAGE') bScore += 5;

    return bScore - aScore;
  });

  for (const candidate of unconfiguredCandidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(candidate.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Signalyn-Diagnostic/1.0',
          Accept: 'application/rss+xml, application/atom+xml, text/xml, */*',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseSyndicationXml(text);

      const foundItem = parsed.items.find(
        (it) =>
          normalizeCanonicalUrl(it.link) === normalizedUrl ||
          it.link.includes(normalizedUrl) ||
          normalizedUrl.includes(normalizeCanonicalUrl(it.link))
      );

      if (foundItem) {
        return {
          targetUrl: rawUrl,
          normalizedUrl,
          status: 'LIVE_FEED_AVAILABLE',
          headline: `Exposed in Unconfigured Feed: "${candidate.title}"`,
          explanation: `The article is live right now in feed "${candidate.title}" (${candidate.url}), which is published by ${targetSource.name} but not currently configured in Signalyn. Adding this feed will ingest this article and expand coverage.`,
          matchedFeedTitle: candidate.title,
          matchedFeedUrl: candidate.url,
          isFeedConfigured: false,
          sourceId: targetSource.id,
          sourceName: targetSource.name,
          publishedAt: foundItem.publishedAt,
          feedOldestItemDate: candidate.oldestItemDate,
          feedNewestItemDate: candidate.newestItemDate,
          suggestedAction: `Add "${candidate.title}" to ${targetSource.name} in Feeds Management.`,
        };
      }
    } catch {
      // Continue
    }
  }

  // 5. Check if article exists on web but falls outside RSS history window
  let articlePublishedDate: string | null = null;
  try {
    const pageRes = await fetch(rawUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Signalyn-Diagnostic/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const dateMatch =
        html.match(/datePublished[\"']:\s*[\"']([^\"']+)[\"']/i) ||
        html.match(/property=[\"']article:published_time[\"']\s+content=[\"']([^\"']+)[\"']/i) ||
        html.match(/itemprop=[\"']datePublished[\"']\s+content=[\"']([^\"']+)[\"']/i) ||
        html.match(/<time[^>]+datetime=[\"']([^\"']+)[\"']/i);
      if (dateMatch && dateMatch[1]) {
        articlePublishedDate = new Date(dateMatch[1]).toISOString();
      }
    }
  } catch {
    // Continue
  }

  if (articlePublishedDate && oldestConfiguredDate && articlePublishedDate < oldestConfiguredDate) {
    return {
      targetUrl: rawUrl,
      normalizedUrl,
      status: 'HISTORICAL_FEED_LIMIT',
      headline: 'Article Falls Outside Historical RSS Window',
      explanation: `This article was published on ${new Date(articlePublishedDate).toLocaleDateString()}, which is older than the oldest item currently retained in ${targetSource.name}'s syndication feeds (${new Date(oldestConfiguredDate).toLocaleDateString()}). Standard RSS feeds only expose the most recent ~25-50 items.`,
      sourceId: targetSource.id,
      sourceName: targetSource.name,
      publishedAt: articlePublishedDate,
      feedOldestItemDate: oldestConfiguredDate,
      feedNewestItemDate: newestConfiguredDate || undefined,
      suggestedAction: 'Candidate for future Historical Backfill (sitemap / archive crawler).',
    };
  }

  return {
    targetUrl: rawUrl,
    normalizedUrl,
    status: 'NO_SYNDICATION_COVERAGE',
    headline: 'No Syndication Coverage Detected',
    explanation: `This article does not appear in any active, paused, or discoverable RSS/Atom feeds for ${targetSource.name}. The publication does not syndicate this section via RSS.`,
    sourceId: targetSource.id,
    sourceName: targetSource.name,
    publishedAt: articlePublishedDate || undefined,
    suggestedAction: 'Candidate for future custom web scrapers or category sitemaps.',
  };
}

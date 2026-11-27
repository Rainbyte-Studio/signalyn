/**
 * Signalyn Feed Discovery Service
 * 
 * Invokes the server-side feed discovery endpoint (/api/discovery/inspect)
 * to perform real HTML parsing, <link rel="alternate"> inspection,
 * and candidate endpoint probing.
 */

import { CollectionMethod, FeedCoverageRole, ArticleDiagnosticReport } from '../types';
import { getAuthorizedApiHeaders } from './apiSessionClient';

export interface FeedCandidate {
  url: string;
  title: string;
  type: CollectionMethod;
  confidence: number;
  entryCount?: number;
  sampleArticleTitle?: string;
  category?: string;
  coverageRole?: FeedCoverageRole;
  oldestItemDate?: string;
  newestItemDate?: string;
}

export interface FeedDiscoveryResult {
  status: 'FOUND' | 'SETUP_REQUIRED';
  websiteUrl: string;
  suggestedName?: string;
  suggestedFeedUrl?: string;
  collectionMethod: CollectionMethod;
  candidates: FeedCandidate[];
  notice: string;
  isLiveScrapingActive: boolean;
  diagnostics?: {
    htmlLinkTagsFound: number;
    endpointsProbed: number;
    responseTimeMs: number;
    notes?: string;
  };
}

export interface IFeedDiscoveryService {
  inspectWebsite(websiteUrl: string): Promise<FeedDiscoveryResult>;
  validateFeedUrl(feedUrl: string): Promise<{ valid: boolean; candidate?: FeedCandidate; error?: string }>;
  diagnoseArticle(url: string, sourceId?: string): Promise<ArticleDiagnosticReport>;
}

export class RealFeedDiscoveryService implements IFeedDiscoveryService {
  async validateFeedUrl(feedUrl: string): Promise<{ valid: boolean; candidate?: FeedCandidate; error?: string }> {
    const trimmed = feedUrl.trim();
    if (!trimmed) {
      return { valid: false, error: 'Feed URL cannot be empty.' };
    }

    try {
      const authHeaders = await getAuthorizedApiHeaders();
      const response = await fetch('/api/discovery/validate', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl: trimmed }),
        signal: AbortSignal.timeout(12000),
      });

      const data = await response.json();
      if (!response.ok || !data.valid) {
        return { valid: false, error: data.error || 'Feed URL validation failed.' };
      }

      return {
        valid: true,
        candidate: data.candidate,
      };
    } catch (err: unknown) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Network failure validating feed.',
      };
    }
  }

  async inspectWebsite(websiteUrl: string): Promise<FeedDiscoveryResult> {
    const trimmed = websiteUrl.trim();
    if (!trimmed) {
      throw new Error('Please enter a valid website URL.');
    }

    try {
      const authHeaders = await getAuthorizedApiHeaders();
      const response = await fetch('/api/discovery/inspect', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ websiteUrl: trimmed }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned HTTP ${response.status}`);
      }

      const data = await response.json();

      const candidates: FeedCandidate[] = (data.candidates || []).map((c: any) => ({
        url: c.url,
        title: c.title,
        type: c.type || 'RSS',
        confidence: c.confidence || 0.8,
        entryCount: c.entryCount,
        sampleArticleTitle: c.sampleArticleTitle,
        category: c.category,
        coverageRole: c.coverageRole,
        oldestItemDate: c.oldestItemDate,
        newestItemDate: c.newestItemDate,
      }));

      const topCandidate = data.selectedFeed || candidates[0];

      return {
        status: data.status === 'FOUND' ? 'FOUND' : 'SETUP_REQUIRED',
        websiteUrl: data.websiteUrl || trimmed,
        suggestedName: data.suggestedName,
        suggestedFeedUrl: topCandidate?.url,
        collectionMethod: topCandidate?.type || 'RSS',
        candidates,
        notice: data.status === 'FOUND'
          ? `Discovered ${candidates.length} live syndication feed(s) from ${data.websiteUrl}.`
          : 'No automated RSS/Atom endpoint detected from HTML links or standard endpoints. Please supply feed URL manually.',
        isLiveScrapingActive: true,
        diagnostics: data.diagnostics,
      };
    } catch (err: unknown) {
      console.warn('Real server feed discovery fallback:', err);

      // Graceful fallback heuristics if network fails
      let fullUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') 
        ? trimmed 
        : `https://${trimmed}`;
      let cleanOrigin = fullUrl;
      try {
        cleanOrigin = new URL(fullUrl).origin;
      } catch {
        // ignore
      }

      return {
        status: 'SETUP_REQUIRED',
        websiteUrl: cleanOrigin,
        suggestedName: cleanOrigin.replace(/^https?:\/\//, '').split('.')[0],
        suggestedFeedUrl: `${cleanOrigin}/feed/`,
        collectionMethod: 'RSS',
        candidates: [
          {
            url: `${cleanOrigin}/feed/`,
            title: 'Common WordPress / CMS Feed',
            type: 'RSS',
            confidence: 0.6,
          },
          {
            url: `${cleanOrigin}/rss.xml`,
            title: 'Generic RSS Feed',
            type: 'RSS',
            confidence: 0.5,
          },
        ],
        notice: `Feed inspection note: ${err instanceof Error ? err.message : 'Could not query backend inspector'}. Please verify feed URL manually.`,
        isLiveScrapingActive: false,
      };
    }
  }

  async diagnoseArticle(url: string, sourceId?: string): Promise<ArticleDiagnosticReport> {
    const trimmed = url.trim();
    if (!trimmed) {
      throw new Error('Please enter an article URL.');
    }

    const authHeaders = await getAuthorizedApiHeaders();
    const response = await fetch('/api/discovery/diagnose-article', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmed, sourceId }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Diagnosis failed with HTTP ${response.status}`);
    }

    return await response.json();
  }
}

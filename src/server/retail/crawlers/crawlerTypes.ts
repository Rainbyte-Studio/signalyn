/**
 * Signalyn Retail Price Intelligence - Crawler Types (Phase P1.0)
 * 
 * Modular interfaces for autonomous category crawling and structured product discovery.
 */

import {
  RetailSourceId,
  RetailCategory,
  StockStatus,
  MatchConfidenceLevel,
  RetailCrawlerStrategy,
} from '../../../types/retailPrice';

export interface CrawlOptions {
  maxPages: number;
  maxProducts: number;
  requestDelaySeconds: number;
  timeoutSeconds: number;
  strategy: RetailCrawlerStrategy;
  simulatedPages?: Record<number, string>; // For offline/unit test execution
}

export interface ExtractedProductRecord {
  retailerId: RetailSourceId;
  retailerSku: string;
  sourceUrl: string;
  title: string;
  brand: string;
  model?: string;
  category: RetailCategory;
  priceCents: number; // Integer EUR cents strictly > 0
  referencePriceCents?: number | null;
  currency: 'EUR';
  isAvailable: boolean;
  stockStatus: StockStatus;
  imageUrl?: string;
  ean?: string;
  extractedAt: string;
  isLiveVerified: boolean;
  pageNumber: number;
  rawSchema?: Record<string, unknown>;
}

export interface PageCrawlResult {
  pageNumber: number;
  pageUrl: string;
  httpStatus: number;
  serverHeader?: string;
  success: boolean;
  isTerminalBlocked: boolean; // true if 401/403 or WAF challenge encountered
  error?: string;
  products: ExtractedProductRecord[];
  nextPageUrl?: string;
  hasNextPage: boolean;
  durationMs: number;
}

export interface CategoryCrawlSummary {
  retailerId: RetailSourceId;
  category: RetailCategory;
  startUrl: string;
  strategy: RetailCrawlerStrategy;
  extractionStrategyUsed?: string;
  status: 'COMPLETED' | 'PARTIAL' | 'ACCESS_BLOCKED' | 'FAILED';
  pagesCrawled: number;
  totalProductsExtracted: number;
  uniqueSkusExtracted: number;
  failedPages: number;
  durationMs: number;
  products: ExtractedProductRecord[];
  errors: string[];
}

export interface RetailerCrawlerAdapter {
  retailerId: RetailSourceId;
  name: string;
  supportsCategory(category: RetailCategory): boolean;
  buildPageUrl(baseUrl: string, pageNumber: number): string;
  extractFromHtml(
    pageUrl: string,
    html: string,
    category: RetailCategory,
    pageNumber: number
  ): {
    products: ExtractedProductRecord[];
    nextPageUrl?: string;
    hasNextPage: boolean;
  };
  extractDynamicFromPage?(
    pageUrl: string,
    html: string,
    category: RetailCategory,
    pageNumber: number,
    timeoutSeconds?: number
  ): Promise<{
    products: ExtractedProductRecord[];
    nextPageUrl?: string;
    hasNextPage: boolean;
    extractionStrategy: string;
    totalCount?: number;
    errors?: string[];
  }>;
}

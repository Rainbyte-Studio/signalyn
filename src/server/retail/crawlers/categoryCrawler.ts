/**
 * Signalyn Retail Price Intelligence - Category Crawler (Phase P1.0)
 * 
 * Modular server-side category crawler orchestrator.
 * Traverses category pagination, enforces deduplication, rate limiting,
 * safe timeouts, and fail-closed handling on perimeter access denial.
 */

import {
  RetailSourceId,
  RetailCategory,
  RetailCrawlerStrategy,
} from '../../../types/retailPrice';
import {
  CrawlOptions,
  CategoryCrawlSummary,
  ExtractedProductRecord,
  RetailerCrawlerAdapter,
} from './crawlerTypes';
import { CrawlerDriver } from './crawlerDriver';
import { PlaisioCrawlerAdapter } from './plaisioCrawlerAdapter';
import { PublicCrawlerAdapter } from './publicCrawlerAdapter';
import { KotsovolosCrawlerAdapter } from './kotsovolosCrawlerAdapter';

export class CategoryCrawler {
  private static adapters: Map<RetailSourceId, RetailerCrawlerAdapter> = new Map<RetailSourceId, RetailerCrawlerAdapter>([
    ['plaisio-gr', new PlaisioCrawlerAdapter()],
    ['public-gr', new PublicCrawlerAdapter()],
    ['kotsovolos-gr', new KotsovolosCrawlerAdapter()],
  ]);

  /**
   * Retrieves registered adapter for a retailer
   */
  public static getAdapter(retailerId: RetailSourceId): RetailerCrawlerAdapter {
    const adapter = this.adapters.get(retailerId);
    if (!adapter) {
      throw new Error(`Unsupported retailer crawler adapter for: ${retailerId}`);
    }
    return adapter;
  }

  /**
   * Crawls category pages starting from startUrl up to maxPages or maxProducts.
   */
  public static async crawlCategory(
    retailerId: RetailSourceId,
    category: RetailCategory,
    startUrl: string,
    options: CrawlOptions
  ): Promise<CategoryCrawlSummary> {
    const startTime = Date.now();
    const adapter = this.getAdapter(retailerId);

    const maxPages = Math.max(1, Math.min(options.maxPages || 2, 10)); // Bounded 1-10
    const maxProducts = Math.max(5, Math.min(options.maxProducts || 50, 200)); // Bounded 5-200
    const delaySec = Math.max(1, Math.min(options.requestDelaySeconds || 3, 10));
    const timeoutSec = Math.max(3, Math.min(options.timeoutSeconds || 12, 30));
    const strategy: RetailCrawlerStrategy = options.strategy || 'AUTO';

    const visitedUrls = new Set<string>();
    const seenSkus = new Set<string>();
    const extractedProducts: ExtractedProductRecord[] = [];
    const errors: string[] = [];
    let failedPages = 0;
    let status: CategoryCrawlSummary['status'] = 'COMPLETED';
    let extractionStrategyUsed: string =
      retailerId === 'plaisio-gr' ? 'STRUCTURED_DATA_JSON_LD' : 'STATIC_HTML_STRUCTURED';

    let currentUrl: string | undefined = startUrl;
    let pageNum = 1;
    let firstPageHtml: string | undefined;

    while (currentUrl && pageNum <= maxPages && extractedProducts.length < maxProducts) {
      if (visitedUrls.has(currentUrl)) {
        break; // Prevent infinite loops or circular redirects
      }
      visitedUrls.add(currentUrl);

      // 1. Fetch HTML (handling simulated test fixtures if provided)
      let html: string | undefined;

      if (options.simulatedPages && options.simulatedPages[pageNum]) {
        html = options.simulatedPages[pageNum];
      } else {
        const fetchResult = await CrawlerDriver.fetchPage(currentUrl, strategy, timeoutSec);

        if (fetchResult.isTerminalBlocked) {
          status = 'ACCESS_BLOCKED';
          extractionStrategyUsed = 'BLOCKED_PERIMETER_WAF';
          errors.push(fetchResult.error || `HTTP ${fetchResult.httpStatus} Access Blocked`);
          failedPages++;
          break; // Stop crawl immediately on perimeter block — never attempt WAF bypass
        }

        if (!fetchResult.html || fetchResult.httpStatus >= 400) {
          failedPages++;
          errors.push(fetchResult.error || `Page ${pageNum} failed with status ${fetchResult.httpStatus}`);
          // Try pattern-based next page if not the last page
          if (pageNum < maxPages) {
            currentUrl = adapter.buildPageUrl(startUrl, pageNum + 1);
            pageNum++;
            await CrawlerDriver.delay(delaySec);
            continue;
          }
          break;
        }

        html = fetchResult.html;
        if (pageNum === 1 && html) {
          firstPageHtml = html;
        }
      }

      if (!html) break;

      // 2. Extract products using AUTO progression:
      //    Step A: Structured data (JSON-LD / #StructuredDataItemListB2C) & Static HTML
      //    Step B: Retailer legitimate dynamic state endpoint (Next.js PLP / Angular Category state)
      //    Step C: Playwright browser rendering if permitted and available
      try {
        let extraction = adapter.extractFromHtml(currentUrl, html, category, pageNum);
        if (extraction.products.length > 0) {
          extractionStrategyUsed =
            retailerId === 'plaisio-gr' ? 'STRUCTURED_DATA_JSON_LD' : 'STATIC_HTML_STRUCTURED';
        }

        const allowDynamicFallback =
          !options.simulatedPages &&
          (strategy === 'AUTO' || strategy === 'DYNAMIC_STATE' || strategy === 'STATIC_FETCH');

        if (extraction.products.length === 0 && allowDynamicFallback && adapter.extractDynamicFromPage) {
          const dynamicResult = await adapter.extractDynamicFromPage(
            currentUrl,
            html || firstPageHtml || '',
            category,
            pageNum,
            timeoutSec
          );

          if (dynamicResult.products.length > 0) {
            extraction = {
              products: dynamicResult.products,
              nextPageUrl: dynamicResult.nextPageUrl,
              hasNextPage: dynamicResult.hasNextPage,
            };
            extractionStrategyUsed = dynamicResult.extractionStrategy;
          } else if (dynamicResult.errors && dynamicResult.errors.length > 0) {
            errors.push(...dynamicResult.errors);
          }
        }

        // Step C: Browser rendering fallback if still 0 products and permitted
        if (
          extraction.products.length === 0 &&
          !options.simulatedPages &&
          (strategy === 'AUTO' || strategy === 'BROWSER_AUTOMATION')
        ) {
          const browserRes = await CrawlerDriver.tryBrowserRender(currentUrl, timeoutSec);
          if (browserRes && !browserRes.isTerminalBlocked && browserRes.html) {
            const browserExtract = adapter.extractFromHtml(currentUrl, browserRes.html, category, pageNum);
            if (browserExtract.products.length > 0) {
              extraction = browserExtract;
              extractionStrategyUsed = 'PLAYWRIGHT_BROWSER_RENDER';
            }
          }
        }

        for (const item of extraction.products) {
          if (!seenSkus.has(item.retailerSku)) {
            seenSkus.add(item.retailerSku);
            extractedProducts.push(item);
            if (extractedProducts.length >= maxProducts) {
              break;
            }
          }
        }

        // 3. Resolve next page
        if (extraction.hasNextPage && extraction.nextPageUrl && !visitedUrls.has(extraction.nextPageUrl)) {
          currentUrl = extraction.nextPageUrl;
        } else if (extraction.hasNextPage) {
          const candidateNext = adapter.buildPageUrl(startUrl, pageNum + 1);
          currentUrl = !visitedUrls.has(candidateNext) ? candidateNext : undefined;
        } else {
          currentUrl = undefined; // Natural end of pagination reached
        }
      } catch (err: unknown) {
        failedPages++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Extraction error on page ${pageNum}: ${msg}`);
        break;
      }

      pageNum++;

      // Polite request delay before next page request (if more pages remain)
      if (currentUrl && pageNum <= maxPages && extractedProducts.length < maxProducts) {
        await CrawlerDriver.delay(delaySec);
      }
    }

    if (status !== 'ACCESS_BLOCKED') {
      if (failedPages > 0 && extractedProducts.length > 0) {
        status = 'PARTIAL';
      } else if (failedPages > 0 && extractedProducts.length === 0) {
        status = 'FAILED';
      } else {
        status = 'COMPLETED';
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      retailerId,
      category,
      startUrl,
      strategy,
      extractionStrategyUsed,
      status,
      pagesCrawled: visitedUrls.size,
      totalProductsExtracted: extractedProducts.length,
      uniqueSkusExtracted: seenSkus.size,
      failedPages,
      durationMs,
      products: extractedProducts,
      errors,
    };
  }
}

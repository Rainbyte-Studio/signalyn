/**
 * Signalyn Retail Price Intelligence - Public.gr Crawler Adapter (Phase P1.0)
 * 
 * Specialized crawler adapter for Public.gr.
 * Extracts structured ItemList / Product schemas and pagination (?page=X).
 * Transparently reports perimeter access restrictions without attempting WAF evasion.
 */

import * as cheerio from 'cheerio';
import {
  RetailSourceId,
  RetailCategory,
  StockStatus,
} from '../../../types/retailPrice';
import {
  RetailerCrawlerAdapter,
  ExtractedProductRecord,
} from './crawlerTypes';
import { parsePriceToCents, extractJsonLdProducts } from '../retailParserUtils';
import { extractBrandFromTitle, PLAISIO_REQUEST_HEADERS } from '../plaisioAdapter';

export const PUBLIC_BASE_URL = 'https://www.public.gr';

export function extractPublicSku(urlOrText: string): string {
  if (!urlOrText) return 'unknown-sku';
  const match = urlOrText.match(/\/(\d{6,10})(?:[?#]|$)/);
  if (match) return match[1];

  const skuMatch = urlOrText.match(/prod(\d{6,10})/i);
  if (skuMatch) return skuMatch[1];

  const clean = urlOrText.split('/').filter(Boolean).pop() || '';
  const numOnly = clean.replace(/[^0-9]/g, '');
  if (numOnly.length >= 6 && numOnly.length <= 10) return numOnly;

  return clean.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'unknown-sku';
}

/**
 * Extracts the Public category path slug after `/cat/` (e.g. "tilefonia/kinita-smartphones")
 */
export function extractPublicCategorySlug(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl);
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (pathname.startsWith('cat/')) {
      const slug = pathname.slice(4).replace(/^\/+|\/+$/g, '');
      return slug.length > 0 ? slug : null;
    }
    return null;
  } catch {
    return null;
  }
}

export class PublicCrawlerAdapter implements RetailerCrawlerAdapter {
  public readonly retailerId: RetailSourceId = 'public-gr';
  public readonly name = 'Public';

  public supportsCategory(category: RetailCategory): boolean {
    return ['WEARABLES', 'SMARTPHONES', 'AUDIO', 'TABLETS'].includes(category);
  }

  public buildPageUrl(baseUrl: string, pageNumber: number): string {
    const url = new URL(baseUrl);
    if (pageNumber <= 1) {
      url.searchParams.delete('page');
      return url.toString();
    }
    url.searchParams.set('page', String(pageNumber));
    return url.toString();
  }

  public extractFromHtml(
    pageUrl: string,
    html: string,
    category: RetailCategory,
    pageNumber: number
  ): {
    products: ExtractedProductRecord[];
    nextPageUrl?: string;
    hasNextPage: boolean;
  } {
    const products: ExtractedProductRecord[] = [];
    const seenSkus = new Set<string>();
    const timestamp = new Date().toISOString();

    // Check if payload is a JSON category state response
    const trimmed = html.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"products"')) {
      try {
        const parsedJson = JSON.parse(trimmed);
        if (Array.isArray(parsedJson.products)) {
          const parsedDynamic = this.parsePublicCategoryPayload(parsedJson, pageUrl, category, pageNumber, timestamp);
          return {
            products: parsedDynamic.products,
            nextPageUrl: parsedDynamic.hasNextPage ? this.buildPageUrl(pageUrl, pageNumber + 1) : undefined,
            hasNextPage: parsedDynamic.hasNextPage,
          };
        }
      } catch {
        // Proceed with standard HTML / JSON-LD extraction
      }
    }

    const jsonLdProducts = extractJsonLdProducts(html);

    for (const jsonLd of jsonLdProducts) {
      const rawName = String(jsonLd.name || '').trim();
      if (!rawName) continue;

      const brand =
        typeof jsonLd.brand === 'object' && jsonLd.brand !== null
          ? String((jsonLd.brand as { name?: string }).name || '').trim()
          : String(jsonLd.brand || extractBrandFromTitle(rawName)).trim();

      let productUrl = String(jsonLd.url || '').trim();
      if (productUrl && !productUrl.startsWith('http')) {
        productUrl = `${PUBLIC_BASE_URL}${productUrl.startsWith('/') ? '' : '/'}${productUrl}`;
      }
      if (!productUrl) productUrl = pageUrl;

      const sku = String(
        jsonLd.sku || jsonLd.productID || extractPublicSku(productUrl) || ''
      ).trim();

      if (!sku || sku === 'unknown-sku' || seenSkus.has(sku)) continue;

      const offersObj = jsonLd.offers as Record<string, unknown> | undefined;
      let priceCents: number | null = null;
      let referencePriceCents: number | null = null;
      let stockStatus: StockStatus = 'UNKNOWN';
      let isAvailable = false;

      if (offersObj) {
        const rawPrice = offersObj.price as string | number | undefined;
        priceCents = parsePriceToCents(rawPrice);

        const highPrice = offersObj.highPrice || offersObj.priceSpecification;
        if (highPrice) {
          referencePriceCents = parsePriceToCents(highPrice as string | number);
        }

        const avail = String(offersObj.availability || '');
        if (avail.includes('InStock')) {
          stockStatus = 'IN_STOCK';
          isAvailable = true;
        } else if (avail.includes('OutOfStock')) {
          stockStatus = 'OUT_OF_STOCK';
          isAvailable = false;
        } else if (avail.includes('PreOrder')) {
          stockStatus = 'PREORDER';
          isAvailable = true;
        }
      }

      if (priceCents === null || priceCents <= 0) continue;

      let imageUrl: string | undefined;
      if (typeof jsonLd.image === 'string') {
        imageUrl = jsonLd.image;
      } else if (Array.isArray(jsonLd.image) && jsonLd.image.length > 0) {
        imageUrl = String(jsonLd.image[0]);
      }

      seenSkus.add(sku);
      products.push({
        retailerId: this.retailerId,
        retailerSku: sku,
        sourceUrl: productUrl,
        title: rawName,
        brand: brand || extractBrandFromTitle(rawName),
        category,
        priceCents,
        referencePriceCents,
        currency: 'EUR',
        isAvailable,
        stockStatus,
        imageUrl,
        ean: (jsonLd.gtin13 as string) || (jsonLd.gtin as string) || (jsonLd.ean as string) || undefined,
        extractedAt: timestamp,
        isLiveVerified: true,
        pageNumber,
        rawSchema: jsonLd,
      });
    }

    // HTML fallback
    if (products.length === 0) {
      const cardProducts = this.extractFromHtmlCards(pageUrl, html, category, pageNumber, timestamp);
      cardProducts.forEach((p) => {
        if (!seenSkus.has(p.retailerSku)) {
          seenSkus.add(p.retailerSku);
          products.push(p);
        }
      });
    }

    const { nextPageUrl, hasNextPage } = this.discoverNextPage(pageUrl, html, pageNumber, products.length);

    return {
      products,
      nextPageUrl,
      hasNextPage,
    };
  }

  /**
   * Legitimate dynamic state extraction for Public.gr's Angular SPA.
   * When `/cat/<slug>` returns the Angular SPA shell (`<app-root></app-root>`),
   * queries Public's normal client-side `ProductListService.retrieveCategory` endpoint:
   * `/category/?s=/cat/<slug>/&p=<page-1>&r=18` and enriches availability from `/public/v1/mm/stockRules`.
   */
  public async extractDynamicFromPage(
    pageUrl: string,
    _html: string,
    category: RetailCategory,
    pageNumber: number,
    timeoutSeconds = 12
  ): Promise<{
    products: ExtractedProductRecord[];
    nextPageUrl?: string;
    hasNextPage: boolean;
    extractionStrategy: string;
    totalCount?: number;
    errors?: string[];
  }> {
    const errors: string[] = [];
    const slug = extractPublicCategorySlug(pageUrl);
    if (!slug) {
      return {
        products: [],
        hasNextPage: false,
        extractionStrategy: 'ANGULAR_DYNAMIC_CATEGORY_STATE',
        errors: [`URL ${pageUrl} does not contain a valid Public /cat/<slug> category path.`],
      };
    }

    const zeroIndexedPage = Math.max(0, pageNumber - 1);
    const pageSize = 18;
    const categoryEndpointUrl = `${PUBLIC_BASE_URL}/category/?s=/cat/${encodeURIComponent(slug)}/&p=${zeroIndexedPage}&r=${pageSize}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutSeconds * 1000, 20000));

    try {
      const response = await fetch(categoryEndpointUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          ...PLAISIO_REQUEST_HEADERS,
          Accept: 'application/json, text/plain, */*',
          Referer: pageUrl,
        },
      });
      clearTimeout(timer);

      if (response.status === 403 || response.status === 401) {
        return {
          products: [],
          hasNextPage: false,
          extractionStrategy: 'ANGULAR_DYNAMIC_CATEGORY_STATE',
          errors: [`Public category state endpoint returned HTTP ${response.status} (Access Blocked).`],
        };
      }

      if (!response.ok) {
        return {
          products: [],
          hasNextPage: false,
          extractionStrategy: 'ANGULAR_DYNAMIC_CATEGORY_STATE',
          errors: [`Public category state endpoint returned HTTP ${response.status}.`],
        };
      }

      const payload = (await response.json()) as Record<string, any>;
      const timestamp = new Date().toISOString();

      // Collect SKU IDs to query Public's stockRules endpoint for accurate availability
      const rawProducts: any[] = Array.isArray(payload.products) ? payload.products : [];
      const skuIds = rawProducts
        .map((item) => String(item?.id || item?.sku?.id || '').trim())
        .filter((id) => id.length > 0);

      const availabilityMap = await this.fetchPublicStockRules(skuIds, pageUrl);
      const parsed = this.parsePublicCategoryPayload(payload, pageUrl, category, pageNumber, timestamp, availabilityMap);

      return {
        products: parsed.products,
        nextPageUrl: parsed.hasNextPage ? this.buildPageUrl(pageUrl, pageNumber + 1) : undefined,
        hasNextPage: parsed.hasNextPage,
        extractionStrategy: 'ANGULAR_DYNAMIC_CATEGORY_STATE',
        totalCount: parsed.totalCount,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        products: [],
        hasNextPage: false,
        extractionStrategy: 'ANGULAR_DYNAMIC_CATEGORY_STATE',
        errors: [`Public dynamic category extraction error: ${msg}`],
      };
    }
  }

  private async fetchPublicStockRules(
    skuIds: string[],
    refererUrl: string
  ): Promise<Map<string, { isAvailable: boolean; stockStatus: StockStatus }>> {
    const map = new Map<string, { isAvailable: boolean; stockStatus: StockStatus }>();
    if (skuIds.length === 0) return map;

    const queryParams = skuIds.slice(0, 24).map((id) => `skuId=${encodeURIComponent(id)}`).join('&');
    const stockUrl = `${PUBLIC_BASE_URL}/public/v1/mm/stockRules?${queryParams}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(stockUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          ...PLAISIO_REQUEST_HEADERS,
          Accept: 'application/json, text/plain, */*',
          Referer: refererUrl,
        },
      });
      clearTimeout(timer);
      if (!res.ok) return map;

      const data = (await res.json()) as { rules?: Array<Record<string, any>> };
      if (Array.isArray(data.rules)) {
        for (const rule of data.rules) {
          const skuId = String(rule.skuId || '').trim();
          if (!skuId) continue;
          const delivery = rule.deliveryRule || {};
          if (delivery.preOrder === true) {
            map.set(skuId, { isAvailable: true, stockStatus: 'PREORDER' });
          } else if (delivery.inStock === true || delivery.allowPurchases === true || Number(rule.totalAtp || 0) > 0) {
            map.set(skuId, { isAvailable: true, stockStatus: 'IN_STOCK' });
          } else {
            map.set(skuId, { isAvailable: false, stockStatus: 'OUT_OF_STOCK' });
          }
        }
      }
    } catch {
      clearTimeout(timer);
    }

    return map;
  }

  private parsePublicCategoryPayload(
    payload: Record<string, any>,
    pageUrl: string,
    category: RetailCategory,
    pageNumber: number,
    timestamp: string,
    availabilityMap?: Map<string, { isAvailable: boolean; stockStatus: StockStatus }>
  ): {
    products: ExtractedProductRecord[];
    hasNextPage: boolean;
    totalCount: number;
  } {
    const products: ExtractedProductRecord[] = [];
    const seenSkus = new Set<string>();
    const rawItems: any[] = Array.isArray(payload.products) ? payload.products : [];
    const totalCount = Number(payload.totalCount || rawItems.length || 0);

    for (const item of rawItems) {
      const skuObj = item?.sku || item || {};
      const sku = String(item?.id || skuObj?.id || '').trim();
      if (!sku || seenSkus.has(sku)) continue;

      const title = String(skuObj?.displayName || item?.displayName || '').trim();
      if (!title) continue;

      const brandName = String(
        skuObj?.brand?.displayName || skuObj?.brand?.name || extractBrandFromTitle(title)
      ).trim();

      const priceInfo = skuObj?.priceInfoDto || item?.priceInfoDto || {};
      const salePriceNum = Number(priceInfo.salePrice ?? priceInfo.listPrice ?? 0);
      const listPriceNum = Number(priceInfo.listPrice ?? 0);

      const priceCents =
        salePriceNum > 0
          ? Math.round(salePriceNum * 100)
          : parsePriceToCents(priceInfo.salePrice || priceInfo.listPrice);

      if (!priceCents || priceCents <= 0) continue;

      const referencePriceCents =
        listPriceNum > salePriceNum && listPriceNum > 0
          ? Math.round(listPriceNum * 100)
          : null;

      const relUrl = String(skuObj?.url || item?.url || '').trim();
      const sourceUrl = relUrl
        ? relUrl.startsWith('http')
          ? relUrl
          : `${PUBLIC_BASE_URL}${relUrl.startsWith('/') ? '' : '/'}${relUrl}`
        : `${PUBLIC_BASE_URL}/product/${sku}`;

      const stockOverride = availabilityMap?.get(sku);
      const fallbackInStock = Number(skuObj?.quantity ?? 1) > 0;
      const isAvailable = stockOverride ? stockOverride.isAvailable : fallbackInStock;
      const stockStatus: StockStatus = stockOverride
        ? stockOverride.stockStatus
        : fallbackInStock
        ? 'IN_STOCK'
        : 'OUT_OF_STOCK';

      const thumb =
        skuObj?.thumbnail ||
        skuObj?.gallery?.[0]?.['100x200'] ||
        skuObj?.gallery?.[0]?.['50x50'];
      const imageUrl = thumb
        ? String(thumb).startsWith('http')
          ? String(thumb)
          : `${PUBLIC_BASE_URL}${String(thumb).startsWith('/') ? '' : '/'}${String(thumb)}`
        : undefined;

      seenSkus.add(sku);
      products.push({
        retailerId: this.retailerId,
        retailerSku: sku,
        sourceUrl,
        title,
        brand: brandName || extractBrandFromTitle(title),
        category,
        priceCents,
        referencePriceCents,
        currency: 'EUR',
        isAvailable,
        stockStatus,
        imageUrl,
        extractedAt: timestamp,
        isLiveVerified: true,
        pageNumber,
        rawSchema: {
          sku,
          salePrice: salePriceNum,
          listPrice: listPriceNum,
          totalCount,
        },
      });
    }

    const pageSize = 18;
    const hasNextPage = totalCount > pageNumber * pageSize && products.length > 0;

    return {
      products,
      hasNextPage,
      totalCount,
    };
  }

  private extractFromHtmlCards(
    categoryUrl: string,
    html: string,
    category: RetailCategory,
    pageNumber: number,
    timestamp: string
  ): ExtractedProductRecord[] {
    const products: ExtractedProductRecord[] = [];
    const $ = cheerio.load(html);

    $('article, .product-card, [data-track-product]').each((_, el) => {
      const $card = $(el);
      const $link = $card
        .find('a[href*="/cat/"], a[href*="/product/"], a[href*="/kinita"], a[href*="/tablets"], a[href*="/ihos"], a[href*="/aksesoyar"]')
        .first();
      const href = $link.attr('href') || '';
      const fullUrl = href.startsWith('http')
        ? href
        : `${PUBLIC_BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;

      const sku = extractPublicSku(fullUrl);
      if (!sku || sku === 'unknown-sku') return;

      const title =
        $card.find('.product-title, .title, h3, h2').first().text().trim() ||
        $link.attr('title') ||
        '';
      if (!title) return;

      const priceText = $card.find('.price, .current-price, .final-price').first().text().trim();
      const priceCents = parsePriceToCents(priceText);
      if (!priceCents || priceCents <= 0) return;

      const oldPriceText = $card.find('.old-price, .initial-price, del').first().text().trim();
      const referencePriceCents = oldPriceText ? parsePriceToCents(oldPriceText) : null;

      const img = $card.find('img').first().attr('src');

      products.push({
        retailerId: this.retailerId,
        retailerSku: sku,
        sourceUrl: fullUrl || categoryUrl,
        title,
        brand: extractBrandFromTitle(title),
        category,
        priceCents,
        referencePriceCents,
        currency: 'EUR',
        isAvailable: true,
        stockStatus: 'IN_STOCK',
        imageUrl: img,
        extractedAt: timestamp,
        isLiveVerified: true,
        pageNumber,
      });
    });

    return products;
  }

  private discoverNextPage(
    currentUrl: string,
    html: string,
    currentPage: number,
    itemCount: number
  ): { nextPageUrl?: string; hasNextPage: boolean } {
    const $ = cheerio.load(html);
    const nextHref = $('a[rel="next"], a.pagination__next, a[aria-label="Next"]').first().attr('href');

    if (nextHref) {
      const nextPageUrl = nextHref.startsWith('http')
        ? nextHref
        : `${PUBLIC_BASE_URL}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`;
      return { nextPageUrl, hasNextPage: true };
    }

    if (itemCount >= 12) {
      const nextPageUrl = this.buildPageUrl(currentUrl, currentPage + 1);
      return { nextPageUrl, hasNextPage: true };
    }

    return { hasNextPage: false };
  }
}

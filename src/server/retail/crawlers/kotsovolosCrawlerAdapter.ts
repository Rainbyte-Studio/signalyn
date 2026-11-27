/**
 * Signalyn Retail Price Intelligence - Kotsovolos.gr Crawler Adapter (Phase P1.0)
 * 
 * Specialized crawler adapter for Kotsovolos.gr.
 * Extracts structured ItemList / Product schemas and pagination (?page=X).
 * Safely identifies perimeter access control (Akamai Edge) without attempting WAF evasion.
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

export const KOTSOVOLOS_BASE_URL = 'https://www.kotsovolos.gr';

export function extractKotsovolosSku(urlOrText: string): string {
  if (!urlOrText) return 'unknown-sku';
  const match = urlOrText.match(/\/(\d{6,10})(?:[?#]|$)/);
  if (match) return match[1];

  const prodMatch = urlOrText.match(/(\d{6,8})/);
  if (prodMatch) return prodMatch[1];

  const clean = urlOrText.split('/').filter(Boolean).pop() || '';
  return clean.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'unknown-sku';
}

export interface KotsovolosNextDataMeta {
  pageType?: string;
  catalogIdPLP?: string;
  defaultSorting?: string;
  storeId?: string;
  categoryTitle?: string;
  categoryIdentifier?: string;
  embeddedCatalogEntryView?: any[];
}

/**
 * Extracts Next.js `#__NEXT_DATA__` PLP metadata from Kotsovolos category HTML.
 */
export function extractKotsovolosNextDataMetadata(html: string): KotsovolosNextDataMeta | null {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    const pageProps = parsed?.props?.pageProps;
    if (!pageProps) return null;

    const catalogIdPLP = String(
      pageProps.catalogIdPLP || pageProps.resultList?.categoryId || ''
    ).trim();
    const rawSorting = String(pageProps.defaultSorting ?? '').trim();
    const defaultSorting = rawSorting.length > 0 ? rawSorting : '10';
    const storeId = String(pageProps.adminLookupResultList?.storeId || '10151').trim();
    const embeddedCatalogEntryView = Array.isArray(pageProps.products?.catalogEntryView)
      ? pageProps.products.catalogEntryView
      : Array.isArray(pageProps.catalogEntryView)
      ? pageProps.catalogEntryView
      : undefined;

    return {
      pageType: pageProps.pageType,
      catalogIdPLP: catalogIdPLP || undefined,
      defaultSorting,
      storeId,
      categoryTitle: pageProps.resultList?.title,
      categoryIdentifier: pageProps.resultList?.categoryIdentifier,
      embeddedCatalogEntryView,
    };
  } catch {
    return null;
  }
}

export class KotsovolosCrawlerAdapter implements RetailerCrawlerAdapter {
  public readonly retailerId: RetailSourceId = 'kotsovolos-gr';
  public readonly name = 'Kotsovolos';

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

    // Check if payload is direct JSON from getProductsByCategory
    const trimmed = html.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"catalogEntryView"')) {
      try {
        const parsedJson = JSON.parse(trimmed);
        if (Array.isArray(parsedJson.catalogEntryView)) {
          const parsedPlp = this.parseKotsovolosPlpPayload(parsedJson, pageUrl, category, pageNumber, timestamp);
          return {
            products: parsedPlp.products,
            nextPageUrl: parsedPlp.hasNextPage ? this.buildPageUrl(pageUrl, pageNumber + 1) : undefined,
            hasNextPage: parsedPlp.hasNextPage,
          };
        }
      } catch {
        // Proceed with standard HTML / JSON-LD extraction
      }
    }

    // Check if `#__NEXT_DATA__` already embeds `catalogEntryView` products directly
    const nextMeta = extractKotsovolosNextDataMetadata(html);
    if (nextMeta?.embeddedCatalogEntryView && nextMeta.embeddedCatalogEntryView.length > 0) {
      const embeddedPlp = this.parseKotsovolosPlpPayload(
        { catalogEntryView: nextMeta.embeddedCatalogEntryView },
        pageUrl,
        category,
        pageNumber,
        timestamp
      );
      if (embeddedPlp.products.length > 0) {
        return {
          products: embeddedPlp.products,
          nextPageUrl: embeddedPlp.hasNextPage ? this.buildPageUrl(pageUrl, pageNumber + 1) : undefined,
          hasNextPage: embeddedPlp.hasNextPage,
        };
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
        productUrl = `${KOTSOVOLOS_BASE_URL}${productUrl.startsWith('/') ? '' : '/'}${productUrl}`;
      }
      if (!productUrl) productUrl = pageUrl;

      const sku = String(
        jsonLd.sku || jsonLd.productID || extractKotsovolosSku(productUrl) || ''
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
   * Legitimate Next.js dynamic PLP extraction for Kotsovolos.gr.
   * Parses `catalogIdPLP`, `defaultSorting`, and `storeId` from `#__NEXT_DATA__`
   * on the category `listPage`, then fetches the normal Next.js listing endpoint:
   * `/api/ext/getProductsByCategory?params=pageNumber%3D<page>%26pageSize%3D18%26orderBy%3D<sort>&catId=<catalogIdPLP>&storeId=<storeId>&isCPage=false`.
   */
  public async extractDynamicFromPage(
    pageUrl: string,
    html: string,
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
    const meta = extractKotsovolosNextDataMetadata(html);
    if (!meta) {
      return {
        products: [],
        hasNextPage: false,
        extractionStrategy: 'NEXTJS_DYNAMIC_PLP_STATE',
        errors: ['Missing #__NEXT_DATA__ metadata in Kotsovolos category HTML.'],
      };
    }

    if (meta.pageType && meta.pageType !== 'listPage') {
      return {
        products: [],
        hasNextPage: false,
        extractionStrategy: 'NEXTJS_DYNAMIC_PLP_STATE',
        errors: [`Kotsovolos pageType is "${meta.pageType}" (expected "listPage").`],
      };
    }

    if (!meta.catalogIdPLP) {
      return {
        products: [],
        hasNextPage: false,
        extractionStrategy: 'NEXTJS_DYNAMIC_PLP_STATE',
        errors: ['Missing catalogIdPLP in Kotsovolos #__NEXT_DATA__.'],
      };
    }

    const pageSize = 18;
    const orderBy = meta.defaultSorting || '10';
    const storeId = meta.storeId || '10151';
    const rawParams = `pageNumber=${pageNumber}&pageSize=${pageSize}&orderBy=${orderBy}`;
    const apiUrl = `${KOTSOVOLOS_BASE_URL}/api/ext/getProductsByCategory?params=${encodeURIComponent(rawParams)}&catId=${encodeURIComponent(meta.catalogIdPLP)}&storeId=${encodeURIComponent(storeId)}&isCPage=false`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutSeconds * 1000, 20000));

    try {
      const response = await fetch(apiUrl, {
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
          extractionStrategy: 'NEXTJS_DYNAMIC_PLP_STATE',
          errors: [`Kotsovolos PLP endpoint returned HTTP ${response.status} (Access Blocked).`],
        };
      }

      if (!response.ok) {
        return {
          products: [],
          hasNextPage: false,
          extractionStrategy: 'NEXTJS_DYNAMIC_PLP_STATE',
          errors: [`Kotsovolos PLP endpoint returned HTTP ${response.status}.`],
        };
      }

      const payload = (await response.json()) as Record<string, any>;
      const timestamp = new Date().toISOString();
      const parsed = this.parseKotsovolosPlpPayload(payload, pageUrl, category, pageNumber, timestamp);

      return {
        products: parsed.products,
        nextPageUrl: parsed.hasNextPage ? this.buildPageUrl(pageUrl, pageNumber + 1) : undefined,
        hasNextPage: parsed.hasNextPage,
        extractionStrategy: 'NEXTJS_DYNAMIC_PLP_STATE',
        totalCount: parsed.totalCount,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        products: [],
        hasNextPage: false,
        extractionStrategy: 'NEXTJS_DYNAMIC_PLP_STATE',
        errors: [`Kotsovolos dynamic PLP extraction error: ${msg}`],
      };
    }
  }

  private parseKotsovolosPlpPayload(
    payload: Record<string, any>,
    pageUrl: string,
    category: RetailCategory,
    pageNumber: number,
    timestamp: string
  ): {
    products: ExtractedProductRecord[];
    hasNextPage: boolean;
    totalCount: number;
  } {
    const products: ExtractedProductRecord[] = [];
    const seenSkus = new Set<string>();
    const entries: any[] = Array.isArray(payload.catalogEntryView) ? payload.catalogEntryView : [];
    const totalCount = Number(payload.recordSetTotal || entries.length || 0);
    const startNum = Number(payload.recordSetStartNumber || (pageNumber - 1) * 18);
    const countNum = Number(payload.recordSetCount || entries.length);

    for (const entry of entries) {
      const sku = String(entry?.partNumber || entry?.uniqueID || '').trim();
      if (!sku || seenSkus.has(sku)) continue;

      const title = String(entry?.name || '').trim();
      if (!title) continue;

      const brand = String(entry?.manufacturer || extractBrandFromTitle(title)).trim();

      const priceArray: Array<{ usage?: string; value?: string | number }> = Array.isArray(entry?.price)
        ? entry.price
        : [];
      const offerPriceEntry = priceArray.find((p) => p.usage === 'Offer');
      const displayPriceEntry = priceArray.find((p) => p.usage === 'Display');

      const rawPrice = entry?.price_EUR ?? offerPriceEntry?.value;
      const priceCents = parsePriceToCents(rawPrice);
      if (!priceCents || priceCents <= 0) continue;

      const rawRefPrice = displayPriceEntry?.value ?? entry?.UserData?.[0]?.x_cy_listprice;
      const parsedRefCents = rawRefPrice ? parsePriceToCents(rawRefPrice) : null;
      const referencePriceCents =
        parsedRefCents && parsedRefCents > priceCents ? parsedRefCents : null;

      const seoUrl = String(entry?.UserData?.[0]?.seo_url || '').trim();
      const sourceUrl = seoUrl
        ? seoUrl.startsWith('http')
          ? seoUrl
          : `${KOTSOVOLOS_BASE_URL}/${seoUrl.replace(/^\/+/, '')}`
        : `${KOTSOVOLOS_BASE_URL}/products/${sku}`;

      const isBuyable = entry?.buyable === 'true' || entry?.buyable === true;
      const stockStatus: StockStatus = isBuyable ? 'IN_STOCK' : 'OUT_OF_STOCK';

      const thumb = String(entry?.thumbnail || '').trim();
      const imageUrl = thumb
        ? thumb.startsWith('http')
          ? thumb
          : `${KOTSOVOLOS_BASE_URL}${thumb.startsWith('/') ? '' : '/'}${thumb}`
        : undefined;

      seenSkus.add(sku);
      products.push({
        retailerId: this.retailerId,
        retailerSku: sku,
        sourceUrl,
        title,
        brand: brand || extractBrandFromTitle(title),
        category,
        priceCents,
        referencePriceCents,
        currency: 'EUR',
        isAvailable: isBuyable,
        stockStatus,
        imageUrl,
        extractedAt: timestamp,
        isLiveVerified: true,
        pageNumber,
        rawSchema: {
          partNumber: sku,
          uniqueID: entry?.uniqueID,
          price_EUR: rawPrice,
          recordSetTotal: totalCount,
        },
      });
    }

    const hasNextPage = totalCount > startNum + countNum && products.length > 0;

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

    $('.product, .product-item, [data-component="ProductCard"]').each((_, el) => {
      const $card = $(el);
      const $link = $card
        .find(
          'a[href*="/mobile-phones-gps"], a[href*="/computing"], a[href*="/akoystika"], a[href*="/wearables"], a[href*="/tablets-ipad"], a[href*="/smartphones"], a[href*="/telephony"], a[href*="/sound"], a[href*="/product"]'
        )
        .first();
      const href = $link.attr('href') || '';
      const fullUrl = href.startsWith('http')
        ? href
        : `${KOTSOVOLOS_BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;

      const sku = extractKotsovolosSku(fullUrl);
      if (!sku || sku === 'unknown-sku') return;

      const title =
        $card.find('.title, .product-title, h2, h3').first().text().trim() ||
        $link.attr('title') ||
        '';
      if (!title) return;

      const priceText = $card.find('.price, .main-price, .current-price').first().text().trim();
      const priceCents = parsePriceToCents(priceText);
      if (!priceCents || priceCents <= 0) return;

      const oldPriceText = $card.find('.was-price, .old-price').first().text().trim();
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
    const nextHref = $('a[rel="next"], .pagination-next a, a[aria-label="Next"]').first().attr('href');

    if (nextHref) {
      const nextPageUrl = nextHref.startsWith('http')
        ? nextHref
        : `${KOTSOVOLOS_BASE_URL}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`;
      return { nextPageUrl, hasNextPage: true };
    }

    if (itemCount >= 12) {
      const nextPageUrl = this.buildPageUrl(currentUrl, currentPage + 1);
      return { nextPageUrl, hasNextPage: true };
    }

    return { hasNextPage: false };
  }
}

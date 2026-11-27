/**
 * Signalyn Retail Price Intelligence - Plaisio Crawler Adapter (Phase P1.0)
 * 
 * Specialized crawler adapter for Plaisio.gr (Pricelog Architecture Parity).
 * Extracts structured ItemList / Product schemas, detects pagination (?page=X),
 * and normalizes live product offers with strict integer EUR cents pricing.
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
import {
  PLAISIO_BASE_URL,
  extractPlaisioSku,
  extractBrandFromTitle,
  extractStructuredDataItemListB2C,
} from '../plaisioAdapter';
import { parsePriceToCents, extractJsonLdProducts } from '../retailParserUtils';

export class PlaisioCrawlerAdapter implements RetailerCrawlerAdapter {
  public readonly retailerId: RetailSourceId = 'plaisio-gr';
  public readonly name = 'Plaisio';

  public supportsCategory(category: RetailCategory): boolean {
    return ['WEARABLES', 'SMARTPHONES', 'AUDIO', 'TABLETS'].includes(category);
  }

  public buildPageUrl(baseUrl: string, pageNumber: number): string {
    if (pageNumber <= 1) return baseUrl;
    const url = new URL(baseUrl);
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

    // 1. Primary Strategy: Extract from #StructuredDataItemListB2C (Pricelog parity)
    let jsonLdProducts = extractStructuredDataItemListB2C(html);

    // 2. Secondary Strategy: Extract from all application/ld+json blocks
    if (jsonLdProducts.length === 0) {
      jsonLdProducts = extractJsonLdProducts(html);
    }

    for (const jsonLd of jsonLdProducts) {
      const rawName = String(jsonLd.name || '').trim();
      if (!rawName) continue;

      const brand =
        typeof jsonLd.brand === 'object' && jsonLd.brand !== null
          ? String((jsonLd.brand as { name?: string }).name || '').trim()
          : String(jsonLd.brand || extractBrandFromTitle(rawName)).trim();

      let productUrl = String(jsonLd.url || '').trim();
      if (productUrl && !productUrl.startsWith('http')) {
        productUrl = `${PLAISIO_BASE_URL}${productUrl.startsWith('/') ? '' : '/'}${productUrl}`;
      }
      if (!productUrl) {
        productUrl = pageUrl;
      }

      const sku = String(
        jsonLd.sku || jsonLd.productID || extractPlaisioSku(productUrl) || ''
      ).trim();

      if (!sku || sku === 'unknown-sku' || seenSkus.has(sku)) {
        continue;
      }

      // Price extraction
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

      // Strict validation: Never fabricate missing prices or record €0
      if (priceCents === null || priceCents <= 0) {
        continue;
      }

      // Image extraction
      let imageUrl: string | undefined;
      if (jsonLd.image) {
        if (typeof jsonLd.image === 'string') {
          imageUrl = jsonLd.image;
        } else if (Array.isArray(jsonLd.image) && jsonLd.image.length > 0) {
          imageUrl = String(jsonLd.image[0]);
        }
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

    // 3. Fallback: Parse HTML product cards if JSON-LD did not yield products
    if (products.length === 0) {
      const cardProducts = this.extractFromHtmlCards(pageUrl, html, category, pageNumber, timestamp);
      cardProducts.forEach((p) => {
        if (!seenSkus.has(p.retailerSku)) {
          seenSkus.add(p.retailerSku);
          products.push(p);
        }
      });
    }

    // Next page discovery
    const { nextPageUrl, hasNextPage } = this.discoverNextPage(pageUrl, html, pageNumber, products.length);

    return {
      products,
      nextPageUrl,
      hasNextPage,
    };
  }

  /**
   * HTML Card selector fallback for Plaisio product catalog pages
   */
  private extractFromHtmlCards(
    categoryUrl: string,
    html: string,
    category: RetailCategory,
    pageNumber: number,
    timestamp: string
  ): ExtractedProductRecord[] {
    const products: ExtractedProductRecord[] = [];
    const $ = cheerio.load(html);

    // Common Plaisio product card classes & attributes
    $('div[data-sku], .product-card, .cell-product, article.product').each((_, el) => {
      const $card = $(el);
      const skuAttr = $card.attr('data-sku') || $card.attr('data-product-id');
      const $link = $card.find('a[href*="/"]').first();
      const href = $link.attr('href') || '';
      const fullUrl = href.startsWith('http')
        ? href
        : `${PLAISIO_BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;

      const sku = skuAttr || extractPlaisioSku(fullUrl);
      if (!sku || sku === 'unknown-sku') return;

      const title =
        $card.find('.product-title, .title, h3, h2, [data-testid="product-title"]').first().text().trim() ||
        $link.attr('title') ||
        '';
      if (!title) return;

      const priceText =
        $card.find('.price, .current-price, .product-price, [data-price]').first().text().trim() ||
        $card.attr('data-price') ||
        '';
      const priceCents = parsePriceToCents(priceText);
      if (!priceCents || priceCents <= 0) return;

      const oldPriceText = $card.find('.old-price, .strikethrough-price, .was-price').first().text().trim();
      const referencePriceCents = oldPriceText ? parsePriceToCents(oldPriceText) : null;

      const img = $card.find('img').first().attr('src') || $card.find('img').first().attr('data-src');

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

  /**
   * Discovers next page URL from pagination markup or item count
   */
  private discoverNextPage(
    currentUrl: string,
    html: string,
    currentPage: number,
    itemCount: number
  ): { nextPageUrl?: string; hasNextPage: boolean } {
    const $ = cheerio.load(html);

    // 1. Look for explicit next page link
    const nextHref = $('a[rel="next"], a.pagination-next, .next-page a, a:contains("Επόμενη")')
      .first()
      .attr('href');

    if (nextHref) {
      const nextPageUrl = nextHref.startsWith('http')
        ? nextHref
        : `${PLAISIO_BASE_URL}${nextHref.startsWith('/') ? '' : '/'}${nextHref}`;
      return { nextPageUrl, hasNextPage: true };
    }

    // 2. Pattern based pagination: If current page yielded at least 12 products, assume next page exists
    if (itemCount >= 12) {
      const nextPageUrl = this.buildPageUrl(currentUrl, currentPage + 1);
      return { nextPageUrl, hasNextPage: true };
    }

    return { hasNextPage: false };
  }
}

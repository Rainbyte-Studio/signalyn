/**
 * Public.gr Retail Price Adapter
 * 
 * Supports:
 * - Product discovery where permitted
 * - Structured JSON-LD / Microdata / Meta tag price extraction
 * - Availability detection
 * - SKU / Model / Variant identification
 * - Detection of Akamai / Perimeter 403 access control (transitions to REQUIRES_AUTHORIZATION)
 * - Safe server-side execution with timeout and rate-limiting
 */

import { RetailAdapterResult, StockStatus } from '../../types/retailPrice';
import { parsePriceToCents, extractJsonLdProducts, extractMetaTags } from './retailParserUtils';

export interface PublicFetchOptions {
  timeoutMs?: number;
  simulatedHtml?: string; // For testing or structured feed ingestion
}

export async function fetchPublicOffer(
  targetUrl: string,
  options: PublicFetchOptions = {}
): Promise<RetailAdapterResult> {
  const timeoutMs = options.timeoutMs ?? 8000;

  // If simulated/feed HTML is supplied directly (e.g. tests or merchant feed sync)
  if (options.simulatedHtml) {
    return parsePublicHtml(targetUrl, options.simulatedHtml);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8',
      },
    });

    clearTimeout(timer);

    if (res.status === 403 || res.status === 401) {
      return {
        retailerId: 'public-gr',
        success: false,
        status: 'REQUIRES_AUTHORIZATION',
        httpStatus: res.status,
        error: `Perimeter protection / Akamai Edge access denied (HTTP ${res.status}). Requires authorized merchant API access.`,
        offers: [],
      };
    }

    if (!res.ok) {
      return {
        retailerId: 'public-gr',
        success: false,
        status: 'ERROR',
        httpStatus: res.status,
        error: `HTTP error response: ${res.status} ${res.statusText}`,
        offers: [],
      };
    }

    const html = await res.text();
    return parsePublicHtml(targetUrl, html);
  } catch (err: unknown) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return {
      retailerId: 'public-gr',
      success: false,
      status: 'ERROR',
      error: `Network/Fetch error: ${message}`,
      offers: [],
    };
  }
}

export function parsePublicHtml(url: string, html: string): RetailAdapterResult {
  const jsonLdList = extractJsonLdProducts(html);
  const metaTags = extractMetaTags(html);

  // Attempt extraction from JSON-LD first
  if (jsonLdList.length > 0) {
    const jsonLd = jsonLdList[0];
    const title = (jsonLd.name as string) || metaTags['og:title'] || '';
    const brand = typeof jsonLd.brand === 'object' && jsonLd.brand !== null
      ? (jsonLd.brand as { name?: string }).name || ''
      : (jsonLd.brand as string) || '';
    const sku = (jsonLd.sku as string) || (jsonLd.productID as string) || extractSkuFromUrl(url);

    const offersObj = jsonLd.offers as Record<string, unknown> | undefined;
    let priceCents: number | null = null;
    let stockStatus: StockStatus = 'UNKNOWN';
    let isAvailable = false;

    if (offersObj) {
      const rawPrice = offersObj.price as string | number | undefined;
      priceCents = parsePriceToCents(rawPrice);
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

    if (!priceCents) {
      priceCents = parsePriceToCents(metaTags['product:price:amount'] || metaTags['og:price:amount']);
    }

    return {
      retailerId: 'public-gr',
      success: true,
      status: 'ACTIVE',
      offers: [
        {
          retailerSku: sku,
          title: title.trim(),
          brand: brand.trim(),
          url,
          priceCents,
          referencePriceCents: null,
          currency: 'EUR',
          isAvailable,
          stockStatus,
          priceSourceType: 'LIVE_SCRAPED',
          observationStatus: 'LIVE_VERIFIED',
          isLiveVerified: true,
          ean: (jsonLd.gtin13 as string) || (jsonLd.gtin as string) || undefined,
        },
      ],
    };
  }

  // Fallback to OpenGraph / Meta tags
  const ogTitle = metaTags['og:title'] || '';
  const ogPrice = metaTags['product:price:amount'] || metaTags['og:price:amount'];
  const priceCents = parsePriceToCents(ogPrice);

  if (ogTitle && priceCents !== null) {
    return {
      retailerId: 'public-gr',
      success: true,
      status: 'ACTIVE',
      offers: [
        {
          retailerSku: extractSkuFromUrl(url),
          title: ogTitle,
          brand: extractBrandFromTitle(ogTitle),
          url,
          priceCents,
          referencePriceCents: null,
          currency: 'EUR',
          isAvailable: true,
          stockStatus: 'IN_STOCK',
          priceSourceType: 'LIVE_SCRAPED',
          observationStatus: 'LIVE_VERIFIED',
          isLiveVerified: true,
        },
      ],
    };
  }

  return {
    retailerId: 'public-gr',
    success: false,
    status: 'UNSUPPORTED',
    error: 'No structured product schema or price data found in page response.',
    offers: [],
  };
}

function extractSkuFromUrl(url: string): string {
  const match = url.match(/\/(\d{5,9})(?:[?#]|$)/);
  if (match) return match[1];
  const lastSegment = url.split('/').filter(Boolean).pop() || '';
  return lastSegment.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'unknown-sku';
}

function extractBrandFromTitle(title: string): string {
  const brands = ['HUAWEI', 'Apple', 'Samsung', 'Xiaomi', 'Honor', 'Garmin', 'Sony', 'Bose', 'Lenovo', 'Nothing'];
  for (const b of brands) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(title)) return b;
  }
  return 'Unknown';
}

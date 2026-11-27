/**
 * Signalyn Retail Sources - Defaults, Domains, and SSRF Validation
 * 
 * Defines verified default category endpoints for the 3 strategic Greek retailers:
 * - Plaisio (plaisio.gr)
 * - Public (public.gr)
 * - Kotsovolos (kotsovolos.gr)
 * 
 * Enforces strict Server-Side Request Forgery (SSRF) and URL syntax guards:
 * - HTTPS protocol strictly required
 * - Approved retailer domain whitelist
 * - Port 443 only (no custom internal ports)
 * - No user/password credentials embedded in URL
 * - Disallow IP literals, localhost, cloud metadata, and private IP CIDRs
 * - Disallow open redirect wrappers (google.com/url, etc.)
 */

import {
  RetailSourceId,
  RetailCategory,
  RetailCategoryEndpointConfig,
  CategoryUrlValidationStatus,
} from '../../types/retailPrice';

export interface RetailerDomainMeta {
  retailerId: RetailSourceId;
  name: string;
  domain: string;
  allowedHostnames: string[];
  websiteUrl: string;
  defaultDelaySeconds: number;
  defaultTimeoutSeconds: number;
  defaultNotes: string;
}

export const RETAILER_DOMAIN_METADATA: Record<RetailSourceId, RetailerDomainMeta> = {
  'plaisio-gr': {
    retailerId: 'plaisio-gr',
    name: 'Plaisio',
    domain: 'plaisio.gr',
    allowedHostnames: ['www.plaisio.gr', 'plaisio.gr'],
    websiteUrl: 'https://www.plaisio.gr',
    defaultDelaySeconds: 3,
    defaultTimeoutSeconds: 10,
    defaultNotes:
      'Akamai Bot Protection WAF blocks direct datacenter IPs (HTTP 403). Requires authorized merchant XML feed syndication for live catalog access.',
  },
  'public-gr': {
    retailerId: 'public-gr',
    name: 'Public',
    domain: 'public.gr',
    allowedHostnames: ['www.public.gr', 'public.gr'],
    websiteUrl: 'https://www.public.gr',
    defaultDelaySeconds: 3,
    defaultTimeoutSeconds: 10,
    defaultNotes:
      'Perimeter Edge WAF restricts automated cloud requests (HTTP 403). Integration requires Public Marketplace Mirakl API credentials or approved merchant product CSV/XML feed.',
  },
  'kotsovolos-gr': {
    retailerId: 'kotsovolos-gr',
    name: 'Kotsovolos',
    domain: 'kotsovolos.gr',
    allowedHostnames: ['www.kotsovolos.gr', 'kotsovolos.gr'],
    websiteUrl: 'https://www.kotsovolos.gr',
    defaultDelaySeconds: 3,
    defaultTimeoutSeconds: 10,
    defaultNotes:
      'Akamai Edge Shield blocks cloud datacenter subnets (HTTP 403). Integration requires Currys Group / Kotsovolos B2B partner commercial datafeed credentials.',
  },
};

/**
 * Default Category Endpoints (Phase P1.1 Corrected Navigation Tree)
 * 
 * - Plaisio (All 4 preserved unchanged):
 *   - WEARABLES: https://www.plaisio.gr/list/tilefonia-tablet-wearables/wearables
 *   - SMARTPHONES: https://www.plaisio.gr/list/tilefonia-tablet-wearables/tilefona/smartphones
 *   - AUDIO: https://www.plaisio.gr/list/thleoraseis-ixos/ixos/akoustika
 *   - TABLETS: https://www.plaisio.gr/list/tilefonia-tablet-wearables/tablet
 * - Public:
 *   - SMARTPHONES: https://www.public.gr/cat/tilefonia/kinita-smartphones (preserved)
 *   - WEARABLES: https://www.public.gr/cat/tilefonia/wearables/smartwatches (preserved)
 *   - AUDIO: https://www.public.gr/cat/ihos/akoustika/akoystika-kefalis (corrected from broken /cat/ixos-kai-eikona/akoustika)
 *   - TABLETS: https://www.public.gr/cat/tablets/syskeyes-tablet (corrected from broken /cat/tilefonia/tablets-kai-aksesoyar/tablets)
 * - Kotsovolos:
 *   - SMARTPHONES: https://www.kotsovolos.gr/mobile-phones-gps/mobile-phones/smartphones (corrected from broken /telephony-tablets-wearables/smartphones)
 *   - WEARABLES: https://www.kotsovolos.gr/mobile-phones-gps/wearables/smartwatches (corrected from broken /telephony-tablets-wearables/wearables)
 *   - AUDIO: https://www.kotsovolos.gr/mobile-phones-gps/akoystika (corrected from broken /sound-vision/audio/headphones)
 *   - TABLETS: https://www.kotsovolos.gr/computing/laptop-tablet-ipad/tablets-ipad (corrected from broken /telephony-tablets-wearables/tablets)
 */
export const DEFAULT_CATEGORY_URLS: Record<RetailSourceId, Record<RetailCategory, string>> = {
  'plaisio-gr': {
    WEARABLES: 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/wearables',
    SMARTPHONES: 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/tilefona/smartphones',
    AUDIO: 'https://www.plaisio.gr/list/thleoraseis-ixos/ixos/akoustika',
    TABLETS: 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/tablet',
  },
  'public-gr': {
    SMARTPHONES: 'https://www.public.gr/cat/tilefonia/kinita-smartphones',
    WEARABLES: 'https://www.public.gr/cat/tilefonia/wearables/smartwatches',
    AUDIO: 'https://www.public.gr/cat/aksesoyar/tablet/bluetooth',
    TABLETS: 'https://www.public.gr/cat/tablets/syskeyes-tablet',
  },
  'kotsovolos-gr': {
    SMARTPHONES: 'https://www.kotsovolos.gr/mobile-phones-gps/mobile-phones/smartphones',
    WEARABLES: 'https://www.kotsovolos.gr/mobile-phones-gps/wearables/smartwatches',
    AUDIO: 'https://www.kotsovolos.gr/mobile-phones-gps/akoystika',
    TABLETS: 'https://www.kotsovolos.gr/computing/laptop-tablet-ipad/tablets-ipad',
  },
};

/**
 * Exact deprecated broken or previous default category URLs to be migrated safely
 * without overwriting any manually configured valid administrator URLs.
 */
export const DEPRECATED_BROKEN_CATEGORY_URLS: Partial<Record<RetailSourceId, Partial<Record<RetailCategory, string[]>>>> = {
  'public-gr': {
    AUDIO: [
      'https://www.public.gr/cat/ihos/akoustika/akoystika-kefalis',
      'https://www.public.gr/cat/ixos-kai-eikona/akoustika',
    ],
    TABLETS: ['https://www.public.gr/cat/tilefonia/tablets-kai-aksesoyar/tablets'],
  },
  'kotsovolos-gr': {
    SMARTPHONES: ['https://www.kotsovolos.gr/telephony-tablets-wearables/smartphones'],
    WEARABLES: ['https://www.kotsovolos.gr/telephony-tablets-wearables/wearables'],
    AUDIO: ['https://www.kotsovolos.gr/sound-vision/audio/headphones'],
    TABLETS: ['https://www.kotsovolos.gr/telephony-tablets-wearables/tablets'],
  },
};

export function isDeprecatedBrokenCategoryUrl(
  retailerId: RetailSourceId,
  category: RetailCategory,
  url?: string
): boolean {
  if (!url) return false;
  const trimmed = url.trim().replace(/\/+$/, '');
  const list = DEPRECATED_BROKEN_CATEGORY_URLS[retailerId]?.[category] || [];
  return list.some((b) => b.replace(/\/+$/, '') === trimmed);
}

export const ALL_RETAIL_CATEGORIES: RetailCategory[] = [
  'SMARTPHONES',
  'WEARABLES',
  'AUDIO',
  'TABLETS',
];

/**
 * Creates default category endpoint configurations for a given retailer
 */
export function createDefaultCategoryEndpoints(
  retailerId: RetailSourceId
): Record<RetailCategory, RetailCategoryEndpointConfig> {
  const urls = DEFAULT_CATEGORY_URLS[retailerId];
  const configs = {} as Record<RetailCategory, RetailCategoryEndpointConfig>;

  for (const cat of ALL_RETAIL_CATEGORIES) {
    const url = urls[cat];
    configs[cat] = {
      category: cat,
      enabled: true,
      url,
      defaultUrl: url,
      status: 'UNVERIFIED',
      validationStatus: 'UNVERIFIED',
      autoDiscoveryEnabled: true,
      maxPagesPerRun: 2,
      maxProductsPerRun: 50,
    };
  }

  return configs;
}

/**
 * Strictly validates retailer URLs to prevent SSRF and injection attacks.
 */
export function validateRetailSourceUrl(
  retailerId: RetailSourceId,
  rawUrl: string
): { valid: boolean; error?: string; normalizedUrl?: string } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string.' };
  }

  const trimmed = rawUrl.trim();

  // 1. Syntax check via URL constructor
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Malformed URL: Failed standard URL parsing.' };
  }

  // 2. Protocol check: strictly HTTPS
  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Insecure protocol '${parsed.protocol}'. Only secure HTTPS URLs are permitted.`,
    };
  }

  // 3. Reject embedded user credentials
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'Security violation: Embedded username or password in URL is strictly prohibited.',
    };
  }

  // 4. Reject custom ports
  if (parsed.port && parsed.port !== '443') {
    return {
      valid: false,
      error: `Non-standard port '${parsed.port}' rejected. Only standard HTTPS (443) is allowed.`,
    };
  }

  // 5. Hostname normalization
  const hostname = parsed.hostname.toLowerCase();

  // 6. Reject IP literals (IPv4 & IPv6) and local/cloud metadata domains
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (
    ipv4Regex.test(hostname) ||
    hostname.startsWith('[') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname.includes('169.254') ||
    hostname.includes('127.0.0.1') ||
    hostname.includes('0.0.0.0')
  ) {
    return {
      valid: false,
      error: 'SSRF Protection: Direct IP addresses, localhost, and metadata hosts are strictly forbidden.',
    };
  }

  // 7. Reject open redirect wrappers (e.g. google.com/url?q=...)
  if (
    hostname.includes('google.') ||
    hostname.includes('bing.') ||
    hostname.includes('bit.ly') ||
    hostname.includes('tinyurl.') ||
    hostname.includes('linktr.ee')
  ) {
    return {
      valid: false,
      error: 'Redirect wrappers and URL shorteners are strictly prohibited.',
    };
  }

  // 8. Whitelist check against approved retailer hostnames
  const meta = RETAILER_DOMAIN_METADATA[retailerId];
  if (!meta) {
    return { valid: false, error: `Unrecognized retailer ID '${retailerId}'.` };
  }

  const isApproved = meta.allowedHostnames.some(
    (allowed) => hostname === allowed || hostname === `www.${allowed}`
  );

  if (!isApproved) {
    return {
      valid: false,
      error: `Domain mismatch: '${hostname}' does not match approved domains for ${meta.name} (${meta.allowedHostnames.join(', ')}).`,
    };
  }

  // 9. Path validation: must have a category path and not be a search or error URL
  if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname.length < 3) {
    return {
      valid: false,
      error: 'Category URL must specify a non-root product category path (e.g. /list/...).',
    };
  }

  const lowerPath = parsed.pathname.toLowerCase();
  const lowerSearch = parsed.search.toLowerCase();
  if (
    lowerPath.startsWith('/search') ||
    lowerPath.includes('/search-results') ||
    lowerSearch.includes('?q=') ||
    lowerSearch.includes('&q=') ||
    lowerSearch.includes('?search=') ||
    lowerSearch.includes('searchquery=')
  ) {
    return {
      valid: false,
      error: 'Search-results pages are not valid category listing URLs.',
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}

const CATEGORY_KEYWORDS: Record<RetailCategory, RegExp[]> = {
  SMARTPHONES: [
    /\bsmartphone/i,
    /\biphone\b/i,
    /\bgalaxy\s+(s\d|a\d|z\s*(fold|flip)|m\d)/i,
    /\bredmi\s+note\b/i,
    /\bpoco\b/i,
    /\bpura\s*\d/i,
    /\bnova\s*\d/i,
    /\bpixel\s*\d/i,
    /\bhonor\s*(\d|magic)/i,
    /\bxiaomi\s*\d/i,
    /\bnothing\s*phone/i,
    /\bmotorola\b/i,
    /\boneplus\b/i,
    /\brealme\b/i,
    /κινητ/i,
    /kinita/i,
    /smartphones/i,
  ],
  WEARABLES: [
    /\bsmartwatch/i,
    /\bwatch\b/i,
    /\bband\b/i,
    /\bfit\s*\d/i,
    /\bgarmin\b/i,
    /\bfenix\b/i,
    /\bforerunner\b/i,
    /\bvenu\b/i,
    /\bsuunto\b/i,
    /\bpolar\b/i,
    /\bwearable/i,
    /\bactivity\s*tracker/i,
    /ρολόι/i,
    /ρολογ/i,
  ],
  AUDIO: [
    /\bfreebuds\b/i,
    /\bfreeclip\b/i,
    /\bairpods\b/i,
    /\bearbuds?\b/i,
    /\bgalaxy\s*buds\b/i,
    /\bredmi\s*buds\b/i,
    /\bheadphones?\b/i,
    /\bheadset\b/i,
    /\bquietcomfort\b/i,
    /\bwf-1000/i,
    /\bwh-1000/i,
    /\bnothing\s*ear\b/i,
    /\btrue\s*wireless\b/i,
    /\btws\b/i,
    /\bbluetooth\b/i,
    /\bhandsfree\b/i,
    /\bjbl\b/i,
    /\bmarshall\b/i,
    /\bsony\b/i,
    /\bbose\b/i,
    /ακουστικ/i,
    /akoustik/i,
    /akoystik/i,
  ],
  TABLETS: [
    /\btablet/i,
    /\bipad\b/i,
    /\bmatepad\b/i,
    /\bgalaxy\s*tab\b/i,
    /\blenovo\s*tab\b/i,
    /\bredmi\s*pad\b/i,
    /\bxiaomi\s*pad\b/i,
    /\bhonor\s*pad\b/i,
    /\btab\s+[a-z0-9]/i,
    /syskeyes-tablet/i,
    /tablets-ipad/i,
  ],
};

/**
 * Counts how many detected products belong to the expected category.
 */
export function verifyProductsMatchCategory(
  category: RetailCategory,
  products: Array<{ sku: string; title: string; url?: string }>,
  pageUrl?: string
): number {
  const patterns = CATEGORY_KEYWORDS[category] || [];
  let matches = 0;

  for (const prod of products) {
    const distinctProdUrl = prod.url && prod.url !== pageUrl ? prod.url : '';
    const text = `${prod.title || ''} ${distinctProdUrl}`;
    if (patterns.some((rx) => rx.test(text))) {
      matches++;
    }
  }

  return matches;
}

/**
 * Evaluates an HTTP response for strict P1.1 category URL validation:
 * - HTTP 200 alone NEVER proves a category URL is valid.
 * - Requires identifiable products belonging to the expected category to mark VALID_CATEGORY.
 * - Distinguishes ACCESS_BLOCKED (HTTP 403/401) from INVALID_CATEGORY and UNVERIFIED.
 */
export function evaluateCategoryResponseValidation(params: {
  retailerId: RetailSourceId;
  category?: RetailCategory;
  targetUrl: string;
  resolvedUrl: string;
  httpStatus: number;
  html: string;
  detectedProducts: Array<{ sku: string; title: string; priceCents?: number | null; url?: string }>;
  serverHeader?: string;
  extractionStrategy?: string;
  extractionErrors?: string[];
}): {
  validationStatus: CategoryUrlValidationStatus;
  accessStatus:
    | 'LIVE_VERIFIED'
    | 'VALID_CATEGORY'
    | 'INVALID_CATEGORY'
    | 'UNVERIFIED'
    | 'ACCESS_BLOCKED'
    | 'INVALID_URL'
    | 'TEST_FAILED';
  categoryMatchCount: number;
  validationEvidence: string;
  error?: string;
} {
  const {
    retailerId,
    category,
    targetUrl,
    resolvedUrl,
    httpStatus,
    html,
    detectedProducts,
    serverHeader,
    extractionStrategy,
    extractionErrors,
  } = params;
  const productsDetected = detectedProducts.length;

  // 1. Check if URL is one of the known deprecated broken URLs
  if (category && isDeprecatedBrokenCategoryUrl(retailerId, category, targetUrl)) {
    return {
      validationStatus: 'INVALID_CATEGORY',
      accessStatus: 'INVALID_URL',
      categoryMatchCount: 0,
      validationEvidence: `Deprecated broken category path (${targetUrl}) does not match retailer's official navigation structure.`,
      error: 'Deprecated/broken category path',
    };
  }

  // 2. Inspect final resolved URL after redirects for homepage, search, or error pages
  try {
    const parsedResolved = new URL(resolvedUrl || targetUrl);
    const pPath = parsedResolved.pathname.toLowerCase().replace(/\/+$/, '');
    const pSearch = parsedResolved.search.toLowerCase();

    if (!pPath || pPath === '' || pPath === '/el' || pPath === '/gr' || pPath === '/index.html') {
      return {
        validationStatus: 'INVALID_CATEGORY',
        accessStatus: 'INVALID_CATEGORY',
        categoryMatchCount: 0,
        validationEvidence: `Redirected to retailer homepage (${resolvedUrl}). Not a product category listing.`,
        error: 'Redirected to homepage',
      };
    }

    if (
      pPath.startsWith('/search') ||
      pPath.includes('/search-results') ||
      pSearch.includes('?q=') ||
      pSearch.includes('&q=') ||
      pSearch.includes('?search=')
    ) {
      return {
        validationStatus: 'INVALID_CATEGORY',
        accessStatus: 'INVALID_CATEGORY',
        categoryMatchCount: 0,
        validationEvidence: `Resolved to a search-results page (${resolvedUrl}) instead of a canonical category page.`,
        error: 'Resolved to search-results page',
      };
    }

    if (pPath.includes('/404') || pPath.includes('/not-found') || pPath.includes('/error')) {
      return {
        validationStatus: 'INVALID_CATEGORY',
        accessStatus: 'INVALID_URL',
        categoryMatchCount: 0,
        validationEvidence: `Redirected to error/404 page (${resolvedUrl}).`,
        error: 'Redirected to error page',
      };
    }
  } catch {
    // URL parsing handled by caller
  }

  // 3. HTTP 403 / 401 -> ACCESS_BLOCKED (strictly distinguished from INVALID_URL and extraction failures)
  if (httpStatus === 403 || httpStatus === 401) {
    const edgeName = serverHeader || 'Edge WAF';
    return {
      validationStatus: 'ACCESS_BLOCKED',
      accessStatus: 'ACCESS_BLOCKED',
      categoryMatchCount: 0,
      validationEvidence: `HTTP ${httpStatus} returned by ${edgeName} (${resolvedUrl}). Perimeter WAF blocked automated cloud IP; live product listing could not be inspected.`,
      error: `Access Denied (HTTP ${httpStatus}) from ${edgeName}`,
    };
  }

  // 4. HTTP 404 / 410 -> INVALID_CATEGORY
  if (httpStatus === 404 || httpStatus === 410) {
    return {
      validationStatus: 'INVALID_CATEGORY',
      accessStatus: 'INVALID_URL',
      categoryMatchCount: 0,
      validationEvidence: `HTTP ${httpStatus} Not Found (${resolvedUrl}). Category path does not exist.`,
      error: `Category path not found (HTTP ${httpStatus})`,
    };
  }

  // 5. Non-200 HTTP errors -> UNVERIFIED / TEST_FAILED
  if (httpStatus !== 200) {
    return {
      validationStatus: 'UNVERIFIED',
      accessStatus: 'TEST_FAILED',
      categoryMatchCount: 0,
      validationEvidence: `HTTP ${httpStatus || 'Network Error'} received (${resolvedUrl}). Could not verify category listing.`,
      error: `HTTP ${httpStatus || 0} error`,
    };
  }

  // 6. HTTP 200: Inspect HTML for soft-404 / error titles
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].trim() : '';
  if (
    /404|page\s*not\s*found|δεν\s*βρέθηκε|σελίδα\s*δεν\s*υπάρχει/i.test(pageTitle)
  ) {
    return {
      validationStatus: 'INVALID_CATEGORY',
      accessStatus: 'INVALID_CATEGORY',
      categoryMatchCount: 0,
      validationEvidence: `HTTP 200 soft-error page detected (Title: "${pageTitle}").`,
      error: `Soft-404 error page ("${pageTitle}")`,
    };
  }

  // 7. HTTP 200 with 0 identifiable products -> Never mark VERIFIED on bare HTTP 200!
  if (productsDetected === 0) {
    const errSuffix =
      extractionErrors && extractionErrors.length > 0 ? ` Extraction error: ${extractionErrors.join('; ')}` : '';

    // Check Kotsovolos __NEXT_DATA__ if present: distinguish non-PLP landing pages (INVALID_CATEGORY) from JS-hydrated PLP shells (UNVERIFIED)
    const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextJson = JSON.parse(nextDataMatch[1]);
        const pp = nextJson?.props?.pageProps;
        if (pp) {
          if (pp.pageType && pp.pageType !== 'listPage') {
            return {
              validationStatus: 'INVALID_CATEGORY',
              accessStatus: 'INVALID_CATEGORY',
              categoryMatchCount: 0,
              validationEvidence: `Resolved to non-listing page (pageType="${pp.pageType}" at ${resolvedUrl}), not a product category listing.`,
              error: `Non-category pageType: ${pp.pageType}`,
            };
          }
          if (pp.pageType === 'listPage' && pp.catalogIdPLP) {
            const plpTitle = pp.resultList?.title || pageTitle;
            return {
              validationStatus: 'UNVERIFIED',
              accessStatus: 'UNVERIFIED',
              categoryMatchCount: 0,
              validationEvidence: `HTTP 200 Next.js listPage shell (catalogIdPLP=${pp.catalogIdPLP}, title="${plpTitle}"), but 0 products extracted.${errSuffix} Left UNVERIFIED per strict validation rules.`,
              error: extractionErrors?.[0] || 'No products extracted from Next.js listPage',
            };
          }
        }
      } catch {
        // Fallback to standard 0-product UNVERIFIED below
      }
    }

    if (html.includes('window.prerenderReady = false')) {
      return {
        validationStatus: 'UNVERIFIED',
        accessStatus: 'UNVERIFIED',
        categoryMatchCount: 0,
        validationEvidence: `HTTP 200 Angular SPA shell received (${resolvedUrl}), but 0 products were extracted.${errSuffix} Left UNVERIFIED per strict validation rules.`,
        error: extractionErrors?.[0] || 'SPA shell returned 0 products',
      };
    }

    return {
      validationStatus: 'UNVERIFIED',
      accessStatus: 'UNVERIFIED',
      categoryMatchCount: 0,
      validationEvidence: `HTTP 200 received (${resolvedUrl}), but 0 identifiable products were detected.${errSuffix} HTTP 200 alone does not verify a category URL.`,
      error: extractionErrors?.[0] || 'No identifiable products detected in HTTP 200 response',
    };
  }

  // 8. HTTP 200 with products: verify that products belong to the expected category
  const categoryMatchCount = category
    ? verifyProductsMatchCategory(category, detectedProducts, resolvedUrl)
    : productsDetected;

  if (category && categoryMatchCount === 0) {
    return {
      validationStatus: 'INVALID_CATEGORY',
      accessStatus: 'INVALID_CATEGORY',
      categoryMatchCount: 0,
      validationEvidence: `HTTP 200 returned ${productsDetected} products at ${resolvedUrl}, but 0 matched expected category ${category} (e.g. "${detectedProducts[0]?.title || 'Unknown'}").`,
      error: `Detected products do not belong to category ${category}`,
    };
  }

  const strategyTag = extractionStrategy ? ` [${extractionStrategy}]` : '';
  return {
    validationStatus: 'VALID_CATEGORY',
    accessStatus: 'LIVE_VERIFIED',
    categoryMatchCount,
    validationEvidence: `HTTP 200 verified at ${resolvedUrl}${strategyTag}: extracted ${productsDetected} identifiable products (${categoryMatchCount} matching ${category || 'catalog'}).`,
  };
}


/**
 * Signalyn Retail Sources Management Service (Phase P0.8)
 * 
 * Server-authoritative service for:
 * 1. Managing retailer configuration, enablement, rate limits, and category URLs.
 * 2. Executing bounded read-only connectivity diagnostics directly from Signalyn's Cloud Run runtime.
 * 3. Inspecting real server headers (Akamai, Cloudflare, Perimeter WAF) and product counts without altering production history.
 * 4. Persisting verified configurations securely to Firestore `retailSources`.
 * 5. Full independence: No external proxies, no third-party feeds, no Pricelog coupling.
 */

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, collection as clientCollection, getDocs as clientGetDocs, setLogLevel as setClientLogLevel } from 'firebase/firestore';
import firebaseAppletConfig from '../../../firebase-applet-config.json' with { type: 'json' };

setClientLogLevel('silent');
import {
  RetailSource,
  RetailSourceId,
  RetailCategory,
  RetailSourceDiagnosticResult,
  RetailCategoryEndpointConfig,
  CategoryUrlValidationStatus,
  RetailCategoryStatus,
} from '../../types/retailPrice';
import {
  RETAILER_DOMAIN_METADATA,
  DEFAULT_CATEGORY_URLS,
  ALL_RETAIL_CATEGORIES,
  createDefaultCategoryEndpoints,
  validateRetailSourceUrl,
  isDeprecatedBrokenCategoryUrl,
  evaluateCategoryResponseValidation,
} from './retailSourceDefaults';
import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import { PILOT_RETAIL_SOURCES } from './pilotCatalog';
import { parsePriceToCents, extractJsonLdProducts } from './retailParserUtils';
import { extractPlaisioSku, PLAISIO_REQUEST_HEADERS } from './plaisioAdapter';
import { PublicCrawlerAdapter } from './crawlers/publicCrawlerAdapter';
import { KotsovolosCrawlerAdapter } from './crawlers/kotsovolosCrawlerAdapter';
import { PlaisioCrawlerAdapter } from './crawlers/plaisioCrawlerAdapter';

// Internal memory cache synced with Firestore
let inMemorySources: Map<RetailSourceId, RetailSource> = new Map();

const LOCAL_PERSISTENCE_PATH = path.resolve(process.cwd(), '.data', 'retailSources.json');

function readLocalPersistedSources(): Partial<Record<RetailSourceId, Partial<RetailSource>>> {
  try {
    if (fs.existsSync(LOCAL_PERSISTENCE_PATH)) {
      const raw = fs.readFileSync(LOCAL_PERSISTENCE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // Ignore local cache read errors
  }
  return {};
}

function writeLocalPersistedSources(sourcesMap: Map<RetailSourceId, RetailSource>): void {
  try {
    const dir = path.dirname(LOCAL_PERSISTENCE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj: Record<string, RetailSource> = {};
    sourcesMap.forEach((val, key) => {
      obj[key] = val;
    });
    fs.writeFileSync(LOCAL_PERSISTENCE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {
    // Ignore local cache write errors
  }
}

async function readFirestoreRetailSources(): Promise<Array<{ id: RetailSourceId; data: Partial<RetailSource> }>> {
  // 1. Try Firebase Admin SDK first
  try {
    const db = getServerDb();
    const snapshot = await db.collection('retailSources').get();
    const results: Array<{ id: RetailSourceId; data: Partial<RetailSource> }> = [];
    snapshot.forEach((doc) => {
      results.push({ id: doc.id as RetailSourceId, data: doc.data() as Partial<RetailSource> });
    });
    if (results.length > 0) {
      return results;
    }
  } catch {
    // Fall back to Firebase Web SDK public read (allowed by firestore.rules: match /retailSources/{sourceId} { allow read: if true; })
  }

  try {
    const app = getClientApps().length === 0 ? initClientApp(firebaseAppletConfig) : getClientApp();
    const clientDb = getClientFirestore(app, firebaseAppletConfig.firestoreDatabaseId);
    const snap = await clientGetDocs(clientCollection(clientDb, 'retailSources'));
    const results: Array<{ id: RetailSourceId; data: Partial<RetailSource> }> = [];
    snap.forEach((doc) => {
      results.push({ id: doc.id as RetailSourceId, data: doc.data() as Partial<RetailSource> });
    });
    return results;
  } catch (err) {
    console.warn(
      '[RetailSourceService] Firestore client read fallback notice:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

async function persistRetailSourceToFirestore(retailerId: RetailSourceId, source: RetailSource): Promise<void> {
  writeLocalPersistedSources(inMemorySources);
  try {
    const db = getServerDb();
    const { lastSuccessfulCollectionAt: _observationTimestamp, ...config } = source;
    await db.collection('retailSources').doc(retailerId).set(cleanServerData(config), { merge: true });
  } catch (err) {
    // Local persistence snapshot already updated above
  }
}

function inferValidationStatus(ep: RetailCategoryEndpointConfig): CategoryUrlValidationStatus {
  if (ep.validationStatus) return ep.validationStatus;
  if (ep.status === 'VALID_CATEGORY') return 'VALID_CATEGORY';
  if (ep.status === 'INVALID_CATEGORY' || ep.status === 'INVALID') return 'INVALID_CATEGORY';
  if (ep.status === 'ACCESS_BLOCKED' || ep.lastHttpStatus === 403 || ep.lastHttpStatus === 401) {
    return 'ACCESS_BLOCKED';
  }
  if (ep.status === 'LIVE_VERIFIED' && (ep.productsDetected ?? ep.lastDiscoveredCount ?? 0) > 0) {
    return 'VALID_CATEGORY';
  }
  return 'UNVERIFIED';
}

/**
 * Initializes and hydrates retail source configurations, automatically migrating
 * the 6 deprecated broken category URLs (Public AUDIO/TABLETS, Kotsovolos all 4)
 * while preserving all Plaisio URLs, manually configured valid URLs, and discovery settings.
 */
export async function initializeRetailSources(): Promise<void> {
  // 1. Seed defaults into memory
  PILOT_RETAIL_SOURCES.forEach((pilot) => {
    if (!inMemorySources.has(pilot.id)) {
      const meta = RETAILER_DOMAIN_METADATA[pilot.id];
      const defaultCategories = createDefaultCategoryEndpoints(pilot.id);

      inMemorySources.set(pilot.id, {
        ...pilot,
        domain: meta?.domain || `${pilot.id}.gr`,
        enabled: pilot.enabled !== undefined ? pilot.enabled : true,
        requestDelaySeconds: pilot.requestDelaySeconds || meta?.defaultDelaySeconds || 3,
        timeoutSeconds: pilot.timeoutSeconds || meta?.defaultTimeoutSeconds || 10,
        autoDiscoveryEnabled: pilot.autoDiscoveryEnabled !== undefined ? pilot.autoDiscoveryEnabled : true,
        defaultMaxPages: pilot.defaultMaxPages || 2,
        defaultMaxProducts: pilot.defaultMaxProducts || 50,
        customNotes: pilot.customNotes || meta?.defaultNotes || '',
        categoryEndpoints: defaultCategories,
      });
    }
  });

  // 2. Hydrate from Firestore (and merge any local durable snapshot)
  const firestoreDocs = await readFirestoreRetailSources();
  const localCache = readLocalPersistedSources();

  const allIds: RetailSourceId[] = ['plaisio-gr', 'public-gr', 'kotsovolos-gr'];
  for (const id of allIds) {
    const existing = inMemorySources.get(id);
    if (!existing) continue;

    const fsEntry = firestoreDocs.find((d) => d.id === id)?.data;
    const localEntry = localCache[id];
    const sourceData: Partial<RetailSource> = {
      ...(fsEntry || {}),
      ...(localEntry || {}),
      categoryEndpoints: {
        ...(fsEntry?.categoryEndpoints || {}),
        ...(localEntry?.categoryEndpoints || {}),
      } as Record<RetailCategory, RetailCategoryEndpointConfig>,
    };

    const defaultEndpoints = createDefaultCategoryEndpoints(id);
    const mergedCategories = {} as Record<RetailCategory, RetailCategoryEndpointConfig>;

    for (const cat of ALL_RETAIL_CATEGORIES) {
      const defEp = defaultEndpoints[cat];
      const storedEp = sourceData.categoryEndpoints?.[cat];

      if (!storedEp || !storedEp.url) {
        mergedCategories[cat] = { ...defEp };
        continue;
      }

      // Check if stored URL is one of the 6 deprecated broken default URLs from P1.0
      if (isDeprecatedBrokenCategoryUrl(id, cat, storedEp.url)) {
        mergedCategories[cat] = {
          ...defEp,
          enabled: storedEp.enabled !== undefined ? storedEp.enabled : true,
          autoDiscoveryEnabled: storedEp.autoDiscoveryEnabled !== undefined ? storedEp.autoDiscoveryEnabled : true,
          maxPagesPerRun: storedEp.maxPagesPerRun || defEp.maxPagesPerRun || 2,
          maxProductsPerRun: storedEp.maxProductsPerRun || defEp.maxProductsPerRun || 50,
          url: DEFAULT_CATEGORY_URLS[id][cat],
          defaultUrl: DEFAULT_CATEGORY_URLS[id][cat],
          status: 'UNVERIFIED',
          validationStatus: 'UNVERIFIED',
          isManuallyConfigured: false,
          lastError: undefined,
        };
      } else {
        const valStatus = inferValidationStatus(storedEp);
        mergedCategories[cat] = {
          ...defEp,
          ...storedEp,
          defaultUrl: DEFAULT_CATEGORY_URLS[id][cat],
          validationStatus: valStatus,
          status:
            storedEp.status === 'UNTESTED'
              ? 'UNVERIFIED'
              : storedEp.status === 'LIVE_VERIFIED' && valStatus !== 'VALID_CATEGORY'
              ? 'UNVERIFIED'
              : storedEp.status,
        };
      }
    }

    const hydratedSource: RetailSource = {
      ...existing,
      ...sourceData,
      id,
      categoryEndpoints: mergedCategories,
    };

    inMemorySources.set(id, hydratedSource);

  }

}

/**
 * Retrieves all retail source configurations
 */
export async function getRetailSourceConfigs(): Promise<RetailSource[]> {
  if (inMemorySources.size === 0) {
    await initializeRetailSources();
  }
  return Array.from(inMemorySources.values());
}

/**
 * Retrieves single retail source configuration
 */
export async function getRetailSourceConfig(
  retailerId: RetailSourceId
): Promise<RetailSource | null> {
  if (inMemorySources.size === 0) {
    await initializeRetailSources();
  }
  return inMemorySources.get(retailerId) || null;
}

/**
 * Updates a retailer's configuration with validation and Firestore persistence.
 * Never overwrites a manually configured valid URL without explicit confirmation.
 */
export async function updateRetailSourceConfig(
  retailerId: RetailSourceId,
  updates: Partial<RetailSource>,
  options: { confirmOverwriteValidUrl?: boolean; isReset?: boolean } = {}
): Promise<RetailSource> {
  if (inMemorySources.size === 0) {
    await initializeRetailSources();
  }

  const current = inMemorySources.get(retailerId);
  if (!current) {
    throw new Error(`Retailer '${retailerId}' not found.`);
  }

  // 1. Validate category URLs if provided
  const updatedCategories = { ...(current.categoryEndpoints || createDefaultCategoryEndpoints(retailerId)) };
  if (updates.categoryEndpoints) {
    for (const [catKey, catConfig] of Object.entries(updates.categoryEndpoints)) {
      const cat = catKey as RetailCategory;
      if (ALL_RETAIL_CATEGORIES.includes(cat) && catConfig?.url) {
        const prevCat = updatedCategories[cat];
        const validation = validateRetailSourceUrl(retailerId, catConfig.url);
        if (!validation.valid) {
          throw new Error(`Invalid URL for ${cat}: ${validation.error}`);
        }

        const normalizedNewUrl = validation.normalizedUrl || catConfig.url.trim();

        if (isDeprecatedBrokenCategoryUrl(retailerId, cat, normalizedNewUrl)) {
          throw new Error(
            `Deprecated broken category URL rejected for ${cat} (${normalizedNewUrl}). Use the official retailer navigation path.`
          );
        }

        const urlChanged = prevCat && prevCat.url !== normalizedNewUrl;

        // Guard: Never overwrite a manually configured valid URL without confirmation
        if (
          urlChanged &&
          prevCat?.isManuallyConfigured &&
          prevCat?.validationStatus === 'VALID_CATEGORY' &&
          !options.confirmOverwriteValidUrl
        ) {
          throw new Error(
            `Confirmation required before overwriting manually configured valid URL for ${cat} (${prevCat.url}).`
          );
        }

        const isCustomUrl = normalizedNewUrl !== DEFAULT_CATEGORY_URLS[retailerId][cat];
        const explicitlyValidated =
          catConfig.validationStatus === 'VALID_CATEGORY' && prevCat?.validationStatus !== 'VALID_CATEGORY';

        updatedCategories[cat] = {
          ...prevCat,
          ...catConfig,
          url: normalizedNewUrl,
          defaultUrl: DEFAULT_CATEGORY_URLS[retailerId][cat],
          isManuallyConfigured: options.isReset
            ? false
            : urlChanged
            ? isCustomUrl || Boolean(catConfig.isManuallyConfigured)
            : (catConfig.isManuallyConfigured ?? prevCat?.isManuallyConfigured ?? isCustomUrl),
          status:
            urlChanged && !explicitlyValidated
              ? 'UNVERIFIED'
              : (catConfig.status || prevCat?.status || 'UNVERIFIED'),
          validationStatus:
            urlChanged && !explicitlyValidated
              ? 'UNVERIFIED'
              : (catConfig.validationStatus || prevCat?.validationStatus || 'UNVERIFIED'),
          resolvedUrl:
            urlChanged && !explicitlyValidated
              ? undefined
              : (catConfig.resolvedUrl ?? prevCat?.resolvedUrl),
          productsDetected:
            urlChanged && !explicitlyValidated
              ? undefined
              : (catConfig.productsDetected ?? prevCat?.productsDetected),
          categoryMatchCount:
            urlChanged && !explicitlyValidated
              ? undefined
              : (catConfig.categoryMatchCount ?? prevCat?.categoryMatchCount),
          validationEvidence:
            urlChanged && !explicitlyValidated
              ? 'URL updated; run Probe to validate category product listing.'
              : (catConfig.validationEvidence ?? prevCat?.validationEvidence),
        };
      }
    }
  }

  // 2. Validate bounds on delay and timeout
  const requestDelaySeconds =
    updates.requestDelaySeconds !== undefined
      ? Math.max(1, Math.min(60, Number(updates.requestDelaySeconds)))
      : current.requestDelaySeconds || 3;

  const timeoutSeconds =
    updates.timeoutSeconds !== undefined
      ? Math.max(3, Math.min(30, Number(updates.timeoutSeconds)))
      : current.timeoutSeconds || 10;

  // 3. Assemble merged object
  const merged: RetailSource = {
    ...current,
    ...updates,
    id: retailerId,
    domain: current.domain || RETAILER_DOMAIN_METADATA[retailerId]?.domain,
    enabled: updates.enabled !== undefined ? Boolean(updates.enabled) : (current.enabled ?? true),
    requestDelaySeconds,
    timeoutSeconds,
    autoDiscoveryEnabled:
      updates.autoDiscoveryEnabled !== undefined
        ? Boolean(updates.autoDiscoveryEnabled)
        : (current.autoDiscoveryEnabled ?? true),
    defaultMaxPages:
      updates.defaultMaxPages !== undefined
        ? Math.max(1, Math.min(10, Number(updates.defaultMaxPages)))
        : (current.defaultMaxPages || 2),
    defaultMaxProducts:
      updates.defaultMaxProducts !== undefined
        ? Math.max(5, Math.min(200, Number(updates.defaultMaxProducts)))
        : (current.defaultMaxProducts || 50),
    customNotes: updates.customNotes !== undefined ? String(updates.customNotes).slice(0, 2000) : current.customNotes,
    categoryEndpoints: updatedCategories,
  };

  // 4. Update memory cache & persist
  inMemorySources.set(retailerId, merged);
  await persistRetailSourceToFirestore(retailerId, merged);

  return merged;
}

/**
 * Resets a retailer's configuration and URLs back to verified defaults
 */
export async function resetRetailSourceDefaults(
  retailerId: RetailSourceId,
  options: { confirmOverwriteValidUrl?: boolean } = { confirmOverwriteValidUrl: true }
): Promise<RetailSource> {
  const meta = RETAILER_DOMAIN_METADATA[retailerId];
  if (!meta) {
    throw new Error(`Unknown retailer ${retailerId}`);
  }

  if (inMemorySources.size === 0) {
    await initializeRetailSources();
  }
  const current = inMemorySources.get(retailerId);

  const defaultCategories = createDefaultCategoryEndpoints(retailerId);
  if (current?.categoryEndpoints) {
    for (const cat of ALL_RETAIL_CATEGORIES) {
      const prev = current.categoryEndpoints[cat];
      if (prev) {
        defaultCategories[cat] = {
          ...defaultCategories[cat],
          enabled: prev.enabled !== undefined ? prev.enabled : true,
          autoDiscoveryEnabled: prev.autoDiscoveryEnabled !== undefined ? prev.autoDiscoveryEnabled : true,
          maxPagesPerRun: prev.maxPagesPerRun || 2,
          maxProductsPerRun: prev.maxProductsPerRun || 50,
        };
      }
    }
  }

  const resetSource: Partial<RetailSource> = {
    enabled: true,
    requestDelaySeconds: meta.defaultDelaySeconds,
    timeoutSeconds: meta.defaultTimeoutSeconds,
    customNotes: meta.defaultNotes,
    categoryEndpoints: defaultCategories,
  };

  return updateRetailSourceConfig(retailerId, resetSource, {
    confirmOverwriteValidUrl: options.confirmOverwriteValidUrl ?? true,
    isReset: true,
  });
}

/**
 * Executes a single, bounded read-only connectivity and category validation probe
 * for a retailer or category URL.
 * 
 * Strict Validation Rules (P1.1):
 * - HTTP 200 alone does NOT prove that a category URL is correct.
 * - A URL is NEVER marked VALID_CATEGORY / LIVE_VERIFIED unless the response contains
 *   identifiable products belonging to the expected category.
 * - HTTP 403 is categorized as ACCESS_BLOCKED (distinct from INVALID_URL / INVALID_CATEGORY).
 * - Tracks final resolved URL after redirects and number of products detected.
 */
export async function testRetailSourceConnection(
  retailerId: RetailSourceId,
  options: {
    category?: RetailCategory;
    customUrl?: string;
    timeoutSeconds?: number;
  } = {}
): Promise<{ diagnostic: RetailSourceDiagnosticResult; source: RetailSource }> {
  if (inMemorySources.size === 0) {
    await initializeRetailSources();
  }

  const source = inMemorySources.get(retailerId);
  if (!source) {
    throw new Error(`Retailer '${retailerId}' does not exist.`);
  }

  const timestamp = new Date().toISOString();
  const targetCategory: RetailCategory | undefined = options.category || 'WEARABLES';

  // 1. Resolve Target URL
  let targetUrl = options.customUrl?.trim();
  if (!targetUrl) {
    if (options.category && source.categoryEndpoints?.[options.category]?.url) {
      targetUrl = source.categoryEndpoints[options.category].url;
    } else if (options.category) {
      targetUrl = DEFAULT_CATEGORY_URLS[retailerId][options.category];
    } else {
      targetUrl =
        source.categoryEndpoints?.WEARABLES?.url ||
        DEFAULT_CATEGORY_URLS[retailerId]?.WEARABLES ||
        source.websiteUrl;
    }
  }

  // 2. Strict SSRF & syntax URL validation
  const validation = validateRetailSourceUrl(retailerId, targetUrl);
  if (!validation.valid) {
    const invalidDiag: RetailSourceDiagnosticResult = {
      timestamp,
      targetUrl,
      resolvedUrl: targetUrl,
      redirected: false,
      category: options.category,
      retailerId,
      httpStatus: 0,
      responseTimeMs: 0,
      serverHeaders: {},
      hasHtml: false,
      productsDetected: 0,
      categoryMatchCount: 0,
      validationStatus: 'INVALID_CATEGORY',
      validationEvidence: `URL Validation Failed: ${validation.error}`,
      accessStatus: 'INVALID_URL',
      error: validation.error,
      diagnosticDetails: `URL Validation Failed: ${validation.error}`,
    };

    return { diagnostic: invalidDiag, source };
  }

  targetUrl = validation.normalizedUrl || targetUrl;

  // 3. Setup bounded request
  const timeoutMs = Math.min((options.timeoutSeconds || source.timeoutSeconds || 10) * 1000, 25000);
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

  const reqHeaders: Record<string, string> = { ...PLAISIO_REQUEST_HEADERS };

  const startTime = performance.now();
  let httpStatus = 0;
  const capturedHeaders: Record<string, string> = {};
  let hasHtml = false;
  let resolvedUrl = targetUrl;
  let redirected = false;
  let extractionStrategy = 'STATIC_HTML_STRUCTURED';
  let totalProductsAvailable: number | undefined;
  let hasNextPage: boolean | undefined;
  const extractionErrors: string[] = [];
  const detectedProductsList: Array<{ sku: string; title: string; priceCents?: number | null; url?: string }> = [];

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: reqHeaders,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutTimer);
    httpStatus = response.status;
    resolvedUrl = response.url || targetUrl;
    redirected = Boolean(response.redirected || (resolvedUrl && resolvedUrl !== targetUrl));

    // Capture diagnostic server headers
    const headerKeys = [
      'server',
      'content-type',
      'x-akamai-transformed',
      'x-akamai-request-id',
      'cf-ray',
      'via',
      'date',
      'content-length',
      'set-cookie',
    ];
    headerKeys.forEach((k) => {
      const val = response.headers.get(k);
      if (val) capturedHeaders[k] = val;
    });

    // Read bounded body
    const rawText = await response.text();
    const boundedText = rawText.slice(0, 512 * 1024); // max 512 KB
    hasHtml =
      boundedText.toLowerCase().includes('<!doctype html') ||
      boundedText.toLowerCase().includes('<html') ||
      (response.headers.get('content-type') || '').includes('text/html');

    if (httpStatus === 403 || httpStatus === 401) {
      extractionStrategy = 'BLOCKED_PERIMETER_WAF';
    } else if (httpStatus === 200) {
      // AUTO Extraction Mode:
      // 1. Try structured data + static HTML extraction first
      if (retailerId === 'plaisio-gr') {
        const $ = cheerio.load(boundedText);
        const structuredContainer = $('#StructuredDataItemListB2C');
        if (structuredContainer.length > 0) {
          const rawJson = structuredContainer.html() || structuredContainer.text();
          try {
            const parsed = JSON.parse(rawJson);
            const items = parsed.itemListElement || (Array.isArray(parsed) ? parsed : []);
            items.forEach((it: any) => {
              const item = it.item || it;
              const sku = String(item.sku || extractPlaisioSku(item.url || '') || '').trim();
              const title = String(item.name || '').trim();
              const priceCents = parsePriceToCents(
                item.offers?.price || item.offers?.priceSpecification?.price || item.price
              );
              if (title) {
                detectedProductsList.push({ sku: sku || 'sku', title, priceCents, url: item.url || resolvedUrl });
              }
            });
            if (detectedProductsList.length > 0) {
              extractionStrategy = 'STRUCTURED_DATA_JSON_LD';
              hasNextPage = detectedProductsList.length >= 12;
            }
          } catch {
            // Fallback to PlaisioCrawlerAdapter below
          }
        }

        if (detectedProductsList.length === 0) {
          const adapter = new PlaisioCrawlerAdapter();
          const extracted = adapter.extractFromHtml(resolvedUrl, boundedText, targetCategory, 1);
          extracted.products.forEach((p) => {
            detectedProductsList.push({
              sku: p.retailerSku,
              title: p.title,
              priceCents: p.priceCents,
              url: p.sourceUrl,
            });
          });
          if (detectedProductsList.length > 0) {
            extractionStrategy = 'STRUCTURED_DATA_JSON_LD';
            hasNextPage = extracted.hasNextPage;
          }
        }
      } else if (retailerId === 'public-gr') {
        const adapter = new PublicCrawlerAdapter();
        const extracted = adapter.extractFromHtml(resolvedUrl, boundedText, targetCategory, 1);
        extracted.products.forEach((p) => {
          detectedProductsList.push({
            sku: p.retailerSku,
            title: p.title,
            priceCents: p.priceCents,
            url: p.sourceUrl,
          });
        });

        // 2. If static HTML returned 0 products (Angular SPA shell), run Public's legitimate dynamic category state extraction
        if (detectedProductsList.length === 0) {
          const dynamicRes = await adapter.extractDynamicFromPage(
            resolvedUrl,
            boundedText,
            targetCategory,
            1,
            options.timeoutSeconds || source.timeoutSeconds || 12
          );
          extractionStrategy = dynamicRes.extractionStrategy;
          totalProductsAvailable = dynamicRes.totalCount;
          hasNextPage = dynamicRes.hasNextPage;
          if (dynamicRes.errors && dynamicRes.errors.length > 0) {
            extractionErrors.push(...dynamicRes.errors);
          }
          dynamicRes.products.forEach((p) => {
            detectedProductsList.push({
              sku: p.retailerSku,
              title: p.title,
              priceCents: p.priceCents,
              url: p.sourceUrl,
            });
          });
        } else {
          extractionStrategy = 'STATIC_HTML_STRUCTURED';
          hasNextPage = extracted.hasNextPage;
        }
      } else if (retailerId === 'kotsovolos-gr') {
        const adapter = new KotsovolosCrawlerAdapter();
        const extracted = adapter.extractFromHtml(resolvedUrl, boundedText, targetCategory, 1);
        extracted.products.forEach((p) => {
          detectedProductsList.push({
            sku: p.retailerSku,
            title: p.title,
            priceCents: p.priceCents,
            url: p.sourceUrl,
          });
        });

        // 2. If static HTML returned 0 products (Next.js listPage shell), run Kotsovolos's legitimate Next.js PLP extraction
        if (detectedProductsList.length === 0) {
          const dynamicRes = await adapter.extractDynamicFromPage(
            resolvedUrl,
            boundedText,
            targetCategory,
            1,
            options.timeoutSeconds || source.timeoutSeconds || 12
          );
          extractionStrategy = dynamicRes.extractionStrategy;
          totalProductsAvailable = dynamicRes.totalCount;
          hasNextPage = dynamicRes.hasNextPage;
          if (dynamicRes.errors && dynamicRes.errors.length > 0) {
            extractionErrors.push(...dynamicRes.errors);
          }
          dynamicRes.products.forEach((p) => {
            detectedProductsList.push({
              sku: p.retailerSku,
              title: p.title,
              priceCents: p.priceCents,
              url: p.sourceUrl,
            });
          });
        } else {
          extractionStrategy = 'STATIC_HTML_STRUCTURED';
          hasNextPage = extracted.hasNextPage;
        }
      }

      // Generic JSON-LD fallback if adapter found 0 items
      if (detectedProductsList.length === 0) {
        const jsonLd = extractJsonLdProducts(boundedText);
        jsonLd.forEach((p) => {
          const title = String(p.name || '').trim();
          if (title) {
            detectedProductsList.push({
              sku: String(p.sku || 'sku'),
              title,
              priceCents: parsePriceToCents((p.offers as any)?.price),
              url: String(p.url || resolvedUrl),
            });
          }
        });
        if (detectedProductsList.length > 0) {
          extractionStrategy = 'GENERIC_JSON_LD';
        }
      }
    }

    const responseTimeMs = Math.round(performance.now() - startTime);

    const evalResult = evaluateCategoryResponseValidation({
      retailerId,
      category: targetCategory,
      targetUrl,
      resolvedUrl,
      httpStatus,
      html: boundedText,
      detectedProducts: detectedProductsList,
      serverHeader: capturedHeaders['server'],
      extractionStrategy,
      extractionErrors,
    });

    const productsDetected = detectedProductsList.length;
    const detectedProductsSummary = detectedProductsList.slice(0, 5).map(({ sku, title, priceCents }) => ({
      sku,
      title,
      priceCents,
    }));

    const diagnosticDetails =
      evalResult.validationStatus === 'ACCESS_BLOCKED'
        ? `Perimeter Access Control: ${evalResult.validationEvidence}`
        : evalResult.validationEvidence;

    const diagnosticResult: RetailSourceDiagnosticResult = {
      timestamp,
      targetUrl,
      resolvedUrl,
      redirected,
      category: options.category,
      retailerId,
      httpStatus,
      responseTimeMs,
      serverHeaders: capturedHeaders,
      hasHtml,
      productsDetected,
      categoryMatchCount: evalResult.categoryMatchCount,
      extractionStrategy,
      pagesProcessed: 1,
      extractionErrors: extractionErrors.length > 0 ? extractionErrors : undefined,
      totalProductsAvailable,
      hasNextPage,
      validationStatus: evalResult.validationStatus,
      validationEvidence: evalResult.validationEvidence,
      detectedProductsSummary: detectedProductsSummary.length > 0 ? detectedProductsSummary : undefined,
      accessStatus: evalResult.accessStatus,
      error: evalResult.error,
      diagnosticDetails,
    };

    const updatedSource = await applyDiagnosticToSource(source, diagnosticResult, options.category);
    return { diagnostic: diagnosticResult, source: updatedSource };
  } catch (err: unknown) {
    clearTimeout(timeoutTimer);
    const responseTimeMs = Math.round(performance.now() - startTime);
    const isTimeout = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    const errorMsg = isTimeout ? `Request timed out after ${timeoutMs}ms` : (err instanceof Error ? err.message : String(err));
    const diagnosticDetails = `Network error connecting to ${targetUrl}: ${errorMsg}`;

    const diagnosticResult: RetailSourceDiagnosticResult = {
      timestamp,
      targetUrl,
      resolvedUrl: targetUrl,
      redirected: false,
      category: options.category,
      retailerId,
      httpStatus: 0,
      responseTimeMs,
      serverHeaders: capturedHeaders,
      hasHtml: false,
      productsDetected: 0,
      categoryMatchCount: 0,
      extractionStrategy: 'NETWORK_ERROR',
      pagesProcessed: 0,
      extractionErrors: [errorMsg],
      validationStatus: 'UNVERIFIED',
      validationEvidence: diagnosticDetails,
      accessStatus: 'TEST_FAILED',
      error: errorMsg,
      diagnosticDetails,
    };

    const updatedSource = await applyDiagnosticToSource(source, diagnosticResult, options.category);
    return { diagnostic: diagnosticResult, source: updatedSource };
  }
}

/**
 * Applies a diagnostic result to the source in memory and Firestore
 */
async function applyDiagnosticToSource(
  source: RetailSource,
  diagnostic: RetailSourceDiagnosticResult,
  category?: RetailCategory
): Promise<RetailSource> {
  const updatedCategories = { ...(source.categoryEndpoints || createDefaultCategoryEndpoints(source.id)) };

  if (category && updatedCategories[category]) {
    const valStatus: CategoryUrlValidationStatus =
      diagnostic.validationStatus ||
      (diagnostic.accessStatus === 'LIVE_VERIFIED' && diagnostic.productsDetected > 0
        ? 'VALID_CATEGORY'
        : diagnostic.accessStatus === 'ACCESS_BLOCKED'
        ? 'ACCESS_BLOCKED'
        : diagnostic.accessStatus === 'INVALID_URL' || diagnostic.accessStatus === 'INVALID_CATEGORY'
        ? 'INVALID_CATEGORY'
        : 'UNVERIFIED');

    const catStatus: RetailCategoryStatus =
      valStatus === 'VALID_CATEGORY'
        ? 'LIVE_VERIFIED'
        : valStatus === 'ACCESS_BLOCKED'
        ? 'ACCESS_BLOCKED'
        : valStatus === 'INVALID_CATEGORY'
        ? 'INVALID_CATEGORY'
        : 'UNVERIFIED';

    updatedCategories[category] = {
      ...updatedCategories[category],
      status: catStatus,
      validationStatus: valStatus,
      resolvedUrl: diagnostic.resolvedUrl || diagnostic.targetUrl,
      redirected: diagnostic.redirected,
      productsDetected: diagnostic.productsDetected,
      categoryMatchCount: diagnostic.categoryMatchCount,
      extractionStrategy: diagnostic.extractionStrategy,
      pagesProcessed: diagnostic.pagesProcessed ?? 1,
      extractionErrors: diagnostic.extractionErrors,
      validationEvidence: diagnostic.validationEvidence || diagnostic.diagnosticDetails,
      lastTestedAt: diagnostic.timestamp,
      lastHttpStatus: diagnostic.httpStatus,
      lastResponseTimeMs: diagnostic.responseTimeMs,
      lastError: diagnostic.error,
    };
  }

  const updatedSource: RetailSource = {
    ...source,
    lastAttemptedAt: diagnostic.timestamp,
    lastCheckedAt: diagnostic.timestamp,
    lastHttpStatus: diagnostic.httpStatus,
    lastError: diagnostic.error,
    lastDiagnostic: diagnostic,
    categoryEndpoints: updatedCategories,
  };

  if (diagnostic.validationStatus === 'VALID_CATEGORY' && diagnostic.accessStatus === 'LIVE_VERIFIED') {
    updatedSource.lastSuccessAt = diagnostic.timestamp;
    updatedSource.readinessState = 'LIVE_READY';
    updatedSource.status = 'ACTIVE';
  } else if (diagnostic.accessStatus === 'ACCESS_BLOCKED') {
    updatedSource.readinessState = 'ACCESS_BLOCKED';
    updatedSource.status = 'REQUIRES_AUTHORIZATION';
  }

  inMemorySources.set(source.id, updatedSource);
  await persistRetailSourceToFirestore(source.id, updatedSource);

  return updatedSource;
}


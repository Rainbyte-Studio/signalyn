/**
 * Signalyn Retail Price Intelligence - Product Discovery & Ingestion Engine (Phase P1.0)
 * 
 * Ingests products discovered by category crawlers:
 * 1. Matches offers against existing catalog using productMatcher (strict variant separation).
 * 2. Creates new canonical RetailProduct items for genuinely new products (isPilot: false).
 * 3. Enqueues uncertain matches into retailMatchReviews without merging distinct variants.
 * 4. Updates RetailOffer records with live verified pricing in integer EUR cents.
 * 5. Stores durable daily price observations in retailPriceHistory idempotently.
 * 6. Preserves historical baseline records without modifying pilot provenance.
 * 7. Persists state safely to Firestore with in-memory caching.
 */

import {
  RetailSourceId,
  RetailCategory,
  RetailProduct,
  RetailOffer,
  RetailPriceHistoryEntry,
  RetailMatchReview,
  DiscoveredProductItem,
} from '../../types/retailPrice';
import { ExtractedProductRecord } from './crawlers/crawlerTypes';
import { matchOfferToCatalog } from './productMatcher';
import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import { getAthensCurrentDateString } from '../reportingWindow';
import {
  getMemCatalog,
  getMemOffers,
  getMemPriceHistory,
  getMemReviews,
  getMemSources,
} from './retailPipelineService';
import { normalizeBrand } from './brandNormalizer';
import { classifyProductTaxonomy } from './taxonomyClassifier';

export interface IngestionResult {
  productsDiscovered: number;
  productsCreated: number;
  offersUpdated: number;
  pricesChanged: number;
  reviewsCreated: number;
  previewItems: DiscoveredProductItem[];
  persistenceStatus: 'PERSISTED_TO_FIRESTORE' | 'FAILED_PERMISSION_DENIED';
  persistenceError?: string;
}

/**
 * Normalizes title into a clean canonical product ID slug with stable brand and variant handling
 */
function generateCanonicalProductId(brand: string, title: string, _category: RetailCategory): string {
  const normBrand = normalizeBrand(brand);
  const cleanBrand = normBrand.id.toLowerCase().replace(/[^a-z0-9]/g, '');

  let cleanTitle = title
    .toLowerCase()
    .replace(/\b(smartphone|smartphones|smartwatch|tablet|tablets)\b/gi, '')
    // Normalize variant phrasing to prevent duplicates across retailer naming quirks
    .replace(/\bwith\s+active\s+noise\s+cancellation\b/gi, 'active-noise-cancellation')
    .replace(/\bactive\s+noise\s+cancellation\b/gi, 'active-noise-cancellation')
    .replace(/\banc\b/gi, 'active-noise-cancellation')
    .replace(/\bwi[\s-]?fi\b/gi, 'wifi')
    .replace(/\b(with|με|w\/)\b/gi, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  if (cleanTitle.startsWith(`${cleanBrand}-`)) {
    cleanTitle = cleanTitle.slice(cleanBrand.length + 1);
  }
  cleanTitle = cleanTitle.slice(0, 76);

  return `prod-${cleanBrand}-${cleanTitle}`;
}

/**
 * Extracts clean modelFamily string from product title for cross-retailer matching
 */
function extractCleanModelFamily(_brand: string, title: string): string {
  return title
    .replace(/\b(Smartphone|Smartphones|Smartwatch|Tablet|Tablets|Κινητό|Ρολόι|Ακουστικά)\b/gi, '')
    .replace(/\b\d{1,2}\s*(?:GB|G)\s*[/+]\s*\d{2,4}\s*(?:GB|G|TB)\b/gi, '')
    .replace(/\b(16|32|64|128|256|512)\s*(?:GB|G)\b|\b(1|2)\s*TB\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 75);
}

/**
 * Extracts storage spec from title or URL if present (e.g. 8GB/256GB -> 256GB, 512GB, 256GB, 128GB, 64GB, 1TB)
 */
function extractStorageFromTitle(title: string, url?: string): string | undefined {
  const ramStorageMatch = title.match(/\b(\d{1,2})\s*(?:gb|g)\s*[/+]\s*(\d{2,4})\s*(gb|g|tb)\b/i);
  if (ramStorageMatch) {
    const unit = ramStorageMatch[3].toUpperCase() === 'G' ? 'GB' : ramStorageMatch[3].toUpperCase();
    return `${ramStorageMatch[2]}${unit}`;
  }
  const match = title.match(/\b(32|64|128|256|512)\s*(?:gb|g)\b|\b(1|2)\s*tb\b/i);
  if (match) {
    return match[0].toUpperCase().replace(/\s+/g, '').replace(/G$/, 'GB');
  }
  if (url) {
    const urlMatch = url.match(/(?:^|[-_/])(32|64|128|256|512)(gb)|(?:^|[-_/])(1|2)(tb)/i);
    if (urlMatch) {
      if (urlMatch[1] && urlMatch[2]) return `${urlMatch[1]}${urlMatch[2].toUpperCase()}`;
      if (urlMatch[3] && urlMatch[4]) return `${urlMatch[3]}${urlMatch[4].toUpperCase()}`;
    }
  }
  return undefined;
}

/**
 * Ingests an array of discovered product records into the retail price intelligence repository.
 */
export async function ingestDiscoveredProducts(
  retailerId: RetailSourceId,
  category: RetailCategory,
  records: ExtractedProductRecord[]
): Promise<IngestionResult> {
  const dateAthens = getAthensCurrentDateString();
  const timestamp = new Date().toISOString();

  const memProducts = getMemCatalog();
  const memOffers = getMemOffers();
  const memPriceHistory = getMemPriceHistory();
  const memReviews = getMemReviews();
  const memSources = getMemSources();

  let productsCreated = 0;
  let offersUpdated = 0;
  let pricesChanged = 0;
  let reviewsCreated = 0;
  const previewItems: DiscoveredProductItem[] = [];

  const pendingProducts: RetailProduct[] = [];
  const pendingOffers: RetailOffer[] = [];
  const pendingHistory: RetailPriceHistoryEntry[] = [];
  const pendingReviews: RetailMatchReview[] = [];

  for (const record of records) {
    if (!record.priceCents || record.priceCents <= 0) {
      continue; // Never ingest zero or missing prices
    }

    const offerId = `${retailerId}__${record.retailerSku}`;
    const existingOffer = memOffers.get(offerId);

    // 1. Match against current canonical catalog
    const catalogList = Array.from(memProducts.values());
    const match = matchOfferToCatalog(
      {
        title: record.title,
        brand: record.brand,
        ean: record.ean,
        url: record.sourceUrl,
      },
      catalogList
    );

    let canonicalProductId: string | undefined;

    if (match.confidence === 'EXACT' || match.confidence === 'HIGH_CONFIDENCE') {
      canonicalProductId = match.productId;
    } else if (match.confidence === 'NEEDS_REVIEW') {
      // If existing offer was already explicitly bound, preserve its link; otherwise keep unlinked pending manual review
      canonicalProductId = existingOffer?.canonicalProductId;
      const reviewId = `rev-${retailerId}__${record.retailerSku}`;
      const reviewRecord: RetailMatchReview = {
        id: reviewId,
        offerId,
        retailerId,
        sourceTitle: record.title,
        sourceBrand: record.brand,
        sourceUrl: record.sourceUrl,
        sourcePriceCents: record.priceCents,
        candidateProductId: match.productId,
        candidateProductName: match.productId ? memProducts.get(match.productId)?.name : undefined,
        confidenceScore: match.confidenceScore,
        suggestedConfidence: match.confidence,
        matchReasons: match.reasons,
        status: 'PENDING',
        createdAt: timestamp,
      };

      memReviews.set(reviewId, reviewRecord);
      pendingReviews.push(reviewRecord);
      reviewsCreated++;
    } else {
      // UNMATCHED: Discover and register a new canonical RetailProduct!
      let newProdId = generateCanonicalProductId(record.brand, record.title, category);
      // Guard against slug collision when matchOfferToCatalog determined this is a distinct unmatched product
      if (memProducts.has(newProdId)) {
        const existingProd = memProducts.get(newProdId)!;
        if (existingProd.name.toLowerCase().trim() !== record.title.toLowerCase().trim()) {
          const cleanSku = record.retailerSku.toLowerCase().replace(/[^a-z0-9]/g, '');
          newProdId = `${newProdId}-${cleanSku}`;
        }
      }
      canonicalProductId = newProdId;

      if (!memProducts.has(newProdId)) {
        const normBrand = normalizeBrand(record.brand);
        const taxonomy = classifyProductTaxonomy(record.title, category);

        const newProduct: RetailProduct = {
          id: newProdId,
          name: record.title,
          brand: normBrand.displayName,
          category: taxonomy.effectiveCategory,
          modelFamily: extractCleanModelFamily(normBrand.displayName, record.title),
          storage: extractStorageFromTitle(record.title, record.sourceUrl),
          ean: record.ean,
          isPilot: false, // Live discovered product, not pilot!
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        memProducts.set(newProdId, newProduct);
        pendingProducts.push(newProduct);
        productsCreated++;
      }
    }

    // 2. Track Price Changes
    if (existingOffer && existingOffer.currentPriceCents && existingOffer.currentPriceCents !== record.priceCents) {
      pricesChanged++;
    }

    // 3. Update or create RetailOffer
    const retailerName = retailerId === 'plaisio-gr' ? 'Plaisio' : retailerId === 'public-gr' ? 'Public' : 'Kotsovolos';

    const offer: RetailOffer = {
      id: offerId,
      retailerId,
      retailerName,
      canonicalProductId,
      matchConfidence: match.confidence,
      title: record.title,
      brand: record.brand,
      url: record.sourceUrl,
      retailerSku: record.retailerSku,
      currentPriceCents: record.priceCents,
      referencePriceCents: record.referencePriceCents,
      currency: 'EUR',
      isAvailable: record.isAvailable,
      stockStatus: record.stockStatus,
      priceSourceType: 'LIVE_SCRAPED',
      observationStatus: 'LIVE_VERIFIED',
      isLiveVerified: true,
      sourceVerifiedAt: timestamp,
      lastSuccessfulFetchAt: timestamp,
      lastObservedAt: timestamp,
      extractedAt: record.extractedAt || timestamp,
      provenanceNote: `Discovered from live ${retailerName} category crawl (${category}).`,
      status: 'ACTIVE',
    };

    memOffers.set(offerId, offer);
    pendingOffers.push(offer);
    offersUpdated++;

    // 4. Store Daily Price Observation in RetailPriceHistory (Idempotent per day)
    const historyId = `${retailerId}__${record.retailerSku}__${dateAthens}`;
    const historyEntry: RetailPriceHistoryEntry = {
      id: historyId,
      offerId,
      retailerId,
      canonicalProductId: canonicalProductId || 'unmatched',
      dateAthens,
      priceCents: record.priceCents,
      referencePriceCents: record.referencePriceCents,
      currency: 'EUR',
      isAvailable: record.isAvailable,
      stockStatus: record.stockStatus,
      priceSourceType: 'LIVE_SCRAPED',
      observationStatus: 'LIVE_VERIFIED',
      isLiveVerified: true,
      recordedAt: timestamp,
    };

    memPriceHistory.set(historyId, historyEntry);
    pendingHistory.push(historyEntry);

    // 5. Append to UI Preview Items
    previewItems.push({
      retailerId,
      retailerSku: record.retailerSku,
      title: record.title,
      brand: record.brand,
      model: record.model,
      category,
      priceCents: record.priceCents,
      referencePriceCents: record.referencePriceCents,
      currency: 'EUR',
      url: record.sourceUrl,
      imageUrl: record.imageUrl,
      availability: record.stockStatus,
      ean: record.ean,
      extractedAt: record.extractedAt,
      isLiveVerified: true,
      pageNumber: record.pageNumber,
      matchedProductId: canonicalProductId,
      matchConfidence: match.confidence,
    });
  }

  // 6. Update RetailSource state
  const source = memSources.get(retailerId);
  if (source) {
    source.lastDiscoveryAt = timestamp;
    source.lastDiscoveryStatus = records.length > 0 ? 'COMPLETED' : 'FAILED';
    source.discoveredProductsCount = (source.discoveredProductsCount || 0) + productsCreated;

    if (source.categoryEndpoints && source.categoryEndpoints[category]) {
      source.categoryEndpoints[category].lastDiscoveredAt = timestamp;
      source.categoryEndpoints[category].lastDiscoveredCount = records.length;
      source.categoryEndpoints[category].productsDetected = records.length;
      source.categoryEndpoints[category].status = records.length > 0 ? 'LIVE_VERIFIED' : 'UNVERIFIED';
      source.categoryEndpoints[category].validationStatus = records.length > 0 ? 'VALID_CATEGORY' : 'UNVERIFIED';
    }
  }

  let persistenceStatus: 'PERSISTED_TO_FIRESTORE' | 'FAILED_PERMISSION_DENIED' = 'PERSISTED_TO_FIRESTORE';
  let persistenceError: string | undefined;

  // Commit Firestore mutations safely in chunks of 400 operations
  try {
    const db = getServerDb();
    const ops: Array<{ collection: string; id: string; data: any }> = [];

    for (const prod of pendingProducts) {
      ops.push({ collection: 'retailProducts', id: prod.id, data: cleanServerData(prod) });
    }
    for (const off of pendingOffers) {
      ops.push({ collection: 'retailOffers', id: off.id, data: cleanServerData(off) });
    }
    for (const hist of pendingHistory) {
      ops.push({ collection: 'retailPriceHistory', id: hist.id, data: cleanServerData(hist) });
    }
    for (const rev of pendingReviews) {
      ops.push({ collection: 'retailMatchReviews', id: rev.id, data: cleanServerData(rev) });
    }
    if (source) {
      ops.push({ collection: 'retailSources', id: retailerId, data: cleanServerData(source) });
    }

    const CHUNK_SIZE = 400;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const chunk = ops.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      for (const op of chunk) {
        batch.set(db.collection(op.collection).doc(op.id), op.data, { merge: true });
      }
      await batch.commit();
    }
  } catch (err) {
    persistenceStatus = 'FAILED_PERMISSION_DENIED';
    persistenceError = err instanceof Error ? err.message : String(err);
    console.warn('[ProductDiscoveryEngine] Firestore batch write failed:', persistenceError);
  }

  return {
    productsDiscovered: records.length,
    productsCreated,
    offersUpdated,
    pricesChanged,
    reviewsCreated,
    previewItems,
    persistenceStatus,
    persistenceError,
  };
}

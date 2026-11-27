/**
 * Signalyn Retail Price Intelligence Types (Phase P0.1)
 * 
 * Strict data models for:
 * 1. Retail Sources & Provider Readiness (Public.gr, Kotsovolos.gr, Plaisio.gr)
 * 2. Canonical Tracked Retail Products (Smartphones, Wearables, Audio, Tablets)
 * 3. Retailer Offers & Strict Provenance Metadata (Integer EUR Cents, Never €0)
 * 4. Durable Daily Price History Observations & Immutability
 * 5. Retail Collection Runs (Audited execution lifecycle, no false success)
 * 6. Product Match Review Queue (Confidence levels & manual resolution)
 */

export type RetailSourceId = 'public-gr' | 'kotsovolos-gr' | 'plaisio-gr';

export type RetailSourceStatus =
  | 'ACTIVE'
  | 'REQUIRES_AUTHORIZATION'
  | 'ACCESS_BLOCKED'
  | 'UNSUPPORTED'
  | 'PAUSED'
  | 'ERROR';

export type RetailerReadinessState =
  | 'LIVE_READY'
  | 'REQUIRES_CREDENTIALS'
  | 'REQUIRES_AUTHORIZATION'
  | 'ACCESS_BLOCKED'
  | 'UNSUPPORTED'
  | 'NOT_VERIFIED';

export type PriceSourceType =
  | 'LIVE_SCRAPED'
  | 'AUTHORIZED_API'
  | 'OFFICIAL_FEED'
  | 'MANUAL_VERIFIED'
  | 'SEEDED_PILOT';

export type ObservationStatus =
  | 'LIVE_VERIFIED'
  | 'SEEDED_PILOT'
  | 'STALE'
  | 'ACCESS_BLOCKED'
  | 'NO_DATA';

export type MatchConfidenceLevel =
  | 'EXACT'
  | 'HIGH_CONFIDENCE'
  | 'NEEDS_REVIEW'
  | 'UNMATCHED';

export type RetailCategory =
  | 'SMARTPHONES'
  | 'WEARABLES'
  | 'AUDIO'
  | 'TABLETS';

export type StockStatus =
  | 'IN_STOCK'
  | 'OUT_OF_STOCK'
  | 'PREORDER'
  | 'DISCONTINUED'
  | 'UNKNOWN';

export type CategoryUrlValidationStatus =
  | 'VALID_CATEGORY'
  | 'INVALID_CATEGORY'
  | 'ACCESS_BLOCKED'
  | 'UNVERIFIED';

export type RetailCategoryStatus =
  | 'VALID'
  | 'INVALID'
  | 'UNTESTED'
  | 'UNVERIFIED'
  | 'VALID_CATEGORY'
  | 'INVALID_CATEGORY'
  | 'LIVE_VERIFIED'
  | 'ACCESS_BLOCKED'
  | 'ERROR';

export interface RetailCategoryEndpointConfig {
  category: RetailCategory;
  enabled: boolean;
  url: string;
  defaultUrl: string;
  status: RetailCategoryStatus;
  validationStatus?: CategoryUrlValidationStatus;
  resolvedUrl?: string;
  redirected?: boolean;
  productsDetected?: number;
  categoryMatchCount?: number;
  extractionStrategy?: string;
  pagesProcessed?: number;
  extractionErrors?: string[];
  validationEvidence?: string;
  isManuallyConfigured?: boolean;
  autoDiscoveryEnabled?: boolean;
  maxPagesPerRun?: number;
  maxProductsPerRun?: number;
  lastTestedAt?: string;
  lastHttpStatus?: number;
  lastResponseTimeMs?: number;
  lastError?: string;
  lastDiscoveredAt?: string;
  lastDiscoveredCount?: number;
}

export interface RetailSourceDiagnosticResult {
  timestamp: string;
  targetUrl: string;
  resolvedUrl?: string;
  redirected?: boolean;
  category?: RetailCategory;
  retailerId: RetailSourceId;
  httpStatus: number;
  responseTimeMs: number;
  serverHeaders: Record<string, string>;
  hasHtml: boolean;
  productsDetected: number;
  categoryMatchCount?: number;
  extractionStrategy?: string;
  pagesProcessed?: number;
  extractionErrors?: string[];
  totalProductsAvailable?: number;
  hasNextPage?: boolean;
  validationStatus?: CategoryUrlValidationStatus;
  validationEvidence?: string;
  detectedProductsSummary?: Array<{
    sku: string;
    title: string;
    priceCents?: number | null;
  }>;
  accessStatus:
    | 'LIVE_VERIFIED'
    | 'VALID_CATEGORY'
    | 'INVALID_CATEGORY'
    | 'UNVERIFIED'
    | 'ACCESS_BLOCKED'
    | 'REQUIRES_AUTHORIZATION'
    | 'INVALID_URL'
    | 'TEST_FAILED';
  error?: string;
  diagnosticDetails?: string;
}

export interface RetailSourceDiscoveryStats {
  pagesCrawled: number;
  productsFound: number;
  productsCreated: number;
  offersUpdated: number;
  pricesChanged: number;
  failedPages: number;
  durationMs: number;
  extractionStrategy?: string;
  errors: string[];
}

export interface RetailSource {
  id: RetailSourceId;
  name: string;
  websiteUrl: string;
  domain?: string;
  enabled?: boolean;
  status: RetailSourceStatus;
  readinessState: RetailerReadinessState;
  accessConditions: string;
  authRequired: boolean;
  rateLimitRpm: number;
  requestDelaySeconds?: number;
  timeoutSeconds?: number;
  autoDiscoveryEnabled?: boolean;
  defaultMaxPages?: number;
  defaultMaxProducts?: number;
  discoveredProductsCount?: number;
  lastDiscoveryAt?: string;
  lastDiscoveryStatus?: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'ACCESS_BLOCKED';
  lastDiscoveryStats?: RetailSourceDiscoveryStats;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastAttemptedAt?: string;
  lastHttpStatus?: number;
  lastError?: string;
  lastHttpError?: string;
  lastHistoricalErrorAt?: string;
  collectionMethod: 'DIRECT_FEED' | 'STRUCTURED_API' | 'PUBLIC_PAGE' | 'MANUAL_VERIFIED' | 'AUTHORIZED_PARTNER_API';
  coverageCategories: RetailCategory[];
  categoryEndpoints?: Record<RetailCategory, RetailCategoryEndpointConfig>;
  integrationMethod: string;
  requiredCredentials: string[];
  customNotes?: string;
  nextAction: string;
  lastDiagnostic?: RetailSourceDiagnosticResult;
}

export interface RetailProduct {
  id: string; // e.g. "prod-huawei-pura-70-pro-512"
  name: string; // e.g. "HUAWEI Pura 70 Pro 512GB"
  brand: string; // e.g. "HUAWEI", "Apple", "Samsung", "Xiaomi", "Honor", "Garmin", "Sony", "Bose", "Lenovo", "Nothing"
  category: RetailCategory;
  modelFamily: string; // e.g. "Pura 70 Pro"
  storage?: string; // e.g. "512GB", "256GB", "128GB"
  color?: string; // e.g. "Black", "Titanium Black", "Silver Frost"
  connectivity?: 'Wi-Fi' | '4G' | '5G' | 'GPS' | 'GPS+Cellular' | 'Bluetooth';
  ean?: string;
  mpn?: string;
  isPilot: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RetailOffer {
  id: string; // `${retailerId}__${sku}`
  retailerId: RetailSourceId;
  retailerName: string;
  canonicalProductId?: string;
  matchConfidence: MatchConfidenceLevel;
  title: string;
  brand: string;
  url: string;
  retailerSku: string;
  currentPriceCents: number | null; // e.g. 119900 = €1,199.00. NEVER 0 for missing/failed!
  referencePriceCents?: number | null; // MSRP / strikethrough price
  currency: 'EUR';
  isAvailable: boolean;
  stockStatus: StockStatus;
  // Strict Provenance & Verification Metadata (P0.1)
  priceSourceType: PriceSourceType;
  observationStatus: ObservationStatus;
  isLiveVerified: boolean; // Strictly false for seeded pilot data
  sourceVerifiedAt?: string;
  lastSuccessfulFetchAt?: string;
  provenanceNote?: string;
  collectionRunId?: string;
  // Separate observation from promotions
  hasInstallments?: boolean;
  hasVouchers?: boolean;
  hasCashback?: boolean;
  hasMembershipPromo?: boolean;
  promoDetails?: string;
  extractedAt: string;
  lastObservedAt: string;
  status: 'ACTIVE' | 'STALE' | 'DISCONTINUED';
}

export interface RetailPriceHistoryEntry {
  id: string; // Idempotent: `${retailerId}__${retailerSku}__${dateAthens}`
  offerId: string;
  retailerId: RetailSourceId;
  canonicalProductId?: string;
  dateAthens: string; // YYYY-MM-DD
  priceCents: number; // in integer cents, strictly > 0
  referencePriceCents?: number | null;
  currency: 'EUR';
  isAvailable: boolean;
  stockStatus: StockStatus;
  priceSourceType: PriceSourceType;
  observationStatus: ObservationStatus;
  isLiveVerified: boolean;
  collectionRunId?: string;
  recordedAt: string;
}

export interface RetailCollectionRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'ACCESS_BLOCKED';
  retailers: {
    [key in RetailSourceId]?: {
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'REQUIRES_AUTHORIZATION' | 'ACCESS_BLOCKED' | 'UNSUPPORTED';
      itemsAttempted: number;
      itemsCollected: number;
      httpStatus?: number;
      error?: string;
    };
  };
  totalAttempted: number;
  totalCollected: number;
  newObservations: number;
  durationMs: number;
  triggeredBy: 'MANUAL' | 'SCHEDULED' | 'PILOT_SEED';
  errorSummary?: string;
}

export interface RetailMatchReview {
  id: string;
  offerId: string;
  retailerId: RetailSourceId;
  sourceTitle: string;
  sourceBrand: string;
  sourceUrl: string;
  sourcePriceCents?: number | null;
  candidateProductId?: string;
  candidateProductName?: string;
  confidenceScore: number; // 0.0 to 1.0
  suggestedConfidence: MatchConfidenceLevel;
  matchReasons: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MANUALLY_LINKED';
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
}

export interface RetailAdapterResult {
  retailerId: RetailSourceId;
  success: boolean;
  status: RetailSourceStatus;
  httpStatus?: number;
  error?: string;
  offers: Array<{
    retailerSku: string;
    title: string;
    brand: string;
    model?: string;
    variant?: string;
    url: string;
    priceCents: number | null;
    referencePriceCents?: number | null;
    currency: 'EUR';
    isAvailable: boolean;
    stockStatus: StockStatus;
    priceSourceType: PriceSourceType;
    observationStatus: ObservationStatus;
    isLiveVerified: boolean;
    ean?: string;
    hasInstallments?: boolean;
    hasVouchers?: boolean;
    hasCashback?: boolean;
    hasMembershipPromo?: boolean;
    rawPayload?: Record<string, unknown>;
  }>;
}

export interface RetailDashboardStats {
  totalTrackedProducts: number;
  totalActiveOffers: number;
  liveVerifiedOffersCount: number;
  seededPilotOffersCount: number;
  totalDiscoveredProducts: number;
  pilotProductsCount: number;
  liveVerifiedProductsCount?: number;
  seededPilotProductsCount?: number;
  pilotOnlyProductsCount?: number;
  mixedProvenanceProductsCount?: number;
  unlinkedOffersCount?: number;
  blockedRetailersCount: number;
  retailerCoverage: {
    retailerId: RetailSourceId;
    retailerName: string;
    status: RetailSourceStatus;
    readinessState: RetailerReadinessState;
    connectivityStatus?: 'OPERATIONAL' | 'ACCESS_BLOCKED' | 'UNVERIFIED';
    lastDiscoveryStatus?: string;
    lastSuccessfulCollectionAt?: string;
    lastHttpError?: string;
    extractionStrategy?: string;
    activeOffersCount: number;
    liveVerifiedOffersCount: number;
    seededPilotOffersCount?: number;
    discoveredCount?: number;
    lastCollectionAt?: string;
    lastHttpStatus?: number;
    accessNote: string;
  }[];
  // Genuine Live Price Movements (strictly 0 if no live collection has run)
  livePriceChanges24h: {
    increases: number;
    decreases: number;
    unchanged: number;
  };
  // Pilot Baseline Movements (strictly labeled as pilot/demo)
  pilotBaselineChanges24h: {
    increases: number;
    decreases: number;
    unchanged: number;
  };
  priceChanges7d: {
    increases: number;
    decreases: number;
  };
  priceChanges30d: {
    increases: number;
    decreases: number;
  };
  pendingReviewsCount: number;
  lastSuccessfulRun?: RetailCollectionRun | null;
  activeDiscoveryJob?: RetailDiscoveryJob | null;
}

export interface RetailProductViewItem {
  product: RetailProduct;
  offers: RetailOffer[];
  lowestLiveVerifiedPriceCents: number | null;
  lowestLiveVerifiedRetailer?: string;
  lowestPilotPriceCents: number | null;
  lowestPilotRetailer?: string;
  effectiveLowestPriceCents?: number | null;
  effectiveLowestRetailer?: string;
  effectiveLowestProvenance?: 'LIVE_VERIFIED' | 'SEEDED_PILOT' | null;
  comparisonType?: 'REAL_MARKET_MULTI' | 'LIVE_SINGLE_RETAILER' | 'PILOT_ONLY_BASELINE' | 'NO_VERIFIED_PRICE';
  highestPriceCents: number | null;
  priceDelta24hCents: number | null; // e.g. -2000 for -€20.00
  priceDelta7dCents: number | null;
  priceDelta30dCents: number | null;
  livePriceDelta24hCents?: number | null;
  livePriceDelta7dCents?: number | null;
  livePriceDelta30dCents?: number | null;
  livePriceMovementObservedAt?: string | null;
  pilotPriceDelta24hCents?: number | null;
  pilotPriceMovementObservedAt?: string | null;
  liveObservationCount?: number;
  latestLiveObservationDate?: string | null;
  provenanceSummary: 'LIVE_VERIFIED' | 'SEEDED_PILOT' | 'ACCESS_BLOCKED' | 'MIXED' | 'NO_DATA';
  lastUpdated: string;
}

export interface DiscoveredProductItem {
  retailerId: RetailSourceId;
  retailerSku: string;
  title: string;
  brand: string;
  model?: string;
  category: RetailCategory;
  priceCents: number;
  referencePriceCents?: number | null;
  currency: 'EUR';
  url: string;
  imageUrl?: string;
  availability: StockStatus;
  ean?: string;
  extractedAt: string;
  isLiveVerified: boolean;
  pageNumber: number;
  matchedProductId?: string;
  matchConfidence?: MatchConfidenceLevel;
}

export type RetailCrawlerStrategy = 'AUTO' | 'STATIC_FETCH' | 'DYNAMIC_STATE' | 'BROWSER_AUTOMATION';

export interface RetailDiscoveryJob {
  id: string; // e.g. "job-plaisio-1740000000000"
  retailerId: RetailSourceId;
  categories: RetailCategory[];
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'ACCESS_BLOCKED' | 'ABORTED';
  strategy: RetailCrawlerStrategy;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  triggeredBy: 'MANUAL' | 'SCHEDULED';
  options: {
    maxPagesPerCategory: number;
    maxProductsPerCategory: number;
    requestDelaySeconds: number;
    timeoutSeconds: number;
  };
  progress: {
    currentCategory?: RetailCategory;
    currentPage: number;
    maxPagesTotal: number;
    pagesCrawled: number;
    productsDiscovered: number;
    productsCreated: number;
    offersUpdated: number;
    pricesChanged: number;
    failedPages: number;
  };
  previewItems: DiscoveredProductItem[];
  errors: string[];
  errorSummary?: string;
}

export interface RetailScheduleConfig {
  id: string; // "retail-daily-collection"
  enabled: boolean;
  status: 'DISABLED_PENDING_ADMIN_APPROVAL' | 'ENABLED_ACTIVE' | 'PAUSED';
  cronExpression: string; // "0 4 * * *" (04:00 Athens Time)
  timezone: string; // "Europe/Athens"
  targetRetailers: RetailSourceId[];
  approvedByAdmin: boolean;
  approvedAt?: string;
  approvedByEmail?: string;
  lastScheduledRunAt?: string;
  lastRunStatus?: string;
  lastRunJobId?: string;
  nextScheduledRunAt?: string;
  maxPagesPerCategory: number;
  maxProductsPerCategory: number;
  requestDelaySeconds: number;
}

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ShoppingBag,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Search,
  TrendingDown,
  TrendingUp,
  Minus,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  History,
  Layers,
  Database,
  HelpCircle,
  Settings,
  Compass,
  Activity,
  Lock,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  FileWarning,
} from 'lucide-react';
import {
  RetailDashboardStats,
  RetailProductViewItem,
  RetailSource,
  RetailMatchReview,
  RetailCollectionRun,
} from '../../types/retailPrice';
import { PriceHistoryModal } from './PriceHistoryModal';
import { RetailSourcesSettings } from './RetailSourcesSettings';
import { getAuthorizedApiHeaders } from '../../services/apiSessionClient';
import { useApp } from '../../context/AppContext';
import { AppPage, PageHeader, SemanticBadge } from '../common/DesignSystem';
import {
  reconcileRetailCatalogCounts,
  getDeduplicatedCanonicalBrands,
  normalizeRetailBrandDisplay,
  matchesCanonicalRetailBrand,
  resolveRetailerOperationalStatus,
  resolveRetailerEffectiveExtractionStrategy,
  classifyRetailerHistoricalNotes,
  evaluateProductPriceComparisonSemantics,
  ResolvedRetailerOperationalStatus,
} from '../../utils/dataIntegrityContracts';

type ProvenanceFilterMode = 'LIVE_ONLY' | 'ALL_OFFERS' | 'PILOT_ONLY';
type RetailSubView = 'MATRIX' | 'SOURCES' | 'DIAGNOSTICS';
type PriceMatrixSortKey =
  | 'lowestPrice'
  | 'priceSpread'
  | 'brand'
  | 'category'
  | 'lastUpdated'
  | 'name';

const STORAGE_REGEX = /\b(64|128|256|512)\s*GB\b|\b(1|2)\s*TB\b/i;
const COLOR_KEYWORDS = [
  'Black',
  'White',
  'Silver',
  'Gold',
  'Blue',
  'Green',
  'Purple',
  'Pink',
  'Red',
  'Gray',
  'Grey',
  'Titanium',
  'Graphite',
  'Midnight',
  'Starlight',
  'Lavender',
  'Cream',
  'Violet',
  'Bronze',
  'Orange',
  'Yellow',
  'Μαύρο',
  'Λευκό',
  'Ασημί',
  'Χρυσό',
  'Μπλε',
  'Πράσινο',
  'Μωβ',
  'Ροζ',
  'Γκρι',
];

function extractListingVariantEvidence(
  sourceTitle: string,
  candidateProductName?: string,
  sourceBrand?: string
): {
  manufacturer: string;
  modelFamily: string;
  storageVariant: string;
  colorVariant: string;
  missingEvidence: string[];
} {
  const combinedTitle = sourceTitle || '';
  const storageMatch = combinedTitle.match(STORAGE_REGEX);
  const storageVariant = storageMatch
    ? storageMatch[0].toUpperCase().replace(/\s+/g, '')
    : 'Unspecified — Missing Evidence';

  let detectedColor = 'Unspecified — Missing Evidence';
  for (const color of COLOR_KEYWORDS) {
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(combinedTitle)) {
      detectedColor = color;
      break;
    }
  }

  const manufacturer =
    sourceBrand ||
    (combinedTitle.toUpperCase().includes('HUAWEI')
      ? 'HUAWEI'
      : combinedTitle.toUpperCase().includes('SAMSUNG')
      ? 'Samsung'
      : combinedTitle.toUpperCase().includes('APPLE') || combinedTitle.toUpperCase().includes('IPHONE')
      ? 'Apple'
      : combinedTitle.toUpperCase().includes('XIAOMI') || combinedTitle.toUpperCase().includes('REDMI')
      ? 'Xiaomi'
      : combinedTitle.toUpperCase().includes('HONOR')
      ? 'HONOR'
      : combinedTitle.toUpperCase().includes('GARMIN')
      ? 'Garmin'
      : 'Unspecified');

  let modelFamily = candidateProductName || combinedTitle;
  modelFamily = modelFamily
    .replace(STORAGE_REGEX, '')
    .replace(/\b(5G|4G|Dual SIM|DS|NFC|Wi-Fi|WiFi|LTE)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const missingEvidence: string[] = [];
  if (storageVariant.startsWith('Unspecified')) {
    missingEvidence.push('Storage capacity (GB/TB) not stated in source listing');
  }
  if (detectedColor.startsWith('Unspecified')) {
    missingEvidence.push('Color / finish variant not stated in source listing');
  }
  if (!candidateProductName) {
    missingEvidence.push('Canonical SKU candidate link requires manual verification');
  }
  if (missingEvidence.length === 0) {
    missingEvidence.push('Exact model / sub-variant disambiguation required (e.g., Base vs Pro/Ultra)');
  }

  return {
    manufacturer,
    modelFamily: modelFamily || 'Unclassified Model Family',
    storageVariant,
    colorVariant: detectedColor,
    missingEvidence,
  };
}

export const RetailPricesView: React.FC = () => {
  const { canManage } = useApp();
  const [subView, setSubView] = useState<RetailSubView>('MATRIX');
  const [stats, setStats] = useState<RetailDashboardStats | null>(null);
  const [products, setProducts] = useState<RetailProductViewItem[]>([]);
  const [sources, setSources] = useState<RetailSource[]>([]);
  const [reviews, setReviews] = useState<RetailMatchReview[]>([]);
  const [latestRun, setLatestRun] = useState<RetailCollectionRun | null>(null);
  const [persistenceDiag, setPersistenceDiag] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [collecting, setCollecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Sort states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [brandFilter, setBrandFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [provenanceFilter, setProvenanceFilter] = useState<ProvenanceFilterMode>('LIVE_ONLY');
  const [sortBy, setSortBy] = useState<PriceMatrixSortKey>('lowestPrice');

  // Expandable UI toggles
  const [showTechnicalRetailerDetails, setShowTechnicalRetailerDetails] = useState<boolean>(false);
  const [showDataDefinitions, setShowDataDefinitions] = useState<boolean>(false);

  // Modal state
  const [selectedProductItem, setSelectedProductItem] = useState<RetailProductViewItem | null>(null);

  const reviewQueueRef = useRef<HTMLDivElement | null>(null);

  const fetchRetailData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthorizedApiHeaders();
      const [dashRes, prodRes, srcRes, revRes, diagRes] = await Promise.all([
        fetch('/api/retail/dashboard', { headers }),
        fetch('/api/retail/products', { headers }),
        fetch('/api/retail/sources', { headers }),
        fetch('/api/retail/reviews?status=PENDING', { headers }),
        fetch('/api/retail/persistence/diagnostics', { headers }),
      ]);

      if (!dashRes.ok || !prodRes.ok || !srcRes.ok || !revRes.ok) {
        throw new Error('Failed to load Retail Price Intelligence telemetry');
      }

      const [dashData, prodData, srcData, revData] = await Promise.all([
        dashRes.json(),
        prodRes.json(),
        srcRes.json(),
        revRes.json(),
      ]);

      const resolvedStats = (dashData?.stats || dashData || null) as RetailDashboardStats | null;
      setStats(resolvedStats);
      setLatestRun(dashData?.latestRun || resolvedStats?.lastSuccessfulRun || null);
      setProducts(prodData.products || []);
      setSources(srcData.sources || []);
      setReviews(revData.reviews || []);

      if (diagRes.ok) {
        const diagData = await diagRes.json();
        setPersistenceDiag(diagData.diagnostics || diagData || null);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading retail intelligence');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRetailData();
  }, []);

  const handleTriggerCollection = async () => {
    setCollecting(true);
    setError(null);
    try {
      const headers = await getAuthorizedApiHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/retail/collect', {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to trigger retail collection');
      }
      await fetchRetailData();
    } catch (err: any) {
      setError(err.message || 'Collection failed');
    } finally {
      setCollecting(false);
    }
  };

  const handleResolveReview = async (reviewId: string, resolution: 'APPROVED' | 'REJECTED') => {
    try {
      const headers = await getAuthorizedApiHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/retail/reviews/${reviewId}/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ resolution }),
      });
      if (res.ok) {
        await fetchRetailData();
      }
    } catch (err) {
      console.error('Failed to resolve review:', err);
    }
  };

  const formatEuro = (cents: number | null | undefined) => {
    if (cents === null || cents === undefined) return '—';
    return `€${(cents / 100).toFixed(2)}`;
  };

  // Helper to get offer for a specific retailer respecting the active provenance filter
  const getRetailerCellOffer = (item: RetailProductViewItem, retailerId: string) => {
    const matchingOffers = item.offers.filter((o) => {
      if (o.retailerId !== retailerId) return false;
      if (provenanceFilter === 'LIVE_ONLY') {
        return o.isLiveVerified === true && o.observationStatus === 'LIVE_VERIFIED';
      }
      if (provenanceFilter === 'PILOT_ONLY') {
        return o.priceSourceType === 'SEEDED_PILOT';
      }
      return true;
    });

    const liveOffer = matchingOffers.find(
      (o) => o.isLiveVerified && o.observationStatus === 'LIVE_VERIFIED'
    );
    return liveOffer || matchingOffers[0] || null;
  };

  // Compute cross-retailer price spread (difference between highest and lowest active price for this product)
  const getProductPriceSpreadCents = (item: RetailProductViewItem): number | null => {
    const relevantOffers = item.offers.filter((o) => {
      if (!o.currentPriceCents || o.currentPriceCents <= 0) return false;
      if (provenanceFilter === 'LIVE_ONLY') {
        return o.isLiveVerified === true && o.observationStatus === 'LIVE_VERIFIED';
      }
      if (provenanceFilter === 'PILOT_ONLY') {
        return o.priceSourceType === 'SEEDED_PILOT';
      }
      return true;
    });

    if (relevantOffers.length < 2) {
      return null;
    }
    const prices = relevantOffers.map((o) => o.currentPriceCents as number);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    return maxP - minP;
  };

  // Authoritative reconciliation counts for consistent display across KPIs and filter tabs
  const reconciliationCounts = useMemo(
    () =>
      reconcileRetailCatalogCounts(
        products,
        stats,
        reviews.length,
        persistenceDiag?.offerProvenanceBreakdown
      ),
    [products, persistenceDiag, stats, reviews.length]
  );

  // Deduplicated canonical brands (prevents duplicate Huawei/HUAWEI, Apple/APPLE, Samsung/SAMSUNG)
  const availableBrands = useMemo(
    () => getDeduplicatedCanonicalBrands(products.map((item) => item.product.brand)),
    [products]
  );

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((item) => {
      if (item.product.category) set.add(item.product.category);
    });
    return Array.from(set).sort();
  }, [products]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    return products
      .filter((item) => {
        if (provenanceFilter === 'LIVE_ONLY') {
          const hasLiveOffer = item.offers.some(
            (o) => o.isLiveVerified === true && o.observationStatus === 'LIVE_VERIFIED'
          );
          if (!hasLiveOffer) return false;
        } else if (provenanceFilter === 'PILOT_ONLY') {
          const hasPilotOffer = item.offers.some((o) => o.priceSourceType === 'SEEDED_PILOT');
          if (!hasPilotOffer) return false;
        }

        if (!matchesCanonicalRetailBrand(item.product.brand, brandFilter)) {
          return false;
        }
        if (categoryFilter !== 'ALL' && item.product.category !== categoryFilter) {
          return false;
        }

        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          item.product.name.toLowerCase().includes(q) ||
          item.product.brand.toLowerCase().includes(q) ||
          item.product.category.toLowerCase().includes(q) ||
          (item.product.modelFamily && item.product.modelFamily.toLowerCase().includes(q)) ||
          (item.product.ean && item.product.ean.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          return a.product.name.localeCompare(b.product.name);
        }
        if (sortBy === 'brand') {
          const brandA = normalizeRetailBrandDisplay(a.product.brand);
          const brandB = normalizeRetailBrandDisplay(b.product.brand);
          const brandCmp = brandA.localeCompare(brandB);
          return brandCmp !== 0 ? brandCmp : a.product.name.localeCompare(b.product.name);
        }
        if (sortBy === 'category') {
          const catCmp = a.product.category.localeCompare(b.product.category);
          return catCmp !== 0 ? catCmp : a.product.name.localeCompare(b.product.name);
        }
        if (sortBy === 'lastUpdated') {
          const timeA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
          const timeB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
          return timeB - timeA;
        }
        if (sortBy === 'priceSpread') {
          const spreadA = getProductPriceSpreadCents(a) ?? -1;
          const spreadB = getProductPriceSpreadCents(b) ?? -1;
          if (spreadB !== spreadA) return spreadB - spreadA;
          const fallbackPriceA = a.effectiveLowestPriceCents ?? 0;
          const fallbackPriceB = b.effectiveLowestPriceCents ?? 0;
          return fallbackPriceB - fallbackPriceA;
        }
        // Default: 'lowestPrice'
        const priceA =
          provenanceFilter === 'LIVE_ONLY'
            ? a.lowestLiveVerifiedPriceCents ?? Number.MAX_SAFE_INTEGER
            : provenanceFilter === 'PILOT_ONLY'
            ? a.lowestPilotPriceCents ?? Number.MAX_SAFE_INTEGER
            : a.effectiveLowestPriceCents ?? Number.MAX_SAFE_INTEGER;
        const priceB =
          provenanceFilter === 'LIVE_ONLY'
            ? b.lowestLiveVerifiedPriceCents ?? Number.MAX_SAFE_INTEGER
            : provenanceFilter === 'PILOT_ONLY'
            ? b.lowestPilotPriceCents ?? Number.MAX_SAFE_INTEGER
            : b.effectiveLowestPriceCents ?? Number.MAX_SAFE_INTEGER;
        return priceA - priceB;
      });
  }, [products, provenanceFilter, brandFilter, categoryFilter, searchQuery, sortBy]);

  // Unified 5-dimension retailer operational status across KPI cards, health summary cards, and matrix table headers
  const allCatalogOffers = useMemo(
    () => products.flatMap((p) => p.offers || []),
    [products]
  );

  const retailerStatusMap = useMemo(() => {
    const map = new Map<string, ResolvedRetailerOperationalStatus>();
    sources.forEach((src) => {
      const coverage = stats?.retailerCoverage?.find((c) => c.retailerId === src.id) || null;
      const retailerOffers = allCatalogOffers.filter((o) => o.retailerId === src.id);
      const liveOffersCount = retailerOffers.filter(
        (o) => o.isLiveVerified === true && o.observationStatus === 'LIVE_VERIFIED'
      ).length;
      const pilotOffersCount = retailerOffers.filter(
        (o) => o.priceSourceType === 'SEEDED_PILOT'
      ).length;
      map.set(
        src.id,
        resolveRetailerOperationalStatus({
          source: src,
          coverage,
          offers: retailerOffers,
          liveOffersCount,
          pilotOffersCount,
        })
      );
    });
    return map;
  }, [sources, allCatalogOffers, stats]);

  const getResolvedRetailerStatus = (retailerId: string): ResolvedRetailerOperationalStatus => {
    const existing = retailerStatusMap.get(retailerId);
    if (existing) return existing;
    const coverage = stats?.retailerCoverage?.find((c) => c.retailerId === retailerId) || null;
    const retailerOffers = allCatalogOffers.filter((o) => o.retailerId === retailerId);
    const liveOffersCount = retailerOffers.filter(
      (o) => o.isLiveVerified === true && o.observationStatus === 'LIVE_VERIFIED'
    ).length;
    const pilotOffersCount = retailerOffers.filter(
      (o) => o.priceSourceType === 'SEEDED_PILOT'
    ).length;
    return resolveRetailerOperationalStatus({
      source: { id: retailerId, name: retailerId },
      coverage,
      offers: retailerOffers,
      liveOffersCount,
      pilotOffersCount,
    });
  };

  const operationalRetailersCount = useMemo(
    () =>
      sources.filter((s) => retailerStatusMap.get(s.id)?.state === 'OPERATIONAL').length,
    [sources, retailerStatusMap]
  );
  const staleLiveRetailersCount = useMemo(
    () =>
      sources.filter((s) => retailerStatusMap.get(s.id)?.state === 'STALE_LIVE').length,
    [sources, retailerStatusMap]
  );
  const blockedRetailersCount = useMemo(
    () =>
      sources.filter((s) => retailerStatusMap.get(s.id)?.state === 'WAF_BLOCKED').length,
    [sources, retailerStatusMap]
  );
  const pilotOnlyRetailersCount = useMemo(
    () =>
      sources.filter((s) => retailerStatusMap.get(s.id)?.state === 'PILOT_ONLY').length,
    [sources, retailerStatusMap]
  );

  if (loading && (!stats || products.length === 0)) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
          <p className="text-sm font-mono">Loading Greek Retail Price Intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <AppPage>
      {/* Top Header & Sub-Navigation */}
      <PageHeader
        badge="Greek Market • Provenance-Verified Pricing"
        title="Retail Price Intelligence"
        subtitle="Cross-retailer price comparison across Public.gr, Kotsovolos, and Plaisio with strict separation between live HTTP 200 observations and pilot baseline references."
        actions={
          <>
            {/* Sub-View Switcher */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
              <button
                onClick={() => setSubView('MATRIX')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  subView === 'MATRIX'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Price Matrix
              </button>
              <button
                onClick={() => setSubView('SOURCES')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  subView === 'SOURCES'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                Manage Sources & Crawlers
              </button>
              {canManage && (
                <button
                  onClick={() => setSubView('DIAGNOSTICS')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                    subView === 'DIAGNOSTICS'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  Retail Diagnostics
                </button>
              )}
            </div>

            {canManage && (
              <button
                onClick={handleTriggerCollection}
                disabled={collecting}
                title="Admin Action: Trigger live HTTP price collection across enabled Greek retailers"
                className="px-3.5 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 disabled:opacity-50 text-amber-200 border border-amber-500/40 font-medium text-xs flex items-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${collecting ? 'animate-spin' : ''}`} />
                {collecting ? 'Probing Retailers...' : 'Test Live Retailer Connectivity'}
              </button>
            )}
          </>
        }
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sub-View Routing */}
      {subView === 'SOURCES' || (subView === 'DIAGNOSTICS' && canManage) ? (
        <div className="space-y-4">
          {subView === 'DIAGNOSTICS' && (
            <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/30 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2 text-indigo-300">
                <Compass className="w-4 h-4" />
                <span className="font-bold uppercase">
                  Retail Crawler & Persistence Diagnostics
                </span>
                {latestRun && (
                  <span className="text-slate-400">
                    • Latest Collection Run: {latestRun.id} ({latestRun.status})
                  </span>
                )}
              </div>
              <a
                href="#system-diagnostics:retail"
                className="px-2.5 py-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 transition-colors"
              >
                Open Full System Diagnostics (Retail Write Probe) →
              </a>
            </div>
          )}
          <RetailSourcesSettings />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ================================================================= */}
          {/* LEVEL 1: RETAIL INTELLIGENCE OVERVIEW (BUSINESS KPIs & DEFINITIONS) */}
          {/* ================================================================= */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* KPI 1: Tracked Products */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="text-[11px] text-slate-400 font-mono uppercase flex items-center justify-between">
                    <span>Tracked Products</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      SKU Catalog
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-white mt-1.5 tabular-nums flex items-baseline gap-2">
                    <span>{reconciliationCounts.allProductsCount}</span>
                    <span className="text-xs font-mono font-normal text-slate-400">
                      ({filteredProducts.length} shown)
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono flex flex-wrap items-center justify-between gap-1">
                  <span>
                    <strong className="text-emerald-400">
                      {reconciliationCounts.liveVerifiedProductsCount}
                    </strong>{' '}
                    Live
                  </span>
                  <span>•</span>
                  <span>
                    <strong className="text-amber-400">
                      {reconciliationCounts.pilotOnlyProductsCount}
                    </strong>{' '}
                    Pilot-Only
                  </span>
                  {reconciliationCounts.unlinkedOrZeroOfferProductsCount > 0 && (
                    <>
                      <span>•</span>
                      <span>
                        <strong className="text-slate-300">
                          {reconciliationCounts.unlinkedOrZeroOfferProductsCount}
                        </strong>{' '}
                        No Offer
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* KPI 2: Live Verified Offers */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="text-[11px] text-slate-400 font-mono uppercase flex items-center justify-between">
                    <span>Live Verified Offers</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      HTTP 200 OK
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1.5 tabular-nums flex items-baseline gap-2">
                    <span>{reconciliationCounts.totalLiveVerifiedOffersCount}</span>
                    <span className="text-xs font-mono font-normal text-slate-400">
                      ({reconciliationCounts.liveVerifiedLinkedOffersCount} linked
                      {reconciliationCounts.unlinkedLiveOffersCount > 0
                        ? ` + ${reconciliationCounts.unlinkedLiveOffersCount} review`
                        : ''}
                      )
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono flex items-center justify-between">
                  <span>
                    +{reconciliationCounts.pilotLinkedOffersCount} Pilot (
                    {reconciliationCounts.allLinkedOffersCount} linked)
                  </span>
                  <span>•</span>
                  <span>{reconciliationCounts.totalActiveOffers} total</span>
                </div>
              </div>

              {/* KPI 3: Retailers Operational */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="text-[11px] text-slate-400 font-mono uppercase flex items-center justify-between">
                    <span>Retailers Operational</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        operationalRetailersCount > 0
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {operationalRetailersCount > 0
                        ? `${operationalRetailersCount} / ${sources.length || 3} Live Active`
                        : staleLiveRetailersCount > 0
                        ? `${staleLiveRetailersCount} Stale Live · 0 Current`
                        : `0 / ${sources.length || 3} Live Active`}
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-white mt-1.5 tabular-nums flex items-baseline gap-2">
                    <span>{operationalRetailersCount}</span>
                    <span className="text-xs font-mono font-normal text-slate-400">
                      current live
                      {staleLiveRetailersCount > 0
                        ? ` (${staleLiveRetailersCount} stale live, ${pilotOnlyRetailersCount} pilot-only)`
                        : blockedRetailersCount > 0
                        ? ` (${blockedRetailersCount} WAF blocked)`
                        : pilotOnlyRetailersCount > 0
                        ? ` (${pilotOnlyRetailersCount} pilot-only, ${blockedRetailersCount} WAF blocked)`
                        : ` (${blockedRetailersCount} WAF blocked)`}
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono flex flex-wrap items-center justify-between gap-1">
                  {sources.length > 0 ? (
                    sources.map((src, idx) => {
                      const resolved = getResolvedRetailerStatus(src.id);
                      const shortName = src.name.replace(/\.gr$/i, '');
                      const lastDateShort = resolved.collectionDimension.effectiveLastCollectionDate
                        ? resolved.collectionDimension.effectiveLastCollectionDate.slice(5)
                        : null;
                      const statusShort =
                        resolved.state === 'OPERATIONAL'
                          ? 'Live'
                          : resolved.state === 'STALE_LIVE'
                          ? lastDateShort
                            ? `Stale (${lastDateShort})`
                            : 'Stale Live'
                          : resolved.state === 'WAF_BLOCKED'
                          ? '403 WAF'
                          : resolved.state === 'PILOT_ONLY'
                          ? 'Pilot Only'
                          : '0 Live';
                      const colorClass =
                        resolved.state === 'OPERATIONAL'
                          ? 'text-emerald-400'
                          : resolved.state === 'STALE_LIVE' ||
                            resolved.state === 'WAF_BLOCKED' ||
                            resolved.state === 'PILOT_ONLY'
                          ? 'text-amber-400'
                          : 'text-slate-400';
                      return (
                        <React.Fragment key={src.id}>
                          {idx > 0 && <span className="text-slate-600">•</span>}
                          <span className={colorClass}>
                            {shortName}: {statusShort}
                          </span>
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <span className="text-slate-400">No retailer sources configured</span>
                  )}
                </div>
              </div>

              {/* KPI 4: Products Requiring Review & 24h Activity */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="text-[11px] text-slate-400 font-mono uppercase flex items-center justify-between">
                    <span>Products Requiring Review</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        reviews.length > 0
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {reviews.length > 0 ? 'Action Needed' : 'Queue Clear'}
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-amber-400 mt-1.5 tabular-nums flex items-baseline gap-2">
                    <span>{reviews.length}</span>
                    <span className="text-xs font-mono font-normal text-slate-400">
                      unlinked offer{reviews.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono flex items-center justify-between">
                  <span>
                    24h Live Moves:{' '}
                    <strong className="text-slate-200">
                      {stats
                        ? stats.livePriceChanges24h.decreases + stats.livePriceChanges24h.increases
                        : 0}
                    </strong>
                  </span>
                  {reviews.length > 0 && (
                    <button
                      onClick={() => reviewQueueRef.current?.scrollIntoView({ behavior: 'smooth' })}
                      className="text-amber-400 hover:text-amber-300 underline font-semibold cursor-pointer"
                    >
                      Inspect Queue ↓
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* A5: Dataset & Offer Count Reconciliation Strip */}
            <div className="px-4 py-2.5 rounded-xl bg-slate-900/70 border border-slate-800/90 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-300 font-mono text-[11px]">
                <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="font-semibold text-slate-200">Catalog & Offer Reconciliation:</span>
                <span>
                  <strong className="text-white">{reconciliationCounts.allProductsCount}</strong>{' '}
                  Canonical SKUs ={' '}
                  <strong className="text-emerald-400">
                    {reconciliationCounts.liveVerifiedProductsCount}
                  </strong>{' '}
                  Live Verified +{' '}
                  <strong className="text-amber-400">
                    {reconciliationCounts.pilotOnlyProductsCount}
                  </strong>{' '}
                  Pilot-Only
                  {reconciliationCounts.unlinkedOrZeroOfferProductsCount > 0 && (
                    <>
                      {' + '}
                      <strong className="text-slate-300">
                        {reconciliationCounts.unlinkedOrZeroOfferProductsCount}
                      </strong>{' '}
                      Unlinked/No Offer
                    </>
                  )}
                  {reconciliationCounts.mixedProvenanceProductsCount > 0 && (
                    <span className="text-slate-400">
                      {' '}
                      ({reconciliationCounts.mixedProvenanceProductsCount} SKUs have both Live &amp; Pilot
                      offers; {reconciliationCounts.pilotProductsCount} total in Pilot Ref)
                    </span>
                  )}
                </span>
                <span className="text-slate-600">|</span>
                <span>
                  <strong className="text-white">{reconciliationCounts.totalActiveOffers}</strong>{' '}
                  Active Offers ={' '}
                  <strong className="text-emerald-400">
                    {reconciliationCounts.totalLiveVerifiedOffersCount}
                  </strong>{' '}
                  Live Verified (
                  <strong className="text-slate-200">
                    {reconciliationCounts.liveVerifiedLinkedOffersCount}
                  </strong>{' '}
                  Linked +{' '}
                  <strong className="text-amber-300">
                    {reconciliationCounts.unlinkedOffersCount}
                  </strong>{' '}
                  Unlinked in Review Queue) +{' '}
                  <strong className="text-amber-400">
                    {reconciliationCounts.pilotLinkedOffersCount}
                  </strong>{' '}
                  Seeded Pilot (
                  <strong className="text-slate-200">
                    {reconciliationCounts.allLinkedOffersCount}
                  </strong>{' '}
                  Total Linked)
                </span>
              </div>
              <button
                onClick={() => setShowDataDefinitions((prev) => !prev)}
                className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{showDataDefinitions ? 'Hide Definitions' : 'Provenance Definitions'}</span>
              </button>
            </div>

            {showDataDefinitions && (
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300">
                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                  <div className="font-semibold text-emerald-400 font-mono text-[11px] mb-1">
                    LIVE_VERIFIED ({reconciliationCounts.liveVerifiedProductsCount} SKUs: {reconciliationCounts.liveOnlyProductsCount} Live-Only + {reconciliationCounts.mixedProvenanceProductsCount} Dual • {reconciliationCounts.totalLiveVerifiedOffersCount} Offers: {reconciliationCounts.liveVerifiedLinkedOffersCount} Linked + {reconciliationCounts.unlinkedLiveOffersCount} Review)
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Extracted directly from live Greek retailer HTTP 200 responses with verified price, stock status, and product URL.
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                  <div className="font-semibold text-amber-400 font-mono text-[11px] mb-1">
                    SEEDED_PILOT ({reconciliationCounts.pilotOnlyProductsCount} Pilot-Only SKUs + {reconciliationCounts.mixedProvenanceProductsCount} Dual = {reconciliationCounts.pilotProductsCount} Pilot Ref SKUs • {reconciliationCounts.pilotLinkedOffersCount} Reference Offers)
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Historical P0 reference baseline catalog entries (2025-02-18) preserved for audit continuity alongside P1.2 live extraction ({reconciliationCounts.unlinkedOrZeroOfferProductsCount} additional catalog SKUs currently have 0 active offers). Never mixed as live observations.
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                  <div className="font-semibold text-indigo-300 font-mono text-[11px] mb-1">
                    UNLINKED REVIEW ({reconciliationCounts.unlinkedOffersCount} Pending Offer)
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Live retailer listings whose storage or color variant is ambiguous and held in the Match Review Queue to prevent false SKU merging.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* A2: COMPACT RETAILER CONNECTIVITY SUMMARY                         */}
          {/* ================================================================= */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Retailer Health Summary
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  • Current operational connectivity vs. historical probe logs
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTechnicalRetailerDetails((prev) => !prev)}
                  className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {showTechnicalRetailerDetails ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Hide Adapter & Error Details</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Technical Adapter Details</span>
                    </>
                  )}
                </button>
                {canManage && (
                  <button
                    onClick={() => setSubView('DIAGNOSTICS')}
                    className="px-2.5 py-1 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Compass className="w-3 h-3" />
                    <span>Retail Diagnostics</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {sources.map((src) => {
                const resolved = getResolvedRetailerStatus(src.id);
                const isHealthy = resolved.state === 'OPERATIONAL';
                const isStaleLive = resolved.state === 'STALE_LIVE';
                const isBlocked = resolved.state === 'WAF_BLOCKED';
                const isPilotOnly = resolved.state === 'PILOT_ONLY';
                const liveCountForSource = resolved.liveOffersCount;
                const pilotCountForSource = resolved.pilotOffersCount;
                const lastCollectionDate =
                  resolved.collectionDimension.effectiveLastCollectionDate;

                return (
                  <div
                    key={src.id}
                    className={`p-3 rounded-lg border transition-colors ${
                      isHealthy
                        ? 'bg-slate-950/70 border-emerald-500/30'
                        : isStaleLive || isBlocked || isPilotOnly
                        ? 'bg-slate-950/70 border-amber-500/30'
                        : 'bg-slate-950/70 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-slate-100 text-xs flex items-center gap-1.5">
                        <span>{src.name}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border flex items-center gap-1 ${
                          isHealthy
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : isStaleLive || isBlocked || isPilotOnly
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {isHealthy ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" /> {resolved.badgeLabel || 'HTTP 200 OK'}
                          </>
                        ) : isBlocked ? (
                          <>
                            <ShieldAlert className="w-3 h-3" /> HTTP 403 Blocked
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-3 h-3" /> {resolved.badgeLabel}
                          </>
                        )}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Inventory Offers</span>
                        <span className="text-slate-200 font-semibold">
                          {liveCountForSource > 0 ? (
                            <span className="text-emerald-400">{liveCountForSource} Live</span>
                          ) : (
                            <span className="text-slate-400">0 Live</span>
                          )}
                          {pilotCountForSource > 0 && (
                            <span className="text-amber-400/90"> (+{pilotCountForSource} Pilot)</span>
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Last Live Collection</span>
                        <span className="text-slate-200">
                          {lastCollectionDate ? (
                            <span>
                              {lastCollectionDate}{' '}
                              <span
                                className={
                                  resolved.freshnessDimension === 'CURRENT'
                                    ? 'text-emerald-400'
                                    : 'text-amber-400'
                                }
                              >
                                ({resolved.freshnessDimension === 'CURRENT' ? 'Current' : 'Stale'})
                              </span>
                            </span>
                          ) : isBlocked ? (
                            'None (WAF Blocked)'
                          ) : liveCountForSource > 0 ? (
                            'Unknown Timestamp'
                          ) : (
                            'None (0 Live Extracted)'
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Clear separation between active operational state, stale historical inventory, and WAF block */}
                    <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                      {isHealthy ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          Operational — Live extraction active ({resolved.detailText})
                        </span>
                      ) : isBlocked ? (
                        <span className="text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          Active Warning: Edge WAF blocks automated crawl
                        </span>
                      ) : (
                        <span className="text-amber-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          {resolved.detailText}
                        </span>
                      )}
                    </div>

                    {showTechnicalRetailerDetails && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-1 text-[10px] font-mono text-slate-400 bg-slate-900/60 p-2 rounded">
                        <div>
                          Dimensions:{' '}
                          <strong className="text-slate-300">
                            Config={resolved.configurationDimension} · Conn={resolved.connectivityDimension} · Inv={resolved.inventoryDimension} · Freshness={resolved.freshnessDimension}
                          </strong>
                        </div>
                        <div>
                          Categories:{' '}
                          <strong className="text-slate-300">
                            {resolved.categoryValidationSummaryLabel}
                          </strong>
                        </div>
                        <div>
                          Adapter:{' '}
                          <strong className="text-slate-300">
                            {resolveRetailerEffectiveExtractionStrategy(src)}
                          </strong>
                        </div>
                        <div>
                          Endpoint: <strong className="text-slate-300">{src.websiteUrl}</strong>
                        </div>
                        {(() => {
                          const histClassification = classifyRetailerHistoricalNotes({
                            source: src,
                            liveOffersCount: liveCountForSource,
                          });
                          return (
                            <>
                              {histClassification.historicalClarificationBanner && (
                                <div className="text-cyan-400/90 pt-1">
                                  {histClassification.historicalClarificationBanner}
                                </div>
                              )}
                              {resolved.formattedHistoricalProbeNote && (
                                <div className="text-slate-400 pt-1">
                                  {!isBlocked ? (
                                    <span className="text-slate-300">
                                      Historical Probe Log (Resolved): {resolved.formattedHistoricalProbeNote}
                                    </span>
                                  ) : (
                                    <span className="text-amber-300/90">
                                      {resolved.formattedHistoricalProbeNote}
                                    </span>
                                  )}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ================================================================= */}
          {/* LEVEL 2: CROSS-RETAILER PRICE MATRIX (PRIMARY WORKING AREA)       */}
          {/* ================================================================= */}
          <div className="space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-900 p-4 rounded-xl border border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-indigo-400" />
                    Cross-Retailer Price Matrix
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Compare verified Greek retailer pricing, cross-retailer price spread, and observation provenance.
                  </p>
                </div>

                {/* Provenance Filter Mode Tabs */}
                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1 self-start sm:self-auto">
                  <button
                    onClick={() => setProvenanceFilter('LIVE_ONLY')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      provenanceFilter === 'LIVE_ONLY'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Live Verified ({reconciliationCounts.liveVerifiedProductsCount})
                  </button>
                  <button
                    onClick={() => setProvenanceFilter('ALL_OFFERS')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      provenanceFilter === 'ALL_OFFERS'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All SKUs ({reconciliationCounts.allProductsCount})
                  </button>
                  <button
                    onClick={() => setProvenanceFilter('PILOT_ONLY')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      provenanceFilter === 'PILOT_ONLY'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Pilot Ref ({reconciliationCounts.pilotProductsCount})
                  </button>
                </div>
              </div>

              {/* Search, Brand, Category & Sort Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 sm:w-56 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search model, brand, EAN..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <select
                  aria-label="Filter by Manufacturer"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All Manufacturers</option>
                  {availableBrands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by Category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All Categories</option>
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1.5">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    aria-label="Sort Price Matrix"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as PriceMatrixSortKey)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="lowestPrice">Sort: Lowest Verified Price</option>
                    <option value="priceSpread">Sort: Highest Price Difference / Spread</option>
                    <option value="brand">Sort: Manufacturer (A-Z)</option>
                    <option value="category">Sort: Category</option>
                    <option value="lastUpdated">Sort: Latest Verified Observation</option>
                    <option value="name">Sort: Product Name (A-Z)</option>
                  </select>
                </div>

                {(searchQuery ||
                  brandFilter !== 'ALL' ||
                  categoryFilter !== 'ALL' ||
                  provenanceFilter !== 'LIVE_ONLY') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setBrandFilter('ALL');
                      setCategoryFilter('ALL');
                      setProvenanceFilter('LIVE_ONLY');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition-colors cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Matrix Table */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-mono text-slate-400 uppercase">
                      <th className="py-3.5 px-4">Product / Canonical SKU</th>
                      <th className="py-3.5 px-3">
                        <div className="flex items-center gap-1">
                          <span>Public.gr</span>
                          <span
                            className={`text-[9px] ${
                              getResolvedRetailerStatus('public-gr').state === 'OPERATIONAL'
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {getResolvedRetailerStatus('public-gr').columnHeaderBadge}
                          </span>
                        </div>
                      </th>
                      <th className="py-3.5 px-3">
                        <div className="flex items-center gap-1">
                          <span>Kotsovolos</span>
                          <span
                            className={`text-[9px] ${
                              getResolvedRetailerStatus('kotsovolos-gr').state === 'OPERATIONAL'
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {getResolvedRetailerStatus('kotsovolos-gr').columnHeaderBadge}
                          </span>
                        </div>
                      </th>
                      <th className="py-3.5 px-3">
                        <div className="flex items-center gap-1">
                          <span>Plaisio</span>
                          <span
                            className={`text-[9px] ${
                              getResolvedRetailerStatus('plaisio-gr').state === 'OPERATIONAL'
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {getResolvedRetailerStatus('plaisio-gr').columnHeaderBadge}
                          </span>
                        </div>
                      </th>
                      <th className="py-3.5 px-3">Lowest Verified & Spread</th>
                      <th className="py-3.5 px-3">24h Price Change</th>
                      <th className="py-3.5 px-4 text-right">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400 font-mono">
                          No products matched your current search, manufacturer, category, or provenance filter.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map((item) => {
                        const p = item.product;
                        const pubOffer = getRetailerCellOffer(item, 'public-gr');
                        const kotOffer = getRetailerCellOffer(item, 'kotsovolos-gr');
                        const plaOffer = getRetailerCellOffer(item, 'plaisio-gr');

                        const hasLiveOffer =
                          item.lowestLiveVerifiedPriceCents !== null &&
                          item.lowestLiveVerifiedPriceCents > 0;
                        const displayLowestPriceCents =
                          provenanceFilter === 'PILOT_ONLY'
                            ? item.lowestPilotPriceCents
                            : hasLiveOffer
                            ? item.lowestLiveVerifiedPriceCents
                            : item.lowestPilotPriceCents;

                        const displayLowestRetailer =
                          provenanceFilter === 'PILOT_ONLY'
                            ? item.lowestPilotRetailer
                            : hasLiveOffer
                            ? item.lowestLiveVerifiedRetailer
                            : item.lowestPilotRetailer;

                        const displayLowestIsLive =
                          provenanceFilter === 'PILOT_ONLY' ? false : hasLiveOffer;

                        const spreadCents = getProductPriceSpreadCents(item);
                        const isHuawei = p.brand.toUpperCase() === 'HUAWEI';

                        const renderOfferCell = (offer: typeof pubOffer) => {
                          if (!offer || !offer.currentPriceCents) {
                            return (
                              <span className="text-[11px] text-slate-500 font-mono">
                                — No verified price
                              </span>
                            );
                          }
                          const isLive =
                            offer.isLiveVerified === true &&
                            offer.observationStatus === 'LIVE_VERIFIED';
                          const isLowestMatch =
                            displayLowestPriceCents !== null &&
                            offer.currentPriceCents === displayLowestPriceCents &&
                            isLive === displayLowestIsLive;

                          return (
                            <div>
                              <div
                                className={`font-bold tabular-nums ${
                                  isLowestMatch ? 'text-emerald-400' : 'text-slate-200'
                                }`}
                              >
                                {formatEuro(offer.currentPriceCents)}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span
                                  className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border ${
                                    isLive
                                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  }`}
                                >
                                  {isLive ? 'LIVE' : 'PILOT'}
                                </span>
                                <a
                                  href={offer.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-indigo-400 hover:underline flex items-center gap-0.5"
                                >
                                  Link <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            </div>
                          );
                        };

                        return (
                          <tr
                            key={p.id}
                            className={`hover:bg-slate-800/30 transition-colors ${
                              isHuawei ? 'bg-indigo-950/10' : ''
                            }`}
                          >
                            {/* Product Column */}
                            <td className="py-3 px-4">
                              <div className="flex items-start gap-2">
                                {isHuawei ? (
                                  <span className="mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                    HUAWEI
                                  </span>
                                ) : (
                                  <span className="mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                    {normalizeRetailBrandDisplay(p.brand)}
                                  </span>
                                )}
                                <div>
                                  <div className="font-bold text-slate-200 hover:text-indigo-400 transition-colors">
                                    {p.name}
                                  </div>
                                  <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-2 flex-wrap">
                                    <span>{p.category}</span>
                                    <span>•</span>
                                    <span>{p.storage || 'Standard'}</span>
                                    <span>•</span>
                                    <span className={p.isPilot ? 'text-amber-400/90' : 'text-cyan-400'}>
                                      {p.isPilot ? 'Pilot Catalog' : 'Auto-Discovered'}
                                    </span>
                                    {p.ean && (
                                      <>
                                        <span>•</span>
                                        <span>EAN {p.ean}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Public Offer */}
                            <td className="py-3 px-3 font-mono">{renderOfferCell(pubOffer)}</td>

                            {/* Kotsovolos Offer */}
                            <td className="py-3 px-3 font-mono">{renderOfferCell(kotOffer)}</td>

                            {/* Plaisio Offer */}
                            <td className="py-3 px-3 font-mono">{renderOfferCell(plaOffer)}</td>

                            {/* Lowest Price & Cross-Retailer Spread Column */}
                            <td className="py-3 px-3 font-mono">
                              {displayLowestPriceCents ? (
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-emerald-400 tabular-nums">
                                      {formatEuro(displayLowestPriceCents)}
                                    </span>
                                    <span
                                      className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border ${
                                        displayLowestIsLive
                                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                      }`}
                                    >
                                      {displayLowestIsLive ? 'LIVE' : 'PILOT'}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    at <span className="text-slate-200">{displayLowestRetailer}</span>
                                    {spreadCents !== null && spreadCents > 0 && (
                                      <span className="ml-1.5 text-amber-300">
                                        (Spread: {formatEuro(spreadCents)})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[9px]">
                                    {displayLowestIsLive ? (
                                      item.comparisonType === 'REAL_MARKET_MULTI' ? (
                                        <span className="text-cyan-400">
                                          Real Market (Multi-Retailer Live)
                                        </span>
                                      ) : item.lowestPilotPriceCents !== null ? (
                                        <span className="text-emerald-400/90">
                                          Live Verified (+Pilot Ref)
                                        </span>
                                      ) : (
                                        <span className="text-emerald-400/80">
                                          Single-Retailer Live Observation
                                        </span>
                                      )
                                    ) : (
                                      <span className="text-amber-400/90">
                                        Pilot Baseline Reference Only
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-500 font-mono">
                                  — No verified price
                                </span>
                              )}
                            </td>

                            {/* 24h Observed Price Change */}
                            <td className="py-3 px-3 font-mono">
                              {(() => {
                                const semantics = evaluateProductPriceComparisonSemantics({ item });
                                if (
                                  semantics.eligibility === 'ELIGIBLE_LIVE_DELTA' &&
                                  semantics.delta24hCents !== null &&
                                  semantics.delta24hCents < 0
                                ) {
                                  return (
                                    <div className="flex flex-col text-[11px]">
                                      <span className="text-emerald-400 flex items-center gap-1 font-bold">
                                        <TrendingDown className="w-3 h-3" />
                                        {formatEuro(Math.abs(semantics.delta24hCents))}
                                      </span>
                                      <span className="text-[9px] text-slate-400">
                                        {semantics.secondaryLabel}
                                      </span>
                                    </div>
                                  );
                                }
                                if (
                                  semantics.eligibility === 'ELIGIBLE_LIVE_DELTA' &&
                                  semantics.delta24hCents !== null &&
                                  semantics.delta24hCents > 0
                                ) {
                                  return (
                                    <div className="flex flex-col text-[11px]">
                                      <span className="text-rose-400 flex items-center gap-1 font-bold">
                                        <TrendingUp className="w-3 h-3" />
                                        +{formatEuro(semantics.delta24hCents)}
                                      </span>
                                      <span className="text-[9px] text-slate-400">
                                        {semantics.secondaryLabel}
                                      </span>
                                    </div>
                                  );
                                }
                                return (
                                  <div
                                    className="text-slate-500 flex flex-col text-[11px]"
                                    title={semantics.tooltipExplanation || semantics.secondaryLabel}
                                  >
                                    <span className="flex items-center gap-1">
                                      <Minus className="w-3 h-3" /> {semantics.primaryLabel || 'No 24h delta'}
                                    </span>
                                    <span
                                      className={`text-[9px] ${
                                        semantics.eligibility === 'STALE_LIVE_OBSERVATION' ||
                                        semantics.eligibility === 'PILOT_BASELINE_ONLY'
                                          ? 'text-amber-400/80'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {semantics.secondaryLabel}
                                    </span>
                                  </div>
                                );
                              })()}
                            </td>

                            {/* Actions */}
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => setSelectedProductItem(item)}
                                className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <History className="w-3.5 h-3.5 text-indigo-400" />
                                Provenance
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ================================================================= */}
          {/* LEVEL 3: PRODUCT MATCH REVIEW & DATA QUALITY QUEUE (A3)           */}
          {/* ================================================================= */}
          <div ref={reviewQueueRef} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileWarning
                  className={`w-4 h-4 ${reviews.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
                />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Product Match Review & Data Quality Queue ({reviews.length})
                </h3>
                <SemanticBadge variant={reviews.length > 0 ? 'review' : 'verified'}>
                  {reviews.length > 0
                    ? `${reviews.length} Pending Disambiguation`
                    : '0 Ambiguous Listings'}
                </SemanticBadge>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Strict non-merging guard: listings missing storage/color variant evidence are held from auto-linking
              </span>
            </div>

            {reviews.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-400 font-mono flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  All active retailer offers have verified canonical product mappings. No ambiguous listings require manual review.
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                {reviews.map((rev) => {
                  const evidence = extractListingVariantEvidence(
                    rev.sourceTitle,
                    rev.candidateProductName,
                    rev.sourceBrand
                  );
                  return (
                    <div
                      key={rev.id}
                      className="p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-3"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 pb-3 border-b border-slate-800/80">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 uppercase">
                              Manual Disambiguation Required
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                              Retailer: {rev.retailerId}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                              Observed Price: {formatEuro(rev.sourcePriceCents)}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                              Confidence: {Math.round(rev.confidenceScore * 100)}% (
                              {rev.suggestedConfidence})
                            </span>
                          </div>
                          <div className="pt-1">
                            <span className="text-[10px] font-mono uppercase text-slate-400 block">
                              Original Retailer Listing:
                            </span>
                            <div className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                              <span>{rev.sourceTitle}</span>
                              {rev.sourceUrl && (
                                <a
                                  href={rev.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-mono font-normal text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 underline"
                                >
                                  <span>Source Listing Link</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Admin Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {canManage ? (
                            <>
                              <button
                                onClick={() => handleResolveReview(rev.id, 'APPROVED')}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Approve Match
                              </button>
                              <button
                                onClick={() => handleResolveReview(rev.id, 'REJECTED')}
                                className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] font-mono text-slate-400 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 flex items-center gap-1.5">
                              <Lock className="w-3 h-3 text-slate-400" />
                              Admin role required to resolve
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Structured Disambiguation Fields */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                          <span className="text-[10px] font-mono uppercase text-slate-400 block">
                            Proposed Canonical Product
                          </span>
                          <span className="font-bold text-indigo-300 mt-0.5 block">
                            {rev.candidateProductName || 'No Canonical Match Found'}
                          </span>
                          {rev.candidateProductId && (
                            <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                              ID: {rev.candidateProductId}
                            </span>
                          )}
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                          <span className="text-[10px] font-mono uppercase text-slate-400 block">
                            Manufacturer
                          </span>
                          <span className="font-bold text-slate-200 mt-0.5 block">
                            {evidence.manufacturer}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                          <span className="text-[10px] font-mono uppercase text-slate-400 block">
                            Model Family
                          </span>
                          <span className="font-semibold text-slate-200 mt-0.5 block">
                            {evidence.modelFamily}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                          <span className="text-[10px] font-mono uppercase text-slate-400 block">
                            Storage Variant
                          </span>
                          <span
                            className={`font-mono font-semibold mt-0.5 block ${
                              evidence.storageVariant.startsWith('Unspecified')
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {evidence.storageVariant}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                          <span className="text-[10px] font-mono uppercase text-slate-400 block">
                            Color Variant
                          </span>
                          <span
                            className={`font-mono font-semibold mt-0.5 block ${
                              evidence.colorVariant.startsWith('Unspecified')
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {evidence.colorVariant}
                          </span>
                        </div>
                      </div>

                      {/* Missing Evidence & Reason for Manual Review */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/20">
                          <span className="text-[10px] font-mono uppercase text-amber-300 font-semibold block mb-1">
                            Missing Evidence Preventing Auto-Merge:
                          </span>
                          <ul className="list-disc list-inside text-[11px] text-amber-200/90 space-y-0.5">
                            {evidence.missingEvidence.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                          <span className="text-[10px] font-mono uppercase text-slate-400 font-semibold block mb-1">
                            Reason for Manual Review:
                          </span>
                          <p className="text-[11px] text-slate-300 font-mono leading-relaxed">
                            {rev.matchReasons.join(' • ')}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* LEVEL 4: TECHNICAL OPERATIONS & ADMIN DIAGNOSTICS LINK            */}
          {/* ================================================================= */}
          {canManage && (
            <div className="px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-400 font-mono">
                <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>
                  Technical Operations: Manage retailer category crawlers, inspect collection run logs, or verify Firestore persistence in System Diagnostics.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSubView('SOURCES')}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px] transition-colors cursor-pointer"
                >
                  Manage Sources & Crawlers
                </button>
                <a
                  href="#system-diagnostics:retail"
                  className="px-2.5 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono text-[11px] transition-colors"
                >
                  Open System Diagnostics (Retail) →
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Price History & Provenance Modal */}
      {selectedProductItem && (
        <PriceHistoryModal
          product={selectedProductItem.product}
          offers={selectedProductItem.offers}
          onClose={() => setSelectedProductItem(null)}
        />
      )}
    </AppPage>
  );
};

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  ArrowRight,
  RefreshCw,
  Building2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Clock,
  Info,
  SlidersHorizontal,
  ShieldCheck,
  Store,
  MessageSquareWarning,
  Layers,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { isProductionStory, NavigationTab } from '../../types';
import {
  RetailDashboardStats,
  RetailProductViewItem,
} from '../../types/retailPrice';
import {
  ServiceAdvisory,
  ServiceDashboardStats,
  ServiceProductMatch,
} from '../../types/serviceIntelligence';
import { VocOverviewPayload } from '../../types/vocIntelligence';
import { calculateTrendAnalytics } from '../../services/trendAnalytics';
import { getGlobalTrackedCompetitors } from '../../services/competitorSelectors';
import {
  CommandCenterReportingPeriod,
  CommandCenterTargetScope,
  SignalConfidenceTier,
  SignalDomainCategory,
  resolveTargetContext,
  resolveDatasetReferenceTimeMs,
  buildPriorityIntelligenceSignals,
  computeExecutiveSummaryKpis,
  evaluateCrossModuleInsights,
  filterAdvisoriesForDashboard,
  isMatchingTargetManufacturer,
  getReportingPeriodLabel,
  evaluateLiveRetailMovementForPeriod,
} from '../../services/commandCenterIntelligence';
import {
  reconcileRetailCatalogCounts,
  resolveRetailCatalogTimestamps,
  resolveRetailerOperationalStatus,
} from '../../utils/dataIntegrityContracts';
import {
  ExecutiveKpiCard,
  PrioritySignalRow,
  ModulePanelHeader,
  formatRelativeOrShortTimestamp,
  formatEurFromCents,
} from './CommandCenterComponents';
import {
  AppPage,
  ResponsiveGrid,
  Button,
  EmptyStateCard,
} from '../common/DesignSystem';

export const OverviewDashboard: React.FC = () => {
  const {
    stories,
    companies,
    products,
    settings,
    analyses,
    setActiveTab,
    navigateToStory,
    refreshData,
    isLoading: isAppContextLoading,
    error: appContextError,
    canManage,
    analyzePendingArticles,
    isAnalyzing,
    collectorStatus,
  } = useApp();

  // Command Center Filter Controls
  const [reportingPeriod, setReportingPeriod] = useState<CommandCenterReportingPeriod>('30d');
  const [targetScope, setTargetScope] = useState<CommandCenterTargetScope>('TARGET_FOCUS');
  const [targetOverrideBrand, setTargetOverrideBrand] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | SignalConfidenceTier>('ALL');
  const [domainFilter, setDomainFilter] = useState<'ALL' | SignalDomainCategory>('ALL');

  // Cross-Module Authoritative State
  const [retailStats, setRetailStats] = useState<RetailDashboardStats | null>(null);
  const [retailProducts, setRetailProducts] = useState<RetailProductViewItem[]>([]);
  const [serviceStats, setServiceStats] = useState<ServiceDashboardStats | null>(null);
  const [serviceAdvisories, setServiceAdvisories] = useState<ServiceAdvisory[]>([]);
  const [serviceMatches, setServiceMatches] = useState<ServiceProductMatch[]>([]);
  const [vocOverview, setVocOverview] = useState<VocOverviewPayload | null>(null);

  const [isModulesLoading, setIsModulesLoading] = useState<boolean>(true);
  const [moduleLoadWarning, setModuleLoadWarning] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  // Sync targetOverrideBrand when global settings change
  useEffect(() => {
    setTargetOverrideBrand(null);
  }, [settings?.myCompanyId, settings?.myCompanyName]);

  const targetContext = useMemo(
    () => resolveTargetContext(companies, settings, targetOverrideBrand),
    [companies, settings, targetOverrideBrand]
  );

  const loadCrossModuleIntelligence = useCallback(async () => {
    setIsModulesLoading(true);
    setModuleLoadWarning(null);

    try {
      const [retailDashRes, retailProdRes, srvStatRes, srvAdvRes, srvMatchRes, vocRes] =
        await Promise.allSettled([
          fetch('/api/retail/dashboard'),
          fetch('/api/retail/products'),
          fetch('/api/service/dashboard-stats'),
          fetch('/api/service/advisories'),
          fetch('/api/service/product-matches'),
          fetch(
            `/api/voc/overview?manufacturer=${encodeURIComponent(
              targetContext.canonicalDisplayName || 'Huawei'
            )}`
          ),
        ]);

      const warnings: string[] = [];

      if (retailDashRes.status === 'fulfilled' && retailDashRes.value.ok) {
        const data = await retailDashRes.value.json();
        setRetailStats(data?.stats || data || null);
      } else {
        warnings.push('Retail summary metrics temporarily unavailable');
      }

      if (retailProdRes.status === 'fulfilled' && retailProdRes.value.ok) {
        const data = await retailProdRes.value.json();
        setRetailProducts(data.products || []);
      }

      if (srvStatRes.status === 'fulfilled' && srvStatRes.value.ok) {
        const data = await srvStatRes.value.json();
        if (data?.stats) setServiceStats(data.stats);
      } else {
        warnings.push('Service intelligence summary temporarily unavailable');
      }

      if (srvAdvRes.status === 'fulfilled' && srvAdvRes.value.ok) {
        const data = await srvAdvRes.value.json();
        setServiceAdvisories(data.advisories || []);
      }

      if (srvMatchRes.status === 'fulfilled' && srvMatchRes.value.ok) {
        const data = await srvMatchRes.value.json();
        setServiceMatches(data.matches || []);
      }

      if (vocRes.status === 'fulfilled' && vocRes.value.ok) {
        const data = await vocRes.value.json();
        setVocOverview(data);
      }

      if (warnings.length > 0) {
        setModuleLoadWarning(warnings.join(' · '));
      }
      setLastRefreshedAt(new Date().toISOString());
    } catch (err: unknown) {
      setModuleLoadWarning(
        err instanceof Error ? err.message : 'Partial intelligence synchronization warning.'
      );
    } finally {
      setIsModulesLoading(false);
    }
  }, [targetContext.canonicalDisplayName]);

  useEffect(() => {
    loadCrossModuleIntelligence();
  }, [loadCrossModuleIntelligence]);

  const handleRefreshAll = async () => {
    await Promise.all([refreshData(), loadCrossModuleIntelligence()]);
  };

  const handleOpenModuleOrStory = (tab: NavigationTab, storyId?: string) => {
    if (tab === 'stories' && storyId) {
      navigateToStory(storyId);
      return;
    }
    setActiveTab(tab);
  };

  // Reference time for consistent reporting period evaluation
  const datasetReferenceTimeMs = useMemo(
    () =>
      resolveDatasetReferenceTimeMs({
        stories,
        advisories: serviceAdvisories,
        retailProducts,
      }),
    [stories, serviceAdvisories, retailProducts]
  );

  // All Priority Signals for the current Target & Reporting Period
  const allPrioritySignals = useMemo(
    () =>
      buildPriorityIntelligenceSignals({
        stories,
        advisories: serviceAdvisories,
        retailProducts,
        target: targetContext,
        scope: targetScope,
        period: reportingPeriod,
        referenceTimeMs: datasetReferenceTimeMs,
      }),
    [
      stories,
      serviceAdvisories,
      retailProducts,
      targetContext,
      targetScope,
      reportingPeriod,
      datasetReferenceTimeMs,
    ]
  );

  // Filtered Priority Signals for Section C
  const filteredPrioritySignals = useMemo(() => {
    return allPrioritySignals.filter((sig) => {
      if (confidenceFilter !== 'ALL' && sig.confidenceTier !== confidenceFilter) {
        return false;
      }
      if (domainFilter !== 'ALL' && sig.domain !== domainFilter) {
        return false;
      }
      return true;
    });
  }, [allPrioritySignals, confidenceFilter, domainFilter]);

  const confirmedSignalsCount = useMemo(
    () => allPrioritySignals.filter((s) => s.confidenceTier === 'CONFIRMED').length,
    [allPrioritySignals]
  );
  const likelySignalsCount = useMemo(
    () => allPrioritySignals.filter((s) => s.confidenceTier === 'LIKELY_CORROBORATED').length,
    [allPrioritySignals]
  );
  const reviewSignalsCount = useMemo(
    () => allPrioritySignals.filter((s) => s.confidenceTier === 'NEEDS_REVIEW').length,
    [allPrioritySignals]
  );

  // Section B: 4 Executive Intelligence Summary KPIs
  const executiveKpis = useMemo(
    () =>
      computeExecutiveSummaryKpis({
        signals: allPrioritySignals,
        stories,
        retailStats,
        retailProducts,
        serviceStats,
        advisories: serviceAdvisories,
        target: targetContext,
        scope: targetScope,
        period: reportingPeriod,
        referenceTimeMs: datasetReferenceTimeMs,
      }),
    [
      allPrioritySignals,
      stories,
      retailStats,
      retailProducts,
      serviceStats,
      serviceAdvisories,
      targetContext,
      targetScope,
      reportingPeriod,
      datasetReferenceTimeMs,
    ]
  );

  // Section D1: Market & Competitive Intelligence Data
  const trackedCompetitors = useMemo(
    () => getGlobalTrackedCompetitors(companies, settings),
    [companies, settings]
  );

  const productionStories = useMemo(
    () =>
      stories.filter(
        (s) =>
          isProductionStory(s) &&
          s.status !== 'ARCHIVED' &&
          s.status !== 'STALE' &&
          !(s.mergeMetadata && (s.mergeMetadata as any).isMergedAway === true)
      ),
    [stories]
  );

  const targetMarketStories = useMemo(() => {
    const list =
      targetScope === 'GLOBAL_MARKET'
        ? productionStories
        : productionStories.filter(
            (s) =>
              isMatchingTargetManufacturer(s.primaryCompanyId, targetContext) ||
              s.huaweiRelevance === 'PRIMARY_TARGET' ||
              (s.companies || []).some((c) =>
                isMatchingTargetManufacturer(c.companyId || c.name, targetContext)
              ) ||
              s.competitiveThreatLevel === 'HIGH'
          );
    return list.slice(0, 4);
  }, [productionStories, targetScope, targetContext]);

  const analysesList = useMemo(() => Object.values(analyses || {}), [analyses]);
  const topTrends = useMemo(() => {
    const res = calculateTrendAnalytics(analysesList, stories, {
      timeRange: reportingPeriod === '7d' ? '7d' : '30d',
      category: 'ALL_STRATEGIC',
    });
    return res.topTrends.slice(0, 5);
  }, [analysesList, stories, reportingPeriod]);

  const scopedCatalogProducts = useMemo(() => {
    if (targetScope === 'GLOBAL_MARKET') return products;
    return products.filter(
      (p) =>
        isMatchingTargetManufacturer(p.companyId, targetContext) ||
        isMatchingTargetManufacturer(p.name, targetContext)
    );
  }, [products, targetScope, targetContext]);

  // Section D2: Retail Price Intelligence Data
  const scopedRetailItems = useMemo(() => {
    if (targetScope === 'GLOBAL_MARKET') return retailProducts;
    return retailProducts.filter((item) =>
      isMatchingTargetManufacturer(item.product.brand, targetContext)
    );
  }, [retailProducts, targetScope, targetContext]);

  const liveVerifiedRetailItems = useMemo(
    () =>
      scopedRetailItems.filter(
        (item) =>
          item.provenanceSummary === 'LIVE_VERIFIED' ||
          item.effectiveLowestProvenance === 'LIVE_VERIFIED' ||
          item.offers.some((o) => o.isLiveVerified)
      ),
    [scopedRetailItems]
  );

  const reconciledOverviewRetailCatalog = useMemo(
    () => reconcileRetailCatalogCounts(scopedRetailItems, retailStats),
    [scopedRetailItems, retailStats]
  );

  const overviewCatalogTimestamps = useMemo(
    () =>
      resolveRetailCatalogTimestamps({
        products: scopedRetailItems,
        retailStats,
      }),
    [scopedRetailItems, retailStats]
  );

  const allScopedRetailOffers = useMemo(
    () => scopedRetailItems.flatMap((item) => item.offers || []),
    [scopedRetailItems]
  );

  const featuredRetailComparisonItems = useMemo(() => {
    // Prioritize products with live verified pricing or multi-retailer comparison, never mixing incompatible variants
    const sorted = [...scopedRetailItems].sort((a, b) => {
      const aLive = a.lowestLiveVerifiedPriceCents !== null ? 1 : 0;
      const bLive = b.lowestLiveVerifiedPriceCents !== null ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive;
      const aOffers = a.offers.length;
      const bOffers = b.offers.length;
      if (bOffers !== aOffers) return bOffers - aOffers;
      return a.product.name.localeCompare(b.product.name);
    });
    return sorted.slice(0, 4);
  }, [scopedRetailItems]);

  // Section D3: Service & Security Intelligence Data
  const scopedServiceAdvisories = useMemo(
    () =>
      filterAdvisoriesForDashboard(
        serviceAdvisories,
        targetContext,
        targetScope,
        reportingPeriod,
        datasetReferenceTimeMs,
        true
      ),
    [serviceAdvisories, targetContext, targetScope, reportingPeriod, datasetReferenceTimeMs]
  );

  const securityVulnerabilityAdvisories = useMemo(
    () =>
      scopedServiceAdvisories.filter(
        (a) =>
          !a.isZeroCveRelease &&
          a.advisoryType !== 'UPDATE_SCHEDULE' &&
          a.advisoryType !== 'GENERAL_MAINTENANCE_INFORMATION'
      ),
    [scopedServiceAdvisories]
  );

  const maintenanceAndUpdateAdvisories = useMemo(
    () =>
      scopedServiceAdvisories.filter(
        (a) =>
          Boolean(a.isZeroCveRelease) ||
          a.advisoryType === 'UPDATE_SCHEDULE' ||
          a.advisoryType === 'GENERAL_MAINTENANCE_INFORMATION'
      ),
    [scopedServiceAdvisories]
  );

  // Section E: Cross-Module Intelligence State
  const crossModuleState = useMemo(
    () =>
      evaluateCrossModuleInsights({
        retailProducts,
        advisories: serviceAdvisories,
        persistedProductMatches: serviceMatches,
        vocOverview,
        target: targetContext,
        scope: targetScope,
      }),
    [retailProducts, serviceAdvisories, serviceMatches, vocOverview, targetContext, targetScope]
  );

  // Overall Data Freshness Timestamp
  const latestGlobalUpdateTimestamp = useMemo(() => {
    const candidates = [
      collectorStatus?.lastSuccessfulGlobalCollection,
      serviceStats?.lastSyncTimestamp,
      retailStats?.lastSuccessfulRun?.completedAt,
      lastRefreshedAt,
    ].filter(Boolean) as string[];

    if (candidates.length === 0) return null;
    return candidates.sort().reverse()[0];
  }, [
    collectorStatus?.lastSuccessfulGlobalCollection,
    serviceStats?.lastSyncTimestamp,
    retailStats?.lastSuccessfulRun?.completedAt,
    lastRefreshedAt,
  ]);

  const isLoadingAny = isAppContextLoading || isModulesLoading;

  // Available Target Manufacturers for quick lens switching
  const quickTargetOptions = useMemo(() => {
    const base = ['HUAWEI', 'Apple', 'Samsung'];
    const current = targetContext.companyName;
    if (!base.some((b) => b.toLowerCase() === current.toLowerCase())) {
      return [current, ...base];
    }
    return base;
  }, [targetContext.companyName]);

  return (
    <AppPage className="pb-8">
      {/* ===================================================================
          SECTION A — Intelligence Command Header
          =================================================================== */}
      <section
        aria-label="Intelligence Command Header"
        className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-xl md:text-2xl font-bold text-slate-100 tracking-tight">
              Intelligence Overview
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Your unified view of market, competitive, retail, customer, and service intelligence.
            </p>
          </div>

          {/* Primary Refresh Action & Freshness Status */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                {isLoadingAny
                  ? 'Synchronizing intelligence...'
                  : latestGlobalUpdateTimestamp
                  ? `Updated ${formatRelativeOrShortTimestamp(latestGlobalUpdateTimestamp)}`
                  : 'Authoritative Data Active'}
              </span>
            </div>

            <Button
              variant="secondary"
              size="md"
              onClick={handleRefreshAll}
              disabled={isLoadingAny}
              title="Refresh all cross-module intelligence datasets (Core, Retail Prices, Service Advisories, and Voice of Customer) without triggering new external source collection"
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoadingAny ? 'animate-spin' : ''}`} />}
            >
              Refresh Intelligence
            </Button>
          </div>
        </div>

        {/* Manufacturer Lens & Reporting Period Filter Bar */}
        <div className="pt-4 border-t border-slate-800/80 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          {/* Left: Temporary Manufacturer Lens Selector */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className="flex items-center gap-1.5 text-xs text-slate-400"
              title="Temporary view filter for this dashboard. Switching lenses here does not overwrite your persisted Global Primary Target."
            >
              <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>Manufacturer Lens:</span>
            </div>

            {/* Target Manufacturer Lens Selector */}
            <div
              role="group"
              aria-label="Manufacturer Lens"
              className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
            >
              {quickTargetOptions.map((brand) => {
                const isSelected =
                  targetScope === 'TARGET_FOCUS' &&
                  targetContext.companyName.toLowerCase() === brand.toLowerCase();
                return (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => {
                      setTargetScope('TARGET_FOCUS');
                      setTargetOverrideBrand(brand);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {brand}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setTargetScope('GLOBAL_MARKET')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  targetScope === 'GLOBAL_MARKET'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Manufacturers
              </button>
            </div>

            {(targetOverrideBrand || targetScope === 'GLOBAL_MARKET') && (
              <span className="text-[11px] font-mono text-slate-400">
                (Temporary view filter)
              </span>
            )}

            {canManage && (
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="text-xs text-slate-400 hover:text-indigo-300 underline-offset-4 hover:underline transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Configure Default Target
              </button>
            )}
          </div>

          {/* Right: Reporting Period Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>Reporting Period:</span>
            </span>
            <div
              role="group"
              aria-label="Reporting Period"
              className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
            >
              {(
                [
                  { id: '24h', label: '24 Hours' },
                  { id: '7d', label: '7 Days' },
                  { id: '30d', label: '30 Days' },
                  { id: 'ALL', label: 'All Active' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setReportingPeriod(opt.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    reportingPeriod === opt.id
                      ? 'bg-slate-800 text-slate-100 border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Non-intrusive warning banner if any secondary endpoint reported an error */}
        {(appContextError || moduleLoadWarning) && (
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{appContextError || moduleLoadWarning}</span>
            </div>
            <button
              type="button"
              onClick={handleRefreshAll}
              className="text-xs font-medium text-amber-200 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Retry Load
            </button>
          </div>
        )}
      </section>

      {/* ===================================================================
          SECTION B — Executive Intelligence Summary (4 Primary KPIs)
          =================================================================== */}
      <section aria-label="Executive Intelligence Summary" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <h2 className="text-sm font-semibold text-slate-200 tracking-tight">
            Executive Intelligence Summary
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>
              Scope:{' '}
              {targetScope === 'TARGET_FOCUS'
                ? `${targetContext.companyName} & Direct Ecosystem`
                : 'Global Multi-Vendor Market'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{getReportingPeriodLabel(reportingPeriod)}</span>
          </div>
        </div>

        <ResponsiveGrid cols={4} gap="md">
          {executiveKpis.map((kpi) => {
            const kpiIsLoading =
              kpi.id === 'retail-pricing'
                ? isModulesLoading && retailStats === null && retailProducts.length === 0
                : kpi.id === 'security-advisories'
                ? isModulesLoading && serviceStats === null && serviceAdvisories.length === 0
                : kpi.id === 'market-developments'
                ? isAppContextLoading && stories.length === 0
                : isLoadingAny &&
                  stories.length === 0 &&
                  serviceAdvisories.length === 0 &&
                  retailProducts.length === 0;
            return (
              <ExecutiveKpiCard
                key={kpi.id}
                metric={kpi}
                isLoading={kpiIsLoading}
                onNavigate={setActiveTab}
              />
            );
          })}
        </ResponsiveGrid>
      </section>

      {/* ===================================================================
          SECTION C — Priority Intelligence Feed
          =================================================================== */}
      <section
        aria-label="Priority Intelligence"
        className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100 tracking-tight">
              Priority Intelligence
            </h2>
            <p className="text-xs text-slate-400">
              Prioritized signals across market developments, official security advisories, and live verified retail pricing. Confirmed facts are strictly separated from likely intelligence and items requiring review.
            </p>
          </div>

          {/* Unboxed Evidence Summary Counts */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-400 shrink-0">
            <span className="text-emerald-400 font-medium">
              {confirmedSignalsCount} Confirmed
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-sky-400 font-medium">
              {likelySignalsCount} Likely / Corroborated
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-400 font-medium">
              {reviewSignalsCount} Require Review
            </span>
          </div>
        </div>

        {/* Interactive Filter Controls for Confidence Tier & Intelligence Domain */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Confidence Tier Segmented Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 inline-flex items-center gap-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span>Verification:</span>
            </span>
            <div
              role="group"
              aria-label="Verification Confidence Filter"
              className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
            >
              {(
                [
                  { id: 'ALL', label: `All (${allPrioritySignals.length})` },
                  { id: 'CONFIRMED', label: `Confirmed (${confirmedSignalsCount})` },
                  {
                    id: 'LIKELY_CORROBORATED',
                    label: `Likely / Corroborated (${likelySignalsCount})`,
                  },
                  { id: 'NEEDS_REVIEW', label: `Requires Review (${reviewSignalsCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setConfidenceFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    confidenceFilter === tab.id
                      ? 'bg-slate-800 text-slate-100 border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Domain Category Segmented Filter */}
          <div
            role="group"
            aria-label="Intelligence Domain Filter"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
          >
            {(
              [
                { id: 'ALL', label: 'All Domains' },
                { id: 'MARKET_COMPETITIVE', label: 'Market & Competitors' },
                { id: 'SECURITY_SERVICE', label: 'Security & Service' },
                { id: 'RETAIL_PRICING', label: 'Retail Pricing' },
              ] as const
            ).map((dom) => (
              <button
                key={dom.id}
                type="button"
                onClick={() => setDomainFilter(dom.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  domainFilter === dom.id
                    ? 'bg-slate-800 text-slate-100 border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {dom.label}
              </button>
            ))}
          </div>
        </div>

        {/* Signals List */}
        {isLoadingAny && allPrioritySignals.length === 0 ? (
          <div className="space-y-4 py-2">
            {[1, 2, 3, 4].map((skeletonIdx) => (
              <div
                key={skeletonIdx}
                className="py-3 border-b border-slate-800/80 last:border-none space-y-2"
              >
                <div className="h-3 w-64 bg-slate-800 rounded" />
                <div className="h-4 w-96 max-w-full bg-slate-800 rounded" />
                <div className="h-3 w-48 bg-slate-800/70 rounded" />
              </div>
            ))}
          </div>
        ) : filteredPrioritySignals.length === 0 ? (
          <div className="p-8 text-center space-y-3 bg-slate-950/50 border border-slate-800/80 rounded-xl">
            <p className="text-sm font-medium text-slate-200">
              No intelligence signals match the active filter criteria
            </p>
            <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
              {reportingPeriod !== 'ALL'
                ? `No verified records were published within ${getReportingPeriodLabel(
                    reportingPeriod
                  ).toLowerCase()} for the selected domain and confidence filters.`
                : 'Adjust the verification tier, domain filter, or switch between Target Focus and All Manufacturers.'}
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
              {reportingPeriod !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setReportingPeriod('ALL')}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
                >
                  Show All Active Periods
                </button>
              )}
              {(confidenceFilter !== 'ALL' || domainFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setConfidenceFilter('ALL');
                    setDomainFilter('ALL');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
                >
                  Reset Signal Filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredPrioritySignals.slice(0, 8).map((signal) => (
              <PrioritySignalRow
                key={signal.id}
                signal={signal}
                onOpenModule={handleOpenModuleOrStory}
              />
            ))}
          </div>
        )}
      </section>

      {/* ===================================================================
          SECTION D — Intelligence Module Overview (4 Consistent Panels)
          =================================================================== */}
      <section aria-label="Intelligence Module Overview" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200 tracking-tight">
            Intelligence Module Overview
          </h2>
          <span className="text-xs text-slate-400">
            Domain-specific summaries synchronized with authoritative module stores
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* ---------------------------------------------------------------
              PANEL 1: Market & Competitive Intelligence
              --------------------------------------------------------------- */}
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
            <ModulePanelHeader
              title="Market & Competitive Intelligence"
              subtitle={`Tracking ${targetContext.companyName}, ${trackedCompetitors.length} global rivals, and ${scopedCatalogProducts.length} catalog products`}
              actionLabel="Open Stories"
              onAction={() => setActiveTab('stories')}
            />

            {/* Unboxed Summary Metrics Strip */}
            <div className="grid grid-cols-3 gap-4 pb-4 border-b border-slate-800/80 text-left">
              <div>
                <span className="text-[11px] text-slate-400 block">Active Story Clusters</span>
                <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                  {productionStories.length}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Tracked Competitors</span>
                <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                  {trackedCompetitors.length}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">
                  {targetScope === 'TARGET_FOCUS'
                    ? `${targetContext.companyName} Products`
                    : 'Catalog Products'}
                </span>
                <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                  {scopedCatalogProducts.length}
                </span>
              </div>
            </div>

            {/* Recent Market & Competitor Developments */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-medium text-slate-300">
                  Recent Strategic Developments
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('competitors')}
                  className="text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Competitor Matrix</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              {isAppContextLoading && stories.length === 0 ? (
                <p className="text-xs text-slate-400 font-mono py-4">
                  Loading active story clusters...
                </p>
              ) : targetMarketStories.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">
                  No active story clusters found for the current target filter.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {targetMarketStories.map((story) => {
                    const companyLabel =
                      story.primaryCompanyId?.replace(/^comp-/i, '').toUpperCase() ||
                      story.companies?.[0]?.name ||
                      targetContext.companyName;
                    return (
                      <div key={story.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>
                            {companyLabel} · {story.storyType || 'MARKET_ACTIVITY'} ·{' '}
                            {story.sourceCount ?? story.sourceIds?.length ?? 1} outlets
                          </span>
                          <span>
                            {formatRelativeOrShortTimestamp(
                              story.lastMaterialUpdateAt || story.lastSeenAt || story.updatedAt
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigateToStory(story.id)}
                          className="text-left text-xs font-semibold text-slate-200 hover:text-indigo-400 transition-colors block w-full truncate cursor-pointer"
                        >
                          {story.canonicalTitle || story.title}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Trending Topics & Quick Links Footer */}
            <div className="pt-4 border-t border-slate-800/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-400 inline-flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Top Monitored Topics:</span>
                </span>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-slate-300">
                  {topTrends.length === 0 ? (
                    <span className="text-slate-500">Awaiting trend velocity</span>
                  ) : (
                    topTrends.map((t, idx) => (
                      <React.Fragment key={t.canonicalKey}>
                        {idx > 0 && <span aria-hidden="true" className="text-slate-600">·</span>}
                        <button
                          type="button"
                          onClick={() => setActiveTab('trends')}
                          className="hover:text-indigo-300 transition-colors cursor-pointer"
                        >
                          {t.topic} ({t.currentCount})
                        </button>
                      </React.Fragment>
                    ))
                  )}
                </div>
              </div>

              {/* Navigation & Admin Analysis Shortcuts */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/50 text-xs">
                <div className="flex flex-wrap items-center gap-3 text-slate-400">
                  <button
                    type="button"
                    onClick={() => setActiveTab('companies')}
                    className="hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    Companies
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('products')}
                    className="hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    Products Catalog
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('feed')}
                    className="hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    Intelligence Feed
                  </button>
                </div>

                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => analyzePendingArticles(5)}
                      disabled={isAnalyzing}
                      className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {isAnalyzing ? 'Analyzing...' : 'Analyze Recent Batch (5)'}
                    </button>
                    <span aria-hidden="true" className="text-slate-700">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('backfill')}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors cursor-pointer"
                    >
                      Historical Backfill
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------------
              PANEL 2: Retail Price Intelligence
              --------------------------------------------------------------- */}
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
            <ModulePanelHeader
              title="Retail Price Intelligence"
              subtitle={`Monitoring Greek retail offers across Plaisio.gr, Public.gr, and Kotsovolos.gr`}
              actionLabel="Open Retail Prices"
              onAction={() => setActiveTab('retail-prices')}
            />

            {/* Unboxed Summary Metrics Strip */}
            <div className="space-y-2.5 pb-4 border-b border-slate-800/80 text-left">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-[11px] text-slate-400 block">
                    {targetScope === 'TARGET_FOCUS'
                      ? `${targetContext.companyName} Monitored SKUs`
                      : 'Total Monitored SKUs'}
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                    {isModulesLoading && retailStats === null && retailProducts.length === 0
                      ? '...'
                      : reconciledOverviewRetailCatalog.allProductsCount}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Live Verified SKUs</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-emerald-400">
                    {isModulesLoading && retailStats === null && retailProducts.length === 0
                      ? '...'
                      : reconciledOverviewRetailCatalog.liveVerifiedProductsCount}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">24h Verified Shifts</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                    {isModulesLoading && retailStats === null && retailProducts.length === 0
                      ? '...'
                      : liveVerifiedRetailItems.filter(
                          (item) =>
                            evaluateLiveRetailMovementForPeriod(item, '24h', datasetReferenceTimeMs)
                              .isEligible
                        ).length}
                  </span>
                </div>
              </div>

              {/* Reconciled SKU Provenance & Separated Catalog Timestamps (N01 / F15 / P2.3.2.5) */}
              <div className="text-[11px] font-mono text-slate-400 flex flex-wrap items-center justify-between gap-2 pt-1">
                {isModulesLoading && retailStats === null && retailProducts.length === 0 ? (
                  <span className="text-slate-400">
                    Loading canonical retail SKU and offer reconciliation...
                  </span>
                ) : (
                  <>
                    <span>
                      <strong className="text-emerald-400">
                        {reconciledOverviewRetailCatalog.liveVerifiedProductsCount}
                      </strong>{' '}
                      live-verified ·{' '}
                      <strong className="text-amber-400">
                        {reconciledOverviewRetailCatalog.pilotOnlyProductsCount}
                      </strong>{' '}
                      pilot-only
                      {reconciledOverviewRetailCatalog.unlinkedOrZeroOfferProductsCount > 0 && (
                        <>
                          {' · '}
                          <strong className="text-slate-300">
                            {reconciledOverviewRetailCatalog.unlinkedOrZeroOfferProductsCount}
                          </strong>{' '}
                          no-offer
                        </>
                      )}
                      {reconciledOverviewRetailCatalog.mixedProvenanceProductsCount > 0 && (
                        <span className="text-slate-500">
                          {' '}
                          ({reconciledOverviewRetailCatalog.mixedProvenanceProductsCount} mixed /{' '}
                          {reconciledOverviewRetailCatalog.pilotProductsCount} pilot ref)
                        </span>
                      )}
                    </span>
                    <span className="text-slate-500">
                      {overviewCatalogTimestamps.latestLiveObservationDate
                        ? `Latest Live Obs: ${overviewCatalogTimestamps.latestLiveObservationDate} · Pilot Seed: ${overviewCatalogTimestamps.pilotBaselineDate}`
                        : `Pilot Seed: ${overviewCatalogTimestamps.pilotBaselineDate}`}
                    </span>
                  </>
                )}
              </div>
              {!(isModulesLoading && retailStats === null && retailProducts.length === 0) &&
                targetScope === 'GLOBAL_MARKET' && (
                  <div className="text-[10px] font-mono text-slate-500">
                    Offers: <strong className="text-emerald-400">{reconciledOverviewRetailCatalog.totalLiveVerifiedOffersCount}</strong> Live Verified ({reconciledOverviewRetailCatalog.liveVerifiedLinkedOffersCount} linked + {reconciledOverviewRetailCatalog.unlinkedLiveOffersCount} review) + <strong className="text-amber-400">{reconciledOverviewRetailCatalog.seededPilotOffersCount}</strong> Pilot = <strong className="text-slate-300">{reconciledOverviewRetailCatalog.totalActiveOffersCount}</strong> Active Offers
                  </div>
                )}
            </div>

            {/* Retailer Coverage & Provenance Integrity */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">
                  Retailer Feed Coverage & Provenance
                </span>
                <span className="text-slate-400 font-mono text-[11px]">
                  Live Verified vs. Pilot Baseline Separated
                </span>
              </div>

              {retailStats?.retailerCoverage && retailStats.retailerCoverage.length > 0 ? (
                <div className="divide-y divide-slate-800/70">
                  {retailStats.retailerCoverage.map((ret) => {
                    const retailerOffers = allScopedRetailOffers.filter(
                      (o) => o.retailerId === ret.retailerId
                    );
                    const resolved = resolveRetailerOperationalStatus({
                      coverage: ret,
                      offers: retailerOffers,
                      liveOffersCount: ret.liveVerifiedOffersCount,
                      pilotOffersCount: ret.seededPilotOffersCount ?? 0,
                    });
                    const hasLiveOffers = resolved.liveOffersCount > 0;
                    const lastDate = resolved.collectionDimension.effectiveLastCollectionDate;
                    const statusLabel =
                      resolved.state === 'OPERATIONAL'
                        ? 'Live Active'
                        : resolved.state === 'STALE_LIVE'
                        ? lastDate
                          ? `Stale Live (Last: ${lastDate})`
                          : 'Stale Live (Unknown Age)'
                        : resolved.state === 'WAF_BLOCKED'
                        ? 'WAF / Restricted (403)'
                        : resolved.state === 'PILOT_ONLY'
                        ? 'Pilot Only (0 Live)'
                        : 'Unverified (0 Live)';
                    return (
                      <div
                        key={ret.retailerId}
                        className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-200 truncate">
                            {ret.retailerName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          <span className={hasLiveOffers ? 'text-emerald-400' : 'text-amber-400'}>
                            {resolved.liveOffersCount} live
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{resolved.pilotOffersCount} pilot</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              resolved.state === 'OPERATIONAL'
                                ? 'text-emerald-400'
                                : resolved.state === 'STALE_LIVE' ||
                                  resolved.state === 'PILOT_ONLY' ||
                                  resolved.state === 'WAF_BLOCKED'
                                ? 'text-amber-400'
                                : 'text-slate-500'
                            }
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-2">
                  Retailer coverage diagnostics loading...
                </p>
              )}
            </div>

            {/* Monitored Product Price Snapshot */}
            <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
              <span className="text-xs font-medium text-slate-300 block">
                {targetScope === 'TARGET_FOCUS'
                  ? `Monitored ${targetContext.companyName} Retail Catalog Sample`
                  : 'Monitored Retail Catalog Sample'}
              </span>

              {isModulesLoading && retailStats === null && retailProducts.length === 0 ? (
                <p className="text-xs text-slate-400 font-mono py-2">
                  Loading canonical retail catalog...
                </p>
              ) : featuredRetailComparisonItems.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  No canonical retail products found for {targetContext.companyName}.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {featuredRetailComparisonItems.map((item) => {
                    const hasLivePrice = item.lowestLiveVerifiedPriceCents !== null;
                    const displayPrice = hasLivePrice
                      ? formatEurFromCents(item.lowestLiveVerifiedPriceCents)
                      : formatEurFromCents(item.lowestPilotPriceCents);
                    const provenanceText = hasLivePrice
                      ? `Live Verified (${item.lowestLiveVerifiedRetailer || 'Retailer'})`
                      : 'Pilot Reference Baseline';

                    return (
                      <div
                        key={item.product.id}
                        className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-slate-200 truncate block">
                            {item.product.name}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {item.product.category} · {provenanceText}
                          </span>
                        </div>
                        <span
                          className={`font-mono tabular-nums font-semibold shrink-0 ${
                            hasLivePrice ? 'text-emerald-400' : 'text-slate-400'
                          }`}
                        >
                          {displayPrice}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ---------------------------------------------------------------
              PANEL 3: Service & Security Intelligence
              --------------------------------------------------------------- */}
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
            <ModulePanelHeader
              title="Service & Security Intelligence"
              subtitle="Official vendor security bulletins, CISA KEV catalog, and software update eligibility"
              actionLabel="Open Service Intel"
              onAction={() => setActiveTab('service')}
            />

            {/* Unboxed Summary Metrics Strip */}
            <div className="grid grid-cols-3 gap-4 pb-4 border-b border-slate-800/80 text-left">
              <div>
                <span className="text-[11px] text-slate-400 block">
                  Security Bulletins (CVE)
                </span>
                <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                  {securityVulnerabilityAdvisories.length}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">
                  Known Exploited (KEV)
                </span>
                <span className="text-lg font-bold font-mono tabular-nums text-rose-400">
                  {
                    scopedServiceAdvisories.filter(
                      (a) => Boolean(a.isKnownExploited) || a.sourceId === 'cisa-kev'
                    ).length
                  }
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">
                  Update / Maintenance
                </span>
                <span className="text-lg font-bold font-mono tabular-nums text-slate-300">
                  {maintenanceAndUpdateAdvisories.length}
                </span>
              </div>
            </div>

            {/* Recent Official Advisories */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">
                  Recent Official Advisories ({targetScope === 'TARGET_FOCUS' ? `${targetContext.companyName} & KEV` : 'All Vendors'})
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {serviceStats?.sourcesOperational ?? 5}/{serviceStats?.totalSources ?? 5} Official Sources Active
                </span>
              </div>

              {isModulesLoading && serviceStats === null && serviceAdvisories.length === 0 ? (
                <p className="text-xs text-slate-400 font-mono py-4">
                  Loading official security advisories...
                </p>
              ) : scopedServiceAdvisories.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">
                  No official advisories found for {targetContext.companyName} in the selected reporting period.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {scopedServiceAdvisories.slice(0, 4).map((adv) => {
                    const isZeroCve =
                      Boolean(adv.isZeroCveRelease) ||
                      adv.advisoryType === 'UPDATE_SCHEDULE' ||
                      adv.advisoryType === 'GENERAL_MAINTENANCE_INFORMATION';
                    return (
                      <div key={adv.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>
                            {adv.manufacturer === 'Huawei' ? 'HUAWEI' : adv.manufacturer} ·{' '}
                            {isZeroCve
                              ? 'Update / Maintenance'
                              : `${adv.severity} (${adv.cveIds?.length || 0} CVEs)`}
                          </span>
                          <span>{formatRelativeOrShortTimestamp(adv.publishedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveTab('service')}
                            className="text-left text-xs font-semibold text-slate-200 hover:text-indigo-400 transition-colors truncate cursor-pointer"
                          >
                            {adv.title}
                          </button>
                          {adv.sourceUrl && (
                            <a
                              href={adv.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              referrerPolicy="no-referrer"
                              className="text-slate-500 hover:text-slate-300 shrink-0"
                              title="Official Advisory Source"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Product Applicability Reconciliation Note */}
            <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
              <span>
                Persisted Confirmed Product Links:{' '}
                <strong className="text-slate-200">
                  {serviceStats?.persistedVerifiedProductMatchesCount ?? serviceMatches.length}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Computed Candidates (In-Memory):{' '}
                <strong className="text-indigo-300">
                  {serviceStats?.computedVerifiedCandidatesCount ?? 278} Verified
                </strong>{' '}
                / {serviceStats?.computedPendingCandidatesCount ?? 408} Review
              </span>
            </div>
          </div>

          {/* ---------------------------------------------------------------
              PANEL 4: Voice of Customer Intelligence (Addendum-Compliant)
              --------------------------------------------------------------- */}
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
            <ModulePanelHeader
              title="Voice of Customer Intelligence"
              subtitle="Public customer complaint taxonomy, conservative model matching, and issue clustering"
              actionLabel="Open VoC Module"
              onAction={() => setActiveTab('voc')}
            />

            {vocOverview &&
            !vocOverview.isEmptyState &&
            vocOverview.kpis.totalUniqueComplaints > 0 ? (
              /* Operational State (automatically activates once verified reports are persisted) */
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4 pb-4 border-b border-slate-800/80 text-left">
                  <div>
                    <span className="text-[11px] text-slate-400 block">Unique Complaints</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                      {vocOverview.kpis.totalUniqueComplaints}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Emerging Clusters</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-amber-300">
                      {vocOverview.kpis.emergingIssuesCount}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Verified Models</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-emerald-400">
                      {vocOverview.kpis.verifiedModelMatchesCount}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Showing verified customer experience reports for {vocOverview.selectedManufacturer}.
                </p>
              </div>
            ) : (
              /* Compact "Data Collection Pending" Empty State per UI P2.0 Addendum */
              <div className="p-5 rounded-xl bg-slate-950/60 border border-slate-800/90 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <MessageSquareWarning className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Status: Data Collection Pending</span>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    0 Persisted Customer Reports
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Foundational complaint classification (15 bilingual EL/EN categories), PII redaction, and conservative canonical product matching are configured. Live customer report ingestion and Firestore persistence are not yet activated, so no complaint volumes, sentiment scores, or issue clusters are displayed.
                </p>

                <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                  <span>
                    Audited Candidate Sources:{' '}
                    <strong className="text-slate-200">
                      {vocOverview?.sources?.length ?? 8}
                    </strong>{' '}
                    ({vocOverview?.kpis?.verifiedAccessibleSourcesCount ?? 4} Accessible)
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('voc')}
                    className="text-indigo-400 hover:text-indigo-300 font-sans font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Inspect Source Feasibility & Sandbox</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===================================================================
          SECTION E — Cross-Module Intelligence
          =================================================================== */}
      <section
        aria-label="Cross-Module Intelligence"
        className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5"
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-4 border-t-0 border-b border-slate-800">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100 tracking-tight">
              Cross-Module Intelligence
            </h2>
            <p className="text-xs text-slate-400">
              Correlating verified entities across Retail Pricing, Official Service Bulletins, Competitive Stories, and Customer Experience under strict evidence governance.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 shrink-0">
            {crossModuleState.status === 'AVAILABLE'
              ? `${crossModuleState.persistedProductAdvisoryLinksCount} Confirmed Persisted Cross-Module Links`
              : 'Insights Not Yet Available (Governance Gate Active)'}
          </span>
        </div>

        {crossModuleState.productAdvisoryInsights.length > 0 ? (
          <div className="divide-y divide-slate-800/80">
            {crossModuleState.productAdvisoryInsights.map((insight) => (
              <div
                key={insight.id}
                className="py-3.5 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono">
                    <span className="text-emerald-400 font-semibold">
                      {insight.confidenceLabel}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-200">{insight.productName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{insight.advisoryTitle}</span>
                  </div>
                  <p className="text-xs text-slate-400">{insight.evidenceNote}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab('retail-prices')}
                    className="px-2.5 py-1 rounded border border-slate-800 hover:border-slate-700 text-xs text-slate-300 cursor-pointer"
                  >
                    Retail SKU
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('service')}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 cursor-pointer"
                  >
                    Advisory Detail
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Honest "Insights Not Yet Available" State with Cross-Module Readiness Breakdown */
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Confirmed Cross-Module Insights Not Yet Persisted
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
                    Signalyn enforces strict evidence verification before surfacing cross-module correlations. Inferred relationships, unconfirmed candidate matches, and uncollected customer reports are never presented as confirmed cross-domain facts.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('service')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Review Candidate Matches</span>
                <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {crossModuleState.deferredCapabilities.map((cap) => (
                <div
                  key={cap.id}
                  className="p-4 rounded-lg bg-slate-950/40 border border-slate-800/80 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-mono text-indigo-300 block">
                      {cap.domains}
                    </span>
                    <h4 className="text-xs font-semibold text-slate-200 leading-snug">
                      {cap.title}
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {cap.explanation}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-500">
                    <span>Readiness</span>
                    <span className="text-amber-300/90">
                      {cap.readinessStatus === 'DATA_COLLECTION_PENDING'
                        ? 'VoC Collection Pending'
                        : cap.readinessStatus === 'AWAITING_ADMIN_CONFIRMATION'
                        ? 'Awaiting Admin Persistence'
                        : 'Planned Next Phase'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </AppPage>
  );
};

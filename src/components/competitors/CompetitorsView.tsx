import React, { useMemo, useState } from 'react';
import {
  ShieldAlert,
  Smartphone,
  Watch,
  Tablet,
  Headphones,
  Laptop,
  CheckCircle2,
  ExternalLink,
  SlidersHorizontal,
  Info,
  Layers,
  Globe,
  MapPin,
  Check,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
} from '../../services/canonicalEntities';
import {
  getPrimaryCompany,
  getGlobalTrackedCompetitors,
  getRelevantCompetitors,
  STANDARD_CATEGORIES,
} from '../../services/competitorSelectors';
import { matchesLifecycleFilter } from '../../services/productAuditRegistry';
import { CompetitorScope, MarketFilterOption, ProductLifecycleFilter } from '../../types';
import {
  AppPage,
  PageHeader,
  SemanticBadge,
  Button,
} from '../common/DesignSystem';

export const CompetitorsView: React.FC = () => {
  const { companies, settings, products, setActiveTab, canManage } = useApp();

  const [activeCategory, setActiveCategory] = useState<string>('Smartphones');
  const [scope, setScope] = useState<CompetitorScope>(() => {
    try {
      const stored = localStorage.getItem('signalyn_matrix_competitor_scope');
      return stored === 'SELECTED_ONLY' ? 'SELECTED_ONLY' : 'ALL_RELEVANT';
    } catch {
      return 'ALL_RELEVANT';
    }
  });
  const [market, setMarket] = useState<MarketFilterOption>(() => {
    try {
      const stored = localStorage.getItem('signalyn_matrix_market_filter');
      return stored === 'GR' ? 'GR' : 'GLOBAL';
    } catch {
      return 'GLOBAL';
    }
  });
  const [lifecycleFilter, setLifecycleFilter] = useState<ProductLifecycleFilter>(() => {
    try {
      const stored = localStorage.getItem('signalyn_matrix_lifecycle_filter');
      return (stored === 'VERIFIED_ACTIVE' || stored === 'RUMORED_OR_UNVERIFIED') ? stored : 'ALL';
    } catch {
      return 'ALL';
    }
  });

  const categories = STANDARD_CATEGORIES;

  const handleScopeChange = (newScope: CompetitorScope) => {
    setScope(newScope);
    try {
      localStorage.setItem('signalyn_matrix_competitor_scope', newScope);
    } catch {
      // ignore storage error
    }
  };

  const handleMarketChange = (newMarket: MarketFilterOption) => {
    setMarket(newMarket);
    try {
      localStorage.setItem('signalyn_matrix_market_filter', newMarket);
    } catch {
      // ignore storage error
    }
  };

  const handleLifecycleChange = (newFilter: ProductLifecycleFilter) => {
    setLifecycleFilter(newFilter);
    try {
      localStorage.setItem('signalyn_matrix_lifecycle_filter', newFilter);
    } catch {
      // ignore storage error
    }
  };

  // Combined company list (Firestore + Static Canonical Registry)
  const allCompanies = useMemo(() => {
    return getMergedCanonicalCompanies(companies);
  }, [companies]);

  // Combined product catalog (Firestore + Canonical Catalog)
  const allProducts = useMemo(() => {
    return getMergedCanonicalProducts(products);
  }, [products]);

  const primaryCompany = useMemo(
    () => getPrimaryCompany(companies, settings),
    [companies, settings]
  );

  const allCompetitors = useMemo(
    () => getGlobalTrackedCompetitors(companies, settings),
    [companies, settings]
  );

  // Discovery engine evaluated competitors for this category, scope, and market
  const discoveredCompetitors = useMemo(() => {
    return getRelevantCompetitors(
      activeCategory,
      scope,
      market,
      companies,
      products,
      settings
    );
  }, [activeCategory, scope, market, companies, products, settings]);

  // Also calculate total relevant vs selected counts for the banner/metrics
  const totalRelevantCount = useMemo(() => {
    return getRelevantCompetitors(
      activeCategory,
      'ALL_RELEVANT',
      'GLOBAL',
      companies,
      products,
      settings
    ).length;
  }, [activeCategory, companies, products, settings]);

  const totalSelectedCount = useMemo(() => {
    return getRelevantCompetitors(
      activeCategory,
      'SELECTED_ONLY',
      'GLOBAL',
      companies,
      products,
      settings
    ).length;
  }, [activeCategory, companies, products, settings]);

  const primaryProducts = allProducts.filter(
    (p) => p.companyId === primaryCompany?.id && p.category.toLowerCase() === activeCategory.toLowerCase()
  );

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Competitive Intelligence Matrix"
        badges={
          <>
            <SemanticBadge variant="info" label={`Primary: ${primaryCompany?.name || 'HUAWEI'}`} />
            <SemanticBadge variant="neutral" label={`${allCompetitors.length} Global Rivals`} />
          </>
        }
        description="Category-segmented competitive matrix with market-grounded availability and dynamic discovery."
        actions={
          canManage ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setActiveTab('settings')}
              leftIcon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            >
              Configure Sets in Settings
            </Button>
          ) : undefined
        }
      />

      {/* Scope, Market & Lifecycle Controls Bar */}
      <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Competitor Scope Segmented Control */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Scope:</span>
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs font-medium">
            <button
              onClick={() => handleScopeChange('ALL_RELEVANT')}
              className={`px-3 py-1 rounded-md transition ${
                scope === 'ALL_RELEVANT'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Relevant ({totalRelevantCount})
            </button>
            <button
              onClick={() => handleScopeChange('SELECTED_ONLY')}
              className={`px-3 py-1 rounded-md transition ${
                scope === 'SELECTED_ONLY'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Selected Only ({totalSelectedCount})
            </button>
          </div>
        </div>

        {/* Center: Lifecycle Filter Segmented Control */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Lifecycle:</span>
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs font-medium">
            <button
              onClick={() => handleLifecycleChange('ALL')}
              className={`px-2.5 py-1 rounded-md transition ${
                lifecycleFilter === 'ALL'
                  ? 'bg-slate-800 text-slate-100 font-semibold border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Models
            </button>
            <button
              onClick={() => handleLifecycleChange('VERIFIED_ACTIVE')}
              className={`px-2.5 py-1 rounded-md transition ${
                lifecycleFilter === 'VERIFIED_ACTIVE'
                  ? 'bg-emerald-950/80 text-emerald-300 font-semibold border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Verified Active
            </button>
            <button
              onClick={() => handleLifecycleChange('RUMORED_OR_UNVERIFIED')}
              className={`px-2.5 py-1 rounded-md transition ${
                lifecycleFilter === 'RUMORED_OR_UNVERIFIED'
                  ? 'bg-purple-950/80 text-purple-300 font-semibold border border-purple-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Rumored / Leaks
            </button>
          </div>
        </div>

        {/* Right: Market Filter Segmented Control */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Market:</span>
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs font-medium">
            <button
              onClick={() => handleMarketChange('GLOBAL')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition ${
                market === 'GLOBAL'
                  ? 'bg-slate-800 text-indigo-300 font-semibold border border-indigo-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3 h-3" />
              Global
            </button>
            <button
              onClick={() => handleMarketChange('GR')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition ${
                market === 'GR'
                  ? 'bg-slate-800 text-amber-300 font-semibold border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MapPin className="w-3 h-3 text-amber-400" />
              Greece (GR)
            </button>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 border-b border-slate-800">
        {categories.map((cat) => {
          const isActive = activeCategory === cat;
          const relevantInCat = getRelevantCompetitors(
            cat,
            scope,
            market,
            companies,
            products,
            settings
          ).length;

          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-t-lg text-xs font-semibold flex items-center gap-2 transition ${
                isActive
                  ? 'bg-slate-900 text-indigo-400 border-t-2 border-indigo-500 border-x border-slate-800'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
            >
              <span>{cat}</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-500'
                }`}
              >
                {relevantInCat} Rivals
              </span>
            </button>
          );
        })}
      </div>

      {/* Scope & Market Context Explanation Banner */}
      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>
            Showing <strong className="text-slate-200">{discoveredCompetitors.length}</strong> {scope === 'ALL_RELEVANT' ? 'relevant' : 'designated'} rivals in <strong className="text-indigo-300">{activeCategory}</strong> ({market === 'GR' ? 'Greek Market View' : 'Global Market'}).
            {lifecycleFilter !== 'ALL' && (
              <span className="text-emerald-400/90 ml-1">
                Lifecycle filter: {lifecycleFilter === 'VERIFIED_ACTIVE' ? 'Verified Active (Commercial & Announced)' : 'Rumored & Speculative Leaks'}.
              </span>
            )}
            {scope === 'ALL_RELEVANT' && (
              <span className="text-slate-400 ml-1">
                Derived from verified hardware catalog and category domain evidence.
              </span>
            )}
            {market === 'GR' && (
              <span className="text-amber-400/90 ml-1 block sm:inline">
                Verified channel presence distinguished from unverified status.
              </span>
            )}
          </span>
        </div>
        <button
          onClick={() => setActiveTab('companies')}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium shrink-0 self-start sm:self-auto"
        >
          View All {allCompanies.length} Tracked Companies →
        </button>
      </div>

      {/* Primary Reference Card */}
      <div className="p-5 rounded-xl bg-indigo-950/20 border border-indigo-500/40 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center font-bold text-indigo-200 text-sm">
              {primaryCompany?.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-indigo-400 font-semibold tracking-wider">
                Primary Reference Target
              </span>
              <h2 className="text-base font-bold text-slate-100">{primaryCompany?.name}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {market === 'GR' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Check className="w-3 h-3" /> Official GR Distribution
              </span>
            )}
            <span className="text-xs text-indigo-300 font-mono bg-indigo-900/40 px-2.5 py-1 rounded-md border border-indigo-800/60">
              {activeCategory} Domain
            </span>
          </div>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-indigo-800/30">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-300">
              {primaryCompany?.name} Products in {activeCategory} ({primaryProducts.filter((p) => matchesLifecycleFilter(p.lifecycle, lifecycleFilter)).length} shown / {primaryProducts.length} total):
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {primaryProducts.filter((p) => matchesLifecycleFilter(p.lifecycle, lifecycleFilter)).length === 0 ? (
              <span className="text-xs text-slate-400 italic">No products matching current lifecycle filter in this domain.</span>
            ) : (
              primaryProducts
                .filter((p) => matchesLifecycleFilter(p.lifecycle, lifecycleFilter))
                .map((p) => (
                  <div
                    key={p.id}
                    title={p.evidenceRationale}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-slate-200 text-xs font-mono border border-slate-700/80 flex items-center gap-2"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        p.lifecycle === 'RELEASED'
                          ? 'bg-emerald-400'
                          : p.lifecycle === 'ANNOUNCED'
                          ? 'bg-blue-400'
                          : 'bg-purple-400'
                      }`}
                    />
                    <span className="font-medium">{p.name}</span>
                    {p.subcategory && (
                      <span className="text-[10px] text-slate-400">({p.subcategory})</span>
                    )}
                    {p.lifecycle && (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold border ${
                          p.lifecycle === 'RELEASED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : p.lifecycle === 'ANNOUNCED'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                            : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                        }`}
                      >
                        {p.lifecycle}
                      </span>
                    )}
                    {p.entryType && p.entryType !== 'INDIVIDUAL_MODEL' && (
                      <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                        {p.entryType === 'PRODUCT_FAMILY' ? 'Family' : 'Series'}
                      </span>
                    )}
                    {p.evidenceUrl && (
                      <a
                        href={p.evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 ml-0.5"
                        title="Official Portal Verification"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Competitors in this Category */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              {scope === 'ALL_RELEVANT' ? 'All Relevant Competitors' : 'Selected Competitors'} in {activeCategory} ({discoveredCompetitors.length})
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
              {scope === 'ALL_RELEVANT' ? 'Automated Discovery' : 'Configured in Settings'}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            {market === 'GR' ? 'Market: Greece (GR)' : 'Market: Global'}
          </span>
        </div>

        {discoveredCompetitors.length === 0 ? (
          <div className="p-8 rounded-xl bg-slate-900/50 border border-slate-800 text-center space-y-2">
            <p className="text-sm font-medium text-slate-300">No competitors found for this selection.</p>
            <p className="text-xs text-slate-500">
              {scope === 'SELECTED_ONLY'
                ? `No competitors are currently configured for ${activeCategory} in Settings.`
                : `No competitors match the active filters for ${activeCategory}.`}
            </p>
            {scope === 'SELECTED_ONLY' && (
              <button
                onClick={() => handleScopeChange('ALL_RELEVANT')}
                className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 underline font-medium"
              >
                Switch to All Relevant Competitors ({totalRelevantCount})
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {discoveredCompetitors.map(({ company: comp, isSelectedInSettings, marketStatus, marketEvidence, relevanceReasons }) => {
              const allCompCategoryProducts = allProducts.filter(
                (p) => p.companyId === comp.id && p.category.toLowerCase() === activeCategory.toLowerCase()
              );
              const compProducts = allCompCategoryProducts.filter((p) =>
                matchesLifecycleFilter(p.lifecycle, lifecycleFilter)
              );

              return (
                <div
                  key={comp.id}
                  className={`p-4 rounded-xl bg-slate-900 border transition space-y-3 ${
                    isSelectedInSettings
                      ? 'border-indigo-500/40 hover:border-indigo-400/60'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-bold text-slate-100 text-sm">{comp.name}</h4>
                        {isSelectedInSettings && (
                          <span
                            title="Selected in Settings comparison set"
                            className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                          >
                            SELECTED
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">{comp.hqCountry}</span>
                    </div>

                    <div className="text-right space-y-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 block">
                        {compProducts.length}
                        {lifecycleFilter !== 'ALL' && ` / ${allCompCategoryProducts.length}`} Models
                      </span>
                    </div>
                  </div>

                  {/* Market Availability Status (especially prominent when Greece is selected) */}
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-slate-500">
                        {market === 'GR' ? 'Greek Market Status:' : 'Market Presence:'}
                      </span>
                      {marketStatus === 'OFFICIAL' && (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Official Distribution
                        </span>
                      )}
                      {marketStatus === 'RETAIL_CONFIRMED' && (
                        <span className="text-amber-400 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Confirmed Retail
                        </span>
                      )}
                      {marketStatus === 'UNKNOWN' && (
                        <span className="text-slate-400 italic flex items-center gap-1">
                          <HelpCircle className="w-3 h-3 text-slate-500" /> Market not verified
                        </span>
                      )}
                      {marketStatus === 'UNAVAILABLE' && (
                        <span className="text-rose-400 font-semibold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Confirmed Unavailable
                        </span>
                      )}
                    </div>

                    {market === 'GR' && marketEvidence?.details && (
                      <p className="text-[10px] text-slate-400 line-clamp-2">
                        {marketEvidence.details}
                      </p>
                    )}
                  </div>

                  {/* Inclusion / Relevance Reason */}
                  {relevanceReasons.length > 0 && (
                    <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                      <span>Evidence:</span>
                      <span className="text-slate-400 truncate">{relevanceReasons.join(' • ')}</span>
                    </div>
                  )}

                  {/* Product Catalog list */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block">
                      Catalog Models in {activeCategory} ({compProducts.length})
                    </span>
                    {compProducts.length === 0 ? (
                      <span className="text-[11px] text-slate-500 italic">No models match the active lifecycle filter</span>
                    ) : (
                      <div className="space-y-1.5">
                        {compProducts.map((p) => (
                          <div
                            key={p.id}
                            title={p.evidenceRationale}
                            className="p-2 rounded-lg bg-slate-950 border border-slate-800/80 text-xs text-slate-300 font-mono flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  p.lifecycle === 'RELEASED'
                                    ? 'bg-emerald-400'
                                    : p.lifecycle === 'ANNOUNCED'
                                    ? 'bg-blue-400'
                                    : 'bg-purple-400'
                                }`}
                              />
                              <span className="truncate font-medium text-slate-200">{p.name}</span>
                              {p.subcategory && (
                                <span className="text-[10px] text-slate-500 shrink-0 hidden sm:inline">({p.subcategory})</span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {p.lifecycle && (
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold border ${
                                    p.lifecycle === 'RELEASED'
                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                      : p.lifecycle === 'ANNOUNCED'
                                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                      : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                                  }`}
                                >
                                  {p.lifecycle}
                                </span>
                              )}
                              {p.entryType && p.entryType !== 'INDIVIDUAL_MODEL' && (
                                <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                                  {p.entryType === 'PRODUCT_FAMILY' ? 'Family' : 'Series'}
                                </span>
                              )}
                              {market === 'GR' && p.greekMarketAvailability?.status === 'OFFICIAL' && (
                                <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="Official Greek Distribution">
                                  GR
                                </span>
                              )}
                              {market === 'GR' && p.greekMarketAvailability?.status === 'RETAIL_CONFIRMED' && (
                                <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20" title="Retail Confirmed in GR">
                                  GR Retail
                                </span>
                              )}
                              {p.evidenceUrl && (
                                <a
                                  href={p.evidenceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-indigo-400 hover:text-indigo-300"
                                  title="Official Portal Verification"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppPage>
  );
};


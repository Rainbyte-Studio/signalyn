import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Smartphone,
  Search,
  Tag,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  Layers,
  Info,
  Globe,
  Calendar,
  ChevronDown,
  ChevronUp,
  Database,
  RotateCcw,
} from 'lucide-react';
import {
  getMergedCanonicalProducts,
  getMergedCanonicalCompanies,
} from '../../services/canonicalEntities';
import {
  matchesLifecycleFilter,
  getProductCatalogStatistics,
  validateProductCatalogIntegrity,
  getProductMarketEvidence,
} from '../../services/productAuditRegistry';
import {
  ProductLifecycleFilter,
  ProductEntryType,
  ProductLifecycleStatus,
} from '../../types';
import {
  AppPage,
  PageHeader,
  EmptyStateCard,
  SemanticBadge,
} from '../common/DesignSystem';
import {
  normalizeCatalogCategoryDisplay,
  ensureFiniteCount,
} from '../../utils/dataIntegrityContracts';

export const ProductsView: React.FC = () => {
  const { products, companies } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [lifecycleFilter, setLifecycleFilter] = useState<ProductLifecycleFilter>('ALL');
  const [entryTypeFilter, setEntryTypeFilter] = useState<string>('ALL');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState<boolean>(false);

  const allProducts = useMemo(() => getMergedCanonicalProducts(products), [products]);
  const allCompanies = useMemo(() => getMergedCanonicalCompanies(companies), [companies]);

  const stats = useMemo(() => getProductCatalogStatistics(allProducts), [allProducts]);
  const integrityReport = useMemo(() => validateProductCatalogIntegrity(allProducts), [allProducts]);

  const getCompanyName = (companyId: string) => {
    const found = allCompanies.find((c) => c.id === companyId);
    return found ? found.name : companyId;
  };

  const categories = useMemo(
    () =>
      Array.from(
        new Set(allProducts.map((p) => normalizeCatalogCategoryDisplay(p.category)))
      ),
    [allProducts]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allProducts.filter((p) => {
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.aliases.some((a) => a.toLowerCase().includes(q));
      const matchesCompany = companyFilter === 'ALL' || p.companyId === companyFilter;
      const matchesCat =
        categoryFilter === 'ALL' ||
        normalizeCatalogCategoryDisplay(p.category) ===
          normalizeCatalogCategoryDisplay(categoryFilter);
      const matchesLife = matchesLifecycleFilter(p.lifecycle, lifecycleFilter);
      const matchesEntry = entryTypeFilter === 'ALL' || p.entryType === entryTypeFilter;
      return matchesSearch && matchesCompany && matchesCat && matchesLife && matchesEntry;
    });
  }, [allProducts, searchQuery, companyFilter, categoryFilter, lifecycleFilter, entryTypeFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    companyFilter !== 'ALL' ||
    categoryFilter !== 'ALL' ||
    lifecycleFilter !== 'ALL' ||
    entryTypeFilter !== 'ALL';

  const handleClearFilters = () => {
    setSearchQuery('');
    setCompanyFilter('ALL');
    setCategoryFilter('ALL');
    setLifecycleFilter('ALL');
    setEntryTypeFilter('ALL');
  };

  const toggleCardExpanded = (productId: string) => {
    setExpandedCards((prev) => ({ ...prev, [productId]: !prev[productId] }));
  };

  const renderLifecycleBadge = (lifecycle?: ProductLifecycleStatus) => {
    const status = lifecycle || 'UNKNOWN';
    switch (status) {
      case 'RELEASED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" />
            RELEASED
          </span>
        );
      case 'ANNOUNCED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
            <Info className="w-3 h-3" />
            ANNOUNCED
          </span>
        );
      case 'RUMORED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            RUMORED / LEAK
          </span>
        );
      case 'PROTOTYPE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
            PROTOTYPE
          </span>
        );
      case 'DISCONTINUED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            DISCONTINUED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            UNVERIFIED
          </span>
        );
    }
  };

  const renderEntryTypeBadge = (entryType?: ProductEntryType) => {
    switch (entryType) {
      case 'INDIVIDUAL_MODEL':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
            Model
          </span>
        );
      case 'PRODUCT_SERIES':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            Series
          </span>
        );
      case 'PRODUCT_FAMILY':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20">
            Family
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <AppPage>
      {/* Header */}
      <PageHeader
        badge="Strategic Hardware & Entity Recognition Catalog"
        title="Product Catalog & Aliases"
        subtitle={`Tracking ${allProducts.length} canonical hardware models, series, and families across ${categories.length} strategic domains with grounded lifecycle provenance and Greek market availability.`}
        actions={
          <button
            onClick={() => setExpandAll((prev) => !prev)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {expandAll ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                <span>Collapse All Evidence & Aliases</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                <span>Expand All Evidence & Aliases</span>
              </>
            )}
          </button>
        }
      />

      {/* C1 & C6: Dataset Scope Distinction & Catalog Integrity Bar */}
      <div className="px-4 py-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-2.5 text-slate-300">
          <Database className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5 sm:mt-0" />
          <div className="leading-relaxed">
            <strong className="text-white">Dataset Scope Distinction:</strong> This catalog tracks{' '}
            <strong className="text-indigo-300">{allProducts.length} Strategic Hardware Models, Series & Families</strong>{' '}
            (including <strong className="text-emerald-400">{stats.verifiedActive} Verified Active</strong> commercial lines and{' '}
            <strong className="text-amber-400">{stats.rumoredOrUnverified} Rumored / Roadmap</strong> entities) used for NLP entity recognition and competitive intelligence. Individual storage/color retail SKUs (<strong className="text-slate-200">326 retail SKUs</strong>) are managed separately in{' '}
            <span className="font-mono text-indigo-300">Retail Price Intelligence</span>.
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <SemanticBadge variant={integrityReport.isValid ? 'verified' : 'error'}>
            {integrityReport.isValid
              ? `Catalog Integrity: ${integrityReport.auditedProductsCount}/${integrityReport.totalProducts} Audited`
              : `${integrityReport.auditedProductsCount}/${integrityReport.totalProducts} Audited • ${integrityReport.issues.length} Integrity Issues`}
          </SemanticBadge>
        </div>
      </div>

      {/* C2: Audit Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase text-[11px]">Verified Active</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white tabular-nums">
            {ensureFiniteCount(stats.verifiedActive)}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
            <strong className="text-emerald-400">{ensureFiniteCount(stats.released)}</strong> Released •{' '}
            <strong className="text-sky-400">{ensureFiniteCount(stats.announced)}</strong> Announced
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase text-[11px]">Speculative / Rumored</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 tabular-nums">
            {ensureFiniteCount(stats.rumoredOrUnverified)}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
            Unannounced supply-chain & roadmap signals
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase text-[11px]">Catalog Architecture</span>
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white tabular-nums">
            {ensureFiniteCount(stats.individualModels)}{' '}
            <span className="text-xs font-normal text-slate-400 font-mono">Models</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
            +{ensureFiniteCount(stats.productSeries)} Series • +
            {ensureFiniteCount(stats.productFamilies)} Families
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase text-[11px]">Greek Market Audit</span>
            <Globe className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 tabular-nums">
            {ensureFiniteCount(
              stats.confirmedGreekMarketTotal ??
                ensureFiniteCount(stats.greekMarketOfficial) +
                  ensureFiniteCount(stats.greekMarketRetailConfirmed)
            )}{' '}
            <span className="text-xs font-normal text-slate-400 font-mono">Confirmed GR</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
            {ensureFiniteCount(stats.greekMarketOfficial)} Official •{' '}
            {ensureFiniteCount(stats.greekMarketRetailConfirmed)} Retail •{' '}
            {ensureFiniteCount(stats.greekMarketUnknown)} Unverified
          </div>
        </div>
      </div>

      {/* C6: Actionable Integrity Alert Banner if Violations Detected */}
      {!integrityReport.isValid && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-xs text-rose-300 space-y-1.5">
          <div className="font-semibold flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                Catalog Integrity Audit Issues Detected ({integrityReport.issues.length} issue
                {integrityReport.issues.length === 1 ? '' : 's'} across{' '}
                {integrityReport.totalProducts - integrityReport.auditedProductsCount} unaudited
                entry)
              </span>
            </div>
            <span className="font-mono text-[11px] text-rose-300/90">
              {integrityReport.auditedProductsCount}/{integrityReport.totalProducts} Audited
            </span>
          </div>
          <ul className="list-disc list-inside text-[11px] text-rose-300/80 space-y-0.5 font-mono">
            {integrityReport.issues.map((issue, idx) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* C5: Combined Filter Bar & Live Result Count */}
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search model or alias..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            aria-label="Filter by Manufacturer"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Manufacturers ({allCompanies.length})</option>
            {allCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by Hardware Domain"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Hardware Domains ({categories.length})</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by Lifecycle Status"
            value={lifecycleFilter}
            onChange={(e) => setLifecycleFilter(e.target.value as ProductLifecycleFilter)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">Lifecycle: All ({stats.total})</option>
            <option value="VERIFIED_ACTIVE">Verified Active ({stats.verifiedActive})</option>
            <option value="RELEASED">Released Only ({stats.released})</option>
            <option value="ANNOUNCED">Announced Only ({stats.announced})</option>
            <option value="RUMORED_OR_UNVERIFIED">
              Rumored / Leaks ({stats.rumoredOrUnverified})
            </option>
          </select>

          <select
            aria-label="Filter by Entry Type"
            value={entryTypeFilter}
            onChange={(e) => setEntryTypeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">Entry Type: All ({ensureFiniteCount(stats.total)})</option>
            <option value="INDIVIDUAL_MODEL">
              Individual Models ({ensureFiniteCount(stats.individualModels)})
            </option>
            <option value="PRODUCT_SERIES">
              Product Series ({ensureFiniteCount(stats.productSeries)})
            </option>
            <option value="PRODUCT_FAMILY">
              Product Families ({ensureFiniteCount(stats.productFamilies)})
            </option>
          </select>
        </div>

        {/* Active Filter Status & Clear Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono text-slate-400">
          <div>
            Showing <strong className="text-white">{filtered.length}</strong> of{' '}
            <strong className="text-slate-200">{allProducts.length}</strong> strategic hardware entries
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 text-[11px] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3 text-indigo-400" />
              <span>Clear Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* C3: Compact Product Cards with Expandable Evidence & Aliases */}
      {filtered.length === 0 ? (
        <EmptyStateCard
          icon={<Smartphone className="w-6 h-6 text-slate-400" />}
          title="No products match the selected filters"
          description="Try clearing your search query or adjusting the Manufacturer, Hardware Domain, Lifecycle, or Entry Type filters."
          action={
            <button
              onClick={handleClearFilters}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors cursor-pointer"
            >
              Reset All Filters
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((prod) => {
            const compName = getCompanyName(prod.companyId);
            const isHuawei = prod.companyId === 'comp-huawei';
            const isRumored = prod.lifecycle === 'RUMORED';
            const grMarket =
              prod.greekMarketAvailability || getProductMarketEvidence(prod.id);

            const q = searchQuery.trim().toLowerCase();
            const matchedAlias =
              q.length > 0
                ? prod.aliases.find((a) => a.toLowerCase().includes(q))
                : undefined;

            const isDetailsExpanded =
              expandAll || Boolean(expandedCards[prod.id]) || Boolean(matchedAlias);

            return (
              <div
                key={prod.id}
                className={`bg-slate-900 rounded-xl border p-4 transition-all flex flex-col justify-between ${
                  isHuawei
                    ? 'border-rose-500/30 hover:border-rose-500/50'
                    : isRumored
                    ? 'border-amber-500/25 hover:border-amber-500/40'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Always-Visible Primary Product Information */}
                <div className="space-y-3">
                  {/* Top Row: Manufacturer + Category & Lifecycle Status Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`p-2 rounded-lg shrink-0 ${
                          isHuawei
                            ? 'bg-rose-500/10 text-rose-400'
                            : isRumored
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${
                              isHuawei
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {compName}
                          </span>
                          <span className="text-[11px] font-mono text-indigo-400 truncate">
                            {prod.category}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-100 text-sm mt-1 leading-snug">
                          {prod.name}
                        </h4>
                      </div>
                    </div>

                    <div className="shrink-0">{renderLifecycleBadge(prod.lifecycle)}</div>
                  </div>

                  {/* Secondary Always-Visible Metadata Grid: Product Type, Launch Info, Greek Market Status */}
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 font-mono text-[10px] uppercase">
                        Product Type:
                      </span>
                      <div className="flex items-center gap-1.5">
                        {renderEntryTypeBadge(prod.entryType)}
                        {prod.subcategory && (
                          <span className="text-[10px] font-mono text-slate-300">
                            • {prod.subcategory}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 font-mono text-[10px] uppercase">
                        Launch Status:
                      </span>
                      {prod.lifecycle === 'RELEASED' || prod.lifecycle === 'ANNOUNCED' ? (
                        <span className="font-mono text-slate-200 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-emerald-400" />
                          <span>
                            {prod.launchDate
                              ? `Verified: ${prod.launchDate}`
                              : 'Commercially Verified'}
                          </span>
                        </span>
                      ) : (
                        <span className="font-mono text-amber-300/90 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          <span>Unconfirmed Roadmap / Not Released</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 font-mono text-[10px] uppercase">
                        Greek Market:
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                          grMarket.status === 'OFFICIAL'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : grMarket.status === 'RETAIL_CONFIRMED'
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                            : grMarket.status === 'UNAVAILABLE'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}
                      >
                        {grMarket.status === 'OFFICIAL'
                          ? 'GR Official Distribution'
                          : grMarket.status === 'RETAIL_CONFIRMED'
                          ? 'GR Retail Confirmed'
                          : grMarket.status === 'UNAVAILABLE'
                          ? 'GR Unavailable'
                          : 'GR Unverified / Unknown'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expandable Details Footer & Drawer */}
                <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                  <button
                    onClick={() => toggleCardExpanded(prod.id)}
                    className="w-full flex items-center justify-between text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <Tag className="w-3 h-3 text-indigo-400" />
                      <span>
                        {isDetailsExpanded ? 'Hide' : 'Show'} Evidence, Source & Aliases (
                        {prod.aliases.length})
                      </span>
                    </span>
                    {isDetailsExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>

                  {isDetailsExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-800/70 space-y-2.5 text-xs">
                      {/* Evidence Summary & Official Source Link */}
                      <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800/90 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono uppercase text-slate-400">
                            {prod.evidenceType?.replace(/_/g, ' ') || 'AUDIT RATIONALE'}
                          </span>
                          {prod.evidenceUrl && (
                            <a
                              href={prod.evidenceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-400 hover:text-indigo-300 underline"
                            >
                              <span>Official Source</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        {prod.evidenceRationale && (
                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            {prod.evidenceRationale}
                          </p>
                        )}
                        {grMarket.details && (
                          <p className="text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-800/80">
                            GR Channel Note: {grMarket.details}
                          </p>
                        )}
                      </div>

                      {/* Recognition Aliases */}
                      <div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5 uppercase">
                          <span>Recognition Aliases ({prod.aliases.length})</span>
                          <span className="text-slate-400">ID: {prod.id}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {prod.aliases.map((alias, idx) => {
                            const isAliasMatch =
                              q.length > 0 && alias.toLowerCase().includes(q);
                            return (
                              <span
                                key={idx}
                                className={`text-[11px] px-2 py-0.5 rounded font-mono border ${
                                  isAliasMatch
                                    ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40 font-bold'
                                    : 'bg-slate-950 text-slate-300 border-slate-800'
                                }`}
                              >
                                {alias}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppPage>
  );
};

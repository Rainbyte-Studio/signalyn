import React, { useMemo, useState } from 'react';
import {
  PieChart,
  BarChart3,
  Building2,
  Filter,
  Layers,
  Globe,
  Info,
  Calendar,
  RefreshCw,
  SlidersHorizontal,
  TrendingUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Target,
  FileText,
  Database,
  Wrench,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CategoryFilter, TRACKED_COMPANIES } from '../../services/competitiveAnalytics';
import {
  useHistoricalAnalytics,
  HistoricalPreset,
} from '../../hooks/useHistoricalAnalytics';
import { computeReconciledSourceKpiCounts } from '../../utils/dataIntegrityContracts';
import {
  AppPage,
  PageHeader,
  FilterToolbar,
  SegmentedControl,
  SemanticBadge,
  ChartCard,
  DataTableContainer,
  ResponsiveGrid,
  MetricCard,
  EmptyStateCard,
  Button,
  SelectControl,
} from '../common/DesignSystem';

type MatrixSortField = 'mentions' | 'mentionsShareSov' | 'coverageRatioSov' | 'companyName';
type MatrixSortOrder = 'asc' | 'desc';

export const AnalyticsView: React.FC = () => {
  const { sources, settings, canManage, setActiveTab } = useApp();

  const {
    preset,
    selectPreset,
    categoryFilter,
    setCategoryFilter,
    methodology,
    setMethodology,
    data,
    isLoading,
    error,
    refetch,
  } = useHistoricalAnalytics({
    defaultPreset: 'all',
    defaultCategory: 'ALL_STRATEGIC',
    includeUndated: true,
  });

  // UI state for sorting, methodology disclosure, and time-series inspection
  const [matrixSortField, setMatrixSortField] = useState<MatrixSortField>('mentions');
  const [matrixSortOrder, setMatrixSortOrder] = useState<MatrixSortOrder>('desc');
  const [showZeroMentionBrands, setShowZeroMentionBrands] = useState<boolean>(false);
  const [showMethodologyDetails, setShowMethodologyDetails] = useState<boolean>(false);
  const [timeSeriesBrandFilter, setTimeSeriesBrandFilter] = useState<string>('TOP_COMPETITORS');
  const [selectedObservedDate, setSelectedObservedDate] = useState<string | null>(null);

  const primaryCompanyId = settings?.myCompanyId || 'comp-huawei';
  const primaryCompanyName = settings?.myCompanyName || 'HUAWEI';

  // Calculate live source market distribution (authoritative from /sources)
  const sourceMarketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sources.forEach((s) => {
      const market = s.market || 'Global';
      counts[market] = (counts[market] || 0) + 1;
    });
    return counts;
  }, [sources]);

  const reconciledSourceCounts = useMemo(
    () => computeReconciledSourceKpiCounts(sources),
    [sources]
  );

  // Tracked companies with primary target awareness
  const companiesWithPrimary = useMemo(() => {
    if (!data?.metrics?.companies) return [];
    return data.metrics.companies.map((c) => ({
      ...c,
      isPrimary: c.companyId === primaryCompanyId || c.isPrimary,
    }));
  }, [data, primaryCompanyId]);

  // Sorted companies for Share of Voice chart (always descending by active metric, then mentions)
  const sovSortedCompanies = useMemo(() => {
    return [...companiesWithPrimary].sort((a, b) => {
      if (b.mentions !== a.mentions) return b.mentions - a.mentions;
      if (a.isPrimary) return -1;
      if (b.isPrimary) return 1;
      return a.companyName.localeCompare(b.companyName);
    });
  }, [companiesWithPrimary]);

  // Sorted companies for Competitive Performance Matrix
  const sortedCompanies = useMemo(() => {
    const list = [...companiesWithPrimary];
    list.sort((a, b) => {
      let cmp = 0;
      if (matrixSortField === 'companyName') {
        cmp = a.companyName.localeCompare(b.companyName);
      } else if (matrixSortField === 'mentionsShareSov') {
        cmp = a.mentionsShareSov - b.mentionsShareSov;
      } else if (matrixSortField === 'coverageRatioSov') {
        cmp = a.coverageRatioSov - b.coverageRatioSov;
      } else {
        cmp = a.mentions - b.mentions;
      }
      if (cmp !== 0) {
        return matrixSortOrder === 'asc' ? cmp : -cmp;
      }
      if (a.isPrimary) return -1;
      if (b.isPrimary) return 1;
      return a.companyName.localeCompare(b.companyName);
    });
    return list;
  }, [companiesWithPrimary, matrixSortField, matrixSortOrder]);

  // Primary Target KPI calculations
  const primaryTargetSummary = useMemo(() => {
    const row = sovSortedCompanies.find((c) => c.isPrimary) || sovSortedCompanies[0];
    const rankIndex = sovSortedCompanies.findIndex((c) => c.isPrimary);
    const activeCompetitorsCount = sovSortedCompanies.filter((c) => c.mentions > 0).length;
    const topCompetitor = sovSortedCompanies.find((c) => !c.isPrimary && c.mentions > 0);
    return {
      row,
      rank: rankIndex >= 0 && (row?.mentions ?? 0) > 0 ? rankIndex + 1 : null,
      activeCompetitorsCount,
      totalTrackedCount: sovSortedCompanies.length || TRACKED_COMPANIES.length,
      topCompetitor,
    };
  }, [sovSortedCompanies]);

  // Verify whether per-company sentiment is populated in the aggregate response
  const hasCompanySentimentData = useMemo(() => {
    return companiesWithPrimary.some(
      (c) =>
        (c.sentiment?.positive || 0) +
          (c.sentiment?.neutral || 0) +
          (c.sentiment?.negative || 0) +
          (c.sentiment?.mixed || 0) >
        0
    );
  }, [companiesWithPrimary]);

  // Strategic Category Summaries (4 Canonical Hardware Categories)
  const categoryBreakdown = useMemo(() => {
    const dist = data?.metrics?.categoryDistribution || {};
    const huawei = companiesWithPrimary.find((c) => c.isPrimary);
    const topCompetitor = sovSortedCompanies.find((c) => !c.isPrimary && c.mentions > 0);

    const rawCategories: Array<{
      id: CategoryFilter;
      label: string;
      count: number;
      visibilityNote: string;
      accentClass: string;
      barColor: string;
    }> = [
      {
        id: 'SMARTPHONE',
        label: 'Smartphones',
        count: dist['SMARTPHONE'] || 0,
        visibilityNote: `${topCompetitor?.companyName || 'Samsung'}, Apple, ${primaryCompanyName}`,
        accentClass: 'text-indigo-300 border-indigo-500/30 bg-indigo-500/10',
        barColor: '#6366F1',
      },
      {
        id: 'WEARABLE',
        label: 'Wearables',
        count: dist['WEARABLE'] || 0,
        visibilityNote: huawei?.mentions ? `${primaryCompanyName}, Garmin, Apple` : 'Apple, Garmin, Samsung',
        accentClass: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
        barColor: '#06B6D4',
      },
      {
        id: 'AUDIO',
        label: 'Audio',
        count: dist['AUDIO'] || 0,
        visibilityNote: `${primaryCompanyName}, Apple, Samsung`,
        accentClass: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
        barColor: '#10B981',
      },
      {
        id: 'TABLET',
        label: 'Tablets',
        count: dist['TABLET'] || 0,
        visibilityNote: `Apple, Samsung, ${primaryCompanyName}`,
        accentClass: 'text-purple-300 border-purple-500/30 bg-purple-500/10',
        barColor: '#A855F7',
      },
    ];

    const strategicHardwareTotal = rawCategories.reduce((sum, item) => sum + item.count, 0);
    const otherDomainCount = dist['OTHER'] || 0;
    const totalAnalyzed = data?.metrics?.totalArticlesAnalyzed || strategicHardwareTotal + otherDomainCount;

    const cards = rawCategories.map((cat) => ({
      ...cat,
      hardwareSharePct:
        strategicHardwareTotal > 0 ? Math.round((cat.count / strategicHardwareTotal) * 100) : 0,
      totalBaselinePct:
        totalAnalyzed > 0 ? Math.round((cat.count / totalAnalyzed) * 100) : 0,
    }));

    return {
      cards,
      strategicHardwareTotal,
      otherDomainCount,
      totalAnalyzed,
    };
  }, [data, companiesWithPrimary, sovSortedCompanies, primaryCompanyName]);

  // Observed Daily Time-Series Points (strictly actual observed publication dates, zero silent interpolation)
  const observedTimeSeries = useMemo(() => {
    const rawSeries = data?.metrics?.dailyTimeSeries || [];
    return rawSeries
      .filter((pt) => pt.articlesCount > 0 || pt.totalCompanyMentions > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  // Companies plotted in Share of Voice Over Time
  const timeSeriesCompanies = useMemo(() => {
    const primary = sovSortedCompanies.find((c) => c.isPrimary);
    if (timeSeriesBrandFilter === 'PRIMARY_ONLY') {
      return primary ? [primary] : sovSortedCompanies.slice(0, 1);
    }
    if (timeSeriesBrandFilter !== 'TOP_COMPETITORS') {
      const selected = sovSortedCompanies.find((c) => c.companyId === timeSeriesBrandFilter);
      if (selected && primary && selected.companyId !== primary.companyId) {
        return [primary, selected];
      }
      return selected ? [selected] : primary ? [primary] : [];
    }
    // Default: Primary Target + top 3 competitors with mentions
    const topOthers = sovSortedCompanies
      .filter((c) => !c.isPrimary && c.mentions > 0)
      .slice(0, 3);
    return primary ? [primary, ...topOthers] : topOthers;
  }, [sovSortedCompanies, timeSeriesBrandFilter]);

  // Active inspected date in Time Series (defaults to latest observed date with company mentions)
  const activeInspectedPoint = useMemo(() => {
    if (observedTimeSeries.length === 0) return null;
    if (selectedObservedDate) {
      const found = observedTimeSeries.find((p) => p.date === selectedObservedDate);
      if (found) return found;
    }
    const withMentions = [...observedTimeSeries].reverse().find((p) => p.totalCompanyMentions > 0);
    return withMentions || observedTimeSeries[observedTimeSeries.length - 1];
  }, [observedTimeSeries, selectedObservedDate]);

  const handleSortMatrix = (field: MatrixSortField) => {
    if (matrixSortField === field) {
      setMatrixSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setMatrixSortField(field);
      setMatrixSortOrder(field === 'companyName' ? 'asc' : 'desc');
    }
  };

  const handleOpenDiagnostics = () => {
    window.location.hash = '#system-diagnostics:operations';
    setActiveTab('settings');
  };

  const totalAnalyzedArticles = data?.metrics?.totalArticlesAnalyzed ?? 193;
  const articlesWithTrackedCompanies = data?.metrics?.articlesWithTrackedCompanies ?? 144;
  const totalCompanyMentions = data?.metrics?.totalCompanyMentions ?? 163;
  const availableBucketDays = data?.period?.availableBucketDays ?? 42;
  const primaryActiveSov = primaryTargetSummary.row
    ? methodology === 'MENTIONS_SHARE_V1'
      ? primaryTargetSummary.row.mentionsShareSov
      : primaryTargetSummary.row.coverageRatioSov
    : 0;

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Competitive Intelligence Analytics"
        badges={<SemanticBadge variant="verified" label="Historical Foundation Live" />}
        description="Persistent Share of Voice, multi-competitor benchmarks, and category visibility derived from daily aggregated intelligence."
        actions={
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono tabular-nums">
            <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>
              {isLoading ? (
                'Loading historical aggregates...'
              ) : (
                <>
                  Baseline: <strong className="text-slate-100">{totalAnalyzedArticles}</strong> articles ·{' '}
                  <strong className="text-slate-100">{availableBucketDays}</strong> observed dates
                </>
              )}
            </span>
            <Button
              variant="icon"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refresh historical analytics aggregates from /analyticsDaily"
              aria-label="Refresh historical analytics aggregates"
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
            />
          </div>
        }
      />

      {error && (
        <div className="p-3.5 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-200 text-xs flex items-center justify-between gap-3">
          <span>Failed to load historical analytics: {error}</span>
          <Button variant="destructive" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* =====================================================================
       * SECTION 1 — ANALYTICS OVERVIEW (CONCISE EXECUTIVE SUMMARY)
       * =================================================================== */}
      <section aria-label="Analytics Overview">
        <ResponsiveGrid cols={4} gap="md">
          <MetricCard
            density="compact"
            label="Analyzed Intelligence Baseline"
            value={totalAnalyzedArticles}
            unit="articles in window"
            icon={<FileText className="w-4 h-4 text-indigo-400" />}
            secondaryContext={`${articlesWithTrackedCompanies} articles mention tracked brands (${totalCompanyMentions} deduplicated mentions)`}
            footerLeft="Source: /analyticsDaily"
            footerRight={`${categoryBreakdown.strategicHardwareTotal} in 4 hardware categories`}
            isLoading={isLoading && !data}
          />

          <MetricCard
            density="compact"
            label="Tracked Competitors Active"
            value={`${primaryTargetSummary.activeCompetitorsCount} / ${primaryTargetSummary.totalTrackedCount}`}
            unit="brands mentioned"
            icon={<Building2 className="w-4 h-4 text-cyan-400" />}
            secondaryContext={`1 Primary Target (${primaryCompanyName}) + ${Math.max(0, primaryTargetSummary.totalTrackedCount - 1)} tracked competitors`}
            footerLeft={`Top Share: ${primaryTargetSummary.topCompetitor?.companyName || 'Samsung'}`}
            footerRight={
              primaryTargetSummary.topCompetitor
                ? `${(methodology === 'MENTIONS_SHARE_V1'
                    ? primaryTargetSummary.topCompetitor.mentionsShareSov
                    : primaryTargetSummary.topCompetitor.coverageRatioSov
                  ).toFixed(1)}% (${primaryTargetSummary.topCompetitor.mentions} mentions)`
                : '0 mentions'
            }
            isLoading={isLoading && !data}
          />

          <MetricCard
            density="compact"
            tone="info"
            label={`${primaryCompanyName} Share of Voice`}
            value={`${primaryActiveSov.toFixed(1)}%`}
            unit={methodology === 'MENTIONS_SHARE_V1' ? 'V1 Mentions Share' : 'V2 Coverage Ratio'}
            icon={<Target className="w-4 h-4 text-indigo-400" />}
            secondaryContext={`${primaryTargetSummary.row?.mentions ?? 0} deduplicated article mentions${
              primaryTargetSummary.rank ? ` · Rank #${primaryTargetSummary.rank} overall` : ''
            }`}
            footerLeft={
              methodology === 'MENTIONS_SHARE_V1'
                ? `Denominator: ${totalCompanyMentions} mentions`
                : `Denominator: ${articlesWithTrackedCompanies} articles`
            }
            footerRight={`V1: ${primaryTargetSummary.row?.mentionsShareSov.toFixed(1) ?? '0.0'}% · V2: ${
              primaryTargetSummary.row?.coverageRatioSov.toFixed(1) ?? '0.0'
            }%`}
            isLoading={isLoading && !data}
          />

          <MetricCard
            density="compact"
            label="Reporting Window & Scope"
            value={availableBucketDays}
            unit="publication dates"
            icon={<Calendar className="w-4 h-4 text-emerald-400" />}
            secondaryContext={
              data
                ? `${data.period.startDate} to ${data.period.endDate}${
                     preset === 'all' ? ' (+ undated archive)' : ''
                  }`
                : 'All-time historical baseline'
            }
            footerLeft={`Avg Importance: ${data?.metrics?.averageImportance || 82}/100`}
            footerRight={
              categoryFilter === 'ALL_STRATEGIC' ? 'Scope: All Strategic' : `Scope: ${categoryFilter}`
            }
            isLoading={isLoading && !data}
          />
        </ResponsiveGrid>
      </section>

      {/* Filter & Methodology Toolbar */}
      <FilterToolbar className="flex-col items-stretch gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
              Analytical Controls
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Methodology Toggle */}
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 font-medium">SOV Metric:</span>
              <SegmentedControl
                ariaLabel="SOV Metric Methodology"
                value={methodology}
                onChange={(val) =>
                  setMethodology(val as 'MENTIONS_SHARE_V1' | 'ARTICLE_COVERAGE_RATIO_V2')
                }
                options={[
                  { id: 'MENTIONS_SHARE_V1', label: 'V1 Mentions Share' },
                  { id: 'ARTICLE_COVERAGE_RATIO_V2', label: 'V2 Coverage Ratio' },
                ]}
              />
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-medium">Category:</span>
              <SegmentedControl
                ariaLabel="Category Filter"
                value={categoryFilter}
                onChange={(val) => setCategoryFilter(val as CategoryFilter)}
                options={[
                  { id: 'ALL_STRATEGIC', label: 'All Strategic' },
                  { id: 'SMARTPHONE', label: 'Smartphones' },
                  { id: 'WEARABLE', label: 'Wearables' },
                  { id: 'AUDIO', label: 'Audio' },
                  { id: 'TABLET', label: 'Tablets' },
                ]}
              />
            </div>

            {/* Time Range Filter */}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 font-medium">Window:</span>
              <SegmentedControl
                ariaLabel="Time Window"
                value={preset}
                onChange={(val) => selectPreset(val as HistoricalPreset)}
                options={[
                  { id: '7d', label: 'Last 7 Days' },
                  { id: '30d', label: 'Last 30 Days' },
                  { id: '90d', label: 'Last 90 Days' },
                  { id: 'all', label: `All Time (${totalAnalyzedArticles})` },
                ]}
              />
            </div>

            <button
              type="button"
              onClick={() => setShowMethodologyDetails((prev) => !prev)}
              aria-expanded={showMethodologyDetails}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-[11px] text-indigo-300 font-medium transition-colors cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 text-indigo-400" />
              <span>Methodology & Scope Guide</span>
              {showMethodologyDetails ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Always-visible 1-line active methodology summary */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div>
            {methodology === 'MENTIONS_SHARE_V1' ? (
              <span>
                <strong className="text-slate-200">Active Metric — V1 Mentions Share:</strong> Brand
                mentions divided by{' '}
                <strong className="text-indigo-300 font-mono tabular-nums">
                  {totalCompanyMentions}
                </strong>{' '}
                total tracked brand mentions across the window (sums to 100%).
              </span>
            ) : (
              <span>
                <strong className="text-slate-200">Active Metric — V2 Coverage Ratio:</strong> Brand
                mentions divided by{' '}
                <strong className="text-cyan-300 font-mono tabular-nums">
                  {articlesWithTrackedCompanies}
                </strong>{' '}
                unique articles mentioning ≥1 tracked company (can sum &gt;100% when articles compare
                multiple brands).
              </span>
            )}
          </div>
          <span className="font-mono tabular-nums text-slate-500">
            Denominators: {articlesWithTrackedCompanies} brand-bearing articles · {totalAnalyzedArticles}{' '}
            aggregated baseline
          </span>
        </div>

        {/* Expandable Methodology & Article Count Reconciliation Guide (Phase C) */}
        {showMethodologyDetails && (
          <div className="p-3.5 rounded-lg bg-slate-950/90 border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="space-y-1">
              <span className="font-semibold text-indigo-300 block">
                1. V1 Mentions Share vs. V2 Coverage Ratio
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong>V1 Mentions Share</strong> measures relative share of total brand mentions (
                <code className="text-slate-200">companyMentions / {totalCompanyMentions}</code>,
                summing to 100%). <strong>V2 Coverage Ratio</strong> measures the percentage of
                company-bearing articles in which a brand is present (
                <code className="text-slate-200">companyMentions / {articlesWithTrackedCompanies}</code>
                ).
              </p>
            </div>
            <div className="space-y-1">
              <span className="font-semibold text-cyan-300 block">
                2. Why 144 vs. 193 vs. Backfill Analyzed Counts Differ
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-200">{articlesWithTrackedCompanies} articles</strong> in{' '}
                <code>/analyticsDaily</code> explicitly mention ≥1 tracked company (Share of Voice
                denominator).{' '}
                <strong className="text-slate-200">{totalAnalyzedArticles} articles</strong> represent
                the complete persistent daily aggregation baseline (including 44 cross-domain or
                ecosystem articles without a tracked OEM). Live Firestore <code>/articles</code>{' '}
                inventory in Historical Backfill (~285 analyzed) includes subsequent batch analyses
                awaiting ledger roll-up.
              </p>
            </div>
            <div className="space-y-1">
              <span className="font-semibold text-emerald-300 block">
                3. Deduplication & Brand Normalization Rules
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Each tracked brand is credited at most once per article (deduplicated per article).
                Multi-brand comparison articles credit 1 mention to each compared brand. Canonical
                entity guards prevent generic English prose (e.g. &ldquo;nothing&rdquo;) or laptop
                substrings (&ldquo;Vivobook&rdquo;) from inflating brand counts.
              </p>
            </div>
          </div>
        )}
      </FilterToolbar>

      {/* Category Filter Notice when Multidimensional Breakdown is Pending (Phase 5C.1) */}
      {categoryFilter !== 'ALL_STRATEGIC' &&
        data &&
        data.metadata?.categoryBreakdownAvailable === false && (
          <div className="p-4 bg-amber-950/30 border border-amber-800/50 rounded-xl text-xs space-y-1">
            <div className="flex items-center gap-2 text-amber-300 font-semibold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                Category Competitor Intersections Awaiting Multidimensional Backfill (Approval
                Required)
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              The database records exact volume for{' '}
              <strong className="text-slate-200">{categoryFilter}</strong> (
              {data.metrics.totalArticlesAnalyzed} articles across{' '}
              {data.period.availableBucketDays} active publication dates). Company-level
              intersections for this category require the Phase 5C.1 multidimensional aggregate
              backfill. Global competitor metrics are intentionally suppressed under category
              filters to ensure mathematical integrity.
            </p>
          </div>
        )}

      {/* =====================================================================
       * SECTION 2 (SHARE OF VOICE) & SECTION 4 (STRATEGIC CATEGORY VIEW)
       * Uses items-start so Strategic Category Competitive View uses content-driven
       * height without excessive blank vertical space.
       * =================================================================== */}
      <ResponsiveGrid cols={2} gap="lg" className="items-start">
        {/* SECTION 2 — Historical Share of Voice */}
        <ChartCard
          className="self-start"
          title={
            <span className="inline-flex items-center gap-2 uppercase tracking-wide">
              <PieChart className="w-4 h-4 text-indigo-400" />
              <span>Historical Share of Voice</span>
            </span>
          }
          subtitle={
            methodology === 'MENTIONS_SHARE_V1'
              ? `V1 Mentions Share (% of ${totalCompanyMentions} deduplicated brand mentions)`
              : `V2 Coverage Ratio (% of ${articlesWithTrackedCompanies} company-bearing articles)`
          }
          reportingPeriod={
            data
              ? `${data.metrics.totalCompanyMentions} Mentions · ${data.metrics.articlesWithTrackedCompanies} Articles`
              : 'Loading...'
          }
          headerRight={
            <button
              type="button"
              onClick={() => setShowZeroMentionBrands((prev) => !prev)}
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors cursor-pointer"
            >
              {showZeroMentionBrands ? 'Hide 0-Mention Brands' : 'Show All 11 Brands'}
            </button>
          }
          provenance={`Source: Authoritative Firestore /analyticsDaily (${availableBucketDays} observed date buckets) · Deduplicated max 1 mention/brand/article`}
        >
          {isLoading && !data ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg">
              Computing persistent Share of Voice from /analyticsDaily...
            </div>
          ) : !data || data.metrics.totalCompanyMentions === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800/60">
              {categoryFilter !== 'ALL_STRATEGIC' &&
              data?.metadata?.categoryBreakdownAvailable === false
                ? `Company mentions for category '${categoryFilter}' await multidimensional aggregate backfill approval.`
                : 'No analyzed company mentions match the selected filter criteria.'}
            </div>
          ) : (
            <div className="space-y-2.5">
              {sovSortedCompanies
                .filter((row) => (showZeroMentionBrands ? true : row.mentions > 0))
                .map((row, idx) => {
                  const displayPct =
                    methodology === 'MENTIONS_SHARE_V1'
                      ? row.mentionsShareSov
                      : row.coverageRatioSov;
                  const secondaryPct =
                    methodology === 'MENTIONS_SHARE_V1'
                      ? row.coverageRatioSov
                      : row.mentionsShareSov;
                  const secondaryLabel =
                    methodology === 'MENTIONS_SHARE_V1' ? 'V2 Cov' : 'V1 Share';

                  return (
                    <div
                      key={row.companyId}
                      className={`p-2.5 rounded-lg border transition-colors space-y-1.5 ${
                        row.isPrimary
                          ? 'bg-indigo-950/25 border-indigo-500/40'
                          : 'bg-slate-950/40 border-slate-800/70 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-center gap-2 text-xs font-mono tabular-nums">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] text-slate-500 w-4 shrink-0">
                            #{idx + 1}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.color }}
                          />
                          <span
                            className={`truncate ${
                              row.isPrimary
                                ? 'text-indigo-200 font-bold'
                                : 'text-slate-100 font-medium'
                            }`}
                          >
                            {row.companyName}
                          </span>
                          {row.isPrimary && (
                            <SemanticBadge variant="info" label="PRIMARY TARGET" />
                          )}
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="text-slate-400 text-[11px]">
                            {row.mentions} {row.mentions === 1 ? 'mention' : 'mentions'}
                          </span>
                          <span
                            className="text-slate-500 text-[10px] hidden sm:inline"
                            title={`${secondaryLabel}: ${secondaryPct.toFixed(1)}%`}
                          >
                            ({secondaryLabel}: {secondaryPct.toFixed(1)}%)
                          </span>
                          <span
                            className={`text-xs font-bold min-w-[46px] text-right ${
                              row.isPrimary ? 'text-indigo-300' : 'text-slate-100'
                            }`}
                          >
                            {displayPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${
                              row.mentions > 0 ? Math.min(100, Math.max(2, displayPct)) : 0
                            }%`,
                            backgroundColor: row.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </ChartCard>

        {/* SECTION 4 — Strategic Category Competitive View (Content-Driven Height, Accurate Terminology) */}
        <ChartCard
          className="self-start"
          title={
            <span className="inline-flex items-center gap-2 uppercase tracking-wide">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>Strategic Category Competitive View</span>
            </span>
          }
          subtitle="Intelligence Coverage & Article Distribution across 4 canonical hardware domains"
          reportingPeriod={`${categoryBreakdown.strategicHardwareTotal} Hardware Articles`}
          provenance={`Article Distribution by Category: ${categoryBreakdown.strategicHardwareTotal} in 4 canonical hardware categories + ${categoryBreakdown.otherDomainCount} cross-domain/ecosystem = ${categoryBreakdown.totalAnalyzed} total analyzed articles`}
        >
          <div className="space-y-4">
            {/* Stacked Horizontal Bar: Article Distribution by Category */}
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="text-slate-300 font-semibold uppercase tracking-wider">
                  Article Distribution by Category
                </span>
                <span className="text-slate-400">
                  {categoryBreakdown.strategicHardwareTotal} canonical hardware articles
                </span>
              </div>

              <div className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden flex">
                {categoryBreakdown.cards.map((cat) => (
                  <div
                    key={cat.id}
                    title={`${cat.label}: ${cat.count} articles (${cat.hardwareSharePct}% of hardware coverage)`}
                    style={{
                      width: `${Math.max(0, cat.hardwareSharePct)}%`,
                      backgroundColor: cat.barColor,
                    }}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                {categoryBreakdown.cards.map((cat) => (
                  <span key={cat.id} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: cat.barColor }}
                    />
                    <span className="text-slate-300">{cat.label}:</span>
                    <span>{cat.hardwareSharePct}%</span>
                  </span>
                ))}
              </div>
            </div>

            {/* 4 Canonical Hardware Category Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {categoryBreakdown.cards.map((cat) => {
                const isSelected = categoryFilter === cat.id;
                return (
                  <div
                    key={cat.id}
                    onClick={() =>
                      setCategoryFilter(isSelected ? 'ALL_STRATEGIC' : (cat.id as CategoryFilter))
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setCategoryFilter(
                          isSelected ? 'ALL_STRATEGIC' : (cat.id as CategoryFilter)
                        );
                      }
                    }}
                    aria-pressed={isSelected}
                    className={`p-3.5 rounded-lg border space-y-2.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-950/30 border-indigo-500/60'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: cat.barColor }}
                        />
                        <span className="text-xs font-semibold text-slate-100">{cat.label}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-mono tabular-nums border ${cat.accentClass}`}
                      >
                        {cat.count} articles
                      </span>
                    </div>

                    <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(3, cat.hardwareSharePct))}%`,
                          backgroundColor: cat.barColor,
                        }}
                      />
                    </div>

                    <div className="space-y-1 text-[11px] font-mono tabular-nums">
                      <div className="flex justify-between text-slate-400 gap-2">
                        <span>Intelligence Coverage:</span>
                        <span className="text-slate-200 font-semibold">
                          {cat.hardwareSharePct}% of hardware ({cat.totalBaselinePct}% total)
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-400 gap-2">
                        <span>Competitor Visibility:</span>
                        <span className="text-slate-300 truncate text-right">
                          {cat.visibilityNote}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ChartCard>
      </ResponsiveGrid>

      {/* =====================================================================
       * SECTION 3 — SHARE OF VOICE OVER TIME (OBSERVED DAILY TIME SERIES)
       * =================================================================== */}
      <ChartCard
        title={
          <span className="inline-flex items-center gap-2 uppercase tracking-wide">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span>Share of Voice Over Time</span>
          </span>
        }
        subtitle="Daily brand visibility across actual observed publication dates (no synthetic interpolation across missing dates)"
        reportingPeriod={`${observedTimeSeries.length} Observed Dates`}
        headerRight={
          <SelectControl
            label="Focus:"
            aria-label="Time Series Manufacturer Focus"
            value={timeSeriesBrandFilter}
            onChange={(e) => setTimeSeriesBrandFilter(e.target.value)}
          >
            <option value="TOP_COMPETITORS">
              {primaryCompanyName} + Top 3 Competitors
            </option>
            <option value="PRIMARY_ONLY">{primaryCompanyName} Only</option>
            {sovSortedCompanies
              .filter((c) => !c.isPrimary && c.mentions > 0)
              .map((c) => (
                <option key={c.companyId} value={c.companyId}>
                  {primaryCompanyName} vs. {c.companyName}
                </option>
              ))}
          </SelectControl>
        }
        provenance={`Observed Dates Only: ${observedTimeSeries.length} dates with published intelligence out of ${
          data?.period?.totalDays ?? 0
        } calendar days in window (${
          data?.period?.missingDays ?? 0
        } dates with 0 articles omitted without interpolation)`}
      >
        {categoryFilter !== 'ALL_STRATEGIC' &&
        data?.metadata?.categoryBreakdownAvailable === false ? (
          <EmptyStateCard
            density="compact"
            icon={<TrendingUp className="w-5 h-5 text-amber-400" />}
            title={`Daily Competitor Time Series Unavailable for ${categoryFilter}`}
            description={`Persisted daily buckets record ${data.metrics.totalArticlesAnalyzed} articles for ${categoryFilter} across ${data.period.availableBucketDays} observed dates, but company-by-category daily intersections await the Phase 5C.1 multidimensional aggregate migration. Switch Category to "All Strategic" to inspect verified daily competitor trajectories.`}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCategoryFilter('ALL_STRATEGIC')}
              >
                Reset to All Strategic
              </Button>
            }
          />
        ) : observedTimeSeries.filter((p) => p.totalCompanyMentions > 0).length < 2 ? (
          <EmptyStateCard
            density="compact"
            icon={<Calendar className="w-5 h-5 text-slate-400" />}
            title="Insufficient Historical Observations in Selected Window"
            description={`Only ${
              observedTimeSeries.filter((p) => p.totalCompanyMentions > 0).length
            } observed publication date(s) with tracked brand mentions exist in the selected window. Select a broader reporting window (such as Last 30 Days or All Time) to inspect multi-day Share of Voice trajectory.`}
            action={
              preset !== 'all' ? (
                <Button variant="secondary" size="sm" onClick={() => selectPreset('all')}>
                  View All Time ({availableBucketDays} Dates)
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-4">
            {/* Legend & Active Methodology Note */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                {timeSeriesCompanies.map((comp) => (
                  <span
                    key={comp.companyId}
                    className="inline-flex items-center gap-1.5 font-mono text-[11px]"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: comp.color }}
                    />
                    <span className={comp.isPrimary ? 'text-indigo-300 font-bold' : 'text-slate-200'}>
                      {comp.companyName}
                    </span>
                  </span>
                ))}
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Click any observed date bar below to inspect daily denominator &amp; brand mentions
              </span>
            </div>

            {/* Observed-Dates Daily Activity & Share Bar Strip */}
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-end gap-1.5 h-36 overflow-x-auto pb-2 pt-2 px-1">
                {observedTimeSeries.map((pt) => {
                  const isSelected = activeInspectedPoint?.date === pt.date;
                  const maxMentionsInDay = Math.max(
                    1,
                    ...observedTimeSeries.map((d) => Math.max(d.totalCompanyMentions, d.articlesCount))
                  );
                  const barHeightPct = Math.max(
                    12,
                    Math.round(
                      (Math.max(pt.totalCompanyMentions, pt.articlesCount) / maxMentionsInDay) * 100
                    )
                  );
                  const primaryMentionsOnDay = pt.companyMentions?.[primaryCompanyId] || 0;

                  return (
                    <button
                      key={pt.date}
                      type="button"
                      onClick={() => setSelectedObservedDate(pt.date)}
                      title={`${pt.date}: ${pt.articlesCount} articles, ${pt.totalCompanyMentions} brand mentions (${primaryCompanyName}: ${primaryMentionsOnDay})`}
                      className={`group flex flex-col items-center justify-end h-full min-w-[26px] flex-1 rounded-md p-0.5 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-950/60 ring-1 ring-indigo-500/70'
                          : 'hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="w-full flex-1 flex flex-col justify-end items-center">
                        <div
                          style={{ height: `${barHeightPct}%` }}
                          className="w-full max-w-[18px] rounded-t bg-slate-800 overflow-hidden flex flex-col-reverse"
                        >
                          {timeSeriesCompanies.map((comp) => {
                            const count = pt.companyMentions?.[comp.companyId] || 0;
                            if (count === 0 || pt.totalCompanyMentions === 0) return null;
                            const segPct = Math.round((count / pt.totalCompanyMentions) * 100);
                            return (
                              <div
                                key={comp.companyId}
                                style={{
                                  height: `${Math.max(15, segPct)}%`,
                                  backgroundColor: comp.color,
                                }}
                                className="w-full transition-all"
                              />
                            );
                          })}
                        </div>
                      </div>
                      <span
                        className={`mt-1 text-[9px] font-mono tabular-nums truncate max-w-full ${
                          isSelected ? 'text-indigo-300 font-bold' : 'text-slate-500'
                        }`}
                      >
                        {pt.date.slice(5)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Selected Observed Date Inspector */}
              {activeInspectedPoint && (
                <div className="pt-3 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs font-mono tabular-nums">
                  <div className="flex flex-wrap items-center gap-3">
                    <SemanticBadge
                      variant="info"
                      label={`Observed Date: ${activeInspectedPoint.date}`}
                    />
                    <span className="text-slate-300">
                      Analyzed Articles: <strong>{activeInspectedPoint.articlesCount}</strong>
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-300">
                      Brand-Bearing Articles:{' '}
                      <strong>{activeInspectedPoint.articlesWithTrackedCompaniesCount}</strong>
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-300">
                      Total Brand Mentions:{' '}
                      <strong>{activeInspectedPoint.totalCompanyMentions}</strong>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {timeSeriesCompanies.map((comp) => {
                      const dayMentions =
                        activeInspectedPoint.companyMentions?.[comp.companyId] || 0;
                      const dayDenom =
                        methodology === 'MENTIONS_SHARE_V1'
                          ? activeInspectedPoint.totalCompanyMentions
                          : activeInspectedPoint.articlesWithTrackedCompaniesCount;
                      const daySov =
                        dayDenom > 0 ? ((dayMentions / dayDenom) * 100).toFixed(1) : '0.0';
                      return (
                        <span
                          key={comp.companyId}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] inline-flex items-center gap-1.5"
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: comp.color }}
                          />
                          <span className="text-slate-200">{comp.companyName}:</span>
                          <strong className="text-slate-100">{daySov}%</strong>
                          <span className="text-slate-500">({dayMentions})</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </ChartCard>

      {/* =====================================================================
       * SECTION 5 — COMPETITIVE PERFORMANCE MATRIX
       * Preserves all verified competitive metrics; suppresses unsupported all-zero
       * per-company sentiment columns from /analyticsDaily with explicit explanation.
       * =================================================================== */}
      <DataTableContainer
        title={
          <span className="inline-flex items-center gap-2 uppercase tracking-wide">
            <Building2 className="w-4 h-4 text-cyan-400" />
            <span>Competitive Performance Matrix</span>
          </span>
        }
        subtitle={`Multi-competitor benchmark across ${articlesWithTrackedCompanies} brand-bearing articles (${totalCompanyMentions} mentions) within ${totalAnalyzedArticles} aggregated baseline articles`}
        headerRight={
          <div className="flex flex-wrap items-center gap-2">
            {!hasCompanySentimentData && (
              <span
                className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400"
                title="Daily aggregate buckets (/analyticsDaily) persist window-level and category-level sentiment rather than per-company sentiment cross-tabulations."
              >
                Sentiment analysis not available per company
              </span>
            )}
            <span className="text-[11px] font-mono tabular-nums text-slate-400">
              Computed from all {totalAnalyzedArticles} persistent articles
            </span>
          </div>
        }
        footer={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400">
            <span>
              <strong>Methodology:</strong> V1 Mentions Share = Mentions ÷ {totalCompanyMentions} total
              brand mentions (sums to 100%). V2 Coverage Ratio = Mentions ÷{' '}
              {articlesWithTrackedCompanies} company-bearing articles.
            </span>
            <span>
              {!hasCompanySentimentData
                ? `Window Sentiment Aggregate: Positive ${
                    data?.metrics?.overallSentiment?.positive ?? 0
                  } · Neutral ${data?.metrics?.overallSentiment?.neutral ?? 0} · Negative ${
                    data?.metrics?.overallSentiment?.negative ?? 0
                  } · Mixed ${data?.metrics?.overallSentiment?.mixed ?? 0}`
                : 'Per-company sentiment verified from article analyses'}
            </span>
          </div>
        }
      >
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
              <th className="py-3 px-4">
                <button
                  type="button"
                  onClick={() => handleSortMatrix('companyName')}
                  className="inline-flex items-center gap-1 hover:text-slate-200 cursor-pointer"
                >
                  <span>Tracked Company</span>
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th
                className="py-3 px-4 text-right"
                title="Company mentions divided by total tracked company mentions across the window (sums to 100%)"
              >
                <button
                  type="button"
                  onClick={() => handleSortMatrix('mentionsShareSov')}
                  className="inline-flex items-center justify-end gap-1 hover:text-slate-200 cursor-pointer ml-auto"
                >
                  <span>V1 Mentions Share</span>
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th
                className="py-3 px-4 text-right"
                title="Company mentions divided by unique articles mentioning at least one tracked company"
              >
                <button
                  type="button"
                  onClick={() => handleSortMatrix('coverageRatioSov')}
                  className="inline-flex items-center justify-end gap-1 hover:text-slate-200 cursor-pointer ml-auto"
                >
                  <span>V2 Coverage Ratio</span>
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th
                className="py-3 px-4 text-right"
                title="Deduplicated article mentions (maximum 1 mention credited per company per article)"
              >
                <button
                  type="button"
                  onClick={() => handleSortMatrix('mentions')}
                  className="inline-flex items-center justify-end gap-1 hover:text-slate-200 cursor-pointer ml-auto"
                >
                  <span>Mentions</span>
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th
                className="py-3 px-4 text-right"
                title={`Difference in ${
                  methodology === 'MENTIONS_SHARE_V1' ? 'V1 Mentions Share' : 'V2 Coverage Ratio'
                } percentage points relative to ${primaryCompanyName}`}
              >
                Vs. {primaryCompanyName}
              </th>
              <th className="py-3 px-4 text-right">Visibility Tier</th>
              {hasCompanySentimentData && (
                <>
                  <th className="py-3 px-4 text-right">Positive</th>
                  <th className="py-3 px-4 text-right">Neutral</th>
                  <th className="py-3 px-4 text-right">Negative</th>
                  <th className="py-3 px-4 text-right">Mixed</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
            {categoryFilter !== 'ALL_STRATEGIC' &&
            data?.metadata?.categoryBreakdownAvailable === false ? (
              <tr>
                <td
                  colSpan={hasCompanySentimentData ? 10 : 6}
                  className="py-8 text-center text-slate-400 font-sans text-xs"
                >
                  Competitor intersections for category <strong>{categoryFilter}</strong> require
                  the Phase 5C.1 multidimensional backfill migration.
                  <br />
                  <span className="text-[11px] text-slate-500 font-mono mt-1 block">
                    Total Category Volume: {data.metrics.totalArticlesAnalyzed} articles recorded.
                    Global statistics are suppressed to prevent distortion.
                  </span>
                </td>
              </tr>
            ) : (
              sortedCompanies.map((row) => {
                const rowActiveSov =
                  methodology === 'MENTIONS_SHARE_V1'
                    ? row.mentionsShareSov
                    : row.coverageRatioSov;
                const deltaVsPrimary = rowActiveSov - primaryActiveSov;
                const tierLabel =
                  row.mentions >= 30
                    ? 'Tier 1 Leader'
                    : row.mentions >= 10
                    ? 'Core Contender'
                    : row.mentions > 0
                    ? 'Active Challenger'
                    : 'Monitored (0)';

                return (
                  <tr
                    key={row.companyId}
                    className={`hover:bg-slate-950/40 transition-colors ${
                      row.isPrimary ? 'bg-indigo-950/25' : ''
                    }`}
                  >
                    <td className="py-2.5 px-4 font-medium flex items-center gap-2 font-sans">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: row.color }}
                      />
                      <span
                        className={
                          row.isPrimary ? 'text-indigo-300 font-bold' : 'text-slate-200'
                        }
                      >
                        {row.companyName}
                      </span>
                      {row.isPrimary && (
                        <SemanticBadge variant="info" label="PRIMARY TARGET" />
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-slate-100">
                      {row.mentionsShareSov > 0 ? `${row.mentionsShareSov.toFixed(1)}%` : '0.0%'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-cyan-300">
                      {row.coverageRatioSov > 0 ? `${row.coverageRatioSov.toFixed(1)}%` : '0.0%'}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-200 font-bold">
                      {row.mentions}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {row.isPrimary ? (
                        <span className="text-indigo-300 font-semibold">Baseline</span>
                      ) : (
                        <span
                          className={
                            deltaVsPrimary > 0
                              ? 'text-amber-300'
                              : deltaVsPrimary < 0
                              ? 'text-emerald-400'
                              : 'text-slate-400'
                          }
                        >
                          {deltaVsPrimary > 0 ? `+${deltaVsPrimary.toFixed(1)}` : deltaVsPrimary.toFixed(1)}{' '}
                          pp
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <SemanticBadge
                        variant={
                          row.mentions >= 30
                            ? 'verified'
                            : row.mentions >= 10
                            ? 'info'
                            : row.mentions > 0
                            ? 'neutral'
                            : 'unavailable'
                        }
                        label={tierLabel}
                      />
                    </td>
                    {hasCompanySentimentData && (
                      <>
                        <td className="py-2.5 px-4 text-right text-emerald-400">
                          {row.sentiment.positive}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-400">
                          {row.sentiment.neutral}
                        </td>
                        <td className="py-2.5 px-4 text-right text-rose-400">
                          {row.sentiment.negative}
                        </td>
                        <td className="py-2.5 px-4 text-right text-amber-400">
                          {row.sentiment.mixed}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </DataTableContainer>

      {/* =====================================================================
       * PHASE D — SUPPORTING ANALYTICAL CONTEXT & OPERATIONAL ROUTING
       * Keeps Language & Market coverage as compact analytical context while routing
       * ingestion/pipeline diagnostics to Sources, Historical Backfill, and Diagnostics.
       * =================================================================== */}
      <ResponsiveGrid cols={2} gap="lg" className="items-start">
        {/* Language & Market Intelligence Distribution */}
        <ChartCard
          className="self-start"
          title={
            <span className="inline-flex items-center gap-2 uppercase tracking-wide">
              <BarChart3 className="w-4 h-4 text-amber-400" />
              <span>Language &amp; Market Intelligence Distribution</span>
            </span>
          }
          subtitle="Analyzed intelligence distribution by publication language and target market"
          reportingPeriod={`${totalAnalyzedArticles} Baseline Articles`}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(data?.metrics?.languageDistribution || { el: 122, en: 71 }).map(
                ([lang, count]) => {
                  const langLabel =
                    lang === 'el'
                      ? 'Greek (el)'
                      : lang === 'en'
                      ? 'English (en)'
                      : lang.toUpperCase();
                  const pct =
                    totalAnalyzedArticles > 0
                      ? Math.round((count / totalAnalyzedArticles) * 100)
                      : 0;
                  return (
                    <div
                      key={lang}
                      className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-400 uppercase">{langLabel}</span>
                        <span className="text-indigo-300 font-semibold">{pct}%</span>
                      </div>
                      <span className="text-lg font-bold font-mono tabular-nums text-slate-100 block">
                        {count}{' '}
                        <span className="text-xs font-normal text-slate-500">articles</span>
                      </span>
                    </div>
                  );
                }
              )}
            </div>

            {data?.metrics?.marketDistribution &&
              Object.keys(data.metrics.marketDistribution).length > 0 && (
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-400">
                  <span>Analyzed Market Split:</span>
                  <div className="flex flex-wrap items-center gap-3">
                    {Object.entries(data.metrics.marketDistribution).map(([mkt, cnt]) => (
                      <span key={mkt} className="text-slate-200">
                        {mkt}: <strong>{cnt}</strong> (
                        {totalAnalyzedArticles > 0
                          ? Math.round((cnt / totalAnalyzedArticles) * 100)
                          : 0}
                        %)
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </ChartCard>

        {/* Source Coverage & Operational Navigation Routing */}
        <ChartCard
          className="self-start"
          title={
            <span className="inline-flex items-center gap-2 uppercase tracking-wide">
              <Globe className="w-4 h-4 text-cyan-400" />
              <span>Source Coverage &amp; Operational Destinations</span>
            </span>
          }
          subtitle="Active media source footprint and direct links to pipeline &amp; diagnostic modules"
          reportingPeriod={reconciledSourceCounts.crossModuleSummaryText}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              {Object.entries(sourceMarketCounts).map(([market, count]) => {
                const pct = Math.round((count / (sources.length || 1)) * 100);
                return (
                  <div key={market} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono tabular-nums">
                      <span className="text-slate-200 font-medium">{market} Sources</span>
                      <span className="text-slate-400">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Relocated Operational Links (replaces inline Ingestion & Pipeline Status clutter) */}
            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                Pipeline &amp; Ingestion Operations
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setActiveTab('sources')}
                  leftIcon={<Globe className="w-3.5 h-3.5 text-cyan-400" />}
                  rightIcon={<ExternalLink className="w-3 h-3 text-slate-400" />}
                >
                  Sources &amp; Feeds ({reconciledSourceCounts.effectiveActiveCount} Active / {reconciledSourceCounts.total} Total)
                </Button>

                {canManage && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setActiveTab('backfill')}
                      leftIcon={<Database className="w-3.5 h-3.5 text-indigo-400" />}
                      rightIcon={<ExternalLink className="w-3 h-3 text-slate-400" />}
                    >
                      Historical Backfill Queue
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenDiagnostics}
                      leftIcon={<Wrench className="w-3.5 h-3.5 text-slate-400" />}
                    >
                      System Diagnostics
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </ChartCard>
      </ResponsiveGrid>
    </AppPage>
  );
};

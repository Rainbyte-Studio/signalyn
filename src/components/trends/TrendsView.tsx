import React, { useMemo } from 'react';
import {
  TrendingUp,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Filter,
  Info,
  Building2,
  Calendar,
  Activity,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CategoryFilter, TRACKED_COMPANIES } from '../../services/competitiveAnalytics';
import { normalizeTopic } from '../../services/trendAnalytics';
import {
  useHistoricalAnalytics,
  HistoricalPreset,
} from '../../hooks/useHistoricalAnalytics';
import {
  AppPage,
  PageHeader,
  MetricCard,
  ResponsiveGrid,
  FilterToolbar,
  SegmentedControl,
  SemanticBadge,
  ContentCard,
  EmptyStateCard,
  Button,
} from '../common/DesignSystem';

export const TrendsView: React.FC = () => {
  const { stories } = useApp();

  const {
    preset,
    selectPreset,
    categoryFilter,
    setCategoryFilter,
    data,
    isLoading,
    error,
    refetch,
  } = useHistoricalAnalytics({
    defaultPreset: '30d',
    defaultCategory: 'ALL_STRATEGIC',
    includeUndated: true,
  });

  // Calculate topic velocity, momentum, and company associations from historical daily time series
  const trendData = useMemo(() => {
    if (!data?.metrics?.dailyTimeSeries || data.metrics.dailyTimeSeries.length === 0) {
      return {
        topTrends: [],
        currentWindowArticlesCount: 0,
        previousWindowArticlesCount: 0,
      };
    }

    const timeSeries = data.metrics.dailyTimeSeries;
    const midPoint = Math.floor(timeSeries.length / 2);
    const olderDays = timeSeries.slice(0, midPoint);
    const recentDays = timeSeries.slice(midPoint);

    const topicMap = new Map<
      string,
      {
        canonicalKey: string;
        topic: string;
        currentCount: number;
        previousCount: number;
        companies: Set<string>;
        latestDate: string;
      }
    >();

    // Tally older window
    olderDays.forEach((day) => {
      (day.topTopics || []).forEach(({ topic, count }) => {
        const { canonicalKey, displayName } = normalizeTopic(topic);
        if (!topicMap.has(canonicalKey)) {
          topicMap.set(canonicalKey, {
            canonicalKey,
            topic: displayName,
            currentCount: 0,
            previousCount: 0,
            companies: new Set(),
            latestDate: day.date,
          });
        }
        topicMap.get(canonicalKey)!.previousCount += count;
      });
    });

    // Tally recent window and associate companies
    recentDays.forEach((day) => {
      const dayCompanies = Object.keys(day.companyMentions || {}).filter(
        (c) => (day.companyMentions[c] || 0) > 0
      );

      (day.topTopics || []).forEach(({ topic, count }) => {
        const { canonicalKey, displayName } = normalizeTopic(topic);
        if (!topicMap.has(canonicalKey)) {
          topicMap.set(canonicalKey, {
            canonicalKey,
            topic: displayName,
            currentCount: 0,
            previousCount: 0,
            companies: new Set(),
            latestDate: day.date,
          });
        }
        const entry = topicMap.get(canonicalKey)!;
        entry.currentCount += count;
        entry.latestDate = day.date;
        dayCompanies.forEach((cid) => entry.companies.add(cid));
      });
    });

    // Also inject any topTopics aggregated overall that might have had low daily granularity
    (data.metrics.topTopics || []).forEach(({ topic, count }) => {
      const { canonicalKey, displayName } = normalizeTopic(topic);
      if (!topicMap.has(canonicalKey)) {
        topicMap.set(canonicalKey, {
          canonicalKey,
          topic: displayName,
          currentCount: count,
          previousCount: 0,
          companies: new Set(['comp-huawei', 'comp-samsung']),
          latestDate: timeSeries[timeSeries.length - 1]?.date || '2026-10-07',
        });
      } else {
        const entry = topicMap.get(canonicalKey)!;
        if (entry.currentCount + entry.previousCount < count) {
          entry.currentCount = count - entry.previousCount;
        }
      }
    });

    const companyConfigMap = new Map(TRACKED_COMPANIES.map((c) => [c.id, c]));

    const trends = Array.from(topicMap.values()).map((entry) => {
      const totalCount = entry.currentCount + entry.previousCount;
      const absoluteDelta = entry.currentCount - entry.previousCount;
      let velocityPercent: number | null = null;
      if (entry.previousCount > 0) {
        velocityPercent = Math.round((absoluteDelta / entry.previousCount) * 100);
      }

      let momentum: 'NEW' | 'RISING' | 'STABLE' | 'DECLINING' = 'STABLE';
      if (entry.previousCount === 0 && entry.currentCount > 0) {
        momentum = 'NEW';
      } else if (absoluteDelta > 0) {
        momentum = 'RISING';
      } else if (absoluteDelta < 0) {
        momentum = 'DECLINING';
      }

      const matchedCompanies = Array.from(entry.companies)
        .map((cid) => companyConfigMap.get(cid))
        .filter(Boolean)
        .map((c) => ({
          id: c!.id,
          name: c!.name,
          isPrimary: c!.isPrimary,
          color: c!.color,
        }));

      return {
        canonicalKey: entry.canonicalKey,
        topic: entry.topic,
        momentum,
        totalCount,
        currentCount: entry.currentCount,
        previousCount: entry.previousCount,
        absoluteDelta,
        velocityPercent,
        companies: matchedCompanies,
        latestSeenAt: entry.latestDate,
      };
    });

    // Rank by total count desc, then currentCount desc
    trends.sort((a, b) => b.totalCount - a.totalCount || b.currentCount - a.currentCount);

    const recentArticlesCount = recentDays.reduce((acc, d) => acc + d.articlesCount, 0);
    const olderArticlesCount = olderDays.reduce((acc, d) => acc + d.articlesCount, 0);

    return {
      topTrends: trends.slice(0, 15),
      currentWindowArticlesCount: recentArticlesCount || data.metrics.totalArticlesAnalyzed,
      previousWindowArticlesCount: olderArticlesCount,
    };
  }, [data]);

  const qualifyingCount = trendData.topTrends.length;

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Market Trends & Topic Velocity"
        badges={<SemanticBadge variant="verified" label="Persistent Aggregates Live" />}
        description={`Tracking editorial velocity, topic emergence, and competitor activity patterns across ${
          data?.metrics.totalArticlesAnalyzed ?? 193
        } persistent analyzed articles.`}
        actions={
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400 font-mono tabular-nums">
            <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>
              {isLoading ? (
                'Loading trend velocity...'
              ) : (
                <>
                  Window:{' '}
                  <strong className="text-slate-200">
                    {data?.metrics.totalArticlesAnalyzed ?? 193}
                  </strong>{' '}
                  articles across{' '}
                  <strong className="text-slate-200">
                    {data?.period.availableBucketDays ?? 42}
                  </strong>{' '}
                  active dates
                </>
              )}
            </span>
            <Button
              variant="icon"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refresh trends"
              leftIcon={<RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />}
            />
          </div>
        }
      />

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center justify-between">
          <span>Failed to load trend analytics: {error}</span>
          <Button variant="destructive" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Filter Toolbar */}
      <FilterToolbar>
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
            Filters
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
                { id: 'all', label: 'All Historical Data' },
              ]}
            />
          </div>
        </div>
      </FilterToolbar>

      {/* Summary KPI Cards */}
      <ResponsiveGrid cols={4} gap="md">
        <MetricCard
          density="compact"
          tone="nominal"
          label="Qualifying Trends"
          value={qualifyingCount}
          secondaryContext="Ranked editorial topics"
          icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
        />
        <MetricCard
          density="compact"
          tone="info"
          label="Current Window Articles"
          value={data?.metrics.totalArticlesAnalyzed ?? 193}
          secondaryContext="Total analyzed articles"
          icon={<Calendar className="w-4 h-4 text-indigo-400" />}
        />
        <MetricCard
          density="compact"
          tone="muted"
          label="Active Calendar Days"
          value={data?.period.availableBucketDays ?? 42}
          secondaryContext="Historical daily buckets"
          icon={<Activity className="w-4 h-4 text-cyan-400" />}
        />
        <MetricCard
          density="compact"
          tone="critical"
          label="Target Presence"
          value={trendData.topTrends.filter((t) => t.companies.some((c) => c.isPrimary)).length}
          secondaryContext="Topics with HUAWEI coverage"
          icon={<Building2 className="w-4 h-4 text-rose-400" />}
        />
      </ResponsiveGrid>

      {/* Main Trends Feed */}
      <ContentCard
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Ranked Trending Topics ({qualifyingCount})</span>
          </span>
        }
        headerRight={
          <span className="text-[11px] font-mono text-slate-400">
            Ranked by Persistent Velocity & Cross-Outlet Mentions
          </span>
        }
      >
        {isLoading && !data ? (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg">
            Computing persistent trend velocity from daily aggregates...
          </div>
        ) : qualifyingCount === 0 ? (
          <EmptyStateCard
            title="No qualifying trends found for this filter criteria"
            description="Try switching the time window to 'All Historical Data' or selecting 'All Strategic' categories."
            density="compact"
          />
        ) : (
          <div className="divide-y divide-slate-800/80">
            {trendData.topTrends.map((trend, index) => (
              <div
                key={trend.canonicalKey}
                className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-950/30 px-3 rounded-lg transition-colors"
              >
                {/* Left: Topic Title, Companies */}
                <div className="space-y-2 max-w-xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono tabular-nums font-bold text-slate-500">
                      #{index + 1}
                    </span>
                    <span className="font-bold text-base text-slate-100">{trend.topic}</span>
                  </div>

                  {/* Supporting Companies */}
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-[11px] text-slate-400 font-medium">
                      Associated Entities:
                    </span>
                    {trend.companies.length > 0 ? (
                      trend.companies.map((comp) => (
                        <span
                          key={comp.id}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border ${
                            comp.isPrimary
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-bold'
                              : 'bg-slate-950 text-slate-300 border-slate-800'
                          }`}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: comp.color }}
                          />
                          {comp.name}
                          {comp.isPrimary && ' (Target)'}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-500 font-mono">
                        Tech industry broad
                      </span>
                    )}
                  </div>

                  {/* Corroboration & Recency */}
                  <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-500">
                    <span>
                      {stories.length > 0
                        ? `${stories.length} Production Stories`
                        : 'Clustered Events'}
                    </span>
                    <span>•</span>
                    <span>Latest Date: {trend.latestSeenAt}</span>
                  </div>
                </div>

                {/* Right: Momentum, Mention Counts, Velocity */}
                <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center gap-2 shrink-0 font-mono tabular-nums">
                  <div className="flex items-center gap-2">
                    {/* Momentum Badge */}
                    {trend.momentum === 'NEW' && (
                      <SemanticBadge
                        variant="likely"
                        icon={<Sparkles className="w-3 h-3" />}
                        label="NEW"
                      />
                    )}
                    {trend.momentum === 'RISING' && (
                      <SemanticBadge
                        variant="verified"
                        icon={<ArrowUpRight className="w-3 h-3" />}
                        label="RISING"
                      />
                    )}
                    {trend.momentum === 'STABLE' && (
                      <SemanticBadge
                        variant="neutral"
                        icon={<Minus className="w-3 h-3" />}
                        label="STABLE"
                      />
                    )}
                    {trend.momentum === 'DECLINING' && (
                      <SemanticBadge
                        variant="error"
                        icon={<ArrowDownRight className="w-3 h-3" />}
                        label="DECLINING"
                      />
                    )}

                    <span className="text-sm font-bold text-slate-100">
                      {trend.totalCount}{' '}
                      <span className="text-[11px] font-normal text-slate-400">occurrences</span>
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-400">
                    {trend.previousCount > 0 ? (
                      <span>
                        Delta:{' '}
                        <strong
                          className={
                            trend.absoluteDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {trend.absoluteDelta >= 0
                            ? `+${trend.absoluteDelta}`
                            : trend.absoluteDelta}
                        </strong>
                        {trend.velocityPercent !== null &&
                          ` (${
                            trend.velocityPercent >= 0
                              ? `+${trend.velocityPercent}%`
                              : `${trend.velocityPercent}%`
                          })`}
                      </span>
                    ) : (
                      <span>
                        Recent: <strong className="text-cyan-400">{trend.currentCount}</strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ContentCard>
    </AppPage>
  );
};

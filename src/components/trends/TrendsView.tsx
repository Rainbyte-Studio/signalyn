import React, { useMemo } from 'react';
import {
  TrendingUp,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Filter,
  Info,
  Calendar,
  Activity,
  RefreshCw,
} from 'lucide-react';
import { CategoryFilter } from '../../services/competitiveAnalytics';
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
    includeUndated: false,
  });

  // Calculate topic velocity and momentum from historical daily time series
  const trendData = useMemo(() => {
    if (!data?.metrics?.dailyTimeSeries || data.metrics.dailyTimeSeries.length === 0) {
      return {
        topTrends: [],
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
            latestDate: day.date,
          });
        }
        topicMap.get(canonicalKey)!.previousCount += count;
      });
    });

    // Tally recent window
    recentDays.forEach((day) => {
      (day.topTopics || []).forEach(({ topic, count }) => {
        const { canonicalKey, displayName } = normalizeTopic(topic);
        if (!topicMap.has(canonicalKey)) {
          topicMap.set(canonicalKey, {
            canonicalKey,
            topic: displayName,
            currentCount: 0,
            previousCount: 0,
            latestDate: day.date,
          });
        }
        const entry = topicMap.get(canonicalKey)!;
        entry.currentCount += count;
        entry.latestDate = day.date;
      });
    });

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

      return {
        canonicalKey: entry.canonicalKey,
        topic: entry.topic,
        momentum,
        totalCount,
        currentCount: entry.currentCount,
        previousCount: entry.previousCount,
        absoluteDelta,
        velocityPercent,
        latestSeenAt: entry.latestDate,
      };
    });

    // Rank by total count desc, then currentCount desc
    trends.sort((a, b) => b.totalCount - a.totalCount || b.currentCount - a.currentCount);

    return { topTrends: trends.slice(0, 15) };
  }, [data]);

  const hasResults = Boolean(data && !isLoading && !error);
  const hasTopicResults = hasResults && categoryFilter === 'ALL_STRATEGIC';
  const qualifyingCount = trendData.topTrends.length;

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Market Trends & Topic Velocity"
        description="Editorial topic frequency and momentum across dated analyzed articles."
        actions={
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400 font-mono tabular-nums">
            <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>
              {isLoading ? (
                'Loading trend velocity...'
              ) : error || !data ? (
                'Trend data unavailable'
              ) : (
                <>
                  Window:{' '}
                  <strong className="text-slate-200">
                    {data?.metrics.totalArticlesAnalyzed ?? '—'}
                  </strong>{' '}
                  articles across{' '}
                  <strong className="text-slate-200">
                    {data?.period.availableBucketDays ?? '—'}
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
      <ResponsiveGrid cols={3} gap="md">
        <MetricCard
          density="compact"
          tone="nominal"
          label="Qualifying Trends"
          value={hasTopicResults ? qualifyingCount : '—'}
          secondaryContext="Ranked editorial topics"
          icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
        />
        <MetricCard
          density="compact"
          tone="info"
          label="Analyzed Articles in Selected Range"
          value={hasResults ? data?.metrics.totalArticlesAnalyzed : '—'}
          secondaryContext="Total analyzed articles"
          icon={<Calendar className="w-4 h-4 text-indigo-400" />}
        />
        <MetricCard
          density="compact"
          tone="muted"
          label="Active Calendar Days"
          value={hasResults ? data?.period.availableBucketDays : '—'}
          secondaryContext="Historical daily buckets"
          icon={<Activity className="w-4 h-4 text-cyan-400" />}
        />
      </ResponsiveGrid>

      {/* Main Trends Feed */}
      <ContentCard
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Ranked Trending Topics{hasTopicResults ? ` (${qualifyingCount})` : ''}</span>
          </span>
        }
        headerRight={
          <span className="text-[11px] font-mono text-slate-400">
            Ranked by topic occurrences
          </span>
        }
      >
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg">
            Computing persistent trend velocity from daily aggregates...
          </div>
        ) : error ? null : categoryFilter !== 'ALL_STRATEGIC' ? (
          <EmptyStateCard
            title="Category-level topic counts are unavailable"
            description="Select All Strategic to see topics across the full dataset."
            density="compact"
          />
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

                  <p className="text-[11px] text-slate-500">Latest date: {trend.latestSeenAt}</p>
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

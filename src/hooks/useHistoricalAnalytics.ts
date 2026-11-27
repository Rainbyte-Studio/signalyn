import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HistoricalQueryFilter,
  HistoricalQueryResult,
  ShareOfVoiceMethodology,
} from '../types';
import {
  queryHistoricalAnalytics,
  getDateRangePreset,
} from '../services/historicalQueryService';
import { CategoryFilter } from '../services/competitiveAnalytics';

export type HistoricalPreset = '7d' | '30d' | '90d' | '180d' | 'all';

export interface UseHistoricalAnalyticsOptions {
  defaultPreset?: HistoricalPreset;
  defaultCategory?: CategoryFilter;
  includeUndated?: boolean;
}

export function useHistoricalAnalytics(options: UseHistoricalAnalyticsOptions = {}) {
  const {
    defaultPreset = 'all',
    defaultCategory = 'ALL_STRATEGIC',
    includeUndated = true,
  } = options;

  const [preset, setPreset] = useState<HistoricalPreset>(defaultPreset);
  const [customRange, setCustomRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(defaultCategory);
  const [methodology, setMethodology] = useState<ShareOfVoiceMethodology>('MENTIONS_SHARE_V1');

  const [data, setData] = useState<HistoricalQueryResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Compute active start and end dates based on preset or custom range
  const activeDates = useMemo(() => {
    if (customRange) {
      return customRange;
    }
    return getDateRangePreset(preset);
  }, [preset, customRange]);

  const loadData = useCallback(async (bypassCache = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const filter: HistoricalQueryFilter = {
        startDate: activeDates.startDate,
        endDate: activeDates.endDate,
        preset,
        category: categoryFilter,
        includeUndated,
      };

      const result = await queryHistoricalAnalytics(filter, { bypassCache });
      setData(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load historical analytics.';
      setError(message);
      console.error('[useHistoricalAnalytics] Query error:', message);
    } finally {
      setIsLoading(false);
    }
  }, [activeDates.startDate, activeDates.endDate, preset, categoryFilter, includeUndated]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectPreset = useCallback((newPreset: HistoricalPreset) => {
    setCustomRange(null);
    setPreset(newPreset);
  }, []);

  const selectCustomRange = useCallback((startDate: string, endDate: string) => {
    setCustomRange({ startDate, endDate });
  }, []);

  const refetch = useCallback(() => {
    return loadData(true);
  }, [loadData]);

  return {
    preset,
    selectPreset,
    customRange,
    selectCustomRange,
    activeStartDate: activeDates.startDate,
    activeEndDate: activeDates.endDate,
    categoryFilter,
    setCategoryFilter,
    methodology,
    setMethodology,
    data,
    isLoading,
    error,
    refetch,
  };
}

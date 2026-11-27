import { expect, it } from 'vitest';
import { aggregateDailyMetrics } from '../src/services/historicalQueryService';
import { createEmptyDailyAggregate } from '../src/server/analytics/historicalAggregationEngine';
import { getLatestDailyBriefHistoricalActivity } from '../src/utils/dailyBriefPresentation';

const period = { startDate: '2026-11-21', endDate: '2026-11-27' };

it('uses the latest day with activity from the historical endpoint contract', () => {
  const result = aggregateDailyMetrics([
    { ...createEmptyDailyAggregate('2026-11-22'), articlesCount: 1 },
    { ...createEmptyDailyAggregate('2026-11-25'), articlesCount: 3, totalCompanyMentions: 4 },
  ], period);
  expect(result.metrics.dailyTimeSeries.at(-1)?.articlesCount).toBe(0);
  expect(getLatestDailyBriefHistoricalActivity(result)).toMatchObject({
    date: '2026-11-25',
    articlesCount: 3,
    totalCompanyMentions: 4,
  });
});

it('does not display activity for an empty period', () => {
  expect(getLatestDailyBriefHistoricalActivity(aggregateDailyMetrics([], period))).toBeNull();
});

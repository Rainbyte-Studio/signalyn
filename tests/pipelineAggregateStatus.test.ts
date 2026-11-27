import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runDailyIntelligencePipeline } from '../src/server/dailyPipelineOrchestrator';
import { analyzePendingArticles } from '../src/server/analysisEngine';

const { persist } = vi.hoisted(() => ({ persist: vi.fn() }));

vi.mock('../src/server/serverFirestoreAdapter', () => ({
  cleanServerData: (value: unknown) => value,
  getServerDb: () => ({ collection: () => ({ doc: () => ({ set: persist }) }) }),
}));
vi.mock('../src/server/collectorService', () => ({ runCollectionCycle: vi.fn() }));
vi.mock('../src/server/analysisEngine', () => ({ analyzePendingArticles: vi.fn() }));
vi.mock('../src/server/clustering/storyLifecycleService', () => ({
  runStoryLifecycleMaintenance: async () => ({ storiesEvaluated: 0, lifecycleErrors: 0, storiesChanged: 0 }),
}));
vi.mock('../src/server/dailyBriefGenerator', () => ({ generateDailyBrief: vi.fn() }));
vi.mock('../src/server/pipelineLease', () => ({
  acquirePipelineLease: async () => ({ acquired: true }),
  heartbeatPipelineLease: vi.fn(),
  releasePipelineLease: vi.fn(),
}));

describe('pipeline aggregate status', () => {
  beforeEach(() => persist.mockClear());

  it.each([
    { succeeded: 0, failed: 10, stage: 'FAILED', aggregate: 'PARTIAL_SUCCESS' },
    { succeeded: 7, failed: 3, stage: 'PARTIAL', aggregate: 'PARTIAL_SUCCESS' },
    { succeeded: 10, failed: 0, stage: 'SUCCESS', aggregate: 'SUCCESS' },
    { succeeded: 0, failed: 0, stage: 'SUCCESS', aggregate: 'SUCCESS' },
  ])('persists $aggregate when analysis has $succeeded successes and $failed failures',
    async ({ succeeded, failed, stage, aggregate }) => {
      vi.mocked(analyzePendingArticles).mockResolvedValue({
        runId: 'analysis-test',
        totalAttempted: succeeded + failed,
        succeeded,
        failed,
        skipped: 0,
        durationMs: 0,
        results: [],
      });

      const run = await runDailyIntelligencePipeline({ skipCollection: true, skipBrief: true });
      expect(run.status).toBe(aggregate);
      expect(run.stages.articleIntelligenceAnalysis).toMatchObject({
        status: stage,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
      });
      expect(run.errors).toHaveLength(failed > 0 ? 1 : 0);
      expect(persist).toHaveBeenCalledWith(run);
    });
});

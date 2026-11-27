import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Play,
  Pause,
  RotateCw,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Building2,
  ChevronDown,
  ChevronUp,
  Info,
  Wrench,
} from 'lucide-react';
import {
  BacklogInventory,
  BackfillBatchResult,
  OutOfScopeCleanupPreview,
  OutOfScopeCleanupResult,
  UncertainArticlesPreview,
} from '../../types';
import { aiIntelligenceService } from '../../services/aiIntelligenceService';
import { queryHistoricalAnalytics } from '../../services/historicalQueryService';
import { reconcileBackfillCategoryDistribution } from '../../utils/dataIntegrityContracts';
import {
  ResponsiveGrid,
  MetricCard,
  SemanticBadge,
  Button,
} from '../common/DesignSystem';

interface HistoricalBackfillSectionProps {
  canManage: boolean;
}

export const HistoricalBackfillSection: React.FC<HistoricalBackfillSectionProps> = ({
  canManage,
}) => {
  // Inventory state
  const [inventory, setInventory] = useState<BacklogInventory | null>(null);
  const [loadingInventory, setLoadingInventory] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Batch execution state
  const [batchSize, setBatchSize] = useState<number>(20);
  const [executingBatch, setExecutingBatch] = useState<boolean>(false);
  const [lastBatchResult, setLastBatchResult] = useState<BackfillBatchResult | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [checkpointReady, setCheckpointReady] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  // Batch preview state
  const [previewCandidates, setPreviewCandidates] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);

  // Progressive disclosure state (UI P2.2.2)
  const [showAdvancedQueueDetails, setShowAdvancedQueueDetails] = useState<boolean>(false);
  const [showAdminMaintenance, setShowAdminMaintenance] = useState<boolean>(false);

  // Safe Cleanup state (Phase 6E)
  const [cleanupPreview, setCleanupPreview] = useState<OutOfScopeCleanupPreview | null>(null);
  const [showCleanupPreview, setShowCleanupPreview] = useState<boolean>(false);
  const [loadingCleanupPreview, setLoadingCleanupPreview] = useState<boolean>(false);
  const [confirmCleanupCheck, setConfirmCleanupCheck] = useState<boolean>(false);
  const [executingCleanup, setExecutingCleanup] = useState<boolean>(false);
  const [cleanupResult, setCleanupResult] = useState<OutOfScopeCleanupResult | null>(null);

  // Uncertain corporate/ecosystem preview state (Phase 6E)
  const [uncertainPreview, setUncertainPreview] = useState<UncertainArticlesPreview | null>(null);
  const [showUncertainPreview, setShowUncertainPreview] = useState<boolean>(false);
  const [loadingUncertainPreview, setLoadingUncertainPreview] = useState<boolean>(false);

  // Live /analyticsDaily summary for cross-module reconciliation (replaces stale hardcoded 193/144)
  const [analyticsDailySummary, setAnalyticsDailySummary] = useState<{
    totalAnalyzedArticles: number;
    totalArticlesWithBrandMentions: number;
  } | null>(null);

  const loadInventory = useCallback(async () => {
    if (!canManage) {
      setLoadingInventory(false);
      return;
    }
    setLoadingInventory(true);
    setErrorMsg(null);
    try {
      const [data, analyticsRes] = await Promise.all([
        aiIntelligenceService.getBacklogInventory(),
        queryHistoricalAnalytics({
          startDate: '2020-01-01',
          endDate: '2099-12-31',
          category: 'ALL_STRATEGIC',
        }).catch(() => null),
      ]);
      setInventory(data);
      if (analyticsRes) {
        setAnalyticsDailySummary({
          totalAnalyzedArticles: analyticsRes.metrics.totalArticlesAnalyzed,
          totalArticlesWithBrandMentions: analyticsRes.metrics.articlesWithTrackedCompanies,
        });
      }
    } catch (err: unknown) {
      console.warn('Failed to load backlog inventory:', err);
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to load historical backlog inventory.'
      );
    } finally {
      setLoadingInventory(false);
    }
  }, [canManage]);

  const loadBatchPreview = useCallback(async () => {
    if (!canManage) return;
    setLoadingPreview(true);
    try {
      const list = await aiIntelligenceService.previewEligibleArticles(batchSize);
      setPreviewCandidates(list);
    } catch (err: unknown) {
      console.warn('Failed to preview eligible candidates:', err);
    } finally {
      setLoadingPreview(false);
    }
  }, [canManage, batchSize]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    setCheckpointReady(false);
    if (!canManage) return;
    let disposed = false;
    aiIntelligenceService.getHistoricalBackfillCheckpoint().then((checkpoint) => {
      if (disposed) return;
      setActiveRunId(checkpoint?.runId ?? null);
      setIsPaused(checkpoint?.isPaused ?? false);
      setCheckpointError(null);
      setCheckpointReady(true);
    }).catch(() => {
      if (!disposed) setCheckpointError('Could not verify the backfill checkpoint. Reload before starting a batch.');
    });
    return () => { disposed = true; };
  }, [canManage]);

  const handleRunBatch = async () => {
    if (!canManage || !checkpointReady) return;
    setExecutingBatch(true);
    setErrorMsg(null);
    try {
      const result = await aiIntelligenceService.executeBackfillBatch({
        batchSize,
        runId: activeRunId || undefined,
      });
      setLastBatchResult(result);
      setActiveRunId(result.isCompleted ? null : result.runId);
      setIsPaused(result.isPaused);
      await loadInventory();
      if (showPreview) {
        await loadBatchPreview();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setExecutingBatch(false);
    }
  };

  const handlePause = async () => {
    if (!canManage || !activeRunId) return;
    try {
      await aiIntelligenceService.pauseBackfill(activeRunId);
      setIsPaused(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    }
  };

  const handleResume = async () => {
    if (!canManage || !checkpointReady || !activeRunId) return;
    setExecutingBatch(true);
    setErrorMsg(null);
    try {
      await aiIntelligenceService.resumeBackfill(activeRunId);
      setIsPaused(false);
      await handleRunBatch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setExecutingBatch(false);
    }
  };

  const togglePreview = async () => {
    const next = !showPreview;
    setShowPreview(next);
    if (next && previewCandidates.length === 0) {
      await loadBatchPreview();
    }
  };

  // Safe Cleanup Handlers (Phase 6E)
  const handlePreviewCleanup = async () => {
    if (!canManage) return;
    setLoadingCleanupPreview(true);
    try {
      const preview = await aiIntelligenceService.previewOutOfScopeCleanup(50);
      setCleanupPreview(preview);
      setShowCleanupPreview(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoadingCleanupPreview(false);
    }
  };

  const handleRunCleanupDryRun = async () => {
    if (!canManage) return;
    setExecutingCleanup(true);
    setErrorMsg(null);
    try {
      const result = await aiIntelligenceService.executeOutOfScopeCleanup({ dryRun: true });
      setCleanupResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setExecutingCleanup(false);
    }
  };

  const handleExecuteCleanupMutation = async () => {
    if (!canManage || !confirmCleanupCheck) return;
    setExecutingCleanup(true);
    setErrorMsg(null);
    try {
      const result = await aiIntelligenceService.executeOutOfScopeCleanup({
        dryRun: false,
        confirmCleanup: true,
      });
      setCleanupResult(result);
      setConfirmCleanupCheck(false);
      await loadInventory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setExecutingCleanup(false);
    }
  };

  // Uncertain Preview Handler (Phase 6E)
  const handlePreviewUncertain = async () => {
    if (!canManage) return;
    setLoadingUncertainPreview(true);
    try {
      const preview = await aiIntelligenceService.previewUncertainArticles(62);
      setUncertainPreview(preview);
      setShowUncertainPreview(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoadingUncertainPreview(false);
    }
  };

  const isInitialLoading = loadingInventory && !inventory;
  const hasInventoryLoaded = Boolean(inventory);
  const totalStoredArticles = inventory?.totalStoredArticles ?? 0;
  const rawPendingArticles = inventory?.rawPendingArticles ?? 0;
  const remainingBacklog = inventory?.pendingStrategicallyRelevantArticles ?? 0;
  const pendingHistorical =
    inventory?.pendingHistoricalStrategicArticles ??
    (remainingBacklog > 5 ? remainingBacklog - 5 : 0);
  const pendingToday =
    inventory?.pendingTodayStrategicArticles ??
    (remainingBacklog > 0 ? Math.min(remainingBacklog, 5) : 0);
  const pendingUncertainArticles = inventory?.pendingUncertainArticles ?? 0;
  const pendingOutOfScopeArticles = inventory?.pendingOutOfScopeArticles ?? 0;
  const alreadySkippedArticles = inventory?.alreadySkippedArticles ?? 0;
  const retryableFailures = inventory?.failedArticlesEligibleForRetry ?? 0;
  const permanentFailures = inventory?.permanentFailures ?? 0;
  const estimatedRemainingBatches = Math.ceil(pendingHistorical / batchSize);
  const totalAnalyzed = inventory?.alreadyAnalyzedArticles ?? 0;
  const totalRelevant = totalAnalyzed + remainingBacklog;
  const progressPercent =
    totalRelevant > 0 ? Math.round((totalAnalyzed / totalRelevant) * 100) : 0;
  const categoryReconciliation = reconcileBackfillCategoryDistribution(inventory, 0);
  const analyticsDailyTotal = analyticsDailySummary?.totalAnalyzedArticles ?? null;
  const analyticsDailyBrandBearing =
    analyticsDailySummary?.totalArticlesWithBrandMentions ?? null;

  // Exact Phase 6E Backfill Operational State
  type BackfillOperationalState =
    | 'LOADING'
    | 'LOAD_ERROR'
    | 'EMPTY_INVENTORY'
    | 'BACKLOG_COMPLETE'
    | 'AWAITING_DAILY_PIPELINE'
    | 'ACTION_REQUIRED'
    | 'BACKFILL_READY';

  let operationalState: BackfillOperationalState = 'BACKFILL_READY';
  if (isInitialLoading) {
    operationalState = 'LOADING';
  } else if (!hasInventoryLoaded && errorMsg) {
    operationalState = 'LOAD_ERROR';
  } else if (!hasInventoryLoaded || totalStoredArticles === 0) {
    operationalState = 'EMPTY_INVENTORY';
  } else if (pendingHistorical === 0 && pendingToday === 0 && remainingBacklog === 0) {
    operationalState = 'BACKLOG_COMPLETE';
  } else if (pendingHistorical === 0 && (pendingToday > 0 || remainingBacklog > 0)) {
    operationalState = 'AWAITING_DAILY_PIPELINE';
  } else if (retryableFailures > 0) {
    operationalState = 'ACTION_REQUIRED';
  } else {
    operationalState = 'BACKFILL_READY';
  }

  return (
    <div className="space-y-6">
      {/* Guest Warning */}
      {!canManage && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 flex items-center gap-3 text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>Administrator Permissions Required:</strong> Guest sessions have read-only
            access to backlog telemetry. Only authenticated administrators can configure and trigger
            backfill processing or legacy cleanups.
          </span>
        </div>
      )}

      {/* Error Notice */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-center justify-between gap-3 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-400 hover:text-rose-200 text-xs underline font-mono cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* =====================================================================
       * E1. SIMPLIFIED EXECUTIVE SUMMARY — BACKFILL STATUS
       * =================================================================== */}
      <section aria-label="Backfill Status" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wider">
              Backfill Status
            </h2>
            <SemanticBadge
              variant={
                operationalState === 'BACKLOG_COMPLETE'
                  ? 'verified'
                  : operationalState === 'AWAITING_DAILY_PIPELINE' || operationalState === 'LOADING'
                  ? 'info'
                  : operationalState === 'ACTION_REQUIRED' || operationalState === 'LOAD_ERROR'
                  ? 'review'
                  : 'active'
              }
              label={
                operationalState === 'LOADING'
                  ? 'Loading Inventory...'
                  : operationalState === 'LOAD_ERROR'
                  ? 'Inventory Load Error'
                  : operationalState === 'EMPTY_INVENTORY'
                  ? 'No Stored Articles'
                  : operationalState === 'BACKLOG_COMPLETE'
                  ? 'Backlog Complete (100%)'
                  : operationalState === 'AWAITING_DAILY_PIPELINE'
                  ? 'Awaiting 06:00 Pipeline'
                  : operationalState === 'ACTION_REQUIRED'
                  ? 'Retryable Failures Detected'
                  : 'Ready for Batch Processing'
              }
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={loadInventory}
            disabled={loadingInventory || executingBatch}
            leftIcon={<RotateCw className={`w-3.5 h-3.5 ${loadingInventory ? 'animate-spin' : ''}`} />}
          >
            Refresh Inventory
          </Button>
        </div>

        <ResponsiveGrid cols={4} gap="md">
          <MetricCard
            density="compact"
            tone="positive"
            label="Analyzed"
            value={isInitialLoading ? '...' : hasInventoryLoaded ? totalAnalyzed : '—'}
            unit="articles in /articles"
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            secondaryContext="Verified Gemini structured intelligence in Firestore (/articles)"
            footerLeft={
              isInitialLoading
                ? 'Loading /articles telemetry...'
                : analyticsDailyTotal !== null
                ? `Analytics Daily (/analyticsDaily): ${analyticsDailyTotal}`
                : `Live /articles ANALYZED: ${hasInventoryLoaded ? totalAnalyzed : '—'}`
            }
            footerRight={
              analyticsDailyBrandBearing !== null
                ? `Brand-Bearing SOV: ${analyticsDailyBrandBearing}`
                : 'Scope: /articles Inventory'
            }
            isLoading={isInitialLoading}
          />

          <MetricCard
            density="compact"
            tone={remainingBacklog > 0 ? 'info' : 'nominal'}
            label="Pending Strategic"
            value={isInitialLoading ? '...' : hasInventoryLoaded ? remainingBacklog : '—'}
            unit="hardware articles"
            icon={<Layers className="w-4 h-4 text-indigo-400" />}
            secondaryContext={
              isInitialLoading
                ? 'Loading queue breakdown...'
                : `Historical queue: ${pendingHistorical} · Today's 06:00 window: ${pendingToday}`
            }
            footerLeft="Scope: 4 Hardware Categories"
            footerRight={`Retryable: ${isInitialLoading ? '...' : retryableFailures}`}
            isLoading={isInitialLoading}
          />

          <MetricCard
            density="compact"
            tone={progressPercent >= 95 ? 'positive' : 'info'}
            label="Strategic Completion"
            value={isInitialLoading ? '...' : hasInventoryLoaded ? `${progressPercent}%` : '—'}
            unit={
              isInitialLoading
                ? 'Loading...'
                : `${totalAnalyzed} / ${totalRelevant} strategic`
            }
            icon={<Sparkles className="w-4 h-4 text-indigo-400" />}
            secondaryContext={
              isInitialLoading
                ? 'Computing strategic completion ratio...'
                : `Formula: Analyzed (${totalAnalyzed}) ÷ [Analyzed (${totalAnalyzed}) + Pending Strategic (${remainingBacklog})]`
            }
            footerLeft={
              isInitialLoading ? 'Loading...' : `Denominator: ${totalRelevant} strategic`
            }
            footerRight={
              isInitialLoading
                ? 'Loading...'
                : `Excludes ${pendingOutOfScopeArticles + alreadySkippedArticles} out-of-scope`
            }
            isLoading={isInitialLoading}
          />

          <MetricCard
            density="compact"
            tone="nominal"
            label="Estimated Remaining Batches"
            value={isInitialLoading ? '...' : hasInventoryLoaded ? `~${estimatedRemainingBatches}` : '—'}
            unit={`@ ${batchSize} articles/batch`}
            icon={<Clock className="w-4 h-4 text-cyan-400" />}
            secondaryContext={
              isInitialLoading
                ? 'Calculating remaining batch estimate...'
                : pendingHistorical === 0
                ? '0 historical batches remaining (today’s items reserved for 06:00 run)'
                : `Computed from ${pendingHistorical} historical strategic articles ÷ ${batchSize}`
            }
            footerLeft="Daily Pipeline: ISOLATED"
            footerRight={isPaused ? 'State: PAUSED' : 'State: BOUNDED'}
            isLoading={isInitialLoading}
          />
        </ResponsiveGrid>
      </section>

      {/* =====================================================================
       * E2. PROCESSING PROGRESS & E3. PRIMARY BATCH ACTION
       * =================================================================== */}
      <section
        aria-label="Processing Progress and Primary Batch Action"
        className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4"
      >
        {/* E2. Processing Progress Bar & Denominator Clarity */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Strategic Hardware Backlog Completion
              </span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400"
                title={`Progress Formula: ${totalAnalyzed} Analyzed Strategic Articles ÷ (${totalAnalyzed} Analyzed + ${remainingBacklog} Pending Strategic) = ${progressPercent}%. Out-of-scope (${
                  pendingOutOfScopeArticles + alreadySkippedArticles
                }) and uncertain corporate (${pendingUncertainArticles}) items are excluded from the strategic hardware denominator.`}
              >
                <Info className="w-3 h-3 text-indigo-400" />
                <span>
                  {isInitialLoading
                    ? 'Loading strategic hardware denominator...'
                    : `Denominator: ${totalAnalyzed} / ${totalRelevant} strategic hardware articles`}
                </span>
              </span>
            </div>
            <span className="font-mono tabular-nums text-indigo-300 font-bold">
              {isInitialLoading ? 'Loading...' : `${progressPercent}% Completed`}
            </span>
          </div>

          <div className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${isInitialLoading ? 0 : progressPercent}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono tabular-nums text-slate-400 pt-0.5">
            <span>
              Completed:{' '}
              <strong className="text-emerald-400">
                {isInitialLoading ? '...' : `${totalAnalyzed} analyzed`}
              </strong>
            </span>
            <span>
              Historical Backlog:{' '}
              <strong className={pendingHistorical === 0 ? 'text-emerald-400' : 'text-indigo-300'}>
                {isInitialLoading ? '...' : `${pendingHistorical} remaining`}
              </strong>
            </span>
            {pendingToday > 0 && !isInitialLoading && (
              <span className="text-amber-300/90 font-medium">
                Today&apos;s Daily Pipeline Queue:{' '}
                <strong className="text-amber-200">{pendingToday} articles</strong>
              </span>
            )}
            <span>
              Estimated Remaining Batches:{' '}
              {isInitialLoading ? '...' : `~${estimatedRemainingBatches}`}
            </span>
          </div>
        </div>

        {/* Active Failure Warning if any retryable or permanent failures exist */}
        {(retryableFailures > 0 || permanentFailures > 0) && (
          <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/50 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-amber-200">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Queue Retry Telemetry: <strong>{retryableFailures}</strong> retryable failure(s) ·{' '}
                <strong>{permanentFailures}</strong> permanent failure(s) (capped at 3 attempts)
              </span>
            </span>
          </div>
        )}

        {/* E3. Primary Batch Action Area */}
        <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Batch Size Selector */}
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="backfill-batch-size" className="text-slate-300 font-mono font-medium">
                  Batch Size:
                </label>
                <select
                  id="backfill-batch-size"
                  value={batchSize}
                  disabled={!canManage || executingBatch}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  <option value={10}>10 Articles</option>
                  <option value={20}>20 Articles (Default)</option>
                  <option value={30}>30 Articles</option>
                  <option value={50}>50 Articles (Max)</option>
                </select>
              </div>

              {/* Preview Next Batch Button */}
              <button
                type="button"
                onClick={togglePreview}
                disabled={!canManage}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
              >
                {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPreview ? 'Hide Candidates' : 'Preview Next Batch'}</span>
              </button>
            </div>

            {/* Primary Execution Controls */}
            {checkpointError && <p role="alert" className="text-sm text-amber-300">{checkpointError}</p>}
            <div className="flex flex-wrap items-center gap-2.5">
              {isPaused ? (
                <button
                  type="button"
                  onClick={handleResume}
                  disabled={!canManage || !checkpointReady || executingBatch}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Resume Backfill</span>
                </button>
              ) : operationalState === 'AWAITING_DAILY_PIPELINE' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-[11px] font-mono text-amber-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Awaiting 06:00 Daily Pipeline ({pendingToday})</span>
                  </span>
                  <button
                    type="button"
                    disabled
                    title="Historical backlog is 100% complete. Today's articles are reserved for the autonomous 06:00 Daily Pipeline."
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 text-slate-400 border border-slate-700 cursor-not-allowed flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Run Next Batch (Complete)</span>
                  </button>
                </div>
              ) : operationalState === 'BACKLOG_COMPLETE' ? (
                <button
                  type="button"
                  disabled
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 cursor-default flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Backlog Clear (100%)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRunBatch}
                  disabled={!canManage || !checkpointReady || executingBatch || pendingHistorical === 0}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition disabled:opacity-50 shadow-md shadow-indigo-600/20 cursor-pointer"
                >
                  <Play
                    className={`w-3.5 h-3.5 fill-current ${executingBatch ? 'animate-pulse' : ''}`}
                  />
                  <span>{executingBatch ? 'Analyzing Batch...' : 'Run Next Batch'}</span>
                </button>
              )}

              {activeRunId && !isPaused && (
                <button
                  type="button"
                  onClick={handlePause}
                  disabled={!canManage || !checkpointReady || executingBatch}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              )}
            </div>
          </div>

          {/* Last Batch Result Telemetry */}
          {lastBatchResult && (
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Batch #{lastBatchResult.batchNumber} Completed ({lastBatchResult.durationMs}ms)
                </span>
                <span className="text-[11px] text-slate-400">Run ID: {lastBatchResult.runId}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-400 pt-1">
                <span>
                  Processed:{' '}
                  <strong className="text-slate-200">{lastBatchResult.itemsProcessed}</strong>
                </span>
                <span>
                  Succeeded:{' '}
                  <strong className="text-emerald-300">{lastBatchResult.itemsSucceeded}</strong>
                </span>
                <span>
                  Failed: <strong className="text-rose-300">{lastBatchResult.itemsFailed}</strong>
                </span>
                <span>
                  Gemini Calls:{' '}
                  <strong className="text-indigo-300">{lastBatchResult.geminiCallsUsed}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Candidate Preview Drawer */}
          {showPreview && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                <span className="font-semibold text-indigo-300">
                  Next Batch Candidates Preview ({previewCandidates.length})
                </span>
                <span className="text-[10px] text-slate-400">
                  Strictly 4 Strategic Categories • Historical Window Only
                </span>
              </div>

              {loadingPreview ? (
                <div className="p-6 flex items-center justify-center text-xs text-slate-400 font-mono">
                  Loading candidates preview...
                </div>
              ) : previewCandidates.length === 0 ? (
                <div className="p-6 text-center text-xs font-mono space-y-1.5">
                  {operationalState === 'AWAITING_DAILY_PIPELINE' ? (
                    <>
                      <div className="flex items-center justify-center gap-1.5 text-amber-300 font-semibold">
                        <Clock className="w-4 h-4 text-amber-400" />
                        <span>Historical Backlog Complete — Awaiting Daily Pipeline</span>
                      </div>
                      <p className="text-[11px] text-slate-400 max-w-lg mx-auto">
                        All historical strategic hardware articles have been processed.{' '}
                        {pendingToday} strategic article(s) published within the current
                        Europe/Athens 24h window are reserved for the autonomous 06:00 Daily
                        Pipeline.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-center gap-1.5 text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Backlog Complete</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        No pending strategic hardware candidates remaining.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto max-h-60">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] font-mono text-slate-400 uppercase">
                        <th className="pb-2">Title</th>
                        <th className="pb-2">Category</th>
                        <th className="pb-2">Company</th>
                        <th className="pb-2">Source</th>
                        <th className="pb-2">Published</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {previewCandidates.map((c, i) => (
                        <tr key={i} className="hover:bg-slate-900/40">
                          <td className="py-2 pr-3 max-w-xs truncate text-slate-200 font-medium">
                            {c.title}
                          </td>
                          <td className="py-2 pr-2 font-mono text-[11px] text-indigo-300">
                            {c.category}
                          </td>
                          <td className="py-2 pr-2 text-slate-300">{c.company}</td>
                          <td className="py-2 pr-2 text-slate-400">{c.sourceName}</td>
                          <td className="py-2 font-mono text-[10px] text-slate-400">
                            {c.publishedAt?.slice(0, 10)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* =====================================================================
       * E4. COLLAPSIBLE ADVANCED QUEUE DETAILS SECTION
       * =================================================================== */}
      <section
        aria-label="Advanced Queue Details"
        className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
      >
        <button
          type="button"
          onClick={() => setShowAdvancedQueueDetails((prev) => !prev)}
          aria-expanded={showAdvancedQueueDetails}
          className="w-full px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-100">Advanced Queue Details</h3>
              <SemanticBadge
                variant={isInitialLoading ? 'info' : 'verified'}
                label={
                  isInitialLoading
                    ? 'Loading...'
                    : categoryReconciliation.reconciliationBadgeLabel
                }
              />
            </div>
            <p className="text-xs text-slate-400">
              Complete Firestore queue inventory, 7-category reconciliation (4 strategic hardware + Corporate/Uncertain + Out-of-Scope + Legacy/Unclassified), and cross-module baseline alignment.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 font-mono text-xs text-slate-300">
            <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] tabular-nums">
              Total Stored: <strong>{isInitialLoading ? '...' : totalStoredArticles}</strong> · Raw Pending:{' '}
              <strong>{isInitialLoading ? '...' : rawPendingArticles}</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-indigo-400">
              <span>{showAdvancedQueueDetails ? 'Hide Details' : 'Show Queue Breakdown'}</span>
              {showAdvancedQueueDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </span>
          </div>
        </button>

        {showAdvancedQueueDetails && (
          <div className="p-5 border-t border-slate-800 space-y-6 bg-slate-950/30">
            {/* 1. Distinct Backlog Queues (Reconciled Metrics) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold uppercase tracking-wider">
                  1. Verified Firestore Inventory Queues
                </span>
                <span className="text-[11px] text-slate-400">
                  Retryable Failures: {retryableFailures} · Permanent Failures: {permanentFailures}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                {/* Total Stored */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block">
                    Total Stored
                  </span>
                  <span className="text-lg font-extrabold text-slate-100 font-mono tabular-nums">
                    {loadingInventory ? '...' : totalStoredArticles}
                  </span>
                  <span className="text-[9px] text-slate-500 block">All Firestore Docs</span>
                </div>

                {/* Raw Pending */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block">
                    Raw Pending
                  </span>
                  <span className="text-lg font-extrabold text-slate-300 font-mono tabular-nums">
                    {loadingInventory ? '...' : rawPendingArticles}
                  </span>
                  <span className="text-[9px] text-slate-500 block">Unprocessed queue</span>
                </div>

                {/* Already Analyzed */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-emerald-900/40 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-emerald-400 block">
                    AI Analyzed
                  </span>
                  <span className="text-lg font-extrabold text-emerald-300 font-mono tabular-nums">
                    {loadingInventory ? '...' : totalAnalyzed}
                  </span>
                  <span className="text-[9px] text-emerald-400/80 block">Verified Gemini Intel</span>
                </div>

                {/* Pending Strategic Hardware */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-indigo-900/40 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-indigo-400 block">
                    Pending Strategic
                  </span>
                  <span className="text-lg font-extrabold text-indigo-300 font-mono tabular-nums">
                    {loadingInventory ? '...' : remainingBacklog}
                  </span>
                  <span className="text-[9px] text-indigo-400/80 block">4 Hardware Categories</span>
                </div>

                {/* Corporate / Uncertain */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-amber-900/40 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-amber-400 block">
                    Corporate / Uncertain
                  </span>
                  <span className="text-lg font-extrabold text-amber-300 font-mono tabular-nums">
                    {loadingInventory ? '...' : pendingUncertainArticles}
                  </span>
                  <span className="text-[9px] text-amber-400/80 block">Preserved from LLM</span>
                </div>

                {/* Out of Scope Pending */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block">
                    Pending Out-of-Scope
                  </span>
                  <span className="text-lg font-extrabold text-slate-400 font-mono tabular-nums">
                    {loadingInventory ? '...' : pendingOutOfScopeArticles}
                  </span>
                  <span className="text-[9px] text-slate-500 block">GPU / Auto / Gaming</span>
                </div>

                {/* Already Skipped Out-of-Scope */}
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block">
                    Already Skipped
                  </span>
                  <span className="text-lg font-extrabold text-slate-400 font-mono tabular-nums">
                    {loadingInventory ? '...' : alreadySkippedArticles}
                  </span>
                  <span className="text-[9px] text-slate-500 block">SKIPPED_STRATEGIC</span>
                </div>
              </div>
            </div>

            {/* 2. Reconciled 7-Category Distribution (Zero Double Counting) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold uppercase tracking-wider">
                  2. Reconciled 7-Category Distribution (Total:{' '}
                  {isInitialLoading ? '...' : categoryReconciliation.totalStoredArticles})
                </span>
                <span
                  className={`text-[11px] ${
                    categoryReconciliation.isExactReconciliation
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {isInitialLoading
                    ? 'Loading 7-category distribution...'
                    : categoryReconciliation.reconciliationDetailLabel}
                </span>
              </div>

              <div
                className={`grid grid-cols-2 sm:grid-cols-3 ${
                  categoryReconciliation.legacyUnclassifiedCount > 0
                    ? 'lg:grid-cols-7'
                    : 'lg:grid-cols-6'
                } gap-2.5`}
              >
                {categoryReconciliation.buckets
                  .filter((b) => !b.isRemainderBucket || b.count > 0)
                  .map((bucket, idx) => (
                    <div
                      key={bucket.key}
                      className={`p-3 rounded-xl bg-slate-950/60 border space-y-0.5 ${
                        bucket.key === 'CORPORATE_UNCERTAIN'
                          ? 'border-amber-900/30'
                          : bucket.key === 'OUT_OF_SCOPE' || bucket.key === 'LEGACY_UNCLASSIFIED'
                          ? 'border-slate-800'
                          : 'border-indigo-900/30'
                      }`}
                    >
                      <span
                        className={`text-[10px] font-mono block ${
                          bucket.key === 'CORPORATE_UNCERTAIN'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {idx + 1}. {bucket.label}
                      </span>
                      <span
                        className={`text-base font-bold font-mono tabular-nums ${
                          bucket.key === 'CORPORATE_UNCERTAIN'
                            ? 'text-amber-300'
                            : bucket.key === 'OUT_OF_SCOPE' || bucket.key === 'LEGACY_UNCLASSIFIED'
                            ? 'text-slate-300'
                            : 'text-indigo-300'
                        }`}
                      >
                        {bucket.count}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* 3. Cross-Module Denominator Reconciliation Note */}
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
              <span className="font-semibold text-slate-200 block font-mono text-[11px] uppercase">
                3. Cross-Module Analyzed Article Reconciliation (Backfill vs. Analytics)
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-emerald-300 font-mono">{totalAnalyzed} articles</strong> are
                marked <code>ANALYZED</code> in live Firestore <code>/articles</code> inventory.{' '}
                {analyticsDailyTotal !== null ? (
                  <>
                    <strong className="text-indigo-300 font-mono">
                      {analyticsDailyTotal} articles
                    </strong>{' '}
                    are committed in persistent <code>/analyticsDaily</code> historical buckets (of
                    which{' '}
                    <strong className="text-cyan-300 font-mono">
                      {analyticsDailyBrandBearing ?? 0} articles
                    </strong>{' '}
                    contain tracked competitor mentions used as the V2 Share of Voice coverage
                    denominator).
                  </>
                ) : (
                  <>
                    Persistent <code>/analyticsDaily</code> daily rollups aggregate date-bucketed
                    strategic articles (including brand-bearing SOV coverage) independently of the raw{' '}
                    <code>/articles</code> processing queue.
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* =====================================================================
       * E5. COLLAPSIBLE ADMINISTRATIVE MAINTENANCE SECTION
       * Clearly separates Read-Only Preview, Dry-Run Simulation, and Mutating Execution.
       * =================================================================== */}
      <section
        aria-label="Administrative Maintenance"
        className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
      >
        <button
          type="button"
          onClick={() => setShowAdminMaintenance((prev) => !prev)}
          aria-expanded={showAdminMaintenance}
          className="w-full px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-100">Administrative Maintenance</h3>
              <SemanticBadge variant="review" label="ADMIN ONLY" />
            </div>
            <p className="text-xs text-slate-400">
              Safe Legacy Out-of-Scope Backlog Cleanup (
              {isInitialLoading ? '...' : `${pendingOutOfScopeArticles} items`}), Dry-Run Audit,
              and Corporate &amp; Ecosystem Intelligence Review (
              {isInitialLoading ? '...' : `${pendingUncertainArticles} items`}).
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 font-mono text-xs text-indigo-400">
            <span>
              {showAdminMaintenance ? 'Hide Maintenance Tools' : 'Open Maintenance Tools'}
            </span>
            {showAdminMaintenance ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </button>

        {showAdminMaintenance && (
          <div className="p-5 border-t border-slate-800 space-y-6 bg-slate-950/30">
            {/* Tool 1: Safe Legacy Out-of-Scope Backlog Cleanup */}
            <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wide">
                        Safe Legacy Out-of-Scope Backlog Cleanup
                      </h4>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                        NON-DESTRUCTIVE · 0 GEMINI CALLS
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Transition {pendingOutOfScopeArticles} confirmed non-hardware PENDING articles
                      to <code className="text-slate-300">SKIPPED_STRATEGIC_SCOPE</code> without
                      invoking Gemini.
                    </p>
                  </div>
                </div>

                {/* Step 1 (Read-Only Preview) & Step 2 (Dry-Run Simulation) */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePreviewCleanup}
                    disabled={!canManage || loadingCleanupPreview}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>1. Preview Candidates ({pendingOutOfScopeArticles})</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRunCleanupDryRun}
                    disabled={!canManage || executingCleanup}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-800/60 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                  >
                    <span>2. Run Dry-Run Audit (0 Writes)</span>
                  </button>
                </div>
              </div>

              {/* Step 3: Explicit Confirmation & Mutating Execution */}
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-rose-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <label className="flex items-start sm:items-center gap-2.5 cursor-pointer text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={confirmCleanupCheck}
                    onChange={(e) => setConfirmCleanupCheck(e.target.checked)}
                    disabled={!canManage || executingCleanup}
                    className="mt-0.5 sm:mt-0 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 w-4 h-4"
                  />
                  <span className="text-[11px] leading-relaxed">
                    <strong className="text-rose-300 uppercase font-mono mr-1.5">
                      Step 3 — Mutating Action:
                    </strong>
                    I explicitly confirm transition of confirmed out-of-scope articles to{' '}
                    <strong className="text-slate-100">SKIPPED_STRATEGIC_SCOPE</strong>.
                    Non-destructive status update, zero Gemini calls.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleExecuteCleanupMutation}
                  disabled={!canManage || !confirmCleanupCheck || executingCleanup}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white transition flex items-center gap-1.5 shrink-0 shadow-sm cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{executingCleanup ? 'Executing Cleanup...' : 'Execute Safe Cleanup'}</span>
                </button>
              </div>

              {/* Cleanup Result Telemetry */}
              {cleanupResult && (
                <div className="p-3.5 rounded-xl bg-slate-900 border border-indigo-900/40 text-xs font-mono space-y-1.5">
                  <div className="flex items-center justify-between text-indigo-300 font-semibold">
                    <span>
                      {cleanupResult.dryRun
                        ? 'DRY-RUN AUDIT RESULT (0 WRITES)'
                        : 'CLEANUP MUTATION EXECUTED'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Audit ID: {cleanupResult.auditId}
                    </span>
                  </div>
                  <p className="text-slate-300">{cleanupResult.message}</p>
                  <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-slate-400">
                    <span>Scanned: {cleanupResult.totalPendingScanned}</span>
                    <span>Eligible: {cleanupResult.eligibleOutOfScopeCount}</span>
                    <span>Updated: {cleanupResult.updatedCount}</span>
                    <span>Batches: {cleanupResult.batchesCommitted}</span>
                  </div>
                </div>
              )}

              {/* Cleanup Preview Table */}
              {showCleanupPreview && cleanupPreview && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-mono text-slate-300 pb-2 border-b border-slate-800">
                    <span className="font-semibold text-rose-300">
                      Sample Out-of-Scope Candidates ({cleanupPreview.sampleCandidates.length} of{' '}
                      {cleanupPreview.outOfScopeCandidatesCount})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCleanupPreview(false)}
                      className="text-slate-400 hover:text-slate-200 text-[11px] cursor-pointer"
                    >
                      Close Preview
                    </button>
                  </div>
                  <div className="overflow-x-auto max-h-52">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[10px] font-mono text-slate-500 uppercase border-b border-slate-800 pb-1">
                          <th className="pb-1">Title</th>
                          <th className="pb-1">Source</th>
                          <th className="pb-1">Reason</th>
                          <th className="pb-1">Published</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {cleanupPreview.sampleCandidates.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-900/40">
                            <td className="py-1.5 pr-2 max-w-xs truncate text-slate-300">
                              {c.title}
                            </td>
                            <td className="py-1.5 pr-2 text-slate-400 font-mono text-[10px]">
                              {c.sourceName}
                            </td>
                            <td className="py-1.5 pr-2 text-rose-300/80 font-mono text-[10px]">
                              {c.skipReason}
                            </td>
                            <td className="py-1.5 text-slate-500 font-mono text-[10px]">
                              {c.publishedAt?.slice(0, 10)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Tool 2: Corporate & Ecosystem Intelligence Review Section */}
            <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wide">
                        Corporate &amp; Ecosystem Intelligence Review ({pendingUncertainArticles}{' '}
                        Articles)
                      </h4>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        READ-ONLY · CONSERVATIVE POLICY
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Articles mention tracked companies but lack explicit hardware models.
                      Preserved from automatic Gemini calls.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePreviewUncertain}
                  disabled={!canManage || loadingUncertainPreview}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>
                    {showUncertainPreview
                      ? 'Refresh Uncertain'
                      : `Preview ${pendingUncertainArticles} Articles`}
                  </span>
                </button>
              </div>

              {/* Uncertain Preview Drawer */}
              {showUncertainPreview && uncertainPreview && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-mono text-slate-300 pb-2 border-b border-slate-800">
                    <span className="font-semibold text-amber-300">
                      Uncertain Articles ({uncertainPreview.candidates.length}) with Heuristic
                      Subtype
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowUncertainPreview(false)}
                      className="text-slate-400 hover:text-slate-200 text-[11px] cursor-pointer"
                    >
                      Close Preview
                    </button>
                  </div>
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[10px] font-mono text-slate-500 uppercase border-b border-slate-800 pb-1">
                          <th className="pb-1">Company</th>
                          <th className="pb-1">Title</th>
                          <th className="pb-1">Subtype Recommendation</th>
                          <th className="pb-1">Notes</th>
                          <th className="pb-1">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {uncertainPreview.candidates.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-900/40">
                            <td className="py-1.5 pr-2 font-mono text-indigo-300 font-semibold">
                              {c.company}
                            </td>
                            <td className="py-1.5 pr-2 max-w-xs truncate text-slate-300">
                              {c.title}
                            </td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                  c.recommendation === 'CONSUMER_ECOSYSTEM_REVIEW'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                                }`}
                              >
                                {c.recommendation}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-slate-400 text-[11px]">{c.notes}</td>
                            <td className="py-1.5 text-slate-500 font-mono text-[10px]">
                              {c.publishedAt?.slice(0, 10)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

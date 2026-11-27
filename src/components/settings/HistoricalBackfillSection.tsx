/**
 * Signalyn Historical Backfill Control & Progress Section
 *
 * Presents a clean, executive-grade overview of historical article analysis
 * progress, plain-language operational status, bounded batch controls,
 * actionable failure review entry point, and a collapsed Administrator-Only
 * Advanced Details section.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  XCircle,
  Filter,
  HelpCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { aiIntelligenceService } from '../../services/aiIntelligenceService';
import {
  BacklogInventory,
  BackfillBatchResult,
  OutOfScopeCleanupPreview,
  OutOfScopeCleanupResult,
  UncertainArticlesPreview,
} from '../../types';
import { FailedArticlesRecoveryPanel } from '../backfill/FailedArticlesRecoveryPanel';

interface HistoricalBackfillSectionProps {
  canManage: boolean;
}

export const HistoricalBackfillSection: React.FC<HistoricalBackfillSectionProps> = ({ canManage }) => {
  // Core inventory & live pipeline status
  const [inventory, setInventory] = useState<BacklogInventory | null>(null);
  const [loadingInventory, setLoadingInventory] = useState<boolean>(false);
  const [pipelineActive, setPipelineActive] = useState<boolean>(false);

  // Batch controls & checkpoint state
  const [batchSize, setBatchSize] = useState<number>(20);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [executingBatch, setExecutingBatch] = useState<boolean>(false);
  const [lastBatchResult, setLastBatchResult] = useState<BackfillBatchResult | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState<boolean>(false);

  // Preview next batch
  const [previewCandidates, setPreviewCandidates] = useState<any[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);

  // Messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Failed Articles Review modal
  const [reviewPanelOpen, setReviewPanelOpen] = useState<boolean>(false);

  // Collapsed Administrator-Only Advanced Details
  const [showAdvancedDetails, setShowAdvancedDetails] = useState<boolean>(false);

  // Advanced Maintenance sub-tools (inside Advanced Details)
  const [cleanupPreview, setCleanupPreview] = useState<OutOfScopeCleanupPreview | null>(null);
  const [loadingCleanupPreview, setLoadingCleanupPreview] = useState<boolean>(false);
  const [cleanupDryRunResult, setCleanupDryRunResult] = useState<OutOfScopeCleanupResult | null>(null);
  const [executingCleanup, setExecutingCleanup] = useState<boolean>(false);
  const [confirmCleanupDialog, setConfirmCleanupDialog] = useState<boolean>(false);
  const [uncertainPreview, setUncertainPreview] = useState<UncertainArticlesPreview | null>(null);
  const [loadingUncertainPreview, setLoadingUncertainPreview] = useState<boolean>(false);

  const fetchInventory = useCallback(async () => {
    setLoadingInventory(true);
    setErrorMessage(null);
    try {
      const [inv, checkpoint, pipelineStatus] = await Promise.all([
        aiIntelligenceService.getBacklogInventory(),
        aiIntelligenceService.getHistoricalBackfillCheckpoint().catch(() => null),
        aiIntelligenceService.getPipelineStatus().catch(() => null),
      ]);
      setInventory(inv);
      if (checkpoint) {
        setActiveRunId(checkpoint.runId);
        setIsPaused(checkpoint.isPaused);
      } else {
        setActiveRunId(null);
        setIsPaused(false);
      }
      setPipelineActive(Boolean(pipelineStatus?.isRunning || pipelineStatus?.lease?.active));
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not load historical backfill status.');
    } finally {
      setLoadingInventory(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const handlePreviewCandidates = async () => {
    setLoadingPreview(true);
    setErrorMessage(null);
    try {
      const candidates = await aiIntelligenceService.previewEligibleArticles(batchSize, activeRunId || undefined);
      setPreviewCandidates(candidates);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not preview upcoming articles.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleExecuteBatch = async () => {
    if (!canManage || executingBatch) return;
    setExecutingBatch(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setConfirmCancelOpen(false);

    try {
      // If paused on an existing checkpoint, resume before executing next batch
      if (activeRunId && isPaused) {
        await aiIntelligenceService.resumeBackfill(activeRunId);
        setIsPaused(false);
      }

      const res = await aiIntelligenceService.executeBackfillBatch({
        batchSize,
        runId: activeRunId || undefined,
      });

      setLastBatchResult(res);

      if (res.isCompleted) {
        setActiveRunId(null);
        setIsPaused(false);
        setSuccessMessage(
          res.itemsProcessed > 0
            ? `Batch complete: ${res.itemsSucceeded} article(s) analyzed.`
            : 'All currently eligible historical articles have been processed.'
        );
      } else if (res.yieldedToDailyPipeline) {
        setActiveRunId(res.runId);
        setIsPaused(true);
        setPipelineActive(true);
        setSuccessMessage(
          `Paused for the daily update after analyzing ${res.itemsSucceeded} article(s). You can resume when the daily update finishes.`
        );
      } else {
        setActiveRunId(res.runId);
        setIsPaused(res.isPaused);
        setSuccessMessage(
          `Batch ${res.batchNumber} complete: ${res.itemsSucceeded} analyzed${
            res.itemsSkipped > 0 ? `, ${res.itemsSkipped} already covered` : ''
          }.`
        );
      }

      setPreviewCandidates(null);
      await fetchInventory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Historical analysis batch failed.';
      setErrorMessage(msg);
      if (msg.toLowerCase().includes('daily pipeline')) {
        setPipelineActive(true);
      }
      await fetchInventory();
    } finally {
      setExecutingBatch(false);
    }
  };

  const handlePause = async () => {
    if (!activeRunId || !canManage) return;
    setErrorMessage(null);
    try {
      await aiIntelligenceService.pauseBackfill(activeRunId);
      setIsPaused(true);
      setSuccessMessage('Historical analysis paused. Progress has been saved.');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not pause historical analysis.');
    }
  };

  const handleCancelRun = async () => {
    if (!activeRunId || !canManage) return;
    setErrorMessage(null);
    try {
      await aiIntelligenceService.cancelBackfill(activeRunId);
      setActiveRunId(null);
      setIsPaused(false);
      setConfirmCancelOpen(false);
      setSuccessMessage('Current analysis run cancelled. Previously analyzed articles are preserved.');
      await fetchInventory();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not cancel run.');
    }
  };

  // Advanced Maintenance Handlers
  const handlePreviewOutOfScope = async () => {
    setLoadingCleanupPreview(true);
    setErrorMessage(null);
    setCleanupDryRunResult(null);
    try {
      const preview = await aiIntelligenceService.previewOutOfScopeCleanup(50);
      setCleanupPreview(preview);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to preview out-of-scope articles.');
    } finally {
      setLoadingCleanupPreview(false);
    }
  };

  const handleRunCleanupDryRun = async () => {
    setExecutingCleanup(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await aiIntelligenceService.executeOutOfScopeCleanup({
        dryRun: true,
        confirmCleanup: false,
      });
      setCleanupDryRunResult(res);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Dry-run simulation failed.');
    } finally {
      setExecutingCleanup(false);
    }
  };

  const handleExecuteCleanupConfirmed = async () => {
    if (!canManage) return;
    setExecutingCleanup(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await aiIntelligenceService.executeOutOfScopeCleanup({
        dryRun: false,
        confirmCleanup: true,
        batchLimit: 1200,
      });
      setCleanupDryRunResult(res);
      setConfirmCleanupDialog(false);
      setSuccessMessage(`Cleaned up ${res.updatedCount} out-of-scope pending article(s).`);
      await fetchInventory();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Out-of-scope cleanup failed.');
    } finally {
      setExecutingCleanup(false);
    }
  };

  const handlePreviewUncertain = async () => {
    setLoadingUncertainPreview(true);
    setErrorMessage(null);
    try {
      const preview = await aiIntelligenceService.previewUncertainArticles(80);
      setUncertainPreview(preview);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to preview uncertain corporate articles.');
    } finally {
      setLoadingUncertainPreview(false);
    }
  };

  // Canonical KPI Calculations (strictly consistent with live inventory)
  const isInitialLoading = loadingInventory && !inventory;
  const analyzedCount = inventory ? inventory.alreadyAnalyzedArticles : 0;
  const historicalPending = inventory
    ? (inventory.pendingHistoricalStrategicArticles ?? inventory.pendingStrategicallyRelevantArticles)
    : 0;
  const todayReserved = inventory ? (inventory.pendingTodayStrategicArticles ?? 0) : 0;
  const retryableFailures = inventory ? inventory.failedArticlesEligibleForRetry : 0;
  const permanentFailures = inventory ? inventory.permanentFailures : 0;
  const archivedFailures = inventory ? (inventory.archivedFailedArticles ?? 0) : 0;
  const actionableFailures =
    inventory?.actionableFailedArticles ?? retryableFailures + permanentFailures;

  const articlesRemaining = historicalPending + retryableFailures;
  const strategicTotal = analyzedCount + historicalPending + todayReserved + retryableFailures;
  const completionPct =
    strategicTotal > 0 ? Math.min(100, Math.round((analyzedCount / strategicTotal) * 100)) : 0;
  const estimatedBatchesRemaining =
    articlesRemaining > 0 ? Math.ceil(articlesRemaining / Math.max(1, batchSize)) : 0;

  // Plain-language operational status
  const statusBanner = pipelineActive
    ? {
        dot: 'bg-amber-400',
        tone: 'border-amber-800/60 bg-amber-950/25 text-amber-200',
        headline: 'Daily update in progress',
        detail: 'Historical analysis is temporarily paused until today’s daily update completes.',
      }
    : executingBatch
    ? {
        dot: 'bg-indigo-400 animate-pulse',
        tone: 'border-indigo-700/60 bg-indigo-950/30 text-indigo-200',
        headline: 'Analyzing historical batch...',
        detail: `Processing up to ${batchSize} archived articles in this batch.`,
      }
    : isPaused
    ? {
        dot: 'bg-amber-400',
        tone: 'border-amber-800/50 bg-amber-950/20 text-amber-200',
        headline: 'Historical analysis temporarily paused',
        detail: 'Progress is saved. Select Continue Analysis whenever you are ready to proceed.',
      }
    : {
        dot: 'bg-emerald-400',
        tone: 'border-slate-800 bg-slate-900/90 text-slate-200',
        headline: 'Ready for historical analysis',
        detail: 'Daily update scheduled for 06:00. Today’s articles remain reserved for the daily run.',
      };

  const reconciliationCategories = inventory
    ? [
        { label: 'Smartphones', count: inventory.countsByCategory.SMARTPHONE || 0 },
        { label: 'Wearables', count: inventory.countsByCategory.WEARABLE || 0 },
        { label: 'Audio', count: inventory.countsByCategory.AUDIO || 0 },
        { label: 'Tablets', count: inventory.countsByCategory.TABLET || 0 },
        { label: 'Corporate / Uncertain', count: inventory.countsByCategory.CORPORATE_UNCERTAIN || 0 },
        { label: 'Out of Scope', count: inventory.countsByCategory.OUT_OF_SCOPE || 0 },
        { label: 'Legacy / Unclassified', count: inventory.countsByCategory.LEGACY_UNCLASSIFIED || 0 },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Error / Success Feedback */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/70 text-xs text-rose-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-950/35 border border-emerald-800/60 text-xs text-emerald-200 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 1. FOUR CLEAN SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5">
          <span className="text-xs font-medium text-slate-400 block">Articles Analyzed</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-emerald-400">
            {isInitialLoading ? '—' : analyzedCount.toLocaleString()}
          </div>
          <p className="text-xs text-slate-500">Completed across tracked categories</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5">
          <span className="text-xs font-medium text-slate-400 block">Articles Remaining</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-indigo-300">
            {isInitialLoading ? '—' : articlesRemaining.toLocaleString()}
          </div>
          <p className="text-xs text-slate-500">Archived articles queued for analysis</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5">
          <span className="text-xs font-medium text-slate-400 block">Analysis Progress</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-slate-100">
            {isInitialLoading ? '—' : `${completionPct}%`}
          </div>
          <p className="text-xs text-slate-500">
            {isInitialLoading
              ? 'Loading coverage...'
              : `Of ${strategicTotal.toLocaleString()} relevant articles`}
          </p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5">
          <span className="text-xs font-medium text-slate-400 block">Estimated Batches Remaining</span>
          <div className="text-3xl font-bold font-mono tabular-nums text-slate-100">
            {isInitialLoading ? '—' : estimatedBatchesRemaining.toLocaleString()}
          </div>
          <p className="text-xs text-slate-500">At {batchSize} articles per batch</p>
        </div>
      </div>

      {/* 2. PROGRESS BAR & QUEUE EXPLANATION */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Historical Coverage Progress</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Today’s newly published articles are handled automatically by the daily update, while historical backfill analyzes older archived coverage.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchInventory}
            disabled={loadingInventory || executingBatch}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingInventory ? 'animate-spin' : ''}`} />
            <span>Refresh Counts</span>
          </button>
        </div>

        <div className="space-y-2">
          <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="font-mono tabular-nums">
              {analyzedCount.toLocaleString()} analyzed · {articlesRemaining.toLocaleString()} historical remaining
            </span>
            <span className="font-mono tabular-nums text-slate-500">
              {todayReserved.toLocaleString()} reserved for today’s daily update
            </span>
          </div>
        </div>
      </div>

      {/* 3. OPERATIONAL STATUS & ANALYSIS CONTROLS */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        {/* Live Status Row */}
        <div className={`px-4 py-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${statusBanner.tone}`}>
          <div className="flex items-start sm:items-center gap-2.5">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 sm:mt-0 ${statusBanner.dot}`} />
            <div>
              <p className="text-xs font-semibold">{statusBanner.headline}</p>
              <p className="text-[11px] opacity-80">{statusBanner.detail}</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0">
            <Clock className="w-3.5 h-3.5" />
            <span>Daily update: 06:00</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span className="font-medium text-slate-400">Batch Size</span>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                disabled={executingBatch}
                aria-label="Batch size"
                className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                <option value={10}>10 articles</option>
                <option value={20}>20 articles</option>
                <option value={30}>30 articles</option>
                <option value={50}>50 articles</option>
              </select>
            </label>

            <button
              type="button"
              onClick={handlePreviewCandidates}
              disabled={loadingPreview || executingBatch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
            >
              {loadingPreview ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>Preview Next Batch</span>
            </button>
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleExecuteBatch}
                disabled={executingBatch || pipelineActive || articlesRemaining === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
              >
                {executingBatch ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing Batch...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>{activeRunId ? 'Continue Analysis' : 'Start Analysis'}</span>
                  </>
                )}
              </button>

              {activeRunId && !isPaused && (
                <button
                  type="button"
                  onClick={handlePause}
                  disabled={executingBatch}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-300 border border-amber-900/50 text-xs font-semibold transition cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Analysis</span>
                </button>
              )}

              {activeRunId && !confirmCancelOpen && (
                <button
                  type="button"
                  onClick={() => setConfirmCancelOpen(true)}
                  disabled={executingBatch}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-400 hover:text-rose-300 text-xs font-medium transition cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>
              )}

              {activeRunId && confirmCancelOpen && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800/70 text-xs">
                  <span className="text-rose-200">End current run?</span>
                  <button
                    type="button"
                    onClick={handleCancelRun}
                    className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCancelOpen(false)}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  >
                    Keep
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Last Batch Summary */}
        {lastBatchResult && (
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4 text-slate-300 font-mono tabular-nums">
              <span>Processed: <strong className="text-slate-100">{lastBatchResult.itemsProcessed}</strong></span>
              <span>Analyzed: <strong className="text-emerald-400">{lastBatchResult.itemsSucceeded}</strong></span>
              {lastBatchResult.itemsSkipped > 0 && (
                <span>Skipped: <strong className="text-slate-400">{lastBatchResult.itemsSkipped}</strong></span>
              )}
              {lastBatchResult.itemsFailed > 0 && (
                <span>Failed: <strong className="text-amber-400">{lastBatchResult.itemsFailed}</strong></span>
              )}
              <span className="text-slate-500">{(lastBatchResult.durationMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
        )}

        {/* Next Batch Preview List */}
        {previewCandidates && (
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Next Batch Preview ({previewCandidates.length} article{previewCandidates.length === 1 ? '' : 's'})
              </span>
              <button
                type="button"
                onClick={() => setPreviewCandidates(null)}
                className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>
            {previewCandidates.length === 0 ? (
              <p className="p-4 text-xs text-slate-400">No historical articles are currently waiting in the queue.</p>
            ) : (
              <div className="divide-y divide-slate-800/70 max-h-60 overflow-y-auto bg-slate-950/40">
                {previewCandidates.map((item) => (
                  <div key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="text-slate-200 font-medium truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-500">
                        {item.sourceName}
                        {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-semibold shrink-0">
                      {item.category}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. ACTIONABLE FAILURE REVIEW NOTICE (Auto-hides when 0 failures remain) */}
      {!isInitialLoading && actionableFailures > 0 && (
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <p className="text-xs font-semibold text-amber-100">
                Some historical articles require review.
              </p>
              <p className="text-xs text-amber-200/75 mt-0.5">
                {actionableFailures.toLocaleString()} historical article{actionableFailures === 1 ? '' : 's'} could not be analyzed automatically.
              </p>
            </div>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={() => setReviewPanelOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition shrink-0 cursor-pointer"
            >
              <span>Review Articles</span>
            </button>
          )}
        </div>
      )}

      {/* 5. COLLAPSED ADMINISTRATOR-ONLY ADVANCED DETAILS */}
      {canManage && (
        <section className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvancedDetails((prev) => !prev)}
            aria-expanded={showAdvancedDetails}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="w-4 h-4 text-slate-400" />
              <div>
                <span className="text-xs font-semibold text-slate-200 block">Advanced Details</span>
                <span className="text-[11px] text-slate-500 block">
                  Administrator safeguards, 7-category reconciliation, backlog cleanup, and diagnostic counters
                </span>
              </div>
            </div>
            {showAdvancedDetails ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showAdvancedDetails && (
            <div className="p-5 border-t border-slate-800 space-y-6 text-xs">
              {/* Safeguards Summary */}
              <div className="space-y-2.5">
                <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>Processing Safeguards</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-slate-400">
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="font-semibold text-slate-200 block">Four Hardware Categories</span>
                    <p className="text-[11px] leading-relaxed">
                      Analysis is restricted to Smartphones, Wearables, Audio, and Tablets. Non-hardware articles remain skipped to avoid unnecessary processing.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="font-semibold text-slate-200 block">Daily Update Priority</span>
                    <p className="text-[11px] leading-relaxed">
                      Distributed lease locks prevent overlap. If the scheduled 06:00 daily update starts, historical backfill pauses cleanly between chunks.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="font-semibold text-slate-200 block">Durable Checkpoints</span>
                    <p className="text-[11px] leading-relaxed">
                      Each batch saves progress durably. Already-analyzed articles are skipped automatically and raw articles are preserved non-destructively.
                    </p>
                  </div>
                </div>
              </div>

              {/* 7-Category Reconciliation */}
              {inventory && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold text-slate-200">
                      7-Category Article Reconciliation
                    </h4>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      Total stored articles: {inventory.totalStoredArticles.toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {reconciliationCategories.map((cat) => (
                      <div
                        key={cat.label}
                        className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-0.5"
                      >
                        <span className="text-[10px] text-slate-400 block truncate">{cat.label}</span>
                        <span className="text-sm font-bold font-mono tabular-nums text-slate-100 block">
                          {cat.count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-400 pt-1">
                    <span>Skipped out of scope: {(inventory.alreadySkippedArticles ?? 0).toLocaleString()}</span>
                    <span>Pending out of scope: {inventory.pendingOutOfScopeArticles.toLocaleString()}</span>
                    <span>Retryable failures: {retryableFailures.toLocaleString()}</span>
                    <span>Permanent failures: {permanentFailures.toLocaleString()}</span>
                    <span>Archived failures: {archivedFailures.toLocaleString()}</span>
                    {activeRunId && <span>Checkpoint: {activeRunId}</span>}
                  </div>
                </div>
              )}

              {/* Administrator Maintenance Tools */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                {/* Tool A: Out-of-Scope Cleanup */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Out-of-Scope Backlog Cleanup</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {inventory?.pendingOutOfScopeArticles ?? 0} pending
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Mark pending non-hardware articles as out of scope without invoking AI analysis.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePreviewOutOfScope}
                      disabled={loadingCleanupPreview}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer disabled:opacity-50"
                    >
                      {loadingCleanupPreview ? 'Loading...' : 'Preview Candidates'}
                    </button>
                    <button
                      type="button"
                      onClick={handleRunCleanupDryRun}
                      disabled={executingCleanup}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-medium transition cursor-pointer disabled:opacity-50"
                    >
                      {executingCleanup ? 'Simulating...' : 'Run Dry-Run'}
                    </button>
                    {cleanupDryRunResult?.dryRun && cleanupDryRunResult.eligibleOutOfScopeCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmCleanupDialog(true)}
                        disabled={executingCleanup}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition cursor-pointer"
                      >
                        Apply Cleanup ({cleanupDryRunResult.eligibleOutOfScopeCount})
                      </button>
                    )}
                  </div>

                  {cleanupDryRunResult && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
                      {cleanupDryRunResult.message}
                    </div>
                  )}

                  {confirmCleanupDialog && cleanupDryRunResult && (
                    <div className="p-3 rounded-lg bg-amber-950/35 border border-amber-800/60 space-y-2">
                      <p className="text-[11px] text-amber-200">
                        Confirm marking {cleanupDryRunResult.eligibleOutOfScopeCount} pending out-of-scope article(s) as skipped?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleExecuteCleanupConfirmed}
                          disabled={executingCleanup}
                          className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          {executingCleanup ? 'Applying...' : 'Confirm Cleanup'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmCleanupDialog(false)}
                          className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {cleanupPreview && (
                    <div className="max-h-36 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/80">
                      {cleanupPreview.sampleCandidates.length === 0 ? (
                        <p className="p-2.5 text-[11px] text-slate-400">No pending out-of-scope articles found.</p>
                      ) : (
                        cleanupPreview.sampleCandidates.slice(0, 10).map((c) => (
                          <div key={c.id} className="p-2 text-[11px] text-slate-300 truncate">
                            {c.title} <span className="text-slate-500">· {c.sourceName}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Tool B: Uncertain Corporate Articles Review */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Corporate / Uncertain Articles</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {inventory?.pendingUncertainArticles ?? 0} held
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Read-only inspection of corporate or ecosystem articles held outside automatic hardware backfill.
                  </p>
                  <button
                    type="button"
                    onClick={handlePreviewUncertain}
                    disabled={loadingUncertainPreview}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer disabled:opacity-50"
                  >
                    {loadingUncertainPreview ? 'Loading...' : 'Inspect Held Articles'}
                  </button>

                  {uncertainPreview && (
                    <div className="max-h-36 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/80">
                      {uncertainPreview.candidates.length === 0 ? (
                        <p className="p-2.5 text-[11px] text-slate-400">No uncertain articles currently held.</p>
                      ) : (
                        uncertainPreview.candidates.slice(0, 12).map((u) => (
                          <div key={u.id} className="p-2 text-[11px] text-slate-300 flex items-center justify-between gap-2">
                            <span className="truncate">{u.title}</span>
                            <span className="text-[10px] text-slate-500 shrink-0">{u.company}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Admin Failed Articles Recovery Modal */}
      {canManage && (
        <FailedArticlesRecoveryPanel
          isOpen={reviewPanelOpen}
          onClose={() => setReviewPanelOpen(false)}
          onRecoveryComplete={fetchInventory}
        />
      )}
    </div>
  );
};

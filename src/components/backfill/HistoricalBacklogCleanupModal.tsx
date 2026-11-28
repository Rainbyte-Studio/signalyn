/**
 * Signalyn Administrator-Only Historical Backlog Cleanup Modal
 *
 * Read-only preview -> Dry-run verification -> Explicit administrator confirmation
 * -> Bounded, idempotent deletion of strictly unreferenced historical backlog records.
 * Zero Gemini API calls. Preserves all analyzed articles, Stories, articleAnalysis,
 * analyticsLedger, analyticsDaily, Daily Briefs, Entity Reviews, Sources, Daily Pipeline
 * window articles, and Corporate/Uncertain articles pending strategic review.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  ShieldCheck,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Database,
} from 'lucide-react';
import { aiIntelligenceService } from '../../services/aiIntelligenceService';
import {
  HistoricalBacklogCleanupPreview,
  HistoricalBacklogCleanupResult,
} from '../../types';

interface HistoricalBacklogCleanupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCleanupComplete: () => Promise<void> | void;
}

export const HistoricalBacklogCleanupModal: React.FC<HistoricalBacklogCleanupModalProps> = ({
  isOpen,
  onClose,
  onCleanupComplete,
}) => {
  const [preview, setPreview] = useState<HistoricalBacklogCleanupPreview | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [dryRunResult, setDryRunResult] = useState<HistoricalBacklogCleanupResult | null>(null);
  const [runningDryRun, setRunningDryRun] = useState<boolean>(false);
  const [confirmedChecked, setConfirmedChecked] = useState<boolean>(false);
  const [executingDelete, setExecutingDelete] = useState<boolean>(false);
  const [finalResult, setFinalResult] = useState<HistoricalBacklogCleanupResult | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDryRunResult(null);
    setFinalResult(null);
    setConfirmedChecked(false);
    try {
      const data = await aiIntelligenceService.previewHistoricalBacklogCleanup(5);
      setPreview(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load live cleanup preview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadPreview();
    }
  }, [isOpen, loadPreview]);

  if (!isOpen) return null;

  const handleRunDryRun = async () => {
    setRunningDryRun(true);
    setError(null);
    setConfirmedChecked(false);
    try {
      const res = await aiIntelligenceService.executeHistoricalBacklogCleanup({
        dryRun: true,
        confirmCleanup: false,
      });
      setDryRunResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dry-run verification failed.');
    } finally {
      setRunningDryRun(false);
    }
  };

  const handleExecuteCleanup = async () => {
    if (!confirmedChecked || executingDelete) return;
    setExecutingDelete(true);
    setError(null);
    try {
      const res = await aiIntelligenceService.executeHistoricalBacklogCleanup({
        dryRun: false,
        confirmCleanup: true,
      });
      setFinalResult(res);
      setConfirmedChecked(false);
      await onCleanupComplete();
      // Reload fresh preview counts after cleanup
      const refreshed = await aiIntelligenceService.previewHistoricalBacklogCleanup(5);
      setPreview(refreshed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Historical backlog cleanup failed.');
    } finally {
      setExecutingDelete(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="historical-cleanup-modal-title"
    >
      <div className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 id="historical-cleanup-modal-title" className="text-base font-semibold text-slate-100">
              Historical Backlog Cleanup
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Remove unanalyzed, failed, out-of-scope, and duplicate historical articles with zero intelligence dependencies. No Gemini requests are used.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPreview}
              disabled={loading || executingDelete}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
              title="Refresh live preview"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={executingDelete}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/70 text-rose-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {finalResult && (
            <div className="p-4 rounded-xl bg-emerald-950/35 border border-emerald-800/70 text-emerald-200 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-emerald-100">{finalResult.message}</p>
                <p className="text-[11px] text-emerald-300/80 font-mono">
                  Audit ID: {finalResult.auditId} · Deleted: {finalResult.deletedCount.toLocaleString()} · Protected: {finalResult.protectedCount.toLocaleString()} · Gemini calls: 0
                </p>
              </div>
            </div>
          )}

          {loading && !preview ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span>Inspecting live Firestore collections and article dependencies...</span>
            </div>
          ) : preview ? (
            <>
              {/* High-Level Disjoint Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-slate-400 block">Total Stored Articles</span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-100 mt-1 block">
                    {preview.totalStoredArticles.toLocaleString()}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/50">
                  <span className="text-amber-300 block">Eligible for Cleanup</span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-amber-200 mt-1 block">
                    {preview.totalEligibleForDeletion.toLocaleString()}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/50">
                  <span className="text-emerald-300 block">Protected & Preserved</span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-emerald-200 mt-1 block">
                    {preview.totalProtectedFromDeletion.toLocaleString()}
                  </span>
                </div>
              </div>

              {preview.dailyPipelineActive && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/60 text-amber-200 flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>The scheduled Daily Update is currently active. Wait until it finishes before executing cleanup.</span>
                </div>
              )}

              {/* Disjoint Classification Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                  <h3 className="font-semibold text-amber-200 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Eligible for Deletion (Unreferenced Historical)</span>
                  </h3>
                  <div className="space-y-1.5 text-slate-300">
                    <div className="flex justify-between">
                      <span>Unanalyzed historical pending</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.eligibleCounts.ELIGIBLE_HISTORICAL_PENDING.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Historical failed & archived failures</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.eligibleCounts.ELIGIBLE_HISTORICAL_FAILED.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Obsolete out-of-scope articles</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.eligibleCounts.ELIGIBLE_OBSOLETE_OUT_OF_SCOPE.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Duplicate or unusable records</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.eligibleCounts.ELIGIBLE_DUPLICATE_OR_UNUSABLE.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                  <h3 className="font-semibold text-emerald-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Protected From Deletion</span>
                  </h3>
                  <div className="space-y-1.5 text-slate-300">
                    <div className="flex justify-between">
                      <span>Successfully analyzed articles</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.protectedCounts.PROTECTED_ANALYZED.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Referenced by intelligence dependencies</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.protectedCounts.PROTECTED_REFERENCED_DEPENDENCY.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Reserved for current Daily Pipeline window</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.protectedCounts.PROTECTED_DAILY_PIPELINE_WINDOW.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Corporate / uncertain pending review</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.protectedCounts.PROTECTED_CORPORATE_UNCERTAIN.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Actively processing</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {preview.protectedCounts.PROTECTED_ACTIVE_PROCESSING.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Preserved Collections & Dependency Audit */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                <h3 className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Preserved Intelligence Collections (100% Untouched)</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {[
                    { label: 'Article Analysis', count: preview.dependenciesSummary.articleAnalysisDocs },
                    { label: 'Stories', count: preview.dependenciesSummary.storiesDocs },
                    { label: 'Analytics Ledger', count: preview.dependenciesSummary.analyticsLedgerDocs },
                    { label: 'Analytics Daily', count: preview.dependenciesSummary.analyticsDailyDocs },
                    { label: 'Daily Briefs', count: preview.dependenciesSummary.dailyBriefsDocs },
                    { label: 'Entity Reviews', count: preview.dependenciesSummary.entityReviewDocs },
                    { label: 'Sources', count: preview.dependenciesSummary.sourcesDocs },
                  ].map((col) => (
                    <div key={col.label} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block truncate">{col.label}</span>
                      <span className="text-sm font-bold font-mono tabular-nums text-slate-100">
                        {col.count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                {preview.activeBackfillRunsCount > 0 && (
                  <p className="text-[11px] text-amber-300/90 pt-1">
                    {preview.activeBackfillRunsCount} open historical backfill checkpoint(s) will be safely cancelled before cleanup starts.
                  </p>
                )}
              </div>

              {/* Dry-Run & Explicit Confirmation Box */}
              {preview.totalEligibleForDeletion === 0 ? (
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/50 text-emerald-200 flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Historical backlog cleared. SIGNALYN is focused on current market intelligence.</span>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-100">Step 1: Verify with Dry-Run</p>
                      <p className="text-[11px] text-slate-400">
                        Re-verifies live dependencies and confirms exact deletion counts without modifying Firestore.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRunDryRun}
                      disabled={runningDryRun || executingDelete || preview.dailyPipelineActive}
                      className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold transition cursor-pointer disabled:opacity-40"
                    >
                      {runningDryRun ? 'Verifying...' : 'Run Dry-Run Verification'}
                    </button>
                  </div>

                  {dryRunResult && (
                    <div className="p-3.5 rounded-lg bg-slate-900 border border-indigo-800/50 space-y-3">
                      <p className="text-slate-200">{dryRunResult.message}</p>
                      <label className="flex items-start gap-2.5 text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={confirmedChecked}
                          onChange={(e) => setConfirmedChecked(e.target.checked)}
                          disabled={executingDelete}
                          className="mt-0.5 rounded border-slate-600 bg-slate-950 text-rose-500 focus:ring-rose-500"
                        />
                        <span>
                          I confirm permanent deletion of{' '}
                          <strong className="text-amber-200 font-mono">
                            {dryRunResult.deletedCount.toLocaleString()}
                          </strong>{' '}
                          unreferenced historical article record(s). All{' '}
                          <strong className="text-emerald-200 font-mono">
                            {dryRunResult.protectedCount.toLocaleString()}
                          </strong>{' '}
                          protected articles and intelligence collections will remain intact.
                        </span>
                      </label>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={handleExecuteCleanup}
                          disabled={!confirmedChecked || executingDelete || preview.dailyPipelineActive}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-semibold transition cursor-pointer"
                        >
                          {executingDelete ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Cleaning Historical Backlog...</span>
                            </>
                          ) : (
                            <>
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Confirm Permanent Cleanup</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

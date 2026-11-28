import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  RefreshCw,
  RotateCcw,
  Archive,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
  Filter,
} from 'lucide-react';
import { aiIntelligenceService } from '../../services/aiIntelligenceService';
import {
  FailedArticleActionResult,
  FailedArticleCategory,
  FailedArticlesRecoveryPreview,
} from '../../types';

interface FailedArticlesRecoveryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onRecoveryComplete: () => Promise<void> | void;
}

const CATEGORY_LABELS: Record<FailedArticleCategory, string> = {
  AUTH_ERROR_RECOVERABLE: 'Auth Error (Recoverable)',
  QUOTA_LIMIT_RECOVERABLE: 'Quota Limit (Recoverable)',
  TRANSIENT_PROVIDER_RECOVERABLE: 'Temporary Error (Recoverable)',
  ALREADY_ANALYZED_STALE_FAILURE: 'Already Analyzed',
  OUT_OF_SCOPE: 'Out of Scope',
  DUPLICATE_ARTICLE: 'Duplicate Article',
  INVALID_OR_MISSING_CONTENT: 'Missing Content',
  UNSUPPORTED_OR_CORRUPT: 'Unsupported Format',
  EXHAUSTED_RETRIES_REVIEW: 'Exhausted Retries',
  OTHER_PERMANENT_REVIEW: 'Needs Manual Review',
};

const CATEGORY_BADGE_STYLES: Record<FailedArticleCategory, string> = {
  AUTH_ERROR_RECOVERABLE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  QUOTA_LIMIT_RECOVERABLE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  TRANSIENT_PROVIDER_RECOVERABLE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  ALREADY_ANALYZED_STALE_FAILURE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  OUT_OF_SCOPE: 'bg-slate-800 text-slate-300 border-slate-700',
  DUPLICATE_ARTICLE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  INVALID_OR_MISSING_CONTENT: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  UNSUPPORTED_OR_CORRUPT: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  EXHAUSTED_RETRIES_REVIEW: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  OTHER_PERMANENT_REVIEW: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

type PendingConfirmationAction =
  | null
  | {
      type: 'REQUEUE' | 'DISMISS_RESOLVED' | 'ARCHIVE' | 'DELETE';
      dryRunResult: FailedArticleActionResult;
      articleIds?: string[];
      categories?: FailedArticleCategory[];
    };

export const FailedArticlesRecoveryPanel: React.FC<FailedArticlesRecoveryPanelProps> = ({
  isOpen,
  onClose,
  onRecoveryComplete,
}) => {
  const [preview, setPreview] = useState<FailedArticlesRecoveryPreview | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<FailedArticleCategory | 'ALL'>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmationAction>(null);
  const [lastResult, setLastResult] = useState<FailedArticleActionResult | null>(null);
  const [showDangerDelete, setShowDangerDelete] = useState<boolean>(false);
  const [confirmDeleteChecked, setConfirmDeleteChecked] = useState<boolean>(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiIntelligenceService.previewFailedArticlesRecovery({
        limit: 300,
        category: 'ALL',
      });
      setPreview(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load failed articles review.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setPendingConfirm(null);
      setLastResult(null);
      setSelectedIds([]);
      setConfirmDeleteChecked(false);
      loadPreview();
    }
  }, [isOpen, loadPreview]);

  const filteredItems = useMemo(() => {
    if (!preview) return [];
    if (categoryFilter === 'ALL') return preview.items;
    return preview.items.filter((item) => item.category === categoryFilter);
  }, [preview, categoryFilter]);

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredItems.map((i) => i.id);
    if (visibleIds.length === 0) return;
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      const remove = new Set(visibleIds);
      setSelectedIds((prev) => prev.filter((id) => !remove.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handlePreviewRequeue = async () => {
    setActionBusy(true);
    setError(null);
    setLastResult(null);
    try {
      const articleIds = selectedIds.length > 0 ? selectedIds : undefined;
      const dryRunResult = await aiIntelligenceService.requeueRecoverableFailedArticles({
        articleIds,
        dryRun: true,
      });
      setPendingConfirm({ type: 'REQUEUE', dryRunResult, articleIds });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to preview recovery.');
    } finally {
      setActionBusy(false);
    }
  };

  const handlePreviewDismissResolved = async () => {
    setActionBusy(true);
    setError(null);
    setLastResult(null);
    try {
      const articleIds = selectedIds.length > 0 ? selectedIds : undefined;
      const dryRunResult = await aiIntelligenceService.dismissResolvedFailedArticles({
        articleIds,
        dryRun: true,
      });
      setPendingConfirm({ type: 'DISMISS_RESOLVED', dryRunResult, articleIds });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to preview resolved reconciliation.');
    } finally {
      setActionBusy(false);
    }
  };

  const handlePreviewArchive = async (obsoleteOnly = false) => {
    setActionBusy(true);
    setError(null);
    setLastResult(null);
    try {
      const articleIds = !obsoleteOnly && selectedIds.length > 0 ? selectedIds : undefined;
      const categories: FailedArticleCategory[] | undefined = obsoleteOnly
        ? ['OUT_OF_SCOPE', 'DUPLICATE_ARTICLE', 'INVALID_OR_MISSING_CONTENT', 'UNSUPPORTED_OR_CORRUPT']
        : undefined;
      const dryRunResult = await aiIntelligenceService.archiveFailedArticles({
        articleIds,
        categories,
        dryRun: true,
      });
      setPendingConfirm({ type: 'ARCHIVE', dryRunResult, articleIds, categories });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to preview archival.');
    } finally {
      setActionBusy(false);
    }
  };

  const handlePreviewDelete = async () => {
    const candidateIds =
      selectedIds.length > 0
        ? selectedIds
        : (preview?.items.filter((i) => i.safeToDelete).map((i) => i.id) ?? []);
    if (candidateIds.length === 0) {
      setError('No unreferenced obsolete articles are selected or eligible for permanent deletion.');
      return;
    }
    setActionBusy(true);
    setError(null);
    setLastResult(null);
    setConfirmDeleteChecked(false);
    try {
      const dryRunResult = await aiIntelligenceService.deleteObsoleteFailedArticles({
        articleIds: candidateIds,
        dryRun: true,
      });
      setPendingConfirm({ type: 'DELETE', dryRunResult, articleIds: candidateIds });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to preview permanent deletion.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmExecution = async () => {
    if (!pendingConfirm) return;
    if (pendingConfirm.type === 'DELETE' && !confirmDeleteChecked) return;

    setActionBusy(true);
    setError(null);
    try {
      let result: FailedArticleActionResult;
      if (pendingConfirm.type === 'REQUEUE') {
        result = await aiIntelligenceService.requeueRecoverableFailedArticles({
          articleIds: pendingConfirm.articleIds,
          dryRun: false,
          confirm: true,
        });
      } else if (pendingConfirm.type === 'DISMISS_RESOLVED') {
        result = await aiIntelligenceService.dismissResolvedFailedArticles({
          articleIds: pendingConfirm.articleIds,
          dryRun: false,
          confirm: true,
        });
      } else if (pendingConfirm.type === 'ARCHIVE') {
        result = await aiIntelligenceService.archiveFailedArticles({
          articleIds: pendingConfirm.articleIds,
          categories: pendingConfirm.categories,
          dryRun: false,
          confirm: true,
        });
      } else {
        result = await aiIntelligenceService.deleteObsoleteFailedArticles({
          articleIds: pendingConfirm.articleIds || [],
          dryRun: false,
          confirmDelete: true,
          confirmationToken: pendingConfirm.dryRunResult.confirmationToken,
        });
      }

      setLastResult(result);
      setPendingConfirm(null);
      setSelectedIds([]);
      setConfirmDeleteChecked(false);
      await loadPreview();
      await onRecoveryComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Review Historical Articles"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">Review Historical Articles</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Inspect why historical articles could not be analyzed and choose a safe recovery or archival action.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPreview}
              disabled={loading || actionBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
              aria-label="Close review dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/70 text-xs text-rose-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {lastResult && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-100">{lastResult.message}</p>
                {lastResult.blockedCount > 0 && (
                  <p className="text-[11px] text-emerald-300/80 mt-0.5">
                    {lastResult.blockedCount} protected article(s) were automatically preserved.
                  </p>
                )}
              </div>
            </div>
          )}

          {loading && !preview ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span>Inspecting historical articles and checking story dependencies...</span>
            </div>
          ) : preview ? (
            <>
              {/* 4 Summary Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <span className="text-[11px] text-slate-400 block">Requiring Review</span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-100 block">
                    {preview.totalFailed.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    {preview.totalArchivedFailed > 0
                      ? `${preview.totalArchivedFailed.toLocaleString()} archived`
                      : 'Active items'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-sky-900/40 space-y-1">
                  <span className="text-[11px] text-sky-300/90 block">Recoverable</span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-sky-300 block">
                    {preview.recoverableCount.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    {preview.authErrorCount > 0
                      ? `${preview.authErrorCount} past auth error(s)`
                      : 'Transient or quota issues'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-emerald-900/40 space-y-1">
                  <span className="text-[11px] text-emerald-300/90 block">Already Analyzed</span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-emerald-300 block">
                    {preview.alreadyAnalyzedCount.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-400 block">Safe to reconcile status</span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <span className="text-[11px] text-slate-400 block">Obsolete / Duplicates</span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-amber-300 block">
                    {preview.invalidOrObsoleteCount.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    {preview.duplicateCount} duplicate · {preview.outOfScopeCount} out of scope
                  </span>
                </div>
              </div>

              {/* AI Readiness Note when auth errors exist */}
              {preview.authErrorCount > 0 && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                    preview.geminiConfigured
                      ? 'bg-sky-950/30 border-sky-800/60 text-sky-200'
                      : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  }`}
                >
                  {preview.geminiConfigured ? (
                    <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-0.5">
                    <p className="font-semibold">
                      {preview.geminiConfigured
                        ? 'AI analysis credentials are currently configured.'
                        : 'AI analysis credentials are not currently configured.'}
                    </p>
                    <p className="text-[11px] opacity-85">
                      {preview.geminiConfigured
                        ? `${preview.authErrorCount.toLocaleString()} article(s) failed previously due to an authentication error. You can safely return them to the Historical Backfill queue for bounded batch analysis.`
                        : 'Configure valid AI provider credentials before returning past authentication failures to the queue.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Primary Safe Recovery Actions */}
              {preview.totalFailed > 0 && (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-200">
                      Recovery & Archival Actions
                      {selectedIds.length > 0 && (
                        <span className="ml-2 font-mono text-indigo-300">
                          ({selectedIds.length} selected)
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      All actions preview affected records before making changes.
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handlePreviewRequeue}
                      disabled={
                        actionBusy ||
                        preview.recoverableCount === 0 ||
                        (preview.authErrorCount > 0 && !preview.geminiConfigured)
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>
                        {selectedIds.length > 0
                          ? `Retry Selected Recoverable`
                          : `Retry Recoverable Articles (${preview.recoverableCount})`}
                      </span>
                    </button>

                    {preview.alreadyAnalyzedCount > 0 && (
                      <button
                        type="button"
                        onClick={handlePreviewDismissResolved}
                        disabled={actionBusy}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Dismiss Resolved ({preview.alreadyAnalyzedCount})</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handlePreviewArchive(false)}
                      disabled={actionBusy || (selectedIds.length === 0 && preview.eligibleForArchivalCount === 0)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold transition cursor-pointer"
                    >
                      <Archive className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        {selectedIds.length > 0
                          ? `Archive Selected (${selectedIds.length})`
                          : `Archive Failed Articles`}
                      </span>
                    </button>

                    {preview.invalidOrObsoleteCount > 0 && selectedIds.length === 0 && (
                      <button
                        type="button"
                        onClick={() => handlePreviewArchive(true)}
                        disabled={actionBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-300 border border-amber-900/50 text-xs font-medium transition cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archive Obsolete Only ({preview.invalidOrObsoleteCount})</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Explicit Dry-Run Confirmation Banner */}
              {pendingConfirm && (
                <div className="p-4 rounded-xl bg-slate-950 border border-indigo-500/50 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                        Confirm Action Preview
                      </h3>
                      <p className="text-xs text-slate-300">{pendingConfirm.dryRunResult.message}</p>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-400 pt-1">
                        <span>Eligible: {(pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount)}</span>
                        {pendingConfirm.dryRunResult.skippedCount > 0 && (
                          <span>Skipped: {pendingConfirm.dryRunResult.skippedCount}</span>
                        )}
                        {pendingConfirm.dryRunResult.blockedCount > 0 && (
                          <span className="text-amber-300">
                            Protected / Blocked: {pendingConfirm.dryRunResult.blockedCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {pendingConfirm.dryRunResult.blockedReasons.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-900/50 text-[11px] text-amber-200 space-y-1 max-h-24 overflow-y-auto">
                      {pendingConfirm.dryRunResult.blockedReasons.slice(0, 5).map((b, idx) => (
                        <div key={idx}>• {b.reason}</div>
                      ))}
                    </div>
                  )}

                  {pendingConfirm.type === 'DELETE' && (pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount) > 0 && (
                    <label className="flex items-center gap-2 text-xs text-rose-200 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={confirmDeleteChecked}
                        onChange={(e) => setConfirmDeleteChecked(e.target.checked)}
                        className="rounded border-rose-700 bg-slate-900 text-rose-600 focus:ring-0"
                      />
                      <span>
                        I confirm permanent deletion of {(pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount)} unreferenced obsolete failed article(s).
                      </span>
                    </label>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPendingConfirm(null)}
                      disabled={actionBusy}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmExecution}
                      disabled={
                        actionBusy ||
                        (pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount) === 0 ||
                        (pendingConfirm.type === 'DELETE' && !confirmDeleteChecked)
                      }
                      className={`px-4 py-1.5 rounded-lg text-white text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                        pendingConfirm.type === 'DELETE'
                          ? 'bg-rose-600 hover:bg-rose-500'
                          : 'bg-indigo-600 hover:bg-indigo-500'
                      }`}
                    >
                      {actionBusy
                        ? 'Applying...'
                        : pendingConfirm.type === 'REQUEUE'
                        ? `Confirm Return to Queue (${(pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount)})`
                        : pendingConfirm.type === 'DISMISS_RESOLVED'
                        ? `Confirm Reconcile (${(pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount)})`
                        : pendingConfirm.type === 'ARCHIVE'
                        ? `Confirm Archive (${(pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount)})`
                        : `Permanently Delete (${(pendingConfirm.dryRunResult.plannedCount ?? pendingConfirm.dryRunResult.processedCount)})`}
                    </button>
                  </div>
                </div>
              )}

              {/* Category Filter & Article Table */}
              {preview.totalFailed === 0 ? (
                <div className="p-8 rounded-xl bg-slate-950/50 border border-slate-800 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <p className="text-sm font-semibold text-slate-200">All historical failures are cleared</p>
                  <p className="text-xs text-slate-400">
                    No active failed historical articles require review.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <Filter className="w-3.5 h-3.5 text-slate-500" />
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value as any)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        aria-label="Filter failed articles by classification"
                      >
                        <option value="ALL">All Classifications ({preview.totalFailed})</option>
                        {(Object.keys(CATEGORY_LABELS) as FailedArticleCategory[])
                          .filter((cat) => (preview.countsByCategory[cat] || 0) > 0)
                          .map((cat) => (
                            <option key={cat} value={cat}>
                              {CATEGORY_LABELS[cat]} ({preview.countsByCategory[cat]})
                            </option>
                          ))}
                      </select>
                    </div>

                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                      Showing {filteredItems.length} of {preview.totalItemsAvailable} articles
                    </span>
                  </div>

                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-950 sticky top-0 z-10 border-b border-slate-800 text-[11px] text-slate-400">
                          <tr>
                            <th className="py-2.5 px-3 w-8">
                              <input
                                type="checkbox"
                                checked={
                                  filteredItems.length > 0 &&
                                  filteredItems.every((i) => selectedIds.includes(i.id))
                                }
                                onChange={toggleSelectAllVisible}
                                className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                                aria-label="Select all visible failed articles"
                              />
                            </th>
                            <th className="py-2.5 px-3 font-semibold">Article</th>
                            <th className="py-2.5 px-3 font-semibold">Classification</th>
                            <th className="py-2.5 px-3 font-semibold">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                          {filteredItems.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-800/40 transition">
                              <td className="py-2.5 px-3 align-top">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(item.id)}
                                  onChange={() => toggleSelectOne(item.id)}
                                  className="mt-0.5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 cursor-pointer"
                                  aria-label={`Select ${item.title}`}
                                />
                              </td>
                              <td className="py-2.5 px-3 max-w-xs">
                                <p className="text-slate-100 font-medium line-clamp-1">{item.title}</p>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  {item.sourceName}
                                  {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleDateString()}` : ''}
                                </p>
                              </td>
                              <td className="py-2.5 px-3 align-top whitespace-nowrap">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                    CATEGORY_BADGE_STYLES[item.category]
                                  }`}
                                >
                                  {CATEGORY_LABELS[item.category]}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-[11px] text-slate-400 align-top">
                                {item.errorSummary}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Collapsed Guarded Permanent Deletion Sub-section */}
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowDangerDelete((prev) => !prev)}
                      className="w-full px-4 py-2.5 bg-slate-950/60 hover:bg-slate-950 flex items-center justify-between text-xs text-slate-400 transition cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2 font-medium">
                        <Trash2 className="w-3.5 h-3.5 text-rose-400/80" />
                        <span>Permanent Removal (Obsolete Unreferenced Records Only)</span>
                      </span>
                      {showDangerDelete ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>

                    {showDangerDelete && (
                      <div className="p-4 bg-rose-950/15 border-t border-slate-800 space-y-3 text-xs">
                        <p className="text-slate-400 leading-relaxed">
                          Non-destructive archiving is recommended. Permanent deletion is strictly blocked for analyzed articles,
                          pending articles, recoverable failures, and any record referenced by Stories, Daily Briefs, or Entity Reviews.
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="text-[11px] font-mono text-slate-400">
                            Safe to delete: {preview.safeToDeleteCount} · Referenced by intelligence:{' '}
                            {preview.referencedByDependenciesCount}
                          </span>
                          <button
                            type="button"
                            onClick={handlePreviewDelete}
                            disabled={actionBusy || (selectedIds.length === 0 && preview.safeToDeleteCount === 0)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-900/50 hover:bg-rose-800/70 disabled:opacity-40 text-rose-200 border border-rose-800/70 text-xs font-semibold transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Preview Permanent Removal</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

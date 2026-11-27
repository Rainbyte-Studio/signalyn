import React, { useState, useEffect } from 'react';
import { AlertTriangle, Trash2, X, ShieldAlert, CheckCircle2, RefreshCw, Info, Lock } from 'lucide-react';
import { Source } from '../../types';
import { extractNormalizedDomain, getSourceFeeds } from '../../utils/urlUtils';

interface SafeDeleteSourceModalProps {
  isOpen: boolean;
  source: Source | null;
  onConfirm: (reason?: string) => Promise<void>;
  onCancel: () => void;
}

type DeletionState = 'IDLE' | 'DELETING' | 'SUCCESS' | 'ERROR';

export const SafeDeleteSourceModal: React.FC<SafeDeleteSourceModalProps> = ({
  isOpen,
  source,
  onConfirm,
  onCancel,
}) => {
  const [typedName, setTypedName] = useState('');
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionState, setDeletionState] = useState<DeletionState>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset form when modal opens with a source
  useEffect(() => {
    if (isOpen) {
      setTypedName('');
      setDeletionReason('');
      setDeletionState('IDLE');
      setErrorMessage(null);
    }
  }, [isOpen, source?.id]);

  if (!isOpen || !source) return null;

  const feeds = getSourceFeeds(source);
  const domain = source.normalizedDomain || extractNormalizedDomain(source.websiteUrl);
  const totalArticles = source.articlesCollected || 0;

  // Strict confirmation requirement: typed name must match source.name exactly (case-sensitive or trimmed)
  const isNameMatched = typedName.trim() === source.name.trim();
  const canDelete = isNameMatched && deletionState !== 'DELETING' && deletionState !== 'SUCCESS';

  const handleDelete = async () => {
    if (!canDelete) return;

    setDeletionState('DELETING');
    setErrorMessage(null);

    // Bounded timeout safety (15 seconds max)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Deletion timed out after 15 seconds. Please try again.')), 15000)
    );

    try {
      await Promise.race([
        onConfirm(deletionReason.trim() || undefined),
        timeoutPromise,
      ]);
      setDeletionState('SUCCESS');
      // Briefly show success state before auto-closing
      setTimeout(() => {
        onCancel();
      }, 750);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred during deletion.';
      setErrorMessage(msg);
      setDeletionState('ERROR');
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div
        className="w-full max-w-lg bg-slate-900 border border-rose-900/50 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rose-950/60 bg-rose-950/30">
          <div className="flex items-center gap-2.5 text-rose-400">
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Delete Source</h3>
              <p className="text-[11px] text-rose-300/80">Permanent removal of publication configuration</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={deletionState === 'DELETING'}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Target Metadata Card */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Source Name:</span>
              <span className="font-bold text-slate-100 font-mono">{source.name}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Domain:</span>
              <span className="font-mono text-indigo-300">{domain}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Configured Feeds:</span>
              <span className="font-mono text-slate-200">{feeds.length} feed(s)</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Collected Articles:</span>
              <span className="font-mono text-emerald-400">{totalArticles} article(s)</span>
            </div>
          </div>

          {/* Explanation & Historical Preservation Guarantee */}
          <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40 text-amber-200 text-xs leading-relaxed space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Safety Guarantee & Preservation Policy</span>
            </div>
            <p>
              Deleting this source will stop all future collection and remove the source configuration. Historical articles and AI intelligence will be preserved by default.
            </p>
          </div>

          {/* Deletion Reason (Optional) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">
              Reason for Deletion <span className="text-slate-500 font-normal">(optional metadata)</span>
            </label>
            <input
              type="text"
              value={deletionReason}
              onChange={(e) => setDeletionReason(e.target.value)}
              disabled={deletionState === 'DELETING'}
              placeholder="e.g., Domain decommissioned, duplicate entry, editorial change"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500 transition"
            />
          </div>

          {/* Typed Name Confirmation Input */}
          <div className="space-y-2 pt-1 border-t border-slate-800">
            <label className="block text-xs font-medium text-slate-300">
              To confirm, type <strong className="text-rose-300 font-mono select-all">"{source.name}"</strong> below:
            </label>
            <div className="relative">
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                disabled={deletionState === 'DELETING'}
                placeholder={`Type "${source.name}" to unlock deletion`}
                className={`w-full px-3 py-2 pr-9 bg-slate-950 border rounded-lg text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none transition ${
                  isNameMatched
                    ? 'border-emerald-500/80 focus:border-emerald-500'
                    : 'border-slate-700 focus:border-rose-500'
                }`}
                autoFocus
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {isNameMatched ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                )}
              </div>
            </div>
            {!isNameMatched && typedName.length > 0 && (
              <p className="text-[11px] text-rose-400">Name does not match exactly.</p>
            )}
          </div>

          {/* Error Message Display */}
          {deletionState === 'ERROR' && errorMessage && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-medium">Deletion Failed</strong>
                <span className="text-[11px]">{errorMessage}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <span className="text-[11px] font-mono text-slate-500">
            {deletionState === 'DELETING'
              ? 'Executing atomic deletion...'
              : deletionState === 'SUCCESS'
              ? 'Tombstone recorded.'
              : isNameMatched
              ? 'Confirmation satisfied'
              : 'Name verification required'}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={deletionState === 'DELETING'}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 disabled:bg-rose-950/40 disabled:text-rose-400/40 disabled:border-rose-900/30 border border-rose-500/50 rounded-lg shadow-sm transition"
            >
              {deletionState === 'DELETING' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>
                {deletionState === 'DELETING'
                  ? 'Deleting...'
                  : deletionState === 'SUCCESS'
                  ? 'Deleted'
                  : 'Delete Source Permanently'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

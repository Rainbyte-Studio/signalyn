import React, { useState, useEffect } from 'react';
import { Database, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { aiIntelligenceService } from '../../services/aiIntelligenceService';
import { BacklogInventory } from '../../types';

interface HistoricalBackfillSettingsCardProps {
  canManage: boolean;
}

export const HistoricalBackfillSettingsCard: React.FC<HistoricalBackfillSettingsCardProps> = ({ canManage }) => {
  const { setActiveTab } = useApp();
  const [inventory, setInventory] = useState<BacklogInventory | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    aiIntelligenceService
      .getBacklogInventory()
      .then((data) => {
        setInventory(data);
      })
      .catch(() => {
        setLoadError(true);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  return (
    <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Historical Backfill</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Analyze archived articles across strategic hardware categories while preserving daily update schedules.
            </p>
          </div>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setActiveTab('backfill')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <span>Open Historical Backfill</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[11px] text-slate-400 block">Articles Remaining</span>
          <span className="text-lg font-bold font-mono tabular-nums text-indigo-300">
            {isLoading
              ? '...'
              : loadError || !inventory
              ? '—'
              : (inventory.pendingHistoricalStrategicArticles ?? inventory.pendingStrategicallyRelevantArticles ?? 0).toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-500 block">Hardware categories</span>
        </div>

        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[11px] text-slate-400 block">Articles Analyzed</span>
          <span className="text-lg font-bold font-mono tabular-nums text-emerald-300">
            {isLoading
              ? '...'
              : loadError || !inventory
              ? '—'
              : (inventory.alreadyAnalyzedArticles ?? 0).toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-500 block">Completed coverage</span>
        </div>

        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[11px] text-slate-400 block">Corporate / Uncertain</span>
          <span className="text-lg font-bold font-mono tabular-nums text-amber-300">
            {isLoading
              ? '...'
              : loadError || !inventory
              ? '—'
              : (inventory.pendingUncertainArticles ?? 0).toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-500 block">Held for review</span>
        </div>

        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[11px] text-slate-400 block">Daily Update Schedule</span>
          <span className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5 pt-0.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Protected</span>
          </span>
          <span className="text-[11px] text-slate-500 block">Daily update runs at 06:00</span>
        </div>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed pt-1">
        Manage batch processing, article review, and historical coverage from the{' '}
        <button
          type="button"
          onClick={() => setActiveTab('backfill')}
          className="text-indigo-400 hover:underline font-semibold cursor-pointer"
        >
          Historical Backfill
        </button>{' '}
        workspace.
      </p>
    </div>
  );
};

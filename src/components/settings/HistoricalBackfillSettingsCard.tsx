import React, { useState, useEffect } from 'react';
import { Database, ArrowRight, ShieldCheck, CheckCircle2, Layers } from 'lucide-react';
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
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
                Historical Intelligence Backfill
              </h3>
              <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/30">
                CANONICAL WORKFLOW
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Consolidated enterprise batch processing for historical articles with 7-category reconciliation (4 strategic hardware categories + Corporate/Uncertain + Out-of-Scope + Legacy/Unclassified).
            </p>
          </div>
        </div>

        {canManage && (
          <button
            onClick={() => setActiveTab('backfill')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition"
          >
            <span>Open Backfill Engine</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[10px] font-mono uppercase text-slate-400 block">Strategic Pending</span>
          <span className="text-lg font-bold font-mono text-indigo-300">
            {isLoading
              ? '...'
              : loadError || !inventory
              ? '—'
              : inventory.pendingStrategicallyRelevantArticles ?? 0}
          </span>
          <span className="text-[10px] text-slate-500 block">4 Hardware Categories</span>
        </div>

        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[10px] font-mono uppercase text-slate-400 block">Corporate / Uncertain</span>
          <span className="text-lg font-bold font-mono text-amber-300">
            {isLoading
              ? '...'
              : loadError || !inventory
              ? '—'
              : inventory.pendingUncertainArticles ?? 0}
          </span>
          <span className="text-[10px] text-slate-500 block">Preserved from auto-LLM</span>
        </div>

        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[10px] font-mono uppercase text-slate-400 block">Batch Concurrency</span>
          <span className="text-lg font-bold font-mono text-emerald-300">2 max</span>
          <span className="text-[10px] text-slate-500 block">Default size: 20 items</span>
        </div>

        <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-[10px] font-mono uppercase text-slate-400 block">Daily Pipeline Preemption</span>
          <span className="text-lg font-bold font-mono text-cyan-300 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Priority Held</span>
          </span>
          <span className="text-[10px] text-slate-500 block">06:00 Europe/Athens lock</span>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
        Batch processing controls, live telemetry, out-of-scope legacy cleanup, and corporate intelligence review
        operate strictly through the canonical{' '}
        <button
          onClick={() => setActiveTab('backfill')}
          className="text-indigo-400 hover:underline font-semibold"
        >
          Historical Backfill
        </button>{' '}
        navigation tab to prevent duplicate execution loops or state fragmentation.
      </p>
    </div>
  );
};

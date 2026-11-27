/**
 * Signalyn Phase 6D & UI P2.2.2: Historical Intelligence Backfill Management View
 *
 * Dedicated Admin Interface for inspecting backlog inventory across actual
 * Firestore articles, triaging strategic hardware relevance, and executing
 * bounded, idempotent batch processing with durable checkpoints.
 */

import React, { useState } from 'react';
import {
  Database,
  ShieldCheck,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { HistoricalBackfillSection } from '../settings/HistoricalBackfillSection';
import {
  AppPage,
  PageHeader,
  ResponsiveGrid,
  Button,
  SemanticBadge,
} from '../common/DesignSystem';

export const HistoricalBackfillView: React.FC = () => {
  const { canManage, setActiveTab } = useApp();
  const [showSafeguardDetails, setShowSafeguardDetails] = useState<boolean>(false);

  return (
    <AppPage>
      {/* Standardized Page Header with Breadcrumb */}
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="text-xs font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Overview
            </button>
            <span className="text-slate-600 font-mono text-xs">/</span>
            <span className="text-xs font-mono text-indigo-400 uppercase tracking-wider font-semibold">
              Historical Backfill
            </span>
          </div>
        }
        title={
          <span className="inline-flex items-center gap-2.5">
            <Database className="w-5 h-5 text-indigo-400 shrink-0" />
            <span>Historical Intelligence Backfill</span>
          </span>
        }
        badges={<SemanticBadge variant="info" label="Bounded Batch Engine" />}
        description="Enterprise batch analysis for historical backlog in 4 strategic hardware categories."
        actions={
          <>
            <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-xs font-mono tabular-nums text-slate-300">
                06:00 Daily Pipeline: <strong className="text-emerald-400">PRIORITY HELD</strong>
              </span>
            </div>

            <Button
              variant="secondary"
              size="md"
              onClick={() => setActiveTab('analytics')}
              leftIcon={<BarChart3 className="w-3.5 h-3.5 text-indigo-400" />}
            >
              Analytics
            </Button>

            <Button variant="secondary" size="md" onClick={() => setActiveTab('feed')}>
              Live Feed
            </Button>
          </>
        }
      />

      {/* PHASE F — Compact Processing Safeguards Summary with Expandable Technical Details */}
      <section
        aria-label="Processing Safeguards"
        className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-3"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-100 uppercase tracking-wide">
              <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Processing Safeguards</span>
            </span>

            <span className="hidden sm:inline text-slate-700">|</span>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-300">
              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                1. Four Hardware Categories
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                2. Daily Scheduler Priority
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                3. Durable Checkpoints
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSafeguardDetails((prev) => !prev)}
            aria-expanded={showSafeguardDetails}
            className="inline-flex items-center gap-1 text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer self-start lg:self-auto"
          >
            <span>
              {showSafeguardDetails ? 'Hide Technical Details' : 'Expand Safeguard Details'}
            </span>
            {showSafeguardDetails ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {showSafeguardDetails && (
          <ResponsiveGrid cols={3} gap="sm" className="pt-2 border-t border-slate-800/80 text-xs text-slate-400">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="font-semibold text-slate-200 block text-[11px] font-mono">
                1. Four Hardware Categories
              </span>
              <p className="text-[11px] leading-relaxed">
                Triage restricts Gemini calls to Smartphones, Watches/Wearables, Audio, and Tablets.
                Out-of-scope GPU/automotive articles remain archived without unnecessary LLM cost.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="font-semibold text-slate-200 block text-[11px] font-mono">
                2. Daily Scheduler Priority
              </span>
              <p className="text-[11px] leading-relaxed">
                Synchronous Firestore lease locks prevent race conditions. The automated 06:00
                Europe/Athens daily briefing run always has preemption authority over backfill
                batches.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="font-semibold text-slate-200 block text-[11px] font-mono">
                3. Durable Checkpoints
              </span>
              <p className="text-[11px] leading-relaxed">
                Every batch writes durable execution state to Firestore. Successfully analyzed
                articles are never re-analyzed, and transient errors are capped at 3 retries.
              </p>
            </div>
          </ResponsiveGrid>
        )}
      </section>

      {/* Main Backfill Interactive Control & Telemetry Section */}
      <HistoricalBackfillSection canManage={canManage} />
    </AppPage>
  );
};

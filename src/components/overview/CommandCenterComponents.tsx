import React from 'react';
import {
  ArrowRight,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Info,
  Clock,
} from 'lucide-react';
import {
  ExecutiveKpiMetric,
  PriorityIntelligenceSignal,
  SignalConfidenceTier,
  SignalSeverityLevel,
} from '../../services/commandCenterIntelligence';
import { NavigationTab } from '../../types';
import { MetricCard, Button } from '../common/DesignSystem';

export function formatRelativeOrShortTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Timestamp unavailable';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatEurFromCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || cents <= 0) return '—';
  return `€${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Reusable Executive Intelligence KPI Card (Section B)
 * Built on the UI P2.1 MetricCard component with standardized height, padding,
 * typography, tabular numerals, and drill-down action.
 */
export const ExecutiveKpiCard: React.FC<{
  metric: ExecutiveKpiMetric;
  isLoading?: boolean;
  onNavigate: (tab: NavigationTab) => void;
}> = ({ metric, isLoading = false, onNavigate }) => {
  const tone =
    metric.statusTone === 'critical'
      ? 'critical'
      : metric.statusTone === 'warning'
      ? 'warning'
      : metric.statusTone === 'nominal'
      ? 'nominal'
      : 'muted';

  return (
    <MetricCard
      label={metric.label}
      value={metric.primaryValue}
      unit={metric.unitLabel}
      secondaryContext={metric.secondaryContext}
      footerLeft={metric.reportingPeriodLabel}
      footerRight={
        metric.freshnessTimestamp
          ? formatRelativeOrShortTimestamp(metric.freshnessTimestamp)
          : metric.provenanceLabel
      }
      icon={
        <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition-colors shrink-0" />
      }
      tone={tone}
      density="standard"
      isLoading={isLoading}
      onClick={() => onNavigate(metric.targetTab)}
      className="min-h-[156px]"
    />
  );
};

/**
 * Reusable Priority Intelligence Signal Row (Section C)
 * Uses clean unboxed metadata with typographic separators (`·`) and explicit confidence & severity labels.
 */
export const PrioritySignalRow: React.FC<{
  signal: PriorityIntelligenceSignal;
  onOpenModule: (tab: NavigationTab, storyId?: string) => void;
}> = ({ signal, onOpenModule }) => {
  const renderConfidenceIndicator = (tier: SignalConfidenceTier, label: string) => {
    if (tier === 'CONFIRMED') {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{label}</span>
        </span>
      );
    }
    if (tier === 'LIKELY_CORROBORATED') {
      return (
        <span className="inline-flex items-center gap-1 text-sky-400 font-medium">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  };

  const renderSeverityLabel = (severity: SignalSeverityLevel) => {
    if (severity === 'CRITICAL') {
      return (
        <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>Critical Priority</span>
        </span>
      );
    }
    if (severity === 'HIGH') {
      return <span className="text-amber-300 font-semibold">High Priority</span>;
    }
    if (severity === 'MEDIUM') {
      return <span className="text-slate-300 font-medium">Medium Priority</span>;
    }
    return <span className="text-slate-400">Informational</span>;
  };

  return (
    <div className="py-4 first:pt-0 last:pb-0 flex flex-col gap-2">
      {/* Unboxed Metadata Line 1: Domain · Signal Type · Manufacturer · Product · Severity */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span className="font-medium text-indigo-300">{signal.signalTypeLabel}</span>
        <span aria-hidden="true">·</span>
        <span
          className={
            signal.isPrimaryTargetManufacturer
              ? 'font-semibold text-slate-100'
              : 'font-medium text-slate-300'
          }
        >
          {signal.manufacturer}
        </span>
        {signal.affectedProductOrFamily && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-slate-300 font-mono">{signal.affectedProductOrFamily}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        {renderSeverityLabel(signal.severity)}
        <span aria-hidden="true">·</span>
        {renderConfidenceIndicator(signal.confidenceTier, signal.confidenceLabel)}
      </div>

      {/* Headline & Primary Action */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenModule(signal.targetTab, signal.targetStoryId)}
            className="text-left group cursor-pointer focus-visible:outline-none"
          >
            <h4 className="text-sm font-semibold text-slate-100 group-hover:text-indigo-400 transition-colors leading-snug">
              {signal.title}
            </h4>
          </button>
          {signal.summary && (
            <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
              {signal.summary}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {signal.sourceUrl && (
            <a
              href={signal.sourceUrl}
              target="_blank"
              rel="noreferrer"
              referrerPolicy="no-referrer"
              className="px-2.5 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-slate-100 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              title="Open official source reference"
            >
              <span>Source</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenModule(signal.targetTab, signal.targetStoryId)}
            rightIcon={<ArrowRight className="w-3 h-3 text-indigo-400" />}
          >
            Inspect
          </Button>
        </div>
      </div>

      {/* Unboxed Provenance & Timestamp Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-slate-400">{signal.sourceAttribution}</span>
          <span aria-hidden="true">·</span>
          <span>{signal.evidenceSummary}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-slate-400">
          <Clock className="w-3 h-3 text-slate-500" />
          <span>{formatRelativeOrShortTimestamp(signal.timestamp)}</span>
        </span>
      </div>
    </div>
  );
};

/**
 * Reusable Module Summary Panel Header (Section D)
 */
export const ModulePanelHeader: React.FC<{
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ title, subtitle, actionLabel, onAction }) => (
  <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
    <div className="space-y-0.5 min-w-0">
      <h3 className="text-base font-semibold text-slate-100 tracking-tight">{title}</h3>
      <p className="text-xs text-slate-400">{subtitle}</p>
    </div>
    <Button
      variant="outline"
      size="md"
      onClick={onAction}
      rightIcon={<ArrowRight className="w-3.5 h-3.5 text-indigo-400" />}
      className="text-indigo-300 hover:text-indigo-200"
    >
      {actionLabel}
    </Button>
  </div>
);

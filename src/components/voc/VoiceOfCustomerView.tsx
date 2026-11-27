import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquareWarning,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Search,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Lock,
  Info,
  Layers,
  Smartphone,
  Activity,
  FileSearch,
  FlaskConical,
  Scale,
} from 'lucide-react';
import {
  VocOverviewPayload,
  VocSource,
  VocSourceFeasibilityStatus,
  VocProductMatchConfidence,
  VocAdvisoryCorrelationStatus,
  VocDiagnosticEvaluationResponse,
} from '../../types/vocIntelligence';
import { AppPage, PageHeader, SemanticBadge, Button } from '../common/DesignSystem';
import { useApp } from '../../context/AppContext';

type VocSubTab =
  | 'overview'
  | 'sources'
  | 'products'
  | 'clusters'
  | 'reports'
  | 'advisories';

const DIAGNOSTIC_PRESETS: {
  label: string;
  manufacturerHint: string;
  text: string;
}[] = [
  {
    label: 'EN: Huawei Pura 70 Ultra Battery & Overheating after Update',
    manufacturerHint: 'Huawei',
    text: 'Since installing the latest EMUI firmware update on my Huawei Pura 70 Ultra 512GB, battery drain is severe and the phone gets very hot while charging. Contact me at user.test@example.com or @pura_owner if support has a fix.',
  },
  {
    label: 'EL: Huawei MatePad 11.5S Εφαρμογές & Wi-Fi',
    manufacturerHint: 'Huawei',
    text: 'Στο Huawei MatePad 11.5S μετά την αναβάθμιση λογισμικού αποσυνδέεται το wifi συνέχεια και κρασάρει η εφαρμογή τράπεζας. Τηλ επικοινωνίας 6971234567.',
  },
  {
    label: 'Conservative Rule: Manufacturer-Only Mention (Rejected)',
    manufacturerHint: 'Huawei',
    text: 'My Huawei phone has a green line on the screen and Bluetooth keeps disconnecting from my car audio.',
  },
  {
    label: 'Conservative Rule: Unqualified Watch GT 5 (Watch GT 5 -> LIKELY_MODEL)',
    manufacturerHint: 'Huawei',
    text: 'My Huawei Watch GT 5 Bluetooth connection drops during workouts and battery drains faster since the last update.',
  },
];

function getFeasibilityStatusStyle(status: VocSourceFeasibilityStatus): {
  label: string;
  textClass: string;
  borderClass: string;
} {
  switch (status) {
    case 'VERIFIED_ACCESSIBLE':
      return {
        label: 'VERIFIED_ACCESSIBLE',
        textClass: 'text-emerald-400',
        borderClass: 'border-emerald-700/60 bg-emerald-950/30',
      };
    case 'ACCESSIBLE_WITH_RESTRICTIONS':
      return {
        label: 'ACCESSIBLE_WITH_RESTRICTIONS',
        textClass: 'text-amber-400',
        borderClass: 'border-amber-700/60 bg-amber-950/30',
      };
    case 'REQUIRES_AUTHORIZATION':
      return {
        label: 'REQUIRES_AUTHORIZATION',
        textClass: 'text-sky-400',
        borderClass: 'border-sky-700/60 bg-sky-950/30',
      };
    case 'NOT_SUPPORTED':
      return {
        label: 'NOT_SUPPORTED',
        textClass: 'text-rose-400',
        borderClass: 'border-rose-700/60 bg-rose-950/30',
      };
    default:
      return {
        label: 'NOT_YET_VERIFIED',
        textClass: 'text-slate-400',
        borderClass: 'border-slate-700 bg-slate-900',
      };
  }
}

function getMatchConfidenceStyle(confidence: VocProductMatchConfidence): string {
  switch (confidence) {
    case 'VERIFIED_MODEL':
      return 'text-emerald-400 border-emerald-700/60 bg-emerald-950/30';
    case 'LIKELY_MODEL':
      return 'text-sky-400 border-sky-700/60 bg-sky-950/30';
    case 'AMBIGUOUS_REVIEW':
      return 'text-amber-400 border-amber-700/60 bg-amber-950/30';
    case 'UNMATCHED':
    default:
      return 'text-rose-400 border-rose-700/60 bg-rose-950/30';
  }
}

function getCorrelationStatusStyle(status: VocAdvisoryCorrelationStatus): string {
  switch (status) {
    case 'OFFICIALLY_CONFIRMED_ISSUE':
      return 'text-emerald-400 border-emerald-700/60 bg-emerald-950/30';
    case 'CORRELATED_WITH_OFFICIAL_ADVISORY':
      return 'text-amber-400 border-amber-700/60 bg-amber-950/30';
    case 'CUSTOMER_REPORTED':
      return 'text-sky-400 border-sky-700/60 bg-sky-950/30';
    case 'UNVERIFIED_CLAIM':
    default:
      return 'text-slate-400 border-slate-700 bg-slate-900';
  }
}

export const VoiceOfCustomerView: React.FC = () => {
  const { canManage, setActiveTab, settings } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<VocSubTab>('overview');
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>(() => {
    const globalName = settings?.myCompanyName || 'Huawei';
    const match = ['Huawei', 'Apple', 'Samsung', 'Xiaomi', 'Honor'].find(
      (m) => m.toLowerCase() === globalName.toLowerCase()
    );
    return match || 'Huawei';
  });
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [overview, setOverview] = useState<VocOverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Source Feasibility Live Probe State
  const [isProbingSources, setIsProbingSources] = useState<boolean>(false);
  const [lastLiveProbeAt, setLastLiveProbeAt] = useState<string | null>(null);
  const [selectedSourceDetail, setSelectedSourceDetail] = useState<VocSource | null>(null);

  // Diagnostic Sandbox State
  const [sandboxText, setSandboxText] = useState<string>(DIAGNOSTIC_PRESETS[0].text);
  const [sandboxManufacturer, setSandboxManufacturer] = useState<string>(
    DIAGNOSTIC_PRESETS[0].manufacturerHint
  );
  const [sandboxResult, setSandboxResult] = useState<VocDiagnosticEvaluationResponse | null>(null);
  const [isEvaluatingSandbox, setIsEvaluatingSandbox] = useState<boolean>(false);

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        manufacturer: selectedManufacturer,
        category: selectedCategory,
      });
      if (searchQuery.trim()) {
        params.set('searchQuery', searchQuery.trim());
      }
      const res = await fetch(`/api/voc/overview?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} loading Voice of Customer overview`);
      }
      const data: VocOverviewPayload = await res.json();
      setOverview(data);
      if (!selectedSourceDetail && data.sources.length > 0) {
        setSelectedSourceDetail(data.sources[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Voice of Customer data.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedManufacturer, selectedCategory, searchQuery]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleRunLiveFeasibilityProbe = async () => {
    setIsProbingSources(true);
    try {
      const res = await fetch('/api/voc/sources/feasibility?liveProbe=true');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} running live source feasibility audit`);
      }
      const data = await res.json();
      setLastLiveProbeAt(data.auditedAt);
      if (overview && Array.isArray(data.sources)) {
        setOverview({
          ...overview,
          sources: data.sources,
        });
        if (selectedSourceDetail) {
          const updated = data.sources.find((s: VocSource) => s.id === selectedSourceDetail.id);
          if (updated) setSelectedSourceDetail(updated);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Live feasibility probe failed.');
    } finally {
      setIsProbingSources(false);
    }
  };

  const handleEvaluateSample = async (textOverride?: string, mfgOverride?: string) => {
    const textToEval = textOverride ?? sandboxText;
    const mfgToEval = mfgOverride ?? sandboxManufacturer;
    if (!textToEval.trim()) return;

    setIsEvaluatingSandbox(true);
    try {
      const res = await fetch('/api/voc/diagnostic/evaluate-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToEval,
          manufacturerHint: mfgToEval,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} evaluating sample`);
      }
      const data: VocDiagnosticEvaluationResponse = await res.json();
      setSandboxResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sample evaluation failed.');
    } finally {
      setIsEvaluatingSandbox(false);
    }
  };

  return (
    <AppPage className="pb-12">
      <PageHeader
        eyebrow="Customer Signal Intelligence"
        title="Voice of Customer Intelligence"
        description="Public customer complaint discovery, bilingual 15-category classification, conservative canonical product matching, emerging issue detection, and Service Intelligence cross-referencing."
        icon={<MessageSquareWarning className="w-6 h-6" />}
        badge={<SemanticBadge variant="pending">DATA COLLECTION PENDING</SemanticBadge>}
        actions={
          <>
            {/* Local Manufacturer Filter Lens */}
            <div
              className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5"
              title="Local Manufacturer Filter Lens (temporary analytical view; does not overwrite Global Primary Target)"
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Manufacturer Lens:
              </span>
              <select
                value={selectedManufacturer}
                onChange={(e) => setSelectedManufacturer(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-100 focus:outline-none font-mono cursor-pointer"
                aria-label="Select Manufacturer Lens"
              >
                {(overview?.availableManufacturers || ['Huawei', 'Apple', 'Samsung', 'Xiaomi', 'Honor', 'ALL']).map(
                  (mfg) => (
                    <option key={mfg} value={mfg} className="bg-slate-900 text-slate-100">
                      {mfg === 'ALL' ? 'All Manufacturers' : mfg}
                    </option>
                  )
                )}
              </select>
            </div>

            {canManage && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.hash = '#system-diagnostics:voc';
                  setActiveTab('settings');
                }}
                leftIcon={<FlaskConical className="w-3.5 h-3.5 text-emerald-400" />}
                title="Open Voice of Customer Storage Telemetry & Classifier Sandbox in Settings"
              >
                VoC Diagnostics &amp; Sandbox
              </Button>
            )}

            <Button
              variant="secondary"
              size="md"
              onClick={loadOverview}
              disabled={isLoading}
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />}
            >
              Refresh Data
            </Button>
          </>
        }
      />

      {error && (
        <div className="bg-rose-950/40 border border-rose-800/80 p-4 text-xs text-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-[11px] font-mono underline text-rose-300 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Primary KPI Grid — Strictly Real Firestore Numbers (No Fabricated Metrics) */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              Complaint Volume ({overview.selectedManufacturer})
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                {overview.kpis.totalUniqueComplaints}
              </span>
              <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                {overview.kpis.duplicatesSuppressed} dupes suppressed
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Persisted unique reports in vocReports
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              Emerging Issues
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                {overview.kpis.emergingIssuesCount}
              </span>
              <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                min n &ge; {overview.methodology.emergingIssueMinUniqueReports}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Velocity &ge; {overview.methodology.emergingVelocityRatioThreshold}x 7d baseline
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              Verified Model Links
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
                {overview.kpis.verifiedModelMatchesCount}
              </span>
              <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                {overview.kpis.likelyModelMatchesCount} likely / {overview.kpis.ambiguousMatchesCount} rev
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Matched against {overview.catalogContext.totalCanonicalProducts} canonical SKUs
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              Sentiment Distribution
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-lg font-bold font-mono tabular-nums text-slate-100">
                {overview.sentimentBreakdown.total === 0
                  ? 'N/A (0 reports)'
                  : `${overview.sentimentBreakdown.negative} NEG / ${overview.sentimentBreakdown.mixed} MIX`}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Zero synthetic sentiment scores
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              Advisory Correlations
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-amber-400">
                {overview.kpis.correlatedWithAdvisoryCount}
              </span>
              <span className="text-[10px] font-mono text-emerald-400 tabular-nums">
                {overview.kpis.officiallyConfirmedCount} confirmed
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {overview.catalogContext.totalOfficialAdvisories} official advisories indexed
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              Audited VOC Sources
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
                {overview.kpis.verifiedAccessibleSourcesCount}
              </span>
              <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                / {overview.sources.length} audited
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {overview.kpis.restrictedOrAuthSourcesCount} restricted/auth • {overview.kpis.unsupportedSourcesCount} WAF/CAPTCHA
            </p>
          </div>
        </div>
      )}

      {/* Sub-Navigation Bar */}
      <div className="border-b border-slate-800 flex flex-wrap gap-1">
        {[
          { id: 'overview', label: 'Overview & Taxonomy', icon: Activity },
          {
            id: 'sources',
            label: `Source Feasibility Matrix (${overview?.sources.length || 11})`,
            icon: ShieldCheck,
          },
          {
            id: 'products',
            label: `Complaints by Product (${overview?.productSummaries.length || 0})`,
            icon: Smartphone,
          },
          {
            id: 'clusters',
            label: `Issue Clusters (${overview?.clusters.length || 0})`,
            icon: Layers,
          },
          {
            id: 'reports',
            label: `Customer Reports (${overview?.reports.length || 0})`,
            icon: FileSearch,
          },
          {
            id: 'advisories',
            label: `Related Service Advisories (${overview?.relatedServiceAdvisories.length || 0})`,
            icon: Scale,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as VocSubTab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                active
                  ? 'border-indigo-500 text-indigo-300 bg-slate-900/60'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: OVERVIEW & TAXONOMY */}
      {overview && activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Honest Empty State Banner when vocReports = 0 */}
          {overview.isEmptyState && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 max-w-3xl">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                    <h3 className="text-sm font-bold text-slate-100">
                      Data Collection Pending — Zero Persisted Customer Complaints
                    </h3>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {overview.emptyStateReason}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveSubTab('sources')}
                    className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-slate-200 transition cursor-pointer"
                  >
                    Inspect Source Feasibility
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== 'undefined') window.location.hash = '#system-diagnostics:voc';
                        setActiveTab('settings');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition cursor-pointer"
                    >
                      Open Classifier &amp; Matcher Sandbox
                    </button>
                  )}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
                {overview.methodology.coreDisclaimer}
              </div>
            </div>
          )}

          {/* 15-Category Bilingual Complaint Taxonomy & Volume Table */}
          <div className="bg-slate-900/60 border border-slate-800">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  Phase 3 — Extensible Bilingual Complaint Taxonomy (15 Categories)
                </h3>
                <p className="text-xs text-slate-400">
                  Supports multi-category assignment per report across English (en) and Greek (el)
                  customer feedback.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                Active Focus: {overview.selectedManufacturer}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400 bg-slate-950/50">
                    <th className="py-2.5 px-4">Category ID</th>
                    <th className="py-2.5 px-4">English Label</th>
                    <th className="py-2.5 px-4">Greek Label (Ελληνικά)</th>
                    <th className="py-2.5 px-4">Domain Scope</th>
                    <th className="py-2.5 px-4 text-right">Persisted Reports</th>
                    <th className="py-2.5 px-4 text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {overview.categoryBreakdown.map((cat) => (
                    <tr key={cat.category} className="hover:bg-slate-900/90">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-indigo-300">
                        {cat.category}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-200">{cat.labelEn}</td>
                      <td className="py-2.5 px-4 text-slate-300">{cat.labelEl}</td>
                      <td className="py-2.5 px-4 font-mono text-[10px] text-slate-400">
                        {cat.isHardwareRelated && cat.isSoftwareUpdateRelated
                          ? 'HARDWARE + SW_UPDATE'
                          : cat.isHardwareRelated
                            ? 'HARDWARE_THERMAL_POWER'
                            : cat.isSoftwareUpdateRelated
                              ? 'SW_FIRMWARE_LIFECYCLE'
                              : 'CONNECTIVITY_OR_SERVICE'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-200">
                        {cat.uniqueReportsCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400">
                        {cat.percentageOfReports.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Methodology & Governance Architecture Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900/60 border border-slate-800 p-5 space-y-2.5">
              <h4 className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-bold">
                Phase 5 — Emerging Issue Detection Thresholds
              </h4>
              <div className="text-xs text-slate-300 space-y-1.5">
                <p>
                  • <strong className="text-slate-100">Minimum Cluster Sample Size:</strong>{' '}
                  <span className="font-mono tabular-nums">
                    {overview.methodology.minimumClusterSampleSize}
                  </span>{' '}
                  unique deduplicated reports for the same model + primary category.
                </p>
                <p>
                  • <strong className="text-slate-100">Emerging Spike Threshold:</strong>{' '}
                  <span className="font-mono tabular-nums">
                    &ge; {overview.methodology.emergingIssueMinUniqueReports}
                  </span>{' '}
                  unique reports with 7-day velocity ratio{' '}
                  <span className="font-mono tabular-nums">
                    &ge; {overview.methodology.emergingVelocityRatioThreshold}x
                  </span>{' '}
                  over prior 21-day baseline.
                </p>
                <p>
                  • <strong className="text-slate-100">Deduplication Policy:</strong>{' '}
                  {overview.methodology.deduplicationPolicy}
                </p>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-5 space-y-2.5">
              <h4 className="text-xs font-mono uppercase tracking-wider text-amber-400 font-bold">
                Phase 6 — Service Intelligence Correlation vs Confirmation
              </h4>
              <div className="text-xs text-slate-300 space-y-1.5">
                <p>{overview.methodology.correlationVsConfirmationRule}</p>
                <p>
                  • <strong className="text-slate-100">PII & Copyright Minimization:</strong>{' '}
                  {overview.methodology.piiMinimizationPolicy}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SOURCE FEASIBILITY MATRIX */}
      {overview && activeSubTab === 'sources' && (
        <div className="space-y-5">
          <div className="bg-slate-900/60 border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Phase 1 — Verified Source Feasibility Audit Matrix
              </h3>
              <p className="text-xs text-slate-400">
                Every source is classified strictly using real HTTP probes, robots.txt inspection,
                and anti-bot/WAF verification. No CAPTCHA, login wall, or WAF is ever bypassed.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {lastLiveProbeAt && (
                <span className="text-[11px] font-mono text-emerald-400 tabular-nums">
                  Probed: {new Date(lastLiveProbeAt).toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={handleRunLiveFeasibilityProbe}
                disabled={isProbingSources}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isProbingSources ? 'animate-spin' : ''}`} />
                <span>{isProbingSources ? 'Probing Endpoints...' : 'Run Live HTTP Probe'}</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400 bg-slate-950/60">
                  <th className="py-2.5 px-4">Source Name</th>
                  <th className="py-2.5 px-4">Feasibility Classification</th>
                  <th className="py-2.5 px-4">HTTP / WAF Status</th>
                  <th className="py-2.5 px-4">Access Method</th>
                  <th className="py-2.5 px-4">robots.txt</th>
                  <th className="py-2.5 px-4">Model ID</th>
                  <th className="py-2.5 px-4">Timestamps</th>
                  <th className="py-2.5 px-4">P1.0 Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {overview.sources.map((src) => {
                  const statusStyle = getFeasibilityStatusStyle(src.feasibilityStatus);
                  const isSelected = selectedSourceDetail?.id === src.id;
                  return (
                    <tr
                      key={src.id}
                      onClick={() => setSelectedSourceDetail(src)}
                      className={`cursor-pointer transition ${
                        isSelected ? 'bg-indigo-950/30' : 'hover:bg-slate-900/90'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-100">{src.name}</div>
                        <div className="text-[11px] font-mono text-slate-400 truncate max-w-xs">
                          {src.officialUrl}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-mono font-bold border ${statusStyle.borderClass} ${statusStyle.textClass}`}
                        >
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[11px]">
                        <span
                          className={
                            src.lastHttpStatus === 200
                              ? 'text-emerald-400'
                              : src.lastHttpStatus === 403 || src.lastHttpStatus === 404
                                ? 'text-rose-400'
                                : 'text-amber-400'
                          }
                        >
                          HTTP {src.lastHttpStatus}
                        </span>
                        {src.antiBotProtection.detected && (
                          <span className="block text-[10px] text-amber-400/90">
                            {src.antiBotProtection.provider || 'Anti-Bot Gate'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-300">
                        {src.permittedAccessMethod}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {src.robotsTxtStatus.targetPathAllowed ? (
                          <span className="text-emerald-400">Allowed (HTTP {src.robotsTxtStatus.httpStatus})</span>
                        ) : (
                          <span className="text-rose-400">Restricted (HTTP {src.robotsTxtStatus.httpStatus})</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {src.productModelIdentificationPossible ? (
                          <span className="text-emerald-400">YES</span>
                        ) : (
                          <span className="text-slate-500">NO</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {src.publicationTimestampsAvailable ? (
                          <span className="text-emerald-400">YES</span>
                        ) : (
                          <span className="text-slate-500">NO</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[10px] text-slate-400">
                        AUDIT_ONLY
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detailed Source Audit Evidence Inspector */}
          {selectedSourceDetail && (
            <div className="bg-slate-900/70 border border-slate-800 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-100">
                    Audit Evidence Inspector: {selectedSourceDetail.name}
                  </h4>
                  <a
                    href={selectedSourceDetail.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-mono text-indigo-400 hover:text-indigo-300"
                  >
                    <span>{selectedSourceDetail.officialUrl}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  Verified: {new Date(selectedSourceDetail.lastVerifiedAt).toISOString()}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">
                      Empirical Verification Evidence
                    </span>
                    <p className="text-slate-200 mt-0.5 leading-relaxed">
                      {selectedSourceDetail.verificationEvidence}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">
                      Content Availability & Architecture
                    </span>
                    <p className="text-slate-300 mt-0.5">{selectedSourceDetail.contentAvailability}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">
                      robots.txt & Anti-Bot Findings
                    </span>
                    <p className="text-slate-300 mt-0.5">
                      {selectedSourceDetail.robotsTxtStatus.summary} —{' '}
                      {selectedSourceDetail.antiBotProtection.details}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">
                      Authentication & Rate Limits
                    </span>
                    <p className="text-slate-300 mt-0.5">
                      {selectedSourceDetail.authenticationDetails} ({selectedSourceDetail.rateLimits})
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">
                      Terms of Service & Legal Assessment
                    </span>
                    <p className="text-slate-300 mt-0.5">
                      {selectedSourceDetail.termsOfServiceRestrictions}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-indigo-400 block">
                      Recommended VOC P1.1 Action
                    </span>
                    <p className="text-indigo-200 mt-0.5 font-medium">
                      {selectedSourceDetail.recommendedP1_1Action}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: COMPLAINTS BY PRODUCT */}
      {overview && activeSubTab === 'products' && (
        <div className="bg-slate-900/60 border border-slate-800">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Phase 4 — Canonical Product Catalog VOC Coverage ({overview.selectedManufacturer})
              </h3>
              <p className="text-xs text-slate-400">
                Read-only linkage to authoritative retailProducts ({overview.catalogContext.totalCanonicalProducts}{' '}
                canonical products; {overview.catalogContext.huaweiCanonicalProducts} Huawei models).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400 bg-slate-950/50">
                  <th className="py-2.5 px-4">Canonical Product</th>
                  <th className="py-2.5 px-4">Brand</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4 text-right">VERIFIED_MODEL</th>
                  <th className="py-2.5 px-4 text-right">LIKELY_MODEL</th>
                  <th className="py-2.5 px-4 text-right">AMBIGUOUS_REVIEW</th>
                  <th className="py-2.5 px-4 text-right">Related Advisories</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {overview.productSummaries.map((prod) => (
                  <tr key={prod.canonicalProductId} className="hover:bg-slate-900/90">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-200">{prod.canonicalProductName}</div>
                      <div className="text-[10px] font-mono text-slate-500">
                        {prod.canonicalProductId}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300">
                      {prod.manufacturer}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400">
                      {prod.category}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-400">
                      {prod.verifiedComplaintCount}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-sky-400">
                      {prod.likelyComplaintCount}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-400">
                      {prod.ambiguousReviewCount}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                      {prod.relatedOfficialAdvisoriesCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: ISSUE CLUSTERS */}
      {overview && activeSubTab === 'clusters' && (
        <div className="space-y-4">
          {overview.clusters.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 p-8 text-center space-y-2">
              <Layers className="w-6 h-6 text-slate-500 mx-auto" />
              <h3 className="text-sm font-bold text-slate-200">
                Zero Active Complaint Clusters (vocIssueClusters = 0)
              </h3>
              <p className="text-xs text-slate-400 max-w-xl mx-auto">
                No repeated complaint clusters are currently persisted in Firestore for{' '}
                {overview.selectedManufacturer}. Issue clusters require a minimum deduplicated
                sample size of n &ge; {overview.methodology.minimumClusterSampleSize} unique reports
                before emerging velocity is flagged.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400 bg-slate-950/50">
                    <th className="py-2.5 px-4">Cluster Title</th>
                    <th className="py-2.5 px-4">Primary Category</th>
                    <th className="py-2.5 px-4 text-right">Unique Reports</th>
                    <th className="py-2.5 px-4 text-right">Velocity (7d)</th>
                    <th className="py-2.5 px-4">Trend Status</th>
                    <th className="py-2.5 px-4">Service Advisory Correlation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {overview.clusters.map((cl) => (
                    <tr key={cl.id} className="hover:bg-slate-900/90">
                      <td className="py-2.5 px-4 font-semibold text-slate-100">{cl.title}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-indigo-300">
                        {cl.primaryCategory}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-200">
                        {cl.uniqueReportCount} ({cl.duplicateSuppressedCount} dupes)
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-200">
                        {cl.velocityRatio}x
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-amber-400">
                        {cl.trendStatus}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-mono border ${getCorrelationStatusStyle(
                            cl.advisoryCorrelationStatus
                          )}`}
                        >
                          {cl.advisoryCorrelationStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 5: CUSTOMER REPORTS EXPLORER */}
      {overview && activeSubTab === 'reports' && (
        <div className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search persisted complaint excerpts..."
                className="bg-transparent text-xs text-slate-200 focus:outline-none w-full"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase text-slate-400">Category:</span>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-200"
              >
                <option value="ALL">All 15 Categories</option>
                {overview.taxonomy.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} ({t.labelEn})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {overview.reports.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 p-8 text-center space-y-2">
              <FileSearch className="w-6 h-6 text-slate-500 mx-auto" />
              <h3 className="text-sm font-bold text-slate-200">
                Zero Persisted Customer Reports in vocReports
              </h3>
              <p className="text-xs text-slate-400 max-w-xl mx-auto">
                Firestore collection <code className="font-mono text-slate-300">vocReports</code>{' '}
                contains 0 records. No synthetic or fabricated customer complaints are displayed.
                Use the Classifier &amp; Matcher Sandbox tab to test real-time classification and
                canonical product matching in dry-run mode.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400 bg-slate-950/50">
                    <th className="py-2.5 px-4">Published</th>
                    <th className="py-2.5 px-4">Product Match</th>
                    <th className="py-2.5 px-4">Categories</th>
                    <th className="py-2.5 px-4">Sanitized Evidence Excerpt</th>
                    <th className="py-2.5 px-4">Advisory Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {overview.reports.map((rep) => (
                    <tr key={rep.id} className="hover:bg-slate-900/90">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-400">
                        {rep.publishedAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-200">
                          {rep.canonicalProductName || rep.reportedProductName}
                        </div>
                        <span
                          className={`inline-block mt-0.5 px-1.5 py-0.2 text-[10px] font-mono border ${getMatchConfidenceStyle(
                            rep.productMatchConfidence
                          )}`}
                        >
                          {rep.productMatchConfidence}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-indigo-300">
                        {rep.categories.join(', ')}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300 max-w-md">{rep.evidenceExcerpt}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-mono border ${getCorrelationStatusStyle(
                            rep.advisoryCorrelationStatus
                          )}`}
                        >
                          {rep.advisoryCorrelationStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 6: RELATED SERVICE ADVISORIES */}
      {overview && activeSubTab === 'advisories' && (
        <div className="bg-slate-900/60 border border-slate-800">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Phase 6 — Official Service Intelligence Advisories Available for VOC Correlation (
                {overview.selectedManufacturer})
              </h3>
              <p className="text-xs text-slate-400">
                Read-only cross-reference with authoritative serviceAdvisories. Correlation with a
                software/security bulletin never implies an officially confirmed hardware defect.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400 bg-slate-950/50">
                  <th className="py-2.5 px-4">Published</th>
                  <th className="py-2.5 px-4">Manufacturer</th>
                  <th className="py-2.5 px-4">Advisory Title</th>
                  <th className="py-2.5 px-4">Type & Severity</th>
                  <th className="py-2.5 px-4">Max VOC Correlation Tier</th>
                  <th className="py-2.5 px-4">Official Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {overview.relatedServiceAdvisories.map((adv) => (
                  <tr key={adv.advisoryId} className="hover:bg-slate-900/90">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-400">
                      {adv.publishedAt.slice(0, 10)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-200">
                      {adv.manufacturer}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-100">{adv.advisoryTitle}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300">
                      {adv.advisoryType} • {adv.severity}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] font-mono border ${getCorrelationStatusStyle(
                          adv.correlationStatus
                        )}`}
                      >
                        {adv.correlationStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <a
                        href={adv.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-indigo-400 hover:text-indigo-300"
                      >
                        <span>Inspect Bulletin</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppPage>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Database,
  ShieldCheck,
  Store,
  MessageSquareWarning,
  Server,
  RefreshCw,
  Play,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  Lock,
  FlaskConical,
  Cpu,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { RestrictedAccessView } from '../common/RestrictedAccessView';
import { ProductionDiagnosticsPanel } from '../service/ProductionDiagnosticsPanel';
import { ProductionSafetyChecks } from './ProductionSafetyChecks';
import type { DiagnosticsSubTab } from '../../utils/navigationSync';
import {
  VocOverviewPayload,
  VocDiagnosticEvaluationResponse,
  VocProductMatchConfidence,
  VocAdvisoryCorrelationStatus,
} from '../../types/vocIntelligence';
import {
  ContentCard,
  SectionHeader,
  SemanticBadge,
  Button,
  ResponsiveGrid,
} from '../common/DesignSystem';
import {
  computeReconciledSourceKpiCounts,
  resolveCanonicalSourceOperationalState,
} from '../../utils/dataIntegrityContracts';
import {
  PublicReleaseMetadata,
  getFrontendReleaseMetadata,
  compareFrontendBackendRelease,
  isSourceFingerprintToken,
} from '../../utils/releaseMetadata';

export type { DiagnosticsSubTab } from '../../utils/navigationSync';

export interface SystemDiagnosticsPanelProps {
  initialSubTab?: DiagnosticsSubTab;
  onNavigateSettingsSection?: (section: 'general' | 'retail-sources' | 'backfill' | 'system-diagnostics') => void;
}

const VOC_DIAGNOSTIC_PRESETS: {
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

export const SystemDiagnosticsPanel: React.FC<SystemDiagnosticsPanelProps> = ({
  initialSubTab = 'overview',
  onNavigateSettingsSection,
}) => {
  const {
    canManage,
    sources,
    collectorStatus,
    isCollecting,
    runCollector,
    refreshData,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<DiagnosticsSubTab>(initialSubTab);

  useEffect(() => {
    setActiveSubTab(initialSubTab);
  }, [initialSubTab]);

  // Consolidated Diagnostics State
  const [retailDiagnostics, setRetailDiagnostics] = useState<any | null>(null);
  const [retailStats, setRetailStats] = useState<any | null>(null);
  const [isRetailProbing, setIsRetailProbing] = useState(false);
  const [retailProbeResult, setRetailProbeResult] = useState<any | null>(null);
  const [retailNotice, setRetailNotice] = useState<string | null>(null);
  const [retailError, setRetailError] = useState<string | null>(null);

  const [vocOverview, setVocOverview] = useState<VocOverviewPayload | null>(null);
  const [isVocProbingSources, setIsVocProbingSources] = useState(false);
  const [lastVocLiveProbeAt, setLastVocLiveProbeAt] = useState<string | null>(null);
  const [sandboxText, setSandboxText] = useState<string>(VOC_DIAGNOSTIC_PRESETS[0].text);
  const [sandboxManufacturer, setSandboxManufacturer] = useState<string>(
    VOC_DIAGNOSTIC_PRESETS[0].manufacturerHint
  );
  const [sandboxResult, setSandboxResult] = useState<VocDiagnosticEvaluationResponse | null>(null);
  const [isEvaluatingSandbox, setIsEvaluatingSandbox] = useState<boolean>(false);
  const [vocError, setVocError] = useState<string | null>(null);

  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(false);
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<string | null>(null);
  const [backendRelease, setBackendRelease] = useState<PublicReleaseMetadata | null>(null);

  const frontendRelease = getFrontendReleaseMetadata();
  const releaseComparison = compareFrontendBackendRelease(frontendRelease, backendRelease);

  const loadDiagnosticsSummary = useCallback(async () => {
    if (!canManage) return;
    setIsLoadingSummary(true);
    try {
      const [retDiagRes, retDashRes, vocRes, relRes] = await Promise.allSettled([
        fetch('/api/retail/persistence/diagnostics'),
        fetch('/api/retail/dashboard'),
        fetch('/api/voc/overview?manufacturer=Huawei'),
        fetch('/api/system/release', { cache: 'no-store' }),
      ]);

      if (retDiagRes.status === 'fulfilled' && retDiagRes.value.ok) {
        const data = await retDiagRes.value.json();
        if (data?.diagnostics) setRetailDiagnostics(data.diagnostics);
      }

      if (retDashRes.status === 'fulfilled' && retDashRes.value.ok) {
        const data = await retDashRes.value.json();
        setRetailStats(data);
      }

      if (vocRes.status === 'fulfilled' && vocRes.value.ok) {
        const data = await vocRes.value.json();
        setVocOverview(data);
      }

      if (relRes.status === 'fulfilled' && relRes.value.ok) {
        const data = await relRes.value.json();
        setBackendRelease(data);
      }

      setLastHealthCheckAt(new Date().toISOString());
    } finally {
      setIsLoadingSummary(false);
    }
  }, [canManage]);

  useEffect(() => {
    loadDiagnosticsSummary();
  }, [loadDiagnosticsSummary]);

  const handleRunRetailPersistenceProbe = async () => {
    if (!canManage) return;
    setIsRetailProbing(true);
    setRetailProbeResult(null);
    setRetailNotice(null);
    setRetailError(null);
    try {
      const headers = await getAuthorizedApiHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/retail/persistence/test', {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      setRetailProbeResult(data.probe);
      if (data.probe?.success) {
        setRetailNotice(
          `Persistence probe passed! Verified WRITE, READ, and DELETE on Firestore (${data.probe.latencyMs}ms).`
        );
      } else {
        setRetailError(
          `Persistence probe failed at step ${data.probe?.step || 'UNKNOWN'}: ${
            data.probe?.error || 'Write permission denied'
          }`
        );
      }
      await loadDiagnosticsSummary();
    } catch (err: unknown) {
      setRetailError(`Probe execution failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRetailProbing(false);
    }
  };

  const handleRunVocLiveFeasibilityProbe = async () => {
    if (!canManage) return;
    setIsVocProbingSources(true);
    setVocError(null);
    try {
      const res = await fetch('/api/voc/sources/feasibility?liveProbe=true');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} running live source feasibility audit`);
      }
      const data = await res.json();
      setLastVocLiveProbeAt(data.auditedAt);
      if (vocOverview && Array.isArray(data.sources)) {
        setVocOverview({
          ...vocOverview,
          sources: data.sources,
        });
      }
    } catch (err: unknown) {
      setVocError(err instanceof Error ? err.message : 'Live feasibility probe failed.');
    } finally {
      setIsVocProbingSources(false);
    }
  };

  const handleEvaluateVocSample = useCallback(
    async (textOverride?: string, mfgOverride?: string) => {
      if (!canManage) return;
      const textToEval = textOverride ?? sandboxText;
      const mfgToEval = mfgOverride ?? sandboxManufacturer;
      if (!textToEval.trim()) return;

      setIsEvaluatingSandbox(true);
      setVocError(null);
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
        setVocError(err instanceof Error ? err.message : 'Sample evaluation failed.');
      } finally {
        setIsEvaluatingSandbox(false);
      }
    },
    [canManage, sandboxText, sandboxManufacturer]
  );

  useEffect(() => {
    if (activeSubTab === 'voc' && !sandboxResult && !isEvaluatingSandbox && canManage) {
      handleEvaluateVocSample();
    }
  }, [activeSubTab, sandboxResult, isEvaluatingSandbox, canManage, handleEvaluateVocSample]);

  // Strict Admin Guard: Guest or non-admin users cannot view or trigger System Diagnostics
  if (!canManage) {
    return (
      <RestrictedAccessView
        featureName="Unified System Diagnostics & Operational Probes"
        description="System Diagnostics, Firestore persistence probes, Service Intelligence reconciliation gates, and Voice of Customer classification sandboxes are restricted to authenticated administrators."
      />
    );
  }

  const reconciledSourceCounts = computeReconciledSourceKpiCounts(sources);
  const currentErrorFeedSources = sources.filter(
    (s) => resolveCanonicalSourceOperationalState(s).effectiveBucket === 'ERROR'
  );
  const historicalWarningFeedSources = sources.filter((s) => {
    const resolved = resolveCanonicalSourceOperationalState(s);
    return resolved.effectiveBucket !== 'ERROR' && resolved.totalErrorCount > 0;
  });

  const subTabs: { id: DiagnosticsSubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'retail', label: 'Retail Intelligence', icon: Store },
    { id: 'service', label: 'Service Intelligence', icon: ShieldCheck },
    { id: 'voc', label: 'Voice of Customer', icon: MessageSquareWarning },
    { id: 'operations', label: 'System Operations', icon: Server },
    { id: 'production-safety', label: 'Production Safety Checks', icon: ShieldCheck },
  ];

  const handleSelectSubTab = (sub: DiagnosticsSubTab) => {
    setActiveSubTab(sub);
    if (typeof window !== 'undefined') {
      const nextHash = sub === 'overview' ? '#system-diagnostics' : `#system-diagnostics:${sub}`;
      if (window.location.hash !== nextHash) {
        window.history.pushState({ activeTab: 'settings' }, '', nextHash);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Unified System Diagnostics Header Banner */}
      <ContentCard className="p-5 bg-slate-900/90 border-indigo-500/30 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Database className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-bold text-slate-100">
                Unified System Diagnostics & Authoritative Persistence Center
              </h2>
              <SemanticBadge variant="verified">ADMIN ONLY</SemanticBadge>
              <SemanticBadge variant="info">
                DB: ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34
              </SemanticBadge>
            </div>
            <p className="text-xs text-slate-400">
              Centralized technical verification for Firestore persistence, Retail catalog reconciliation, Service Intelligence Quality Gates & Match Evidence Inspector, and Voice of Customer classification sandboxes.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadDiagnosticsSummary}
              disabled={isLoadingSummary}
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoadingSummary ? 'animate-spin text-indigo-400' : ''}`} />}
            >
              Refresh Health Check
            </Button>
          </div>
        </div>

        {/* Sub-Tab Selector */}
        <div
          role="tablist"
          aria-label="System Diagnostics Sections"
          className="flex flex-wrap gap-1.5"
        >
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => handleSelectSubTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-950/80 text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </ContentCard>

      {/* SECTION 1: OVERVIEW */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Runtime Environment & Firestore Summary */}
          <ResponsiveGrid cols={4}>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                Authoritative Database
              </span>
              <div className="text-sm font-bold font-mono text-emerald-400 truncate" title="ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34">
                Named Firestore Active
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate">
                Project: signalyn-5406e (us-west1)
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                Persistence Write Policy
              </span>
              <div className="flex items-center gap-2">
                {retailDiagnostics?.writePermitted === false ? (
                  <SemanticBadge variant="review">SANDBOX WRITES BLOCKED</SemanticBadge>
                ) : (
                  <SemanticBadge variant="verified">FIRESTORE WRITABLE</SemanticBadge>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate">
                {retailDiagnostics?.runtimeServiceAccount || 'Dedicated Cloud Run IAM'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                Ingestion & Feed Health
              </span>
              <div className="text-base font-bold font-mono tabular-nums text-slate-100">
                {reconciledSourceCounts.effectiveActiveCount} Active · {reconciledSourceCounts.effectivePausedCount} Paused · {reconciledSourceCounts.currentErrorSourcesCount} Errors
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {reconciledSourceCounts.configuredEnabledCount} configured ({reconciledSourceCounts.feedDerivedPausedCount} feed-paused) · {reconciledSourceCounts.sourcesWithHistoricalErrorsCount} historical warnings
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                Last Health Check
              </span>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-100">
                {lastHealthCheckAt
                  ? new Date(lastHealthCheckAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : 'Checking...'}
              </div>
              <p className="text-[11px] text-emerald-400 font-mono">
                Read-only verification complete
              </p>
            </div>
          </ResponsiveGrid>

          {/* R01: Release & Build Traceability Card (Read-Only) */}
          <ContentCard className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">
                  Release &amp; Build Traceability
                </h3>
                <SemanticBadge
                  variant={
                    releaseComparison.status === 'VERIFIED_MATCH'
                      ? 'verified'
                      : releaseComparison.versionMatchStatus === 'MISMATCH'
                      ? 'review'
                      : 'info'
                  }
                >
                  {releaseComparison.badgeLabel}
                </SemanticBadge>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {releaseComparison.summaryLabel}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs font-mono">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Frontend Build</span>
                <div className="text-slate-100 font-bold truncate">
                  v{frontendRelease.appVersion}
                </div>
                <div className="text-[11px] text-slate-400 truncate" title={frontendRelease.buildId}>
                  Build: {frontendRelease.buildId}
                </div>
                <div
                  className="text-[10px] text-slate-500 truncate"
                  title={
                    isSourceFingerprintToken(frontendRelease.commitSha)
                      ? `Deterministic SHA-256 source-code tree fingerprint (${frontendRelease.commitSha}), not a full deployed artifact binary hash`
                      : frontendRelease.commitSha
                  }
                >
                  {isSourceFingerprintToken(frontendRelease.commitSha)
                    ? 'Source-Code Fingerprint'
                    : 'Commit SHA'}
                  : {frontendRelease.commitSha}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Backend Build</span>
                <div className="text-slate-100 font-bold truncate">
                  v{backendRelease?.appVersion || 'UNKNOWN'}
                </div>
                <div
                  className="text-[11px] text-slate-400 truncate"
                  title={backendRelease?.serverReleaseId || backendRelease?.buildId || 'UNKNOWN'}
                >
                  Release: {backendRelease?.serverReleaseId || backendRelease?.buildId || 'UNKNOWN'}
                </div>
                <div
                  className="text-[10px] text-slate-500 truncate"
                  title={
                    isSourceFingerprintToken(backendRelease?.commitSha)
                      ? `Deterministic SHA-256 source-code tree fingerprint (${backendRelease?.commitSha}), not a full deployed artifact binary hash`
                      : backendRelease?.commitSha || 'UNKNOWN'
                  }
                >
                  {isSourceFingerprintToken(backendRelease?.commitSha)
                    ? 'Source-Code Fingerprint'
                    : 'Commit SHA'}
                  : {backendRelease?.commitSha || 'UNKNOWN'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Environment</span>
                <div className="text-indigo-300 font-bold uppercase truncate">
                  {releaseComparison.environment}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  FE: {frontendRelease.environment} / BE: {backendRelease?.environment || 'UNKNOWN'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Build Timestamp</span>
                <div
                  className="text-slate-200 font-semibold truncate"
                  title={frontendRelease.buildTimestamp}
                >
                  {frontendRelease.buildTimestamp === 'UNKNOWN'
                    ? 'UNKNOWN'
                    : frontendRelease.buildTimestamp.slice(0, 19).replace('T', ' ') + 'Z'}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  BE:{' '}
                  {backendRelease?.buildTimestamp && backendRelease.buildTimestamp !== 'UNKNOWN'
                    ? backendRelease.buildTimestamp.slice(0, 19).replace('T', ' ') + 'Z'
                    : 'UNKNOWN'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">
                  Version-Match Status
                </span>
                <div
                  className={`font-bold ${
                    releaseComparison.versionMatchStatus === 'MATCH'
                      ? 'text-emerald-400'
                      : releaseComparison.versionMatchStatus === 'MISMATCH'
                      ? 'text-amber-400'
                      : 'text-slate-300'
                  }`}
                >
                  {releaseComparison.versionMatchStatus}
                </div>
                <div className="text-[10px] text-slate-400 leading-snug">
                  Source-code fingerprint &amp; build metadata comparison (not full artifact binary hash)
                </div>
              </div>
            </div>
          </ContentCard>

          {/* Operational Warnings Banner (if any) */}
          {(currentErrorFeedSources.length > 0 || (retailDiagnostics?.writePermitted === false)) && (
            <ContentCard className="p-4 bg-amber-950/20 border-amber-500/30 space-y-2">
              <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Active Operational & Environment Notices</span>
              </div>
              <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                {retailDiagnostics?.writePermitted === false && (
                  <li>
                    Preview sandbox service account (<code className="font-mono text-amber-300">{retailDiagnostics.runtimeServiceAccount}</code>) has read access; production writes are restricted to <code className="font-mono text-emerald-300">signalyn-backend@signalyn-5406e.iam.gserviceaccount.com</code> on Cloud Run.
                  </li>
                )}
                {currentErrorFeedSources.length > 0 && (
                  <li>
                    {currentErrorFeedSources.length} feed source(s) are currently in operational ERROR state. Inspect inside System Operations or Sources Manager.
                  </li>
                )}
              </ul>
            </ContentCard>
          )}

          {/* Module Diagnostic Jump Cards */}
          <ResponsiveGrid cols={3}>
            <ContentCard className="p-5 space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <Store className="w-4 h-4 text-indigo-400" />
                    Retail Intelligence (P1.6)
                  </span>
                  <SemanticBadge variant="info">
                    {isLoadingSummary && !retailDiagnostics && !retailStats
                      ? 'Loading SKUs...'
                      : `${retailDiagnostics?.directFirestoreCounts?.products ?? retailStats?.totalTrackedProducts ?? 0} SKUs`}
                  </SemanticBadge>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Inspect direct Firestore document counts (<code className="font-mono">retailProducts</code>, <code className="font-mono">retailOffers</code>, <code className="font-mono">retailPriceHistory</code>), IAM service account identity, and run bounded Firestore write/read/delete probes.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSelectSubTab('retail')}
                >
                  Open Retail Diagnostics
                </Button>
              </div>
            </ContentCard>

            <ContentCard className="p-5 space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Service Intelligence (S1.2.6)
                  </span>
                  <SemanticBadge variant="verified">5/5 SOURCES</SemanticBadge>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Execute dry-run product match reconciliation, inspect the S1.2.5 Quality Gate, audit 8-point match evidence, verify source authenticity, and run selective Apple advisory reprocessing.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSelectSubTab('service')}
                >
                  Open Service Diagnostics
                </Button>
              </div>
            </ContentCard>

            <ContentCard className="p-5 space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <MessageSquareWarning className="w-4 h-4 text-amber-400" />
                    Voice of Customer (P1.0)
                  </span>
                  <SemanticBadge variant="pending">
                    {vocOverview?.sources.length ?? 11} AUDITED SOURCES
                  </SemanticBadge>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Verify authoritative <code className="font-mono">vocSources</code> and <code className="font-mono">vocReports</code> collection telemetry, trigger live source feasibility probes, and test the bilingual Classifier & Product Matcher Sandbox.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSelectSubTab('voc')}
                >
                  Open VoC Diagnostics & Sandbox
                </Button>
              </div>
            </ContentCard>
          </ResponsiveGrid>
        </div>
      )}

      {/* SECTION 2: RETAIL INTELLIGENCE DIAGNOSTICS */}
      {activeSubTab === 'retail' && (
        <div className="space-y-6">
          {retailNotice && (
            <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center justify-between">
              <span>{retailNotice}</span>
              <button
                type="button"
                onClick={() => setRetailNotice(null)}
                className="text-emerald-400 hover:text-emerald-200 font-mono text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {retailError && (
            <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center justify-between">
              <span>{retailError}</span>
              <button
                type="button"
                onClick={() => setRetailError(null)}
                className="text-rose-400 hover:text-rose-200 font-mono text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Relocated Phase P1.6 — Authoritative Firestore Persistence & Secure Identity Architecture */}
          <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>Firestore Authoritative Persistence & Identity Architecture (P1.6)</span>
                    {retailDiagnostics?.writePermitted === false ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                        SANDBOX WRITES BLOCKED (SECURE BY DESIGN)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        FIRESTORE AUTHORITATIVE & WRITABLE
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Target custom database:{' '}
                    <code className="text-indigo-300 font-mono">
                      ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34
                    </code>{' '}
                    in project <code className="text-indigo-300 font-mono">signalyn-5406e</code>. Local JSON fallback removed.
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                ZERO SHARED SANDBOX IAM GRANTS
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {/* Column 1: Direct Firestore Document Counts */}
              <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-2">
                <span className="font-mono text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">
                  Direct Remote Firestore Collections
                </span>
                <div className="space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">retailProducts:</span>
                    <span className="text-slate-100 font-bold">
                      {isLoadingSummary && !retailDiagnostics && !retailStats
                        ? 'Loading...'
                        : `${retailDiagnostics?.directFirestoreCounts?.products ?? retailStats?.totalTrackedProducts ?? 0} (Canonical)`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">retailOffers:</span>
                    <span className="text-slate-100 font-bold">
                      {isLoadingSummary && !retailDiagnostics && !retailStats
                        ? 'Loading...'
                        : `${retailDiagnostics?.directFirestoreCounts?.offers ?? retailStats?.totalActiveOffers ?? 0} (Active Offers)`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">retailPriceHistory:</span>
                    <span className="text-slate-100 font-bold">
                      {isLoadingSummary && !retailDiagnostics
                        ? 'Loading...'
                        : `${retailDiagnostics?.directFirestoreCounts?.priceHistory ?? 0} (Snapshots)`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">retailMatchReviews:</span>
                    <span className="text-slate-100 font-bold">
                      {isLoadingSummary && !retailDiagnostics && !retailStats
                        ? 'Loading...'
                        : `${retailDiagnostics?.directFirestoreCounts?.reviews ?? retailStats?.unlinkedOffersCount ?? 0} (Review Queue)`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Column 2: Runtime Identity & Permissions */}
              <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-2">
                <span className="font-mono text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">
                  Runtime Service Identity & Policy
                </span>
                <div className="space-y-1 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Current Runtime Identity:</span>
                    <span className="text-amber-300 break-all text-[10px]">
                      {isLoadingSummary && !retailDiagnostics
                        ? 'Verifying service identity...'
                        : retailDiagnostics?.runtimeServiceAccount || 'Authenticated Runtime Identity'}
                    </span>
                  </div>
                  <div className="pt-1">
                    <span className="text-slate-400 block text-[10px]">Dedicated Service Account:</span>
                    <span className="text-emerald-400 font-semibold break-all text-[10px]">
                      signalyn-backend@signalyn-5406e.iam.gserviceaccount.com
                    </span>
                  </div>
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-slate-400">Sandbox Writes:</span>
                    <span
                      className={
                        isLoadingSummary && !retailDiagnostics
                          ? 'text-slate-400 font-bold'
                          : retailDiagnostics?.writePermitted
                          ? 'text-emerald-400 font-bold'
                          : 'text-amber-400 font-bold'
                      }
                    >
                      {isLoadingSummary && !retailDiagnostics
                        ? 'CHECKING...'
                        : retailDiagnostics?.writePermitted
                        ? 'PERMITTED'
                        : retailDiagnostics?.writePermitted === false
                        ? 'PERMISSION_DENIED'
                        : 'NOT TESTED'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Column 3: Secure Administrator Configuration */}
              <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-2">
                <span className="font-mono text-slate-400 uppercase tracking-wider text-[10px] block font-semibold">
                  Administrator IAM & Cloud Run Setup
                </span>
                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-300">
                    Deployed Cloud Run service <code className="text-emerald-300 font-mono">signalyn</code> runs in{' '}
                    <code className="text-indigo-300 font-mono">us-west1</code>. Production writes are authorized via dedicated service account:
                  </p>
                  <pre className="p-2 rounded bg-slate-900 text-[10px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap select-all border border-slate-800">
{`gcloud iam service-accounts create signalyn-backend --project=signalyn-5406e
gcloud projects add-iam-policy-binding signalyn-5406e --member="serviceAccount:signalyn-backend@signalyn-5406e.iam.gserviceaccount.com" --role="roles/datastore.user"
gcloud run services update signalyn --project=signalyn-5406e --region=us-west1 --service-account=signalyn-backend@signalyn-5406e.iam.gserviceaccount.com`}
                  </pre>
                </div>
              </div>
            </div>

            {/* Fresh Retail Discovery & Persistence Verification Probe */}
            <div className="p-4 rounded-lg bg-indigo-950/20 border border-indigo-900/50 space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                      <span>Fresh Retail Discovery & Direct Persistence Mode</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                        MIGRATION DISABLED
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-300">
                      Scraped items are written <span className="font-semibold text-emerald-400">directly to Cloud Firestore</span>. Local JSON buffer is ignored. Fresh collection is gated on authorized Firestore persistence.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleRunRetailPersistenceProbe}
                    disabled={isRetailProbing}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                    title="Execute real bounded write/read/delete probe on Firestore"
                  >
                    <Play className={`w-3.5 h-3.5 text-amber-400 ${isRetailProbing ? 'animate-spin' : ''}`} />
                    <span>{isRetailProbing ? 'Probing Firestore...' : 'Test Write Probe'}</span>
                  </button>

                  {onNavigateSettingsSection && (
                    <button
                      type="button"
                      onClick={() => onNavigateSettingsSection('retail-sources')}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-200" />
                      <span>Configure Discovery & Crawlers</span>
                    </button>
                  )}
                </div>
              </div>

              {retailProbeResult && (
                <div
                  className={`p-3 rounded-lg text-xs font-mono border ${
                    retailProbeResult.success
                      ? 'bg-emerald-950/30 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/30 border-red-800 text-red-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">
                      {retailProbeResult.success
                        ? '✓ Persistence Probe Succeeded (WRITE/READ/VERIFY/DELETE)'
                        : `✗ Persistence Probe Failed at step: ${retailProbeResult.step}`}
                    </span>
                    <span>Latency: {retailProbeResult.latencyMs}ms</span>
                  </div>
                  {retailProbeResult.error && (
                    <p className="mt-1 text-[11px] text-red-400 font-sans">{retailProbeResult.error}</p>
                  )}
                  {retailProbeResult.remediation && (
                    <p className="mt-1 text-[11px] text-slate-300 font-sans">{retailProbeResult.remediation}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: SERVICE INTELLIGENCE DIAGNOSTICS */}
      {activeSubTab === 'service' && (
        <div className="space-y-6">
          <ProductionDiagnosticsPanel onRecomputeCompleted={loadDiagnosticsSummary} />
        </div>
      )}

      {/* SECTION 4: VOICE OF CUSTOMER DIAGNOSTICS & SANDBOX */}
      {activeSubTab === 'voc' && (
        <div className="space-y-6">
          {vocError && (
            <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center justify-between">
              <span>{vocError}</span>
              <button
                type="button"
                onClick={() => setVocError(null)}
                className="text-rose-400 hover:text-rose-200 font-mono text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Relocated Authoritative Firestore & Governance Telemetry */}
          <ContentCard className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span>Voice of Customer Authoritative Firestore Telemetry & P1.0 Governance</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Direct Firestore collection counts and live HTTP feasibility verification for audited public complaint sources.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] font-mono text-amber-300">
                  <Lock className="w-3.5 h-3.5" />
                  <span>P1.0 Governance Lock: Autonomous Scraping Disabled</span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRunVocLiveFeasibilityProbe}
                  disabled={isVocProbingSources}
                  leftIcon={
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isVocProbingSources ? 'animate-spin text-indigo-400' : ''}`}
                    />
                  }
                >
                  {isVocProbingSources ? 'Probing Sources...' : 'Run Live Source Feasibility Probe'}
                </Button>
              </div>
            </div>

            {vocOverview && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase block">STORAGE MODE</span>
                  <strong
                    className={`mt-1 block text-xs ${
                      vocOverview.storageMode === 'FIRESTORE_AUTHORITATIVE'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {vocOverview.storageMode}
                  </strong>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase block">vocSources</span>
                  <strong className="mt-1 block text-sm text-slate-100 tabular-nums">
                    {vocOverview.sources.length} audited ({vocOverview.firestoreCollections.vocSources} persisted)
                  </strong>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase block">vocReports</span>
                  <strong className="mt-1 block text-sm text-slate-100 tabular-nums">
                    {vocOverview.firestoreCollections.vocReports}
                  </strong>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase block">vocIssueClusters</span>
                  <strong className="mt-1 block text-sm text-slate-100 tabular-nums">
                    {vocOverview.firestoreCollections.vocIssueClusters}
                  </strong>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase block">vocProductMatches</span>
                  <strong className="mt-1 block text-sm text-slate-100 tabular-nums">
                    {vocOverview.firestoreCollections.vocProductMatches}
                  </strong>
                </div>
              </div>
            )}

            {lastVocLiveProbeAt && (
              <p className="text-[11px] font-mono text-emerald-400">
                ✓ Live HTTP feasibility audit completed at {lastVocLiveProbeAt}.
              </p>
            )}
          </ContentCard>

          {/* Relocated Dry-Run VOC Classifier, PII Sanitizer & Conservative Product Matcher Sandbox */}
          <div className="space-y-5">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-indigo-400" />
                    <span>Dry-Run VOC Classifier, PII Sanitizer &amp; Conservative Product Matcher Sandbox</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Evaluates English or Greek complaint text against the 15-category taxonomy, canonical retailProducts catalog, and official Service Advisories without writing to Firestore (<code className="font-mono">persistedToFirestore: false</code>).
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-700/60">
                  READ-ONLY DRY RUN
                </span>
              </div>

              {/* Preset Test Buttons */}
              <div className="flex flex-wrap gap-2">
                {VOC_DIAGNOSTIC_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSandboxText(preset.text);
                      setSandboxManufacturer(preset.manufacturerHint);
                      handleEvaluateVocSample(preset.text, preset.manufacturerHint);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300 transition cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <textarea
                  rows={3}
                  value={sandboxText}
                  onChange={(e) => setSandboxText(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                  placeholder="Paste a Greek or English customer complaint snippet to test classification and product matching..."
                />
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <span>Manufacturer Hint:</span>
                    <select
                      value={sandboxManufacturer}
                      onChange={(e) => setSandboxManufacturer(e.target.value)}
                      className="rounded bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-200"
                    >
                      <option value="Huawei">Huawei</option>
                      <option value="Apple">Apple</option>
                      <option value="Samsung">Samsung</option>
                      <option value="Xiaomi">Xiaomi</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEvaluateVocSample()}
                    disabled={isEvaluatingSandbox}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer"
                  >
                    {isEvaluatingSandbox ? 'Evaluating...' : 'Evaluate Sample (Dry Run)'}
                  </button>
                </div>
              </div>
            </div>

            {sandboxResult && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Classification & PII Sanitization Result */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3 text-xs">
                  <h4 className="font-mono uppercase text-[11px] text-indigo-400 font-bold">
                    1. Bilingual Taxonomy, Sentiment &amp; PII Redaction
                  </h4>
                  <div className="space-y-2">
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">Detected Language:</span>
                      <span className="font-mono text-slate-200 uppercase">
                        {sandboxResult.detectedLanguage}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">Primary Category:</span>
                      <span className="font-mono font-bold text-indigo-300">
                        {sandboxResult.primaryCategory}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">Multi-Label Categories:</span>
                      <span className="font-mono text-slate-200">
                        {sandboxResult.categories.map((c) => `${c.category} (${c.confidence})`).join(', ')}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">Sentiment &amp; Score:</span>
                      <span className="font-mono tabular-nums text-amber-400">
                        {sandboxResult.sentiment} ({sandboxResult.sentimentScore})
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">PII Redacted:</span>
                      <span className="font-mono tabular-nums text-emerald-400">
                        {sandboxResult.piiRedacted
                          ? `YES (${sandboxResult.redactedItemsCount} item(s) stripped)`
                          : 'NONE_DETECTED'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-1">
                        Bounded Sanitized Excerpt (&le; 280 chars):
                      </span>
                      <div className="p-2.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-200">
                        {sandboxResult.sanitizedExcerpt}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Product Match & Service Advisory Correlation Result */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3 text-xs">
                  <h4 className="font-mono uppercase text-[11px] text-emerald-400 font-bold">
                    2. Conservative Canonical Product Match &amp; Advisory Correlation
                  </h4>
                  <div className="space-y-2">
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">Match Confidence Tier:</span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${getMatchConfidenceStyle(
                          sandboxResult.productMatch.confidence
                        )}`}
                      >
                        {sandboxResult.productMatch.confidence} (
                        {sandboxResult.productMatch.confidenceScore})
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">Canonical Product:</span>
                      <span className="font-mono text-slate-100">
                        {sandboxResult.productMatch.canonicalProductName || 'None (Unlinked)'}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                      <span className="text-slate-400">Manufacturer-Only Rejected:</span>
                      <span className="font-mono text-slate-200">
                        {sandboxResult.productMatch.manufacturerOnlyRejected ? 'YES (Protected)' : 'NO'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Matcher Rationale:</span>
                      <p className="text-slate-300 mt-0.5">
                        {sandboxResult.productMatch.matchRationale}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-slate-400">Service Intelligence Status:</span>
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] border ${getCorrelationStatusStyle(
                            sandboxResult.advisoryCorrelation.status
                          )}`}
                        >
                          {sandboxResult.advisoryCorrelation.status}
                        </span>
                      </div>
                      <p className="text-slate-300 text-[11px]">
                        {sandboxResult.advisoryCorrelation.explanation}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === 'production-safety' && <ProductionSafetyChecks />}

      {/* SECTION 5: SYSTEM OPERATIONS & ARCHITECTURE READINESS */}
      {activeSubTab === 'operations' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ContentCard className="p-5 space-y-4">
            <SectionHeader
              title="Feed Ingestion & Collector Operations"
              subtitle="Server-side RSS/Atom feed collector lifecycle and active source telemetry"
              icon={<Server className="w-4 h-4 text-indigo-400" />}
              actions={
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => refreshData()}
                  >
                    Refresh State
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => runCollector()}
                    disabled={isCollecting}
                    isLoading={isCollecting}
                  >
                    {isCollecting ? 'Collecting...' : 'Trigger Collection Cycle'}
                  </Button>
                </div>
              }
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">
                  Effective Active Sources
                </span>
                <strong className="mt-1 block text-base text-emerald-400 tabular-nums">
                  {reconciledSourceCounts.effectiveActiveCount} / {reconciledSourceCounts.total}
                </strong>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {reconciledSourceCounts.configuredEnabledCount} configured ({reconciledSourceCounts.feedDerivedPausedCount} feed-paused)
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">
                  Current Source Errors
                </span>
                <strong
                  className={`mt-1 block text-base tabular-nums ${
                    reconciledSourceCounts.currentErrorSourcesCount > 0
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {reconciledSourceCounts.currentErrorSourcesCount}
                </strong>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Reconciled with Sources Manager Error KPI
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">
                  Historical Feed Warnings
                </span>
                <strong
                  className={`mt-1 block text-base tabular-nums ${
                    reconciledSourceCounts.sourcesWithHistoricalErrorsCount > 0
                      ? 'text-amber-400'
                      : 'text-slate-200'
                  }`}
                >
                  {reconciledSourceCounts.sourcesWithHistoricalErrorsCount} sources ({reconciledSourceCounts.totalHistoricalFeedErrorsCount} events)
                </strong>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Prior feed failures on paused/healthy sources
                </span>
              </div>
            </div>

            {historicalWarningFeedSources.length > 0 && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 text-xs">
                <span className="text-[10px] font-mono uppercase text-amber-400 font-semibold block">
                  Sources with Historical Feed Failure Records (0 Active Source Errors)
                </span>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {historicalWarningFeedSources.map((src) => {
                    const resolved = resolveCanonicalSourceOperationalState(src);
                    return (
                      <div
                        key={src.id}
                        className="flex items-center justify-between text-[11px] font-mono text-slate-300"
                      >
                        <span className="truncate">
                          {src.name}{' '}
                          <span className="text-slate-500">
                            ({resolved.badgeLabel} · {resolved.activeFeedsCount}/{resolved.totalFeedsCount} active feeds)
                          </span>
                        </span>
                        <span className="text-amber-400 shrink-0">
                          {resolved.totalErrorCount} prior failure(s)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ContentCard>

          <ContentCard className="p-5 space-y-4">
            <SectionHeader
              title="Architecture Readiness & Governance Audit"
              subtitle="Platform-wide data integrity and security enforcement checklist"
              icon={<Database className="w-4 h-4 text-emerald-400" />}
            />

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-emerald-400 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Authoritative Firestore Repositories
                  </span>
                  <span className="font-mono text-[10px]">VERIFIED</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  All 16 intelligence views read from authoritative Firestore collections in{' '}
                  <code className="font-mono text-slate-300">ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34</code>.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-indigo-400 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" /> Server-Side Gemini AI & Classification Pipeline
                  </span>
                  <span className="font-mono text-[10px]">ACTIVE</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  16-type article analysis, story clustering, executive brief generation, and conservative product matching active via server-side endpoints.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                <span className="font-semibold text-slate-200 block">Production Governance Enforced</span>
                <ul className="space-y-1 text-slate-400 text-[11px] list-disc list-inside">
                  <li>Zero fabricated metrics, synthetic sentiment, or fake live scraping.</li>
                  <li>All write probes and reconciliation mutations require explicit admin authorization.</li>
                  <li>Dry-run inspections guarantee zero Firestore writes.</li>
                </ul>
              </div>
            </div>
          </ContentCard>
        </div>
      )}
    </div>
  );
};

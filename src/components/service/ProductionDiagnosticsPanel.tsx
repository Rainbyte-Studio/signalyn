/**
 * Signalyn Service Intelligence - Production Diagnostics & Match Evidence Review Panel
 * Phases S1.2.1, S1.2.2, and S1.2.3
 *
 * Objectives:
 * 1. Admin-only diagnostic interface validating real production Firestore persistence.
 * 2. Visualizes runtime environment (Cloud Run vs Preview sandbox), project, and database.
 * 3. Audits actual Firestore collection counts (with UNAVAILABLE indicators when blocked).
 * 4. Displays breakdown of serviceProductMatches by Confidence Tier and Admin Review Status.
 * 5. Provides a controlled "Run Persistence Test" button executing write/read-back/verify/delete lifecycle.
 * 6. Provides Dry-Run Match Reconciliation -> Evidence Quality Gate -> Snapshot-Verified Bounded Persistence.
 * 7. Exposes S1.2.3 Match Evidence Review with 7 filters, expandable 8-point evidence inspector,
 *    36-candidate Stratified Quality Audit viewer, and Matcher Rule Registry.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Database,
  RefreshCw,
  Server,
  CheckCircle2,
  XCircle,
  Play,
  Activity,
  ArrowRightLeft,
  Layers,
  Check,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  FileSearch,
  BookOpen,
} from 'lucide-react';
import {
  ProductionDiagnosticsReport,
  PersistenceProbeReport,
  MatchRecomputeSummary,
  MatchEvidenceReviewResponse,
  ServiceProductMatch,
  SourceAuthenticityAuditSummary,
  AppleSelectiveReprocessReport,
} from '../../types/serviceIntelligence';
import { useApp } from '../../context/AppContext';
import { auth } from '../../firebase';
import { getAuthorizedApiHeaders } from '../../services/apiSessionClient';

interface ProductionDiagnosticsPanelProps {
  onRecomputeCompleted?: () => void;
}

export const ProductionDiagnosticsPanel: React.FC<ProductionDiagnosticsPanelProps> = ({
  onRecomputeCompleted,
}) => {
  const { canManage } = useApp();
  const [report, setReport] = useState<ProductionDiagnosticsReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [isRecomputingDryRun, setIsRecomputingDryRun] = useState(false);
  const [isPersistingMatches, setIsPersistingMatches] = useState(false);
  const [isLoadingEvidenceReview, setIsLoadingEvidenceReview] = useState(false);
  const [dryRunSummary, setDryRunSummary] = useState<MatchRecomputeSummary | null>(null);
  const [persistSummary, setPersistSummary] = useState<MatchRecomputeSummary | null>(null);
  const [evidenceReview, setEvidenceReview] = useState<MatchEvidenceReviewResponse | null>(null);
  const [appleReprocessReport, setAppleReprocessReport] =
    useState<AppleSelectiveReprocessReport | null>(null);
  const [isPreviewingAppleReprocess, setIsPreviewingAppleReprocess] = useState(false);
  const [isPersistingAppleReprocess, setIsPersistingAppleReprocess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [probeNotice, setProbeNotice] = useState<string | null>(null);

  // S1.2.3 & S1.2.4 Objective 4 & 5: Match Evidence Review Filters & Expandable State
  const [searchQuery, setSearchQuery] = useState('');
  const [manufacturerFilter, setManufacturerFilter] = useState<string>('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('ALL');
  const [authenticityFilter, setAuthenticityFilter] = useState<string>('ALL');
  const [relationshipFilter, setRelationshipFilter] = useState<string>('ALL');
  const [strengthFilter, setStrengthFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [missingEvidenceFilter, setMissingEvidenceFilter] = useState<string>('ALL');
  const [ruleIdFilter, setRuleIdFilter] = useState<string>('ALL');
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(25);
  const [showStratifiedAudit, setShowStratifiedAudit] = useState<boolean>(false);
  const [showRuleRegistry, setShowRuleRegistry] = useState<boolean>(false);
  const [showSourceAuthenticityAudit, setShowSourceAuthenticityAudit] = useState<boolean>(true);
  const [showS125IntegrityAudit, setShowS125IntegrityAudit] = useState<boolean>(true);
  const [authenticityAuditTab, setAuthenticityAuditTab] = useState<
    'VERIFIED' | 'CAVEATS' | 'UNVERIFIABLE' | 'CONTRADICTED' | 'EXCLUDED'
  >('VERIFIED');

  const fetchDiagnostics = async (runProbe = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await getAuthorizedApiHeaders(auth);
      const url = `/api/service/diagnostic/persistence${runProbe ? '?runProbe=true' : ''}`;
      const res = await fetch(url, { headers });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Access Denied: Production Diagnostics is restricted to authenticated administrators.');
      }

      const data = await res.json();
      if (!data.success || !data.diagnostic) {
        throw new Error(data.error || 'Failed to retrieve diagnostic data.');
      }

      setReport(data.diagnostic);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchEvidenceReview = async (reuseSnapshot = true) => {
    setIsLoadingEvidenceReview(true);
    setInspectorError(null);
    try {
      const headers = await getAuthorizedApiHeaders(auth);
      const res = await fetch(
        `/api/service/matches/evidence-review?reuseSnapshot=${reuseSnapshot ? 'true' : 'false'}`,
        { headers },
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error('Unauthorized: Administrator privileges required to inspect match evidence.');
      }
      const data = await res.json();
      if (!data.success || !data.review) {
        throw new Error(data.error || 'Failed to load match evidence review.');
      }
      const reviewPayload: MatchEvidenceReviewResponse = data.review;
      setEvidenceReview(reviewPayload);
      setDryRunSummary(reviewPayload.summary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setInspectorError(msg);
    } finally {
      setIsLoadingEvidenceReview(false);
    }
  };

  const handleRunPersistenceTest = async () => {
    setIsProbing(true);
    setProbeNotice(null);
    setError(null);
    try {
      const headers = await getAuthorizedApiHeaders(auth);
      const res = await fetch('/api/service/diagnostic/probe', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Unauthorized: Administrator privileges required to run persistence probes.');
      }

      const data = await res.json();
      if (!data.success || !data.probeReport) {
        throw new Error(data.error || 'Persistence probe returned failure status.');
      }

      const p: PersistenceProbeReport = data.probeReport;
      if (p.overallResult === 'VERIFIED') {
        setProbeNotice(
          `Persistence Probe VERIFIED: Write, read-back, content verification, and cleanup succeeded cleanly in Firestore (doc: ${p.probeDocId}).`,
        );
      } else {
        setError(`Persistence Probe FAILED: ${p.summaryMessage}`);
      }

      await fetchDiagnostics(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsProbing(false);
    }
  };

  const handlePreviewMatchReconciliation = async () => {
    setIsRecomputingDryRun(true);
    setError(null);
    setInspectorError(null);
    setProbeNotice(null);
    try {
      const headers = await getAuthorizedApiHeaders(auth);
      const res = await fetch('/api/service/matches/recompute', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'DRY_RUN',
          confirmPersistence: false,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Unauthorized: Administrator privileges required to preview match reconciliation.');
      }

      const data = await res.json();
      if (!data.summary) {
        throw new Error(data.error || 'Match reconciliation dry-run failed.');
      }

      setDryRunSummary(data.summary);
      setPersistSummary(null);
      await fetchEvidenceReview(true);
      await fetchDiagnostics(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsRecomputingDryRun(false);
    }
  };

  const handleConfirmAndPersistMatches = async () => {
    setIsPersistingMatches(true);
    setError(null);
    setProbeNotice(null);
    try {
      const snapshotHash = dryRunSummary?.dryRunSnapshotHash || evidenceReview?.dryRunSnapshotHash;
      const headers = await getAuthorizedApiHeaders(auth);
      const res = await fetch('/api/service/matches/recompute', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'PERSIST',
          confirmPersistence: true,
          expectedSnapshotHash: snapshotHash,
          requirePriorDryRun: true,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Unauthorized: Administrator privileges required to persist product matches.');
      }

      const data = await res.json();
      if (!data.summary) {
        throw new Error(data.error || 'Match persistence failed.');
      }

      const summary: MatchRecomputeSummary = data.summary;
      setPersistSummary(summary);
      setDryRunSummary(summary);

      if (summary.status === 'PERSISTED_VERIFIED') {
        setProbeNotice(
          `Product Match Reconciliation Completed (${summary.status}): Persisted ${summary.persistedTotalCount} matches (${summary.persistedVerifiedCount} VERIFIED, ${summary.persistedPendingReviewCount} Pending Review, Batches: ${summary.batchesCommitted}).`,
        );
      } else {
        setError(
          `Match Persistence Status: ${summary.status} — ${summary.writeErrors.join('; ') || 'Partial or failed write.'}`,
        );
      }

      await fetchDiagnostics(false);
      if (onRecomputeCompleted) {
        onRecomputeCompleted();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsPersistingMatches(false);
    }
  };

  const handlePreviewAppleSelectiveReprocess = async () => {
    setIsPreviewingAppleReprocess(true);
    setError(null);
    setProbeNotice(null);
    try {
      const headers = await getAuthorizedApiHeaders(auth);
      const res = await fetch('/api/service/advisories/reprocess-apple', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'DRY_RUN',
          confirmPersistence: false,
          includeMetadataNormalization: true,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          'Unauthorized: Administrator privileges required to preview Apple advisory reprocessing.',
        );
      }
      const data = await res.json();
      if (!data.report) {
        throw new Error(data.error || 'Failed to generate Apple selective reprocessing preview.');
      }
      setAppleReprocessReport(data.report);
      setProbeNotice(
        `Selective Apple Reprocessing Dry Run Ready: ${data.report.recordsPlannedForUpdateCount} Apple advisory record(s) queued for normalization (${data.report.staleSchemaAdvisoriesTargetedCount} legacy zero-CVE schema/duplicates, ${data.report.missingDetailCveAdvisoriesTargetedCount} missing detail CVEs). Zero Firestore writes executed.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsPreviewingAppleReprocess(false);
    }
  };

  const handleConfirmAndPersistAppleSelectiveReprocess = async () => {
    setIsPersistingAppleReprocess(true);
    setError(null);
    setProbeNotice(null);
    try {
      const headers = await getAuthorizedApiHeaders(auth);
      const res = await fetch('/api/service/advisories/reprocess-apple', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'PERSIST',
          confirmPersistence: true,
          expectedSnapshotHash: appleReprocessReport?.snapshotHashBefore,
          includeMetadataNormalization: true,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          'Unauthorized: Administrator privileges required to persist Apple advisory corrections.',
        );
      }
      const data = await res.json();
      if (!data.report) {
        throw new Error(data.error || 'Selective Apple advisory persistence failed.');
      }
      const rep: AppleSelectiveReprocessReport = data.report;
      setAppleReprocessReport(rep);
      if (rep.status === 'PERSISTED_AND_VERIFIED' || rep.status === 'NO_CHANGES_REQUIRED') {
        setProbeNotice(
          `Selective Apple Advisory Reprocessing Verified (${rep.status}): Persisted ${rep.recordsPersistedCount} Apple record(s) in ${rep.batchesCommitted} batch(es). Quality Gate: ${rep.afterMetrics.qualityGatePassCount}/12 PASS (${rep.afterMetrics.qualityGateOverallStatus}).`,
        );
      } else {
        setError(
          `Selective Apple Reprocessing Status: ${rep.status} — ${rep.errors.join('; ') || 'Partial or failed write.'}`,
        );
      }
      await fetchEvidenceReview(false);
      await fetchDiagnostics(false);
      if (onRecomputeCompleted) {
        onRecomputeCompleted();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsPersistingAppleReprocess(false);
    }
  };

  useEffect(() => {
    if (canManage) {
      (async () => {
        await fetchEvidenceReview(false);
        await fetchDiagnostics(false);
      })();
    }
  }, [canManage]);

  const allReviewPool: ServiceProductMatch[] = useMemo(() => {
    if (!evidenceReview) return [];
    if (confidenceFilter === 'UNMATCHED' || authenticityFilter === 'NOT_APPLICABLE') {
      return evidenceReview.rejectedSample || [];
    }
    return evidenceReview.candidates || [];
  }, [evidenceReview, confidenceFilter, authenticityFilter]);

  const filteredCandidates = useMemo(() => {
    return allReviewPool.filter((m) => {
      if (manufacturerFilter !== 'ALL' && m.manufacturer !== manufacturerFilter) return false;
      if (confidenceFilter !== 'ALL' && m.confidence !== confidenceFilter) return false;
      if (authenticityFilter !== 'ALL' && m.authenticityClassification !== authenticityFilter) return false;
      if (relationshipFilter !== 'ALL' && m.relationshipType !== relationshipFilter) return false;
      if (strengthFilter !== 'ALL' && m.evidenceStrength !== strengthFilter) return false;
      if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
      if (ruleIdFilter !== 'ALL' && m.matcherRuleId !== ruleIdFilter) return false;

      const hasMissing = Boolean(
        (m.missingEvidence && m.missingEvidence.length > 0) ||
          (m.sourceAuthenticityWarnings && m.sourceAuthenticityWarnings.length > 0),
      );
      if (missingEvidenceFilter === 'HAS_MISSING_EVIDENCE' && !hasMissing) return false;
      if (missingEvidenceFilter === 'COMPLETE_EVIDENCE' && hasMissing) return false;

      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase().trim();
        const hay = [
          m.productTitle,
          m.canonicalProductId,
          m.exactModel || '',
          m.productFamily || '',
          m.advisoryTitle || '',
          m.advisoryId,
          m.matcherRuleId || '',
          m.authenticityClassification || '',
          m.attributableExcerpt || '',
          m.evidenceSummary || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    allReviewPool,
    manufacturerFilter,
    confidenceFilter,
    authenticityFilter,
    relationshipFilter,
    strengthFilter,
    statusFilter,
    missingEvidenceFilter,
    ruleIdFilter,
    searchQuery,
  ]);

  if (!canManage) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
        <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto mb-2" />
        <h3 className="text-sm font-semibold text-slate-200">Production Diagnostics Restricted</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          This panel performs direct database verification against named Firestore database{' '}
          <code className="text-amber-300 font-mono">ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34</code>.
          Administrator sign-in is required.
        </p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CONNECTED':
      case 'PRODUCTION_VERIFIED':
      case 'FIRESTORE_AUTHORITATIVE':
      case 'SUCCESS':
      case 'VERIFIED':
      case 'RECONCILED':
      case 'COMPLETED':
      case 'PERSISTED_VERIFIED':
      case 'READY_FOR_ADMIN_REVIEW':
      case 'DIRECT_OFFICIAL_EVIDENCE':
      case 'STRUCTURED_MANUFACTURER_APPLICABILITY':
      case 'OFFICIAL_CONFIRMED':
      case 'OFFICIAL_FAMILY_CONFIRMED':
      case 'AUTHENTIC_VERIFIED':
      case 'GO_CONFIRMED_Subset_ONLY':
      case 'GO':
      case 'PASS':
        return 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60';
      case 'PREVIEW_IN_MEMORY_ONLY':
      case 'PARTIAL':
      case 'PARTIAL_VERIFICATION':
      case 'DESYNC_PREVIEW_MEMORY':
      case 'DRY_RUN_ONLY':
      case 'DRY_RUN_READY':
      case 'LIKELY':
      case 'INFERRED_FAMILY_APPLICABILITY':
      case 'INFERRED_NEEDS_REVIEW':
      case 'AUTHENTIC_WITH_EXTRACTION_CAVEAT':
      case 'GENERIC_MAINTENANCE_SCHEDULE':
      case 'ZERO_CVE_RELEASE_NOTE':
      case 'NEEDS_REVIEW':
        return 'text-amber-400 bg-amber-950/40 border-amber-800/60';
      case 'PERMISSION_DENIED':
      case 'PRODUCTION_NOT_VERIFIED':
      case 'PERSISTENCE_FAILED':
      case 'QUALITY_GATE_FAILED':
      case 'QUALITY_GATE_BLOCKED':
      case 'INSUFFICIENT_EVIDENCE':
      case 'FAILED':
      case 'FAIL':
      case 'UNAVAILABLE':
      case 'AMBIGUOUS_REVIEW':
      case 'HEURISTIC_SIMILARITY':
      case 'SOURCE_UNVERIFIABLE':
      case 'SOURCE_CONTRADICTED':
      case 'UNVERIFIABLE':
      case 'CONTRADICTED':
      case 'NO_GO':
        return 'text-rose-400 bg-rose-950/40 border-rose-800/60';
      default:
        return 'text-slate-400 bg-slate-800/60 border-slate-700';
    }
  };

  const activeRecomputeSummary =
    persistSummary || dryRunSummary || evidenceReview?.summary || report?.matchReconciliation?.lastSummary || null;

  // S1.2.5.1 Objective 6: Strict Firestore Persistence Safety Gate
  const hasCriticalRuntimeError =
    Boolean(error) ||
    Boolean(inspectorError) ||
    Boolean(report?.subsystemErrors && report.subsystemErrors.length > 0) ||
    Boolean(evidenceReview?.auditSectionErrors && evidenceReview.auditSectionErrors.length > 0);
  const hasLoadedInspectorSnapshot =
    Boolean(evidenceReview) &&
    Array.isArray(evidenceReview?.candidates) &&
    evidenceReview.candidates.length > 0 &&
    evidenceReview.candidates.length === activeRecomputeSummary?.candidateMatchesGenerated;
  const isSnapshotHashAligned =
    Boolean(activeRecomputeSummary?.dryRunSnapshotHash) &&
    evidenceReview?.dryRunSnapshotHash === activeRecomputeSummary?.dryRunSnapshotHash &&
    evidenceReview?.isSnapshotExpired !== true;
  const isQualityGateBlocking =
    activeRecomputeSummary?.qualityGatePassed === false ||
    evidenceReview?.s125IntegrityAudit?.qualityGate12Check?.overallStatus === 'BLOCKED';

  const canConfirmPersistence =
    Boolean(activeRecomputeSummary) &&
    !hasCriticalRuntimeError &&
    hasLoadedInspectorSnapshot &&
    isSnapshotHashAligned &&
    !isQualityGateBlocking &&
    !isRecomputingDryRun &&
    !isPersistingMatches;

  const persistenceDisableReason = !activeRecomputeSummary
    ? 'Run Dry-Run Preview first to inspect candidate matches before persisting.'
    : hasCriticalRuntimeError
    ? 'Persistence disabled: Resolve runtime or subsystem diagnostic errors first.'
    : !hasLoadedInspectorSnapshot
    ? 'Persistence disabled: Match Evidence Inspector has not loaded the full candidate snapshot.'
    : !isSnapshotHashAligned
    ? 'Persistence disabled: Dry-run snapshot is expired or does not match the active dataset hash.'
    : isQualityGateBlocking
    ? 'Persistence disabled: Mandatory Quality Gate check is BLOCKED.'
    : 'Confirm and persist snapshot-verified candidate matches to Firestore.';

  const authenticityClassCounts = useMemo(() => {
    const cands = evidenceReview?.candidates || [];
    return {
      OFFICIAL_CONFIRMED: cands.filter((c) => c.authenticityClassification === 'OFFICIAL_CONFIRMED').length,
      OFFICIAL_FAMILY_CONFIRMED: cands.filter((c) => c.authenticityClassification === 'OFFICIAL_FAMILY_CONFIRMED').length,
      INFERRED_NEEDS_REVIEW: cands.filter((c) => c.authenticityClassification === 'INFERRED_NEEDS_REVIEW').length,
      SOURCE_UNVERIFIABLE: cands.filter((c) => c.authenticityClassification === 'SOURCE_UNVERIFIABLE').length,
      SOURCE_CONTRADICTED: cands.filter((c) => c.authenticityClassification === 'SOURCE_CONTRADICTED').length,
    };
  }, [evidenceReview]);

  return (
    <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">Production Diagnostics</h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 uppercase">
              Admin Exclusive
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time verification of named Firestore database persistence, runtime credentials, and S1.2.5.1 Match Evidence Quality Gate.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={async () => {
              await fetchEvidenceReview(false);
              await fetchDiagnostics(false);
            }}
            disabled={isLoading || isProbing || isRecomputingDryRun || isPersistingMatches}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            Refresh Diagnostics
          </button>

          <button
            onClick={handleRunPersistenceTest}
            disabled={isLoading || isProbing || isRecomputingDryRun || isPersistingMatches}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition disabled:opacity-50"
          >
            <Play className={`w-3.5 h-3.5 fill-current ${isProbing ? 'animate-pulse' : ''}`} />
            {isProbing ? 'Running Probe...' : 'Run Persistence Test'}
          </button>
        </div>
      </div>

      {/* Error or Notice Alerts (Fault-Isolated by Subsystem) */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-200">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-rose-300">Diagnostic Subsystem Notice:</span> {error}
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 font-mono text-[10px]">
            Dismiss
          </button>
        </div>
      )}

      {inspectorError && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-200">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-rose-300">Match Evidence Inspector Error:</span> {inspectorError}
          </div>
          <button
            onClick={() => setInspectorError(null)}
            className="text-rose-400 hover:text-rose-200 font-mono text-[10px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {((report?.subsystemErrors && report.subsystemErrors.length > 0) ||
        (evidenceReview?.auditSectionErrors && evidenceReview.auditSectionErrors.length > 0)) && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 space-y-1 text-xs font-mono text-amber-200">
          <div className="font-bold text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>Isolated Subsystem Warning(s):</span>
          </div>
          {[...(report?.subsystemErrors || []), ...(evidenceReview?.auditSectionErrors || [])].map(
            (subErr, idx) => (
              <div key={idx} className="text-[11px]">
                <span className="text-amber-300 font-bold">[{subErr.subsystem}]</span>: {subErr.error}
              </div>
            ),
          )}
        </div>
      )}

      {probeNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 flex items-start gap-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-emerald-300">Verification Notice:</span> {probeNotice}
          </div>
          <button
            onClick={() => setProbeNotice(null)}
            className="text-emerald-400 hover:text-emerald-200 font-mono text-[10px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4 Status Ribbons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
            Runtime Environment
          </span>
          <div className="flex items-center gap-1.5">
            <Server className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-sm font-semibold text-slate-200 truncate">
              {report?.runtimeInfo.environment || 'Evaluating...'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 block truncate">
            {report?.runtimeInfo.cloudRunService
              ? `Service: ${report.runtimeInfo.cloudRunService}`
              : 'Preview Sandbox Context'}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
            Firestore Connection
          </span>
          <div className="flex items-center gap-1.5">
            <Database className="w-4 h-4 text-cyan-400 shrink-0" />
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${getStatusColor(
                report?.firestoreConnection || 'NOT_VERIFIED',
              )}`}
            >
              {report?.firestoreConnection || 'CHECKING'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 block truncate">
            Database: {report?.runtimeInfo.firestoreDatabaseId.split('-')[0]}...
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">Storage Mode</span>
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-amber-400 shrink-0" />
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${getStatusColor(
                report?.storageMode || 'UNKNOWN',
              )}`}
            >
              {report?.storageMode || 'UNKNOWN'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 block truncate">
            {report?.storageMode === 'FIRESTORE_AUTHORITATIVE'
              ? 'Authoritative Database Writes'
              : 'Isolated Preview In-Memory'}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
            Persistence Status
          </span>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${getStatusColor(
                report?.overallVerificationStatus || 'PRODUCTION_NOT_VERIFIED',
              )}`}
            >
              {report?.overallVerificationStatus || 'PRODUCTION_NOT_VERIFIED'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 block truncate">
            {report?.overallVerificationStatus === 'PRODUCTION_VERIFIED'
              ? 'Verified in Deployed Cloud Run'
              : 'Requires Cloud Run Verification'}
          </span>
        </div>
      </div>

      {/* Runtime Information Details Bar */}
      <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono">
        <div>
          <span className="text-[10px] text-slate-400 uppercase block">Runtime Env</span>
          <span className="text-slate-100 font-semibold">{report?.runtimeInfo.environment || 'Unknown'}</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 uppercase block">Cloud Run Service</span>
          <span className="text-slate-200">{report?.runtimeInfo.cloudRunService || 'Not Verifiable'}</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 uppercase block">Cloud Run Region</span>
          <span className="text-slate-200">{report?.runtimeInfo.cloudRunRegion || 'Not Verifiable'}</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 uppercase block">Firebase Project ID</span>
          <span className="text-indigo-300">{report?.runtimeInfo.firebaseProjectId || 'signalyn-5406e'}</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 uppercase block">Firestore Database ID</span>
          <span className="text-cyan-300 break-all text-[10px]">
            {report?.runtimeInfo.firestoreDatabaseId || 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34'}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 uppercase block">Last Diagnostic Run</span>
          <span className="text-slate-200">
            {report?.runtimeInfo.timestamp
              ? new Date(report.runtimeInfo.timestamp).toLocaleTimeString()
              : 'Pending'}
          </span>
        </div>
      </div>

      {/* S1.2.5.1 Objective 7: 6 Separated Subsystem Statuses */}
      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/90 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold uppercase text-indigo-300">
            Production Subsystem Health & Isolation Matrix (S1.2.5.1)
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            Fault-Isolated Subsystems • Zero Cross-Module Cascade
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs font-mono">
          <div className="p-2 rounded bg-slate-900 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">1. Firestore Conn.</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-1 ${getStatusColor(
                report?.subsystemStatuses?.firestoreConnectionStatus ||
                  report?.firestoreConnection ||
                  'NOT_VERIFIED',
              )}`}
            >
              {report?.subsystemStatuses?.firestoreConnectionStatus ||
                report?.firestoreConnection ||
                'NOT_VERIFIED'}
            </span>
          </div>
          <div className="p-2 rounded bg-slate-900 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">2. Persistence Probe</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-1 ${getStatusColor(
                report?.subsystemStatuses?.persistenceProbeStatus ||
                  report?.probeReport?.overallResult ||
                  'NOT_RUN',
              )}`}
            >
              {report?.subsystemStatuses?.persistenceProbeStatus ||
                report?.probeReport?.overallResult ||
                'NOT_RUN'}
            </span>
          </div>
          <div className="p-2 rounded bg-slate-900 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">3. Source Sync</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-1 ${getStatusColor(
                report?.subsystemStatuses?.sourceSyncStatus ||
                  report?.lastPersistedSync.status ||
                  'NOT_VERIFIED',
              )}`}
            >
              {report?.subsystemStatuses?.sourceSyncStatus ||
                report?.lastPersistedSync.status ||
                'NOT_VERIFIED'}
            </span>
          </div>
          <div className="p-2 rounded bg-slate-900 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">4. Match Compute</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-1 ${getStatusColor(
                activeRecomputeSummary ? 'VERIFIED' : report?.subsystemStatuses?.matchComputationStatus || 'NOT_RUN',
              )}`}
            >
              {activeRecomputeSummary
                ? `READY (${activeRecomputeSummary.candidateMatchesGenerated})`
                : report?.subsystemStatuses?.matchComputationStatus || 'NOT_RUN'}
            </span>
          </div>
          <div className="p-2 rounded bg-slate-900 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">5. Match Inspector</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-1 ${getStatusColor(
                inspectorError
                  ? 'FAILED'
                  : hasLoadedInspectorSnapshot
                  ? 'VERIFIED'
                  : 'PARTIAL',
              )}`}
            >
              {inspectorError
                ? 'EMPTY_OR_FAILED'
                : hasLoadedInspectorSnapshot
                ? `READY (${evidenceReview?.candidates.length})`
                : 'LOADING'}
            </span>
          </div>
          <div className="p-2 rounded bg-slate-900 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">6. Quality Gate</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-1 ${getStatusColor(
                evidenceReview?.s125IntegrityAudit?.qualityGate12Check?.overallStatus ||
                  report?.subsystemStatuses?.qualityGateStatus ||
                  'NEEDS_REVIEW',
              )}`}
            >
              {evidenceReview?.s125IntegrityAudit?.qualityGate12Check?.overallStatus ||
                report?.subsystemStatuses?.qualityGateStatus ||
                'EVALUATING'}
            </span>
          </div>
        </div>
      </div>

      {/* Persistence Probe Lifecycle Report */}
      {report?.probeReport && (
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-semibold text-slate-200">
                Persistence Probe Result ({report.probeReport.probeDocId})
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400">Overall Result:</span>
              <span
                className={`px-2 py-0.5 rounded font-mono text-xs font-bold border ${getStatusColor(
                  report.probeReport.overallResult,
                )}`}
              >
                {report.probeReport.overallResult}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {new Date(report.probeReport.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-mono text-[11px]">Write:</span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${getStatusColor(
                  report.probeReport.write.status,
                )}`}
              >
                {report.probeReport.write.status}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-mono text-[11px]">Read-back:</span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${getStatusColor(
                  report.probeReport.readBack.status,
                )}`}
              >
                {report.probeReport.readBack.status}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-mono text-[11px]">Content verification:</span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${getStatusColor(
                  report.probeReport.contentVerification.status,
                )}`}
              >
                {report.probeReport.contentVerification.status}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-mono text-[11px]">Cleanup:</span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${getStatusColor(
                  report.probeReport.cleanup.status,
                )}`}
              >
                {report.probeReport.cleanup.status}
              </span>
            </div>
          </div>
          {report.probeReport.remainingDocument && (
            <div className="p-2 rounded bg-amber-950/50 border border-amber-700/60 text-[11px] font-mono text-amber-300">
              Remaining diagnostic document requiring cleanup: <code>{report.probeReport.remainingDocument}</code>
            </div>
          )}
          <p className="text-[11px] text-slate-400 font-mono">Summary: {report.probeReport.summaryMessage}</p>
        </div>
      )}

      {/* Two-Column Section: Actual Firestore Collection Counts & Dashboard Consistency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-1.5">
              <Database className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-semibold text-slate-200">Authoritative Firestore Collection Counts</h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Server-Side Aggregation</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80">
              <span className="text-slate-300 font-mono">serviceSources:</span>
              <span
                className={`font-mono font-bold ${
                  typeof report?.firestoreCounts.serviceSources === 'number' ? 'text-slate-100' : 'text-rose-400'
                }`}
              >
                {report?.firestoreCounts.serviceSources ?? 'UNAVAILABLE'}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80">
              <span className="text-slate-300 font-mono">serviceAdvisories:</span>
              <span
                className={`font-mono font-bold ${
                  typeof report?.firestoreCounts.serviceAdvisories === 'number' ? 'text-slate-100' : 'text-rose-400'
                }`}
              >
                {report?.firestoreCounts.serviceAdvisories ?? 'UNAVAILABLE'}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80">
              <span className="text-slate-300 font-mono">serviceVulnerabilities:</span>
              <span
                className={`font-mono font-bold ${
                  typeof report?.firestoreCounts.serviceVulnerabilities === 'number'
                    ? 'text-slate-100'
                    : 'text-rose-400'
                }`}
              >
                {report?.firestoreCounts.serviceVulnerabilities ?? 'UNAVAILABLE'}
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-mono">serviceProductMatches:</span>
                <span
                  className={`font-mono font-bold ${
                    typeof report?.firestoreCounts.serviceProductMatches === 'number'
                      ? 'text-slate-100'
                      : 'text-rose-400'
                  }`}
                >
                  {report?.firestoreCounts.serviceProductMatches ?? 'UNAVAILABLE'}
                </span>
              </div>
              <div className="pl-3 space-y-1 text-[11px] text-slate-400 font-mono border-l-2 border-indigo-500/30">
                <div className="text-[10px] uppercase text-slate-500">By Confidence Tier:</div>
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    VERIFIED:{' '}
                    <span className="text-slate-200">
                      {report?.firestoreCounts.productMatchesBreakdown.VERIFIED ?? 'UNAVAILABLE'}
                    </span>
                  </div>
                  <div>
                    LIKELY:{' '}
                    <span className="text-slate-200">
                      {report?.firestoreCounts.productMatchesBreakdown.LIKELY ?? 'UNAVAILABLE'}
                    </span>
                  </div>
                  <div>
                    AMBIGUOUS_REVIEW:{' '}
                    <span className="text-slate-200">
                      {report?.firestoreCounts.productMatchesBreakdown.AMBIGUOUS_REVIEW ?? 'UNAVAILABLE'}
                    </span>
                  </div>
                  <div>
                    UNMATCHED:{' '}
                    <span className="text-slate-200">
                      {report?.firestoreCounts.productMatchesBreakdown.UNMATCHED ?? 'UNAVAILABLE'}
                    </span>
                  </div>
                </div>
                {report?.firestoreCounts.productMatchesStatusBreakdown && (
                  <>
                    <div className="text-[10px] uppercase text-slate-500 pt-1">By Review Status:</div>
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        CONFIRMED:{' '}
                        <span className="text-slate-200">
                          {report.firestoreCounts.productMatchesStatusBreakdown.CONFIRMED}
                        </span>
                      </div>
                      <div>
                        PENDING:{' '}
                        <span className="text-slate-200">
                          {report.firestoreCounts.productMatchesStatusBreakdown.PENDING_REVIEW}
                        </span>
                      </div>
                      <div>
                        DISMISSED:{' '}
                        <span className="text-slate-200">
                          {report.firestoreCounts.productMatchesStatusBreakdown.DISMISSED}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80">
              <span className="text-slate-300 font-mono">serviceSyncRuns:</span>
              <span
                className={`font-mono font-bold ${
                  typeof report?.firestoreCounts.serviceSyncRuns === 'number' ? 'text-slate-100' : 'text-rose-400'
                }`}
              >
                {report?.firestoreCounts.serviceSyncRuns ?? 'UNAVAILABLE'}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/80">
              <span className="text-slate-300 font-mono">serviceAlerts:</span>
              <span
                className={`font-mono font-bold ${
                  typeof report?.firestoreCounts.serviceAlerts === 'number' ? 'text-slate-100' : 'text-rose-400'
                }`}
              >
                {report?.firestoreCounts.serviceAlerts ?? 'UNAVAILABLE'}
              </span>
            </div>
          </div>
        </div>

        {/* Dashboard Consistency Comparison Table & Last Persisted Sync */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-semibold text-slate-200">Dashboard Consistency Check</h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Zero Silent Overwrites</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px]">
                  <th className="pb-1.5">Metric</th>
                  <th className="pb-1.5 text-center">Dashboard</th>
                  <th className="pb-1.5 text-center">Firestore</th>
                  <th className="pb-1.5 text-center">Difference</th>
                  <th className="pb-1.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-[11px]">
                {report?.consistencyChecks.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/40">
                    <td className="py-2 text-slate-300 truncate max-w-[130px]">{item.metric}</td>
                    <td className="py-2 text-center text-slate-100">{item.dashboardCount}</td>
                    <td className="py-2 text-center text-slate-400">
                      {item.firestoreCount === 'UNAVAILABLE' ? (
                        <span className="text-rose-400 text-[10px]">UNAVAILABLE</span>
                      ) : (
                        item.firestoreCount
                      )}
                    </td>
                    <td className="py-2 text-center text-amber-300">{item.difference}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(item.status)}`}
                      >
                        {item.status === 'DESYNC_PREVIEW_MEMORY' ? 'PREVIEW MEM' : item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="text-slate-300 text-[11px] font-semibold uppercase">
                Last Successful Sync Verification (serviceSyncRuns)
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(
                  report?.lastPersistedSync.status || 'NOT_VERIFIED',
                )}`}
              >
                {report?.lastPersistedSync.status || 'NOT_VERIFIED'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px]">Source ID</span>
                <span className="text-slate-200">{report?.lastPersistedSync.sourceId || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Sync Run ID</span>
                <span className="text-slate-200 truncate block">{report?.lastPersistedSync.syncRunId || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Completion Time</span>
                <span className="text-slate-200">
                  {report?.lastPersistedSync.completionTimestamp
                    ? new Date(report.lastPersistedSync.completionTimestamp).toLocaleString()
                    : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Records Created</span>
                <span className="text-slate-200">{report?.lastPersistedSync.recordsCreated ?? 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Records Updated</span>
                <span className="text-slate-200">{report?.lastPersistedSync.recordsUpdated ?? 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Persistence Status</span>
                <span className="text-slate-200">{report?.lastPersistedSync.persistenceStatus || 'NOT_VERIFIED'}</span>
              </div>
            </div>
            {report?.lastPersistedSync.notes && (
              <p className="text-[10px] text-amber-400/90 pt-1 border-t border-slate-800/80">
                {report.lastPersistedSync.notes}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* S1.2.5.1 Objectives 3 & 4: Authoritative Counter Reconciliation & Source Sync Schema Audit */}
      {(report?.reconciledCounters || report?.sourceSyncAudit) && (
        <div className="p-4 rounded-xl bg-slate-950/75 border border-indigo-500/30 space-y-3 text-xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <span className="text-indigo-300 font-bold uppercase block">
                Authoritative Advisory & Sync Delta Reconciliation (S1.2.5.1)
              </span>
              <span className="text-[10px] text-slate-400">
                Separates Persisted Collection Totals from Latest Sync Run Deltas & Audits Stored Schema Completeness
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/60 border border-emerald-700/60 text-emerald-300">
              READ-ONLY AUDIT
            </span>
          </div>

          {report?.reconciledCounters && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[11px]">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">totalPersistedAdvisories</span>
                <span className="text-sm font-bold text-emerald-400">
                  {report.reconciledCounters.totalPersistedAdvisories}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">activeAdvisoriesCount</span>
                <span className="text-sm font-bold text-indigo-300">
                  {report.reconciledCounters.activeAdvisoriesCount}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">totalPersistedCisaKevCount</span>
                <span className="text-sm font-bold text-rose-400">
                  {report.reconciledCounters.totalPersistedCisaKevCount}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Latest Sync Delta (New / Upd / Unch)</span>
                <span className="text-sm font-bold text-cyan-300">
                  +{report.reconciledCounters.latestSyncRecordsCreated} /{' '}
                  {report.reconciledCounters.latestSyncRecordsUpdated} /{' '}
                  {report.reconciledCounters.latestSyncRecordsUnchanged}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">latestCompletedSyncStatus</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-0.5 ${getStatusColor(
                    report.reconciledCounters.latestCompletedSyncStatus,
                  )}`}
                >
                  {report.reconciledCounters.latestCompletedSyncStatus}
                </span>
              </div>
            </div>
          )}

          {report?.sourceSyncAudit && (
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/80">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="bg-slate-950 text-slate-400 text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-2">Source ID</th>
                    <th className="p-2 text-center">Persisted Total</th>
                    <th className="p-2 text-center">Current S1.2.5 Schema</th>
                    <th className="p-2 text-center">Stale Pre-S1.2.5 Schema</th>
                    <th className="p-2 text-center">Incomplete Detail CVEs</th>
                    <th className="p-2 text-center">Requires Reprocessing</th>
                    <th className="p-2 text-right">Sync Readiness</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {report.sourceSyncAudit.sources.map((srcItem) => (
                    <tr key={srcItem.sourceId} className="hover:bg-slate-800/40">
                      <td className="p-2 text-slate-200 font-semibold">{srcItem.sourceId}</td>
                      <td className="p-2 text-center text-slate-100 font-bold">
                        {srcItem.totalPersistedRecords}
                      </td>
                      <td className="p-2 text-center text-emerald-400 font-bold">
                        {srcItem.currentSchemaCount}
                      </td>
                      <td className="p-2 text-center text-amber-300">
                        {srcItem.stalePreS125SchemaCount}
                      </td>
                      <td className="p-2 text-center text-amber-300">
                        {srcItem.incompleteMissingDetailCvesCount}
                      </td>
                      <td className="p-2 text-center text-rose-300 font-bold">
                        {srcItem.requiresReprocessingCount}
                      </td>
                      <td className="p-2 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                            srcItem.syncReadinessStatus === 'CURRENT'
                              ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60'
                              : 'text-amber-400 bg-amber-950/40 border-amber-800/60'
                          }`}
                        >
                          {srcItem.syncReadinessStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* S1.2.6 Selective Apple Advisory Reprocessing & Quality Gate Closure Controls */}
          <div className="p-3.5 rounded-xl bg-slate-900/95 border border-cyan-500/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold text-slate-100 uppercase">
                    Selective Apple Advisory Reprocessing & Quality Gate Closure (S1.2.6)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Idempotent, Apple-only reprocessing preserving all existing advisory IDs while normalizing legacy zero-CVE records, resolving duplicate pairs, and extracting official Apple detail-page CVEs.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handlePreviewAppleSelectiveReprocess}
                  disabled={isPreviewingAppleReprocess || isPersistingAppleReprocess}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isPreviewingAppleReprocess ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isPreviewingAppleReprocess
                      ? 'Auditing Official Apple Sources...'
                      : 'Preview Selective Apple Reprocessing (Dry Run)'}
                  </span>
                </button>
                <button
                  onClick={handleConfirmAndPersistAppleSelectiveReprocess}
                  disabled={
                    !appleReprocessReport ||
                    appleReprocessReport.recordsPlannedForUpdateCount === 0 ||
                    isPreviewingAppleReprocess ||
                    isPersistingAppleReprocess
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {isPersistingAppleReprocess
                      ? 'Persisting Apple Corrections...'
                      : 'Confirm & Persist Apple Corrections'}
                  </span>
                </button>
              </div>
            </div>

            {appleReprocessReport && (
              <div className="space-y-3 text-[11px] font-mono">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Mode / Status</span>
                    <span className="text-cyan-300 font-bold">
                      {appleReprocessReport.mode} • {appleReprocessReport.status}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Apple Stale Schema</span>
                    <span className="text-amber-300 font-bold">
                      {appleReprocessReport.beforeMetrics.appleStalePreS125Count} →{' '}
                      <span className="text-emerald-400">
                        {appleReprocessReport.afterMetrics.appleStalePreS125Count}
                      </span>
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Apple Missing Detail CVEs</span>
                    <span className="text-amber-300 font-bold">
                      {appleReprocessReport.beforeMetrics.appleMissingDetailCvesCount} →{' '}
                      <span className="text-emerald-400">
                        {appleReprocessReport.afterMetrics.appleMissingDetailCvesCount}
                      </span>
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Duplicate Groups</span>
                    <span className="text-amber-300 font-bold">
                      {appleReprocessReport.beforeMetrics.duplicateGroupsCount} →{' '}
                      <span className="text-emerald-400">
                        {appleReprocessReport.afterMetrics.duplicateGroupsCount}
                      </span>
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Candidate Matches</span>
                    <span className="text-indigo-300 font-bold">
                      {appleReprocessReport.beforeMetrics.candidateMatchesTotal} →{' '}
                      <span className="text-emerald-400">
                        {appleReprocessReport.afterMetrics.candidateMatchesTotal}
                      </span>
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">12-Check Quality Gate</span>
                    <span className="text-amber-300 font-bold">
                      {appleReprocessReport.beforeMetrics.qualityGatePassCount}/12 →{' '}
                      <span className="text-emerald-400">
                        {appleReprocessReport.afterMetrics.qualityGatePassCount}/12 (
                        {appleReprocessReport.afterMetrics.qualityGateOverallStatus})
                      </span>
                    </span>
                  </div>
                </div>

                {appleReprocessReport.recordChanges.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
                    <table className="w-full text-left text-[10px] font-mono">
                      <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="p-2">Preserved Advisory ID</th>
                          <th className="p-2">Action Taken</th>
                          <th className="p-2">Title (Before → After)</th>
                          <th className="p-2 text-center">CVEs</th>
                          <th className="p-2 text-center">Status</th>
                          <th className="p-2">Official Evidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {appleReprocessReport.recordChanges.map((rc) => (
                          <tr key={rc.advisoryId} className="hover:bg-slate-900/50">
                            <td className="p-2 text-cyan-300 font-semibold">{rc.advisoryId}</td>
                            <td className="p-2 text-indigo-300">{rc.actionTaken}</td>
                            <td className="p-2 text-slate-200">
                              {rc.before.title !== rc.after.title ? (
                                <>
                                  <span className="text-rose-300 line-through block">
                                    {rc.before.title}
                                  </span>
                                  <span className="text-emerald-300 block">{rc.after.title}</span>
                                </>
                              ) : (
                                <span>{rc.after.title}</span>
                              )}
                            </td>
                            <td className="p-2 text-center text-slate-100">
                              {rc.before.cveIds.length} →{' '}
                              <span className="text-emerald-400 font-bold">
                                {rc.after.cveIds.length}
                              </span>
                            </td>
                            <td className="p-2 text-center">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                  rc.after.status === 'SUPERSEDED'
                                    ? 'text-amber-300 bg-amber-950/40 border-amber-800/60'
                                    : 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60'
                                }`}
                              >
                                {rc.after.status}
                              </span>
                            </td>
                            <td className="p-2 text-slate-400 max-w-xs">
                              {rc.officialEvidenceSummary}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Service Product Match Reconciliation & Quality Gate Panel (S1.2.2 + S1.2.3) */}
      <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                Service Product Match Reconciliation & Quality Gate (S1.2.3)
              </h3>
            </div>
            <p className="text-[11px] text-slate-400">
              Preview candidate product-advisory matches against authoritative{' '}
              <code className="text-cyan-300 font-mono">retailProducts</code>, inspect the S1.2.3 Evidence Quality Gate,
              and confirm snapshot-verified Firestore persistence.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePreviewMatchReconciliation}
              disabled={isRecomputingDryRun || isPersistingMatches}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRecomputingDryRun ? 'animate-spin' : ''}`} />
              <span>
                {isRecomputingDryRun ? 'Evaluating Candidates...' : 'Preview Match Reconciliation (Dry Run)'}
              </span>
            </button>

            <button
              onClick={handleConfirmAndPersistMatches}
              disabled={!canConfirmPersistence}
              title={persistenceDisableReason}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isPersistingMatches ? 'Persisting to Firestore...' : 'Confirm & Persist Matches'}</span>
            </button>
          </div>
        </div>

        {/* Persisted vs Candidate Telemetry Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono">
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Persisted Matches</span>
            <span className="text-sm font-bold text-slate-100">
              {report?.firestoreCounts.serviceProductMatches ?? 'UNAVAILABLE'}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">VERIFIED Persisted</span>
            <span className="text-sm font-bold text-emerald-400">
              {report?.firestoreCounts.productMatchesBreakdown.VERIFIED ?? 'UNAVAILABLE'}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Pending Review Persisted</span>
            <span className="text-sm font-bold text-amber-400">
              {report?.firestoreCounts.productMatchesStatusBreakdown?.PENDING_REVIEW ?? 'UNAVAILABLE'}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Computed Candidates</span>
            <span className="text-sm font-bold text-indigo-300">
              {activeRecomputeSummary?.candidateMatchesGenerated ??
                report?.matchReconciliation?.computedCandidatesCount ??
                0}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Quality Gate Status</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-block mt-0.5 ${getStatusColor(
                activeRecomputeSummary?.qualityGateStatus || 'PRODUCTION_NOT_VERIFIED',
              )}`}
            >
              {activeRecomputeSummary?.qualityGateStatus || 'NOT_EVALUATED'}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Dry-Run Snapshot Hash</span>
            <span className="text-[11px] text-cyan-300 truncate block mt-0.5">
              {activeRecomputeSummary?.dryRunSnapshotHash || 'Not Computed'}
            </span>
          </div>
        </div>

        {/* Dry-Run / Persistence Extended S1.2.3 Reconciliation Summary */}
        {activeRecomputeSummary && (
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-indigo-500/30 space-y-3 text-xs font-mono">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-indigo-300 font-bold uppercase">
                  Reconciliation & Quality Gate Summary ({activeRecomputeSummary.mode})
                </span>
                <span className="text-[10px] text-slate-400">
                  Catalog: {activeRecomputeSummary.catalogSource} • Matcher: {activeRecomputeSummary.matcherVersion}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(
                    activeRecomputeSummary.status,
                  )}`}
                >
                  {activeRecomputeSummary.status}
                </span>
                <span className="text-[10px] text-slate-400">
                  {new Date(activeRecomputeSummary.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800/80">
                <span className="text-slate-500 block text-[10px]">Advisories × Products</span>
                <span className="text-slate-100 font-bold">
                  {activeRecomputeSummary.advisoriesExamined} × {activeRecomputeSummary.canonicalProductsExamined}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800/80">
                <span className="text-slate-500 block text-[10px]">Candidates / Unmatched</span>
                <span className="text-indigo-300 font-bold">{activeRecomputeSummary.candidateMatchesGenerated}</span>
                {' / '}
                <span className="text-slate-400">{activeRecomputeSummary.unmatchedCount ?? activeRecomputeSummary.rejectedCandidates}</span>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800/80">
                <span className="text-slate-500 block text-[10px]">VERIFIED / LIKELY / AMBIG</span>
                <span className="text-emerald-400 font-bold">{activeRecomputeSummary.verifiedCandidates}</span>
                {' / '}
                <span className="text-amber-300 font-bold">{activeRecomputeSummary.likelyCandidates}</span>
                {' / '}
                <span className="text-rose-300 font-bold">{activeRecomputeSummary.ambiguousReviewCandidates}</span>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800/80">
                <span className="text-slate-500 block text-[10px]">VERIFIED Direct / Struct</span>
                <span className="text-emerald-300 font-bold">
                  {activeRecomputeSummary.verifiedWithDirectEvidence ?? 0}
                </span>
                {' / '}
                <span className="text-cyan-300 font-bold">
                  {activeRecomputeSummary.verifiedWithStructuredApplicability ?? 0}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800/80">
                <span className="text-slate-500 block text-[10px]">VERIFIED Missing Evid.</span>
                <span
                  className={`font-bold ${
                    (activeRecomputeSummary.verifiedMissingRequiredEvidence ?? 0) === 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {activeRecomputeSummary.verifiedMissingRequiredEvidence ?? 0}
                </span>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800/80">
                <span className="text-slate-500 block text-[10px]">Create / Update / Same</span>
                <span className="text-slate-200 font-bold">
                  {activeRecomputeSummary.plannedCreates} / {activeRecomputeSummary.plannedUpdates} /{' '}
                  {activeRecomputeSummary.plannedUnchanged}
                </span>
              </div>
            </div>

            {/* Relationship & Evidence Strength Breakdown */}
            {activeRecomputeSummary.relationshipBreakdown && activeRecomputeSummary.evidenceStrengthBreakdown && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[10px]">
                <div className="p-2 rounded bg-slate-950/60 border border-slate-800/70 space-y-1">
                  <span className="text-slate-400 uppercase font-semibold block">Relationship Breakdown</span>
                  <div className="grid grid-cols-2 gap-1 text-slate-300">
                    <div>
                      SECURITY_BULLETIN:{' '}
                      <span className="text-slate-100 font-bold">
                        {activeRecomputeSummary.relationshipBreakdown.SECURITY_BULLETIN_APPLICABILITY}
                      </span>
                    </div>
                    <div>
                      UPDATE_ELIGIBILITY:{' '}
                      <span className="text-cyan-300 font-bold">
                        {activeRecomputeSummary.relationshipBreakdown.OFFICIAL_UPDATE_ELIGIBILITY}
                      </span>
                    </div>
                    <div>
                      CONFIRMED_VULN:{' '}
                      <span className="text-amber-300 font-bold">
                        {activeRecomputeSummary.relationshipBreakdown.CONFIRMED_VULNERABILITY_APPLICABILITY}
                      </span>
                    </div>
                    <div>
                      GENERAL_INFO:{' '}
                      <span className="text-slate-400 font-bold">
                        {activeRecomputeSummary.relationshipBreakdown.GENERAL_SECURITY_INFORMATION}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-950/60 border border-slate-800/70 space-y-1">
                  <span className="text-slate-400 uppercase font-semibold block">Evidence Strength Breakdown</span>
                  <div className="grid grid-cols-2 gap-1 text-slate-300">
                    <div>
                      DIRECT_OFFICIAL:{' '}
                      <span className="text-emerald-400 font-bold">
                        {activeRecomputeSummary.evidenceStrengthBreakdown.DIRECT_OFFICIAL_EVIDENCE}
                      </span>
                    </div>
                    <div>
                      STRUCTURED_MFG:{' '}
                      <span className="text-cyan-300 font-bold">
                        {activeRecomputeSummary.evidenceStrengthBreakdown.STRUCTURED_MANUFACTURER_APPLICABILITY}
                      </span>
                    </div>
                    <div>
                      INFERRED_FAMILY:{' '}
                      <span className="text-amber-300 font-bold">
                        {activeRecomputeSummary.evidenceStrengthBreakdown.INFERRED_FAMILY_APPLICABILITY}
                      </span>
                    </div>
                    <div>
                      HEURISTIC:{' '}
                      <span className="text-rose-300 font-bold">
                        {activeRecomputeSummary.evidenceStrengthBreakdown.HEURISTIC_SIMILARITY}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeRecomputeSummary.qualityGateBlockingReasons &&
              activeRecomputeSummary.qualityGateBlockingReasons.length > 0 && (
                <div className="p-2.5 rounded bg-rose-950/50 border border-rose-800/70 text-[11px] text-rose-200 space-y-1">
                  <div className="font-bold text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    Quality Gate Blocking Reasons:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {activeRecomputeSummary.qualityGateBlockingReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

            {activeRecomputeSummary.qualityGateWarnings &&
              activeRecomputeSummary.qualityGateWarnings.length > 0 && (
                <div className="p-2 rounded bg-slate-950/80 border border-slate-800 text-[10px] text-slate-300">
                  {activeRecomputeSummary.qualityGateWarnings.join(' • ')}
                </div>
              )}
          </div>
        )}
      </div>

      {/* S1.2.3 Objective 5 & 6: Match Evidence Review & Stratified Audit Section */}
      <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <FileSearch className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                Match Evidence Review (S1.2.3 Quality Gate Inspector)
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Read-Only Zero-Write Audit
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Filter and inspect exact source evidence, product family/generation rules, missing evidence flags, and the
              36-item Stratified Representative Quality Audit before approving bulk persistence.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowS125IntegrityAudit((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-200 border border-cyan-600/60 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {showS125IntegrityAudit ? 'Hide' : 'View'} Official Source Adapter & Data Integrity Audit (S1.2.5)
              </span>
            </button>

            <button
              onClick={() => setShowSourceAuthenticityAudit((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                {showSourceAuthenticityAudit ? 'Hide' : 'View'} Source Authenticity Audit (S1.2.4)
              </span>
            </button>

            <button
              onClick={() => setShowStratifiedAudit((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                {showStratifiedAudit ? 'Hide' : 'View'} Stratified Quality Audit (
                {evidenceReview?.stratifiedAudit.totalSampled ?? 36} Samples)
              </span>
            </button>

            <button
              onClick={() => setShowRuleRegistry((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>
                {showRuleRegistry ? 'Hide' : 'View'} Matcher Rule Registry ({evidenceReview?.ruleRegistry.length ?? 17}{' '}
                Rules)
              </span>
            </button>
          </div>
        </div>

        {/* S1.2.5 Objective J: Official Source Adapter & Data Integrity Audit */}
        {showS125IntegrityAudit && evidenceReview?.s125IntegrityAudit && (
          <div className="p-4 rounded-xl bg-slate-900/95 border border-cyan-500/40 space-y-4 text-xs font-mono">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-cyan-300 font-bold uppercase text-xs">
                    Official Source Adapter & Data Integrity Audit (S1.2.5)
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(
                      evidenceReview.s125IntegrityAudit.qualityGate12Check.overallStatus,
                    )}`}
                  >
                    12-Check Quality Gate: {evidenceReview.s125IntegrityAudit.qualityGate12Check.overallStatus} (
                    {evidenceReview.s125IntegrityAudit.qualityGate12Check.passCount} PASS /{' '}
                    {evidenceReview.s125IntegrityAudit.qualityGate12Check.needsReviewCount} NEEDS_REVIEW /{' '}
                    {evidenceReview.s125IntegrityAudit.qualityGate12Check.blockedCount} BLOCKED)
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                    Duplicate Advisory Groups: {evidenceReview.s125IntegrityAudit.duplicateAdvisoriesAudit.duplicateGroupCount}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-1">
                  {evidenceReview.s125IntegrityAudit.candidateCountComparison.explanation}
                </p>
              </div>
              <div className="text-right text-[10px] text-slate-400">
                <div>Version: {evidenceReview.s125IntegrityAudit.version}</div>
                <div>Audited: {new Date(evidenceReview.s125IntegrityAudit.auditedAt).toLocaleTimeString()}</div>
              </div>
            </div>

            {/* Candidate Match Comparison & Product Classification Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">S1.2.2 Candidates</span>
                <span className="text-sm font-bold text-slate-200">
                  {evidenceReview.s125IntegrityAudit.candidateCountComparison.s122Count}
                </span>
                <span className="text-[9px] text-slate-500 block">Pre-hardening baseline</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">S1.2.3 / S1.2.4 Candidates</span>
                <span className="text-sm font-bold text-slate-200">
                  {evidenceReview.s125IntegrityAudit.candidateCountComparison.s123AndS124Count}
                </span>
                <span className="text-[9px] text-slate-500 block">-231 Apple delta</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-cyan-800/60">
                <span className="text-[10px] text-cyan-300 block">S1.2.5 Current Candidates</span>
                <span className="text-sm font-bold text-cyan-300">
                  {evidenceReview.s125IntegrityAudit.candidateCountComparison.s125CurrentCount}
                </span>
                <span className="text-[9px] text-emerald-400 block">
                  +{evidenceReview.s125IntegrityAudit.candidateCountComparison.restoredByClassificationAndParserFixes} restored hardware matches
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-emerald-800/60">
                <span className="text-[10px] text-emerald-300 block">Restored Primary SKUs</span>
                <span className="text-sm font-bold text-emerald-400">
                  {evidenceReview.s125IntegrityAudit.productClassificationAudit.restoredPrimarySkuCount} SKUs
                </span>
                <span className="text-[9px] text-slate-400 block">
                  22 Watch • 3 iPad Glass • 5 MatePad+KB
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Schedule Matches in VERIFIED</span>
                <span className="text-sm font-bold text-emerald-400">
                  {evidenceReview.s125IntegrityAudit.reconciliationPreview.candidateMatchesSummary.scheduleMatchesInVerifiedCount}
                </span>
                <span className="text-[9px] text-slate-400 block">Huawei schedules capped at LIKELY</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-amber-800/60">
                <span className="text-[10px] text-amber-300 block">Stored Advisories to Re-Sync</span>
                <span className="text-sm font-bold text-amber-400">
                  {evidenceReview.s125IntegrityAudit.reconciliationPreview.advisoriesRequiringCorrectionCount}
                </span>
                <span className="text-[9px] text-slate-400 block">Read-only preview ready</span>
              </div>
            </div>

            {/* Source Adapter Health by Provider & 12-Check Quality Gate */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="text-[10px] uppercase font-bold text-cyan-300">
                  Source Adapter Health & CVE Extraction Coverage by Provider
                </div>
                <div className="space-y-1.5 text-[10px]">
                  {evidenceReview.s125IntegrityAudit.providerAdapterHealth.map((prov) => (
                    <div key={prov.sourceId} className="p-2 rounded bg-slate-900 border border-slate-800/80 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-100">
                          {prov.providerName} ({prov.persistedAdvisoryCount} records)
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(prov.status)}`}
                        >
                          {prov.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-slate-400">
                        <span>Verified Sources: {prov.verifiedAuthenticCount}</span>
                        <span>Unverifiable: {prov.unverifiableCount}</span>
                        <span>With CVEs: {prov.advisoriesWithExtractedCves}</span>
                        <span>Zero-CVE/Sched: {prov.zeroCveMaintenanceReleasesCount}</span>
                      </div>
                      <div className="text-emerald-300/90">
                        Adapter Fixes: {prov.adapterFixesImplemented[0]}
                      </div>
                      {prov.storedRecordFindings.length > 0 && (
                        <div className="text-amber-300/90">
                          Stored Firestore State: {prov.storedRecordFindings.join(' ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-emerald-300">
                    12-Check Production Quality Gate (Section 11)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    PASS: {evidenceReview.s125IntegrityAudit.qualityGate12Check.passCount} • NEEDS_REVIEW:{' '}
                    {evidenceReview.s125IntegrityAudit.qualityGate12Check.needsReviewCount} • BLOCKED:{' '}
                    {evidenceReview.s125IntegrityAudit.qualityGate12Check.blockedCount}
                  </span>
                </div>
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1 text-[10px]">
                  {evidenceReview.s125IntegrityAudit.qualityGate12Check.checks.map((chk) => (
                    <div
                      key={chk.checkId}
                      className="p-2 rounded bg-slate-900/90 border border-slate-800/80 flex items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-200">
                          #{chk.checkNumber}. {chk.title}{' '}
                          <span className="text-slate-500 font-normal">({chk.checkId})</span>
                        </div>
                        <p className="text-slate-400 leading-relaxed">{chk.explanation}</p>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 ${getStatusColor(
                          chk.status,
                        )}`}
                      >
                        {chk.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Restored Primary Hardware SKUs & Proposed Advisory Corrections Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-emerald-300">
                    Product Classification Corrections ({evidenceReview.s125IntegrityAudit.productClassificationAudit.restoredPrimarySkuCount} Restored SKUs)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    SMARTPHONE: {evidenceReview.s125IntegrityAudit.productClassificationAudit.countsByCategory.SMARTPHONE} •
                    TABLET: {evidenceReview.s125IntegrityAudit.productClassificationAudit.countsByCategory.TABLET} •
                    WEARABLE: {evidenceReview.s125IntegrityAudit.productClassificationAudit.countsByCategory.WEARABLE} •
                    EXCLUDED: {evidenceReview.s125IntegrityAudit.productClassificationAudit.countsByCategory.ACCESSORY + evidenceReview.s125IntegrityAudit.productClassificationAudit.countsByCategory.AUDIO}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto rounded border border-slate-800 bg-slate-900/60">
                  <table className="w-full text-left text-[10px] font-mono">
                    <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-1.5">Brand</th>
                        <th className="p-1.5">Restored Primary Hardware SKU</th>
                        <th className="p-1.5">Derived Type</th>
                        <th className="p-1.5">Rule</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {evidenceReview.s125IntegrityAudit.productClassificationAudit.restoredPrimarySkus.map((sku) => (
                        <tr key={sku.productId} className="hover:bg-slate-900/80">
                          <td className="p-1.5 text-cyan-300">{sku.brand}</td>
                          <td className="p-1.5 text-slate-100">{sku.productName}</td>
                          <td className="p-1.5 text-emerald-400 font-bold">{sku.derivedDeviceCategory}</td>
                          <td className="p-1.5 text-slate-400">{sku.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-amber-300">
                    Read-Only Discrepancy & Proposed Advisory Corrections Preview ({evidenceReview.s125IntegrityAudit.reconciliationPreview.advisoriesRequiringCorrectionCount})
                  </span>
                  <span className="text-[10px] text-slate-400">Zero Automatic Writes</span>
                </div>
                <div className="max-h-48 overflow-y-auto rounded border border-slate-800 bg-slate-900/60">
                  <table className="w-full text-left text-[10px] font-mono">
                    <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-1.5">Advisory ID</th>
                        <th className="p-1.5">Stored / Expected CVEs</th>
                        <th className="p-1.5">Proposed Correction</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {evidenceReview.s125IntegrityAudit.reconciliationPreview.proposedAdvisoryCorrections.map((corr) => (
                        <tr key={corr.advisoryId} className="hover:bg-slate-900/80">
                          <td className="p-1.5 text-slate-200">{corr.advisoryId}</td>
                          <td className="p-1.5 text-amber-300">
                            {corr.currentCveCount} / {corr.expectedOfficialCveCount ?? 'Detail'}
                          </td>
                          <td className="p-1.5 text-slate-300">{corr.proposedChanges.join(' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* S1.2.4 Objective 1–4: Official Source Authenticity & Product Applicability Audit Summary */}
        {showSourceAuthenticityAudit && evidenceReview?.sourceAuthenticityAudit && (
          <div className="p-4 rounded-xl bg-slate-900/95 border border-emerald-500/30 space-y-4 text-xs font-mono">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-300 font-bold uppercase">
                    S1.2.4 Official Source Authenticity & Product Applicability Audit
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(
                      evidenceReview.sourceAuthenticityAudit.goNoGoRecommendation,
                    )}`}
                  >
                    Recommendation: {evidenceReview.sourceAuthenticityAudit.goNoGoRecommendation}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-1">
                  {evidenceReview.sourceAuthenticityAudit.verified221AuditBreakdown.explanation}
                </p>
              </div>
              <div className="text-right text-[10px] text-slate-400">
                <div>Auditor Version: {evidenceReview.sourceAuthenticityAudit.auditorVersion}</div>
                <div>Audited: {new Date(evidenceReview.sourceAuthenticityAudit.auditedAt).toLocaleTimeString()}</div>
              </div>
            </div>

            {/* 6 Authenticity Classification Counters + 221 VERIFIED Audit */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">OFFICIAL_CONFIRMED</span>
                <span className="text-sm font-bold text-emerald-400">
                  {evidenceReview.sourceAuthenticityAudit.matchAuthenticityCounts.OFFICIAL_CONFIRMED}
                </span>
                <span className="text-[9px] text-slate-500 block">Exact model in CVE bulletin</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-emerald-800/50">
                <span className="text-[10px] text-emerald-300 block">OFFICIAL_FAMILY_CONFIRMED</span>
                <span className="text-sm font-bold text-emerald-400">
                  {evidenceReview.sourceAuthenticityAudit.matchAuthenticityCounts.OFFICIAL_FAMILY_CONFIRMED}
                </span>
                <span className="text-[9px] text-slate-400 block">
                  {evidenceReview.sourceAuthenticityAudit.verified221AuditBreakdown.officialFamilyConfirmed} of{' '}
                  {evidenceReview.sourceAuthenticityAudit.verified221AuditBreakdown.totalCurrentlyVerified} VERIFIED
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-amber-800/50">
                <span className="text-[10px] text-amber-300 block">INFERRED_NEEDS_REVIEW</span>
                <span className="text-sm font-bold text-amber-400">
                  {evidenceReview.sourceAuthenticityAudit.matchAuthenticityCounts.INFERRED_NEEDS_REVIEW}
                </span>
                <span className="text-[9px] text-amber-300/80 block">
                  Includes {evidenceReview.sourceAuthenticityAudit.verified221AuditBreakdown.downgradedToInferredNeedsReview} Huawei schedule matches
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">SOURCE_UNVERIFIABLE</span>
                <span className="text-sm font-bold text-slate-200">
                  {evidenceReview.sourceAuthenticityAudit.matchAuthenticityCounts.SOURCE_UNVERIFIABLE}
                </span>
                <span className="text-[9px] text-slate-500 block">Unreachable / missing source</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">SOURCE_CONTRADICTED</span>
                <span className="text-sm font-bold text-slate-200">
                  {evidenceReview.sourceAuthenticityAudit.matchAuthenticityCounts.SOURCE_CONTRADICTED}
                </span>
                <span className="text-[9px] text-slate-500 block">Contradicted by official page</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">NOT_APPLICABLE (Excluded)</span>
                <span className="text-sm font-bold text-slate-300">
                  {evidenceReview.sourceAuthenticityAudit.matchAuthenticityCounts.NOT_APPLICABLE}
                </span>
                <span className="text-[9px] text-slate-500 block">
                  Of {evidenceReview.sourceAuthenticityAudit.candidateCountReconciliation.totalCandidateCombinationsEvaluated} pairs evaluated
                </span>
              </div>
            </div>

            {/* Per-Authority Authenticity Breakdown + 531 vs 762 Candidate Reconciliation */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="text-[10px] uppercase font-bold text-cyan-300">
                  Official Source Authority Audit (93 Advisories + NVD Enrichment)
                </div>
                <div className="space-y-1.5 text-[10px]">
                  {(
                    Object.entries(evidenceReview.sourceAuthenticityAudit.manufacturerFindings) as Array<
                      [string, SourceAuthenticityAuditSummary['manufacturerFindings']['Apple']]
                    >
                  ).map(([authorityKey, authItem]) => (
                    <div key={authorityKey} className="p-2 rounded bg-slate-900 border border-slate-800/80">
                      <div className="flex items-center justify-between font-bold text-slate-200">
                        <span>
                          {authorityKey} ({authItem.advisoriesCount} advisories)
                        </span>
                        <span className="text-emerald-400">
                          Verified: {authItem.verifiedAuthenticCount} • Caveat/Sched: {authItem.caveatOrScheduleCount}
                        </span>
                      </div>
                      <p className="text-slate-400 mt-0.5 leading-relaxed">{authItem.summaryFinding}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-indigo-300">
                    Objective 3: Candidate Count Reconciliation (531 vs 762 = -231 Delta)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {evidenceReview.sourceAuthenticityAudit.candidateCountReconciliation.totalAdvisoriesExamined} ×{' '}
                    {evidenceReview.sourceAuthenticityAudit.candidateCountReconciliation.totalCanonicalProductsExamined} ={' '}
                    {evidenceReview.sourceAuthenticityAudit.candidateCountReconciliation.totalCandidateCombinationsEvaluated}{' '}
                    pairs
                  </span>
                </div>
                <div className="space-y-1 text-[10px]">
                  {evidenceReview.sourceAuthenticityAudit.candidateCountReconciliation.discrepancyExplanation531Vs762.breakdownOf231ExcludedCandidates.map(
                    (b, idx) => (
                      <div
                        key={idx}
                        className="p-1.5 rounded bg-slate-900/90 border border-slate-800/70 flex items-start justify-between gap-2"
                      >
                        <div>
                          <span className="text-slate-200 font-semibold">{b.category}:</span>{' '}
                          <span className="text-slate-400">{b.technicalCause}</span>
                        </div>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-950/70 border border-indigo-700/50 text-indigo-300 font-bold shrink-0">
                          -{b.excludedCandidateCount}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>

            {/* Separate Tabs for Verified, Caveats/Schedules, Unverifiable, Contradicted, Excluded Advisories */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-2">
                <button
                  type="button"
                  onClick={() => setAuthenticityAuditTab('VERIFIED')}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border transition ${
                    authenticityAuditTab === 'VERIFIED'
                      ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Verified Authentic ({evidenceReview.sourceAuthenticityAudit.advisoryCounts.verifiedAuthentic})
                </button>
                <button
                  type="button"
                  onClick={() => setAuthenticityAuditTab('CAVEATS')}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border transition ${
                    authenticityAuditTab === 'CAVEATS'
                      ? 'bg-amber-950/70 border-amber-600 text-amber-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Caveats / Schedules / Zero-CVE (
                  {evidenceReview.sourceAuthenticityAudit.advisoryCounts.authenticWithCaveats +
                    evidenceReview.sourceAuthenticityAudit.advisoryCounts.genericMaintenanceSchedule}
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setAuthenticityAuditTab('UNVERIFIABLE')}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border transition ${
                    authenticityAuditTab === 'UNVERIFIABLE'
                      ? 'bg-rose-950/70 border-rose-600 text-rose-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Unverifiable ({evidenceReview.sourceAuthenticityAudit.advisoryCounts.unverifiable})
                </button>
                <button
                  type="button"
                  onClick={() => setAuthenticityAuditTab('CONTRADICTED')}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border transition ${
                    authenticityAuditTab === 'CONTRADICTED'
                      ? 'bg-rose-950/70 border-rose-600 text-rose-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Contradicted ({evidenceReview.sourceAuthenticityAudit.advisoryCounts.contradicted})
                </button>
                <button
                  type="button"
                  onClick={() => setAuthenticityAuditTab('EXCLUDED')}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border transition ${
                    authenticityAuditTab === 'EXCLUDED'
                      ? 'bg-indigo-950/70 border-indigo-600 text-indigo-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Zero-Match / Excluded Advisories (
                  {evidenceReview.sourceAuthenticityAudit.candidateCountReconciliation.advisoriesWithZeroMatches})
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80">
                <table className="w-full text-left text-[10px] font-mono">
                  <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-1.5">Advisory ID</th>
                      <th className="p-1.5">Authority Domain</th>
                      <th className="p-1.5">Title</th>
                      <th className="p-1.5">Authenticity Status</th>
                      <th className="p-1.5">Stored / Live CVEs</th>
                      <th className="p-1.5">Audit Findings / Exclusion Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {evidenceReview.sourceAuthenticityAudit.advisoryAudits
                      .filter((advRec) => {
                        if (authenticityAuditTab === 'VERIFIED') {
                          return advRec.authenticityStatus === 'VERIFIED_AUTHENTIC';
                        }
                        if (authenticityAuditTab === 'CAVEATS') {
                          return (
                            advRec.authenticityStatus === 'AUTHENTIC_WITH_PARSING_CAVEATS' ||
                            advRec.authenticityStatus === 'GENERIC_MAINTENANCE_SCHEDULE'
                          );
                        }
                        if (authenticityAuditTab === 'UNVERIFIABLE') {
                          return advRec.authenticityStatus === 'UNVERIFIABLE';
                        }
                        if (authenticityAuditTab === 'CONTRADICTED') {
                          return advRec.authenticityStatus === 'CONTRADICTED';
                        }
                        return advRec.candidateMatchCount === 0;
                      })
                      .map((advRec) => (
                        <tr key={advRec.advisoryId} className="hover:bg-slate-900/60">
                          <td className="p-1.5 text-slate-300">{advRec.advisoryId}</td>
                          <td className="p-1.5 text-cyan-300">{advRec.expectedAuthorityDomain}</td>
                          <td className="p-1.5 text-slate-100 max-w-[200px] truncate" title={advRec.storedTitle}>
                            <a
                              href={advRec.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline inline-flex items-center gap-1"
                            >
                              {advRec.storedTitle}
                              <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                            </a>
                          </td>
                          <td className="p-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(
                                advRec.authenticityStatus,
                              )}`}
                            >
                              {advRec.authenticityStatus}
                            </span>
                          </td>
                          <td className="p-1.5 text-slate-300">
                            {advRec.storedCveCount} / {advRec.livePageCveCount ?? 'N/A'}
                          </td>
                          <td
                            className="p-1.5 text-slate-400 max-w-[320px] truncate"
                            title={
                              authenticityAuditTab === 'EXCLUDED'
                                ? advRec.exclusionReasonIfZeroMatches || ''
                                : [...advRec.missingOrCaveatReasons, ...advRec.findings].join(' | ')
                            }
                          >
                            {authenticityAuditTab === 'EXCLUDED'
                              ? advRec.exclusionReasonIfZeroMatches
                              : advRec.missingOrCaveatReasons.length > 0
                              ? advRec.missingOrCaveatReasons.join(' • ')
                              : advRec.findings.join(' • ')}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Stratified Representative Quality Audit (Objective 6) */}
        {showStratifiedAudit && evidenceReview?.stratifiedAudit && (
          <div className="p-3.5 rounded-xl bg-slate-900/95 border border-cyan-500/30 space-y-3 text-xs font-mono">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <div>
                <span className="text-cyan-300 font-bold uppercase block">
                  Stratified Representative Quality Audit ({evidenceReview.stratifiedAudit.totalSampled} Candidates)
                </span>
                <span className="text-[10px] text-slate-400">
                  {evidenceReview.stratifiedAudit.samplingMethodology}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-700/60 text-emerald-300 font-bold">
                  PASS: {evidenceReview.stratifiedAudit.passCount}
                </span>
                <span className="px-2 py-0.5 rounded bg-rose-950/50 border border-rose-700/60 text-rose-300 font-bold">
                  FAIL: {evidenceReview.stratifiedAudit.failCount}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="sticky top-0 bg-slate-950 text-slate-400 text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-1.5">#</th>
                    <th className="p-1.5">Stratum</th>
                    <th className="p-1.5">Canonical Product</th>
                    <th className="p-1.5">Advisory</th>
                    <th className="p-1.5">Confidence</th>
                    <th className="p-1.5">Authenticity Class</th>
                    <th className="p-1.5">Rule ID</th>
                    <th className="p-1.5 text-right">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {evidenceReview.stratifiedAudit.items.map((item) => (
                    <tr key={item.candidateId} className="hover:bg-slate-800/40">
                      <td className="p-1.5 text-slate-500">{item.sampleIndex}</td>
                      <td className="p-1.5 text-slate-300 max-w-[180px] truncate" title={item.stratumLabel}>
                        {item.stratumLabel}
                      </td>
                      <td className="p-1.5 text-slate-100 max-w-[180px] truncate" title={item.canonicalProductName}>
                        {item.canonicalProductName}
                      </td>
                      <td className="p-1.5 text-indigo-300 max-w-[180px] truncate" title={item.advisoryTitle}>
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline inline-flex items-center gap-1"
                        >
                          {item.advisoryTitle}
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      </td>
                      <td className="p-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(
                            item.actualConfidence,
                          )}`}
                        >
                          {item.actualConfidence}
                        </span>
                      </td>
                      <td className="p-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(
                            item.authenticityClassification || '',
                          )}`}
                        >
                          {item.authenticityClassification || item.relationshipType}
                        </span>
                      </td>
                      <td className="p-1.5 text-cyan-300 text-[10px]">{item.matcherRuleId}</td>
                      <td className="p-1.5 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(
                            item.auditVerdict,
                          )}`}
                        >
                          {item.auditVerdict}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Collapsible Matcher Rule Registry (Objective 1) */}
        {showRuleRegistry && evidenceReview?.ruleRegistry && (
          <div className="p-3.5 rounded-xl bg-slate-900/95 border border-indigo-500/30 space-y-3 text-xs font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-indigo-300 font-bold uppercase">
                S1.2.3 Matcher Rule Registry ({evidenceReview.ruleRegistry.length} Rules)
              </span>
              <span className="text-[10px] text-slate-400">Matcher Version: {evidenceReview.matcherVersion}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-96 overflow-y-auto pr-1">
              {evidenceReview.ruleRegistry.map((rule) => (
                <div
                  key={rule.ruleId}
                  className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-cyan-300">{rule.ruleId}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(
                        rule.targetConfidence,
                      )}`}
                    >
                      Max: {rule.targetConfidence}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Manufacturer: <span className="text-slate-200">{rule.manufacturer}</span> • Strength:{' '}
                    <span className="text-slate-200">{rule.evidenceStrength}</span>
                  </div>
                  <div className="text-[10px] text-slate-300">
                    <span className="text-slate-500">Identity Req:</span> {rule.productIdentityRequirements}
                  </div>
                  <div className="text-[10px] text-amber-300/90">
                    <span className="text-slate-500">Limitations:</span> {rule.confidenceLimitations}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* S1.2.5.1 Objective 2: Active Dry-Run Snapshot Integrity Bar */}
        {evidenceReview && (
          <div className="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-indigo-300 font-bold uppercase">Active Inspector Snapshot:</span>
              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-300 font-bold">
                {evidenceReview.snapshotId || evidenceReview.dryRunSnapshotHash}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                  evidenceReview.isSnapshotExpired
                    ? 'bg-rose-950/60 border-rose-700 text-rose-300'
                    : 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                }`}
              >
                {evidenceReview.isSnapshotExpired ? 'EXPIRED' : 'IMMUTABLE SNAPSHOT ALIGNED'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-slate-300">
              <span>
                Total Pool: <strong className="text-slate-100">{evidenceReview.candidates.length}</strong>
              </span>
              <span>
                VERIFIED:{' '}
                <strong className="text-emerald-400">
                  {evidenceReview.verifiedCountInSnapshot ?? evidenceReview.summary.verifiedCandidates}
                </strong>
              </span>
              <span>
                LIKELY:{' '}
                <strong className="text-amber-300">
                  {evidenceReview.likelyCountInSnapshot ?? evidenceReview.summary.likelyCandidates}
                </strong>
              </span>
              <span>
                AMBIGUOUS_REVIEW:{' '}
                <strong className="text-rose-300">
                  {evidenceReview.ambiguousCountInSnapshot ?? evidenceReview.summary.ambiguousReviewCandidates}
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* Filters + Search Input (including S1.2.4/S1.2.5.1 Dynamic Authenticity Classification Filter) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product, model, advisory, rule, excerpt..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            aria-label="Filter by Manufacturer"
            value={manufacturerFilter}
            onChange={(e) => setManufacturerFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono"
          >
            <option value="ALL">Manufacturer: ALL</option>
            <option value="Apple">Apple</option>
            <option value="Samsung">Samsung</option>
            <option value="Huawei">Huawei</option>
            <option value="Cross-Vendor">Cross-Vendor (CISA KEV)</option>
          </select>

          <select
            aria-label="Filter by Authenticity Classification"
            value={authenticityFilter}
            onChange={(e) => setAuthenticityFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-emerald-800/70 text-emerald-200 text-xs font-mono"
          >
            <option value="ALL">
              Authenticity: ALL ({evidenceReview?.candidates.length ?? 0})
            </option>
            <option value="OFFICIAL_CONFIRMED">
              OFFICIAL_CONFIRMED ({authenticityClassCounts.OFFICIAL_CONFIRMED})
            </option>
            <option value="OFFICIAL_FAMILY_CONFIRMED">
              OFFICIAL_FAMILY_CONFIRMED ({authenticityClassCounts.OFFICIAL_FAMILY_CONFIRMED})
            </option>
            <option value="INFERRED_NEEDS_REVIEW">
              INFERRED_NEEDS_REVIEW ({authenticityClassCounts.INFERRED_NEEDS_REVIEW})
            </option>
            <option value="SOURCE_UNVERIFIABLE">
              SOURCE_UNVERIFIABLE ({authenticityClassCounts.SOURCE_UNVERIFIABLE})
            </option>
            <option value="SOURCE_CONTRADICTED">
              SOURCE_CONTRADICTED ({authenticityClassCounts.SOURCE_CONTRADICTED})
            </option>
            <option value="NOT_APPLICABLE">NOT_APPLICABLE (Rejected Sample)</option>
          </select>

          <select
            aria-label="Filter by Confidence"
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono"
          >
            <option value="ALL">
              Confidence: ALL Candidates ({evidenceReview?.candidates.length ?? 0})
            </option>
            <option value="VERIFIED">
              VERIFIED ({evidenceReview?.verifiedCountInSnapshot ?? evidenceReview?.summary.verifiedCandidates ?? 0})
            </option>
            <option value="LIKELY">
              LIKELY ({evidenceReview?.likelyCountInSnapshot ?? evidenceReview?.summary.likelyCandidates ?? 0})
            </option>
            <option value="AMBIGUOUS_REVIEW">
              AMBIGUOUS_REVIEW ({evidenceReview?.ambiguousCountInSnapshot ?? evidenceReview?.summary.ambiguousReviewCandidates ?? 0})
            </option>
            <option value="UNMATCHED">UNMATCHED (Rejected Sample)</option>
          </select>

          <select
            aria-label="Filter by Relationship Type"
            value={relationshipFilter}
            onChange={(e) => setRelationshipFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono"
          >
            <option value="ALL">Relationship: ALL</option>
            <option value="SECURITY_BULLETIN_APPLICABILITY">SECURITY_BULLETIN_APPLICABILITY</option>
            <option value="OFFICIAL_UPDATE_ELIGIBILITY">OFFICIAL_UPDATE_ELIGIBILITY</option>
            <option value="CONFIRMED_VULNERABILITY_APPLICABILITY">CONFIRMED_VULNERABILITY_APPLICABILITY</option>
            <option value="GENERAL_SECURITY_INFORMATION">GENERAL_SECURITY_INFORMATION</option>
            <option value="GENERAL_MAINTENANCE_INFORMATION">GENERAL_MAINTENANCE_INFORMATION</option>
          </select>

          <select
            aria-label="Filter by Evidence Strength"
            value={strengthFilter}
            onChange={(e) => setStrengthFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono"
          >
            <option value="ALL">Evidence Strength: ALL</option>
            <option value="DIRECT_OFFICIAL_EVIDENCE">DIRECT_OFFICIAL_EVIDENCE</option>
            <option value="STRUCTURED_MANUFACTURER_APPLICABILITY">STRUCTURED_MANUFACTURER_APPLICABILITY</option>
            <option value="INFERRED_FAMILY_APPLICABILITY">INFERRED_FAMILY_APPLICABILITY</option>
            <option value="HEURISTIC_SIMILARITY">HEURISTIC_SIMILARITY</option>
          </select>

          <select
            aria-label="Filter by Review Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono"
          >
            <option value="ALL">Review Status: ALL</option>
            <option value="CONFIRMED">CONFIRMED (Candidate Ready)</option>
            <option value="PENDING_REVIEW">PENDING_REVIEW</option>
            <option value="DISMISSED">DISMISSED</option>
          </select>

          <select
            aria-label="Filter by Missing Evidence"
            value={missingEvidenceFilter}
            onChange={(e) => setMissingEvidenceFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono"
          >
            <option value="ALL">Missing Evidence / Warnings: ALL</option>
            <option value="COMPLETE_EVIDENCE">Complete Evidence Only (0 Missing/Warnings)</option>
            <option value="HAS_MISSING_EVIDENCE">Has Missing Evidence or Source Warnings</option>
          </select>

          <select
            aria-label="Filter by Matcher Rule"
            value={ruleIdFilter}
            onChange={(e) => setRuleIdFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono"
          >
            <option value="ALL">Matcher Rule: ALL</option>
            {evidenceReview?.ruleRegistry.map((r) => (
              <option key={r.ruleId} value={r.ruleId}>
                {r.ruleId}
              </option>
            ))}
          </select>
        </div>

        {/* Filter Status Bar & Page Size Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              Showing <strong className="text-slate-200">{Math.min(visibleLimit, filteredCandidates.length)}</strong> of{' '}
              <strong className="text-slate-200">{filteredCandidates.length}</strong> matching candidate records (Pool:{' '}
              <strong className="text-indigo-300">{allReviewPool.length}</strong>)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isLoadingEvidenceReview && (
              <span className="text-indigo-300 animate-pulse">Loading evidence audit...</span>
            )}
            <span className="text-[10px] text-slate-500">Page Size:</span>
            {[25, 50, 100, 1000].map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setVisibleLimit(sz)}
                className={`px-2 py-0.5 rounded text-[10px] border transition ${
                  visibleLimit === sz
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                }`}
              >
                {sz === 1000 ? 'All' : sz}
              </button>
            ))}
          </div>
        </div>

        {/* Candidate Evidence Table with Expandable 11-Field Detail View (Objective 4) */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/90 text-slate-400 text-[10px] border-b border-slate-800 uppercase">
              <tr>
                <th className="p-2.5">Canonical Product</th>
                <th className="p-2.5">Exact Model / Family</th>
                <th className="p-2.5">Official Advisory & Source</th>
                <th className="p-2.5">Confidence & Authenticity</th>
                <th className="p-2.5">Relationship & Strength</th>
                <th className="p-2.5">Matcher Rule & Warnings</th>
                <th className="p-2.5 text-right">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-[11px]">
              {filteredCandidates.slice(0, visibleLimit).map((m) => {
                const isExpanded = expandedCandidateId === m.id;
                const missingCount = m.missingEvidence?.length || 0;
                const warningCount = m.sourceAuthenticityWarnings?.length || 0;
                const officialUrl = m.sourceUrl || m.officialSourceUrl || '';

                return (
                  <React.Fragment key={m.id}>
                    <tr
                      onClick={() => setExpandedCandidateId(isExpanded ? null : m.id)}
                      className="hover:bg-slate-800/50 cursor-pointer transition"
                    >
                      <td className="p-2.5">
                        <div className="text-slate-100 font-semibold truncate max-w-[210px]" title={m.productTitle}>
                          {m.productTitle}
                        </div>
                        <div className="text-[10px] text-slate-500">{m.canonicalProductId}</div>
                      </td>
                      <td className="p-2.5">
                        <div className="text-cyan-300 font-semibold">{m.exactModel || 'N/A'}</div>
                        <div className="text-[10px] text-slate-400">
                          {m.brand} • {m.productFamily || 'Device'}
                        </div>
                      </td>
                      <td className="p-2.5">
                        <div className="text-slate-200 truncate max-w-[220px]" title={m.advisoryTitle}>
                          {m.advisoryTitle || m.advisoryId}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {m.manufacturer} • {m.sourcePublishedAt ? m.sourcePublishedAt.slice(0, 10) : 'N/A'}
                        </div>
                      </td>
                      <td className="p-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(
                              m.confidence,
                            )}`}
                          >
                            {m.confidence}
                          </span>
                          {m.authenticityClassification && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getStatusColor(
                                m.authenticityClassification,
                              )}`}
                            >
                              {m.authenticityClassification}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">Status: {m.status}</div>
                      </td>
                      <td className="p-2.5">
                        <div className="text-slate-200 text-[10px]">{m.relationshipType}</div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border inline-block mt-0.5 ${getStatusColor(
                            m.evidenceStrength || '',
                          )}`}
                        >
                          {m.evidenceStrength}
                        </span>
                      </td>
                      <td className="p-2.5">
                        <div className="text-indigo-300 text-[10px]">{m.matcherRuleId}</div>
                        {missingCount > 0 || warningCount > 0 ? (
                          <span className="text-[10px] text-amber-400">
                            {missingCount} missing • {warningCount} warning(s)
                          </span>
                        ) : (
                          <span className="text-[10px] text-emerald-400">Complete verified evidence</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px]"
                        >
                          <span>Inspect</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </td>
                    </tr>

                    {/* Expandable 11-Field Evidence & Source Authenticity Detail View (Objective 4) */}
                    {isExpanded && (
                      <tr className="bg-slate-950/95">
                        <td colSpan={7} className="p-4 border-t border-slate-800">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
                            {/* 1. Canonical Product Title & Identity */}
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                              <div className="text-[10px] uppercase text-indigo-300 font-bold">
                                1. Canonical Product Title & Identity
                              </div>
                              <div>
                                Product Title: <span className="text-slate-100 font-semibold">{m.productTitle}</span>
                              </div>
                              <div>
                                ID: <span className="text-slate-300">{m.canonicalProductId}</span> • Brand:{' '}
                                <span className="text-slate-200">{m.brand}</span>
                              </div>
                              <div>
                                Parsed Family: <span className="text-cyan-300">{m.productFamily}</span> • Exact Model:{' '}
                                <span className="text-emerald-300 font-bold">{m.exactModel}</span>
                              </div>
                            </div>

                            {/* 2–6. Advisory Title/ID, Authority, Source URL, Published & Verified Timestamps */}
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                              <div className="text-[10px] uppercase text-indigo-300 font-bold">
                                2–6. Official Advisory, Source Authority, URL & Timestamps
                              </div>
                              <div>
                                Advisory Title: <span className="text-slate-100 font-semibold">{m.advisoryTitle}</span>
                              </div>
                              <div>
                                Advisory ID: <span className="text-slate-300">{m.advisoryId}</span> • Authority:{' '}
                                <span className="text-amber-300">{m.manufacturer}</span>
                              </div>
                              <div>
                                Published: <span className="text-slate-200">{m.sourcePublishedAt || 'N/A'}</span> • Last
                                Fetched/Verified:{' '}
                                <span className="text-cyan-300">{m.sourceVerifiedAt || m.matchedAt || 'N/A'}</span>
                              </div>
                              {officialUrl && (
                                <div className="pt-1">
                                  <a
                                    href={officialUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 underline break-all"
                                  >
                                    <span>{officialUrl}</span>
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                  </a>
                                </div>
                              )}
                            </div>

                            {/* 7. Exact Matched Text / Attributable Excerpt & Structured Fields */}
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                              <div className="text-[10px] uppercase text-indigo-300 font-bold">
                                7. Attributable Source Excerpt & Structured Fields
                              </div>
                              <div className="text-emerald-300 text-[10px] bg-slate-950 p-2 rounded border border-slate-800">
                                {m.attributableExcerpt || m.evidenceSummary}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Source Fields Inspected:{' '}
                                <span className="text-slate-200">
                                  {(m.evidenceSourceFields || []).join(', ') || 'title, affectedProductsText'}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1 pt-1">
                                {(m.evidence || []).map((tok, i) => (
                                  <span
                                    key={i}
                                    className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-cyan-300"
                                  >
                                    {tok}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* 8–11. Matcher Rule ID, Confidence, Authenticity Classification & Missing Evidence/Warnings */}
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                              <div className="text-[10px] uppercase text-indigo-300 font-bold">
                                8–11. Rule ID, Confidence, Authenticity & Warnings
                              </div>
                              <div>
                                Rule ID: <span className="text-cyan-300 font-bold">{m.matcherRuleId}</span> • Confidence:{' '}
                                <span className="text-slate-100 font-bold">{m.confidence}</span> • Authenticity:{' '}
                                <span className="text-emerald-300 font-bold">{m.authenticityClassification}</span>
                              </div>
                              <div>
                                Rationale:{' '}
                                <span className="text-slate-200">
                                  {m.authenticityRationale || m.classificationRationale}
                                </span>
                              </div>
                              {m.missingEvidence && m.missingEvidence.length > 0 ? (
                                <div className="text-amber-300">
                                  Missing Evidence: {m.missingEvidence.join(' | ')}
                                </div>
                              ) : (
                                <div className="text-emerald-400">
                                  Missing Evidence: None
                                </div>
                              )}
                              {m.sourceAuthenticityWarnings && m.sourceAuthenticityWarnings.length > 0 && (
                                <div className="text-amber-300/90 text-[10px]">
                                  Source Warnings: {m.sourceAuthenticityWarnings.join(' | ')}
                                </div>
                              )}
                              <div className="pt-1">
                                Recommended Admin Action:{' '}
                                <span className="px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 font-bold">
                                  {m.recommendedReviewAction}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredCandidates.length > visibleLimit && (
          <div className="text-center pt-1">
            <button
              onClick={() => setVisibleLimit((v) => v + 50)}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700"
            >
              Load More Candidates ({filteredCandidates.length - visibleLimit} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

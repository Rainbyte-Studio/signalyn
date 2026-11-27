import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileText,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Globe,
  TrendingUp,
  ShieldAlert,
  Sparkles,
  ExternalLink,
  Play,
  Activity,
  Layers,
  Calendar,
  Compass,
  Target,
  BarChart3,
  Info,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  GitCompare,
  Cpu,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Archive,
} from 'lucide-react';
import {
  DailyBriefDocument,
  DailyBriefContent,
  PipelineRunRecord,
  PipelineLeaseRecord,
} from '../../types/dailyBrief';
import { DailyAggregate } from '../../types';
import { getAuthorizedApiHeaders } from '../../services/apiSessionClient';
import { useApp } from '../../context/AppContext';
import { AppPage, PageHeader, SemanticBadge } from '../common/DesignSystem';
import {
  buildConsolidatedPriorityDevelopments,
  buildConsolidatedRecommendations,
  classifyDailyBriefHttpResponse,
  DailyBriefReadErrorInfo,
  DailyBriefViewState,
  normalizeBriefDeltaForDisplay,
  RecommendationBucket,
  resolveBriefLocalizedContent,
  resolveBriefReportingDate,
  resolveDailyBriefViewState,
} from '../../utils/dailyBriefPresentation';
import {
  deriveCriticalAlerts,
  deriveStrategicHardwareOverview,
} from '../../services/briefDeltaService';

type PriorityDevelopmentFilter = 'ALL' | 'VERIFIED_ONLY' | 'HIGH_IMPACT' | 'RUMORS_MONITOR';
type DailyBriefLanguage = 'en' | 'el';

export const DailyBriefView: React.FC = () => {
  const { canManage, navigateToStory } = useApp();
  const [language, setLanguage] = useState<DailyBriefLanguage>('en');
  const [briefDoc, setBriefDoc] = useState<DailyBriefDocument | null>(null);
  const [archiveList, setArchiveList] = useState<Partial<DailyBriefDocument>[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [latestRun, setLatestRun] = useState<PipelineRunRecord | null>(null);
  const [lease, setLease] = useState<PipelineLeaseRecord | null>(null);
  const [historicalPulse, setHistoricalPulse] = useState<Array<Pick<DailyAggregate, 'dateKey' | 'articlesCount' | 'totalCompanyMentions'> & { date?: string }>>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isArchiveLoading, setIsArchiveLoading] = useState<boolean>(true);
  const [archiveError, setArchiveError] = useState(false);
  const briefRequestId = useRef(0);
  const archiveRequestId = useRef(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isRunningPipeline, setIsRunningPipeline] = useState<boolean>(false);
  const [readError, setReadError] = useState<DailyBriefReadErrorInfo | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState<Record<string, boolean>>({});

  // Section 2 filter & Section 4 recommendation tab
  const [devFilter, setDevFilter] = useState<PriorityDevelopmentFilter>('ALL');
  const [recBucketFilter, setRecBucketFilter] = useState<'ALL' | RecommendationBucket>('ALL');

  // Expandable Supporting Intelligence & Brief Diagnostics toggles
  const [showBriefDiagnostics, setShowBriefDiagnostics] = useState<boolean>(false);
  const [showHardwareDomains, setShowHardwareDomains] = useState<boolean>(false);
  const [showCompetitorRadar, setShowCompetitorRadar] = useState<boolean>(false);
  const [showDetailedBreakdowns, setShowDetailedBreakdowns] = useState<boolean>(false);
  const [showHistoricalAndArchive, setShowHistoricalAndArchive] = useState<boolean>(false);

  const loadBrief = useCallback(async (dateOverride?: string) => {
    const requestId = ++briefRequestId.current;
    setIsLoading(true);
    setReadError(null);
    if (dateOverride) {
      setBriefDoc(null);
      setSelectedDate(dateOverride);
    }

    try {
      const url = dateOverride
        ? `/api/daily-brief/latest?date=${encodeURIComponent(dateOverride)}`
        : '/api/daily-brief/latest';
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      const contentType = resp.headers.get('content-type');
      const rawBody = await resp.text();
      if (requestId !== briefRequestId.current) return;

      const classification = classifyDailyBriefHttpResponse({
        status: resp.status,
        ok: resp.ok,
        contentType,
        rawBody,
        requestedDate: dateOverride,
      });

      if (classification.outcome === 'LOADED' && classification.brief) {
        setBriefDoc(classification.brief);
        setSelectedDate(classification.brief.date || dateOverride || '');
        setReadError(null);
      } else if (classification.outcome === 'READ_ERROR' && classification.error) {
        setBriefDoc(null);
        if (classification.resolvedDate) {
          setSelectedDate(classification.resolvedDate);
        }
        setReadError(classification.error);
      } else {
        // NOT_FOUND or PUBLISHED_METADATA_MISMATCH (resolved against archiveList in resolveDailyBriefViewState)
        setBriefDoc(null);
        if (classification.resolvedDate) {
          setSelectedDate(classification.resolvedDate);
        }
        setReadError(null);
      }
    } catch (err: any) {
      if (requestId !== briefRequestId.current) return;
      setBriefDoc(null);
      setReadError({
        kind: 'NETWORK_ERROR',
        userMessage:
          'Unable to load Daily Intelligence Brief due to a network or connection failure.',
        diagnosticDetail: err?.message || 'Network request failed.',
      });
    } finally {
      if (requestId === briefRequestId.current) setIsLoading(false);
    }
  }, []);

  const loadArchive = useCallback(async () => {
    const requestId = ++archiveRequestId.current;
    setIsArchiveLoading(true);
    setArchiveError(false);
    try {
      const response = await fetch('/api/daily-brief/archive');
      if (!response.ok) throw new Error('Brief archive read failed');
      const data = await response.json();
      if (!Array.isArray(data.briefs)) throw new Error('Invalid brief archive response');
      if (requestId === archiveRequestId.current) setArchiveList(data.briefs);
    } catch {
      if (requestId === archiveRequestId.current) setArchiveError(true);
    } finally {
      if (requestId === archiveRequestId.current) setIsArchiveLoading(false);
    }
  }, []);

  const loadPipelineStatusAndArchive = useCallback(async () => {
    const archiveRequest = loadArchive();
    try {
      const [statusResp, histResp] = await Promise.all([
        fetch('/api/pipeline/status'),
        fetch('/api/analytics/historical?days=7'),
      ]);

      if (statusResp.ok) {
        const statusData = await statusResp.json();
        setLatestRun(statusData.latestRun || null);
        setLease(statusData.lease || null);
      }

      if (histResp.ok) {
        const histData = await histResp.json();
        setHistoricalPulse(histData.aggregates || []);
      }
    } catch {
      // Non-blocking background metadata load
    }
    await archiveRequest;
  }, [loadArchive]);

  useEffect(() => {
    loadBrief();
    loadPipelineStatusAndArchive();
  }, [loadBrief, loadPipelineStatusAndArchive]);

  const handleRegenerateBrief = async (forceRegenerate: boolean = true) => {
    setIsGenerating(true);
    setActionErrorMessage(null);
    setStatusBanner(
      language === 'el'
        ? 'Σύνθεση Ημερήσιας Αναφοράς Στρατηγικής Ευφυΐας (EN + EL)...'
        : 'Synthesizing Executive Daily Intelligence Brief (EN + EL)...'
    );

    try {
      const headers = await getAuthorizedApiHeaders(true);
      const resp = await fetch('/api/daily-brief/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dateStr: selectedDate || undefined,
          date: selectedDate || undefined,
          forceRegenerate,
        }),
      });
      const data = await resp.json();

      if (!resp.ok || data.status === 'FAILED') {
        throw new Error(data.error || 'Daily Brief generation failed.');
      }

      const generatedBrief = data.brief || (data.id && data.date ? data : null);
      if (generatedBrief) {
        setBriefDoc(generatedBrief);
        setSelectedDate(generatedBrief.date);
        setReadError(null);
      }
      setStatusBanner(
        language === 'el'
          ? 'Η Ημερήσια Αναφορά ενημερώθηκε επιτυχώς!'
          : 'Executive Daily Brief generated and persisted successfully!'
      );
      await loadPipelineStatusAndArchive();
    } catch (err: any) {
      setActionErrorMessage(err.message || 'Error generating Daily Brief.');
      setStatusBanner(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTriggerFullPipeline = async () => {
    setIsRunningPipeline(true);
    setActionErrorMessage(null);
    setStatusBanner(
      language === 'el'
        ? 'Εκτέλεση Πλήρους Ημερήσιου Pipeline (Συλλογή RSS -> Stories -> Analytics -> Ημερήσια Αναφορά)...'
        : 'Executing Full Daily Intelligence Pipeline (RSS Ingestion -> Story Clustering -> Analytics -> Daily Brief)...'
    );

    try {
      const headers = await getAuthorizedApiHeaders(true);
      const resp = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          forceRegenerateBrief: true,
        }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Daily Pipeline execution failed.');
      }

      await loadBrief(selectedDate || undefined);
      await loadPipelineStatusAndArchive();
      setStatusBanner(
        language === 'el'
          ? `Το Pipeline ολοκληρώθηκε (${data.status}).`
          : `Daily Intelligence Pipeline completed (${data.status}).`
      );
    } catch (err: any) {
      setActionErrorMessage(err.message || 'Failed to execute Daily Pipeline.');
      setStatusBanner(null);
    } finally {
      setIsRunningPipeline(false);
    }
  };

  const toggleCitation = (key: string) => {
    setExpandedCitations((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAnalysis = (key: string) => {
    setExpandedAnalysis((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const rawActiveContent = useMemo(
    () => resolveBriefLocalizedContent(briefDoc, language),
    [briefDoc, language]
  );

  const isLegacyBrief = Boolean(
    briefDoc &&
      rawActiveContent &&
      (!rawActiveContent.criticalAlerts || !rawActiveContent.strategicHardwareOverview)
  );

  const activeContent: DailyBriefContent | null = useMemo(() => {
    if (!rawActiveContent) return null;
    if (rawActiveContent.criticalAlerts && rawActiveContent.strategicHardwareOverview) {
      return rawActiveContent;
    }
    const developments = rawActiveContent.headlineDevelopments ?? rawActiveContent.topDevelopments;
    return {
      ...rawActiveContent,
      criticalAlerts:
        rawActiveContent.criticalAlerts ||
        deriveCriticalAlerts([], briefDoc?.targetCompanyId || 'comp-huawei', developments),
      strategicHardwareOverview:
        rawActiveContent.strategicHardwareOverview ||
        deriveStrategicHardwareOverview([], briefDoc?.targetCompanyId || 'comp-huawei', developments),
    };
  }, [rawActiveContent, briefDoc]);

  const normalizedDelta = useMemo(
    () => normalizeBriefDeltaForDisplay(activeContent?.dayOverDayDelta),
    [activeContent]
  );

  const viewState: DailyBriefViewState = useMemo(
    () =>
      resolveDailyBriefViewState({
        isLoading: isLoading || (briefDoc === null && !readError && isArchiveLoading),
        briefDoc,
        activeContent,
        readError,
        selectedDate,
        archiveList,
      }),
    [isLoading, isArchiveLoading, briefDoc, activeContent, readError, selectedDate, archiveList]
  );

  const reportingDateDisplay = useMemo(
    () =>
      resolveBriefReportingDate({
        briefDoc,
        selectedDate,
        archiveList,
      }),
    [briefDoc, selectedDate, archiveList]
  );

  const latestDay = historicalPulse.length > 0 ? historicalPulse[historicalPulse.length - 1] : null;

  // Consolidated Priority Developments (Section 2) & Recommendations (Section 4)
  const priorityDevelopments = useMemo(
    () => buildConsolidatedPriorityDevelopments(activeContent),
    [activeContent]
  );

  const filteredDevelopments = useMemo(() => {
    return priorityDevelopments.filter((dev) => {
      if (devFilter === 'VERIFIED_ONLY') return !dev.isUnconfirmedRumor;
      if (devFilter === 'HIGH_IMPACT') return dev.isCriticalAlert || dev.strategicImportanceScore >= 75;
      if (devFilter === 'RUMORS_MONITOR') return dev.isUnconfirmedRumor;
      return true;
    });
  }, [priorityDevelopments, devFilter]);

  const consolidatedRecommendations = useMemo(
    () => buildConsolidatedRecommendations(activeContent, priorityDevelopments),
    [activeContent, priorityDevelopments]
  );

  const filteredRecommendations = useMemo(() => {
    if (recBucketFilter === 'ALL') return consolidatedRecommendations;
    return consolidatedRecommendations.filter((r) => r.bucket === recBucketFilter);
  }, [consolidatedRecommendations, recBucketFilter]);

  const sentimentBadgeColor = (sentiment?: string) => {
    switch (sentiment) {
      case 'BULLISH':
      case 'EXPANSIVE':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'DEFENSIVE':
      case 'VOLATILE':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      default:
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    }
  };

  return (
    <AppPage>
      {/* Top Executive Header & Controls */}
      <PageHeader
        badge="Executive Daily Brief • Grounded 24h Synthesis"
        title={
          language === 'el'
            ? 'Ημερήσια Αναφορά Στρατηγικής Ευφυΐας'
            : 'Executive Daily Intelligence Brief'
        }
        description={
          language === 'el'
            ? `24ωρη Στρατηγική Σύνθεση Ανταγωνισμού για τη ${briefDoc?.targetCompanyName || 'HUAWEI'} (Ζώνη Ώρας: Europe/Athens)`
            : `24-Hour Grounded Competitive Synthesis for ${briefDoc?.targetCompanyName || 'HUAWEI'} (Europe/Athens Window)`
        }
        actions={
          <>
            {/* Language Switcher (EN / EL) */}
            <div className="inline-flex items-center rounded-lg bg-slate-900 border border-slate-800 p-1">
              <button
                onClick={() => setLanguage('en')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  language === 'en'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>English</span>
              </button>
              <button
                onClick={() => setLanguage('el')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  language === 'el'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Ελληνικά</span>
              </button>
            </div>

            {/* Archive Date Selector */}
            {archiveError && (
              <button type="button" onClick={loadArchive} className="text-xs text-amber-300 underline">
                Archive unavailable · Retry
              </button>
            )}
            {archiveList.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs">
                <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                <select
                  aria-label="Select Brief Archive Date"
                  value={selectedDate}
                  onChange={(e) => loadBrief(e.target.value)}
                  className="bg-transparent text-slate-200 font-mono focus:outline-none cursor-pointer"
                >
                  {!archiveList.some((brief) => brief.date === selectedDate) && (
                    <option value={selectedDate} disabled>Choose an archived date</option>
                  )}
                  {archiveList.map((b) => (
                    <option key={b.id || b.date} value={b.date} className="bg-slate-900 text-slate-200">
                      {b.date} ({b.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Brief Diagnostics Toggle */}
            <button
              onClick={() => setShowBriefDiagnostics((prev) => !prev)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              <span>{showBriefDiagnostics ? 'Hide Diagnostics' : 'Brief Diagnostics'}</span>
            </button>

            {/* Admin-Only Mutating Pipeline Actions (Visually Distinct from Reading Controls) */}
            {canManage && (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <button
                  onClick={() => handleRegenerateBrief(true)}
                  disabled={isGenerating || isRunningPipeline}
                  title="Admin Mutation: Synthesize and overwrite Daily Brief for selected date"
                  className="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>{language === 'el' ? 'Αναδημιουργία' : 'Regenerate Brief'}</span>
                </button>

                <button
                  onClick={handleTriggerFullPipeline}
                  disabled={isGenerating || isRunningPipeline}
                  title="Admin Mutation: Run full 5-stage Daily Intelligence Pipeline"
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-200 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Play className={`w-3.5 h-3.5 ${isRunningPipeline ? 'animate-pulse' : ''}`} />
                  <span>{language === 'el' ? 'Εκτέλεση Pipeline' : 'Run Pipeline'}</span>
                </button>
              </div>
            )}
          </>
        }
      />

      {/* Compact Freshness & Reporting Window Bar (B6) */}
      <div className="px-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3 text-slate-300">
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            <span>Reporting Date:</span>
            <strong className="text-white">{reportingDateDisplay}</strong>
          </span>
          <span className="text-slate-600">•</span>
          <span>
            Target: <strong className="text-indigo-300">{briefDoc?.targetCompanyName || 'HUAWEI'}</strong>
          </span>
          <span className="text-slate-600">•</span>
          <span>
            Window: <strong className="text-slate-200">{(briefDoc as any)?.timezone || 'Europe/Athens'} (24h)</strong>
          </span>
          {briefDoc?.generatedAt && (
            <>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">
                Generated: <strong className="text-slate-300">{new Date(briefDoc.generatedAt).toLocaleString()}</strong>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {briefDoc?.groundingMetrics && (
            <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 text-[11px]">
              {briefDoc.groundingMetrics.storiesUsed ?? 0} Stories • {briefDoc.groundingMetrics.totalArticlesInWindow} Articles ({briefDoc.groundingMetrics.distinctSourcesCount} Sources)
            </span>
          )}
          {latestRun && (
            <SemanticBadge
              variant={
                (latestRun.status as string) === 'COMPLETED' || latestRun.status === 'SUCCESS'
                  ? 'verified'
                  : latestRun.status === 'PARTIAL_SUCCESS'
                  ? 'review'
                  : 'info'
              }
            >
              Pipeline: {latestRun.status}
            </SemanticBadge>
          )}
        </div>
      </div>

      {/* Expandable Brief Diagnostics Panel (B6) */}
      {showBriefDiagnostics && (
        <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/30 space-y-3 text-xs font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 text-indigo-300 font-bold uppercase">
              <Activity className="w-4 h-4" />
              <span>Brief Synthesis & Pipeline Diagnostics</span>
            </div>
            <span className="text-[11px] text-slate-400">
              Lease: {lease?.status === 'ACTIVE' ? `ACTIVE (${lease.leaseHolder})` : 'IDLE / AVAILABLE'}
            </span>
          </div>

          {briefDoc?.groundingMetrics ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block">Synthesis Model & Duration</span>
                <strong className="text-slate-200 block mt-0.5">
                  {briefDoc.groundingMetrics.geminiModelUsed} ({briefDoc.groundingMetrics.synthesisDurationMs}ms)
                </strong>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block">Story Integration Mode</span>
                <strong className="text-indigo-300 block mt-0.5">
                  {briefDoc.groundingMetrics.storyIntegrationMode || 'STORY_ENRICHED'} ({briefDoc.groundingMetrics.storiesUsed ?? 0} used / {briefDoc.groundingMetrics.storiesEligible ?? 0} eligible / {briefDoc.groundingMetrics.storiesQueried ?? 0} queried)
                </strong>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block">Articles & Source Breadth</span>
                <strong className="text-slate-200 block mt-0.5">
                  {briefDoc.groundingMetrics.totalArticlesInWindow} Articles • {briefDoc.groundingMetrics.distinctSourcesCount} Distinct Outlets
                </strong>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block">Relevance Gate Filtering</span>
                <strong className="text-amber-300 block mt-0.5">
                  {briefDoc.groundingMetrics.unrelatedArticlesSkipped ?? 0} Out-of-Scope Skipped • {briefDoc.groundingMetrics.storiesExcludedArchived ?? 0} Archived Excluded
                </strong>
              </div>
            </div>
          ) : (
            <div className="text-slate-400">No grounding diagnostics available for the current brief.</div>
          )}

          {latestRun && (
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>
                Latest Run ID: <strong className="text-slate-300">{latestRun.id}</strong> ({latestRun.trigger || (latestRun as any).triggerType})
              </span>
              <span>
                RSS Ingested: <strong className="text-slate-200">{latestRun.summary?.articlesPersisted ?? (latestRun.summary as any)?.articlesIngested ?? 0}</strong> • Stories Updated: <strong className="text-slate-200">{latestRun.summary?.clustersUpdated ?? (latestRun.summary as any)?.storiesUpdated ?? 0}</strong> • Duration: <strong className="text-slate-200">{(latestRun.summary?.totalDurationMs ?? (latestRun as any).durationMs) ? `${(((latestRun.summary?.totalDurationMs ?? (latestRun as any).durationMs) as number) / 1000).toFixed(1)}s` : '—'}</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Status & Action Error Banners */}
      {statusBanner && (
        <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center gap-3 text-xs text-indigo-200">
          <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 animate-spin" />
          <span>{statusBanner}</span>
        </div>
      )}

      {actionErrorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-3 text-xs text-rose-200">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{actionErrorMessage}</span>
        </div>
      )}

      {/* Main Brief Content: 5 Distinct States (LOADING | READ_ERROR | PUBLISHED_METADATA_MISMATCH | NOT_FOUND | LOADED) */}
      {viewState === 'LOADING' ? (
        <div className="p-12 rounded-2xl bg-slate-900/50 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
          <p className="text-xs font-mono">Loading Executive Daily Intelligence Brief...</p>
        </div>
      ) : viewState === 'READ_ERROR' && readError ? (
        <div
          role="alert"
          data-testid="daily-brief-read-error"
          className="p-8 rounded-2xl bg-slate-900 border border-rose-500/40 text-center space-y-4 max-w-2xl mx-auto"
        >
          <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded text-[11px] font-mono bg-rose-950/60 text-rose-300 border border-rose-500/30">
              <span>READ_ERROR • {readError.kind}</span>
              {readError.status ? <span>• HTTP {readError.status}</span> : null}
            </div>
            <h3 className="text-base font-semibold text-white">
              {language === 'el'
                ? 'Αδυναμία Φόρτωσης της Ημερήσιας Αναφοράς'
                : 'Unable to Load Daily Intelligence Brief'}
            </h3>
            <p className="text-xs text-slate-300 max-w-lg mx-auto leading-relaxed">
              {readError.userMessage}
            </p>
            <p className="text-[11px] font-mono text-slate-400 max-w-lg mx-auto">
              {readError.diagnosticDetail} (Requested Date: {reportingDateDisplay}). Published briefs in authoritative storage are preserved—use Retry Read below to repeat the read-only request.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => loadBrief(selectedDate || undefined)}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{language === 'el' ? 'Επανάληψη Ανάγνωσης (Retry Read)' : 'Retry Read'}</span>
            </button>
          </div>
        </div>
      ) : viewState === 'PUBLISHED_METADATA_MISMATCH' ? (
        <div
          role="status"
          data-testid="daily-brief-metadata-mismatch"
          className="p-8 rounded-2xl bg-slate-900 border border-amber-500/40 text-center space-y-4 max-w-2xl mx-auto"
        >
          <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6 text-amber-400" />
          </div>
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded text-[11px] font-mono bg-amber-950/60 text-amber-300 border border-amber-500/30">
              <span>PUBLISHED_METADATA_MISMATCH • {reportingDateDisplay}</span>
            </div>
            <h3 className="text-base font-semibold text-white">
              {language === 'el'
                ? 'Αναντιστοιχία Μεταδεδομένων Δημοσιευμένης Αναφοράς'
                : 'Published Brief Metadata Mismatch Detected'}
            </h3>
            <p className="text-xs text-slate-300 max-w-lg mx-auto leading-relaxed">
              The Daily Brief archive marks <strong className="text-white">{reportingDateDisplay}</strong> as{' '}
              <strong className="text-emerald-300">PUBLISHED</strong>, but the full document content could not be retrieved in the current read response.
            </p>
            <p className="text-[11px] font-mono text-slate-400 max-w-lg mx-auto">
              Do not regenerate or overwrite the published record unless explicitly intended. Retry the read-only retrieval first.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => loadBrief(reportingDateDisplay !== 'Latest' ? reportingDateDisplay : undefined)}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{language === 'el' ? 'Επανάληψη Ανάγνωσης (Retry Read)' : 'Retry Read'}</span>
            </button>
          </div>
        </div>
      ) : viewState === 'NOT_FOUND' || !briefDoc || !activeContent ? (
        <div
          data-testid="daily-brief-not-found"
          className="p-10 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4"
        >
          <FileText className="w-10 h-10 text-slate-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-white">
              {language === 'el'
                ? 'Δεν βρέθηκε Ημερήσια Αναφορά για αυτή την ημερομηνία'
                : 'No Daily Intelligence Brief Found for Selected Date'}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {canManage
                ? language === 'el'
                  ? 'Δεν υπάρχει δημοσιευμένη αναφορά για την επιλεγμένη ημερομηνία. Οι διαχειριστές μπορούν να χρησιμοποιήσουν "Αναδημιουργία" ή "Εκτέλεση Pipeline" παραπάνω.'
                  : 'No published brief exists in the archive for the selected date. Administrators may use "Regenerate Brief" or "Run Pipeline" above if synthesis is required.'
                : language === 'el'
                ? 'Δεν υπάρχει δημοσιευμένη αναφορά στο αρχείο για την επιλεγμένη ημερομηνία.'
                : 'No published brief exists in the archive for the selected reporting date.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {isLegacyBrief && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3 text-xs text-amber-200 font-mono">
              <Archive className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Historical Archive Briefing (Phase P0 Baseline) — Displaying preserved archival record with pure client-side presentation compatibility.
              </span>
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION 1: EXECUTIVE SUMMARY                                      */}
          {/* ================================================================= */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/30 border border-slate-800 space-y-5 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  SECTION 1 • EXECUTIVE SUMMARY
                </span>
                <span className="px-2.5 py-1 rounded-md text-xs font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  {(language === 'el' ? (briefDoc as any).dateDisplayEl : (briefDoc as any).dateDisplayEn) || briefDoc.date}
                </span>
              </div>

              <div
                className={`px-3 py-1 rounded-md text-xs font-mono font-semibold border ${sentimentBadgeColor(
                  activeContent.marketSentimentOverview?.overall
                )}`}
              >
                {language === 'el' ? 'Κλίμα Αγοράς: ' : 'Market Sentiment: '}
                {activeContent.marketSentimentOverview?.overall || 'CAUTIOUS'}
              </div>
            </div>

            {/* Executive Headline */}
            <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug">
              {activeContent.executiveHeadline}
            </h2>

            {/* Key Themes Chips */}
            {activeContent.keyThemes && activeContent.keyThemes.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono uppercase text-slate-400 mr-1">
                  {language === 'el' ? 'Κύριοι Άξονες:' : 'Core Themes:'}
                </span>
                {activeContent.keyThemes.map((theme, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-0.5 rounded-md text-xs bg-slate-800/90 text-slate-200 border border-slate-700/80"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            )}

            {/* Key Findings (3-5 Executive Bullet Takeaways) */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
              <h4 className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-semibold">
                {language === 'el'
                  ? 'Κύρια Στρατηγικά Ευρήματα (24ωρο)'
                  : 'Key Executive Findings (24-Hour Synthesis)'}
              </h4>
              <ul className="space-y-2">
                {activeContent.executiveSummary.map((point, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-200 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 shrink-0" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Market Assessment Rationale */}
            {activeContent.marketSentimentOverview?.rationale && (
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300 flex items-start gap-2.5">
                <Compass className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-white">
                    {language === 'el' ? 'Αξιολόγηση Δυναμικής Αγοράς: ' : 'Overall Market Assessment: '}
                  </span>
                  {activeContent.marketSentimentOverview.rationale}
                </div>
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* SECTION 2: PRIORITY DEVELOPMENTS (UNIFIED & DEDUPLICATED)         */}
          {/* ================================================================= */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span>
                    {language === 'el'
                      ? `Section 2 • Κύριες Εξελίξεις Προτεραιότητας (${filteredDevelopments.length})`
                      : `Section 2 • Priority Developments (${filteredDevelopments.length})`}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Consolidated, deduplicated primary list of significant developments with explicit separation between Empirical Evidence Confidence and Potential Strategic Impact.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="inline-flex items-center rounded-lg bg-slate-900 border border-slate-800 p-1 text-xs font-mono self-start sm:self-auto">
                {(
                  [
                    { id: 'ALL', label: `All (${priorityDevelopments.length})` },
                    {
                      id: 'VERIFIED_ONLY',
                      label: `Verified (${priorityDevelopments.filter((d) => !d.isUnconfirmedRumor).length})`,
                    },
                    {
                      id: 'HIGH_IMPACT',
                      label: `High Impact (${priorityDevelopments.filter((d) => d.isCriticalAlert || d.strategicImportanceScore >= 75).length})`,
                    },
                    {
                      id: 'RUMORS_MONITOR',
                      label: `Rumors / Leaks (${priorityDevelopments.filter((d) => d.isUnconfirmedRumor).length})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setDevFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                      devFilter === tab.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredDevelopments.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 font-mono text-center">
                No developments match the selected filter criteria.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredDevelopments.map((dev) => {
                  const isCitationsOpen = Boolean(expandedCitations[dev.key]);
                  const isAnalysisOpen = Boolean(expandedAnalysis[dev.key]);

                  return (
                    <div
                      key={dev.key}
                      id={dev.storyId ? `brief-dev-${dev.storyId}` : undefined}
                      className={`p-5 rounded-xl bg-slate-900 border transition-all flex flex-col justify-between space-y-3.5 shadow-sm ${
                        dev.isUnconfirmedRumor
                          ? 'border-amber-500/30 hover:border-amber-500/50'
                          : dev.isCriticalAlert
                          ? 'border-indigo-500/40 hover:border-indigo-500/60'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Top Metadata Row: Manufacturer, Category/Product & Signal Classification */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-950 text-white border border-slate-700">
                              {dev.manufacturer}
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-indigo-300 border border-slate-800">
                              {dev.category}
                              {dev.productName ? ` • ${dev.productName}` : ''}
                            </span>
                            {dev.geographicRelevance && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                                {dev.geographicRelevance}
                              </span>
                            )}
                          </div>

                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase border ${
                              dev.isUnconfirmedRumor
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                : dev.isCriticalAlert
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {dev.priorityNatureLabel}
                          </span>
                        </div>

                        {/* B4: Explicit Two-Axis Separation Bar: Evidence Confidence vs. Potential Strategic Impact */}
                        <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800/90 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                          <div className="flex items-center justify-between sm:border-r sm:border-slate-800 sm:pr-2">
                            <span className="text-slate-400 text-[10px] uppercase">Empirical Evidence:</span>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                                  dev.isUnconfirmedRumor
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                }`}
                              >
                                {dev.evidenceLabel}
                              </span>
                              <span className="font-bold text-slate-200">{dev.evidenceConfidencePct}% Conf</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:pl-1">
                            <span className="text-slate-400 text-[10px] uppercase">Potential Impact:</span>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-200">
                                {dev.strategicImportanceScore}/100
                              </span>
                              <span
                                className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                  dev.isUnconfirmedRumor
                                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    : dev.competitiveThreatLevel === 'HIGH'
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                    : dev.competitiveThreatLevel === 'ELEVATED'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {dev.competitiveThreatLevel} Impact
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Unconfirmed Rumor Caution Notice */}
                        {dev.isUnconfirmedRumor && (
                          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-[11px] text-amber-200">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>
                              <strong>Unconfirmed Leak / Rumor:</strong> High potential impact ({dev.strategicImportanceScore}/100) if confirmed, but empirical confidence is {dev.evidenceConfidencePct}%. Treat as a monitoring signal, not a confirmed release.
                            </span>
                          </div>
                        )}

                        {/* Headline */}
                        <h4 className="text-base font-bold text-slate-100 leading-snug">
                          {dev.title}
                        </h4>

                        {/* Executive Takeaway */}
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {dev.executiveTakeaway}
                        </p>

                        {/* Why It Matters to Target */}
                        <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-900/40 text-xs">
                          <span className="font-semibold text-indigo-300 block mb-0.5 text-[11px] uppercase font-mono">
                            Why It Matters to {briefDoc.targetCompanyName || 'HUAWEI'}:
                          </span>
                          <p className="text-slate-200 text-[11px] leading-relaxed">
                            {dev.whyItMatters}
                          </p>
                        </div>

                        {/* Expandable Detailed Observations & Positioning */}
                        {(dev.strategicAnalysis.length > 0 || dev.productPositioning) && (
                          <div>
                            <button
                              onClick={() => toggleAnalysis(dev.key)}
                              className="text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                            >
                              {isAnalysisOpen ? (
                                <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                              )}
                              <span>
                                {isAnalysisOpen
                                  ? 'Hide Detailed Analysis'
                                  : `Show Detailed Analysis (${dev.strategicAnalysis.length} points)`}
                              </span>
                            </button>

                            {isAnalysisOpen && (
                              <div className="mt-2 p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2 text-xs">
                                {dev.strategicAnalysis.length > 0 && (
                                  <ul className="space-y-1.5 text-[11px] text-slate-300">
                                    {dev.strategicAnalysis.map((obs, i) => (
                                      <li key={i} className="flex items-start gap-2">
                                        <span className="w-1 h-1 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                                        <span>{obs}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {dev.productPositioning && (
                                  <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-300">
                                    <strong className="text-sky-300 block mb-0.5">
                                      Product Positioning:
                                    </strong>
                                    {dev.productPositioning}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Footer: Story Link, Independent Source Breadth & Citations Toggle */}
                      <div className="pt-3 border-t border-slate-800/80 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {dev.storyId ? (
                            <button
                              onClick={() => navigateToStory(dev.storyId!)}
                              className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:text-indigo-200 text-[11px] font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <Layers className="w-3.5 h-3.5 text-indigo-400" />
                              <span>Inspect Story Intelligence</span>
                              <ArrowRight className="w-3 h-3 text-indigo-400" />
                            </button>
                          ) : (
                            <span className="text-[10px] font-mono text-slate-400">
                              Synthesized development
                            </span>
                          )}

                          <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
                            <span>
                              {dev.independentSourceCount}{' '}
                              {dev.independentSourceCount === 1
                                ? 'Independent Outlet'
                                : 'Independent Outlets'}
                              {dev.totalArticlesCount ? ` (${dev.totalArticlesCount} Articles)` : ''}
                            </span>
                            {dev.groundedCitations.length > 0 && (
                              <button
                                onClick={() => toggleCitation(dev.key)}
                                className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                              >
                                {isCitationsOpen ? 'Hide' : 'Sources'} ({dev.groundedCitations.length})
                              </button>
                            )}
                          </div>
                        </div>

                        {isCitationsOpen && dev.groundedCitations.length > 0 && (
                          <div className="space-y-1 p-2 rounded-lg bg-slate-950 border border-slate-800">
                            {dev.groundedCitations.map((cit, cIdx) => (
                              <a
                                key={cIdx}
                                href={cit.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-slate-300 hover:text-indigo-300 flex items-center justify-between gap-2 p-1 rounded hover:bg-slate-900 transition-colors"
                              >
                                <span className="truncate flex-1">{cit.title}</span>
                                <span className="text-[10px] font-mono text-slate-400 shrink-0 flex items-center gap-1">
                                  {cit.sourceName}
                                  <ExternalLink className="w-3 h-3" />
                                </span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* SECTION 3: CHANGES SINCE YESTERDAY (COMPACT DELTA REFERENCE)      */}
          {/* ================================================================= */}
          {normalizedDelta && (
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    <GitCompare className="w-4 h-4 text-indigo-400" />
                    <span>
                      {language === 'el'
                        ? 'Section 3 • Μεταβολές από Χθες (Day-over-Day Delta)'
                        : 'Section 3 • Changes Since Yesterday (Day-over-Day Delta)'}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Compact state transitions compared against prior brief ({normalizedDelta.previousBriefDate || 'No Baseline'}). Cross-references primary developments above without duplicating full cards.
                  </p>
                </div>

                {normalizedDelta.hasBaselineData && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      New: {normalizedDelta.counts.newCount}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                      Updated: {normalizedDelta.counts.materialUpdateCount}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                      Escalations: {normalizedDelta.counts.escalatingCount}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      Resolved / De-escalated: {normalizedDelta.counts.resolvedCount}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-300 font-medium">
                {normalizedDelta.summaryStatement}
              </p>

              {!normalizedDelta.hasBaselineData ? (
                <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-400 font-mono">
                  Insufficient historical baseline data for day-over-day comparison.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/70 rounded-xl bg-slate-950/60 border border-slate-800 overflow-hidden">
                  {normalizedDelta.items.map((item, idx: number) => (
                    <div
                      key={`${item.storyId}-${idx}`}
                      className="p-3 hover:bg-slate-900/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase shrink-0 border ${
                            item.deltaClassification === 'ESCALATING_DEVELOPMENT'
                              ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                              : item.deltaClassification === 'NEW_DEVELOPMENT'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : item.deltaClassification === 'MATERIAL_UPDATE'
                              ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {item.deltaClassification === 'ESCALATING_DEVELOPMENT'
                            ? 'Escalating'
                            : item.deltaClassification === 'NEW_DEVELOPMENT'
                            ? 'New'
                            : item.deltaClassification === 'MATERIAL_UPDATE'
                            ? 'Material Update'
                            : 'Resolved / De-escalated'}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-200 truncate">
                            {item.headline}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono truncate">
                            {item.deltaReason}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 text-[11px] font-mono">
                        <span className="text-slate-400">
                          Score:{' '}
                          <strong className="text-slate-200">
                            {item.previousImportanceScore !== undefined
                              ? `${item.previousImportanceScore} → ${item.currentImportanceScore}`
                              : `${item.currentImportanceScore}/100`}
                          </strong>
                        </span>
                        {item.storyId && (
                          <button
                            onClick={() => navigateToStory(item.storyId)}
                            className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                          >
                            <span>Story</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION 4: STRATEGIC RECOMMENDATIONS (CONSOLIDATED & EVIDENCE-AWARE) */}
          {/* ================================================================= */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>
                    {language === 'el'
                      ? `Section 4 • Στρατηγικές Προτάσεις Ενεργειών (${filteredRecommendations.length})`
                      : `Section 4 • Strategic Recommendations for ${briefDoc.targetCompanyName || 'HUAWEI'} (${filteredRecommendations.length})`}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Deduplicated executive recommendations grouped by action horizon. Distinguishes verified strategic actions from conditional/investigative monitoring for unconfirmed rumors.
                </p>
              </div>

              {/* Recommendation Bucket Tabs */}
              <div className="inline-flex items-center rounded-lg bg-slate-900 border border-slate-800 p-1 text-xs font-mono self-start sm:self-auto">
                {(
                  [
                    { id: 'ALL', label: `All (${consolidatedRecommendations.length})` },
                    {
                      id: 'IMMEDIATE',
                      label: `Immediate Actions (${consolidatedRecommendations.filter((r) => r.bucket === 'IMMEDIATE').length})`,
                    },
                    {
                      id: 'MONITOR_INVESTIGATE',
                      label: `Monitor / Investigate (${consolidatedRecommendations.filter((r) => r.bucket === 'MONITOR_INVESTIGATE').length})`,
                    },
                    {
                      id: 'OPPORTUNITIES',
                      label: `Longer-Term Opportunities (${consolidatedRecommendations.filter((r) => r.bucket === 'OPPORTUNITIES').length})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setRecBucketFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                      recBucketFilter === tab.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredRecommendations.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 font-mono text-center">
                No recommendations in this category.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRecommendations.map((rec) => (
                  <div
                    key={rec.key}
                    className={`p-4 rounded-xl bg-slate-900 border transition-all flex flex-col justify-between space-y-3 ${
                      rec.isConditionalInvestigative
                        ? 'border-amber-500/30'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase border ${
                            rec.bucket === 'IMMEDIATE'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : rec.bucket === 'MONITOR_INVESTIGATE'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                          }`}
                        >
                          {rec.bucket === 'IMMEDIATE'
                            ? 'Immediate Action'
                            : rec.bucket === 'MONITOR_INVESTIGATE'
                            ? 'Monitor / Investigate'
                            : 'Strategic Opportunity'}
                        </span>

                        <span
                          className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                            rec.isConditionalInvestigative
                              ? 'bg-amber-950/60 text-amber-300 border-amber-500/30'
                              : 'bg-slate-950 text-emerald-400 border-slate-800'
                          }`}
                        >
                          {rec.confidencePct}% Evidence Conf
                        </span>
                      </div>

                      {/* Evidence-Aware Action Nature Callout */}
                      <div className="text-[10px] font-mono flex items-center justify-between text-slate-400 bg-slate-950/70 px-2.5 py-1.5 rounded border border-slate-800/80">
                        <span>{rec.actionNatureLabel}</span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-indigo-300">
                        <span className="text-slate-400">Owner:</span>
                        <span className="font-semibold text-slate-200">{rec.ownerLabel}</span>
                        {rec.geographicScope && (
                          <>
                            <span className="text-slate-600">•</span>
                            <span className="text-slate-400">{rec.geographicScope}</span>
                          </>
                        )}
                      </div>

                      <h5 className="text-xs font-bold text-slate-100 leading-snug">
                        {rec.action}
                      </h5>

                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {rec.strategicRationale}
                      </p>
                    </div>

                    <div className="pt-2.5 border-t border-slate-800/80 space-y-1.5 text-[10px] font-mono text-slate-400">
                      <div className="truncate" title={rec.supportingContextLabels.join(' | ')}>
                        Supporting: <span className="text-slate-300">{rec.supportingContextLabels.join(', ')}</span>
                      </div>
                      {rec.supportingStoryIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          {rec.supportingStoryIds.map((sid, sIdx) => (
                            <button
                              key={sid}
                              onClick={() => navigateToStory(sid)}
                              className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 underline cursor-pointer"
                            >
                              <span>Story #{sIdx + 1}</span>
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ================================================================= */}
          {/* SECTION 5: SUPPORTING INTELLIGENCE (EXPANDABLE / COLLAPSIBLE)      */}
          {/* ================================================================= */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span>
                  {language === 'el'
                    ? 'Section 5 • Υποστηρικτική Ευφυΐα & Αναλυτικά Παραρτήματα'
                    : 'Section 5 • Supporting Intelligence & Domain Breakdowns'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Expand domain matrices, competitor surveillance radar, or historical archive context on demand.
              </p>
            </div>

            {/* 5A: Strategic Hardware Overview (4 Core Domains) */}
            {activeContent.strategicHardwareOverview &&
              activeContent.strategicHardwareOverview.length > 0 && (
                <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                  <button
                    onClick={() => setShowHardwareDomains((prev) => !prev)}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <Cpu className="w-4 h-4 text-indigo-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Strategic Hardware Overview (4 Core Domains)
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        ({activeContent.strategicHardwareOverview.length} Domains)
                      </span>
                    </div>
                    {showHardwareDomains ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {showHardwareDomains && (
                    <div className="p-4 pt-0 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                      {activeContent.strategicHardwareOverview.map((dom, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between space-y-2.5"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-white">{dom.domain}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                                {dom.highestThreatLevel} Threat
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                              {dom.competitorDevelopmentsSummary}
                            </p>
                            <div className="p-2 rounded bg-indigo-950/30 border border-indigo-900/40 text-[11px] text-slate-300">
                              <strong className="text-indigo-300 block text-[10px] uppercase">
                                HUAWEI Implication:
                              </strong>
                              {dom.huaweiImplications}
                            </div>
                          </div>
                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                            <span>{dom.storyCount} Stories</span>
                            {dom.supportingStoryIds.length > 0 && (
                              <button
                                onClick={() => navigateToStory(dom.supportingStoryIds[0])}
                                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                              >
                                <span>Inspect</span>
                                <ArrowRight className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            {/* 5B: Competitor Moves Radar */}
            {activeContent.competitorMoves && activeContent.competitorMoves.length > 0 && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                <button
                  onClick={() => setShowCompetitorRadar((prev) => !prev)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Competitor Moves & Tactical Positioning Radar
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      ({activeContent.competitorMoves.length} Rival Updates)
                    </span>
                  </div>
                  {showCompetitorRadar ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {showCompetitorRadar && (
                  <div className="p-4 pt-0 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                    {activeContent.competitorMoves.map((move, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between space-y-2.5"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white">{move.companyName}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 border border-slate-800">
                              {move.threatLevel} Priority
                            </span>
                          </div>
                          <h5 className="text-xs font-semibold text-slate-200">{move.headline}</h5>
                          <p className="text-[11px] text-slate-400 leading-relaxed">{move.analysis}</p>
                        </div>
                        {move.storyId && (
                          <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                            <button
                              onClick={() => navigateToStory(move.storyId!)}
                              className="text-[10px] font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                            >
                              <span>Inspect Story</span>
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 5C: Executive Playbook Matrix & Category Breakdowns */}
            {activeContent.strategicImplicationsForHuawei && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                <button
                  onClick={() => setShowDetailedBreakdowns((prev) => !prev)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Executive C-Suite Playbook Matrix (SWOT / Horizon View)
                    </span>
                  </div>
                  {showDetailedBreakdowns ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {showDetailedBreakdowns && (
                  <div className="p-4 pt-0 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                    <div className="p-3.5 rounded-xl bg-slate-950/70 border border-emerald-900/40 space-y-2">
                      <span className="text-xs font-bold text-emerald-400 uppercase">Immediate Actions</span>
                      <ul className="space-y-1 text-xs text-slate-300">
                        {activeContent.strategicImplicationsForHuawei.immediateActions.map((act, i) => (
                          <li key={i}>• {act}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-950/70 border border-indigo-900/40 space-y-2">
                      <span className="text-xs font-bold text-indigo-400 uppercase">Medium-Term Watch</span>
                      <ul className="space-y-1 text-xs text-slate-300">
                        {activeContent.strategicImplicationsForHuawei.mediumTermWatch.map((item, i) => (
                          <li key={i}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-950/70 border border-rose-900/40 space-y-2">
                      <span className="text-xs font-bold text-rose-400 uppercase">Threats & Risks</span>
                      <ul className="space-y-1 text-xs text-slate-300">
                        {activeContent.strategicImplicationsForHuawei.threatsAndRisks.map((th, i) => (
                          <li key={i}>• {th}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-950/70 border border-amber-900/40 space-y-2">
                      <span className="text-xs font-bold text-amber-400 uppercase">Opportunities</span>
                      <ul className="space-y-1 text-xs text-slate-300">
                        {activeContent.strategicImplicationsForHuawei.opportunities.map((opp, i) => (
                          <li key={i}>• {opp}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5D: Historical Aggregates & Brief Archive */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
              <button
                onClick={() => setShowHistoricalAndArchive((prev) => !prev)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Archive className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    Historical Aggregates Grounding & Brief Archive ({archiveList.length} Briefs)
                  </span>
                </div>
                {showHistoricalAndArchive ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {showHistoricalAndArchive && (
                <div className="p-4 pt-0 border-t border-slate-800/80 space-y-3 mt-3">
                  {latestDay && (
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                      <span className="text-slate-300">
                        Latest Historical Aggregate: <strong className="text-indigo-300">{latestDay.dateKey || latestDay.date}</strong>
                      </span>
                      <div className="flex items-center gap-4 text-slate-400">
                        <span>
                          Articles: <strong className="text-slate-200">{latestDay.articlesCount}</strong>
                        </span>
                        <span>
                          Mentions: <strong className="text-slate-200">{latestDay.totalCompanyMentions}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {archiveList.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {archiveList.map((arc, i) => (
                        <button
                          key={i}
                          onClick={() => arc.date && loadBrief(arc.date)}
                          className={`px-2.5 py-1 rounded text-xs font-mono transition-colors border cursor-pointer ${
                            arc.date === briefDoc?.date
                              ? 'bg-indigo-600 text-white border-indigo-500'
                              : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-slate-800'
                          }`}
                        >
                          {arc.date} (v{arc.version || 1})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppPage>
  );
};

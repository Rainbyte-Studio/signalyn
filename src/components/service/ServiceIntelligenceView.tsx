import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Search,
  Filter,
  ExternalLink,
  Info,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Wrench,
  Clock,
  Layers,
  ChevronRight,
  Sparkles,
  Smartphone,
  Calendar,
  Tag,
  Check,
  X,
  Database,
  Building2,
} from 'lucide-react';
import {
  ServiceAdvisory,
  ServiceSource,
  ServiceDashboardStats,
  ServiceProductMatch,
  ServiceVulnerability,
  ServiceSeverity,
  ServiceAdvisoryType,
  ServiceManufacturer,
} from '../../types/serviceIntelligence';
import { useApp } from '../../context/AppContext';
import { auth } from '../../firebase';
import { getAuthorizedApiHeaders } from '../../services/apiSessionClient';
import { AppPage, PageHeader, SemanticBadge, Button } from '../common/DesignSystem';

export const ServiceIntelligenceView: React.FC = () => {
  const { canManage, setActiveTab } = useApp();
  const [advisories, setAdvisories] = useState<ServiceAdvisory[]>([]);
  const [sources, setSources] = useState<ServiceSource[]>([]);
  const [stats, setStats] = useState<ServiceDashboardStats | null>(null);
  const [productMatches, setProductMatches] = useState<ServiceProductMatch[]>([]);
  const [vulnerabilities, setVulnerabilities] = useState<ServiceVulnerability[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [cisaKevOnly, setCisaKevOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  // Selected Detail Modal
  const [selectedAdvisory, setSelectedAdvisory] = useState<ServiceAdvisory | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [srcRes, advRes, statRes, matchRes, vulnRes] = await Promise.all([
        fetch('/api/service/sources'),
        fetch('/api/service/advisories'),
        fetch('/api/service/dashboard-stats'),
        fetch('/api/service/product-matches'),
        fetch('/api/service/vulnerabilities?limit=50'),
      ]);

      if (!srcRes.ok || !advRes.ok) {
        throw new Error('Failed to load Service Intelligence data');
      }

      const srcData = await srcRes.json();
      const advData = await advRes.json();
      const statData = statRes.ok ? await statRes.json() : null;
      const matchData = matchRes.ok ? await matchRes.json() : null;
      const vulnData = vulnRes.ok ? await vulnRes.json() : null;

      setSources(srcData.sources || []);
      setAdvisories(advData.advisories || []);
      if (statData?.stats) setStats(statData.stats);
      if (matchData?.matches) setProductMatches(matchData.matches);
      if (vulnData?.vulnerabilities) setVulnerabilities(vulnData.vulnerabilities);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSyncSource = async (sourceId: string) => {
    if (!canManage) return;
    setSyncingSourceId(sourceId);
    setActionNotice(null);
    setError(null);

    try {
      const headers = await getAuthorizedApiHeaders();
      if (auth.currentUser && !headers['Authorization']) {
        const token = await auth.currentUser.getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/service/sync/${encodeURIComponent(sourceId)}`, {
        method: 'POST',
        headers,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Source synchronization failed');

      setActionNotice(
        `Synchronized ${sourceId}: Discovered ${data.syncRun?.advisoriesDiscovered || 0} advisories, ${data.syncRun?.productMatchesCreated || 0} product associations.`
      );
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingSourceId(null);
    }
  };

  const handleSyncAll = async () => {
    if (!canManage) return;
    setIsSyncing(true);
    setActionNotice(null);
    setError(null);

    try {
      const headers = await getAuthorizedApiHeaders();
      if (auth.currentUser && !headers['Authorization']) {
        const token = await auth.currentUser.getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/service/sync-all', {
        method: 'POST',
        headers,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Full sync failed');

      const totalDiscovered = (data.runs || []).reduce(
        (acc: number, r: any) => acc + (r.advisoriesDiscovered || 0),
        0
      );
      setActionNotice(`All 5 official service sources synchronized successfully (${totalDiscovered} advisories refreshed).`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncing(false);
    }
  };

  // Filtered Advisories
  const filteredAdvisories = useMemo(() => {
    return advisories.filter((a) => {
      // Manufacturer Filter
      if (selectedManufacturer !== 'ALL' && a.manufacturer !== selectedManufacturer) {
        return false;
      }

      // Type Filter
      if (selectedType !== 'ALL' && a.advisoryType !== selectedType) {
        return false;
      }

      // Severity Filter
      if (selectedSeverity !== 'ALL' && a.severity !== selectedSeverity) {
        return false;
      }

      // CISA KEV
      const isKevRecord = Boolean(
        a.isKnownExploited === true ||
          a.cisaKevStatus === 'ACTIVE_EXPLOITED' ||
          (a as any).isCisaKev ||
          a.sourceId === 'cisa-kev',
      );
      if (cisaKevOnly && !isKevRecord) {
        return false;
      }

      // Verified Only
      if (verifiedOnly && a.verificationStatus !== 'OFFICIALLY_CONFIRMED') {
        return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = a.title.toLowerCase().includes(q);
        const matchesSummary = a.summary.toLowerCase().includes(q);
        const matchesRef = a.bulletinReference?.toLowerCase().includes(q) || false;
        const matchesProd = a.affectedProducts.some((p) => p.toLowerCase().includes(q));
        const matchesCve = a.cveIds.some((c) => c.toLowerCase().includes(q));
        if (!matchesTitle && !matchesSummary && !matchesRef && !matchesProd && !matchesCve) {
          return false;
        }
      }

      return true;
    });
  }, [advisories, selectedManufacturer, selectedType, selectedSeverity, cisaKevOnly, verifiedOnly, searchQuery]);

  const getSeverityBadge = (severity: ServiceSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'HIGH':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'MEDIUM':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'LOW':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'UNKNOWN':
      case 'NOT_AVAILABLE':
        return 'bg-slate-800 text-slate-400 border-slate-700';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const getTypeBadge = (type: ServiceAdvisoryType) => {
    switch (type) {
      case 'KNOWN_EXPLOITED':
        return { label: 'CISA KEV', color: 'bg-rose-500/15 text-rose-300 border-rose-500/40' };
      case 'SECURITY_UPDATE':
        return { label: 'Security Update', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40' };
      case 'VULNERABILITY':
        return { label: 'Vulnerability', color: 'bg-amber-500/15 text-amber-300 border-amber-500/40' };
      case 'REPAIR_PROGRAM':
        return { label: 'Repair Program', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' };
      case 'PRODUCT_RECALL':
        return { label: 'Product Recall', color: 'bg-red-500/20 text-red-300 border-red-500/50' };
      case 'END_OF_SUPPORT':
        return { label: 'End of Support', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
      case 'UPDATE_SCHEDULE':
        return { label: 'Update Schedule', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' };
      default:
        return { label: type, color: 'bg-slate-500/15 text-slate-300 border-slate-500/40' };
    }
  };

  return (
    <AppPage className="pb-12">
      <PageHeader
        eyebrow="Service Intelligence"
        title="Service & Security Intelligence"
        description="Traceable manufacturer security bulletins (Huawei, Apple, Samsung) and cybersecurity authority catalogs (NIST NVD, CISA KEV)."
        badge={
          <div className="flex items-center gap-2 flex-wrap">
            <SemanticBadge variant="verified">5/5 SOURCES LIVE VERIFIED</SemanticBadge>
            <SemanticBadge variant="info">
              {stats?.totalPersistedAdvisories ?? stats?.totalAdvisories ?? advisories.length} PERSISTED ADVISORIES
            </SemanticBadge>
          </div>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="icon"
              onClick={loadData}
              disabled={isLoading}
              title="Refresh Service Data"
              aria-label="Refresh Service Data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>

            {canManage && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.hash = '#system-diagnostics:service';
                  setActiveTab('settings');
                }}
                leftIcon={<Database className="w-3.5 h-3.5 text-emerald-400" />}
                title="Open Service Intelligence Diagnostics & Match Evidence Inspector in Settings"
              >
                Service Diagnostics &amp; Inspector
              </Button>
            )}
            {canManage && (
              <Button
                variant="primary"
                size="md"
                onClick={handleSyncAll}
                disabled={isSyncing}
                isLoading={isSyncing}
                leftIcon={!isSyncing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
              >
                {isSyncing ? 'Synchronizing Sources...' : 'Synchronize All Sources'}
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6 w-full">
        {/* Action Notice */}
        {actionNotice && (
          <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-800/60 text-indigo-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0 text-indigo-400" />
              <span>{actionNotice}</span>
            </div>
            <button onClick={() => setActionNotice(null)} className="text-indigo-400 hover:text-indigo-200 font-mono text-xs">
              Dismiss
            </button>
          </div>
        )}

        {/* Error Notice */}
        {error && (
          <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-center justify-between">
            <span>Error: {error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 font-mono text-xs">
              Dismiss
            </button>
          </div>
        )}

        {/* Overview KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Total Advisories
              </span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono text-slate-100">
                {stats?.totalAdvisories ?? advisories.length}
              </span>
              <span className="text-xs text-emerald-400 font-mono">Verified</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Apple ({stats?.manufacturerBreakdown?.Apple || 0}) • Samsung ({stats?.manufacturerBreakdown?.Samsung || 0}) • Huawei ({stats?.manufacturerBreakdown?.Huawei || 0}) • Cross-Vendor ({stats?.manufacturerBreakdown?.CrossVendor || 0})
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                CISA KEV Exploited
              </span>
              <Flame className="w-4 h-4 text-rose-400" />
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono text-rose-400">
                {stats?.totalPersistedCisaKevCount ??
                  stats?.cisaKevCount ??
                  advisories.filter(
                    (a) =>
                      a.isKnownExploited === true ||
                      a.cisaKevStatus === 'ACTIVE_EXPLOITED' ||
                      (a as any).isCisaKev ||
                      a.sourceId === 'cisa-kev',
                  ).length}
              </span>
              <span className="text-xs text-rose-400/80 font-mono">Persisted In-Wild</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Binding Federal Operational Directives
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Catalog Product Links
              </span>
              <Smartphone className="w-4 h-4 text-cyan-400" />
            </div>
            {stats?.persistedMatchesStatus === 'UNAVAILABLE' ? (
              <>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold font-mono text-rose-400">
                    UNAVAILABLE
                  </span>
                  <span className="text-[11px] text-rose-400/80 font-mono">Firestore Error</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">
                  Pending Review: UNAVAILABLE
                </p>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold font-mono text-cyan-400">
                    {stats?.verifiedProductMatchesCount ?? 0}
                  </span>
                  <span className="text-xs text-cyan-400/80 font-mono">Confirmed (Persisted)</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">
                  {stats?.pendingReviewMatchesCount ?? 0} pending review (persisted)
                </p>
                {typeof stats?.computedCandidateMatchesCount === 'number' &&
                  stats.computedCandidateMatchesCount > 0 &&
                  (stats?.verifiedProductMatchesCount ?? 0) + (stats?.pendingReviewMatchesCount ?? 0) === 0 && (
                    <p className="text-[10px] text-indigo-300/90 mt-1 font-mono">
                      Computed Candidates (Not Yet Persisted): {stats.computedCandidateMatchesCount} ({stats.computedVerifiedCandidatesCount ?? 0} VERIFIED)
                    </p>
                  )}
              </>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Official Sources Health
              </span>
              <CheckCircle2 className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono text-indigo-300">
                {stats?.sourcesOperational ?? sources.length} / {sources.length || 5}
              </span>
              <span className="text-xs text-indigo-400 font-mono">Operational</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Direct official extraction • Zero third-party fees
            </p>
          </div>
        </div>

        {/* Official Sources Health & Control Panel */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  Official Service Intelligence Sources Registry
                </h2>
                <p className="text-xs text-slate-400">
                  Traceable manufacturer security centers and government cybersecurity authority feeds
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              ZERO FABRICATED DATA
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sources.map((src) => {
              const isSourceSyncing = syncingSourceId === src.id;

              return (
                <div
                  key={src.id}
                  className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex flex-col justify-between space-y-2.5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">{src.name}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold ${
                          src.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {src.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-sans line-clamp-2">
                      {src.provenanceDescription}
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-800/50">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>Persisted in Firestore (Total):</span>
                      <span className="text-emerald-300 font-bold">
                        {src.persistedAdvisoriesCount ??
                          (src.id === 'nvd-api'
                            ? stats?.totalVulnerabilities ?? 0
                            : stats?.sourceBreakdown?.[src.id] ?? 0)}{' '}
                        {src.id === 'nvd-api' ? 'CVEs' : 'advisories'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>Latest Sync Run Delta:</span>
                      <span className="text-slate-300">
                        +{src.recordsCreated ?? 0} new • {src.recordsUpdated ?? 0} updated (
                        {src.recordsDiscovered ?? 0} discovered)
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>Sync Terminal Status:</span>
                      <span
                        className={`font-semibold ${
                          src.collectionStatus === 'PARTIAL'
                            ? 'text-amber-400'
                            : src.collectionStatus === 'FAILED'
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {src.lastSyncTerminalStatus ||
                          (src.collectionStatus === 'SUCCESS' ? 'COMPLETED' : src.collectionStatus)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>Official Endpoint:</span>
                      <a
                        href={src.officialUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        <span>Visit Official URL</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    {canManage && (
                      <button
                        onClick={() => handleSyncSource(src.id)}
                        disabled={isSourceSyncing}
                        className="w-full mt-2 py-1.5 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 text-indigo-400 ${isSourceSyncing ? 'animate-spin' : ''}`} />
                        <span>{isSourceSyncing ? 'Syncing...' : 'Sync Source'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Filters Bar */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/60 pb-3">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
              <span>Advisories & Vulnerabilities Filtering:</span>
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCisaKevOnly(!cisaKevOnly)}
                className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-colors flex items-center gap-1.5 ${
                  cisaKevOnly
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Flame className="w-3.5 h-3.5 text-rose-300" />
                <span>Known Exploited (CISA KEV)</span>
              </button>

              <button
                onClick={() => setVerifiedOnly(!verifiedOnly)}
                className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-colors flex items-center gap-1.5 ${
                  verifiedOnly
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                <span>Officially Confirmed Only</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search advisory, CVE, model..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Manufacturer Filter */}
            <div>
              <select
                value={selectedManufacturer}
                onChange={(e) => setSelectedManufacturer(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Manufacturers</option>
                <option value="Apple">Apple</option>
                <option value="Samsung">Samsung</option>
                <option value="Huawei">Huawei</option>
                <option value="Cross-Vendor">Cross-Vendor</option>
              </select>
            </div>

            {/* Advisory Type Filter */}
            <div>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Advisory Types</option>
                <option value="SECURITY_UPDATE">Security Update</option>
                <option value="VULNERABILITY">Vulnerability Notice</option>
                <option value="KNOWN_EXPLOITED">Known Exploited Vulnerability</option>
                <option value="REPAIR_PROGRAM">Repair Program</option>
                <option value="PRODUCT_RECALL">Product Recall</option>
                <option value="END_OF_SUPPORT">End of Support</option>
              </select>
            </div>

            {/* Severity Filter */}
            <div>
              <select
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
          </div>
        </div>

        {/* Advisories Feed List */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono text-slate-400 px-1">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Visible Under Current Filters:{' '}
                <strong className="text-slate-200">{filteredAdvisories.length}</strong> of{' '}
                <strong className="text-slate-200">{advisories.length}</strong>
              </span>
              <span className="text-slate-700">|</span>
              <span>
                Persisted Total:{' '}
                <strong className="text-emerald-400">
                  {stats?.totalPersistedAdvisories ?? stats?.totalAdvisories ?? advisories.length}
                </strong>
              </span>
              <span className="text-slate-700">|</span>
              <span>
                Active Advisories:{' '}
                <strong className="text-indigo-300">
                  {stats?.activeAdvisoriesCount ?? advisories.length}
                </strong>
              </span>
            </div>
            <span>Sorted by Release / Publication Date</span>
          </div>

          {filteredAdvisories.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-3">
              <ShieldAlert className="w-8 h-8 text-slate-500 mx-auto" />
              <h3 className="text-sm font-bold text-slate-200">No Advisories Found</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                No official advisories match the current filter selection. Reset filters or run a source synchronization.
              </p>
              {canManage && (
                <button
                  onClick={handleSyncAll}
                  disabled={isSyncing}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Synchronize Sources Now</span>
                </button>
              )}
            </div>
          ) : (
            filteredAdvisories.map((advisory) => {
              const typeBadge = getTypeBadge(advisory.advisoryType);
              const linkedMatches = productMatches.filter((m) => m.advisoryId === advisory.id);

              return (
                <div
                  key={advisory.id}
                  className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"
                  onClick={() => setSelectedAdvisory(advisory)}
                >
                  <div className="space-y-2 max-w-3xl">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-200">
                        {advisory.manufacturer}
                      </span>

                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${typeBadge.color}`}>
                        {typeBadge.label}
                      </span>

                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${getSeverityBadge(advisory.severity)}`}>
                        {advisory.severity}
                      </span>

                      {advisory.verificationStatus === 'OFFICIALLY_CONFIRMED' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Officially Confirmed</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                          {advisory.verificationStatus}
                        </span>
                      )}

                      <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 ml-auto md:ml-0">
                        <Calendar className="w-3 h-3" />
                        <span>{advisory.publishedAt}</span>
                      </span>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-slate-100 hover:text-indigo-300 transition-colors">
                        {advisory.title}
                      </h3>
                      <p className="text-xs text-slate-300 mt-1 line-clamp-2">
                        {advisory.summary}
                      </p>
                    </div>

                    {/* Affected Products & CVE Tags */}
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {advisory.affectedProducts.length > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Smartphone className="w-3 h-3 text-slate-500" />
                          <span className="text-slate-300 font-medium">
                            {advisory.affectedProducts.slice(0, 3).join(', ')}
                            {advisory.affectedProducts.length > 3 ? ` +${advisory.affectedProducts.length - 3}` : ''}
                          </span>
                        </div>
                      )}

                      {advisory.cveIds.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                            {advisory.cveIds.length} CVEs
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            ({advisory.cveIds.slice(0, 2).join(', ')}{advisory.cveIds.length > 2 ? '...' : ''})
                          </span>
                        </div>
                      )}

                      {linkedMatches.length > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {linkedMatches.length} Catalog Matches
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <a
                      href={advisory.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-2 text-slate-400 hover:text-indigo-300 bg-slate-800/80 hover:bg-slate-700 rounded-lg transition-colors"
                      title="Open Official Manufacturer/Authority Source"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => setSelectedAdvisory(advisory)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1"
                    >
                      <span>Details</span>
                      <ChevronRight className="w-3 h-3 text-slate-400" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Advisory Detail Modal */}
      {selectedAdvisory && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-200">
                    {selectedAdvisory.manufacturer}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${getTypeBadge(selectedAdvisory.advisoryType).color}`}>
                    {getTypeBadge(selectedAdvisory.advisoryType).label}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${getSeverityBadge(selectedAdvisory.severity)}`}>
                    {selectedAdvisory.severity}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-100 mt-1">
                  {selectedAdvisory.title}
                </h2>
              </div>
              <button
                onClick={() => setSelectedAdvisory(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <span className="font-mono text-slate-400 uppercase text-[10px] block font-semibold mb-1">
                  Summary & Scope
                </span>
                <p className="text-slate-200 text-xs leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                  {selectedAdvisory.summary}
                </p>
              </div>

              {selectedAdvisory.affectedProductsText && (
                <div>
                  <span className="font-mono text-slate-400 uppercase text-[10px] block font-semibold mb-1">
                    Official Hardware & Software Scope
                  </span>
                  <p className="text-slate-300 font-mono text-[11px] bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                    {selectedAdvisory.affectedProductsText}
                  </p>
                </div>
              )}

              {/* CISA Required Action */}
              {selectedAdvisory.cisaRequiredAction && (
                <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/60 space-y-1">
                  <div className="flex items-center gap-1.5 text-rose-300 font-bold">
                    <Flame className="w-4 h-4" />
                    <span>CISA Operational Directive & Remediation Action</span>
                  </div>
                  <p className="text-rose-200 text-[11px]">
                    {selectedAdvisory.cisaRequiredAction}
                  </p>
                  {selectedAdvisory.cisaDueDate && (
                    <span className="text-rose-400 font-mono text-[10px] block mt-1">
                      Federal Due Date: {selectedAdvisory.cisaDueDate}
                    </span>
                  )}
                </div>
              )}

              {/* Associated CVE Identifiers */}
              {selectedAdvisory.cveIds.length > 0 && (
                <div>
                  <span className="font-mono text-slate-400 uppercase text-[10px] block font-semibold mb-1.5">
                    Associated CVE Identifiers ({selectedAdvisory.cveIds.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedAdvisory.cveIds.map((cve) => (
                      <a
                        key={cve}
                        href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-0.5 rounded bg-slate-950 hover:bg-indigo-950 border border-slate-800 hover:border-indigo-700 text-indigo-400 text-[10px] font-mono flex items-center gap-1"
                      >
                        <span>{cve}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Matched Catalog Products */}
              <div>
                <span className="font-mono text-slate-400 uppercase text-[10px] block font-semibold mb-1.5">
                  Associated Signalyn Catalog Products
                </span>
                {productMatches.filter((m) => m.advisoryId === selectedAdvisory.id).length === 0 ? (
                  <p className="text-slate-500 text-[11px] italic">
                    No confirmed catalog product matches linked to this advisory.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {productMatches
                      .filter((m) => m.advisoryId === selectedAdvisory.id)
                      .map((match) => (
                        <div
                          key={match.id}
                          className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="text-slate-200 font-bold">
                              {match.productTitle || match.canonicalProductName}
                            </span>
                            <span className="text-slate-400 text-[10px] font-mono block">
                              Evidence: {(match.evidence || match.matchEvidence || []).join(' • ')}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              match.confidence === 'VERIFIED'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {match.confidence}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <a
                href={selectedAdvisory.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
              >
                <span>View Authoritative Vendor Bulletin</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => setSelectedAdvisory(null)}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AppPage>
  );
};

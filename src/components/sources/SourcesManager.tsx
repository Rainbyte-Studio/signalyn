import React, { useState, useMemo } from 'react';
import {
  Rss,
  Search,
  Filter,
  Plus,
  Layers,
  CheckCircle2,
  Clock,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  Edit2,
  Trash2,
  Eye,
  RefreshCw,
  Power,
  ChevronDown,
  Info,
  Play,
} from 'lucide-react';
import { Source, SourceStatus, CollectionMethod } from '../../types';
import { useApp } from '../../context/AppContext';
import { AddEditSourceModal } from './AddEditSourceModal';
import { GroupManagerModal } from './GroupManagerModal';
import { SourceDetailModal } from './SourceDetailModal';
import { SafeDeleteSourceModal } from './SafeDeleteSourceModal';
import {
  AppPage,
  PageHeader,
  SemanticBadge,
  Button,
} from '../common/DesignSystem';
import {
  resolveCanonicalSourceOperationalState,
  computeReconciledSourceKpiCounts,
  formatSourceRowErrorOrWarningDisplay,
} from '../../utils/dataIntegrityContracts';

export const SourcesManager: React.FC = () => {
  const {
    sources,
    sourceGroups,
    toggleSourceStatus,
    deleteSource,
    isLoading,
    refreshData,
    runCollector,
    isCollecting,
    canManage,
  } = useApp();

  const [collectingSourceId, setCollectingSourceId] = useState<string | null>(null);

  const handleCollectSingle = async (sourceId: string) => {
    try {
      setCollectingSourceId(sourceId);
      await runCollector(sourceId);
    } finally {
      setCollectingSourceId(null);
    }
  };

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [marketFilter, setMarketFilter] = useState<string>('ALL');

  // Modal States
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [sourceToEdit, setSourceToEdit] = useState<Source | null>(null);

  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);

  const [detailSource, setDetailSource] = useState<Source | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const [sourceToDelete, setSourceToDelete] = useState<Source | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sorting
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'articles' | 'errors' | 'lastCollected'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Filtered & Sorted sources
  const filteredSources = useMemo(() => {
    return sources.filter((s) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesUrl = s.websiteUrl.toLowerCase().includes(q);
        const groupObj = sourceGroups.find(
          (g) => g.id === s.sourceGroupId || g.id === s.sourceGroup || g.name === s.sourceGroup
        );
        const matchesGroup =
          (s.sourceGroup || '').toLowerCase().includes(q) ||
          (s.sourceGroupId || '').toLowerCase().includes(q) ||
          (groupObj?.name || '').toLowerCase().includes(q);
        const matchesCat = s.categories.some((c) => c.toLowerCase().includes(q));
        if (!matchesName && !matchesUrl && !matchesGroup && !matchesCat) return false;
      }

      // Reconciled Status & Feed Health Bucket
      const resolvedState = resolveCanonicalSourceOperationalState(s);
      if (statusFilter !== 'ALL' && resolvedState.kpiBucket !== statusFilter) return false;

      // Group
      if (groupFilter !== 'ALL') {
        const groupObj = sourceGroups.find(
          (g) => g.id === s.sourceGroupId || g.id === s.sourceGroup || g.name === s.sourceGroup
        );
        if (
          s.sourceGroup !== groupFilter &&
          s.sourceGroupId !== groupFilter &&
          groupObj?.name !== groupFilter &&
          groupObj?.id !== groupFilter
        ) {
          return false;
        }
      }

      // Method
      if (methodFilter !== 'ALL' && s.collectionMethod !== methodFilter) return false;

      // Market
      if (marketFilter !== 'ALL' && s.market !== marketFilter) return false;

      return true;
    }).sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') comparison = a.name.localeCompare(b.name);
      else if (sortBy === 'status') {
        const stateA = resolveCanonicalSourceOperationalState(a).kpiBucket;
        const stateB = resolveCanonicalSourceOperationalState(b).kpiBucket;
        comparison = stateA.localeCompare(stateB);
      } else if (sortBy === 'articles') comparison = (a.articlesCollected ?? 0) - (b.articlesCollected ?? 0);
      else if (sortBy === 'errors') {
        const errA = resolveCanonicalSourceOperationalState(a).totalErrorCount;
        const errB = resolveCanonicalSourceOperationalState(b).totalErrorCount;
        comparison = errA - errB;
      } else if (sortBy === 'lastCollected') {
        const tA = a.lastSuccessfulCollection ? new Date(a.lastSuccessfulCollection).getTime() : 0;
        const tB = b.lastSuccessfulCollection ? new Date(b.lastSuccessfulCollection).getTime() : 0;
        comparison = tA - tB;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [sources, searchQuery, statusFilter, groupFilter, methodFilter, marketFilter, sortBy, sortOrder, sourceGroups]);

  // Unique markets for filtering
  const uniqueMarkets = useMemo(() => {
    return Array.from(new Set(sources.map((s) => s.market))).filter(Boolean);
  }, [sources]);

  // Reconciled Status counts (single model across KPI strip, filters, and row badges)
  const statusCounts = useMemo(() => computeReconciledSourceKpiCounts(sources), [sources]);

  const handleOpenAdd = () => {
    setSourceToEdit(null);
    setIsAddEditOpen(true);
  };

  const handleOpenEdit = (source: Source) => {
    setSourceToEdit(source);
    setIsAddEditOpen(true);
  };

  const handleOpenDetail = (source: Source) => {
    setDetailSource(source);
    setIsDetailOpen(true);
  };

  const handleConfirmDelete = async (reason?: string) => {
    if (!sourceToDelete) return;
    try {
      setIsDeleting(true);
      await deleteSource(sourceToDelete.id, reason);
      setSourceToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Sources Manager"
        badges={<SemanticBadge variant="info" label={`${sources.length} Registered`} />}
        description="Configure authoritative tech news portals, regional media, and RSS/ATOM collection endpoints."
        actions={
          canManage ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => runCollector()}
                disabled={isCollecting || isLoading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/40"
                title="Execute server-side collector across all active sources"
                leftIcon={
                  isCollecting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )
                }
              >
                {isCollecting ? 'Ingesting All...' : 'Run Ingestion'}
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={() => setIsGroupManagerOpen(true)}
                leftIcon={<Layers className="w-3.5 h-3.5 text-indigo-400" />}
              >
                Manage Groups ({sourceGroups.length})
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleOpenAdd}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Add Source
              </Button>
            </>
          ) : (
            <SemanticBadge
              variant="neutral"
              label="Read-Only Source Directory"
              className="px-3 py-1.5 text-xs"
            />
          )
        }
      />

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          onClick={() => setStatusFilter('ALL')}
          className={`p-3 rounded-lg border text-left transition ${
            statusFilter === 'ALL'
              ? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/40'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            All Sources
          </span>
          <span className="text-lg font-bold font-mono text-slate-100 mt-0.5 block">
            {statusCounts.total}
          </span>
        </button>

        <button
          onClick={() => setStatusFilter('ACTIVE')}
          className={`p-3 rounded-lg border text-left transition ${
            statusFilter === 'ACTIVE'
              ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/40'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider block flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Active
          </span>
          <span className="text-lg font-bold font-mono text-emerald-300 mt-0.5 block">
            {statusCounts.active}
          </span>
          <span className="text-[10px] font-mono text-slate-400 block">
            {statusCounts.configuredEnabledCount} configured
          </span>
        </button>

        <button
          onClick={() => setStatusFilter('PAUSED')}
          className={`p-3 rounded-lg border text-left transition ${
            statusFilter === 'PAUSED'
              ? 'bg-amber-950/40 border-amber-500/60 ring-1 ring-amber-500/40'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <span className="text-[11px] font-medium text-amber-400 uppercase tracking-wider block flex items-center gap-1">
            <Clock className="w-3 h-3" /> Paused
          </span>
          <span className="text-lg font-bold font-mono text-amber-300 mt-0.5 block">
            {statusCounts.paused}
          </span>
          <span className="text-[10px] font-mono text-slate-400 block">
            {statusCounts.feedDerivedPausedCount > 0
              ? `${statusCounts.feedDerivedPausedCount} feed-paused`
              : `${statusCounts.explicitlyPausedCount} source-paused`}
          </span>
        </button>

        <button
          onClick={() => setStatusFilter('ERROR')}
          className={`p-3 rounded-lg border text-left transition ${
            statusFilter === 'ERROR'
              ? 'bg-rose-950/40 border-rose-500/60 ring-1 ring-rose-500/40'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <span className="text-[11px] font-medium text-rose-400 uppercase tracking-wider block flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Error
          </span>
          <span className="text-lg font-bold font-mono text-rose-300 mt-0.5 block">
            {statusCounts.error}
          </span>
          <span className="text-[10px] font-mono text-slate-400 block">
            {statusCounts.sourcesWithHistoricalErrorsCount > 0
              ? `${statusCounts.sourcesWithHistoricalErrorsCount} with hist. warnings`
              : '0 active errors'}
          </span>
        </button>

        <button
          onClick={() => setStatusFilter('SETUP_REQUIRED')}
          className={`p-3 rounded-lg border text-left transition ${
            statusFilter === 'SETUP_REQUIRED'
              ? 'bg-slate-800 border-slate-600 ring-1 ring-slate-500'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block flex items-center gap-1">
            <HelpCircle className="w-3 h-3" /> Setup Required
          </span>
          <span className="text-lg font-bold font-mono text-slate-300 mt-0.5 block">
            {statusCounts.setup}
          </span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by source name, domain, group, or tags (e.g. Insomnia, Greek, Foldables)..."
              className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
              >
                ×
              </button>
            )}
          </div>

          {/* Group Filter */}
          <div className="w-full md:w-48">
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Groups</option>
              {sourceGroups.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Collection Method Filter */}
          <div className="w-full md:w-36">
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Methods</option>
              <option value="RSS">RSS</option>
              <option value="ATOM">ATOM</option>
              <option value="API">API</option>
              <option value="WEB">WEB</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </div>

          {/* Market Filter */}
          <div className="w-full md:w-36">
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Markets</option>
              {uniqueMarkets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Filter Indicators */}
        {(searchQuery || statusFilter !== 'ALL' || groupFilter !== 'ALL' || methodFilter !== 'ALL' || marketFilter !== 'ALL') && (
          <div className="flex items-center gap-2 pt-1 border-t border-slate-800 text-[11px] text-slate-400">
            <span>Active filters:</span>
            {statusFilter !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 flex items-center gap-1">
                Status: {statusFilter}
                <button onClick={() => setStatusFilter('ALL')} className="hover:text-white">×</button>
              </span>
            )}
            {groupFilter !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 flex items-center gap-1">
                Group: {groupFilter}
                <button onClick={() => setGroupFilter('ALL')} className="hover:text-white">×</button>
              </span>
            )}
            {methodFilter !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 flex items-center gap-1">
                Method: {methodFilter}
                <button onClick={() => setMethodFilter('ALL')} className="hover:text-white">×</button>
              </span>
            )}
            {marketFilter !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 flex items-center gap-1">
                Market: {marketFilter}
                <button onClick={() => setMarketFilter('ALL')} className="hover:text-white">×</button>
              </span>
            )}
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setGroupFilter('ALL');
                setMethodFilter('ALL');
                setMarketFilter('ALL');
              }}
              className="text-indigo-400 hover:text-indigo-300 underline ml-auto"
            >
              Reset all filters
            </button>
          </div>
        )}
      </div>

      {/* Sources Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px] tracking-wider select-none">
              <tr>
                <th
                  onClick={() => toggleSort('name')}
                  className="py-3 px-4 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    Source & Domain
                    {sortBy === 'name' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                  </div>
                </th>
                <th className="py-3 px-3">Group & Topics</th>
                <th className="py-3 px-3">Protocol</th>
                <th
                  onClick={() => toggleSort('status')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    Status
                    {sortBy === 'status' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('lastCollected')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    Last Collection
                    {sortBy === 'lastCollected' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('articles')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-200 text-right"
                >
                  <div className="flex items-center justify-end gap-1">
                    Articles
                    {sortBy === 'articles' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('errors')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-200 text-right"
                  title="Active operational source errors vs. historical feed failure warnings"
                >
                  <div className="flex items-center justify-end gap-1">
                    Warnings / Errors
                    {sortBy === 'errors' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                  </div>
                </th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading && sources.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
                      <p className="text-xs font-mono text-slate-300">
                        Loading registered intelligence sources from Firestore...
                      </p>
                    </div>
                  </td>
                </tr>
              ) : filteredSources.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Rss className="w-8 h-8 text-slate-600" />
                      <p className="text-sm font-medium text-slate-300">No sources found matching criteria</p>
                      <p className="text-xs text-slate-500">
                        Try adjusting your search query, status filters, or register a new source.
                      </p>
                      <button
                        onClick={handleOpenAdd}
                        className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add New Source
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSources.map((source) => {
                  const groupObj = sourceGroups.find(
                    (g) =>
                      g.id === source.sourceGroupId ||
                      g.id === source.sourceGroup ||
                      g.name === source.sourceGroup
                  );
                  const groupDisplay = groupObj?.name || source.sourceGroup || 'General';
                  const isError = source.status === 'ERROR';

                  return (
                    <tr
                      key={source.id}
                      className="hover:bg-slate-800/40 transition group"
                    >
                      {/* Name & Domain */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-300 text-[11px] shrink-0">
                            {source.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                onClick={() => handleOpenDetail(source)}
                                className="font-semibold text-slate-200 hover:text-indigo-400 cursor-pointer truncate"
                              >
                                {source.name}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                                {source.language.toUpperCase()}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5 truncate">
                              <span className="font-mono text-slate-400 truncate max-w-[200px]">
                                {source.websiteUrl.replace(/^https?:\/\//, '')}
                              </span>
                              <a
                                href={source.websiteUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-500 hover:text-slate-300"
                                title="Open site in new tab"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Group & Topics */}
                      <td className="py-3 px-3">
                        <div className="space-y-1">
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
                            style={{
                              backgroundColor: `${groupObj?.color || '#4F46E5'}15`,
                              color: groupObj?.color || '#818CF8',
                              border: `1px solid ${groupObj?.color || '#4F46E5'}35`,
                            }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: groupObj?.color || '#818CF8' }}
                            />
                            {groupDisplay}
                          </span>
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {source.categories.slice(0, 2).map((c) => (
                              <span
                                key={c}
                                className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1 rounded border border-slate-800"
                              >
                                {c}
                              </span>
                            ))}
                            {source.categories.length > 2 && (
                              <span className="text-[10px] text-slate-500">
                                +{source.categories.length - 2}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Feeds & Protocol */}
                      <td className="py-3 px-3">
                        {(() => {
                          const resolved = resolveCanonicalSourceOperationalState(source);
                          return (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="px-1.5 py-0.2 rounded font-mono text-[10px] font-semibold bg-slate-950 text-indigo-300 border border-slate-800">
                                  {source.collectionMethod}
                                </span>
                                <span className="text-[11px] font-medium text-slate-300">
                                  {resolved.totalFeedCount > 0
                                    ? `${resolved.totalFeedCount} feed${resolved.totalFeedCount === 1 ? '' : 's'}`
                                    : '0 feeds'}
                                </span>
                              </div>
                              {resolved.totalFeedCount > 0 ? (
                                <div
                                  className={`text-[10px] font-mono ${
                                    resolved.activeFeedCount > 0
                                      ? 'text-emerald-400/80'
                                      : 'text-amber-400/80'
                                  }`}
                                >
                                  {resolved.activeFeedCount}/{resolved.totalFeedCount} active
                                  {resolved.isPausedByFeeds ? ' (all paused)' : ''}
                                </div>
                              ) : (
                                <div className="text-[10px] font-mono text-amber-400/80">
                                  Needs feeds
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Health & Status (Reconciled across KPIs, filters, and row actions) */}
                      <td className="py-3 px-3">
                        {(() => {
                          const resolved = resolveCanonicalSourceOperationalState(source);
                          if (resolved.badgeLabel === 'DEGRADED') {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 cursor-pointer"
                                onClick={() => handleOpenDetail(source)}
                                title={resolved.summaryReason}
                              >
                                <AlertTriangle className="w-3 h-3" />
                                DEGRADED
                              </span>
                            );
                          }
                          if (resolved.badgeLabel === 'ERROR') {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 cursor-pointer"
                                onClick={() => handleOpenDetail(source)}
                                title={source.lastError || resolved.summaryReason}
                              >
                                <AlertTriangle className="w-3 h-3" />
                                ERROR
                              </span>
                            );
                          }
                          if (resolved.badgeLabel === 'PAUSED') {
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-700/30 text-slate-300 border border-slate-700 cursor-pointer"
                                  onClick={() => handleOpenDetail(source)}
                                  title={resolved.summaryReason}
                                >
                                  <Clock className="w-3 h-3 text-amber-400" />
                                  PAUSED
                                </span>
                                {resolved.isPausedByFeeds && (
                                  <span className="text-[9px] font-mono text-amber-400/80">
                                    Feeds paused
                                  </span>
                                )}
                              </div>
                            );
                          }
                          if (resolved.badgeLabel === 'NEEDS CONFIG') {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 cursor-pointer"
                                onClick={() => handleOpenDetail(source)}
                                title={resolved.summaryReason}
                              >
                                <Clock className="w-3 h-3" />
                                NEEDS CONFIG
                              </span>
                            );
                          }
                          return (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                              title={resolved.summaryReason}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              HEALTHY
                            </span>
                          );
                        })()}
                      </td>

                      {/* Last Collection */}
                      <td className="py-3 px-3 text-slate-300 font-mono text-[11px]">
                        {source.lastSuccessfulCollection ? (
                          <div>
                            <div>{new Date(source.lastSuccessfulCollection).toLocaleDateString()}</div>
                            <div className="text-[10px] text-slate-500">
                              {new Date(source.lastSuccessfulCollection).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      {/* Articles Count */}
                      <td className="py-3 px-3 text-right font-mono font-medium text-slate-200">
                        {(source.articlesCollected ?? 0).toLocaleString()}
                      </td>

                      {/* Warnings / Errors */}
                      <td className="py-3 px-3 text-right font-mono">
                        {(() => {
                          const resolved = resolveCanonicalSourceOperationalState(source);
                          const display = formatSourceRowErrorOrWarningDisplay(resolved);
                          if (display.badgeKind !== 'NONE') {
                            return (
                              <span
                                className={`${
                                  display.tone === 'rose'
                                    ? 'text-rose-400 hover:text-rose-300'
                                    : 'text-amber-400/90 hover:text-amber-300'
                                } font-semibold cursor-pointer underline text-[11px]`}
                                onClick={() => handleOpenDetail(source)}
                                title={display.tooltip}
                              >
                                {display.displayValue}
                              </span>
                            );
                          }
                          return <span className="text-slate-500">0</span>;
                        })()}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        {(() => {
                          const resolved = resolveCanonicalSourceOperationalState(source);
                          const isPausedState = resolved.kpiBucket === 'PAUSED';
                          return (
                            <div className="flex items-center justify-end gap-1">
                              {canManage && (
                                <>
                                  <button
                                    onClick={() => handleCollectSingle(source.id)}
                                    disabled={collectingSourceId === source.id || isCollecting}
                                    className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30 rounded transition disabled:opacity-40"
                                    title="Ingest articles from this source now"
                                  >
                                    <Play
                                      className={`w-3.5 h-3.5 fill-current ${
                                        collectingSourceId === source.id ? 'animate-spin' : ''
                                      }`}
                                    />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (
                                        resolved.actionButtonMode === 'RESUME_FEEDS' ||
                                        resolved.activeFeedsCount === 0
                                      ) {
                                        handleOpenDetail(source);
                                      } else {
                                        toggleSourceStatus(source.id);
                                      }
                                    }}
                                    className={`p-1.5 rounded transition ${
                                      !isPausedState
                                        ? 'text-slate-400 hover:text-amber-400 hover:bg-amber-950/20'
                                        : 'text-amber-400 hover:text-emerald-400 hover:bg-emerald-950/20'
                                    }`}
                                    title={resolved.actionButtonTitle}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => handleOpenDetail(source)}
                                className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition"
                                title="Inspect details & feeds"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              {canManage && (
                                <>
                                  <button
                                    onClick={() => handleOpenEdit(source)}
                                    className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                                    title="Edit configuration"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setSourceToDelete(source)}
                                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded transition"
                                    title="Delete source"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer info */}
        <div className="p-3 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <div>
            Showing <span className="font-mono text-slate-200">{filteredSources.length}</span> of{' '}
            <span className="font-mono text-slate-200">{sources.length}</span> sources
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <Info className="w-3.5 h-3.5" />
            <span>All source configurations persist locally and conform to Firestore schemas.</span>
          </div>
        </div>
      </div>

      {/* Modals */}
      {canManage && (
        <AddEditSourceModal
          isOpen={isAddEditOpen}
          onClose={() => setIsAddEditOpen(false)}
          sourceToEdit={sourceToEdit}
        />
      )}

      {canManage && (
        <GroupManagerModal
          isOpen={isGroupManagerOpen}
          onClose={() => setIsGroupManagerOpen(false)}
        />
      )}

      <SourceDetailModal
        source={detailSource}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onEdit={(src) => {
          if (!canManage) return;
          setIsDetailOpen(false);
          handleOpenEdit(src);
        }}
        onToggleStatus={toggleSourceStatus}
      />

      {canManage && (
        <SafeDeleteSourceModal
          isOpen={Boolean(sourceToDelete)}
          source={sourceToDelete}
          onConfirm={handleConfirmDelete}
          onCancel={() => setSourceToDelete(null)}
        />
      )}
    </AppPage>
  );
};

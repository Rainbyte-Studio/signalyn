import React, { useState } from 'react';
import {
  X,
  Globe,
  Rss,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  FileText,
  ExternalLink,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Star,
  Tag,
  Sparkles,
  Info,
  Check,
  RotateCcw,
  Search,
  HelpCircle,
  Radio,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import {
  Source,
  SourceFeed,
  SourceHealth,
  CollectionMethod,
  FeedStatus,
  FeedCoverageRole,
  ArticleDiagnosticReport,
  ArticleDiagnosisStatus,
} from '../../types';
import { useApp } from '../../context/AppContext';
import { getSourceFeeds, normalizeFeedUrl } from '../../utils/urlUtils';
import {
  evaluateSourceStatusToggleContract,
  resolveCanonicalSourceOperationalState,
} from '../../utils/dataIntegrityContracts';
import { FeedCandidate } from '../../services/feedDiscoveryService';
import { SafeDeleteSourceModal } from './SafeDeleteSourceModal';

interface SourceDetailModalProps {
  source: Source | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (source: Source) => void;
  onToggleStatus: (id: string) => void;
}

export const SourceDetailModal: React.FC<SourceDetailModalProps> = ({
  source,
  isOpen,
  onClose,
  onEdit,
  onToggleStatus,
}) => {
  const {
    articles,
    sourceGroups,
    runCollector,
    isCollecting,
    feedDiscoveryService,
    addSourceFeed,
    updateSourceFeed,
    removeSourceFeed,
    setPrimarySourceFeed,
    toggleSourceFeedStatus,
    retrySourceFeed,
    deleteSource,
    notify,
    canManage,
  } = useApp();

  const [isCollectingAll, setIsCollectingAll] = useState(false);
  const [collectingFeedId, setCollectingFeedId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Feed Actions & Modals
  const [feedToRemove, setFeedToRemove] = useState<SourceFeed | null>(null);
  const [isRemovingFeed, setIsRemovingFeed] = useState(false);

  // Inline Category Editing
  const [editingFeedCategoriesId, setEditingFeedCategoriesId] = useState<string | null>(null);
  const [categoryInputText, setCategoryInputText] = useState('');

  // Discover & Add Feed Panel
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredCandidates, setDiscoveredCandidates] = useState<FeedCandidate[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // Manual Feed Entry Panel
  const [isManualFeedOpen, setIsManualFeedOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategories, setManualCategories] = useState('');
  const [manualType, setManualType] = useState<CollectionMethod>('RSS');
  const [manualCoverageRole, setManualCoverageRole] = useState<FeedCoverageRole>('CATEGORY');
  const [isValidatingManual, setIsValidatingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Missing Article Diagnostic Tool (Requirement 11)
  const [diagnosticUrl, setDiagnosticUrl] = useState('');
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<ArticleDiagnosticReport | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [isAddingDiagnosedFeed, setIsAddingDiagnosedFeed] = useState(false);

  if (!isOpen || !source) return null;

  const feeds = getSourceFeeds(source);

  const groupObj = sourceGroups.find(
    (g) =>
      g.id === source.sourceGroupId ||
      g.id === source.sourceGroup ||
      g.name === source.sourceGroup
  );
  const groupDisplayName = groupObj?.name || source.sourceGroup || 'General';

  const sourceArticles = articles.filter((a) => a.sourceId === source.id);

  // Coverage Diagnostics Metrics (Requirement 10)
  const activeFeeds = feeds.filter((f) => f.status === 'ACTIVE');
  const primaryFeed = feeds.find(
    (f) => f.coverageRole === 'PRIMARY_COVERAGE' || (f.isPrimary && f.coverageRole !== 'CATEGORY')
  );
  const categoryFeeds = feeds.filter(
    (f) =>
      f.coverageRole === 'CATEGORY' ||
      (!f.coverageRole && !f.isPrimary && (f.categories?.length || 0) > 0)
  );
  const supplementalFeeds = feeds.filter((f) => f.coverageRole === 'SUPPLEMENTAL');
  const resolvedSourceState = resolveCanonicalSourceOperationalState(source);
  const feedErrors = feeds.filter(
    (f) => f.status === 'ERROR' || f.failureCount > 0 || Boolean(f.lastError)
  );

  const allOldestDates = feeds.map((f) => f.oldestItemDate).filter(Boolean) as string[];
  allOldestDates.sort();
  const sourceOldestItemDate = allOldestDates[0] || null;

  const allNewestDates = feeds.map((f) => f.newestItemDate).filter(Boolean) as string[];
  allNewestDates.sort().reverse();
  const sourceNewestItemDate = allNewestDates[0] || null;

  const totalCollectedAcrossFeeds = feeds.reduce((sum, f) => sum + (f.articlesCollected || 0), 0);
  const totalArticlesCollected = Math.max(source.articlesCollected || 0, totalCollectedAcrossFeeds);

  const lastCollectionTimestamp =
    source.lastSuccessfulCollection ||
    source.lastCollectionAttempt ||
    source.lastCollectedAt ||
    feeds
      .map((f) => f.lastCollectedAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] ||
    null;

  const handleUpdateCoverageRole = async (feedId: string, role: FeedCoverageRole) => {
    try {
      await updateSourceFeed(source.id, feedId, {
        coverageRole: role,
        ...(role === 'PRIMARY_COVERAGE' ? { isPrimary: true } : {}),
      });
      notify('success', 'Coverage Role Updated', `Feed coverage role set to ${role}.`);
    } catch (err: unknown) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Could not update coverage role.');
    }
  };

  const handleRunArticleDiagnostic = async (overrideUrl?: string) => {
    const urlToTest = (overrideUrl || diagnosticUrl).trim();
    if (!urlToTest) {
      setDiagnosticError('Please enter an article URL to diagnose.');
      return;
    }
    try {
      setIsDiagnosing(true);
      setDiagnosticError(null);
      setDiagnosticReport(null);
      const report = await feedDiscoveryService.diagnoseArticle(urlToTest, source.id);
      setDiagnosticReport(report);
    } catch (err: unknown) {
      setDiagnosticError(err instanceof Error ? err.message : 'Diagnosis failed.');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleAddDiagnosedFeed = async () => {
    if (!diagnosticReport || !diagnosticReport.matchedFeedUrl) return;
    try {
      setIsAddingDiagnosedFeed(true);
      const feedTitle = diagnosticReport.matchedFeedTitle || 'Discovered Feed';
      const isReview = feedTitle.toLowerCase().includes('review') || diagnosticReport.targetUrl.includes('review');
      const isMain = feedTitle.toLowerCase().includes('main') || feedTitle.toLowerCase().includes('ειδήσεις');

      await addSourceFeed(source.id, {
        title: feedTitle,
        url: diagnosticReport.matchedFeedUrl,
        feedType: 'RSS',
        categories: isReview ? ['Reviews', 'Hardware'] : ['Technology'],
        coverageRole: isMain ? 'PRIMARY_COVERAGE' : isReview ? 'CATEGORY' : 'SUPPLEMENTAL',
        status: 'ACTIVE',
        isPrimary: isMain || feeds.length === 0,
      });

      notify('success', 'Feed Added', `Added "${feedTitle}" to ${source.name}. Ingesting articles...`);
      await runCollector(source.id);
      await handleRunArticleDiagnostic(diagnosticReport.targetUrl);
    } catch (err: unknown) {
      notify('error', 'Failed to Add Feed', err instanceof Error ? err.message : 'Could not add feed.');
    } finally {
      setIsAddingDiagnosedFeed(false);
    }
  };

  // Ingestion triggers
  const handleCollectAll = async () => {
    try {
      setIsCollectingAll(true);
      await runCollector(source.id);
    } finally {
      setIsCollectingAll(false);
    }
  };

  const handleCollectFeed = async (feed: SourceFeed) => {
    try {
      setCollectingFeedId(feed.id);
      await runCollector(source.id, feed.id);
    } finally {
      setCollectingFeedId(null);
    }
  };

  const handleRetryFeed = async (feed: SourceFeed) => {
    try {
      setCollectingFeedId(feed.id);
      await retrySourceFeed(source.id, feed.id);
      await runCollector(source.id, feed.id);
    } finally {
      setCollectingFeedId(null);
    }
  };

  // Remove Feed with Safety Guarantee
  const confirmRemoveFeed = async () => {
    if (!feedToRemove) return;
    try {
      setIsRemovingFeed(true);
      await removeSourceFeed(source.id, feedToRemove.id);
      setFeedToRemove(null);
    } finally {
      setIsRemovingFeed(false);
    }
  };

  // Safe Source Deletion
  const handleDeleteSource = async (reason?: string) => {
    if (!source) return;
    await deleteSource(source.id, reason);
    setIsDeleteModalOpen(false);
    onClose();
  };

  // Discover feeds for this existing publication
  const handleRunDiscovery = async () => {
    try {
      setIsDiscovering(true);
      setDiscoveryError(null);
      setIsDiscoveryOpen(true);

      const result = await feedDiscoveryService.inspectWebsite(source.websiteUrl);
      const candidates = result.candidates || [];

      // Filter out feeds that are already configured for this source
      const existingUrls = new Set(feeds.map((f) => normalizeFeedUrl(f.url)));
      const novelCandidates = candidates.filter((c) => !existingUrls.has(normalizeFeedUrl(c.url)));

      setDiscoveredCandidates(novelCandidates);
      if (novelCandidates.length === 0 && candidates.length > 0) {
        setDiscoveryError('All discovered syndication feeds are already configured for this source.');
      } else if (candidates.length === 0) {
        setDiscoveryError('No additional RSS/Atom feeds detected on this website.');
      }
    } catch (err: unknown) {
      setDiscoveryError(err instanceof Error ? err.message : 'Discovery inspection failed.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleAddDiscoveredCandidate = async (candidate: FeedCandidate) => {
    try {
      const categories: string[] = [];
      if (candidate.category) categories.push(candidate.category);

      await addSourceFeed(source.id, {
        title: candidate.title || 'Feed',
        url: candidate.url,
        feedType: candidate.type || 'RSS',
        categories,
        status: 'ACTIVE',
        isPrimary: feeds.length === 0,
      });

      // Remove from discovered list
      setDiscoveredCandidates((prev) =>
        prev.filter((c) => normalizeFeedUrl(c.url) !== normalizeFeedUrl(candidate.url))
      );
    } catch (err: unknown) {
      notify('error', 'Add Feed Failed', err instanceof Error ? err.message : 'Could not add feed');
    }
  };

  // Validate & Add Manual Feed
  const handleAddManualFeed = async () => {
    setManualError(null);
    const raw = manualUrl.trim();
    if (!raw) {
      setManualError('Please enter a feed URL.');
      return;
    }

    const norm = normalizeFeedUrl(raw);
    if (feeds.some((f) => normalizeFeedUrl(f.url) === norm)) {
      setManualError('This feed URL is already configured for this source.');
      return;
    }

    try {
      setIsValidatingManual(true);
      const valResult = await feedDiscoveryService.validateFeedUrl(norm);

      if (!valResult.valid) {
        setManualError(valResult.error || 'Endpoint validation failed. Not a valid RSS/Atom feed.');
        return;
      }

      const candidate = valResult.candidate;
      const categories = manualCategories
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      await addSourceFeed(source.id, {
        title: manualTitle.trim() || candidate?.title || 'Manual Feed',
        url: norm,
        feedType: candidate?.type || manualType,
        categories,
        status: 'ACTIVE',
        isPrimary: feeds.length === 0,
      });

      setManualUrl('');
      setManualTitle('');
      setManualCategories('');
      setIsManualFeedOpen(false);
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : 'Failed to add feed.');
    } finally {
      setIsValidatingManual(false);
    }
  };

  // Save inline categories
  const handleSaveCategories = async (feedId: string) => {
    const categories = categoryInputText
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    await updateSourceFeed(source.id, feedId, { categories });
    setEditingFeedCategoriesId(null);
  };

  const getHealthBadge = () => {
    if (resolvedSourceState.effectiveBucket === 'PAUSED') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-500/10 text-slate-300 border border-slate-500/30"
          title={resolvedSourceState.badgeSubtitle}
        >
          <Clock className="w-3.5 h-3.5" /> PAUSED
          {resolvedSourceState.isFeedDerivedPaused && (
            <span className="text-[10px] font-mono text-amber-300 ml-1">
              (0/{resolvedSourceState.totalFeedsCount} Active Feeds)
            </span>
          )}
        </span>
      );
    }
    if (resolvedSourceState.effectiveBucket === 'ERROR') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30">
          <AlertTriangle className="w-3.5 h-3.5" /> ERROR
        </span>
      );
    }
    if (resolvedSourceState.effectiveBucket === 'SETUP_REQUIRED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
          <Clock className="w-3.5 h-3.5" /> NEEDS CONFIGURATION
        </span>
      );
    }
    if (resolvedSourceState.isDegraded) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5" /> DEGRADED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE ({resolvedSourceState.activeFeedsCount}/{resolvedSourceState.totalFeedsCount} Feeds)
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div
        className="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[88vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200 text-sm">
              {source.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-100">{source.name}</h2>
                {getHealthBadge()}
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                  {source.language.toUpperCase()}
                </span>
              </div>
              <a
                href={source.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-mono mt-0.5"
              >
                {source.websiteUrl}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-md hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Metadata Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">
                Source Group
              </span>
              <span className="text-xs font-semibold text-slate-200 mt-1 block truncate">
                {groupDisplayName}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">
                Operational Feeds
              </span>
              <span className="text-xs font-mono font-semibold text-indigo-300 mt-1 block">
                {feeds.length} ({feeds.filter((f) => f.status === 'ACTIVE').length} active)
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">
                Market & Language
              </span>
              <span className="text-xs font-semibold text-slate-200 mt-1 block">
                {source.market} ({source.language.toUpperCase()})
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block">
                Articles Stored
              </span>
              <span className="text-xs font-mono font-semibold text-emerald-300 mt-1 block">
                {(source.articlesCollected ?? sourceArticles.length ?? 0).toLocaleString()}
              </span>
            </div>
          </div>

          {/* FEEDS MANAGEMENT SECTION (Requirement 16) */}
          <div className="space-y-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Rss className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Feeds Management ({feeds.length})
                </h3>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRunDiscovery}
                    disabled={isDiscovering}
                    className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                    title="Discover additional RSS/Atom feeds from website HTML"
                  >
                    {isDiscovering ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    <span>Discover Feeds</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsManualFeedOpen(!isManualFeedOpen)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Manual Feed</span>
                  </button>
                </div>
              )}
            </div>

            {/* Manual Feed Entry Drawer */}
            {isManualFeedOpen && (
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-700 space-y-3 animate-in fade-in duration-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Add Feed Manually (Validated Before Enabling)
                  </span>
                  <button
                    onClick={() => setIsManualFeedOpen(false)}
                    className="text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Cancel
                  </button>
                </div>

                {manualError && (
                  <div className="p-2.5 rounded bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span>{manualError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">Endpoint URL *</label>
                    <input
                      type="text"
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="https://example.com/rss/tech.xml"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">Feed Title</label>
                    <input
                      type="text"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      placeholder="e.g. Technology & Smartphones"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">Categories (comma-separated)</label>
                    <input
                      type="text"
                      value={manualCategories}
                      onChange={(e) => setManualCategories(e.target.value)}
                      placeholder="Smartphones, Hardware"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium">Feed Protocol</label>
                    <select
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value as CollectionMethod)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="RSS">RSS</option>
                      <option value="ATOM">ATOM</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleAddManualFeed}
                    disabled={isValidatingManual || !manualUrl.trim()}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1.5 transition shadow-xs"
                  >
                    {isValidatingManual ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>{isValidatingManual ? 'Validating Endpoint...' : 'Validate & Enable Feed'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Discovery Candidates Drawer */}
            {isDiscoveryOpen && (
              <div className="p-3.5 rounded-lg bg-indigo-950/30 border border-indigo-900/60 space-y-3 animate-in fade-in duration-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-300">
                    Discovered Feed Candidates ({discoveredCandidates.length})
                  </span>
                  <button
                    onClick={() => setIsDiscoveryOpen(false)}
                    className="text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Close
                  </button>
                </div>

                {discoveryError && (
                  <p className="text-xs text-amber-300 font-mono bg-amber-950/30 p-2 rounded border border-amber-900/40">
                    {discoveryError}
                  </p>
                )}

                {discoveredCandidates.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {discoveredCandidates.map((candidate) => (
                      <div
                        key={candidate.url}
                        className="p-2.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200 truncate">{candidate.title}</span>
                            <span className="text-[10px] font-mono px-1 rounded bg-slate-800 text-indigo-300">
                              {candidate.type}
                            </span>
                            {candidate.entryCount !== undefined && (
                              <span className="text-[10px] font-mono text-emerald-400">
                                {candidate.entryCount} items
                              </span>
                            )}
                            {candidate.category && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-900/40 text-indigo-300">
                                {candidate.category}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                            {candidate.url}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleAddDiscoveredCandidate(candidate)}
                          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium shrink-0 flex items-center gap-1 transition"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Feed</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* List of Configured Feeds */}
            {feeds.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                No syndication feeds configured. Click "Discover Feeds" or "Manual Feed" to add endpoints.
              </div>
            ) : (
              <div className="space-y-3">
                {feeds.map((feed) => {
                  const isFeedCollecting = collectingFeedId === feed.id;
                  const isEditingCategories = editingFeedCategoriesId === feed.id;
                  const isError = feed.status === 'ERROR' || (feed.failureCount > 0 && feed.lastError);

                  return (
                    <div
                      key={feed.id}
                      className={`p-3.5 rounded-lg border transition ${
                        isError
                          ? 'bg-rose-950/15 border-rose-900/40'
                          : 'bg-slate-900/90 border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() => setPrimarySourceFeed(source.id, feed.id)}
                                className={`p-0.5 rounded transition ${
                                  feed.isPrimary
                                    ? 'text-amber-400 hover:text-amber-300'
                                    : 'text-slate-600 hover:text-slate-400'
                                }`}
                                title={feed.isPrimary ? 'Primary Feed' : 'Set as Primary Feed'}
                              >
                                <Star className={`w-4 h-4 ${feed.isPrimary ? 'fill-current' : ''}`} />
                              </button>
                            ) : feed.isPrimary ? (
                              <Star className="w-4 h-4 text-amber-400 fill-current" />
                            ) : null}
                            <span className="text-xs font-semibold text-slate-100">{feed.title}</span>
                            {feed.isPrimary && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                                PRIMARY
                              </span>
                            )}
                            {feed.coverageRole === 'PRIMARY_COVERAGE' ? (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30 font-semibold">
                                PRIMARY COVERAGE
                              </span>
                            ) : feed.coverageRole === 'SUPPLEMENTAL' ? (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-500/10 text-slate-400 border border-slate-500/30">
                                SUPPLEMENTAL
                              </span>
                            ) : (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                                CATEGORY
                              </span>
                            )}
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-indigo-300">
                              {feed.feedType}
                            </span>
                            <span
                              className={`text-[10px] font-medium px-2 py-0.2 rounded border ${
                                feed.status === 'ACTIVE'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : feed.status === 'PAUSED'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              }`}
                            >
                              {feed.status}
                            </span>
                          </div>

                          <div className="font-mono text-[10px] text-slate-400 truncate mt-1 break-all">
                            {feed.url}
                          </div>
                        </div>

                        {/* Action Buttons for Feed */}
                        {canManage && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {feed.status === 'ERROR' ? (
                            <button
                              type="button"
                              onClick={() => handleRetryFeed(feed)}
                              disabled={isFeedCollecting}
                              className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded text-[11px] font-medium flex items-center gap-1 transition"
                              title="Reset failure count and retry collection"
                            >
                              <RotateCcw className={`w-3 h-3 ${isFeedCollecting ? 'animate-spin' : ''}`} />
                              <span>Retry</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleCollectFeed(feed)}
                              disabled={isFeedCollecting || isCollectingAll}
                              className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded text-[11px] font-medium flex items-center gap-1 transition"
                              title="Collect articles from this specific feed endpoint"
                            >
                              {isFeedCollecting ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Play className="w-3 h-3 fill-current" />
                              )}
                              <span>Collect</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => toggleSourceFeedStatus(source.id, feed.id)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition"
                            title={feed.status === 'ACTIVE' ? 'Pause feed collection' : 'Activate feed'}
                          >
                            {feed.status === 'ACTIVE' ? 'Pause' : 'Enable'}
                          </button>

                          <button
                            type="button"
                            onClick={() => setFeedToRemove(feed)}
                            className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800 transition"
                            title="Remove feed from publication"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        )}
                      </div>

                      {/* Error Diagnostic if present */}
                      {feed.lastError && (
                        <div className="mt-2 p-2 rounded bg-rose-950/40 border border-rose-900/30 text-[11px] font-mono text-rose-300 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400 mt-0.5" />
                          <div className="break-all">
                            Failures: {feed.failureCount} — {feed.lastError}
                          </div>
                        </div>
                      )}

                      {/* Telemetry Row */}
                      <div className="mt-2.5 pt-2 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono text-slate-400">
                        <div>
                          <span>Articles: </span>
                          <span className="text-emerald-400 font-semibold">
                            {(feed.articlesCollected || 0).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span>Last Collection: </span>
                          <span className="text-slate-300">
                            {feed.lastCollectedAt
                              ? new Date(feed.lastCollectedAt).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'Never'}
                          </span>
                        </div>
                        <div>
                          <span>Last Successful: </span>
                          <span className="text-slate-300">
                            {feed.lastSuccessfulCollectionAt
                              ? new Date(feed.lastSuccessfulCollectionAt).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'Never'}
                          </span>
                        </div>
                        {feed.oldestItemDate && feed.newestItemDate && (
                          <div className="col-span-2 sm:col-span-3 text-[10px] text-slate-400 font-mono flex items-center gap-1.5 pt-1">
                            <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                            <span className="text-slate-500">History Window:</span>
                            <span className="text-slate-300">
                              {new Date(feed.oldestItemDate).toLocaleDateString()} — {new Date(feed.newestItemDate).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Feed-Level Categories & Coverage Role Controls */}
                      <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <Tag className="w-3 h-3 text-slate-500 shrink-0" />
                          <span className="text-[10px] text-slate-400 font-medium">Categories:</span>
                          {feed.categories && feed.categories.length > 0 ? (
                            feed.categories.map((c) => (
                              <span
                                key={c}
                                className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-indigo-300 border border-slate-700"
                              >
                                {c}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-500 italic">None assigned</span>
                          )}
                        </div>

                        {canManage ? (
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Coverage Role Selector */}
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-500 font-mono">Role:</span>
                              <select
                                value={feed.coverageRole || (feed.isPrimary ? 'PRIMARY_COVERAGE' : 'CATEGORY')}
                                onChange={(e) => handleUpdateCoverageRole(feed.id, e.target.value as FeedCoverageRole)}
                                className="bg-slate-950 border border-slate-800 text-[10px] rounded px-1.5 py-0.5 text-slate-300 focus:outline-none focus:border-indigo-500 font-mono cursor-pointer"
                                title="Set Feed Coverage Role"
                              >
                                <option value="PRIMARY_COVERAGE">PRIMARY_COVERAGE (Broad)</option>
                                <option value="CATEGORY">CATEGORY (Section)</option>
                                <option value="SUPPLEMENTAL">SUPPLEMENTAL (Additional)</option>
                              </select>
                            </div>

                            {isEditingCategories ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={categoryInputText}
                                  onChange={(e) => setCategoryInputText(e.target.value)}
                                  placeholder="Smartphones, Hardware"
                                  className="px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-[11px] text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveCategories(feed.id)}
                                  className="px-2 py-0.5 bg-indigo-600 text-white rounded text-[10px] font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingFeedCategoriesId(null)}
                                  className="text-slate-400 text-[10px]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingFeedCategoriesId(feed.id);
                                  setCategoryInputText(feed.categories.join(', '));
                                }}
                                className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                              >
                                Edit Categories
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="text-[10px] font-mono text-slate-500">
                            Role: {feed.coverageRole || (feed.isPrimary ? 'PRIMARY_COVERAGE' : 'CATEGORY')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* COVERAGE DIAGNOSTICS SECTION (Requirement 10) */}
          <div className="space-y-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Publication Coverage Diagnostics
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Architecture: Multi-Feed Syndication
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Active Feeds */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">Active Feeds</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100 font-mono text-sm">
                    {activeFeeds.length} / {feeds.length} Active
                  </span>
                  {activeFeeds.length === feeds.length && feeds.length > 0 ? (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30">
                      All Feeds Active
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/30">
                      {feeds.length - activeFeeds.length} Paused/Degraded
                    </span>
                  )}
                </div>
              </div>

              {/* Primary Coverage Feed */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">Primary Coverage Feed</span>
                {primaryFeed ? (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-medium text-sky-300 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="truncate">{primaryFeed.title}</span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-400 truncate">
                      {primaryFeed.url}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400 italic text-xs flex items-center gap-1.5 mt-1">
                    <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>No broad publication feed configured.</span>
                  </div>
                )}
              </div>

              {/* Category Feeds */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">Category Feeds ({categoryFeeds.length})</span>
                {categoryFeeds.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {categoryFeeds.map((f) => (
                      <span
                        key={f.id}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-900/40"
                        title={f.url}
                      >
                        {f.title}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-500 text-xs italic">No specific category feeds configured.</span>
                )}
              </div>

              {/* Collection Telemetry */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">Collection Telemetry</span>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Last Collection:</span>
                    <span className="font-mono text-xs text-slate-200">
                      {lastCollectionTimestamp
                        ? new Date(lastCollectionTimestamp).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Never'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Articles Collected:</span>
                    <span className="font-mono text-xs font-semibold text-emerald-400">
                      {totalArticlesCollected.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Historical RSS Window Coverage */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">Syndication History Window</span>
                <div className="grid grid-cols-2 gap-2 mt-1 text-[11px] font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Oldest Available:</span>
                    <span className="text-slate-300">
                      {sourceOldestItemDate ? new Date(sourceOldestItemDate).toLocaleDateString() : 'Pending collection'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Newest Available:</span>
                    <span className="text-slate-300">
                      {sourceNewestItemDate ? new Date(sourceNewestItemDate).toLocaleDateString() : 'Pending collection'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Feed Errors */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">
                  Feed Operational &amp; Historical Errors
                </span>
                {resolvedSourceState.totalErrorCount === 0 && feedErrors.length === 0 ? (
                  resolvedSourceState.effectiveBucket === 'PAUSED' ? (
                    <div className="text-slate-300 flex items-center gap-1.5 text-xs mt-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        All {resolvedSourceState.totalFeedsCount} configured feeds paused (0 active or historical errors).
                      </span>
                    </div>
                  ) : (
                    <div className="text-emerald-400 flex items-center gap-1.5 text-xs mt-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>All configured feeds healthy with 0 errors.</span>
                    </div>
                  )
                ) : (
                  <div className="space-y-1.5 mt-1">
                    <div
                      className={`text-[11px] font-mono flex items-start gap-1.5 ${
                        resolvedSourceState.hasCurrentOperationalError
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        {resolvedSourceState.hasCurrentOperationalError
                          ? `${resolvedSourceState.totalErrorCount} active operational feed error(s) detected.`
                          : `${resolvedSourceState.totalErrorCount} historical feed failure(s) recorded (${
                              resolvedSourceState.effectiveBucket === 'PAUSED'
                                ? 'all feeds currently paused — 0 active source errors'
                                : '0 active source errors; active feeds currently healthy'
                            }).`}
                      </span>
                    </div>
                    {feedErrors.map((f) => (
                      <div
                        key={f.id}
                        className="text-slate-300 text-[11px] font-mono pl-5 flex items-start justify-between gap-2"
                      >
                        <span className="truncate">
                          {f.title} ({f.status}):{' '}
                          {f.lastError || `${f.failureCount || 0} prior failure(s)`}
                        </span>
                        <span className="text-amber-400 shrink-0">
                          {f.failureCount || 0} err
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MISSING ARTICLE DIAGNOSTIC TOOL (Requirement 11) */}
          <div className="space-y-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Missing Article Diagnostic Tool (Check Article URL)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Syndication Path Inspector
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Verify why a specific publication URL was not ingested, check if it exists in an unconfigured feed, or detect if it falls outside the active RSS history window.
            </p>

            {/* Input Row */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={diagnosticUrl}
                  onChange={(e) => setDiagnosticUrl(e.target.value)}
                  placeholder="https://www.insomnia.gr/articles/various/insomnia-review/huawei-watch-gt-7-pro-review/"
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500 placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => handleRunArticleDiagnostic()}
                  disabled={isDiagnosing || !diagnosticUrl.trim()}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-xs shrink-0 cursor-pointer"
                >
                  {isDiagnosing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>{isDiagnosing ? 'Diagnosing...' : 'Check Article URL'}</span>
                </button>
              </div>

              {/* Quick helper for Insomnia review */}
              {source.normalizedDomain === 'insomnia.gr' && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span>Quick Test URL:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const url = 'https://www.insomnia.gr/articles/various/insomnia-review/huawei-watch-gt-7-pro-review/';
                      setDiagnosticUrl(url);
                      handleRunArticleDiagnostic(url);
                    }}
                    className="text-amber-400 hover:text-amber-300 underline font-mono truncate max-w-md cursor-pointer"
                  >
                    Huawei Watch GT 7 Pro Review
                  </button>
                </div>
              )}
            </div>

            {diagnosticError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/50 text-xs text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{diagnosticError}</span>
              </div>
            )}

            {/* Diagnostic Result Card */}
            {diagnosticReport && (
              <div className="p-4 rounded-lg bg-slate-900 border border-slate-700 space-y-3 animate-in fade-in duration-150">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Status Badge */}
                      {diagnosticReport.status === 'LIVE_FEED_AVAILABLE' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          LIVE_FEED_AVAILABLE
                        </span>
                      )}
                      {diagnosticReport.status === 'ALREADY_INGESTED' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
                          ALREADY_INGESTED
                        </span>
                      )}
                      {diagnosticReport.status === 'FILTERED_FROM_UI' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
                          FILTERED_FROM_UI
                        </span>
                      )}
                      {diagnosticReport.status === 'HISTORICAL_FEED_LIMIT' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                          HISTORICAL_FEED_LIMIT
                        </span>
                      )}
                      {diagnosticReport.status === 'NO_SYNDICATION_COVERAGE' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-500/10 text-slate-300 border border-slate-500/30">
                          NO_SYNDICATION_COVERAGE
                        </span>
                      )}
                      {diagnosticReport.status === 'INGESTION_ERROR' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                          INGESTION_ERROR
                        </span>
                      )}
                      <h4 className="text-xs font-semibold text-slate-100">{diagnosticReport.headline}</h4>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{diagnosticReport.explanation}</p>
                  </div>

                  {/* Quick action button if available in unconfigured feed — Admins only */}
                  {canManage && diagnosticReport.status === 'LIVE_FEED_AVAILABLE' && !diagnosticReport.isFeedConfigured && diagnosticReport.matchedFeedUrl && (
                    <button
                      type="button"
                      onClick={handleAddDiagnosedFeed}
                      disabled={isAddingDiagnosedFeed}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium shrink-0 flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                    >
                      {isAddingDiagnosedFeed ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>Add Feed & Ingest</span>
                    </button>
                  )}
                </div>

                {/* Details Breakdown */}
                <div className="pt-2 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                  <div>
                    <span className="text-slate-500">Target URL: </span>
                    <span className="text-slate-300 break-all">{diagnosticReport.targetUrl}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Canonical: </span>
                    <span className="text-slate-300 break-all">{diagnosticReport.normalizedUrl}</span>
                  </div>
                  {diagnosticReport.matchedFeedTitle && (
                    <div>
                      <span className="text-slate-500">Matched Feed: </span>
                      <span className="text-indigo-300">{diagnosticReport.matchedFeedTitle}</span>
                      {diagnosticReport.isFeedConfigured ? (
                        <span className="ml-1 text-emerald-400">(Configured)</span>
                      ) : (
                        <span className="ml-1 text-amber-400">(Not Configured)</span>
                      )}
                    </div>
                  )}
                  {diagnosticReport.matchedFeedUrl && (
                    <div>
                      <span className="text-slate-500">Feed URL: </span>
                      <span className="text-slate-300 break-all">{diagnosticReport.matchedFeedUrl}</span>
                    </div>
                  )}
                  {diagnosticReport.publishedAt && (
                    <div>
                      <span className="text-slate-500">Article Published: </span>
                      <span className="text-slate-200">{new Date(diagnosticReport.publishedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {diagnosticReport.suggestedAction && (
                    <div className="col-span-1 md:col-span-2 text-indigo-300">
                      <span className="text-slate-500">Suggested Action: </span>
                      <span>{diagnosticReport.suggestedAction}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Assigned Source-Level Publication Categories */}
          <div>
            <span className="text-xs font-medium text-slate-300 block mb-2">
              Publication Topic Categories
            </span>
            <div className="flex flex-wrap gap-1.5">
              {source.categories.map((cat) => (
                <span
                  key={cat}
                  className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono"
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {/* Recent Ingested Articles Preview with Feed Provenance */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                Latest Ingested Articles ({sourceArticles.length})
              </span>
            </div>

            {sourceArticles.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950/40 border border-slate-800 text-center text-xs text-slate-500">
                No articles ingested yet. Click "Collect All Feeds" below to run the live collector.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {sourceArticles.slice(0, 5).map((art) => (
                  <div
                    key={art.id}
                    className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={art.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-slate-200 hover:text-indigo-400 line-clamp-1"
                      >
                        {art.title}
                      </a>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {art.feedTitle && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-900/60">
                            {art.feedTitle}
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-slate-400">
                          {new Date(art.publishedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">{art.excerpt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 shrink-0">
          {/* Destructive Action - Visually Separated (Requirement 1 & 2) */}
          {canManage ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-rose-100 border border-rose-800/60 rounded-lg text-xs font-medium transition group"
                title="Permanently remove source configuration (Historical articles preserved)"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400 group-hover:text-rose-200" />
                <span>Delete Source</span>
              </button>

              <div className="hidden sm:block h-4 w-px bg-slate-800" />

              {/* Standard Operations */}
              <div className="flex items-center gap-2">
                {(() => {
                  const toggleContract = evaluateSourceStatusToggleContract(source);
                  return (
                    <button
                      onClick={() => {
                        if (toggleContract.allowed) {
                          onToggleStatus(source.id);
                        }
                      }}
                      disabled={!toggleContract.allowed}
                      title={toggleContract.userMessage}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition disabled:opacity-60 disabled:cursor-not-allowed ${
                        !toggleContract.allowed
                          ? 'border-amber-700/50 text-amber-300 bg-amber-950/20'
                          : toggleContract.actionMode === 'PAUSE_SOURCE'
                          ? 'border-amber-700/50 text-amber-300 hover:bg-amber-950/30'
                          : 'border-emerald-700/50 text-emerald-300 hover:bg-emerald-950/30'
                      }`}
                    >
                      {toggleContract.buttonLabel}
                    </button>
                  );
                })()}
                <button
                  onClick={handleCollectAll}
                  disabled={isCollectingAll || isCollecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition shadow-xs"
                  title="Run ingestion across all active feeds for this source"
                >
                  {isCollectingAll ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>{isCollectingAll ? 'Ingesting All Feeds...' : 'Collect All Feeds'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              <span>Read-Only Diagnostics Mode</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {canManage && (
              <button
                onClick={() => onEdit(source)}
                className="px-4 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition"
              >
                Edit Source
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Safe Source Deletion Modal (Requirements 1, 2, 3, 4, 12, 13) */}
      <SafeDeleteSourceModal
        isOpen={isDeleteModalOpen}
        source={source}
        onConfirm={handleDeleteSource}
        onCancel={() => setIsDeleteModalOpen(false)}
      />

      {/* Feed Removal Confirmation Modal (Requirement 18: Safe feed removal guarantee) */}
      {feedToRemove && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h4 className="text-sm font-semibold text-slate-100">Remove Feed Endpoint</h4>
            </div>

            <div className="space-y-2 text-xs text-slate-300">
              <p>
                Are you sure you want to remove feed <strong>"{feedToRemove.title}"</strong> (
                <span className="font-mono text-slate-400">{feedToRemove.url}</span>)?
              </p>
              <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/40 text-emerald-300">
                <strong>Historical Intelligence Protected:</strong> Removing this feed will only stop future collection from this endpoint. Previously ingested articles and AI analyses are permanently preserved.
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFeedToRemove(null)}
                disabled={isRemovingFeed}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRemoveFeed}
                disabled={isRemovingFeed}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
              >
                {isRemovingFeed && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>Confirm Removal</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

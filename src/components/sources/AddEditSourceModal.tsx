import React, { useState, useEffect } from 'react';
import {
  X,
  Globe,
  Sparkles,
  AlertCircle,
  Info,
  Check,
  Plus,
  Trash2,
  Star,
  Rss,
  CheckCircle2,
  Clock,
  RefreshCw,
  Tag,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import {
  Source,
  SourceFeed,
  CollectionMethod,
  SourceStatus,
  FeedStatus,
  FeedCoverageRole,
  DeletedSource,
} from '../../types';
import { useApp } from '../../context/AppContext';
import {
  extractNormalizedDomain,
  ensureHttpProtocol,
  normalizeFeedUrl,
  getSourceFeeds,
  computeSourceHealth,
} from '../../utils/urlUtils';
import { withTimeout } from '../../firebase';
import { FeedCandidate } from '../../services/feedDiscoveryService';
import { SafeDeleteSourceModal } from './SafeDeleteSourceModal';

interface AddEditSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceToEdit?: Source | null;
}

interface DraftFeedItem {
  id: string;
  title: string;
  url: string;
  feedType: CollectionMethod;
  categories: string[];
  coverageRole?: FeedCoverageRole;
  status: FeedStatus;
  isPrimary: boolean;
  entryCount?: number;
  detectedCategory?: string;
  createdAt?: string;
  updatedAt?: string;
  lastCollectedAt?: string | null;
  lastSuccessfulCollectionAt?: string | null;
  failureCount?: number;
  articlesCollected?: number;
  lastError?: string | null;
}

const COMMON_MARKETS = ['Global', 'Greece', 'Europe', 'US', 'Asia-Pacific', 'China'];
const COMMON_LANGUAGES = [
  { code: 'en', label: 'English (en)' },
  { code: 'el', label: 'Greek (el)' },
  { code: 'de', label: 'German (de)' },
  { code: 'zh', label: 'Chinese (zh)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'es', label: 'Spanish (es)' },
];

export const AddEditSourceModal: React.FC<AddEditSourceModalProps> = ({
  isOpen,
  onClose,
  sourceToEdit,
}) => {
  const {
    sources,
    deletedSources,
    sourceGroups,
    createSource,
    updateSource,
    deleteSource,
    restoreSource,
    getDeletedSourceByDomain,
    feedDiscoveryService,
    notify,
  } = useApp();

  const isEditing = Boolean(sourceToEdit);

  // Form State
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [country, setCountry] = useState('Global');
  const [market, setMarket] = useState('Global');
  const [language, setLanguage] = useState('en');
  const [sourceGroupId, setSourceGroupId] = useState('');
  const [sourceCategoriesInput, setSourceCategoriesInput] = useState('');
  const [status, setStatus] = useState<SourceStatus>('ACTIVE');

  // Deletion & Restoration State (Requirements 1, 2, 7)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [detectedTombstone, setDetectedTombstone] = useState<DeletedSource | null>(null);
  const [customIdToRestore, setCustomIdToRestore] = useState<string | null>(null);

  // Multi-Feed Draft State
  const [draftFeeds, setDraftFeeds] = useState<DraftFeedItem[]>([]);

  // Discovery Inspection State
  const [isInspecting, setIsInspecting] = useState(false);
  const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null);
  const [discoveredCandidates, setDiscoveredCandidates] = useState<FeedCandidate[]>([]);
  const [selectedCandidateUrls, setSelectedCandidateUrls] = useState<Set<string>>(new Set());
  const [diagnosticsInfo, setDiagnosticsInfo] = useState<{
    htmlLinkTagsFound: number;
    endpointsProbed: number;
    responseTimeMs: number;
  } | null>(null);

  // Manual Feed Input State
  const [showManualFeedForm, setShowManualFeedForm] = useState(false);
  const [manualFeedUrl, setManualFeedUrl] = useState('');
  const [manualFeedTitle, setManualFeedTitle] = useState('');
  const [manualFeedCategories, setManualFeedCategories] = useState('');
  const [manualFeedType, setManualFeedType] = useState<CollectionMethod>('RSS');
  const [isValidatingManual, setIsValidatingManual] = useState(false);
  const [manualValidationError, setManualValidationError] = useState<string | null>(null);

  // General Form Errors & Submitting
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize or reset form
  useEffect(() => {
    if (sourceToEdit) {
      setWebsiteUrl(sourceToEdit.websiteUrl);
      setName(sourceToEdit.name);
      setLogoUrl(sourceToEdit.logoUrl || '');
      setCountry(sourceToEdit.country || 'Global');
      setMarket(sourceToEdit.market || 'Global');
      setLanguage(sourceToEdit.language || 'en');

      // Resolve valid sourceGroupId
      const matchingGroup = sourceGroups.find(
        (g) =>
          g.id === sourceToEdit.sourceGroupId ||
          g.id === sourceToEdit.sourceGroup ||
          g.name === sourceToEdit.sourceGroup
      );
      setSourceGroupId(matchingGroup?.id || sourceGroups[0]?.id || '');

      setSourceCategoriesInput(sourceToEdit.categories.join(', '));
      setStatus(sourceToEdit.status);

      // Populate draft feeds from source
      const existingFeeds = getSourceFeeds(sourceToEdit);
      setDraftFeeds(
        existingFeeds.map((f, idx) => ({
          id: f.id || `feed-${idx}-${Date.now().toString(36)}`,
          title: f.title,
          url: f.url,
          feedType: f.feedType,
          categories: f.categories || [],
          coverageRole: f.coverageRole,
          status: f.status || 'ACTIVE',
          isPrimary: Boolean(f.isPrimary),
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          lastCollectedAt: f.lastCollectedAt,
          lastSuccessfulCollectionAt: f.lastSuccessfulCollectionAt,
          failureCount: f.failureCount || 0,
          articlesCollected: f.articlesCollected || 0,
          lastError: f.lastError,
        }))
      );

      setDiscoveryNotice(null);
      setDiscoveredCandidates([]);
      setSelectedCandidateUrls(new Set());
      setDiagnosticsInfo(null);
      setFormError(null);
      setShowManualFeedForm(false);
    } else {
      setWebsiteUrl('');
      setName('');
      setLogoUrl('');
      setCountry('Global');
      setMarket('Global');
      setLanguage('en');
      setSourceGroupId(sourceGroups[0]?.id || '');
      setSourceCategoriesInput('Technology, Industry, News');
      setStatus('ACTIVE');
      setDraftFeeds([]);
      setDiscoveryNotice(null);
      setDiscoveredCandidates([]);
      setSelectedCandidateUrls(new Set());
      setDiagnosticsInfo(null);
      setFormError(null);
      setShowManualFeedForm(false);
      setManualFeedUrl('');
      setManualFeedTitle('');
      setManualFeedCategories('');
      setManualValidationError(null);
      setDetectedTombstone(null);
      setCustomIdToRestore(null);
      setIsDeleteModalOpen(false);
    }
  }, [sourceToEdit, sourceGroups, isOpen]);

  // Detect previously deleted source when entering URL (Requirement 7)
  useEffect(() => {
    if (isEditing || !websiteUrl.trim()) {
      setDetectedTombstone(null);
      return;
    }
    const domain = extractNormalizedDomain(websiteUrl.trim());
    if (!domain) {
      setDetectedTombstone(null);
      return;
    }

    const matched = deletedSources.find((d) => d.normalizedDomain === domain);
    if (matched) {
      setDetectedTombstone(matched);
    } else {
      getDeletedSourceByDomain(domain)
        .then((res) => {
          setDetectedTombstone(res);
        })
        .catch(() => {
          setDetectedTombstone(null);
        });
    }
  }, [websiteUrl, isEditing, deletedSources, getDeletedSourceByDomain]);

  const handleApplyRestoreFromTombstone = () => {
    if (!detectedTombstone) return;
    if (!name.trim()) {
      setName(detectedTombstone.name);
    }
    setCustomIdToRestore(detectedTombstone.id);
    notify(
      'info',
      'Historical Identity Applied',
      `Restoring "${detectedTombstone.name}" will preserve its original ID (${detectedTombstone.id}) and all historical articles.`
    );
  };

  const handleDeleteSource = async (reason?: string) => {
    if (!sourceToEdit) return;
    await deleteSource(sourceToEdit.id, reason);
    setIsDeleteModalOpen(false);
    onClose();
  };

  if (!isOpen) return null;

  // Real Server-Side URL inspection with safe protocol normalization & bounded timeout
  const handleInspectUrl = async () => {
    const raw = websiteUrl.trim();
    if (!raw) {
      setFormError('Please enter a website URL first.');
      return;
    }

    const cleanUrl = ensureHttpProtocol(raw);
    setWebsiteUrl(cleanUrl);

    try {
      setIsInspecting(true);
      setFormError(null);
      setDiscoveryNotice(null);
      setDiscoveredCandidates([]);
      setSelectedCandidateUrls(new Set());

      const result = await withTimeout(
        feedDiscoveryService.inspectWebsite(cleanUrl),
        15000,
        'Feed discovery timed out after 15s. You can enter feed URLs manually or configure later.'
      );

      // Populate suggested source name if blank
      if (!name && result.suggestedName) {
        setName(result.suggestedName);
      }

      setDiscoveryNotice(result.notice);
      const candidates = result.candidates || [];
      setDiscoveredCandidates(candidates);
      if (result.diagnostics) {
        setDiagnosticsInfo(result.diagnostics);
      }

      // If exactly ONE valid feed is discovered, pre-select it for convenience
      if (candidates.length === 1) {
        setSelectedCandidateUrls(new Set([candidates[0].url]));
        addCandidateToDraftFeeds(candidates[0], true);
      }

      // Auto-detect Greek market heuristics if domain ends in .gr
      if (cleanUrl.toLowerCase().includes('.gr')) {
        setCountry('Greece');
        setMarket('Greece');
        setLanguage('el');
        const greekGroup = sourceGroups.find(
          (g) => g.id === 'group-greek' || g.name.toLowerCase().includes('greek')
        );
        if (greekGroup) setSourceGroupId(greekGroup.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Feed discovery failed.';
      setFormError(msg);
    } finally {
      setIsInspecting(false);
    }
  };

  const addCandidateToDraftFeeds = (candidate: FeedCandidate, isPrimary = false) => {
    const normUrl = normalizeFeedUrl(candidate.url);
    setDraftFeeds((prev) => {
      // Check if feed already added
      if (prev.some((f) => normalizeFeedUrl(f.url) === normUrl)) {
        return prev;
      }

      const feedId = `feed-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const hasAnyPrimary = prev.some((f) => f.isPrimary);
      const shouldBePrimary = isPrimary || (!hasAnyPrimary && prev.length === 0);

      const categories: string[] = [];
      if (candidate.category) {
        categories.push(candidate.category);
      }

      const newFeed: DraftFeedItem = {
        id: feedId,
        title: candidate.title || 'Syndication Feed',
        url: normUrl,
        feedType: candidate.type || 'RSS',
        categories,
        status: 'ACTIVE',
        coverageRole: candidate.coverageRole || (shouldBePrimary ? 'PRIMARY_COVERAGE' : 'CATEGORY'),
        isPrimary: shouldBePrimary,
        entryCount: candidate.entryCount,
        detectedCategory: candidate.category,
      };

      return [...prev, newFeed];
    });
  };

  const removeCandidateFromDraftFeeds = (candidateUrl: string) => {
    const normUrl = normalizeFeedUrl(candidateUrl);
    setDraftFeeds((prev) => {
      const remaining = prev.filter((f) => normalizeFeedUrl(f.url) !== normUrl);
      if (remaining.length > 0 && !remaining.some((f) => f.isPrimary)) {
        remaining[0].isPrimary = true;
      }
      return remaining;
    });
  };

  const toggleCandidateSelection = (candidate: FeedCandidate) => {
    const normUrl = normalizeFeedUrl(candidate.url);
    const nextSelected = new Set(selectedCandidateUrls);

    if (nextSelected.has(candidate.url) || nextSelected.has(normUrl)) {
      nextSelected.delete(candidate.url);
      nextSelected.delete(normUrl);
      setSelectedCandidateUrls(nextSelected);
      removeCandidateFromDraftFeeds(candidate.url);
    } else {
      nextSelected.add(candidate.url);
      setSelectedCandidateUrls(nextSelected);
      addCandidateToDraftFeeds(candidate);
    }
  };

  const handleSetPrimaryDraftFeed = (feedId: string) => {
    setDraftFeeds((prev) =>
      prev.map((f) => ({
        ...f,
        isPrimary: f.id === feedId,
      }))
    );
  };

  const handleToggleFeedStatus = (feedId: string) => {
    setDraftFeeds((prev) =>
      prev.map((f) => {
        if (f.id === feedId) {
          const nextStatus: FeedStatus = f.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
          return { ...f, status: nextStatus };
        }
        return f;
      })
    );
  };

  const handleRemoveDraftFeed = (feedId: string) => {
    setDraftFeeds((prev) => {
      const remaining = prev.filter((f) => f.id !== feedId);
      if (remaining.length > 0 && !remaining.some((f) => f.isPrimary)) {
        remaining[0].isPrimary = true;
      }
      return remaining;
    });
  };

  const handleFeedCategoryChange = (feedId: string, value: string) => {
    const categories = value
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    setDraftFeeds((prev) =>
      prev.map((f) => (f.id === feedId ? { ...f, categories } : f))
    );
  };

  // Validate and Add Manual Feed
  const handleValidateAndAddManualFeed = async () => {
    setManualValidationError(null);
    const raw = manualFeedUrl.trim();
    if (!raw) {
      setManualValidationError('Please enter an RSS or Atom feed URL.');
      return;
    }

    const normUrl = normalizeFeedUrl(raw);
    // Duplicate check within draft feeds
    if (draftFeeds.some((f) => normalizeFeedUrl(f.url) === normUrl)) {
      setManualValidationError('This feed URL is already added to this source.');
      return;
    }

    try {
      setIsValidatingManual(true);
      const valResult = await feedDiscoveryService.validateFeedUrl(normUrl);

      if (!valResult.valid) {
        setManualValidationError(valResult.error || 'Feed URL validation failed. Endpoint did not return valid XML.');
        return;
      }

      const candidate = valResult.candidate;
      const title = manualFeedTitle.trim() || candidate?.title || 'Manual Feed';
      const categories = manualFeedCategories
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      const hasPrimary = draftFeeds.some((f) => f.isPrimary);
      const newFeed: DraftFeedItem = {
        id: `feed-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        title,
        url: normUrl,
        feedType: candidate?.type || manualFeedType,
        categories,
        status: 'ACTIVE',
        isPrimary: !hasPrimary,
        entryCount: candidate?.entryCount,
      };

      setDraftFeeds((prev) => [...prev, newFeed]);
      setManualFeedUrl('');
      setManualFeedTitle('');
      setManualFeedCategories('');
      setShowManualFeedForm(false);
      notify('success', 'Feed Validated & Added', `"${title}" added with ${candidate?.entryCount || 0} items.`);
    } catch (err: unknown) {
      setManualValidationError(err instanceof Error ? err.message : 'Feed validation failed.');
    } finally {
      setIsValidatingManual(false);
    }
  };

  const handleWebsiteUrlChange = (value: string) => {
    setWebsiteUrl(value);
    const lower = value.toLowerCase();
    if (lower.includes('.gr') || lower.endsWith('.gr') || lower.includes('.gr/')) {
      if (market === 'Global') setMarket('Greece');
      if (country === 'Global') setCountry('Greece');
      if (language === 'en') setLanguage('el');
      const greekGroup = sourceGroups.find(
        (g) => g.id === 'group-greek' || g.name.toLowerCase().includes('greek')
      );
      if (greekGroup && (!sourceGroupId || sourceGroupId === sourceGroups[0]?.id)) {
        setSourceGroupId(greekGroup.id);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const rawUrl = websiteUrl.trim();
    if (!rawUrl) {
      setFormError('Website URL is required.');
      return;
    }

    const cleanUrl = ensureHttpProtocol(rawUrl);
    try {
      new URL(cleanUrl);
    } catch {
      setFormError('Please enter a valid URL (e.g. insomnia.gr or https://insomnia.gr)');
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('Source name is required.');
      return;
    }

    // 1. Duplicate Domain Check
    const domain = extractNormalizedDomain(cleanUrl);
    const duplicate = sources.find(
      (s) =>
        (!isEditing || s.id !== sourceToEdit?.id) &&
        (extractNormalizedDomain(s.websiteUrl) === domain || s.normalizedDomain === domain)
    );

    if (duplicate) {
      setFormError(
        `Source already exists: A source with domain "${domain}" is already registered as "${duplicate.name}".`
      );
      return;
    }

    // 2. Source Group Validation
    const selectedGroup = sourceGroups.find((g) => g.id === sourceGroupId);
    if (!selectedGroup) {
      if (sourceGroups.length === 0) {
        setFormError('No source groups available in Firestore. Please create a source group first.');
      } else {
        setFormError('Selected Source Group is invalid. Please select an existing group.');
      }
      return;
    }

    // 3. Parse Source-Level Categories
    const sourceCategories = sourceCategoriesInput
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    // 4. Validate Draft Feeds
    const seenUrls = new Set<string>();
    for (const f of draftFeeds) {
      const norm = normalizeFeedUrl(f.url);
      if (seenUrls.has(norm)) {
        setFormError(`Duplicate feed URL found within this source: "${f.url}"`);
        return;
      }
      seenUrls.add(norm);
    }

    // Ensure primary feed selection
    let validatedFeeds: SourceFeed[] = draftFeeds.map((f, idx) => {
      const now = new Date().toISOString();
      return {
        id: f.id,
        title: f.title.trim() || 'Feed',
        url: normalizeFeedUrl(f.url),
        feedType: f.feedType || 'RSS',
        categories: f.categories || [],
        status: f.status || 'ACTIVE',
        isPrimary: f.isPrimary || (idx === 0 && !draftFeeds.some((d) => d.isPrimary)),
        createdAt: f.createdAt || now,
        updatedAt: now,
        lastCollectedAt: f.lastCollectedAt || null,
        lastSuccessfulCollectionAt: f.lastSuccessfulCollectionAt || null,
        failureCount: f.failureCount || 0,
        articlesCollected: f.articlesCollected || 0,
        lastError: f.lastError || null,
      };
    });

    // Make sure exactly one isPrimary if feeds exist
    if (validatedFeeds.length > 0 && !validatedFeeds.some((f) => f.isPrimary)) {
      validatedFeeds[0].isPrimary = true;
    }

    // Determine initial status & health
    let initialStatus = status;
    if (validatedFeeds.length === 0) {
      initialStatus = 'NEEDS_CONFIGURATION';
    }
    const computedHealth = computeSourceHealth(validatedFeeds, initialStatus);
    const primaryFeed = validatedFeeds.find((f) => f.isPrimary) || validatedFeeds[0];

    try {
      setIsSubmitting(true);

      const sourcePayload = {
        name: cleanName,
        websiteUrl: cleanUrl,
        normalizedDomain: domain,
        feeds: validatedFeeds,
        health: computedHealth,
        feedUrl: primaryFeed?.url || undefined,
        feedType: primaryFeed?.feedType || 'RSS',
        collectionMethod: primaryFeed?.feedType || 'RSS',
        sourceGroupId: selectedGroup.id,
        sourceGroup: selectedGroup.name,
        logoUrl: logoUrl.trim() || undefined,
        country,
        market,
        language,
        categories: sourceCategories,
        status: initialStatus,
      };

      if (isEditing && sourceToEdit) {
        await withTimeout(
          updateSource(sourceToEdit.id, sourcePayload),
          15000,
          'Timed out saving source changes to Firestore. Please check your network connection.'
        );
      } else {
        await withTimeout(
          createSource({
            ...sourcePayload,
            ...(customIdToRestore ? { customId: customIdToRestore } : {}),
          }),
          15000,
          'Timed out saving source to Firestore. Please check your network connection.'
        );
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save source.';
      console.error('[AddEditSourceModal] Save error:', err);
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div
        className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Rss className="w-4 h-4 text-indigo-400" />
              {isEditing ? 'Edit Source Configuration' : 'Register News Source'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              One publication / domain with multiple RSS / Atom feeds. Explicit feed selection prevents duplicate sources.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-md hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6">
          {formError && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* STEP 1: Website URL & Real Discovery */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Step 1: Website URL <span className="text-rose-400">*</span>
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                Domain-level duplicate prevention active
              </span>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Globe className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => handleWebsiteUrlChange(e.target.value)}
                  placeholder="https://www.insomnia.gr or verge.com"
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                  required
                />
              </div>
              <button
                type="button"
                onClick={handleInspectUrl}
                disabled={isInspecting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50 shrink-0 shadow-xs"
                title="Perform server-side HTML scraping and candidate detection"
              >
                {isInspecting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>{isInspecting ? 'Discovering...' : 'Discover Feeds'}</span>
              </button>
            </div>

            {/* Previously Removed / Tombstone Notice (Requirement 7) */}
            {detectedTombstone && !isEditing && (
              <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-xs space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-300 font-semibold">
                    <RotateCcw className="w-4 h-4 text-indigo-400" />
                    <span>This source was previously removed</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-500/30">
                    ID: {detectedTombstone.id}
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  <strong>"{detectedTombstone.name}"</strong> ({detectedTombstone.normalizedDomain}) was removed on{' '}
                  {new Date(detectedTombstone.deletedAt).toLocaleDateString()}.{' '}
                  {detectedTombstone.articleCount > 0 && (
                    <span className="text-emerald-300 font-medium">
                      {detectedTombstone.articleCount} historical articles and AI intelligence remain preserved in Signalyn.{' '}
                    </span>
                  )}
                  Re-registering allows you to restore this publication and seamlessly unify it with its historical data without duplicate articles.
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={handleApplyRestoreFromTombstone}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                      customIdToRestore === detectedTombstone.id
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs'
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>
                      {customIdToRestore === detectedTombstone.id
                        ? 'Historical Identity Applied'
                        : 'Restore Previous Publication'}
                    </span>
                  </button>
                  {customIdToRestore === detectedTombstone.id && (
                    <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Ready to re-register with ID {detectedTombstone.id}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Discovery Diagnostics & Feedback */}
          {discoveryNotice && (
            <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 space-y-2 text-xs text-indigo-200">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
                <div>
                  <p className="font-semibold text-indigo-300">Feed Discovery Results</p>
                  <p className="text-indigo-200/90 text-[11px]">{discoveryNotice}</p>
                </div>
              </div>
              {diagnosticsInfo && (
                <div className="pt-2 border-t border-indigo-900/50 flex flex-wrap gap-4 font-mono text-[10px] text-indigo-300/80">
                  <span>HTML Alternate Links: {diagnosticsInfo.htmlLinkTagsFound}</span>
                  <span>Probed Endpoints: {diagnosticsInfo.endpointsProbed}</span>
                  <span>Response Time: {diagnosticsInfo.responseTimeMs}ms</span>
                </div>
              )}
            </div>
          )}

          {/* STEP 2 & 3: Discovered Candidates Panel (Multi-Select) */}
          {discoveredCandidates.length > 0 && (
            <div className="space-y-2.5 p-4 rounded-xl bg-slate-950/80 border border-indigo-900/50">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300 block">
                    Step 2: Discovered Feeds ({discoveredCandidates.length} Candidates)
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Explicitly select the feeds you wish to enable for this publication. Unselected feeds will not be ingested.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      discoveredCandidates.forEach((c) => {
                        if (!draftFeeds.some((f) => normalizeFeedUrl(f.url) === normalizeFeedUrl(c.url))) {
                          addCandidateToDraftFeeds(c);
                        }
                      });
                      setSelectedCandidateUrls(new Set(discoveredCandidates.map((c) => c.url)));
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      discoveredCandidates.forEach((c) => removeCandidateFromDraftFeeds(c.url));
                      setSelectedCandidateUrls(new Set());
                    }}
                    className="text-[11px] text-slate-400 hover:text-slate-300 underline font-medium"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {discoveredCandidates.map((candidate) => {
                  const normCandidateUrl = normalizeFeedUrl(candidate.url);
                  const isChecked = draftFeeds.some(
                    (f) => normalizeFeedUrl(f.url) === normCandidateUrl
                  );

                  return (
                    <div
                      key={candidate.url}
                      onClick={() => toggleCandidateSelection(candidate)}
                      className={`p-3 rounded-lg border text-xs cursor-pointer flex items-center justify-between gap-3 transition ${
                        isChecked
                          ? 'bg-indigo-950/60 border-indigo-500/70 shadow-xs ring-1 ring-indigo-500/30'
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by parent onClick
                          className="mt-0.5 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-950 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-100">{candidate.title}</span>
                            <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-800 text-indigo-300 border border-slate-700">
                              {candidate.type}
                            </span>
                            {candidate.entryCount !== undefined && (
                              <span className="text-[11px] font-mono text-emerald-400">
                                {candidate.entryCount} items
                              </span>
                            )}
                            {candidate.category && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-900/40 text-indigo-300 border border-indigo-800/60">
                                Topic: {candidate.category}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                            {candidate.url}
                          </div>
                          {candidate.sampleArticleTitle && (
                            <div className="text-[11px] text-slate-400 italic truncate mt-0.5">
                              Sample: {candidate.sampleArticleTitle}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {isChecked ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            <Check className="w-3 h-3" /> Enabled
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 hover:text-indigo-300">
                            Click to Enable
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Configured Feeds Section (Editable Categories, Primary, Status, Removal) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Step 3: Configured Feeds for this Publication ({draftFeeds.length})
                </label>
                <p className="text-[11px] text-slate-400">
                  Assign primary feed and feed-specific categories. Feeds can be paused or customized.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowManualFeedForm(!showManualFeedForm)}
                className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showManualFeedForm ? 'Close Manual Feed' : 'Add Feed Manually'}</span>
              </button>
            </div>

            {/* Manual Feed Entry Form */}
            {showManualFeedForm && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-700/80 space-y-3 animate-in fade-in duration-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Add Feed Manually (Validated before enabling)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowManualFeedForm(false)}
                    className="text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Cancel
                  </button>
                </div>

                {manualValidationError && (
                  <div className="p-2.5 rounded bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <span>{manualValidationError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-medium">Feed URL *</label>
                    <input
                      type="text"
                      value={manualFeedUrl}
                      onChange={(e) => setManualFeedUrl(e.target.value)}
                      placeholder="https://example.com/rss/custom.xml"
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-medium">Feed Title</label>
                    <input
                      type="text"
                      value={manualFeedTitle}
                      onChange={(e) => setManualFeedTitle(e.target.value)}
                      placeholder="e.g. Smartphones & Hardware"
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-medium">Feed Categories (comma-separated)</label>
                    <input
                      type="text"
                      value={manualFeedCategories}
                      onChange={(e) => setManualFeedCategories(e.target.value)}
                      placeholder="Smartphones, Hardware"
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-medium">Protocol</label>
                    <select
                      value={manualFeedType}
                      onChange={(e) => setManualFeedType(e.target.value as CollectionMethod)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="RSS">RSS</option>
                      <option value="ATOM">ATOM</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleValidateAndAddManualFeed}
                    disabled={isValidatingManual || !manualFeedUrl.trim()}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    {isValidatingManual ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>{isValidatingManual ? 'Validating Endpoint...' : 'Validate & Add Feed'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* List of configured draft feeds */}
            {draftFeeds.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center space-y-2">
                <Rss className="w-6 h-6 text-slate-600 mx-auto" />
                <p className="text-xs font-medium text-slate-300">No feeds configured yet</p>
                <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                  Click <strong>Discover Feeds</strong> above, or add a manual RSS/Atom feed URL. You can also save the publication now and configure feeds later (status will be <em>NEEDS_CONFIGURATION</em>).
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {draftFeeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleSetPrimaryDraftFeed(feed.id)}
                          className={`p-1 rounded transition ${
                            feed.isPrimary
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-slate-600 hover:text-slate-400'
                          }`}
                          title={feed.isPrimary ? 'Primary Feed' : 'Set as Primary Feed'}
                        >
                          <Star className={`w-4 h-4 ${feed.isPrimary ? 'fill-current' : ''}`} />
                        </button>
                        <span className="font-semibold text-slate-200 text-xs truncate">
                          {feed.title}
                        </span>
                        {feed.isPrimary && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            PRIMARY
                          </span>
                        )}
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-indigo-300">
                          {feed.feedType}
                        </span>
                        {feed.entryCount !== undefined && (
                          <span className="text-[10px] font-mono text-emerald-400">
                            ({feed.entryCount} items)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleFeedStatus(feed.id)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border transition ${
                            feed.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          {feed.status}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveDraftFeed(feed.id)}
                          className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-900 transition"
                          title="Remove feed from publication"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="font-mono text-[10px] text-slate-400 break-all bg-slate-900/60 p-1.5 rounded border border-slate-800/80">
                      {feed.url}
                    </div>

                    {/* Feed-Level Categories */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-900">
                      <Tag className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                        Feed Categories:
                      </span>
                      <input
                        type="text"
                        value={feed.categories.join(', ')}
                        onChange={(e) => handleFeedCategoryChange(feed.id, e.target.value)}
                        placeholder="e.g. Smartphones, Hardware"
                        className="flex-1 px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* STEP 4: Configure Source Metadata */}
          <div className="space-y-4 pt-2 border-t border-slate-800">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Step 4: Publication Metadata
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Publication Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Insomnia or GSMArena"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Source Group <span className="text-rose-400">*</span>
                </label>
                <select
                  value={sourceGroupId}
                  onChange={(e) => setSourceGroupId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                >
                  {sourceGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Market Region
                </label>
                <select
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  {COMMON_MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  {COMMON_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Initial Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SourceStatus)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PAUSED">PAUSED</option>
                  <option value="NEEDS_CONFIGURATION">NEEDS CONFIGURATION</option>
                </select>
              </div>
            </div>

            {/* Source-Level Publication Categories */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Publication-Level Categories (comma-separated)
              </label>
              <input
                type="text"
                value={sourceCategoriesInput}
                onChange={(e) => setSourceCategoriesInput(e.target.value)}
                placeholder="Technology, Hardware, Telecom, Greece"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[11px] text-slate-400">
                Source categories represent the publication overall, distinct from feed-specific categories.
              </p>
            </div>
          </div>

          {/* Footer Actions (Step 5: Save) */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <div className="flex items-center gap-3">
              {isEditing && sourceToEdit && (
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-rose-100 border border-rose-800/60 rounded-lg text-xs font-medium transition"
                  title="Permanently remove this publication configuration"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Delete Source</span>
                </button>
              )}
              <span className="text-[11px] font-mono text-slate-400">
                {draftFeeds.length > 0
                  ? `${draftFeeds.length} feed(s) configured (${draftFeeds.filter((f) => f.status === 'ACTIVE').length} active)`
                  : 'Zero feeds configured (will save as NEEDS_CONFIGURATION)'}
              </span>
            </div>

            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg shadow-sm transition flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>
                  {isSubmitting
                    ? 'Saving to Firestore...'
                    : isEditing
                    ? 'Save Changes'
                    : customIdToRestore
                    ? 'Restore & Register Source'
                    : 'Register Source'}
                </span>
              </button>
            </div>
          </div>
        </form>

        {/* Safe Source Deletion Modal (Requirements 1, 2, 3, 4, 12, 13) */}
        <SafeDeleteSourceModal
          isOpen={isDeleteModalOpen}
          source={sourceToEdit || null}
          onConfirm={handleDeleteSource}
          onCancel={() => setIsDeleteModalOpen(false)}
        />
      </div>
    </div>
  );
};

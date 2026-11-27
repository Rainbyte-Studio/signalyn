import React, { useState, useEffect, useMemo } from 'react';
import {
  Store,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  Save,
  Play,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Globe,
  Clock,
  Sliders,
  Lock,
  Wifi,
  ChevronDown,
  ChevronUp,
  Info,
  Check,
  RefreshCw,
  Search,
  Eye,
  Compass,
  Calendar,
  Zap,
  X,
  Tag,
  SlidersHorizontal,
  Layers,
} from 'lucide-react';
import {
  RetailSource,
  RetailSourceId,
  RetailCategory,
  RetailCategoryEndpointConfig,
  RetailSourceDiagnosticResult,
  RetailDiscoveryJob,
  RetailScheduleConfig,
  DiscoveredProductItem,
} from '../../types/retailPrice';
import { getAuthorizedApiHeaders } from '../../services/apiSessionClient';
import { useApp } from '../../context/AppContext';
import {
  resolveRetailerOperationalStatus,
  resolveRetailSourceDiscoveredCount,
  resolveRetailerEffectiveExtractionStrategy,
  classifyRetailerHistoricalNotes,
} from '../../utils/dataIntegrityContracts';

const CATEGORY_LABELS: Record<RetailCategory, { name: string; tag: string; isRef?: boolean }> = {
  WEARABLES: { name: 'Watches & Wearables', tag: 'Verified Reference Category', isRef: true },
  SMARTPHONES: { name: 'Smartphones', tag: 'Flagship & Mid-range' },
  AUDIO: { name: 'Audio Devices', tag: 'True Wireless & Over-Ear' },
  TABLETS: { name: 'Tablets & Pads', tag: 'Productivity & Media' },
};

const ORDERED_CATEGORIES: RetailCategory[] = ['WEARABLES', 'SMARTPHONES', 'AUDIO', 'TABLETS'];

export const RetailSourcesSettings: React.FC = () => {
  const { canManage, notify } = useApp();

  const [sources, setSources] = useState<RetailSource[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<RetailSourceId>('plaisio-gr');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingCategory, setTestingCategory] = useState<RetailCategory | null>(null);
  const [activeDiagnostic, setActiveDiagnostic] = useState<RetailSourceDiagnosticResult | null>(null);
  const [isRawDetailsOpen, setIsRawDetailsOpen] = useState(false);

  // Editable local state per retailer
  const [editedSources, setEditedSources] = useState<Record<RetailSourceId, RetailSource>>({} as any);

  // Discovery Engine State (P1.0 / P1.2)
  const [activeDiscoveryJob, setActiveDiscoveryJob] = useState<RetailDiscoveryJob | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryStepProgress, setDiscoveryStepProgress] = useState<string | null>(null);
  const [discoveryStrategy, setDiscoveryStrategy] = useState<'AUTO' | 'STATIC_FETCH' | 'DYNAMIC_STATE' | 'BROWSER_AUTOMATION'>('AUTO');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewFilter, setPreviewFilter] = useState('');

  // Daily Scheduling Governance State (P1.0 Requirement 9)
  const [scheduleConfig, setScheduleConfig] = useState<RetailScheduleConfig | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [scheduleApprovalChecked, setScheduleApprovalChecked] = useState(false);

  // Fetch configs from backend
  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/retail/sources/config');
      if (res.ok) {
        const data = await res.json();
        const srcList: RetailSource[] = data.sources || [];
        setSources(srcList);

        const editMap: Record<RetailSourceId, RetailSource> = {} as any;
        srcList.forEach((s) => {
          editMap[s.id] = JSON.parse(JSON.stringify(s));
        });
        setEditedSources(editMap);

        const current = srcList.find((s) => s.id === selectedRetailerId);
        if (current?.lastDiagnostic) {
          setActiveDiagnostic(current.lastDiagnostic);
        }
      }
    } catch (err) {
      console.error('[RetailSourcesSettings] Failed to fetch sources config:', err);
      notify('warning', 'Error loading sources', 'Could not retrieve retailer configurations from backend.');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch latest discovery job for active retailer
  const fetchLatestJob = async (rId: RetailSourceId) => {
    try {
      const res = await fetch(`/api/retail/discovery/latest/${rId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.job) {
          setActiveDiscoveryJob(data.job);
        }
      }
    } catch (err) {
      console.warn('[RetailSourcesSettings] Failed to load latest discovery job:', err);
    }
  };

  // Fetch schedule configuration
  const fetchSchedule = async () => {
    try {
      const res = await fetch('/api/retail/schedule');
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setScheduleConfig(data.config);
          setScheduleApprovalChecked(data.config.approvedByAdmin || false);
        }
      }
    } catch (err) {
      console.warn('[RetailSourcesSettings] Failed to load schedule config:', err);
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchLatestJob(selectedRetailerId);
    fetchSchedule();
  }, []);

  const currentSource = editedSources[selectedRetailerId];
  const originalSource = sources.find((s) => s.id === selectedRetailerId);

  // Check if current retailer has unsaved changes
  const isDirty = useMemo(() => {
    if (!currentSource || !originalSource) return false;
    return JSON.stringify(currentSource) !== JSON.stringify(originalSource);
  }, [currentSource, originalSource]);

  // Handle retailer tab change
  const handleSelectRetailer = (id: RetailSourceId) => {
    setSelectedRetailerId(id);
    const src = sources.find((s) => s.id === id);
    if (src?.lastDiagnostic) {
      setActiveDiagnostic(src.lastDiagnostic);
    } else {
      setActiveDiagnostic(null);
    }
    fetchLatestJob(id);
  };

  // Modify local field
  const handleUpdateCurrent = (updates: Partial<RetailSource>) => {
    setEditedSources((prev) => ({
      ...prev,
      [selectedRetailerId]: {
        ...prev[selectedRetailerId],
        ...updates,
      },
    }));
  };

  // Modify local category URL
  const handleUpdateCategory = (
    category: RetailCategory,
    updates: Partial<NonNullable<RetailSource['categoryEndpoints']>[RetailCategory]>
  ) => {
    const endpoints = { ...(currentSource.categoryEndpoints || {}) } as Record<RetailCategory, RetailCategoryEndpointConfig>;
    endpoints[category] = {
      ...endpoints[category],
      ...updates,
    };

    handleUpdateCurrent({ categoryEndpoints: endpoints });
  };

  // Client-side URL format check
  const getUrlError = (category: RetailCategory): string | null => {
    const url = currentSource?.categoryEndpoints?.[category]?.url;
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return 'Must use secure HTTPS protocol.';
      const hostname = parsed.hostname.toLowerCase();
      const meta = currentSource.domain || '';
      if (!hostname.includes(meta.replace('www.', '')) && !hostname.includes(currentSource.id.split('-')[0])) {
        return `Domain does not match ${currentSource.name}.`;
      }
    } catch {
      return 'Malformed URL syntax.';
    }
    return null;
  };

  // Helper to perform authenticated fetch with automatic token refresh on 401
  const authorizedFetch = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = await getAuthorizedApiHeaders(false);
    let res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      const refreshedHeaders = await getAuthorizedApiHeaders(true);
      res = await fetch(url, { ...init, headers: refreshedHeaders });
    }
    return res;
  };

  // Save current retailer configuration to Firestore
  const handleSave = async () => {
    if (!canManage || !isDirty) return;

    for (const cat of ORDERED_CATEGORIES) {
      const err = getUrlError(cat);
      if (err) {
        notify('warning', 'Invalid Category URL', `Category ${CATEGORY_LABELS[cat].name}: ${err}`);
        return;
      }
    }

    // Check if any manually configured VALID_CATEGORY URL is being overwritten
    let confirmOverwriteValidUrl = false;
    for (const cat of ORDERED_CATEGORIES) {
      const origEp = originalSource?.categoryEndpoints?.[cat];
      const newEp = currentSource?.categoryEndpoints?.[cat];
      if (
        origEp?.isManuallyConfigured &&
        origEp?.validationStatus === 'VALID_CATEGORY' &&
        newEp?.url &&
        newEp.url.trim() !== origEp.url.trim()
      ) {
        const confirmed = confirm(
          `Category "${CATEGORY_LABELS[cat].name}" currently has a manually configured VALID_CATEGORY URL:\n${origEp.url}\n\nAre you sure you want to overwrite it with:\n${newEp.url}?`
        );
        if (!confirmed) {
          return;
        }
        confirmOverwriteValidUrl = true;
      }
    }

    setIsSaving(true);
    try {
      const res = await authorizedFetch(`/api/retail/sources/${selectedRetailerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...currentSource,
          confirmOverwriteValidUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      notify('success', 'Configuration Saved', `${currentSource.name} configuration updated and persisted to Firestore.`);
      await fetchConfigs();
    } catch (err) {
      console.error('[RetailSourcesSettings] Save error:', err);
      notify('warning', 'Save Failed', err instanceof Error ? err.message : 'Error updating retailer config');
    } finally {
      setIsSaving(false);
    }
  };

  // Discard local changes
  const handleDiscard = () => {
    if (!originalSource) return;
    setEditedSources((prev) => ({
      ...prev,
      [selectedRetailerId]: JSON.parse(JSON.stringify(originalSource)),
    }));
    notify('info', 'Changes Discarded', 'Restored saved configuration.');
  };

  // Reset to verified defaults
  const handleResetDefaults = async () => {
    if (!canManage || !confirm(`Reset ${currentSource?.name} configuration and category URLs to verified defaults?`)) {
      return;
    }

    setIsSaving(true);
    try {
      const res = await authorizedFetch(`/api/retail/sources/${selectedRetailerId}/reset`, {
        method: 'POST',
        body: JSON.stringify({ confirmOverwriteValidUrl: true }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to reset defaults');
      }

      notify('success', 'Defaults Restored', `${currentSource?.name} category URLs and settings restored to verified defaults.`);
      await fetchConfigs();
    } catch (err) {
      console.error('[RetailSourcesSettings] Reset error:', err);
      notify('warning', 'Reset Failed', err instanceof Error ? err.message : 'Error restoring defaults');
    } finally {
      setIsSaving(false);
    }
  };

  // Run bounded connectivity diagnostic
  const handleTestConnection = async (category?: RetailCategory) => {
    if (!canManage) return;

    if (category) {
      setTestingCategory(category);
    } else {
      setIsTesting(true);
    }

    try {
      const bodyPayload: any = {};
      if (category) {
        bodyPayload.category = category;
        const currentUrl = currentSource?.categoryEndpoints?.[category]?.url;
        if (currentUrl) bodyPayload.customUrl = currentUrl;
      }

      const res = await authorizedFetch(`/api/retail/sources/${selectedRetailerId}/test`, {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Connectivity diagnostic failed');
      }

      const diag: RetailSourceDiagnosticResult = data.diagnostic;
      setActiveDiagnostic(diag);
      await fetchConfigs();

      const valStatus = diag.validationStatus || (
        diag.accessStatus === 'LIVE_VERIFIED' && diag.productsDetected > 0
          ? 'VALID_CATEGORY'
          : diag.accessStatus === 'ACCESS_BLOCKED'
          ? 'ACCESS_BLOCKED'
          : 'UNVERIFIED'
      );

      if (valStatus === 'VALID_CATEGORY') {
        notify(
          'success',
          'Valid Category Verified (VALID_CATEGORY)',
          `HTTP ${diag.httpStatus}: Verified ${diag.productsDetected} product items (${diag.categoryMatchCount ?? diag.productsDetected} matching category).`
        );
      } else if (valStatus === 'ACCESS_BLOCKED') {
        notify(
          'warning',
          'Perimeter Access Blocked (ACCESS_BLOCKED)',
          `${currentSource?.name} returned HTTP ${diag.httpStatus || 403}. Perimeter Edge WAF blocked datacenter IP.`
        );
      } else if (valStatus === 'INVALID_CATEGORY') {
        notify(
          'warning',
          'Invalid Category Page (INVALID_CATEGORY)',
          diag.validationEvidence || diag.diagnosticDetails || `URL did not resolve to a valid product listing for ${category || currentSource?.name}.`
        );
      } else {
        notify(
          'info',
          'Category Unverified (UNVERIFIED)',
          diag.validationEvidence || `HTTP ${diag.httpStatus || 'Timeout'}: 0 verifiable category products extracted. Left UNVERIFIED for review.`
        );
      }
    } catch (err) {
      console.error('[RetailSourcesSettings] Diagnostic error:', err);
      notify('warning', 'Diagnostic Error', err instanceof Error ? err.message : 'Error running connectivity diagnostic');
    } finally {
      setIsTesting(false);
      setTestingCategory(null);
    }
  };

  // Execute Autonomous Product Discovery Job (P1.0)
  const handleStartDiscovery = async () => {
    if (!canManage) return;

    setIsDiscovering(true);
    setDiscoveryStepProgress('Initializing crawler job...');

    try {
      const startRes = await authorizedFetch('/api/retail/discovery/start', {
        method: 'POST',
        body: JSON.stringify({
          retailerId: selectedRetailerId,
          maxPages: currentSource.defaultMaxPages || 2,
          maxProducts: currentSource.defaultMaxProducts || 50,
          requestDelaySeconds: currentSource.requestDelaySeconds || 3,
          timeoutSeconds: currentSource.timeoutSeconds || 12,
          strategy: discoveryStrategy,
        }),
      });

      const startData = await startRes.json();
      if (!startRes.ok || !startData.success) {
        throw new Error(startData.error || 'Failed to start discovery job');
      }

      let job: RetailDiscoveryJob = startData.job;
      setActiveDiscoveryJob(job);

      // Execute batches sequentially within Cloud Run bounds
      while (job.status === 'QUEUED' || job.status === 'RUNNING') {
        setDiscoveryStepProgress(
          `Crawling category: ${CATEGORY_LABELS[job.progress.currentCategory || 'WEARABLES']?.name || job.progress.currentCategory} (Discovered: ${job.progress.productsDiscovered})...`
        );

        const stepRes = await authorizedFetch('/api/retail/discovery/step', {
          method: 'POST',
          body: JSON.stringify({ jobId: job.id }),
        });

        const stepData = await stepRes.json();
        if (!stepRes.ok || !stepData.success) {
          throw new Error(stepData.error || 'Discovery step execution failed');
        }

        job = stepData.job;
        setActiveDiscoveryJob({ ...job });
      }

      setDiscoveryStepProgress(null);
      await fetchConfigs();

      if (job.status === 'COMPLETED') {
        notify(
          'success',
          'Discovery Completed',
          `Traversed categories successfully. Discovered ${job.progress.productsDiscovered} products (${job.progress.productsCreated} new canonical products, ${job.progress.offersUpdated} offers updated).`
        );
      } else if (job.status === 'ACCESS_BLOCKED') {
        notify(
          'warning',
          'Perimeter Access Blocked',
          job.errorSummary || 'Perimeter WAF blocked automated collection for this retailer.'
        );
      } else {
        notify(
          'info',
          'Discovery Finished',
          `Job finished with status: ${job.status}. Discovered ${job.progress.productsDiscovered} products.`
        );
      }
    } catch (err) {
      console.error('[RetailSourcesSettings] Discovery error:', err);
      notify('warning', 'Discovery Failed', err instanceof Error ? err.message : 'Error executing product discovery');
    } finally {
      setIsDiscovering(false);
      setDiscoveryStepProgress(null);
    }
  };

  // Update Daily Schedule Configuration (P1.0 Requirement 9)
  const handleSaveSchedule = async () => {
    if (!canManage) return;

    setIsSavingSchedule(true);
    try {
      const res = await authorizedFetch('/api/retail/schedule', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: scheduleApprovalChecked,
          approvedByAdmin: scheduleApprovalChecked,
          targetRetailers: scheduleConfig?.targetRetailers || ['plaisio-gr'],
          maxPagesPerCategory: scheduleConfig?.maxPagesPerCategory || 2,
          maxProductsPerCategory: scheduleConfig?.maxProductsPerCategory || 50,
          requestDelaySeconds: scheduleConfig?.requestDelaySeconds || 3,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update schedule');
      }

      setScheduleConfig(data.config);
      notify(
        'success',
        'Schedule Updated',
        data.config.enabled
          ? 'Autonomous daily collection schedule activated (04:00 Athens Time).'
          : 'Schedule disabled (requires administrator approval).'
      );
    } catch (err) {
      console.error('[RetailSourcesSettings] Schedule save error:', err);
      notify('warning', 'Schedule Error', err instanceof Error ? err.message : 'Error saving schedule configuration');
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Filtered preview items
  const filteredPreview = useMemo(() => {
    if (!activeDiscoveryJob?.previewItems) return [];
    if (!previewFilter) return activeDiscoveryJob.previewItems;
    const q = previewFilter.toLowerCase();
    return activeDiscoveryJob.previewItems.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.retailerSku.includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [activeDiscoveryJob, previewFilter]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 space-y-3 bg-slate-900 border border-slate-800 rounded-xl">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-xs font-mono text-slate-400">Loading retail sources configurations from Firestore...</p>
      </div>
    );
  }

  if (!currentSource) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl">
        <p className="text-xs text-slate-400">No retail source configuration found.</p>
        <button
          onClick={fetchConfigs}
          className="mt-3 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium"
        >
          Retry Loading
        </button>
      </div>
    );
  }

  const getSourceEndpointProductTotal = (src: RetailSource): number => {
    return resolveRetailSourceDiscoveredCount(src);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-slate-100 tracking-tight">
              Retail Sources Management & Autonomous Crawling Engine
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
              PHASE P1.1
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Configure category URLs, verify product category listings, manage pagination limits, and run live connectivity diagnostics.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {sources.map((src) => {
            const isSelected = src.id === selectedRetailerId;
            const liveCount = getSourceEndpointProductTotal(src);
            const resolved = resolveRetailerOperationalStatus({
              source: src,
              liveOffersCount: liveCount,
              pilotOffersCount: src.id === 'public-gr' || src.id === 'kotsovolos-gr' ? 10 : 0,
            });
            const isSrcOperational = resolved.state === 'OPERATIONAL';
            const isSrcBlocked = resolved.state === 'WAF_BLOCKED';

            return (
              <button
                key={src.id}
                onClick={() => handleSelectRetailer(src.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800/60'
                }`}
              >
                <span>{src.name}</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSrcOperational
                      ? 'bg-emerald-400'
                      : isSrcBlocked
                      ? 'bg-rose-400'
                      : 'bg-amber-400'
                  }`}
                  title={`${resolved.badgeLabel} — ${resolved.detailText}`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Left Column Settings, Right Column Live Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols wide on desktop): Global Settings & Category Endpoints */}
        <div className="lg:col-span-2 space-y-6">
          {/* Retailer General Configuration Card */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
                  {currentSource.name} Configuration & Limits
                </h3>
              </div>

              {/* Retailer Enable/Disable Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono">Retailer Active:</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentSource.enabled ?? true}
                    disabled={!canManage}
                    onChange={(e) => handleUpdateCurrent({ enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 peer-disabled:opacity-60"></div>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Domain & Website */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
                  Retailer Domain
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200">
                    {currentSource.domain || currentSource.websiteUrl}
                  </div>
                  <a
                    href={currentSource.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
                    title="Open retailer website"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Default Max Pages */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Max Pages Per Category Run</span>
                  <span className="text-slate-500 font-mono text-[10px]">1 – 10 PAGES</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={currentSource.defaultMaxPages || 2}
                  disabled={!canManage}
                  onChange={(e) => handleUpdateCurrent({ defaultMaxPages: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                />
              </div>

              {/* Request Delay Seconds */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Rate Limiting Delay</span>
                  <span className="text-slate-500 font-mono text-[10px]">1 – 60 SECONDS</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={currentSource.requestDelaySeconds || 3}
                    disabled={!canManage}
                    onChange={(e) => handleUpdateCurrent({ requestDelaySeconds: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  />
                  <span className="absolute right-3 top-2 text-xs font-mono text-slate-400">sec</span>
                </div>
              </div>

              {/* Timeout Seconds */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Connection Timeout</span>
                  <span className="text-slate-500 font-mono text-[10px]">3 – 30 SECONDS</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={3}
                    max={30}
                    value={currentSource.timeoutSeconds || 10}
                    disabled={!canManage}
                    onChange={(e) => handleUpdateCurrent({ timeoutSeconds: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  />
                  <span className="absolute right-3 top-2 text-xs font-mono text-slate-400">sec</span>
                </div>
              </div>
            </div>

            {/* Custom Notes */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
                  Administrative Notes & Integration Conditions
                </label>
                <span className="text-[10px] font-mono text-slate-400">
                  Live Discovery:{' '}
                  <strong className="text-emerald-400">
                    {getSourceEndpointProductTotal(currentSource)} discovered
                  </strong>{' '}
                  • Strategy:{' '}
                  <strong className="text-indigo-300">
                    {resolveRetailerEffectiveExtractionStrategy(currentSource)}
                  </strong>
                </span>
              </div>
              <textarea
                rows={2}
                value={currentSource.customNotes || ''}
                disabled={!canManage}
                onChange={(e) => handleUpdateCurrent({ customNotes: e.target.value })}
                placeholder="Operational notes, partner API registration details..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60 resize-none font-sans"
              />
              {(() => {
                const histClass = classifyRetailerHistoricalNotes({
                  source: currentSource,
                  liveOffersCount: getSourceEndpointProductTotal(currentSource),
                });
                if (!histClass.historicalClarificationBanner) return null;
                return (
                  <p className="text-[11px] font-mono text-cyan-400">
                    {histClass.historicalClarificationBanner}
                  </p>
                );
              })()}
            </div>
          </div>

          {/* Strategic Category URLs & Crawler Discovery Toggles Card */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
                  Category URLs & Discovery Endpoints
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                {
                  resolveRetailerOperationalStatus({
                    source: currentSource,
                    liveOffersCount: getSourceEndpointProductTotal(currentSource),
                  }).categoryValidationSummaryLabel
                }
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Define the exact category discovery URLs for each strategic product vertical. A category URL is only marked <strong className="text-emerald-400 font-mono">VALID_CATEGORY</strong> when a probe confirms identifiable products belonging to the expected category. HTTP 200 alone without verifiable category products remains <strong className="text-slate-300 font-mono">UNVERIFIED</strong> or <strong className="text-amber-400 font-mono">INVALID_CATEGORY</strong>.
            </p>

            <div className="space-y-4 pt-1">
              {ORDERED_CATEGORIES.map((cat) => {
                const meta = CATEGORY_LABELS[cat];
                const config = currentSource.categoryEndpoints?.[cat] || {
                  category: cat,
                  enabled: true,
                  url: '',
                  defaultUrl: '',
                  status: 'UNVERIFIED',
                  validationStatus: 'UNVERIFIED',
                  autoDiscoveryEnabled: true,
                  maxPagesPerRun: 2,
                };

                const urlError = getUrlError(cat);
                const isTestingThis = testingCategory === cat;

                const valStatus =
                  config.validationStatus ||
                  (config.status === 'LIVE_VERIFIED' && (config.productsDetected ?? 0) > 0
                    ? 'VALID_CATEGORY'
                    : config.status === 'ACCESS_BLOCKED'
                    ? 'ACCESS_BLOCKED'
                    : config.status === 'INVALID' || config.status === 'INVALID_CATEGORY'
                    ? 'INVALID_CATEGORY'
                    : 'UNVERIFIED');

                const detectedCount = config.productsDetected ?? config.lastDiscoveredCount;

                return (
                  <div
                    key={cat}
                    className={`p-3.5 rounded-lg border transition ${
                      meta.isRef
                        ? 'bg-indigo-950/20 border-indigo-500/40'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.enabled}
                            disabled={!canManage}
                            onChange={(e) => handleUpdateCategory(cat, { enabled: e.target.checked })}
                            className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-xs font-semibold text-slate-200">{meta.name}</span>
                        </label>

                        {meta.isRef && (
                          <span className="text-[9px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded uppercase">
                            Reference Endpoint
                          </span>
                        )}

                        {config.isManuallyConfigured && (
                          <span className="text-[9px] font-mono bg-purple-500/15 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded uppercase">
                            Custom Configured
                          </span>
                        )}

                        <label className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-400 bg-cyan-950/30 border border-cyan-800/40 px-2 py-0.5 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.autoDiscoveryEnabled ?? true}
                            disabled={!canManage || !config.enabled}
                            onChange={(e) => handleUpdateCategory(cat, { autoDiscoveryEnabled: e.target.checked })}
                            className="rounded border-cyan-800 text-cyan-600"
                          />
                          <span>Auto-Discover</span>
                        </label>
                      </div>

                      {/* Validation Status & Products Detected Badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {valStatus === 'VALID_CATEGORY' ? (
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>VALID_CATEGORY</span>
                          </span>
                        ) : valStatus === 'ACCESS_BLOCKED' ? (
                          <span className="text-[10px] font-mono text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" />
                            <span>ACCESS_BLOCKED{config.lastHttpStatus ? ` (${config.lastHttpStatus})` : ' (403)'}</span>
                          </span>
                        ) : valStatus === 'INVALID_CATEGORY' ? (
                          <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            <span>INVALID_CATEGORY</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                            UNVERIFIED
                          </span>
                        )}

                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            detectedCount && detectedCount > 0
                              ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
                              : 'text-slate-500 bg-slate-900 border-slate-800'
                          }`}
                          title="Number of products detected on category page"
                        >
                          {detectedCount !== undefined ? `${detectedCount} products` : '0 products'}
                        </span>
                      </div>
                    </div>

                    {/* URL Input & Action Buttons */}
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={config.url}
                          disabled={!canManage || !config.enabled}
                          onChange={(e) => handleUpdateCategory(cat, { url: e.target.value })}
                          className={`w-full px-3 py-1.5 bg-slate-900 border rounded-lg text-xs font-mono text-slate-200 focus:outline-none disabled:opacity-60 ${
                            urlError ? 'border-rose-500' : 'border-slate-800 focus:border-indigo-500'
                          }`}
                          placeholder="https://..."
                        />
                      </div>

                      {/* Open Direct URL */}
                      {config.url && (
                        <a
                          href={config.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-800 transition"
                          title="Open configured URL in new tab"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {/* Single Probe Button */}
                      {canManage && (
                        <button
                          type="button"
                          disabled={isTestingThis || !config.enabled}
                          onClick={() => handleTestConnection(cat)}
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Run single read-only probe and verify category products"
                        >
                          {isTestingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                          <span>Probe</span>
                        </button>
                      )}
                    </div>

                    {/* Final Resolved URL, Extraction Strategy, Pages Processed, Errors & Validation Evidence Metadata */}
                    <div className="mt-2 pt-2 border-t border-slate-900/80 flex flex-col gap-1.5 text-[11px] font-mono">
                      <div className="flex items-center justify-between gap-2 text-slate-400">
                        <span className="truncate" title={config.resolvedUrl || config.url}>
                          <span className="text-slate-500">Resolved URL: </span>
                          <span className="text-slate-300">{config.resolvedUrl || config.url || '—'}</span>
                          {config.redirected && (
                            <span className="ml-1.5 text-[10px] text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded border border-amber-500/20">
                              REDIRECTED
                            </span>
                          )}
                        </span>
                        {config.lastHttpStatus !== undefined && (
                          <span className="shrink-0 text-slate-500">
                            HTTP {config.lastHttpStatus || 'ERR'}
                          </span>
                        )}
                      </div>

                      {/* P1.2 Extraction Diagnostics Row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
                        <span>
                          <span className="text-slate-500">Extraction Strategy: </span>
                          <span className="text-indigo-300 font-semibold">
                            {config.extractionStrategy || 'NOT_RUN'}
                          </span>
                        </span>
                        <span>
                          <span className="text-slate-500">Products Detected: </span>
                          <span className={detectedCount && detectedCount > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                            {detectedCount ?? 0}
                            {config.categoryMatchCount !== undefined ? ` (${config.categoryMatchCount} matching)` : ''}
                          </span>
                        </span>
                        <span>
                          <span className="text-slate-500">Pages Processed: </span>
                          <span className="text-slate-200">{config.pagesProcessed ?? (config.lastTestedAt ? 1 : 0)}</span>
                        </span>
                        <span>
                          <span className="text-slate-500">Final Status: </span>
                          <span
                            className={
                              valStatus === 'VALID_CATEGORY'
                                ? 'text-emerald-400 font-semibold'
                                : valStatus === 'ACCESS_BLOCKED'
                                ? 'text-rose-400 font-semibold'
                                : valStatus === 'INVALID_CATEGORY'
                                ? 'text-amber-400 font-semibold'
                                : 'text-slate-400'
                            }
                          >
                            {valStatus}
                          </span>
                        </span>
                      </div>

                      {config.extractionErrors && config.extractionErrors.length > 0 && (
                        <div className="text-[10px] text-rose-400 truncate" title={config.extractionErrors.join('; ')}>
                          <span className="text-slate-500">Extraction Errors: </span>
                          <span>{config.extractionErrors.join('; ')}</span>
                        </div>
                      )}

                      {(config.validationEvidence || config.lastError) && (
                        <div className="text-[10px] text-slate-400 truncate" title={config.validationEvidence || config.lastError}>
                          <span className="text-slate-500">Validation: </span>
                          <span
                            className={
                              valStatus === 'VALID_CATEGORY'
                                ? 'text-emerald-400'
                                : valStatus === 'ACCESS_BLOCKED'
                                ? 'text-rose-400'
                                : valStatus === 'INVALID_CATEGORY'
                                ? 'text-amber-400'
                                : 'text-slate-400'
                            }
                          >
                            {config.validationEvidence || config.lastError}
                          </span>
                        </div>
                      )}
                    </div>

                    {urlError && (
                      <p className="mt-1 text-[11px] font-mono text-rose-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {urlError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Autonomous Discovery Engine, Diagnostics & Scheduling */}
        <div className="space-y-6">
          {/* Autonomous Product Discovery Engine Card (P1.0 / P1.2) */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
                  Automatic Discovery Engine
                </h3>
              </div>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                P1.2 DYNAMIC
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Traverses configured category pagination, extracts real products via structured JSON-LD or dynamic application state, creates canonical items, and stores daily price snapshots.
            </p>

            {/* Discovery Strategy Selector */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Crawl & Extraction Strategy
              </label>
              <select
                value={discoveryStrategy}
                disabled={isDiscovering || !canManage}
                onChange={(e) => setDiscoveryStrategy(e.target.value as any)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="AUTO">Strategy AUTO: Structured Data → Dynamic State (Next.js/Angular) → Browser Render</option>
                <option value="STATIC_FETCH">Strategy A: Static HTML + Structured Data Only</option>
                <option value="DYNAMIC_STATE">Strategy B: Dynamic Application State (Next.js PLP / Angular Category)</option>
                <option value="BROWSER_AUTOMATION">Strategy C: Headless Browser Driver (Playwright DOM Render)</option>
              </select>
            </div>

            {/* Discover Products Action Button */}
            {canManage && (
              <button
                type="button"
                disabled={isDiscovering || !currentSource.enabled}
                onClick={handleStartDiscovery}
                className="w-full py-2.5 px-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDiscovering ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Discovering Products...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-current" />
                    <span>Discover {currentSource.name} Products</span>
                  </>
                )}
              </button>
            )}

            {/* Live Discovery Step Progress */}
            {discoveryStepProgress && (
              <div className="p-2.5 bg-cyan-950/40 border border-cyan-800/60 rounded-lg text-xs font-mono text-cyan-300 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-cyan-400" />
                <span className="truncate">{discoveryStepProgress}</span>
              </div>
            )}

            {/* Discovery Stats Summary Card */}
            {activeDiscoveryJob ? (
              <div className="space-y-3 pt-2">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">Run Status:</span>
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        activeDiscoveryJob.status === 'COMPLETED'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : activeDiscoveryJob.status === 'RUNNING'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : activeDiscoveryJob.status === 'ACCESS_BLOCKED'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {activeDiscoveryJob.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
                    <div className="p-2 bg-slate-900 rounded">
                      <span className="text-slate-500 text-[10px] block">DISCOVERED</span>
                      <span className="text-sm font-bold text-cyan-400">{activeDiscoveryJob.progress.productsDiscovered}</span>
                    </div>
                    <div className="p-2 bg-slate-900 rounded">
                      <span className="text-slate-500 text-[10px] block">NEW PRODUCTS</span>
                      <span className="text-sm font-bold text-emerald-400">{activeDiscoveryJob.progress.productsCreated}</span>
                    </div>
                    <div className="p-2 bg-slate-900 rounded">
                      <span className="text-slate-500 text-[10px] block">OFFERS UPDATED</span>
                      <span className="text-sm font-bold text-indigo-400">{activeDiscoveryJob.progress.offersUpdated}</span>
                    </div>
                    <div className="p-2 bg-slate-900 rounded">
                      <span className="text-slate-500 text-[10px] block">PAGES CRAWLED</span>
                      <span className="text-sm font-bold text-slate-200">{activeDiscoveryJob.progress.pagesCrawled}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-slate-400 pt-1">
                    <span>Strategy Mode:</span>
                    <span className="text-indigo-300">{activeDiscoveryJob.strategy || 'AUTO'}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                    <span>Duration:</span>
                    <span>{Math.round(activeDiscoveryJob.durationMs / 1000)}s</span>
                  </div>

                  {activeDiscoveryJob.errors && activeDiscoveryJob.errors.length > 0 && (
                    <div className="pt-1 border-t border-slate-900 text-[10px] font-mono text-rose-400">
                      <span className="text-slate-500 block">EXTRACTION ERRORS ({activeDiscoveryJob.errors.length}):</span>
                      <span className="block truncate" title={activeDiscoveryJob.errors.join(' | ')}>
                        {activeDiscoveryJob.errors[0]}
                      </span>
                    </div>
                  )}

                  {activeDiscoveryJob.completedAt && (
                    <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                      <span>Completed At:</span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(activeDiscoveryJob.completedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Preview Discovered Products Button */}
                {activeDiscoveryJob.previewItems && activeDiscoveryJob.previewItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsPreviewOpen(true)}
                    className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg text-xs font-medium border border-slate-700 flex items-center justify-center gap-2 transition"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview Discovered Products ({activeDiscoveryJob.previewItems.length})</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="p-4 text-center bg-slate-950 border border-slate-800 rounded-lg">
                <p className="text-xs text-slate-500">
                  No automated discovery job run yet for {currentSource.name}.
                </p>
              </div>
            )}
          </div>

          {/* Daily Collection Scheduling Governance Card (P1.0 Requirement 9) */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
                  Daily Automation Governance
                </h3>
              </div>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                scheduleConfig?.enabled
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}>
                {scheduleConfig?.enabled ? 'ACTIVE' : 'PENDING APPROVAL'}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Google Cloud Scheduler triggers daily product discovery & price collection at <strong>04:00 Europe/Athens</strong>.
              Schedule cannot be activated without explicit administrator confirmation.
            </p>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Frequency:</span>
                <span className="text-slate-200">Daily at 04:00 Athens Time</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Status:</span>
                <span className={scheduleConfig?.enabled ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {scheduleConfig?.status || 'DISABLED_PENDING_ADMIN_APPROVAL'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Target Retailers:</span>
                <span className="text-slate-300">Plaisio, Public & Kotsovolos</span>
              </div>
            </div>

            {/* Explicit Administrator Approval Checkbox */}
            {canManage && (
              <div className="space-y-3 pt-1">
                <label className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-950/20 border border-amber-800/40 cursor-pointer text-xs text-amber-300 leading-tight">
                  <input
                    type="checkbox"
                    checked={scheduleApprovalChecked}
                    onChange={(e) => setScheduleApprovalChecked(e.target.checked)}
                    className="mt-0.5 rounded border-amber-800 text-amber-600 focus:ring-amber-500"
                  />
                  <span>
                    I confirm that a bounded manual discovery has succeeded and explicitly approve activating automated daily collection.
                  </span>
                </label>

                <button
                  type="button"
                  disabled={
                    isSavingSchedule ||
                    (!scheduleConfig?.enabled && !scheduleApprovalChecked)
                  }
                  onClick={handleSaveSchedule}
                  className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-400 text-slate-950 font-bold rounded-lg text-xs flex items-center justify-center gap-2 transition disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isSavingSchedule ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {scheduleApprovalChecked
                      ? scheduleConfig?.enabled
                        ? 'Update Approved Daily Schedule'
                        : 'Activate Daily Collection Schedule'
                      : scheduleConfig?.enabled
                      ? 'Disable Daily Schedule'
                      : 'Confirm Admin Approval Above to Activate'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Live Runtime Diagnostic Card */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
                  Live Runtime Diagnostic
                </h3>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                PROBE
              </span>
            </div>

            {canManage && (
              <button
                type="button"
                disabled={isTesting || !currentSource.enabled}
                onClick={() => handleTestConnection()}
                className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition disabled:opacity-60"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing Diagnostic Probe...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Test {currentSource.name} Connectivity</span>
                  </>
                )}
              </button>
            )}

            {activeDiagnostic && (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Final Validation Status:</span>
                  <span
                    className={
                      activeDiagnostic.validationStatus === 'VALID_CATEGORY'
                        ? 'text-emerald-400 font-bold'
                        : activeDiagnostic.validationStatus === 'ACCESS_BLOCKED'
                        ? 'text-rose-400 font-bold'
                        : activeDiagnostic.validationStatus === 'INVALID_CATEGORY'
                        ? 'text-amber-400 font-bold'
                        : 'text-slate-300 font-bold'
                    }
                  >
                    {activeDiagnostic.validationStatus || activeDiagnostic.accessStatus}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Extraction Strategy:</span>
                  <span className="text-indigo-300 font-bold">
                    {activeDiagnostic.extractionStrategy || 'STATIC_HTML'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Response Status:</span>
                  <span className={activeDiagnostic.httpStatus === 200 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    HTTP {activeDiagnostic.httpStatus}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Products Detected:</span>
                  <span className={activeDiagnostic.productsDetected > 0 ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                    {activeDiagnostic.productsDetected} items
                    {activeDiagnostic.categoryMatchCount !== undefined ? ` (${activeDiagnostic.categoryMatchCount} matching)` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Pages Processed:</span>
                  <span className="text-slate-200">{activeDiagnostic.pagesProcessed ?? 1}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Round-trip Latency:</span>
                  <span className="text-slate-200">{activeDiagnostic.responseTimeMs} ms</span>
                </div>
                {activeDiagnostic.extractionErrors && activeDiagnostic.extractionErrors.length > 0 && (
                  <div className="pt-1 border-t border-slate-900 space-y-0.5">
                    <span className="text-rose-400 text-[10px] block">EXTRACTION ERRORS:</span>
                    <span className="text-rose-300 text-[10px] leading-relaxed block">
                      {activeDiagnostic.extractionErrors.join('; ')}
                    </span>
                  </div>
                )}
                {activeDiagnostic.resolvedUrl && (
                  <div className="pt-1 border-t border-slate-900 space-y-0.5">
                    <span className="text-slate-500 text-[10px] block">FINAL RESOLVED URL:</span>
                    <span className="text-slate-300 text-[11px] break-all block">
                      {activeDiagnostic.resolvedUrl}
                    </span>
                  </div>
                )}
                {activeDiagnostic.validationEvidence && (
                  <div className="pt-1 border-t border-slate-900 space-y-0.5">
                    <span className="text-slate-500 text-[10px] block">VALIDATION EVIDENCE:</span>
                    <span className="text-slate-300 text-[10px] leading-relaxed block">
                      {activeDiagnostic.validationEvidence}
                    </span>
                  </div>
                )}
              </div>
            )}

            {!activeDiagnostic &&
              (currentSource.lastHttpError || currentSource.lastError) && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1 text-[11px] font-mono text-slate-400">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Historical Probe Record
                  </div>
                  <div className="text-slate-300 leading-relaxed">
                    {
                      resolveRetailerOperationalStatus({
                        source: currentSource,
                        liveOffersCount: getSourceEndpointProductTotal(currentSource),
                      }).formattedHistoricalProbeNote
                    }
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      {canManage && (
        <div className="sticky bottom-4 z-20 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl shadow-xl">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {isDirty ? (
              <span className="text-amber-400 flex items-center gap-1 font-mono">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                Unsaved changes detected
              </span>
            ) : (
              <span className="text-slate-500 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Configuration in sync with Firestore
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleResetDefaults}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
            >
              Reset to Defaults
            </button>

            {isDirty && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleDiscard}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
              >
                Discard
              </button>
            )}

            <button
              type="button"
              disabled={isSaving || !isDirty}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Configuration</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Discovered Products Preview Modal (P1.0) */}
      {isPreviewOpen && activeDiscoveryJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Preview Discovered Products — {currentSource.name} ({activeDiscoveryJob.previewItems?.length || 0} items)
                </h3>
              </div>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Bar */}
            <div className="p-3 border-b border-slate-800 bg-slate-900/40 flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-500 shrink-0" />
              <input
                type="text"
                value={previewFilter}
                onChange={(e) => setPreviewFilter(e.target.value)}
                placeholder="Filter preview by title, brand, SKU or category..."
                className="w-full bg-transparent border-0 text-xs text-slate-200 focus:outline-none placeholder:text-slate-500 font-mono"
              />
            </div>

            {/* Product Table */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="pb-2.5 font-semibold">SKU</th>
                      <th className="pb-2.5 font-semibold">Product Title</th>
                      <th className="pb-2.5 font-semibold">Brand</th>
                      <th className="pb-2.5 font-semibold">Category</th>
                      <th className="pb-2.5 font-semibold text-right">Price</th>
                      <th className="pb-2.5 font-semibold text-center">Status</th>
                      <th className="pb-2.5 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredPreview.map((item) => (
                      <tr key={item.retailerSku} className="hover:bg-slate-800/30 transition">
                        <td className="py-2.5 font-semibold text-indigo-400">{item.retailerSku}</td>
                        <td className="py-2.5 text-slate-200 max-w-xs truncate pr-4 font-sans font-medium" title={item.title}>
                          {item.title}
                        </td>
                        <td className="py-2.5 text-slate-300">{item.brand}</td>
                        <td className="py-2.5 text-slate-400 text-[11px]">{item.category}</td>
                        <td className="py-2.5 text-right font-bold text-emerald-400">
                          €{(item.priceCents / 100).toFixed(2)}
                        </td>
                        <td className="py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] ${
                            item.availability === 'IN_STOCK'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {item.availability}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-sans font-medium"
                          >
                            <span>View</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
              <span>Showing {filteredPreview.length} of {activeDiscoveryJob.previewItems?.length || 0} items</span>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

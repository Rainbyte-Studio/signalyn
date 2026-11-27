import React, { useMemo, useState } from 'react';
import {
  Settings2,
  Building2,
  SlidersHorizontal,
  RotateCcw,
  CheckCircle2,
  Database,
  Cpu,
  Shield,
  Layers,
  Info,
  Loader2,
  Store,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getMergedCanonicalCompanies } from '../../services/canonicalEntities';
import {
  getPrimaryCompany,
  getGlobalTrackedCompetitors,
  getCategoryCompetitors,
  isCategoryCompetitor,
  STANDARD_CATEGORIES,
} from '../../services/competitorSelectors';
import { HistoricalBackfillSettingsCard } from './HistoricalBackfillSettingsCard';
import { RetailSourcesSettings } from '../retail/RetailSourcesSettings';
import {
  SystemDiagnosticsPanel,
  DiagnosticsSubTab,
} from './SystemDiagnosticsPanel';
import {
  AppPage,
  PageHeader,
  Button,
  SemanticBadge,
} from '../common/DesignSystem';
import {
  buildNavigationHash,
  parseNavigationHash,
  SettingsSection,
} from '../../utils/navigationSync';

function parseSettingsHash(hash: string): {
  section: SettingsSection;
  diagnosticsSubTab: DiagnosticsSubTab;
} {
  const parsed = parseNavigationHash(hash, {
    currentActiveTab: 'settings',
    historyStateTab: 'settings',
  });
  return {
    section: parsed.settingsSection,
    diagnosticsSubTab: parsed.diagnosticsSubTab,
  };
}

export const SettingsView: React.FC = () => {
  const {
    settings,
    companies,
    setPrimaryCompany,
    updateSettings,
    resetMockData,
    notify,
    canManage,
  } = useApp();

  const allCompanies = useMemo(() => getMergedCanonicalCompanies(companies), [companies]);
  const primaryCompany = useMemo(() => getPrimaryCompany(companies, settings), [companies, settings]);
  const globalCompetitors = useMemo(() => getGlobalTrackedCompetitors(companies, settings), [companies, settings]);

  const [selectedCompanyId, setSelectedCompanyId] = useState(
    settings?.myCompanyId || 'comp-huawei'
  );
  const [retentionDays, setRetentionDays] = useState(settings?.retentionDays || 90);
  const [collectionInterval, setCollectionInterval] = useState(
    settings?.collectionIntervalMinutes || 60
  );
  const [defaultMarket, setDefaultMarket] = useState(settings?.defaultMarket || 'Global');

  // Competitor Sets by Category
  const categories = STANDARD_CATEGORIES;
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('Smartphones');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showResetConfirmation, setShowResetConfirmation] = useState<boolean>(false);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCompanyId !== settings?.myCompanyId) {
      await setPrimaryCompany(selectedCompanyId);
    }
    await updateSettings({
      retentionDays: Number(retentionDays),
      collectionIntervalMinutes: Number(collectionInterval),
      defaultMarket,
    });
  };

  const handleToggleCompetitorForCategory = async (companyId: string, category: string) => {
    const key = `${category}-${companyId}`;
    if (savingKey === key) return;
    setSavingKey(key);

    try {
      const currentList = settings?.competitorSets?.[category] || [];
      const exists = currentList.includes(companyId);
      const updatedList = exists
        ? currentList.filter((id) => id !== companyId)
        : [...currentList, companyId];

      await updateSettings({
        competitorSets: {
          [category]: updatedList,
        },
      });
    } catch (err: unknown) {
      console.warn(`[SettingsView] Failed to toggle competitor ${companyId} for ${category}:`, err);
    } finally {
      setSavingKey(null);
    }
  };

  const initialParsed = parseSettingsHash(
    typeof window !== 'undefined' ? window.location.hash : ''
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialParsed.section);
  const [diagnosticsSubTab, setDiagnosticsSubTab] = useState<DiagnosticsSubTab>(
    initialParsed.diagnosticsSubTab
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleLocationSync = () => {
      const parsed = parseSettingsHash(window.location.hash);
      setActiveSection(parsed.section);
      setDiagnosticsSubTab(parsed.diagnosticsSubTab);
    };
    window.addEventListener('hashchange', handleLocationSync);
    window.addEventListener('popstate', handleLocationSync);
    return () => {
      window.removeEventListener('hashchange', handleLocationSync);
      window.removeEventListener('popstate', handleLocationSync);
    };
  }, []);

  const handleNavigateSection = (section: SettingsSection) => {
    setActiveSection(section);
    if (typeof window !== 'undefined') {
      const nextHash = buildNavigationHash('settings', {
        settingsSection: section,
        diagnosticsSubTab: section === 'system-diagnostics' ? diagnosticsSubTab : 'overview',
        preserveExistingSettingsHash: false,
      });
      if (window.location.hash !== nextHash) {
        window.history.pushState({ activeTab: 'settings' }, '', nextHash);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }
  };

  return (
    <AppPage>
      {/* Standardized Page Header (Dangerous actions relocated to Advanced / Danger Zone) */}
      <PageHeader
        title="System & Intelligence Settings"
        description="Configure primary intelligence vantage point, competitor classification sets per category, retail data collection endpoints, and centralized system diagnostics."
      />

      {/* Settings Navigation Tabs */}
      <div className="flex border-b border-slate-800 gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => handleNavigateSection('general')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
            activeSection === 'general'
              ? 'border-indigo-500 text-indigo-400 bg-slate-900/80 shadow-xs'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <Building2 className="w-4 h-4" />
          General & Competitor Sets
        </button>

        <button
          type="button"
          onClick={() => handleNavigateSection('retail-sources')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
            activeSection === 'retail-sources'
              ? 'border-indigo-500 text-indigo-400 bg-slate-900/80 shadow-xs'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <Store className="w-4 h-4" />
          <span>Retail Sources (Public • Kotsovolos • Plaisio)</span>
        </button>

        {canManage && (
          <button
            type="button"
            onClick={() => handleNavigateSection('backfill')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
              activeSection === 'backfill'
                ? 'border-indigo-500 text-indigo-400 bg-slate-900/80 shadow-xs'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Database className="w-4 h-4" />
            Historical Backfill
          </button>
        )}

        {canManage && (
          <button
            type="button"
            onClick={() => handleNavigateSection('system-diagnostics')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
              activeSection === 'system-diagnostics'
                ? 'border-indigo-500 text-indigo-400 bg-slate-900/80 shadow-xs'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>System Diagnostics</span>
            <SemanticBadge variant="verified">ADMIN</SemanticBadge>
          </button>
        )}
      </div>

      {activeSection === 'system-diagnostics' ? (
        <SystemDiagnosticsPanel
          initialSubTab={diagnosticsSubTab}
          onNavigateSettingsSection={handleNavigateSection}
        />
      ) : activeSection === 'retail-sources' ? (
        <RetailSourcesSettings />
      ) : activeSection === 'backfill' ? (
        <div className="space-y-6">
          <HistoricalBackfillSettingsCard canManage={canManage} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column (2 spans): Primary Company & Competitor Sets */}
            <div className="lg:col-span-2 space-y-6">
              {/* Primary Company Configuration */}
              <form onSubmit={handleSaveGeneral} className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-400" />
                Primary Company Designation (My Company)
              </h3>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                ACTIVE PERSPECTIVE
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Designate the enterprise being benchmarked. The intelligence feed, daily brief, and threat matrices will pivot
              around this primary anchor. While initially defaulted to HUAWEI, you may switch this to any tracked competitor.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Selected Primary Target
              </label>
              <select
                value={selectedCompanyId}
                disabled={!canManage}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {allCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.isMyCompany ? '(Current Primary)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300 uppercase block">
                  Collection Interval
                </label>
                <select
                  value={collectionInterval}
                  disabled={!canManage}
                  onChange={(e) => setCollectionInterval(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-xs text-slate-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <option value={15}>15 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={60}>60 Minutes (Standard)</option>
                  <option value={120}>2 Hours</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300 uppercase block">
                  Data Retention Policy
                </label>
                <select
                  value={retentionDays}
                  disabled={!canManage}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-xs text-slate-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <option value={30}>30 Days</option>
                  <option value={60}>60 Days</option>
                  <option value={90}>90 Days (Recommended)</option>
                  <option value={180}>180 Days</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300 uppercase block">
                  Default Market
                </label>
                <select
                  value={defaultMarket}
                  disabled={!canManage}
                  onChange={(e) => setDefaultMarket(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-xs text-slate-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <option value="Global">Global</option>
                  <option value="Greece">Greece</option>
                  <option value="Europe">Europe</option>
                </select>
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              {canManage ? (
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  Save General Settings
                </button>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400">
                  <span>Read-Only Policy (Admin Assignment Required)</span>
                </div>
              )}
            </div>
          </form>

          {/* Competitor Sets per Category */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-purple-400" />
                Category Competitor Sets Configuration
              </h3>
              <span className="text-[10px] font-mono text-slate-400">
                SEGMENTED MAPPING
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Select which rivals compete against your primary company inside each specific hardware category.
              For instance, Smartphone competitors differ from Wearables or Audio rivals.
            </p>

            {/* Category tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((cat) => {
                const count = getCategoryCompetitors(cat, companies, settings).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategoryTab(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                      selectedCategoryTab === cat
                        ? 'bg-indigo-600 text-white font-bold'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {cat} ({count})
                  </button>
                );
              })}
            </div>

            {/* Checkbox grid of companies */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-semibold text-slate-300 block">
                Active Rivals in {selectedCategoryTab}:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {globalCompetitors.map((comp) => {
                  const isChecked = isCategoryCompetitor(comp.id, selectedCategoryTab, settings, companies);
                  const isSavingThis = savingKey === `${selectedCategoryTab}-${comp.id}`;

                  return (
                    <label
                      key={comp.id}
                      className={`p-2.5 rounded-lg border flex items-center justify-between transition ${
                        !canManage ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                      } ${
                        isSavingThis ? 'opacity-60 cursor-wait' : ''
                      } ${
                        isChecked
                          ? 'bg-indigo-950/30 border-indigo-500/50 text-slate-100'
                          : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isSavingThis ? (
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                        ) : (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={Boolean(savingKey) || !canManage}
                            onChange={() => {
                              if (canManage) {
                                handleToggleCompetitorForCategory(comp.id, selectedCategoryTab);
                              }
                            }}
                            className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60"
                          />
                        )}
                        <span className="text-xs font-medium">{comp.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">{comp.hqCountry}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Target Governance & System Diagnostics Shortcut */}
        <div className="space-y-6">
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-100 uppercase tracking-wide flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-400" />
              Intelligence Target Governance
            </h3>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-emerald-400 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Global Primary Target
                  </span>
                  <span className="font-mono text-[10px]">{primaryCompany?.name || 'HUAWEI'}</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Sets the platform-wide primary benchmark company across the Header, Sidebar, Daily Brief, Competitor Matrices, and Overview Command Center default scope.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-indigo-400 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5" /> Local View Filter Lenses
                  </span>
                  <span className="font-mono text-[10px]">NON-MUTATING</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Module-level brand or manufacturer selectors in Overview, Retail Prices, Service Intelligence, and Voice of Customer act as temporary analytical lenses without altering your persisted Global Primary Target.
                </p>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Unified System Diagnostics</span>
                </h4>
                <SemanticBadge variant="verified">ADMIN</SemanticBadge>
              </div>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                Inspect Firestore collection health, Retail P1.6 write probes, Service S1.2.6 Quality Gate &amp; Match Evidence Inspector, and the VoC Classifier Sandbox in one centralized view.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleNavigateSection('system-diagnostics')}
                leftIcon={<Activity className="w-3.5 h-3.5 text-emerald-400" />}
              >
                Open System Diagnostics
              </Button>
            </div>
          )}

          {/* Phase F: Advanced / Danger Zone (Relocated from PageHeader with explicit confirmation) */}
          {canManage && (
            <div
              id="danger-zone"
              aria-label="Advanced / Danger Zone"
              className="p-5 bg-slate-900 border border-rose-900/50 rounded-xl space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-rose-300 flex items-center gap-2 uppercase tracking-wide">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Advanced / Danger Zone</span>
                </h4>
                <SemanticBadge variant="error">ADMIN ONLY</SemanticBadge>
              </div>

              <p className="text-slate-400 text-[11px] leading-relaxed">
                <strong>Reset Baseline Demo Data</strong> invokes <code className="font-mono text-slate-300">seedFirestoreIfEmpty()</code> followed by a full state reload. If the <code className="font-mono text-slate-300">sources</code> collection is already populated, existing production records are preserved untouched. If empty, it seeds baseline documents into <code className="font-mono text-slate-300">sourceGroups</code>, <code className="font-mono text-slate-300">sources</code>, <code className="font-mono text-slate-300">companies</code>, <code className="font-mono text-slate-300">products</code>, <code className="font-mono text-slate-300">stories</code>, and <code className="font-mono text-slate-300">settings/intelligence</code>.
              </p>

              {!showResetConfirmation ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowResetConfirmation(true)}
                  leftIcon={<RotateCcw className="w-3.5 h-3.5 text-rose-400" />}
                  className="border-rose-800/60 text-rose-300 hover:bg-rose-950/40"
                >
                  Reset Baseline Demo Data...
                </Button>
              ) : (
                <div
                  role="alertdialog"
                  aria-label="Confirm Baseline Demo Data Reset"
                  className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-800/60 space-y-3"
                >
                  <p className="text-[11px] text-rose-200 leading-relaxed">
                    <strong>Confirm Action:</strong> This operation will check Cloud Firestore and seed baseline records into <code className="font-mono">sourceGroups</code>, <code className="font-mono">sources</code>, <code className="font-mono">companies</code>, <code className="font-mono">products</code>, <code className="font-mono">stories</code>, and <code className="font-mono">settings</code> if the database is uninitialized, then reload all active collections.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        setShowResetConfirmation(false);
                        await resetMockData();
                      }}
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                    >
                      Confirm Baseline Sync
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowResetConfirmation(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )}
</AppPage>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import {
  Menu,
  RefreshCw,
  Building2,
  Play,
  AlertCircle,
  LogIn,
  LogOut,
  User as UserIcon,
  ShieldCheck,
  Activity,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { DESIGN_TOKENS } from '../../styles/designTokens';
import { computeReconciledSourceKpiCounts } from '../../utils/dataIntegrityContracts';

export const Header: React.FC<{ onToggleMobileMenu: () => void }> = ({
  onToggleMobileMenu,
}) => {
  const {
    activeTab,
    refreshData,
    isLoading,
    settings,
    setActiveTab,
    sources,
    runCollector,
    isCollecting,
    collectorStatus,
    currentUser,
    isAdmin,
    canManage,
    signInWithGoogle,
    logout,
  } = useApp();

  const [showAuthMenu, setShowAuthMenu] = useState(false);
  const [showOperationsMenu, setShowOperationsMenu] = useState(false);

  const authMenuRef = useRef<HTMLDivElement>(null);
  const operationsMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (authMenuRef.current && !authMenuRef.current.contains(event.target as Node)) {
        setShowAuthMenu(false);
      }
      if (operationsMenuRef.current && !operationsMenuRef.current.contains(event.target as Node)) {
        setShowOperationsMenu(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAuthMenu(false);
        setShowOperationsMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const getPageTitle = () => {
    switch (activeTab) {
      case 'overview':
        return 'Overview Dashboard';
      case 'feed':
        return 'Intelligence Feed';
      case 'stories':
        return 'Story Clusters & Verification';
      case 'companies':
        return 'Tracked Companies Directory';
      case 'products':
        return 'Product Catalog & Aliases';
      case 'competitors':
        return 'Competitive Intelligence Matrix';
      case 'trends':
        return 'Keyword & Topic Trends';
      case 'daily-brief':
        return 'Daily Intelligence Brief';
      case 'retail-prices':
        return 'Retail Price Intelligence';
      case 'service':
        return 'Service & Security Intelligence';
      case 'voc':
        return 'Voice of Customer Intelligence';
      case 'analytics':
        return 'Intelligence Analytics';
      case 'backfill':
        return 'Historical Intelligence Backfill';
      case 'sources':
        return 'Sources Manager';
      case 'reviews':
        return 'Entity Reviews & Canonical Promotion';
      case 'settings':
        return 'System & Intelligence Settings';
      default:
        return 'Signalyn';
    }
  };

  const reconciledSourceCounts = computeReconciledSourceKpiCounts(sources);
  const errorSourcesCount = reconciledSourceCounts.currentErrorSourcesCount;
  const globalTargetName = settings?.myCompanyName || 'HUAWEI';

  const handleOpenSettings = (hash: string) => {
    if (typeof window !== 'undefined') {
      window.location.hash = hash;
    }
    setActiveTab('settings');
    setShowAuthMenu(false);
    setShowOperationsMenu(false);
  };

  return (
    <header aria-label="Global Application Header" className={DESIGN_TOKENS.header.container}>
      {/* Left Zone: Navigation Toggle & Standardized Page Title / Subtitle */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          className={`lg:hidden ${DESIGN_TOKENS.header.controlHeight} w-8 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-lg shrink-0 cursor-pointer`}
          aria-label="Toggle Navigation Menu"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="min-w-0 flex-1">
          <h2 className={DESIGN_TOKENS.header.title}>{getPageTitle()}</h2>
          <div className={DESIGN_TOKENS.header.subtitle}>
            <span title={reconciledSourceCounts.headerTooltipText}>
              {reconciledSourceCounts.headerStatusText}
            </span>
            {collectorStatus?.lastSuccessfulGlobalCollection && (
              <>
                <span className="mx-1.5 text-slate-600">•</span>
                <span>
                  Last cycle:{' '}
                  {new Date(collectorStatus.lastSuccessfulGlobalCollection).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right Zone: Standardized Global Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* 1. Authoritative Global Primary Intelligence Target Indicator */}
        <button
          type="button"
          onClick={() => handleOpenSettings('#general')}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 ${DESIGN_TOKENS.header.controlHeight} rounded-lg bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-700 text-xs transition whitespace-nowrap shrink-0 cursor-pointer`}
          title={`Global Primary Intelligence Target (${globalTargetName}). Click to configure in Settings. Local view filters act as temporary analytical lenses without overwriting this global target.`}
          aria-label={`Global Primary Intelligence Target: ${globalTargetName}. Configure in Settings.`}
        >
          <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="text-slate-400 text-[11px]">Target:</span>
          <span className="font-semibold text-slate-100 text-xs font-mono">
            {globalTargetName}
          </span>
        </button>

        {/* 2. Conditional Operational Warning Indicator (Only when source errors exist) */}
        {errorSourcesCount > 0 && (
          canManage ? (
            <button
              type="button"
              onClick={() => handleOpenSettings('#system-diagnostics:operations')}
              className={`inline-flex items-center gap-1.5 px-2.5 ${DESIGN_TOKENS.header.controlHeight} rounded-lg bg-amber-950/40 hover:bg-amber-950/70 border border-amber-500/40 text-[11px] font-mono text-amber-300 transition whitespace-nowrap shrink-0 cursor-pointer`}
              title={`${errorSourcesCount} feed source(s) reported collection errors. Click to inspect in System Diagnostics.`}
              aria-label={`${errorSourcesCount} Source Warnings. Open System Diagnostics.`}
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden md:inline">
                {errorSourcesCount} Source Warning{errorSourcesCount > 1 ? 's' : ''}
              </span>
              <span className="md:hidden">{errorSourcesCount}</span>
            </button>
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 ${DESIGN_TOKENS.header.controlHeight} rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] font-mono text-amber-400 whitespace-nowrap shrink-0`}
              title={`${errorSourcesCount} feed source(s) reported collection warnings`}
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">
                {errorSourcesCount} Source Warning{errorSourcesCount > 1 ? 's' : ''}
              </span>
              <span className="md:hidden">{errorSourcesCount}</span>
            </span>
          )
        )}

        {/* 3. Global Core Data Refresh Action (Read-only reload of core Firestore state) */}
        <button
          type="button"
          onClick={refreshData}
          disabled={isLoading}
          aria-label="Refresh core platform data"
          className={`inline-flex items-center gap-1.5 px-2.5 ${DESIGN_TOKENS.header.controlHeight} text-xs text-slate-300 hover:text-slate-100 bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-800 hover:border-slate-700 transition disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer`}
          title="Refresh core platform data (sources, stories, entities, and settings) from Firestore without triggering external source collection"
        >
          <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isLoading ? 'animate-spin text-indigo-400' : 'text-slate-400'}`} />
          <span className="hidden xl:inline font-medium">Refresh</span>
        </button>

        {/* 4. Secondary Administrative Operations Menu (Admin-only) */}
        {canManage && (
          <div className="relative" ref={operationsMenuRef}>
            <button
              type="button"
              onClick={() => {
                setShowOperationsMenu((prev) => !prev);
                setShowAuthMenu(false);
              }}
              aria-expanded={showOperationsMenu}
              aria-haspopup="menu"
              aria-label="Administrative Operations Menu"
              title="Administrative Operations: Trigger source collection or inspect System Diagnostics"
              className={`inline-flex items-center gap-1.5 px-2.5 ${DESIGN_TOKENS.header.controlHeight} bg-slate-900 hover:bg-slate-800 border ${
                isCollecting
                  ? 'border-emerald-500/50 text-emerald-300'
                  : 'border-slate-800 hover:border-slate-700 text-slate-200'
              } rounded-lg text-xs transition whitespace-nowrap shrink-0 cursor-pointer`}
            >
              {isCollecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
                  <span className="hidden sm:inline font-medium">Ingesting...</span>
                </>
              ) : (
                <>
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="hidden sm:inline font-medium">Operations</span>
                </>
              )}
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>

            {showOperationsMenu && (
              <div
                role="menu"
                aria-label="Administrative Operations"
                className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-2 z-50 space-y-1"
              >
                <div className="px-2.5 py-1.5 border-b border-slate-800/80 flex items-center justify-between">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
                    Admin Operations
                  </span>
                  <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                    ADMIN
                  </span>
                </div>

                {/* Collect Now Action */}
                <button
                  type="button"
                  role="menuitem"
                  disabled={isCollecting || isLoading}
                  onClick={() => {
                    runCollector();
                    setShowOperationsMenu(false);
                  }}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-slate-800/90 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
                  title="Trigger immediate server-side news ingestion across all active sources"
                >
                  {isCollecting ? (
                    <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin shrink-0 mt-0.5" />
                  ) : (
                    <Play className="w-4 h-4 text-emerald-400 fill-current shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-100">
                      {isCollecting ? 'Ingesting Feeds...' : 'Collect Now'}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                      Trigger immediate RSS/Atom collection across active sources
                    </p>
                  </div>
                </button>

                {/* System Diagnostics Shortcut */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleOpenSettings('#system-diagnostics')}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-slate-800/90 transition cursor-pointer"
                >
                  <Activity className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-100">
                      System Diagnostics
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
                      Inspect health checks, persistence probes &amp; quality gates
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 5. User / Account Control */}
        <div className="relative" ref={authMenuRef}>
          {currentUser ? (
            <button
              type="button"
              onClick={() => {
                setShowAuthMenu((prev) => !prev);
                setShowOperationsMenu(false);
              }}
              aria-expanded={showAuthMenu}
              aria-haspopup="menu"
              className={`inline-flex items-center gap-1.5 px-2.5 ${DESIGN_TOKENS.header.controlHeight} bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg text-xs text-slate-200 transition whitespace-nowrap shrink-0 cursor-pointer`}
              title={`${currentUser.displayName || 'Authenticated User'} (${currentUser.email || 'Active Session'}) — Role: ${isAdmin ? 'Admin' : 'Analyst'}`}
            >
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'User'}
                  className="w-4 h-4 rounded-full shrink-0"
                />
              ) : (
                <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${isAdmin ? 'text-emerald-400' : 'text-sky-400'}`} />
              )}
              <span className="hidden md:inline font-mono text-[11px] truncate max-w-[100px]">
                {currentUser.displayName || currentUser.email?.split('@')[0] || (isAdmin ? 'Admin' : 'Analyst')}
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                  isAdmin
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {isAdmin ? 'Admin' : 'Analyst'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowAuthMenu((prev) => !prev);
                setShowOperationsMenu(false);
              }}
              aria-expanded={showAuthMenu}
              aria-haspopup="menu"
              className={`inline-flex items-center gap-1.5 px-2.5 ${DESIGN_TOKENS.header.controlHeight} bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg text-xs text-slate-300 transition whitespace-nowrap shrink-0 cursor-pointer`}
              title="Account & Session Menu"
            >
              <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="hidden md:inline font-medium">Account</span>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>
          )}

          {showAuthMenu && (
            <div
              role="menu"
              aria-label="Account Menu"
              className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-3 z-50 space-y-2"
            >
              <div className="text-xs text-slate-400 font-mono border-b border-slate-800 pb-2">
                {currentUser ? (
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className="font-semibold text-slate-200 truncate"
                        title={currentUser.displayName || 'Signed In'}
                      >
                        {currentUser.displayName || 'Signed In'}
                      </p>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                          isAdmin
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {isAdmin ? 'Admin' : 'Analyst'}
                      </span>
                    </div>
                    <p
                      className="text-[10px] truncate text-slate-400 mt-0.5"
                      title={currentUser.email || 'Firebase Session'}
                    >
                      {currentUser.email || 'Firebase Session'}
                    </p>
                    {!isAdmin && (
                      <p className="text-[10px] text-amber-400/90 mt-1 font-sans">
                        Read-only analyst session. Privileged actions require explicit administrator role assignment.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-200">Public Read-Only Mode</p>
                    <p className="text-[10px] text-slate-400 font-sans">
                      Public browsing and data exploration active without login
                    </p>
                  </div>
                )}
              </div>

              {/* Quick Navigation Links */}
              <div className="space-y-1 border-b border-slate-800 pb-2">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleOpenSettings('#general')}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <span>Target &amp; Settings</span>
                  <span className="text-[10px] font-mono text-slate-400">{globalTargetName}</span>
                </button>
                {canManage && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleOpenSettings('#system-diagnostics')}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-emerald-300 hover:text-emerald-200 hover:bg-emerald-950/30 rounded-lg transition cursor-pointer"
                  >
                    <span>System Diagnostics</span>
                    <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      ADMIN
                    </span>
                  </button>
                )}
              </div>

              {currentUser ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    logout();
                    setShowAuthMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-950/30 rounded-lg transition cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      signInWithGoogle();
                      setShowAuthMenu(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Sign in with Google</span>
                  </button>
                  <p className="text-[10px] text-slate-500 text-center leading-tight">
                    Sign in with Google as an analyst or administrator. Public browsing remains active for guests.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};


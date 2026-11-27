import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NavigationTab, isProductionStory } from '../../types';
import {
  NavigationGroupId,
  NavigationItemResolved,
  SIDEBAR_COMPACT_STORAGE_KEY,
  SIDEBAR_EXPANDED_STORAGE_KEY,
  ensureActiveGroupExpanded,
  getInitialExpandedGroups,
  getResolvedNavigationGroups,
} from '../../config/navigationConfig';
import { DESIGN_TOKENS } from '../../styles/designTokens';

function readLocalStorageSafely(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors in restricted contexts
  }
  return null;
}

function writeLocalStorageSafely(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage write errors
  }
}

export const Sidebar: React.FC<{ isMobileOpen?: boolean; onCloseMobile?: () => void }> = ({
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const { activeTab, setActiveTab, sources, stories, settings, entityReviews, canManage } = useApp();

  const pendingReviewsCount = useMemo(
    () => entityReviews.filter((r) => r.status === 'PENDING').length,
    [entityReviews]
  );
  const productionStoriesCount = useMemo(
    () => stories.filter(isProductionStory).length,
    [stories]
  );

  // Expanded/collapsed group state with localStorage persistence
  const [expandedGroups, setExpandedGroups] = useState<Record<NavigationGroupId, boolean>>(() =>
    getInitialExpandedGroups(activeTab, readLocalStorageSafely(SIDEBAR_EXPANDED_STORAGE_KEY))
  );

  // Optional compact rail mode on desktop/tablet (lg+), always full width inside mobile drawer
  const [isCompactRail, setIsCompactRail] = useState<boolean>(() => {
    const saved = readLocalStorageSafely(SIDEBAR_COMPACT_STORAGE_KEY);
    return saved === 'true';
  });

  // Automatically expand the group containing the active tab whenever activeTab changes
  useEffect(() => {
    setExpandedGroups((prev) => {
      const updated = ensureActiveGroupExpanded(prev, activeTab);
      if (updated !== prev) {
        writeLocalStorageSafely(SIDEBAR_EXPANDED_STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }, [activeTab]);

  // Dismiss mobile drawer on Escape key press
  useEffect(() => {
    if (!isMobileOpen || !onCloseMobile) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  const handleToggleGroup = (groupId: NavigationGroupId) => {
    setExpandedGroups((prev) => {
      const next = {
        ...prev,
        [groupId]: !prev[groupId],
      };
      writeLocalStorageSafely(SIDEBAR_EXPANDED_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleToggleCompactRail = () => {
    setIsCompactRail((prev) => {
      const next = !prev;
      writeLocalStorageSafely(SIDEBAR_COMPACT_STORAGE_KEY, String(next));
      return next;
    });
  };

  const handleSelectTab = (tab: NavigationTab) => {
    setActiveTab(tab);
    if (onCloseMobile) onCloseMobile();
  };

  const resolvedGroups = useMemo(
    () =>
      getResolvedNavigationGroups(
        canManage,
        {
          productionStoriesCount,
          sourcesCount: sources.length,
          pendingReviewsCount,
        },
        activeTab
      ),
    [canManage, productionStoriesCount, sources.length, pendingReviewsCount, activeTab]
  );

  const targetCompanyName = settings?.myCompanyName || 'HUAWEI';
  // On mobile drawer, always render full labels even if desktop compact rail is enabled
  const effectiveCompact = isCompactRail && !isMobileOpen;

  const renderNavItem = (item: NavigationItemResolved, groupLabel: string) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    const tooltipText =
      item.badge !== undefined
        ? `${groupLabel} — ${item.label} (${item.badge})`
        : `${groupLabel} — ${item.label}`;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleSelectTab(item.id)}
        aria-current={isActive ? 'page' : undefined}
        aria-label={effectiveCompact ? tooltipText : item.label}
        title={effectiveCompact ? tooltipText : undefined}
        className={`w-full flex items-center ${
          effectiveCompact ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-1.5'
        } rounded-lg text-xs font-medium transition motion-reduce:transition-none group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 ${
          isActive
            ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-xs'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
        }`}
      >
        <div className={`flex items-center ${effectiveCompact ? 'justify-center relative' : 'gap-2.5 min-w-0'}`}>
          <Icon
            className={`w-4 h-4 shrink-0 transition motion-reduce:transition-none ${
              isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
            }`}
          />
          {!effectiveCompact && <span className="truncate">{item.label}</span>}

          {/* Compact rail status dot for highlights or active alert badges */}
          {effectiveCompact && (item.highlight || item.badge !== undefined) && (
            <span
              className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-slate-950 ${
                item.highlight ? 'bg-amber-400' : 'bg-indigo-400'
              }`}
            />
          )}
        </div>

        {!effectiveCompact && (
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {item.badge !== undefined && (
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                  isActive
                    ? 'bg-indigo-500/30 text-indigo-200 font-bold'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                {item.badge}
              </span>
            )}
            {item.highlight && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                aria-label="Active module highlight"
              />
            )}
          </div>
        )}
      </button>
    );
  };

  return (
    <aside
      aria-label="Primary Sidebar Navigation"
      className={`fixed lg:static inset-y-0 left-0 z-40 ${
        effectiveCompact ? 'w-64 lg:w-16' : 'w-64'
      } bg-slate-950 border-r border-slate-800/80 flex flex-col justify-between transition-all duration-200 motion-reduce:transition-none lg:translate-x-0 ${
        isMobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex flex-col h-full min-h-0">
        {/* Brand Logo & Title Header */}
        <div
          className={`${DESIGN_TOKENS.header.height} flex items-center ${
            effectiveCompact ? 'justify-center px-2' : 'justify-between px-4'
          } border-b border-slate-800/80`}
        >
          <div className={`flex items-center ${effectiveCompact ? 'justify-center' : 'gap-2.5 min-w-0'}`}>
            <div
              className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30 font-black text-lg tracking-wider shrink-0"
              title="Signalyn CORE — Tech Intel Platform"
            >
              S
            </div>
            {!effectiveCompact && (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-base tracking-tight text-slate-100 truncate">
                    Signalyn
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shrink-0">
                    CORE
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 tracking-wider font-mono uppercase truncate">
                  Tech Intel Platform
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Desktop rail collapse/expand toggle */}
            {!effectiveCompact && (
              <button
                type="button"
                onClick={handleToggleCompactRail}
                aria-label="Collapse sidebar to icon rail"
                title="Collapse sidebar to icon rail"
                className="hidden lg:flex p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-900 rounded-md transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}

            {/* Mobile drawer explicit close button */}
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close navigation menu"
                className="lg:hidden p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Compact Rail Expand Trigger when collapsed on desktop */}
        {effectiveCompact && (
          <div className="hidden lg:flex justify-center py-1.5 border-b border-slate-800/60 bg-slate-950 shrink-0">
            <button
              type="button"
              onClick={handleToggleCompactRail}
              aria-label="Expand sidebar navigation"
              title="Expand sidebar navigation"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Grouped Navigation Region */}
        <nav
          aria-label="Intelligence Modules"
          className="flex-1 px-2.5 py-3 space-y-3 overflow-y-auto overscroll-contain"
        >
          {resolvedGroups.map((group, groupIndex) => {
            const isExpanded = Boolean(expandedGroups[group.id]);
            const groupPanelId = `sidebar-group-panel-${group.id}`;

            if (effectiveCompact) {
              return (
                <div
                  key={group.id}
                  role="group"
                  aria-label={group.label}
                  className={groupIndex > 0 ? 'pt-2 border-t border-slate-800/60 space-y-1' : 'space-y-1'}
                >
                  {group.items.map((item) => renderNavItem(item, group.label))}
                </div>
              );
            }

            return (
              <div
                key={group.id}
                className={groupIndex > 0 ? 'pt-2 border-t border-slate-800/40' : ''}
              >
                {/* Collapsible Group Header Button */}
                <button
                  type="button"
                  onClick={() => handleToggleGroup(group.id)}
                  aria-expanded={isExpanded}
                  aria-controls={groupPanelId}
                  className="w-full flex items-center justify-between px-2 py-1 rounded-md text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 select-none"
                >
                  <span className="truncate">{group.label}</span>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Subtle group-level notification indicator when collapsed */}
                    {!isExpanded && group.actionAlertCount > 0 && (
                      <span
                        className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        title={`${group.actionAlertCount} pending action item(s) in ${group.label}`}
                      >
                        {group.actionAlertCount}
                      </span>
                    )}
                    {!isExpanded && group.hasGroupHighlight && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-amber-400"
                        title={`${group.label} contains highlighted intelligence modules`}
                        aria-label={`${group.label} contains highlighted modules`}
                      />
                    )}
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </div>
                </button>

                {/* Group Items List:
                    When expanded, render all items in the group.
                    When manually collapsed while containing the active page, keep the active item pinned and visible so the active page is never hidden inside a collapsed group. */}
                <div
                  id={groupPanelId}
                  role="region"
                  aria-label={group.label}
                  className="mt-1 space-y-0.5"
                >
                  {isExpanded
                    ? group.items.map((item) => renderNavItem(item, group.label))
                    : group.activeItem
                    ? [renderNavItem(group.activeItem, group.label)]
                    : null}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer Context Summary & Admin Diagnostics Shortcut */}
        {effectiveCompact ? (
          <div className="p-2 border-t border-slate-800/80 bg-slate-950 flex justify-center shrink-0">
            <span
              title={`Access Role: ${canManage ? 'Admin' : 'Guest (Read-Only)'} • Global Target: ${targetCompanyName}`}
              className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-mono font-bold uppercase ${
                canManage
                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                  : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              {canManage ? 'A' : 'G'}
            </span>
          </div>
        ) : (
          <div className="p-3.5 border-t border-slate-800/80 bg-slate-950 shrink-0">
            <div className="text-[10px] text-slate-500 font-mono space-y-1.5">
              <div className="flex justify-between items-center">
                <span>Primary Target:</span>
                <span className="text-slate-300 font-semibold truncate max-w-[110px]">
                  {targetCompanyName}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Access Role:</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                    canManage
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  {canManage ? 'Admin' : 'Guest (Read-Only)'}
                </span>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.location.hash = '#system-diagnostics';
                    }
                    handleSelectTab('settings');
                  }}
                  className="w-full flex items-center justify-between pt-1.5 border-t border-slate-800/60 text-[10px] font-mono text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                  title="Open Unified System Diagnostics in Settings"
                >
                  <span>System Diagnostics</span>
                  <span className="text-[9px] text-slate-400">Open &rarr;</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

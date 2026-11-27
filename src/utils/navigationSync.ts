import { NavigationTab } from '../types';

export type SettingsSection = 'general' | 'retail-sources' | 'backfill' | 'system-diagnostics';
export type DiagnosticsSubTab = 'overview' | 'retail' | 'service' | 'voc' | 'operations';

export const VALID_NAVIGATION_TABS: readonly NavigationTab[] = [
  'overview',
  'feed',
  'stories',
  'companies',
  'products',
  'retail-prices',
  'service',
  'voc',
  'competitors',
  'trends',
  'daily-brief',
  'analytics',
  'backfill',
  'sources',
  'reviews',
  'settings',
] as const;

export const VALID_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'retail-sources',
  'backfill',
  'system-diagnostics',
] as const;

export const VALID_DIAGNOSTICS_SUB_TABS: readonly DiagnosticsSubTab[] = [
  'overview',
  'retail',
  'service',
  'voc',
  'operations',
] as const;

export interface ResolvedNavigationState {
  activeTab: NavigationTab;
  settingsSection: SettingsSection;
  diagnosticsSubTab: DiagnosticsSubTab;
  canonicalHash: string;
  isUnknownFallback: boolean;
}

/**
 * Checks whether a raw hash specifically targets a Settings section or sub-tab.
 */
export function isSettingsHash(rawHash: string, currentActiveTab?: NavigationTab): boolean {
  const clean = (rawHash || '').replace(/^#\/?/, '').trim().toLowerCase();
  if (!clean) return false;
  if (
    clean === 'settings' ||
    clean === 'general' ||
    clean === 'retail-sources' ||
    clean.startsWith('system-diagnostics') ||
    clean.startsWith('settings:') ||
    clean.startsWith('settings/')
  ) {
    return true;
  }
  if (clean === 'backfill' && currentActiveTab === 'settings') {
    return true;
  }
  return false;
}

/**
 * Parses a URL hash (e.g. `#retail-sources`, `#system-diagnostics:retail`, `#overview`, `#analytics`)
 * into a deterministic ResolvedNavigationState.
 * Unknown or empty hashes resolve safely to `overview` (`#overview`).
 */
export function parseNavigationHash(
  rawHash: string,
  options?: { currentActiveTab?: NavigationTab; historyStateTab?: NavigationTab }
): ResolvedNavigationState {
  const clean = (rawHash || '').replace(/^#\/?/, '').trim().toLowerCase();

  // Empty hash defaults cleanly to Overview
  if (!clean) {
    return {
      activeTab: 'overview',
      settingsSection: 'general',
      diagnosticsSubTab: 'overview',
      canonicalHash: '#overview',
      isUnknownFallback: false,
    };
  }

  // 1. Explicit Settings sub-routes: #general, #retail-sources, #system-diagnostics[:sub], #settings[:section]
  if (clean === 'general' || clean === 'settings' || clean === 'settings:general' || clean === 'settings/general') {
    return {
      activeTab: 'settings',
      settingsSection: 'general',
      diagnosticsSubTab: 'overview',
      canonicalHash: '#general',
      isUnknownFallback: false,
    };
  }

  if (clean === 'retail-sources' || clean === 'settings:retail-sources' || clean === 'settings/retail-sources') {
    return {
      activeTab: 'settings',
      settingsSection: 'retail-sources',
      diagnosticsSubTab: 'overview',
      canonicalHash: '#retail-sources',
      isUnknownFallback: false,
    };
  }

  if (clean === 'settings:backfill' || clean === 'settings/backfill') {
    return {
      activeTab: 'settings',
      settingsSection: 'backfill',
      diagnosticsSubTab: 'overview',
      canonicalHash: '#settings:backfill',
      isUnknownFallback: false,
    };
  }

  // Disambiguate `#backfill` when navigating within Settings vs top-level Historical Backfill page
  if (clean === 'backfill') {
    if (options?.historyStateTab === 'settings' || options?.currentActiveTab === 'settings') {
      return {
        activeTab: 'settings',
        settingsSection: 'backfill',
        diagnosticsSubTab: 'overview',
        canonicalHash: '#backfill',
        isUnknownFallback: false,
      };
    }
    return {
      activeTab: 'backfill',
      settingsSection: 'general',
      diagnosticsSubTab: 'overview',
      canonicalHash: '#backfill',
      isUnknownFallback: false,
    };
  }

  if (
    clean.startsWith('system-diagnostics') ||
    clean.startsWith('settings:system-diagnostics') ||
    clean.startsWith('settings/system-diagnostics')
  ) {
    const normalizedDiag = clean
      .replace(/^settings[:/]/, '');
    const parts = normalizedDiag.split(':');
    const subCandidate = parts[1] as DiagnosticsSubTab | undefined;
    const validSub: DiagnosticsSubTab =
      subCandidate && (VALID_DIAGNOSTICS_SUB_TABS as readonly string[]).includes(subCandidate)
        ? subCandidate
        : 'overview';
    const canonicalHash =
      validSub === 'overview' ? '#system-diagnostics' : `#system-diagnostics:${validSub}`;

    return {
      activeTab: 'settings',
      settingsSection: 'system-diagnostics',
      diagnosticsSubTab: validSub,
      canonicalHash,
      isUnknownFallback: false,
    };
  }

  // 2. Standard top-level NavigationTab routes
  if ((VALID_NAVIGATION_TABS as readonly string[]).includes(clean)) {
    const tab = clean as NavigationTab;
    return {
      activeTab: tab,
      settingsSection: 'general',
      diagnosticsSubTab: 'overview',
      canonicalHash: tab === 'settings' ? '#general' : `#${tab}`,
      isUnknownFallback: false,
    };
  }

  // 3. Unknown or malformed hash -> safe fallback to Overview
  return {
    activeTab: 'overview',
    settingsSection: 'general',
    diagnosticsSubTab: 'overview',
    canonicalHash: '#overview',
    isUnknownFallback: true,
  };
}

/**
 * Computes the canonical URL hash for a target NavigationTab and optional Settings sub-state.
 */
export function buildNavigationHash(
  tab: NavigationTab,
  options?: {
    currentHash?: string;
    settingsSection?: SettingsSection;
    diagnosticsSubTab?: DiagnosticsSubTab;
    preserveExistingSettingsHash?: boolean;
  }
): string {
  if (tab !== 'settings') {
    return `#${tab}`;
  }

  // If navigating to 'settings' and the current hash is already a specific Settings hash
  // (e.g., Header/Sidebar set `#system-diagnostics` right before calling `setActiveTab('settings')`),
  // preserve that specific Settings hash.
  if (options?.preserveExistingSettingsHash && options.currentHash) {
    const parsedCurrent = parseNavigationHash(options.currentHash, { currentActiveTab: 'settings' });
    if (parsedCurrent.activeTab === 'settings' && !parsedCurrent.isUnknownFallback) {
      return parsedCurrent.canonicalHash;
    }
  }

  const section = options?.settingsSection || 'general';
  if (section === 'retail-sources') return '#retail-sources';
  if (section === 'backfill') return '#backfill';
  if (section === 'system-diagnostics') {
    const sub = options?.diagnosticsSubTab || 'overview';
    return sub === 'overview' ? '#system-diagnostics' : `#system-diagnostics:${sub}`;
  }
  return '#general';
}

/**
 * Pure, testable browser history simulator for deterministic verification of
 * multi-step navigation, deep links, Settings sub-tabs, and Browser Back/Forward.
 */
export class NavigationHistoryController {
  private entries: Array<{ hash: string; state: { activeTab: NavigationTab } }> = [];
  private index = 0;
  private currentState: ResolvedNavigationState;

  constructor(initialHash: string = '#overview') {
    const resolved = parseNavigationHash(initialHash);
    this.currentState = resolved;
    this.entries = [{ hash: resolved.canonicalHash, state: { activeTab: resolved.activeTab } }];
    this.index = 0;
  }

  public getState(): ResolvedNavigationState & {
    urlHash: string;
    historyLength: number;
    historyIndex: number;
  } {
    return {
      ...this.currentState,
      urlHash: this.entries[this.index].hash,
      historyLength: this.entries.length,
      historyIndex: this.index,
    };
  }

  public navigateToTab(tab: NavigationTab): ResolvedNavigationState {
    const currentHash = this.entries[this.index].hash;
    const nextHash = buildNavigationHash(tab, {
      currentHash,
      preserveExistingSettingsHash: false,
    });
    const nextState = parseNavigationHash(nextHash, {
      currentActiveTab: tab,
      historyStateTab: tab,
    });

    if (currentHash !== nextState.canonicalHash || this.currentState.activeTab !== nextState.activeTab) {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push({
        hash: nextState.canonicalHash,
        state: { activeTab: nextState.activeTab },
      });
      this.index = this.entries.length - 1;
    }
    this.currentState = nextState;
    return this.currentState;
  }

  public navigateToSettingsSection(
    section: SettingsSection,
    diagnosticsSubTab: DiagnosticsSubTab = 'overview'
  ): ResolvedNavigationState {
    const currentHash = this.entries[this.index].hash;
    const nextHash = buildNavigationHash('settings', {
      settingsSection: section,
      diagnosticsSubTab,
      preserveExistingSettingsHash: false,
    });
    const nextState = parseNavigationHash(nextHash, {
      currentActiveTab: 'settings',
      historyStateTab: 'settings',
    });

    if (currentHash !== nextState.canonicalHash || this.currentState.activeTab !== 'settings') {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push({
        hash: nextState.canonicalHash,
        state: { activeTab: 'settings' },
      });
      this.index = this.entries.length - 1;
    }
    this.currentState = nextState;
    return this.currentState;
  }

  public openHash(rawHash: string): ResolvedNavigationState {
    const currentHash = this.entries[this.index].hash;
    const nextState = parseNavigationHash(rawHash, {
      currentActiveTab: this.currentState.activeTab,
    });

    if (currentHash !== nextState.canonicalHash) {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push({
        hash: nextState.canonicalHash,
        state: { activeTab: nextState.activeTab },
      });
      this.index = this.entries.length - 1;
    }
    this.currentState = nextState;
    return this.currentState;
  }

  public back(): ResolvedNavigationState {
    if (this.index > 0) {
      this.index -= 1;
      const entry = this.entries[this.index];
      this.currentState = parseNavigationHash(entry.hash, {
        historyStateTab: entry.state.activeTab,
      });
    }
    return this.currentState;
  }

  public forward(): ResolvedNavigationState {
    if (this.index < this.entries.length - 1) {
      this.index += 1;
      const entry = this.entries[this.index];
      this.currentState = parseNavigationHash(entry.hash, {
        historyStateTab: entry.state.activeTab,
      });
    }
    return this.currentState;
  }

  public reload(): ResolvedNavigationState {
    const entry = this.entries[this.index];
    this.currentState = parseNavigationHash(entry.hash, {
      historyStateTab: entry.state.activeTab,
    });
    return this.currentState;
  }
}

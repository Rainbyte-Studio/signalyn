import {
  LayoutDashboard,
  Rss,
  Layers,
  Building2,
  Cpu,
  TrendingUp,
  BarChart3,
  Database,
  Settings,
  FileText,
  Swords,
  History,
  ShieldCheck,
  ShoppingBag,
  ShieldAlert,
  MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react';
import { NavigationTab } from '../types';

export type NavigationGroupId =
  | 'workspace'
  | 'market-intelligence'
  | 'customer-service'
  | 'analytics-data'
  | 'administration';

export interface NavBadgeContext {
  productionStoriesCount: number;
  sourcesCount: number;
  pendingReviewsCount: number;
}

export interface NavigationItemDefinition {
  id: NavigationTab;
  label: string;
  groupId: NavigationGroupId;
  icon: LucideIcon;
  requiresManage?: boolean;
  resolveBadge?: (ctx: NavBadgeContext) => number | undefined;
  resolveHighlight?: (ctx: NavBadgeContext) => boolean;
  /** Whether a highlight on this item represents an actionable/priority module or alert */
  isActionAlert?: (ctx: NavBadgeContext) => boolean;
}

export interface NavigationItemResolved extends NavigationItemDefinition {
  badge?: number;
  highlight?: boolean;
  hasActionAlert?: boolean;
}

export interface NavigationGroupDefinition {
  id: NavigationGroupId;
  label: string;
  items: NavigationItemDefinition[];
}

export interface NavigationGroupResolved {
  id: NavigationGroupId;
  label: string;
  items: NavigationItemResolved[];
  containsActiveTab: boolean;
  activeItem?: NavigationItemResolved;
  /** True when the group contains at least one highlighted module or pending action alert */
  hasGroupHighlight: boolean;
  /** Sum of actionable alert badges (e.g. pending reviews) inside the group without double-counting static inventory counts */
  actionAlertCount: number;
}

export const SIDEBAR_EXPANDED_STORAGE_KEY = 'signalyn_sidebar_expanded_groups_v1';
export const SIDEBAR_COMPACT_STORAGE_KEY = 'signalyn_sidebar_compact_v1';

export const NAVIGATION_GROUPS: NavigationGroupDefinition[] = [
  {
    id: 'workspace',
    label: 'WORKSPACE',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        groupId: 'workspace',
        icon: LayoutDashboard,
      },
      {
        id: 'feed',
        label: 'Intelligence Feed',
        groupId: 'workspace',
        icon: Rss,
      },
      {
        id: 'stories',
        label: 'Stories',
        groupId: 'workspace',
        icon: Layers,
        resolveBadge: (ctx) => ctx.productionStoriesCount,
      },
      {
        id: 'daily-brief',
        label: 'Daily Brief',
        groupId: 'workspace',
        icon: FileText,
      },
    ],
  },
  {
    id: 'market-intelligence',
    label: 'MARKET INTELLIGENCE',
    items: [
      {
        id: 'companies',
        label: 'Companies',
        groupId: 'market-intelligence',
        icon: Building2,
      },
      {
        id: 'products',
        label: 'Products',
        groupId: 'market-intelligence',
        icon: Cpu,
      },
      {
        id: 'retail-prices',
        label: 'Retail Prices',
        groupId: 'market-intelligence',
        icon: ShoppingBag,
        resolveHighlight: () => true,
      },
      {
        id: 'competitors',
        label: 'Competitors',
        groupId: 'market-intelligence',
        icon: Swords,
      },
      {
        id: 'trends',
        label: 'Trends',
        groupId: 'market-intelligence',
        icon: TrendingUp,
      },
    ],
  },
  {
    id: 'customer-service',
    label: 'CUSTOMER & SERVICE',
    items: [
      {
        id: 'service',
        label: 'Service Intelligence',
        groupId: 'customer-service',
        icon: ShieldAlert,
        resolveHighlight: () => true,
      },
      {
        id: 'voc',
        label: 'Voice of Customer',
        groupId: 'customer-service',
        icon: MessageSquareWarning,
        resolveHighlight: () => true,
      },
    ],
  },
  {
    id: 'analytics-data',
    label: 'ANALYTICS & DATA',
    items: [
      {
        id: 'analytics',
        label: 'Analytics',
        groupId: 'analytics-data',
        icon: BarChart3,
      },
      {
        id: 'backfill',
        label: 'Historical Backfill',
        groupId: 'analytics-data',
        icon: History,
        requiresManage: true,
      },
      {
        id: 'sources',
        label: 'Sources',
        groupId: 'analytics-data',
        icon: Database,
        resolveBadge: (ctx) => ctx.sourcesCount,
      },
    ],
  },
  {
    id: 'administration',
    label: 'ADMINISTRATION',
    items: [
      {
        id: 'reviews',
        label: 'Entity Reviews',
        groupId: 'administration',
        icon: ShieldCheck,
        requiresManage: true,
        resolveBadge: (ctx) => (ctx.pendingReviewsCount > 0 ? ctx.pendingReviewsCount : undefined),
        resolveHighlight: (ctx) => ctx.pendingReviewsCount > 0,
        isActionAlert: (ctx) => ctx.pendingReviewsCount > 0,
      },
      {
        id: 'settings',
        label: 'Settings',
        groupId: 'administration',
        icon: Settings,
      },
    ],
  },
];

export const ALL_NAVIGATION_GROUP_IDS: NavigationGroupId[] = NAVIGATION_GROUPS.map((g) => g.id);

/**
 * Finds the group ID that contains the given navigation tab.
 */
export function getGroupForTab(tab: NavigationTab): NavigationGroupId {
  for (const group of NAVIGATION_GROUPS) {
    if (group.items.some((item) => item.id === tab)) {
      return group.id;
    }
  }
  return 'workspace';
}

/**
 * Computes the initial expanded/collapsed state for all navigation groups.
 * - On first visit (no stored state): expands WORKSPACE and the group containing activeTab.
 * - When stored state exists: restores stored preferences and guarantees the group containing activeTab is expanded.
 */
export function getInitialExpandedGroups(
  activeTab: NavigationTab,
  storedJson?: string | null
): Record<NavigationGroupId, boolean> {
  const activeGroupId = getGroupForTab(activeTab);
  const defaultState: Record<NavigationGroupId, boolean> = {
    'workspace': true,
    'market-intelligence': activeGroupId === 'market-intelligence',
    'customer-service': activeGroupId === 'customer-service',
    'analytics-data': activeGroupId === 'analytics-data',
    'administration': activeGroupId === 'administration',
  };

  if (!storedJson) {
    return defaultState;
  }

  try {
    const parsed = JSON.parse(storedJson);
    if (parsed && typeof parsed === 'object') {
      const merged: Record<NavigationGroupId, boolean> = { ...defaultState };
      for (const groupId of ALL_NAVIGATION_GROUP_IDS) {
        if (typeof parsed[groupId] === 'boolean') {
          merged[groupId] = parsed[groupId];
        }
      }
      // Always ensure the group containing the currently active page is expanded on load
      merged[activeGroupId] = true;
      return merged;
    }
  } catch {
    // Ignore malformed localStorage JSON and fall back to defaultState
  }

  return defaultState;
}

/**
 * Ensures the group containing `activeTab` is marked expanded when navigating to a new page.
 */
export function ensureActiveGroupExpanded(
  currentState: Record<NavigationGroupId, boolean>,
  activeTab: NavigationTab
): Record<NavigationGroupId, boolean> {
  const activeGroupId = getGroupForTab(activeTab);
  if (currentState[activeGroupId]) {
    return currentState;
  }
  return {
    ...currentState,
    [activeGroupId]: true,
  };
}

/**
 * Resolves visible navigation groups and items based on user role (`canManage`),
 * badge counts, and current `activeTab`.
 */
export function getResolvedNavigationGroups(
  canManage: boolean,
  badgeContext: NavBadgeContext,
  activeTab: NavigationTab
): NavigationGroupResolved[] {
  return NAVIGATION_GROUPS.map((group) => {
    const visibleItems: NavigationItemResolved[] = group.items
      .filter((item) => !item.requiresManage || canManage)
      .map((item) => {
        const badge = item.resolveBadge ? item.resolveBadge(badgeContext) : undefined;
        const highlight = item.resolveHighlight ? item.resolveHighlight(badgeContext) : false;
        const hasActionAlert = item.isActionAlert ? item.isActionAlert(badgeContext) : false;
        return {
          ...item,
          badge,
          highlight,
          hasActionAlert,
        };
      });

    const activeItem = visibleItems.find((item) => item.id === activeTab);
    const containsActiveTab = Boolean(activeItem);
    const hasGroupHighlight = visibleItems.some((item) => Boolean(item.highlight));
    const actionAlertCount = visibleItems.reduce(
      (sum, item) => sum + (item.hasActionAlert && typeof item.badge === 'number' ? item.badge : 0),
      0
    );

    return {
      id: group.id,
      label: group.label,
      items: visibleItems,
      containsActiveTab,
      activeItem,
      hasGroupHighlight,
      actionAlertCount,
    };
  }).filter((group) => group.items.length > 0);
}

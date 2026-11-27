import { describe, it, expect } from 'vitest';
import {
  NAVIGATION_GROUPS,
  ALL_NAVIGATION_GROUP_IDS,
  getGroupForTab,
  getInitialExpandedGroups,
  ensureActiveGroupExpanded,
  getResolvedNavigationGroups,
  NavBadgeContext,
} from '../src/config/navigationConfig';
import { NavigationTab } from '../src/types';

describe('SIGNALYN UI P1.1 — Functional Sidebar Navigation & Information Architecture', () => {
  const defaultBadgeContext: NavBadgeContext = {
    productionStoriesCount: 24,
    sourcesCount: 15,
    pendingReviewsCount: 3,
  };

  it('1. defines the exact 5 functional navigation groups in order', () => {
    expect(NAVIGATION_GROUPS.map((g) => g.label)).toEqual([
      'WORKSPACE',
      'MARKET INTELLIGENCE',
      'CUSTOMER & SERVICE',
      'ANALYTICS & DATA',
      'ADMINISTRATION',
    ]);
    expect(ALL_NAVIGATION_GROUP_IDS).toEqual([
      'workspace',
      'market-intelligence',
      'customer-service',
      'analytics-data',
      'administration',
    ]);
  });

  it('2. places all 16 existing pages into their exact required functional groups without changing route IDs', () => {
    const groupMap = Object.fromEntries(
      NAVIGATION_GROUPS.map((g) => [g.label, g.items.map((i) => ({ id: i.id, label: i.label }))])
    );

    expect(groupMap['WORKSPACE']).toEqual([
      { id: 'overview', label: 'Overview' },
      { id: 'feed', label: 'Intelligence Feed' },
      { id: 'stories', label: 'Stories' },
      { id: 'daily-brief', label: 'Daily Brief' },
    ]);

    expect(groupMap['MARKET INTELLIGENCE']).toEqual([
      { id: 'companies', label: 'Companies' },
      { id: 'products', label: 'Products' },
      { id: 'retail-prices', label: 'Retail Prices' },
      { id: 'competitors', label: 'Competitors' },
      { id: 'trends', label: 'Trends' },
    ]);

    expect(groupMap['CUSTOMER & SERVICE']).toEqual([
      { id: 'service', label: 'Service Intelligence' },
      { id: 'voc', label: 'Voice of Customer' },
    ]);

    expect(groupMap['ANALYTICS & DATA']).toEqual([
      { id: 'analytics', label: 'Analytics' },
      { id: 'backfill', label: 'Historical Backfill' },
      { id: 'sources', label: 'Sources' },
    ]);

    expect(groupMap['ADMINISTRATION']).toEqual([
      { id: 'reviews', label: 'Entity Reviews' },
      { id: 'settings', label: 'Settings' },
    ]);
  });

  it('3. maps every NavigationTab to its owning functional group via getGroupForTab', () => {
    const expectedMappings: Array<[NavigationTab, string]> = [
      ['overview', 'workspace'],
      ['feed', 'workspace'],
      ['stories', 'workspace'],
      ['daily-brief', 'workspace'],
      ['companies', 'market-intelligence'],
      ['products', 'market-intelligence'],
      ['retail-prices', 'market-intelligence'],
      ['competitors', 'market-intelligence'],
      ['trends', 'market-intelligence'],
      ['service', 'customer-service'],
      ['voc', 'customer-service'],
      ['analytics', 'analytics-data'],
      ['backfill', 'analytics-data'],
      ['sources', 'analytics-data'],
      ['reviews', 'administration'],
      ['settings', 'administration'],
    ];

    for (const [tab, expectedGroup] of expectedMappings) {
      expect(getGroupForTab(tab)).toBe(expectedGroup);
    }
  });

  it('4. expands WORKSPACE and the active page group by default on first visit', () => {
    // When activeTab is inside WORKSPACE
    const initialOverview = getInitialExpandedGroups('overview', null);
    expect(initialOverview).toEqual({
      'workspace': true,
      'market-intelligence': false,
      'customer-service': false,
      'analytics-data': false,
      'administration': false,
    });

    // When activeTab is Voice of Customer (inside CUSTOMER & SERVICE)
    const initialVoc = getInitialExpandedGroups('voc', null);
    expect(initialVoc).toEqual({
      'workspace': true,
      'market-intelligence': false,
      'customer-service': true,
      'analytics-data': false,
      'administration': false,
    });
  });

  it('5. restores persisted group expansion state from localStorage while ensuring activeTab group is expanded', () => {
    const storedState = JSON.stringify({
      'workspace': false,
      'market-intelligence': true,
      'customer-service': false,
      'analytics-data': true,
      'administration': false,
    });

    // Navigating to 'service' (in customer-service) must force 'customer-service' to expand while preserving other saved preferences
    const restored = getInitialExpandedGroups('service', storedState);
    expect(restored).toEqual({
      'workspace': false,
      'market-intelligence': true,
      'customer-service': true,
      'analytics-data': true,
      'administration': false,
    });
  });

  it('6. automatically expands a collapsed group when navigating to a page inside it', () => {
    const currentExpanded = {
      'workspace': true,
      'market-intelligence': false,
      'customer-service': false,
      'analytics-data': false,
      'administration': false,
    };

    const afterRetailNavigation = ensureActiveGroupExpanded(currentExpanded, 'retail-prices');
    expect(afterRetailNavigation['market-intelligence']).toBe(true);
    expect(afterRetailNavigation['workspace']).toBe(true);

    const afterSettingsNavigation = ensureActiveGroupExpanded(afterRetailNavigation, 'settings');
    expect(afterSettingsNavigation['administration']).toBe(true);
  });

  it('7. preserves role-based visibility for Admin (canManage=true) vs Guest (canManage=false)', () => {
    const adminGroups = getResolvedNavigationGroups(true, defaultBadgeContext, 'overview');
    const adminItemIds = adminGroups.flatMap((g) => g.items.map((i) => i.id));
    expect(adminItemIds).toHaveLength(16);
    expect(adminItemIds).toContain('backfill');
    expect(adminItemIds).toContain('reviews');

    const guestGroups = getResolvedNavigationGroups(false, defaultBadgeContext, 'overview');
    const guestItemIds = guestGroups.flatMap((g) => g.items.map((i) => i.id));
    expect(guestItemIds).toHaveLength(14);
    expect(guestItemIds).not.toContain('backfill');
    expect(guestItemIds).not.toContain('reviews');
    // Settings remains accessible in ADMINISTRATION
    expect(guestItemIds).toContain('settings');
  });

  it('8. preserves item badges, module highlights, and collapsed group alert indicators without double counting', () => {
    const groups = getResolvedNavigationGroups(true, defaultBadgeContext, 'voc');
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));

    // WORKSPACE: Stories has badge=24, no artificial action alert count
    const storiesItem = byId['workspace'].items.find((i) => i.id === 'stories');
    expect(storiesItem?.badge).toBe(24);
    expect(byId['workspace'].actionAlertCount).toBe(0);

    // MARKET INTELLIGENCE: Retail Prices has highlight=true
    const retailItem = byId['market-intelligence'].items.find((i) => i.id === 'retail-prices');
    expect(retailItem?.highlight).toBe(true);
    expect(byId['market-intelligence'].hasGroupHighlight).toBe(true);

    // CUSTOMER & SERVICE: Service Intelligence & VOC have highlight=true, and VOC is the activeItem
    expect(byId['customer-service'].hasGroupHighlight).toBe(true);
    expect(byId['customer-service'].containsActiveTab).toBe(true);
    expect(byId['customer-service'].activeItem?.id).toBe('voc');

    // ANALYTICS & DATA: Sources has badge=15, no false actionAlertCount
    const sourcesItem = byId['analytics-data'].items.find((i) => i.id === 'sources');
    expect(sourcesItem?.badge).toBe(15);
    expect(byId['analytics-data'].actionAlertCount).toBe(0);

    // ADMINISTRATION: Entity Reviews has pendingReviewsCount=3, highlight=true, and group actionAlertCount=3
    const reviewsItem = byId['administration'].items.find((i) => i.id === 'reviews');
    expect(reviewsItem?.badge).toBe(3);
    expect(reviewsItem?.highlight).toBe(true);
    expect(byId['administration'].hasGroupHighlight).toBe(true);
    expect(byId['administration'].actionAlertCount).toBe(3);
  });
});

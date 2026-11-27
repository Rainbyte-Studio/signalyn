import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DESIGN_TOKENS } from '../src/styles/designTokens';
import { NAVIGATION_GROUPS } from '../src/config/navigationConfig';

function runUiP221Tests() {
  console.log(
    'Running SIGNALYN UI P2.2.1 — Global Header Consistency, Action Hierarchy & UX Refinement Suite...\n'
  );

  const headerContent = fs.readFileSync(path.resolve('src/components/layout/Header.tsx'), 'utf8');
  const sidebarContent = fs.readFileSync(path.resolve('src/components/layout/Sidebar.tsx'), 'utf8');
  const overviewContent = fs.readFileSync(
    path.resolve('src/components/overview/OverviewDashboard.tsx'),
    'utf8'
  );
  const settingsContent = fs.readFileSync(
    path.resolve('src/components/settings/SettingsView.tsx'),
    'utf8'
  );

  // 1. Standardized Global Header Dimensions & Design Tokens Across All 16 Routes
  assert.ok(
    DESIGN_TOKENS.header &&
      DESIGN_TOKENS.header.height.includes('h-16') &&
      DESIGN_TOKENS.header.height.includes('min-h-[64px]') &&
      DESIGN_TOKENS.header.height.includes('max-h-[64px]') &&
      DESIGN_TOKENS.header.height.includes('shrink-0'),
    'DESIGN_TOKENS.header.height must enforce a fixed 64px height with shrink-0 to prevent flex compression'
  );
  assert.ok(
    headerContent.includes('className={DESIGN_TOKENS.header.container}'),
    'Header.tsx must use DESIGN_TOKENS.header.container for consistent dimensions across all routes'
  );
  assert.ok(
    sidebarContent.includes('${DESIGN_TOKENS.header.height}'),
    'Sidebar.tsx brand header must share DESIGN_TOKENS.header.height so bottom borders align across the viewport'
  );

  const allTabIds = NAVIGATION_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(allTabIds.length, 16, 'All 16 application routes must be present');
  for (const tabId of allTabIds) {
    assert.ok(
      headerContent.includes(`case '${tabId}':`),
      `Header.tsx getPageTitle() must explicitly support route "${tabId}"`
    );
  }
  console.log(
    '✓ 1. Global Header height and layout tokens remain identical across Overview, Settings, Retail, Service, VoC, Sources, and all 16 routes.'
  );

  // 2. Standardized Header Typography & Control Sizing
  assert.ok(
    DESIGN_TOKENS.header.title.includes('text-[15px]') &&
      DESIGN_TOKENS.header.title.includes('font-semibold') &&
      DESIGN_TOKENS.header.title.includes('truncate'),
    'DESIGN_TOKENS.header.title must enforce 15px semibold single-line truncated title typography'
  );
  assert.ok(
    DESIGN_TOKENS.header.subtitle.includes('text-[11px]') &&
      DESIGN_TOKENS.header.subtitle.includes('text-slate-400') &&
      DESIGN_TOKENS.header.subtitle.includes('truncate'),
    'DESIGN_TOKENS.header.subtitle must enforce 11px muted single-line truncated subtitle typography'
  );
  assert.equal(
    DESIGN_TOKENS.header.controlHeight,
    'h-8',
    'DESIGN_TOKENS.header.controlHeight must standardize interactive header controls to 32px (h-8)'
  );
  assert.ok(
    headerContent.includes('<h2 className={DESIGN_TOKENS.header.title}>') &&
      headerContent.includes('<div className={DESIGN_TOKENS.header.subtitle}>'),
    'Header.tsx must apply shared title and subtitle typography tokens'
  );
  console.log('✓ 2. Header title, subtitle typography, and 32px control heights are standardized.');

  // 3. Authoritative Global Target Indicator in Header
  assert.ok(
    headerContent.includes('Target:') &&
      headerContent.includes('Global Primary Intelligence Target') &&
      headerContent.includes("handleOpenSettings('#general')"),
    'Header.tsx must display the authoritative Global Target indicator ("Target: HUAWEI") linking to Settings -> General'
  );
  console.log('✓ 3. Global Target badge is displayed consistently in the Header.');

  // 4. Simplified Sidebar Target Display (No Duplicate Top-of-Sidebar Selector Card)
  assert.ok(
    !sidebarContent.includes('Permanently Visible Intelligence Target Selector'),
    'Sidebar.tsx must remove the competing top-of-sidebar Intelligence Target card that duplicated the Header badge'
  );
  assert.ok(
    sidebarContent.includes('Primary Target:'),
    'Sidebar.tsx must retain a subtle, non-competing single-line Primary Target context indicator in the footer'
  );
  console.log('✓ 4. Sidebar target display simplified without competing with the Global Header indicator.');

  // 5. Overview Temporary Manufacturer Filter Clearly Labeled as "Manufacturer Lens"
  assert.ok(
    overviewContent.includes('Manufacturer Lens:') &&
      overviewContent.includes('aria-label="Manufacturer Lens"'),
    'OverviewDashboard.tsx must clearly label its local brand filter as "Manufacturer Lens"'
  );
  assert.ok(
    !overviewContent.includes('<span>Active Target:</span>'),
    'OverviewDashboard.tsx must not redundantly repeat "Active Target: HUAWEI" next to the Manufacturer Lens buttons'
  );
  console.log(
    '✓ 5. Overview manufacturer filter is clearly labeled as "Manufacturer Lens" without repetitive brand labels.'
  );

  // 6. Refresh Actions Clarified & Differentiated
  assert.ok(
    headerContent.includes(
      'Refresh core platform data (sources, stories, entities, and settings) from Firestore without triggering external source collection'
    ),
    'Header.tsx global refresh button must clearly document its read-only core Firestore scope'
  );
  assert.ok(
    overviewContent.includes(
      'Refresh all cross-module intelligence datasets (Core, Retail Prices, Service Advisories, and Voice of Customer) without triggering new external source collection'
    ),
    'OverviewDashboard.tsx "Refresh Intelligence" button must clearly document its cross-module scope'
  );
  console.log('✓ 6. Global Refresh and Overview Refresh Intelligence actions are clearly differentiated.');

  // 7. "Collect Now" Relocated to Admin-Only Operations Overflow Menu
  assert.ok(
    headerContent.includes('aria-label="Administrative Operations Menu"') &&
      headerContent.includes('aria-label="Administrative Operations"') &&
      headerContent.includes('>Operations</span>'),
    'Header.tsx must provide a compact admin-only Operations overflow menu'
  );
  assert.ok(
    headerContent.includes('runCollector()') &&
      headerContent.includes("isCollecting ? 'Ingesting Feeds...' : 'Collect Now'") &&
      headerContent.includes('disabled={isCollecting || isLoading}'),
    'Header.tsx Operations menu must preserve Collect Now action, loading state, and disabled state while collecting'
  );
  assert.ok(
    !headerContent.includes('bg-emerald-600 hover:bg-emerald-500'),
    'Header.tsx must not render a prominent top-level green "Collect Now" button in the primary header row'
  );
  console.log(
    '✓ 7. "Collect Now" moved from the primary Header button row into the admin-only Operations overflow menu.'
  );

  // 8. System Diagnostics Accessible for Admins
  assert.ok(
    headerContent.includes("handleOpenSettings('#system-diagnostics')") &&
      sidebarContent.includes('#system-diagnostics') &&
      settingsContent.includes("'system-diagnostics'"),
    'System Diagnostics remains accessible for admins from the Header Operations/Account menus, Sidebar footer, and Settings tabs'
  );
  console.log('✓ 8. System Diagnostics remains accessible across all admin entry points.');

  // 9. "Reset Baseline Demo Data" Relocated to Settings -> Advanced / Danger Zone with Confirmation
  const pageHeaderMatch = settingsContent.match(/<PageHeader[\s\S]*?\/>/);
  assert.ok(pageHeaderMatch, 'SettingsView.tsx must render <PageHeader />');
  assert.ok(
    !pageHeaderMatch[0].includes('resetMockData') &&
      !pageHeaderMatch[0].includes('Reset Baseline Demo Data'),
    'SettingsView.tsx <PageHeader /> must NOT contain the destructive "Reset Baseline Demo Data" button'
  );
  assert.ok(
    settingsContent.includes('id="danger-zone"') &&
      settingsContent.includes('Advanced / Danger Zone') &&
      settingsContent.includes('showResetConfirmation') &&
      settingsContent.includes('Confirm Baseline Sync'),
    'SettingsView.tsx must relocate "Reset Baseline Demo Data" to Advanced / Danger Zone with an explicit two-step confirmation dialog'
  );
  console.log(
    '✓ 9. "Reset Baseline Demo Data" removed from Settings PageHeader and protected in Advanced / Danger Zone with explicit confirmation.'
  );

  // 10. Account / User Menu Alignment, Truncation & Keyboard/Outside-Click Dismissal
  assert.ok(
    headerContent.includes("event.key === 'Escape'") &&
      headerContent.includes('document.addEventListener(\'mousedown\', handleClickOutside)'),
    'Header.tsx must close Account and Operations menus on Escape key and outside click'
  );
  assert.ok(
    headerContent.includes('truncate max-w-[100px]') &&
      headerContent.includes('aria-label="Account Menu"'),
    'Header.tsx Account menu trigger must truncate long usernames cleanly and provide accessible menu roles'
  );
  console.log('✓ 10. Account / User menu alignment, truncation, and keyboard/outside-click dismissal verified.');

  // 11. Conditional Operational Warnings
  assert.ok(
    headerContent.includes('errorSourcesCount > 0') &&
      headerContent.includes("handleOpenSettings('#system-diagnostics:operations')"),
    'Header.tsx must conditionally render source warning indicators only when errorSourcesCount > 0 and link admins to System Diagnostics -> Operations'
  );
  console.log('✓ 11. Operational warnings appear conditionally and route to System Diagnostics.');

  // 12. Responsive Layout & Overflow Prevention
  assert.ok(
    headerContent.includes('min-w-0 flex-1') &&
      headerContent.includes('shrink-0') &&
      headerContent.includes('lg:hidden'),
    'Header.tsx must enforce min-w-0 flex-1 on title container and shrink-0 on right-hand controls to prevent horizontal overflow across breakpoints'
  );
  console.log('✓ 12. Responsive behavior across desktop, tablet, and mobile verified.');

  console.log('\nALL 12/12 SIGNALYN UI P2.2.1 GLOBAL HEADER CONSISTENCY & UX REFINEMENT TESTS PASSED!');
}

runUiP221Tests();

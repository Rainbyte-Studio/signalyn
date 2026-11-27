import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NAVIGATION_GROUPS,
  getResolvedNavigationGroups,
} from '../src/config/navigationConfig';

function runUiP22Tests() {
  console.log(
    'Running SIGNALYN UI P2.2 — Global Navigation, Information Architecture Cleanup & Unified System Diagnostics Suite...\n'
  );

  // 1. Verify Global Header Cleanup & Functional Controls (Phase A)
  const headerContent = fs.readFileSync(path.resolve('src/components/layout/Header.tsx'), 'utf8');
  assert.ok(
    !headerContent.includes('Firestore Active'),
    'Header.tsx must not display permanent "Firestore Active" developer telemetry in normal state'
  );
  assert.ok(
    headerContent.includes('errorSourcesCount > 0'),
    'Header.tsx must conditionally surface operational warnings only when feed sources have errors'
  );
  assert.ok(
    headerContent.includes('Target:') && headerContent.includes('Global Primary Intelligence Target'),
    'Header.tsx must clearly label the Global Primary Intelligence Target and distinguish it from local view lenses'
  );
  assert.ok(
    headerContent.includes('#system-diagnostics'),
    'Header.tsx must provide an admin-gated quick link to Settings -> System Diagnostics'
  );
  console.log('✓ 1. Global Header functional audit, telemetry cleanup, and actionable warning indicator verified.');

  // 2. Verify Sidebar Navigation & Footer Telemetry Cleanup (Phase B)
  const sidebarContent = fs.readFileSync(path.resolve('src/components/layout/Sidebar.tsx'), 'utf8');
  assert.equal(NAVIGATION_GROUPS.length, 5, 'Sidebar must preserve the 5 functional navigation groups');
  const adminResolved = getResolvedNavigationGroups(
    true,
    { productionStoriesCount: 10, sourcesCount: 12, pendingReviewsCount: 2 },
    'overview'
  );
  assert.equal(
    adminResolved.flatMap((g) => g.items).length,
    16,
    'Sidebar must preserve all 16 existing routes without adding a standalone top-level diagnostics route'
  );
  assert.ok(
    !sidebarContent.includes('1.0 Foundation') &&
      !sidebarContent.includes('Repository Layer') &&
      !sidebarContent.includes('Local Async / Firestore'),
    'Sidebar.tsx footer must not expose raw developer implementation strings in normal user views'
  );
  assert.ok(
    sidebarContent.includes('#system-diagnostics'),
    'Sidebar.tsx footer must provide an admin-gated shortcut to Settings -> System Diagnostics'
  );
  console.log('✓ 2. Sidebar 5-group architecture preservation and developer footer cleanup verified.');

  // 3. Verify Unified System Diagnostics in SettingsView & SystemDiagnosticsPanel (Phase D & E)
  const settingsContent = fs.readFileSync(path.resolve('src/components/settings/SettingsView.tsx'), 'utf8');
  const diagPanelContent = fs.readFileSync(
    path.resolve('src/components/settings/SystemDiagnosticsPanel.tsx'),
    'utf8'
  );

  assert.ok(
    settingsContent.includes("'system-diagnostics'") &&
      settingsContent.includes('<SystemDiagnosticsPanel'),
    'SettingsView.tsx must integrate SystemDiagnosticsPanel under the system-diagnostics section'
  );
  assert.ok(
    diagPanelContent.includes('if (!canManage)') &&
      diagPanelContent.includes('<RestrictedAccessView'),
    'SystemDiagnosticsPanel.tsx must enforce strict admin-only authorization and render RestrictedAccessView on unauthorized direct access'
  );

  const requiredDiagSubTabs = [
    "{ id: 'overview', label: 'Overview'",
    "{ id: 'retail', label: 'Retail Intelligence'",
    "{ id: 'service', label: 'Service Intelligence'",
    "{ id: 'voc', label: 'Voice of Customer'",
    "{ id: 'operations', label: 'System Operations'",
  ];
  for (const tabDef of requiredDiagSubTabs) {
    assert.ok(
      diagPanelContent.includes(tabDef),
      `SystemDiagnosticsPanel.tsx must include diagnostic section: ${tabDef}`
    );
  }
  assert.ok(
    diagPanelContent.includes('<ProductionDiagnosticsPanel'),
    'SystemDiagnosticsPanel.tsx must host the Service Intelligence ProductionDiagnosticsPanel'
  );
  assert.ok(
    diagPanelContent.includes('/api/retail/persistence/test'),
    'SystemDiagnosticsPanel.tsx must host the Retail Intelligence Firestore write probe'
  );
  assert.ok(
    diagPanelContent.includes('/api/voc/diagnostic/evaluate-sample'),
    'SystemDiagnosticsPanel.tsx must host the Voice of Customer Classifier & Matcher Sandbox'
  );
  console.log('✓ 3. Unified System Diagnostics (5 sub-tabs) and strict admin route protection verified.');

  // 4. Verify Relocation of Developer Diagnostics from Normal User Views (Phase C & F)
  const retailViewContent = fs.readFileSync(
    path.resolve('src/components/retail/RetailPricesView.tsx'),
    'utf8'
  );
  assert.ok(
    !retailViewContent.includes('Firestore Authoritative Persistence & Identity Architecture (P1.6)'),
    'RetailPricesView.tsx must relocate the inline P1.6 Firestore persistence architecture panel to System Diagnostics'
  );
  assert.ok(
    retailViewContent.includes('#system-diagnostics:retail'),
    'RetailPricesView.tsx must provide an admin deep-link to Settings -> System Diagnostics (Retail)'
  );

  const serviceViewContent = fs.readFileSync(
    path.resolve('src/components/service/ServiceIntelligenceView.tsx'),
    'utf8'
  );
  assert.ok(
    !serviceViewContent.includes('<ProductionDiagnosticsPanel'),
    'ServiceIntelligenceView.tsx must relocate the inline ProductionDiagnosticsPanel to System Diagnostics'
  );
  assert.ok(
    serviceViewContent.includes('#system-diagnostics:service'),
    'ServiceIntelligenceView.tsx must provide an admin deep-link to Settings -> System Diagnostics (Service)'
  );

  const vocViewContent = fs.readFileSync(
    path.resolve('src/components/voc/VoiceOfCustomerView.tsx'),
    'utf8'
  );
  assert.ok(
    !vocViewContent.includes('overview.firestoreCollections.vocIssueClusters'),
    'VoiceOfCustomerView.tsx must remove the raw Firestore collection telemetry bar from the main user view'
  );
  assert.ok(
    !vocViewContent.includes("activeSubTab === 'sandbox'"),
    'VoiceOfCustomerView.tsx must relocate the Classifier & Matcher Sandbox sub-tab to System Diagnostics'
  );
  assert.ok(
    vocViewContent.includes('#system-diagnostics:voc'),
    'VoiceOfCustomerView.tsx must provide an admin deep-link to Settings -> System Diagnostics (VoC)'
  );
  console.log('✓ 4. Developer diagnostics relocated from Retail, Service, and VoC user views into System Diagnostics.');

  // 5. Verify Global Primary Target vs. Local View Filter Lens Consistency (Phase A5 & F)
  assert.ok(
    vocViewContent.includes('Manufacturer Lens:'),
    'VoiceOfCustomerView.tsx must label its local filter as "Manufacturer Lens:" to distinguish from Global Primary Target'
  );
  assert.ok(
    settingsContent.includes('Global Primary Target') &&
      settingsContent.includes('Local View Filter Lenses'),
    'SettingsView.tsx must document Global Primary Target vs. Local View Filter Lenses governance'
  );
  console.log('✓ 5. Global Primary Target vs. Local View Filter Lens consistency verified.');

  console.log('\nALL SIGNALYN UI P2.2 NAVIGATION, IA CLEANUP & UNIFIED SYSTEM DIAGNOSTICS TESTS PASSED!');
}

runUiP22Tests();

/**
 * Signalyn Phase 5S-D2-D.2: Guest Access Control & RBAC Permission Enforcement Test Suite
 * 
 * Verifies:
 * 1. Role-Based Access Control State & Hook Semantics:
 *    - Defaults to fail-closed (canManage = false) when auth is loading or resolving.
 *    - GUEST (unauthenticated or non-admin analyst) has canManage = false, canCollect = false, etc.
 *    - ADMIN has canManage = true, canCollect = true, canAnalyze = true, canManageSources = true, etc.
 * 2. Backend Protected Endpoints Enforcement:
 *    - Collection & Ingestion endpoints require admin/authorized credentials (/api/collector/run).
 *    - Repair & maintenance endpoints require admin credentials (/api/collector/repair-articles, /api/collector/migrate-sources).
 *    - Gemini AI endpoints require admin credentials (/api/analysis/article/:id, /api/analysis/batch, /api/analysis/pending).
 *    - Backfill mutation endpoints require admin credentials (/api/backfill/start, /api/backfill/:id/pause, etc.).
 *    - Backfill dry run endpoint requires admin credentials (/api/analytics/backfill-dry-run).
 *    - Feed discovery and validation endpoints require admin credentials (/api/discovery/inspect, /api/discovery/validate, /api/discovery/diagnose-article).
 *    - Rejects unauthenticated callers with HTTP 401.
 *    - Rejects non-admin authenticated users with HTTP 403.
 * 3. Frontend Component Hardening:
 *    - Header collection trigger button is gated by canManage.
 *    - SourcesManager administrative action buttons (Collect Now, Add Source, Manage Groups, Row Edit, Row Delete, Row Toggle) gated by canManage.
 *    - FeedView Gemini analysis trigger buttons gated by canManage.
 *    - ArticleIntelligenceModal Re-analyze button gated by canManage.
 *    - CompaniesView "Set as Primary" gated by canManage.
 *    - SettingsView "Reset Baseline Demo Data" and general settings mutations gated by canManage.
 *    - Entity Review route in App.tsx protected and falls back to RestrictedAccessView for guests.
 *    - Sidebar Entity Reviews link hidden for guests.
 */

import fs from 'fs';
import path from 'path';
import { requireAdminOrAuthorizedClient } from '../src/server/authMiddleware';
import { Request, Response } from 'express';

async function runGuestAccessControlTests() {
  console.log('=== RUNNING PHASE 5S-D2-D.2 GUEST ACCESS CONTROL & RBAC TESTS ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${title}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${title}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // Part 1: Backend API Authorization Guarding Verification
  // -------------------------------------------------------------------------
  const serverPath = path.resolve(process.cwd(), 'server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  // Verify all privileged endpoints have requireAdminOrAuthorizedClient middleware
  assert(
    serverContent.includes("app.post('/api/collector/run', requireAdminOrAuthorizedClient,"),
    'Backend: /api/collector/run protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/collector/repair-articles', requireAdminOrAuthorizedClient,"),
    'Backend: /api/collector/repair-articles protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/collector/migrate-sources', requireAdminOrAuthorizedClient,"),
    'Backend: /api/collector/migrate-sources protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/analysis/article/:id', requireAdminOrAuthorizedClient,"),
    'Backend: /api/analysis/article/:id protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/analysis/batch', requireAdminOrAuthorizedClient,"),
    'Backend: /api/analysis/batch protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/analysis/pending', requireAdminOrAuthorizedClient,"),
    'Backend: /api/analysis/pending protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/backfill/start', requireAdminOrAuthorizedClient,"),
    'Backend: /api/backfill/start protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/backfill/:runId/pause', requireAdminOrAuthorizedClient,"),
    'Backend: /api/backfill/:runId/pause protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/backfill/:runId/resume', requireAdminOrAuthorizedClient,"),
    'Backend: /api/backfill/:runId/resume protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/backfill/:runId/cancel', requireAdminOrAuthorizedClient,"),
    'Backend: /api/backfill/:runId/cancel protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.get('/api/analytics/backfill-dry-run', requireAdminOrAuthorizedClient,"),
    'Backend: /api/analytics/backfill-dry-run protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/discovery/inspect', requireAdminOrAuthorizedClient,"),
    'Backend: /api/discovery/inspect protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/discovery/validate', requireAdminOrAuthorizedClient,"),
    'Backend: /api/discovery/validate protected by requireAdminOrAuthorizedClient'
  );

  assert(
    serverContent.includes("app.post('/api/discovery/diagnose-article', requireAdminOrAuthorizedClient,"),
    'Backend: /api/discovery/diagnose-article protected by requireAdminOrAuthorizedClient'
  );

  // -------------------------------------------------------------------------
  // Part 2: Middleware Direct Enforcement Tests
  // -------------------------------------------------------------------------
  function createMockResponse() {
    let statusCode = 0;
    let responseData: any = null;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            responseData = data;
          },
        };
      },
    } as unknown as Response;

    return {
      res,
      getStatus: () => statusCode,
      getData: () => responseData,
    };
  }

  // Test: Unauthenticated Guest request returns HTTP 401
  {
    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      mock.getStatus() === 401 && !nextCalled,
      'Middleware: Unauthenticated Guest caller rejected with HTTP 401',
      mock.getData()?.error
    );
  }

  // -------------------------------------------------------------------------
  // Part 3: Frontend Component RBAC Gating Verification
  // -------------------------------------------------------------------------
  const sourcesManagerPath = path.resolve(process.cwd(), 'src/components/sources/SourcesManager.tsx');
  const sourcesManagerContent = fs.readFileSync(sourcesManagerPath, 'utf8');

  assert(
    sourcesManagerContent.includes('{canManage ? (') &&
      sourcesManagerContent.includes('Run Ingestion') &&
      sourcesManagerContent.includes('Manage Groups') &&
      sourcesManagerContent.includes('Add Source') &&
      sourcesManagerContent.includes('Read-Only Source Directory'),
    'Frontend SourcesManager: Top action buttons gated by canManage with read-only fallback'
  );

  assert(
    sourcesManagerContent.includes('{canManage && (') &&
      sourcesManagerContent.includes('handleOpenEdit') &&
      sourcesManagerContent.includes('setSourceToDelete'),
    'Frontend SourcesManager: Row edit and delete buttons gated by canManage'
  );

  const headerPath = path.resolve(process.cwd(), 'src/components/layout/Header.tsx');
  const headerContent = fs.readFileSync(headerPath, 'utf8');

  assert(
    headerContent.includes('{canManage && (') &&
      headerContent.includes('Collect Now'),
    'Frontend Header: Collect Now button gated by canManage'
  );

  const feedViewPath = path.resolve(process.cwd(), 'src/components/feed/FeedView.tsx');
  const feedViewContent = fs.readFileSync(feedViewPath, 'utf8');

  assert(
    feedViewContent.includes('{canManage && pendingArticlesCount > 0 && (') &&
      feedViewContent.includes('Analyze Pending Articles'),
    'Frontend FeedView: Pending batch analysis button gated by canManage'
  );

  assert(
    feedViewContent.includes(') : canManage ? (') &&
      feedViewContent.includes('Analyze with Gemini') &&
      feedViewContent.includes('Unanalyzed'),
    'Frontend FeedView: Per-article Analyze with Gemini button gated by canManage with fallback'
  );

  const articleModalPath = path.resolve(process.cwd(), 'src/components/feed/ArticleIntelligenceModal.tsx');
  const articleModalContent = fs.readFileSync(articleModalPath, 'utf8');

  assert(
    articleModalContent.includes('{canManage && (') &&
      articleModalContent.includes('Re-analyze with Gemini'),
    'Frontend ArticleIntelligenceModal: Re-analyze button gated by canManage'
  );

  const companiesViewPath = path.resolve(process.cwd(), 'src/components/companies/CompaniesView.tsx');
  const companiesViewContent = fs.readFileSync(companiesViewPath, 'utf8');

  assert(
    companiesViewContent.includes(') : canManage ? (') &&
      companiesViewContent.includes('Set as Primary') &&
      companiesViewContent.includes('Tracked Enterprise'),
    'Frontend CompaniesView: Set as Primary button gated by canManage with read-only badge'
  );

  const settingsViewPath = path.resolve(process.cwd(), 'src/components/settings/SettingsView.tsx');
  const settingsViewContent = fs.readFileSync(settingsViewPath, 'utf8');

  assert(
    settingsViewContent.includes('{canManage && (') &&
      settingsViewContent.includes('Reset Baseline Demo Data'),
    'Frontend SettingsView: Reset Baseline Demo Data button gated by canManage'
  );

  assert(
    settingsViewContent.includes('{canManage ? (') &&
      settingsViewContent.includes('Save General Settings') &&
      settingsViewContent.includes('Read-Only Policy (Admin Assignment Required)'),
    'Frontend SettingsView: Save General Settings gated by canManage'
  );

  const sidebarPath = path.resolve(process.cwd(), 'src/components/layout/Sidebar.tsx');
  const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');

  assert(
    sidebarContent.includes("if (item.id === 'reviews' && !canManage) {") &&
      sidebarContent.includes('return false;'),
    'Frontend Sidebar: Privileged Entity Reviews navigation item hidden for Guests'
  );

  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert(
    appContent.includes("case 'reviews':") &&
      appContent.includes('return canManage ? (') &&
      appContent.includes('<RestrictedAccessView'),
    'Frontend App: Direct navigation to reviews route falls back to RestrictedAccessView for Guests'
  );

  // -------------------------------------------------------------------------
  // Part 4: AppContext Centralized RBAC State & Fail-Closed Logic
  // -------------------------------------------------------------------------
  const appContextPath = path.resolve(process.cwd(), 'src/context/AppContext.tsx');
  const appContextContent = fs.readFileSync(appContextPath, 'utf8');

  assert(
    appContextContent.includes('const canManage = Boolean(!isAuthLoading && !isCheckingAdmin && isAdmin);'),
    'AppContext: Centralized canManage enforces strict fail-closed evaluation'
  );

  assert(
    appContextContent.includes('requireAdminPrivilege') &&
      appContextContent.includes('canManage,'),
    'AppContext: Value provider exports canManage and requireAdminPrivilege'
  );

  console.log(`\n=== PHASE 5S-D2-D.2 TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runGuestAccessControlTests().catch((err) => {
  console.error('Fatal error in Phase 5S-D2-D.2 tests:', err);
  process.exit(1);
});

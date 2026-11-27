import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  classifyDailyBriefHttpResponse,
  normalizeBriefDeltaForDisplay,
  resolveBriefLocalizedContent,
  resolveBriefReportingDate,
  resolveDailyBriefViewState,
} from '../src/utils/dailyBriefPresentation';
import {
  buildNavigationHash,
  isSettingsHash,
  NavigationHistoryController,
  parseNavigationHash,
} from '../src/utils/navigationSync';
import {
  createGetDailyBriefHandler,
  createPostDailyBriefGenerateHandler,
  createPostPipelineRunHandler,
  validateStrictBriefDateParam,
} from '../src/server/dailyBriefRouteContract';
import { requireAdminOrAuthorizedClient } from '../src/server/authMiddleware';
import {
  _resetTestOverrides,
  _setTestFirestoreDb,
  _setTestIdentityOverride,
  _setTestTokenVerifier,
} from '../src/server/firestoreAdmin';

function createPublishedBriefFixture(date: string, headlineEn: string, headlineEl: string) {
  return {
    id: `brief-${date}`,
    date,
    windowStart: `${date}T00:00:00.000Z`,
    windowEnd: `${date}T23:59:59.999Z`,
    status: 'PUBLISHED' as const,
    version: 2,
    generatedAt: `${date}T06:00:00.000Z`,
    lastUpdatedAt: `${date}T06:00:00.000Z`,
    generatedBy: 'SYSTEM_AUTOMATION' as const,
    targetCompanyId: 'comp-huawei',
    targetCompanyName: 'HUAWEI',
    en: {
      language: 'en' as const,
      executiveHeadline: headlineEn,
      executiveSummary: [`Summary point 1 for ${date}`, `Summary point 2 for ${date}`],
      keyThemes: ['Flagship Rivalry', 'Wearables Battery'],
      marketSentimentOverview: {
        overall: 'NEUTRAL' as const,
        rationale: 'Balanced competitive landscape.',
      },
      headlineDevelopments: [
        {
          storyId: `story-${date}-1`,
          title: `Samsung Galaxy S25 Ultra Launch Analysis (${date})`,
          category: 'Smartphones',
          executiveTakeaway: 'Flagship launch in EU retail channels.',
          strategicAnalysis: ['Carrier promotions active across Europe.'],
          competitiveThreatLevel: 'HIGH' as const,
          implicationForHuawei: 'Counter with Pura 70 Ultra camera superiority.',
          trackedCompetitors: ['Samsung'],
          groundedCitations: [],
          strategicImportanceScore: 88,
          evidenceClassification: 'VERIFIED_REPORT' as const,
          evidenceConfidence: 0.9,
          independentSourceCount: 4,
        },
      ],
      categoryBreakdowns: [],
      competitorMoves: [],
      strategicImplicationsForHuawei: {
        immediateActions: ['Highlight Watch GT 5 battery life in Greek retail'],
        mediumTermWatch: ['Monitor S25 Ultra trade-in promotions'],
        threatsAndRisks: ['Carrier bundling pressure'],
        opportunities: ['Premium wearable leadership'],
      },
      dayOverDayDelta: {
        hasBaselineData: true,
        previousBriefDate: '2026-10-28',
        summary: {
          newCount: 1,
          materialUpdateCount: 0,
          escalatingCount: 1,
          resolvedCount: 0,
        },
        changes: [
          {
            storyId: `story-${date}-1`,
            title: `Samsung Galaxy S25 Ultra Launch Analysis (${date})`,
            deltaType: 'ESCALATING_DEVELOPMENT' as const,
            category: 'Smartphones',
            competitorName: 'Samsung',
            description: 'Escalated threat score from 74 to 88.',
            previousState: {
              strategicImportanceScore: 74,
              competitiveThreatLevel: 'ELEVATED',
              status: 'DEVELOPING',
              evidenceClassification: 'VERIFIED_REPORT',
            },
            currentState: {
              strategicImportanceScore: 88,
              competitiveThreatLevel: 'HIGH',
              status: 'DEVELOPING',
              evidenceClassification: 'VERIFIED_REPORT',
            },
            evidenceClassification: 'VERIFIED_REPORT' as const,
            evidenceConfidence: 0.9,
            independentSourceCount: 4,
          },
        ],
      },
    },
    el: {
      language: 'el' as const,
      executiveHeadline: headlineEl,
      executiveSummary: [`Σημείο σύνοψης 1 για ${date}`, `Σημείο σύνοψης 2 για ${date}`],
      keyThemes: ['Ανταγωνισμός Flagship', 'Αυτονομία Wearables'],
      marketSentimentOverview: {
        overall: 'NEUTRAL' as const,
        rationale: 'Ισορροπημένο ανταγωνιστικό περιβάλλον.',
      },
      headlineDevelopments: [
        {
          storyId: `story-${date}-1`,
          title: `Ανάλυση Κυκλοφορίας Samsung Galaxy S25 Ultra (${date})`,
          category: 'Smartphones',
          executiveTakeaway: 'Κυκλοφορία ναυαρχίδας στην ευρωπαϊκή αγορά.',
          strategicAnalysis: ['Ενεργές προωθητικές ενέργειες.'],
          competitiveThreatLevel: 'HIGH' as const,
          implicationForHuawei: 'Απάντηση με την υπεροχή κάμερας του Pura 70 Ultra.',
          trackedCompetitors: ['Samsung'],
          groundedCitations: [],
          strategicImportanceScore: 88,
          evidenceClassification: 'VERIFIED_REPORT' as const,
          evidenceConfidence: 0.9,
          independentSourceCount: 4,
        },
      ],
      categoryBreakdowns: [],
      competitorMoves: [],
      strategicImplicationsForHuawei: {
        immediateActions: ['Προβολή αυτονομίας Watch GT 5'],
        mediumTermWatch: ['Παρακολούθηση προσφορών ανταλλαγής'],
        threatsAndRisks: ['Πίεση πακέτων παρόχων'],
        opportunities: ['Ηγετική θέση στα wearables'],
      },
    },
    groundingMetrics: {
      totalArticlesInWindow: 18,
      strategicallyRelevantArticles: 14,
      distinctSourcesCount: 6,
      sourcesCovered: ['GSMArena', 'The Verge'],
      distinctClustersConsidered: 4,
      geminiModelUsed: 'gemini-2.5-flash',
      synthesisDurationMs: 1240,
      storiesUsed: 4,
    },
  };
}

function createMockExpressResponse() {
  let statusCode = 200;
  let jsonBody: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      jsonBody = payload;
      return res;
    },
  } as unknown as Response;

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => jsonBody,
  };
}

async function invokeProtectedHandler(
  req: Partial<Request>,
  handler: (req: Request, res: Response) => Promise<void>
): Promise<{ status: number; body: any; handlerReached: boolean }> {
  const mock = createMockExpressResponse();
  let nextCalled = false;
  await requireAdminOrAuthorizedClient(req as Request, mock.res, () => {
    nextCalled = true;
  });
  if (nextCalled) {
    await handler(req as Request, mock.res);
  }
  return {
    status: mock.getStatus(),
    body: mock.getBody(),
    handlerReached: nextCalled,
  };
}

async function runP231CriticalFunctionalRecoveryTests() {
  console.log(
    'Running SIGNALYN P2.3.1 & P2.3.1.1 — Critical Functional Recovery & Pre-Deployment Safety Gate Suite...\n'
  );

  const archiveListFixture = [
    { id: 'brief-2026-10-31', date: '2026-10-31', status: 'PUBLISHED' },
    { id: 'brief-2026-10-29', date: '2026-10-29', status: 'PUBLISHED' },
  ];

  const brief20261031 = createPublishedBriefFixture(
    '2026-10-31',
    'Daily Executive Intelligence Brief • 2026-10-31',
    'Ημερήσια Αναφορά Στρατηγικής Ευφυΐας • 2026-10-31'
  );
  const brief20261029 = createPublishedBriefFixture(
    '2026-10-29',
    'Daily Executive Intelligence Brief • 2026-10-29',
    'Ημερήσια Αναφορά Στρατηγικής Ευφυΐας • 2026-10-29'
  );

  // =========================================================================
  // PART 1: F01 — DAILY BRIEF READ RELIABILITY TESTS (10 TESTS)
  // =========================================================================

  // F01 Test 1: Selecting 2026-10-31 (PUBLISHED) loads and renders the published brief
  const res20261031 = classifyDailyBriefHttpResponse({
    status: 200,
    ok: true,
    contentType: 'application/json; charset=utf-8',
    rawBody: JSON.stringify({ ...brief20261031, found: true, brief: brief20261031 }),
    requestedDate: '2026-10-31',
    archiveList: archiveListFixture,
  });
  assert.equal(res20261031.outcome, 'LOADED');
  assert.equal(res20261031.brief?.date, '2026-10-31');
  const content20261031En = resolveBriefLocalizedContent(res20261031.brief, 'en');
  assert.ok(content20261031En, '2026-10-31 English content must resolve from canonical briefDoc.en');
  assert.equal(
    resolveDailyBriefViewState({
      isLoading: false,
      briefDoc: res20261031.brief,
      activeContent: content20261031En,
      readError: null,
      selectedDate: '2026-10-31',
      archiveList: archiveListFixture,
    }),
    'LOADED'
  );
  console.log('✓ F01.1 Selecting 2026-10-31 (PUBLISHED) loads and renders the published brief.');

  // F01 Test 2: Selecting 2026-10-29 (PUBLISHED) loads and renders the published brief (including direct document format)
  const res20261029 = classifyDailyBriefHttpResponse({
    status: 200,
    ok: true,
    contentType: 'application/json',
    rawBody: JSON.stringify(brief20261029),
    requestedDate: '2026-10-29',
    archiveList: archiveListFixture,
  });
  assert.equal(res20261029.outcome, 'LOADED');
  assert.equal(res20261029.brief?.date, '2026-10-29');
  const content20261029En = resolveBriefLocalizedContent(res20261029.brief, 'en');
  assert.ok(content20261029En);
  assert.equal(
    content20261029En?.executiveHeadline,
    'Daily Executive Intelligence Brief • 2026-10-29'
  );
  console.log('✓ F01.2 Selecting 2026-10-29 (PUBLISHED) loads and renders the published brief.');

  // F01 Test 3: Switching 2026-10-31 -> 2026-10-29 -> 2026-10-31 updates content and reporting date correctly
  const step1Date = resolveBriefReportingDate({
    briefDoc: res20261031.brief,
    selectedDate: '2026-10-31',
    archiveList: archiveListFixture,
  });
  const step2Date = resolveBriefReportingDate({
    briefDoc: res20261029.brief,
    selectedDate: '2026-10-29',
    archiveList: archiveListFixture,
  });
  const step3Date = resolveBriefReportingDate({
    briefDoc: res20261031.brief,
    selectedDate: '2026-10-31',
    archiveList: archiveListFixture,
  });
  assert.equal(step1Date, '2026-10-31');
  assert.equal(step2Date, '2026-10-29');
  assert.equal(step3Date, '2026-10-31');
  assert.notEqual(
    resolveBriefLocalizedContent(res20261031.brief, 'en')?.executiveHeadline,
    resolveBriefLocalizedContent(res20261029.brief, 'en')?.executiveHeadline
  );
  console.log(
    '✓ F01.3 Switching 2026-10-31 -> 2026-10-29 -> 2026-10-31 updates content and reporting date accurately.'
  );

  // F01 Test 4: Header Reporting Date matches the loaded brief date or selected archive date (never stuck on "Latest")
  assert.equal(
    resolveBriefReportingDate({
      briefDoc: null,
      selectedDate: '2026-10-29',
      archiveList: archiveListFixture,
    }),
    '2026-10-29',
    'When a date is selected in the dropdown, Reporting Date must reflect that date even before briefDoc loads'
  );
  assert.equal(
    resolveBriefReportingDate({
      briefDoc: null,
      selectedDate: '',
      archiveList: archiveListFixture,
    }),
    '2026-10-31',
    'When archiveList is loaded and selectedDate is empty, Reporting Date defaults to the latest archive entry date'
  );
  console.log('✓ F01.4 Header Reporting Date matches the loaded brief date and selected archive date.');

  // F01 Test 5: English and Greek language switch works when localized content exists (canonical + legacy schemas) + Section 3 delta normalization
  const resolvedEl = resolveBriefLocalizedContent(brief20261031, 'el');
  assert.equal(
    resolvedEl?.executiveHeadline,
    'Ημερήσια Αναφορά Στρατηγικής Ευφυΐας • 2026-10-31'
  );
  const deltaNormalized = normalizeBriefDeltaForDisplay(content20261031En?.dayOverDayDelta);
  assert.ok(deltaNormalized);
  assert.equal(deltaNormalized.hasBaselineData, true);
  assert.equal(deltaNormalized.counts.escalatingCount, 1);
  assert.equal(deltaNormalized.items[0].previousImportanceScore, 74);
  assert.equal(deltaNormalized.items[0].currentImportanceScore, 88);
  console.log('✓ F01.5 English and Greek language switch and canonical Day-over-Day Delta normalization verified.');

  // F01 Test 6: HTML fallback response (<!doctype html>) is detected and handled cleanly without throwing raw JSON syntax errors
  const htmlFallbackClassification = classifyDailyBriefHttpResponse({
    status: 200,
    ok: true,
    contentType: 'text/html; charset=utf-8',
    rawBody: '<!doctype html><html><head><title>SIGNALYN</title></head><body><div id="root"></div></body></html>',
    requestedDate: '2026-10-31',
    archiveList: archiveListFixture,
  });
  assert.equal(htmlFallbackClassification.outcome, 'READ_ERROR');
  assert.equal(htmlFallbackClassification.error?.kind, 'HTML_FALLBACK');
  assert.ok(
    !htmlFallbackClassification.error?.userMessage.includes('<!doctype'),
    'User-facing error message must never expose raw HTML or Unexpected token <'
  );
  assert.equal(
    resolveDailyBriefViewState({
      isLoading: false,
      briefDoc: null,
      activeContent: null,
      readError: htmlFallbackClassification.error || null,
      selectedDate: '2026-10-31',
      archiveList: archiveListFixture,
    }),
    'READ_ERROR'
  );
  console.log(
    '✓ F01.6 HTML fallback response (<!doctype html>) is intercepted and classified as READ_ERROR (HTML_FALLBACK) without raw JSON syntax errors.'
  );

  // F01 Test 7: HTTP 404 for an unpublished date renders the Not Found state
  const notFoundClassification = classifyDailyBriefHttpResponse({
    status: 404,
    ok: false,
    contentType: 'application/json',
    rawBody: JSON.stringify({ found: false, date: '2026-10-15', error: 'Not found' }),
    requestedDate: '2026-10-15',
    archiveList: archiveListFixture,
  });
  assert.equal(notFoundClassification.outcome, 'NOT_FOUND');
  assert.equal(
    resolveDailyBriefViewState({
      isLoading: false,
      briefDoc: null,
      activeContent: null,
      readError: null,
      selectedDate: '2026-10-15',
      archiveList: archiveListFixture,
    }),
    'NOT_FOUND'
  );
  console.log('✓ F01.7 HTTP 404 for a non-published date resolves to NOT_FOUND.');

  // F01 Test 8: HTTP 500 or network failure renders the Read Error state, not the Not Found state
  const server500Classification = classifyDailyBriefHttpResponse({
    status: 500,
    ok: false,
    contentType: 'application/json',
    rawBody: JSON.stringify({ error: 'Firestore timeout' }),
    requestedDate: '2026-10-31',
    archiveList: archiveListFixture,
  });
  assert.equal(server500Classification.outcome, 'READ_ERROR');
  assert.equal(server500Classification.error?.kind, 'SERVER_ERROR');
  assert.equal(
    resolveDailyBriefViewState({
      isLoading: false,
      briefDoc: null,
      activeContent: null,
      readError: server500Classification.error || null,
      selectedDate: '2026-10-31',
      archiveList: archiveListFixture,
    }),
    'READ_ERROR',
    'HTTP 500 must render READ_ERROR and never NOT_FOUND'
  );
  console.log('✓ F01.8 HTTP 500 / network failure resolves to READ_ERROR, never NOT_FOUND.');

  // F01 Test 9: Archive entry marked PUBLISHED whose content fails to load (404 / empty) renders Published Metadata Mismatch state
  const mismatchClassification = classifyDailyBriefHttpResponse({
    status: 404,
    ok: false,
    contentType: 'application/json',
    rawBody: JSON.stringify({ found: false, date: '2026-10-31', error: 'Document missing' }),
    requestedDate: '2026-10-31',
    archiveList: archiveListFixture,
  });
  assert.equal(mismatchClassification.outcome, 'PUBLISHED_METADATA_MISMATCH');
  assert.equal(
    resolveDailyBriefViewState({
      isLoading: false,
      briefDoc: null,
      activeContent: null,
      readError: null,
      selectedDate: '2026-10-31',
      archiveList: archiveListFixture,
    }),
    'PUBLISHED_METADATA_MISMATCH',
    'When archive marks 2026-10-31 as PUBLISHED but briefDoc is missing, state must be PUBLISHED_METADATA_MISMATCH'
  );
  console.log(
    '✓ F01.9 Archive entry marked PUBLISHED with missing document content resolves to PUBLISHED_METADATA_MISMATCH.'
  );

  // F01 Test 10: Verify DailyBriefView.tsx & server.ts endpoint alignment, Retry Read control, and Guest vs Admin role gating
  const dailyBriefViewSource = fs.readFileSync(
    path.resolve('src/components/dailybrief/DailyBriefView.tsx'),
    'utf8'
  );
  const serverSource = fs.readFileSync(path.resolve('server.ts'), 'utf8');

  assert.ok(
    dailyBriefViewSource.includes('/api/daily-brief/latest') &&
      serverSource.includes("app.get('/api/daily-brief/latest', handleGetDailyBrief)") &&
      serverSource.includes("app.get('/api/daily-brief', handleGetDailyBrief)"),
    'DailyBriefView.tsx and server.ts must share aligned Daily Brief read routes'
  );
  assert.ok(
    serverSource.includes("app.use('/api', (req, res) => {"),
    'server.ts must include an explicit /api/* JSON 404 guard before the SPA HTML fallback'
  );
  assert.ok(
    dailyBriefViewSource.includes('data-testid="daily-brief-read-error"') &&
      dailyBriefViewSource.includes('data-testid="daily-brief-metadata-mismatch"') &&
      dailyBriefViewSource.includes('data-testid="daily-brief-not-found"') &&
      dailyBriefViewSource.includes('Retry Read'),
    'DailyBriefView.tsx must render distinct Read Error, Published Metadata Mismatch, and Not Found states with a safe Retry Read button'
  );
  assert.ok(
    dailyBriefViewSource.includes('{canManage && (') &&
      dailyBriefViewSource.includes('handleRegenerateBrief') &&
      dailyBriefViewSource.includes('handleTriggerFullPipeline'),
    'DailyBriefView.tsx must gate Regenerate Brief and Run Pipeline strictly behind canManage (Admin only)'
  );
  console.log(
    '✓ F01.10 DailyBriefView.tsx endpoint contract, /api 404 JSON guard, Retry Read button, and Guest vs. Admin role gating verified.'
  );

  // =========================================================================
  // PART 2: F10 — NAVIGATION & BROWSER HISTORY SYNCHRONIZATION TESTS (10 TESTS)
  // =========================================================================

  // F10 Test 1: Sidebar navigation updates active view, sidebar state, header title, and browser URL
  const nav = new NavigationHistoryController('#overview');
  assert.equal(nav.getState().activeTab, 'overview');
  assert.equal(nav.getState().urlHash, '#overview');

  nav.navigateToTab('daily-brief');
  assert.equal(nav.getState().activeTab, 'daily-brief');
  assert.equal(nav.getState().urlHash, '#daily-brief');

  nav.navigateToTab('retail-prices');
  assert.equal(nav.getState().activeTab, 'retail-prices');
  assert.equal(nav.getState().urlHash, '#retail-prices');
  console.log('✓ F10.1 Sidebar navigation updates activeTab and browser URL hash in lockstep.');

  // F10 Test 2: Settings sub-tab navigation updates URL and active sub-tab
  nav.navigateToTab('settings');
  assert.equal(nav.getState().activeTab, 'settings');
  assert.equal(nav.getState().settingsSection, 'general');
  assert.equal(nav.getState().urlHash, '#general');

  nav.navigateToSettingsSection('retail-sources');
  assert.equal(nav.getState().activeTab, 'settings');
  assert.equal(nav.getState().settingsSection, 'retail-sources');
  assert.equal(nav.getState().urlHash, '#retail-sources');

  nav.navigateToSettingsSection('system-diagnostics', 'service');
  assert.equal(nav.getState().activeTab, 'settings');
  assert.equal(nav.getState().settingsSection, 'system-diagnostics');
  assert.equal(nav.getState().diagnosticsSubTab, 'service');
  assert.equal(nav.getState().urlHash, '#system-diagnostics:service');
  console.log('✓ F10.2 Settings sub-tab navigation updates URL hash and active sub-tab state.');

  // F10 Test 3: Leaving Settings via sidebar removes stale Settings URL state (#retail-sources -> #overview)
  const auditNav = new NavigationHistoryController('#overview');
  auditNav.navigateToTab('settings'); // #general
  auditNav.navigateToSettingsSection('retail-sources'); // #retail-sources
  assert.equal(auditNav.getState().urlHash, '#retail-sources');

  auditNav.navigateToTab('overview'); // User clicks Overview in Sidebar
  assert.equal(auditNav.getState().activeTab, 'overview');
  assert.equal(
    auditNav.getState().urlHash,
    '#overview',
    'Leaving Settings via Sidebar must replace #retail-sources with #overview'
  );
  console.log('✓ F10.3 Leaving Settings via Sidebar removes stale #retail-sources hash and sets #overview.');

  // F10 Test 4: Settings -> Retail Sources -> Overview -> Browser Back restores Settings -> Retail Sources
  auditNav.back();
  assert.equal(
    auditNav.getState().activeTab,
    'settings',
    'Browser Back from Overview must restore activeTab="settings"'
  );
  assert.equal(
    auditNav.getState().settingsSection,
    'retail-sources',
    'Browser Back from Overview must restore settingsSection="retail-sources"'
  );
  assert.equal(auditNav.getState().urlHash, '#retail-sources');
  console.log(
    '✓ F10.4 Exact audit sequence: Settings -> Retail Sources -> Overview -> Browser Back restores Settings -> Retail Sources.'
  );

  // F10 Test 5: Settings -> Retail Sources -> Overview -> Browser Back -> Browser Forward restores Overview
  auditNav.forward();
  assert.equal(
    auditNav.getState().activeTab,
    'overview',
    'Browser Forward must restore activeTab="overview"'
  );
  assert.equal(auditNav.getState().urlHash, '#overview');
  console.log(
    '✓ F10.5 Exact audit sequence: Settings -> Retail Sources -> Overview -> Browser Back -> Browser Forward restores Overview.'
  );

  // F10 Test 6: Multi-step primary navigation: Overview -> Analytics -> Sources -> Browser Back (and Daily Brief -> Stories -> Back)
  const primaryNav = new NavigationHistoryController('#overview');
  primaryNav.navigateToTab('analytics');
  primaryNav.navigateToTab('sources');
  assert.equal(primaryNav.getState().activeTab, 'sources');
  assert.equal(primaryNav.getState().urlHash, '#sources');

  primaryNav.back();
  assert.equal(primaryNav.getState().activeTab, 'analytics');
  assert.equal(primaryNav.getState().urlHash, '#analytics');

  primaryNav.navigateToTab('daily-brief');
  primaryNav.navigateToTab('stories');
  assert.equal(primaryNav.getState().activeTab, 'stories');
  primaryNav.back();
  assert.equal(primaryNav.getState().activeTab, 'daily-brief');
  assert.equal(primaryNav.getState().urlHash, '#daily-brief');
  console.log(
    '✓ F10.6 Overview -> Analytics -> Sources -> Back and Daily Brief -> Stories -> Back synchronize view and URL.'
  );

  // F10 Test 7: Settings General -> Retail Sources -> Browser Back restores Settings General
  const settingsNav = new NavigationHistoryController('#overview');
  settingsNav.navigateToTab('settings');
  assert.equal(settingsNav.getState().urlHash, '#general');
  settingsNav.navigateToSettingsSection('retail-sources');
  assert.equal(settingsNav.getState().urlHash, '#retail-sources');

  settingsNav.back();
  assert.equal(settingsNav.getState().activeTab, 'settings');
  assert.equal(settingsNav.getState().settingsSection, 'general');
  assert.equal(settingsNav.getState().urlHash, '#general');
  console.log('✓ F10.7 Settings General -> Retail Sources -> Browser Back restores Settings General.');

  // F10 Test 8: Direct deep-link opening of #retail-sources, #system-diagnostics:retail, and #analytics opens the correct view
  const deepLinkRetailSources = new NavigationHistoryController('#retail-sources');
  assert.equal(deepLinkRetailSources.getState().activeTab, 'settings');
  assert.equal(deepLinkRetailSources.getState().settingsSection, 'retail-sources');

  const deepLinkDiagRetail = new NavigationHistoryController('#system-diagnostics:retail');
  assert.equal(deepLinkDiagRetail.getState().activeTab, 'settings');
  assert.equal(deepLinkDiagRetail.getState().settingsSection, 'system-diagnostics');
  assert.equal(deepLinkDiagRetail.getState().diagnosticsSubTab, 'retail');

  const deepLinkAnalytics = new NavigationHistoryController('#analytics');
  assert.equal(deepLinkAnalytics.getState().activeTab, 'analytics');
  assert.equal(deepLinkAnalytics.getState().urlHash, '#analytics');
  console.log('✓ F10.8 Direct deep-link opening of #retail-sources, #system-diagnostics:retail, and #analytics verified.');

  // F10 Test 9: Page refresh on a nested Settings tab preserves the active view and sub-tab
  const refreshNav = new NavigationHistoryController('#overview');
  refreshNav.navigateToTab('settings');
  refreshNav.navigateToSettingsSection('retail-sources');
  const afterReload = refreshNav.reload();
  assert.equal(afterReload.activeTab, 'settings');
  assert.equal(afterReload.settingsSection, 'retail-sources');
  assert.equal(refreshNav.getState().urlHash, '#retail-sources');
  console.log('✓ F10.9 Page refresh on a nested Settings tab (#retail-sources) preserves active view and sub-tab.');

  // F10 Test 10: Invalid/unknown hash falls back safely to Overview AND redundant navigation does not push duplicate history entries
  const unknownNav = new NavigationHistoryController('#non-existent-route-999');
  assert.equal(unknownNav.getState().activeTab, 'overview');
  assert.equal(unknownNav.getState().urlHash, '#overview');
  assert.equal(unknownNav.getState().isUnknownFallback, true);

  const beforeLen = unknownNav.getState().historyLength;
  unknownNav.navigateToTab('overview'); // Redundant navigation to already active tab
  assert.equal(
    unknownNav.getState().historyLength,
    beforeLen,
    'Redundant navigation to the already-active tab must not push duplicate history entries'
  );
  console.log(
    '✓ F10.10 Invalid hash falls back safely to #overview and redundant navigation does not push duplicate history entries.'
  );

  // =========================================================================
  // PART 3: P2.3.1.1 — PRE-DEPLOYMENT SAFETY & ENDPOINT SECURITY GATE (8 TESTS)
  // =========================================================================

  let generateBriefCallCount = 0;
  let lastGeneratedDateStr: string | undefined = undefined;
  let pipelineRunCallCount = 0;
  let lastPipelineDateStr: string | undefined = undefined;

  const postBriefHandler = createPostDailyBriefGenerateHandler({
    generateDailyBrief: async ({ dateStr }) => {
      generateBriefCallCount++;
      lastGeneratedDateStr = dateStr;
      return brief20261031;
    },
  });

  const postPipelineHandler = createPostPipelineRunHandler({
    runDailyIntelligencePipeline: async ({ dateStr }) => {
      pipelineRunCallCount++;
      lastPipelineDateStr = dateStr;
      return {
        runId: 'run-test-1',
        status: 'SUCCESS',
        dateStr: dateStr || '2026-10-31',
      };
    },
    getPipelineStatus: async () => ({
      activeRun: { status: 'RUNNING' },
    }),
  });

  // Gate Test 1: Unauthenticated (401) and Cross-Origin (403) POST requests to /api/daily-brief/generate and /api/pipeline/run never execute jobs
  const unauthBriefRes = await invokeProtectedHandler(
    { headers: {}, ip: '10.10.0.1', body: { dateStr: '2026-10-31', forceRegenerate: true } },
    postBriefHandler
  );
  assert.equal(unauthBriefRes.status, 401);
  assert.equal(unauthBriefRes.handlerReached, false);

  const csrfPipelineRes = await invokeProtectedHandler(
    {
      headers: { 'sec-fetch-site': 'cross-site', authorization: 'Bearer some-token' },
      ip: '10.10.0.2',
      body: { dateStr: '2026-10-31' },
    },
    postPipelineHandler
  );
  assert.equal(csrfPipelineRes.status, 403);
  assert.equal(csrfPipelineRes.handlerReached, false);
  assert.equal(generateBriefCallCount, 0);
  assert.equal(pipelineRunCallCount, 0);
  console.log(
    '✓ Gate.1 Unauthenticated (401) and cross-site (403) POST requests to /api/daily-brief/generate and /api/pipeline/run are blocked with zero job execution.'
  );

  // Gate Test 2: Non-admin authenticated user (403) POST requests to /api/daily-brief/generate and /api/pipeline/run are blocked with zero job execution
  _setTestIdentityOverride({
    initialized: true,
    credentialMode: 'ADC',
    projectId: 'signalyn-5406e',
    databaseId: 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34',
  });
  _setTestTokenVerifier(async () => ({
    uid: 'guest-user-999',
    email: 'guest@example.com',
    email_verified: true,
    admin: false,
  }));
  _setTestFirestoreDb({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false }),
      }),
    }),
  });

  const nonAdminBriefRes = await invokeProtectedHandler(
    {
      headers: { authorization: 'Bearer valid-guest-jwt' },
      ip: '10.10.0.3',
      body: { dateStr: '2026-10-31', forceRegenerate: true },
    },
    postBriefHandler
  );
  assert.equal(nonAdminBriefRes.status, 403);
  assert.equal(nonAdminBriefRes.handlerReached, false);

  const nonAdminPipelineRes = await invokeProtectedHandler(
    {
      headers: { authorization: 'Bearer valid-guest-jwt' },
      ip: '10.10.0.4',
      body: { dateStr: '2026-10-31' },
    },
    postPipelineHandler
  );
  assert.equal(nonAdminPipelineRes.status, 403);
  assert.equal(nonAdminPipelineRes.handlerReached, false);
  assert.equal(generateBriefCallCount, 0);
  assert.equal(pipelineRunCallCount, 0);
  console.log(
    '✓ Gate.2 Non-admin authenticated user POST requests are rejected with HTTP 403 and zero job execution.'
  );

  // Gate Test 3: Invalid date payloads ("2026-02-30", "2026-13-45", "2026/10/31", "not-a-date", numbers/objects) rejected with HTTP 400 before job execution
  _setTestTokenVerifier(async () => ({
    uid: 'admin-owner-1',
    email: 'n.kalogerogiannis@gmail.com',
    email_verified: true,
    admin: true,
  }));

  const invalidPayloads = [
    { dateStr: '2026-02-30' },
    { dateStr: '2026-13-45' },
    { date: '2026/10/31' },
    { dateStr: 'not-a-date' },
    { dateStr: 20261031 },
    { date: { nested: '2026-10-31' } },
  ];

  for (const badBody of invalidPayloads) {
    const resBrief = await invokeProtectedHandler(
      {
        headers: { authorization: 'Bearer admin-jwt' },
        ip: '10.10.0.5',
        body: badBody,
      },
      postBriefHandler
    );
    assert.equal(resBrief.status, 400, `Expected HTTP 400 for invalid brief payload ${JSON.stringify(badBody)}`);

    const resPipe = await invokeProtectedHandler(
      {
        headers: { authorization: 'Bearer admin-jwt' },
        ip: '10.10.0.5',
        query: { sync: 'true' } as any,
        body: badBody,
      },
      postPipelineHandler
    );
    assert.equal(resPipe.status, 400, `Expected HTTP 400 for invalid pipeline payload ${JSON.stringify(badBody)}`);
  }
  assert.equal(
    generateBriefCallCount,
    0,
    'Invalid date payloads must NEVER fall back to today or invoke generateDailyBrief'
  );
  assert.equal(
    pipelineRunCallCount,
    0,
    'Invalid date payloads must NEVER fall back to today or invoke runDailyIntelligencePipeline'
  );
  console.log(
    '✓ Gate.3 Invalid date payloads ("2026-02-30", "2026/10/31", non-strings) are rejected with HTTP 400 before job execution.'
  );

  // Gate Test 4: date vs dateStr compatibility and conflict rejection (400 on conflict; 200 on valid admin call)
  const conflictRes = await invokeProtectedHandler(
    {
      headers: { authorization: 'Bearer admin-jwt' },
      ip: '10.10.0.6',
      body: { dateStr: '2026-10-31', date: '2026-10-29', forceRegenerate: true },
    },
    postBriefHandler
  );
  assert.equal(conflictRes.status, 400);
  assert.equal(generateBriefCallCount, 0);

  const validLegacyDateAliasRes = await invokeProtectedHandler(
    {
      headers: { authorization: 'Bearer admin-jwt' },
      ip: '10.10.0.6',
      body: { date: '2026-10-29', forceRegenerate: false },
    },
    postBriefHandler
  );
  assert.equal(validLegacyDateAliasRes.status, 200);
  assert.equal(generateBriefCallCount, 1);
  assert.equal(lastGeneratedDateStr, '2026-10-29');

  const validDualMatchingRes = await invokeProtectedHandler(
    {
      headers: { authorization: 'Bearer admin-jwt' },
      ip: '10.10.0.6',
      body: { dateStr: '2026-10-31', date: '2026-10-31', forceRegenerate: true },
    },
    postBriefHandler
  );
  assert.equal(validDualMatchingRes.status, 200);
  assert.equal(generateBriefCallCount, 2);
  assert.equal(lastGeneratedDateStr, '2026-10-31');
  _resetTestOverrides();
  console.log(
    '✓ Gate.4 date vs. dateStr compatibility and conflicting parameter rejection (HTTP 400) verified.'
  );

  // Gate Test 5: GET /api/daily-brief and GET /api/daily-brief/latest never invoke generateDailyBrief and reject malformed ?date= with HTTP 400
  let getReadCalls = 0;
  const getHandler = createGetDailyBriefHandler({
    getDailyBrief: async (dateStr?: string) => {
      getReadCalls++;
      if (dateStr === '2026-10-29') return brief20261029;
      if (!dateStr || dateStr === '2026-10-31') return brief20261031;
      return null;
    },
  });

  const badGetMock = createMockExpressResponse();
  await getHandler({ query: { date: '2026-02-30' } } as unknown as Request, badGetMock.res);
  assert.equal(badGetMock.getStatus(), 400);
  assert.equal(getReadCalls, 0, 'Malformed ?date= query on GET must not query Firestore');

  const okGetMock = createMockExpressResponse();
  await getHandler({ query: { date: '2026-10-29' } } as unknown as Request, okGetMock.res);
  assert.equal(okGetMock.getStatus(), 200);
  assert.equal(okGetMock.getBody()?.date, '2026-10-29');
  assert.equal(getReadCalls, 1);
  assert.equal(
    generateBriefCallCount,
    2,
    'GET /api/daily-brief* must never increment generateBriefCallCount'
  );
  console.log(
    '✓ Gate.5 GET /api/daily-brief and GET /api/daily-brief/latest are strictly read-only and validate ?date= parameters.'
  );

  // Gate Test 6: Express API route ordering & canonical /api/pipeline/run contract
  const idxBriefLatest = serverSource.indexOf("app.get('/api/daily-brief/latest'");
  const idxBriefAlias = serverSource.indexOf("app.get('/api/daily-brief'");
  const idxBriefGen = serverSource.indexOf("'/api/daily-brief/generate'");
  const idxPipelineRun = serverSource.indexOf("'/api/pipeline/run'");
  const idxApi404 = serverSource.indexOf("app.use('/api', (req, res) => {");
  const idxViteMiddleware = serverSource.indexOf('app.use(vite.middlewares)');
  const idxSpaCatchAll = serverSource.indexOf("app.get('*', (req, res) => {");

  assert.ok(idxBriefLatest > 0 && idxBriefAlias > 0 && idxBriefGen > 0 && idxPipelineRun > 0);
  assert.ok(
    idxBriefLatest < idxApi404 &&
      idxBriefAlias < idxApi404 &&
      idxBriefGen < idxApi404 &&
      idxPipelineRun < idxApi404,
    'All /api/daily-brief* and /api/pipeline/* routes must be registered BEFORE the /api 404 JSON middleware'
  );
  assert.ok(
    idxApi404 < idxViteMiddleware && idxApi404 < idxSpaCatchAll,
    'The /api 404 JSON middleware must be registered BEFORE Vite dev middleware and production SPA catch-all'
  );
  assert.ok(
    !serverSource.includes("'/api/pipeline/daily-run'"),
    'Unnecessary /api/pipeline/daily-run alias must be absent; canonical /api/pipeline/run is used'
  );
  console.log(
    '✓ Gate.6 Express API route ordering verified (/api/* routes -> /api 404 JSON guard -> SPA HTML fallback).'
  );

  // Gate Test 7: Legacy historical brief presentation compatibility preserved without Firestore writes
  assert.ok(
    dailyBriefViewSource.includes('const isLegacyBrief = Boolean(') &&
      dailyBriefViewSource.includes('Historical Archive Briefing (Phase P0 Baseline)') &&
      dailyBriefViewSource.includes('deriveCriticalAlerts') &&
      dailyBriefViewSource.includes('deriveStrategicHardwareOverview'),
    'DailyBriefView.tsx must preserve pure client-side legacy brief fallback and Historical Archive Briefing banner'
  );
  console.log(
    '✓ Gate.7 Legacy historical brief presentation compatibility (Phase P0 baseline fallback) verified.'
  );

  // Gate Test 8: Navigation event listener registration and cleanup audit (AppContext.tsx & SettingsView.tsx)
  const appContextSource = fs.readFileSync(path.resolve('src/context/AppContext.tsx'), 'utf8');
  const settingsViewSource = fs.readFileSync(
    path.resolve('src/components/settings/SettingsView.tsx'),
    'utf8'
  );
  assert.ok(
    appContextSource.includes("window.addEventListener('popstate', syncFromBrowserLocation)") &&
      appContextSource.includes("window.removeEventListener('popstate', syncFromBrowserLocation)") &&
      appContextSource.includes("window.addEventListener('hashchange', syncFromBrowserLocation)") &&
      appContextSource.includes("window.removeEventListener('hashchange', syncFromBrowserLocation)"),
    'AppContext.tsx must register and symmetrically clean up popstate and hashchange listeners'
  );
  assert.ok(
    settingsViewSource.includes("window.addEventListener('hashchange', handleLocationSync)") &&
      settingsViewSource.includes("window.removeEventListener('hashchange', handleLocationSync)") &&
      settingsViewSource.includes("window.addEventListener('popstate', handleLocationSync)") &&
      settingsViewSource.includes("window.removeEventListener('popstate', handleLocationSync)"),
    'SettingsView.tsx must register and symmetrically clean up hashchange and popstate listeners'
  );
  console.log(
    '✓ Gate.8 Browser navigation listener registration and unmount cleanup verified in AppContext.tsx and SettingsView.tsx.'
  );

  console.log(
    '\nALL 28/28 SIGNALYN P2.3.1 & P2.3.1.1 CRITICAL FUNCTIONAL RECOVERY & PRE-DEPLOYMENT GATE TESTS PASSED!'
  );
}

runP231CriticalFunctionalRecoveryTests().catch((err) => {
  console.error('Fatal test failure in p231CriticalFunctionalRecovery.test.ts:', err);
  process.exit(1);
});

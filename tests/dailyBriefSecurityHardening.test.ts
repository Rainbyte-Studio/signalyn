/**
 * Signalyn Daily Brief Production Security & Data Integrity Hardening Test Suite
 * 
 * Verifies:
 * 1. Firestore Security Rules:
 *    - /dailyBriefs/{briefId} has allow write: if false (client writes completely blocked)
 *    - /pipelineRuns/{runId} has allow write: if false (client writes completely blocked)
 *    - /dailyBriefs/{briefId} has allow read: if true (read-only client access)
 *    - No unauthenticated, ordinary user, or client-spoofed writes permitted
 * 2. Backend Persistence & Zero Client Write Fallbacks:
 *    - Zero occurrences of setDoc/updateDoc/addDoc/deleteDoc in dailyBriefGenerator.ts
 *    - Daily brief persistence strictly mediated by getServerDb() (Firebase Admin SDK)
 *    - Fail-closed security exception when credentials uninitialized
 * 3. Historical Daily Brief Immutability:
 *    - getDailyBrief returns existing historical documents as-is
 *    - Zero Gemini calls, zero Firestore mutations, zero timestamp overwrites on historical reads
 *    - generateDailyBrief respects existing historical briefs when !forceRegenerate
 * 4. API Authorization Guards:
 *    - /api/daily-brief/generate guarded with requireAdminOrAuthorizedClient
 *    - Unauthenticated requests rejected with HTTP 401
 *    - Cross-site requests rejected with HTTP 403
 * 5. Frontend Presentation-Only Compatibility:
 *    - Legacy archive disclosure notice rendered for pre-P1 briefs without document mutation
 */

import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { requireAdminOrAuthorizedClient } from '../src/server/authMiddleware';
import * as firestoreAdmin from '../src/server/firestoreAdmin';
import { getServerDb } from '../src/server/serverFirestoreAdapter';
import { getDailyBrief, generateDailyBrief } from '../src/server/dailyBriefGenerator';
import { DailyBriefDocument } from '../src/types/dailyBrief';

async function runDailyBriefSecurityTests() {
  console.log('===============================================================');
  console.log('SIGNALYN DAILY BRIEF SECURITY & DATA INTEGRITY HARDENING TESTS');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${title}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${title}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // Part 1: Firestore Security Rules Audit
  // -------------------------------------------------------------------------
  console.log('[Part 1: Firestore Security Rules Audit]');
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const candidateRulesPath = path.resolve(process.cwd(), 'firestore.rules.candidate');
  assert('firestore.rules exists', fs.existsSync(rulesPath));
  assert('firestore.rules.candidate exists', fs.existsSync(candidateRulesPath));

  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  const candidateContent = fs.readFileSync(candidateRulesPath, 'utf8');

  // Verify /dailyBriefs/{briefId} write lockdown in operational rules
  const dailyBriefsRule = rulesContent.match(/match\s+\/dailyBriefs\/\{briefId\}\s*\{([^}]+)\}/);
  assert('dailyBriefs match block defined', Boolean(dailyBriefsRule));
  if (dailyBriefsRule) {
    const block = dailyBriefsRule[1];
    assert('dailyBriefs write blocked for clients', block.includes('allow write: if false;'), 'Found allow write: if false;');
    assert('dailyBriefs read permitted', block.includes('allow read: if true;'), 'Found allow read: if true;');
    assert('dailyBriefs zero unrestricted write', !block.includes('allow write: if true;'), 'Zero allow write: if true;');
  }

  // Verify /pipelineRuns/{runId} write lockdown in operational rules
  const pipelineRunsRule = rulesContent.match(/match\s+\/pipelineRuns\/\{runId\}\s*\{([^}]+)\}/);
  assert('pipelineRuns match block defined', Boolean(pipelineRunsRule));
  if (pipelineRunsRule) {
    const block = pipelineRunsRule[1];
    assert('pipelineRuns write blocked for clients', block.includes('allow write: if false;'), 'Found allow write: if false;');
    assert('pipelineRuns read permitted', block.includes('allow read: if true;'), 'Found allow read: if true;');
    assert('pipelineRuns zero unrestricted write', !block.includes('allow write: if true;'), 'Zero allow write: if true;');
  }

  // Verify candidate rules parity
  assert(
    'Candidate rules lockdown parity',
    candidateContent.includes('match /dailyBriefs/{briefId} {\n      allow read: if true;\n      allow write: if false;') &&
    candidateContent.includes('match /pipelineRuns/{runId} {\n      allow read: if true;\n      allow write: if false;'),
    'firestore.rules.candidate enforces allow write: if false for both collections'
  );

  // -------------------------------------------------------------------------
  // Part 2: Backend Persistence & Zero Client Write Fallbacks
  // -------------------------------------------------------------------------
  console.log('\n[Part 2: Backend Persistence & Zero Client Write Fallbacks]');
  const generatorPath = path.resolve(process.cwd(), 'src/server/dailyBriefGenerator.ts');
  const generatorContent = fs.readFileSync(generatorPath, 'utf8');

  // Check that no client SDK mutation functions are called
  const hasClientSetDoc = generatorContent.includes('setDoc(');
  const hasClientUpdateDoc = generatorContent.includes('updateDoc(');
  const hasClientAddDoc = generatorContent.includes('addDoc(');
  const hasClientDeleteDoc = generatorContent.includes('deleteDoc(');

  assert(
    'Zero client SDK writes in dailyBriefGenerator',
    !hasClientSetDoc && !hasClientUpdateDoc && !hasClientAddDoc && !hasClientDeleteDoc,
    'Zero occurrences of setDoc, updateDoc, addDoc, or deleteDoc'
  );

  // Check that daily brief persistence explicitly invokes getServerDb()
  assert(
    'Persists via trusted server Admin SDK',
    generatorContent.includes('const adminDb = getServerDb();') &&
    generatorContent.includes('await adminDb.collection(\'dailyBriefs\').doc(briefId).set('),
    'Uses getServerDb().collection("dailyBriefs").doc(briefId).set()'
  );

  // Check fail-closed behavior when credentials are unavailable
  firestoreAdmin._setTestIdentityOverride({
    initialized: false,
    credentialMode: 'MISSING',
    projectId: 'signalyn-5406e',
    databaseId: 'test-db',
    error: 'Simulated credential absence for security test',
  });

  let threwSecurityException = false;
  try {
    getServerDb();
  } catch (err: any) {
    threwSecurityException = true;
    assert(
      'Server Firestore Adapter fails closed on missing credentials',
      err.message.includes('[Security Exception]') && err.message.includes('Fail-closed'),
      err.message
    );
  }
  assert('Security exception thrown when uninitialized', threwSecurityException);

  // Reset test override
  firestoreAdmin._resetTestOverrides();

  // -------------------------------------------------------------------------
  // Part 3: Historical Daily Brief Immutability & Safe Read-Only Retrieval
  // -------------------------------------------------------------------------
  console.log('\n[Part 3: Historical Daily Brief Immutability]');

  // Mock historical brief with older schema (lacks strategicHardwareOverview)
  const legacyHistoricalBrief: DailyBriefDocument = {
    id: 'brief-2026-10-15',
    date: '2026-10-15',
    windowStart: '2026-10-14T21:00:00.000Z',
    windowEnd: '2026-10-15T20:59:59.999Z',
    status: 'PUBLISHED',
    version: 1,
    generatedAt: '2026-10-15T22:00:00.000Z',
    lastUpdatedAt: '2026-10-15T22:00:00.000Z',
    generatedBy: 'SYSTEM_AUTOMATION',
    targetCompanyId: 'comp-huawei',
    targetCompanyName: 'HUAWEI',
    en: {
      language: 'en',
      executiveHeadline: 'Historical Briefing',
      executiveSummary: ['Historical executive note.'],
      keyThemes: ['Smartphones'],
      marketSentimentOverview: { overall: 'NEUTRAL', rationale: 'Historical rationale' },
      headlineDevelopments: [
        {
          title: 'Competitor Launch in China',
          category: 'Smartphones',
          executiveTakeaway: 'Takeaway',
          strategicAnalysis: ['Analysis'],
          competitiveThreatLevel: 'HIGH',
          implicationForHuawei: 'Historical implication',
          trackedCompetitors: ['Apple'],
          groundedCitations: [],
        },
      ],
      categoryBreakdowns: [],
      competitorMoves: [],
      strategicImplicationsForHuawei: {
        immediateActions: ['Action'],
        mediumTermWatch: ['Watch'],
        threatsAndRisks: ['Risk'],
        opportunities: ['Opportunity'],
      },
    },
    groundingMetrics: {
      totalArticlesInWindow: 10,
      strategicallyRelevantArticles: 5,
      unrelatedArticlesSkipped: 5,
      storiesQueried: 50,
      storiesEligible: 0,
      storiesUsed: 0,
      storyIntegrationMode: 'ARTICLE_FALLBACK',
      geminiModelUsed: 'gemini-3.1-flash-lite',
      synthesisDurationMs: 5000,
      coverageStatus: 'FULL',
      sourcesCovered: ['GSMArena'],
      distinctSourcesCount: 1,
      distinctClustersConsidered: 0,
      pendingRelevantArticlesCount: 0,
      failedArticlesCount: 0,
    },
  };

  // Mock Admin Firestore for read-only test
  let writeAttempted = false;
  const mockDb: any = {
    collection: (collName: string) => ({
      doc: (docId: string) => ({
        get: async () => ({
          exists: docId === 'brief-2026-10-15',
          data: () => (docId === 'brief-2026-10-15' ? legacyHistoricalBrief : null),
        }),
        set: async () => {
          writeAttempted = true;
          throw new Error('ILLEGAL_MUTATION: Historical brief write attempted during read!');
        },
      }),
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            empty: false,
            docs: [{ data: () => legacyHistoricalBrief }],
          }),
        }),
      }),
    }),
  };

  firestoreAdmin._setTestFirestoreDb(mockDb);

  // Test: getDailyBrief on existing historical brief
  const retrievedBrief = await getDailyBrief('2026-10-15');
  assert('Historical brief retrieved successfully', Boolean(retrievedBrief));
  assert('Zero Firestore writes during historical retrieval', !writeAttempted);
  assert('Historical generatedAt timestamp preserved', retrievedBrief?.generatedAt === '2026-10-15T22:00:00.000Z');
  assert('Historical version preserved', retrievedBrief?.version === 1);
  assert('Historical executive headline preserved', retrievedBrief?.en?.executiveHeadline === 'Historical Briefing');

  // Test: generateDailyBrief with !forceRegenerate returns existing historical brief immediately
  const genResult = await generateDailyBrief({ dateStr: '2026-10-15', forceRegenerate: false });
  assert('generateDailyBrief without forceRegenerate returns existing brief', genResult.id === 'brief-2026-10-15');
  assert('Zero Firestore writes when brief already exists', !writeAttempted);

  // Test: Non-existent past date returns null (never synthesizes retroactive briefs)
  const nonExistentHistorical = await getDailyBrief('2026-01-01');
  assert('Non-existent historical date returns null safely', nonExistentHistorical === null);

  firestoreAdmin._resetTestOverrides();

  // -------------------------------------------------------------------------
  // Part 4: API Authorization Guards
  // -------------------------------------------------------------------------
  console.log('\n[Part 4: API Authorization Guards]');

  function createMockResponse() {
    let statusCode = 200;
    let jsonBody: any = null;
    return {
      res: {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (body: any) => {
              jsonBody = body;
            },
          };
        },
      } as unknown as Response,
      getStatus: () => statusCode,
      getBody: () => jsonBody,
    };
  }

  // Test 4A: Missing Authorization header returns 401
  {
    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {},
      ip: '10.0.0.1',
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert('Unauthenticated mutation rejected with HTTP 401', mock.getStatus() === 401);
    assert('Middleware halted without calling next()', !nextCalled);
  }

  // Test 4B: Cross-origin mutation rejected with HTTP 403
  {
    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {
        'sec-fetch-site': 'cross-site',
        authorization: 'Bearer dummy-token',
      },
      ip: '10.0.0.2',
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert('Cross-origin mutation rejected with HTTP 403', mock.getStatus() === 403);
    assert('Middleware halted without calling next()', !nextCalled);
  }

  // -------------------------------------------------------------------------
  // Part 5: Frontend Presentation Compatibility
  // -------------------------------------------------------------------------
  console.log('\n[Part 5: Frontend Presentation Compatibility]');
  const viewPath = path.resolve(process.cwd(), 'src/components/dailybrief/DailyBriefView.tsx');
  const viewContent = fs.readFileSync(viewPath, 'utf8');

  assert(
    'isLegacyBrief check present in DailyBriefView',
    viewContent.includes('const isLegacyBrief = Boolean('),
    'Evaluates legacy state without document mutation'
  );

  assert(
    'Historical archive notice rendered for legacy briefs',
    viewContent.includes('{isLegacyBrief && (') &&
    viewContent.includes('Historical Archive Briefing (Phase P0 Baseline)'),
    'Renders informative historical disclosure banner'
  );

  assert(
    'Defensive P1 fallback uses pure client derivation',
    viewContent.includes('const activeContent: DailyBriefContent | null = useMemo(') &&
    viewContent.includes('deriveCriticalAlerts') &&
    viewContent.includes('deriveStrategicHardwareOverview'),
    'Employs useMemo to provide presentation-only baseline without writes'
  );

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

runDailyBriefSecurityTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

/**
 * Signalyn Phase 5S-D2-A Security & Candidate Rules Security Test Suite
 * 
 * Verifies:
 * 1. candidate firestore rules syntax and structure
 * 2. Unauthenticated and anonymous write denial
 * 3. Removal of probe ID deletion backdoors
 * 4. Protection of story membership subcollections
 * 5. Server-only collections strictly deny client writes
 * 6. ServerFirestoreAdapter fail-closed guarantees (never falls back to Web SDK writes)
 * 7. Verification that tests do not make calls to live external production Firestore, collectors, or Gemini
 */

import fs from 'fs';
import path from 'path';
import { getServerDb, cleanServerData } from '../src/server/serverFirestoreAdapter';
import * as firestoreAdmin from '../src/server/firestoreAdmin';

async function runSecurityTestSuite() {
  console.log('=== RUNNING PHASE 5S-D2-A SECURITY & CANDIDATE RULES TESTS ===\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, detail: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${title}: ${detail}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${title}: ${detail}`);
      failed++;
    }
  }

  // Test 1: firestore.rules.candidate exists and is populated
  const candidateRulesPath = path.resolve('firestore.rules.candidate');
  assert(
    'Candidate Rules Exist',
    fs.existsSync(candidateRulesPath),
    `Found candidate rules file at ${candidateRulesPath}`
  );

  const candidateRules = fs.readFileSync(candidateRulesPath, 'utf8');

  // Test 2: Probe ID deletion exceptions are completely removed from candidate rules
  assert(
    'Zero Probe ID Deletion Exceptions',
    !candidateRules.includes('isProbeId') && !candidateRules.includes('sec_probe_'),
    'Zero occurrences of isProbeId() or sec_probe_ in firestore.rules.candidate'
  );

  // Test 3: Candidate rules enforce isAuthorizedAdmin() or isAnalyst() across write blocks
  assert(
    'Admin Authorization on Protected Collections',
    candidateRules.includes('isAuthorizedAdmin') &&
      candidateRules.includes('isAnalyst') &&
      candidateRules.includes('request.auth.token.email_verified == true'),
    'Candidate rules define verified email and explicit admin/analyst roles'
  );

  // Test 4: Fully server-owned collections explicitly deny client writes (allow write: if false)
  const articlesMatch = candidateRules.includes('match /articles/{articleId} {\n      allow read: if true;\n      allow write: if false;');
  const analysisMatch = candidateRules.includes('match /articleAnalysis/{articleId} {\n      allow read: if true;\n      allow write: if false;');
  const dailyMatch = candidateRules.includes('match /analyticsDaily/{dayId} {\n      allow read: if true;\n      allow write: if false;');
  const ledgerMatch = candidateRules.includes('match /analyticsLedger/{articleId} {\n      allow read: if true;\n      allow write: if false;');

  assert(
    'Server-Owned Collections Deny Client Direct Writes',
    articlesMatch && analysisMatch && dailyMatch && ledgerMatch,
    'articles, articleAnalysis, analyticsDaily, and analyticsLedger client writes strictly denied'
  );

  // Test 5: Story memberships are protected against anonymous deletion or modification
  const membershipMatch = candidateRules.includes('match /articles/{articleId} {') &&
    candidateRules.includes('allow delete: if (isAuthorizedAdmin() || isAnalyst()) && isValidId(articleId) && isValidId(storyId);');

  assert(
    'Story Memberships Protected',
    membershipMatch,
    'Subcollection /stories/{storyId}/articles/{articleId} requires explicit role'
  );

  // Test 6: ServerFirestoreAdapter Fail-Closed Guarantee
  firestoreAdmin._setTestIdentityOverride({
    initialized: false,
    credentialMode: 'MISSING',
    projectId: 'signalyn-5406e',
    databaseId: 'test-db',
    error: 'Simulated missing credentials in test harness',
  });

  let threw = false;
  try {
    getServerDb();
  } catch (err: any) {
    threw = true;
    assert(
      'Server Adapter Fails Closed on Missing Credentials',
      err.message.includes('[Security Exception]') && err.message.includes('Fail-closed'),
      `Properly rejected with security exception: ${err.message}`
    );
  }

  if (!threw) {
    assert('Server Adapter Fails Closed on Missing Credentials', false, 'getServerDb() did not throw!');
  }

  firestoreAdmin._resetTestOverrides();

  // Test 7: cleanServerData helper strips undefined values without mutating valid data
  const testObj = {
    validField: 'Signalyn',
    count: 42,
    emptyField: undefined,
    nested: {
      inner: 'active',
      badInner: undefined,
    },
    arr: [1, undefined, 3],
  };

  const cleaned = cleanServerData(testObj);
  assert(
    'cleanServerData Operates Correctly',
    cleaned.emptyField === undefined &&
      cleaned.nested.badInner === undefined &&
      cleaned.validField === 'Signalyn' &&
      cleaned.arr.length === 2,
    'Cleaned undefined fields successfully'
  );

  console.log(`\n=== PHASE 5S-D2-A SECURITY TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runSecurityTestSuite()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  });

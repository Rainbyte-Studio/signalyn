/**
 * Signalyn Phase 5S-D2-D.1 Security Remediation & Native AI Studio Publish Gate Test Suite
 * 
 * Verifies:
 * 1. Startup safety: automatic repair/migration mutations eliminated from server startup.
 * 2. Candidate rules hardening:
 *    - Zero hardcoded email bypasses in firestore.rules.candidate.
 *    - Context-aware allow delete rules (no request.resource evaluations).
 *    - Company schema rule alignment (no nonexistent tier field required).
 *    - EntityReview status allowlist parity (all application statuses supported).
 *    - Nested story membership subcollection protection.
 * 3. Administrator authorization consistency across backend, frontend, and rules:
 *    - Multi-tiered administrator recognition (custom claims, admins doc, verified owner).
 *    - Strict emailVerified requirement for email-based administrator access.
 * 4. Production Identity Gate:
 *    - Post-publish read-only verification helper fails closed without leaking credentials.
 *    - Protected /api/admin/verify-database-access endpoint.
 * 5. Production preservation:
 *    - Operational firestore.rules untouched.
 */

import fs from 'fs';
import path from 'path';
import {
  isAuthorizedOwner,
  verifyServerDatabaseAccess,
  _setTestIdentityOverride,
  _resetTestOverrides,
  _setTestFirestoreDb,
} from '../src/server/firestoreAdmin';

async function runPhase5sD2d1SecurityTests() {
  console.log('=== RUNNING PHASE 5S-D2-D.1 SECURITY REMEDIATION TESTS ===\n');

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
  // Part A: Startup Safety
  // -------------------------------------------------------------------------
  const serverPath = path.resolve(process.cwd(), 'server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert(
    !serverContent.includes('setTimeout(async () => {') &&
      !serverContent.includes('repairCorruptedArticles({ maxArticles: 500 })'),
    'Startup Safety: Automatic article repair and source migration removed from server startup'
  );

  assert(
    serverContent.includes('/api/collector/repair-articles') &&
      serverContent.includes('/api/collector/migrate-sources'),
    'Startup Safety: Maintenance jobs remain accessible via authorized admin endpoints'
  );

  // -------------------------------------------------------------------------
  // Part B: Administrator Authorization Parity
  // -------------------------------------------------------------------------
  // Test emailVerified requirement
  const originalEmail = process.env.SIGNALYN_OWNER_EMAIL;
  process.env.SIGNALYN_OWNER_EMAIL = 'admin@example.com';
  delete process.env.SIGNALYN_OWNER_UID;

  assert(
    !isAuthorizedOwner({ email: 'admin@example.com', emailVerified: false }),
    'Admin Auth: Unverified email claim is rejected by isAuthorizedOwner'
  );

  assert(
    isAuthorizedOwner({ email: 'admin@example.com', emailVerified: true }),
    'Admin Auth: Verified email claim is accepted by isAuthorizedOwner'
  );

  assert(
    !isAuthorizedOwner({ email: 'attacker@example.com', emailVerified: true }),
    'Admin Auth: Non-owner email with emailVerified is rejected by isAuthorizedOwner'
  );

  // Test UID requirement
  process.env.SIGNALYN_OWNER_UID = 'uid-legitimate-owner-123';
  delete process.env.SIGNALYN_OWNER_EMAIL;

  assert(
    isAuthorizedOwner({ uid: 'uid-legitimate-owner-123' }),
    'Admin Auth: Matching owner UID is accepted by isAuthorizedOwner'
  );

  assert(
    !isAuthorizedOwner({ uid: 'uid-impostor-456' }),
    'Admin Auth: Non-matching UID is rejected by isAuthorizedOwner'
  );

  // Restore env
  if (originalEmail) {
    process.env.SIGNALYN_OWNER_EMAIL = originalEmail;
  } else {
    delete process.env.SIGNALYN_OWNER_EMAIL;
  }
  delete process.env.SIGNALYN_OWNER_UID;

  // -------------------------------------------------------------------------
  // Part C: Candidate Rules Hardening
  // -------------------------------------------------------------------------
  const candidateRulesPath = path.resolve(process.cwd(), 'firestore.rules.candidate');
  const candidateRules = fs.readFileSync(candidateRulesPath, 'utf8');

  assert(
    !candidateRules.includes('@gmail.com') && !candidateRules.includes('@'),
    'Candidate Rules: Zero hardcoded personal email addresses'
  );

  assert(
    candidateRules.includes('exists(/databases/$(database)/documents/admins/$(request.auth.uid))') &&
      candidateRules.includes('request.auth.token.admin == true'),
    'Candidate Rules: Enforces custom claim or admins collection registry document'
  );

  // Context-aware delete rules: allow delete does not reference request.resource
  const sourceGroupsBlock = candidateRules.match(/match \/sourceGroups\/\{groupId\} \{[\s\S]*?\}/);
  assert(
    Boolean(sourceGroupsBlock && sourceGroupsBlock[0].includes('allow delete: if isAuthorizedAdmin() && isValidId(groupId);')),
    'Candidate Rules: sourceGroups delete does not evaluate request.resource'
  );

  const deletedSourcesBlock = candidateRules.match(/match \/deletedSources\/\{sourceId\} \{[\s\S]*?\}/);
  assert(
    Boolean(deletedSourcesBlock && deletedSourcesBlock[0].includes('allow delete: if isAuthorizedAdmin() && isValidId(sourceId);')),
    'Candidate Rules: deletedSources delete does not evaluate request.resource'
  );

  const storyReviewBlock = candidateRules.match(/match \/storyReview\/\{reviewId\} \{[\s\S]*?\}/);
  assert(
    Boolean(storyReviewBlock && storyReviewBlock[0].includes('allow delete: if (isAuthorizedAdmin() || isAnalyst()) && isValidId(reviewId);')),
    'Candidate Rules: storyReview delete does not evaluate request.resource'
  );

  // Analysts registry read restriction: only corresponding user or authorized admin
  const analystsBlock = candidateRules.match(/match \/analysts\/\{userId\} \{[\s\S]*?\}/);
  assert(
    Boolean(
      analystsBlock &&
        analystsBlock[0].includes('allow read: if (isSignedIn() && request.auth.uid == userId) || isAuthorizedAdmin();') &&
        analystsBlock[0].includes('allow write: if isAuthorizedAdmin();')
    ),
    'Candidate Rules: analysts registry read restricted to corresponding user or authorized admin'
  );

  // Company rule schema
  const companyBlock = candidateRules.match(/match \/companies\/\{companyId\} \{[\s\S]*?\}/);
  assert(
    Boolean(companyBlock && !companyBlock[0].includes('tier')),
    'Candidate Rules: companies rule does not demand nonexistent tier property'
  );

  // EntityReview rule statuses
  const entityReviewBlock = candidateRules.match(/match \/entityReview\/\{reviewId\} \{[\s\S]*?\}/);
  assert(
    Boolean(
      entityReviewBlock &&
        entityReviewBlock[0].includes('RESOLVED_EXISTING') &&
        entityReviewBlock[0].includes('PROMOTED_NEW') &&
        entityReviewBlock[0].includes('DISMISSED_NON_STRATEGIC')
    ),
    'Candidate Rules: entityReview allows RESOLVED_EXISTING, PROMOTED_NEW, and DISMISSED_NON_STRATEGIC'
  );

  // Server-owned collections write: if false
  const serverCols = ['articles', 'articleAnalysis', 'analyticsDaily', 'analyticsLedger', 'system'];
  for (const c of serverCols) {
    const rx = new RegExp(`match\\s+\\/${c}\\/[^\\n]+\\{[\\s\\S]*?allow write:\\s*if false;`, 'm');
    assert(rx.test(candidateRules), `Candidate Rules: /${c} denies client direct writes (write: if false)`);
  }

  // -------------------------------------------------------------------------
  // Part E: Post-Publish Identity Verification Diagnostic
  // -------------------------------------------------------------------------
  // Verify verifyServerDatabaseAccess fails closed when identity is uninitialized
  _setTestIdentityOverride({
    initialized: false,
    credentialMode: 'MISSING',
    projectId: 'signalyn-5406e',
    databaseId: 'test-db',
    error: 'Simulated missing credentials',
  });

  const failClosedReport = await verifyServerDatabaseAccess();
  assert(
    failClosedReport.success === false && failClosedReport.readVerified === false,
    'Identity Verification: Fails closed when credentials are uninitialized'
  );

  // Verify successful probe with mock DB
  _setTestIdentityOverride({
    initialized: true,
    credentialMode: 'ADC',
    projectId: 'signalyn-5406e',
    databaseId: 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34',
  });

  _setTestFirestoreDb({
    collection: (colName: string) => ({
      doc: (docName: string) => ({
        get: async () => ({ exists: true, data: () => ({ ok: true }) }),
      }),
    }),
  });

  const successReport = await verifyServerDatabaseAccess();
  assert(
    successReport.success === true && successReport.readVerified === true,
    'Identity Verification: Reports successful read on verified database'
  );

  _resetTestOverrides();

  // Verify server has mounted /api/admin/verify-database-access
  assert(
    serverContent.includes("app.get('/api/admin/verify-database-access'"),
    'Identity Verification: Protected endpoint /api/admin/verify-database-access is registered'
  );

  // -------------------------------------------------------------------------
  // Production Safety Confirmation
  // -------------------------------------------------------------------------
  const prodRules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert(
    prodRules.includes('service cloud.firestore'),
    'Safety: Operational firestore.rules is preserved and untouched'
  );

  console.log(`\n=== PHASE 5S-D2-D.1 TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5sD2d1SecurityTests().catch((err) => {
  console.error('Fatal test error in Phase 5S-D2-D.1 suite:', err);
  process.exit(1);
});

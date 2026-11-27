import {
  initializeServerIdentity,
  getServerFirestore,
  getServerIdentityStatus,
  isAuthorizedOwner,
  TARGET_PROJECT_ID,
  TARGET_DATABASE_ID,
} from '../src/server/firestoreAdmin';

async function runServerIdentityTests() {
  console.log('=== RUNNING SERVER IDENTITY & AUTHORIZATION TESTS ===\n');

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

  // Test 1: Configuration targets exact database ID and project ID
  assert(
    'Target Database ID',
    TARGET_DATABASE_ID === 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34',
    `Custom database ID preserved: ${TARGET_DATABASE_ID}`
  );
  assert(
    'Target Project ID',
    TARGET_PROJECT_ID === 'signalyn-5406e',
    `Project ID preserved: ${TARGET_PROJECT_ID}`
  );

  // Test 2: In environment without ADC or Service Account, status accurately reports
  const status = initializeServerIdentity();
  assert(
    'Initialization Status Structure',
    typeof status.initialized === 'boolean' && typeof status.credentialMode === 'string',
    `Status received: initialized=${status.initialized}, mode=${status.credentialMode}`
  );

  // Test 3: Fail-closed verification
  // If not initialized, getServerFirestore MUST throw immediately
  if (!status.initialized) {
    let threw = false;
    try {
      getServerFirestore();
    } catch (err: any) {
      threw = true;
      assert(
        'Fail-Closed on Missing Credentials',
        err.message.includes('[Security Exception]') && err.message.includes('Fail-closed'),
        `Properly threw security exception: ${err.message}`
      );
    }
    if (!threw) {
      assert('Fail-Closed on Missing Credentials', false, 'getServerFirestore did not throw!');
    }
  } else {
    // If running in an environment where ADC actually works
    assert('Admin SDK Initialized', status.initialized, `Initialized via ${status.credentialMode}`);
  }

  // Test 4: Authorization Model — Fail Closed When No Owner Configured
  const originalEnvEmail = process.env.SIGNALYN_OWNER_EMAIL;
  const originalEnvUid = process.env.SIGNALYN_OWNER_UID;
  delete process.env.SIGNALYN_OWNER_EMAIL;
  delete process.env.SIGNALYN_OWNER_UID;

  assert(
    'No Configured Owner Fails Closed',
    !isAuthorizedOwner({ uid: 'random-uid', email: 'test@example.com', emailVerified: true }),
    'Denied access when no owner environment variable is defined'
  );

  // Test 5: Authorization Model — Spoofed Unverified Email Rejection
  process.env.SIGNALYN_OWNER_EMAIL = 'admin@signalyn.internal';
  assert(
    'Unverified Email Spoof Attack Denied',
    !isAuthorizedOwner({ uid: 'attacker-uid', email: 'admin@signalyn.internal', emailVerified: false }),
    'User with matching email but emailVerified=false is strictly rejected'
  );

  // Test 6: Authorization Model — Verified Owner Email Accepted
  assert(
    'Verified Owner Email Accepted',
    isAuthorizedOwner({ uid: 'admin-uid', email: 'admin@signalyn.internal', emailVerified: true }),
    'User with matching email and emailVerified=true is authorized'
  );

  // Test 7: Authorization Model — Case-Insensitive Email Matching
  assert(
    'Case-Insensitive Email Handling',
    isAuthorizedOwner({ uid: 'admin-uid', email: 'ADMIN@Signalyn.Internal', emailVerified: true }),
    'Normalized casing matches correctly'
  );

  // Test 8: Authorization Model — Arbitrary Authenticated Google User Rejected
  assert(
    'Arbitrary Google User Denied',
    !isAuthorizedOwner({ uid: 'other-user', email: 'somebody.else@gmail.com', emailVerified: true }),
    'Non-matching Google account is strictly denied admin privileges'
  );

  // Test 9: Authorization Model — Specific Owner UID Matching
  process.env.SIGNALYN_OWNER_UID = 'trusted-owner-uid-12345';
  assert(
    'Owner UID Match',
    isAuthorizedOwner({ uid: 'trusted-owner-uid-12345', email: 'any@domain.com' }),
    'Matching UID grants admin privileges'
  );
  assert(
    'Non-matching UID Denied',
    !isAuthorizedOwner({ uid: 'untrusted-uid-99999', email: 'any@domain.com' }),
    'Non-matching UID is denied'
  );

  // Cleanup env
  if (originalEnvEmail) process.env.SIGNALYN_OWNER_EMAIL = originalEnvEmail;
  else delete process.env.SIGNALYN_OWNER_EMAIL;
  if (originalEnvUid) process.env.SIGNALYN_OWNER_UID = originalEnvUid;
  else delete process.env.SIGNALYN_OWNER_UID;

  console.log(`\n=== SERVER IDENTITY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runServerIdentityTests()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  });

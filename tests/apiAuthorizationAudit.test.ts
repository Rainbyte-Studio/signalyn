/**
 * Signalyn Phase 5S-D2-A API Authorization & Security Audit Test Suite
 * 
 * Tests the hardened backend authorization middleware:
 * 1. Missing credentials return HTTP 401 Unauthorized
 * 2. Malformed or empty Bearer token returns HTTP 401
 * 3. Session tokens (x-signalyn-session) are no longer accepted -> HTTP 401
 * 4. Cross-origin / cross-site requests return HTTP 403 Forbidden
 * 5. Privileged server-to-server admin key is accepted
 * 6. Non-admin Google account is rejected with HTTP 403 Forbidden
 * 7. Verified administrator account is authorized
 * 8. Unavailable identity infrastructure fails closed (HTTP 503)
 * 9. Sliding-window rate limiting prevents brute-force mutation attacks
 */

import {
  requireAdminOrAuthorizedClient,
  checkRateLimit,
} from '../src/server/authMiddleware';
import * as firestoreAdmin from '../src/server/firestoreAdmin';
import { Request, Response } from 'express';

async function runApiAuthorizationTests() {
  console.log('=== RUNNING PHASE 5S-D2-A API AUTHORIZATION TESTS ===\n');

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

  const clientIp = '192.168.1.100';

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

  // Test 1: Cross-Origin Request Blocked with HTTP 403
  {
    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: { 'sec-fetch-site': 'cross-site' },
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Cross-Origin Request Blocked',
      mock.getStatus() === 403 && !nextCalled,
      `Rejected with 403: ${mock.getData()?.error}`
    );
  }

  // Test 2: Missing Credentials Returns HTTP 401
  {
    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {},
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Missing Credentials Returns 401',
      mock.getStatus() === 401 && !nextCalled,
      `Rejected with 401: ${mock.getData()?.error}`
    );
  }

  // Test 3: Session Token (x-signalyn-session) No Longer Grants Access (Requirement 3)
  {
    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {
        'x-signalyn-session': 'legacy-fake-session-token',
      },
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Session Token Rejected (No Handshake Privilege)',
      mock.getStatus() === 401 && !nextCalled,
      'x-signalyn-session strictly rejected without Bearer token'
    );
  }

  // Test 4: Malformed Bearer Token Returns HTTP 401
  {
    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {
        authorization: 'Bearer ',
      },
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Empty Bearer Token Returns 401',
      mock.getStatus() === 401 && !nextCalled,
      `Rejected with 401: ${mock.getData()?.error}`
    );
  }

  // Test 5: Server-to-Server Admin Key Accepted
  {
    const originalAdminKey = process.env.ANALYSIS_ADMIN_KEY;
    process.env.ANALYSIS_ADMIN_KEY = 'super-secret-admin-key-2026';

    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {
        authorization: 'Bearer super-secret-admin-key-2026',
      },
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Privileged Server Admin Key Allowed',
      nextCalled && mock.getStatus() === 0,
      'Valid server-to-server admin key successfully routed to next()'
    );

    if (originalAdminKey) process.env.ANALYSIS_ADMIN_KEY = originalAdminKey;
    else delete process.env.ANALYSIS_ADMIN_KEY;
  }

  // Test 6: Fail-Closed When Identity Infrastructure Is Unavailable (HTTP 503)
  {
    firestoreAdmin._setTestIdentityOverride({
      initialized: false,
      credentialMode: 'MISSING',
      projectId: 'signalyn-5406e',
      databaseId: 'test-db',
    });

    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {
        authorization: 'Bearer test-firebase-token',
      },
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Unavailable Identity Infra Fails Closed (503)',
      mock.getStatus() === 503 && !nextCalled,
      `Failed closed with 503: ${mock.getData()?.error}`
    );

    firestoreAdmin._resetTestOverrides();
  }

  // Test 7: Non-Administrator Authenticated User Returns HTTP 403 Forbidden
  {
    const originalEnvEmail = process.env.SIGNALYN_OWNER_EMAIL;
    process.env.SIGNALYN_OWNER_EMAIL = 'admin@signalyn.internal';

    firestoreAdmin._setTestIdentityOverride({
      initialized: true,
      credentialMode: 'SERVICE_ACCOUNT',
      projectId: 'signalyn-5406e',
      databaseId: 'test-db',
    });

    firestoreAdmin._setTestTokenVerifier(async () => ({
      uid: 'regular-user-uid',
      email: 'regular.analyst@example.com',
      email_verified: true,
    }));

    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {
        authorization: 'Bearer valid-id-token-of-regular-user',
      },
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Non-Admin Google User Returns 403 Forbidden',
      mock.getStatus() === 403 && !nextCalled,
      `Returned 403: ${mock.getData()?.error}`
    );

    firestoreAdmin._resetTestOverrides();
    if (originalEnvEmail) process.env.SIGNALYN_OWNER_EMAIL = originalEnvEmail;
    else delete process.env.SIGNALYN_OWNER_EMAIL;
  }

  // Test 8: Verified Administrator User Is Granted Access
  {
    const originalEnvEmail = process.env.SIGNALYN_OWNER_EMAIL;
    process.env.SIGNALYN_OWNER_EMAIL = 'n.kalogerogiannis@gmail.com';

    firestoreAdmin._setTestIdentityOverride({
      initialized: true,
      credentialMode: 'SERVICE_ACCOUNT',
      projectId: 'signalyn-5406e',
      databaseId: 'test-db',
    });

    firestoreAdmin._setTestTokenVerifier(async () => ({
      uid: 'admin-user-uid',
      email: 'n.kalogerogiannis@gmail.com',
      email_verified: true,
    }));

    const mock = createMockResponse();
    let nextCalled = false;
    const req = {
      headers: {
        authorization: 'Bearer valid-id-token-of-admin',
      },
      ip: clientIp,
    } as unknown as Request;

    await requireAdminOrAuthorizedClient(req, mock.res, () => {
      nextCalled = true;
    });

    assert(
      'Verified Administrator Granted Access',
      nextCalled && mock.getStatus() === 0,
      'Verified administrator request routed to next()'
    );

    firestoreAdmin._resetTestOverrides();
    if (originalEnvEmail) process.env.SIGNALYN_OWNER_EMAIL = originalEnvEmail;
    else delete process.env.SIGNALYN_OWNER_EMAIL;
  }


  // Test 9: Sliding Window Rate Limiting
  {
    const rateLimitIp = '172.16.0.88';
    for (let i = 0; i < 30; i++) {
      checkRateLimit(rateLimitIp, 30, 60000);
    }
    const exceeded = !checkRateLimit(rateLimitIp, 30, 60000);
    assert(
      'Sliding Window Rate Limit Exhaustion',
      exceeded,
      '31st call from same IP within window was rate-limited'
    );
  }

  console.log(`\n=== API AUTHORIZATION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runApiAuthorizationTests()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal API test error:', e);
    process.exit(1);
  });

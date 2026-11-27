/**
 * Signalyn Production Google Cloud Scheduler OIDC Authentication Middleware
 *
 * Enforces strict verification of Google-issued OIDC ID tokens:
 * 1. Cryptographic signature verified against Google public certs via google-auth-library
 * 2. Issuer must be 'https://accounts.google.com' or 'accounts.google.com'
 * 3. Token must be unexpired
 * 4. Token audience must strictly match the configured SCHEDULER_TARGET_AUDIENCE
 * 5. Token email must strictly match the authorized SCHEDULER_SERVICE_ACCOUNT_EMAIL
 * 6. Arbitrary Google accounts and service accounts are strictly rejected with HTTP 403
 * 7. Missing/invalid tokens are rejected with HTTP 401
 * 8. Unconfigured server scheduler identity fails closed with HTTP 503
 * 9. Preserves existing interactive administrator permissions for operational inspection
 */

import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import {
  getServerIdentityStatus,
  verifyFirebaseIdToken,
  isAuthorizedOwner,
  getServerFirestore,
} from './firestoreAdmin';

export const SCHEDULER_SA_ENV = 'SCHEDULER_SERVICE_ACCOUNT_EMAIL';
export const SCHEDULER_AUD_ENV = 'SCHEDULER_TARGET_AUDIENCE';

export const DEFAULT_SCHEDULER_AUDIENCE = 'https://hw-signalyn.ai.studio/api/pipeline/scheduled-run';

export interface SchedulerTokenPayload {
  email: string;
  sub: string;
  aud: string;
  iss: string;
  email_verified?: boolean;
}

// Global cached client
let oidcClient: OAuth2Client | null = null;
function getOAuth2Client(): OAuth2Client {
  if (!oidcClient) {
    oidcClient = new OAuth2Client();
  }
  return oidcClient;
}

// Pluggable verifier for isolated unit test suites
export type TokenVerifierFn = (token: string, audience: string) => Promise<SchedulerTokenPayload>;

let customTokenVerifier: TokenVerifierFn | null = null;
export function setCustomTokenVerifierForTesting(fn: TokenVerifierFn | null): void {
  customTokenVerifier = fn;
}

/**
 * Validates a Google-issued OIDC identity token for the dedicated scheduler endpoint.
 */
export async function verifySchedulerOidcToken(
  token: string,
  options?: {
    expectedAudience?: string;
    expectedServiceAccountEmail?: string;
  }
): Promise<SchedulerTokenPayload> {
  const expectedAudience =
    options?.expectedAudience ||
    process.env[SCHEDULER_AUD_ENV] ||
    process.env.SCHEDULER_EXPECTED_AUDIENCE ||
    DEFAULT_SCHEDULER_AUDIENCE;

  const expectedEmail =
    options?.expectedServiceAccountEmail ||
    process.env[SCHEDULER_SA_ENV] ||
    process.env.GOOGLE_SCHEDULER_SERVICE_ACCOUNT;

  if (!expectedEmail) {
    throw new Error(
      `CONFIGURATION_ERROR: Dedicated scheduler service account is not configured on server (${SCHEDULER_SA_ENV}). Fail closed.`
    );
  }

  let payload: SchedulerTokenPayload;

  if (customTokenVerifier) {
    payload = await customTokenVerifier(token, expectedAudience);
  } else {
    const client = getOAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    const p = ticket.getPayload();
    if (!p) {
      throw new Error('TOKEN_ERROR: Missing token payload');
    }
    payload = {
      email: p.email || '',
      sub: p.sub || '',
      aud: typeof p.aud === 'string' ? p.aud : (p.aud?.[0] || ''),
      iss: p.iss || '',
      email_verified: p.email_verified,
    };
  }

  // 1. Strict Issuer Verification
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error(`UNAUTHORIZED_ISSUER: Invalid token issuer '${payload.iss}'. Expected Google accounts issuer.`);
  }

  // 2. Strict Audience Verification
  if (payload.aud !== expectedAudience) {
    throw new Error(`UNAUTHORIZED_AUDIENCE: Token audience '${payload.aud}' does not match expected '${expectedAudience}'.`);
  }

  // 3. Strict Verification of Service Account Identity
  if (!payload.email) {
    throw new Error('UNAUTHORIZED_IDENTITY: Token contains no service account email claim.');
  }

  if (payload.email_verified === false) {
    throw new Error('UNAUTHORIZED_IDENTITY: Service account email is not verified.');
  }

  if (payload.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error(
      `UNAUTHORIZED_IDENTITY: Token issued for service account '${payload.email}', but scheduler endpoint requires authorized service account '${expectedEmail}'. Arbitrary identities rejected.`
    );
  }

  return payload;
}

/**
 * Express middleware for the dedicated scheduler endpoint (POST /api/pipeline/scheduled-run).
 */
export async function requireSchedulerAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // 1. Reject missing or malformed credentials immediately with 401
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized: Missing or malformed authorization credentials. Bearer token required.',
    });
    return;
  }

  const bearerToken = authHeader.slice(7).trim();
  if (!bearerToken) {
    res.status(401).json({
      error: 'Unauthorized: Empty bearer token provided.',
    });
    return;
  }

  // 2. Preserve existing administrator permissions (admin key or verified Firebase admin)
  if (process.env.ANALYSIS_ADMIN_KEY && bearerToken === process.env.ANALYSIS_ADMIN_KEY) {
    (req as any).authenticatedRole = 'ADMIN_KEY';
    return next();
  }

  // Check if caller is verified Firebase Administrator
  const idStatus = getServerIdentityStatus();
  if (idStatus.initialized) {
    try {
      const decoded = await verifyFirebaseIdToken(bearerToken);
      const isOwner = isAuthorizedOwner({
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified,
      });
      const hasAdminClaim = Boolean((decoded as any).admin);
      let hasAdminDoc = false;
      try {
        const snap = await getServerFirestore().collection('admins').doc(decoded.uid).get();
        hasAdminDoc = snap.exists;
      } catch {
        hasAdminDoc = false;
      }

      if (isOwner || hasAdminClaim || hasAdminDoc) {
        (req as any).user = decoded;
        (req as any).authenticatedRole = 'FIREBASE_ADMIN';
        return next();
      }
    } catch {
      // Not a Firebase admin token; proceed to evaluate as Google Cloud Scheduler OIDC token
    }
  }

  // 3. Evaluate Google Cloud Scheduler OIDC Identity Token
  try {
    const verifiedPayload = await verifySchedulerOidcToken(bearerToken);
    (req as any).schedulerIdentity = verifiedPayload;
    (req as any).authenticatedRole = 'SCHEDULER_SERVICE_ACCOUNT';
    return next();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.startsWith('CONFIGURATION_ERROR')) {
      res.status(503).json({
        error: 'Service Unavailable: Scheduler service account identity verification is not configured in server environment.',
        detail: msg,
      });
      return;
    }

    if (msg.startsWith('UNAUTHORIZED_AUDIENCE') || msg.startsWith('UNAUTHORIZED_IDENTITY')) {
      res.status(403).json({
        error: 'Forbidden: Caller is not the authorized scheduler service account.',
        detail: msg,
      });
      return;
    }

    if (msg.startsWith('UNAUTHORIZED_ISSUER') || msg.includes('expired') || msg.includes('signature') || msg.startsWith('TOKEN_ERROR')) {
      res.status(401).json({
        error: 'Unauthorized: Invalid, expired, or untrusted OIDC identity token.',
        detail: msg,
      });
      return;
    }

    // Default reject with 401
    res.status(401).json({
      error: 'Unauthorized: OIDC token verification failed.',
      detail: msg,
    });
    return;
  }
}

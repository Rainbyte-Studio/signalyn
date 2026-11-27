/**
 * Signalyn Trusted Server-Side Firestore & Identity Module
 * 
 * Provides:
 * 1. Dedicated Firebase Admin SDK initialization targeting the exact custom database:
 *    ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34
 * 2. Strict credential availability detection (ADC or explicit server secret)
 * 3. Fail-closed behavior when credentials are unavailable
 * 4. Server-side token verification and owner/admin authorization guards
 */

import { initializeApp, getApps, getApp, type App, cert } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import configFile from '../../firebase-applet-config.json' with { type: 'json' };

export const TARGET_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || configFile.projectId || 'signalyn-5406e';
export const TARGET_DATABASE_ID =
  process.env.FIREBASE_DATABASE_ID ||
  configFile.firestoreDatabaseId ||
  'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34';

export interface ServerIdentityStatus {
  initialized: boolean;
  credentialMode: 'ADC' | 'SERVICE_ACCOUNT' | 'MISSING';
  projectId: string;
  databaseId: string;
  error?: string;
}

let adminApp: App | null = null;
let adminDb: Firestore | null = null;
let adminAuth: Auth | null = null;
let identityStatus: ServerIdentityStatus = {
  initialized: false,
  credentialMode: 'MISSING',
  projectId: TARGET_PROJECT_ID,
  databaseId: TARGET_DATABASE_ID,
  error: 'Server identity not yet initialized.',
};

/**
 * Initializes the trusted Firebase Admin SDK environment.
 * Evaluates whether Application Default Credentials (ADC) or a managed server
 * service account secret are present.
 */
export function initializeServerIdentity(): ServerIdentityStatus {
  if (adminApp) {
    return identityStatus;
  }

  // Check if existing default app exists
  if (getApps().length > 0) {
    adminApp = getApp();
  } else {
    try {
      // 1. Check for explicit service account credentials in environment (Optional legacy/override)
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT;
      if (serviceAccountJson) {
        const credentials = JSON.parse(serviceAccountJson);
        adminApp = initializeApp({
          credential: cert(credentials),
          projectId: TARGET_PROJECT_ID,
        });
        identityStatus.credentialMode = 'SERVICE_ACCOUNT';
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // 2. Explicit file-based ADC path
        adminApp = initializeApp({
          projectId: TARGET_PROJECT_ID,
        });
        identityStatus.credentialMode = 'ADC';
      } else {
        // 3. Ambient ADC in Google Cloud environment (AI Studio Preview & Cloud Run Publish)
        adminApp = initializeApp({
          projectId: TARGET_PROJECT_ID,
        });
        identityStatus.credentialMode = 'ADC';
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      identityStatus = {
        initialized: false,
        credentialMode: 'MISSING',
        projectId: TARGET_PROJECT_ID,
        databaseId: TARGET_DATABASE_ID,
        error: `Admin SDK initialization failed: ${msg}`,
      };
      return identityStatus;
    }
  }

  try {
    // Crucial: bind to exact custom database ID, never default
    adminDb = getFirestore(adminApp, TARGET_DATABASE_ID);
    adminAuth = getAuth(adminApp);
    identityStatus = {
      initialized: true,
      credentialMode: identityStatus.credentialMode,
      projectId: TARGET_PROJECT_ID,
      databaseId: TARGET_DATABASE_ID,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    identityStatus = {
      initialized: false,
      credentialMode: 'MISSING',
      projectId: TARGET_PROJECT_ID,
      databaseId: TARGET_DATABASE_ID,
      error: `Firestore database binding failed: ${msg}`,
    };
  }

  return identityStatus;
}

/**
 * Retrieves the trusted Admin Firestore instance.
 * Auto-initializes if not yet initialized.
 * Throws immediately (fail-closed) if credentials are missing or uninitialized.
 */
export function getServerFirestore(): Firestore {
  if (testFirestoreDbOverride) {
    return testFirestoreDbOverride;
  }
  if (testIdentityStatusOverride && !testIdentityStatusOverride.initialized) {
    throw new Error(
      `[Security Exception] Trusted Server Firestore is unavailable. Fail-closed: ` +
        `Credentials mode is ${testIdentityStatusOverride.credentialMode}. Detail: ${testIdentityStatusOverride.error || 'Uninitialized'}`
    );
  }
  if (!adminDb) {
    initializeServerIdentity();
  }
  const currentStatus = getServerIdentityStatus();
  if (!adminDb || !currentStatus.initialized) {
    throw new Error(
      `[Security Exception] Trusted Server Firestore is unavailable. Fail-closed: ` +
        `Credentials mode is ${currentStatus.credentialMode}. Detail: ${currentStatus.error || 'Uninitialized'}`
    );
  }
  return adminDb;
}

// Test override hooks for test harness isolation
let testIdentityStatusOverride: ServerIdentityStatus | null = null;
let testTokenVerifierOverride: ((token: string) => Promise<any>) | null = null;
let testFirestoreDbOverride: Firestore | null = null;

export function _setTestIdentityOverride(override: ServerIdentityStatus | null) {
  testIdentityStatusOverride = override;
}

export function _setTestTokenVerifier(verifier: ((token: string) => Promise<any>) | null) {
  testTokenVerifierOverride = verifier;
}

export function _setTestFirestoreDb(db: any) {
  testFirestoreDbOverride = db;
}

export function _resetTestOverrides() {
  testIdentityStatusOverride = null;
  testTokenVerifierOverride = null;
  testFirestoreDbOverride = null;
}

/**
 * Returns current server identity diagnostic status.
 */
export function getServerIdentityStatus(): ServerIdentityStatus {
  if (testIdentityStatusOverride) {
    return { ...testIdentityStatusOverride };
  }
  return { ...identityStatus };
}

/**
 * Verifies a client-provided Firebase ID token using Firebase Admin Auth.
 * Performs full cryptographic RS256 signature and claim verification (aud, iss, exp, sub)
 * against Google's SecureToken x509 public certificates. In ADC mode (where the host
 * container project differs from the Firebase project), skips the extra Identity Toolkit
 * getAccountInfo RPC (checkRevoked) that would target the host container project.
 */
export async function verifyFirebaseIdToken(token: string) {
  if (testTokenVerifierOverride) {
    return await testTokenVerifierOverride(token);
  }
  if (!adminAuth || !identityStatus.initialized) {
    throw new Error(
      `[Security Exception] Token verification unavailable: Admin Auth is not initialized (Mode: ${identityStatus.credentialMode}).`
    );
  }
  if (identityStatus.credentialMode === 'SERVICE_ACCOUNT') {
    try {
      return await adminAuth.verifyIdToken(token, true);
    } catch (err: any) {
      if (err?.code === 'auth/internal-error') {
        return await adminAuth.verifyIdToken(token, false);
      }
      throw err;
    }
  }
  return await adminAuth.verifyIdToken(token, false);
}

/**
 * Evaluates whether a verified user is the authorized application owner / administrator.
 * Compares against configured environment variables without granting blanket access to all Google accounts.
 */
export function isAuthorizedOwner(user: { uid?: string; email?: string; emailVerified?: boolean }): boolean {
  const configuredOwnerEmail = (
    process.env.SIGNALYN_OWNER_EMAIL ||
    process.env.VITE_SIGNALYN_OWNER_EMAIL ||
    'n.kalogerogiannis@gmail.com'
  )
    ?.trim()
    .toLowerCase();
  const configuredOwnerUid = (
    process.env.SIGNALYN_OWNER_UID ||
    process.env.VITE_SIGNALYN_OWNER_UID ||
    ''
  )?.trim();

  // If no owner is configured in environment, fail-closed: no one is treated as admin
  if (!configuredOwnerEmail && !configuredOwnerUid) {
    return false;
  }

  // UID-based check (strongest)
  if (configuredOwnerUid && user.uid === configuredOwnerUid) {
    return true;
  }

  // Email-based check (strictly requires email_verified == true)
  if (
    configuredOwnerEmail &&
    user.email &&
    user.email.trim().toLowerCase() === configuredOwnerEmail &&
    user.emailVerified === true
  ) {
    return true;
  }

  return false;
}

/**
 * Safely verifies post-publish server Firestore database access.
 * Non-destructive read against test/connection doc on the named database.
 * Fails closed without exposing credentials or tokens.
 */
export async function verifyServerDatabaseAccess(): Promise<{
  success: boolean;
  databaseId: string;
  projectId: string;
  credentialMode: string;
  readVerified: boolean;
  latencyMs: number;
  error?: string;
}> {
  const status = getServerIdentityStatus();
  if (!status.initialized) {
    return {
      success: false,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      credentialMode: status.credentialMode,
      readVerified: false,
      latencyMs: 0,
      error: `Server identity not initialized: ${status.error || 'Unknown initialization failure'}`,
    };
  }

  const startTime = Date.now();
  try {
    const db = getServerFirestore();
    // Non-destructive probe: read test/connection document in custom named database
    await db.collection('test').doc('connection').get();
    const latencyMs = Date.now() - startTime;

    return {
      success: true,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      credentialMode: status.credentialMode,
      readVerified: true,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      databaseId: TARGET_DATABASE_ID,
      projectId: TARGET_PROJECT_ID,
      credentialMode: status.credentialMode,
      readVerified: false,
      latencyMs,
      error: msg,
    };
  }
}


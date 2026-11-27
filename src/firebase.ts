/**
 * Firebase Client Initialization
 * Connects to the provisioned Firestore database and Firebase Authentication
 * targeting signalyn-5406e.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer, setLogLevel } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import configFile from '../firebase-applet-config.json';

// Suppress internal @firebase/firestore idle gRPC stream disconnect warnings
// ("1 CANCELLED: Disconnecting idle stream. Timed out waiting for new targets.")
// while preserving explicit application-level handleFirestoreError diagnostics.
setLogLevel('silent');

// Helper to filter out dummy environment placeholder strings like "projectId", "apiKey", etc.
function resolveConfig(envVal: unknown, configVal: string | undefined, placeholder: string): string {
  if (typeof envVal === 'string' && envVal.trim() && envVal !== placeholder && !envVal.startsWith('MY_')) {
    return envVal.trim();
  }
  return configVal || '';
}

const config = {
  projectId: resolveConfig(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_PROJECT_ID : undefined, configFile.projectId, 'projectId'),
  appId: resolveConfig(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_APP_ID : undefined, configFile.appId, 'appId'),
  apiKey: resolveConfig(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_API_KEY : undefined, configFile.apiKey, 'apiKey'),
  authDomain: resolveConfig(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN : undefined, configFile.authDomain, 'authDomain'),
  firestoreDatabaseId: resolveConfig(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_DATABASE_ID : undefined, configFile.firestoreDatabaseId, 'firestoreDatabaseId'),
  storageBucket: resolveConfig(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET : undefined, configFile.storageBucket, 'storageBucket'),
  messagingSenderId: resolveConfig(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined, configFile.messagingSenderId, 'messagingSenderId'),
};

const app = getApps().length === 0 ? initializeApp(config) : getApp();
export const db = getFirestore(app, config.firestoreDatabaseId);
export const auth = getAuth(app);

// -------------------------------------------------------------
// Firestore Error Handling & Diagnostic Spec (firebase-skill)
// -------------------------------------------------------------

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Universal bounded timeout promise wrapper.
 * Guarantees every async operation either resolves, rejects, or times out.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 15000,
  errorMessage = 'Firestore operation timed out.'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Validates connection to Firestore backend per firebase-skill.
 */
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await withTimeout(getDocFromServer(doc(db, 'test', 'connection')), 5000);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline notice: Please verify network connection to Firebase project.');
    }
    return false;
  }
}

export default app;

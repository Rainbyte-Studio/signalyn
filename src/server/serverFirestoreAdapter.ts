/**
 * Signalyn Server Firestore Adapter
 * 
 * Strict Server-Side Persistence Layer backed by Firebase Admin SDK.
 * Binds exclusively to the designated custom database:
 * ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34
 * 
 * Principles:
 * 1. ZERO silent fallback to unauthenticated client Web SDK writes.
 * 2. Fail-closed: If Admin SDK is not initialized, throws immediately.
 * 3. Preserves collection paths, schemas, transactions, batch writes, and server timestamps.
 */

import { Firestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getServerFirestore, getServerIdentityStatus } from './firestoreAdmin';

/**
 * Returns the trusted server-only Firestore instance.
 * Throws immediately if Admin credentials/identity are missing.
 */
export function getServerDb(): Firestore {
  return getServerFirestore();
}

/**
 * Helper to get Firestore FieldValue primitives for server operations.
 */
export const ServerFieldValue = FieldValue;
export const ServerTimestamp = Timestamp;

/**
 * Cleans object to remove undefined properties before persisting.
 */
export function cleanServerData<T extends Record<string, any>>(obj: T): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.filter((x) => x !== undefined).map(cleanServerData);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        res[k] = cleanServerData(v);
      }
    }
    return res;
  }
  return obj;
}

/**
 * Server-only generic document operations with strict error reporting.
 */
export async function serverGetDoc<T = any>(collectionName: string, docId: string): Promise<T | null> {
  const db = getServerDb();
  const snap = await db.collection(collectionName).doc(docId).get();
  if (!snap.exists) return null;
  return snap.data() as T;
}

export async function serverSetDoc(
  collectionName: string,
  docId: string,
  data: Record<string, any>,
  merge = false
): Promise<void> {
  const db = getServerDb();
  await db.collection(collectionName).doc(docId).set(cleanServerData(data), { merge });
}

export async function serverUpdateDoc(
  collectionName: string,
  docId: string,
  data: Record<string, any>
): Promise<void> {
  const db = getServerDb();
  await db.collection(collectionName).doc(docId).update(cleanServerData(data));
}

export async function serverDeleteDoc(collectionName: string, docId: string): Promise<void> {
  const db = getServerDb();
  await db.collection(collectionName).doc(docId).delete();
}

/**
 * Signalyn Client-Side API Session Manager
 * 
 * Attaches verified Firebase ID tokens when an authenticated user is logged in.
 * Public endpoints require standard JSON headers. Privileged endpoints require
 * the verified Authorization Bearer token with explicit administrator rights.
 */

import { auth } from '../firebase';

/**
 * Returns authenticated HTTP headers for backend mutation endpoints.
 * Automatically includes Firebase Auth Bearer token if user is signed in.
 */
export async function getAuthorizedApiHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    if (typeof auth.authStateReady === 'function') {
      await Promise.race([
        auth.authStateReady(),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    }
  } catch {
    // Ignore readiness wait errors
  }

  // If user is signed in with Google, provide their Firebase ID token
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken(forceRefresh);
      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
      }
    } catch (err) {
      console.warn('[Signalyn Auth] Notice retrieving Firebase ID token:', err);
    }
  }

  return headers;
}


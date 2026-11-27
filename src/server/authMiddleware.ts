/**
 * Signalyn Production API Authorization Middleware
 * 
 * Enforces strict least-privilege access for privileged mutation endpoints:
 * 1. Missing credentials -> HTTP 401 Unauthorized
 * 2. Unverified / non-administrator identity -> HTTP 403 Forbidden
 * 3. Unavailable / uninitialized trusted identity infrastructure -> HTTP 503 / 500 Fail Closed
 * 
 * NO LONGER ALLOWS ephemeral browser handshake or x-signalyn-session tokens
 * to authorize privileged mutation endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import {
  getServerIdentityStatus,
  verifyFirebaseIdToken,
  isAuthorizedOwner,
  getServerFirestore,
} from './firestoreAdmin';

// Sliding-window rate limiter per client IP
const ipRateLimits = new Map<string, number[]>();

export function checkRateLimit(ip: string, maxCalls = 30, windowMs = 3 * 60 * 1000): boolean {
  const now = Date.now();
  const timestamps = (ipRateLimits.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxCalls) {
    ipRateLimits.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  ipRateLimits.set(ip, timestamps);
  return true;
}

/**
 * Express middleware to enforce strict administrator authorization on privileged mutation endpoints.
 */
export async function requireAdminOrAuthorizedClient(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';

  // 1. Cross-Site Request Forgery / Cross-Origin check
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    res.status(403).json({
      error: 'Access Denied: Cross-origin mutation requests are strictly prohibited.',
    });
    return;
  }

  // 2. Rate-limit check
  if (!checkRateLimit(clientIp)) {
    res.status(429).json({
      error: 'Rate Limit Exceeded: Too many mutation requests. Please wait before retrying.',
    });
    return;
  }

  const authHeader = req.headers.authorization;

  // 3. Reject missing or malformed credentials immediately with 401
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

  // 4. Check for configured Admin API Key (Server-to-Server)
  if (process.env.ANALYSIS_ADMIN_KEY && bearerToken === process.env.ANALYSIS_ADMIN_KEY) {
    return next();
  }

  // 5. Fail-Closed check on trusted identity infrastructure
  const idStatus = getServerIdentityStatus();
  if (!idStatus.initialized) {
    res.status(503).json({
      error: 'Service Unavailable: Trusted identity verification infrastructure is unavailable. Fail closed.',
      credentialMode: idStatus.credentialMode,
    });
    return;
  }

  // 6. Verify Firebase ID Token via Firebase Admin Auth
  try {
    const decodedToken = await verifyFirebaseIdToken(bearerToken);
    
    // 7. Explicit administrator role evaluation
    const isOwner = isAuthorizedOwner({
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
    });

    const hasAdminClaim = Boolean((decodedToken as any).admin);

    if (isOwner || hasAdminClaim) {
      (req as any).user = decodedToken;
      (req as any).userEmail = decodedToken.email;
      return next();
    }

    let hasAdminDoc = false;
    try {
      const adminDocSnap = await getServerFirestore().collection('admins').doc(decodedToken.uid).get();
      hasAdminDoc = adminDocSnap.exists;
    } catch {
      hasAdminDoc = false;
    }

    if (hasAdminDoc) {
      // Attach verified identity to request context
      (req as any).user = decodedToken;
      (req as any).userEmail = decodedToken.email;
      return next();
    }

    // Authenticated but lacks explicit administrator authorization -> HTTP 403
    res.status(403).json({
      error: 'Forbidden: Authenticated user does not possess verified administrator privileges.',
      uid: decodedToken.uid,
    });
    return;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(401).json({
      error: 'Unauthorized: Invalid or expired Firebase ID token.',
      detail: msg,
    });
    return;
  }
}

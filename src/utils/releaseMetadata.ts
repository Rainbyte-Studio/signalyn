/**
 * SIGNALYN P2.3.2.2 — R01: Release Traceability & Build Identification Contract
 *
 * Pure, read-only release and build metadata resolution and frontend-vs-backend
 * version comparison utilities.
 *
 * Strict Governance Rules:
 * - Never invents random runtime IDs.
 * - Never uses current browser or request runtime time as a build timestamp.
 * - Uses 'UNKNOWN' whenever a build/deployment metadata field is unavailable.
 * - Exposes only sanitized, non-sensitive public release identifiers.
 */

export const SIGNALYN_APP_VERSION = '2.3.2.5';
export const UNKNOWN_RELEASE_VALUE = 'UNKNOWN';

export interface PublicReleaseMetadata {
  appVersion: string;
  buildId: string;
  commitSha: string;
  buildTimestamp: string;
  environment: string;
  serverReleaseId: string;
}

export type ReleaseMatchStatus =
  | 'VERIFIED_MATCH'
  | 'VERSION_MISMATCH'
  | 'PARTIAL_MATCH_UNKNOWN_FIELDS'
  | 'BACKEND_UNAVAILABLE';

export interface ReleaseComparisonSummary {
  status: ReleaseMatchStatus;
  versionMatchStatus: 'MATCH' | 'MISMATCH' | 'UNKNOWN';
  isMatch: boolean;
  isMatched: boolean;
  environment: string;
  badgeLabel: string;
  summaryLabel: string;
  badgeTone: 'verified' | 'warning' | 'info' | 'neutral';
  detailText: string;
  frontend: PublicReleaseMetadata;
  backend: PublicReleaseMetadata | null;
}

declare const __SIGNALYN_RELEASE_META__: Partial<PublicReleaseMetadata> | undefined;

/**
 * Checks whether a sanitized provenance token is a deterministic `src-<12-hex>` source fingerprint.
 */
export function isSourceFingerprintToken(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^src-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Classifies a provenance token into GIT_COMMIT_SHA, SOURCE_FINGERPRINT, or UNKNOWN.
 */
export function resolveProvenanceTokenKind(
  value: unknown
): 'GIT_COMMIT_SHA' | 'SOURCE_FINGERPRINT' | 'UNKNOWN' {
  const sanitized = sanitizeReleaseToken(value, UNKNOWN_RELEASE_VALUE);
  if (sanitized === UNKNOWN_RELEASE_VALUE) return 'UNKNOWN';
  if (isSourceFingerprintToken(sanitized)) return 'SOURCE_FINGERPRINT';
  return 'GIT_COMMIT_SHA';
}

/**
 * Sanitizes a single metadata token, returning 'UNKNOWN' if empty, missing, invalid,
 * or if it resembles an API key, token, email/service-account, or filesystem path.
 */
export function sanitizeReleaseToken(
  value: unknown,
  fallback: string = UNKNOWN_RELEASE_VALUE
): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    return fallback;
  }
  // Never expose API keys, bearer/JWT tokens, service account emails, or filesystem paths
  if (
    /^AIza/i.test(trimmed) ||
    /^sk-/i.test(trimmed) ||
    /^ya29\./i.test(trimmed) ||
    /^eyJ[A-Za-z0-9_-]+/i.test(trimmed) ||
    /secret|password|private_key|api_key/i.test(trimmed) ||
    trimmed.includes('@') ||
    trimmed.includes('/') ||
    trimmed.includes('\\')
  ) {
    return fallback;
  }
  // Bound length and strip any control characters
  return trimmed.replace(/[\r\n\t]/g, '').slice(0, 128);
}

/**
 * Validates that a build timestamp is a genuine ISO-8601 or build-time date string,
 * otherwise returns 'UNKNOWN'. Never substitutes current runtime Date.now().
 */
export function sanitizeBuildTimestamp(value: unknown): string {
  if (typeof value !== 'string') return UNKNOWN_RELEASE_VALUE;
  const trimmed = value.trim();
  if (!trimmed || trimmed === UNKNOWN_RELEASE_VALUE || trimmed === 'undefined' || trimmed === 'null') {
    return UNKNOWN_RELEASE_VALUE;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return UNKNOWN_RELEASE_VALUE;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return UNKNOWN_RELEASE_VALUE;
  return new Date(parsed).toISOString();
}

/**
 * Resolves sanitized public release metadata from an explicit partial config or environment map.
 * Pure and deterministic: never generates random IDs or runtime timestamps.
 */
export function resolveSanitizedReleaseMetadata(
  raw?: Record<string, unknown> | null,
  defaults?: Partial<PublicReleaseMetadata>
): PublicReleaseMetadata {
  const src = raw || {};
  const def = defaults || {};

  const appVersion = sanitizeReleaseToken(
    src.appVersion ??
      src.VITE_APP_VERSION ??
      src.APP_VERSION ??
      src.npm_package_version ??
      def.appVersion,
    SIGNALYN_APP_VERSION
  );

  const buildId = sanitizeReleaseToken(
    src.buildId ??
      src.VITE_BUILD_ID ??
      src.BUILD_ID ??
      src.CLOUD_BUILD_ID ??
      def.buildId,
    UNKNOWN_RELEASE_VALUE
  );

  const commitSha = sanitizeReleaseToken(
    src.commitSha ??
      src.VITE_GIT_COMMIT_SHA ??
      src.GIT_COMMIT_SHA ??
      src.COMMIT_SHA ??
      src.SHORT_SHA ??
      src.sourceFingerprint ??
      src.SIGNALYN_SOURCE_FINGERPRINT ??
      src.VITE_SOURCE_FINGERPRINT ??
      def.commitSha,
    UNKNOWN_RELEASE_VALUE
  );

  const buildTimestamp = sanitizeBuildTimestamp(
    src.buildTimestamp ??
      src.VITE_BUILD_TIMESTAMP ??
      src.BUILD_TIMESTAMP ??
      def.buildTimestamp
  );

  const serverReleaseId = sanitizeReleaseToken(
    src.serverReleaseId ??
      src.K_REVISION ??
      src.SERVER_RELEASE_ID ??
      src.VITE_SERVER_RELEASE_ID ??
      def.serverReleaseId ??
      (buildId !== UNKNOWN_RELEASE_VALUE ? buildId : UNKNOWN_RELEASE_VALUE),
    UNKNOWN_RELEASE_VALUE
  );

  let rawEnv = sanitizeReleaseToken(
    src.environment ??
      src.VITE_DEPLOYMENT_ENV ??
      src.DEPLOYMENT_ENV ??
      def.environment,
    UNKNOWN_RELEASE_VALUE
  );

  if (rawEnv === UNKNOWN_RELEASE_VALUE) {
    if (typeof src.K_SERVICE === 'string' && src.K_SERVICE.trim().length > 0) {
      rawEnv = 'cloud-run-production';
    } else if (src.NODE_ENV === 'production') {
      rawEnv = 'production';
    } else if (src.NODE_ENV === 'test') {
      rawEnv = 'test';
    } else if (src.NODE_ENV === 'development') {
      rawEnv = 'ai-studio-preview';
    }
  }

  return {
    appVersion,
    buildId,
    commitSha,
    buildTimestamp,
    environment: rawEnv,
    serverReleaseId,
  };
}

/**
 * Returns the frontend release metadata baked in at build time (or resolved from Vite import.meta.env).
 * Never uses browser runtime time or random IDs.
 */
export function getFrontendReleaseMetadata(): PublicReleaseMetadata {
  const baked: Partial<PublicReleaseMetadata> =
    typeof __SIGNALYN_RELEASE_META__ !== 'undefined' && __SIGNALYN_RELEASE_META__
      ? __SIGNALYN_RELEASE_META__
      : {};

  const metaEnv: Record<string, unknown> =
    typeof import.meta !== 'undefined' && (import.meta as any).env
      ? ((import.meta as any).env as Record<string, unknown>)
      : {};

  return resolveSanitizedReleaseMetadata(metaEnv, {
    appVersion: baked.appVersion || SIGNALYN_APP_VERSION,
    buildId: baked.buildId || UNKNOWN_RELEASE_VALUE,
    commitSha: baked.commitSha || UNKNOWN_RELEASE_VALUE,
    buildTimestamp: baked.buildTimestamp || UNKNOWN_RELEASE_VALUE,
    environment:
      baked.environment ||
      (metaEnv.PROD ? 'production' : metaEnv.DEV ? 'ai-studio-preview' : UNKNOWN_RELEASE_VALUE),
    serverReleaseId: baked.serverReleaseId || UNKNOWN_RELEASE_VALUE,
  });
}

/**
 * Compares frontend and backend release metadata to verify deployment consistency.
 */
export function compareFrontendBackendRelease(
  frontend: PublicReleaseMetadata,
  backend?: PublicReleaseMetadata | null
): ReleaseComparisonSummary {
  const effectiveEnvironment =
    backend?.environment && backend.environment !== UNKNOWN_RELEASE_VALUE
      ? backend.environment
      : frontend.environment;

  if (!backend) {
    const detailText =
      'Awaiting response from GET /api/system/release to compare frontend bundle and backend server revision.';
    return {
      status: 'BACKEND_UNAVAILABLE',
      versionMatchStatus: 'UNKNOWN',
      isMatch: false,
      isMatched: false,
      environment: effectiveEnvironment,
      badgeLabel: 'BACKEND UNVERIFIED',
      summaryLabel: detailText,
      badgeTone: 'neutral',
      detailText,
      frontend,
      backend: null,
    };
  }

  const versionMismatch =
    frontend.appVersion !== UNKNOWN_RELEASE_VALUE &&
    backend.appVersion !== UNKNOWN_RELEASE_VALUE &&
    frontend.appVersion !== backend.appVersion;

  const commitMismatch =
    frontend.commitSha !== UNKNOWN_RELEASE_VALUE &&
    backend.commitSha !== UNKNOWN_RELEASE_VALUE &&
    frontend.commitSha !== backend.commitSha;

  const buildMismatch =
    frontend.buildId !== UNKNOWN_RELEASE_VALUE &&
    backend.buildId !== UNKNOWN_RELEASE_VALUE &&
    frontend.buildId !== backend.buildId;

  const timestampMismatch =
    frontend.buildTimestamp !== UNKNOWN_RELEASE_VALUE &&
    backend.buildTimestamp !== UNKNOWN_RELEASE_VALUE &&
    frontend.buildTimestamp !== backend.buildTimestamp;

  if (versionMismatch || commitMismatch || buildMismatch || timestampMismatch) {
    const mismatchReasons: string[] = [];
    if (versionMismatch) {
      mismatchReasons.push(`version (${frontend.appVersion} vs ${backend.appVersion})`);
    }
    if (commitMismatch) {
      mismatchReasons.push(`commit (${frontend.commitSha} vs ${backend.commitSha})`);
    }
    if (buildMismatch) {
      mismatchReasons.push(`buildId (${frontend.buildId} vs ${backend.buildId})`);
    }
    if (timestampMismatch) {
      mismatchReasons.push(`buildTimestamp (${frontend.buildTimestamp} vs ${backend.buildTimestamp})`);
    }
    const detailText = `Frontend and backend release identifiers differ by ${mismatchReasons.join(', ')}.`;
    return {
      status: 'VERSION_MISMATCH',
      versionMatchStatus: 'MISMATCH',
      isMatch: false,
      isMatched: false,
      environment: effectiveEnvironment,
      badgeLabel: 'MISMATCH DETECTED',
      summaryLabel: detailText,
      badgeTone: 'warning',
      detailText,
      frontend,
      backend,
    };
  }

  const hasFullCommitAndBuild =
    frontend.commitSha !== UNKNOWN_RELEASE_VALUE &&
    backend.commitSha !== UNKNOWN_RELEASE_VALUE &&
    frontend.buildId !== UNKNOWN_RELEASE_VALUE &&
    backend.buildId !== UNKNOWN_RELEASE_VALUE;

  if (hasFullCommitAndBuild) {
    const isFingerprint = isSourceFingerprintToken(frontend.commitSha);
    const provenanceLabel = isFingerprint
      ? `source-code fingerprint ${frontend.commitSha}`
      : `commit SHA ${frontend.commitSha}`;
    const detailText = isFingerprint
      ? `Frontend bundle and backend server match on v${frontend.appVersion} (${provenanceLabel} — verifies canonical source-code tree parity and build metadata; not a cryptographic hash of the complete container binary).`
      : `Frontend bundle and backend server match on v${frontend.appVersion} (${provenanceLabel}).`;
    return {
      status: 'VERIFIED_MATCH',
      versionMatchStatus: 'MATCH',
      isMatch: true,
      isMatched: true,
      environment: effectiveEnvironment,
      badgeLabel: 'VERIFIED MATCH',
      summaryLabel: detailText,
      badgeTone: 'verified',
      detailText,
      frontend,
      backend,
    };
  }

  const detailText = `Application version v${frontend.appVersion} matches across frontend and backend; optional CI commit/build tokens are ${UNKNOWN_RELEASE_VALUE}.`;
  return {
    status: 'PARTIAL_MATCH_UNKNOWN_FIELDS',
    versionMatchStatus: 'MATCH',
    isMatch: true,
    isMatched: true,
    environment: effectiveEnvironment,
    badgeLabel: `VERSION MATCH (v${frontend.appVersion})`,
    summaryLabel: detailText,
    badgeTone: 'info',
    detailText,
    frontend,
    backend,
  };
}

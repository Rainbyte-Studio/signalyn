/**
 * SIGNALYN P2.3.2.5 — Task 1: Deterministic Source Fingerprint & Release Provenance
 *
 * Computes a deterministic, content-addressed SHA-256 fingerprint (`src-<12-hex>`)
 * over the application's canonical source tree so that builds and Cloud Run deployments
 * without `.git` metadata or CI commit SHA environment variables still expose a
 * verifiable, non-UNKNOWN provenance token across both frontend and backend.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { UNKNOWN_RELEASE_VALUE } from '../utils/releaseMetadata';

const CANONICAL_ROOT_FILES = ['package.json', 'server.ts', 'vite.config.ts'];
const CANONICAL_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

let cachedSourceFingerprint: { rootDir: string; fingerprint: string } | null = null;

function collectCanonicalSourceFiles(dirPath: string, rootDir: string, acc: string[]): void {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectCanonicalSourceFiles(fullPath, rootDir, acc);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (CANONICAL_SOURCE_EXTENSIONS.has(ext)) {
        const relPosix = path.relative(rootDir, fullPath).split(path.sep).join('/');
        acc.push(relPosix);
      }
    }
  }
}

/**
 * Computes a deterministic `src-<12-hex>` SHA-256 fingerprint of the canonical source files.
 * Normalizes line endings (`\r\n` -> `\n`) and sorts relative paths lexicographically.
 */
export function computeStableSourceFingerprint(
  rootDir: string = path.resolve('.'),
  options?: { bypassCache?: boolean }
): string {
  const resolvedRoot = path.resolve(rootDir);
  if (!options?.bypassCache && cachedSourceFingerprint?.rootDir === resolvedRoot) {
    return cachedSourceFingerprint.fingerprint;
  }

  try {
    const relativeFiles: string[] = [];
    for (const rootFile of CANONICAL_ROOT_FILES) {
      const candidate = path.join(resolvedRoot, rootFile);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        relativeFiles.push(rootFile);
      }
    }

    const srcDir = path.join(resolvedRoot, 'src');
    collectCanonicalSourceFiles(srcDir, resolvedRoot, relativeFiles);
    relativeFiles.sort((a, b) => a.localeCompare(b));

    if (relativeFiles.length === 0) {
      return UNKNOWN_RELEASE_VALUE;
    }

    const hash = crypto.createHash('sha256');
    for (const relPath of relativeFiles) {
      const absPath = path.join(resolvedRoot, relPath);
      const rawContent = fs.readFileSync(absPath, 'utf-8').replace(/\r\n/g, '\n');
      hash.update(`file:${relPath}\n`);
      hash.update(rawContent);
      hash.update('\n---\n');
    }

    const digestHex = hash.digest('hex').slice(0, 12);
    const fingerprint = `src-${digestHex}`;
    cachedSourceFingerprint = { rootDir: resolvedRoot, fingerprint };
    return fingerprint;
  } catch {
    return UNKNOWN_RELEASE_VALUE;
  }
}

export interface ResolvedServerReleaseProvenance {
  commitSha: string;
  sourceFingerprint: string;
  provenanceType: 'GIT_COMMIT_SHA' | 'SOURCE_FINGERPRINT' | 'UNKNOWN';
}

/**
 * Resolves the authoritative provenance token for build/runtime metadata:
 * 1. Explicit Git commit SHA from environment or build manifest (if present and not 'UNKNOWN' / 'src-*')
 * 2. Deterministic source fingerprint (`src-<12-hex>`) from build manifest or computed from source tree
 */
export function resolveServerReleaseProvenance(params?: {
  rootDir?: string;
  manifestData?: Record<string, unknown> | null;
  env?: NodeJS.ProcessEnv;
}): ResolvedServerReleaseProvenance {
  const env = params?.env ?? process.env;
  const manifest = params?.manifestData ?? {};
  const sourceFingerprint = computeStableSourceFingerprint(params?.rootDir);

  const rawEnvGitSha =
    env.SIGNALYN_COMMIT_SHA ||
    env.VITE_GIT_COMMIT_SHA ||
    env.GIT_COMMIT_SHA ||
    env.COMMIT_SHA ||
    env.SHORT_SHA ||
    env.GITHUB_SHA ||
    '';

  const trimmedEnvSha = String(rawEnvGitSha).trim();
  if (
    trimmedEnvSha &&
    trimmedEnvSha !== UNKNOWN_RELEASE_VALUE &&
    !trimmedEnvSha.startsWith('src-')
  ) {
    return {
      commitSha: trimmedEnvSha,
      sourceFingerprint,
      provenanceType: 'GIT_COMMIT_SHA',
    };
  }

  const rawManifestSha =
    typeof manifest.commitSha === 'string' ? manifest.commitSha.trim() : '';
  if (rawManifestSha && rawManifestSha !== UNKNOWN_RELEASE_VALUE) {
    return {
      commitSha: rawManifestSha,
      sourceFingerprint:
        rawManifestSha.startsWith('src-') ? rawManifestSha : sourceFingerprint,
      provenanceType: rawManifestSha.startsWith('src-')
        ? 'SOURCE_FINGERPRINT'
        : 'GIT_COMMIT_SHA',
    };
  }

  if (sourceFingerprint !== UNKNOWN_RELEASE_VALUE) {
    return {
      commitSha: sourceFingerprint,
      sourceFingerprint,
      provenanceType: 'SOURCE_FINGERPRINT',
    };
  }

  return {
    commitSha: UNKNOWN_RELEASE_VALUE,
    sourceFingerprint: UNKNOWN_RELEASE_VALUE,
    provenanceType: 'UNKNOWN',
  };
}

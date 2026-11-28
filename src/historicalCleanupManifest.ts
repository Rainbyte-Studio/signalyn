import type { HistoricalCleanupManifestSelection } from './types';

export const HISTORICAL_CLEANUP_ELIGIBLE_CATEGORIES = [
  'ELIGIBLE_HISTORICAL_PENDING',
  'ELIGIBLE_HISTORICAL_FAILED',
  'ELIGIBLE_OBSOLETE_OUT_OF_SCOPE',
  'ELIGIBLE_DUPLICATE_OR_UNUSABLE',
] as const;

export function parseHistoricalCleanupManifest(input: unknown): HistoricalCleanupManifestSelection {
  const invalid = () => new Error('INVALID_CLEANUP_MANIFEST: Expected unique article IDs, eligible categories, a matching count and a SHA-256 fingerprint.');
  if (!input || typeof input !== 'object') throw invalid();
  const { candidateCount, selectionSha256, candidates } = input as HistoricalCleanupManifestSelection;
  if (!Array.isArray(candidates) || !Number.isInteger(candidateCount) || candidateCount < 1 ||
      candidateCount > 10000 || candidates.length !== candidateCount ||
      typeof selectionSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(selectionSha256)) throw invalid();

  const seen = new Set<string>();
  const selection = candidates.map((row) => {
    if (!row || typeof row.id !== 'string' || !row.id || row.id === '.' || row.id === '..' ||
        /[\u0000-\u001f\u007f/:]/.test(row.id) || /^__.*__$/.test(row.id) ||
        new TextEncoder().encode(row.id).length > 1500 || seen.has(row.id) ||
        !HISTORICAL_CLEANUP_ELIGIBLE_CATEGORIES.includes(row.category)) throw invalid();
    seen.add(row.id);
    return { id: row.id, category: row.category };
  });
  selection.sort((a, b) => a.id.localeCompare(b.id));
  if (selection.some((row, index) => index > 0 && selection[index - 1].id.localeCompare(row.id) === 0)) {
    throw invalid();
  }
  return { candidateCount, selectionSha256, candidates: selection };
}

import React from 'react';
import type { HistoricalBacklogCleanupResult, HistoricalCleanupRecoveryReport } from '../../types';

interface CleanupOutcome extends Partial<Omit<HistoricalCleanupRecoveryReport, 'status'>> {
  status: HistoricalCleanupRecoveryReport['status'] | 'FAILED';
}

const statusLabels: Record<CleanupOutcome['status'], [string, string]> = {
  NOT_STARTED: ['Cleanup has not started', 'border-slate-700 text-slate-200'],
  RUNNING: ['Cleanup still running', 'border-indigo-700 text-indigo-200'],
  FAILED: ['Cleanup could not be confirmed', 'border-rose-700 text-rose-200'],
  STOPPED: ['Cleanup stopped', 'border-amber-700 text-amber-200'],
  PARTIAL: ['Cleanup partially completed', 'border-orange-700 text-orange-200'],
  COMPLETED: ['Cleanup completed', 'border-emerald-700 text-emerald-200'],
};

export function executionOutcome(result: HistoricalBacklogCleanupResult): CleanupOutcome {
  const committedCount = result.committedSelectedCount ?? result.deletedCount;
  const workRemains = Boolean(result.skippedDueToConcurrentChange || result.unprocessedSelectedCount ||
    result.unresolvedSelectedCount || result.outcomeUnverified);
  const allManifestRowsCommitted = result.manifestCandidateCount === committedCount;
  return {
    auditId: result.auditId,
    status: result.success === true && !workRemains ? 'COMPLETED' :
      allManifestRowsCommitted ? 'FAILED' : committedCount > 0 ? 'PARTIAL' :
        result.unprocessedSelectedCount !== undefined ? 'STOPPED' : 'FAILED',
    committedCount,
    skippedCount: result.skippedDueToConcurrentChange ?? result.skippedCount,
    unprocessedCount: result.unprocessedSelectedCount,
    unresolvedCount: result.unresolvedSelectedCount ?? (result.outcomeUnverified ? undefined : 0),
  };
}

export function HistoricalCleanupOutcome({ outcome, message }: { outcome: CleanupOutcome; message?: string }) {
  const [label, tone] = statusLabels[outcome.status];
  const counts = [
    ['Committed deletions', outcome.committedCount],
    ['Skipped', outcome.skippedCount],
    ['Unprocessed', outcome.unprocessedCount],
    ['Unresolved', outcome.unresolvedCount],
  ] as const;
  return (
    <section role="status" className={`rounded-xl border bg-slate-950/60 p-4 space-y-2 ${tone}`}>
      <h3 className="font-semibold">{label}</h3>
      {message && <p>{message}</p>}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd className="font-mono">{value === undefined ? 'Unverified' : value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {outcome.auditId && <p className="break-all font-mono">Audit ID {outcome.auditId}</p>}
    </section>
  );
}

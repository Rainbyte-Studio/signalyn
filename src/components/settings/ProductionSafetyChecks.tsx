import { useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, ContentCard, SectionHeader, SemanticBadge } from '../common/DesignSystem';
import { aiIntelligenceService } from '../../services/aiIntelligenceService';
import { DELETION_SAFETY_ROUTES, type ProductionSafetyReport, type SafetyCheckStatus } from '../../types/productionSafetyDiagnostics';

function CheckStatus({ status }: { status: SafetyCheckStatus }) {
  return <SemanticBadge variant={status === 'PASS' ? 'verified' : status === 'FAIL' ? 'error' : 'neutral'}>{status}</SemanticBadge>;
}

function enabled(value?: boolean | null) {
  return value == null ? 'Unverified' : value ? 'Enabled' : 'Disabled';
}

const deletionLabels = ['Backlog cleanup', 'Failed-article deletion'];
const transactionStages = {
  create: 'The temporary record could not be created and committed.',
  'read-update': 'A transaction could not read, query or update the committed record.',
  'delete-verify': 'Deletion of the temporary record could not be verified.',
  complete: 'Create, query, update and delete transactions committed. The temporary record was removed.',
  unavailable: 'The transaction check could not run against the trusted Firestore connection.',
} as const;

export function ProductionSafetyChecks() {
  const [report, setReport] = useState<ProductionSafetyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const running = useRef(false);

  async function runChecks() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setReport(null);
    setProblem(null);
    try {
      const result = await aiIntelligenceService.runProductionSafetyChecks();
      setReport(result);
      if (result.requestStatus === 429) {
        setProblem('Safety checks are rate-limited. Wait a minute and try again.');
      } else if (!result.backend) {
        setProblem('The server could not run the checks. Verify your administrator session and try again.');
      }
    } catch {
      setProblem('The safety checks could not be verified. Try again from a verified administrator session.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const backend = report?.backend;
  const environment = backend?.environment;
  const transaction = backend?.transaction;
  const environmentRows = [
    ['Application version', backend?.release.appVersion],
    ['Source fingerprint', backend?.release.sourceFingerprint],
    ['Cloud Run revision', environment?.revision],
    ['Firestore project', environment?.firestoreProject],
    ['Firestore database', environment?.firestoreDatabase],
    ['Gemini quota accounting mode', environment?.quotaAccountingMode],
    ['Permanent article deletion', enabled(environment?.permanentDeletionEnabled)],
    ['Historical Backfill', enabled(environment?.historicalBackfillEnabled)],
    ['Daily Pipeline runtime', environment?.dailyPipeline?.replaceAll('_', ' ')],
  ];

  return (
    <ContentCard className="space-y-5 p-5">
      <SectionHeader
        title="Production Safety Checks"
        subtitle="Checks deletion safeguards and Firestore transactions. Uses a temporary diagnostic record and makes no Gemini requests."
        badge={<ShieldCheck className="h-4 w-4 text-indigo-400" aria-hidden="true" />}
        actions={<Button type="button" size="sm" onClick={runChecks} disabled={busy}>{busy ? 'Running checks…' : 'Run Safety Checks'}</Button>}
      />
      <div aria-live="polite" aria-busy={busy} className="space-y-5">
        {problem && <p className="text-sm text-amber-300">{problem}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <h3 className="text-sm font-semibold text-slate-100">Permanent deletion safeguards</h3>
            {DELETION_SAFETY_ROUTES.map((route, index) => {
              const result = report?.deletion.find((entry) => entry.route === route);
              return (
                <div key={route} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-200">{deletionLabels[index]}</p>
                    <p className="break-all font-mono text-xs text-slate-400">
                      {result?.httpStatus ? 'HTTP ' + result.httpStatus : 'No verified response'}
                      {result?.disabledCodeConfirmed && ' · PERMANENT_ARTICLE_DELETION_DISABLED'}
                    </p>
                  </div>
                  <CheckStatus status={result?.status ?? 'UNVERIFIED'} />
                </div>
              );
            })}
          </div>
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-100">Firestore transactions</h3>
              <CheckStatus status={transaction?.status ?? 'UNVERIFIED'} />
            </div>
            <p className="text-sm text-slate-400">{transaction ? transactionStages[transaction.stage] : 'Run the checks to verify transaction commits.'}</p>
            {transaction?.status === 'FAIL' && !transaction.cleanupVerified && (
              <p className="text-sm text-amber-300">Temporary record cleanup is unverified. Check the server log before retrying.</p>
            )}
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <h3 className="text-sm font-semibold text-slate-100">Production environment</h3>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {environmentRows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="break-all text-sm text-slate-100">{value || 'Unverified'}</dd>
              </div>
            ))}
          </dl>
          {environment && <p className="text-xs text-slate-400">Pipeline runtime status does not indicate whether Cloud Scheduler is paused.</p>}
        </div>
      </div>
    </ContentCard>
  );
}

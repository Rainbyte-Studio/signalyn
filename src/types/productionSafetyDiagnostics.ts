export const PERMANENT_ARTICLE_DELETION_DISABLED = 'PERMANENT_ARTICLE_DELETION_DISABLED';

export const DELETION_SAFETY_ROUTES = [
  '/api/backfill/backlog-cleanup/execute',
  '/api/backfill/failures/delete',
] as const;

export type SafetyCheckStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';

export interface DeletionSafetyResult {
  route: (typeof DELETION_SAFETY_ROUTES)[number];
  status: SafetyCheckStatus;
  httpStatus: number | null;
  disabledCodeConfirmed: boolean;
}

export interface TransactionSafetyResult {
  status: SafetyCheckStatus;
  stage: 'create' | 'read-update' | 'delete-verify' | 'complete' | 'unavailable';
  cleanupVerified: boolean;
}

export interface ProductionSafetyBackendReport {
  transaction: TransactionSafetyResult;
  environment: {
    revision: string | null;
    firestoreProject: string | null;
    firestoreDatabase: string | null;
    quotaAccountingMode: 'FIRESTORE_TRANSACTION' | 'IN_PROCESS_FALLBACK' | null;
    permanentDeletionEnabled: boolean;
    historicalBackfillEnabled: boolean | null;
    dailyPipeline: 'RUNNING' | 'LEASE_ACTIVE' | 'IDLE' | null;
  };
}

export interface ProductionSafetyApiReport extends ProductionSafetyBackendReport {
  release: { appVersion: string; sourceFingerprint: string };
}

export interface ProductionSafetyReport {
  backend: ProductionSafetyApiReport | null;
  deletion: DeletionSafetyResult[];
  requestStatus: number | null;
}

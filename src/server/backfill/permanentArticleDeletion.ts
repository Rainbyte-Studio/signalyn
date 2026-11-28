import { PERMANENT_ARTICLE_DELETION_DISABLED } from '../../types/productionSafetyDiagnostics';

export { PERMANENT_ARTICLE_DELETION_DISABLED };

export class PermanentArticleDeletionDisabledError extends Error {
  readonly code = PERMANENT_ARTICLE_DELETION_DISABLED;

  constructor() {
    super('Permanent article deletion is disabled on this server. Previews and dry runs are available.');
    this.name = 'PermanentArticleDeletionDisabledError';
  }
}

/** Only the exact server-side opt-in enables either permanent deletion path. */
export function assertPermanentArticleDeletionEnabled(dryRun: boolean): void {
  if (!dryRun && !isPermanentArticleDeletionEnabled()) {
    throw new PermanentArticleDeletionDisabledError();
  }
}

export function isPermanentArticleDeletionEnabled(): boolean {
  return process.env.SIGNALYN_ENABLE_PERMANENT_ARTICLE_DELETION === 'true';
}

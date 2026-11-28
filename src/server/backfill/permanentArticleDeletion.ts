export const PERMANENT_ARTICLE_DELETION_DISABLED = 'PERMANENT_ARTICLE_DELETION_DISABLED';

export class PermanentArticleDeletionDisabledError extends Error {
  readonly code = PERMANENT_ARTICLE_DELETION_DISABLED;

  constructor() {
    super('Permanent article deletion is disabled on this server. Previews and dry runs are available.');
    this.name = 'PermanentArticleDeletionDisabledError';
  }
}

/** Only the exact server-side opt-in enables either permanent deletion path. */
export function assertPermanentArticleDeletionEnabled(dryRun: boolean): void {
  if (!dryRun && process.env.SIGNALYN_ENABLE_PERMANENT_ARTICLE_DELETION !== 'true') {
    throw new PermanentArticleDeletionDisabledError();
  }
}

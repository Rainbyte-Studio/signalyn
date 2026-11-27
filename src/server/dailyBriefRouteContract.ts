import type { Request, Response } from 'express';

export interface BriefDateValidationResult {
  valid: boolean;
  dateStr?: string;
  error?: string;
}

const STRICT_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Strictly validates `dateStr` and/or `date` parameters for Daily Brief and Pipeline endpoints.
 * - Rejects non-string values (numbers, arrays, objects, booleans) with `valid: false`.
 * - Rejects conflicting `dateStr` and `date` values when both are non-empty.
 * - Rejects malformed strings (e.g. `2026/10/31`, `not-a-date`) or invalid calendar dates
 *   (e.g. `2026-02-30`, `2026-13-01`) so they NEVER silently fall back to today's date.
 */
export function validateStrictBriefDateParam(input: {
  dateStr?: unknown;
  date?: unknown;
}): BriefDateValidationResult {
  const { dateStr, date } = input || {};

  const hasDateStr = dateStr !== undefined && dateStr !== null && dateStr !== '';
  const hasDate = date !== undefined && date !== null && date !== '';

  if (hasDateStr && typeof dateStr !== 'string') {
    return {
      valid: false,
      error: 'Invalid dateStr parameter: expected a YYYY-MM-DD string.',
    };
  }

  if (hasDate && typeof date !== 'string') {
    return {
      valid: false,
      error: 'Invalid date parameter: expected a YYYY-MM-DD string.',
    };
  }

  const trimmedDateStr = typeof dateStr === 'string' ? dateStr.trim() : '';
  const trimmedDate = typeof date === 'string' ? date.trim() : '';

  if (trimmedDateStr && trimmedDate && trimmedDateStr !== trimmedDate) {
    return {
      valid: false,
      error: `Conflicting date parameters supplied: dateStr="${trimmedDateStr}" vs date="${trimmedDate}".`,
    };
  }

  const candidate = trimmedDateStr || trimmedDate;
  if (!candidate) {
    return { valid: true, dateStr: undefined };
  }

  const match = STRICT_DATE_REGEX.exec(candidate);
  if (!match) {
    return {
      valid: false,
      error: `Invalid date format "${candidate}". Expected strict YYYY-MM-DD format.`,
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return {
      valid: false,
      error: `Invalid calendar date "${candidate}".`,
    };
  }

  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return {
      valid: false,
      error: `Invalid calendar date "${candidate}" (day does not exist in month).`,
    };
  }

  return {
    valid: true,
    dateStr: candidate,
  };
}

export interface GetDailyBriefHandlerDeps {
  getDailyBrief: (dateStr?: string) => Promise<any>;
}

/**
 * Pure read-only handler for `GET /api/daily-brief/latest` and `GET /api/daily-brief`.
 * Never invokes brief synthesis or mutates Firestore.
 */
export function createGetDailyBriefHandler(deps: GetDailyBriefHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const rawQueryDate = req.query?.date;
      if (Array.isArray(rawQueryDate)) {
        res.status(400).json({
          found: false,
          error: 'Multiple date query parameters are not allowed.',
        });
        return;
      }

      const validation = validateStrictBriefDateParam({
        date: rawQueryDate !== undefined ? String(rawQueryDate) : undefined,
      });

      if (!validation.valid) {
        res.status(400).json({
          found: false,
          error: validation.error || 'Invalid date parameter.',
        });
        return;
      }

      const brief = await deps.getDailyBrief(validation.dateStr);
      if (!brief) {
        res.status(404).json({
          found: false,
          date: validation.dateStr || null,
          error: 'Daily Brief not found for requested period.',
        });
        return;
      }

      res.json({
        ...brief,
        found: true,
        brief,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve daily brief.';
      console.error('[API /daily-brief] Error:', msg);
      res.status(500).json({ found: false, error: msg });
    }
  };
}

export interface PostDailyBriefGenerateHandlerDeps {
  generateDailyBrief: (options: {
    dateStr?: string;
    forceRegenerate?: boolean;
  }) => Promise<any>;
}

/**
 * Admin-only handler for `POST /api/daily-brief/generate`.
 * Enforces strict date validation before invoking `generateDailyBrief`.
 */
export function createPostDailyBriefGenerateHandler(deps: PostDailyBriefGenerateHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { dateStr, date, forceRegenerate } = req.body || {};
      const validation = validateStrictBriefDateParam({ dateStr, date });
      if (!validation.valid) {
        res.status(400).json({
          error: validation.error || 'Invalid date parameter.',
        });
        return;
      }

      const resolvedDateStr = validation.dateStr;
      console.log(
        `[API /daily-brief/generate] Triggering synthesis for ${resolvedDateStr || 'today'} (Force: ${Boolean(forceRegenerate)})`
      );
      const result = await deps.generateDailyBrief({
        dateStr: resolvedDateStr,
        forceRegenerate: Boolean(forceRegenerate),
      });
      res.json({
        ...result,
        brief: result,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Brief generation failed.';
      console.error('[API /daily-brief/generate] Error:', msg);
      res.status(500).json({ error: msg });
    }
  };
}

export interface PostPipelineRunHandlerDeps {
  runDailyIntelligencePipeline: (options: any) => Promise<any>;
  getPipelineStatus: () => Promise<any>;
}

/**
 * Admin-only handler for canonical `POST /api/pipeline/run`.
 * Enforces strict date validation before initiating pipeline execution.
 */
export function createPostPipelineRunHandler(deps: PostPipelineRunHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        trigger,
        dateStr,
        date,
        skipCollection,
        skipBrief,
        maxArticlesToAnalyze,
        forceRegenerateBrief,
      } = req.body || {};

      const validation = validateStrictBriefDateParam({ dateStr, date });
      if (!validation.valid) {
        res.status(400).json({
          error: validation.error || 'Invalid date parameter.',
        });
        return;
      }

      const resolvedDateStr = validation.dateStr;
      console.log(
        `[API /pipeline/run] Triggering daily intelligence cycle (Trigger: ${trigger || 'MANUAL_ADMIN'}, Date: ${resolvedDateStr || 'today'})`
      );

      if (req.query?.sync === 'true') {
        const record = await deps.runDailyIntelligencePipeline({
          trigger: trigger || 'MANUAL_ADMIN',
          dateStr: resolvedDateStr,
          skipCollection,
          skipBrief,
          maxArticlesToAnalyze,
          forceRegenerateBrief,
        });
        res.json(record);
        return;
      }

      deps
        .runDailyIntelligencePipeline({
          trigger: trigger || 'MANUAL_ADMIN',
          dateStr: resolvedDateStr,
          skipCollection,
          skipBrief,
          maxArticlesToAnalyze,
          forceRegenerateBrief,
        })
        .catch((err: any) => {
          console.error('[API /pipeline/run] Background pipeline execution error:', err);
        });

      await new Promise((r) => setTimeout(r, 60));
      const status = await deps.getPipelineStatus();
      res.json({
        isRunning: true,
        message: 'Daily intelligence pipeline initiated in background.',
        status: status.activeRun?.status || 'RUNNING',
        activeRun: status.activeRun,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Pipeline run failed.';
      console.error('[API /pipeline/run] Error:', msg);
      res.status(500).json({ error: msg });
    }
  };
}

/**
 * Signalyn AI Intelligence Service Client (Phase 3)
 * 
 * Provides client-side interface to the server-side Gemini intelligence engine.
 * Never exposes GEMINI_API_KEY to the browser; all requests communicate with
 * protected /api/analysis/* endpoints.
 */

import {
  ArticleAnalysis,
  EntityReview,
  BacklogInventory,
  BackfillBatchResult,
  FailedArticleActionResult,
  FailedArticleCategory,
  FailedArticlesRecoveryPreview,
  GeminiQuotaStatus,
  HistoricalBackfillConfig,
  HistoricalBacklogCleanupPreview,
  HistoricalBacklogCleanupResult,
  HistoricalCleanupEligibleDisposition,
  OutOfScopeCleanupPreview,
  OutOfScopeCleanupResult,
  UncertainArticlesPreview,
} from '../types';

import { getAuthorizedApiHeaders } from './apiSessionClient';
import {
  DELETION_SAFETY_ROUTES,
  PERMANENT_ARTICLE_DELETION_DISABLED,
  type DeletionSafetyResult,
  type ProductionSafetyApiReport,
  type ProductionSafetyReport,
} from '../types/productionSafetyDiagnostics';

export interface AnalysisStatusResponse {
  configured: boolean;
  model: string;
  version: string;
  timestamp: string;
}

export interface AnalysisExecutionResponse {
  success: boolean;
  articleId: string;
  analysis?: ArticleAnalysis;
  error?: string;
  durationMs: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface BatchAnalysisResponse {
  runId: string;
  totalAttempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  durationMs: number;
  results: AnalysisExecutionResponse[];
}

export interface DailyBriefSection {
  title: string;
  category: string;
  highlights: string[];
  threatLevel: 'LOW' | 'MEDIUM' | 'ELEVATED' | 'HIGH';
  implicationSummary: string;
}

export interface DailyBriefReport {
  date: string;
  generatedAt?: string;
  companyName: string;
  executiveHeadline: string;
  executiveSummary: string;
  sections: DailyBriefSection[];
  status: 'PENDING_INTEGRATION' | 'READY';
}

export class GeminiIntelligenceServiceClient {
  private sessionToken: string | null = null;
  private sessionExpiresAt = 0;

  /**
   * Acquires or reuses an ephemeral same-origin session token.
   */
  private async getAuthorizedHeaders(): Promise<Record<string, string>> {
    return await getAuthorizedApiHeaders();
  }

  async runProductionSafetyChecks(): Promise<ProductionSafetyReport> {
    const headers = await this.getAuthorizedHeaders();
    const unverified = (route: DeletionSafetyResult['route']): DeletionSafetyResult => ({
      route, status: 'UNVERIFIED', httpStatus: null, disabledCodeConfirmed: false,
    });
    const options = { method: 'POST', headers, redirect: 'error', cache: 'no-store' } as const;
    const response = await fetch('/api/admin/production-safety-diagnostics', options);
    if (!response.ok) {
      return { backend: null, deletion: DELETION_SAFETY_ROUTES.map(unverified), requestStatus: response.status };
    }
    const backend: ProductionSafetyApiReport = await response.json();
    if (!backend?.transaction || !backend.environment || !backend.release ||
        (backend.transaction.status === 'PASS' &&
          (backend.transaction.stage !== 'complete' || backend.transaction.cleanupVerified !== true))) {
      throw new Error('Unexpected safety diagnostic response.');
    }
    const deletion = await Promise.all(DELETION_SAFETY_ROUTES.map(async (route): Promise<DeletionSafetyResult> => {
      try {
        const result = await fetch(route, {
          ...options,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: '{"dryRun":false}',
        });
        const body = await result.json().catch(() => null);
        const disabledCodeConfirmed = result.status === 503 && body?.code === PERMANENT_ARTICLE_DELETION_DISABLED;
        return {
          route,
          status: disabledCodeConfirmed ? 'PASS' : [401, 403, 429].includes(result.status) ? 'UNVERIFIED' : 'FAIL',
          httpStatus: result.status,
          disabledCodeConfirmed,
        };
      } catch {
        return unverified(route);
      }
    }));
    return { backend, deletion, requestStatus: response.status };
  }

  /**
   * Checks whether Gemini is configured on the backend server.
   */
  async getStatus(): Promise<AnalysisStatusResponse> {
    try {
      const res = await fetch('/api/analysis/status');
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      return await res.json();
    } catch {
      return {
        configured: false,
        model: 'gemini-3.1-flash-lite',
        version: 'signalyn-analysis-v1',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Fetches analysis for a specific article from server.
   */
  async getArticleAnalysis(articleId: string): Promise<ArticleAnalysis | null> {
    try {
      const res = await fetch(`/api/analysis/article/${encodeURIComponent(articleId)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Could not fetch analysis for article ${articleId}:`, err);
      return null;
    }
  }

  /**
   * Triggers server-side Gemini analysis on a single article.
   */
  async analyzeArticle(
    articleId: string,
    options?: { forceReanalyze?: boolean }
  ): Promise<AnalysisExecutionResponse> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/analysis/article/${encodeURIComponent(articleId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ forceReanalyze: Boolean(options?.forceReanalyze) }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Analysis failed with status ${res.status}`);
    }

    return data;
  }

  /**
   * Triggers batch analysis on a specific list of article IDs.
   */
  async analyzeBatch(
    articleIds: string[],
    options?: { forceReanalyze?: boolean }
  ): Promise<BatchAnalysisResponse> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/analysis/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        articleIds,
        forceReanalyze: Boolean(options?.forceReanalyze),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Batch analysis failed with status ${res.status}`);
    }

    return data;
  }

  /**
   * Triggers processing for articles currently in PENDING state.
   */
  async analyzePendingArticles(maxCount = 5): Promise<BatchAnalysisResponse> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/analysis/pending', {
      method: 'POST',
      headers,
      body: JSON.stringify({ maxCount }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Pending analysis failed with status ${res.status}`);
    }

    return data;
  }

  // Daily brief compatibility helper
  getIntegrationStatus() {
    return {
      engine: 'Google Gemini (gemini-3.1-flash-lite)',
      stage: 'PHASE_6_INTELLIGENCE' as const,
      readyForGemini: true,
      requiredEndpoint: '/api/daily-brief/latest',
      description:
        'Phase 6 delivers autonomous daily intelligence pipeline orchestration and executive data-grounded daily briefings.',
    };
  }

  /**
   * Fetches the latest published daily brief from server.
   */
  async getLatestDailyBrief(dateStr?: string): Promise<import('../types/dailyBrief').DailyBriefDocument | null> {
    try {
      const q = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
      const res = await fetch(`/api/daily-brief/latest${q}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Failed to fetch daily brief from server:', err);
      return null;
    }
  }

  /**
   * Admin-only: Triggers brief generation or regeneration.
   */
  async generateDailyBriefDocument(options?: {
    dateStr?: string;
    forceRegenerate?: boolean;
  }): Promise<import('../types/dailyBrief').DailyBriefDocument> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/daily-brief/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Brief generation failed with status ${res.status}`);
    }

    return data;
  }

  /**
   * Lists archived daily briefs.
   */
  async getDailyBriefArchives(limit = 30): Promise<Array<Partial<import('../types/dailyBrief').DailyBriefDocument>>> {
    try {
      const res = await fetch(`/api/daily-brief/archive?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const data = await res.json();
      return data.briefs || [];
    } catch (err) {
      console.warn('Failed to fetch brief archives:', err);
      return [];
    }
  }

  /**
   * Fetches status of the pipeline orchestrator and distributed lease.
   */
  async getPipelineStatus(): Promise<any> {
    try {
      const res = await fetch('/api/pipeline/status');
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Failed to fetch pipeline status:', err);
      return { isRunning: false, activeRun: null, lastCompletedRun: null };
    }
  }

  /**
   * Admin-only: Triggers end-to-end Daily Intelligence Pipeline.
   */
  async triggerPipelineRun(options?: any): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Pipeline run failed with status ${res.status}`);
    }

    return data;
  }

  /**
   * Phase 6D: Retrieves read-only backlog inventory of actual Firestore articles.
   */
  async getBacklogInventory(): Promise<BacklogInventory> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/inventory', { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to fetch backlog inventory (${res.status})`);
    }
    return data.inventory;
  }

  /**
   * Phase 6D: Previews upcoming candidate articles eligible for historical analysis.
   */
  async previewEligibleArticles(limit = 20, runId?: string): Promise<any[]> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/backfill/preview?${new URLSearchParams({ limit: String(limit), ...(runId ? { runId } : {}) })}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to preview eligible articles (${res.status})`);
    }
    return data.candidates || [];
  }

  /**
   * Phase 6D: Executes a single synchronous bounded backfill batch.
   */
  async executeBackfillBatch(options?: {
    batchSize?: number;
    runId?: string;
    maxStage2Calls?: number;
  }): Promise<BackfillBatchResult> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 || data.pipelineActive) {
        throw new Error(`Scheduled Daily Pipeline is active. Historical backfill yielded.`);
      }
      throw new Error(data.error || `Backfill batch failed (${res.status})`);
    }
    return data;
  }

  /**
   * Phase 6D: Pauses an active backfill run.
   */
  async pauseBackfill(runId: string): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/backfill/${encodeURIComponent(runId)}/pause`, {
      method: 'POST',
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to pause backfill (${res.status})`);
    }
    return data;
  }

  /**
   * Phase 6D: Resumes a paused backfill run.
   */
  async resumeBackfill(runId: string): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/backfill/${encodeURIComponent(runId)}/resume`, {
      method: 'POST',
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to resume backfill (${res.status})`);
    }
    return data;
  }

  /**
   * Cancels an active or paused historical backfill run.
   */
  async cancelBackfill(runId: string): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/backfill/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to cancel backfill (${res.status})`);
    }
    return data;
  }

  /**
   * Admin-only: Read-only inventory and classification of historical failed articles.
   */
  async previewFailedArticlesRecovery(options?: {
    limit?: number;
    category?: FailedArticleCategory | 'ALL';
    includeArchived?: boolean;
  }): Promise<FailedArticlesRecoveryPreview> {
    const headers = await this.getAuthorizedHeaders();
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.category) params.set('category', options.category);
    if (options?.includeArchived) params.set('includeArchived', 'true');
    const qs = params.toString();
    const res = await fetch(`/api/backfill/failures/preview${qs ? `?${qs}` : ''}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to preview failed articles (${res.status})`);
    }
    return data.preview;
  }

  /**
   * Admin-only: Requeue recoverable failed articles (dry-run by default).
   */
  async requeueRecoverableFailedArticles(options?: {
    articleIds?: string[];
    categories?: FailedArticleCategory[];
    dryRun?: boolean;
    confirm?: boolean;
    maxItems?: number;
  }): Promise<FailedArticleActionResult> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/failures/recover', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to requeue articles (${res.status})`);
    }
    return data;
  }

  /**
   * Admin-only: Reconcile stale failed articles that already have completed analyses.
   */
  async dismissResolvedFailedArticles(options?: {
    articleIds?: string[];
    dryRun?: boolean;
    confirm?: boolean;
  }): Promise<FailedArticleActionResult> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/failures/dismiss-resolved', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to dismiss resolved articles (${res.status})`);
    }
    return data;
  }

  /**
   * Admin-only: Non-destructively archive obsolete or unrecoverable failed articles.
   */
  async archiveFailedArticles(options?: {
    articleIds?: string[];
    categories?: FailedArticleCategory[];
    reason?: string;
    dryRun?: boolean;
    confirm?: boolean;
  }): Promise<FailedArticleActionResult> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/failures/archive', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to archive failed articles (${res.status})`);
    }
    return data;
  }

  /**
   * Admin-only: Guarded permanent deletion of unreferenced obsolete failed articles.
   */
  async deleteObsoleteFailedArticles(options: {
    articleIds: string[];
    dryRun?: boolean;
    confirmDelete?: boolean;
    confirmationToken?: string;
  }): Promise<FailedArticleActionResult> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/failures/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to delete obsolete articles (${res.status})`);
    }
    return data;
  }

  /**
   * Phase 6D: Retrieves current backfill status and active run record.
   */
  async getBackfillStatus(): Promise<any> {
    try {
      const res = await fetch('/api/backfill/status');
      return await res.json();
    } catch (err) {
      console.warn('Failed to fetch backfill status:', err);
      return { success: false, status: 'IDLE', activeRun: null };
    }
  }

  async getHistoricalBackfillCheckpoint(): Promise<{ runId: string; isPaused: boolean } | null> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/checkpoint', { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to read historical backfill checkpoint (${res.status})`);
    }
    return data.checkpoint;
  }

  /**
   * Phase 6E: Previews legacy out-of-scope candidate articles for safe cleanup.
   */
  async previewOutOfScopeCleanup(limit = 100): Promise<OutOfScopeCleanupPreview> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/backfill/cleanup/preview?limit=${limit}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to preview out-of-scope cleanup (${res.status})`);
    }
    return data.preview;
  }

  /**
   * Phase 6E: Executes safe cleanup of legacy out-of-scope articles (dry-run by default).
   */
  async executeOutOfScopeCleanup(options?: {
    dryRun?: boolean;
    confirmCleanup?: boolean;
    batchLimit?: number;
  }): Promise<OutOfScopeCleanupResult> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/cleanup/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 || data.pipelineActive) {
        throw new Error('Scheduled Daily Pipeline is active. Cleanup yielded.');
      }
      throw new Error(data.error || `Cleanup execution failed (${res.status})`);
    }
    return data;
  }

  /**
   * Phase 6E: Previews uncertain corporate/ecosystem articles with heuristic breakdown.
   */
  async previewUncertainArticles(limit = 62): Promise<UncertainArticlesPreview> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/backfill/uncertain/preview?limit=${limit}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to preview uncertain articles (${res.status})`);
    }
    return data.preview;
  }

  // Backward-compatibility wrapper for legacy preview
  async generateDailyBrief(date: string, companyId: string): Promise<DailyBriefReport> {
    return {
      date,
      companyName: companyId === 'comp-huawei' ? 'HUAWEI' : 'Primary Company',
      executiveHeadline: 'Phase 3 Article Intelligence Pipeline Live in Cloud Firestore',
      executiveSummary:
        'Articles are analyzed via server-side Gemini into structured intelligence. Aggregated overnight executive briefing synthesis is scheduled for Phase 4.',
      sections: [
        {
          title: 'Flagship & Foldables Competitive Dynamics',
          category: 'Smartphones',
          highlights: [
            'Live Gemini analysis active in Feed view for all incoming articles.',
            'Competitive relevance, sentiment, and grounded signals extracted to /articleAnalysis.',
          ],
          threatLevel: 'MEDIUM',
          implicationSummary:
            'Continuous monitoring active across registered sources in signalyn-5406e.',
        },
      ],
      status: 'READY',
    };
  }

  /**
   * Phase 7B.1: Runs a read-only lifecycle dry-run across all production stories.
   */
  async getStoryLifecycleDryRun(): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/stories/lifecycle/dry-run', {
      method: 'POST',
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to execute lifecycle dry-run (${res.status})`);
    }
    return data;
  }

  /**
   * Phase 7B.1: Executes bounded, administrator-controlled lifecycle reconciliation.
   */
  async executeStoryLifecycleReconciliation(options?: { batchSize?: number; limit?: number }): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/stories/lifecycle/reconcile', {
      method: 'POST',
      headers,
      body: JSON.stringify(options || {}),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to execute lifecycle reconciliation (${res.status})`);
    }
    return data;
  }

  /**
   * Phase 7B.2: Runs a read-only duplicate story audit across production stories.
   */
  async getStoryDuplicateAudit(): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/stories/audit/duplicates', {
      method: 'GET',
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to execute duplicate audit (${res.status})`);
    }
    return data;
  }

  /**
   * Phase 7B.2: Executes bounded, atomic merge of two confirmed duplicate stories.
   */
  async executeStoryMerge(params: { targetStoryId: string; sourceStoryId: string; reason?: string }): Promise<any> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/stories/reconcile/merge', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to execute story merge (${res.status})`);
    }
    return data;
  }
  /**
   * Admin-only: Read Historical Backfill enablement config (disabled by default).
   */
  async getHistoricalBackfillConfig(): Promise<HistoricalBackfillConfig> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/config', { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to fetch historical backfill config (${res.status})`);
    }
    return data.config;
  }

  /**
   * Admin-only: Explicitly enable or disable Historical Backfill.
   */
  async setHistoricalBackfillEnabled(enabled: boolean, note?: string): Promise<HistoricalBackfillConfig> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/config', {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabled, note }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to update historical backfill config (${res.status})`);
    }
    return data.config;
  }

  /**
   * Read-only: Fetch Gemini API quota protection status & true provider-request accounting.
   */
  async getGeminiQuotaStatus(): Promise<GeminiQuotaStatus> {
    const res = await fetch('/api/quota/status');
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to fetch Gemini quota status (${res.status})`);
    }
    return data.quota;
  }

  /**
   * Admin-only: Read-only preview of Historical Backlog Cleanup with full 6-collection dependency checks.
   */
  async previewHistoricalBacklogCleanup(sampleLimit = 10): Promise<HistoricalBacklogCleanupPreview> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(
      `/api/backfill/backlog-cleanup/preview?sampleLimit=${encodeURIComponent(String(sampleLimit))}`,
      { headers }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to preview historical backlog cleanup (${res.status})`);
    }
    return data.preview;
  }

  /**
   * Admin-only: Execute bounded, atomic, preview-bound Historical Backlog Cleanup (dry-run by default).
   */
  async executeHistoricalBacklogCleanup(options: {
    dryRun?: boolean;
    confirmCleanup?: boolean;
    previewFingerprint?: string;
    confirmationToken?: string;
    categories?: HistoricalCleanupEligibleDisposition[];
    maxDeletions?: number;
  }): Promise<HistoricalBacklogCleanupResult> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch('/api/backfill/backlog-cleanup/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Historical backlog cleanup failed (${res.status})`);
    }
    return data;
  }
}

export const aiIntelligenceService = new GeminiIntelligenceServiceClient();

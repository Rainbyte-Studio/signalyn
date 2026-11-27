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
  OutOfScopeCleanupPreview,
  OutOfScopeCleanupResult,
  UncertainArticlesPreview,
} from '../types';

import { getAuthorizedApiHeaders } from './apiSessionClient';

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
  async previewEligibleArticles(limit = 20): Promise<any[]> {
    const headers = await this.getAuthorizedHeaders();
    const res = await fetch(`/api/backfill/preview?limit=${limit}`, { headers });
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
}

export const aiIntelligenceService = new GeminiIntelligenceServiceClient();

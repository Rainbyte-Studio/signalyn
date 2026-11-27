/**
 * Signalyn Collector Client Service
 * 
 * Interacts with the backend collector endpoints to trigger manual
 * or single-source ingestion cycles, and inspect collector status.
 */

import { getAuthorizedApiHeaders } from './apiSessionClient';

export interface CollectorRunStats {
  id: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  articlesDiscovered: number;
  articlesCreated: number;
  articlesUpdated: number;
  duplicatesSkipped: number;
  errors: Array<{ sourceId?: string; sourceName?: string; error: string }>;
  triggeredBy: string;
}

export interface CollectorStatus {
  isRunning: boolean;
  currentRunStatus: 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | string;
  lastSuccessfulGlobalCollection: string | null;
  collectionIntervalMinutes: number;
  isSchedulerActive: boolean;
  activeRun?: CollectorRunStats | null;
  lastRun?: CollectorRunStats | null;
  staleRunRecovered?: boolean;
}

export class CollectorClientService {
  async triggerRun(sourceId?: string, feedId?: string): Promise<CollectorRunStats> {
    const authHeaders = await getAuthorizedApiHeaders();
    const res = await fetch('/api/collector/run', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        sourceId,
        feedId,
        triggeredBy: feedId ? 'SINGLE_FEED' : sourceId ? 'SINGLE_SOURCE' : 'MANUAL',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Collector cycle failed with HTTP ${res.status}`);
    }

    return await res.json();
  }

  async getStatus(): Promise<CollectorStatus> {
    const res = await fetch('/api/collector/status');
    if (!res.ok) {
      throw new Error(`Failed to fetch collector status: HTTP ${res.status}`);
    }
    return await res.json();
  }
}

export const collectorClient = new CollectorClientService();

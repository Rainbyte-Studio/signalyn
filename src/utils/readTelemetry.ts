/**
 * Development-Only In-Memory Firestore Read Telemetry
 * 
 * Tracks and estimates document reads across key system operations:
 * - refreshData
 * - collector run
 * - single analysis
 * - 30-article batch
 * - story clustering
 * 
 * Safety constraints:
 * - In-memory only: NEVER writes telemetry documents to Firestore.
 * - Lightweight: zero overhead in production.
 */

export interface ReadEstimateEvent {
  operation: string;
  estimatedReads: number;
  details?: Record<string, number>;
  timestamp: string;
}

const recentEvents: ReadEstimateEvent[] = [];
const MAX_EVENTS = 50;

export const readTelemetry = {
  record(operation: string, estimatedReads: number, details?: Record<string, number>): void {
    const event: ReadEstimateEvent = {
      operation,
      estimatedReads,
      details,
      timestamp: new Date().toISOString(),
    };

    recentEvents.unshift(event);
    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.pop();
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[ReadTelemetry] ${operation}: ~${estimatedReads} reads`,
        details ? JSON.stringify(details) : ''
      );
    }
  },

  getRecentEvents(): ReadEstimateEvent[] {
    return [...recentEvents];
  },

  getSummary(): Record<string, { totalReads: number; callCount: number; avgReads: number }> {
    const summary: Record<string, { totalReads: number; callCount: number; avgReads: number }> = {};
    for (const ev of recentEvents) {
      if (!summary[ev.operation]) {
        summary[ev.operation] = { totalReads: 0, callCount: 0, avgReads: 0 };
      }
      summary[ev.operation].totalReads += ev.estimatedReads;
      summary[ev.operation].callCount += 1;
    }
    for (const op of Object.keys(summary)) {
      summary[op].avgReads = Math.round(summary[op].totalReads / summary[op].callCount);
    }
    return summary;
  },

  clear(): void {
    recentEvents.length = 0;
  },
};

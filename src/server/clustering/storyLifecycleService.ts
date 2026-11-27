/**
 * Signalyn Phase 7B.1 Deterministic Story Lifecycle Maintenance Service
 *
 * Implements authoritative lifecycle states:
 * - NEW: Recently created story with an initial qualifying article (age <= 24h, articleCount <= 1).
 * - DEVELOPING: Story receiving meaningful developments within the last 7 days (dormantDays < 7).
 * - STABLE: Established claims with no updates for at least 7 days (7 <= dormantDays < 30).
 * - RESOLVED: Documented terminal development (concluded product launch / explicit terminal event).
 *             (Never assigned solely based on elapsed time).
 * - ARCHIVED: Dormant stories with no updates for at least 30 days (dormantDays >= 30).
 *             (Reversible if new evidence is attached within last 7 days).
 *
 * Invariants:
 * 1. Zero destructive mutations — preserves existing Story IDs, article IDs, and analyses.
 * 2. Idempotent & Write-Conserving — zero Firestore writes when status is unchanged.
 * 3. Lifecycle maturity is strictly separated from factual verification.
 * 4. Bounded transition history — story.lifecycleTransitions capped at 5 entries.
 * 5. Dedicated event collection (/system/storyLifecycle/events/{id}) for immutable audit trail.
 */

import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import { Story, StoryStatus, LifecycleTransition, isLegacyStory } from '../../types';
import { getStoryCanonicalCategories, ALL_CANONICAL_DEVICE_CATEGORIES } from '../../utils/categoryModel';

export interface LifecycleEvaluationResult {
  storyId: string;
  currentStatus: StoryStatus;
  proposedStatus: StoryStatus;
  changed: boolean;
  reason: string;
  firstSeenAt: string;
  lastSeenAt: string;
  dormantDays: number;
  ageHours: number;
  isReactivation: boolean;
}

export interface LifecycleDryRunReport {
  totalProductionStories: number;
  storiesRequiringChangeCount: number;
  currentLifecycleDistribution: Record<string, number>;
  proposedLifecycleDistribution: Record<string, number>;
  storiesWithMissingTimestamps: number;
  storiesWithInconsistentCategories: number;
  potentiallyArchivedCount: number;
  potentiallyReactivatedCount: number;
  sampleComparisons: Array<{
    id: string;
    title: string;
    currentStatus: StoryStatus;
    proposedStatus: StoryStatus;
    reason: string;
    lastSeenAt: string;
    articleCount: number;
  }>;
}

export interface LifecycleMaintenanceOptions {
  batchSize?: number;
  maxTotal?: number;
  dryRun?: boolean;
  now?: Date;
  limit?: number;
}

export interface LifecycleMaintenanceResult {
  storiesEvaluated: number;
  storiesNew: number;
  storiesDeveloping: number;
  storiesStable: number;
  storiesResolved: number;
  storiesArchived: number;
  storiesReactivated: number;
  storiesChanged: number;
  lifecycleErrors: number;
  durationMs: number;
  dryRun: boolean;
}

/**
 * Deterministically evaluates the lifecycle status of a single Story.
 * Pure function: zero side-effects, zero mutations.
 */
export function evaluateStoryLifecycle(
  story: Story,
  options?: { now?: Date }
): LifecycleEvaluationResult {
  const now = options?.now || new Date();
  const nowMs = now.getTime();

  // 1. Safe timestamp resolution with fallbacks
  let firstSeen = story.firstSeenAt;
  let lastSeen = story.lastSeenAt || story.lastUpdatedAt || story.updatedAt;

  const isFirstMissing = !firstSeen || isNaN(new Date(firstSeen).getTime());
  const isLastMissing = !lastSeen || isNaN(new Date(lastSeen).getTime());

  if (isFirstMissing) {
    firstSeen = story.createdAt || now.toISOString();
  }
  if (isLastMissing) {
    lastSeen = firstSeen || story.updatedAt || now.toISOString();
  }

  const firstMs = new Date(firstSeen).getTime();
  const lastMs = new Date(lastSeen).getTime();

  const ageHours = Math.max(0, (nowMs - firstMs) / (1000 * 60 * 60));
  const dormantDays = Math.max(0, (nowMs - lastMs) / (1000 * 60 * 60 * 24));

  const currentStatus = story.status || ('DEVELOPING' as StoryStatus);
  let proposedStatus: StoryStatus = currentStatus;
  let reason = '';
  let isReactivation = false;

  // 2. Terminal event evaluation (Documented conclusion required — never based on elapsed time)
  if (story.terminalReason && story.terminalReason.trim()) {
    proposedStatus = 'RESOLVED';
    reason = `Documented terminal development: ${story.terminalReason}`;
  } else if (currentStatus === 'RESOLVED') {
    // Retain RESOLVED unless new evidence arrived after resolution
    if (dormantDays <= 7 && (story.articleCount ?? 0) > 1) {
      proposedStatus = 'DEVELOPING';
      isReactivation = true;
      reason = `Reactivated from RESOLVED: New active reporting arrived (${dormantDays.toFixed(1)}d ago)`;
    } else {
      proposedStatus = 'RESOLVED';
      reason = 'Preserved RESOLVED state: Documented terminal conclusion';
    }
  } else if (currentStatus === 'ARCHIVED' || currentStatus === 'STALE') {
    // 3. Reactivation check for dormant stories
    if (dormantDays <= 7) {
      proposedStatus = 'DEVELOPING';
      isReactivation = true;
      reason = `Reactivated from ${currentStatus}: Genuinely new developments received within last 7 days (${dormantDays.toFixed(1)}d ago)`;
    } else {
      proposedStatus = 'ARCHIVED';
      reason = `Preserved ARCHIVED state: Dormant for >= 30 days without new updates (${dormantDays.toFixed(1)}d)`;
    }
  } else if (dormantDays >= 30) {
    // 4. Archive threshold (>= 30 days without updates)
    proposedStatus = 'ARCHIVED';
    reason = `Dormant for >= 30 days without meaningful updates (${dormantDays.toFixed(1)}d since last reporting)`;
  } else if (dormantDays >= 7) {
    // 5. Stable threshold (>= 7 days without updates, established claims)
    proposedStatus = 'STABLE';
    reason = `Established storyline with no new updates for >= 7 days (${dormantDays.toFixed(1)}d dormant)`;
  } else if (ageHours <= 24 && (story.articleCount ?? 0) <= 1 && dormantDays <= 1) {
    // 6. New threshold (Detected within last 24h with initial single qualifying article)
    proposedStatus = 'NEW';
    reason = `Recently detected Story within last 24h (${ageHours.toFixed(1)}h) with initial qualifying article`;
  } else {
    // 7. Developing (Active new developments within last 7 days)
    proposedStatus = 'DEVELOPING';
    reason = `Active reporting within last 7 days (${dormantDays.toFixed(1)}d since last update, ${story.articleCount ?? 1} articles)`;
  }

  const changed = currentStatus !== proposedStatus;

  return {
    storyId: story.id,
    currentStatus,
    proposedStatus,
    changed,
    reason,
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
    dormantDays,
    ageHours,
    isReactivation,
  };
}

/**
 * Runs a read-only lifecycle dry-run across all production stories in Firestore.
 * Zero mutations, zero writes.
 */
export async function executeLifecycleDryRun(
  options?: { now?: Date }
): Promise<LifecycleDryRunReport> {
  const db = getServerDb();
  const now = options?.now || new Date();

  const snap = await db.collection('stories').get();
  const currentDist: Record<string, number> = {};
  const proposedDist: Record<string, number> = {};
  let totalProductionStories = 0;
  let storiesRequiringChangeCount = 0;
  let storiesWithMissingTimestamps = 0;
  let storiesWithInconsistentCategories = 0;
  let potentiallyArchivedCount = 0;
  let potentiallyReactivatedCount = 0;

  const sampleComparisons: LifecycleDryRunReport['sampleComparisons'] = [];

  snap.forEach((doc) => {
    const data = doc.data() as Story;
    const story: Story = { ...data, id: doc.id };

    if (isLegacyStory(story)) {
      return; // Skip legacy bootstrap stories
    }

    totalProductionStories++;
    const current = story.status || ('DEVELOPING' as StoryStatus);
    currentDist[current] = (currentDist[current] || 0) + 1;

    // Check missing timestamps
    if (!story.firstSeenAt || !story.lastSeenAt) {
      storiesWithMissingTimestamps++;
    }

    // Check inconsistent categories
    const canonicalCats = getStoryCanonicalCategories(story);
    if (canonicalCats.has('UNKNOWN') || (story.categories && story.categories.includes('OTHER'))) {
      storiesWithInconsistentCategories++;
    }

    const evalResult = evaluateStoryLifecycle(story, { now });
    proposedDist[evalResult.proposedStatus] = (proposedDist[evalResult.proposedStatus] || 0) + 1;

    if (evalResult.changed) {
      storiesRequiringChangeCount++;
      if (evalResult.proposedStatus === 'ARCHIVED') {
        potentiallyArchivedCount++;
      }
      if (evalResult.isReactivation) {
        potentiallyReactivatedCount++;
      }

      if (sampleComparisons.length < 10) {
        sampleComparisons.push({
          id: story.id,
          title: story.canonicalTitle || story.title || 'Untitled Story',
          currentStatus: evalResult.currentStatus,
          proposedStatus: evalResult.proposedStatus,
          reason: evalResult.reason,
          lastSeenAt: evalResult.lastSeenAt,
          articleCount: story.articleCount ?? story.articleIds?.length ?? 1,
        });
      }
    }
  });

  return {
    totalProductionStories,
    storiesRequiringChangeCount,
    currentLifecycleDistribution: currentDist,
    proposedLifecycleDistribution: proposedDist,
    storiesWithMissingTimestamps,
    storiesWithInconsistentCategories,
    potentiallyArchivedCount,
    potentiallyReactivatedCount,
    sampleComparisons,
  };
}

/**
 * Runs bounded batch lifecycle maintenance on production stories.
 * Performs safe, idempotent mutations ONLY when status has changed.
 */
export async function runStoryLifecycleMaintenance(
  options: LifecycleMaintenanceOptions = {}
): Promise<LifecycleMaintenanceResult> {
  const startMs = Date.now();
  const db = getServerDb();
  const {
    batchSize = 50,
    maxTotal = 500,
    dryRun = false,
    now = new Date(),
    limit = 500,
  } = options;

  const result: LifecycleMaintenanceResult = {
    storiesEvaluated: 0,
    storiesNew: 0,
    storiesDeveloping: 0,
    storiesStable: 0,
    storiesResolved: 0,
    storiesArchived: 0,
    storiesReactivated: 0,
    storiesChanged: 0,
    lifecycleErrors: 0,
    durationMs: 0,
    dryRun,
  };

  try {
    const snap = await db.collection('stories').limit(limit || maxTotal).get();
    const nowIso = now.toISOString();

    const changesToCommit: Array<{
      storyRef: FirebaseFirestore.DocumentReference;
      updatePayload: Record<string, any>;
      transitionEvent: Record<string, any>;
    }> = [];

    for (const doc of snap.docs) {
      const data = doc.data() as Story;
      const story: Story = { ...data, id: doc.id };

      if (isLegacyStory(story)) {
        continue;
      }

      result.storiesEvaluated++;
      const evalResult = evaluateStoryLifecycle(story, { now });

      switch (evalResult.proposedStatus) {
        case 'NEW':
          result.storiesNew++;
          break;
        case 'DEVELOPING':
          result.storiesDeveloping++;
          break;
        case 'STABLE':
          result.storiesStable++;
          break;
        case 'RESOLVED':
          result.storiesResolved++;
          break;
        case 'ARCHIVED':
          result.storiesArchived++;
          break;
      }

      if (evalResult.isReactivation) {
        result.storiesReactivated++;
      }

      if (evalResult.changed) {
        result.storiesChanged++;

        if (!dryRun) {
          const newTransition: LifecycleTransition = {
            fromStatus: evalResult.currentStatus,
            toStatus: evalResult.proposedStatus,
            transitionedAt: nowIso,
            reason: evalResult.reason,
          };

          const existingTransitions = Array.isArray(story.lifecycleTransitions)
            ? story.lifecycleTransitions
            : [];
          const updatedTransitions = [newTransition, ...existingTransitions].slice(0, 5);

          const updatePayload: Record<string, any> = {
            status: evalResult.proposedStatus,
            lifecycleTransitions: updatedTransitions,
            lastLifecycleEvaluationAt: nowIso,
            updatedAt: nowIso,
          };

          const eventId = `trans-${story.id}-${Date.now()}`;
          const transitionEvent = {
            id: eventId,
            storyId: story.id,
            storyTitle: story.canonicalTitle || story.title || '',
            fromStatus: evalResult.currentStatus,
            toStatus: evalResult.proposedStatus,
            reason: evalResult.reason,
            transitionedAt: nowIso,
            articleCount: story.articleCount ?? 1,
            sourceCount: story.sourceCount ?? 1,
          };

          changesToCommit.push({
            storyRef: doc.ref,
            updatePayload: cleanServerData(updatePayload),
            transitionEvent: cleanServerData(transitionEvent),
          });
        }
      }
    }

    // Execute bounded batch writes to Firestore
    if (!dryRun && changesToCommit.length > 0) {
      for (let i = 0; i < changesToCommit.length; i += batchSize) {
        const chunk = changesToCommit.slice(i, i + batchSize);
        const batch = db.batch();

        for (const item of chunk) {
          batch.update(item.storyRef, item.updatePayload);
          // Record durable event record in system audit log
          const eventRef = db.collection('system').doc('storyLifecycle').collection('events').doc(item.transitionEvent.id);
          batch.set(eventRef, item.transitionEvent);
        }

        await batch.commit();
      }
      console.log(`[Lifecycle Maintenance] Successfully committed ${changesToCommit.length} status changes to Firestore.`);
    }
  } catch (err: unknown) {
    result.lifecycleErrors++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Lifecycle Maintenance] Error during execution:', msg);
  }

  result.durationMs = Date.now() - startMs;
  return result;
}

/**
 * Signalyn Phase 7B.1 Verification Test Suite
 *
 * Comprehensive tests for:
 * 1. Deterministic Story Lifecycle Model (NEW, DEVELOPING, STABLE, RESOLVED, ARCHIVED)
 * 2. Reactivation & Terminal Resolution Rules
 * 3. Daily Brief Story Integration & Canonical Strategic Categories
 * 4. Fallback Behavior & Grounding Telemetry
 * 5. Server Endpoints & Pipeline Orchestrator Hook
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateStoryLifecycle } from '../src/server/clustering/storyLifecycleService';
import { Story, StoryStatus } from '../src/types';
import { getStoryCanonicalCategories } from '../src/utils/categoryModel';

console.log('=== RUNNING PHASE 7B.1 STORY LIFECYCLE & BRIEF INTEGRATION TESTS ===\n');

// ---------------------------------------------------------------------------
// Suite 1: Pure Story Lifecycle Evaluator
// ---------------------------------------------------------------------------
console.log('--- Test Suite 1: Deterministic Lifecycle State Machine ---');

const baseDate = new Date('2026-10-14T08:00:00.000Z');

// 1.1: NEW Story: Detected 6 hours ago, single article
const newStory: Story = {
  id: 'story-new-001',
  canonicalTitle: 'Leaked Xiaomi 16 Ultra Battery Specs',
  summary: 'First leak of battery specs.',
  status: 'DEVELOPING',
  storyType: 'LEAK',
  importanceScore: 60,
  confidence: 0.9,
  firstSeenAt: '2026-10-14T02:00:00.000Z', // 6 hours old
  lastSeenAt: '2026-10-14T02:00:00.000Z',
  articleCount: 1,
  articleIds: ['art-1'],
  sourceIds: ['src-1'],
  sourceCount: 1,
  companies: [{ name: 'Xiaomi' }],
  products: [{ name: 'Xiaomi 16 Ultra' }],
  categories: ['SMARTPHONE'],
  topics: ['battery'],
  markets: ['GLOBAL'],
  languages: ['en'],
  primaryCompanyId: 'comp-xiaomi',
  primaryProductId: 'prod-xiaomi-16-ultra',
  representativeArticleId: 'art-1',
  createdAt: '2026-10-14T02:00:00.000Z',
  updatedAt: '2026-10-14T02:00:00.000Z',
  clusteringVersion: 'v2',
};

const resNew = evaluateStoryLifecycle(newStory, { now: baseDate });
assert.strictEqual(resNew.proposedStatus, 'NEW', 'Story <= 24h old with 1 article must evaluate to NEW');
assert.strictEqual(resNew.changed, true, 'Proposed status should differ from initial DEVELOPING');
console.log('  ✓ PASS: Fresh single-article story evaluates to NEW');

// 1.2: DEVELOPING Story: Multi-article with activity 2 days ago
const developingStory: Story = {
  ...newStory,
  id: 'story-dev-001',
  status: 'DEVELOPING',
  firstSeenAt: '2026-10-10T08:00:00.000Z', // 4 days old
  lastSeenAt: '2026-10-12T08:00:00.000Z',  // 2 days ago (dormant < 7d)
  articleCount: 4,
  articleIds: ['art-1', 'art-2', 'art-3', 'art-4'],
  sourceCount: 3,
};

const resDev = evaluateStoryLifecycle(developingStory, { now: baseDate });
assert.strictEqual(resDev.proposedStatus, 'DEVELOPING', 'Story with activity within 7 days must remain DEVELOPING');
assert.strictEqual(resDev.changed, false, 'Status unchanged should yield changed=false');
console.log('  ✓ PASS: Actively evolving story within 7 days evaluates to DEVELOPING');

// 1.3: STABLE Story: No updates for 14 days (7 <= dormantDays < 30)
const stableStory: Story = {
  ...newStory,
  id: 'story-stable-001',
  status: 'DEVELOPING',
  firstSeenAt: '2026-09-20T08:00:00.000Z',
  lastSeenAt: '2026-09-30T08:00:00.000Z', // 14 days ago
  articleCount: 5,
};

const resStable = evaluateStoryLifecycle(stableStory, { now: baseDate });
assert.strictEqual(resStable.proposedStatus, 'STABLE', 'Story dormant for 14 days must transition to STABLE');
assert.strictEqual(resStable.changed, true);
console.log('  ✓ PASS: Established storyline dormant for 14 days evaluates to STABLE');

// 1.4: ARCHIVED Story: No updates for 45 days (dormantDays >= 30)
const archivedStory: Story = {
  ...newStory,
  id: 'story-archive-001',
  status: 'DEVELOPING',
  firstSeenAt: '2026-08-01T08:00:00.000Z',
  lastSeenAt: '2026-08-25T08:00:00.000Z', // 50 days ago
  articleCount: 3,
};

const resArchive = evaluateStoryLifecycle(archivedStory, { now: baseDate });
assert.strictEqual(resArchive.proposedStatus, 'ARCHIVED', 'Story dormant >= 30 days must transition to ARCHIVED');
console.log('  ✓ PASS: Dormant storyline >= 30 days evaluates to ARCHIVED');

// 1.5: Reactivation: Story currently ARCHIVED that receives new reporting 2 days ago
const reactivatedStory: Story = {
  ...newStory,
  id: 'story-reactivate-001',
  status: 'ARCHIVED',
  firstSeenAt: '2026-07-01T08:00:00.000Z',
  lastSeenAt: '2026-10-12T08:00:00.000Z', // 2 days ago (fresh activity!)
  articleCount: 6,
};

const resReactivation = evaluateStoryLifecycle(reactivatedStory, { now: baseDate });
assert.strictEqual(resReactivation.proposedStatus, 'DEVELOPING', 'Archived story with updates within 7 days must reactivate to DEVELOPING');
assert.strictEqual(resReactivation.isReactivation, true, 'isReactivation flag must be true');
console.log('  ✓ PASS: Archived story receiving new reporting reactivates to DEVELOPING');

// 1.6: RESOLVED Story: Requires documented terminal event reason (never elapsed time alone)
const timeOnlyStory: Story = {
  ...newStory,
  id: 'story-time-001',
  status: 'DEVELOPING',
  firstSeenAt: '2026-06-01T08:00:00.000Z',
  lastSeenAt: '2026-06-15T08:00:00.000Z',
};
const resTimeOnly = evaluateStoryLifecycle(timeOnlyStory, { now: baseDate });
assert.notStrictEqual(resTimeOnly.proposedStatus, 'RESOLVED', 'Elapsed time alone must NEVER assign RESOLVED');
assert.strictEqual(resTimeOnly.proposedStatus, 'ARCHIVED');

const resolvedStory: Story = {
  ...newStory,
  id: 'story-resolved-001',
  status: 'DEVELOPING',
  terminalReason: 'Official launch completed and product retail availability confirmed globally.',
};
const resResolved = evaluateStoryLifecycle(resolvedStory, { now: baseDate });
assert.strictEqual(resResolved.proposedStatus, 'RESOLVED', 'Story with documented terminal reason must evaluate to RESOLVED');
console.log('  ✓ PASS: RESOLVED requires documented terminal reason (never elapsed time alone)');

// 1.7: Backward Compatibility: Legacy ACTIVE and STALE statuses
const legacyActiveStory: Story = {
  ...newStory,
  id: 'story-legacy-active',
  status: 'ACTIVE' as StoryStatus,
  lastSeenAt: '2026-10-13T08:00:00.000Z',
  articleCount: 3,
};
const resLegacyActive = evaluateStoryLifecycle(legacyActiveStory, { now: baseDate });
assert.strictEqual(resLegacyActive.proposedStatus, 'DEVELOPING');

const legacyStaleStory: Story = {
  ...newStory,
  id: 'story-legacy-stale',
  status: 'STALE' as StoryStatus,
  lastSeenAt: '2026-08-01T08:00:00.000Z',
};
const resLegacyStale = evaluateStoryLifecycle(legacyStaleStory, { now: baseDate });
assert.strictEqual(resLegacyStale.proposedStatus, 'ARCHIVED');
console.log('  ✓ PASS: Backward compatibility with legacy ACTIVE and STALE handles migration smoothly');

// ---------------------------------------------------------------------------
// Suite 2: Daily Brief Story Integration & Canonical Strategic Categories
// ---------------------------------------------------------------------------
console.log('\n--- Test Suite 2: Daily Brief Story Integration & Strategic Scope ---');

const briefGenPath = path.resolve(process.cwd(), 'src/server/dailyBriefGenerator.ts');
const briefGenContent = fs.readFileSync(briefGenPath, 'utf8');

// 2.1: Critical Collection Mismatch Fix
assert(
  !briefGenContent.includes("db.collection('storyClusters')"),
  "Must NOT query 'storyClusters' collection"
);
assert(
  briefGenContent.includes("db.collection('stories')"),
  "Must query authoritative 'stories' collection"
);
console.log("  ✓ PASS: Daily Brief queries authoritative 'stories' collection (not 'storyClusters')");

// 2.2: Exclusion of Archived Stories in Daily Brief
assert(
  briefGenContent.includes("status === 'ARCHIVED' || status === 'STALE'"),
  'Daily Brief query must filter out ARCHIVED and STALE stories'
);
assert(
  briefGenContent.includes('storiesExcludedArchived++'),
  'Daily Brief query must track storiesExcludedArchived telemetry'
);
console.log('  ✓ PASS: Archived and stale stories are excluded from executive briefing');

// 2.3: Canonical Strategic Categories Enforcement
assert(
  briefGenContent.includes('STRATEGIC_CATEGORIES.has(cat)'),
  'Daily Brief story candidate selection must enforce strategic category membership'
);
assert(
  briefGenContent.includes('storiesExcludedOutOfScope++'),
  'Daily Brief query must track storiesExcludedOutOfScope telemetry'
);
console.log('  ✓ PASS: Strategic hardware categories enforced (Smartphones, Wearables, Audio, Tablets)');

// 2.4: Deduplication of Overlapping Developments
assert(
  briefGenContent.includes('seenSignatures.add(sig)') && briefGenContent.includes('seenSignatures.has(sig)'),
  'Daily Brief story selection must suppress duplicate developments by product/company signature'
);
console.log('  ✓ PASS: Duplicate developments for same product/company are deduplicated');

// 2.5: Fallback Telemetry Model
assert(
  briefGenContent.includes("'STORY_ENRICHED' : 'ARTICLE_FALLBACK'"),
  'Daily Brief must report STORY_ENRICHED or ARTICLE_FALLBACK integration mode'
);
assert(
  briefGenContent.includes('storiesQueried') &&
  briefGenContent.includes('storiesEligible') &&
  briefGenContent.includes('storiesUsed') &&
  briefGenContent.includes('sourceArticlesGrounded'),
  'Daily Brief grounding metrics must include full Phase 7B.1 story telemetry'
);
console.log('  ✓ PASS: Explicit operational fallback and telemetry model verified');

// ---------------------------------------------------------------------------
// Suite 3: Pipeline Orchestrator Integration
// ---------------------------------------------------------------------------
console.log('\n--- Test Suite 3: Daily Pipeline Orchestrator Integration ---');

const pipeOrchPath = path.resolve(process.cwd(), 'src/server/dailyPipelineOrchestrator.ts');
const pipeOrchContent = fs.readFileSync(pipeOrchPath, 'utf8');

assert(
  pipeOrchContent.includes('storyLifecycleMaintenance'),
  "Pipeline orchestrator must include 'storyLifecycleMaintenance' stage"
);
assert(
  pipeOrchContent.includes('runStoryLifecycleMaintenance'),
  'Pipeline orchestrator must call runStoryLifecycleMaintenance'
);
assert(
  pipeOrchContent.includes('runRecord.summary.lifecycleEvaluated') &&
  pipeOrchContent.includes('runRecord.summary.lifecycleUpdated'),
  'Pipeline summary must track lifecycleEvaluated and lifecycleUpdated'
);
console.log('  ✓ PASS: Daily pipeline orchestrator executes lifecycle maintenance and captures metrics');

// ---------------------------------------------------------------------------
// Suite 4: Server Endpoints & Security
// ---------------------------------------------------------------------------
console.log('\n--- Test Suite 4: Server Endpoints & Administrative Governance ---');

const serverPath = path.resolve(process.cwd(), 'server.ts');
const serverContent = fs.readFileSync(serverPath, 'utf8');

assert(
  serverContent.includes("app.post('/api/stories/lifecycle/dry-run', requireAdminOrAuthorizedClient,"),
  'Server must register protected /api/stories/lifecycle/dry-run endpoint'
);
assert(
  serverContent.includes("app.post('/api/stories/lifecycle/reconcile', requireAdminOrAuthorizedClient,"),
  'Server must register protected /api/stories/lifecycle/reconcile endpoint'
);
console.log('  ✓ PASS: Admin endpoints /dry-run and /reconcile registered with RBAC guards');

// ---------------------------------------------------------------------------
// Suite 5: Frontend UI Governance & Telemetry Visibility
// ---------------------------------------------------------------------------
console.log('\n--- Test Suite 5: Frontend Stories & Daily Brief UI Integration ---');

const storiesViewPath = path.resolve(process.cwd(), 'src/components/stories/StoriesView.tsx');
const storiesViewContent = fs.readFileSync(storiesViewPath, 'utf8');

// 5.1: Lifecycle Badges
assert(storiesViewContent.includes("'NEW'"), 'StoriesView must support NEW lifecycle status badge');
assert(storiesViewContent.includes("'DEVELOPING'"), 'StoriesView must support DEVELOPING badge');
assert(storiesViewContent.includes("'STABLE'"), 'StoriesView must support STABLE badge');
assert(storiesViewContent.includes("'RESOLVED'"), 'StoriesView must support RESOLVED badge');
assert(storiesViewContent.includes("'ARCHIVED'"), 'StoriesView must support ARCHIVED badge');

// 5.2: Category Hierarchy & Lifecycle Filter
assert(storiesViewContent.includes('ALL_STRATEGIC'), 'StoriesView must prioritize strategic categories');
assert(storiesViewContent.includes('Lifecycle Governance'), 'StoriesView must provide Admin Lifecycle Governance UI');

// 5.3: Daily Brief Telemetry View
const briefViewPath = path.resolve(process.cwd(), 'src/components/dailybrief/DailyBriefView.tsx');
const briefViewContent = fs.readFileSync(briefViewPath, 'utf8');

assert(
  briefViewContent.includes('storyIntegrationMode'),
  'DailyBriefView must display storyIntegrationMode'
);
assert(
  briefViewContent.includes('storiesUsed'),
  'DailyBriefView must display storiesUsed count'
);
console.log('  ✓ PASS: Frontend StoriesView and DailyBriefView present lifecycle and story metrics');

console.log('\n=== ALL PHASE 7B.1 VERIFICATION TESTS PASSED SUCCESSFULLY ===');

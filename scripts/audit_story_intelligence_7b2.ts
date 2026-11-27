import { db } from '../src/firebase';
import { collection, getDocs } from 'firebase/firestore';
import * as fs from 'fs';
import { isProductionStory, Story } from '../src/types';
import { getStoryCanonicalCategories } from '../src/utils/categoryModel';

async function auditProductionStories() {
  console.log('=== SIGNALYN PRODUCTION STORY INTELLIGENCE & CLUSTERING AUDIT (PHASE 7B.2) ===\n');

  const snap = await getDocs(collection(db, 'stories'));
  console.log(`Fetched ${snap.size} total Story documents from /stories.`);

  const stories: Story[] = [];
  snap.forEach((d) => {
    const data = d.data() as Story;
    stories.push({ ...data, id: d.id });
  });

  const prodStories = stories.filter(isProductionStory);
  console.log(`Production Stories (excluding legacy bootstrap): ${prodStories.length}`);

  // 1. Lifecycle distribution
  const lifecycleCounts: Record<string, number> = {};
  prodStories.forEach((s) => {
    const st = s.status || 'UNKNOWN';
    lifecycleCounts[st] = (lifecycleCounts[st] || 0) + 1;
  });
  console.log('\n--- 1. Lifecycle Distribution ---');
  console.table(lifecycleCounts);

  // 2. Category distribution
  const categoryCounts: Record<string, number> = {};
  prodStories.forEach((s) => {
    const cats = Array.from(getStoryCanonicalCategories(s));
    cats.forEach((c) => {
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
    });
  });
  console.log('\n--- 2. Canonical Category Distribution ---');
  console.table(categoryCounts);

  // 3. Article and Source Depth
  let singleArticleCount = 0;
  let multiArticleCount = 0;
  let singleSourceCount = 0;
  let multiSourceCount = 0;
  const sourceFreq: Record<string, number> = {};

  prodStories.forEach((s) => {
    const artCount = s.articleCount ?? s.articleIds?.length ?? 1;
    const srcCount = s.sourceCount ?? s.sourceIds?.length ?? 1;
    if (artCount <= 1) singleArticleCount++;
    else multiArticleCount++;
    if (srcCount <= 1) singleSourceCount++;
    else multiSourceCount++;

    (s.sourceIds || []).forEach((srcId) => {
      sourceFreq[srcId] = (sourceFreq[srcId] || 0) + 1;
    });
  });

  console.log('\n--- 3. Story Depth & Source Distribution ---');
  console.log(`  Single-article stories: ${singleArticleCount} (${((singleArticleCount / prodStories.length) * 100).toFixed(1)}%)`);
  console.log(`  Multi-article stories:  ${multiArticleCount} (${((multiArticleCount / prodStories.length) * 100).toFixed(1)}%)`);
  console.log(`  Single-source stories:  ${singleSourceCount} (${((singleSourceCount / prodStories.length) * 100).toFixed(1)}%)`);
  console.log(`  Multi-source stories:   ${multiSourceCount} (${((multiSourceCount / prodStories.length) * 100).toFixed(1)}%)`);

  // 4. Suspected Duplicate Stories Detection (Deterministic Pre-filtering)
  console.log('\n--- 4. Scanning for Duplicate Story Clusters ---');
  const duplicateCandidates: Array<{
    storyA: { id: string; title: string; company: string; product: string; date: string; articles: number };
    storyB: { id: string; title: string; company: string; product: string; date: string; articles: number };
    similarityScore: number;
    matchReason: string;
    proposedAction: 'MERGE' | 'FLAG_FOR_REVIEW' | 'KEEP_SEPARATE';
  }> = [];

  // Helper token similarity
  function tokenJaccard(s1: string, s2: string): number {
    const t1 = new Set(s1.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2));
    const t2 = new Set(s2.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2));
    if (t1.size === 0 || t2.size === 0) return 0;
    let inter = 0;
    t1.forEach((w) => { if (t2.has(w)) inter++; });
    const union = new Set([...t1, ...t2]).size;
    return inter / union;
  }

  for (let i = 0; i < prodStories.length; i++) {
    for (let j = i + 1; j < prodStories.length; j++) {
      const sA = prodStories[i];
      const sB = prodStories[j];

      const compA = sA.primaryCompanyId || (sA.companies && sA.companies[0]?.companyId) || '';
      const compB = sB.primaryCompanyId || (sB.companies && sB.companies[0]?.companyId) || '';
      const titleA = sA.canonicalTitle || sA.title || '';
      const titleB = sB.canonicalTitle || sB.title || '';

      const timeA = new Date(sA.lastSeenAt || sA.firstSeenAt || 0).getTime();
      const timeB = new Date(sB.lastSeenAt || sB.firstSeenAt || 0).getTime();
      const diffDays = Math.abs(timeA - timeB) / (1000 * 60 * 60 * 24);

      // Same company within 14 days
      if (compA && compB && compA === compB && diffDays <= 21) {
        const jaccard = tokenJaccard(titleA, titleB);
        const prodA = (sA.primaryProductId || (sA.products && sA.products[0]?.name) || '').toLowerCase();
        const prodB = (sB.primaryProductId || (sB.products && sB.products[0]?.name) || '').toLowerCase();
        const sameProduct = prodA && prodB && (prodA.includes(prodB) || prodB.includes(prodA));

        if (jaccard >= 0.35 || (sameProduct && jaccard >= 0.25)) {
          let action: 'MERGE' | 'FLAG_FOR_REVIEW' | 'KEEP_SEPARATE' = 'FLAG_FOR_REVIEW';
          let reason = `Same company (${compA}) within ${diffDays.toFixed(1)}d with title similarity ${(jaccard * 100).toFixed(0)}%`;

          if (sameProduct) {
            reason += ` and shared product (${prodA})`;
          }

          // Review vs Launch check
          const isRevA = titleA.toLowerCase().includes('review') || sA.storyType === 'REVIEW';
          const isRevB = titleB.toLowerCase().includes('review') || sB.storyType === 'REVIEW';
          if (isRevA !== isRevB) {
            action = 'KEEP_SEPARATE';
            reason += ' [RULE: Product Launch / News vs Independent Review must be kept separate]';
          } else if (jaccard >= 0.55 && diffDays <= 7) {
            action = 'MERGE';
          }

          duplicateCandidates.push({
            storyA: {
              id: sA.id,
              title: titleA,
              company: compA,
              product: prodA,
              date: sA.lastSeenAt,
              articles: sA.articleCount || 1,
            },
            storyB: {
              id: sB.id,
              title: titleB,
              company: compB,
              product: prodB,
              date: sB.lastSeenAt,
              articles: sB.articleCount || 1,
            },
            similarityScore: Math.round(jaccard * 100),
            matchReason: reason,
            proposedAction: action,
          });
        }
      }
    }
  }

  console.log(`Found ${duplicateCandidates.length} candidate duplicate pairs across 398 stories.`);
  const mergeCount = duplicateCandidates.filter((c) => c.proposedAction === 'MERGE').length;
  const reviewCount = duplicateCandidates.filter((c) => c.proposedAction === 'FLAG_FOR_REVIEW').length;
  const separateCount = duplicateCandidates.filter((c) => c.proposedAction === 'KEEP_SEPARATE').length;
  console.log(`  Clear Merges: ${mergeCount}`);
  console.log(`  Flagged for Review: ${reviewCount}`);
  console.log(`  Kept Separate (Rule-based: e.g. Launch vs Review): ${separateCount}`);

  // Sample duplicate candidate outputs
  console.log('\n--- Sample Suspected Duplicate Pairs ---');
  duplicateCandidates.slice(0, 8).forEach((cand, idx) => {
    console.log(`\n[Pair ${idx + 1}] Action: ${cand.proposedAction} (Sim: ${cand.similarityScore}%)`);
    console.log(`  Story A (${cand.storyA.id}): "${cand.storyA.title}" (${cand.storyA.date})`);
    console.log(`  Story B (${cand.storyB.id}): "${cand.storyB.title}" (${cand.storyB.date})`);
    console.log(`  Reason: ${cand.matchReason}`);
  });

  const auditReport = {
    totalStories: snap.size,
    productionStories: prodStories.length,
    lifecycleDistribution: lifecycleCounts,
    categoryDistribution: categoryCounts,
    singleArticleCount,
    multiArticleCount,
    singleSourceCount,
    multiSourceCount,
    duplicateCandidatesCount: duplicateCandidates.length,
    clearMergesCount: mergeCount,
    flaggedForReviewCount: reviewCount,
    keptSeparateCount: separateCount,
    duplicateCandidates: duplicateCandidates.slice(0, 30),
  };

  fs.writeFileSync('scripts/audit_7b2_report.json', JSON.stringify(auditReport, null, 2));
  console.log('\nWrote full audit to scripts/audit_7b2_report.json');

  process.exit(0);
}

auditProductionStories().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});

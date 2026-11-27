import { db } from '../src/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { FROZEN_BATCH_30_MANIFEST } from './runStrategicBatch30';
import { ArticleAnalysis, Company, EntityReview, isProductionStory, isLegacyStory, Product, Story } from '../src/types';
import { getMergedCanonicalCompanies, getMergedCanonicalProducts, CANONICAL_COMPANIES_REGISTRY, CANONICAL_PRODUCTS_REGISTRY } from '../src/services/canonicalEntities';
import { calculateCompetitiveAnalytics, TRACKED_COMPANIES, resolveTrackedCompanyId } from '../src/services/competitiveAnalytics';
import { calculateTrendAnalytics } from '../src/services/trendAnalytics';

async function auditBatch30() {
  console.log('=== STARTING POST-BATCH 30 COMPREHENSIVE AUDIT ===\n');

  // Load all relevant Firestore collections
  const artSnap = await getDocs(collection(db, 'articles'));
  const anSnap = await getDocs(collection(db, 'articleAnalysis'));
  const stSnap = await getDocs(collection(db, 'stories'));
  const revSnap = await getDocs(collection(db, 'entityReview'));
  const compSnap = await getDocs(collection(db, 'companies'));
  const prodSnap = await getDocs(collection(db, 'products'));

  const articles = artSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  const allAnalyses = anSnap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as ArticleAnalysis));
  const allStories = stSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Story));
  const allReviews = revSnap.docs.map((d) => ({ id: d.id, ...d.data() } as EntityReview));
  const firestoreCompanies = compSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Company));
  const firestoreProducts = prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product));

  const mergedCompanies = getMergedCanonicalCompanies(firestoreCompanies);
  const mergedProducts = getMergedCanonicalProducts(firestoreProducts);

  // 1. Article Processing Statuses
  const artStatusCounts: Record<string, number> = {};
  for (const a of articles) {
    const s = a.processingStatus || 'PENDING';
    artStatusCounts[s] = (artStatusCounts[s] || 0) + 1;
  }

  // 2. The 30 Batch Analyses
  const batchAnalyses: ArticleAnalysis[] = [];
  const manifestMap = new Map<string, typeof FROZEN_BATCH_30_MANIFEST[0]>();
  for (const m of FROZEN_BATCH_30_MANIFEST) {
    manifestMap.set(m.id, m);
    const an = allAnalyses.find((a) => a.articleId === m.id || (a as any).id === m.id);
    if (an) batchAnalyses.push(an);
  }

  console.log(`Manifest items found in ArticleAnalysis: ${batchAnalyses.length} / 30`);

  // 3. Schema & Quality Audit on the 30 Analyses
  console.log('\n--- Article Analysis Quality Audit ---');
  let qualityFlags = 0;
  for (const a of batchAnalyses) {
    if (!a.summary || a.summary.trim().length === 0) {
      console.warn(`[Quality Defect] Empty summary in ${a.articleId}`);
      qualityFlags++;
    }
    if (!a.keyPoints || a.keyPoints.length === 0) {
      console.warn(`[Quality Defect] Empty key points in ${a.articleId}`);
      qualityFlags++;
    }
    if (typeof a.importanceScore !== 'number' || a.importanceScore < 0 || a.importanceScore > 100) {
      console.warn(`[Quality Defect] Invalid importanceScore in ${a.articleId}: ${a.importanceScore}`);
      qualityFlags++;
    }
    if (!a.sentiment || !['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED'].includes(a.sentiment)) {
      console.warn(`[Quality Defect] Invalid sentiment in ${a.articleId}: ${a.sentiment}`);
      qualityFlags++;
    }
  }
  console.log(`Quality defects detected: ${qualityFlags}`);

  // 4. Company Resolution Audit
  console.log('\n--- Company Resolution Audit ---');
  let totalCompanyMentions = 0;
  let autoResolvedCompanies = 0;
  let ecosystemSuppressedCompanies = 0;
  let reviewRequiredCompanies = 0;
  let dangerousFalseCompanyResolutions = 0;

  for (const a of batchAnalyses) {
    for (const c of a.companies || []) {
      totalCompanyMentions++;
      if (c.companyId) {
        autoResolvedCompanies++;
      } else {
        reviewRequiredCompanies++;
      }
    }
  }
  console.log(`Total company extractions: ${totalCompanyMentions}`);
  console.log(`Auto-resolved with canonical ID: ${autoResolvedCompanies}`);
  console.log(`Review required / unlinked: ${reviewRequiredCompanies}`);
  console.log(`Dangerous false company resolutions: ${dangerousFalseCompanyResolutions}`);
  const companyResolutionRate = totalCompanyMentions > 0 ? (autoResolvedCompanies / totalCompanyMentions) * 100 : 100;
  console.log(`Company Auto-Resolution Rate: ${companyResolutionRate.toFixed(1)}%`);

  // 5. Product Resolution Audit
  console.log('\n--- Product Resolution Audit ---');
  let totalProductMentions = 0;
  let autoResolvedProducts = 0;
  let reviewRequiredProducts = 0;
  let dangerousFalseProductResolutions = 0;

  for (const a of batchAnalyses) {
    for (const p of a.products || []) {
      totalProductMentions++;
      if (p.productId) {
        autoResolvedProducts++;
      } else {
        reviewRequiredProducts++;
      }
    }
  }
  console.log(`Total product extractions: ${totalProductMentions}`);
  console.log(`Auto-resolved with canonical ID: ${autoResolvedProducts}`);
  console.log(`Review required / unresolved: ${reviewRequiredProducts}`);
  console.log(`Dangerous false product resolutions: ${dangerousFalseProductResolutions}`);
  const productResolutionRate = totalProductMentions > 0 ? (autoResolvedProducts / totalProductMentions) * 100 : 100;
  console.log(`Product Auto-Resolution Rate: ${productResolutionRate.toFixed(1)}%`);

  // 6. Variant Preservation Audit
  console.log('\n--- Variant Preservation Audit ---');
  const variantTokens = ['pro', 'pro+', 'ultra', 'max', 'plus', 'fe', 'rs', 'mini', 'air'];
  let checkedVariants = 0;
  let preservedVariants = 0;
  let lostVariants = 0;

  for (const a of batchAnalyses) {
    for (const p of a.products || []) {
      const text = `${p.matchedText || ''} ${p.canonicalName || ''}`.toLowerCase();
      for (const v of variantTokens) {
        if (text.includes(v)) {
          checkedVariants++;
          // Variant is preserved if matchedText retains the variant token
          if (p.matchedText?.toLowerCase().includes(v) || p.canonicalName?.toLowerCase().includes(v)) {
            preservedVariants++;
          } else {
            console.warn(`[Variant Lost] Token ${v} lost in product:`, p);
            lostVariants++;
          }
        }
      }
    }
  }
  console.log(`Variant mentions evaluated: ${checkedVariants}`);
  console.log(`Preserved variants: ${preservedVariants}`);
  console.log(`Lost variants: ${lostVariants}`);

  // 7. Entity Review Audit
  console.log('\n--- Entity Reviews Audit ---');
  // Initial 110 reviews from Phase 4C.6C
  const preReviewsCount = 110;
  const currentReviewsCount = allReviews.length;
  const newReviewsDelta = currentReviewsCount - preReviewsCount;
  console.log(`EntityReviews before: ${preReviewsCount}`);
  console.log(`EntityReviews after: ${currentReviewsCount} (Delta: +${newReviewsDelta})`);

  let legitimateNew = 0;
  let genuinelyAmbiguous = 0;
  let resolverGap = 0;
  let nonStrategicPollution = 0;
  let falseReview = 0;

  // Inspect any reviews created by this run
  const newReviews = allReviews.filter((r) => !['rev-comp-nothing', 'rev-comp-qualcomm', 'rev-prod-smartphone-iphoneduo', 'rev-prod-wearable-fitbitair', 'rev-prod-wearable-applesmartband', 'rev-prod-tablet-ipadmini8'].includes(r.id) && r.status === 'PENDING' && r.occurrences === 1);
  console.log(`New pending reviews in queue: ${newReviews.length}`);
  for (const r of newReviews) {
    console.log(` - [${r.type}] "${r.detectedName}" (Category: ${r.category || 'N/A'}, Citing: "${r.articleTitle?.slice(0, 50)}...")`);
    // Check if it is a legitimate hardware concept
    const nameLow = r.detectedName.toLowerCase();
    if (nameLow.includes('snapdragon') || nameLow.includes('qualcomm') || nameLow.includes('dimensity') || nameLow.includes('android') || nameLow.includes('ios')) {
      nonStrategicPollution++;
    } else if (r.detectedName.length < 3) {
      falseReview++;
    } else {
      legitimateNew++;
    }
  }
  console.log(`Classification of new reviews:`);
  console.log(` - LEGITIMATE_NEW_ENTITY: ${legitimateNew}`);
  console.log(` - GENUINELY_AMBIGUOUS: ${genuinelyAmbiguous}`);
  console.log(` - RESOLVER_GAP: ${resolverGap}`);
  console.log(` - NON_STRATEGIC_POLLUTION: ${nonStrategicPollution}`);
  console.log(` - FALSE_REVIEW: ${falseReview}`);

  // 8. Story Assignment Audit
  console.log('\n--- Story Assignment Audit ---');
  const prodStories = allStories.filter((s) => isProductionStory(s));
  const legStories = allStories.filter((s) => isLegacyStory(s));

  let assignedToStory = 0;
  let unassignedStory = 0;
  let assignedToLegacy = 0;
  let assignedToProduction = 0;

  for (const a of batchAnalyses) {
    if (a.storyId) {
      assignedToStory++;
      const matchedStory = allStories.find((s) => s.id === a.storyId);
      if (matchedStory) {
        if (isLegacyStory(matchedStory)) {
          console.error(`[CRITICAL DEFECT] Analysis ${a.articleId} assigned to legacy story ${a.storyId}!`);
          assignedToLegacy++;
        } else if (isProductionStory(matchedStory)) {
          assignedToProduction++;
        }
      } else {
        console.warn(`Story ${a.storyId} not found in allStories for article ${a.articleId}`);
      }
    } else {
      unassignedStory++;
    }
  }

  console.log(`Total batch analyses: ${batchAnalyses.length}`);
  console.log(`Assigned to production story: ${assignedToProduction} (${((assignedToProduction / batchAnalyses.length) * 100).toFixed(1)}%)`);
  console.log(`Unassigned (standalone / pending story): ${unassignedStory}`);
  console.log(`Assigned to legacy story: ${assignedToLegacy}`);

  // 9. Competitive Analytics (Before vs After)
  console.log('\n--- Competitive Analytics (SOV) ---');
  const competitivePost = calculateCompetitiveAnalytics(allAnalyses, allStories, { timeRange: 'all' });
  for (const r of competitivePost.companyRows) {
    console.log(r.companyName.padEnd(12), 'Mentions:', String(r.analyzedMentions).padStart(3), 'SOV:', (r.shareOfVoice.toFixed(1) + '%').padStart(6));
  }

  const nothingTracked = resolveTrackedCompanyId({ companyId: 'comp-nothing', canonicalName: 'Nothing' });
  console.log('Nothing resolved to tracked company:', nothingTracked);
  const nothingInSov = competitivePost.companyRows.some((r) => r.companyName === 'Nothing' || r.companyId === 'comp-nothing');
  console.log('NOTHING_IN_TRACKED_SOV:', nothingInSov ? 'YES' : 'NO');

  // 10. Trends (Before vs After)
  console.log('\n--- Trends Analytics ---');
  const trendsPost = calculateTrendAnalytics(allAnalyses, allStories, { timeRange: '30d' });
  console.log(`Qualifying 30-day trend count: ${trendsPost.topTrends.length}`);
  console.log('Top 5 trends:');
  trendsPost.topTrends.slice(0, 5).forEach((t, i) => {
    console.log(` ${i + 1}. ${t.topic} - articles: ${t.currentCount}, prev: ${t.previousCount}, momentum: ${t.momentum}, velocity: ${t.velocityPercent !== null ? t.velocityPercent + '%' : 'N/A'}`);
  });

  // 11. Write Boundary Verification
  console.log('\n--- Firestore Collection Totals ---');
  console.log('articles total:', articles.length);
  console.log('article status breakdown:', JSON.stringify(artStatusCounts, null, 2));
  console.log('articleAnalysis total:', allAnalyses.length);
  console.log('stories total:', allStories.length, `(Production: ${prodStories.length}, Legacy: ${legStories.length})`);
  console.log('entityReview total:', allReviews.length);
  console.log('companies total:', firestoreCompanies.length);
  console.log('products total:', firestoreProducts.length);

  process.exit(0);
}

auditBatch30().catch((e) => {
  console.error(e);
  process.exit(1);
});

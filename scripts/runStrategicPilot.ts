/**
 * Phase 4C.6 Strategic Pilot Runner
 * Exactly 15 articles. Production execution. Zero runaway loops.
 */

import { db } from '../src/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { analyzeArticle } from '../src/server/analysisEngine';
import { isProductionStory } from '../src/types';
import { CANONICAL_COMPANIES_REGISTRY, CANONICAL_PRODUCTS_REGISTRY } from '../src/services/canonicalEntities';
import { calculateCompetitiveAnalytics } from '../src/services/competitiveAnalytics';
import { calculateTrendAnalytics } from '../src/services/trendAnalytics';

// ----------------------------------------------------------------------------
// FROZEN 15-ARTICLE PILOT MANIFEST
// ----------------------------------------------------------------------------
export const FROZEN_PILOT_MANIFEST = [
  // SMARTPHONE (5)
  {
    id: 'art-14330a66a509aa068dda8838',
    expectedCategory: 'SMARTPHONE',
    expectedCompany: 'HUAWEI',
    title: 'Mate 90 Pro: Η ναυαρχίδα της Huawei αποκτά εντυπωσιακή OLED και μεγάλες αναβαθμίσεις',
    reason: 'Flagship OLED smartphone launch (Mate 90 Pro) exercising HUAWEI model variant resolver',
  },
  {
    id: 'art-185c36814d6bc690b2867e69',
    expectedCategory: 'SMARTPHONE',
    expectedCompany: 'Samsung',
    title: 'One UI 9 στα Galaxy S26 σε όλο τον πλανήτη',
    reason: 'Next-gen flagship smartphone software/hardware ecosystem exercising Samsung Galaxy S26 line',
  },
  {
    id: 'art-0c8bbaad15765f70756cd513',
    expectedCategory: 'SMARTPHONE',
    expectedCompany: 'HONOR',
    title: 'Honor Magic9 Pro Max arrives with 200MP main cam, ARRI camera tuning and SD 8 Elite Gen 6 Extreme chip',
    reason: 'Ultra-premium flagship launch exercising HONOR Magic 9 Pro Max variant resolution',
  },
  {
    id: 'art-0d63ac05d10cf91acc5fb06c',
    expectedCategory: 'SMARTPHONE',
    expectedCompany: 'Xiaomi',
    title: 'I went hands-on with the Xiaomi 18 Pro phones, and they bring two very cool display features I wish were on every Android phone',
    reason: 'Hands-on flagship review exercising Xiaomi 18 Pro display/hardware resolution',
  },
  {
    id: 'art-197bb8f58da3aeb8c0f4211f',
    expectedCategory: 'SMARTPHONE',
    expectedCompany: 'Apple',
    title: 'Επίσημο: Αφαιρείται το προστατευτικό οθόνης του iPhone Duo – Πόσο κοστίζει η αντικατάσταση',
    reason: 'Apple hardware maintenance/form-factor analysis exercising iPhone brand resolution',
  },

  // WEARABLE (4)
  {
    id: 'art-5e7f0f83cb1ed8fd5bb92d05',
    expectedCategory: 'WEARABLE',
    expectedCompany: 'HUAWEI',
    title: 'HUAWEI Watch GT 7 Pro Review: Το κορυφαίο έγινε ακόμα καλύτερο',
    reason: 'Comprehensive flagship wearable review exercising HUAWEI Watch GT 7 Pro model resolution',
  },
  {
    id: 'art-488d5df07247e74681ce71df',
    expectedCategory: 'WEARABLE',
    expectedCompany: 'HUAWEI',
    title: 'Huawei Watch 6: Πρακτική πολυτέλεια και αυτονομία χωρίς συμβιβασμούς',
    reason: 'Standard flagship smartwatch review exercising HUAWEI Watch 6 resolution',
  },
  {
    id: 'art-350118c860794e177edf7b37',
    expectedCategory: 'WEARABLE',
    expectedCompany: 'Google',
    title: 'Google launches Fitbit Air in India, though its high price might deter the masses',
    reason: 'Wearable market launch exercising Google/Fitbit competitor resolution and "Air" token guard',
  },
  {
    id: 'art-ef1945149aba0e3c55aa7517',
    expectedCategory: 'WEARABLE',
    expectedCompany: 'Apple',
    title: 'Η Apple δοκιμάζει πρωτότυπα για smart band χωρίς οθόνη',
    reason: 'Screenless fitness tracker prototype leak exercising Apple wearable domain tracking',
  },

  // AUDIO (3)
  {
    id: 'art-65e59439aa5b2c3a43a8b52a',
    expectedCategory: 'AUDIO',
    expectedCompany: 'Samsung',
    title: 'Galaxy Buds On: Τα πρώτα clip ακουστικά της Samsung κρατούν 9,5 ώρες',
    reason: 'Open-ear clip audio hardware launch exercising Samsung Galaxy Buds series resolution',
  },
  {
    id: 'art-ee142b283ccdc87a794b246d',
    expectedCategory: 'AUDIO',
    expectedCompany: 'Apple',
    title: 'Με ακύρωση θορύβου στα 129 δολάρια, τα AirPods 5 έρχονται στις 18 Σεπτεμβρίου',
    reason: 'Entry ANC true wireless earbud launch exercising Apple AirPods 5 generation resolution',
  },
  {
    id: 'art-0fba7f2e7e88d8b621609ff6',
    expectedCategory: 'AUDIO',
    expectedCompany: 'Nothing',
    title: 'Η Nothing παρουσίασε τα Nothing Headphone (1) Pro',
    reason: 'Over-ear ANC headphone launch exercising non-tracked audio specialist resolution',
  },

  // TABLET (3)
  {
    id: 'art-69d7aa413460456453aa8e86',
    expectedCategory: 'TABLET',
    expectedCompany: 'HUAWEI',
    title: 'Huawei MatePad Air: Όταν η τεχνογνωσία συναντά την απόλυτη πρακτικότητα',
    reason: 'Productivity tablet review exercising HUAWEI MatePad Air resolution',
  },
  {
    id: 'art-a092fd97b0e013e0bce49970',
    expectedCategory: 'TABLET',
    expectedCompany: 'Samsung',
    title: 'Galaxy Tab S12 Ultra: 5,1 mm, Photoshop από το κουτί, Ελλάδα στις 2/10',
    reason: 'Ultra-thin flagship Android tablet launch exercising Samsung Galaxy Tab S12 Ultra resolution',
  },
  {
    id: 'art-c6aa848611a285a34f01d7c8',
    expectedCategory: 'TABLET',
    expectedCompany: 'Apple',
    title: 'iPad mini 8: A20 Pro και κάμερα στη σωστή πλευρά για βιντεοκλήσεις',
    reason: 'Compact productivity tablet release exercising Apple iPad mini resolution',
  },
];

async function runPilot() {
  if (FROZEN_PILOT_MANIFEST.length !== 15) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Manifest length must be exactly 15, got ${FROZEN_PILOT_MANIFEST.length}`);
  }

  console.log('====================================================');
  console.log('STARTING PHASE 4C.6 STRATEGIC PILOT BACKFILL (15 ARTICLES)');
  console.log('====================================================\n');

  // Baseline Snapshot
  const initialRevSnap = await getDocs(collection(db, 'entityReview'));
  const initialReviews = initialRevSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const initialStorySnap = await getDocs(collection(db, 'stories'));
  const initialStories = initialStorySnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  const initialProdStories = initialStories.filter(isProductionStory);

  const initialAnSnap = await getDocs(collection(db, 'articleAnalysis'));
  const initialAnalyses = initialAnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  console.log(`BEFORE SNAPSHOT: ${initialAnalyses.length} analyses, ${initialProdStories.length} prod stories, ${initialReviews.length} entity reviews.\n`);

  const results: any[] = [];
  let primaryGeminiCalls = 0;
  let retryGeminiCalls = 0;

  for (let i = 0; i < FROZEN_PILOT_MANIFEST.length; i++) {
    const item = FROZEN_PILOT_MANIFEST[i];
    console.log(`--- [${i + 1}/15] Processing Article ${item.id} ---`);
    console.log(`Title: "${item.title}"`);
    console.log(`Expected Category: ${item.expectedCategory} | Expected Company: ${item.expectedCompany}`);

    const startTime = Date.now();
    try {
      primaryGeminiCalls++;
      const res = await analyzeArticle(item.id, {
        trigger: 'pilot-4c.6',
        autoCluster: true,
      });

      const durationMs = Date.now() - startTime;
      console.log(`Result: ${res.success ? 'SUCCESS' : 'FAILED'} in ${durationMs}ms`);

      results.push({
        item,
        success: res.success,
        analysis: res.analysis,
        error: res.error,
        durationMs,
      });
    } catch (err: any) {
      console.error(`Article ${item.id} encountered fatal error:`, err.message);
      results.push({
        item,
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      });
    }

    // Rate-limiting delay between articles to prevent Gemini quota exhaustion
    if (i < FROZEN_PILOT_MANIFEST.length - 1) {
      console.log('Cooling down 2500ms...');
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  console.log('\n====================================================');
  console.log('PILOT EXECUTION COMPLETE. AUDITING AFTER SNAPSHOT...');
  console.log('====================================================\n');

  // After Snapshot
  const afterAnSnap = await getDocs(collection(db, 'articleAnalysis'));
  const afterAnalyses = afterAnSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  const afterStorySnap = await getDocs(collection(db, 'stories'));
  const afterStories = afterStorySnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  const afterProdStories = afterStories.filter(isProductionStory);

  const afterRevSnap = await getDocs(collection(db, 'entityReview'));
  const afterReviews = afterRevSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Check final status of all 15 articles
  const finalStatuses: Record<string, string> = {};
  for (const m of FROZEN_PILOT_MANIFEST) {
    const artSnap = await getDoc(doc(db, 'articles', m.id));
    finalStatuses[m.id] = artSnap.exists() ? (artSnap.data() as any).processingStatus || 'UNKNOWN' : 'NOT_FOUND';
  }

  // Analytics Before & After
  const compBefore = calculateCompetitiveAnalytics(initialAnalyses, initialStories, { timeRange: 'all' });
  const compAfter = calculateCompetitiveAnalytics(afterAnalyses, afterStories, { timeRange: 'all' });

  // Trends Before & After
  const trendBefore = calculateTrendAnalytics(initialAnalyses, initialStories, { timeRange: '30d' });
  const trendAfter = calculateTrendAnalytics(afterAnalyses, afterStories, { timeRange: '30d' });

  // Print Summary Data
  console.log('=== FINAL AUDIT DATA ===');
  console.log('ATTEMPTED:', results.length);
  console.log('SUCCESSFUL:', results.filter((r) => r.success).length);
  console.log('FAILED:', results.filter((r) => !r.success).length);
  console.log('PRIMARY GEMINI CALLS:', primaryGeminiCalls);
  console.log('RETRY GEMINI CALLS:', retryGeminiCalls);

  console.log('\nFINAL ARTICLE STATUSES:');
  for (const [id, st] of Object.entries(finalStatuses)) {
    console.log(` - ${id}: ${st}`);
  }

  console.log('\nARTICLE ANALYSIS DELTA:');
  console.log(`Before: ${initialAnalyses.length} -> After: ${afterAnalyses.length} (Delta: +${afterAnalyses.length - initialAnalyses.length})`);

  console.log('\nPRODUCTION STORIES DELTA:');
  console.log(`Before: ${initialProdStories.length} -> After: ${afterProdStories.length} (Delta: +${afterProdStories.length - initialProdStories.length})`);

  console.log('\nENTITY REVIEWS DELTA:');
  console.log(`Before: ${initialReviews.length} -> After: ${afterReviews.length} (Delta: +${afterReviews.length - initialReviews.length})`);

  const initialRevIds = new Set(initialReviews.map((r) => r.id));
  const newReviews = afterReviews.filter((r) => !initialRevIds.has(r.id));
  console.log('NEW REVIEWS CREATED:', newReviews.length);
  newReviews.forEach((r: any) => {
    console.log(` - [${r.type}] ${r.detectedName} (${r.category}) -> Reason: ${r.reason}, ID: ${r.id}`);
  });

  console.log('\nANALYTICS DELTA:');
  console.log(`Total Strategic Analyses: ${compBefore.totalStrategicAnalyses} -> ${compAfter.totalStrategicAnalyses}`);
  console.log(`Total Tracked Mentions: ${compBefore.totalEligibleMentions} -> ${compAfter.totalEligibleMentions}`);
  console.log('SOV AFTER:');
  compAfter.companyRows.forEach((r) => {
    console.log(` - ${r.companyName}: ${r.shareOfVoice}% (${r.analyzedMentions} mentions)`);
  });

  console.log('\nTRENDS DELTA:');
  console.log(`Qualifying Trends: ${trendBefore.topTrends.length} -> ${trendAfter.topTrends.length}`);
  console.log('TOP 5 TRENDS AFTER:');
  trendAfter.topTrends.slice(0, 5).forEach((t) => {
    console.log(` - ${t.topic}: ${t.currentCount} articles, Momentum: ${t.momentum}`);
  });

  // Detailed Analysis Quality & Entities per Article
  console.log('\n=== PER-ARTICLE ANALYSIS QUALITY & RESOLUTION AUDIT ===');
  for (const res of results) {
    if (!res.success) {
      console.log(`\nARTICLE ${res.item.id}: FAILED - ${res.error}`);
      continue;
    }
    const a = res.analysis;
    console.log(`\nARTICLE ${a.articleId} (${res.item.expectedCategory}):`);
    console.log(` - Summary: "${a.summary.slice(0, 80)}..."`);
    console.log(` - NewsType: ${a.newsType} | Score: ${a.importanceScore} | Sentiment: ${a.sentiment} (${a.sentimentConfidence})`);
    console.log(` - StoryId: ${a.storyId || 'NONE'}`);
    console.log(` - Companies (${a.companies.length}):`);
    a.companies.forEach((c: any) => {
      console.log(`    * Raw: "${c.canonicalName}" | CompanyId: ${c.companyId || 'UNRESOLVED'} | Alias: "${c.matchedAlias}" | Conf: ${c.confidence}`);
    });
    console.log(` - Products (${a.products.length}):`);
    a.products.forEach((p: any) => {
      console.log(`    * Raw: "${p.canonicalName}" | ProductId: ${p.productId || 'UNRESOLVED'} | Text: "${p.matchedText}" | Category: ${p.category} | Conf: ${p.confidence}`);
    });
  }

  process.exit(0);
}

runPilot().catch((e) => {
  console.error('FATAL PILOT RUNNER ERROR:', e);
  process.exit(1);
});

/**
 * Phase 4C.7 Controlled Strategic Batch Backfill Runner
 * Exactly 30 articles. Concurrency = 2. Production execution.
 */

import { db } from '../src/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { analyzeArticle } from '../src/server/analysisEngine';
import { isProductionStory, isLegacyStory, ArticleAnalysis, EntityReview, Company, Product, Story } from '../src/types';
import { getMergedCanonicalCompanies, getMergedCanonicalProducts, CANONICAL_COMPANIES_REGISTRY, CANONICAL_PRODUCTS_REGISTRY } from '../src/services/canonicalEntities';
import { calculateCompetitiveAnalytics, TRACKED_COMPANIES, resolveTrackedCompanyId } from '../src/services/competitiveAnalytics';
import { calculateTrendAnalytics } from '../src/services/trendAnalytics';

// ----------------------------------------------------------------------------
// FROZEN 30-ARTICLE BATCH MANIFEST
// ----------------------------------------------------------------------------
export const FROZEN_BATCH_30_MANIFEST = [
  // SMARTPHONE (10)
  {
    index: 1,
    id: 'art-f3b90ec44234b91d96e067cf',
    category: 'SMARTPHONE',
    company: 'HUAWEI',
    title: 'Huawei Mate 90: Ανακοινώθηκαν επίσημα και ξεπερνούν τους περιορισμούς των ΗΠΑ',
    reason: 'HUAWEI flagship smartphone launch (Mate 90) exercising primary OEM resolution',
  },
  {
    index: 2,
    id: 'art-72cd9cb4ba4e6301c9c32876',
    category: 'SMARTPHONE',
    company: 'Samsung',
    title: 'Η Samsung καλωσορίζει δημόσια το iPhone Duo, υπενθυμίζοντας όμως ότι το κλειδί είναι το βάρος',
    reason: 'Samsung commentary on Apple iPhone Duo exercising newly promoted canonical product prod-appl-iphoneduo',
  },
  {
    index: 3,
    id: 'art-b33feb00ce8e58bd68fd4aae',
    category: 'SMARTPHONE',
    company: 'Apple',
    title: 'Bloomberg: Από τα 2.000 δολάρια θα ξεκινά το iPhone Duo, το πρώτο αναδιπλούμενο της Apple',
    reason: 'Bloomberg report on Apple foldable iPhone Duo exercising canonical product resolver',
  },
  {
    index: 4,
    id: 'art-510ac39df3246e02e03e131c',
    category: 'SMARTPHONE',
    company: 'Samsung',
    title: 'Galaxy S25: Ήρθε το σταθερό One UI 9, μαζί με Z Fold 7 και Z Flip 7',
    reason: 'Samsung Galaxy S25 / Z Fold 7 software & hardware ecosystem launch',
  },
  {
    index: 5,
    id: 'art-ddc61a5952196d56dd70b4a8',
    category: 'SMARTPHONE',
    company: 'Samsung',
    title: 'Επίσημο το Galaxy A18 4G της Samsung με One UI 9 και έξι χρόνια αναβαθμίσεων',
    reason: 'Samsung Galaxy A series entry smartphone launch exercising model variant tracking',
  },
  {
    index: 6,
    id: 'art-412f59cf086d55a373bb4880',
    category: 'SMARTPHONE',
    company: 'HONOR',
    title: "Honor's Magic 9 Pro Max takes the ARRI cinematic route: spotlights 4K 60fps, 8,800mAh battery",
    reason: 'HONOR Magic 9 Pro Max cinematic flagship exercising HONOR variant resolver',
  },
  {
    index: 7,
    id: 'art-0ef13bb14c0c991ea131d8fd',
    category: 'SMARTPHONE',
    company: 'Xiaomi',
    title: 'Poco C95 Pro: Η οικονομική πρόταση ανακοινώθηκε με θηριώδη μπαταρία',
    reason: 'Xiaomi Poco C95 Pro budget smartphone announcement exercising brand alias',
  },
  {
    index: 8,
    id: 'art-71c6712c90148fcbdadf5994',
    category: 'SMARTPHONE',
    company: 'Google',
    title: 'Ελαφρύτερο, πιο ανθεκτικό και με άρθρωση χωρίς γρανάζια το νέο Pixel 11 Pro Fold της Google',
    reason: 'Google Pixel 11 Pro Fold hardware leak exercising Google foldables series',
  },
  {
    index: 9,
    id: 'art-24aa5f9d45faf55beaa00e28',
    category: 'SMARTPHONE',
    company: 'OPPO',
    title: 'Oppo Find X10 and Find X10 Pro Max leaked European prices are shocking',
    reason: 'OPPO Find X10 / Pro Max flagship series pricing exercising OPPO tracking',
  },
  {
    index: 10,
    id: 'art-28b908f1f490f00a8b408932',
    category: 'SMARTPHONE',
    company: 'vivo',
    title: 'vivo X Fold6: Πάνω από 2.100 ευρώ στην Ευρώπη, με κάμερα 200MP',
    reason: 'vivo X Fold6 European launch exercising vivo foldable device tracking',
  },

  // WEARABLE (8)
  {
    index: 11,
    id: 'art-5ece4a92ba501457ffcb8d2f',
    category: 'WEARABLE',
    company: 'HUAWEI',
    title: 'HUAWEI WATCH GT 7 Series: Η νέα γενιά premium smartwatches είναι πλέον διαθέσιμη στην Ελλάδα',
    reason: 'HUAWEI Watch GT 7 Series Greek launch exercising HUAWEI smartwatch series resolver',
  },
  {
    index: 12,
    id: 'art-65872ebebd36cfa41e253ac6',
    category: 'WEARABLE',
    company: 'HUAWEI',
    title: 'Huawei Watch GT 7 Series: Νέα σχεδίαση, προηγμένα sports modes και αυτονομία έως 21 ημέρες',
    reason: 'HUAWEI Watch GT 7 Series technical deep-dive exercising sports modes & battery',
  },
  {
    index: 13,
    id: 'art-6aa2f1cc0e4033909810d424',
    category: 'WEARABLE',
    company: 'HUAWEI',
    title: 'Huawei Watch GT 7 Pro Hands-On Review: “Από την πόλη στo βουνό, χωρίς… συμβιβασμούς και εκπτώσεις”!',
    reason: 'HUAWEI Watch GT 7 Pro Hands-On review exercising premium model variant',
  },
  {
    index: 14,
    id: 'art-571ec7c9786aed64a8cef3ee',
    category: 'WEARABLE',
    company: 'Google',
    title: "Fitbit Air finally lands in India, but you won't like the pricing",
    reason: 'Google Fitbit Air India market launch exercising newly promoted canonical product prod-goog-fitbitair',
  },
  {
    index: 15,
    id: 'art-620a774e2c5302cb30b3a4fe',
    category: 'WEARABLE',
    company: 'Google',
    title: 'Google Fitbit Air Review: Το wearable που θέλει να ξεχάσεις ότι φοράς',
    reason: 'Google Fitbit Air comprehensive review exercising newly promoted canonical product',
  },
  {
    index: 16,
    id: 'art-8a311fd837034279925a6edc',
    category: 'WEARABLE',
    company: 'Apple',
    title: 'Παλμοί κάθε πέντε δευτερόλεπτα και AI που ακούει για εσάς στα Apple Watch Series 12 και Ultra 4',
    reason: 'Apple Watch Series 12 & Ultra 4 leak exercising Apple wearable family resolution',
  },
  {
    index: 17,
    id: 'art-a32a43330804153a3865ccd7',
    category: 'WEARABLE',
    company: 'HUAWEI',
    title: 'Η Huawei στην κορυφή της παγκόσμιας αγοράς wearables το πρώτο εξάμηνο του 2026',
    reason: 'HUAWEI global wearable market leadership analysis exercising macro competitive intelligence',
  },
  {
    index: 18,
    id: 'art-66a349533d2f80e11c3029cf',
    category: 'WEARABLE',
    company: 'HUAWEI',
    title: 'Σχόλιο στο Η Huawei στην κορυφή της παγκόσμιας αγοράς wearables για 2ο συνεχόμενο τρίμηνο από τον/την Το fitness έγινε μόδα – και η Xiaomi οδηγεί την τάση στα bands!',
    reason: 'HUAWEI & Xiaomi fitness band competitive comparison exercising multi-company analysis',
  },

  // AUDIO (6)
  {
    index: 19,
    id: 'art-73fda67ce15d17c764174c6d',
    category: 'AUDIO',
    company: 'Nothing',
    title: 'Nothing Headphone (1) Pro unveiled with triple drivers, improved ANC, and premium build',
    reason: 'Nothing Headphone (1) Pro unveil exercising newly promoted canonical company comp-nothing',
  },
  {
    index: 20,
    id: 'art-7dd29fdc56494da0662b67fa',
    category: 'AUDIO',
    company: 'Nothing',
    title: 'Nothing Headphone (1) Pro in for review',
    reason: 'Nothing Headphone (1) Pro review exercising newly promoted canonical company comp-nothing',
  },
  {
    index: 21,
    id: 'art-c1093242a929464d13621095',
    category: 'AUDIO',
    company: 'Apple',
    title: "I test headphones for a living, and the Beats 360 are a fun and stylish alternative to the AirPods Max 2 that I can't recommend more",
    reason: 'Apple AirPods Max 2 / Beats 360 audio comparison exercising Apple audio resolver',
  },
  {
    index: 22,
    id: 'art-c5a73f784c99a6bd501817f8',
    category: 'AUDIO',
    company: 'Samsung',
    title: 'Samsung finally takes on Shokz with first clip-on Galaxy Buds',
    reason: 'Samsung Galaxy Buds clip-on audio launch exercising Samsung audio category',
  },
  {
    index: 23,
    id: 'art-e1bf7c0cebf0150341e06dab',
    category: 'AUDIO',
    company: 'Apple',
    title: 'Σχόλιο στο Ολοκαίνουργιος σχεδιασμός για τα AirPods Pro 3 και νέες λειτουργίες μέσω του iOS 26 από τον/την AirPods Pro 3: Νέες δυνατότητες παρακολούθησης καρδιακού ρυθμού και ζωντανής μετάφρασης με την τεχνητή νοημοσύνη της Apple',
    reason: 'Apple AirPods Pro 3 heart rate tracking feature leak exercising Apple audio family',
  },
  {
    index: 24,
    id: 'art-e0593d9d3439f88351fb7cb4',
    category: 'AUDIO',
    company: 'Audio Specialist',
    title: 'Η Bose ξαναβάζει… καλώδιο στα ακουστικά της μετά από 11 χρόνια, ανακοίνωσε τα Noise Cancelling Wired Earbuds',
    reason: 'Bose Noise Cancelling Wired Earbuds launch exercising ecosystem audio specialist',
  },

  // TABLET (6)
  {
    index: 25,
    id: 'art-9c630a01ca85a961b5512b06',
    category: 'TABLET',
    company: 'Samsung',
    title: 'Η Samsung παρουσιάζει τη σειρά Galaxy Tab S12',
    reason: 'Samsung Galaxy Tab S12 series official launch exercising tablet family resolver',
  },
  {
    index: 26,
    id: 'art-b549fe3e920aaae97885910b',
    category: 'TABLET',
    company: 'Samsung',
    title: 'Samsung Galaxy Tab S12: Τιμές, χαρακτηριστικά και δυνατότητες AI',
    reason: 'Samsung Galaxy Tab S12 pricing & AI specs exercising Samsung tablet catalog',
  },
  {
    index: 27,
    id: 'art-e6dcc06c58f1c54045d6810f',
    category: 'TABLET',
    company: 'Samsung',
    title: 'Samsung Galaxy Tab S12 Ultra: Ο νέος βασιλιάς των Android tablets έρχεται με Dimensity 9500',
    reason: 'Samsung Galaxy Tab S12 Ultra Dimensity 9500 leak exercising chipset non-device suppression',
  },
  {
    index: 28,
    id: 'art-e88101058e9c235ee03bbb0b',
    category: 'TABLET',
    company: 'Samsung',
    title: 'Με επεξεργαστή 3nm και πάχος 5,1 χιλιοστά, τα Galaxy Tab S12 είναι τα ισχυρότερα tablet της Samsung',
    reason: 'Samsung Galaxy Tab S12 3nm hardware design & form factor analysis',
  },
  {
    index: 29,
    id: 'art-eeba4b8deda4ac7e61c66c7b',
    category: 'TABLET',
    company: 'Samsung',
    title: 'Samsung Galaxy Tab S12 Ultra και S12+: Ανακοινώθηκαν με chipset του 2025',
    reason: 'Samsung Galaxy Tab S12 Ultra & S12+ launch exercising tablet model variants',
  },
  {
    index: 30,
    id: 'art-fca202f1fc716a9032742d76',
    category: 'TABLET',
    company: 'Samsung',
    title: 'Samsung Galaxy Tab S12 Ultra in for review',
    reason: 'Samsung Galaxy Tab S12 Ultra hardware review exercising tablet specs',
  },
];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runControlledBatch30() {
  console.log('====================================================');
  console.log('PHASE 4C.7: CONTROLLED STRATEGIC BATCH BACKFILL (30)');
  console.log('====================================================\n');

  // Verify Pre-Conditions
  const targetIds = FROZEN_BATCH_30_MANIFEST.map((m) => m.id);
  if (targetIds.length !== 30) {
    throw new Error(`Manifest size must be exactly 30, got ${targetIds.length}`);
  }

  // Pre-snapshot counts
  const beforeRevSnap = await getDocs(collection(db, 'entityReview'));
  const beforeAnSnap = await getDocs(collection(db, 'articleAnalysis'));
  const beforeStorySnap = await getDocs(collection(db, 'stories'));

  console.log('Pre-run EntityReviews total:', beforeRevSnap.size);
  console.log('Pre-run ArticleAnalysis total:', beforeAnSnap.size);
  console.log('Pre-run Stories total:', beforeStorySnap.size);

  const initialRevIds = new Set(beforeRevSnap.docs.map((d) => d.id));

  // Run execution with concurrency = 2
  const results: Array<{
    id: string;
    index: number;
    title: string;
    success: boolean;
    analysis?: any;
    error?: string;
    durationMs: number;
  }> = [];

  let consecutiveFailures = 0;
  let totalFailures = 0;
  let stopTriggered = false;
  let stopReason = '';

  // Process in pairs of 2
  for (let i = 0; i < FROZEN_BATCH_30_MANIFEST.length; i += 2) {
    if (stopTriggered) {
      console.log(`[STOP CONDITION ACTIVE] Skipping remaining articles starting at index ${i + 1}`);
      break;
    }

    const pair = FROZEN_BATCH_30_MANIFEST.slice(i, i + 2);
    console.log(`\n--- Processing Batch Pair: #${pair[0].index} & #${pair[1] ? pair[1].index : 'N/A'} ---`);

    const promises = pair.map(async (item) => {
      const startTime = Date.now();
      console.log(`[#${item.index}] Starting: "${item.title.slice(0, 60)}..." (${item.id})`);
      try {
        const execResult = await analyzeArticle(item.id);
        const durationMs = Date.now() - startTime;
        console.log(`[#${item.index}] SUCCESS (${durationMs}ms) -> Story: ${execResult.analysis?.storyId || 'None'}`);
        return {
          id: item.id,
          index: item.index,
          title: item.title,
          success: execResult.success,
          analysis: execResult.analysis,
          durationMs,
        };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        console.error(`[#${item.index}] FAILED (${durationMs}ms):`, err.message);
        return {
          id: item.id,
          index: item.index,
          title: item.title,
          success: false,
          error: err.message,
          durationMs,
        };
      }
    });

    const pairResults = await Promise.all(promises);
    for (const r of pairResults) {
      results.push(r);
      if (!r.success) {
        consecutiveFailures++;
        totalFailures++;
      } else {
        consecutiveFailures = 0;
      }
    }

    // Check Gemini Stop Conditions
    if (consecutiveFailures >= 3) {
      stopTriggered = true;
      stopReason = '3 consecutive primary ArticleAnalysis failures';
      break;
    }

    if (results.length >= 10 && totalFailures / results.length > 0.2) {
      stopTriggered = true;
      stopReason = `Gemini failure rate (${((totalFailures / results.length) * 100).toFixed(1)}%) exceeded 20%`;
      break;
    }

    // Safe delay before next pair (1500ms)
    if (i + 2 < FROZEN_BATCH_30_MANIFEST.length) {
      await sleep(1500);
    }
  }

  console.log('\n====================================================');
  console.log('BATCH 30 PROCESSING COMPLETE');
  console.log('====================================================\n');

  console.log(`Attempted: ${results.length} / 30`);
  console.log(`Successful: ${results.filter((r) => r.success).length}`);
  console.log(`Failed: ${results.filter((r) => !r.success).length}`);
  if (stopTriggered) {
    console.log(`STOPPED EARLY: ${stopReason}`);
  }

  // Check final status of all 30 articles in Firestore
  const finalStatuses: Record<string, string> = {};
  for (const m of FROZEN_BATCH_30_MANIFEST) {
    const snap = await getDoc(doc(db, 'articles', m.id));
    finalStatuses[m.id] = snap.exists() ? snap.data().processingStatus || 'PENDING' : 'NOT_FOUND';
  }
  console.log('\nFinal Article Statuses:', JSON.stringify(finalStatuses, null, 2));

  // Check new EntityReviews created
  const afterRevSnap = await getDocs(collection(db, 'entityReview'));
  const newReviews = afterRevSnap.docs.filter((d) => !initialRevIds.has(d.id));
  console.log(`\nNew EntityReviews created (${newReviews.length}):`);
  newReviews.forEach((d) => {
    const data = d.data();
    console.log(` - ID: ${d.id} | Name: ${data.detectedName} | Type: ${data.type} | Status: ${data.status} | Reason: ${data.reason}`);
  });

  // Check post-batch ArticleAnalysis
  const afterAnSnap = await getDocs(collection(db, 'articleAnalysis'));
  console.log(`\nPost-run ArticleAnalysis total: ${afterAnSnap.size} (Delta: +${afterAnSnap.size - beforeAnSnap.size})`);

  // Check post-batch Stories
  const afterStorySnap = await getDocs(collection(db, 'stories'));
  const prodStories = afterStorySnap.docs.filter((d) => isProductionStory({ id: d.id, ...d.data() } as any));
  console.log(`Post-run Stories total: ${afterStorySnap.size} (Production: ${prodStories.length}, Delta: +${afterStorySnap.size - beforeStorySnap.size})`);

  process.exit(0);
}

runControlledBatch30().catch((err) => {
  console.error('Fatal batch runner error:', err);
  process.exit(1);
});

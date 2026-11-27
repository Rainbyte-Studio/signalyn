import { db } from '../src/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { classifyStrategicRelevance } from '../src/server/strategicRelevanceGate';

const PILOT_IDS = [
  // SMARTPHONE (5)
  'art-14330a66a509aa068dda8838', // HUAWEI Mate 90 Pro
  'art-185c36814d6bc690b2867e69', // Samsung Galaxy S26
  'art-0c8bbaad15765f70756cd513', // HONOR Magic9 Pro Max
  'art-0d63ac05d10cf91acc5fb06c', // Xiaomi 18 Pro
  'art-197bb8f58da3aeb8c0f4211f', // Apple iPhone Duo
  // WEARABLE (4)
  'art-5e7f0f83cb1ed8fd5bb92d05', // HUAWEI Watch GT 7 Pro
  'art-488d5df07247e74681ce71df', // HUAWEI Watch 6
  'art-350118c860794e177edf7b37', // Google Fitbit Air
  'art-ef1945149aba0e3c55aa7517', // Apple Smart Band
  // AUDIO (3)
  'art-65e59439aa5b2c3a43a8b52a', // Samsung Galaxy Buds On
  'art-ee142b283ccdc87a794b246d', // Apple AirPods 5
  'art-0fba7f2e7e88d8b621609ff6', // Nothing Headphone (1) Pro
  // TABLET (3)
  'art-69d7aa413460456453aa8e86', // HUAWEI MatePad Air
  'art-a092fd97b0e013e0bce49970', // Samsung Galaxy Tab S12 Ultra
  'art-c6aa848611a285a34f01d7c8', // Apple iPad mini 8
];

async function verifyManifest() {
  console.log('=== PILOT MANIFEST CANDIDATES VERIFICATION ===');
  console.log('Total count:', PILOT_IDS.length);

  for (let i = 0; i < PILOT_IDS.length; i++) {
    const id = PILOT_IDS[i];
    const snap = await getDoc(doc(db, 'articles', id));
    if (!snap.exists()) {
      console.error(`Article ${id} NOT FOUND!`);
      continue;
    }
    const a = { id: snap.id, ...snap.data() } as any;
    const rel = classifyStrategicRelevance({
      title: a.title,
      excerpt: a.excerpt || a.summary || a.contentSnippet || '',
      rawCategories: a.rawCategories || a.categories || [],
      sourceName: a.sourceName || '',
      canonicalUrl: a.canonicalUrl || '',
    });

    console.log(`\n[${i + 1}/15] ${a.id}`);
    console.log(`Title: "${a.title}"`);
    console.log(`Source: ${a.sourceName || a.sourceId} | Published: ${a.publishedAt}`);
    console.log(`Status: ${a.processingStatus || a.status} | URL: ${a.canonicalUrl}`);
    console.log(`Relevance: ${rel.decision} | Category: ${rel.category} | MatchedCo: [${rel.matchedCompanies.join(', ')}]`);
    console.log(`Reason: ${rel.reason}`);
  }

  process.exit(0);
}

verifyManifest().catch(console.error);

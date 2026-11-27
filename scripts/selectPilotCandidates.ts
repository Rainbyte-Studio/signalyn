import { db } from '../src/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { classifyStrategicRelevance } from '../src/server/strategicRelevanceGate';

async function scan() {
  const snap = await getDocs(collection(db, 'articles'));
  const allArticles = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const pending = allArticles.filter(a => a.processingStatus === 'PENDING' || a.status === 'PENDING');

  console.log('Total articles:', allArticles.length);
  console.log('Total pending:', pending.length);

  const evaluated = pending.map(a => {
    const rel = classifyStrategicRelevance({
      title: a.title,
      excerpt: a.excerpt || a.summary || a.contentSnippet || '',
      rawCategories: a.rawCategories || a.categories || [],
      sourceName: a.sourceName || '',
      canonicalUrl: a.canonicalUrl || '',
    });
    return { article: a, rel };
  });

  const inScope = evaluated.filter(e => e.rel.decision === 'IN_SCOPE');
  const uncertain = evaluated.filter(e => e.rel.decision === 'UNCERTAIN');
  const outOfScope = evaluated.filter(e => e.rel.decision === 'OUT_OF_SCOPE');

  console.log('IN_SCOPE:', inScope.length);
  console.log('UNCERTAIN:', uncertain.length);
  console.log('OUT_OF_SCOPE:', outOfScope.length);

  const byCat: Record<string, any[]> = {
    SMARTPHONE: [],
    WEARABLE: [],
    AUDIO: [],
    TABLET: [],
    OTHER: [],
    UNKNOWN: []
  };

  for (const e of inScope) {
    const cat = e.rel.category || 'UNKNOWN';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(e);
  }

  for (const [cat, list] of Object.entries(byCat)) {
    console.log(` - ${cat}: ${list.length}`);
  }

  // Print samples from each of the 4 categories
  for (const targetCat of ['SMARTPHONE', 'WEARABLE', 'AUDIO', 'TABLET']) {
    console.log(`\n=== SAMPLES FOR ${targetCat} (${byCat[targetCat]?.length || 0}) ===`);
    (byCat[targetCat] || []).slice(0, 10).forEach(e => {
      console.log(`ID: ${e.article.id} | Co: [${e.rel.matchedCompanies.join(', ')}] | Title: "${e.article.title.slice(0, 75)}" | Pub: ${e.article.publishedAt}`);
    });
  }

  process.exit(0);
}

scan().catch(e => {
  console.error(e);
  process.exit(1);
});

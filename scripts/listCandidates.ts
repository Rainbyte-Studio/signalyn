import { db } from '../src/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { classifyStrategicRelevance } from '../src/server/strategicRelevanceGate';

async function listAllCandidates() {
  const snap = await getDocs(collection(db, 'articles'));
  const pending = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .filter(a => a.processingStatus === 'PENDING' || a.status === 'PENDING');

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

  console.log('--- ALL 27 WEARABLES ---');
  inScope.filter(e => e.rel.category === 'WEARABLE').forEach(e => {
    console.log(e.article.id, '|', e.rel.matchedCompanies.join(','), '|', e.article.title);
  });

  console.log('\n--- ALL 24 AUDIO ---');
  inScope.filter(e => e.rel.category === 'AUDIO').forEach(e => {
    console.log(e.article.id, '|', e.rel.matchedCompanies.join(','), '|', e.article.title);
  });

  console.log('\n--- ALL 12 TABLETS ---');
  inScope.filter(e => e.rel.category === 'TABLET').forEach(e => {
    console.log(e.article.id, '|', e.rel.matchedCompanies.join(','), '|', e.article.title);
  });

  console.log('\n--- TOP 15 SMARTPHONES ---');
  inScope.filter(e => e.rel.category === 'SMARTPHONE').slice(0, 15).forEach(e => {
    console.log(e.article.id, '|', e.rel.matchedCompanies.join(','), '|', e.article.title);
  });

  process.exit(0);
}

listAllCandidates().catch(console.error);

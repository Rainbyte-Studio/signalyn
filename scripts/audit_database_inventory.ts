import { db } from '../src/firebase';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  limit,
  orderBy,
} from 'firebase/firestore';
import { isProductionStory } from '../src/types';

async function runDatabaseInventory() {
  console.log('=== SIGNALYN PRODUCTION FIRESTORE INVENTORY AUDIT ===\n');

  // 1. Collection Counts
  const colNames = [
    'sources',
    'deletedSources',
    'sourceGroups',
    'articles',
    'stories',
    'companies',
    'products',
    'articleAnalysis',
    'entityReview',
    'settings',
    'analyticsDaily',
    'analyticsLedger',
  ];

  console.log('--- 1. Document Counts per Collection ---');
  const counts: Record<string, number> = {};

  for (const name of colNames) {
    try {
      const snap = await getCountFromServer(collection(db, name));
      counts[name] = snap.data().count;
      console.log(`  ${name.padEnd(20)}: ${counts[name]}`);
    } catch (err: any) {
      console.log(`  ${name.padEnd(20)}: ERROR (${err.message})`);
    }
  }

  // 2. Sources Audit
  console.log('\n--- 2. Sources Analysis ---');
  const sourcesSnap = await getDocs(collection(db, 'sources'));
  let activeSources = 0;
  let pausedSources = 0;
  let errorSources = 0;
  let totalFeeds = 0;
  let activeFeeds = 0;
  let errorFeeds = 0;
  const sourceNames: string[] = [];

  sourcesSnap.forEach((d) => {
    const s = d.data();
    sourceNames.push(s.name || d.id);
    if (s.status === 'ACTIVE') activeSources++;
    else if (s.status === 'PAUSED') pausedSources++;
    else if (s.status === 'ERROR') errorSources++;

    (s.feeds || []).forEach((f: any) => {
      totalFeeds++;
      if (f.status === 'ACTIVE') activeFeeds++;
      else if (f.status === 'ERROR') errorFeeds++;
    });
  });

  console.log(`  Total Sources:   ${sourcesSnap.size}`);
  console.log(`  Active Sources:  ${activeSources}`);
  console.log(`  Paused Sources:  ${pausedSources}`);
  console.log(`  Error Sources:   ${errorSources}`);
  console.log(`  Total Feeds:     ${totalFeeds}`);
  console.log(`  Active Feeds:    ${activeFeeds}`);
  console.log(`  Error Feeds:     ${errorFeeds}`);
  console.log(`  Source Sample:   ${sourceNames.slice(0, 5).join(', ')}`);

  // 3. Articles Audit
  console.log('\n--- 3. Articles Analysis (Bounded Sample: 100) ---');
  const articlesSampleSnap = await getDocs(query(collection(db, 'articles'), limit(100)));
  const statusCounts: Record<string, number> = {};
  const languages: Record<string, number> = {};
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';

  articlesSampleSnap.forEach((d) => {
    const a = d.data();
    const st = a.processingStatus || 'NONE';
    statusCounts[st] = (statusCounts[st] || 0) + 1;

    const lang = a.language || 'unknown';
    languages[lang] = (languages[lang] || 0) + 1;

    if (a.publishedAt) {
      if (a.publishedAt < minDate) minDate = a.publishedAt;
      if (a.publishedAt > maxDate) maxDate = a.publishedAt;
    }
  });

  console.log(`  Processing Statuses in sample:`, statusCounts);
  console.log(`  Languages in sample:          `, languages);
  console.log(`  Sample Date Range:             ${minDate.slice(0, 10)} to ${maxDate.slice(0, 10)}`);

  // 4. Stories Audit
  console.log('\n--- 4. Stories Analysis ---');
  const storiesSnap = await getDocs(collection(db, 'stories'));
  let productionStoriesCount = 0;
  let legacyStoriesCount = 0;

  storiesSnap.forEach((d) => {
    const s = d.data();
    if (isProductionStory(s as any)) {
      productionStoriesCount++;
    } else {
      legacyStoriesCount++;
    }
  });

  console.log(`  Total Stories in DB:     ${storiesSnap.size}`);
  console.log(`  Production Stories:      ${productionStoriesCount}`);
  console.log(`  Legacy Stories:          ${legacyStoriesCount}`);

  // 5. Entity Reviews Audit
  console.log('\n--- 5. Entity Reviews Analysis ---');
  const reviewSnap = await getDocs(collection(db, 'entityReview'));
  const reviewStatusMap: Record<string, number> = {};
  const reviewTypeMap: Record<string, number> = {};

  reviewSnap.forEach((d) => {
    const r = d.data();
    const st = r.status || 'UNKNOWN';
    const ty = r.type || 'UNKNOWN';
    reviewStatusMap[st] = (reviewStatusMap[st] || 0) + 1;
    reviewTypeMap[ty] = (reviewTypeMap[ty] || 0) + 1;
  });

  console.log(`  Review Statuses:`, reviewStatusMap);
  console.log(`  Review Types:   `, reviewTypeMap);

  // 6. Analytics Daily & Ledger Bounded Audit
  console.log('\n--- 6. Analytics Daily & Ledger Audit ---');
  const dailySnap = await getDocs(collection(db, 'analyticsDaily'));
  let dailyWithByCategory = 0;
  let dailyMissingByCategory = 0;
  let totalArticlesInDaily = 0;
  let totalMentionsInDaily = 0;

  dailySnap.forEach((d) => {
    const data = d.data();
    totalArticlesInDaily += data.articlesCount || 0;
    totalMentionsInDaily += data.totalCompanyMentions || 0;
    if (data.byCategory && Object.keys(data.byCategory).length > 0) {
      dailyWithByCategory++;
    } else {
      dailyMissingByCategory++;
    }
  });

  console.log(`  Daily Buckets:            ${dailySnap.size}`);
  console.log(`  Buckets with byCategory:  ${dailyWithByCategory}`);
  console.log(`  Buckets w/o byCategory:   ${dailyMissingByCategory}`);
  console.log(`  Sum of articlesCount:     ${totalArticlesInDaily}`);
  console.log(`  Sum of totalMentions:     ${totalMentionsInDaily}`);

  process.exit(0);
}

runDatabaseInventory().catch((err) => {
  console.error(err);
  process.exit(1);
});

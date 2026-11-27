import { db } from '../src/firebase';
import { collection, getDocs, doc, getDoc, query, orderBy, limit, where } from 'firebase/firestore';
import { getAthensReportingWindow, isWithinAthensReportingWindow } from '../src/server/reportingWindow';
import { classifyStrategicRelevance } from '../src/server/strategicRelevanceGate';

async function diagnose() {
  console.log('=== 1. CHECK REPORTING WINDOW FOR 2026-10-20 ===');
  const window20 = getAthensReportingWindow('2026-10-20');
  console.log('Window 2026-10-20:', window20);

  console.log('\n=== 2. CHECK LATEST DAILY BRIEFS ===');
  const briefsSnap = await getDocs(query(collection(db, 'dailyBriefs'), orderBy('date', 'desc'), limit(3)));
  console.log('Daily Briefs count in DB:', briefsSnap.size);
  briefsSnap.forEach(d => {
    const data = d.data();
    console.log(`Brief ID: ${d.id}, Date: ${data.date}, Status: ${data.status}`);
    console.log('Grounding metrics:', JSON.stringify(data.groundingMetrics, null, 2));
    console.log('Headline developments count:', data.en?.headlineDevelopments?.length);
    if (data.en?.headlineDevelopments?.length > 0) {
      console.log('Headlines:', data.en.headlineDevelopments.map((h: any) => ({
        title: h.title,
        storyId: h.storyId,
        category: h.category,
        competitors: h.trackedCompetitors
      })));
    }
    console.log('P1 fields in EN:');
    console.log('- criticalAlerts:', data.en?.criticalAlerts?.length);
    console.log('- dayOverDayDelta:', data.en?.dayOverDayDelta ? 'Present' : 'Missing', data.en?.dayOverDayDelta?.summary);
    console.log('- strategicHardwareOverview:', data.en?.strategicHardwareOverview?.length);
    console.log('- prioritizedOpportunitiesThreats:', data.en?.prioritizedOpportunitiesThreats ? 'Present' : 'Missing');
    console.log('- actionableRecommendations:', data.en?.actionableRecommendations?.length);
  });

  console.log('\n=== 3. CHECK ARTICLES IN WINDOW 2026-10-20 ===');
  const articlesSnap = await getDocs(query(collection(db, 'articles'), orderBy('publishedAt', 'desc'), limit(40)));
  console.log('Total articles fetched:', articlesSnap.size);
  
  const windowArticles: any[] = [];
  articlesSnap.forEach(d => {
    const a = d.data();
    a.id = d.id;
    if (isWithinAthensReportingWindow(a.publishedAt, window20.windowStartIso, window20.windowEndIso)) {
      windowArticles.push(a);
    }
  });

  console.log(`Articles strictly in window 2026-10-20 (${window20.windowStartIso} to ${window20.windowEndIso}): ${windowArticles.length}`);
  windowArticles.forEach((a, idx) => {
    const rel = classifyStrategicRelevance({
      title: a.title,
      excerpt: a.excerpt,
      rawCategories: a.rawCategories,
      sourceName: a.sourceName,
      canonicalUrl: a.canonicalUrl,
    });
    console.log(`[${idx+1}] ${a.title} | Source: ${a.sourceName} | Published: ${a.publishedAt}`);
    console.log(`    Relevance Decision: ${rel.decision} | Category: ${rel.category} | Reason: ${rel.reason}`);
  });

  console.log('\n=== 4. CHECK RECENT STORIES ===');
  const storiesSnap = await getDocs(query(collection(db, 'stories'), limit(100)));
  console.log('Stories sampled:', storiesSnap.size);
  let eligibleCount = 0;
  let inWindowMaterialCount = 0;
  let statusCounts: Record<string, number> = {};
  
  storiesSnap.forEach(d => {
    const s = d.data();
    s.id = d.id;
    statusCounts[s.status || 'UNDEFINED'] = (statusCounts[s.status || 'UNDEFINED'] || 0) + 1;
    const matTime = s.lastMaterialUpdateAt || s.lastSeenAt || s.lastUpdatedAt || s.updatedAt || s.firstSeenAt;
    const inWin = isWithinAthensReportingWindow(matTime, window20.windowStartIso, window20.windowEndIso);
    if (inWin) inWindowMaterialCount++;
  });

  console.log('Stories status breakdown:', statusCounts);
  console.log('Stories with material time in window 2026-10-20:', inWindowMaterialCount);

  process.exit(0);
}

diagnose().catch(err => {
  console.error(err);
  process.exit(1);
});

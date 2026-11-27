import { db } from '../src/firebase';
import configFile from '../firebase-applet-config.json';
import { collection, getDocs, getCountFromServer } from 'firebase/firestore';

async function runPreflight() {
  console.log('=== PHASE 5C.2 PREFLIGHT: PRODUCTION BASELINE CHECK ===');

  const expectedProjectId = 'signalyn-5406e';
  const expectedDbId = 'ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34';

  const configProjectId = configFile.projectId;
  const configDbId = configFile.firestoreDatabaseId;

  console.log(`Firebase Project: ${configProjectId} (Expected: ${expectedProjectId})`);
  console.log(`Firestore DB ID:  ${configDbId} (Expected: ${expectedDbId})`);

  if (configProjectId !== expectedProjectId || configDbId !== expectedDbId) {
    throw new Error('Database / Project configuration mismatch!');
  }

  // Count ledger and daily aggregates
  const ledgerCol = collection(db, 'analyticsLedger');
  const dailyCol = collection(db, 'analyticsDaily');
  const analysesCol = collection(db, 'articleAnalysis');

  const [ledgerCountSnap, dailyCountSnap, analysesCountSnap] = await Promise.all([
    getCountFromServer(ledgerCol),
    getCountFromServer(dailyCol),
    getCountFromServer(analysesCol),
  ]);

  const ledgerCount = ledgerCountSnap.data().count;
  const dailyCount = dailyCountSnap.data().count;
  const analysesCount = analysesCountSnap.data().count;

  console.log(`Current /analyticsLedger count:  ${ledgerCount}`);
  console.log(`Current /analyticsDaily count:   ${dailyCount}`);
  console.log(`Current /articleAnalysis count:  ${analysesCount}`);

  // Inspect existing byCategory presence in /analyticsDaily
  const dailySnap = await getDocs(dailyCol);
  let bucketsWithByCategory = 0;
  let bucketsWithoutByCategory = 0;

  dailySnap.forEach((d) => {
    const data = d.data();
    if (data.byCategory && Object.keys(data.byCategory).length > 0) {
      bucketsWithByCategory++;
    } else {
      bucketsWithoutByCategory++;
    }
  });

  console.log(`Buckets with byCategory already:    ${bucketsWithByCategory}`);
  console.log(`Buckets missing byCategory:         ${bucketsWithoutByCategory}`);

  process.exit(0);
}

runPreflight().catch((err) => {
  console.error('Preflight failed:', err);
  process.exit(1);
});

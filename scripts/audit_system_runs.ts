import { db } from '../src/firebase';
import { collection, getDocs, limit, query, orderBy } from 'firebase/firestore';

async function checkSystemRuns() {
  console.log('=== SYSTEM RUNS AUDIT ===');
  
  try {
    const collectorRunsSnap = await getDocs(query(collection(db, 'system/collectorRuns/runs'), limit(5)));
    console.log(`collectorRuns count (in runs subcol): ${collectorRunsSnap.size}`);
    collectorRunsSnap.forEach(d => console.log('  collectorRun:', d.id, d.data().status, d.data().startedAt));
  } catch (e: any) {
    console.log('collectorRuns error:', e.message);
  }

  try {
    const runsDocSnap = await getDocs(collection(db, 'system'));
    console.log(`system root docs: ${runsDocSnap.size}`);
    runsDocSnap.forEach(d => console.log('  system doc:', d.id));
  } catch (e: any) {
    console.log('system root error:', e.message);
  }

  process.exit(0);
}

checkSystemRuns();

import { db } from '../src/firebase';
import { doc, getDoc } from 'firebase/firestore';

async function checkCollectorState() {
  const snap = await getDoc(doc(db, 'system', 'collectorState'));
  if (snap.exists()) {
    console.log('collectorState:', JSON.stringify(snap.data(), null, 2));
  } else {
    console.log('No collectorState doc');
  }
  process.exit(0);
}

checkCollectorState();

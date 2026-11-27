import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { getAuth, signOut } from 'firebase/auth';
import configFile from '../firebase-applet-config.json';

const app = initializeApp(configFile, 'verify-hardened-app');
const db = getFirestore(app, configFile.firestoreDatabaseId);
const auth = getAuth(app);

async function verifyHardenedSecurity() {
  console.log('=================================================================');
  console.log('SIGNALYN PHASE 5S-B1: VERIFYING HARDENED SECURITY RULES');
  console.log('=================================================================\n');

  await signOut(auth).catch(() => {});
  console.log(`Auth state: auth.currentUser = ${auth.currentUser?.uid || 'null (unauthenticated)'}\n`);

  let testPassed = 0;
  let testFailed = 0;

  function assert(title: string, condition: boolean, detail: string) {
    if (condition) {
      console.log(`[PASS] ${title}: ${detail}`);
      testPassed++;
    } else {
      console.error(`[FAIL] ${title}: ${detail}`);
      testFailed++;
    }
  }

  // TEST 1: Unauthenticated write to /test/connection must be DENIED
  try {
    await setDoc(doc(db, 'test', 'write_probe'), { data: 'test' });
    assert('Test 1: Write to /test', false, 'Expected PERMISSION_DENIED but write succeeded!');
  } catch (err: any) {
    assert('Test 1: Write to /test', err?.code === 'permission-denied', `Write correctly rejected with ${err?.code}`);
  }

  // TEST 2: Unauthenticated delete of production source must be DENIED
  try {
    await deleteDoc(doc(db, 'sources', 'source-gsmarena'));
    assert('Test 2: Delete production source', false, 'Expected PERMISSION_DENIED but delete succeeded!');
  } catch (err: any) {
    assert('Test 2: Delete production source', err?.code === 'permission-denied', `Delete correctly rejected with ${err?.code}`);
  }

  // TEST 3: Unauthenticated delete of production company must be DENIED
  try {
    await deleteDoc(doc(db, 'companies', 'comp-apple'));
    assert('Test 3: Delete production company', false, 'Expected PERMISSION_DENIED but delete succeeded!');
  } catch (err: any) {
    assert('Test 3: Delete production company', err?.code === 'permission-denied', `Delete correctly rejected with ${err?.code}`);
  }

  // TEST 4: Unauthenticated delete of production settings must be DENIED
  try {
    await deleteDoc(doc(db, 'settings', 'intelligence'));
    assert('Test 4: Delete settings', false, 'Expected PERMISSION_DENIED but delete succeeded!');
  } catch (err: any) {
    assert('Test 4: Delete settings', err?.code === 'permission-denied', `Delete correctly rejected with ${err?.code}`);
  }

  // TEST 5: Malformed company write (missing tier) must be DENIED
  try {
    await setDoc(doc(db, 'companies', 'sec_probe_bad_co'), {
      id: 'sec_probe_bad_co',
      name: 'Bad Co',
      // missing 'tier'
    });
    assert('Test 5: Malformed company write', false, 'Expected PERMISSION_DENIED but write succeeded!');
  } catch (err: any) {
    assert('Test 5: Malformed company write', err?.code === 'permission-denied', `Write correctly rejected with ${err?.code}`);
  }

  // TEST 6: Cleanup of probe article /articles/sec_probe_valid_art must SUCCEED via isProbeId
  try {
    await deleteDoc(doc(db, 'articles', 'sec_probe_valid_art'));
    assert('Test 6: Probe article cleanup', true, 'Successfully deleted sec_probe_valid_art');
  } catch (err: any) {
    assert('Test 6: Probe article cleanup', false, `Failed to delete probe article: ${err?.code}`);
  }

  // TEST 7: Production article deletion must be DENIED
  try {
    await deleteDoc(doc(db, 'articles', 'art-gsmarena-sample'));
    assert('Test 7: Production article deletion', false, 'Expected PERMISSION_DENIED but delete succeeded!');
  } catch (err: any) {
    assert('Test 7: Production article deletion', err?.code === 'permission-denied', `Delete correctly rejected with ${err?.code}`);
  }

  // TEST 8: Read access across intelligence collections remains ACTIVE and OPERATIONAL
  try {
    const snap = await getDoc(doc(db, 'settings', 'intelligence'));
    assert('Test 8: Read settings', snap.exists(), `Successfully read settings/intelligence (exists=${snap.exists()})`);
  } catch (err: any) {
    assert('Test 8: Read settings', false, `Read failed: ${err?.code}`);
  }

  console.log('\n=================================================================');
  console.log(`VERIFICATION SUMMARY: ${testPassed} PASSED, ${testFailed} FAILED`);
  console.log('=================================================================');

  if (testFailed > 0) {
    process.exit(1);
  }
}

verifyHardenedSecurity()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });

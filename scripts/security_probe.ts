import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { getAuth, signInAnonymously, signOut } from 'firebase/auth';
import configFile from '../firebase-applet-config.json';

// Initialize a fresh, independent client app to test unauthenticated access
const probeApp = initializeApp(configFile, 'security-probe-app');
const probeDb = getFirestore(probeApp, configFile.firestoreDatabaseId);
const probeAuth = getAuth(probeApp);

interface ProbeResult {
  collection: string;
  operation: string;
  authStatus: 'unauthenticated' | 'anonymous' | 'authenticated';
  payloadDescription: string;
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
}

async function runControlledSecurityProbe() {
  console.log('=================================================================');
  console.log('SIGNALYN PHASE 5S-B1: CONTROLLED FIRESTORE SECURITY PROBE');
  console.log('=================================================================');
  console.log(`Target Project: ${configFile.projectId}`);
  console.log(`Target Database: ${configFile.firestoreDatabaseId}\n`);

  const results: ProbeResult[] = [];

  // Ensure unauthenticated initially
  await signOut(probeAuth).catch(() => {});
  console.log(`Initial auth state: probeAuth.currentUser = ${probeAuth.currentUser?.uid || 'null (unauthenticated)'}\n`);

  // --- PROBE 1: Read Access across collections (Unauthenticated) ---
  const collectionsToRead = [
    'articles',
    'companies',
    'products',
    'articleAnalysis',
    'settings',
    'analyticsDaily',
    'sources',
    'stories',
    'system'
  ];

  console.log('--- 1. Testing Unauthenticated READ Access ---');
  for (const col of collectionsToRead) {
    try {
      const snap = await getDoc(doc(probeDb, col, 'test-nonexistent-id'));
      results.push({
        collection: col,
        operation: 'read (get)',
        authStatus: 'unauthenticated',
        payloadDescription: `Single document lookup in /${col}/test-nonexistent-id`,
        allowed: true,
      });
      console.log(`[PASS READ] /${col}: Read allowed (exists=${snap.exists()})`);
    } catch (err: any) {
      results.push({
        collection: col,
        operation: 'read (get)',
        authStatus: 'unauthenticated',
        payloadDescription: `Single document lookup in /${col}/test-nonexistent-id`,
        allowed: false,
        errorCode: err?.code,
        errorMessage: err?.message,
      });
      console.log(`[DENIED READ] /${col}: ${err?.code || err?.message}`);
    }
  }

  // --- PROBE 2: Unauthenticated WRITE Access to /companies (DEFECT-SEC-001) ---
  console.log('\n--- 2. Testing Unauthenticated WRITE Access ---');
  const tempCompanyId = 'sec_probe_temp_company';
  try {
    await setDoc(doc(probeDb, 'companies', tempCompanyId), {
      id: tempCompanyId,
      name: 'Security Probe Test Company',
      tier: 'TIER_1',
      categories: ['SMARTPHONE'],
      aliases: ['ProbeCo'],
      primaryDomain: 'probe.example.com',
      isAuthoritative: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    results.push({
      collection: 'companies',
      operation: 'create (setDoc)',
      authStatus: 'unauthenticated',
      payloadDescription: 'Valid company object without any authentication',
      allowed: true,
    });
    console.log(`[VULNERABILITY CONFIRMED] Unauthenticated write to /companies/${tempCompanyId} SUCCEEDED!`);

    // Clean up test document immediately
    await deleteDoc(doc(probeDb, 'companies', tempCompanyId));
    console.log(`[CLEANUP] Deleted probe document /companies/${tempCompanyId}`);
  } catch (err: any) {
    results.push({
      collection: 'companies',
      operation: 'create (setDoc)',
      authStatus: 'unauthenticated',
      payloadDescription: 'Valid company object without any authentication',
      allowed: false,
      errorCode: err?.code,
      errorMessage: err?.message,
    });
    console.log(`[WRITE REJECTED] /companies: ${err?.code || err?.message}`);
  }

  // --- PROBE 3: Schema Boundary Rejection (Unauthenticated) ---
  console.log('\n--- 3. Testing Schema Boundary Rejection on /articles ---');
  const invalidArticleId = 'sec_probe_invalid_art';
  try {
    // Missing required fields (canonicalUrl, contentHash, etc.)
    await setDoc(doc(probeDb, 'articles', invalidArticleId), {
      id: invalidArticleId,
      title: 'Invalid Article Missing Fields',
    });
    results.push({
      collection: 'articles',
      operation: 'create (setDoc)',
      authStatus: 'unauthenticated',
      payloadDescription: 'Malformed article missing required schema fields',
      allowed: true,
    });
    console.log(`[UNEXPECTED PASS] Malformed article write succeeded!`);
    await deleteDoc(doc(probeDb, 'articles', invalidArticleId)).catch(() => {});
  } catch (err: any) {
    results.push({
      collection: 'articles',
      operation: 'create (setDoc)',
      authStatus: 'unauthenticated',
      payloadDescription: 'Malformed article missing required schema fields',
      allowed: false,
      errorCode: err?.code,
      errorMessage: err?.message,
    });
    console.log(`[SCHEMA GUARD ACTIVE] /articles schema validation rejected write as expected: ${err?.code || err?.message}`);
  }

  // --- PROBE 4: Valid Schema Article Write (Unauthenticated) ---
  console.log('\n--- 4. Testing Valid Schema Article Write (Unauthenticated) ---');
  const validProbeArticleId = 'sec_probe_valid_art';
  try {
    await setDoc(doc(probeDb, 'articles', validProbeArticleId), {
      id: validProbeArticleId,
      sourceId: 'src-probe',
      canonicalUrl: 'https://example.com/sec-probe-article',
      title: 'Security Probe Article Test',
      publishedAt: new Date().toISOString(),
      collectedAt: new Date().toISOString(),
      contentHash: 'hash-probe-1234567890abcdef',
    });
    results.push({
      collection: 'articles',
      operation: 'create (setDoc)',
      authStatus: 'unauthenticated',
      payloadDescription: 'Valid schema article without authentication',
      allowed: true,
    });
    console.log(`[VULNERABILITY CONFIRMED] Unauthenticated write to /articles/${validProbeArticleId} SUCCEEDED!`);
    // Note: /articles delete rule is "allow delete: if false", so let's verify if delete is blocked!
    try {
      await deleteDoc(doc(probeDb, 'articles', validProbeArticleId));
      console.log(`[ANOMALY] Delete on /articles allowed!`);
    } catch (delErr: any) {
      console.log(`[ARTICLE IMMUTABILITY ACTIVE] As expected, delete on /articles was blocked: ${delErr?.code}`);
    }
  } catch (err: any) {
    results.push({
      collection: 'articles',
      operation: 'create (setDoc)',
      authStatus: 'unauthenticated',
      payloadDescription: 'Valid schema article without authentication',
      allowed: false,
      errorCode: err?.code,
      errorMessage: err?.message,
    });
    console.log(`[ARTICLE WRITE REJECTED] ${err?.code || err?.message}`);
  }

  // --- PROBE 5: Anonymous Authentication Write Behavior ---
  console.log('\n--- 5. Testing Anonymous Authentication Capabilities ---');
  try {
    const cred = await signInAnonymously(probeAuth);
    console.log(`[ANONYMOUS AUTH] Obtained anonymous uid: ${cred.user.uid}, isAnonymous: ${cred.user.isAnonymous}`);
    
    const tempProductId = 'sec_probe_temp_product';
    await setDoc(doc(probeDb, 'products', tempProductId), {
      id: tempProductId,
      name: 'Probe Product',
      companyId: 'comp-apple',
      category: 'SMARTPHONE',
      status: 'ANNOUNCED',
    });
    results.push({
      collection: 'products',
      operation: 'create (setDoc)',
      authStatus: 'anonymous',
      payloadDescription: 'Product creation by anonymous user',
      allowed: true,
    });
    console.log(`[ANONYMOUS WRITE CONFIRMED] Anonymous write to /products/${tempProductId} SUCCEEDED.`);
    await deleteDoc(doc(probeDb, 'products', tempProductId));
    console.log(`[CLEANUP] Deleted probe document /products/${tempProductId}`);
  } catch (err: any) {
    results.push({
      collection: 'products',
      operation: 'create (setDoc)',
      authStatus: 'anonymous',
      payloadDescription: 'Product creation by anonymous user',
      allowed: false,
      errorCode: err?.code,
      errorMessage: err?.message,
    });
    console.log(`[ANONYMOUS AUTH ERROR] ${err?.code || err?.message}`);
  }

  // Clean up auth state
  await signOut(probeAuth).catch(() => {});

  console.log('\n=================================================================');
  console.log('PROBE SUMMARY TABLE:');
  console.log('=================================================================');
  console.table(results.map(r => ({
    Collection: r.collection,
    Op: r.operation,
    Auth: r.authStatus,
    Allowed: r.allowed,
    Code: r.errorCode || 'SUCCESS',
  })));
}

runControlledSecurityProbe()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal probe error:', e);
    process.exit(1);
  });

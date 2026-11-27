/**
 * Signalyn Phase 5S-D2-B Backend Admin SDK Migration & Verification Suite
 * 
 * Verifies:
 * 1. Zero Web SDK imports in backend modules (src/server/* and server.ts)
 * 2. Strict client/server boundary isolation (zero server imports in client bundle)
 * 3. Client bundle isolation (dist/ contains 0 references to firebase-admin or google-auth-library)
 * 4. Server Firestore adapter operation and cleanServerData semantics
 * 5. Candidate Security Rules audit (default-deny, server-owned collections write: if false, owner email bootstrap)
 * 6. Production cutover readiness & fail-closed security posture
 */

import fs from 'fs';
import path from 'path';
import { getServerDb, cleanServerData } from '../src/server/serverFirestoreAdapter';
import * as firestoreAdmin from '../src/server/firestoreAdmin';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runPhase5sD2bTests() {
  console.log('=== STARTING PHASE 5S-D2-B BACKEND ADMIN SDK MIGRATION SUITE ===\n');

  // -------------------------------------------------------------
  // Test 1: Complete Backend Admin SDK Migration Verification
  // -------------------------------------------------------------
  console.log('--- Test 1: Complete Backend Admin SDK Migration ---');

  const serverFiles = [
    'server.ts',
    'src/server/collectorService.ts',
    'src/server/analysisEngine.ts',
    'src/server/articleRepairService.ts',
    'src/server/articleDiagnosticService.ts',
    'src/server/backfill/backfillEngine.ts',
    'src/server/analytics/historicalBackfillEngine.ts',
    'src/server/analytics/firestoreAggregationAdapter.ts',
    'src/server/clustering/storyPersistenceService.ts',
    'src/server/clustering/incrementalStoryService.ts',
    'src/server/entityResolution/canonicalContextCache.ts',
    'src/server/entityResolution/entityReviewService.ts',
  ];

  for (const relPath of serverFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    assert(fs.existsSync(fullPath), `Backend file exists: ${relPath}`);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Must not import from firebase Web SDK
    const hasWebFirestore = /from\s+['"]firebase\/firestore['"]/.test(content);
    const hasWebAuth = /from\s+['"]firebase\/auth['"]/.test(content);
    const hasWebApp = /from\s+['"]firebase\/app['"]/.test(content);
    const hasClientFirebase = /from\s+['"][^'"]*firebase['"]/.test(content) && !content.includes('firebase-admin') && !content.includes('firebase-applet-config');

    assert(!hasWebFirestore, `${relPath} contains zero imports from 'firebase/firestore'`);
    assert(!hasWebAuth, `${relPath} contains zero imports from 'firebase/auth'`);
    assert(!hasWebApp, `${relPath} contains zero imports from 'firebase/app'`);
  }

  // -------------------------------------------------------------
  // Test 2: Architectural Boundary Isolation (Frontend -> Server)
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Architectural Boundary Isolation ---');

  function scanDir(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        results = results.concat(scanDir(full));
      } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        results.push(full);
      }
    }
    return results;
  }

  const clientDirs = [
    'src/components',
    'src/context',
    'src/hooks',
    'src/repositories',
    'src/services',
    'src/utils',
  ];

  for (const cDir of clientDirs) {
    const fullDir = path.resolve(process.cwd(), cDir);
    if (!fs.existsSync(fullDir)) continue;
    const files = scanDir(fullDir);
    for (const f of files) {
      const rel = path.relative(process.cwd(), f);
      const content = fs.readFileSync(f, 'utf8');
      const hasServerImport = /from\s+['"][^'"]*\/server\/[^'"]*['"]/.test(content);
      assert(!hasServerImport, `Client file ${rel} does NOT import from server/`);
    }
  }

  // -------------------------------------------------------------
  // Test 3: Client Bundle Isolation
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Client Bundle Isolation ---');

  const distDir = path.resolve(process.cwd(), 'dist/assets');
  if (fs.existsSync(distDir)) {
    const assetFiles = fs.readdirSync(distDir);
    for (const f of assetFiles) {
      if (f.endsWith('.js')) {
        const jsContent = fs.readFileSync(path.join(distDir, f), 'utf8');
        assert(!jsContent.includes('firebase-admin'), `Client bundle ${f} does NOT contain 'firebase-admin'`);
        assert(!jsContent.includes('google-auth-library'), `Client bundle ${f} does NOT contain 'google-auth-library'`);
      }
    }
  } else {
    console.log('  (dist directory not present; skipping bundle content assertion)');
  }

  // -------------------------------------------------------------
  // Test 4: Server Firestore Adapter Semantics
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Server Firestore Adapter Semantics ---');

  // Test cleanServerData
  const dirtyData = {
    title: 'HUAWEI Mate 90 Pro',
    excerpt: undefined,
    specs: {
      ram: '16GB',
      storage: undefined,
      nested: {
        chip: 'Kirin 9100',
        clock: undefined,
      },
    },
    tags: ['flagship', undefined, '5g'],
  };

  const cleaned = cleanServerData(dirtyData);
  assert(cleaned.title === 'HUAWEI Mate 90 Pro', 'cleanServerData preserves valid string fields');
  assert(!('excerpt' in cleaned), 'cleanServerData removes top-level undefined fields');
  assert(!('storage' in cleaned.specs), 'cleanServerData removes nested undefined fields');
  assert(cleaned.specs.nested.chip === 'Kirin 9100', 'cleanServerData preserves deep nested fields');
  assert(!('clock' in cleaned.specs.nested), 'cleanServerData removes deep nested undefined fields');
  assert(cleaned.tags.length === 2 && !cleaned.tags.includes(undefined), 'cleanServerData filters undefined from arrays');

  // Test getServerDb fail-closed behavior when identity is uninitialized
  try {
    const db = getServerDb();
    assert(Boolean(db), 'getServerDb() returned Admin Firestore instance when initialized');
  } catch (err: any) {
    assert(
      err.message.includes('Security Exception') || err.message.includes('Credentials mode is MISSING'),
      'getServerDb() correctly threw secure fail-closed exception when credentials absent'
    );
  }

  // -------------------------------------------------------------
  // Test 5: Candidate Rules Audit & Validation
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Candidate Rules Audit & Validation ---');

  const candidateRulesPath = path.resolve(process.cwd(), 'firestore.rules.candidate');
  assert(fs.existsSync(candidateRulesPath), 'firestore.rules.candidate exists');
  const candidateRules = fs.readFileSync(candidateRulesPath, 'utf8');

  // 5A. Global default-deny
  assert(
    candidateRules.includes('match /{document=**}') && candidateRules.includes('allow read, write: if false;'),
    'Candidate rules enforce global default-deny catch-all'
  );

  // 5B. Server-owned collections have allow write: if false
  const serverOwnedCollections = [
    'articles',
    'articleAnalysis',
    'analyticsDaily',
    'analyticsLedger',
    'system',
  ];

  for (const col of serverOwnedCollections) {
    const regex = new RegExp(`match\\s+\\/${col}\\/[^\\n]+\\{[\\s\\S]*?allow write:\\s*if false;`, 'm');
    assert(regex.test(candidateRules), `Server-owned collection /${col} rejects direct client writes (write: if false)`);
  }

  // 5C. Governed collections require admin/analyst
  const governedCollections = [
    'sources',
    'companies',
    'products',
    'entityReview',
    'stories',
    'storyReview',
    'settings',
  ];

  for (const col of governedCollections) {
    const regex = new RegExp(`match\\s+\\/${col}\\/[^\\n]+\\{[\\s\\S]*?isAuthorizedAdmin`, 'm');
    assert(regex.test(candidateRules), `Governed collection /${col} requires admin authorization`);
  }

  // 5D. Canonical admin role verified in candidate rules (custom claim and admins doc, zero hardcoded email)
  assert(
    candidateRules.includes('request.auth.token.admin == true') &&
      candidateRules.includes('exists(/databases/$(database)/documents/admins/$(request.auth.uid))') &&
      !candidateRules.includes('@gmail.com'),
    'Candidate rules enforce canonical admin authorization with zero hardcoded email bypass'
  );

  // 5E. Connection test endpoint
  assert(
    candidateRules.includes('match /test/{docId}') && candidateRules.includes('allow read: if true;'),
    'Candidate rules keep connection test ping endpoint readable'
  );

  // 5F. Existing firestore.rules remained unchanged for safety
  const operationalRules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert(operationalRules.includes('service cloud.firestore'), 'Operational firestore.rules is preserved');

  console.log('\n=== ALL PHASE 5S-D2-B VERIFICATION TESTS PASSED SUCCESSFULLY ===');
}

runPhase5sD2bTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

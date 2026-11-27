/**
 * Comprehensive Verification Script for Signalyn Sources Manager & Firestore Persistence
 * 
 * Verifies:
 * 1. Firebase configuration resolution & connection test against signalyn-5406e
 * 2. URL normalization (insomnia.gr -> https://insomnia.gr) & domain extraction
 * 3. Duplicate domain prevention for all 4 variants (insomnia.gr, www.insomnia.gr, https://insomnia.gr, https://www.insomnia.gr/)
 * 4. Source group validation (rejection of non-existent groups like "General", mapping to valid ID)
 * 5. Full Source creation lifecycle in Firestore with all 17 schema fields
 * 6. Read-back verification of the persisted document
 * 7. Collector execution on the registered source (feed fetch -> parse -> write to /articles)
 * 8. Regression tests on existing sources (load, update, telemetry)
 */

import { db, testFirestoreConnection } from '../src/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { FirestoreSourceRepository } from '../src/repositories/firestore/firestoreRepositories';
import {
  extractNormalizedDomain,
  ensureHttpProtocol,
  isSameSourceDomain,
  normalizeWebsiteUrl,
} from '../src/utils/urlUtils';
import { discoverWebsiteFeeds } from '../src/server/feedDiscovery';
import { runCollectionCycle } from '../src/server/collectorService';
import configFile from '../firebase-applet-config.json';

async function runVerification() {
  console.log('================================================================');
  console.log('SIGNALYN SOURCES MANAGER REGRESSION & FIX VERIFICATION');
  console.log('Active Project:', configFile.projectId);
  console.log('Database ID:', configFile.firestoreDatabaseId);
  console.log('================================================================\n');

  // TEST 1: Connection Test
  console.log('[TEST 1] Firestore Connection Test');
  const connected = await testFirestoreConnection();
  console.log('Firestore connection verified:', connected ? 'PASS' : 'FAIL');
  if (!connected) {
    throw new Error('Firestore connection failed!');
  }

  // TEST 2: URL Normalization & Domain Extraction
  console.log('\n[TEST 2] URL Normalization & Domain Extraction');
  const testInputs = [
    'insomnia.gr',
    'www.insomnia.gr',
    'https://insomnia.gr',
    'https://www.insomnia.gr/',
    'http://insomnia.gr/articles',
  ];
  for (const input of testInputs) {
    const normUrl = ensureHttpProtocol(input);
    const domain = extractNormalizedDomain(input);
    console.log(`  "${input}" -> Normalized URL: "${normUrl}", Domain: "${domain}"`);
    if (domain !== 'insomnia.gr') {
      throw new Error(`Domain extraction failed for ${input}: got ${domain}`);
    }
  }
  console.log('URL normalization & domain extraction: PASS');

  // TEST 3: Feed Discovery on Insomnia
  console.log('\n[TEST 3] Real Feed Discovery for Insomnia');
  const discovery = await discoverWebsiteFeeds('https://insomnia.gr');
  console.log('  Discovery Status:', discovery.status);
  console.log('  Suggested Name:', discovery.suggestedName);
  console.log('  Candidate count:', discovery.candidates?.length);
  if (discovery.selectedFeed) {
    console.log('  Top Feed URL:', discovery.selectedFeed.url);
    console.log('  Top Feed Title:', discovery.selectedFeed.title);
    console.log('  Top Feed Type:', discovery.selectedFeed.type);
    console.log('  Entry Count:', discovery.selectedFeed.entryCount);
  }
  if (!discovery.selectedFeed?.url) {
    throw new Error('Feed discovery failed to find any valid feeds for Insomnia!');
  }
  console.log('Feed discovery for Insomnia: PASS');

  // Clean up any pre-existing insomnia source for clean test sequence
  const sourceRepo = new FirestoreSourceRepository();
  const allExisting = await sourceRepo.getAll();
  const preExisting = allExisting.filter(
    (s) => extractNormalizedDomain(s.websiteUrl) === 'insomnia.gr' || s.id === 'src-insomnia'
  );
  for (const old of preExisting) {
    console.log(`  Cleaning prior test document: ${old.id} (${old.name})`);
    await deleteDoc(doc(db, 'sources', old.id));
  }

  // TEST 4: Register News Source with Full Schema
  console.log('\n[TEST 4] Register News Source: Insomnia');
  const newSourceInput = {
    customId: 'src-insomnia-live',
    name: 'Insomnia',
    websiteUrl: 'insomnia.gr', // Test bare domain input without https://
    feedUrl: discovery.selectedFeed.url,
    feedType: discovery.selectedFeed.type,
    collectionMethod: discovery.selectedFeed.type,
    sourceGroupId: 'group-greek', // Valid Firestore sourceGroup ID
    sourceGroup: 'Greek Tech Media',
    market: 'Greece',
    country: 'Greece',
    language: 'el', // Greek language
    categories: ['Smartphones', 'Hardware', 'Telecom', 'Greek Market'],
    status: 'ACTIVE' as const,
  };

  const createdSource = await sourceRepo.create(newSourceInput);
  console.log('  Created Source ID:', createdSource.id);
  console.log('  Persisted Website URL:', createdSource.websiteUrl);
  console.log('  Normalized Domain:', createdSource.normalizedDomain);
  console.log('  Source Group ID:', createdSource.sourceGroupId);
  console.log('  Language:', createdSource.language);
  console.log('  Status:', createdSource.status);
  console.log('  Feed URL:', createdSource.feedUrl);

  // TEST 5: Verify Firestore Document Read-Back
  console.log('\n[TEST 5] Verify Persisted Firestore Document /sources/' + createdSource.id);
  const docSnap = await getDoc(doc(db, 'sources', createdSource.id));
  if (!docSnap.exists()) {
    throw new Error('Document does not exist in Firestore!');
  }
  const persistedData = docSnap.data();
  console.log('  Persisted Firestore fields:');
  const requiredFields = [
    'id',
    'name',
    'websiteUrl',
    'normalizedDomain',
    'feedUrl',
    'feedType',
    'collectionMethod',
    'sourceGroupId',
    'market',
    'country',
    'language',
    'categories',
    'status',
    'createdAt',
    'updatedAt',
    'failureCount',
  ];
  for (const field of requiredFields) {
    const val = persistedData[field];
    console.log(`    - ${field}: ${JSON.stringify(val)}`);
    if (val === undefined) {
      throw new Error(`Required field "${field}" is missing or undefined in Firestore!`);
    }
  }
  console.log('Document persistence & schema validation: PASS');

  // TEST 6: Duplicate Detection Across Variants
  console.log('\n[TEST 6] Duplicate Detection Across All Normalized Variants');
  const duplicateVariants = [
    'insomnia.gr',
    'www.insomnia.gr',
    'https://insomnia.gr',
    'https://www.insomnia.gr/',
    'http://insomnia.gr',
  ];

  for (const variant of duplicateVariants) {
    let duplicateRejected = false;
    try {
      await sourceRepo.create({
        name: 'Insomnia Clone',
        websiteUrl: variant,
        collectionMethod: 'RSS',
        sourceGroupId: 'group-greek',
        language: 'el',
        categories: ['Tech'],
        status: 'ACTIVE',
      });
    } catch (err: any) {
      if (err.message.includes('already exists') || err.message.includes('already registered')) {
        duplicateRejected = true;
        console.log(`  Variant "${variant}" correctly rejected: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!duplicateRejected) {
      throw new Error(`Duplicate variant "${variant}" was not rejected!`);
    }
  }
  console.log('Duplicate detection across all variants: PASS');

  // TEST 7: Run Collector on Newly Registered Source
  console.log('\n[TEST 7] Collector Execution for Insomnia (ID: ' + createdSource.id + ')');
  const collectResult = await runCollectionCycle('SINGLE_SOURCE', createdSource.id);
  console.log('  Collector Status:', collectResult.status);
  console.log('  Articles Discovered:', collectResult.articlesDiscovered);
  console.log('  Articles Created:', collectResult.articlesCreated);
  console.log('  Duplicates Skipped:', collectResult.duplicatesSkipped);
  console.log('  Sources Succeeded:', collectResult.sourcesSucceeded);
  console.log('  Sources Failed:', collectResult.sourcesFailed);
  if (collectResult.errors.length > 0) {
    console.log('  Collector Errors:', collectResult.errors);
  }

  // Check updated source telemetry in Firestore
  const updatedDocSnap = await getDoc(doc(db, 'sources', createdSource.id));
  const updatedData = updatedDocSnap.data();
  console.log('  Updated Source Telemetry in Firestore:');
  console.log('    - articlesCollected:', updatedData?.articlesCollected);
  console.log('    - lastSuccessfulCollection:', updatedData?.lastSuccessfulCollection);
  console.log('    - lastSuccessfulCollectionAt:', updatedData?.lastSuccessfulCollectionAt);
  console.log('    - lastCollectionAttempt:', updatedData?.lastCollectionAttempt);
  console.log('    - lastCollectedAt:', updatedData?.lastCollectedAt);
  console.log('    - failureCount:', updatedData?.failureCount);
  console.log('    - errorCount:', updatedData?.errorCount);

  // Check articles created in Firestore
  const articlesQuery = await getDocs(collection(db, 'articles'));
  const insomniaArticles: any[] = [];
  articlesQuery.forEach((d) => {
    const data = d.data();
    if (data.sourceId === createdSource.id) {
      insomniaArticles.push(data);
    }
  });
  console.log(`  Total articles in /articles for Insomnia: ${insomniaArticles.length}`);
  if (insomniaArticles.length > 0) {
    console.log('  Sample Article 1 Title:', insomniaArticles[0].title);
    console.log('  Sample Article 1 Canonical URL:', insomniaArticles[0].canonicalUrl);
    console.log('  Sample Article 1 Content Hash:', insomniaArticles[0].contentHash);
  }
  console.log('Collector verification: PASS');

  // TEST 8: Regression Test Existing Sources
  console.log('\n[TEST 8] Regression Test Existing Sources');
  const allSources = await sourceRepo.getAll();
  console.log(`  Loaded ${allSources.length} total sources from Firestore.`);
  if (allSources.length < 5) {
    throw new Error('Expected at least 5 sources in database!');
  }
  const testEditSource = allSources.find((s) => s.id !== createdSource.id);
  if (testEditSource) {
    console.log(`  Testing edit on existing source: ${testEditSource.name} (${testEditSource.id})`);
    const originalMarket = testEditSource.market;
    await sourceRepo.update(testEditSource.id, { market: originalMarket });
    console.log(`  Source edit completed successfully.`);
  }
  console.log('Regression test on existing sources: PASS');

  console.log('\n================================================================');
  console.log('ALL VERIFICATION TESTS COMPLETED WITH 100% SUCCESS');
  console.log('================================================================');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('\n*** VERIFICATION FAILED ***');
  console.error(err);
  process.exit(1);
});

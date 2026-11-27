import { db } from '../src/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  dismissEntityReviewAsNonStrategic,
  promoteEntityReviewToProduct,
} from '../src/server/entityResolution/entityReviewService';
import {
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
  checkCompanyCollision,
  checkProductCollision,
  evaluateEntityReviewNeed,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
  resolveCompanySafe,
  resolveProductSafe,
} from '../src/services/canonicalEntities';
import {
  calculateCompetitiveAnalytics,
  resolveTrackedCompanyId,
  TRACKED_COMPANIES,
} from '../src/services/competitiveAnalytics';
import { ArticleAnalysis, Company, EntityReview, isProductionStory, Product } from '../src/types';

async function runPhase4C6C() {
  console.log('=== PHASE 4C.6C EXECUTION START ===\n');

  // 1. Validate Target Pending Reviews
  const qualcommRef = await getDoc(doc(db, 'entityReview', 'rev-comp-qualcomm'));
  const iphoneDuoRef = await getDoc(doc(db, 'entityReview', 'rev-prod-smartphone-iphoneduo'));
  const smartBandRef = await getDoc(doc(db, 'entityReview', 'rev-prod-wearable-applesmartband'));
  const ipadMiniRef = await getDoc(doc(db, 'entityReview', 'rev-prod-tablet-ipadmini8'));

  if (!qualcommRef.exists() || !iphoneDuoRef.exists() || !smartBandRef.exists() || !ipadMiniRef.exists()) {
    throw new Error('One or more target pilot reviews do not exist in Firestore!');
  }

  // Action 1: Dismiss Qualcomm as non-strategic
  console.log('--- Action 1: Dismiss Qualcomm as Non-Strategic ---');
  if (qualcommRef.data().status === 'PENDING') {
    const res = await dismissEntityReviewAsNonStrategic(
      'rev-comp-qualcomm',
      'Ecosystem component partner / chipset platform (not a tracked hardware device OEM)'
    );
    console.log('Dismissed Qualcomm:', res.success);
  } else {
    console.log('Qualcomm review already resolved:', qualcommRef.data().status);
  }

  // Action 2: Promote iPhone Duo
  console.log('\n--- Action 2: Promote iPhone Duo to Canonical Product ---');
  if (iphoneDuoRef.data().status === 'PENDING') {
    const res = await promoteEntityReviewToProduct('rev-prod-smartphone-iphoneduo', {
      name: 'iPhone Duo',
      companyId: 'comp-apple',
      category: 'Smartphones',
      lifecycle: 'RUMORED',
      entityLevel: 'PRODUCT_MODEL',
    });
    console.log('Promoted iPhone Duo:', res.success, res.product.id);
  } else {
    console.log('iPhone Duo already resolved:', iphoneDuoRef.data().status);
  }

  // Action 3: Promote Apple Smart Band
  console.log('\n--- Action 3: Promote Apple Smart Band to Canonical Product ---');
  if (smartBandRef.data().status === 'PENDING') {
    const res = await promoteEntityReviewToProduct('rev-prod-wearable-applesmartband', {
      name: 'Apple Smart Band',
      companyId: 'comp-apple',
      category: 'Wearables',
      lifecycle: 'PROTOTYPE',
      entityLevel: 'PRODUCT_MODEL',
    });
    console.log('Promoted Apple Smart Band:', res.success, res.product.id);
  } else {
    console.log('Apple Smart Band already resolved:', smartBandRef.data().status);
  }

  // Action 4: Promote iPad mini 8
  console.log('\n--- Action 4: Promote iPad mini 8 to Canonical Product ---');
  if (ipadMiniRef.data().status === 'PENDING') {
    const res = await promoteEntityReviewToProduct('rev-prod-tablet-ipadmini8', {
      name: 'iPad mini 8',
      companyId: 'comp-apple',
      category: 'Tablets',
      lifecycle: 'RUMORED',
      entityLevel: 'PRODUCT_MODEL',
    });
    console.log('Promoted iPad mini 8:', res.success, res.product.id);
  } else {
    console.log('iPad mini 8 already resolved:', ipadMiniRef.data().status);
  }

  // 2. Fetch Post-Action State
  console.log('\n=== POST-ACTION AUDIT & VERIFICATIONS ===\n');

  const revSnap = await getDocs(collection(db, 'entityReview'));
  const compSnap = await getDocs(collection(db, 'companies'));
  const prodSnap = await getDocs(collection(db, 'products'));
  const anSnap = await getDocs(collection(db, 'articleAnalysis'));
  const storySnap = await getDocs(collection(db, 'stories'));

  const allReviews = revSnap.docs.map((d) => ({ id: d.id, ...d.data() } as EntityReview));
  const firestoreCompanies = compSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Company));
  const firestoreProducts = prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product));
  const allAnalyses = anSnap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as ArticleAnalysis));
  const prodStories = storySnap.docs.filter((d) => isProductionStory({ id: d.id, ...d.data() } as any));

  const statusCounts: Record<string, number> = {};
  for (const r of allReviews) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }

  const mergedCompanies = getMergedCanonicalCompanies(firestoreCompanies);
  const mergedProducts = getMergedCanonicalProducts(firestoreProducts);

  console.log('Post-Action EntityReviews total:', allReviews.length);
  console.log('Post-Action Status counts:', JSON.stringify(statusCounts, null, 2));
  console.log('Post-Action Firestore Companies count:', firestoreCompanies.length);
  console.log('Post-Action Firestore Products count:', firestoreProducts.length);
  console.log('Post-Action Merged Canonical Companies count:', mergedCompanies.length);
  console.log('Post-Action Merged Canonical Products count:', mergedProducts.length);
  console.log('Post-Action Tracked Competitor count (TRACKED_COMPANIES):', TRACKED_COMPANIES.length);
  console.log('Post-Action ArticleAnalysis count:', allAnalyses.length);
  console.log('Post-Action Production Stories count:', prodStories.length);

  // 3. Atomicity Verification
  console.log('\n--- Atomicity Checks ---');
  const checkReviewAndEntity = async (reviewId: string, expectedType: 'COMPANY' | 'PRODUCT' | 'DISMISS') => {
    const rDoc = await getDoc(doc(db, 'entityReview', reviewId));
    const rData = rDoc.data() as EntityReview;
    if (expectedType === 'DISMISS') {
      if (rData.status !== 'DISMISSED_NON_STRATEGIC') throw new Error(`${reviewId} status is not DISMISSED_NON_STRATEGIC`);
      const qualcommDoc = await getDoc(doc(db, 'companies', 'comp-qualcomm'));
      if (qualcommDoc.exists()) throw new Error('Qualcomm company document should NOT exist!');
      console.log(`✓ Atomicity PASS: ${reviewId} dismissed without creating canonical company`);
    } else if (expectedType === 'COMPANY') {
      if (rData.status !== 'PROMOTED_NEW') throw new Error(`${reviewId} status is not PROMOTED_NEW`);
      if (!rData.canonicalId) throw new Error(`${reviewId} missing canonicalId`);
      const cDoc = await getDoc(doc(db, 'companies', rData.canonicalId));
      if (!cDoc.exists()) throw new Error(`Canonical company ${rData.canonicalId} does not exist in Firestore!`);
      console.log(`✓ Atomicity PASS: ${reviewId} promoted atomically with company ${rData.canonicalId}`);
    } else {
      if (rData.status !== 'PROMOTED_NEW') throw new Error(`${reviewId} status is not PROMOTED_NEW`);
      if (!rData.canonicalId) throw new Error(`${reviewId} missing canonicalId`);
      const pDoc = await getDoc(doc(db, 'products', rData.canonicalId));
      if (!pDoc.exists()) throw new Error(`Canonical product ${rData.canonicalId} does not exist in Firestore!`);
      console.log(`✓ Atomicity PASS: ${reviewId} promoted atomically with product ${rData.canonicalId}`);
    }
  };

  await checkReviewAndEntity('rev-comp-nothing', 'COMPANY');
  await checkReviewAndEntity('rev-comp-qualcomm', 'DISMISS');
  await checkReviewAndEntity('rev-prod-smartphone-iphoneduo', 'PRODUCT');
  await checkReviewAndEntity('rev-prod-wearable-fitbitair', 'PRODUCT');
  await checkReviewAndEntity('rev-prod-wearable-applesmartband', 'PRODUCT');
  await checkReviewAndEntity('rev-prod-tablet-ipadmini8', 'PRODUCT');

  // 4. Screen Visibility Verification
  console.log('\n--- Screen Visibility Verification ---');
  const nothingInCompanies = mergedCompanies.some((c) => c.name === 'Nothing' || c.id === 'comp-nothing');
  const iphoneDuoInProducts = mergedProducts.some((p) => p.name === 'iPhone Duo');
  const fitbitAirInProducts = mergedProducts.some((p) => p.name === 'Fitbit Air');
  const appleSmartBandInProducts = mergedProducts.some((p) => p.name === 'Apple Smart Band');
  const ipadMini8InProducts = mergedProducts.some((p) => p.name === 'iPad mini 8');

  console.log('NOTHING_COMPANIES_VISIBLE:', nothingInCompanies ? 'YES' : 'NO');
  console.log('IPHONE_DUO_PRODUCTS_VISIBLE:', iphoneDuoInProducts ? 'YES' : 'NO');
  console.log('FITBIT_AIR_PRODUCTS_VISIBLE:', fitbitAirInProducts ? 'YES' : 'NO');
  console.log('APPLE_SMART_BAND_PRODUCTS_VISIBLE:', appleSmartBandInProducts ? 'YES' : 'NO');
  console.log('IPAD_MINI_8_PRODUCTS_VISIBLE:', ipadMini8InProducts ? 'YES' : 'NO');

  if (!nothingInCompanies || !iphoneDuoInProducts || !fitbitAirInProducts || !appleSmartBandInProducts || !ipadMini8InProducts) {
    throw new Error('Screen visibility check failed!');
  }

  // 5. Runtime Resolver Verification
  console.log('\n--- Runtime Resolver Verification ---');
  const resNothing = resolveCompanySafe('Nothing', mergedCompanies);
  const resIphoneDuo = resolveProductSafe('iPhone Duo', 'SMARTPHONE', mergedProducts);
  const resFitbitAir = resolveProductSafe('Fitbit Air', 'WEARABLE', mergedProducts);
  const resSmartBand = resolveProductSafe('Apple Smart Band', 'WEARABLE', mergedProducts);
  const resIpadMini8 = resolveProductSafe('iPad mini 8', 'TABLET', mergedProducts);
  const resQualcomm = resolveCompanySafe('Qualcomm', mergedCompanies);

  console.log('Nothing ->', resNothing.matchedCompany?.id, '(confidence:', resNothing.confidence, ')');
  console.log('iPhone Duo ->', resIphoneDuo.matchedProduct?.id, '(confidence:', resIphoneDuo.confidence, ')');
  console.log('Fitbit Air ->', resFitbitAir.matchedProduct?.id, '(confidence:', resFitbitAir.confidence, ')');
  console.log('Apple Smart Band ->', resSmartBand.matchedProduct?.id, '(confidence:', resSmartBand.confidence, ')');
  console.log('iPad mini 8 ->', resIpadMini8.matchedProduct?.id, '(confidence:', resIpadMini8.confidence, ')');
  console.log('Qualcomm -> isRecognizedEcosystem:', resQualcomm.isRecognizedEcosystem, 'sector:', resQualcomm.ecosystemSector, 'matchedCompany:', resQualcomm.matchedCompany?.id);

  if (resNothing.matchedCompany?.id !== 'comp-nothing') throw new Error('Nothing failed to resolve to comp-nothing');
  if (resIphoneDuo.matchedProduct?.id !== 'prod-appl-iphoneduo') throw new Error('iPhone Duo failed to resolve');
  if (resFitbitAir.matchedProduct?.id !== 'prod-goog-fitbitair') throw new Error('Fitbit Air failed to resolve');
  if (resSmartBand.matchedProduct?.id !== 'prod-appl-applesmartband') throw new Error('Apple Smart Band failed to resolve');
  if (resIpadMini8.matchedProduct?.id !== 'prod-appl-ipadmini8') throw new Error('iPad mini 8 failed to resolve');
  if (resQualcomm.matchedCompany) throw new Error('Qualcomm should not resolve to a canonical company!');
  if (!resQualcomm.isRecognizedEcosystem) throw new Error('Qualcomm must be recognized as an ecosystem partner!');

  // 6. Future Review Suppression Verification
  console.log('\n--- Future Review Suppression Verification ---');
  const needNothing = evaluateEntityReviewNeed('COMPANY', 'Nothing', undefined, undefined, mergedCompanies, mergedProducts);
  const needIphoneDuo = evaluateEntityReviewNeed('PRODUCT', 'iPhone Duo', 'SMARTPHONE', undefined, mergedCompanies, mergedProducts);
  const needFitbitAir = evaluateEntityReviewNeed('PRODUCT', 'Fitbit Air', 'WEARABLE', undefined, mergedCompanies, mergedProducts);
  const needSmartBand = evaluateEntityReviewNeed('PRODUCT', 'Apple Smart Band', 'WEARABLE', undefined, mergedCompanies, mergedProducts);
  const needIpadMini8 = evaluateEntityReviewNeed('PRODUCT', 'iPad mini 8', 'TABLET', undefined, mergedCompanies, mergedProducts);
  const needQualcomm = evaluateEntityReviewNeed('COMPANY', 'Qualcomm', undefined, undefined, mergedCompanies, mergedProducts);

  console.log('Nothing review needed:', needNothing.shouldCreateReview, '(action:', needNothing.suggestedAction, ')');
  console.log('iPhone Duo review needed:', needIphoneDuo.shouldCreateReview, '(action:', needIphoneDuo.suggestedAction, ')');
  console.log('Fitbit Air review needed:', needFitbitAir.shouldCreateReview, '(action:', needFitbitAir.suggestedAction, ')');
  console.log('Apple Smart Band review needed:', needSmartBand.shouldCreateReview, '(action:', needSmartBand.suggestedAction, ')');
  console.log('iPad mini 8 review needed:', needIpadMini8.shouldCreateReview, '(action:', needIpadMini8.suggestedAction, ')');
  console.log('Qualcomm review needed:', needQualcomm.shouldCreateReview, '(action:', needQualcomm.suggestedAction, ')');

  // 7. Collision Audit
  console.log('\n--- Collision Audit ---');
  // Check duplicate company IDs and names
  const compIdSet = new Set<string>();
  const compNameSet = new Set<string>();
  let compCollisions = 0;
  for (const c of mergedCompanies) {
    if (compIdSet.has(c.id)) compCollisions++;
    compIdSet.add(c.id);
    const norm = c.name.toLowerCase().trim();
    if (compNameSet.has(norm)) compCollisions++;
    compNameSet.add(norm);
  }

  // Check duplicate product IDs and names within company
  const prodIdSet = new Set<string>();
  const prodCompanyKeySet = new Set<string>();
  let prodCollisions = 0;
  for (const p of mergedProducts) {
    if (prodIdSet.has(p.id)) prodCollisions++;
    prodIdSet.add(p.id);
    const key = `${p.companyId}:${p.name.toLowerCase().trim()}`;
    if (prodCompanyKeySet.has(key)) prodCollisions++;
    prodCompanyKeySet.add(key);
  }

  console.log('Company collisions count:', compCollisions);
  console.log('Product collisions count:', prodCollisions);
  if (compCollisions > 0 || prodCollisions > 0) throw new Error('Collisions detected in canonical catalogs!');

  // 8. Analytics & SOV Safety
  console.log('\n--- Analytics & SOV Safety ---');
  const trackedIdNothing = resolveTrackedCompanyId({ companyId: 'comp-nothing', canonicalName: 'Nothing' });
  console.log('resolveTrackedCompanyId(Nothing):', trackedIdNothing);
  if (trackedIdNothing !== null) throw new Error('Nothing must NOT resolve as a tracked company ID!');

  const analytics = calculateCompetitiveAnalytics(allAnalyses, [], { timeRange: 'all' });
  const nothingInSov = analytics.companyRows.some((r) => r.companyName === 'Nothing' || r.companyId === 'comp-nothing');
  console.log('NOTHING_IN_TRACKED_SOV:', nothingInSov ? 'YES' : 'NO');
  if (nothingInSov) throw new Error('Nothing must NOT appear in Competitive Share of Voice!');

  console.log('\n=== ALL PHASE 4C.6C CHECKS PASSED ===\n');
  process.exit(0);
}

runPhase4C6C().catch((err) => {
  console.error('Phase 4C.6C Failed:', err);
  process.exit(1);
});

/**
 * Signalyn Frontend Client Entity Review Service
 * 
 * Provides analyst client-side actions for entity resolution:
 * - Linking EntityReview to existing canonical entities
 * - Promoting EntityReview to Company
 * - Promoting EntityReview to Product
 * - Dismissing EntityReview as non-strategic
 * - Rejecting EntityReview
 * 
 * Safe for client-side bundle execution via Web SDK.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Company,
  EntityReview,
  Product,
  ProductLifecycleStatus,
  ProductEntityLevel,
} from '../types';
import { normalizeDeviceCategory } from '../utils/categoryModel';
import { normalizeCatalogCategoryDisplay } from '../utils/dataIntegrityContracts';
import {
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
  checkCompanyCollision,
  checkProductCollision,
  generateCanonicalCompanyId,
  generateCanonicalProductId,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
  normalizeCompanyName,
  normalizeEntityKey,
  validateCanonicalAlias,
} from './canonicalEntities';
import { generateCanonicalReviewId } from '../utils/entityReviewId';

export { generateCanonicalReviewId };

function cleanClientData(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.filter((x) => x !== undefined).map(cleanClientData);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        res[k] = cleanClientData(v);
      }
    }
    return res;
  }
  return obj;
}

export async function linkEntityReviewToExisting(
  reviewId: string,
  params: {
    canonicalId: string;
    canonicalName: string;
    entityType: 'COMPANY' | 'PRODUCT';
    addAlias?: boolean;
  }
): Promise<{ success: boolean; review: EntityReview }> {
  const reviewRef = doc(db, 'entityReview', reviewId);
  const revSnap = await getDoc(reviewRef);
  if (!revSnap.exists()) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const review = revSnap.data() as EntityReview;
  const now = new Date().toISOString();

  if (params.entityType === 'COMPANY') {
    const compDoc = await getDoc(doc(db, 'companies', params.canonicalId));
    const compExists = compDoc.exists() || CANONICAL_COMPANIES_REGISTRY.some((c) => c.id === params.canonicalId);
    if (!compExists) {
      throw new Error(`Target company "${params.canonicalId}" does not exist in canonical registry.`);
    }

    if (params.addAlias && review.detectedName) {
      const aliasValidation = validateCanonicalAlias(review.detectedName);
      if (aliasValidation.valid && compDoc.exists()) {
        const compData = compDoc.data() as Company;
        const currentAliases = compData.aliases || [];
        if (!currentAliases.some((a) => normalizeCompanyName(a) === normalizeCompanyName(review.detectedName))) {
          await updateDoc(doc(db, 'companies', params.canonicalId), {
            aliases: [...currentAliases, review.detectedName],
            updatedAt: now,
          });
        }
      }
    }
  } else {
    const prodDoc = await getDoc(doc(db, 'products', params.canonicalId));
    const prodExists = prodDoc.exists() || CANONICAL_PRODUCTS_REGISTRY.some((p) => p.id === params.canonicalId);
    if (!prodExists) {
      throw new Error(`Target product "${params.canonicalId}" does not exist in canonical registry.`);
    }

    const targetCategory = prodDoc.exists()
      ? (prodDoc.data() as Product).category
      : CANONICAL_PRODUCTS_REGISTRY.find((p) => p.id === params.canonicalId)?.category || 'OTHER';

    if (review.category && review.category !== 'OTHER') {
      const normReviewCat = normalizeDeviceCategory(review.category);
      const normTargetCat = normalizeDeviceCategory(targetCategory);
      if (normReviewCat !== 'OTHER' && normTargetCat !== 'OTHER' && normReviewCat !== normTargetCat) {
        throw new Error(
          `Incompatible categories: review category "${normReviewCat}" cannot link to product in category "${normTargetCat}".`
        );
      }
    }

    if (params.addAlias && review.detectedName) {
      const aliasValidation = validateCanonicalAlias(review.detectedName);
      if (aliasValidation.valid && prodDoc.exists()) {
        const prodData = prodDoc.data() as Product;
        const currentAliases = prodData.aliases || [];
        if (!currentAliases.some((a) => normalizeEntityKey(a) === normalizeEntityKey(review.detectedName))) {
          await updateDoc(doc(db, 'products', params.canonicalId), {
            aliases: [...currentAliases, review.detectedName],
            updatedAt: now,
          });
        }
      }
    }
  }

  const updatedReviewData: Partial<EntityReview> = {
    status: 'RESOLVED_EXISTING',
    canonicalId: params.canonicalId,
    canonicalName: params.canonicalName,
    resolutionType: 'EXISTING',
    resolutionMethod: 'MANUAL_LINK',
    resolvedAt: now,
    reviewedAt: now,
  };

  await updateDoc(reviewRef, cleanClientData(updatedReviewData));

  return {
    success: true,
    review: {
      ...review,
      ...updatedReviewData,
    } as EntityReview,
  };
}

export async function promoteEntityReviewToCompany(
  reviewId: string,
  companyData: {
    name: string;
    aliases?: string[];
    categories?: string[];
    tracked?: boolean;
    website?: string;
  }
): Promise<{ success: boolean; company: Company }> {
  const reviewRef = doc(db, 'entityReview', reviewId);
  const revSnap = await getDoc(reviewRef);
  if (!revSnap.exists()) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const compSnap = await getDocs(collection(db, 'companies'));
  const firestoreCompanies = compSnap.docs.map((d) => d.data() as Company);
  const allCompanies = getMergedCanonicalCompanies(firestoreCompanies);

  const cleanName = companyData.name.trim();
  if (!cleanName) {
    throw new Error('Company name cannot be empty.');
  }

  const rawAliases = companyData.aliases || [];
  const cleanAliases: string[] = [];
  for (const a of rawAliases) {
    const val = validateCanonicalAlias(a);
    if (!val.valid) {
      throw new Error(`Invalid alias "${a}": ${val.reason}`);
    }
    cleanAliases.push(a.trim());
  }

  const collision = checkCompanyCollision(cleanName, cleanAliases, allCompanies);
  if (collision.hasCollision) {
    throw new Error(
      `Cannot promote company "${cleanName}": ${collision.reason} Please link to existing canonical entity instead.`
    );
  }

  const companyId = generateCanonicalCompanyId(cleanName);
  const now = new Date().toISOString();

  const newCompany: Company = {
    id: companyId,
    name: cleanName,
    aliases: cleanAliases,
    website: companyData.website || '',
    isMyCompany: false,
    isCompetitor: companyData.tracked ?? false,
    categories: companyData.categories && companyData.categories.length > 0 ? companyData.categories : ['Smartphones'],
    active: true,
    createdAt: now,
    updatedAt: now,
    provenance: `promoted_from_review_${reviewId}`,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'companies', companyId), cleanClientData(newCompany));
  batch.update(reviewRef, {
    status: 'PROMOTED_NEW',
    canonicalId: companyId,
    canonicalName: cleanName,
    resolutionType: 'PROMOTED_NEW',
    resolutionMethod: 'MANUAL_PROMOTION',
    resolvedAt: now,
    reviewedAt: now,
  });

  await batch.commit();

  return { success: true, company: newCompany };
}

export async function promoteEntityReviewToProduct(
  reviewId: string,
  productData: {
    name: string;
    companyId: string;
    category: string;
    subcategory?: string;
    lifecycle?: ProductLifecycleStatus;
    entityLevel?: ProductEntityLevel;
    aliases?: string[];
  }
): Promise<{ success: boolean; product: Product }> {
  const reviewRef = doc(db, 'entityReview', reviewId);
  const revSnap = await getDoc(reviewRef);
  if (!revSnap.exists()) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const cleanName = productData.name.trim();
  if (!cleanName) {
    throw new Error('Product name cannot be empty.');
  }

  if (!productData.companyId) {
    throw new Error('companyId is required for canonical product promotion.');
  }

  const prodSnap = await getDocs(collection(db, 'products'));
  const firestoreProducts = prodSnap.docs.map((d) => d.data() as Product);
  const allProducts = getMergedCanonicalProducts(firestoreProducts);

  const rawAliases = productData.aliases || [];
  const cleanAliases: string[] = [];
  for (const a of rawAliases) {
    const val = validateCanonicalAlias(a);
    if (!val.valid) {
      throw new Error(`Invalid alias "${a}": ${val.reason}`);
    }
    cleanAliases.push(a.trim());
  }

  const collision = checkProductCollision(
    cleanName,
    productData.category,
    productData.companyId,
    cleanAliases,
    allProducts
  );
  if (collision.hasCollision) {
    throw new Error(
      `Cannot promote product "${cleanName}": ${collision.reason} Please link to existing canonical entity instead.`
    );
  }

  const productId = generateCanonicalProductId(productData.companyId, cleanName);
  const now = new Date().toISOString();

  const newProduct: Product = {
    id: productId,
    companyId: productData.companyId,
    name: cleanName,
    aliases: cleanAliases,
    category: normalizeCatalogCategoryDisplay(productData.category),
    subcategory: productData.subcategory || undefined,
    active: true,
    lifecycle: productData.lifecycle || 'UNKNOWN',
    entityLevel: productData.entityLevel || 'PRODUCT_MODEL',
    createdAt: now,
    updatedAt: now,
    provenance: `promoted_from_review_${reviewId}`,
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'products', productId), cleanClientData(newProduct));
  batch.update(reviewRef, {
    status: 'PROMOTED_NEW',
    canonicalId: productId,
    canonicalName: cleanName,
    resolutionType: 'PROMOTED_NEW',
    resolutionMethod: 'MANUAL_PROMOTION',
    resolvedAt: now,
    reviewedAt: now,
  });

  await batch.commit();

  return { success: true, product: newProduct };
}

export async function dismissEntityReviewAsNonStrategic(
  reviewId: string,
  reason?: string
): Promise<{ success: boolean }> {
  const reviewRef = doc(db, 'entityReview', reviewId);
  const revSnap = await getDoc(reviewRef);
  if (!revSnap.exists()) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const now = new Date().toISOString();
  await updateDoc(reviewRef, {
    status: 'DISMISSED_NON_STRATEGIC',
    resolutionType: 'NON_STRATEGIC',
    resolutionMethod: 'DISMISS',
    nonStrategicReason: reason || 'Concept deemed out of competitive scope',
    resolvedAt: now,
    reviewedAt: now,
  });

  return { success: true };
}

export async function rejectEntityReview(
  reviewId: string,
  reason?: string
): Promise<{ success: boolean }> {
  const reviewRef = doc(db, 'entityReview', reviewId);
  const revSnap = await getDoc(reviewRef);
  if (!revSnap.exists()) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const now = new Date().toISOString();
  await updateDoc(reviewRef, {
    status: 'REJECTED',
    resolutionType: 'REJECTED',
    resolutionMethod: 'REJECT',
    rejectionReason: reason || 'Entity extraction determined invalid or hallucinated',
    resolvedAt: now,
    reviewedAt: now,
  });

  return { success: true };
}

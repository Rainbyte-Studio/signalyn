/**
 * Signalyn Server-Side Entity Review & Resolution Service (Phase 4B.3 / Phase 5S-D2-B)
 * 
 * Provides:
 * 1. Deterministic, category-aware review IDs to eliminate duplicate review creation.
 * 2. Multi-article evidence tracking (articleIds, articleTitles, occurrences).
 * 3. Safe alias & corporate normalization.
 * 4. Existing EntityReview consolidation and repair backed by Firebase Admin SDK.
 */

import { getServerDb, cleanServerData } from '../serverFirestoreAdapter';
import {
  Company,
  EntityReview,
  Product,
  ReviewStatus,
  ProductLifecycleStatus,
  ProductEntityLevel,
} from '../../types';
import { normalizeDeviceCategory } from '../../utils/categoryModel';
import {
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
  checkCompanyCollision,
  checkProductCollision,
  CompanyResolutionResult,
  generateCanonicalCompanyId,
  generateCanonicalProductId,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
  isGenericProductToken,
  normalizeCompanyName,
  normalizeEntityKey,
  ProductResolutionResult,
  resolveCompanySafe as resolveCompanyCanonical,
  resolveProductSafe as resolveProductCanonical,
  validateCanonicalAlias,
} from '../../services/canonicalEntities';
import { invalidateCanonicalContextCache } from './canonicalContextCache';
import { generateCanonicalReviewId } from '../../utils/entityReviewId';

export { normalizeCompanyName, normalizeEntityKey, generateCanonicalReviewId };

/**
 * Records or updates an unresolved EntityReview deterministically in Firestore using Admin SDK.
 * Ensures duplicateReviewRate = 0 by aggregating occurrences into the canonical document.
 */
export async function recordEntityReview(params: {
  entityType: 'COMPANY' | 'PRODUCT';
  detectedName: string;
  category?: string;
  confidence: number;
  articleId: string;
  articleTitle: string;
  reason?: string;
}): Promise<string> {
  const { reviewId, normalizedKey, canonicalCategory } = generateCanonicalReviewId(
    params.entityType,
    params.detectedName,
    params.category
  );

  const db = getServerDb();
  const now = new Date().toISOString();
  const reviewRef = db.collection('entityReview').doc(reviewId);
  const existingSnap = await reviewRef.get();

  const isExisting = typeof existingSnap.exists === 'function'
    ? (existingSnap as any).exists()
    : Boolean(existingSnap.exists);

  if (!isExisting) {
    // Prevent cross-category duplicate pending/resolved reviews for the same normalized entity
    let crossCatSnap: FirebaseFirestore.QuerySnapshot | null = null;
    try {
      const colRef: any = db.collection('entityReview');
      if (typeof colRef.where === 'function') {
        crossCatSnap = await colRef
          .where('normalizedKey', '==', normalizedKey)
          .get();
      }
    } catch {
      crossCatSnap = null;
    }

    if (crossCatSnap && !crossCatSnap.empty) {
      const matching = crossCatSnap.docs
        .map((d: any) => ({ id: d.id, ref: d.ref, data: d.data() as any }))
        .filter((d: any) => (d.data.type || d.data.entityType) === params.entityType);

      // If already dismissed, rejected, or resolved under another category, do not re-create noise
      const terminalMatch = matching.find((m: any) =>
        ['RESOLVED_EXISTING', 'PROMOTED_NEW', 'APPROVED', 'DISMISSED_NON_STRATEGIC', 'REJECTED'].includes(m.data.status)
      );
      if (terminalMatch) {
        return terminalMatch.id;
      }

      // If already pending under another category (e.g., OTHER/UNKNOWN vs SMARTPHONE), aggregate into it
      const existingPending = matching.find((m: any) => m.data.status === 'PENDING');
      if (existingPending) {
        const existing = existingPending.data;
        const updatedArticleIds = Array.from(
          new Set([...(existing?.articleIds || [existing?.articleId]), params.articleId].filter(Boolean))
        );
        const updatedArticleTitles = Array.from(
          new Set([...(existing?.articleTitles || [existing?.articleTitle]), params.articleTitle].filter(Boolean))
        );
        const preferredCategory =
          params.entityType === 'PRODUCT' &&
          (!existing.category || existing.category === 'OTHER' || existing.category === 'UNKNOWN') &&
          canonicalCategory !== 'OTHER'
            ? canonicalCategory
            : existing.category;

        await existingPending.ref.update(
          cleanServerData({
            occurrences: (existing?.occurrences || 1) + 1,
            articleIds: updatedArticleIds,
            articleTitles: updatedArticleTitles,
            category: preferredCategory,
            lastSeenAt: now,
            confidence: Math.max(existing?.confidence || 0, params.confidence),
          })
        );
        return existingPending.id;
      }
    }

    // Create new canonical review document
    const newReview: any = {
      id: reviewId,
      type: params.entityType,
      entityType: params.entityType,
      detectedName: params.detectedName,
      rawText: params.detectedName,
      normalizedKey,
      category: params.entityType === 'PRODUCT' ? canonicalCategory : 'OTHER',
      reason: params.reason || `UNRESOLVED_${params.entityType}`,
      confidence: params.confidence,
      status: 'PENDING' as ReviewStatus,
      occurrences: 1,
      articleId: params.articleId,
      articleTitle: params.articleTitle,
      articleIds: [params.articleId],
      articleTitles: [params.articleTitle],
      createdAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    if (params.entityType === 'COMPANY') {
      newReview.suggestedCompany = params.detectedName;
    } else {
      newReview.suggestedProduct = params.detectedName;
    }

    await reviewRef.set(cleanServerData(newReview));
  } else {
    // Update existing canonical review with new citation
    const existing = existingSnap.data() as any;
    const updatedArticleIds = Array.from(new Set([...(existing?.articleIds || [existing?.articleId]), params.articleId]));
    const updatedArticleTitles = Array.from(new Set([...(existing?.articleTitles || [existing?.articleTitle]), params.articleTitle]));
    const occurrences = (existing?.occurrences || 1) + 1;

    await reviewRef.update(cleanServerData({
      occurrences,
      articleIds: updatedArticleIds,
      articleTitles: updatedArticleTitles,
      lastSeenAt: now,
      confidence: Math.max(existing?.confidence || 0, params.confidence),
    }));
  }

  return reviewId;
}

/**
 * Resolves a company name against canonical registered companies & aliases.
 */
export function resolveCompanySafe(
  detectedName: string,
  canonicalCompanies?: Company[]
): CompanyResolutionResult {
  return resolveCompanyCanonical(detectedName, canonicalCompanies);
}

/**
 * Resolves a product name against canonical registered products & aliases.
 */
export function resolveProductSafe(
  detectedName: string,
  detectedCategory: string = 'OTHER',
  canonicalProducts?: Product[]
): ProductResolutionResult {
  return resolveProductCanonical(detectedName, detectedCategory, canonicalProducts);
}

/**
 * Migrates and consolidates existing fragmented EntityReview documents
 * into canonical deduplicated records.
 */
export async function repairAndConsolidateEntityReviews(): Promise<{
  beforeCount: number;
  consolidatedCount: number;
  duplicatesRemoved: number;
}> {
  const db = getServerDb();
  const reviewsSnap = await db.collection('entityReview').get();
  const allReviews = reviewsSnap.docs.map((d) => ({ docId: d.id, ...d.data() } as any));
  const beforeCount = allReviews.length;

  const canonicalGroups = new Map<string, any[]>();
  for (const r of allReviews) {
    const type = r.type || r.entityType || 'COMPANY';
    const name = r.detectedName || r.suggestedProduct || r.suggestedCompany || r.rawText || r.docId;
    const cat = r.category || 'OTHER';
    const { reviewId } = generateCanonicalReviewId(type, name, cat);

    if (!canonicalGroups.has(reviewId)) {
      canonicalGroups.set(reviewId, []);
    }
    canonicalGroups.get(reviewId)!.push(r);
  }

  let duplicatesRemoved = 0;

  for (const [canonicalId, group] of canonicalGroups.entries()) {
    const first = group[0];
    const type = first.type || first.entityType || 'COMPANY';
    const name = first.detectedName || first.suggestedProduct || first.suggestedCompany || first.rawText;
    const cat = first.category || 'OTHER';
    const { normalizedKey, canonicalCategory } = generateCanonicalReviewId(type, name, cat);

    const allArticleIds = Array.from(
      new Set(group.flatMap((g) => g.articleIds || (g.articleId ? [g.articleId] : [])))
    );
    const allArticleTitles = Array.from(
      new Set(group.flatMap((g) => g.articleTitles || (g.articleTitle ? [g.articleTitle] : [])))
    );

    const earliestCreatedAt = group
      .map((g) => g.createdAt || g.firstSeenAt)
      .filter(Boolean)
      .sort()[0] || new Date().toISOString();

    const latestSeenAt = group
      .map((g) => g.lastSeenAt || g.createdAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] || earliestCreatedAt;

    const maxConfidence = Math.max(...group.map((g) => g.confidence || 0.8));
    const status = group.some((g) => g.status === 'APPROVED')
      ? 'APPROVED'
      : group.some((g) => g.status === 'REJECTED')
      ? 'REJECTED'
      : 'PENDING';

    const consolidatedDoc: any = {
      id: canonicalId,
      type,
      entityType: type,
      detectedName: name,
      rawText: name,
      normalizedKey,
      category: type === 'PRODUCT' ? canonicalCategory : 'OTHER',
      reason: first.reason || `UNRESOLVED_${type}`,
      confidence: maxConfidence,
      status,
      occurrences: group.reduce((sum, g) => sum + (g.occurrences || 1), 0),
      articleId: allArticleIds[0] || first.articleId || 'unknown',
      articleTitle: allArticleTitles[0] || first.articleTitle || '',
      articleIds: allArticleIds,
      articleTitles: allArticleTitles,
      createdAt: earliestCreatedAt,
      firstSeenAt: earliestCreatedAt,
      lastSeenAt: latestSeenAt,
    };

    if (type === 'COMPANY') {
      consolidatedDoc.suggestedCompany = name;
    } else {
      consolidatedDoc.suggestedProduct = name;
    }

    await db.collection('entityReview').doc(canonicalId).set(cleanServerData(consolidatedDoc));

    for (const item of group) {
      if (item.docId !== canonicalId) {
        await db.collection('entityReview').doc(item.docId).delete();
        duplicatesRemoved++;
      }
    }
  }

  return {
    beforeCount,
    consolidatedCount: canonicalGroups.size,
    duplicatesRemoved,
  };
}

/**
 * Links an EntityReview to an existing canonical Company or Product (Server Admin SDK).
 */
export async function linkEntityReviewToExisting(
  reviewId: string,
  params: {
    canonicalId: string;
    canonicalName: string;
    entityType: 'COMPANY' | 'PRODUCT';
    addAlias?: boolean;
  }
): Promise<{ success: boolean; review: EntityReview }> {
  const db = getServerDb();
  const reviewRef = db.collection('entityReview').doc(reviewId);
  const revSnap = await reviewRef.get();
  const isRevExists = typeof revSnap.exists === 'function' ? (revSnap as any).exists() : Boolean(revSnap.exists);
  if (!isRevExists) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const review = revSnap.data() as EntityReview;
  const now = new Date().toISOString();

  if (params.entityType === 'COMPANY') {
    const compDoc = await db.collection('companies').doc(params.canonicalId).get();
    const isCompExists = (typeof compDoc.exists === 'function' ? (compDoc as any).exists() : Boolean(compDoc.exists)) ||
      CANONICAL_COMPANIES_REGISTRY.some((c) => c.id === params.canonicalId);
    if (!isCompExists) {
      throw new Error(`Target company "${params.canonicalId}" does not exist in canonical registry.`);
    }

    if (params.addAlias && review.detectedName) {
      const aliasValidation = validateCanonicalAlias(review.detectedName);
      if (aliasValidation.valid && compDoc.exists) {
        const compData = compDoc.data() as Company;
        const currentAliases = compData.aliases || [];
        if (!currentAliases.some((a) => normalizeCompanyName(a) === normalizeCompanyName(review.detectedName))) {
          await db.collection('companies').doc(params.canonicalId).update(cleanServerData({
            aliases: [...currentAliases, review.detectedName],
            updatedAt: now,
          }));
        }
      }
    }
  } else {
    const prodDoc = await db.collection('products').doc(params.canonicalId).get();
    const isProdExists = (typeof prodDoc.exists === 'function' ? (prodDoc as any).exists() : Boolean(prodDoc.exists)) ||
      CANONICAL_PRODUCTS_REGISTRY.some((p) => p.id === params.canonicalId);
    if (!isProdExists) {
      throw new Error(`Target product "${params.canonicalId}" does not exist in canonical registry.`);
    }

    const targetCategory = prodDoc.exists
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
      if (aliasValidation.valid && prodDoc.exists) {
        const prodData = prodDoc.data() as Product;
        const currentAliases = prodData.aliases || [];
        if (!currentAliases.some((a) => normalizeEntityKey(a) === normalizeEntityKey(review.detectedName))) {
          await db.collection('products').doc(params.canonicalId).update(cleanServerData({
            aliases: [...currentAliases, review.detectedName],
            updatedAt: now,
          }));
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

  await reviewRef.update(cleanServerData(updatedReviewData));

  return {
    success: true,
    review: {
      ...review,
      ...updatedReviewData,
    } as EntityReview,
  };
}

/**
 * Promotes an unresolved COMPANY EntityReview into a first-class canonical Company (Server Admin SDK).
 */
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
  const db = getServerDb();
  const reviewRef = db.collection('entityReview').doc(reviewId);
  const revSnap = await reviewRef.get();
  const isRevExists = typeof revSnap.exists === 'function' ? (revSnap as any).exists() : Boolean(revSnap.exists);
  if (!isRevExists) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const compSnap = await db.collection('companies').get();
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

  const batch = db.batch();
  batch.set(db.collection('companies').doc(companyId), cleanServerData(newCompany));
  batch.update(reviewRef, cleanServerData({
    status: 'PROMOTED_NEW',
    canonicalId: companyId,
    canonicalName: cleanName,
    resolutionType: 'PROMOTED_NEW',
    resolutionMethod: 'MANUAL_PROMOTION',
    resolvedAt: now,
    reviewedAt: now,
  }));

  await batch.commit();
  invalidateCanonicalContextCache();

  return { success: true, company: newCompany };
}

/**
 * Promotes an unresolved PRODUCT EntityReview into a first-class canonical Product (Server Admin SDK).
 */
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
  const db = getServerDb();
  const reviewRef = db.collection('entityReview').doc(reviewId);
  const revSnap = await reviewRef.get();
  const isRevExists = typeof revSnap.exists === 'function' ? (revSnap as any).exists() : Boolean(revSnap.exists);
  if (!isRevExists) {
    throw new Error(`EntityReview "${reviewId}" does not exist.`);
  }

  const cleanName = productData.name.trim();
  if (!cleanName) {
    throw new Error('Product name cannot be empty.');
  }

  if (!productData.companyId) {
    throw new Error('companyId is required for canonical product promotion.');
  }

  const prodSnap = await db.collection('products').get();
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
    category: productData.category,
    subcategory: productData.subcategory || undefined,
    active: true,
    lifecycle: productData.lifecycle || 'UNKNOWN',
    entityLevel: productData.entityLevel || 'PRODUCT_MODEL',
    createdAt: now,
    updatedAt: now,
    provenance: `promoted_from_review_${reviewId}`,
  };

  const batch = db.batch();
  batch.set(db.collection('products').doc(productId), cleanServerData(newProduct));
  batch.update(reviewRef, cleanServerData({
    status: 'PROMOTED_NEW',
    canonicalId: productId,
    canonicalName: cleanName,
    resolutionType: 'PROMOTED_NEW',
    resolutionMethod: 'MANUAL_PROMOTION',
    resolvedAt: now,
    reviewedAt: now,
  }));

  await batch.commit();
  invalidateCanonicalContextCache();

  return { success: true, product: newProduct };
}

/**
 * Dismisses an EntityReview as a non-strategic hardware concept (Server Admin SDK).
 */
export async function dismissEntityReviewAsNonStrategic(
  reviewId: string,
  reason?: string
): Promise<{ success: boolean }> {
  const db = getServerDb();
  const reviewRef = db.collection('entityReview').doc(reviewId);
  const now = new Date().toISOString();

  await reviewRef.update(cleanServerData({
    status: 'DISMISSED_NON_STRATEGIC',
    resolutionType: 'NON_STRATEGIC',
    resolutionMethod: 'DISMISS',
    nonStrategicReason: reason || 'NON_STRATEGIC_CONCEPT',
    resolvedAt: now,
    reviewedAt: now,
  }));

  return { success: true };
}

/**
 * Rejects an EntityReview (Server Admin SDK).
 */
export async function rejectEntityReview(
  reviewId: string,
  reason?: string
): Promise<{ success: boolean }> {
  const db = getServerDb();
  const reviewRef = db.collection('entityReview').doc(reviewId);
  const now = new Date().toISOString();

  await reviewRef.update(cleanServerData({
    status: 'REJECTED',
    resolutionType: 'REJECTED',
    nonStrategicReason: reason || 'INVALID_EXTRACTION',
    resolvedAt: now,
    reviewedAt: now,
  }));

  return { success: true };
}

/**
 * Batch-links multiple explicitly selected EntityReviews to one canonical entity (Server Admin SDK).
 * Requires explicit reviewIds and explicit confirmation; never auto-approves uncertain items.
 */
export async function batchLinkEntityReviews(
  reviewIds: string[],
  params: {
    canonicalId: string;
    canonicalName: string;
    entityType: 'COMPANY' | 'PRODUCT';
    addAlias?: boolean;
    confirmed: boolean;
  }
): Promise<{ success: boolean; linkedIds: string[]; skippedIds: Array<{ id: string; reason: string }> }> {
  if (!params.confirmed) {
    throw new Error('Explicit administrator confirmation is required for batch linking.');
  }
  const uniqueIds = Array.from(new Set(reviewIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    throw new Error('At least one review ID must be selected.');
  }

  const linkedIds: string[] = [];
  const skippedIds: Array<{ id: string; reason: string }> = [];

  for (const id of uniqueIds) {
    try {
      await linkEntityReviewToExisting(id, {
        canonicalId: params.canonicalId,
        canonicalName: params.canonicalName,
        entityType: params.entityType,
        addAlias: params.addAlias,
      });
      linkedIds.push(id);
    } catch (err: unknown) {
      skippedIds.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { success: true, linkedIds, skippedIds };
}

/**
 * Batch-dismisses multiple explicitly selected EntityReviews as non-strategic (Server Admin SDK).
 */
export async function batchDismissEntityReviews(
  reviewIds: string[],
  params: { reason?: string; confirmed: boolean }
): Promise<{ success: boolean; dismissedIds: string[] }> {
  if (!params.confirmed) {
    throw new Error('Explicit administrator confirmation is required for batch dismissal.');
  }
  const uniqueIds = Array.from(new Set(reviewIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    throw new Error('At least one review ID must be selected.');
  }

  const db = getServerDb();
  const now = new Date().toISOString();
  const reason = params.reason || 'NON_STRATEGIC_CONCEPT';
  const dismissedIds: string[] = [];

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    const batch = db.batch();
    for (const id of chunk) {
      batch.update(
        db.collection('entityReview').doc(id),
        cleanServerData({
          status: 'DISMISSED_NON_STRATEGIC',
          resolutionType: 'NON_STRATEGIC',
          resolutionMethod: 'DISMISS',
          nonStrategicReason: reason,
          resolvedAt: now,
          reviewedAt: now,
        })
      );
      dismissedIds.push(id);
    }
    await batch.commit();
  }

  return { success: true, dismissedIds };
}


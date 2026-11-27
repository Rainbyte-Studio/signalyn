/**
 * Signalyn Voice of Customer — Phase 2, 5, 6, 7 & 8 Authoritative Pipeline & Diagnostic Service
 *
 * Responsibilities:
 * 1. Reads authoritative VOC collections (`vocSources`, `vocReports`, `vocIssueClusters`,
 *    `vocCollectionRuns`, `vocProductMatches`) from the named Firestore database
 *    (`ai-studio-signalyn-4ae53645-c201-40dc-b0f8-89d40cdf8d34`).
 * 2. Joins in strict read-only mode with canonical `retailProducts` and `serviceAdvisories`.
 * 3. Never fabricates customer complaints, sentiment scores, or demo trends when Firestore has 0 reports.
 * 4. Exposes a read-only dry-run diagnostic evaluator (`evaluateVocSampleDiagnostic`) that tests
 *    bilingual classification, PII redaction, conservative product matching, and advisory correlation
 *    without writing to production Firestore collections.
 */

import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from 'firebase/app';
import {
  getFirestore as getClientFirestore,
  collection as clientCollection,
  getDocs as clientGetDocs,
  setLogLevel as setClientLogLevel,
} from 'firebase/firestore';
import firebaseAppletConfig from '../../../firebase-applet-config.json' with { type: 'json' };

setClientLogLevel('silent');
import { getServerDb } from '../serverFirestoreAdapter';
import { getMemCatalog, seedPilotCatalog } from '../retail/retailPipelineService';
import { getServiceAdvisories } from '../service/servicePipelineService';
import { RetailProduct } from '../../types/retailPrice';
import { PersistenceStorageMode, ServiceAdvisory } from '../../types/serviceIntelligence';
import {
  VocCollectionRun,
  VocDiagnosticEvaluationRequest,
  VocDiagnosticEvaluationResponse,
  VocIssueCluster,
  VocOverviewPayload,
  VocProductComplaintSummary,
  VocProductMatch,
  VocRelatedAdvisoryLink,
  VocReport,
  VocSource,
} from '../../types/vocIntelligence';
import { getAuthoritativeVocSources, runVocSourceFeasibilityAudit } from './vocSourceRegistry';
import {
  VOC_COMPLAINT_TAXONOMY,
  analyzeVocSentiment,
  classifyVocComplaintCategories,
  computeVocDuplicateMetadata,
  detectVocLanguage,
  getVocComplaintTaxonomy,
  normalizeBilingualText,
  sanitizeVocExcerpt,
} from './vocTaxonomyClassifier';
import { matchVocReportToCanonicalProduct } from './vocProductMatcher';
import {
  VOC_METHODOLOGY_DISCLOSURE,
  buildVocIssueClusters,
  correlateVocWithServiceAdvisories,
} from './vocEmergingIssueDetector';

/**
 * Reads a public-readable Firestore collection via Admin SDK first, then falls back
 * to the read-only client SDK against the named Firestore database.
 */
async function readAuthoritativeCollection<T>(
  colName: string
): Promise<{ docs: T[]; fromFirestore: boolean }> {
  try {
    const db = getServerDb();
    const snap = await db.collection(colName).get();
    const docs: T[] = [];
    snap.forEach((d) => docs.push(d.data() as T));
    return { docs, fromFirestore: true };
  } catch {
    // Fallback to client SDK read (allowed for public read collections in firestore.rules)
  }

  try {
    const app = getClientApps().length === 0 ? initClientApp(firebaseAppletConfig) : getClientApp();
    const clientDb = getClientFirestore(app, firebaseAppletConfig.firestoreDatabaseId);
    const snap = await clientGetDocs(clientCollection(clientDb, colName));
    const docs: T[] = [];
    snap.forEach((d) => docs.push(d.data() as T));
    return { docs, fromFirestore: true };
  } catch {
    return { docs: [], fromFirestore: false };
  }
}

/**
 * Loads canonical retail products in strict read-only mode, prioritizing the
 * authoritative 326-product `retailProducts` collection in Firestore.
 */
export async function getReadOnlyCanonicalProducts(): Promise<RetailProduct[]> {
  const { docs } = await readAuthoritativeCollection<RetailProduct>('retailProducts');
  if (docs.length > 0) {
    return docs;
  }
  await seedPilotCatalog(false, { persistToDisk: false });
  return Array.from(getMemCatalog().values()).map((p) => ({ ...p }));
}

/**
 * Loads official Service Intelligence advisories in strict read-only mode.
 */
export async function getReadOnlyServiceAdvisories(): Promise<ServiceAdvisory[]> {
  try {
    const advisories = await getServiceAdvisories({});
    if (advisories.length > 0) return advisories;
  } catch {
    // fallback to direct collection read
  }
  const { docs } = await readAuthoritativeCollection<ServiceAdvisory>('serviceAdvisories');
  return docs;
}

/**
 * Builds the complete Voice of Customer overview payload for the dashboard.
 * Never fabricates complaints, sentiment scores, or demo trends when persisted reports = 0.
 */
export async function getVocOverview(options?: {
  manufacturer?: string;
  category?: string;
  searchQuery?: string;
}): Promise<VocOverviewPayload> {
  const selectedManufacturer = options?.manufacturer?.trim() || 'Huawei';
  const mfgNorm = normalizeBilingualText(selectedManufacturer);
  const isAllManufacturers = mfgNorm === 'all';

  const [
    sourcesRes,
    reportsRes,
    clustersRes,
    runsRes,
    matchesRes,
    canonicalProducts,
    serviceAdvisories,
  ] = await Promise.all([
    readAuthoritativeCollection<VocSource>('vocSources'),
    readAuthoritativeCollection<VocReport>('vocReports'),
    readAuthoritativeCollection<VocIssueCluster>('vocIssueClusters'),
    readAuthoritativeCollection<VocCollectionRun>('vocCollectionRuns'),
    readAuthoritativeCollection<VocProductMatch>('vocProductMatches'),
    getReadOnlyCanonicalProducts(),
    getReadOnlyServiceAdvisories(),
  ]);

  const storageMode: PersistenceStorageMode =
    reportsRes.fromFirestore || sourcesRes.fromFirestore
      ? 'FIRESTORE_AUTHORITATIVE'
      : 'PREVIEW_IN_MEMORY_ONLY';

  // Merge persisted vocSources with the authoritative Phase 1 feasibility registry
  const authoritativeSources = getAuthoritativeVocSources();
  const persistedSourceMap = new Map(sourcesRes.docs.map((s) => [s.id, s]));
  const mergedSources = authoritativeSources.map((src) => persistedSourceMap.get(src.id) || src);

  // Filter reports by manufacturer if not 'ALL'
  const allPersistedReports = reportsRes.docs;
  const manufacturerReports = isAllManufacturers
    ? allPersistedReports
    : allPersistedReports.filter(
        (r) => normalizeBilingualText(r.manufacturer) === mfgNorm
      );

  // Apply optional category & search filter for explorer list
  let filteredReports = [...manufacturerReports];
  if (options?.category && options.category !== 'ALL') {
    filteredReports = filteredReports.filter(
      (r) =>
        r.primaryCategory === options.category ||
        (Array.isArray(r.categories) && r.categories.includes(options.category as any))
    );
  }
  if (options?.searchQuery && options.searchQuery.trim()) {
    const q = normalizeBilingualText(options.searchQuery.trim());
    filteredReports = filteredReports.filter((r) =>
      normalizeBilingualText(
        `${r.reportedProductName} ${r.canonicalProductName || ''} ${r.evidenceExcerpt} ${r.primaryCategory}`
      ).includes(q)
    );
  }

  // Deduplicate manufacturerReports for accurate KPI counting
  const seenHashes = new Set<string>();
  const uniqueReports: VocReport[] = [];
  let duplicatesSuppressed = 0;

  for (const r of manufacturerReports) {
    const hash = r.duplicateMetadata?.normalizedTextHash || r.id;
    if (r.duplicateMetadata?.isDuplicate || seenHashes.has(hash)) {
      duplicatesSuppressed++;
    } else {
      seenHashes.add(hash);
      uniqueReports.push(r);
    }
  }

  // Build or hydrate issue clusters
  const computedClusters =
    clustersRes.docs.length > 0
      ? clustersRes.docs.filter(
          (c) =>
            isAllManufacturers || normalizeBilingualText(c.manufacturer) === mfgNorm
        )
      : buildVocIssueClusters({
          reports: manufacturerReports,
          advisories: serviceAdvisories,
        });

  // Category breakdown across unique reports
  const taxonomy = getVocComplaintTaxonomy();
  const categoryBreakdown = taxonomy.map((desc) => {
    const count = uniqueReports.filter(
      (r) =>
        r.primaryCategory === desc.id ||
        (Array.isArray(r.categories) && r.categories.includes(desc.id))
    ).length;
    return {
      category: desc.id,
      labelEn: desc.labelEn,
      labelEl: desc.labelEl,
      uniqueReportsCount: count,
      percentageOfReports:
        uniqueReports.length > 0
          ? Number(((count / uniqueReports.length) * 100).toFixed(1))
          : 0,
      isHardwareRelated: desc.isHardwareRelated,
      isSoftwareUpdateRelated: desc.isSoftwareUpdateRelated,
    };
  });

  // Sentiment breakdown across unique reports
  const sentimentBreakdown = {
    negative: uniqueReports.filter((r) => r.sentiment === 'NEGATIVE').length,
    mixed: uniqueReports.filter((r) => r.sentiment === 'MIXED').length,
    neutral: uniqueReports.filter((r) => r.sentiment === 'NEUTRAL').length,
    positive: uniqueReports.filter((r) => r.sentiment === 'POSITIVE').length,
    total: uniqueReports.length,
  };

  // Trend series (only populated when real persisted reports exist)
  const trendBuckets = new Map<string, { uniqueComplaints: number; emergingSpikes: number }>();
  for (const r of uniqueReports) {
    const dateKey = (r.publishedAt || r.collectedAt || '').slice(0, 10);
    if (!dateKey) continue;
    const prev = trendBuckets.get(dateKey) || { uniqueComplaints: 0, emergingSpikes: 0 };
    prev.uniqueComplaints += 1;
    trendBuckets.set(dateKey, prev);
  }
  const trendSeries = Array.from(trendBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, val]) => ({
      date,
      uniqueComplaints: val.uniqueComplaints,
      emergingSpikes: val.emergingSpikes,
    }));

  // Canonical catalog products for the selected manufacturer
  const mfgProducts = isAllManufacturers
    ? canonicalProducts
    : canonicalProducts.filter((p) => normalizeBilingualText(p.brand) === mfgNorm);

  const mfgAdvisories = isAllManufacturers
    ? serviceAdvisories
    : serviceAdvisories.filter(
        (a) =>
          normalizeBilingualText(a.manufacturer) === mfgNorm ||
          a.manufacturer === 'Cross-Vendor'
      );

  // Build product summaries showing canonical catalog coverage + real persisted complaint counts (0 when empty)
  const productSummaries: VocProductComplaintSummary[] = mfgProducts
    .slice(0, 50)
    .map((prod) => {
      const prodReports = uniqueReports.filter((r) => r.canonicalProductId === prod.id);
      const verifiedCount = prodReports.filter(
        (r) => r.productMatchConfidence === 'VERIFIED_MODEL'
      ).length;
      const likelyCount = prodReports.filter(
        (r) => r.productMatchConfidence === 'LIKELY_MODEL'
      ).length;
      const ambiguousCount = prodReports.filter(
        (r) => r.productMatchConfidence === 'AMBIGUOUS_REVIEW'
      ).length;

      const catCounts = new Map<string, number>();
      for (const r of prodReports) {
        catCounts.set(r.primaryCategory, (catCounts.get(r.primaryCategory) || 0) + 1);
      }

      const topCategories = Array.from(catCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([category, count]) => ({ category: category as any, count }));

      const prodNameNorm = normalizeBilingualText(`${prod.modelFamily} ${prod.name}`);
      const relatedAdvCount = mfgAdvisories.filter((adv) => {
        const advText = normalizeBilingualText(
          `${adv.title} ${adv.affectedProductsText || ''} ${(adv.affectedProducts || []).join(' ')}`
        );
        const familyToken = normalizeBilingualText(prod.modelFamily || '')
          .split(/\s+/)
          .slice(0, 2)
          .join(' ');
        return (
          (familyToken.length >= 3 && advText.includes(familyToken)) ||
          (normalizeBilingualText(prod.brand) === 'huawei' &&
            (advText.includes('emui') || advText.includes('harmonyos')))
        );
      }).length;

      return {
        canonicalProductId: prod.id,
        canonicalProductName: prod.name,
        manufacturer: prod.brand,
        category: prod.category,
        verifiedComplaintCount: verifiedCount,
        likelyComplaintCount: likelyCount,
        ambiguousReviewCount: ambiguousCount,
        topCategories,
        dominantSentiment: prodReports.length === 0 ? 'NO_DATA' : prodReports[0].sentiment,
        relatedOfficialAdvisoriesCount: relatedAdvCount,
        advisoryCorrelationStatus:
          prodReports.length === 0
            ? 'CUSTOMER_REPORTED'
            : prodReports[0].advisoryCorrelationStatus,
      };
    });

  // Related official Service Intelligence advisories for the selected manufacturer
  const relatedServiceAdvisories: VocRelatedAdvisoryLink[] = mfgAdvisories
    .slice(0, 20)
    .map((adv) => ({
      advisoryId: adv.id,
      advisoryTitle: adv.title,
      manufacturer: adv.manufacturer,
      advisoryType: adv.advisoryType,
      severity: adv.severity,
      sourceUrl: adv.sourceUrl,
      publishedAt: adv.publishedAt,
      correlationStatus:
        adv.advisoryType === 'REPAIR_PROGRAM' || adv.advisoryType === 'PRODUCT_RECALL'
          ? 'OFFICIALLY_CONFIRMED_ISSUE'
          : 'CORRELATED_WITH_OFFICIAL_ADVISORY',
      correlationReason:
        adv.advisoryType === 'REPAIR_PROGRAM' || adv.advisoryType === 'PRODUCT_RECALL'
          ? `Official ${adv.manufacturer} ${adv.advisoryType} available for cross-referencing against customer hardware reports.`
          : `Official ${adv.manufacturer} ${adv.advisoryType} (${adv.bulletinReference || adv.id}) available for software/firmware update correlation.`,
      sharedProductIds: [],
      sharedCategories:
        adv.advisoryType === 'REPAIR_PROGRAM' || adv.advisoryType === 'PRODUCT_RECALL'
          ? ['REPAIR_WARRANTY_COMPLAINTS', 'DEVICE_RELIABILITY']
          : ['FIRMWARE_UPDATE_PROBLEMS', 'SOFTWARE_BUGS'],
    }));

  const availableManufacturers = [
    'Huawei',
    'Apple',
    'Samsung',
    'Xiaomi',
    'Honor',
    'ALL',
  ];

  const huaweiCanonicalProducts = canonicalProducts.filter(
    (p) => normalizeBilingualText(p.brand) === 'huawei'
  ).length;
  const huaweiOfficialAdvisories = serviceAdvisories.filter(
    (a) => normalizeBilingualText(a.manufacturer) === 'huawei'
  ).length;

  const isEmptyState = allPersistedReports.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    storageMode,
    firestoreCollections: {
      vocSources: sourcesRes.docs.length,
      vocReports: allPersistedReports.length,
      vocIssueClusters: clustersRes.docs.length,
      vocCollectionRuns: runsRes.docs.length,
      vocProductMatches: matchesRes.docs.length,
    },
    catalogContext: {
      totalCanonicalProducts: canonicalProducts.length,
      huaweiCanonicalProducts,
      totalOfficialAdvisories: serviceAdvisories.length,
      huaweiOfficialAdvisories,
    },
    selectedManufacturer,
    availableManufacturers,
    isEmptyState,
    emptyStateReason: isEmptyState
      ? 'Zero customer complaint records (vocReports = 0) are currently persisted in Firestore. Per VOC P1.0 Phase 7 & Phase 8 governance rules, autonomous scraping and daily bulk ingestion are disabled and no synthetic complaints, sentiment scores, or demo trends are fabricated.'
      : '',
    kpis: {
      totalUniqueComplaints: uniqueReports.length,
      totalRawReports: manufacturerReports.length,
      duplicatesSuppressed,
      emergingIssuesCount: computedClusters.filter((c) => c.isEmergingIssue).length,
      verifiedModelMatchesCount: uniqueReports.filter(
        (r) => r.productMatchConfidence === 'VERIFIED_MODEL'
      ).length,
      likelyModelMatchesCount: uniqueReports.filter(
        (r) => r.productMatchConfidence === 'LIKELY_MODEL'
      ).length,
      ambiguousMatchesCount: uniqueReports.filter(
        (r) => r.productMatchConfidence === 'AMBIGUOUS_REVIEW'
      ).length,
      correlatedWithAdvisoryCount: uniqueReports.filter(
        (r) => r.advisoryCorrelationStatus === 'CORRELATED_WITH_OFFICIAL_ADVISORY'
      ).length,
      officiallyConfirmedCount: uniqueReports.filter(
        (r) => r.advisoryCorrelationStatus === 'OFFICIALLY_CONFIRMED_ISSUE'
      ).length,
      verifiedAccessibleSourcesCount: mergedSources.filter(
        (s) => s.feasibilityStatus === 'VERIFIED_ACCESSIBLE'
      ).length,
      restrictedOrAuthSourcesCount: mergedSources.filter(
        (s) =>
          s.feasibilityStatus === 'ACCESSIBLE_WITH_RESTRICTIONS' ||
          s.feasibilityStatus === 'REQUIRES_AUTHORIZATION'
      ).length,
      unsupportedSourcesCount: mergedSources.filter(
        (s) => s.feasibilityStatus === 'NOT_SUPPORTED'
      ).length,
    },
    categoryBreakdown,
    sentimentBreakdown,
    trendSeries,
    sources: mergedSources,
    clusters: computedClusters,
    reports: filteredReports,
    productSummaries,
    relatedServiceAdvisories,
    taxonomy,
    methodology: VOC_METHODOLOGY_DISCLOSURE,
  };
}

/**
 * Evaluates a sample complaint snippet in strict dry-run mode (`persistedToFirestore: false`)
 * to verify bilingual taxonomy classification, PII redaction, conservative canonical product matching,
 * and Service Intelligence correlation without mutating Firestore.
 */
export async function evaluateVocSampleDiagnostic(
  req: VocDiagnosticEvaluationRequest
): Promise<VocDiagnosticEvaluationResponse> {
  const rawText = (req.text || '').trim();
  const sourceId = req.sourceId || 'diagnostic-dry-run';
  const sampleReportId = `diag-${Date.now().toString(36)}`;

  const detectedLanguage = detectVocLanguage(rawText);
  const { sanitizedExcerpt, piiRedacted, redactedItemsCount } = sanitizeVocExcerpt(rawText);
  const classification = classifyVocComplaintCategories(rawText);
  const sentimentResult = analyzeVocSentiment(rawText);
  const duplicateMetadata = computeVocDuplicateMetadata({
    sourceId,
    sourceSpecificId: sampleReportId,
    text: rawText,
  });

  const [canonicalProducts, serviceAdvisories] = await Promise.all([
    getReadOnlyCanonicalProducts(),
    getReadOnlyServiceAdvisories(),
  ]);

  const productMatch = matchVocReportToCanonicalProduct({
    reportId: sampleReportId,
    text: rawText,
    manufacturerHint: req.manufacturerHint,
    canonicalProducts,
  });

  const advisoryCorrelation = correlateVocWithServiceAdvisories({
    manufacturer: productMatch.manufacturer,
    canonicalProductId: productMatch.canonicalProductId,
    canonicalProductName: productMatch.canonicalProductName,
    detectedModelText: productMatch.detectedModelText,
    categories: classification.categories.map((c) => c.category),
    classificationConfidence: classification.overallConfidence,
    productMatchConfidence: productMatch.confidence,
    advisories: serviceAdvisories,
  });

  return {
    evaluatedAt: new Date().toISOString(),
    persistedToFirestore: false,
    detectedLanguage,
    sanitizedExcerpt,
    piiRedacted,
    redactedItemsCount,
    primaryCategory: classification.primaryCategory,
    categories: classification.categories,
    sentiment: sentimentResult.sentiment,
    sentimentScore: sentimentResult.sentimentScore,
    duplicateMetadata,
    productMatch,
    advisoryCorrelation,
  };
}

export { runVocSourceFeasibilityAudit };

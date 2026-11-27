/**
 * Signalyn Voice of Customer — Phase 5 Emerging Issue Detection &
 * Phase 6 Service Intelligence Cross-Referencing Engine
 *
 * Governance Rules:
 * - Deduplicate reports by normalizedTextHash / sourceExternalIdHash before counting cluster volume.
 * - Require transparent minimum sample sizes before flagging an issue as EMERGING_SPIKE.
 * - Online complaint counts do not represent true affected customer counts or hardware defect rates.
 * - Correlation with a Service Intelligence advisory must NEVER automatically imply OFFICIALLY_CONFIRMED_ISSUE.
 */

import { ServiceAdvisory } from '../../types/serviceIntelligence';
import {
  VocAdvisoryCorrelationStatus,
  VocComplaintCategory,
  VocIssueCluster,
  VocIssueTrendStatus,
  VocMethodologyDisclosure,
  VocRelatedAdvisoryLink,
  VocReport,
  VocSentiment,
} from '../../types/vocIntelligence';
import { VOC_COMPLAINT_TAXONOMY, normalizeBilingualText } from './vocTaxonomyClassifier';

export const VOC_ANALYTICS_VERSION = 'VOC-P1.0-emerging-v1';
export const MIN_CLUSTER_UNIQUE_SAMPLE_SIZE = 3;
export const MIN_EMERGING_UNIQUE_REPORTS = 5;
export const EMERGING_VELOCITY_RATIO_THRESHOLD = 2.0;

export const VOC_METHODOLOGY_DISCLOSURE: VocMethodologyDisclosure = {
  version: VOC_ANALYTICS_VERSION,
  minimumClusterSampleSize: MIN_CLUSTER_UNIQUE_SAMPLE_SIZE,
  emergingIssueMinUniqueReports: MIN_EMERGING_UNIQUE_REPORTS,
  emergingVelocityRatioThreshold: EMERGING_VELOCITY_RATIO_THRESHOLD,
  deduplicationPolicy:
    'Reports are deduplicated via SHA-256 normalized token fingerprinting (normalizedTextHash) and upstream source ID hashing (sourceExternalIdHash). Cross-posted or reposted complaints are counted once in cluster uniqueReportCount and tracked separately under duplicateSuppressedCount.',
  piiMinimizationPolicy:
    'All ingested excerpts undergo automated regex sanitization to strip email addresses, phone numbers, social @handles, user profile URLs, and 15-digit IMEI identifiers, and are truncated to <= 280 characters for fair-use attribution.',
  coreDisclaimer:
    'METHODOLOGICAL DISCLAIMER: Online customer complaint counts reflect publicly observable posts across monitored channels and are subject to self-selection bias, source availability, and collection volume. They do NOT represent true affected customer counts, installed-base failure rates, or verified hardware defect rates.',
  correlationVsConfirmationRule:
    'A complaint or cluster sharing a device model or software update window with an official Service Intelligence bulletin is classified as CORRELATED_WITH_OFFICIAL_ADVISORY. It is NEVER elevated to OFFICIALLY_CONFIRMED_ISSUE unless an official manufacturer REPAIR_PROGRAM or PRODUCT_RECALL advisory explicitly confirms the specific hardware/service defect for that exact model.',
  collectionGovernanceLock:
    'VOC P1.0 operates in foundation and feasibility-verification mode. Autonomous scraping, daily background collection, and bulk ingestion are disabled.',
};

/**
 * Maps VOC complaint categories to relevant Service Intelligence advisory types or keywords.
 */
function doesAdvisoryCorrelateWithCategory(
  advisory: ServiceAdvisory,
  categories: VocComplaintCategory[]
): boolean {
  const advText = normalizeBilingualText(
    `${advisory.title} ${advisory.summary} ${advisory.advisoryType}`
  );

  for (const cat of categories) {
    if (cat === 'REPAIR_WARRANTY_COMPLAINTS' || cat === 'DISPLAY_DEFECTS' || cat === 'BATTERY_DRAIN' || cat === 'DEVICE_RELIABILITY') {
      if (
        advisory.advisoryType === 'REPAIR_PROGRAM' ||
        advisory.advisoryType === 'PRODUCT_RECALL' ||
        advisory.advisoryType === 'END_OF_SUPPORT'
      ) {
        return true;
      }
    }
    if (
      cat === 'FIRMWARE_UPDATE_PROBLEMS' ||
      cat === 'SOFTWARE_BUGS' ||
      cat === 'APP_COMPATIBILITY' ||
      cat === 'CONNECTIVITY_PROBLEMS' ||
      cat === 'BLUETOOTH_PROBLEMS' ||
      cat === 'WIFI_ISSUES' ||
      cat === 'PERFORMANCE_DEGRADATION'
    ) {
      if (
        advisory.advisoryType === 'SECURITY_UPDATE' ||
        advisory.advisoryType === 'UPDATE_SCHEDULE' ||
        advText.includes('emui') ||
        advText.includes('harmonyos') ||
        advText.includes('ios') ||
        advText.includes('one ui') ||
        advText.includes('update')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Cross-references a VOC report or cluster with authoritative Service Intelligence advisories (read-only).
 * Enforces strict separation between CUSTOMER_REPORTED, CORRELATED_WITH_OFFICIAL_ADVISORY,
 * OFFICIALLY_CONFIRMED_ISSUE, and UNVERIFIED_CLAIM.
 */
export function correlateVocWithServiceAdvisories(params: {
  manufacturer: string;
  canonicalProductId: string | null;
  canonicalProductName: string | null;
  detectedModelText: string;
  categories: VocComplaintCategory[];
  classificationConfidence: number;
  productMatchConfidence: string;
  advisories: ReadonlyArray<ServiceAdvisory>;
}): {
  status: VocAdvisoryCorrelationStatus;
  explanation: string;
  relatedAdvisories: VocRelatedAdvisoryLink[];
} {
  const {
    manufacturer,
    canonicalProductId,
    canonicalProductName,
    detectedModelText,
    categories,
    classificationConfidence,
    productMatchConfidence,
    advisories,
  } = params;

  if (classificationConfidence < 0.45 || productMatchConfidence === 'UNMATCHED') {
    return {
      status: 'UNVERIFIED_CLAIM',
      explanation:
        'Classified as UNVERIFIED_CLAIM because product model identity is unmatched or complaint classification confidence is below verification threshold.',
      relatedAdvisories: [],
    };
  }

  const mfgNorm = normalizeBilingualText(manufacturer);
  const modelNorm = normalizeBilingualText(canonicalProductName || detectedModelText || '');
  // Extract key model family token (e.g., "pura 70", "mate 60", "watch gt", "iphone 16", "galaxy s24")
  const modelFamilyTokens = modelNorm
    .replace(new RegExp(`^${mfgNorm}\\s+`, 'i'), '')
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');

  const matchedLinks: VocRelatedAdvisoryLink[] = [];

  for (const adv of advisories) {
    const advMfg = normalizeBilingualText(adv.manufacturer);
    if (advMfg !== mfgNorm && adv.manufacturer !== 'Cross-Vendor') {
      continue;
    }

    const advTargetText = normalizeBilingualText(
      `${adv.title} ${adv.affectedProductsText || ''} ${(adv.affectedProducts || []).join(' ')}`
    );

    const matchesModelOrOs =
      (modelFamilyTokens.length >= 3 && advTargetText.includes(modelFamilyTokens)) ||
      (mfgNorm === 'huawei' &&
        (advTargetText.includes('emui') || advTargetText.includes('harmonyos'))) ||
      (mfgNorm === 'apple' &&
        (advTargetText.includes('iphone') ||
          advTargetText.includes('ipad') ||
          advTargetText.includes('macos') ||
          advTargetText.includes('watchos'))) ||
      (mfgNorm === 'samsung' &&
        (advTargetText.includes('galaxy') || advTargetText.includes('smr')));

    if (!matchesModelOrOs) continue;
    if (!doesAdvisoryCorrelateWithCategory(adv, categories)) continue;

    // Determine whether this advisory is an explicit official confirmation (REPAIR_PROGRAM / PRODUCT_RECALL
    // naming the exact model and hardware symptom) vs a correlation with an official security/software bulletin.
    const isExplicitOfficialDefectConfirmation =
      (adv.advisoryType === 'REPAIR_PROGRAM' || adv.advisoryType === 'PRODUCT_RECALL') &&
      modelFamilyTokens.length >= 3 &&
      advTargetText.includes(modelFamilyTokens);

    const linkStatus: VocAdvisoryCorrelationStatus = isExplicitOfficialDefectConfirmation
      ? 'OFFICIALLY_CONFIRMED_ISSUE'
      : 'CORRELATED_WITH_OFFICIAL_ADVISORY';

    matchedLinks.push({
      advisoryId: adv.id,
      advisoryTitle: adv.title,
      manufacturer: adv.manufacturer,
      advisoryType: adv.advisoryType,
      severity: adv.severity,
      sourceUrl: adv.sourceUrl,
      publishedAt: adv.publishedAt,
      correlationStatus: linkStatus,
      correlationReason: isExplicitOfficialDefectConfirmation
        ? `Official ${adv.manufacturer} ${adv.advisoryType} explicitly covers ${canonicalProductName || detectedModelText}.`
        : `Correlated by manufacturer (${adv.manufacturer}) and software/platform lifecycle scope (${adv.advisoryType}). Correlation does not confirm a hardware defect.`,
      sharedProductIds: canonicalProductId ? [canonicalProductId] : [],
      sharedCategories: categories,
    });
  }

  if (matchedLinks.length === 0) {
    return {
      status: 'CUSTOMER_REPORTED',
      explanation:
        'Customer-reported experience with verified model/category signals; no overlapping official Service Intelligence recall or software bulletin requirement confirmed.',
      relatedAdvisories: [],
    };
  }

  const hasOfficialConfirmation = matchedLinks.some(
    (l) => l.correlationStatus === 'OFFICIALLY_CONFIRMED_ISSUE'
  );

  return {
    status: hasOfficialConfirmation
      ? 'OFFICIALLY_CONFIRMED_ISSUE'
      : 'CORRELATED_WITH_OFFICIAL_ADVISORY',
    explanation: hasOfficialConfirmation
      ? 'Matches an official manufacturer repair program or product recall for this model.'
      : `Correlated with ${matchedLinks.length} official Service Intelligence bulletin(s) covering the same manufacturer/OS scope. Per Phase 6 rules, correlation alone does not constitute official defect confirmation.`,
    relatedAdvisories: matchedLinks.slice(0, 5),
  };
}

/**
 * Builds deduplicated issue clusters (`VocIssueCluster[]`) from a set of `VocReport` records
 * and evaluates emerging issue velocity using transparent sample-size and spike thresholds.
 */
export function buildVocIssueClusters(params: {
  reports: ReadonlyArray<VocReport>;
  advisories: ReadonlyArray<ServiceAdvisory>;
  referenceNowIso?: string;
}): VocIssueCluster[] {
  const { reports, advisories } = params;
  if (reports.length === 0) return [];

  const nowMs = params.referenceNowIso ? Date.parse(params.referenceNowIso) : Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const twentyEightDaysMs = 28 * 24 * 60 * 60 * 1000;

  // Group by manufacturer + canonicalProductId (or normalized reportedProductName) + primaryCategory
  const groups = new Map<string, VocReport[]>();

  for (const r of reports) {
    const productKey = r.canonicalProductId || normalizeBilingualText(r.reportedProductName || 'unspecified').replace(/\s+/g, '-');
    const key = `${normalizeBilingualText(r.manufacturer)}__${productKey}__${r.primaryCategory}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  const clusters: VocIssueCluster[] = [];

  for (const [groupKey, groupReports] of groups.entries()) {
    // Deduplicate by normalizedTextHash so reposts do not inflate uniqueReportCount
    const seenHashes = new Set<string>();
    const uniqueReports: VocReport[] = [];
    let duplicateSuppressedCount = 0;

    for (const rep of groupReports) {
      const hash = rep.duplicateMetadata?.normalizedTextHash || rep.id;
      if (rep.duplicateMetadata?.isDuplicate || seenHashes.has(hash)) {
        duplicateSuppressedCount++;
      } else {
        seenHashes.add(hash);
        uniqueReports.push(rep);
      }
    }

    if (uniqueReports.length === 0) continue;

    const exemplar = uniqueReports[0];
    const categoryMeta = VOC_COMPLAINT_TAXONOMY.find((c) => c.id === exemplar.primaryCategory);

    // Secondary categories across unique reports
    const secondarySet = new Set<VocComplaintCategory>();
    for (const u of uniqueReports) {
      for (const c of u.categories) {
        if (c !== exemplar.primaryCategory) secondarySet.add(c);
      }
    }

    const distinctSourceIds = Array.from(new Set(uniqueReports.map((u) => u.sourceId)));

    // Timestamps & 7-day velocity
    const pubDates = uniqueReports
      .map((u) => Date.parse(u.publishedAt))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);

    const firstObservedAt =
      pubDates.length > 0 ? new Date(pubDates[0]).toISOString() : exemplar.collectedAt;
    const lastObservedAt =
      pubDates.length > 0
        ? new Date(pubDates[pubDates.length - 1]).toISOString()
        : exemplar.collectedAt;

    const recent7dCount = pubDates.filter((t) => nowMs - t <= sevenDaysMs).length;
    const prior21dCount = pubDates.filter(
      (t) => nowMs - t > sevenDaysMs && nowMs - t <= twentyEightDaysMs
    ).length;
    const baseline7dAvgCount = Number(Math.max(1, prior21dCount / 3).toFixed(2));
    const velocityRatio = Number((recent7dCount / baseline7dAvgCount).toFixed(2));

    const sampleSizeSufficient = uniqueReports.length >= MIN_CLUSTER_UNIQUE_SAMPLE_SIZE;
    const isEmergingIssue =
      uniqueReports.length >= MIN_EMERGING_UNIQUE_REPORTS &&
      recent7dCount >= MIN_CLUSTER_UNIQUE_SAMPLE_SIZE &&
      velocityRatio >= EMERGING_VELOCITY_RATIO_THRESHOLD;

    const isSoftwareUpdatePattern =
      exemplar.primaryCategory === 'FIRMWARE_UPDATE_PROBLEMS' ||
      secondarySet.has('FIRMWARE_UPDATE_PROBLEMS') ||
      Boolean(categoryMeta?.isSoftwareUpdateRelated);

    let trendStatus: VocIssueTrendStatus = 'LOW_SAMPLE_MONITORING';
    if (isEmergingIssue) {
      trendStatus = 'EMERGING_SPIKE';
    } else if (sampleSizeSufficient && velocityRatio >= 1.25) {
      trendStatus = 'RISING';
    } else if (sampleSizeSufficient) {
      trendStatus = 'STABLE_RECURRING';
    }

    // Sentiment aggregation
    const avgScore = Number(
      (
        uniqueReports.reduce((acc, r) => acc + (r.sentimentScore ?? -0.5), 0) /
        uniqueReports.length
      ).toFixed(2)
    );
    const dominantSentiment: VocSentiment =
      avgScore <= -0.25 ? 'NEGATIVE' : avgScore >= 0.25 ? 'POSITIVE' : 'MIXED';

    // Service Intelligence correlation
    const correlation = correlateVocWithServiceAdvisories({
      manufacturer: exemplar.manufacturer,
      canonicalProductId: exemplar.canonicalProductId,
      canonicalProductName: exemplar.canonicalProductName,
      detectedModelText: exemplar.reportedProductName,
      categories: [exemplar.primaryCategory, ...Array.from(secondarySet)],
      classificationConfidence: exemplar.classificationConfidence,
      productMatchConfidence: exemplar.productMatchConfidence,
      advisories,
    });

    const productDisplay =
      exemplar.canonicalProductName || exemplar.reportedProductName || exemplar.manufacturer;

    clusters.push({
      id: `voc-cluster-${groupKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 120),
      title: `${productDisplay} — ${categoryMeta?.labelEn || exemplar.primaryCategory}`,
      manufacturer: exemplar.manufacturer,
      canonicalProductId: exemplar.canonicalProductId,
      canonicalProductName: exemplar.canonicalProductName,
      productFamily: exemplar.reportedProductName || productDisplay,
      primaryCategory: exemplar.primaryCategory,
      secondaryCategories: Array.from(secondarySet),
      uniqueReportCount: uniqueReports.length,
      totalRawMentionsCount: groupReports.length,
      duplicateSuppressedCount,
      distinctSourceCount: distinctSourceIds.length,
      sourceIds: distinctSourceIds,
      dominantSentiment,
      averageSentimentScore: avgScore,
      firstObservedAt,
      lastObservedAt,
      recent7dCount,
      baseline7dAvgCount,
      velocityRatio,
      isEmergingIssue,
      isSoftwareUpdatePattern,
      trendStatus,
      sampleSizeSufficient,
      minimumSampleThreshold: MIN_CLUSTER_UNIQUE_SAMPLE_SIZE,
      advisoryCorrelationStatus: correlation.status,
      relatedAdvisories: correlation.relatedAdvisories,
      methodologyNote: sampleSizeSufficient
        ? `Meets minimum deduplicated sample threshold (${uniqueReports.length} >= ${MIN_CLUSTER_UNIQUE_SAMPLE_SIZE} unique reports; ${duplicateSuppressedCount} duplicates suppressed).`
        : `Below minimum sample threshold (${uniqueReports.length} < ${MIN_CLUSTER_UNIQUE_SAMPLE_SIZE} unique reports); held in LOW_SAMPLE_MONITORING.`,
      updatedAt: new Date(nowMs).toISOString(),
    });
  }

  clusters.sort((a, b) => {
    if (a.isEmergingIssue !== b.isEmergingIssue) return a.isEmergingIssue ? -1 : 1;
    return b.uniqueReportCount - a.uniqueReportCount;
  });

  return clusters;
}

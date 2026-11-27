import { describe, it, expect } from 'vitest';
import {
  getAuthoritativeVocSources,
  runVocSourceFeasibilityAudit,
} from '../src/server/voc/vocSourceRegistry';
import {
  VOC_COMPLAINT_TAXONOMY,
  MAX_VOC_EXCERPT_LENGTH,
  classifyVocComplaintCategories,
  analyzeVocSentiment,
  detectVocLanguage,
  sanitizeVocExcerpt,
  computeVocDuplicateMetadata,
} from '../src/server/voc/vocTaxonomyClassifier';
import { matchVocReportToCanonicalProduct } from '../src/server/voc/vocProductMatcher';
import {
  MIN_CLUSTER_UNIQUE_SAMPLE_SIZE,
  MIN_EMERGING_UNIQUE_REPORTS,
  VOC_METHODOLOGY_DISCLOSURE,
  buildVocIssueClusters,
  correlateVocWithServiceAdvisories,
} from '../src/server/voc/vocEmergingIssueDetector';
import {
  getVocOverview,
  evaluateVocSampleDiagnostic,
  getReadOnlyCanonicalProducts,
} from '../src/server/voc/vocPipelineService';
import { ServiceAdvisory } from '../src/types/serviceIntelligence';
import { VocReport } from '../src/types/vocIntelligence';

describe('SIGNALYN VOC P1.0 — Voice of Customer Intelligence Foundation', () => {
  describe('Phase 1: Source Feasibility Audit & Governance Registry', () => {
    it('defines all required candidate sources with valid feasibility classifications and P1.0 collection lock', async () => {
      const sources = getAuthoritativeVocSources();
      expect(sources.length).toBeGreaterThanOrEqual(9);

      const allowedStatuses = new Set([
        'VERIFIED_ACCESSIBLE',
        'ACCESSIBLE_WITH_RESTRICTIONS',
        'REQUIRES_AUTHORIZATION',
        'NOT_SUPPORTED',
        'NOT_YET_VERIFIED',
      ]);

      for (const src of sources) {
        expect(allowedStatuses.has(src.feasibilityStatus)).toBe(true);
        // Phase 8 boundary: collection must be disabled in P1.0
        expect(src.collectionEnabledInP1_0).toBe(false);
        expect(src.verificationEvidence.length).toBeGreaterThan(20);
      }

      const byId = new Map(sources.map((s) => [s.id, s]));
      expect(byId.get('voc-src-huawei-community-en')?.feasibilityStatus).toBe(
        'ACCESSIBLE_WITH_RESTRICTIONS'
      );
      expect(byId.get('voc-src-huawei-support-gr')?.feasibilityStatus).toBe(
        'ACCESSIBLE_WITH_RESTRICTIONS'
      );
      expect(byId.get('voc-src-reddit-huawei')?.feasibilityStatus).toBe(
        'REQUIRES_AUTHORIZATION'
      );
      expect(byId.get('voc-src-public-gr-reviews')?.feasibilityStatus).toBe('NOT_SUPPORTED');
      expect(byId.get('voc-src-kotsovolos-gr-reviews')?.feasibilityStatus).toBe('NOT_SUPPORTED');
      expect(byId.get('voc-src-plaisio-gr-reviews')?.feasibilityStatus).toBe('NOT_SUPPORTED');
      expect(byId.get('voc-src-google-play-reviews')?.feasibilityStatus).toBe(
        'REQUIRES_AUTHORIZATION'
      );

      const auditReport = await runVocSourceFeasibilityAudit({ liveProbe: false });
      expect(auditReport.summary.totalSources).toBe(sources.length);
      expect(auditReport.summary.notSupported).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Phase 2 & 3: Complaint Taxonomy, Bilingual Classification & PII Minimization', () => {
    it('includes all 15 mandatory complaint categories with English and Greek metadata', () => {
      const expectedCategories = [
        'BATTERY_DRAIN',
        'OVERHEATING',
        'CHARGING_PROBLEMS',
        'DISPLAY_DEFECTS',
        'CAMERA_ISSUES',
        'CONNECTIVITY_PROBLEMS',
        'BLUETOOTH_PROBLEMS',
        'WIFI_ISSUES',
        'SOFTWARE_BUGS',
        'FIRMWARE_UPDATE_PROBLEMS',
        'PERFORMANCE_DEGRADATION',
        'APP_COMPATIBILITY',
        'DEVICE_RELIABILITY',
        'REPAIR_WARRANTY_COMPLAINTS',
        'CUSTOMER_SUPPORT_EXPERIENCE',
      ];

      expect(VOC_COMPLAINT_TAXONOMY.length).toBe(15);
      const actualIds = VOC_COMPLAINT_TAXONOMY.map((c) => c.id);
      expect(actualIds).toEqual(expectedCategories);

      for (const item of VOC_COMPLAINT_TAXONOMY) {
        expect(item.labelEn.length).toBeGreaterThan(3);
        expect(item.labelEl.length).toBeGreaterThan(3);
        expect(item.keywordsEn.length).toBeGreaterThan(0);
        expect(item.keywordsEl.length).toBeGreaterThan(0);
      }
    });

    it('supports multi-category classification across English and Greek customer complaints', () => {
      const enText =
        'Since the firmware update on my Pura 70 Ultra, battery drain is terrible and the phone is overheating when charging.';
      const enResult = classifyVocComplaintCategories(enText);
      const enCatIds = enResult.categories.map((c) => c.category);

      expect(enCatIds).toContain('FIRMWARE_UPDATE_PROBLEMS');
      expect(enCatIds).toContain('BATTERY_DRAIN');
      expect(enCatIds).toContain('OVERHEATING');
      expect(detectVocLanguage(enText)).toBe('en');

      const elText =
        'Μετά την αναβάθμιση λογισμικού στο MatePad 11.5S αποσυνδέεται το wifi και κρασάρει η εφαρμογή τράπεζας.';
      const elResult = classifyVocComplaintCategories(elText);
      const elCatIds = elResult.categories.map((c) => c.category);

      expect(elCatIds).toContain('FIRMWARE_UPDATE_PROBLEMS');
      expect(elCatIds).toContain('WIFI_ISSUES');
      expect(elCatIds).toContain('APP_COMPATIBILITY');
      expect(['el', 'mixed']).toContain(detectVocLanguage(elText));

      const sentiment = analyzeVocSentiment(elText);
      expect(sentiment.sentiment).toBe('NEGATIVE');
      expect(sentiment.sentimentScore).toBeLessThan(0);
    });

    it('redacts emails, phone numbers, @handles, profile URLs, and IMEI numbers and bounds excerpt length', () => {
      const rawWithPii =
        'My Huawei Watch GT 5 Pro keeps disconnecting from Bluetooth! Reach me at john.doe@gmail.com or +30 6971234567 or @johndoe_gr or https://www.reddit.com/user/johndoe_gr with IMEI 358901234567890. ' +
        'Repeating extra text to exceed two hundred and eighty characters limit so truncation is verified properly in unit tests.';

      const sanitized = sanitizeVocExcerpt(rawWithPii);
      expect(sanitized.piiRedacted).toBe(true);
      expect(sanitized.redactedItemsCount).toBeGreaterThanOrEqual(5);
      expect(sanitized.sanitizedExcerpt).not.toContain('john.doe@gmail.com');
      expect(sanitized.sanitizedExcerpt).not.toContain('6971234567');
      expect(sanitized.sanitizedExcerpt).not.toContain('@johndoe_gr');
      expect(sanitized.sanitizedExcerpt).not.toContain('reddit.com/user/johndoe_gr');
      expect(sanitized.sanitizedExcerpt).not.toContain('358901234567890');
      expect(sanitized.sanitizedExcerpt.length).toBeLessThanOrEqual(MAX_VOC_EXCERPT_LENGTH);
    });

    it('detects duplicate posts via normalized token fingerprinting', () => {
      const first = computeVocDuplicateMetadata({
        sourceId: 'voc-src-github-hms-issues',
        sourceSpecificId: 'issue-101',
        text: 'Huawei Pura 70 Pro battery drain after EMUI 14.2 update is severe!',
      });
      expect(first.isDuplicate).toBe(false);

      const repost = computeVocDuplicateMetadata({
        sourceId: 'voc-src-hn-algolia-api',
        sourceSpecificId: 'comment-999',
        text: 'huawei pura 70 pro battery drain after emui 14.2 update is severe!!!',
        existingReports: [
          {
            id: 'voc-rep-1',
            normalizedTextHash: first.normalizedTextHash,
            sourceExternalIdHash: first.sourceExternalIdHash,
          },
        ],
      });
      expect(repost.isDuplicate).toBe(true);
      expect(repost.duplicateOfReportId).toBe('voc-rep-1');
    });
  });

  describe('Phase 4: Conservative Canonical Product Matching', () => {
    it('rejects manufacturer-only mentions and accurately distinguishes model generations and variants', async () => {
      const canonicalProducts = await getReadOnlyCanonicalProducts();
      const snapshotBefore = JSON.stringify(canonicalProducts.slice(0, 5));

      // 1. Manufacturer-only mention -> UNMATCHED + manufacturerOnlyRejected: true
      const mfgOnly = matchVocReportToCanonicalProduct({
        reportId: 'test-mfg-only',
        text: 'My Huawei phone battery drains very fast and gets hot.',
        manufacturerHint: 'Huawei',
        canonicalProducts,
      });
      expect(mfgOnly.confidence).toBe('UNMATCHED');
      expect(mfgOnly.canonicalProductId).toBeNull();
      expect(mfgOnly.manufacturerOnlyRejected).toBe(true);

      // 2. Exact model + generation + variant ("Huawei Pura 70 Ultra") -> VERIFIED_MODEL
      const verifiedUltra = matchVocReportToCanonicalProduct({
        reportId: 'test-pura-70-ultra',
        text: 'Camera autofocus issue on my Huawei Pura 70 Ultra after update.',
        manufacturerHint: 'Huawei',
        canonicalProducts,
      });
      expect(verifiedUltra.confidence).toBe('VERIFIED_MODEL');
      expect(verifiedUltra.canonicalProductName?.toLowerCase()).toContain('pura 70 ultra');
      expect(verifiedUltra.manufacturerOnlyRejected).toBe(false);

      // 3. Unqualified series mention ("Huawei Watch GT 5") where base Watch GT 5 41mm/46mm and Pro exist -> LIKELY_MODEL
      const likelyWatch = matchVocReportToCanonicalProduct({
        reportId: 'test-watch-gt-5-unqualified',
        text: 'Huawei Watch GT 5 Bluetooth keeps disconnecting after firmware update.',
        manufacturerHint: 'Huawei',
        canonicalProducts,
      });
      expect(likelyWatch.confidence).toBe('LIKELY_MODEL');
      expect(likelyWatch.candidateProductIds.length).toBeGreaterThan(1);

      // 4. Unqualified series mention ("Huawei Pura 70") where only Pro & Ultra exist in catalog -> AMBIGUOUS_REVIEW
      const ambiguousPura = matchVocReportToCanonicalProduct({
        reportId: 'test-pura-70-unqualified',
        text: 'Huawei Pura 70 battery drain after software update.',
        manufacturerHint: 'Huawei',
        canonicalProducts,
      });
      expect(ambiguousPura.confidence).toBe('AMBIGUOUS_REVIEW');
      expect(ambiguousPura.candidateProductIds.length).toBeGreaterThanOrEqual(2);

      // 5. Generation-less family mention ("Huawei MatePad") -> AMBIGUOUS_REVIEW
      const ambiguousFamily = matchVocReportToCanonicalProduct({
        reportId: 'test-matepad-generic',
        text: 'My Huawei MatePad screen flickers when charging.',
        manufacturerHint: 'Huawei',
        canonicalProducts,
      });
      expect(ambiguousFamily.confidence).toBe('AMBIGUOUS_REVIEW');
      expect(ambiguousFamily.canonicalProductId).toBeNull();

      // Verify canonical products were not mutated
      expect(JSON.stringify(canonicalProducts.slice(0, 5))).toBe(snapshotBefore);
    });
  });

  describe('Phase 5 & 6: Emerging Issue Detection & Service Intelligence Integration', () => {
    const sampleAdvisories: ServiceAdvisory[] = [
      {
        id: 'adv-huawei-emui-oct-2026',
        sourceId: 'huawei-security',
        manufacturer: 'Huawei',
        advisoryType: 'SECURITY_UPDATE',
        title: 'Huawei EMUI & HarmonyOS Security Bulletin — October 2026',
        summary: 'Monthly security update for EMUI 14 and HarmonyOS devices including Pura 70 series.',
        publishedAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        sourceUrl: 'https://consumer.huawei.com/en/support/bulletin/2026/10/',
        affectedProductsText: 'HUAWEI Pura 70, HUAWEI Pura 70 Pro, HUAWEI Pura 70 Ultra',
        affectedProducts: ['HUAWEI Pura 70', 'HUAWEI Pura 70 Pro', 'HUAWEI Pura 70 Ultra'],
        affectedVersions: ['EMUI 14.2'],
        fixedVersions: ['EMUI 14.2.0.180'],
        cveIds: ['CVE-2026-1234'],
        severity: 'HIGH',
        verificationStatus: 'OFFICIALLY_CONFIRMED',
        ingestionTimestamp: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'adv-huawei-battery-repair-program',
        sourceId: 'huawei-security',
        manufacturer: 'Huawei',
        advisoryType: 'REPAIR_PROGRAM',
        title: 'Official Battery Replacement Service Program for Mate 60 Pro',
        summary: 'Official hardware repair program for qualifying Mate 60 Pro battery health issues.',
        publishedAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
        sourceUrl: 'https://consumer.huawei.com/en/support/service-program/',
        affectedProductsText: 'HUAWEI Mate 60 Pro',
        affectedProducts: ['HUAWEI Mate 60 Pro'],
        affectedVersions: [],
        fixedVersions: [],
        cveIds: [],
        severity: 'MEDIUM',
        verificationStatus: 'OFFICIALLY_CONFIRMED',
        ingestionTimestamp: '2026-09-16T00:00:00.000Z',
      },
    ];

    it('never elevates a routine SECURITY_UPDATE correlation to OFFICIALLY_CONFIRMED_ISSUE', () => {
      const secUpdateCorrelation = correlateVocWithServiceAdvisories({
        manufacturer: 'Huawei',
        canonicalProductId: 'prod-huawei-pura-70-ultra-512',
        canonicalProductName: 'HUAWEI Pura 70 Ultra 512GB',
        detectedModelText: 'Pura 70 Ultra',
        categories: ['FIRMWARE_UPDATE_PROBLEMS', 'BATTERY_DRAIN'],
        classificationConfidence: 0.88,
        productMatchConfidence: 'VERIFIED_MODEL',
        advisories: sampleAdvisories,
      });

      expect(secUpdateCorrelation.status).toBe('CORRELATED_WITH_OFFICIAL_ADVISORY');
      expect(secUpdateCorrelation.status).not.toBe('OFFICIALLY_CONFIRMED_ISSUE');

      const repairProgramCorrelation = correlateVocWithServiceAdvisories({
        manufacturer: 'Huawei',
        canonicalProductId: 'prod-huawei-mate-60-pro',
        canonicalProductName: 'HUAWEI Mate 60 Pro',
        detectedModelText: 'Mate 60 Pro',
        categories: ['BATTERY_DRAIN', 'REPAIR_WARRANTY_COMPLAINTS'],
        classificationConfidence: 0.9,
        productMatchConfidence: 'VERIFIED_MODEL',
        advisories: sampleAdvisories,
      });

      expect(repairProgramCorrelation.status).toBe('OFFICIALLY_CONFIRMED_ISSUE');
    });

    it('suppresses duplicate reports when computing cluster sample sizes and emerging issue spikes', () => {
      const refNow = '2026-10-28T00:00:00.000Z';
      const makeReport = (
        id: string,
        normHash: string,
        isDuplicate: boolean,
        publishedAt: string
      ): VocReport => ({
        id,
        sourceId: 'voc-src-github-hms-issues',
        sourceName: 'GitHub Public Issue Tracker',
        sourceSpecificId: id,
        sourceUrl: `https://github.com/HMS-Core/issues/${id}`,
        publishedAt,
        collectedAt: refNow,
        manufacturer: 'Huawei',
        reportedProductName: 'HUAWEI Pura 70 Ultra',
        canonicalProductId: 'prod-huawei-pura-70-ultra-512',
        canonicalProductName: 'HUAWEI Pura 70 Ultra 512GB',
        productMatchConfidence: 'VERIFIED_MODEL',
        productMatchRationale: 'Exact match',
        primaryCategory: 'FIRMWARE_UPDATE_PROBLEMS',
        categories: ['FIRMWARE_UPDATE_PROBLEMS', 'BATTERY_DRAIN'],
        sentiment: 'NEGATIVE',
        sentimentScore: -0.7,
        originalLanguage: 'en',
        evidenceExcerpt: `Unique report excerpt ${normHash}`,
        piiRedacted: false,
        redactedItemsCount: 0,
        classificationConfidence: 0.85,
        verificationStatus: 'SOURCE_VERIFIED',
        advisoryCorrelationStatus: 'CORRELATED_WITH_OFFICIAL_ADVISORY',
        relatedAdvisoryIds: ['adv-huawei-emui-oct-2026'],
        duplicateMetadata: {
          contentHash: normHash,
          normalizedTextHash: normHash,
          sourceExternalIdHash: id,
          isDuplicate,
        },
      });

      // 5 unique reports in last 7 days + 3 duplicates of hash-1
      const reports: VocReport[] = [
        makeReport('r1', 'hash-1', false, '2026-10-27T10:00:00.000Z'),
        makeReport('r1-dup1', 'hash-1', true, '2026-10-27T11:00:00.000Z'),
        makeReport('r1-dup2', 'hash-1', true, '2026-10-27T12:00:00.000Z'),
        makeReport('r2', 'hash-2', false, '2026-10-26T10:00:00.000Z'),
        makeReport('r3', 'hash-3', false, '2026-10-25T10:00:00.000Z'),
        makeReport('r4', 'hash-4', false, '2026-10-24T10:00:00.000Z'),
        makeReport('r5', 'hash-5', false, '2026-10-23T10:00:00.000Z'),
      ];

      const clusters = buildVocIssueClusters({
        reports,
        advisories: sampleAdvisories,
        referenceNowIso: refNow,
      });

      expect(clusters.length).toBe(1);
      expect(clusters[0].uniqueReportCount).toBe(5);
      expect(clusters[0].totalRawMentionsCount).toBe(7);
      expect(clusters[0].duplicateSuppressedCount).toBe(2);
      expect(clusters[0].sampleSizeSufficient).toBe(true);
      expect(clusters[0].isEmergingIssue).toBe(true);
      expect(clusters[0].trendStatus).toBe('EMERGING_SPIKE');
      expect(clusters[0].advisoryCorrelationStatus).toBe('CORRELATED_WITH_OFFICIAL_ADVISORY');
      expect(VOC_METHODOLOGY_DISCLOSURE.minimumClusterSampleSize).toBe(MIN_CLUSTER_UNIQUE_SAMPLE_SIZE);
      expect(VOC_METHODOLOGY_DISCLOSURE.emergingIssueMinUniqueReports).toBe(MIN_EMERGING_UNIQUE_REPORTS);
    });
  });

  describe('Phase 7 & 8: Authoritative Empty State & Read-Only Diagnostic Sandbox', () => {
    it('returns an honest empty state with zero fabricated complaints and executes dry-run evaluations without persisting', async () => {
      const overview = await getVocOverview({ manufacturer: 'Huawei' });
      expect(overview.selectedManufacturer).toBe('Huawei');
      expect(overview.firestoreCollections.vocReports).toBe(0);
      expect(overview.isEmptyState).toBe(true);
      expect(overview.kpis.totalUniqueComplaints).toBe(0);
      expect(overview.reports.length).toBe(0);
      expect(overview.catalogContext.totalCanonicalProducts).toBeGreaterThan(0);

      const diagnostic = await evaluateVocSampleDiagnostic({
        text: 'My Huawei Pura 70 Ultra battery drains fast after update. Email me at test@domain.com.',
        manufacturerHint: 'Huawei',
      });
      expect(diagnostic.persistedToFirestore).toBe(false);
      expect(diagnostic.piiRedacted).toBe(true);
      expect(diagnostic.sanitizedExcerpt).not.toContain('test@domain.com');
      expect(diagnostic.productMatch.confidence).toBe('VERIFIED_MODEL');
    });
  });
});

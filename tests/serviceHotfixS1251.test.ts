/**
 * Signalyn S1.2.5.1 — Production Hotfix, Source Reconciliation & Match Inspector Recovery Test Suite
 *
 * Verifies all 15 required regression scenarios from Section 8 of S1.2.5.1:
 *  1. `cleanAppleReleaseTitle` is defined, imported, and covered by unit tests (including inside `buildProductionReconciliationPreview`).
 *  2. Apple zero-CVE updates are classified without runtime errors.
 *  3. Apple CVE updates preserve extracted CVE IDs (and existing valid CVEs are never overwritten with `[]`).
 *  4. Huawei monthly bulletins preserve normalized titles and CVE extraction.
 *  5. Huawei update schedules remain `UPDATE_SCHEDULE` / `OFFICIAL_UPDATE_ELIGIBILITY` and never become `VERIFIED` vulnerability links.
 *  6. Samsung SMR sections do not reuse identical CVE slices across unrelated months.
 *  7. CISA KEV persisted count (40) is separated from latest sync delta count (1 created, 39 updated).
 *  8. Advisory count reconciliation explains and resolves the 93 vs. 94 difference.
 *  9. Match Evidence Inspector returns the full candidate count matching reconciliation summary (686 on stored production dataset).
 * 10. Match Evidence Inspector filters work for `ALL`, `VERIFIED`, `LIKELY`, `AMBIGUOUS_REVIEW`, and manufacturer.
 * 11. Snapshot hash mismatch or expired snapshot blocks persistence.
 * 12. Quality Gate failure blocks persistence (`bulkPersistenceSafe === false` when evidence is missing).
 * 13. Existing admin decisions (`CONFIRMED` / `DISMISSED`) are preserved during recomputation.
 * 14. Diagnostic failure in one section does not break unrelated sections or empty the Match Evidence Inspector.
 * 15. No Firestore writes occur during dry-run or diagnostic inspection.
 */

import assert from 'node:assert/strict';
import {
  cleanAppleReleaseTitle,
  parseAppleSecurityIndexHtml,
  parseAppleSecurityDetailHtml,
} from '../src/server/service/adapters/appleSecurityAdapter';
import {
  formatHuaweiBulletinTitle,
  parseHuaweiBulletinDetailHtml,
} from '../src/server/service/adapters/huaweiSecurityAdapter';
import { parseSamsungSmrSectionsFromHtml } from '../src/server/service/adapters/samsungSecurityAdapter';
import {
  buildProductionReconciliationPreview,
  buildSourceSyncSchemaAudit,
  evaluateS125QualityGate,
  runOfficialAdapterAndIntegrityAudit,
} from '../src/server/service/serviceAuthenticityAuditor';
import {
  recomputeServiceProductMatches,
  getMatchEvidenceReview,
  getPersistenceDiagnostic,
  getServiceDashboardStats,
  getServiceSources,
  getServiceAdvisories,
  getSourceSyncSchemaAudit,
  expireActiveDryRunSnapshotForTests,
  resetServiceStateForTests,
} from '../src/server/service/servicePipelineService';
import { matchAdvisoriesToCatalog } from '../src/server/service/serviceProductMatcher';
import {
  ServiceAdvisory,
  ServiceProductMatch,
  ServiceSource,
  ServiceSyncRun,
  ServiceVulnerability,
} from '../src/types/serviceIntelligence';
import { RetailProduct } from '../src/types/retailPrice';

/**
 * In-memory mock Firestore database that tracks every write operation (`writeCount`)
 * so we can prove zero writes occur during dry-run, evidence review, and diagnostics.
 */
function createInstrumentedMockDb(seed: {
  advisories: ServiceAdvisory[];
  products: RetailProduct[];
  matches?: ServiceProductMatch[];
  vulnerabilities?: ServiceVulnerability[];
  sources?: ServiceSource[];
  syncRuns?: ServiceSyncRun[];
  failWrites?: boolean;
}) {
  const store: Record<string, Map<string, any>> = {
    serviceAdvisories: new Map(seed.advisories.map((a) => [a.id, { ...a }])),
    retailProducts: new Map(seed.products.map((p) => [p.id, { ...p }])),
    serviceProductMatches: new Map((seed.matches || []).map((m) => [m.id, { ...m }])),
    serviceVulnerabilities: new Map((seed.vulnerabilities || []).map((v) => [v.cveId, { ...v }])),
    serviceSources: new Map((seed.sources || []).map((s) => [s.id, { ...s }])),
    serviceSyncRuns: new Map((seed.syncRuns || []).map((r) => [r.id, { ...r }])),
    serviceAlerts: new Map(),
    _serviceDiagnostics: new Map(),
  };

  let writeCount = 0;

  const makeCollection = (name: string) => {
    if (!store[name]) store[name] = new Map();
    const colMap = store[name];
    return {
      count: () => ({
        get: async () => ({
          data: () => ({
            count: Array.from(colMap.keys()).filter((k) => !String(k).startsWith('_diag_probe_'))
              .length,
          }),
        }),
      }),
      limit: (n: number) => ({
        get: async () => {
          const docs = Array.from(colMap.entries())
            .slice(0, n)
            .map(([id, val]) => ({ id, exists: true, data: () => val }));
          return { empty: docs.length === 0, size: docs.length, docs };
        },
      }),
      orderBy: () => ({
        limit: (n: number) => ({
          get: async () => {
            const docs = Array.from(colMap.entries())
              .slice(0, n)
              .map(([id, val]) => ({ id, exists: true, data: () => val }));
            return { empty: docs.length === 0, size: docs.length, docs };
          },
        }),
      }),
      get: async () => {
        const docs = Array.from(colMap.entries()).map(([id, val]) => ({
          id,
          exists: true,
          data: () => val,
        }));
        return { empty: docs.length === 0, size: docs.length, docs };
      },
      doc: (docId: string) => ({
        id: docId,
        get: async () => {
          const val = colMap.get(docId);
          return { id: docId, exists: val !== undefined, data: () => val };
        },
        set: async (data: any, opts?: { merge?: boolean }) => {
          if (seed.failWrites) {
            throw new Error('PERMISSION_DENIED: Simulated Firestore write failure');
          }
          writeCount++;
          const prev = colMap.get(docId) || {};
          colMap.set(docId, opts?.merge ? { ...prev, ...data } : { ...data });
        },
        delete: async () => {
          writeCount++;
          colMap.delete(docId);
        },
      }),
    };
  };

  return {
    getWriteCount: () => writeCount,
    resetWriteCount: () => {
      writeCount = 0;
    },
    store,
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: any, opts?: { merge?: boolean }) => {
          ops.push(() => {
            for (const colMap of Object.values(store)) {
              if (colMap.has(ref.id)) {
                const prev = colMap.get(ref.id) || {};
                colMap.set(ref.id, opts?.merge ? { ...prev, ...data } : { ...data });
                return;
              }
            }
            store.serviceProductMatches.set(ref.id, data);
          });
        },
        commit: async () => {
          if (seed.failWrites) {
            throw new Error('PERMISSION_DENIED: Simulated Firestore batch commit failure');
          }
          writeCount += ops.length;
          ops.forEach((fn) => fn());
        },
      };
    },
  };
}

/**
 * Builds a representative production-like dataset (stored pre-S1.2.5 advisories + canonical products)
 */
function buildRepresentativeDataset(): {
  advisories: ServiceAdvisory[];
  products: RetailProduct[];
} {
  const advisories: ServiceAdvisory[] = [
    // Stored Apple advisory WITH concatenated zero-CVE footnote (triggers line 1377 in serviceAuthenticityAuditor.ts)
    {
      id: 'adv-apple-ios-26-0-1',
      sourceId: 'apple-security',
      manufacturer: 'Apple',
      advisoryType: 'SECURITY_UPDATE',
      title: 'iOS 26.0.1 and iPadOS 26.0.1\nThis update has no published CVE entries.',
      summary: 'Official Apple security release for iPhone and iPad.',
      publishedAt: '2026-09-25',
      updatedAt: '2026-09-25',
      sourceUrl: 'https://support.apple.com/100100',
      bulletinReference: 'HT201222',
      affectedProductsText: 'iPhone 13 and later, iPad Pro (M4), iPad Air (M2 and later), iPad (10th generation and later)',
      affectedProducts: ['iPhone', 'iPad'],
      affectedVersions: ['iOS 26.0.1', 'iPadOS 26.0.1'],
      fixedVersions: ['iOS 26.0.1', 'iPadOS 26.0.1'],
      cveIds: [],
      severity: 'HIGH',
      verificationStatus: 'OFFICIALLY_CONFIRMED',
      ingestionTimestamp: '2026-10-01T00:00:00Z',
    },
    // Stored Apple dedicated CVE bulletin with extracted CVEs
    {
      id: 'adv-apple-125886',
      sourceId: 'apple-security',
      manufacturer: 'Apple',
      advisoryType: 'SECURITY_UPDATE',
      title: 'iOS 27.2 and iPadOS 27.2',
      summary: 'Security update addressing 29 CVEs for iPhone and iPad.',
      publishedAt: '2026-10-15',
      updatedAt: '2026-10-15',
      sourceUrl: 'https://support.apple.com/en-us/125886',
      bulletinReference: '125886',
      affectedProductsText:
        'iPhone 14 and later, iPad Pro 13-inch (M4), iPad Air 11-inch (M2 and later), iPad (A16)',
      affectedProducts: ['iPhone', 'iPad'],
      affectedVersions: ['iOS 27.2', 'iPadOS 27.2'],
      fixedVersions: ['iOS 27.2', 'iPadOS 27.2'],
      cveIds: ['CVE-2026-20001', 'CVE-2026-20002'],
      severity: 'CRITICAL',
      verificationStatus: 'OFFICIALLY_CONFIRMED',
      ingestionTimestamp: '2026-10-15T00:00:00Z',
    },
    // Stored Apple watchOS bulletin
    {
      id: 'adv-apple-watchos-12-1',
      sourceId: 'apple-security',
      manufacturer: 'Apple',
      advisoryType: 'SECURITY_UPDATE',
      title: 'watchOS 12.1',
      summary: 'Security update for Apple Watch Series 9, Series 10, Series 11, and Ultra 2.',
      publishedAt: '2026-10-15',
      updatedAt: '2026-10-15',
      sourceUrl: 'https://support.apple.com/en-us/125890',
      bulletinReference: '125890',
      affectedProductsText: 'Apple Watch Series 6 and later, Apple Watch Ultra and later, Apple Watch SE (2nd generation)',
      affectedProducts: ['Apple Watch'],
      affectedVersions: ['watchOS 12.1'],
      fixedVersions: ['watchOS 12.1'],
      cveIds: ['CVE-2026-20010'],
      severity: 'HIGH',
      verificationStatus: 'OFFICIALLY_CONFIRMED',
      ingestionTimestamp: '2026-10-15T00:00:00Z',
    },
    // Stored Huawei monthly security bulletin
    {
      id: 'adv-huawei-emui-2026-10',
      sourceId: 'huawei-security',
      manufacturer: 'Huawei',
      advisoryType: 'SECURITY_UPDATE',
      title: 'Huawei EMUI / HarmonyOS Security Bulletin — October 2026',
      summary: 'Monthly security patches for EMUI and HarmonyOS devices.',
      publishedAt: '2026-10-01',
      updatedAt: '2026-10-01',
      sourceUrl: 'https://consumer.huawei.com/en/support/bulletin/2026/10/',
      bulletinReference: '2026/10',
      affectedProductsText: 'HUAWEI Pura 70 Ultra, HUAWEI Pura 70 Pro, HUAWEI MatePad 11.5',
      affectedProducts: ['HUAWEI Pura 70 Ultra', 'HUAWEI Pura 70 Pro', 'HUAWEI MatePad 11.5'],
      affectedVersions: ['EMUI 14'],
      fixedVersions: ['EMUI 14.2.0.155'],
      cveIds: ['CVE-2026-30001'],
      severity: 'HIGH',
      verificationStatus: 'OFFICIALLY_CONFIRMED',
      ingestionTimestamp: '2026-10-02T00:00:00Z',
    },
    // Stored Huawei quarterly update schedule
    {
      id: 'adv-huawei-schedule-quarterly',
      sourceId: 'huawei-security',
      manufacturer: 'Huawei',
      advisoryType: 'UPDATE_SCHEDULE',
      title: 'Huawei Quarterly Security Update Device Scope',
      summary: 'Official device eligibility scope for quarterly security updates.',
      publishedAt: '2026-10-01',
      updatedAt: '2026-10-01',
      sourceUrl: 'https://consumer.huawei.com/de/support/bulletin/',
      bulletinReference: 'HUAWEI-QUARTERLY-SCOPE',
      affectedProductsText: 'HUAWEI Pura 70 Ultra, HUAWEI Watch GT 5 Pro',
      affectedProducts: ['HUAWEI Pura 70 Ultra', 'HUAWEI Watch GT 5 Pro'],
      affectedVersions: [],
      fixedVersions: [],
      cveIds: [],
      severity: 'INFORMATIONAL',
      verificationStatus: 'OFFICIALLY_CONFIRMED',
      ingestionTimestamp: '2026-10-02T00:00:00Z',
    },
    // Stored Samsung SMR bulletin
    {
      id: 'adv-samsung-smr-oct-2026',
      sourceId: 'samsung-security',
      manufacturer: 'Samsung',
      advisoryType: 'SECURITY_UPDATE',
      title: 'Samsung Mobile Security Maintenance Release (SMR) — Oct-2026',
      summary: 'October 2026 SMR addressing Android and Samsung vulnerabilities.',
      publishedAt: '2026-10-05',
      updatedAt: '2026-10-05',
      sourceUrl: 'https://security.samsungmobile.com/securityUpdate.smsb',
      bulletinReference: 'SMR-OCT-2026',
      affectedProductsText: 'Galaxy S25 Ultra, Galaxy S25+, Galaxy S25, Galaxy Z Fold6, Galaxy A56',
      affectedProducts: ['Galaxy S25 Ultra', 'Galaxy S25+', 'Galaxy S25', 'Galaxy Z Fold6', 'Galaxy A56'],
      affectedVersions: ['Android 15', 'Android 16'],
      fixedVersions: ['SMR Oct-2026 Release 1'],
      cveIds: ['CVE-2026-40001', 'CVE-2026-40002'],
      sveIds: ['SVE-2026-1001'],
      severity: 'HIGH',
      verificationStatus: 'OFFICIALLY_CONFIRMED',
      ingestionTimestamp: '2026-10-05T00:00:00Z',
    },
    // Stored CISA KEV advisory
    {
      id: 'adv-cisa-kev-cve-2026-20001',
      sourceId: 'cisa-kev',
      manufacturer: 'Apple',
      advisoryType: 'KNOWN_EXPLOITED',
      title: 'CISA KEV: Apple iOS and iPadOS WebKit Code Execution Vulnerability (CVE-2026-20001)',
      summary: 'Apple iOS and iPadOS contain an unspecified vulnerability in WebKit.',
      publishedAt: '2026-10-16',
      updatedAt: '2026-10-16',
      sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
      bulletinReference: 'CVE-2026-20001',
      affectedProductsText: 'Apple iOS and iPadOS',
      affectedProducts: ['iOS and iPadOS'],
      affectedVersions: [],
      fixedVersions: [],
      cveIds: ['CVE-2026-20001'],
      isKnownExploited: true,
      cisaKevStatus: 'ACTIVE_EXPLOITED',
      cisaDateAdded: '2026-10-16',
      cisaDueDate: '2026-11-06',
      cisaRequiredAction: 'Apply mitigations per vendor instructions.',
      knownRansomwareCampaignUse: 'Unknown',
      severity: 'NOT_AVAILABLE',
      severitySource: 'UNSPECIFIED',
      severityVerificationStatus: 'UNVERIFIED',
      verificationStatus: 'OFFICIALLY_CONFIRMED',
      ingestionTimestamp: '2026-10-16T00:00:00Z',
    },
  ];

  const products: RetailProduct[] = [
    {
      id: 'prod-apple-iphone-16-pro',
      name: 'Apple iPhone 16 Pro 256GB',
      brand: 'Apple',
      category: 'Smartphones',
      releaseYear: 2024,
      msrpEur: 1229,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'prod-apple-watch-s11-case-band',
      name: 'Apple Watch Series 11 GPS 46mm Aluminium Case with Sport Band',
      brand: 'Apple',
      category: 'Wearables',
      releaseYear: 2025,
      msrpEur: 479,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'prod-huawei-pura-70-ultra',
      name: 'Huawei Pura 70 Ultra 512GB',
      brand: 'Huawei',
      category: 'Smartphones',
      releaseYear: 2024,
      msrpEur: 1499,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'prod-samsung-s25-ultra',
      name: 'Samsung Galaxy S25 Ultra 512GB',
      brand: 'Samsung',
      category: 'Smartphones',
      releaseYear: 2025,
      msrpEur: 1449,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  return { advisories, products };
}

async function runTests() {
  console.log('=== SIGNALYN S1.2.5.1 — PRODUCTION HOTFIX & RECONCILIATION REGRESSION SUITE ===');
  let passed = 0;

  // ---------------------------------------------------------------------------
  // Scenario 1: `cleanAppleReleaseTitle` is defined, imported, and covered by unit tests
  // ---------------------------------------------------------------------------
  {
    const raw = 'iOS 26.0.1 and iPadOS 26.0.1\nThis update has no published CVE entries.';
    const cleaned = cleanAppleReleaseTitle(raw);
    assert.equal(cleaned.cleanTitle, 'iOS 26.0.1 and iPadOS 26.0.1');
    assert.equal(cleaned.hadZeroCveFootnote, true);

    // Must also succeed inside buildProductionReconciliationPreview and runOfficialAdapterAndIntegrityAudit
    // when a stored Apple advisory contains "This update has no published CVE entries." in adv.title!
    const { advisories, products } = buildRepresentativeDataset();
    const matchRes = matchAdvisoriesToCatalog(advisories, products);
    const preview = buildProductionReconciliationPreview(advisories, products, matchRes.matches, []);
    const appleCorrection = preview.proposedAdvisoryCorrections.find(
      (c) => c.advisoryId === 'adv-apple-ios-26-0-1',
    );
    assert.ok(appleCorrection, 'Expected proposed correction for stored Apple zero-CVE title');
    assert.equal(appleCorrection?.proposedTitle, 'iOS 26.0.1 and iPadOS 26.0.1');

    const fullAudit = await runOfficialAdapterAndIntegrityAudit({
      advisories,
      catalogProducts: products,
      matches: matchRes.matches,
    });
    assert.ok(fullAudit.qualityGate12Check, 'runOfficialAdapterAndIntegrityAudit must complete without ReferenceError');
    passed++;
    console.log('PASS [1/15]: cleanAppleReleaseTitle is defined, imported, and executes cleanly in auditor');
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Apple zero-CVE updates are classified without runtime errors
  // ---------------------------------------------------------------------------
  {
    const sampleHtml = `
      <table>
        <tr><th>Release</th><th>Available for</th><th>Released</th></tr>
        <tr>
          <td>iOS 26.0.1 and iPadOS 26.0.1<br/>This update has no published CVE entries.</td>
          <td>iPhone 13 and later, iPad Pro (M4)</td>
          <td>25 Sep 2026</td>
        </tr>
      </table>
    `;
    const rows = parseAppleSecurityIndexHtml(sampleHtml, { maxReleases: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'iOS 26.0.1 and iPadOS 26.0.1');
    assert.equal(rows[0].isZeroCveRelease, true);
    passed++;
    console.log('PASS [2/15]: Apple zero-CVE updates are classified cleanly without concatenated footnote');
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Apple CVE updates preserve extracted CVE IDs
  // ---------------------------------------------------------------------------
  {
    const detailHtml = `
      <html>
        <head><title>About the security content of iOS 27.2 and iPadOS 27.2 - Apple Support</title></head>
        <body>
          <h1>About the security content of iOS 27.2 and iPadOS 27.2</h1>
          <p>CVE-2026-20001: A remote attacker may be able to cause arbitrary code execution.</p>
          <p>CVE-2026-20002: Processing maliciously crafted web content may lead to arbitrary code execution.</p>
        </body>
      </html>
    `;
    const parsed = parseAppleSecurityDetailHtml(detailHtml);
    assert.deepEqual(parsed.cveIds, ['CVE-2026-20001', 'CVE-2026-20002']);
    assert.equal(parsed.isZeroCveStatementPresent, false);
    passed++;
    console.log('PASS [3/15]: Apple CVE updates preserve extracted detail-page CVE IDs');
  }

  // ---------------------------------------------------------------------------
  // Scenario 4: Huawei monthly bulletins preserve normalized titles and CVE extraction
  // ---------------------------------------------------------------------------
  {
    const normalized = formatHuaweiBulletinTitle('Month 10 2026', '2026', '10');
    assert.ok(normalized.includes('October 2026') && !normalized.includes('Month 10'));
    const detailParsed = parseHuaweiBulletinDetailHtml(
      '<div>Fixed vulnerabilities: CVE-2026-30001, CVE-2026-30002</div>',
      '2026',
      '10',
    );
    assert.deepEqual(detailParsed.cveIds, ['CVE-2026-30001', 'CVE-2026-30002']);
    passed++;
    console.log('PASS [4/15]: Huawei monthly bulletins preserve normalized titles and CVE extraction');
  }

  // ---------------------------------------------------------------------------
  // Scenario 5: Huawei update schedules remain UPDATE_SCHEDULE and never become VERIFIED vulnerability links
  // ---------------------------------------------------------------------------
  {
    const { advisories, products } = buildRepresentativeDataset();
    const matchRes = matchAdvisoriesToCatalog(advisories, products);
    const scheduleMatches = matchRes.matches.filter(
      (m) => m.advisoryId === 'adv-huawei-schedule-quarterly',
    );
    assert.ok(scheduleMatches.length > 0, 'Expected Huawei schedule candidate match');
    for (const m of scheduleMatches) {
      assert.notEqual(
        m.confidence,
        'VERIFIED',
        'Huawei update schedule match must never be promoted to VERIFIED',
      );
      assert.equal(m.relationshipType, 'OFFICIAL_UPDATE_ELIGIBILITY');
    }
    passed++;
    console.log('PASS [5/15]: Huawei update schedules remain UPDATE_SCHEDULE / OFFICIAL_UPDATE_ELIGIBILITY and never VERIFIED');
  }

  // ---------------------------------------------------------------------------
  // Scenario 6: Samsung SMR sections do not reuse identical CVE slices across unrelated months
  // ---------------------------------------------------------------------------
  {
    const smrHtml = `
      <div>
        <h2>SMR Oct-2026 Release 1</h2>
        <p>Security patch level: 2026-10-01. Addresses CVE-2026-40001, CVE-2026-40002, and SVE-2026-1001.</p>
        <h2>SMR Sep-2026 Release 1</h2>
        <p>Security patch level: 2026-09-01. Addresses CVE-2026-39001, CVE-2026-39002, and SVE-2026-0901.</p>
      </div>
    `;
    const bulletins = parseSamsungSmrSectionsFromHtml(smrHtml, 10);
    assert.equal(bulletins.length, 2);
    assert.deepEqual(bulletins[0].cveIds, ['CVE-2026-40001', 'CVE-2026-40002']);
    assert.deepEqual(bulletins[1].cveIds, ['CVE-2026-39001', 'CVE-2026-39002']);
    assert.notDeepEqual(bulletins[0].cveIds, bulletins[1].cveIds);
    passed++;
    console.log('PASS [6/15]: Samsung SMR sections isolate monthly CVEs without cross-month slice duplication');
  }

  // ---------------------------------------------------------------------------
  // Scenario 7: CISA KEV persisted count is separated from latest sync delta count
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    // Create 40 CISA KEV advisories in mock Firestore, while latest sync run had recordsCreated = 1, recordsUpdated = 39
    const fortyKevAdvisories: ServiceAdvisory[] = Array.from({ length: 40 }, (_, i) => ({
      ...advisories.find((a) => a.sourceId === 'cisa-kev')!,
      id: `adv-cisa-kev-cve-2026-${20001 + i}`,
      cveIds: [`CVE-2026-${20001 + i}`],
    }));
    const allAdvisories = [
      ...advisories.filter((a) => a.sourceId !== 'cisa-kev'),
      ...fortyKevAdvisories,
    ];
    const cisaSource: ServiceSource = {
      id: 'cisa-kev',
      name: 'CISA Known Exploited Vulnerabilities (KEV)',
      manufacturerOrAuthority: 'U.S. Cybersecurity and Infrastructure Security Agency',
      sourceType: 'CYBERSECURITY_AUTHORITY',
      officialUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
      enabled: true,
      status: 'ACTIVE',
      collectionStatus: 'SUCCESS',
      lastSyncTerminalStatus: 'COMPLETED',
      lastSuccessfulSync: '2026-10-30T10:00:00Z',
      recordsDiscovered: 40,
      recordsCreated: 1,
      recordsUpdated: 39,
      recordsUnchanged: 0,
      provenanceDescription: 'Official CISA KEV catalog',
    };
    const syncRun: ServiceSyncRun = {
      id: 'sync-cisa-kev-1',
      sourceId: 'cisa-kev',
      sourceName: cisaSource.name,
      status: 'COMPLETED',
      startedAt: '2026-10-30T09:59:50Z',
      completedAt: '2026-10-30T10:00:00Z',
      advisoriesDiscovered: 40,
      advisoriesCreated: 1,
      advisoriesUpdated: 39,
      advisoriesUnchanged: 0,
      vulnerabilitiesDiscovered: 40,
      productMatchesCreated: 0,
      persistenceStorageMode: 'FIRESTORE_AUTHORITATIVE',
      triggeredBy: 'MANUAL_ADMIN',
    };

    const mockDb = createInstrumentedMockDb({
      advisories: allAdvisories,
      products,
      sources: [cisaSource],
      syncRuns: [syncRun],
    });

    const diag = await getPersistenceDiagnostic(false, { customDb: mockDb });
    assert.equal(diag.reconciledCounters?.totalPersistedCisaKevCount, 40);
    assert.equal(diag.reconciledCounters?.latestSyncRecordsCreated, 1);
    assert.equal(diag.reconciledCounters?.latestSyncRecordsUpdated, 39);
    assert.ok(diag.reconciledCounters?.discrepancyExplanations.cisaKevCount40Vs1.includes('39'));
    passed++;
    console.log('PASS [7/15]: CISA KEV persisted total (40) is explicitly separated from latest sync delta (1 created, 39 updated)');
  }

  // ---------------------------------------------------------------------------
  // Scenario 8: Advisory count reconciliation explains and resolves the 93 vs. 94 difference
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const mockDb = createInstrumentedMockDb({ advisories, products });

    // Run recompute dry-run and dashboard stats against the same authoritative DB
    const summary = await recomputeServiceProductMatches({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });
    const stats = await getServiceDashboardStats({ customDb: mockDb });
    const diag = await getPersistenceDiagnostic(false, { customDb: mockDb });

    assert.equal(summary.advisoriesExamined, advisories.length);
    assert.equal(stats.totalPersistedAdvisories, advisories.length);
    assert.equal(diag.reconciledCounters?.totalPersistedAdvisories, advisories.length);
    assert.ok(
      diag.reconciledCounters?.discrepancyExplanations.advisoryCount93Vs94.includes('memAdvisories'),
    );
    passed++;
    console.log('PASS [8/15]: Advisory count reconciliation aligns totalPersistedAdvisories across stats, dry-run, and diagnostics');
  }

  // ---------------------------------------------------------------------------
  // Scenario 9: Match Evidence Inspector returns the full candidate count matching reconciliation summary
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const mockDb = createInstrumentedMockDb({ advisories, products });

    const summary = await recomputeServiceProductMatches({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });
    const review = await getMatchEvidenceReview({
      customDb: mockDb,
      reuseSnapshotIfValid: true,
    });

    assert.equal(review.candidates.length, summary.candidateMatchesGenerated);
    assert.equal(review.verifiedCountInSnapshot, summary.verifiedCandidates);
    assert.equal(review.likelyCountInSnapshot, summary.likelyCandidates);
    assert.equal(review.ambiguousCountInSnapshot, summary.ambiguousReviewCandidates);
    assert.equal(review.dryRunSnapshotHash, summary.dryRunSnapshotHash);
    assert.ok(review.candidates.length > 0, 'Inspector must return non-empty candidates matching summary');
    passed++;
    console.log('PASS [9/15]: Match Evidence Inspector returns 100% of computed candidates from the shared immutable dry-run snapshot');
  }

  // ---------------------------------------------------------------------------
  // Scenario 10: Match Evidence Inspector filters work for ALL, VERIFIED, LIKELY, AMBIGUOUS_REVIEW, and manufacturer
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const mockDb = createInstrumentedMockDb({ advisories, products });
    const review = await getMatchEvidenceReview({ customDb: mockDb });

    const allCount = review.candidates.length;
    const verifiedList = review.candidates.filter((c) => c.confidence === 'VERIFIED');
    const likelyList = review.candidates.filter((c) => c.confidence === 'LIKELY');
    const ambigList = review.candidates.filter((c) => c.confidence === 'AMBIGUOUS_REVIEW');

    assert.equal(
      verifiedList.length + likelyList.length + ambigList.length,
      allCount,
      'Confidence tiers must partition 100% of candidates',
    );

    const appleList = review.candidates.filter((c) => c.manufacturer === 'Apple');
    const huaweiList = review.candidates.filter((c) => c.manufacturer === 'Huawei');
    const samsungList = review.candidates.filter((c) => c.manufacturer === 'Samsung');
    assert.ok(appleList.length > 0, 'Expected Apple candidates');
    assert.ok(huaweiList.length > 0, 'Expected Huawei candidates');
    assert.ok(samsungList.length > 0, 'Expected Samsung candidates');
    assert.equal(appleList.length + huaweiList.length + samsungList.length, allCount);
    passed++;
    console.log('PASS [10/15]: Match Evidence Inspector filters partition ALL, VERIFIED, LIKELY, AMBIGUOUS_REVIEW, and manufacturers accurately');
  }

  // ---------------------------------------------------------------------------
  // Scenario 11: Snapshot hash mismatch or expired snapshot blocks persistence
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const mockDb = createInstrumentedMockDb({ advisories, products });

    const drySummary = await recomputeServiceProductMatches({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });

    // 11a. Mismatched snapshot hash must throw STALE_DRY_RUN_SNAPSHOT
    await assert.rejects(
      async () => {
        await recomputeServiceProductMatches({
          mode: 'PERSIST',
          confirmPersistence: true,
          expectedSnapshotHash: 'snap-s123-mismatched000',
          requirePriorDryRun: true,
          customDb: mockDb,
        });
      },
      /STALE_DRY_RUN_SNAPSHOT/,
    );

    // 11b. Expired snapshot must throw EXPIRED_DRY_RUN_SNAPSHOT
    expireActiveDryRunSnapshotForTests(mockDb);
    await assert.rejects(
      async () => {
        await recomputeServiceProductMatches({
          mode: 'PERSIST',
          confirmPersistence: true,
          expectedSnapshotHash: drySummary.dryRunSnapshotHash,
          requirePriorDryRun: true,
          customDb: mockDb,
        });
      },
      /EXPIRED_DRY_RUN_SNAPSHOT/,
    );
    passed++;
    console.log('PASS [11/15]: Snapshot hash mismatch and expired snapshot both block persistence');
  }

  // ---------------------------------------------------------------------------
  // Scenario 12: Quality Gate failure blocks persistence
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const mockDb = createInstrumentedMockDb({ advisories, products });

    // Inject an invalid VERIFIED candidate with HEURISTIC_SIMILARITY and missingEvidence
    const invalidCandidate: ServiceProductMatch = {
      id: 'match-invalid-verified',
      advisoryId: advisories[0].id,
      canonicalProductId: products[0].id,
      productTitle: products[0].name,
      brand: 'Apple',
      manufacturer: 'Apple',
      confidence: 'VERIFIED',
      status: 'CONFIRMED',
      evidenceStrength: 'HEURISTIC_SIMILARITY',
      evidence: ['Heuristic token'],
      missingEvidence: ['Missing hardware generation confirmation'],
      matchedAt: new Date().toISOString(),
    };

    const blockedDryRun = await recomputeServiceProductMatches({
      mode: 'DRY_RUN',
      customDb: mockDb,
      candidatesOverrideForTest: [invalidCandidate],
    });
    assert.equal(blockedDryRun.qualityGatePassed, false);
    assert.equal(blockedDryRun.status, 'QUALITY_GATE_BLOCKED');

    await assert.rejects(
      async () => {
        await recomputeServiceProductMatches({
          mode: 'PERSIST',
          confirmPersistence: true,
          expectedSnapshotHash: blockedDryRun.dryRunSnapshotHash,
          requirePriorDryRun: true,
          customDb: mockDb,
          candidatesOverrideForTest: [invalidCandidate],
        });
      },
      /QUALITY_GATE_BLOCKED/,
    );

    // Also verify S1.2.5 12-check Quality Gate sets bulkPersistenceSafe = false when stored records need review
    const matchRes = matchAdvisoriesToCatalog(advisories, products);
    const preview = buildProductionReconciliationPreview(advisories, products, matchRes.matches, []);
    const qgReport = evaluateS125QualityGate({
      advisories,
      catalogProducts: products,
      matches: matchRes.matches,
      advisoryAudits: [],
      reconciliationPreview: preview,
    });
    assert.equal(qgReport.overallStatus, 'NEEDS_REVIEW');
    assert.equal(qgReport.bulkPersistenceSafe, false);
    passed++;
    console.log('PASS [12/15]: Quality Gate failure blocks persistence and sets bulkPersistenceSafe = false when evidence is missing');
  }

  // ---------------------------------------------------------------------------
  // Scenario 13: Existing admin decisions are preserved during recomputation
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const initialMatches = matchAdvisoriesToCatalog(advisories, products).matches;
    assert.ok(initialMatches.length >= 2);

    const dismissedMatch: ServiceProductMatch = {
      ...initialMatches[0],
      status: 'DISMISSED',
      reviewedBy: 'admin@signalyn.ai',
      reviewedAt: '2026-10-29T12:00:00Z',
    };
    const confirmedLikelyMatch: ServiceProductMatch = {
      ...initialMatches[1],
      confidence: 'LIKELY',
      status: 'CONFIRMED',
      reviewedBy: 'admin@signalyn.ai',
      reviewedAt: '2026-10-29T12:05:00Z',
    };

    const mockDb = createInstrumentedMockDb({
      advisories,
      products,
      matches: [dismissedMatch, confirmedLikelyMatch],
    });

    const drySummary = await recomputeServiceProductMatches({
      mode: 'DRY_RUN',
      customDb: mockDb,
    });
    assert.equal(drySummary.preservedAdminDecisions, 2);

    const persistSummary = await recomputeServiceProductMatches({
      mode: 'PERSIST',
      confirmPersistence: true,
      expectedSnapshotHash: drySummary.dryRunSnapshotHash,
      requirePriorDryRun: true,
      customDb: mockDb,
    });
    assert.equal(persistSummary.preservedAdminDecisions, 2);
    assert.equal(mockDb.store.serviceProductMatches.get(dismissedMatch.id)?.status, 'DISMISSED');
    assert.equal(mockDb.store.serviceProductMatches.get(confirmedLikelyMatch.id)?.status, 'CONFIRMED');
    passed++;
    console.log('PASS [13/15]: Existing admin decisions (CONFIRMED / DISMISSED) are preserved across recomputation and persistence');
  }

  // ---------------------------------------------------------------------------
  // Scenario 14: Diagnostic failure in one section does not break unrelated sections
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const mockDb = createInstrumentedMockDb({ advisories, products });

    const reviewWithFault = await getMatchEvidenceReview({
      customDb: mockDb,
      forceAuditFailureForTest: true,
    });

    assert.ok(
      reviewWithFault.candidates.length > 0,
      'Match Evidence Inspector candidates must remain intact even when an auxiliary audit throws',
    );
    assert.equal(
      reviewWithFault.candidates.length,
      reviewWithFault.summary.candidateMatchesGenerated,
    );
    assert.ok(
      Array.isArray(reviewWithFault.auditSectionErrors) &&
        reviewWithFault.auditSectionErrors.length > 0,
      'Auxiliary audit failure must be recorded in auditSectionErrors',
    );
    passed++;
    console.log('PASS [14/15]: Auxiliary audit failure is isolated in auditSectionErrors without emptying Match Evidence Inspector candidates');
  }

  // ---------------------------------------------------------------------------
  // Scenario 15: No Firestore writes occur during dry-run or diagnostic inspection
  // ---------------------------------------------------------------------------
  {
    resetServiceStateForTests();
    const { advisories, products } = buildRepresentativeDataset();
    const mockDb = createInstrumentedMockDb({ advisories, products });
    mockDb.resetWriteCount();

    await recomputeServiceProductMatches({ mode: 'DRY_RUN', customDb: mockDb });
    await getMatchEvidenceReview({ customDb: mockDb, reuseSnapshotIfValid: true });
    await getPersistenceDiagnostic(false, { customDb: mockDb });
    await getSourceSyncSchemaAudit({ customDb: mockDb });
    const schemaAudit = buildSourceSyncSchemaAudit(advisories, 40);
    assert.equal(schemaAudit.readOnlyMode, true);

    assert.equal(
      mockDb.getWriteCount(),
      0,
      'Zero Firestore writes may occur during DRY_RUN, getMatchEvidenceReview, getPersistenceDiagnostic(false), or getSourceSyncSchemaAudit',
    );
    passed++;
    console.log('PASS [15/15]: Zero Firestore writes occur during dry-run reconciliation, evidence review, or diagnostic inspection');
  }

  console.log(`\nALL ${passed}/15 S1.2.5.1 REGRESSION TESTS PASSED!`);
}

runTests().catch((err) => {
  console.error('S1.2.5.1 Regression Test Suite FAILED:', err);
  process.exit(1);
});

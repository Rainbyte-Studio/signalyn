/**
 * Signalyn Service Intelligence - CISA KEV Adapter (Source D)
 * 
 * Official Source: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 * 
 * S1.1 Hardened Rules:
 * - Ingests official CISA Known Exploited Vulnerabilities (KEV) feed.
 * - Distinguishes total KEV catalog (1,758+ entries) from target-vendor filtered entries.
 * - Decouples real-world active exploitation priority from technical CVSS score.
 * - NEVER invents CVSS scores or forces severity to CRITICAL solely due to KEV inclusion.
 * - Sets cvssSeverity to 'NOT_AVAILABLE' and severity to 'UNKNOWN' until official CVSS is enriched from NIST NVD.
 * - Sets isKnownExploited = true, cisaKevStatus = 'ACTIVE_EXPLOITED', and preserves CISA required actions & due dates.
 */

import {
  ServiceAdvisory,
  ServiceVulnerability,
  ServiceSeverity,
} from "../../../types/serviceIntelligence";

export interface CisaKevCatalogItem {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse?: "Known" | "Unknown";
  notes?: string;
  cwes?: string[];
}

export interface CisaKevCatalogFeed {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: CisaKevCatalogItem[];
}

export interface CisaKevSyncResult {
  advisories: ServiceAdvisory[];
  vulnerabilities: ServiceVulnerability[];
  totalKevCatalogCount: number;
  filteredCount: number;
  error?: string;
}

export function parseCisaKevJson(
  data: CisaKevCatalogFeed,
  maxEntries = 40,
  targetVendors: string[] = ["Apple", "Samsung", "Huawei", "Google", "Android"],
): CisaKevSyncResult {
  const rawList = data.vulnerabilities || [];
  const timestamp = new Date().toISOString();

  // Filter by relevant vendors and sort newest dateAdded first
  const vendorRegexes = targetVendors.map((v) => new RegExp(`\\b${v}\\b`, "i"));
  const matchingEntries = rawList
    .filter((item) => vendorRegexes.some((rx) => rx.test(item.vendorProject)))
    .sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""))
    .slice(0, maxEntries);

  const advisories: ServiceAdvisory[] = [];
  const vulnerabilities: ServiceVulnerability[] = [];

  for (const item of matchingEntries) {
    // Determine primary manufacturer
    let manufacturer: "Apple" | "Samsung" | "Huawei" | "Cross-Vendor" = "Cross-Vendor";
    if (/apple/i.test(item.vendorProject)) manufacturer = "Apple";
    else if (/samsung/i.test(item.vendorProject)) manufacturer = "Samsung";
    else if (/huawei/i.test(item.vendorProject)) manufacturer = "Huawei";

    // Parse references from notes field
    const refs = (item.notes || "")
      .split(";")
      .map((r) => r.trim())
      .filter((r) => r.startsWith("http"));

    const advisoryId = `adv-cisa-${item.cveID.toLowerCase()}`;

    // Ingest advisory with decoupled exploitation priority and technical CVSS
    advisories.push({
      id: advisoryId,
      sourceId: "cisa-kev",
      manufacturer,
      advisoryType: "KNOWN_EXPLOITED",
      title: `CISA KEV: ${item.vulnerabilityName} (${item.cveID})`,
      summary: item.shortDescription,
      publishedAt: item.dateAdded,
      updatedAt: item.dateAdded,
      sourceUrl: refs[0] || "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
      bulletinReference: item.cveID,
      affectedProductsText: `${item.vendorProject} ${item.product}`,
      affectedProducts: [item.product],
      affectedVersions: [],
      fixedVersions: [],
      cveIds: [item.cveID],
      // S1.1/S1.2.5: Do NOT hardcode CRITICAL! Technical severity is UNKNOWN until enriched from NVD.
      severity: "UNKNOWN" as ServiceSeverity,
      verificationStatus: "OFFICIALLY_CONFIRMED",
      ingestionTimestamp: timestamp,
      updateFrequency: "AS_NEEDED",
      notes: `CISA BOD 22-01 Required Action: ${item.requiredAction}. Due date: ${item.dueDate}. Ransomware campaign use: ${item.knownRansomwareCampaignUse || "Unknown"}.`,

      // Decoupled exploitation fields
      isKnownExploited: true,
      cisaKevStatus: "ACTIVE_EXPLOITED",
      cisaDueDate: item.dueDate,
      cisaRequiredAction: item.requiredAction,
      cisaDateAdded: item.dateAdded,
      knownRansomwareCampaignUse: item.knownRansomwareCampaignUse,

      // Technical CVSS fields
      cvssScore: undefined, // Never invented
      cvssVersion: undefined,
      cvssSeverity: "NOT_AVAILABLE" as ServiceSeverity,
      severitySource: "UNSPECIFIED",
      severityVerificationStatus: "UNVERIFIED",
    });

    // Ingest vulnerability entity
    vulnerabilities.push({
      cveId: item.cveID,
      title: item.vulnerabilityName,
      description: item.shortDescription,
      sourceUrl: refs[0] || `https://nvd.nist.gov/vuln/detail/${item.cveID}`,
      firstDiscoveredAt: item.dateAdded,
      lastUpdatedAt: item.dateAdded,

      // S1.1/S1.2.5: Zero invented CVSS
      cvssV3Score: undefined,
      cvssVersion: undefined,
      severity: "UNKNOWN" as ServiceSeverity,
      severitySource: "UNSPECIFIED",
      severityVerificationStatus: "UNVERIFIED",

      isKnownExploited: true,
      cisaKevStatus: "ACTIVE_EXPLOITED",
      cisaDateAdded: item.dateAdded,
      cisaDueDate: item.dueDate,
      cisaRequiredAction: item.requiredAction,
      knownRansomwareCampaignUse: item.knownRansomwareCampaignUse,

      affectedVendors: [item.vendorProject],
      affectedProducts: [item.product],
      references: refs,
    });
  }

  return {
    advisories,
    vulnerabilities,
    totalKevCatalogCount: data.count || rawList.length,
    filteredCount: advisories.length,
  };
}

export async function fetchCisaKevFeed(options: {
  maxRecords?: number;
  targetVendors?: string[];
  timeoutMs?: number;
} = {}): Promise<CisaKevSyncResult> {
  const maxEntries = options.maxRecords || 40;
  const targetVendors = options.targetVendors || ["Apple", "Samsung", "Huawei", "Google", "Android"];
  const timeoutMs = options.timeoutMs || 12000;
  const officialUrl =
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

  try {
    const res = await fetch(officialUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`CISA KEV feed returned HTTP ${res.status}: ${res.statusText}`);
    }

    const data: CisaKevCatalogFeed = await res.json();
    return parseCisaKevJson(data, maxEntries, targetVendors);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[CisaKevAdapter] Ingestion failed:", error);
    return {
      advisories: [],
      vulnerabilities: [],
      totalKevCatalogCount: 0,
      filteredCount: 0,
      error,
    };
  }
}

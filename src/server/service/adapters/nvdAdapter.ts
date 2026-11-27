/**
 * Signalyn Service Intelligence - NIST NVD API 2.0 Adapter (Source E)
 * 
 * Official Source: https://services.nvd.nist.gov/rest/json/cves/2.0
 * 
 * S1.1 Hardened Rules:
 * - Enriches CVEs with authoritative NIST CVSS v3.1 base score, severity vector, and description.
 * - Respects public API rate limits (650ms polite backoff).
 * - Distinguishes between successful enrichment, not found (404), and rate-limited responses (403/429).
 * - Never fabricates CVSS scores or fallback values.
 */

import {
  ServiceVulnerability,
  ServiceSeverity,
} from "../../../types/serviceIntelligence";

export interface NvdLookupResult {
  vulnerability?: ServiceVulnerability;
  success: boolean;
  status?: "SUCCESS" | "NOT_FOUND" | "RATE_LIMITED" | "ERROR";
  error?: string;
}

export interface NvdBatchAudit {
  cvesRequested: number;
  successfulResponses: number;
  cvesEnriched: number;
  cvesNotFound: number;
  rateLimitedResponses: number;
  unresolvedFailures: number;
}

export interface NvdBatchResult {
  vulnerabilities: ServiceVulnerability[];
  discoveredCount: number;
  audit: NvdBatchAudit;
  error?: string;
}

export function parseNvdCveItem(
  cve: any,
  fallbackTimestamp?: string
): ServiceVulnerability {
  const cleanCve = String(cve?.id || "").trim().toUpperCase();
  const descObj =
    (cve?.descriptions || []).find((d: any) => d.lang === "en") ||
    cve?.descriptions?.[0];
  const description = descObj?.value || "No description provided by NIST NVD.";

  let cvssScore: number | undefined;
  let cvssVersion: string | undefined;
  let cvssSeverity: ServiceSeverity = "NOT_AVAILABLE";

  const v31 = cve?.metrics?.cvssMetricV31?.[0]?.cvssData;
  const v30 = cve?.metrics?.cvssMetricV30?.[0]?.cvssData;
  const v2 = cve?.metrics?.cvssMetricV2?.[0]?.cvssData;
  const cvss = v31 || v30 || v2;

  if (cvss && typeof cvss.baseScore === "number") {
    cvssScore = cvss.baseScore;
    cvssVersion = v31 ? "3.1" : v30 ? "3.0" : v2 ? "2.0" : undefined;
    const rawSev = (cvss.baseSeverity || "").toUpperCase();
    if (rawSev === "CRITICAL") cvssSeverity = "CRITICAL";
    else if (rawSev === "HIGH") cvssSeverity = "HIGH";
    else if (rawSev === "MEDIUM") cvssSeverity = "MEDIUM";
    else if (rawSev === "LOW") cvssSeverity = "LOW";
    else cvssSeverity = "UNKNOWN";
  }

  const refs = (cve?.references || []).map((r: any) => r.url).filter(Boolean);
  const timestamp = fallbackTimestamp || new Date().toISOString();
  const hasVerifiedScore = typeof cvssScore === "number";

  return {
    cveId: cleanCve,
    title: `${cleanCve} — NIST NVD Vulnerability`,
    description,
    sourceUrl: `https://nvd.nist.gov/vuln/detail/${cleanCve}`,
    firstDiscoveredAt: cve?.published || timestamp,
    lastUpdatedAt: cve?.lastModified || timestamp,

    // Authoritative CVSS metrics (never invented or converted to 0 when absent)
    cvssV3Score: cvssScore,
    cvssVersion,
    severity: cvssSeverity,
    severitySource: hasVerifiedScore ? "NIST_NVD" : "UNSPECIFIED",
    severityVerificationStatus: hasVerifiedScore ? "OFFICIALLY_CONFIRMED" : "UNVERIFIED",

    // Decoupled exploitation status (updated only if combined with CISA KEV)
    isKnownExploited: false,
    cisaKevStatus: "NOT_EXPLOITED",

    affectedVendors: [],
    affectedProducts: [],
    references: refs,
  };
}

export async function fetchNvdCveDetails(
  cveId: string,
  timeoutMs = 8000
): Promise<NvdLookupResult> {
  const cleanCve = cveId.trim().toUpperCase();
  if (!/^CVE-\d{4}-\d{4,7}$/.test(cleanCve)) {
    return {
      success: false,
      status: "ERROR",
      error: `Invalid CVE format: ${cveId}`,
    };
  }

  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cleanCve)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SignalynServiceIntelligence/1.2.5 (Production Audit)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        return {
          success: false,
          status: "RATE_LIMITED",
          error: `NVD API Rate limit or 403 (${res.status})`,
        };
      }
      return {
        success: false,
        status: "ERROR",
        error: `NVD API returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const items = data.vulnerabilities || [];

    if (items.length === 0 || !items[0]?.cve) {
      return {
        success: false,
        status: "NOT_FOUND",
        error: `CVE not found in NVD: ${cleanCve}`,
      };
    }

    const vulnerability = parseNvdCveItem(items[0].cve);

    return {
      success: true,
      status: "SUCCESS",
      vulnerability,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, status: "ERROR", error };
  }
}

export async function batchEnrichCvesWithNvd(
  cveIds: string[],
  maxBatch = 6
): Promise<NvdBatchResult> {
  const targetCves = Array.from(new Set(cveIds)).slice(0, maxBatch);
  const vulnerabilities: ServiceVulnerability[] = [];
  const audit: NvdBatchAudit = {
    cvesRequested: targetCves.length,
    successfulResponses: 0,
    cvesEnriched: 0,
    cvesNotFound: 0,
    rateLimitedResponses: 0,
    unresolvedFailures: 0,
  };

  for (const id of targetCves) {
    const result = await fetchNvdCveDetails(id);
    if (result.success && result.vulnerability) {
      audit.successfulResponses++;
      audit.cvesEnriched++;
      vulnerabilities.push(result.vulnerability);
    } else {
      if (result.status === "NOT_FOUND") audit.cvesNotFound++;
      else if (result.status === "RATE_LIMITED") audit.rateLimitedResponses++;
      else audit.unresolvedFailures++;
    }
    // Polite pacing delay between NVD requests
    await new Promise((r) => setTimeout(r, 650));
  }

  return {
    vulnerabilities,
    discoveredCount: vulnerabilities.length,
    audit,
  };
}

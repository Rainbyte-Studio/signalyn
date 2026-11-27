/**
 * Signalyn Service Intelligence - Samsung Mobile Security Adapter (Source C — S1.2.5 Hardened)
 *
 * Official Source: https://security.samsungmobile.com/securityUpdate.smsb
 *
 * S1.2.5 Adapter Rules:
 * - Parses each monthly SMR section (e.g. SMR Oct-2026, SMR Sep-2026) independently by
 *   DOM/section boundaries so CVEs and SVEs (SVE-YYYY-XXXX) are associated ONLY with the
 *   monthly bulletin section that actually documents them
 * - Never reuses a static slice (e.g. uniqueCves.slice(25, 40)) across multiple SMR months
 * - Never carries CVEs forward across months automatically
 * - Extracts monthly and quarterly supported Galaxy model lists and binds them transparently
 */

import * as cheerio from "cheerio";
import {
  ServiceAdvisory,
  ServiceSeverity,
} from "../../../types/serviceIntelligence";

export interface SamsungSyncResult {
  advisories: ServiceAdvisory[];
  discoveredCount: number;
  monthlyModels: string[];
  quarterlyModels: string[];
  error?: string;
}

export interface SamsungSmrSectionExtraction {
  smrTag: string;
  yearStr: string;
  monthNum: string;
  publishedAt: string;
  cveIds: string[];
  sveIds: string[];
  highestSeverity: ServiceSeverity;
  hasDedicatedSectionBody: boolean;
}

const MONTH_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function parseSamsungSmrSectionsFromHtml(
  html: string,
  maxBulletins: number = 10
): SamsungSmrSectionExtraction[] {
  if (!html) return [];

  // Normalize whitespace in a copy for boundary scanning while preserving order
  const smrRegex = /SMR\s+([A-Za-z]{3})-(\d{4})/gi;
  interface SmrOccurrence {
    smrTag: string;
    monthStr: string;
    yearStr: string;
    index: number;
  }

  const occurrences: SmrOccurrence[] = [];
  let match: RegExpExecArray | null;
  while ((match = smrRegex.exec(html)) !== null) {
    const monthStr = match[1].toLowerCase();
    const yearStr = match[2];
    const canonicalSmr = `SMR ${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()}-${yearStr}`;
    occurrences.push({
      smrTag: canonicalSmr,
      monthStr,
      yearStr,
      index: match.index,
    });
  }

  if (occurrences.length === 0) {
    return [];
  }

  // Group occurrences by canonical SMR tag; find content blocks where each SMR is the active heading
  // Stop any SMR section before "Current Models for Monthly Security Updates" so schedule footers don't pollute SMR slices
  const scheduleBoundaryIdx = html.search(/Current Models for (?:Monthly|Quarterly) Security Updates/i);
  const effectiveHtmlEnd = scheduleBoundaryIdx !== -1 ? scheduleBoundaryIdx : html.length;

  const sectionMap = new Map<
    string,
    {
      smrTag: string;
      yearStr: string;
      monthNum: string;
      publishedAt: string;
      cves: Set<string>;
      sves: Set<string>;
      hasCritical: boolean;
      hasDedicatedBody: boolean;
    }
  >();

  for (let i = 0; i < occurrences.length; i++) {
    const curr = occurrences[i];
    const monthNum = MONTH_MAP[curr.monthStr] || "01";
    const publishedAt = `${curr.yearStr}-${monthNum}-01`;

    if (!sectionMap.has(curr.smrTag)) {
      sectionMap.set(curr.smrTag, {
        smrTag: curr.smrTag,
        yearStr: curr.yearStr,
        monthNum,
        publishedAt,
        cves: new Set<string>(),
        sves: new Set<string>(),
        hasCritical: false,
        hasDedicatedBody: false,
      });
    }

    if (curr.index >= effectiveHtmlEnd) continue;

    const nextIdx =
      i + 1 < occurrences.length
        ? Math.min(occurrences[i + 1].index, effectiveHtmlEnd)
        : effectiveHtmlEnd;

    const segment = html.slice(curr.index, nextIdx);
    const segmentCves = segment.match(/CVE-\d{4}-\d{4,7}/gi) || [];
    const segmentSves = segment.match(/SVE-\d{4}-\d+/gi) || [];

    const entry = sectionMap.get(curr.smrTag)!;
    if (segmentCves.length > 0 || segmentSves.length > 0) {
      entry.hasDedicatedBody = true;
      for (const c of segmentCves) entry.cves.add(c.toUpperCase());
      for (const s of segmentSves) entry.sves.add(s.toUpperCase());
      if (/\bcritical\b/i.test(segment)) {
        entry.hasCritical = true;
      }
    }
  }

  const results: SamsungSmrSectionExtraction[] = [];
  for (const entry of sectionMap.values()) {
    if (results.length >= maxBulletins) break;
    const cveIds = Array.from(entry.cves).sort();
    const sveIds = Array.from(entry.sves).sort();
    const highestSeverity: ServiceSeverity =
      cveIds.length === 0 && sveIds.length === 0
        ? "INFORMATIONAL"
        : entry.hasCritical
          ? "CRITICAL"
          : "HIGH";

    results.push({
      smrTag: entry.smrTag,
      yearStr: entry.yearStr,
      monthNum: entry.monthNum,
      publishedAt: entry.publishedAt,
      cveIds,
      sveIds,
      highestSeverity,
      hasDedicatedSectionBody: entry.hasDedicatedBody,
    });
  }

  return results;
}

export function parseSamsungSecurityHtml(
  html: string,
  options: {
    maxBulletins?: number;
    ingestionTimestamp?: string;
  } = {}
): {
  advisories: ServiceAdvisory[];
  monthlyModels: string[];
  quarterlyModels: string[];
} {
  const maxBulletins = options.maxBulletins || 10;
  const timestamp = options.ingestionTimestamp || new Date().toISOString();
  const officialUrl = "https://security.samsungmobile.com/securityUpdate.smsb";
  const $ = cheerio.load(html);

  const monthlyModels: string[] = [];
  const quarterlyModels: string[] = [];

  const bodyText = $("body").text().replace(/\s+/g, " ");
  const monthlyIdx = bodyText.indexOf("Current Models for Monthly Security Updates");
  const quarterlyIdx = bodyText.indexOf("Current Models for Quarterly Security Updates");
  const biannualIdx = bodyText.indexOf("Current Models for Biannual Security Updates");

  if (monthlyIdx !== -1) {
    const endIdx = quarterlyIdx !== -1 ? quarterlyIdx : monthlyIdx + 2500;
    const text = bodyText.slice(monthlyIdx, endIdx);
    const galaxyMatches = text.match(/Galaxy\s+[A-Za-z0-9\s+()-]+?(?=,|•|\n|Galaxy\s|$)/gi) || [];
    galaxyMatches.slice(0, 60).forEach((m) => {
      const clean = m.replace(/\s+/g, " ").trim();
      if (clean && clean.length >= 8 && !monthlyModels.includes(clean)) {
        monthlyModels.push(clean);
      }
    });
  }

  if (quarterlyIdx !== -1) {
    const endIdx = biannualIdx !== -1 ? biannualIdx : quarterlyIdx + 2500;
    const text = bodyText.slice(quarterlyIdx, endIdx);
    const galaxyMatches = text.match(/Galaxy\s+[A-Za-z0-9\s+()-]+?(?=,|•|\n|Galaxy\s|$)/gi) || [];
    galaxyMatches.slice(0, 60).forEach((m) => {
      const clean = m.replace(/\s+/g, " ").trim();
      if (clean && clean.length >= 8 && !quarterlyModels.includes(clean)) {
        quarterlyModels.push(clean);
      }
    });
  }

  const smrSections = parseSamsungSmrSectionsFromHtml(html, maxBulletins);
  const advisories: ServiceAdvisory[] = [];

  const combinedSupportedModels = Array.from(new Set([...monthlyModels, ...quarterlyModels]));
  const affectedProductsText =
    combinedSupportedModels.length > 0
      ? `Samsung Mobile Security Update Schedule Models: ${combinedSupportedModels.slice(0, 25).join(", ")}${combinedSupportedModels.length > 25 ? ` (+${combinedSupportedModels.length - 25} additional eligible Galaxy models)` : ""}`
      : "Samsung Galaxy devices eligible for Android/One UI Security Maintenance Releases (Galaxy S, Galaxy Z Fold/Flip, Galaxy A, Galaxy Tab series)";

  const affectedProducts =
    combinedSupportedModels.length > 0
      ? combinedSupportedModels.slice(0, 30)
      : ["Galaxy S Series", "Galaxy Z Series", "Galaxy A Series", "Galaxy Tab"];

  for (const section of smrSections) {
    const id = `adv-samsung-${section.yearStr}-${section.monthNum}`;
    const title = `Samsung Mobile Security Update — ${section.smrTag}`;

    const summary = section.hasDedicatedSectionBody
      ? `Official Samsung Security Maintenance Release (${section.smrTag}) documenting ${section.cveIds.length} Google Android CVE(s) and ${section.sveIds.length} Samsung Vulnerability and Exposure (SVE) item(s) specifically within the ${section.smrTag} bulletin section.`
      : `Official Samsung Security Maintenance Release (${section.smrTag}) listed on security.samsungmobile.com/securityUpdate.smsb. Full CVE/SVE table for ${section.smrTag} requires selecting that month's tab; zero cross-month CVEs carried forward.`;

    const notes = section.hasDedicatedSectionBody
      ? `Parsed strictly from the ${section.smrTag} section on security.samsungmobile.com (${section.cveIds.length} CVEs, ${section.sveIds.length} SVEs: ${section.sveIds.slice(0, 5).join(", ")}).`
      : `Referenced in SMR selector on security.samsungmobile.com; no cross-month CVE slice assigned.`;

    advisories.push({
      id,
      deterministicId: id,
      sourceId: "samsung-security",
      manufacturer: "Samsung",
      advisoryType: "SECURITY_UPDATE",
      title,
      summary,
      publishedAt: section.publishedAt,
      updatedAt: section.publishedAt,
      sourceUrl: officialUrl,
      normalizedSourceUrl: officialUrl,
      bulletinReference: section.smrTag,
      affectedProductsText,
      affectedProducts,
      affectedVersions: ["One UI 7", "One UI 6", "One UI 5", "Android 15", "Android 14"],
      fixedVersions: [],
      cveIds: section.cveIds,
      sveIds: section.sveIds,
      isZeroCveRelease: false,
      sourceVerifiedAt: timestamp,
      severity: section.highestSeverity,
      verificationStatus: "OFFICIALLY_CONFIRMED",
      ingestionTimestamp: timestamp,
      updateFrequency: "MONTHLY",
      notes,
    });
  }

  return {
    advisories,
    monthlyModels,
    quarterlyModels,
  };
}

export async function fetchSamsungSecurityBulletins(
  options: {
    maxBulletins?: number;
    timeoutMs?: number;
  } = {}
): Promise<SamsungSyncResult> {
  const maxBulletins = options.maxBulletins || 10;
  const timeoutMs = options.timeoutMs || 15000;
  const officialUrl = "https://security.samsungmobile.com/securityUpdate.smsb";

  try {
    const res = await fetch(officialUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Samsung Mobile Security page returned HTTP ${res.status}: ${res.statusText}`);
    }

    const html = await res.text();
    const timestamp = new Date().toISOString();
    const parsed = parseSamsungSecurityHtml(html, {
      maxBulletins,
      ingestionTimestamp: timestamp,
    });

    return {
      advisories: parsed.advisories,
      discoveredCount: parsed.advisories.length,
      monthlyModels: parsed.monthlyModels,
      quarterlyModels: parsed.quarterlyModels,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[SamsungSecurityAdapter] Extraction failed:", error);
    return {
      advisories: [],
      discoveredCount: 0,
      monthlyModels: [],
      quarterlyModels: [],
      error,
    };
  }
}


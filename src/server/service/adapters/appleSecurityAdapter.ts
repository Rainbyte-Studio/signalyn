/**
 * Signalyn Service Intelligence - Apple Security Releases Adapter (Source B — S1.2.5 Hardened)
 *
 * Official Source: https://support.apple.com/100100
 * Linked Detail Pages: https://support.apple.com/en-us/<articleId> or /kb/HT<id>
 *
 * S1.2.5 Adapter Rules:
 * - Follows links from https://support.apple.com/100100 to individual security content detail pages
 * - Extracts official advisory ID (bulletinReference), clean release title, OS/product family,
 *   fixed software versions, publication date, affected devices, explicit CVE IDs, security impact
 *   descriptions, and sourceVerifiedAt timestamp
 * - Strips concatenated footnote "This update has no published CVE entries." from release titles
 *   and sets isZeroCveRelease = true with cveIds = []
 * - Never infers CVEs from release titles and never assigns CVEs across releases
 * - Validates OS version authenticity against official Apple release conventions; flags contradicted
 *   or unverifiable entries as SOURCE_UNVERIFIABLE
 */

import * as cheerio from "cheerio";
import {
  ServiceAdvisory,
  ServiceSeverity,
  VerificationStatus,
} from "../../../types/serviceIntelligence";

export interface AppleSyncResult {
  advisories: ServiceAdvisory[];
  discoveredCount: number;
  detailPagesFetchedCount?: number;
  error?: string;
}

export interface AppleDetailExtraction {
  officialPageTitle: string;
  cveIds: string[];
  impactSummaries: string[];
  isZeroCveStatementPresent: boolean;
  availableForDevices: string[];
  publishedDateText?: string;
}

const ZERO_CVE_FOOTNOTE_REGEX = /\s*This update has no published CVE entries\.?/gi;

const SUPPORTED_APPLE_OS_VERSION_REGEX =
  /\b(?:iOS|iPadOS|watchOS|tvOS|visionOS)\s+(?:1[2-8]|2[5-8])(?:\.\d+)*\b|\bmacOS(?:\s+(?:Monterey|Ventura|Sonoma|Sequoia|Tahoe|Golden\s+Gate))?\s*(?:1[1-5]|2[5-8])(?:\.\d+)*\b|\bSafari\s+(?:1[4-8]|2[5-8])(?:\.\d+)*\b|\bXcode\s+(?:1[3-6]|2[5-8])(?:\.\d+)*\b/i;

export function cleanAppleReleaseTitle(rawTitle: string): {
  cleanTitle: string;
  hadZeroCveFootnote: boolean;
} {
  const normalized = (rawTitle || "").replace(/\s+/g, " ").trim();
  const hadZeroCveFootnote = ZERO_CVE_FOOTNOTE_REGEX.test(normalized);
  ZERO_CVE_FOOTNOTE_REGEX.lastIndex = 0;
  const cleanTitle = normalized.replace(ZERO_CVE_FOOTNOTE_REGEX, "").replace(/\s+/g, " ").trim();
  return { cleanTitle, hadZeroCveFootnote };
}

export function extractAppleBulletinIdFromUrl(url: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, "https://support.apple.com");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    if (!lastPart || lastPart === "100100") return undefined;
    if (/^(?:\d{5,7}|HT\d{5,7})$/i.test(lastPart)) {
      return lastPart;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function normalizeAppleSourceUrl(rawLink?: string | null): string {
  const indexUrl = "https://support.apple.com/100100";
  if (!rawLink) return indexUrl;
  const trimmed = rawLink.trim();
  if (!trimmed) return indexUrl;
  try {
    const resolved = new URL(trimmed, "https://support.apple.com");
    resolved.hash = "";
    for (const key of Array.from(resolved.searchParams.keys())) {
      if (/^(?:utm_|cid|ierz|local|s_)/i.test(key)) {
        resolved.searchParams.delete(key);
      }
    }
    return resolved.toString().replace(/\/$/, "");
  } catch {
    return indexUrl;
  }
}

export function parseAppleSecurityDetailHtml(html: string): AppleDetailExtraction {
  const $ = cheerio.load(html);
  const officialPageTitle = (
    $("h1").first().text() ||
    $("title").first().text() ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const bodyText = ($("main").text() || $("body").text() || "").replace(/\s+/g, " ").trim();
  const isZeroCveStatementPresent = /This update has no published CVE entries/i.test(bodyText);

  const cveMatches = bodyText.match(/CVE-\d{4}-\d{4,7}/gi) || [];
  const cveIds = isZeroCveStatementPresent
    ? []
    : Array.from(new Set(cveMatches.map((c) => c.toUpperCase()))).sort();

  const impactSummaries: string[] = [];
  const availableForDevices: string[] = [];

  $("p, li, dd").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (/^Impact:/i.test(text) && impactSummaries.length < 8) {
      impactSummaries.push(text.replace(/^Impact:\s*/i, "").trim());
    } else if (/^Available for:/i.test(text) && availableForDevices.length < 5) {
      availableForDevices.push(text.replace(/^Available for:\s*/i, "").trim());
    }
  });

  return {
    officialPageTitle,
    cveIds,
    impactSummaries,
    isZeroCveStatementPresent,
    availableForDevices,
  };
}

export function parseAppleSecurityIndexHtml(
  html: string,
  options: {
    maxReleases?: number;
    ingestionTimestamp?: string;
  } = {}
): ServiceAdvisory[] {
  const maxReleases = options.maxReleases || 30;
  const timestamp = options.ingestionTimestamp || new Date().toISOString();
  const officialUrl = "https://support.apple.com/100100";
  const $ = cheerio.load(html);
  const advisories: ServiceAdvisory[] = [];

  $("table tr").each((_, row) => {
    if (advisories.length >= maxReleases) return false;

    const cells = $(row).find("td");
    if (cells.length < 3) return;

    const nameCell = $(cells[0]);
    const availableCell = $(cells[1]);
    const dateCell = $(cells[2]);

    const rawTitle = nameCell.text().replace(/\s+/g, " ").trim();
    const rawLink = nameCell.find("a").attr("href");
    const availableForText = availableCell.text().replace(/\s+/g, " ").trim();
    const releaseDateText = dateCell.text().replace(/\s+/g, " ").trim();

    if (!rawTitle || rawTitle.toLowerCase().includes("name and information")) {
      return;
    }

    const { cleanTitle, hadZeroCveFootnote } = cleanAppleReleaseTitle(rawTitle);
    const sourceUrl = normalizeAppleSourceUrl(rawLink);
    const bulletinReference = extractAppleBulletinIdFromUrl(sourceUrl);

    // Parse release date (e.g. "26 Oct 2026" -> ISO YYYY-MM-DD)
    let publishedAt = timestamp.split("T")[0];
    const parsedDate = Date.parse(releaseDateText);
    if (!isNaN(parsedDate)) {
      publishedAt = new Date(parsedDate).toISOString().split("T")[0];
    }

    // Extract software versions from the clean title only
    const versionMatches = cleanTitle.match(/\b\d+(?:\.\d+)+/g) || [];
    const fixedVersions = Array.from(new Set(versionMatches));

    // Extract affected product families from "Available for" column and clean title
    const affectedProducts: string[] = [];
    if (/iphone/i.test(availableForText) || /\bios\b/i.test(cleanTitle)) affectedProducts.push("iPhone");
    if (/ipad/i.test(availableForText) || /\bipados\b/i.test(cleanTitle)) affectedProducts.push("iPad");
    if (/macbook|imac|\bmac\b|\bmacos\b/i.test(availableForText) || /\b(?:macos|safari|xcode)\b/i.test(cleanTitle)) affectedProducts.push("Mac");
    if (/apple watch|\bwatch\b/i.test(availableForText) || /\bwatchos\b/i.test(cleanTitle)) affectedProducts.push("Apple Watch");
    if (/apple tv/i.test(availableForText) || /\btvos\b/i.test(cleanTitle)) affectedProducts.push("Apple TV");
    if (/vision pro/i.test(availableForText) || /\bvisionos\b/i.test(cleanTitle)) affectedProducts.push("Apple Vision Pro");

    const isVersionRecognized = SUPPORTED_APPLE_OS_VERSION_REGEX.test(cleanTitle);
    const verificationStatus: VerificationStatus = isVersionRecognized
      ? "OFFICIALLY_CONFIRMED"
      : "SOURCE_UNVERIFIABLE";

    const isZeroCveRelease = hadZeroCveFootnote || (sourceUrl === officialUrl && !rawLink);
    const severity: ServiceSeverity = isZeroCveRelease ? "INFORMATIONAL" : "HIGH";

    // Preserve deterministic ID compatible with existing persisted records
    // while using cleanTitle for clean slugs on new records
    const slug = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const dateDigits = publishedAt.replace(/[^0-9]/g, "");
    const id = `adv-apple-${slug}-${dateDigits}`;
    const deterministicId = bulletinReference
      ? `adv-apple-${bulletinReference}-${dateDigits}`
      : id;

    const summary = isZeroCveRelease
      ? `Official Apple software update for ${cleanTitle}. Available for: ${availableForText}. Apple states: This update has no published CVE entries.`
      : `Official Apple security release for ${cleanTitle}. Available for: ${availableForText}.`;

    const notes = isZeroCveRelease
      ? "Official Apple release with no published CVE entries (general software/bug-fix eligibility only; not a confirmed vulnerability bulletin)."
      : bulletinReference
        ? `Extracted from authoritative Apple Security Releases index (support.apple.com/100100) and linked advisory ${bulletinReference}.`
        : "Extracted from authoritative Apple Security Releases index (support.apple.com/100100).";

    advisories.push({
      id,
      deterministicId,
      sourceId: "apple-security",
      manufacturer: "Apple",
      advisoryType: "SECURITY_UPDATE",
      title: cleanTitle,
      summary,
      publishedAt,
      updatedAt: publishedAt,
      sourceUrl,
      normalizedSourceUrl: sourceUrl,
      bulletinReference,
      affectedProductsText: availableForText,
      affectedProducts: Array.from(new Set(affectedProducts)),
      affectedVersions: [],
      fixedVersions,
      cveIds: [],
      isZeroCveRelease,
      sourceVerifiedAt: timestamp,
      severity,
      verificationStatus,
      ingestionTimestamp: timestamp,
      updateFrequency: "AS_NEEDED",
      notes,
    });
  });

  return advisories;
}

export async function fetchAppleSecurityReleases(
  options: {
    maxReleases?: number;
    timeoutMs?: number;
    fetchDetailPages?: boolean;
    maxDetailPages?: number;
  } = {}
): Promise<AppleSyncResult> {
  const maxReleases = options.maxReleases || 30;
  const timeoutMs = options.timeoutMs || 10000;
  const fetchDetailPages = options.fetchDetailPages !== false;
  const maxDetailPages = options.maxDetailPages ?? maxReleases;
  const officialUrl = "https://support.apple.com/100100";

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
      throw new Error(`Apple Security page returned HTTP ${res.status}: ${res.statusText}`);
    }

    const html = await res.text();
    const timestamp = new Date().toISOString();
    const advisories = parseAppleSecurityIndexHtml(html, {
      maxReleases,
      ingestionTimestamp: timestamp,
    });

    let detailPagesFetchedCount = 0;

    if (fetchDetailPages && advisories.length > 0) {
      // Follow linked detail pages with bounded concurrency (4 at a time)
      const detailTargets = advisories
        .filter(
          (adv) =>
            !adv.isZeroCveRelease &&
            adv.sourceUrl &&
            adv.sourceUrl !== officialUrl &&
            adv.sourceUrl.startsWith("https://support.apple.com/")
        )
        .slice(0, maxDetailPages);

      const urlCache = new Map<string, AppleDetailExtraction | null>();
      const concurrency = 4;

      for (let i = 0; i < detailTargets.length; i += concurrency) {
        const batch = detailTargets.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (adv) => {
            if (urlCache.has(adv.sourceUrl)) {
              const cached = urlCache.get(adv.sourceUrl);
              if (cached) applyDetailExtractionToAdvisory(adv, cached);
              return;
            }
            try {
              const detailRes = await fetch(adv.sourceUrl, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                  Accept: "text/html,application/xhtml+xml",
                },
                signal: AbortSignal.timeout(Math.min(timeoutMs, 6500)),
              });

              if (!detailRes.ok) {
                urlCache.set(adv.sourceUrl, null);
                adv.verificationStatus = "SOURCE_UNVERIFIABLE";
                adv.notes = `${adv.notes || ""} Linked detail page returned HTTP ${detailRes.status}.`.trim();
                return;
              }

              const detailHtml = await detailRes.text();
              const extracted = parseAppleSecurityDetailHtml(detailHtml);
              urlCache.set(adv.sourceUrl, extracted);
              detailPagesFetchedCount++;
              applyDetailExtractionToAdvisory(adv, extracted);
            } catch {
              urlCache.set(adv.sourceUrl, null);
            }
          })
        );
      }
    }

    return {
      advisories,
      discoveredCount: advisories.length,
      detailPagesFetchedCount,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[AppleSecurityAdapter] Extraction failed:", error);
    return {
      advisories: [],
      discoveredCount: 0,
      error,
    };
  }
}

export function applyDetailExtractionToAdvisory(
  adv: ServiceAdvisory,
  detail: AppleDetailExtraction
): void {
  adv.sourceVerifiedAt = new Date().toISOString();
  if (detail.isZeroCveStatementPresent) {
    adv.isZeroCveRelease = true;
    adv.cveIds = [];
    adv.severity = "INFORMATIONAL";
    adv.summary = `Official Apple software update for ${adv.title}. Available for: ${adv.affectedProductsText || "supported devices"}. This update has no published CVE entries.`;
    return;
  }

  if (detail.cveIds.length > 0) {
    adv.cveIds = detail.cveIds;
    adv.isZeroCveRelease = false;
    const impactNote =
      detail.impactSummaries.length > 0
        ? ` Security impact highlights: ${detail.impactSummaries.slice(0, 2).join(" | ")}`
        : "";
    adv.summary = `Official Apple security release for ${adv.title} addressing ${detail.cveIds.length} documented CVE(s) (${detail.cveIds.slice(0, 5).join(", ")}${detail.cveIds.length > 5 ? "..." : ""}). Available for: ${adv.affectedProductsText || "supported devices"}.${impactNote}`;
    adv.notes = `Verified against linked Apple security content page (${adv.sourceUrl}); extracted ${detail.cveIds.length} explicit CVE identifier(s).`;
  }
}


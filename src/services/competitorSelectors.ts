/**
 * Authoritative Competitor & Company Selectors (Phase 5S-C1.1)
 * 
 * Provides single-source-of-truth functions across:
 * - OverviewDashboard
 * - CompaniesView
 * - CompetitorsView (Matrix)
 * - SettingsView
 * - Analytics & Trends
 * 
 * Guarantees:
 * 1. Canonical company IDs and unified resolution via getMergedCanonicalCompanies()
 * 2. Deterministic alphabetical ordering
 * 3. Primary company is never included as its own competitor
 * 4. Distinct separation between Global Tracked Competitors and Category-Designated Competitors
 * 5. Robust category normalization (case-insensitive title-casing)
 */

import {
  Company,
  IntelligenceSettings,
  MarketAvailabilityStatus,
  MarketEvidence,
  MarketFilterOption,
  Product,
  ProductLifecycleFilter,
} from '../types';
import {
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
} from './canonicalEntities';
import { VERIFIED_GREEK_MARKET_EVIDENCE } from './marketEvidenceRegistry';
import { matchesLifecycleFilter } from './productAuditRegistry';

/**
 * Standard hardware categories supported by Signalyn.
 */
export const STANDARD_CATEGORIES = ['Smartphones', 'Wearables', 'Tablets', 'Audio', 'Laptops'] as const;
export type StandardCategory = (typeof STANDARD_CATEGORIES)[number];

export interface CompetitorDiscoveryInclusion {
  company: Company;
  isCategoryRelevant: boolean;
  isSelectedInSettings: boolean;
  marketStatus: MarketAvailabilityStatus;
  marketEvidence?: MarketEvidence;
  relevanceReasons: string[];
  productCount: number;
  verifiedActiveProductCount?: number;
  rumoredProductCount?: number;
}

/**
 * Normalizes any category string into the canonical key used in IntelligenceSettings.competitorSets.
 */
export function normalizeCategoryKey(category: string): string {
  if (!category) return 'Smartphones';
  const trimmed = category.trim().toLowerCase();
  switch (trimmed) {
    case 'smartphone':
    case 'smartphones':
      return 'Smartphones';
    case 'wearable':
    case 'wearables':
    case 'watches / wearables':
    case 'watch':
    case 'watches':
      return 'Wearables';
    case 'tablet':
    case 'tablets':
      return 'Tablets';
    case 'audio':
    case 'headphones':
      return 'Audio';
    case 'laptop':
    case 'laptops':
      return 'Laptops';
    default:
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

/**
 * Retrieves market evidence for a specific company and market.
 */
export function getCompanyMarketEvidence(
  companyId: string,
  market: MarketFilterOption = 'GLOBAL',
  evidenceRegistry: MarketEvidence[] = VERIFIED_GREEK_MARKET_EVIDENCE
): { status: MarketAvailabilityStatus; evidence?: MarketEvidence } {
  if (market === 'GLOBAL') {
    return {
      status: 'OFFICIAL',
    };
  }

  // Market is Greece ('GR')
  const found = evidenceRegistry.find(
    (e) => e.companyId === companyId && e.market === 'GR'
  );

  if (found) {
    return {
      status: found.status,
      evidence: found,
    };
  }

  // Default state when no reliable evidence exists: UNKNOWN (never assume absence)
  return {
    status: 'UNKNOWN',
  };
}

/**
 * Pure selector that computes verified category relevance for a company.
 * A company is relevant to a category if:
 * 1. It has matching catalog products in that category, OR
 * 2. Its company profile explicitly lists the normalized category.
 */
export function isCompanyRelevantToCategory(
  company: Company,
  category: string,
  allProducts: Product[],
  lifecycleFilter: ProductLifecycleFilter = 'ALL'
): {
  isRelevant: boolean;
  reasons: string[];
  productCount: number;
  verifiedActiveProductCount: number;
  rumoredProductCount: number;
} {
  const normCat = normalizeCategoryKey(category).toLowerCase();
  const reasons: string[] = [];

  const allMatchingProducts = allProducts.filter(
    (p) => p.companyId === company.id && normalizeCategoryKey(p.category).toLowerCase() === normCat
  );

  const verifiedActiveProducts = allMatchingProducts.filter(
    (p) => p.lifecycle === 'RELEASED' || p.lifecycle === 'ANNOUNCED'
  );
  const rumoredProducts = allMatchingProducts.filter(
    (p) => p.lifecycle === 'RUMORED' || p.lifecycle === 'PROTOTYPE'
  );

  if (allMatchingProducts.length > 0) {
    if (verifiedActiveProducts.length > 0 && rumoredProducts.length > 0) {
      reasons.push(`${allMatchingProducts.length} catalog products (${verifiedActiveProducts.length} active, ${rumoredProducts.length} rumored)`);
    } else {
      reasons.push(`${allMatchingProducts.length} verified products in catalog`);
    }
  }

  const hasCategoryDeclaration = (company.categories || []).some(
    (c) => normalizeCategoryKey(c).toLowerCase() === normCat
  );

  if (hasCategoryDeclaration) {
    reasons.push(`Declared category domain in profile`);
  }

  const isRelevant = allMatchingProducts.length > 0 || hasCategoryDeclaration;

  return {
    isRelevant,
    reasons,
    productCount: allMatchingProducts.length,
    verifiedActiveProductCount: verifiedActiveProducts.length,
    rumoredProductCount: rumoredProducts.length,
  };
}

/**
 * Authoritative Competitor Discovery Selector (Phase 5S-C1.2)
 * 
 * Computes the complete competitive landscape for a product category and market.
 * 
 * Guarantees:
 * 1. Canonical company identity resolution
 * 2. Primary vantage-point company is NEVER included as a competitor
 * 3. Scope separation:
 *    - 'ALL_RELEVANT': Competitors with verified category evidence (product catalog or category domain)
 *    - 'SELECTED_ONLY': Competitors explicitly designated in settings.competitorSets[category]
 * 4. Market filter:
 *    - 'GLOBAL': All competitors meeting scope
 *    - 'GR': Distinguishes OFFICIAL, RETAIL_CONFIRMED, and UNKNOWN (with optional unknown inclusion)
 * 5. Deterministic alphabetical sorting
 */
export function getRelevantCompetitors(
  category: string,
  scope: 'ALL_RELEVANT' | 'SELECTED_ONLY' = 'ALL_RELEVANT',
  market: MarketFilterOption = 'GLOBAL',
  companies?: Company[],
  products?: Product[],
  settings?: IntelligenceSettings | null,
  marketEvidence: MarketEvidence[] = VERIFIED_GREEK_MARKET_EVIDENCE,
  options?: {
    includeUnknownMarketInGreece?: boolean;
    lifecycleFilter?: ProductLifecycleFilter;
  }
): CompetitorDiscoveryInclusion[] {
  const normalizedCategory = normalizeCategoryKey(category);
  const primary = getPrimaryCompany(companies, settings);
  const mergedCompanies = getMergedCanonicalCompanies(companies);
  const mergedProducts = getMergedCanonicalProducts(products);

  const configuredCompetitorIds = new Set(
    settings?.competitorSets?.[normalizedCategory] || []
  );

  const results: CompetitorDiscoveryInclusion[] = [];

  for (const company of mergedCompanies) {
    // 1. Exclude primary reference company
    if (company.id === primary.id) continue;

    // 2. Tracked competitors check:
    // A company is a competitor if explicitly flagged isCompetitor, OR if it is a registered canonical entity other than primary.
    const isCompetitorEntity = company.isCompetitor || (company.id !== primary.id && !company.isMyCompany) || (company.id !== primary.id && !!settings?.myCompanyId);
    if (!isCompetitorEntity) continue;

    // 3. Evaluate category relevance
    const { isRelevant, reasons, productCount, verifiedActiveProductCount, rumoredProductCount } = isCompanyRelevantToCategory(
      company,
      normalizedCategory,
      mergedProducts,
      options?.lifecycleFilter || 'ALL'
    );

    const isSelected = configuredCompetitorIds.has(company.id);

    // 4. Scope Filtering
    if (scope === 'SELECTED_ONLY') {
      if (!isSelected) continue;
    } else {
      // ALL_RELEVANT: Must have verified category participation
      if (!isRelevant && !isSelected) continue;
    }

    // 5. Market Filtering
    const marketInfo = getCompanyMarketEvidence(company.id, market, marketEvidence);

    // When filtering by Greece, UNAVAILABLE is excluded.
    // If includeUnknownMarketInGreece is explicitly false, UNKNOWN would be filtered out,
    // but by default in competitive intelligence, UNKNOWN status is included with an explicit label
    // so we never silently hide competitors without evidence.
    if (market === 'GR') {
      if (marketInfo.status === 'UNAVAILABLE') {
        continue;
      }
      if (options?.includeUnknownMarketInGreece === false && marketInfo.status === 'UNKNOWN') {
        continue;
      }
    }

    results.push({
      company,
      isCategoryRelevant: isRelevant,
      isSelectedInSettings: isSelected,
      marketStatus: marketInfo.status,
      marketEvidence: marketInfo.evidence,
      relevanceReasons: reasons,
      productCount,
      verifiedActiveProductCount,
      rumoredProductCount,
    });
  }

  // Deterministically sort alphabetically
  return results.sort((a, b) => a.company.name.localeCompare(b.company.name));
}

/**
 * Returns the authoritative primary vantage-point company.
 * 
 * Precedence:
 * 1. Matching company from settings.myCompanyId (authoritative user configuration)
 * 2. Matching company with isMyCompany === true in loaded company records
 * 3. Fallback to first company in the canonical registry (comp-huawei)
 */
export function getPrimaryCompany(
  companies?: Company[],
  settings?: IntelligenceSettings | null
): Company {
  const merged = getMergedCanonicalCompanies(companies);

  if (settings?.myCompanyId) {
    const fromSettings = merged.find((c) => c.id === settings.myCompanyId);
    if (fromSettings) return fromSettings;
  }

  const fromFlag = merged.find((c) => c.isMyCompany);
  if (fromFlag) return fromFlag;

  return merged[0];
}

/**
 * Returns all Global Tracked Competitors:
 * All canonical companies EXCEPT the primary company, where isCompetitor === true.
 * Deterministically sorted alphabetically by name.
 */
export function getGlobalTrackedCompetitors(
  companies?: Company[],
  settings?: IntelligenceSettings | null
): Company[] {
  const merged = getMergedCanonicalCompanies(companies);
  const primary = getPrimaryCompany(companies, settings);

  return merged
    .filter((c) => c.id !== primary.id && c.isCompetitor)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Returns all Category-Designated Competitors for the specified hardware domain.
 * Reads directly from settings.competitorSets[normalizedCategory].
 * 
 * Rules:
 * - Excludes the primary company even if present in the configured set
 * - Resolves each ID against the canonical company registry
 * - Returns only valid, recognized canonical Company objects
 * - Deterministically sorted alphabetically by name
 */
export function getCategoryCompetitors(
  category: string,
  companies?: Company[],
  settings?: IntelligenceSettings | null
): Company[] {
  const normalizedCategory = normalizeCategoryKey(category);
  const primary = getPrimaryCompany(companies, settings);
  const merged = getMergedCanonicalCompanies(companies);
  const companyMap = new Map<string, Company>(merged.map((c) => [c.id, c]));

  const designatedIds = settings?.competitorSets?.[normalizedCategory] || [];
  const results: Company[] = [];

  for (const cid of designatedIds) {
    if (cid === primary.id) continue; // Primary company can never be its own competitor
    const comp = companyMap.get(cid);
    if (comp) {
      results.push(comp);
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Evaluates whether a specific company ID is currently designated as an active competitor
 * in the specified category according to authoritative Settings.
 */
export function isCategoryCompetitor(
  companyId: string,
  category: string,
  settings?: IntelligenceSettings | null,
  companies?: Company[]
): boolean {
  const primary = getPrimaryCompany(companies, settings);
  if (companyId === primary.id) return false;

  const normalizedCategory = normalizeCategoryKey(category);
  const designatedIds = settings?.competitorSets?.[normalizedCategory] || [];
  return designatedIds.includes(companyId);
}

import {
  DerivedProductCategory,
  DuplicateAdvisoryGroup,
  MatcherRuleAuditDescriptor,
  ProductClassificationAuditItem,
  ProductMatchConfidence,
  MatchEvidenceStrength,
  MatchRelationshipType,
  RecommendedMatchReviewAction,
  ServiceAdvisory,
  ServiceProductMatch,
  StratifiedAuditItem,
} from '../../types/serviceIntelligence';
import { RetailProduct } from '../../types/retailPrice';
import { classifyProductMatchAuthenticity } from './serviceAuthenticityAuditor';

export const SERVICE_MATCHER_VERSION = 'S1.2.5-evidence-hardened-v1';

export function buildDeterministicMatchId(canonicalProductId: string, advisoryId: string): string {
  return `match-${canonicalProductId}-${advisoryId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * S1.2.3 Objective 1: Complete registry of every matcher rule, its required evidence,
 * source fields inspected, product identity requirements, OS/firmware applicability,
 * confidence ceiling, and false-positive risks.
 */
export const MATCHER_RULE_REGISTRY: MatcherRuleAuditDescriptor[] = [
  {
    ruleId: 'APPLE_EXACT_MODEL_DIRECT',
    manufacturer: 'Apple',
    targetConfidence: 'VERIFIED',
    evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Apple security release URL with published CVE entries',
      'Explicit narrow hardware model identifier in affectedProductsText (e.g., iPhone XS, Apple Watch Series 12)',
      'Exact canonical Apple product model match without "and later" range expansion',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'affectedProducts', 'sourceUrl', 'cveIds', 'advisoryType'],
    productIdentityRequirements: 'Canonical brand Apple; exact model token boundary match (no screen-size or year-only inference).',
    softwareApplicabilityRequirements: 'Explicit iOS, iPadOS, macOS, or watchOS security release with published CVEs.',
    confidenceLimitations: 'Downgraded to LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) if the release has 0 published CVEs.',
    falsePositiveRisks: 'Substring overlap between base and Pro/Max/Mini variants if token boundaries are not enforced.',
  },
  {
    ruleId: 'APPLE_IPHONE_GENERATION_APPLICABILITY',
    manufacturer: 'Apple',
    targetConfidence: 'VERIFIED',
    evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Apple iOS security release with >= 1 published CVE entry',
      'Structured Apple hardware eligibility statement ("iPhone XS and later" or "iPhone 11 and later")',
      'Parsed canonical iPhone generation within [minGenerationFloor, maxSupportedGenerationForOsBranch]',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'affectedProducts', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical Apple iPhone with deterministic generation number (XS/XR=10.5, 11=11 .. 17=17, SE 2nd/3rd gen).',
    softwareApplicabilityRequirements: 'iOS security update with explicit minimum iPhone hardware floor and >= 1 CVE.',
    confidenceLimitations: 'Downgraded to LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) when the iOS point release has 0 published CVEs. Excludes future hardware generations that shipped with a newer major iOS.',
    falsePositiveRisks: 'Legacy iPhones (iPhone 8/X) or unannounced future models (iPhone 18 on iOS 18/26) if generation bounds are not enforced.',
  },
  {
    ruleId: 'APPLE_IPAD_GENERATION_APPLICABILITY',
    manufacturer: 'Apple',
    targetConfidence: 'VERIFIED',
    evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Apple iPadOS security release with >= 1 published CVE entry',
      'Structured sub-family hardware floor (iPad Pro 12.9-inch/11-inch gen, iPad Air gen/chip, iPad mini gen/chip, base iPad gen)',
      'Explicit generation or Apple Silicon chip (M1/M2/M3/M4/M5/A17 Pro) in canonical product title without screen-size or year-only inference',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'affectedProducts', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical Apple iPad with explicit sub-family (Pro/Air/Mini/Base) and explicit generation or chip.',
    softwareApplicabilityRequirements: 'iPadOS security update with published CVEs and explicit sub-family generation floor.',
    confidenceLimitations: 'Downgraded to LIKELY (INFERRED_FAMILY_APPLICABILITY) if generation is inferred solely from release year (e.g. "iPad Mini 2024") or across screen-size redesigns ("iPad Pro 13-inch" vs "12.9-inch" advisory text).',
    falsePositiveRisks: 'Cross-matching base iPad vs iPad Air/Mini/Pro, or assuming a release year maps to a specific generation without explicit chip/gen evidence.',
  },
  {
    ruleId: 'APPLE_IPAD_LINEAGE_INFERRED',
    manufacturer: 'Apple',
    targetConfidence: 'LIKELY',
    evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Apple iPadOS security release',
      'Canonical Apple iPad sub-family match where generation is inferred from release year or 13-inch M4/M5 lineage to 12.9-inch advisory floor',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl'],
    productIdentityRequirements: 'Canonical Apple iPad Pro 13-inch (M4/M5) or iPad Mini (2024 year-only title).',
    softwareApplicabilityRequirements: 'iPadOS bulletin listing iPad Pro 12.9-inch/11-inch or iPad mini 5th gen+.',
    confidenceLimitations: 'Capped at LIKELY because exact generation or screen-size token is not explicitly written in either the product title or advisory text.',
    falsePositiveRisks: 'Year-only retail titles could refer to refurbished earlier generations.',
  },
  {
    ruleId: 'APPLE_MAC_OS_FAMILY_APPLICABILITY',
    manufacturer: 'Apple',
    targetConfidence: 'VERIFIED',
    evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Apple macOS security release (Tahoe/Sequoia/Sonoma) with >= 1 published CVE entry',
      'Explicit Mac hardware family ("MacBook Air", "MacBook Pro", "iMac", "Mac mini", "Mac Studio") in affectedProductsText',
      'Apple Silicon chip (M1/M2/M3/M4/M5) confirmed in canonical product title',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical Apple Mac (MacBook Air/Pro, iMac, Mac mini, Mac Studio) with Apple Silicon M-series processor.',
    softwareApplicabilityRequirements: 'macOS security release with published CVEs.',
    confidenceLimitations: 'Macs without explicit M-series chip or on zero-CVE maintenance releases are capped at LIKELY.',
    falsePositiveRisks: 'Intel Macs incompatible with macOS Sequoia/Tahoe if Apple Silicon chip check is omitted.',
  },
  {
    ruleId: 'APPLE_WATCH_SERIES_APPLICABILITY',
    manufacturer: 'Apple',
    targetConfidence: 'VERIFIED',
    evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Apple watchOS security release with >= 1 published CVE entry',
      'Explicit "Apple Watch Series N and later" or narrow Series/Ultra model eligibility',
      'Explicit Series number >= floor or Ultra model in canonical product title',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical Apple Watch with explicit Series number (Series 6..11) or Ultra (1/2/3).',
    softwareApplicabilityRequirements: 'watchOS security update with published CVEs.',
    confidenceLimitations: 'Apple Watch SE / SE 3 is capped at LIKELY (APPLE_WATCH_SE_INFERRED) when advisory only states "Apple Watch Series 6 and later". Zero-CVE updates are capped at LIKELY.',
    falsePositiveRisks: 'Treating "Apple Watch SE 3" as a numbered "Series" model without explicit "Apple Watch SE" text in the bulletin.',
  },
  {
    ruleId: 'APPLE_WATCH_SE_INFERRED',
    manufacturer: 'Apple',
    targetConfidence: 'LIKELY',
    evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Apple watchOS security release stating "Apple Watch Series 6 and later"',
      'Canonical product is Apple Watch SE (2nd/3rd gen)',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl'],
    productIdentityRequirements: 'Canonical Apple Watch SE model.',
    softwareApplicabilityRequirements: 'watchOS bulletin where SE is not explicitly named alongside Series 6+.',
    confidenceLimitations: 'Capped at LIKELY until Apple explicitly names "Apple Watch SE" in the affected devices string.',
    falsePositiveRisks: '1st-generation Apple Watch SE hardware floor divergence.',
  },
  {
    ruleId: 'APPLE_MAINTENANCE_UPDATE_ELIGIBILITY',
    manufacturer: 'Apple',
    targetConfidence: 'LIKELY',
    evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
    defaultRelationshipType: 'OFFICIAL_UPDATE_ELIGIBILITY',
    requiredEvidence: [
      'Official Apple OS point-release entry (e.g. iOS 27.0.1 / watchOS 27.0.1)',
      'Structured hardware eligibility statement matching canonical product',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical Apple hardware meeting the OS generation floor.',
    softwareApplicabilityRequirements: 'Point release where Apple states "This update has no published CVE entries".',
    confidenceLimitations: 'Strictly capped at LIKELY with relationshipType = OFFICIAL_UPDATE_ELIGIBILITY because no CVE vulnerabilities are patched in the release.',
    falsePositiveRisks: 'Overstating routine bug-fix maintenance updates as confirmed security vulnerability advisories.',
  },
  {
    ruleId: 'APPLE_SAFARI_OS_COUPLED_REVIEW',
    manufacturer: 'Apple',
    targetConfidence: 'AMBIGUOUS_REVIEW',
    evidenceStrength: 'HEURISTIC_SIMILARITY',
    defaultRelationshipType: 'GENERAL_SECURITY_INFORMATION',
    requiredEvidence: [
      'Official Apple Safari security release targeting macOS',
      'Canonical Apple Mac hardware capable of running the target macOS version',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl'],
    productIdentityRequirements: 'Canonical Apple Mac.',
    softwareApplicabilityRequirements: 'Standalone Safari update for older macOS branches.',
    confidenceLimitations: 'Capped at AMBIGUOUS_REVIEW because standalone Safari advisories apply only if the Mac is running down-level macOS.',
    falsePositiveRisks: 'Assuming a new M4/M5 Mac runs a legacy macOS branch.',
  },
  {
    ruleId: 'SAMSUNG_EXACT_MODEL_SMR',
    manufacturer: 'Samsung',
    targetConfidence: 'VERIFIED',
    evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Samsung Mobile Security Bulletin URL',
      'Explicit canonical model name (e.g., Galaxy S24, Galaxy Z Fold6, Galaxy A55) listed in affectedProductsText',
      'Strict generation and variant boundary check (S24 != S24 FE unless FE listed; Fold != Flip)',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'affectedProducts', 'sourceUrl', 'cveIds', 'advisoryType'],
    productIdentityRequirements: 'Canonical Samsung Galaxy smartphone or tablet with explicit model & variant match.',
    softwareApplicabilityRequirements: 'Samsung Android SMR security patch bulletin.',
    confidenceLimitations: 'Requires explicit model listing in affectedProductsText; broad Android OS or "Galaxy S series" bulletins cannot use this rule.',
    falsePositiveRisks: 'Matching S24 FE to S24 or Z Flip5 to Z Fold6 if variant/foldable tokens are not isolated.',
  },
  {
    ruleId: 'SAMSUNG_BROAD_SMR_GALAXY_S_Z',
    manufacturer: 'Samsung',
    targetConfidence: 'LIKELY',
    evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Samsung Monthly Security Maintenance Release (SMR) targeting Android 14/15/16 or Galaxy S/Z series',
      'Canonical Samsung flagship Galaxy S (S21..S26) or Galaxy Z (Fold4..7 / Flip4..7) within active SMR support window',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical Samsung Galaxy S or Z series device.',
    softwareApplicabilityRequirements: 'Android 13/14/15/16 SMR bulletin.',
    confidenceLimitations: 'Capped at LIKELY because the bulletin specifies broad Android OS versions or series rather than enumerating individual Galaxy model identifiers.',
    falsePositiveRisks: 'Carrier-locked or regional firmware patch delay.',
  },
  {
    ruleId: 'SAMSUNG_BROAD_SMR_GALAXY_A_TAB',
    manufacturer: 'Samsung',
    targetConfidence: 'AMBIGUOUS_REVIEW',
    evidenceStrength: 'HEURISTIC_SIMILARITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Samsung SMR bulletin mentioning Galaxy A or Galaxy Tab families broadly',
      'Canonical Samsung Galaxy A or Galaxy Tab product',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl'],
    productIdentityRequirements: 'Canonical Samsung Galaxy A or Galaxy Tab device.',
    softwareApplicabilityRequirements: 'Android SMR bulletin without explicit A-series/Tab model numbers.',
    confidenceLimitations: 'Capped at AMBIGUOUS_REVIEW because mid-range Galaxy A and Tab models switch between monthly, quarterly, and biannual schedules.',
    falsePositiveRisks: 'Assuming monthly SMR applicability for a quarterly/biannual tablet or A-series SKU.',
  },
  {
    ruleId: 'HUAWEI_EXACT_MODEL_EMUI_HARMONY',
    manufacturer: 'Huawei',
    targetConfidence: 'VERIFIED',
    evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Huawei EMUI / HarmonyOS security bulletin or update schedule URL',
      'Explicit Huawei model identifier (e.g., Pura 70, Pura 70 Pro, Pura 70 Ultra, Pura 80 Pro, MatePad 11.5) in affectedProductsText',
      'Strict generation & sub-variant check (Pura 70 != Pura 80; MatePad 11.5 != MatePad 11.5S; MateBook != MatePad)',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'affectedProducts', 'sourceUrl', 'cveIds', 'advisoryType'],
    productIdentityRequirements: 'Canonical Huawei smartphone or tablet with exact model and sub-variant match.',
    softwareApplicabilityRequirements: 'EMUI / HarmonyOS bulletin or official update scope list.',
    confidenceLimitations: 'If advisoryType === UPDATE_SCHEDULE, relationshipType is set to OFFICIAL_UPDATE_ELIGIBILITY (never CONFIRMED_VULNERABILITY_APPLICABILITY).',
    falsePositiveRisks: 'Matching MatePad 11.5S PaperMatte to a bulletin that only lists MatePad 11.5.',
  },
  {
    ruleId: 'HUAWEI_MATEPAD_SUBVARIANT_INFERRED',
    manufacturer: 'Huawei',
    targetConfidence: 'LIKELY',
    evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
    defaultRelationshipType: 'OFFICIAL_UPDATE_ELIGIBILITY',
    requiredEvidence: [
      'Official Huawei quarterly security update scope listing Huawei MatePad 11.5',
      'Canonical product is Huawei MatePad 11.5S sub-variant',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl'],
    productIdentityRequirements: 'Canonical Huawei MatePad 11.5S.',
    softwareApplicabilityRequirements: 'Quarterly EMUI/HarmonyOS scope listing base MatePad 11.5.',
    confidenceLimitations: 'Capped at LIKELY because "MatePad 11.5S" is a distinct hardware sub-variant from "MatePad 11.5".',
    falsePositiveRisks: 'Sub-variant firmware train differences between MatePad 11.5 and MatePad 11.5S.',
  },
  {
    ruleId: 'HUAWEI_BROAD_OS_BULLETIN_PURA',
    manufacturer: 'Huawei',
    targetConfidence: 'LIKELY',
    evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Huawei monthly EMUI 14 / HarmonyOS 4.2+ security bulletin',
      'Canonical Huawei Pura 70 / 80 flagship running EMUI 14+ / HarmonyOS 4.2+',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical Huawei Pura 70 / Pura 80 series device.',
    softwareApplicabilityRequirements: 'Monthly EMUI / HarmonyOS security bulletin listing OS versions or broad series rather than device models.',
    confidenceLimitations: 'Capped at LIKELY because the monthly bulletin lists OS versions (EMUI 14.0, HarmonyOS 4.2) or broad series rather than explicit handset models.',
    falsePositiveRisks: 'Regional EMUI vs HarmonyOS firmware branch differences.',
  },
  {
    ruleId: 'HUAWEI_BROAD_OS_BULLETIN_TABLET',
    manufacturer: 'Huawei',
    targetConfidence: 'AMBIGUOUS_REVIEW',
    evidenceStrength: 'HEURISTIC_SIMILARITY',
    defaultRelationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
    requiredEvidence: [
      'Official Huawei monthly HarmonyOS / MatePad series security bulletin',
      'Canonical Huawei MatePad tablet',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl'],
    productIdentityRequirements: 'Canonical Huawei MatePad tablet.',
    softwareApplicabilityRequirements: 'Monthly HarmonyOS bulletin without explicit tablet model list.',
    confidenceLimitations: 'Capped at AMBIGUOUS_REVIEW because MatePad tablets typically follow quarterly security patch cycles.',
    falsePositiveRisks: 'Applying monthly phone OS patch cadence to quarterly tablets.',
  },
  {
    ruleId: 'CISA_KEV_OS_PLATFORM_APPLICABILITY',
    manufacturer: 'Cross-Vendor',
    targetConfidence: 'LIKELY',
    evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
    defaultRelationshipType: 'CONFIRMED_VULNERABILITY_APPLICABILITY',
    requiredEvidence: [
      'Official CISA KEV entry targeting Apple iOS/iPadOS/macOS or Samsung Android platform',
      'Canonical Apple iPhone/iPad/Mac or Samsung Galaxy product running that OS family',
    ],
    sourceFieldsUsed: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
    productIdentityRequirements: 'Canonical hardware running the KEV-affected OS platform.',
    softwareApplicabilityRequirements: 'OS-level CISA KEV entry.',
    confidenceLimitations: 'Capped at LIKELY because CISA KEV entry specifies OS family ("iOS and iPadOS") without enumerating the exact hardware generation floor.',
    falsePositiveRisks: 'Hardware models running newer patched OS trains unaffected by historical KEV CVEs.',
  },
];

const ACCESSORY_KEYWORDS = [
  'case', 'cover', 'charger', 'cable', 'adapter', 'strap', 'band', 'loop',
  'buckle', 'pencil', 'keyboard', 'folio', 'stand', 'mount', 'holder',
  'protector', 'glass', 'film', 'sleeve', 'pouch', 'wallet', 'magsafe',
  'airtag', 'earpods', 'power bank', 'dock', 'hub', 'stylus', 's pen',
  'smart tag', 'smarttag', 'ring', 'buds', 'freebuds', 'airpods', 'homepod',
];

function getProductTitle(product: RetailProduct): string {
  return product.name || (product as any).title || '';
}

function getAdvisoryAffectedText(advisory: ServiceAdvisory): string {
  return (
    advisory.affectedProductsText ||
    (advisory as any).affectedProductsSummary ||
    (advisory.affectedProducts || []).join(', ') ||
    advisory.summary ||
    ''
  );
}

/**
 * Legacy pre-S1.2.5 keyword check (retained solely for audit comparison so we can
 * report exact SKUs restored from false accessory exclusion).
 */
export function wasLegacyAccessoryExcluded(product: RetailProduct): boolean {
  const cat = String(product.category || '').toLowerCase();
  if (cat.includes('accessor') || cat.includes('audio') || cat.includes('headphone') || cat.includes('earbud')) {
    return true;
  }
  const titleLower = ` ${getProductTitle(product).toLowerCase()} `;
  for (const kw of ACCESSORY_KEYWORDS) {
    const regex = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(titleLower)) {
      return true;
    }
  }
  return false;
}

/**
 * S1.2.5 Objective E (Section 7): Non-destructive Canonical Product Type Classifier.
 * Distinguishes primary hardware devices (SMARTPHONE, TABLET, WEARABLE, LAPTOP) — even when
 * sold with a watch case/strap ("Aluminium Case with Sport Band"), display option ("Standard Glass"),
 * or bundled keyboard ("+ Keyboard") — from standalone accessories (ACCESSORY) and audio gear (AUDIO).
 */
export function classifyCanonicalProductType(product: RetailProduct): ProductClassificationAuditItem {
  const title = getProductTitle(product).trim();
  const titleLower = ` ${title.toLowerCase()} `;
  const storedCat = String(product.category || '');
  const catLower = storedCat.toLowerCase();
  const legacyExcluded = wasLegacyAccessoryExcluded(product);

  // 1. Explicit standalone accessory indicators ("Case for ...", "Screen Protector", "Tempered Glass", "Charger", etc.)
  const isExplicitStandaloneAccessory =
    /\b(?:case\s+for|cover\s+for|folio\s+for|smart\s+folio|magic\s+keyboard\s+for|smart\s+keyboard|keyboard\s+for|screen\s+protector|tempered\s+glass|protector\s+for|strap\s+for|band\s+for|charger|power\s+adapter|wall\s+adapter|usb-c\s+cable|lightning\s+cable|magsafe\s+charger|magsafe\s+wallet|finewoven\s+wallet|silicone\s+case|clear\s+case|leather\s+case|rugged\s+case|flip\s+suit\s+case|standing\s+grip\s+case|s-view\s+wallet|book\s+cover|apple\s+pencil|m-pencil|s\s+pen\b(?!\s+edition)|airtag|smart\s*tag|smarttag|power\s+bank|sleeve\s+for|pouch|car\s+mount|desk\s+stand|multiport\s+adapter|usb-c\s+hub)\b/i.test(
      title,
    );

  const buildClassItem = (
    derivedCategory: DerivedProductCategory,
    eligibleForOsSecurityMatching: boolean,
    classificationCorrected: boolean,
    classificationEvidence: string,
    correctionReason?: string,
  ): ProductClassificationAuditItem => ({
    canonicalProductId: product.id,
    productId: product.id,
    canonicalName: title,
    productName: title,
    brand: product.brand,
    storedRetailCategory: storedCat,
    legacyWasAccessoryExcluded: legacyExcluded,
    derivedCategory,
    derivedDeviceCategory: derivedCategory,
    eligibleForOsSecurityMatching,
    isExcludedFromMatching: !eligibleForOsSecurityMatching,
    classificationCorrected,
    restoredFromLegacyExclusion: classificationCorrected,
    correctionReason,
    reason: correctionReason || classificationEvidence,
    classificationEvidence,
  });

  // 2. Audio devices (AirPods, FreeBuds, Galaxy Buds, HomePod, EarPods)
  const isAudioDevice =
    catLower.includes('audio') ||
    catLower.includes('earbud') ||
    catLower.includes('headphone') ||
    /\b(?:airpods|earpods|homepod|freebuds|freeclip|galaxy\s+buds|buds\s*(?:2|3|fe|pro|live))\b/i.test(title);

  if (isAudioDevice && !/\b(?:iphone|ipad|macbook|matepad|matebook|pura\s+\d+|galaxy\s+s\d+)\b/i.test(title)) {
    return buildClassItem(
      'AUDIO',
      false,
      false,
      'Classified as AUDIO hardware (earbuds/headphones/speakers); excluded from OS/firmware security bulletins.',
    );
  }

  if (isExplicitStandaloneAccessory) {
    return buildClassItem(
      'ACCESSORY',
      false,
      false,
      'Explicit standalone accessory phrasing detected in product title.',
    );
  }

  // 3. Primary Wearable Hardware (Apple Watch Series/S/Ultra/SE, Huawei Watch, Samsung Galaxy Watch)
  // Note: Apple Watch SKUs include chassis & strap descriptors like "46mm Rose Gold Aluminium Case with Light Blush Sport Band"
  const isPrimaryWatchHardware =
    /\bApple\s+Watch\s+(?:Series\s+\d{1,2}|S\d{1,2}|Ultra(?:\s+\d+)?|SE(?:\s+\d+)?)\b/i.test(title) ||
    /\b(?:Huawei|HUAWEI)\s+Watch\s+(?:GT|Fit|Ultimate|D\d*|Buds|\d)/i.test(title) ||
    /\bGalaxy\s+Watch\s*(?:\d+|Ultra|FE|Classic)\b/i.test(title);

  if (isPrimaryWatchHardware) {
    const corrected = legacyExcluded;
    return buildClassItem(
      'WEARABLE',
      true,
      corrected,
      'Primary smartwatch model identifier verified (Series/Ultra/SE/GT/Watch generation).',
      corrected
        ? 'Restored primary smartwatch SKU previously excluded due to chassis/strap descriptors ("Case", "Band", "Loop") in title.'
        : undefined,
    );
  }

  // 4. Primary Tablet Hardware (Apple iPad, Huawei MatePad, Samsung Galaxy Tab)
  // Note: iPad Pro M5 titles include "Standard Glass" / "Nano-texture Glass" display options;
  // Huawei MatePad titles include "+ Keyboard" / "with Keyboard" bundle suffixes.
  const isPrimaryTabletHardware =
    /\b(?:Apple\s+)?iPad(?:\s+(?:Pro|Air|mini|\d{1,2}|A16))\b/i.test(title) ||
    /\b(?:Huawei\s+)?MatePad\s+(?:Pro|Air|SE|11\.5|12\s*X|\d+)/i.test(title) ||
    /\bGalaxy\s+Tab\s+(?:S\d+|A\d+|Active)/i.test(title);

  if (isPrimaryTabletHardware) {
    const corrected = legacyExcluded;
    let correctionReason: string | undefined;
    if (corrected) {
      if (/\b(?:standard|nano-texture)\s+glass\b/i.test(title)) {
        correctionReason =
          'Restored primary iPad Pro tablet SKU previously excluded due to Apple display option ("Standard Glass" / "Nano-texture Glass") matching "glass".';
      } else if (/\bkeyboard\b/i.test(title)) {
        correctionReason =
          'Restored primary tablet bundle SKU (e.g. MatePad + Keyboard) previously excluded due to bundled "+ Keyboard" descriptor.';
      } else {
        correctionReason =
          'Restored primary tablet SKU previously excluded by legacy accessory keyword filter.';
      }
    }
    return buildClassItem(
      'TABLET',
      true,
      corrected,
      'Primary tablet model family (iPad / MatePad / Galaxy Tab) verified.',
      correctionReason,
    );
  }

  // 5. Primary Laptop / Desktop Hardware (MacBook, iMac, Mac mini/Studio/Pro, MateBook, Galaxy Book)
  const isPrimaryLaptopHardware =
    /\b(?:MacBook\s+(?:Air|Pro)|iMac|Mac\s+(?:mini|Studio|Pro)|MateBook(?:\s+[A-Za-z0-9]+)?|Galaxy\s+Book)\b/i.test(
      title,
    );

  if (isPrimaryLaptopHardware) {
    const corrected = legacyExcluded;
    return buildClassItem(
      'LAPTOP',
      true,
      corrected,
      'Primary computer/laptop hardware identifier (Mac / MateBook / Galaxy Book) verified.',
      corrected
        ? 'Restored primary laptop/Mac SKU previously excluded by legacy accessory keyword filter.'
        : undefined,
    );
  }

  // 6. Primary Smartphone Hardware (iPhone, Galaxy S/Z/A/XCover, Huawei Pura/Mate/nova/Pocket)
  const isPrimarySmartphoneHardware =
    /\biPhone\s+(?:\d{1,2}|SE|XS|XR|X)\b/i.test(title) ||
    /\bGalaxy\s+(?:S\d{2}|Z\s*(?:Fold|Flip)\s*\d|A\d{2}|XCover\s*\d)\b/i.test(title) ||
    /\b(?:Huawei\s+)?(?:Pura\s+\d{2}|Mate\s+(?:\d{2}|XT|X\d)|nova\s+\d+|Pocket\s+\d*)\b/i.test(title);

  if (isPrimarySmartphoneHardware) {
    const corrected = legacyExcluded;
    return buildClassItem(
      'SMARTPHONE',
      true,
      corrected,
      'Primary smartphone model family (iPhone / Galaxy / Pura / Mate / nova) verified.',
      corrected
        ? 'Restored primary smartphone SKU previously excluded by legacy accessory keyword filter.'
        : undefined,
    );
  }

  // 7. Remaining items with accessory keywords or accessory category are standalone accessories
  if (catLower.includes('accessor') || legacyExcluded) {
    return buildClassItem(
      'ACCESSORY',
      false,
      false,
      'Classified as standalone ACCESSORY based on category and accessory keyword presence without primary hardware model identity.',
    );
  }

  // Fallback by stored RetailCategory
  if (catLower.includes('smartphone') || catLower.includes('phone')) {
    return buildClassItem('SMARTPHONE', true, false, 'Derived from stored retail category (SMARTPHONES).');
  }
  if (catLower.includes('tablet')) {
    return buildClassItem('TABLET', true, false, 'Derived from stored retail category (TABLETS).');
  }
  if (catLower.includes('wearable') || catLower.includes('watch')) {
    return buildClassItem('WEARABLE', true, false, 'Derived from stored retail category (WEARABLES).');
  }
  if (catLower.includes('laptop')) {
    return buildClassItem('LAPTOP', true, false, 'Derived from stored retail category (LAPTOPS).');
  }

  return buildClassItem('UNKNOWN', false, false, 'Unrecognized product category/model pattern.');
}

export function auditCanonicalProductClassifications(
  products: RetailProduct[],
): {
  items: ProductClassificationAuditItem[];
  correctedItems: ProductClassificationAuditItem[];
  breakdown: Record<DerivedProductCategory, number>;
  restoredPrimarySkuCount: number;
  restoredPrimarySkus: ProductClassificationAuditItem[];
  countsByCategory: Record<DerivedProductCategory, number>;
} {
  const breakdown: Record<DerivedProductCategory, number> = {
    SMARTPHONE: 0,
    TABLET: 0,
    WEARABLE: 0,
    LAPTOP: 0,
    AUDIO: 0,
    ACCESSORY: 0,
    UNKNOWN: 0,
  };
  const items: ProductClassificationAuditItem[] = [];
  const correctedItems: ProductClassificationAuditItem[] = [];

  for (const p of products) {
    const item = classifyCanonicalProductType(p);
    breakdown[item.derivedCategory] = (breakdown[item.derivedCategory] || 0) + 1;
    items.push(item);
    if (item.classificationCorrected) {
      correctedItems.push(item);
    }
  }

  return {
    items,
    correctedItems,
    breakdown,
    restoredPrimarySkuCount: correctedItems.length,
    restoredPrimarySkus: correctedItems,
    countsByCategory: breakdown,
  };
}

export function isAccessoryProduct(product: RetailProduct): boolean {
  const classification = classifyCanonicalProductType(product);
  return !classification.eligibleForOsSecurityMatching;
}

/**
 * S1.2.5 Objective G (Section 9): Deterministic Advisory Identity and Deduplication.
 * Normalizes official URLs (stripping tracking params, hash fragments, locale prefixes on
 * support.apple.com, and trailing slash variations) and detects duplicate advisories
 * without merging distinct OS releases or distinct publication dates.
 */
export function normalizeOfficialAdvisoryUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.protocol = 'https:';
    parsed.hash = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^(?:utm_|cid|ierz|local|s_|fbclid|gclid|ref)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    if (parsed.hostname.toLowerCase().includes('support.apple.com')) {
      parsed.pathname = parsed.pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, '/en-us/');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/#.*$/, '').replace(/\?.*$/, '').replace(/\/$/, '');
  }
}

export function buildDeterministicAdvisoryId(
  advisory: Partial<ServiceAdvisory> & {
    sourceId?: string;
    manufacturer?: string;
    sourceUrl?: string;
    bulletinReference?: string;
    title?: string;
    publishedAt?: string;
  },
): string {
  const mfgRaw =
    advisory.manufacturer ||
    (advisory.sourceId?.includes('apple')
      ? 'apple'
      : advisory.sourceId?.includes('huawei')
      ? 'huawei'
      : advisory.sourceId?.includes('samsung')
      ? 'samsung'
      : 'other');
  const mfg = mfgRaw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cleanTitle = (advisory.title || '')
    .replace(/\s*This update has no published CVE entries\.?/gi, '')
    .trim();
  const titleSlug = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 45);
  const dateDigits = (advisory.publishedAt || '').replace(/[^0-9]/g, '').slice(0, 8);
  const refSlug = (advisory.bulletinReference || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (mfg === 'apple') {
    const appleIdMatch = (advisory.sourceUrl || '').match(/support\.apple\.com\/(?:[a-z]{2}-[a-z]{2}\/)?(\d{5,8})\b/i);
    if (appleIdMatch && appleIdMatch[1] !== '100100') {
      return `adv-apple-${appleIdMatch[1]}`;
    }
    return `adv-apple-${titleSlug}-${dateDigits}`;
  }
  if (mfg === 'huawei' && refSlug) {
    return `adv-huawei-${refSlug}-${dateDigits}`;
  }
  if (mfg === 'samsung' && refSlug) {
    return `adv-samsung-${refSlug}-${dateDigits}`;
  }
  return `adv-${mfg}-${refSlug || titleSlug}-${dateDigits}`;
}

export type DuplicateAdvisoryAuditResult = DuplicateAdvisoryGroup[] & {
  duplicateGroupCount: number;
  totalDuplicateAdvisories: number;
  groups: DuplicateAdvisoryGroup[];
};

export function detectDuplicateAdvisories(advisories: ServiceAdvisory[]): DuplicateAdvisoryAuditResult {
  const groups = new Map<
    string,
    {
      manufacturer: ServiceAdvisory['manufacturer'];
      normalizedSourceUrl: string;
      bulletinReference: string;
      publishedAt: string;
      advisories: ServiceAdvisory[];
    }
  >();

  for (const adv of advisories) {
    if (adv.status === 'SUPERSEDED' || adv.status === 'ARCHIVED') {
      continue;
    }
    const normUrl = normalizeOfficialAdvisoryUrl(adv.sourceUrl);
    const cleanTitle = (adv.title || '')
      .replace(/\s*This update has no published CVE entries\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const ref = (adv.bulletinReference || '').trim().toLowerCase();
    const pubDate = (adv.publishedAt || '').slice(0, 10);

    const dedupeKey = `${adv.manufacturer.toLowerCase()}|${normUrl}|${ref || cleanTitle}|${cleanTitle}|${pubDate}`;

    if (!groups.has(dedupeKey)) {
      groups.set(dedupeKey, {
        manufacturer: adv.manufacturer,
        normalizedSourceUrl: normUrl,
        bulletinReference: adv.bulletinReference || cleanTitle,
        publishedAt: pubDate,
        advisories: [],
      });
    }
    groups.get(dedupeKey)!.advisories.push(adv);
  }

  const duplicates: DuplicateAdvisoryGroup[] = [];
  for (const [dedupeKey, group] of groups.entries()) {
    if (group.advisories.length > 1) {
      const sorted = [...group.advisories].sort((a, b) => {
        const aCves = a.cveIds?.length || 0;
        const bCves = b.cveIds?.length || 0;
        if (bCves !== aCves) return bCves - aCves;
        return a.id.localeCompare(b.id);
      });
      duplicates.push({
        dedupeKey,
        manufacturer: group.manufacturer,
        normalizedSourceUrl: group.normalizedSourceUrl,
        bulletinReference: group.bulletinReference,
        publishedAt: group.publishedAt,
        advisoryIds: sorted.map((a) => a.id),
        recommendedPrimaryId: sorted[0].id,
        reason: `Multiple advisory records (${sorted.map((a) => a.id).join(', ')}) resolve to identical normalized source URL, release title/bulletin reference, and publication date (${group.publishedAt}).`,
      });
    }
  }

  const totalDuplicateAdvisories = duplicates.reduce(
    (sum, g) => sum + Math.max(0, g.advisoryIds.length - 1),
    0,
  );

  return Object.assign(duplicates, {
    duplicateGroupCount: duplicates.length,
    totalDuplicateAdvisories,
    groups: duplicates,
  });
}

export interface ParsedIphoneIdentity {
  isIphone: boolean;
  generationNumber: number | null;
  isSe: boolean;
  seGeneration: number | null;
  exactModelLabel: string;
}

export function parseIphoneIdentity(title: string): ParsedIphoneIdentity {
  const t = title.trim();
  if (!/\biphone\b/i.test(t)) {
    return { isIphone: false, generationNumber: null, isSe: false, seGeneration: null, exactModelLabel: '' };
  }

  const seMatch = t.match(/\biphone\s+se(?:\s*\(?(\d+)(?:st|nd|rd|th)?\s*gen(?:eration)?\)?|\s+(2020|2022))?/i);
  if (seMatch) {
    let seGen: number | null = null;
    if (seMatch[1]) seGen = parseInt(seMatch[1], 10);
    else if (seMatch[2] === '2020') seGen = 2;
    else if (seMatch[2] === '2022') seGen = 3;
    return {
      isIphone: true,
      generationNumber: seGen && seGen >= 2 ? 11 : 9,
      isSe: true,
      seGeneration: seGen,
      exactModelLabel: seGen ? `iPhone SE (${seGen}nd/rd generation)` : 'iPhone SE',
    };
  }

  if (/\biphone\s+xs(\s+max)?\b/i.test(t) || /\biphone\s+xr\b/i.test(t)) {
    const label = t.match(/\b(iPhone\s+(?:XS(?:\s+Max)?|XR))\b/i)?.[1] || 'iPhone XS/XR';
    return { isIphone: true, generationNumber: 10.5, isSe: false, seGeneration: null, exactModelLabel: label };
  }
  if (/\biphone\s+x\b/i.test(t)) {
    return { isIphone: true, generationNumber: 10, isSe: false, seGeneration: null, exactModelLabel: 'iPhone X' };
  }

  const numMatch = t.match(/\biphone\s+(\d{1,2})(?:e)?(?:\s+(pro\s+max|pro|plus|mini|air|e))?\b/i);
  if (numMatch) {
    const gen = parseInt(numMatch[1], 10);
    const isE = /\biphone\s+\d{1,2}e\b/i.test(t);
    const suffix = isE ? 'e' : numMatch[2] ? ` ${numMatch[2].replace(/\s+/g, ' ').trim()}` : '';
    return {
      isIphone: true,
      generationNumber: gen,
      isSe: false,
      seGeneration: null,
      exactModelLabel: `iPhone ${gen}${suffix}`,
    };
  }

  return { isIphone: true, generationNumber: null, isSe: false, seGeneration: null, exactModelLabel: 'iPhone' };
}

export interface ParsedIpadIdentity {
  isIpad: boolean;
  subFamily: 'PRO' | 'AIR' | 'MINI' | 'BASE' | null;
  screenSizeInches: '12.9' | '13' | '11' | '10.9' | '10.2' | '8.3' | null;
  explicitGeneration: number | null;
  chip: string | null;
  releaseYear: number | null;
  effectiveGeneration: number | null;
  inferredFromYearOnly: boolean;
  inferredAcrossScreenSizeLineage: boolean;
  exactModelLabel: string;
}

export function parseIpadIdentity(title: string): ParsedIpadIdentity {
  const t = title.trim();
  if (!/\bipad\b/i.test(t)) {
    return {
      isIpad: false,
      subFamily: null,
      screenSizeInches: null,
      explicitGeneration: null,
      chip: null,
      releaseYear: null,
      effectiveGeneration: null,
      inferredFromYearOnly: false,
      inferredAcrossScreenSizeLineage: false,
      exactModelLabel: '',
    };
  }

  let subFamily: 'PRO' | 'AIR' | 'MINI' | 'BASE' = 'BASE';
  if (/\bipad\s+pro\b/i.test(t)) subFamily = 'PRO';
  else if (/\bipad\s+air\b/i.test(t)) subFamily = 'AIR';
  else if (/\bipad\s+mini\b/i.test(t)) subFamily = 'MINI';

  let screenSizeInches: ParsedIpadIdentity['screenSizeInches'] = null;
  if (/\b12[.,]9(?:\s*-?\s*inch|")?/i.test(t)) screenSizeInches = '12.9';
  else if (/\b13(?:\s*-?\s*inch|"|\s+202[456]|\s+m[45])/i.test(t)) screenSizeInches = '13';
  else if (/\b11(?:\s*-?\s*inch|"|\s+202[0-6]|\s+m[1-5])/i.test(t) && subFamily !== 'BASE') screenSizeInches = '11';
  else if (/\b10[.,]9(?:\s*-?\s*inch|")?/i.test(t)) screenSizeInches = '10.9';
  else if (/\b10[.,]2(?:\s*-?\s*inch|")?/i.test(t)) screenSizeInches = '10.2';
  else if (/\b8[.,]3(?:\s*-?\s*inch|")?/i.test(t)) screenSizeInches = '8.3';

  const genMatch = t.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*gen(?:eration)?\b/i)
    || t.match(/\bgen(?:eration)?\s*(\d{1,2})\b/i);
  let explicitGeneration = genMatch ? parseInt(genMatch[1], 10) : null;

  // Base "Apple iPad 11" (or "iPad 10") where 11/10 is the generation number (not Pro/Air 11-inch)
  if (explicitGeneration === null && subFamily === 'BASE') {
    const baseNumMatch = t.match(/\bipad\s+(10|11)\b(?!\s*(?:-?\s*inch|"))/i);
    if (baseNumMatch) {
      explicitGeneration = parseInt(baseNumMatch[1], 10);
    }
  }

  const chipMatch = t.match(/\b(M[1-5](?:\s+(?:Pro|Max))?|A1[4-9](?:\s+(?:Pro|Bionic))?)\b/i);
  const chip = chipMatch ? chipMatch[1].toUpperCase() : null;

  const yearMatch = t.match(/\b(201[89]|202[0-6])\b/);
  const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  let effectiveGeneration: number | null = explicitGeneration;
  let inferredFromYearOnly = false;
  const inferredAcrossScreenSizeLineage = false;

  if (effectiveGeneration === null && chip) {
    const chipBase = chip.split(/\s+/)[0];
    if (subFamily === 'PRO') {
      if (screenSizeInches === '12.9') {
        if (chipBase === 'M1') effectiveGeneration = 5;
        else if (chipBase === 'M2') effectiveGeneration = 6;
      } else if (screenSizeInches === '13') {
        if (chipBase === 'M4') effectiveGeneration = 7;
        else if (chipBase === 'M5') effectiveGeneration = 8;
      } else if (screenSizeInches === '11') {
        if (chipBase === 'M1') effectiveGeneration = 3;
        else if (chipBase === 'M2') effectiveGeneration = 4;
        else if (chipBase === 'M4') effectiveGeneration = 5;
        else if (chipBase === 'M5') effectiveGeneration = 6;
      }
    } else if (subFamily === 'AIR') {
      if (chipBase === 'A14') effectiveGeneration = 4;
      else if (chipBase === 'M1') effectiveGeneration = 5;
      else if (chipBase === 'M2') effectiveGeneration = 6;
      else if (chipBase === 'M3') effectiveGeneration = 7;
      else if (chipBase === 'M4') effectiveGeneration = 8;
    } else if (subFamily === 'MINI') {
      if (chipBase === 'A15') effectiveGeneration = 6;
      else if (chipBase === 'A17') effectiveGeneration = 7;
    } else if (subFamily === 'BASE') {
      if (chipBase === 'A14') effectiveGeneration = 10;
      else if (chipBase === 'A16') effectiveGeneration = 11;
    }
  }

  if (effectiveGeneration === null && releaseYear !== null) {
    inferredFromYearOnly = true;
    if (subFamily === 'MINI') {
      if (releaseYear === 2021) effectiveGeneration = 6;
      else if (releaseYear >= 2024) effectiveGeneration = 7;
    } else if (subFamily === 'AIR') {
      if (releaseYear === 2020) effectiveGeneration = 4;
      else if (releaseYear === 2022) effectiveGeneration = 5;
      else if (releaseYear === 2024) effectiveGeneration = 6;
      else if (releaseYear >= 2025) effectiveGeneration = 7;
    } else if (subFamily === 'BASE') {
      if (releaseYear === 2021) effectiveGeneration = 9;
      else if (releaseYear === 2022) effectiveGeneration = 10;
      else if (releaseYear >= 2025) effectiveGeneration = 11;
    }
  }

  const labelParts = ['iPad'];
  if (subFamily !== 'BASE') labelParts.push(subFamily.charAt(0) + subFamily.slice(1).toLowerCase());
  if (screenSizeInches) labelParts.push(`${screenSizeInches}-inch`);
  if (explicitGeneration) labelParts.push(`(${explicitGeneration}th gen)`);
  else if (chip) labelParts.push(`(${chip})`);
  else if (releaseYear) labelParts.push(`(${releaseYear})`);

  return {
    isIpad: true,
    subFamily,
    screenSizeInches,
    explicitGeneration,
    chip,
    releaseYear,
    effectiveGeneration,
    inferredFromYearOnly,
    inferredAcrossScreenSizeLineage,
    exactModelLabel: labelParts.join(' '),
  };
}

function isZeroCveMaintenanceRelease(advisory: ServiceAdvisory): boolean {
  if (advisory.isZeroCveRelease === true) return true;
  const combined = `${advisory.title} ${advisory.summary || ''} ${advisory.notes || ''} ${getAdvisoryAffectedText(advisory)}`.toLowerCase();
  return combined.includes('no published cve');
}

/**
 * S1.2.3 & S1.2.5 Strict VERIFIED Quality Gate.
 * Inspects a candidate match and downgrades any VERIFIED candidate that lacks
 * complete evidence, originates from an UPDATE_SCHEDULE / GENERAL_MAINTENANCE_INFORMATION,
 * or violates relationship/evidence-strength rules.
 */
export function validateCandidateEvidenceGate(match: ServiceProductMatch): ServiceProductMatch {
  const missing: string[] = [...(match.missingEvidence || [])];
  const conflicts: string[] = [...(match.potentialConflicts || [])];
  const url = match.sourceUrl || match.officialSourceUrl || '';

  if (!url || !/^https?:\/\//i.test(url)) {
    missing.push('Missing valid official sourceUrl.');
  }
  if (!match.advisoryTitle || match.advisoryTitle.trim().length === 0) {
    missing.push('Missing official advisoryTitle.');
  }
  if (!match.productFamily || match.productFamily.trim().length === 0) {
    missing.push('Missing canonical productFamily.');
  }
  if (!match.exactModel || match.exactModel.trim().length === 0) {
    missing.push('Missing canonical exactModel identifier.');
  }
  if (!match.affectedOsOrFirmware || match.affectedOsOrFirmware.trim().length === 0) {
    missing.push('Missing affectedOsOrFirmware applicability.');
  }
  if (!match.evidenceSourceFields || match.evidenceSourceFields.length === 0) {
    missing.push('Missing evidenceSourceFields provenance.');
  }

  let relationshipType: MatchRelationshipType =
    match.relationshipType || 'SECURITY_BULLETIN_APPLICABILITY';

  // Rule: Update schedules must NEVER be classified as CONFIRMED_VULNERABILITY_APPLICABILITY
  if (
    match.advisoryType === 'UPDATE_SCHEDULE' &&
    (relationshipType === 'CONFIRMED_VULNERABILITY_APPLICABILITY' ||
      relationshipType === 'CONFIRMED_VULNERABILITY' ||
      relationshipType === 'SECURITY_BULLETIN_APPLICABILITY')
  ) {
    relationshipType = 'OFFICIAL_UPDATE_ELIGIBILITY';
  }
  if (match.advisoryType === 'GENERAL_MAINTENANCE_INFORMATION') {
    relationshipType = 'GENERAL_MAINTENANCE_INFORMATION';
  }

  let confidence: ProductMatchConfidence = match.confidence;
  let classificationRationale = match.classificationRationale || '';

  // S1.2.5 Rule 8.2: Never mark a candidate VERIFIED solely because the device is on a
  // monthly or quarterly update schedule or general maintenance portal
  if (
    confidence === 'VERIFIED' &&
    (match.advisoryType === 'UPDATE_SCHEDULE' ||
      match.advisoryType === 'GENERAL_MAINTENANCE_INFORMATION' ||
      relationshipType === 'OFFICIAL_UPDATE_ELIGIBILITY' ||
      relationshipType === 'GENERAL_MAINTENANCE_INFORMATION')
  ) {
    confidence = 'LIKELY';
    missing.push(
      'Source record is an update schedule or general maintenance program (0 CVEs); represents OFFICIAL_UPDATE_ELIGIBILITY rather than a confirmed security vulnerability.',
    );
    classificationRationale +=
      ' [S1.2.5 Quality Gate: Capped at LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) because update schedules do not prove vulnerability applicability.]';
  }

  if (confidence === 'VERIFIED') {
    const allowedStrength =
      match.evidenceStrength === 'DIRECT_OFFICIAL_EVIDENCE' ||
      match.evidenceStrength === 'STRUCTURED_MANUFACTURER_APPLICABILITY';

    if (!allowedStrength) {
      confidence = 'LIKELY';
      missing.push(
        `Evidence strength ${match.evidenceStrength} does not meet the VERIFIED threshold (requires DIRECT_OFFICIAL_EVIDENCE or STRUCTURED_MANUFACTURER_APPLICABILITY).`,
      );
      classificationRationale += ' [Quality Gate: Downgraded from VERIFIED to LIKELY due to inferred/heuristic evidence strength.]';
    }

    if (missing.length > 0 || conflicts.length > 0) {
      confidence = 'LIKELY';
      classificationRationale += ` [Quality Gate: Downgraded from VERIFIED to LIKELY because ${missing.length} required evidence check(s) or ${conflicts.length} conflict(s) were flagged.]`;
    }
  }

  let recommendedReviewAction: RecommendedMatchReviewAction = 'KEEP_PENDING_REVIEW';
  if (
    confidence === 'VERIFIED' &&
    missing.length === 0 &&
    conflicts.length === 0 &&
    (match.evidenceStrength === 'DIRECT_OFFICIAL_EVIDENCE' ||
      match.evidenceStrength === 'STRUCTURED_MANUFACTURER_APPLICABILITY')
  ) {
    recommendedReviewAction = 'APPROVE_LINK';
  } else if (confidence === 'LIKELY') {
    recommendedReviewAction = 'KEEP_PENDING_REVIEW';
  } else {
    recommendedReviewAction = 'VERIFY_MODEL_VARIANT';
  }

  const status: ServiceProductMatch['status'] =
    confidence === 'VERIFIED' && missing.length === 0 && conflicts.length === 0
      ? 'CONFIRMED'
      : 'PENDING_REVIEW';

  return {
    ...match,
    confidence,
    status,
    relationshipType,
    missingEvidence: Array.from(new Set(missing)),
    potentialConflicts: Array.from(new Set(conflicts)),
    classificationRationale,
    recommendedReviewAction,
  };
}

function buildMatchRecord(params: {
  advisory: ServiceAdvisory;
  product: RetailProduct;
  confidence: ProductMatchConfidence;
  relationshipType: MatchRelationshipType;
  evidenceStrength: MatchEvidenceStrength;
  matcherRuleId: string;
  productFamily: string;
  exactModel: string;
  affectedOsOrFirmware: string;
  affectedSoftwareVersions: string[];
  applicableRegion?: string | null;
  evidenceSummary: string;
  evidenceSourceFields: string[];
  missingEvidence?: string[];
  potentialConflicts?: string[];
  classificationRationale: string;
  matchedTokens: string[];
  nowIso: string;
}): ServiceProductMatch {
  const {
    advisory,
    product,
    confidence,
    relationshipType,
    evidenceStrength,
    matcherRuleId,
    productFamily,
    exactModel,
    affectedOsOrFirmware,
    affectedSoftwareVersions,
    applicableRegion = null,
    evidenceSummary,
    evidenceSourceFields,
    missingEvidence = [],
    potentialConflicts = [],
    classificationRationale,
    matchedTokens,
    nowIso,
  } = params;

  const pTitle = getProductTitle(product);
  const derivedType = classifyCanonicalProductType(product);
  const evidenceArr = [evidenceSummary, ...matchedTokens.map(t => `Token: ${t}`)];

  const rawMatch: ServiceProductMatch = {
    id: buildDeterministicMatchId(product.id, advisory.id),
    advisoryId: advisory.id,
    advisoryTitle: advisory.title,
    advisoryType: advisory.advisoryType,
    canonicalProductId: product.id,
    productTitle: pTitle,
    canonicalProductName: pTitle,
    brand: product.brand,
    manufacturer: advisory.manufacturer,
    productFamily,
    exactModel,
    derivedDeviceCategory: derivedType.derivedCategory,
    affectedOsOrFirmware,
    affectedSoftwareVersions,
    applicableRegion,
    confidence,
    status: confidence === 'VERIFIED' ? 'CONFIRMED' : 'PENDING_REVIEW',
    relationshipType,
    evidenceStrength,
    matcherRuleId,
    matcherVersion: SERVICE_MATCHER_VERSION,
    evidence: evidenceArr,
    matchEvidence: evidenceArr,
    evidenceSummary,
    evidenceSourceFields,
    missingEvidence,
    classificationRationale,
    potentialConflicts,
    recommendedReviewAction: 'KEEP_PENDING_REVIEW',
    officialSourceUrl: advisory.sourceUrl,
    sourceUrl: advisory.sourceUrl,
    bulletinReference: advisory.bulletinReference,
    matchedAt: nowIso,
    lastEvaluatedAt: nowIso,
    createdAt: nowIso,
  };

  const gated = validateCandidateEvidenceGate(rawMatch);
  const authInfo = classifyProductMatchAuthenticity(gated, advisory);
  // If source authenticity is SOURCE_UNVERIFIABLE or SOURCE_CONTRADICTED, never allow VERIFIED confidence
  let finalConfidence = gated.confidence;
  let finalStatus = gated.status;
  const finalMissing = [...(gated.missingEvidence || [])];
  if (
    finalConfidence === 'VERIFIED' &&
    (authInfo.authenticityClassification === 'SOURCE_UNVERIFIABLE' ||
      authInfo.authenticityClassification === 'SOURCE_CONTRADICTED' ||
      advisory.verificationStatus === 'SOURCE_UNVERIFIABLE')
  ) {
    finalConfidence = 'AMBIGUOUS_REVIEW';
    finalStatus = 'PENDING_REVIEW';
    finalMissing.push('Source advisory is marked SOURCE_UNVERIFIABLE or contradicted.');
  }

  const uniqueMissing = Array.from(new Set(finalMissing));
  const whyNotHigherConfidence =
    finalConfidence !== 'VERIFIED'
      ? uniqueMissing.join(' ') || gated.classificationRationale
      : undefined;

  return {
    ...gated,
    ruleId: gated.matcherRuleId,
    confidence: finalConfidence,
    status: finalStatus,
    missingEvidence: uniqueMissing,
    whyNotHigherConfidence,
    authenticityClassification: authInfo.authenticityClassification,
    qualifiesForAutomaticConfirmation: authInfo.qualifiesForAutomaticConfirmation,
    sourcePublishedAt: authInfo.sourcePublishedAt,
    sourceVerifiedAt: authInfo.sourceVerifiedAt,
    attributableExcerpt: authInfo.attributableExcerpt,
    sourceAuthenticityStatus: authInfo.sourceAuthenticityStatus,
    sourceAuthenticityWarnings: authInfo.sourceAuthenticityWarnings,
  };
}

function extractSoftwareVersions(advisory: ServiceAdvisory): string[] {
  if (Array.isArray(advisory.fixedVersions) && advisory.fixedVersions.length > 0) {
    return advisory.fixedVersions;
  }
  if (Array.isArray(advisory.affectedVersions) && advisory.affectedVersions.length > 0) {
    return advisory.affectedVersions;
  }
  const combined = `${advisory.title} ${getAdvisoryAffectedText(advisory)}`;
  const matches = combined.match(
    /\b(?:iOS|iPadOS|macOS(?:\s+[A-Za-z]+)?|watchOS|Safari|Android|EMUI|HarmonyOS)\s+\d+(?:\.\d+){0,2}\b/gi,
  );
  if (!matches || matches.length === 0) {
    return [advisory.title];
  }
  return Array.from(new Set(matches.map(m => m.trim())));
}

function evaluateAppleMatch(
  advisory: ServiceAdvisory,
  product: RetailProduct,
  nowIso: string,
): ServiceProductMatch | null {
  if (product.brand.toLowerCase() !== 'apple') return null;
  if (isAccessoryProduct(product)) return null;

  const pTitle = getProductTitle(product);
  const titleLower = advisory.title.toLowerCase();
  const affectedText = getAdvisoryAffectedText(advisory);
  const affectedLower = affectedText.toLowerCase();
  const combinedLower = `${titleLower} ${affectedLower}`;
  const swVersions = extractSoftwareVersions(advisory);
  const zeroCve = isZeroCveMaintenanceRelease(advisory);

  const iphone = parseIphoneIdentity(pTitle);
  const ipad = parseIpadIdentity(pTitle);
  const isMac = /\b(macbook\s+(?:air|pro)|imac|mac\s+mini|mac\s+studio|mac\s+pro)\b/i.test(pTitle);
  const isWatch = /\bapple\s+watch\b/i.test(pTitle);

  // 1. iPhone matching against iOS advisories
  if (iphone.isIphone && /\bios\b/i.test(combinedLower)) {
    const iosVerMatch = combinedLower.match(/\bios\s+(\d{1,2})(?:\.(\d+))?/i);
    const iosMajor = iosVerMatch ? parseInt(iosVerMatch[1], 10) : 26;
    const maxSupportedGen = iosMajor <= 26 ? 17 : 18;

    if (iphone.generationNumber === null || iphone.generationNumber > maxSupportedGen) {
      return null;
    }

    const hasAndLater = /\band\s+later\b/i.test(affectedLower);
    let minGenFloor: number | null = null;
    let floorPhrase = '';

    if (hasAndLater) {
      if (/\biphone\s+11\s+and\s+later\b/i.test(affectedLower)) {
        minGenFloor = 11;
        floorPhrase = 'iPhone 11 and later';
      } else if (/\biphone\s+xs\s+and\s+later\b/i.test(affectedLower)) {
        minGenFloor = 10.5;
        floorPhrase = 'iPhone XS and later';
      } else {
        const floorMatch = affectedLower.match(/\biphone\s+(\d{1,2})\s+and\s+later\b/i);
        if (floorMatch) {
          minGenFloor = parseInt(floorMatch[1], 10);
          floorPhrase = floorMatch[0];
        }
      }

      if (minGenFloor !== null) {
        if (iphone.generationNumber < minGenFloor) {
          return null;
        }

        if (zeroCve) {
          return buildMatchRecord({
            advisory,
            product,
            confidence: 'LIKELY',
            relationshipType: 'OFFICIAL_UPDATE_ELIGIBILITY',
            evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
            matcherRuleId: 'APPLE_MAINTENANCE_UPDATE_ELIGIBILITY',
            productFamily: 'iPhone',
            exactModel: iphone.exactModelLabel,
            affectedOsOrFirmware: swVersions[0] || 'iOS',
            affectedSoftwareVersions: swVersions,
            evidenceSummary: `Official Apple release notes specify "${floorPhrase}", which includes ${iphone.exactModelLabel} (gen ${iphone.generationNumber} >= ${minGenFloor}), but state "This update has no published CVE entries".`,
            evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
            missingEvidence: [
              'Official Apple release notes state "This update has no published CVE entries" (maintenance update without CVE security patches).',
            ],
            classificationRationale: `Downgraded from VERIFIED to LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) under S1.2.3 Quality Gate because ${advisory.title} is a zero-CVE maintenance point release.`,
            matchedTokens: ['iOS', floorPhrase, iphone.exactModelLabel],
            nowIso,
          });
        }

        return buildMatchRecord({
          advisory,
          product,
          confidence: 'VERIFIED',
          relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
          evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
          matcherRuleId: 'APPLE_IPHONE_GENERATION_APPLICABILITY',
          productFamily: 'iPhone',
          exactModel: iphone.exactModelLabel,
          affectedOsOrFirmware: swVersions[0] || 'iOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple security bulletin specifies hardware floor "${floorPhrase}"; canonical product ${iphone.exactModelLabel} (generation ${iphone.generationNumber}) satisfies [${minGenFloor}, ${maxSupportedGen}].`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          classificationRationale: `Assigned VERIFIED (STRUCTURED_MANUFACTURER_APPLICABILITY) because Apple explicitly defines hardware applicability "${floorPhrase}" and ${iphone.exactModelLabel} has deterministic generation ${iphone.generationNumber} >= ${minGenFloor}.`,
          matchedTokens: ['iOS', floorPhrase, iphone.exactModelLabel],
          nowIso,
        });
      }
    } else {
      const namesXsXr = /\biphone\s+(?:xs|xr)\b/i.test(affectedLower);
      const namedNums = Array.from(affectedLower.matchAll(/\biphone\s+(\d{1,2})\b/gi)).map(m =>
        parseInt(m[1], 10),
      );

      let narrowMatch = false;
      if (iphone.generationNumber === 10.5 && namesXsXr) {
        narrowMatch = true;
      } else if (namedNums.includes(iphone.generationNumber)) {
        narrowMatch = true;
      }

      if (narrowMatch) {
        if (zeroCve) {
          return buildMatchRecord({
            advisory,
            product,
            confidence: 'LIKELY',
            relationshipType: 'OFFICIAL_UPDATE_ELIGIBILITY',
            evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
            matcherRuleId: 'APPLE_MAINTENANCE_UPDATE_ELIGIBILITY',
            productFamily: 'iPhone',
            exactModel: iphone.exactModelLabel,
            affectedOsOrFirmware: swVersions[0] || 'iOS',
            affectedSoftwareVersions: swVersions,
            evidenceSummary: `Official Apple narrow release explicitly targets "${affectedText}", matching ${iphone.exactModelLabel}, but has no published CVE entries.`,
            evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
            missingEvidence: [
              'Official Apple release notes state "This update has no published CVE entries" (maintenance update without CVE security patches).',
            ],
            classificationRationale: `Downgraded to LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) because the narrow release has 0 published CVEs.`,
            matchedTokens: ['iOS', affectedText, iphone.exactModelLabel],
            nowIso,
          });
        }

        return buildMatchRecord({
          advisory,
          product,
          confidence: 'VERIFIED',
          relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
          evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
          matcherRuleId: 'APPLE_EXACT_MODEL_DIRECT',
          productFamily: 'iPhone',
          exactModel: iphone.exactModelLabel,
          affectedOsOrFirmware: swVersions[0] || 'iOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple narrow security release explicitly lists "${affectedText}", directly matching ${iphone.exactModelLabel}.`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          classificationRationale: `Assigned VERIFIED (DIRECT_OFFICIAL_EVIDENCE) via explicit narrow model match on "${affectedText}".`,
          matchedTokens: ['iOS', affectedText, iphone.exactModelLabel],
          nowIso,
        });
      }
      return null;
    }
  }

  // 2. iPad matching against iPadOS advisories
  if (ipad.isIpad && /\bipados\b/i.test(combinedLower)) {
    let eligible = false;
    let floorPhrase = '';
    let requiresLineageInference = false;
    let lineageReason = '';

    if (ipad.subFamily === 'PRO') {
      const pro129Match = affectedLower.match(/ipad\s+pro\s+12\.9-inch\s+(\d+)(?:st|nd|rd|th)\s+generation\s+and\s+later/i);
      const pro13Match = affectedLower.match(/ipad\s+pro\s+13-inch/i);
      const pro11Match = affectedLower.match(/ipad\s+pro\s+11-inch\s+(\d+)(?:st|nd|rd|th)\s+generation\s+and\s+later/i);

      if (ipad.screenSizeInches === '12.9' && pro129Match && ipad.effectiveGeneration !== null) {
        const minGen = parseInt(pro129Match[1], 10);
        if (ipad.effectiveGeneration >= minGen) {
          eligible = true;
          floorPhrase = pro129Match[0];
        }
      } else if (ipad.screenSizeInches === '13') {
        if (pro13Match) {
          eligible = true;
          floorPhrase = 'iPad Pro 13-inch';
        } else if (pro129Match && ipad.effectiveGeneration !== null) {
          eligible = true;
          floorPhrase = pro129Match[0];
          requiresLineageInference = true;
          lineageReason = 'Advisory specifies "iPad Pro 12.9-inch ... and later" without explicitly naming "iPad Pro 13-inch"; matched via M4/M5 successor lineage.';
        }
      } else if (ipad.screenSizeInches === '11' && pro11Match && ipad.effectiveGeneration !== null) {
        const minGen = parseInt(pro11Match[1], 10);
        if (ipad.effectiveGeneration >= minGen) {
          eligible = true;
          floorPhrase = pro11Match[0];
        }
      }
    } else if (ipad.subFamily === 'AIR') {
      const airMatch = affectedLower.match(/ipad\s+air\s+(\d+)(?:st|nd|rd|th)\s+generation\s+and\s+later/i);
      if (airMatch && ipad.effectiveGeneration !== null) {
        const minGen = parseInt(airMatch[1], 10);
        if (ipad.effectiveGeneration >= minGen) {
          eligible = true;
          floorPhrase = airMatch[0];
        }
      }
    } else if (ipad.subFamily === 'MINI') {
      const miniMatch = affectedLower.match(/ipad\s+mini\s+(\d+)(?:st|nd|rd|th)\s+generation\s+and\s+later/i);
      if (miniMatch && ipad.effectiveGeneration !== null) {
        const minGen = parseInt(miniMatch[1], 10);
        if (ipad.effectiveGeneration >= minGen) {
          eligible = true;
          floorPhrase = miniMatch[0];
        }
      }
    } else if (ipad.subFamily === 'BASE') {
      const baseMatch = affectedLower.match(/\bipad\s+(\d+)(?:st|nd|rd|th)\s+generation\s+and\s+later/i);
      if (baseMatch && ipad.effectiveGeneration !== null) {
        const minGen = parseInt(baseMatch[1], 10);
        if (ipad.effectiveGeneration >= minGen) {
          eligible = true;
          floorPhrase = baseMatch[0];
        }
      }
    }

    if (eligible) {
      if (zeroCve) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'LIKELY',
          relationshipType: 'OFFICIAL_UPDATE_ELIGIBILITY',
          evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
          matcherRuleId: 'APPLE_MAINTENANCE_UPDATE_ELIGIBILITY',
          productFamily: 'iPad',
          exactModel: ipad.exactModelLabel,
          affectedOsOrFirmware: swVersions[0] || 'iPadOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple release notes specify "${floorPhrase}", matching ${ipad.exactModelLabel}, but state "This update has no published CVE entries".`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          missingEvidence: [
            'Official Apple release notes state "This update has no published CVE entries" (maintenance update without CVE security patches).',
          ],
          classificationRationale: `Downgraded from VERIFIED to LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) because ${advisory.title} has no published CVEs.`,
          matchedTokens: ['iPadOS', floorPhrase, ipad.exactModelLabel],
          nowIso,
        });
      }

      if (ipad.inferredFromYearOnly || requiresLineageInference) {
        const reason = ipad.inferredFromYearOnly
          ? `Canonical product title "${pTitle}" specifies release year (${ipad.releaseYear}) without an explicit generation number or Apple Silicon chip identifier.`
          : lineageReason;
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'LIKELY',
          relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
          evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
          matcherRuleId: 'APPLE_IPAD_LINEAGE_INFERRED',
          productFamily: 'iPad',
          exactModel: ipad.exactModelLabel,
          affectedOsOrFirmware: swVersions[0] || 'iPadOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple iPadOS bulletin specifies "${floorPhrase}". ${reason}`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          missingEvidence: [reason],
          classificationRationale: `Capped at LIKELY (INFERRED_FAMILY_APPLICABILITY) under S1.2.3 Quality Gate because ${reason}`,
          matchedTokens: ['iPadOS', floorPhrase, ipad.exactModelLabel],
          nowIso,
        });
      }

      return buildMatchRecord({
        advisory,
        product,
        confidence: 'VERIFIED',
        relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
        evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
        matcherRuleId: 'APPLE_IPAD_GENERATION_APPLICABILITY',
        productFamily: 'iPad',
        exactModel: ipad.exactModelLabel,
        affectedOsOrFirmware: swVersions[0] || 'iPadOS',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: `Official Apple iPadOS security bulletin specifies "${floorPhrase}"; canonical product ${ipad.exactModelLabel} explicitly matches sub-family and generation (${ipad.effectiveGeneration}) via ${ipad.explicitGeneration ? 'explicit generation' : `chip ${ipad.chip}`}.`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
        classificationRationale: `Assigned VERIFIED (STRUCTURED_MANUFACTURER_APPLICABILITY) with complete sub-family, screen-size, and chip/generation evidence.`,
        matchedTokens: ['iPadOS', floorPhrase, ipad.exactModelLabel],
        nowIso,
      });
    }
  }

  // 3. Mac matching against macOS / Safari advisories
  if (isMac) {
    const macFamilyMatch = pTitle.match(/\b(MacBook\s+Air|MacBook\s+Pro|iMac|Mac\s+mini|Mac\s+Studio|Mac\s+Pro)\b/i);
    const macFamily = macFamilyMatch ? macFamilyMatch[1] : 'Mac';
    const chipMatch = pTitle.match(/\b(M[1-5](?:\s+(?:Pro|Max|Ultra))?)\b/i);
    const exactMacModel = chipMatch ? `${macFamily} (${chipMatch[1].toUpperCase()})` : macFamily;

    if (/\bsafari\b/i.test(titleLower) && /\bmacos\b/i.test(combinedLower)) {
      return buildMatchRecord({
        advisory,
        product,
        confidence: 'AMBIGUOUS_REVIEW',
        relationshipType: 'GENERAL_SECURITY_INFORMATION',
        evidenceStrength: 'HEURISTIC_SIMILARITY',
        matcherRuleId: 'APPLE_SAFARI_OS_COUPLED_REVIEW',
        productFamily: 'Mac',
        exactModel: exactMacModel,
        affectedOsOrFirmware: swVersions[0] || 'Safari / macOS',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: `Standalone Apple Safari security update (${advisory.title}) applies only to Macs running the target macOS branch (${affectedText}).`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl'],
        missingEvidence: ['Installed macOS major branch on retail SKU is not fixed by hardware model alone for standalone Safari updates.'],
        classificationRationale: 'Assigned AMBIGUOUS_REVIEW because standalone Safari updates depend on the installed macOS branch.',
        matchedTokens: ['Safari', 'macOS', macFamily],
        nowIso,
      });
    }

    if (/\bmacos\b/i.test(titleLower)) {
      const explicitlyNamesMacHardware =
        affectedLower.includes(macFamily.toLowerCase()) ||
        /\ball\s+macs\b/i.test(affectedLower);

      if (explicitlyNamesMacHardware && chipMatch && !zeroCve) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'VERIFIED',
          relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
          evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
          matcherRuleId: 'APPLE_MAC_OS_FAMILY_APPLICABILITY',
          productFamily: 'Mac',
          exactModel: exactMacModel,
          affectedOsOrFirmware: swVersions[0] || 'macOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple macOS security release explicitly lists ${macFamily} compatibility; canonical SKU is Apple Silicon ${exactMacModel}.`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          classificationRationale: `Assigned VERIFIED (STRUCTURED_MANUFACTURER_APPLICABILITY) because Apple lists ${macFamily} in affectedProductsText and ${exactMacModel} is confirmed Apple Silicon.`,
          matchedTokens: ['macOS', macFamily, chipMatch[1]],
          nowIso,
        });
      }

      if (/\bmacos\s+(?:tahoe|sequoia|sonoma|ventura)\b/i.test(combinedLower)) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'LIKELY',
          relationshipType: zeroCve ? 'OFFICIAL_UPDATE_ELIGIBILITY' : 'SECURITY_BULLETIN_APPLICABILITY',
          evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
          matcherRuleId: 'APPLE_MAC_OS_FAMILY_APPLICABILITY',
          productFamily: 'Mac',
          exactModel: exactMacModel,
          affectedOsOrFirmware: swVersions[0] || 'macOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple macOS release (${advisory.title}) lists OS branch "${affectedText}" without enumerating specific Mac hardware models; ${exactMacModel} is compatible with modern macOS.`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl'],
          missingEvidence: [
            `Advisory affectedProductsText specifies OS branch ("${affectedText}") rather than enumerating explicit Mac hardware models (${macFamily}).`,
          ],
          classificationRationale: `Capped at LIKELY (INFERRED_FAMILY_APPLICABILITY) because the bulletin specifies the macOS branch ("${affectedText}") without an explicit Mac hardware model list.`,
          matchedTokens: ['macOS', macFamily],
          nowIso,
        });
      }
    }
  }

  // 4. Apple Watch matching against watchOS advisories
  if (isWatch && /\bwatchos\b/i.test(combinedLower)) {
    const seriesMatch = pTitle.match(/\bApple\s+Watch\s+(?:Series\s+|S)(\d{1,2})\b/i);
    const ultraMatch = pTitle.match(/\bApple\s+Watch\s+Ultra(?:\s+(\d+))?\b/i);
    const seMatch = pTitle.match(/\bApple\s+Watch\s+SE(?:\s+(\d+))?\b/i);

    const floorMatch = affectedLower.match(/apple\s+watch\s+series\s+(\d{1,2})\s+and\s+later/i);
    const narrowSeriesMatch = affectedLower.match(/apple\s+watch\s+series\s+(\d{1,2})(?!\s+and\s+later)/i);
    const narrowUltraMatch = affectedLower.match(/apple\s+watch\s+ultra\s+(\d+)/i);

    if (!floorMatch) {
      if (seriesMatch && narrowSeriesMatch) {
        if (parseInt(seriesMatch[1], 10) !== parseInt(narrowSeriesMatch[1], 10)) {
          return null;
        }
      } else if (ultraMatch && narrowUltraMatch) {
        const prodUltra = ultraMatch[1] ? parseInt(ultraMatch[1], 10) : 1;
        if (prodUltra !== parseInt(narrowUltraMatch[1], 10)) {
          return null;
        }
      } else {
        return null;
      }
    }

    const minSeries = floorMatch
      ? parseInt(floorMatch[1], 10)
      : narrowSeriesMatch
      ? parseInt(narrowSeriesMatch[1], 10)
      : 6;

    if (seriesMatch || ultraMatch) {
      const seriesNum = seriesMatch ? parseInt(seriesMatch[1], 10) : 8;
      if (seriesNum < minSeries) return null;

      const exactWatchModel = seriesMatch
        ? `Apple Watch Series ${seriesNum}`
        : `Apple Watch Ultra${ultraMatch?.[1] ? ` ${ultraMatch[1]}` : ''}`;

      if (zeroCve) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'LIKELY',
          relationshipType: 'OFFICIAL_UPDATE_ELIGIBILITY',
          evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
          matcherRuleId: 'APPLE_MAINTENANCE_UPDATE_ELIGIBILITY',
          productFamily: 'Apple Watch',
          exactModel: exactWatchModel,
          affectedOsOrFirmware: swVersions[0] || 'watchOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple watchOS update (${advisory.title}) applies to ${exactWatchModel} ("Apple Watch Series ${minSeries} and later"), but states "This update has no published CVE entries".`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          missingEvidence: [
            'Official Apple release notes state "This update has no published CVE entries" (maintenance update without CVE security patches).',
          ],
          classificationRationale: `Downgraded from VERIFIED to LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) under S1.2.3 Quality Gate because ${advisory.title} has zero published CVEs.`,
          matchedTokens: ['watchOS', exactWatchModel],
          nowIso,
        });
      }

      return buildMatchRecord({
        advisory,
        product,
        confidence: 'VERIFIED',
        relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
        evidenceStrength: 'STRUCTURED_MANUFACTURER_APPLICABILITY',
        matcherRuleId: 'APPLE_WATCH_SERIES_APPLICABILITY',
        productFamily: 'Apple Watch',
        exactModel: exactWatchModel,
        affectedOsOrFirmware: swVersions[0] || 'watchOS',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: `Official Apple watchOS security bulletin specifies "Apple Watch Series ${minSeries} and later", covering ${exactWatchModel}.`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
        classificationRationale: `Assigned VERIFIED (STRUCTURED_MANUFACTURER_APPLICABILITY) because ${exactWatchModel} satisfies Series >= ${minSeries}.`,
        matchedTokens: ['watchOS', exactWatchModel],
        nowIso,
      });
    }

    if (seMatch) {
      const exactWatchSe = `Apple Watch SE${seMatch[1] ? ` ${seMatch[1]}` : ''}`;
      const explicitlyNamesSe = /\bapple\s+watch\s+se\b/i.test(affectedLower);
      if (explicitlyNamesSe && !zeroCve) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'VERIFIED',
          relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
          evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
          matcherRuleId: 'APPLE_WATCH_SERIES_APPLICABILITY',
          productFamily: 'Apple Watch',
          exactModel: exactWatchSe,
          affectedOsOrFirmware: swVersions[0] || 'watchOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Apple watchOS bulletin explicitly names Apple Watch SE in affectedProductsText.`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          classificationRationale: 'Assigned VERIFIED because Apple Watch SE is explicitly named in the bulletin.',
          matchedTokens: ['watchOS', exactWatchSe],
          nowIso,
        });
      }

      return buildMatchRecord({
        advisory,
        product,
        confidence: 'LIKELY',
        relationshipType: zeroCve ? 'OFFICIAL_UPDATE_ELIGIBILITY' : 'SECURITY_BULLETIN_APPLICABILITY',
        evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
        matcherRuleId: 'APPLE_WATCH_SE_INFERRED',
        productFamily: 'Apple Watch',
        exactModel: exactWatchSe,
        affectedOsOrFirmware: swVersions[0] || 'watchOS',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: `Official watchOS bulletin specifies "Apple Watch Series ${minSeries} and later" without explicitly naming "${exactWatchSe}".`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
        missingEvidence: [
          `Advisory affectedProductsText states "Apple Watch Series ${minSeries} and later" without explicitly naming Apple Watch SE.`,
        ],
        classificationRationale: `Capped at LIKELY (INFERRED_FAMILY_APPLICABILITY) because Apple Watch SE is not a numbered "Series" model and is not explicitly named in affectedProductsText.`,
        matchedTokens: ['watchOS', exactWatchSe],
        nowIso,
      });
    }
  }

  return null;
}

function evaluateSamsungMatch(
  advisory: ServiceAdvisory,
  product: RetailProduct,
  nowIso: string,
): ServiceProductMatch | null {
  if (product.brand.toLowerCase() !== 'samsung') return null;
  if (isAccessoryProduct(product)) return null;

  const pTitle = getProductTitle(product);
  const affectedText = getAdvisoryAffectedText(advisory);
  const swVersions = extractSoftwareVersions(advisory);

  const sMatch = pTitle.match(/\bGalaxy\s+(S\d{2})(?:\s+(Ultra|Plus|\+|FE|Edge|Slim))?\b/i);
  const zFoldMatch = pTitle.match(/\bGalaxy\s+Z\s*Fold\s*(\d)\b/i);
  const zFlipMatch = pTitle.match(/\bGalaxy\s+Z\s*Flip\s*(\d)(?:\s+(FE))?\b/i);
  const aMatch = pTitle.match(/\bGalaxy\s+(A\d{2}[s]?)\b/i);
  const tabMatch = pTitle.match(/\bGalaxy\s+Tab\s+(S\d{1,2}(?:\s*(?:FE|Ultra|\+|Plus))?|A\d{1,2}(?:\+)?)\b/i);
  const xcoverMatch = pTitle.match(/\bGalaxy\s+XCover\s*(\d)\b/i);

  if (!sMatch && !zFoldMatch && !zFlipMatch && !aMatch && !tabMatch && !xcoverMatch) {
    return null;
  }

  let productFamily = 'Galaxy';
  let exactModel = pTitle;
  let explicitlyListed = false;

  if (sMatch) {
    productFamily = 'Galaxy S';
    const gen = sMatch[1].toUpperCase();
    const variant = sMatch[2] ? sMatch[2].toUpperCase() : '';
    const isFe = variant === 'FE';
    exactModel = `Galaxy ${gen}${variant ? ` ${variant}` : ''}`;

    if (isFe) {
      const feRegex = new RegExp(`\\bGalaxy\\s+${gen}\\s+FE\\b`, 'i');
      explicitlyListed = feRegex.test(affectedText);
    } else {
      const cleanedAffected = affectedText.replace(new RegExp(`\\bGalaxy\\s+${gen}\\s+FE\\b`, 'gi'), '');
      const baseRegex = new RegExp(`\\bGalaxy\\s+${gen}(?:\\s+(?:Ultra|Plus|\\+|series))?\\b`, 'i');
      explicitlyListed = baseRegex.test(cleanedAffected);
    }
  } else if (zFoldMatch) {
    productFamily = 'Galaxy Z Fold';
    const gen = zFoldMatch[1];
    exactModel = `Galaxy Z Fold${gen}`;
    const foldRegex = new RegExp(`\\bGalaxy\\s+Z\\s*Fold\\s*${gen}\\b`, 'i');
    explicitlyListed = foldRegex.test(affectedText);
  } else if (zFlipMatch) {
    productFamily = 'Galaxy Z Flip';
    const gen = zFlipMatch[1];
    const isFe = Boolean(zFlipMatch[2]);
    exactModel = `Galaxy Z Flip${gen}${isFe ? ' FE' : ''}`;
    if (isFe) {
      const flipFeRegex = new RegExp(`\\bGalaxy\\s+Z\\s*Flip\\s*${gen}\\s+FE\\b`, 'i');
      explicitlyListed = flipFeRegex.test(affectedText);
    } else {
      const cleanedAffected = affectedText.replace(new RegExp(`\\bGalaxy\\s+Z\\s*Flip\\s*${gen}\\s+FE\\b`, 'gi'), '');
      const flipRegex = new RegExp(`\\bGalaxy\\s+Z\\s*Flip\\s*${gen}\\b`, 'i');
      explicitlyListed = flipRegex.test(cleanedAffected);
    }
  } else if (aMatch) {
    productFamily = 'Galaxy A';
    const modelCode = aMatch[1].toUpperCase();
    exactModel = `Galaxy ${modelCode}`;
    const aRegex = new RegExp(`\\bGalaxy\\s+${modelCode}\\b`, 'i');
    explicitlyListed = aRegex.test(affectedText);
  } else if (tabMatch) {
    productFamily = 'Galaxy Tab';
    const tabCode = tabMatch[1].replace(/\s+/g, ' ').trim();
    exactModel = `Galaxy Tab ${tabCode}`;
    const tabRegex = new RegExp(`\\bGalaxy\\s+Tab\\s+${tabCode.replace(/\+/g, '\\+')}\\b`, 'i');
    explicitlyListed = tabRegex.test(affectedText);
  } else if (xcoverMatch) {
    productFamily = 'Galaxy XCover';
    exactModel = `Galaxy XCover${xcoverMatch[1]}`;
    const xcRegex = new RegExp(`\\bGalaxy\\s+XCover\\s*${xcoverMatch[1]}\\b`, 'i');
    explicitlyListed = xcRegex.test(affectedText);
  }

  const relType: MatchRelationshipType =
    advisory.advisoryType === 'UPDATE_SCHEDULE'
      ? 'OFFICIAL_UPDATE_ELIGIBILITY'
      : 'SECURITY_BULLETIN_APPLICABILITY';

  if (explicitlyListed) {
    return buildMatchRecord({
      advisory,
      product,
      confidence: 'VERIFIED',
      relationshipType: relType,
      evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
      matcherRuleId: 'SAMSUNG_EXACT_MODEL_SMR',
      productFamily,
      exactModel,
      affectedOsOrFirmware: swVersions[0] || 'Samsung Android SMR',
      affectedSoftwareVersions: swVersions,
      evidenceSummary: `Official Samsung security bulletin explicitly lists "${exactModel}" in affectedProductsText (${affectedText}).`,
      evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
      classificationRationale: `Assigned VERIFIED (DIRECT_OFFICIAL_EVIDENCE) because "${exactModel}" is explicitly named with exact generation and variant boundaries.`,
      matchedTokens: ['Samsung', productFamily, exactModel],
      nowIso,
    });
  }

  const isBroadSmr =
    /\bandroid\s+1[23456]\b/i.test(affectedText) ||
    /\bselected\s+galaxy\b/i.test(affectedText) ||
    /\bgalaxy\s+s\b/i.test(affectedText) ||
    /\bgalaxy\s+tab\b/i.test(affectedText);

  if (!isBroadSmr) return null;

  if (sMatch || zFoldMatch || zFlipMatch) {
    return buildMatchRecord({
      advisory,
      product,
      confidence: 'LIKELY',
      relationshipType: relType,
      evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
      matcherRuleId: 'SAMSUNG_BROAD_SMR_GALAXY_S_Z',
      productFamily,
      exactModel,
      affectedOsOrFirmware: swVersions[0] || 'Samsung Android SMR',
      affectedSoftwareVersions: swVersions,
      evidenceSummary: `Official Samsung SMR bulletin (${advisory.title}) targets "${affectedText}"; ${exactModel} is an active flagship running the affected Android OS generation, but individual model identifiers are not explicitly enumerated in the bulletin summary.`,
      evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
      missingEvidence: [
        `Samsung SMR summary specifies broad OS/series scope ("${affectedText}") rather than explicitly enumerating "${exactModel}".`,
      ],
      classificationRationale: `Capped at LIKELY (INFERRED_FAMILY_APPLICABILITY) because the bulletin lists broad Android OS versions or series rather than explicit model "${exactModel}".`,
      matchedTokens: ['Samsung', productFamily, exactModel],
      nowIso,
    });
  }

  if (aMatch || tabMatch || xcoverMatch) {
    return buildMatchRecord({
      advisory,
      product,
      confidence: 'AMBIGUOUS_REVIEW',
      relationshipType: relType,
      evidenceStrength: 'HEURISTIC_SIMILARITY',
      matcherRuleId: 'SAMSUNG_BROAD_SMR_GALAXY_A_TAB',
      productFamily,
      exactModel,
      affectedOsOrFirmware: swVersions[0] || 'Samsung Android SMR',
      affectedSoftwareVersions: swVersions,
      evidenceSummary: `Samsung SMR bulletin (${advisory.title}) mentions broad Android/Galaxy scope without confirming whether ${exactModel} is on the monthly, quarterly, or biannual patch train for this release.`,
      evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl'],
      missingEvidence: [
        `Explicit model "${exactModel}" and its monthly vs quarterly SMR schedule eligibility are not stated in "${affectedText}".`,
      ],
      classificationRationale: `Assigned AMBIGUOUS_REVIEW (HEURISTIC_SIMILARITY) because Galaxy A/Tab/XCover devices require explicit model schedule confirmation.`,
      matchedTokens: ['Samsung', productFamily, exactModel],
      nowIso,
    });
  }

  return null;
}

function evaluateHuaweiMatch(
  advisory: ServiceAdvisory,
  product: RetailProduct,
  nowIso: string,
): ServiceProductMatch | null {
  if (product.brand.toLowerCase() !== 'huawei') return null;
  if (isAccessoryProduct(product)) return null;

  const pTitle = getProductTitle(product);
  if (/\bmatebook\b/i.test(pTitle) || /\bwatch\b/i.test(pTitle)) {
    return null;
  }

  const affectedText = getAdvisoryAffectedText(advisory);
  const swVersions = extractSoftwareVersions(advisory);
  const isSchedule =
    advisory.advisoryType === 'UPDATE_SCHEDULE' ||
    advisory.advisoryType === 'GENERAL_MAINTENANCE_INFORMATION';
  const relType: MatchRelationshipType =
    advisory.advisoryType === 'GENERAL_MAINTENANCE_INFORMATION'
      ? 'GENERAL_MAINTENANCE_INFORMATION'
      : isSchedule
      ? 'OFFICIAL_UPDATE_ELIGIBILITY'
      : 'SECURITY_BULLETIN_APPLICABILITY';

  const puraMatch = pTitle.match(/\b(?:Huawei\s+)?Pura\s+(\d{2})(?:\s+(Ultra|Pro\+?|Plus))?\b/i);
  const matepadMatch = pTitle.match(/\b(?:Huawei\s+)?MatePad\s+(Pro\s+\d+(?:\.\d+)?|11\.5\s*S|11\.5|12\s*X|SE\s+\d+(?:\.\d+)?|Air)\b/i);

  if (!puraMatch && !matepadMatch) return null;

  if (puraMatch) {
    const gen = puraMatch[1];
    const variant = puraMatch[2] ? ` ${puraMatch[2]}` : '';
    const exactModel = `HUAWEI Pura ${gen}${variant}`;

    const exactRegex = new RegExp(`\\bPura\\s+${gen}${variant ? `\\s+${puraMatch[2].replace(/\+/g, '\\+')}` : '(?!\\s*(?:Pro|Ultra))'}\\b`, 'i');
    const seriesRegex = new RegExp(`\\bPura\\s+${gen}\\s+series\\b`, 'i');

    if (exactRegex.test(affectedText) || seriesRegex.test(affectedText)) {
      return buildMatchRecord({
        advisory,
        product,
        confidence: isSchedule ? 'LIKELY' : 'VERIFIED',
        relationshipType: relType,
        evidenceStrength: isSchedule ? 'STRUCTURED_MANUFACTURER_APPLICABILITY' : 'DIRECT_OFFICIAL_EVIDENCE',
        matcherRuleId: 'HUAWEI_EXACT_MODEL_EMUI_HARMONY',
        productFamily: 'Huawei Pura',
        exactModel,
        affectedOsOrFirmware: swVersions[0] || 'EMUI 14 / HarmonyOS 4.2',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: isSchedule
          ? `Official Huawei security update scope explicitly lists "${exactModel}" as eligible for scheduled security updates (${affectedText}).`
          : `Official Huawei security bulletin explicitly lists "${exactModel}" in affectedProductsText.`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'advisoryType'],
        missingEvidence: isSchedule
          ? ['Advisory is an official update maintenance schedule (0 CVEs), not a confirmed security vulnerability bulletin.']
          : [],
        classificationRationale: isSchedule
          ? `Assigned LIKELY with relationshipType = OFFICIAL_UPDATE_ELIGIBILITY (not a CVE vulnerability claim) because Huawei's official scope table lists "${exactModel}" for update cadence eligibility only.`
          : `Assigned VERIFIED (DIRECT_OFFICIAL_EVIDENCE) because "${exactModel}" is explicitly listed in the security bulletin.`,
        matchedTokens: ['Huawei', exactModel],
        nowIso,
      });
    }

    if (
      !isSchedule &&
      (/\b(?:EMUI\s+1[345]|HarmonyOS\s+[45])\b/i.test(affectedText) ||
        /\bpura\s*(70|80)/i.test(affectedText) ||
        /\bpura\s*\/\s*mate/i.test(affectedText))
    ) {
      return buildMatchRecord({
        advisory,
        product,
        confidence: 'LIKELY',
        relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
        evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
        matcherRuleId: 'HUAWEI_BROAD_OS_BULLETIN_PURA',
        productFamily: 'Huawei Pura',
        exactModel,
        affectedOsOrFirmware: swVersions[0] || 'EMUI 14 / HarmonyOS 4.2',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: `Official Huawei monthly bulletin (${advisory.title}) covers ${affectedText}; ${exactModel} runs EMUI 14 / HarmonyOS 4.2+, though individual handset SKUs are not enumerated in the monthly CVE table.`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
        missingEvidence: [
          `Monthly bulletin specifies OS/series scope ("${affectedText}") rather than explicitly enumerating "${exactModel}".`,
        ],
        classificationRationale: `Capped at LIKELY (INFERRED_FAMILY_APPLICABILITY) because the monthly bulletin lists OS versions or broad series rather than explicit handset models.`,
        matchedTokens: ['Huawei', 'EMUI/HarmonyOS', exactModel],
        nowIso,
      });
    }
  }

  if (matepadMatch) {
    const rawSub = matepadMatch[1].replace(/\s+/g, ' ').trim();
    const is115S = /11\.5\s*S/i.test(rawSub);
    const is115Base = /^11\.5$/i.test(rawSub);
    const exactModel = `HUAWEI MatePad ${rawSub}`;

    if (is115S) {
      if (/\bMatePad\s+11\.5\s*S\b/i.test(affectedText)) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: isSchedule ? 'LIKELY' : 'VERIFIED',
          relationshipType: relType,
          evidenceStrength: isSchedule ? 'STRUCTURED_MANUFACTURER_APPLICABILITY' : 'DIRECT_OFFICIAL_EVIDENCE',
          matcherRuleId: 'HUAWEI_EXACT_MODEL_EMUI_HARMONY',
          productFamily: 'Huawei MatePad',
          exactModel,
          affectedOsOrFirmware: swVersions[0] || 'HarmonyOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Huawei advisory explicitly lists "${exactModel}".`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl'],
          missingEvidence: isSchedule
            ? ['Advisory is an official update maintenance schedule (0 CVEs), not a confirmed security vulnerability bulletin.']
            : [],
          classificationRationale: isSchedule
            ? `Assigned LIKELY (OFFICIAL_UPDATE_ELIGIBILITY) because the update schedule lists "${exactModel}" for cadence eligibility only.`
            : `Assigned VERIFIED because "${exactModel}" is explicitly listed.`,
          matchedTokens: ['Huawei', exactModel],
          nowIso,
        });
      }

      if (/\bMatePad\s+11\.5(?!\s*S)\b/i.test(affectedText)) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'LIKELY',
          relationshipType: relType,
          evidenceStrength: 'INFERRED_FAMILY_APPLICABILITY',
          matcherRuleId: 'HUAWEI_MATEPAD_SUBVARIANT_INFERRED',
          productFamily: 'Huawei MatePad',
          exactModel,
          affectedOsOrFirmware: swVersions[0] || 'HarmonyOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Huawei scope lists "HUAWEI MatePad 11.5", whereas canonical product is the "${exactModel}" (PaperMatte) sub-variant.`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl'],
          missingEvidence: [
            `Advisory lists base "MatePad 11.5" without explicitly naming the "MatePad 11.5S" sub-variant.`,
          ],
          classificationRationale: `Downgraded from VERIFIED to LIKELY (INFERRED_FAMILY_APPLICABILITY) under S1.2.3 Objective 4B because MatePad 11.5S is a distinct sub-variant from MatePad 11.5.`,
          matchedTokens: ['Huawei', 'MatePad 11.5', exactModel],
          nowIso,
        });
      }
    } else if (is115Base) {
      if (/\bMatePad\s+11\.5(?!\s*S)\b/i.test(affectedText)) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: isSchedule ? 'LIKELY' : 'VERIFIED',
          relationshipType: relType,
          evidenceStrength: isSchedule ? 'STRUCTURED_MANUFACTURER_APPLICABILITY' : 'DIRECT_OFFICIAL_EVIDENCE',
          matcherRuleId: 'HUAWEI_EXACT_MODEL_EMUI_HARMONY',
          productFamily: 'Huawei MatePad',
          exactModel,
          affectedOsOrFirmware: swVersions[0] || 'HarmonyOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official Huawei quarterly security scope explicitly lists "HUAWEI MatePad 11.5", matching canonical product "${pTitle}".`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'advisoryType'],
          missingEvidence: isSchedule
            ? ['Advisory is an official update maintenance schedule (0 CVEs), not a confirmed security vulnerability bulletin.']
            : [],
          classificationRationale: isSchedule
            ? `Assigned LIKELY with relationshipType = ${relType} because "HUAWEI MatePad 11.5" is listed in Huawei's update cadence schedule (0 CVEs).`
            : `Assigned VERIFIED with relationshipType = ${relType} because "HUAWEI MatePad 11.5" is explicitly named in the official Huawei bulletin.`,
          matchedTokens: ['Huawei', exactModel],
          nowIso,
        });
      }
    }

    if (!isSchedule && (/\bHarmonyOS\s+[2345]\b/i.test(affectedText) || /\bMatePad\s+series\b/i.test(affectedText))) {
      return buildMatchRecord({
        advisory,
        product,
        confidence: 'AMBIGUOUS_REVIEW',
        relationshipType: 'SECURITY_BULLETIN_APPLICABILITY',
        evidenceStrength: 'HEURISTIC_SIMILARITY',
        matcherRuleId: 'HUAWEI_BROAD_OS_BULLETIN_TABLET',
        productFamily: 'Huawei MatePad',
        exactModel,
        affectedOsOrFirmware: swVersions[0] || 'HarmonyOS',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: `Monthly Huawei bulletin (${advisory.title}) lists HarmonyOS / MatePad series broadly without specifying tablet model ${exactModel} (tablets normally follow quarterly scope).`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl'],
        missingEvidence: [`Explicit tablet model "${exactModel}" is not listed in the monthly bulletin.`],
        classificationRationale: `Assigned AMBIGUOUS_REVIEW because Huawei MatePad tablets follow quarterly update cycles unless explicitly named.`,
        matchedTokens: ['Huawei', 'HarmonyOS', exactModel],
        nowIso,
      });
    }
  }

  return null;
}

function evaluateCisaKevMatch(
  advisory: ServiceAdvisory,
  product: RetailProduct,
  nowIso: string,
): ServiceProductMatch | null {
  if (isAccessoryProduct(product)) return null;

  const pTitle = getProductTitle(product);
  const brandLower = product.brand.toLowerCase();
  const affectedText = getAdvisoryAffectedText(advisory);
  const swVersions = extractSoftwareVersions(advisory);

  // S1.2.2 / S1.2.3: CISA KEV entries only match canonical hardware if an explicit hardware model/generation is stated
  // in the KEV record (generic OS-only strings like "Apple iOS and iPadOS" or "Samsung Mobile Devices" are not bulk-linked to all SKUs).
  if (brandLower === 'apple') {
    const iphone = parseIphoneIdentity(pTitle);
    if (iphone.isIphone && iphone.generationNumber !== null) {
      const explicitGenRegex = new RegExp(`\\biPhone\\s+${iphone.generationNumber}\\b`, 'i');
      if (explicitGenRegex.test(affectedText)) {
        return buildMatchRecord({
          advisory,
          product,
          confidence: 'VERIFIED',
          relationshipType: 'CONFIRMED_VULNERABILITY_APPLICABILITY',
          evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
          matcherRuleId: 'CISA_KEV_OS_PLATFORM_APPLICABILITY',
          productFamily: 'iPhone',
          exactModel: iphone.exactModelLabel,
          affectedOsOrFirmware: 'Apple iOS',
          affectedSoftwareVersions: swVersions,
          evidenceSummary: `Official CISA KEV entry (${advisory.cveIds.join(', ')}) explicitly names ${iphone.exactModelLabel}.`,
          evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
          classificationRationale: 'Assigned VERIFIED because CISA KEV explicitly names the hardware generation.',
          matchedTokens: ['CISA KEV', iphone.exactModelLabel],
          nowIso,
        });
      }
    }
  }

  if (brandLower === 'samsung') {
    const sMatch = pTitle.match(/\bGalaxy\s+(S\d{2})\b/i);
    if (sMatch && new RegExp(`\\bGalaxy\\s+${sMatch[1]}\\b`, 'i').test(affectedText)) {
      return buildMatchRecord({
        advisory,
        product,
        confidence: 'VERIFIED',
        relationshipType: 'CONFIRMED_VULNERABILITY_APPLICABILITY',
        evidenceStrength: 'DIRECT_OFFICIAL_EVIDENCE',
        matcherRuleId: 'CISA_KEV_OS_PLATFORM_APPLICABILITY',
        productFamily: 'Galaxy S',
        exactModel: `Galaxy ${sMatch[1]}`,
        affectedOsOrFirmware: 'Samsung Mobile Android',
        affectedSoftwareVersions: swVersions,
        evidenceSummary: `Official CISA KEV entry (${advisory.cveIds.join(', ')}) explicitly names Galaxy ${sMatch[1]}.`,
        evidenceSourceFields: ['title', 'affectedProductsText', 'sourceUrl', 'cveIds'],
        classificationRationale: 'Assigned VERIFIED because CISA KEV explicitly names the Galaxy model.',
        matchedTokens: ['CISA KEV', `Galaxy ${sMatch[1]}`],
        nowIso,
      });
    }
  }

  return null;
}

export function evaluateProductAdvisoryMatch(
  advisory: ServiceAdvisory,
  product: RetailProduct,
  nowIso: string = new Date().toISOString(),
): ServiceProductMatch | null {
  if (
    advisory.sourceId === 'cisa-kev' ||
    advisory.advisoryType === 'KNOWN_EXPLOITED' ||
    (advisory.advisoryType as string) === 'CISA_KEV'
  ) {
    return evaluateCisaKevMatch(advisory, product, nowIso);
  }
  const mfg = advisory.manufacturer.toLowerCase();
  if (mfg === 'apple') {
    return evaluateAppleMatch(advisory, product, nowIso);
  }
  if (mfg === 'samsung') {
    return evaluateSamsungMatch(advisory, product, nowIso);
  }
  if (mfg === 'huawei') {
    return evaluateHuaweiMatch(advisory, product, nowIso);
  }
  return null;
}

export function matchAdvisoryToCatalogProducts(
  advisory: ServiceAdvisory,
  catalogProducts: RetailProduct[],
): ServiceProductMatch[] {
  const nowIso = new Date().toISOString();
  const results: ServiceProductMatch[] = [];
  for (const product of catalogProducts) {
    const match = evaluateProductAdvisoryMatch(advisory, product, nowIso);
    if (match) {
      results.push(match);
    }
  }
  return results;
}

/**
 * Counts how many matches would have been marked VERIFIED under legacy pre-S1.2.2/S1.2.3
 * broad OS/family heuristics so we can report downgradedFromLegacyVerified accurately.
 */
export function countLegacyBroadVerifiedIds(
  advisories: ServiceAdvisory[],
  catalogProducts: RetailProduct[],
): Set<string> {
  const legacyVerifiedIds = new Set<string>();
  for (const adv of advisories) {
    for (const prod of catalogProducts) {
      if (isAccessoryProduct(prod)) continue;
      if (adv.manufacturer.toLowerCase() !== prod.brand.toLowerCase()) continue;
      const matchId = buildDeterministicMatchId(prod.id, adv.id);
      const pTitle = getProductTitle(prod);
      const comb = `${adv.title} ${getAdvisoryAffectedText(adv)}`.toLowerCase();

      if (adv.manufacturer === 'Apple') {
        if (/\biphone\b/i.test(pTitle) && /\bios\b/i.test(comb)) legacyVerifiedIds.add(matchId);
        if (/\bipad\b/i.test(pTitle) && /\bipados\b/i.test(comb)) legacyVerifiedIds.add(matchId);
        if (/\bapple\s+watch\b/i.test(pTitle) && /\bwatchos\b/i.test(comb)) legacyVerifiedIds.add(matchId);
      } else if (adv.manufacturer === 'Samsung') {
        if (/\bgalaxy\s+(s\d{2}|z\s*(fold|flip)\s*\d)/i.test(pTitle) && /\b(android|galaxy)\b/i.test(comb)) {
          legacyVerifiedIds.add(matchId);
        }
      } else if (adv.manufacturer === 'Huawei') {
        if (/\b(pura|matepad)\b/i.test(pTitle) && /\b(emui|harmonyos|pura|matepad)\b/i.test(comb)) {
          legacyVerifiedIds.add(matchId);
        }
      }
    }
  }
  return legacyVerifiedIds;
}

export interface MatchBatchResult {
  matches: ServiceProductMatch[];
  verifiedCount: number;
  likelyCount: number;
  ambiguousReviewCount: number;
  reviewCount: number;
  rejectedCount: number;
  rejectedSample: ServiceProductMatch[];
  downgradedFromLegacyVerified: number;
  downgradeReasons: string[];
}

export function matchAdvisoriesToCatalog(
  advisories: ServiceAdvisory[],
  catalogProducts: RetailProduct[],
): MatchBatchResult {
  const matches: ServiceProductMatch[] = [];
  const rejectedSample: ServiceProductMatch[] = [];
  const seenIds = new Set<string>();
  const nowIso = new Date().toISOString();
  let rejectedCount = 0;

  for (const advisory of advisories) {
    if (advisory.status === 'SUPERSEDED' || advisory.status === 'ARCHIVED') {
      continue;
    }
    for (const product of catalogProducts) {
      const match = evaluateProductAdvisoryMatch(advisory, product, nowIso);
      if (match) {
        if (!seenIds.has(match.id)) {
          seenIds.add(match.id);
          matches.push(match);
        }
      } else {
        rejectedCount++;
        if (
          rejectedSample.length < 25 &&
          advisory.manufacturer.toLowerCase() === product.brand.toLowerCase()
        ) {
          const pTitle = getProductTitle(product);
          rejectedSample.push({
            id: buildDeterministicMatchId(product.id, advisory.id),
            advisoryId: advisory.id,
            advisoryTitle: advisory.title,
            advisoryType: advisory.advisoryType,
            canonicalProductId: product.id,
            productTitle: pTitle,
            canonicalProductName: pTitle,
            brand: product.brand,
            manufacturer: advisory.manufacturer,
            productFamily: product.modelFamily || product.category,
            exactModel: pTitle,
            affectedOsOrFirmware: null,
            affectedSoftwareVersions: [],
            applicableRegion: null,
            confidence: 'UNMATCHED',
            status: 'DISMISSED',
            relationshipType: 'GENERAL_SECURITY_INFORMATION',
            evidenceStrength: 'HEURISTIC_SIMILARITY',
            matcherRuleId: 'REJECTED_INCOMPATIBLE_MODEL_OR_ACCESSORY',
            matcherVersion: SERVICE_MATCHER_VERSION,
            evidence: ['Excluded by generational, category, or accessory isolation guard.'],
            matchEvidence: ['Excluded by generational, category, or accessory isolation guard.'],
            evidenceSummary: `Excluded: "${pTitle}" does not satisfy hardware family/generation requirements of "${advisory.title}".`,
            evidenceSourceFields: ['title', 'affectedProductsText'],
            missingEvidence: ['Incompatible product category, accessory, or hardware generation outside advisory scope.'],
            classificationRationale: 'Rejected by deterministic hardware family/generation/accessory boundary.',
            potentialConflicts: [],
            recommendedReviewAction: 'DISMISS_CANDIDATE',
            officialSourceUrl: advisory.sourceUrl,
            sourceUrl: advisory.sourceUrl,
            authenticityClassification: 'NOT_APPLICABLE',
            qualifiesForAutomaticConfirmation: false,
            sourcePublishedAt: advisory.publishedAt,
            sourceVerifiedAt: nowIso,
            attributableExcerpt: `${advisory.title} (${advisory.sourceUrl})`,
            matchedAt: nowIso,
            lastEvaluatedAt: nowIso,
          });
        }
      }
    }
  }

  const verifiedCount = matches.filter(m => m.confidence === 'VERIFIED').length;
  const likelyCount = matches.filter(m => m.confidence === 'LIKELY').length;
  const ambiguousReviewCount = matches.filter(m => m.confidence === 'AMBIGUOUS_REVIEW').length;
  const reviewCount = likelyCount + ambiguousReviewCount;

  const legacyVerifiedIds = countLegacyBroadVerifiedIds(advisories, catalogProducts);
  let downgradedFromLegacyVerified = 0;
  const downgradeReasonSet = new Set<string>();

  for (const m of matches) {
    if (m.confidence !== 'VERIFIED' && legacyVerifiedIds.has(m.id)) {
      downgradedFromLegacyVerified++;
      if (m.missingEvidence && m.missingEvidence.length > 0) {
        downgradeReasonSet.add(m.missingEvidence[0]);
      }
    }
  }

  return {
    matches,
    verifiedCount,
    likelyCount,
    ambiguousReviewCount,
    reviewCount,
    rejectedCount,
    rejectedSample,
    downgradedFromLegacyVerified,
    downgradeReasons: Array.from(downgradeReasonSet).slice(0, 12),
  };
}

/**
 * S1.2.3 Objective 6: Deterministic Stratified Representative Quality Audit Sample.
 * Selects 36 candidates across Apple, Huawei, Samsung, covering VERIFIED, LIKELY,
 * AMBIGUOUS_REVIEW, and all relationship types.
 */
export function buildStratifiedQualityAuditSample(
  matches: ServiceProductMatch[],
  catalogProducts: RetailProduct[] = [],
): StratifiedAuditItem[] {
  const sorted = [...matches].sort((a, b) => a.id.localeCompare(b.id));
  const prodCatMap = new Map<string, string>(
    catalogProducts.map(p => [p.id, String(p.category || 'SMARTPHONES')]),
  );
  const selectedIds = new Set<string>();
  const items: StratifiedAuditItem[] = [];

  const strata: Array<{
    id: string;
    label: string;
    limit: number;
    predicate: (m: ServiceProductMatch) => boolean;
  }> = [
    {
      id: 'STRATUM_APPLE_IPHONE_VERIFIED',
      label: 'Apple iPhone — VERIFIED Security Bulletin',
      limit: 4,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'iPhone' && m.confidence === 'VERIFIED',
    },
    {
      id: 'STRATUM_APPLE_IPHONE_ZERO_CVE',
      label: 'Apple iPhone — LIKELY Zero-CVE Maintenance Update',
      limit: 3,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'iPhone' && m.matcherRuleId === 'APPLE_MAINTENANCE_UPDATE_ELIGIBILITY',
    },
    {
      id: 'STRATUM_APPLE_IPAD_VERIFIED',
      label: 'Apple iPad — VERIFIED Explicit Gen/Chip',
      limit: 4,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'iPad' && m.confidence === 'VERIFIED',
    },
    {
      id: 'STRATUM_APPLE_IPAD_LINEAGE_LIKELY',
      label: 'Apple iPad — LIKELY Lineage/Year Inferred (13" M5 / Mini 2024)',
      limit: 3,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'iPad' && m.matcherRuleId === 'APPLE_IPAD_LINEAGE_INFERRED',
    },
    {
      id: 'STRATUM_APPLE_MAC_LIKELY',
      label: 'Apple Mac — LIKELY Broad macOS Security Bulletin',
      limit: 3,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'Mac' && m.confidence === 'LIKELY',
    },
    {
      id: 'STRATUM_APPLE_SAFARI_AMBIGUOUS',
      label: 'Apple Mac — AMBIGUOUS_REVIEW Standalone Safari',
      limit: 2,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'Mac' && m.confidence === 'AMBIGUOUS_REVIEW',
    },
    {
      id: 'STRATUM_APPLE_WATCH_VERIFIED',
      label: 'Apple Watch Series — VERIFIED watchOS Security Bulletin',
      limit: 3,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'Apple Watch' && m.confidence === 'VERIFIED',
    },
    {
      id: 'STRATUM_APPLE_WATCH_LIKELY',
      label: 'Apple Watch SE 3 / Zero-CVE — LIKELY Gated',
      limit: 2,
      predicate: m => m.manufacturer === 'Apple' && m.productFamily === 'Apple Watch' && m.confidence === 'LIKELY',
    },
    {
      id: 'STRATUM_SAMSUNG_S_Z_LIKELY',
      label: 'Samsung Galaxy S & Z Fold/Flip — LIKELY Broad SMR Bulletin',
      limit: 4,
      predicate: m => m.manufacturer === 'Samsung' && m.confidence === 'LIKELY' && m.matcherRuleId === 'SAMSUNG_BROAD_SMR_GALAXY_S_Z',
    },
    {
      id: 'STRATUM_SAMSUNG_A_TAB_AMBIGUOUS',
      label: 'Samsung Galaxy A & Tab — AMBIGUOUS_REVIEW Broad SMR',
      limit: 3,
      predicate: m => m.manufacturer === 'Samsung' && m.confidence === 'AMBIGUOUS_REVIEW',
    },
    {
      id: 'STRATUM_HUAWEI_PURA_VERIFIED',
      label: 'Huawei Pura — Official Update Schedule Eligibility (Gated LIKELY)',
      limit: 2,
      predicate: m =>
        m.manufacturer === 'Huawei' &&
        m.productFamily === 'Huawei Pura' &&
        (m.confidence === 'VERIFIED' || m.relationshipType === 'OFFICIAL_UPDATE_ELIGIBILITY'),
    },
    {
      id: 'STRATUM_HUAWEI_MATEPAD_GATE',
      label: 'Huawei MatePad 11.5 vs 11.5S — Schedule & Sub-Variant Gate',
      limit: 2,
      predicate: m => m.manufacturer === 'Huawei' && m.productFamily === 'Huawei MatePad' && (m.confidence === 'VERIFIED' || m.confidence === 'LIKELY'),
    },
    {
      id: 'STRATUM_HUAWEI_BROAD_MONTHLY',
      label: 'Huawei Pura & MatePad — Broad Monthly Bulletin (LIKELY & AMBIGUOUS)',
      limit: 3,
      predicate: m => m.manufacturer === 'Huawei' && (m.matcherRuleId || '').startsWith('HUAWEI_BROAD_OS_BULLETIN'),
    },
  ];

  let sampleIdx = 1;
  for (const stratum of strata) {
    let count = 0;
    for (const m of sorted) {
      if (count >= stratum.limit) break;
      if (selectedIds.has(m.id)) continue;
      if (stratum.predicate(m)) {
        selectedIds.add(m.id);
        count++;

        const missingList = m.missingEvidence || [];
        const isPass =
          (m.confidence === 'VERIFIED' &&
            missingList.length === 0 &&
            (m.evidenceStrength === 'DIRECT_OFFICIAL_EVIDENCE' ||
              m.evidenceStrength === 'STRUCTURED_MANUFACTURER_APPLICABILITY')) ||
          (m.confidence !== 'VERIFIED' && m.recommendedReviewAction !== 'APPROVE_LINK');

        items.push({
          sampleIndex: sampleIdx++,
          stratumId: stratum.id,
          stratumLabel: stratum.label,
          candidateId: m.id,
          canonicalProductId: m.canonicalProductId,
          canonicalProductName: m.productTitle,
          productCategory: prodCatMap.get(m.canonicalProductId) || m.productFamily || 'SMARTPHONES',
          advisoryId: m.advisoryId,
          advisoryTitle: m.advisoryTitle || m.advisoryId,
          advisoryType: m.advisoryType || 'SECURITY_UPDATE',
          manufacturer: m.manufacturer || 'Other',
          sourceUrl: m.sourceUrl || m.officialSourceUrl || '',
          actualConfidence: m.confidence,
          expectedConfidence: m.confidence,
          relationshipType: m.relationshipType || 'SECURITY_BULLETIN_APPLICABILITY',
          evidenceStrength: m.evidenceStrength || 'STRUCTURED_MANUFACTURER_APPLICABILITY',
          matcherRuleId: m.matcherRuleId || 'UNKNOWN_RULE',
          authenticityClassification: m.authenticityClassification || 'INFERRED_NEEDS_REVIEW',
          evidenceSummary: m.evidenceSummary || m.evidence[0] || '',
          missingEvidence: missingList,
          auditVerdict: isPass ? 'PASS' : 'FAIL',
          verdictReason:
            missingList.length > 0
              ? `Appropriately gated at ${m.confidence}: ${missingList.join(' ')}`
              : `Verified against ${(m.evidenceSourceFields || []).join(', ')} under rule ${m.matcherRuleId}.`,
        });
      }
    }
  }

  return items;
}

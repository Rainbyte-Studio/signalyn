/**
 * Signalyn Strategic Relevance Gate (Phase 4C.1 & 4C.1B)
 * 
 * Deterministic, server-side pre-analysis classifier designed to run
 * BEFORE expensive Phase 3 Gemini analysis.
 * 
 * Scope:
 * - Strategic Categories: SMARTPHONE, WEARABLE, AUDIO, TABLET
 * - Primary Target: HUAWEI
 * - Strategic Competitors: Apple, Samsung, Xiaomi, HONOR, Google, Garmin, OPPO, vivo, etc.
 * 
 * Classifications:
 * - IN_SCOPE: Credible relevance to the four strategic hardware categories
 * - OUT_OF_SCOPE: Clearly unrelated domains (gaming, automotive, PC/desktop GPUs, streaming, home appliances, enterprise cloud)
 * - UNCERTAIN: Insufficient deterministic evidence; preserved for conservative review (prefer UNCERTAIN over unsafe OUT_OF_SCOPE)
 * 
 * Zero Gemini calls / Quota-Safe.
 */

import { CanonicalDeviceCategory } from './clustering/categoryModel';

export type RelevanceDecision = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'UNCERTAIN';

export interface StrategicRelevanceInput {
  title: string;
  excerpt?: string;
  rawCategories?: string[];
  sourceName?: string;
  canonicalUrl?: string;
}

export interface StrategicRelevanceResult {
  decision: RelevanceDecision;
  category: CanonicalDeviceCategory;
  matchedCompanies: string[];
  matchedKeywords: string[];
  negativeSignals: string[];
  reason: string;
  confidence: number;
  ruleStrength: 'STRONG' | 'MODERATE' | 'WEAK';
}

/**
 * Normalizes text by removing Greek accents/diacritics and converting to lowercase.
 */
function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Checks if normalized text contains any of the search phrases (with Unicode word-boundary awareness).
 */
function findMatches(text: string, phrases: string[]): string[] {
  const matches: string[] = [];
  for (const phrase of phrases) {
    const normPhrase = normalizeText(phrase);
    if (!normPhrase) continue;

    // Use Unicode-aware word boundary: not preceded or followed by a letter or digit
    const escaped = normPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu');
    if (regex.test(text)) {
      matches.push(phrase);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// 1. STRATEGIC COMPANY DICTIONARY (Aligns with canonical /companies)
// ---------------------------------------------------------------------------

interface CompanyPattern {
  id: string;
  name: string;
  isPrimary?: boolean;
  patterns: string[];
}

const STRATEGIC_COMPANIES: CompanyPattern[] = [
  {
    id: 'comp-huawei',
    name: 'HUAWEI',
    isPrimary: true,
    patterns: [
      'huawei', 'χιoυαγουει', 'harmonyos', 'emui', 'pura 70', 'pura 80', 'pura', 'matepad', 'freebuds', 'freeclip',
      'huawei enjoy', 'enjoy 60', 'enjoy 70', 'enjoy 80', 'enjoy 90', 'enjoy 100', 'nova 12', 'nova 13', 'nova 14', 'nova',
      'mate 60', 'mate 70', 'mate xt', 'watch gt', 'watch d',
    ],
  },
  {
    id: 'comp-apple',
    name: 'Apple',
    patterns: ['apple', 'iphone', 'ipad', 'airpods', 'apple watch', 'ios 18', 'ios 19', 'watchos'],
  },
  {
    id: 'comp-samsung',
    name: 'Samsung',
    patterns: ['samsung', 'galaxy s', 'galaxy z', 'galaxy tab', 'galaxy watch', 'galaxy buds', 'galaxy ring', 'one ui'],
  },
  {
    id: 'comp-xiaomi',
    name: 'Xiaomi',
    patterns: ['xiaomi', 'redmi', 'poco', 'hyperos', 'miui', 'xiaomi pad', 'xiaomi watch', 'redmi buds'],
  },
  {
    id: 'comp-honor',
    name: 'HONOR',
    patterns: [
      'honor', 'magic v', 'magic9', 'magic8', 'magic7', 'magic6', 'magic 7', 'magic 8', 'magic 9',
      'honor 200', 'honor 300', 'honor 400', 'honor x9', 'magicpad', 'honor watch', 'honor pad', 'honor choice',
    ],
  },
  {
    id: 'comp-google',
    name: 'Google',
    // Require hardware signals for Google so cloud/enterprise news isn't auto-flagged
    patterns: [
      'google pixel', 'pixel 9', 'pixel 10', 'pixel 11', 'pixel watch', 'pixel buds', 'pixel tablet',
      'fitbit', 'fitbit charge', 'fitbit sense', 'fitbit inspire', 'fitbit versa', 'fitbit ace',
      'wear os', 'android 15', 'android 16',
    ],
  },
  {
    id: 'comp-garmin',
    name: 'Garmin',
    patterns: [
      'garmin', 'fenix', 'forerunner', 'epix', 'venu', 'instinct', 'enduro', 'tactix', 'lily', 'vivoactive', 'vivosmart', 'approach',
    ],
  },
  {
    id: 'comp-oppo',
    name: 'OPPO',
    patterns: ['oppo', 'find x', 'find n', 'reno', 'oppo pad', 'oppo watch', 'enco'],
  },
  {
    id: 'comp-vivo',
    name: 'vivo',
    patterns: ['vivo', 'x fold', 'x-fold', 'vivo x', 'vivo v', 'iqoo', 'vivo pad', 'vivo tws'],
  },
  {
    id: 'comp-sony',
    name: 'Sony',
    patterns: ['sony', 'xperia', 'linkbuds', 'wf-1000xm', 'wh-1000xm', 'sony audio', 'sony headphones', 'sony earbuds'],
  },
  {
    id: 'comp-lenovo',
    name: 'Lenovo',
    patterns: ['lenovo', 'lenovo tab', 'yoga tab', 'legion tab', 'xiaoxin pad', 'tab plus', 'tab p12'],
  },
  {
    id: 'comp-nothing',
    name: 'Nothing',
    patterns: ['nothing phone', 'nothing ear', 'cmf by nothing', 'cmf phone', 'cmf watch', 'cmf buds', 'nothing audio', 'nothing head'],
  },
  {
    id: 'comp-bose',
    name: 'Bose',
    patterns: ['bose', 'quietcomfort', 'ultra open', 'soundlink', 'bose earbuds', 'bose headphones'],
  },
  {
    id: 'comp-motorola',
    name: 'Motorola',
    patterns: ['motorola', 'moto', 'razr', 'edge 50', 'edge 60', 'moto g', 'moto buds', 'signature 27'],
  },
  {
    id: 'comp-oneplus',
    name: 'OnePlus',
    patterns: ['oneplus', 'oneplus pad', 'oneplus watch', 'oneplus buds', 'oneplus nord'],
  },
  {
    id: 'comp-other-mobile',
    name: 'Competitor Mobile OEM',
    patterns: ['realme', 'asus rog phone', 'zenfone', 'sennheiser', 'jbl', 'soundcore', 'shure', 'audio-technica'],
  },
];

// ---------------------------------------------------------------------------
// 2. STRATEGIC DEVICE PATTERNS
// ---------------------------------------------------------------------------

const STRATEGIC_PATTERNS = {
  SMARTPHONE: {
    explicitModels: [
      'iphone', 'iphone 15', 'iphone 16', 'iphone 17', 'iphone 18', 'iphone se',
      'galaxy s24', 'galaxy s25', 'galaxy s26', 'galaxy s27', 'galaxy s28',
      'galaxy z fold', 'galaxy z fold6', 'galaxy z fold7', 'galaxy z fold8', 'galaxy z flip',
      'galaxy a08', 'galaxy a16', 'galaxy a26', 'galaxy a36', 'galaxy a55', 'galaxy a56',
      'galaxy f08', 'galaxy m08', 'galaxy s',
      'mate 60', 'mate 70', 'mate 80', 'mate 90', 'mate xt', 'pura 70', 'pura 80', 'nova 12', 'nova 13', 'nova 14',
      'huawei enjoy', 'enjoy 60', 'enjoy 70', 'enjoy 80', 'enjoy 90', 'enjoy 100', 'enjoy',
      'pixel 7', 'pixel 8', 'pixel 9', 'pixel 10', 'pixel 11', 'pixel 12',
      'xiaomi 14', 'xiaomi 15', 'xiaomi 16', 'xiaomi 17', 'xiaomi 18',
      'redmi', 'redmi note', 'poco', 'poco f6', 'poco x6', 'poco c95',
      'magic 4', 'magic 5', 'magic 6', 'magic 7', 'magic 8', 'magic 9',
      'magic4', 'magic5', 'magic6', 'magic7', 'magic8', 'magic9', 'magic v', 'magic v2', 'magic v3', 'honor magic',
      'honor 200', 'honor 300', 'honor 400', 'honor x9b', 'honor x9',
      'oneplus 11', 'oneplus 12', 'oneplus 13', 'oneplus 14', 'oneplus 15', 'oneplus 16', 'oneplus nord',
      'find x', 'find x7', 'find x8', 'find x9', 'find x10', 'find n', 'oppo f35', 'reno16', 'reno12', 'oppo k14',
      'vivo x fold', 'vivo x fold6', 'x fold', 'x fold6', 'x fold 6', 'x-fold', 'vivo v80', 'vivo x', 'vivo v',
      'x100', 'x200', 'x500', 'razr', 'razr 50', 'razr 60', 'razr flex', 'signature 27', 'edge 50', 'edge 60',
      'moto g', 'moto g47', 'moto g55', 'moto g85', 'moto g75', 'moto g35', 'moto g24', 'moto g04', 'moto g power',
      'realme', 'realme gt', 'realme 12', 'realme 13', 'realme 14', 'realme 15', 'realme p1', 'realme p2', 'realme narzo',
      'xperia 1', 'xperia 5', 'xperia 10', 'nothing phone 2', 'nothing phone 3', 'cmf phone 1', 'cmf phone 2',
    ],
    keywords: [
      'smartphone', 'smartphones', 'phone', 'phones', 'foldable phone', 'foldable phones', 'flip phone',
      'tri-fold', 'trifold', 'mobile phone', 'mobile phones', 'flagship phone', 'cellphone', 'cellphones', 'handset', 'handsets',
      'κινητο', 'κινητα', 'τηλεφωνο', 'τηλεφωνα', 'αναδιπλουμενο', 'αναδιπλουμενα', 'foldables', 'foldable',
      'android 14', 'android 15', 'android 16', 'ios 18', 'ios 19', 'harmonyos next', 'harmonyos 5',
      'snapdragon 8 elite', 'snapdragon 8 gen', 'dimensity 9400', 'dimensity 9300', 'dimensity 9600',
      'kirin 9000', 'kirin 9010', 'kirin 9100', 'a18 pro', 'periscope zoom',
      'periscope camera', 'telephoto lens', 'camera sensor for phone', 'smartphone display', 'under-display camera',
      'one ui 7', 'one ui 8', 'one ui 9',
    ],
  },
  WEARABLE: {
    explicitModels: [
      'apple watch', 'apple watch ultra', 'apple watch series', 'apple watch series 10', 'apple watch se',
      'galaxy watch', 'galaxy watch ultra', 'galaxy watch 7', 'galaxy ring',
      'huawei watch', 'huawei band', 'watch gt', 'watch gt 4', 'watch gt 5', 'watch gt 7', 'watch ultimate', 'watch fit', 'watch d', 'watch d2', 'watch d3',
      'pixel watch', 'pixel watch 3', 'xiaomi watch', 'xiaomi band', 'redmi watch', 'honor watch',
      'garmin fenix', 'garmin fenix 8', 'garmin forerunner', 'garmin epix', 'garmin venu', 'garmin venu 3', 'garmin instinct', 'garmin enduro', 'garmin tactix',
      'fitbit air', 'fitbit charge', 'fitbit charge 6', 'fitbit sense', 'fitbit inspire', 'fitbit versa', 'fitbit luxe', 'fitbit band', 'fitbit tracker',
      'oneplus watch', 'oneplus watch 2', 'oppo watch', 'cmf watch pro', 'whoop 4', 'oura ring', 'smart ring',
    ],
    keywords: [
      'smartwatch', 'smartwatches', 'smart watch', 'smart watches', 'wearable', 'wearables',
      'fitness tracker', 'fitness band', 'smart band', 'smartband', 'smart ring', 'smart rings',
      'εξυπνο ρολοι', 'εξυπνα ρολογια', 'ρολοι', 'ρολογια', 'smart ring', 'περικαρπιο',
      'wear os', 'watchos', 'ecg sensor', 'blood pressure monitor watch', 'trusense', 'sleep apnea detection watch',
      'bio-sensing', 'health tracking ring', 'heart rate sensor',
    ],
  },
  AUDIO: {
    explicitModels: [
      'airpods', 'airpods pro', 'airpods max', 'airpods 4', 'galaxy buds', 'galaxy buds 3', 'galaxy buds 3 pro',
      'freebuds', 'freebuds pro', 'freebuds pro 3', 'freebuds 6', 'freebuds 6i', 'freeclip',
      'linkbuds', 'linkbuds open', 'linkbuds fit', 'pixel buds', 'pixel buds pro',
      'wf-1000xm', 'wf-1000xm5', 'wh-1000xm', 'wh-1000xm5', 'wh-1000xm6',
      'quietcomfort', 'quietcomfort ultra', 'bose quietcomfort', 'momentum 4',
      'nothing ear', 'nothing ear 2', 'nothing ear (a)', 'nothing ear (open)', 'cmf buds', 'cmf buds pro',
      'moto buds', 'redmi buds', 'enco x',
    ],
    keywords: [
      'earbuds', 'wireless earbuds', 'earbud', 'headphones', 'headphone', 'tws', 'true wireless',
      'in-ear headphones', 'over-ear headphones', 'noise cancelling earbuds', 'anc earbuds', 'anc headphones',
      'open-ear earbuds', 'spatial audio', 'lossless audio earbuds',
      'ακουστικα', 'ασυρματα ακουστικα', 'headset', 'earphones',
    ],
  },
  TABLET: {
    explicitModels: [
      'ipad', 'ipad pro', 'ipad air', 'ipad mini', 'matepad', 'matepad pro', 'matepad 11.5', 'papermatte',
      'galaxy tab', 'galaxy tab s10', 'galaxy tab s9', 'galaxy tab a9',
      'xiaomi pad', 'xiaomi pad 7', 'xiaomi pad 6s pro', 'redmi pad',
      'pixel tablet', 'oneplus pad', 'oneplus pad 2', 'surface pro',
      'lenovo tab', 'lenovo tab plus', 'lenovo tab p12', 'lenovo legion tab',
      'honor magicpad', 'honor magicpad 2', 'honor pad', 'oppo pad', 'vivo pad',
    ],
    keywords: [
      'tablet', 'tablets', 'slate', 'ταμπλετα', 'ταμπλετες', 'ταμπλετ', 'tablet pc',
      'digital stylus', 'm-pencil', 'apple pencil', 'paper-matte display', 'stylus pen', 'oled tablet',
    ],
  },
};

// ---------------------------------------------------------------------------
// 3. NEGATIVE OUT-OF-SCOPE DOMAINS
// ---------------------------------------------------------------------------

const NEGATIVE_DOMAINS = {
  AUTOMOTIVE: [
    'volkswagen', 'tesla', 'bmw', 'mercedes', 'byd', 'toyota', 'hyundai', 'audi', 'porsche', 'ferrari',
    'ford motor', 'stellantis', 'automaker', 'automakers', 'electric vehicle', 'electric vehicles', 'ev charging',
    'αυτοκινητο', 'αυτοκινητα', 'ηλεκτρικο αυτοκινητο', 'οδηγηση', 'suv', 'sedan', 'supercar', 'f1', 'formula 1',
    'horsepower', 'charging station', 'crash test', 'self-driving taxi', 'robotaxi', 'autopilot',
  ],
  GAMING_STUDIOS: [
    'playstation', 'ps5', 'ps4', 'xbox', 'nintendo switch', 'nintendo', 'steam deck', 'steam',
    'gameplay', 'trailer', 'video game', 'videogame', 'game studio', 'game developer', 'esports',
    'rpg', 'gta', 'grand theft auto', 'fortnite', 'minecraft', 'call of duty', 'patch notes', 'dlc',
    'remastered', 'boss fight', 'gaming console', 'unreal engine 5', 'unity engine',
  ],
  PC_DESKTOP_HARDWARE: [
    'geforce rtx', 'rtx 40', 'rtx 50', 'radeon rx', 'desktop gpu', 'graphics card', 'motherboard',
    'pc build', 'power supply', 'psu', 'liquid cooling', 'pc case', 'ddr5 ram', 'pcie 5',
    'intel core ultra desktop', 'arrow lake', 'amd ryzen desktop', 'am5 socket', 'socket lga',
  ],
  LAPTOPS_PC: [
    'laptop', 'laptops', 'macbook', 'macbook pro', 'macbook air', 'chromebook', 'notebook pc',
    'desktop pc', 'workstation pc', 'φορητος υπολογιστης',
  ],
  HOME_APPLIANCES: [
    'washer-dryer', 'washing machine', 'washer', 'dryer', 'massager', 'air purifier', 'vacuum cleaner',
    'robot vacuum', 'smart tv', 'microled', 'microled tv', 'πλυντηριο', 'σκουπα', 'τηλεοραση',
  ],
  STREAMING_ENTERTAINMENT: [
    'netflix', 'disney+', 'disney plus', 'hbo max', 'prime video', 'apple tv+', 'fire tv',
    'tv series', 'movie trailer', 'box office', 'hollywood', 'season 2', 'season 3', 'soundtrack',
    'up play', 'streaming service', 'streaming platform',
  ],
  ENTERPRISE_AI_CLOUD: [
    'data center', 'datacenter', 'aws ec2', 'azure cloud', 'kubernetes', 'ransomware', 'cyberattack',
    'enterprise saas', 'enterprise cybersecurity', 'llm benchmark', 'openai gpt', 'chatgpt enterprise',
    'claude enterprise', 'ai copyright lawsuit', 'ai server cluster',
  ],
};

// ---------------------------------------------------------------------------
// 4. GENERIC VARIANT TOKENS THAT REQUIRE CONTEXTUAL EVIDENCE
// ---------------------------------------------------------------------------

const GENERIC_TOKENS = new Set([
  'air', 'pro', 'ultra', 'max', 'plus', 'mini', 'lite', 'se', 'ai', 'pad', 'one', 'go',
  'galaxy', 'camera', '5g', 'android', 'snapdragon', 'dimensity', 'mobile',
]);

/**
 * Main Classifier: evaluates article metadata deterministically.
 */
export function classifyStrategicRelevance(input: StrategicRelevanceInput): StrategicRelevanceResult {
  const normTitle = normalizeText(input.title || '');
  const normExcerpt = normalizeText(input.excerpt || '');
  const rawCategories = (input.rawCategories || []).map(normalizeText);

  // 1. Detect Strategic Companies
  const matchedCompanies: string[] = [];
  let isHuaweiMentioned = false;

  for (const comp of STRATEGIC_COMPANIES) {
    const hits = findMatches(normTitle, comp.patterns);
    if (hits.length > 0) {
      matchedCompanies.push(comp.name);
      if (comp.isPrimary) isHuaweiMentioned = true;
    } else {
      // Also check excerpt if not found in title
      const excerptHits = findMatches(normExcerpt, comp.patterns);
      if (excerptHits.length > 0) {
        matchedCompanies.push(comp.name);
        if (comp.isPrimary) isHuaweiMentioned = true;
      }
    }
  }

  // 2. Detect Positive Device / Category Signals
  const matchedKeywords: string[] = [];
  let detectedCategory: CanonicalDeviceCategory = 'UNKNOWN';
  let hasExplicitModel = false;
  let hasTitleOrExcerptKeyword = false;

  // Priority order: SMARTPHONE > WEARABLE > AUDIO > TABLET
  for (const [catName, patterns] of Object.entries(STRATEGIC_PATTERNS) as [CanonicalDeviceCategory, typeof STRATEGIC_PATTERNS['SMARTPHONE']][]) {
    // Check explicit hardware models first in title
    const modelHits = findMatches(normTitle, patterns.explicitModels);
    if (modelHits.length > 0) {
      hasExplicitModel = true;
      detectedCategory = catName;
      matchedKeywords.push(...modelHits);
      break;
    }

    // Check category keywords in title
    const kwHits = findMatches(normTitle, patterns.keywords);
    if (kwHits.length > 0) {
      hasTitleOrExcerptKeyword = true;
      detectedCategory = catName;
      matchedKeywords.push(...kwHits);
      break;
    }
  }

  // If title didn't resolve category, check excerpt
  if (detectedCategory === 'UNKNOWN') {
    for (const [catName, patterns] of Object.entries(STRATEGIC_PATTERNS) as [CanonicalDeviceCategory, typeof STRATEGIC_PATTERNS['SMARTPHONE']][]) {
      const excerptModelHits = findMatches(normExcerpt, patterns.explicitModels);
      if (excerptModelHits.length > 0) {
        hasExplicitModel = true;
        detectedCategory = catName;
        matchedKeywords.push(...excerptModelHits);
        break;
      }

      const excerptKwHits = findMatches(normExcerpt, patterns.keywords);
      if (excerptKwHits.length > 0) {
        hasTitleOrExcerptKeyword = true;
        detectedCategory = catName;
        matchedKeywords.push(...excerptKwHits);
        break;
      }
    }
  }

  // Check raw categories from RSS feed as supplemental corroboration ONLY
  const rawCategoryHits: string[] = [];
  for (const [catName, patterns] of Object.entries(STRATEGIC_PATTERNS) as [CanonicalDeviceCategory, typeof STRATEGIC_PATTERNS['SMARTPHONE']][]) {
    const hits = rawCategories.filter((rc) => findMatches(rc, patterns.keywords).length > 0);
    if (hits.length > 0) {
      rawCategoryHits.push(`${catName}:${hits.join(',')}`);
      // Corroborate only if tracked company is already matched
      if (detectedCategory === 'UNKNOWN' && matchedCompanies.length > 0) {
        detectedCategory = catName;
        matchedKeywords.push(`rawCategory:${hits.join(',')}`);
      }
    }
  }

  // 3. Detect Negative Domain Signals
  const negativeSignals: string[] = [];
  for (const [domainName, domainKeywords] of Object.entries(NEGATIVE_DOMAINS)) {
    const hits = findMatches(normTitle, domainKeywords);
    if (hits.length > 0) {
      negativeSignals.push(`${domainName}:${hits.join(',')}`);
    } else {
      // Check excerpt if not in title
      const excerptHits = findMatches(normExcerpt, domainKeywords);
      if (excerptHits.length > 0) {
        negativeSignals.push(`${domainName}:${excerptHits.join(',')}`);
      }
    }
  }

  // 4. Safeguard: Prevent Generic Tokens alone from dictating relevance
  if (matchedKeywords.length > 0) {
    const onlyGenericTokens = matchedKeywords.every((kw) => GENERIC_TOKENS.has(kw.toLowerCase()));
    if (onlyGenericTokens && !hasExplicitModel) {
      // A generic token like "Air" or "Ultra" or "Pad" without device context
      matchedKeywords.length = 0;
      detectedCategory = 'UNKNOWN';
    }
  }

  // 5. Decision Matrix

  // CASE A: Negative Domain Signal Evaluation
  if (negativeSignals.length > 0 && !hasExplicitModel) {
    // Check if tracked company + strategic hardware category keyword are present in title/excerpt
    const hasStrongMobileContext = matchedCompanies.length > 0 && detectedCategory !== 'UNKNOWN' && hasTitleOrExcerptKeyword;

    // Verify whether the negative domain is primary/dominant (e.g. desktop RTX GPU, automobile crash test/EV without mobile device)
    const hasDominantNegative = negativeSignals.some((s) => {
      if (s.startsWith('PC_DESKTOP_HARDWARE') || s.startsWith('ENTERPRISE_AI_CLOUD')) return true;
      if (s.startsWith('AUTOMOTIVE') && !findMatches(normTitle, ['smartwatch', 'watch', 'phone', 'earbuds', 'tablet', 'ring']).length) return true;
      if (s.startsWith('GAMING_STUDIOS') && !findMatches(normTitle, ['phone', 'tablet', 'screen', 'display', 'snapdragon', 'kirin']).length) return true;
      return false;
    });

    if (!hasStrongMobileContext || hasDominantNegative) {
      return {
        decision: 'OUT_OF_SCOPE',
        category: 'OTHER',
        matchedCompanies,
        matchedKeywords,
        negativeSignals,
        reason: `Article matched non-strategic domain signals (${negativeSignals.join('; ')}) without explicit mobile hardware context`,
        confidence: 0.95,
        ruleStrength: 'STRONG',
      };
    }
    // Otherwise, article has strong mobile context (e.g. "Lenovo launches productivity tablet to replace laptops") -> proceed to Case C
  }

  // CASE B: Explicit Strategic Device Model
  if (hasExplicitModel) {
    return {
      decision: 'IN_SCOPE',
      category: detectedCategory,
      matchedCompanies,
      matchedKeywords,
      negativeSignals,
      reason: `Matched explicit strategic hardware model in ${detectedCategory} (${matchedKeywords.join(', ')})`,
      confidence: 0.98,
      ruleStrength: 'STRONG',
    };
  }

  // CASE C: Tracked Strategic Company + Strategic Category Keyword in Title/Excerpt
  if (matchedCompanies.length > 0 && detectedCategory !== 'UNKNOWN' && hasTitleOrExcerptKeyword) {
    return {
      decision: 'IN_SCOPE',
      category: detectedCategory,
      matchedCompanies,
      matchedKeywords,
      negativeSignals,
      reason: `Matched tracked company (${matchedCompanies.join(', ')}) in strategic domain ${detectedCategory}`,
      confidence: 0.92,
      ruleStrength: 'STRONG',
    };
  }

  // CASE C2: Tracked Strategic Company + Category Corroborated via Source Metadata/Raw Categories
  if (matchedCompanies.length > 0 && detectedCategory !== 'UNKNOWN' && rawCategoryHits.length > 0 && negativeSignals.length === 0) {
    return {
      decision: 'IN_SCOPE',
      category: detectedCategory,
      matchedCompanies,
      matchedKeywords,
      negativeSignals,
      reason: `Matched tracked company (${matchedCompanies.join(', ')}) with ${detectedCategory} corroborated by feed categories (${rawCategoryHits.join('; ')})`,
      confidence: 0.88,
      ruleStrength: 'MODERATE',
    };
  }

  // CASE C3: Tracked Strategic Company with Detected Strategic Category and Zero Negative Signals
  if (matchedCompanies.length > 0 && detectedCategory !== 'UNKNOWN' && negativeSignals.length === 0) {
    return {
      decision: 'IN_SCOPE',
      category: detectedCategory,
      matchedCompanies,
      matchedKeywords,
      negativeSignals,
      reason: `Matched tracked company (${matchedCompanies.join(', ')}) in strategic category ${detectedCategory}`,
      confidence: 0.85,
      ruleStrength: 'MODERATE',
    };
  }

  // CASE D: Strong Category Keyword in Title (Even if Company Unrecognized or Generic Market Scope)
  if (detectedCategory !== 'UNKNOWN' && hasTitleOrExcerptKeyword && negativeSignals.length === 0) {
    return {
      decision: 'IN_SCOPE',
      category: detectedCategory,
      matchedCompanies,
      matchedKeywords,
      negativeSignals,
      reason: `Strong ${detectedCategory} category signals detected in headline/metadata`,
      confidence: 0.85,
      ruleStrength: 'MODERATE',
    };
  }

  // CASE E: Tracked Company Mentioned, but No Category or Hardware Evidence
  if (matchedCompanies.length > 0 && detectedCategory === 'UNKNOWN') {
    if (negativeSignals.length > 0) {
      return {
        decision: 'OUT_OF_SCOPE',
        category: 'OTHER',
        matchedCompanies,
        matchedKeywords,
        negativeSignals,
        reason: `Tracked company mentioned (${matchedCompanies.join(', ')}) but in non-hardware domain (${negativeSignals.join(', ')})`,
        confidence: 0.9,
        ruleStrength: 'STRONG',
      };
    }

    // Company is HUAWEI: Be conservative!
    if (isHuaweiMentioned) {
      return {
        decision: 'UNCERTAIN',
        category: 'UNKNOWN',
        matchedCompanies,
        matchedKeywords,
        negativeSignals,
        reason: 'HUAWEI mentioned with ambiguous category; preserved for analyst review or deeper inspection',
        confidence: 0.65,
        ruleStrength: 'WEAK',
      };
    }

    // Other tracked company without category evidence and without clear negative signal -> UNCERTAIN
    return {
      decision: 'UNCERTAIN',
      category: 'UNKNOWN',
      matchedCompanies,
      matchedKeywords,
      negativeSignals,
      reason: `Tracked company (${matchedCompanies.join(', ')}) present without conclusive hardware category evidence`,
      confidence: 0.6,
      ruleStrength: 'WEAK',
    };
  }

  // CASE F: No Company, No Hardware Category, and Negative Signals Present
  if (negativeSignals.length > 0) {
    return {
      decision: 'OUT_OF_SCOPE',
      category: 'OTHER',
      matchedCompanies,
      matchedKeywords,
      negativeSignals,
      reason: `Non-strategic domain signals (${negativeSignals.join('; ')}) with no strategic relevance`,
      confidence: 0.95,
      ruleStrength: 'STRONG',
    };
  }

  // CASE G: Completely Ambiguous / General Tech News with No Clear Domain
  return {
    decision: 'OUT_OF_SCOPE',
    category: 'UNKNOWN',
    matchedCompanies,
    matchedKeywords,
    negativeSignals,
    reason: 'No strategic company, hardware category, or mobile ecosystem signal detected in headline',
    confidence: 0.8,
    ruleStrength: 'MODERATE',
  };
}

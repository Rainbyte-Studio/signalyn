/**
 * Phase 5S-C1.3: Product Catalog Lifecycle & Verification Audit Metadata
 * 
 * Defines the authoritative lifecycle status, entry type, and grounded evidence
 * provenance for each canonical product entity.
 * 
 * Rules:
 * - Commercial products with official launches: 'RELEASED'
 * - Officially announced but not yet broadly available: 'ANNOUNCED'
 * - Speculative / leak-based / future roadmaps: 'RUMORED'
 * - Generic brand umbrellas (e.g. Galaxy A/M/F series): 'PRODUCT_FAMILY' / 'PLACEHOLDER'
 * - Multi-model product lines: 'PRODUCT_SERIES'
 * - Specific SKUs/devices: 'INDIVIDUAL_MODEL'
 * - No assumption without traceable evidence; unsupported claims fallback to 'UNKNOWN'
 */

import {
  Product,
  ProductLifecycleStatus,
  ProductEntryType,
  ProductLifecycleFilter,
  MarketAvailabilityStatus,
} from '../types';
import {
  normalizeCatalogCategoryDisplay,
  ensureFiniteCount,
} from '../utils/dataIntegrityContracts';

export interface ProductAuditMetadata {
  id: string;
  lifecycle: ProductLifecycleStatus;
  entryType: ProductEntryType;
  launchDate?: string;
  evidenceType: string;
  evidenceUrl?: string;
  evidenceRationale: string;
  greekMarketAvailability?: {
    status: MarketAvailabilityStatus;
    details?: string;
    sourceUrl?: string;
  };
}

export const CANONICAL_PRODUCT_AUDIT_MAP: Record<string, ProductAuditMetadata> = {
  // --------------------------------------------------------------------------
  // HUAWEI
  // --------------------------------------------------------------------------
  'prod-hw-pura70': {
    id: 'prod-hw-pura70',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-04-18',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/gr/phones/pura70-ultra/',
    evidenceRationale: 'Commercially released flagship photography smartphone with official manufacturer portal and retail channel distribution.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Distributed officially through Greek telco and retail electronics channels.',
      sourceUrl: 'https://consumer.huawei.com/gr/phones/pura70-ultra/',
    },
  },
  'prod-hw-matext': {
    id: 'prod-hw-matext',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-09-10',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/en/phones/mate-xt-ultimate-design/',
    evidenceRationale: 'Commercial release in primary markets as first commercial tri-foldable smartphone.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'No verified official distribution or retail stock confirmed in Greek market channels.',
    },
  },
  'prod-hw-mate90': {
    id: 'prod-hw-mate90',
    lifecycle: 'RUMORED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'INDUSTRY_ROADMAP_SPECULATION',
    evidenceRationale: 'Next-generation Mate flagship series mentioned in supply chain leaks; not officially announced by manufacturer.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Product is rumored; regional market distribution not applicable.',
    },
  },
  'prod-hw-mate60': {
    id: 'prod-hw-mate60',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-08-29',
    evidenceType: 'OFFICIAL_ANNOUNCEMENT_AND_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/en/phones/mate60-pro/',
    evidenceRationale: 'Commercial release in Chinese market with Kirin 9000S and satellite messaging.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Mainland China release; no official direct consumer distribution in Greece.',
    },
  },
  'prod-hw-gt5': {
    id: 'prod-hw-gt5',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-09-19',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/gr/wearables/watch-gt5-pro/',
    evidenceRationale: 'Official global and regional launch with verified Greek channel availability.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Official Greek retail launch across major consumer electronics chains and telcos.',
      sourceUrl: 'https://www.insomnia.gr/articles/hardware/wearables/huawei-watch-gt-5-series-greece-launch-pricing/',
    },
  },
  'prod-hw-gt7': {
    id: 'prod-hw-gt7',
    lifecycle: 'RUMORED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Future generation smartwatch series designation from roadmap speculation; no official announcement.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Product series is unannounced.',
    },
  },
  'prod-hw-watchd3': {
    id: 'prod-hw-watchd3',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_HARDWARE_ROADMAP',
    evidenceRationale: 'Anticipated successor to Watch D2 blood pressure monitor; not officially announced.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unreleased model.',
    },
  },
  'prod-hw-watch6p': {
    id: 'prod-hw-watch6p',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_SERIES_ROADMAP',
    evidenceRationale: 'Roadmap placeholder for potential Watch 6 Pro flagship.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unannounced model.',
    },
  },
  'prod-hw-freebuds3': {
    id: 'prod-hw-freebuds3',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-09-25',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/gr/audio/freebuds-pro-3/',
    evidenceRationale: 'Commercial true wireless ANC earbuds retailed in Europe and Greece.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greece with localized technical support.',
      sourceUrl: 'https://consumer.huawei.com/gr/audio/freebuds-pro-3/',
    },
  },
  'prod-hw-freeclip': {
    id: 'prod-hw-freeclip',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-12-12',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/gr/audio/freeclip/',
    evidenceRationale: 'Open-ear acoustic C-bridge earphones officially retailed in Greece.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially available at authorized retail partners.',
      sourceUrl: 'https://consumer.huawei.com/gr/audio/freeclip/',
    },
  },
  'prod-hw-matepad': {
    id: 'prod-hw-matepad',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-08-06',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/gr/tablets/matepad-pro-12-2/',
    evidenceRationale: 'Commercial Tandem OLED PaperMatte productivity tablet.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially retailed in Greece through authorized channels.',
    },
  },
  'prod-hw-matepad-air': {
    id: 'prod-hw-matepad-air',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-08-06',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://consumer.huawei.com/en/tablets/matepad-air-2024/',
    evidenceRationale: 'Lightweight high-refresh tablet officially released.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Specific 2024 Air SKU direct distribution in Greece unconfirmed.',
    },
  },

  // --------------------------------------------------------------------------
  // Samsung
  // --------------------------------------------------------------------------
  'prod-sam-s24u': {
    id: 'prod-sam-s24u',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-01-17',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.samsung.com/gr/smartphones/galaxy-s24-ultra/',
    evidenceRationale: 'Commercial Galaxy AI flagship phone widely distributed globally and in Greece.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Direct legal entity distribution across all Greek telecommunications and electronics retailers.',
      sourceUrl: 'https://www.samsung.com/gr/smartphones/galaxy-s24-ultra/',
    },
  },
  'prod-sam-s25': {
    id: 'prod-sam-s25',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2025-01-22',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.samsung.com/gr/smartphones/galaxy-s25-ultra/',
    evidenceRationale: 'Commercial Galaxy S25 flagship smartphone officially released.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greek market.',
    },
  },
  'prod-sam-s26': {
    id: 'prod-sam-s26',
    lifecycle: 'RUMORED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'INDUSTRY_ROADMAP_SPECULATION',
    evidenceRationale: 'Unannounced next-generation flagship series; known only via speculative supply chain reporting.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unannounced series.',
    },
  },
  'prod-sam-s27': {
    id: 'prod-sam-s27',
    lifecycle: 'RUMORED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Multi-year forward speculative placeholder; no official manufacturer verification.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Speculative entry.',
    },
  },
  'prod-sam-zfold6': {
    id: 'prod-sam-zfold6',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-07-10',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.samsung.com/gr/smartphones/galaxy-z-fold6/',
    evidenceRationale: 'Commercial foldable smartphone retailed in Greece and worldwide.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Official Samsung Greece distribution.',
    },
  },
  'prod-sam-zfold7': {
    id: 'prod-sam-zfold7',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_ROADMAP_ENTRY',
    evidenceRationale: 'Next-generation foldable roadmap mention; not yet officially released.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unreleased model.',
    },
  },
  'prod-sam-zfold8': {
    id: 'prod-sam-zfold8',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Multi-year forward speculative foldable model; unannounced.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Speculative model.',
    },
  },
  'prod-sam-galaxya': {
    id: 'prod-sam-galaxya',
    lifecycle: 'RELEASED',
    entryType: 'PRODUCT_FAMILY',
    evidenceType: 'COMMERCIAL_PORTFOLIO_FAMILY',
    evidenceUrl: 'https://www.samsung.com/gr/smartphones/galaxy-a/',
    evidenceRationale: 'Broad commercial portfolio family encompassing mid-range devices (A55, A35, etc.).',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Galaxy A series devices are officially retailed nationwide in Greece.',
    },
  },
  'prod-sam-tabs12': {
    id: 'prod-sam-tabs12',
    lifecycle: 'RUMORED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'SPECULATIVE_ROADMAP_SERIES',
    evidenceRationale: 'Unannounced tablet series.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unreleased series.',
    },
  },
  'prod-sam-tabs10': {
    id: 'prod-sam-tabs10',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-09-26',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.samsung.com/gr/tablets/galaxy-tab-s10/',
    evidenceRationale: 'Commercial flagship tablet with MediaTek Dimensity 9300+ retailed in Greece.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greece.',
    },
  },
  'prod-sam-watch7': {
    id: 'prod-sam-watch7',
    lifecycle: 'RELEASED',
    entryType: 'PRODUCT_SERIES',
    launchDate: '2024-07-10',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.samsung.com/gr/watches/galaxy-watch7/',
    evidenceRationale: 'Commercial Galaxy Watch 7 and Watch Ultra smartwatches.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed across Greek retail networks.',
    },
  },
  'prod-sam-smarttag3': {
    id: 'prod-sam-smarttag3',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_ACCESSORY_ROADMAP',
    evidenceRationale: 'Unannounced tracking accessory; SmartTag2 is current commercial generation.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unannounced accessory.',
    },
  },
  'prod-sam-budson': {
    id: 'prod-sam-budson',
    lifecycle: 'RELEASED',
    entryType: 'PRODUCT_FAMILY',
    evidenceType: 'COMMERCIAL_PORTFOLIO_FAMILY',
    evidenceUrl: 'https://www.samsung.com/gr/audio-sound/galaxy-buds/',
    evidenceRationale: 'Galaxy Buds audio family (Buds3, Buds3 Pro, Buds FE).',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Galaxy Buds are officially distributed in Greece.',
    },
  },

  // --------------------------------------------------------------------------
  // Apple
  // --------------------------------------------------------------------------
  'prod-app-ip16p': {
    id: 'prod-app-ip16p',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-09-09',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.apple.com/gr/iphone-16-pro/',
    evidenceRationale: 'Commercial premium flagship smartphone with Apple Intelligence.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Official Apple authorized distribution nationwide in Greece.',
      sourceUrl: 'https://www.apple.com/gr/iphone-16-pro/',
    },
  },
  'prod-app-ip17p': {
    id: 'prod-app-ip17p',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SUPPLY_CHAIN_LEAKS',
    evidenceRationale: 'Future generation iPhone model reported in tech media; not officially announced by Apple.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unannounced device.',
    },
  },
  'prod-app-ip18p': {
    id: 'prod-app-ip18p',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Multi-year forward speculative model name.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Speculative entry.',
    },
  },
  'prod-app-watchu2': {
    id: 'prod-app-watchu2',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-09-12',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.apple.com/gr/apple-watch-ultra-2/',
    evidenceRationale: 'Commercial adventure smartwatch with S9 SiP and titanium chassis.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greece.',
    },
  },
  'prod-app-visionpro': {
    id: 'prod-app-visionpro',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-02-02',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.apple.com/apple-vision-pro/',
    evidenceRationale: 'Commercial spatial computing headset released in select tier-1 global countries.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Not officially localized or distributed through Apple Greece channels.',
    },
  },
  'prod-app-airpodsp2': {
    id: 'prod-app-airpodsp2',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-09-12',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.apple.com/gr/airpods-pro/',
    evidenceRationale: 'Commercial USB-C ANC earbuds with clinical-grade hearing aid features.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially available in Greek market.',
    },
  },
  'prod-app-airpods5': {
    id: 'prod-app-airpods5',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Speculative model name; Apple currently markets AirPods 4.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Unannounced device.',
    },
  },
  'prod-app-ipadprom4': {
    id: 'prod-app-ipadprom4',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-05-07',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.apple.com/gr/ipad-pro/',
    evidenceRationale: 'Commercial Ultra Retina XDR OLED tablet with Apple M4 silicon.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially retailed in Greece.',
    },
  },

  // --------------------------------------------------------------------------
  // Xiaomi
  // --------------------------------------------------------------------------
  'prod-xm-14u': {
    id: 'prod-xm-14u',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-02-22',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.mi.com/gr/product/xiaomi-14-ultra/',
    evidenceRationale: 'Commercial Leica quad-camera flagship phone with Snapdragon 8 Gen 3.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially imported and distributed by Info Quest Technologies in Greece.',
      sourceUrl: 'https://www.mi.com/gr/product/xiaomi-14-ultra/',
    },
  },
  'prod-xm-15u': {
    id: 'prod-xm-15u',
    lifecycle: 'ANNOUNCED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2025-02-01',
    evidenceType: 'OFFICIAL_MANUFACTURER_TEASER_AND_REPORTING',
    evidenceRationale: 'Next-generation Leica flagship officially announced/scheduled with Snapdragon 8 Elite.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Pending general European commercial availability.',
    },
  },
  'prod-xm-17u': {
    id: 'prod-xm-17u',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Multi-year forward speculative placeholder; unannounced.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Speculative model.',
    },
  },
  'prod-xm-watchs3': {
    id: 'prod-xm-watchs3',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-10-26',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.mi.com/gr/product/xiaomi-watch-s3/',
    evidenceRationale: 'Commercial HyperOS smartwatch with interchangeable bezels.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greece.',
    },
  },
  'prod-xm-pad7': {
    id: 'prod-xm-pad7',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-10-29',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.mi.com/global/product/xiaomi-pad-7-pro/',
    evidenceRationale: 'Commercial productivity tablet with Snapdragon 8s Gen 3.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Global announcement verified; specific Greek national distributor stock pending verification.',
    },
  },

  // --------------------------------------------------------------------------
  // HONOR
  // --------------------------------------------------------------------------
  'prod-hn-magicv3': {
    id: 'prod-hn-magicv3',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-07-12',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.hihonor.com/gr/phones/honor-magic-v3/',
    evidenceRationale: 'Ultra-thin commercial foldable smartphone officially retailed in Greece.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Official Greek commercial launch confirmed with nationwide tech store stock.',
      sourceUrl: 'https://techblog.gr/mobile/honor-magic-v3-greece-review-foldable-leptotita/',
    },
  },
  'prod-hn-magic6p': {
    id: 'prod-hn-magic6p',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-01-11',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.hihonor.com/gr/phones/honor-magic6-pro/',
    evidenceRationale: 'Commercial AI flagship smartphone with Falcon camera system.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greek market.',
    },
  },
  'prod-hn-magic9p': {
    id: 'prod-hn-magic9p',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Forward speculative model designation; unannounced.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Speculative model.',
    },
  },
  'prod-hn-magicpad4': {
    id: 'prod-hn-magicpad4',
    lifecycle: 'RELEASED',
    entryType: 'PRODUCT_SERIES',
    launchDate: '2024-07-12',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.hihonor.com/global/tablets/honor-magicpad2/',
    evidenceRationale: 'MagicPad 2 / series commercial tablet models.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'European launch verified; local Greek retail inventory unverified.',
    },
  },

  // --------------------------------------------------------------------------
  // Google
  // --------------------------------------------------------------------------
  'prod-goog-pixel9p': {
    id: 'prod-goog-pixel9p',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-08-13',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://store.google.com/product/pixel_9_pro',
    evidenceRationale: 'Commercial Gemini-native smartphone with Tensor G4.',
    greekMarketAvailability: {
      status: 'RETAIL_CONFIRMED',
      details: 'Confirmed physical and online stock in Greek electronics chains (Kotsovolos, Plaisio, Public); Google Store direct is unlocalized.',
      sourceUrl: 'https://www.insomnia.gr/articles/hardware/smartphones/google-pixel-greece-retail/',
    },
  },
  'prod-goog-pixel11a': {
    id: 'prod-goog-pixel11a',
    lifecycle: 'RUMORED',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Multi-year forward speculative placeholder; current generation is Pixel 8a / 9a.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Speculative model.',
    },
  },
  'prod-goog-pixelwatch3': {
    id: 'prod-goog-pixelwatch3',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-08-13',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://store.google.com/product/pixel_watch_3',
    evidenceRationale: 'Commercial WearOS smartwatch with Fitbit health suite.',
    greekMarketAvailability: {
      status: 'RETAIL_CONFIRMED',
      details: 'Available through Greek retail electronics imports.',
    },
  },
  'prod-goog-pixelbudsp2': {
    id: 'prod-goog-pixelbudsp2',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-08-13',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://store.google.com/product/pixel_buds_pro_2',
    evidenceRationale: 'Commercial true wireless earbuds with Tensor A1.',
    greekMarketAvailability: {
      status: 'RETAIL_CONFIRMED',
      details: 'Available through Greek retail electronics channels.',
    },
  },
  'prod-goog-pixeltablet': {
    id: 'prod-goog-pixeltablet',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-05-10',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://store.google.com/product/pixel_tablet',
    evidenceRationale: 'Commercial smart home speaker dock tablet.',
    greekMarketAvailability: {
      status: 'RETAIL_CONFIRMED',
      details: 'Available via select tech retailers in Greece.',
    },
  },

  // --------------------------------------------------------------------------
  // Garmin
  // --------------------------------------------------------------------------
  'prod-garmin-venu': {
    id: 'prod-garmin-venu',
    lifecycle: 'RELEASED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.garmin.gr/category/smartwatches/venu/',
    evidenceRationale: 'Commercial Venu series (Venu 3, 3S) smart fitness watches.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Official Garmin Greece distribution and localized retail network.',
      sourceUrl: 'https://www.garmin.gr/category/smartwatches/venu/',
    },
  },
  'prod-garmin-fenix8': {
    id: 'prod-garmin-fenix8',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-08-27',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.garmin.gr/category/smartwatches/fenix-8/',
    evidenceRationale: 'Commercial multisport outdoor GPS watch with AMOLED and solar options.',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greece.',
    },
  },
  'prod-garmin-forerunner': {
    id: 'prod-garmin-forerunner',
    lifecycle: 'RELEASED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.garmin.gr/category/running/',
    evidenceRationale: 'Commercial running watch series (Forerunner 965, 265, 165).',
    greekMarketAvailability: {
      status: 'OFFICIAL',
      details: 'Officially distributed in Greece across sports and electronics retail.',
    },
  },

  // --------------------------------------------------------------------------
  // OPPO / OnePlus
  // --------------------------------------------------------------------------
  'prod-oppo-findx8': {
    id: 'prod-oppo-findx8',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-10-24',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.oppo.com/en/smartphones/series-find-x/find-x8-pro/',
    evidenceRationale: 'Commercial Hasselblad flagship phone released globally with Dimensity 9400.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Global availability confirmed; specific Greek authorized retail channels unconfirmed.',
    },
  },
  'prod-oppo-op16': {
    id: 'prod-oppo-op16',
    lifecycle: 'RUMORED',
    entryType: 'PRODUCT_SERIES',
    evidenceType: 'SPECULATIVE_SERIES_PLACEHOLDER',
    evidenceRationale: 'Mixed placeholder representing future OnePlus 16 alongside current OnePlus 13/12 models.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Entry contains speculative model references.',
    },
  },
  'prod-oppo-watchx': {
    id: 'prod-oppo-watchx',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-02-29',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.oppo.com/en/accessories/watch-x/',
    evidenceRationale: 'Commercial WearOS dual-engine smartwatch (OPPO Watch X / OnePlus Watch 2).',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Import/retail status in Greece unverified.',
    },
  },

  // --------------------------------------------------------------------------
  // vivo
  // --------------------------------------------------------------------------
  'prod-vivo-x200p': {
    id: 'prod-vivo-x200p',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-10-14',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.vivo.com/en/products/x200pro',
    evidenceRationale: 'Commercial Zeiss telephoto flagship smartphone with 200MP APO sensor.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'No official direct distributor or localized retail presence verified in Greece.',
    },
  },
  'prod-vivo-xfold3p': {
    id: 'prod-vivo-xfold3p',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2024-03-26',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.vivo.com/en/products/xfold3pro',
    evidenceRationale: 'Commercial slim foldable smartphone with Snapdragon 8 Gen 3.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Not officially distributed in Greek channels.',
    },
  },
  'prod-vivo-watch3': {
    id: 'prod-vivo-watch3',
    lifecycle: 'RELEASED',
    entryType: 'INDIVIDUAL_MODEL',
    launchDate: '2023-11-13',
    evidenceType: 'OFFICIAL_PRODUCT_PORTAL',
    evidenceUrl: 'https://www.vivo.com/en/products/watch3',
    evidenceRationale: 'Commercial BlueOS smartwatch.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'No Greek market availability verified.',
    },
  },
};

/**
 * Returns audit metadata for a given canonical product ID, or a safe UNKNOWN fallback.
 */
export function getProductAuditMetadata(productId: string): ProductAuditMetadata {
  const found = CANONICAL_PRODUCT_AUDIT_MAP[productId];
  if (found) return found;

  return {
    id: productId,
    lifecycle: 'UNKNOWN',
    entryType: 'INDIVIDUAL_MODEL',
    evidenceType: 'UNVERIFIED',
    evidenceRationale: 'No authoritative product lifecycle evidence recorded.',
    greekMarketAvailability: {
      status: 'UNKNOWN',
      details: 'Market availability unverified.',
    },
  };
}

/**
 * Returns the Greek market availability for a specific product ID.
 */
export function getProductMarketEvidence(productId: string): {
  status: MarketAvailabilityStatus;
  details?: string;
  sourceUrl?: string;
} {
  const meta = getProductAuditMetadata(productId);
  if (meta.greekMarketAvailability) {
    return meta.greekMarketAvailability;
  }
  return {
    status: 'UNKNOWN',
    details: 'Greek market status unverified.',
  };
}

/**
 * Evaluates whether a product's lifecycle matches a given ProductLifecycleFilter.
 */
export function matchesLifecycleFilter(
  lifecycle: ProductLifecycleStatus | undefined,
  filter: ProductLifecycleFilter = 'ALL'
): boolean {
  if (filter === 'ALL') return true;

  if (filter === 'VERIFIED_ACTIVE') {
    return lifecycle === 'RELEASED' || lifecycle === 'ANNOUNCED';
  }

  if ((filter as string) === 'RELEASED') {
    return lifecycle === 'RELEASED';
  }

  if ((filter as string) === 'ANNOUNCED') {
    return lifecycle === 'ANNOUNCED';
  }

  if (filter === 'RUMORED_OR_UNVERIFIED') {
    return (
      lifecycle === 'RUMORED' ||
      lifecycle === 'PROTOTYPE' ||
      lifecycle === 'UNKNOWN' ||
      lifecycle === 'DISCONTINUED' ||
      !lifecycle
    );
  }

  return true;
}

/**
 * Filters an array of products according to the requested ProductLifecycleFilter.
 */
export function filterProductsByLifecycle(
  products: Product[],
  filter: ProductLifecycleFilter = 'ALL'
): Product[] {
  if (filter === 'ALL') return products;
  return products.filter((p) => matchesLifecycleFilter(p.lifecycle, filter));
}

export interface CatalogIntegrityAuditReport {
  totalProducts: number;
  auditedProductsCount: number;
  releasedCount: number;
  announcedCount: number;
  rumoredCount: number;
  discontinuedCount: number;
  prototypeCount: number;
  unknownCount: number;
  entryTypeCounts: Record<ProductEntryType, number>;
  verifiedActiveCount: number;
  rumoredOrUnverifiedCount: number;
  greekMarketBreakdown: Record<MarketAvailabilityStatus, number>;
  hasGroundingEvidenceCount: number;
  issues: string[];
  isValid: boolean;
}

/**
 * Evaluates catalog integrity rules across products against authoritative audit metadata.
 * 
 * Rules:
 * 1. Product ID must follow the standard canonical schema prod-{companyPrefix}-{slug}
 * 2. Product ID must be unique across the catalog
 * 3. Every product must have an authoritative audit entry in the audit map
 * 4. Commercial products (RELEASED) must have documented grounding evidence and evidence type
 * 5. Announced products (ANNOUNCED) must have official launch/teaser documentation
 * 6. Speculative roadmaps / leaks must be classified as RUMORED or PROTOTYPE, never RELEASED
 * 7. Umbrella portfolios (e.g. Galaxy A/M/F) must be PRODUCT_FAMILY or PRODUCT_SERIES, never INDIVIDUAL_MODEL
 * 8. Greek market status must distinguish OFFICIAL, RETAIL_CONFIRMED, and UNKNOWN without fabricating absence
 */
export function validateProductCatalogIntegrity(products: Product[]): CatalogIntegrityAuditReport {
  const issues: string[] = [];
  const seenIds = new Set<string>();

  let releasedCount = 0;
  let announcedCount = 0;
  let rumoredCount = 0;
  let discontinuedCount = 0;
  let prototypeCount = 0;
  let unknownCount = 0;
  let auditedProductsCount = 0;
  let hasGroundingEvidenceCount = 0;

  const entryTypeCounts: Record<ProductEntryType, number> = {
    INDIVIDUAL_MODEL: 0,
    PRODUCT_SERIES: 0,
    PRODUCT_FAMILY: 0,
    PLACEHOLDER: 0,
  };

  const greekMarketBreakdown: Record<MarketAvailabilityStatus, number> = {
    OFFICIAL: 0,
    RETAIL_CONFIRMED: 0,
    UNKNOWN: 0,
    UNAVAILABLE: 0,
  };

  for (const p of products) {
    // Check ID schema
    if (!p.id || !/^prod-[a-z0-9]+-[a-z0-9_-]+$/.test(p.id)) {
      issues.push(`Product ${p.name || '(unnamed)'} has invalid ID schema: "${p.id}"`);
    }

    // Check duplicate ID
    if (seenIds.has(p.id)) {
      issues.push(`Duplicate product ID detected: "${p.id}"`);
    }
    seenIds.add(p.id);

    // Audit metadata check
    const audit = CANONICAL_PRODUCT_AUDIT_MAP[p.id];
    if (audit) {
      auditedProductsCount++;
    } else {
      issues.push(`Product "${p.name}" (${p.id}) lacks authoritative audit metadata entry`);
    }

    const lifecycle: ProductLifecycleStatus = p.lifecycle || audit?.lifecycle || 'UNKNOWN';
    const entryType: ProductEntryType = p.entryType || audit?.entryType || 'INDIVIDUAL_MODEL';

    // Lifecycle count
    switch (lifecycle) {
      case 'RELEASED':
        releasedCount++;
        break;
      case 'ANNOUNCED':
        announcedCount++;
        break;
      case 'RUMORED':
        rumoredCount++;
        break;
      case 'DISCONTINUED':
        discontinuedCount++;
        break;
      case 'PROTOTYPE':
        prototypeCount++;
        break;
      default:
        unknownCount++;
        break;
    }

    // Entry type count
    if (entryTypeCounts[entryType] !== undefined) {
      entryTypeCounts[entryType]++;
    } else {
      entryTypeCounts.INDIVIDUAL_MODEL++;
    }

    // Grounding Evidence Check
    const rationale = p.evidenceRationale || audit?.evidenceRationale;
    const evidenceType = p.evidenceType || audit?.evidenceType;
    if (rationale && rationale.length > 10 && evidenceType && evidenceType !== 'UNVERIFIED') {
      hasGroundingEvidenceCount++;
    } else if (lifecycle === 'RELEASED' || lifecycle === 'ANNOUNCED') {
      issues.push(`Commercial/Announced product "${p.name}" (${p.id}) lacks grounded evidence rationale or evidenceType`);
    }

    // Umbrella series check
    if (
      (p.name.toLowerCase().includes('series') || p.name.toLowerCase().includes('family')) &&
      entryType === 'INDIVIDUAL_MODEL'
    ) {
      issues.push(`Umbrella series "${p.name}" (${p.id}) should have entryType PRODUCT_SERIES or PRODUCT_FAMILY`);
    }

    // Greek market tracking
    const grMarket = p.greekMarketAvailability?.status || audit?.greekMarketAvailability?.status || 'UNKNOWN';
    if (greekMarketBreakdown[grMarket] !== undefined) {
      greekMarketBreakdown[grMarket]++;
    } else {
      greekMarketBreakdown.UNKNOWN++;
    }
  }

  const verifiedActiveCount = releasedCount + announcedCount;
  const rumoredOrUnverifiedCount = rumoredCount + prototypeCount + unknownCount + discontinuedCount;

  return {
    totalProducts: products.length,
    auditedProductsCount,
    releasedCount,
    announcedCount,
    rumoredCount,
    discontinuedCount,
    prototypeCount,
    unknownCount,
    entryTypeCounts,
    verifiedActiveCount,
    rumoredOrUnverifiedCount,
    greekMarketBreakdown,
    hasGroundingEvidenceCount,
    issues,
    isValid: issues.length === 0,
  };
}

export interface CatalogStatistics {
  total: number;
  released: number;
  announced: number;
  rumored: number;
  discontinued: number;
  prototype: number;
  unknown: number;
  verifiedActive: number;
  rumoredOrUnverified: number;
  individualModels: number;
  productSeries: number;
  productFamilies: number;
  placeholders: number;
  greekMarketOfficial: number;
  greekMarketRetailConfirmed: number;
  greekMarketUnknown: number;
  greekMarketUnavailable: number;
  confirmedGreekMarketTotal: number;
  byCategory: Record<string, { total: number; verifiedActive: number; rumored: number }>;
  byManufacturer: Record<string, { total: number; verifiedActive: number; rumored: number }>;
}

/**
 * Computes categorized lifecycle, entry-type, and Greek market statistics for a set of products.
 * Guarantees finite integer counts (never NaN or undefined).
 */
export function getProductCatalogStatistics(products: Product[]): CatalogStatistics {
  const byCategory: Record<string, { total: number; verifiedActive: number; rumored: number }> = {};
  const byManufacturer: Record<string, { total: number; verifiedActive: number; rumored: number }> = {};

  let released = 0;
  let announced = 0;
  let rumored = 0;
  let discontinued = 0;
  let prototype = 0;
  let unknown = 0;

  let individualModels = 0;
  let productSeries = 0;
  let productFamilies = 0;
  let placeholders = 0;

  let greekMarketOfficial = 0;
  let greekMarketRetailConfirmed = 0;
  let greekMarketUnknown = 0;
  let greekMarketUnavailable = 0;

  const safeProducts = Array.isArray(products) ? products : [];

  for (const p of safeProducts) {
    const audit = CANONICAL_PRODUCT_AUDIT_MAP[p.id];
    const lifecycle: ProductLifecycleStatus = p.lifecycle || audit?.lifecycle || 'UNKNOWN';
    const isReleased = lifecycle === 'RELEASED';
    const isAnnounced = lifecycle === 'ANNOUNCED';
    const isRumored = lifecycle === 'RUMORED' || lifecycle === 'PROTOTYPE';
    const isVerifiedActive = isReleased || isAnnounced;

    if (isReleased) released++;
    else if (isAnnounced) announced++;
    else if (lifecycle === 'RUMORED') rumored++;
    else if (lifecycle === 'PROTOTYPE') {
      prototype++;
      rumored++;
    } else if (lifecycle === 'DISCONTINUED') discontinued++;
    else unknown++;

    // Entry type breakdown (with fallback to entityLevel / audit map)
    const entryType: ProductEntryType =
      p.entryType ||
      audit?.entryType ||
      (p.entityLevel === 'PRODUCT_SERIES'
        ? 'PRODUCT_SERIES'
        : p.entityLevel === 'PRODUCT_FAMILY'
        ? 'PRODUCT_FAMILY'
        : 'INDIVIDUAL_MODEL');

    if (entryType === 'PRODUCT_SERIES') productSeries++;
    else if (entryType === 'PRODUCT_FAMILY') productFamilies++;
    else if (entryType === 'PLACEHOLDER') placeholders++;
    else individualModels++;

    // Greek market availability breakdown
    const grStatus: MarketAvailabilityStatus =
      p.greekMarketAvailability?.status || audit?.greekMarketAvailability?.status || 'UNKNOWN';
    if (grStatus === 'OFFICIAL') greekMarketOfficial++;
    else if (grStatus === 'RETAIL_CONFIRMED') greekMarketRetailConfirmed++;
    else if (grStatus === 'UNAVAILABLE') greekMarketUnavailable++;
    else greekMarketUnknown++;

    // Normalized category breakdown (unifies 'SMARTPHONE' and 'Smartphones')
    const cat = normalizeCatalogCategoryDisplay(p.category);
    if (!byCategory[cat]) {
      byCategory[cat] = { total: 0, verifiedActive: 0, rumored: 0 };
    }
    byCategory[cat].total++;
    if (isVerifiedActive) byCategory[cat].verifiedActive++;
    if (isRumored) byCategory[cat].rumored++;

    // Manufacturer breakdown
    const mfg = p.companyId || 'unknown';
    if (!byManufacturer[mfg]) {
      byManufacturer[mfg] = { total: 0, verifiedActive: 0, rumored: 0 };
    }
    byManufacturer[mfg].total++;
    if (isVerifiedActive) byManufacturer[mfg].verifiedActive++;
    if (isRumored) byManufacturer[mfg].rumored++;
  }

  const total = ensureFiniteCount(safeProducts.length);
  const verifiedActive = ensureFiniteCount(released + announced);
  const rumoredOrUnverified = ensureFiniteCount(Math.max(0, total - verifiedActive));
  const confirmedGreekMarketTotal = ensureFiniteCount(
    greekMarketOfficial + greekMarketRetailConfirmed
  );

  return {
    total,
    released: ensureFiniteCount(released),
    announced: ensureFiniteCount(announced),
    rumored: ensureFiniteCount(rumored),
    discontinued: ensureFiniteCount(discontinued),
    prototype: ensureFiniteCount(prototype),
    unknown: ensureFiniteCount(unknown),
    verifiedActive,
    rumoredOrUnverified,
    individualModels: ensureFiniteCount(individualModels),
    productSeries: ensureFiniteCount(productSeries),
    productFamilies: ensureFiniteCount(productFamilies),
    placeholders: ensureFiniteCount(placeholders),
    greekMarketOfficial: ensureFiniteCount(greekMarketOfficial),
    greekMarketRetailConfirmed: ensureFiniteCount(greekMarketRetailConfirmed),
    greekMarketUnknown: ensureFiniteCount(greekMarketUnknown),
    greekMarketUnavailable: ensureFiniteCount(greekMarketUnavailable),
    confirmedGreekMarketTotal,
    byCategory,
    byManufacturer,
  };
}

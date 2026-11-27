/**
 * Canonical Entity Registry & Resolution Engine (Phase 4C.5)
 * 
 * Provides:
 * 1. Authoritative Tracked Companies registry for all 9 competitors + HUAWEI.
 * 2. Extended Canonical Product catalog covering Smartphones, Wearables, Tablets, Audio.
 * 3. High-precision deterministic Company & Product entity resolution.
 * 4. Word-boundary and generic token collision prevention (e.g., "Vivobook" never matches "vivo").
 * 5. Product Family / Series resolution (e.g., "Galaxy Tab S12 Ultra" -> Samsung Tablet).
 * 6. Non-hardware concept detection (AI agents, chipsets, operating systems).
 * 7. Zero Gemini / Zero Backfill / Zero production intelligence writes.
 */

import { Company, Product } from '../types';
import { normalizeDeviceCategory } from '../utils/categoryModel';
import { getProductAuditMetadata } from './productAuditRegistry';
import { normalizeCatalogCategoryDisplay } from '../utils/dataIntegrityContracts';

// ============================================================================
// 1. AUTHORITATIVE CANONICAL COMPANIES REGISTRY
// ============================================================================

export const CANONICAL_COMPANIES_REGISTRY: Company[] = [
  {
    id: 'comp-huawei',
    name: 'HUAWEI',
    aliases: [
      'Huawei Technologies',
      'HUAWEI Consumer BG',
      'Huawei Cloud',
      'Huawei Device',
      'Huawei',
      'HiSilicon',
    ],
    website: 'https://consumer.huawei.com',
    isMyCompany: true,
    isCompetitor: false,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Audio', 'Laptops', '5G Infrastructure'],
    active: true,
    hqCountry: 'China',
  },
  {
    id: 'comp-samsung',
    name: 'Samsung Electronics',
    aliases: [
      'Samsung',
      'Samsung Mobile',
      'Samsung Galaxy',
      'Galaxy',
      'Samsung Electronics Co., Ltd.',
      'Samsung Electronics Co',
    ],
    website: 'https://www.samsung.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Audio', 'Semiconductors', 'Displays'],
    active: true,
    hqCountry: 'South Korea',
  },
  {
    id: 'comp-apple',
    name: 'Apple',
    aliases: [
      'Apple Inc',
      'Apple Inc.',
      'Apple Computer',
      'iPhone',
      'Apple Watch',
      'Cupertino',
    ],
    website: 'https://www.apple.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Audio', 'Laptops', 'Services'],
    active: true,
    hqCountry: 'United States',
  },
  {
    id: 'comp-xiaomi',
    name: 'Xiaomi',
    aliases: [
      'Xiaomi Corp',
      'Xiaomi Corporation',
      'Redmi',
      'POCO',
      'Xiaomi Inc',
    ],
    website: 'https://www.mi.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Audio', 'Smart Home', 'EV'],
    active: true,
    hqCountry: 'China',
  },
  {
    id: 'comp-honor',
    name: 'HONOR',
    aliases: [
      'Honor Device Co',
      'Honor Device Co., Ltd.',
      'Honor Mobile',
      'Magic Series',
      'Honor',
    ],
    website: 'https://www.hihonor.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Smartphones', 'Wearables', 'Tablets', 'Laptops'],
    active: true,
    hqCountry: 'China',
  },
  {
    id: 'comp-google',
    name: 'Google',
    aliases: [
      'Google Pixel',
      'Alphabet',
      'Alphabet Inc',
      'Google LLC',
      'Pixel',
    ],
    website: 'https://store.google.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Smartphones', 'Wearables', 'Audio', 'AI', 'Android'],
    active: true,
    hqCountry: 'United States',
  },
  {
    id: 'comp-garmin',
    name: 'Garmin',
    aliases: [
      'Garmin Ltd',
      'Garmin Ltd.',
      'Garmin Fitness',
      'Garmin International',
      'Garmin Navigation',
    ],
    website: 'https://www.garmin.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Wearables'],
    active: true,
    hqCountry: 'United States',
  },
  {
    id: 'comp-oppo',
    name: 'OPPO',
    aliases: [
      'Guangdong Oppo',
      'Guangdong OPPO Mobile Telecommunications',
      'OnePlus',
      'OPPO Mobile',
    ],
    website: 'https://www.oppo.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Smartphones', 'Wearables', 'Audio'],
    active: true,
    hqCountry: 'China',
  },
  {
    id: 'comp-vivo',
    name: 'vivo',
    aliases: [
      'vivo Mobile',
      'vivo Communication Technology',
      'iQOO',
      'Vivo',
    ],
    website: 'https://www.vivo.com',
    isMyCompany: false,
    isCompetitor: true,
    categories: ['Smartphones', 'Wearables', 'Audio'],
    active: true,
    hqCountry: 'China',
  },
];

// Recognized Non-Tracked Ecosystem Partners & Component Vendors
export const RECOGNIZED_ECOSYSTEM_COMPANIES: Array<{ name: string; aliases: string[]; sector: string }> = [
  { name: 'Qualcomm', aliases: ['Qualcomm Inc', 'Snapdragon'], sector: 'Semiconductors' },
  { name: 'MediaTek', aliases: ['MediaTek Inc', 'Dimensity'], sector: 'Semiconductors' },
  { name: 'NVIDIA', aliases: ['Nvidia Corp', 'GeForce'], sector: 'GPUs & AI Silicon' },
  { name: 'Sony', aliases: ['Sony Corporation', 'Sony Group', 'PlayStation', 'Xperia'], sector: 'Electronics & Sensors' },
  { name: 'Bose', aliases: ['Bose Corporation'], sector: 'Audio Equipment' },
  { name: 'Logitech', aliases: ['Logitech International'], sector: 'Peripherals' },
  { name: 'ASUS', aliases: ['AsusTek Computer', 'ROG'], sector: 'PCs & Hardware' },
  { name: 'Lenovo', aliases: ['Lenovo Group', 'Motorola Mobility', 'Moto'], sector: 'PCs & Mobile' },
  { name: 'Motorola', aliases: ['Moto', 'Motorola Mobility'], sector: 'Smartphones' },
  { name: 'Amazon', aliases: ['Amazon.com', 'AWS', 'Amazon Echo'], sector: 'Cloud & Smart Home' },
  { name: 'Meta', aliases: ['Meta Platforms', 'Oculus', 'Facebook'], sector: 'Social & XR' },
  { name: 'OpenAI', aliases: ['OpenAI Inc'], sector: 'Generative AI' },
  { name: 'Microsoft', aliases: ['Microsoft Corp', 'Surface'], sector: 'Software & Devices' },
  { name: 'Intel', aliases: ['Intel Corporation', 'Intel Core'], sector: 'Semiconductors & Processors' },
  { name: 'AMD', aliases: ['Advanced Micro Devices', 'Ryzen', 'Radeon'], sector: 'Semiconductors & GPUs' },
  { name: 'Netflix', aliases: ['Netflix Inc'], sector: 'Media & Streaming' },

  // Recognized Automotive OEMs (Incidental Infotainment / Connected Car Partners outside Consumer Hardware Scope)
  { name: 'Ford', aliases: ['Ford Motor Company'], sector: 'Automotive OEM' },
  { name: 'General Motors', aliases: ['GM', 'General Motors Company', 'Chevrolet', 'Cadillac'], sector: 'Automotive OEM' },
  { name: 'Honda', aliases: ['Honda Motor', 'Honda Motor Co'], sector: 'Automotive OEM' },
  { name: 'Toyota', aliases: ['Toyota Motor', 'Toyota Motor Corp'], sector: 'Automotive OEM' },
  { name: 'BMW', aliases: ['BMW Group', 'Bayerische Motoren Werke'], sector: 'Automotive OEM' },
  { name: 'Mercedes-Benz', aliases: ['Mercedes', 'Daimler'], sector: 'Automotive OEM' },
  { name: 'Volkswagen', aliases: ['VW', 'Volkswagen Group'], sector: 'Automotive OEM' },
  { name: 'Hyundai', aliases: ['Hyundai Motor', 'Kia'], sector: 'Automotive OEM' },
  { name: 'Tesla', aliases: ['Tesla Motors', 'Tesla Inc'], sector: 'Automotive OEM' },
];

// ============================================================================
// 2. AUTHORITATIVE CANONICAL PRODUCT CATALOG
// ============================================================================

export const CANONICAL_PRODUCTS_REGISTRY: Product[] = [
  // --------------------------------------------------------------------------
  // HUAWEI
  // --------------------------------------------------------------------------
  {
    id: 'prod-hw-pura70',
    companyId: 'comp-huawei',
    name: 'HUAWEI Pura 70 Ultra',
    aliases: ['Pura 70', 'Pura 70 Pro', 'Pura 70 Ultra', 'Pura 70 Pro+', 'Huawei Pura 70'],
    category: 'Smartphones',
    subcategory: 'Flagship Photography',
    active: true,
  },
  {
    id: 'prod-hw-matext',
    companyId: 'comp-huawei',
    name: 'HUAWEI Mate XT ULTIMATE DESIGN',
    aliases: ['Mate XT', 'Huawei Tri-Fold', 'Mate XT Ultimate', 'Mate XT2', 'Huawei Mate XT'],
    category: 'Smartphones',
    subcategory: 'Tri-Foldable Flagship',
    active: true,
  },
  {
    id: 'prod-hw-mate90',
    companyId: 'comp-huawei',
    name: 'HUAWEI Mate 90 Series',
    aliases: [
      'Mate 90',
      'Mate 90 Pro',
      'Mate 90 Pro Max',
      'Mate 90 RS',
      'Mate 90 RS Ultimate Design',
      'Huawei Mate 90 series',
      'Mate90 series',
      'Mate 90 Pro+',
    ],
    category: 'Smartphones',
    subcategory: 'Next-Gen Flagship',
    active: true,
  },
  {
    id: 'prod-hw-mate60',
    companyId: 'comp-huawei',
    name: 'HUAWEI Mate 60 Pro',
    aliases: ['Mate 60', 'Mate 60 Pro', 'Mate 60 RS', 'Mate 60 Pro+'],
    category: 'Smartphones',
    subcategory: 'Satellite Flagship',
    active: true,
  },
  {
    id: 'prod-hw-gt5',
    companyId: 'comp-huawei',
    name: 'HUAWEI Watch GT 5 Pro',
    aliases: ['Watch GT5', 'GT 5 Pro', 'Watch GT 5', 'Huawei GT5'],
    category: 'Wearables',
    subcategory: 'Smartwatch',
    active: true,
  },
  {
    id: 'prod-hw-gt7',
    companyId: 'comp-huawei',
    name: 'HUAWEI Watch GT 7 Series',
    aliases: [
      'HUAWEI WATCH GT 7',
      'Huawei Watch GT 7 Pro',
      'Watch GT 7',
      'Watch GT 7 Pro',
      'GT 7 Pro',
      'GT 7',
    ],
    category: 'Wearables',
    subcategory: 'Next-Gen Smartwatch',
    active: true,
  },
  {
    id: 'prod-hw-watchd3',
    companyId: 'comp-huawei',
    name: 'HUAWEI Watch D3',
    aliases: ['Huawei Watch D3', 'Watch D3', 'Watch D2', 'Huawei Watch D'],
    category: 'Wearables',
    subcategory: 'Blood Pressure Health Smartwatch',
    active: true,
  },
  {
    id: 'prod-hw-watch6p',
    companyId: 'comp-huawei',
    name: 'HUAWEI Watch 6 Pro',
    aliases: [
      'HUAWEI Watch 6 Pro 43mm',
      'Watch 6 Pro',
      'Huawei Watch 6',
      'Watch 6',
      'Watch 5 Pro',
    ],
    category: 'Wearables',
    subcategory: 'Flagship Smartwatch',
    active: true,
  },
  {
    id: 'prod-hw-freebuds3',
    companyId: 'comp-huawei',
    name: 'HUAWEI FreeBuds Pro 3',
    aliases: ['FreeBuds Pro 3', 'FreeBuds Pro', 'FreeBuds 6', 'FreeBuds Pro 2'],
    category: 'Audio',
    subcategory: 'True Wireless ANC',
    active: true,
  },
  {
    id: 'prod-hw-freeclip',
    companyId: 'comp-huawei',
    name: 'HUAWEI FreeClip',
    aliases: ['FreeClip', 'Huawei FreeClip', 'FreeClip 2'],
    category: 'Audio',
    subcategory: 'Open-Ear TWS',
    active: true,
  },
  {
    id: 'prod-hw-matepad',
    companyId: 'comp-huawei',
    name: 'HUAWEI MatePad Pro 12.2',
    aliases: ['MatePad Pro', 'PaperMatte Display', 'MatePad Pro 13.2', 'MatePad 11.5S'],
    category: 'Tablets',
    subcategory: 'Productivity Tablet',
    active: true,
  },
  {
    id: 'prod-hw-matepad-air',
    companyId: 'comp-huawei',
    name: 'HUAWEI MatePad Air',
    aliases: ['MatePad Air Z', 'MatePad Air', 'Huawei MatePad Air'],
    category: 'Tablets',
    subcategory: 'Lightweight Tablet',
    active: true,
  },

  // --------------------------------------------------------------------------
  // Samsung
  // --------------------------------------------------------------------------
  {
    id: 'prod-sam-s24u',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy S24 Ultra',
    aliases: ['S24 Ultra', 'Galaxy S24', 'Galaxy S24+', 'S24 Plus', 'Samsung S24'],
    category: 'Smartphones',
    subcategory: 'AI Flagship',
    active: true,
  },
  {
    id: 'prod-sam-s25',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy S25 Ultra',
    aliases: ['S25 Ultra', 'Galaxy S25', 'Galaxy S25+', 'Samsung Galaxy S25'],
    category: 'Smartphones',
    subcategory: 'AI Flagship',
    active: true,
  },
  {
    id: 'prod-sam-s26',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy S26 Series',
    aliases: [
      'Samsung Galaxy S26',
      'Samsung Galaxy S26 Ultra',
      'Galaxy S26',
      'Galaxy S26 Ultra',
      'S26 Ultra',
      'S26',
    ],
    category: 'Smartphones',
    subcategory: 'Next-Gen Flagship',
    active: true,
  },
  {
    id: 'prod-sam-s27',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy S27 Series',
    aliases: [
      'Samsung Galaxy S27 Ultra',
      'Samsung Galaxy 27 Ultra',
      'Galaxy S27',
      'Galaxy S27 Ultra',
      'S27 Ultra',
    ],
    category: 'Smartphones',
    subcategory: 'Future Flagship',
    active: true,
  },
  {
    id: 'prod-sam-zfold6',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy Z Fold6',
    aliases: ['Z Fold6', 'Fold6', 'Galaxy Z Fold 6', 'Galaxy Z Flip6', 'Z Flip6'],
    category: 'Smartphones',
    subcategory: 'Book Foldable',
    active: true,
  },
  {
    id: 'prod-sam-zfold7',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy Z Fold7',
    aliases: [
      'Samsung Galaxy Z Fold7',
      'Galaxy Z Fold7',
      'Z Fold7',
      'Fold7',
      'Galaxy Z Fold 7',
      'Galaxy Z Flip7',
    ],
    category: 'Smartphones',
    subcategory: 'Next-Gen Foldable',
    active: true,
  },
  {
    id: 'prod-sam-zfold8',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy Z Fold8 Ultra',
    aliases: [
      'Samsung Galaxy Z Fold8 Ultra',
      'Galaxy Z Fold8',
      'Z Fold8',
      'Z Fold8 Ultra',
      'Fold8',
    ],
    category: 'Smartphones',
    subcategory: 'Ultra Foldable',
    active: true,
  },
  {
    id: 'prod-sam-galaxya',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy A / M / F Series',
    aliases: [
      'Samsung Galaxy F08',
      'Samsung Galaxy M08',
      'Galaxy A55',
      'Galaxy A35',
      'Galaxy M55',
      'Galaxy F55',
    ],
    category: 'Smartphones',
    subcategory: 'Mid-Range Smartphone',
    active: true,
  },
  {
    id: 'prod-sam-tabs12',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy Tab S12 Series',
    aliases: [
      'Galaxy Tab S12',
      'Galaxy Tab S12+',
      'Galaxy Tab S12 Ultra',
      'Samsung Galaxy Tab S12',
      'Samsung Galaxy Tab S12+',
      'Tab S12 Ultra',
      'Tab S12',
      'Tab S12+',
    ],
    category: 'Tablets',
    subcategory: 'Flagship Tablet',
    active: true,
  },
  {
    id: 'prod-sam-tabs10',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy Tab S10 Ultra',
    aliases: ['Galaxy Tab S10', 'Galaxy Tab S10+', 'Galaxy Tab S10 Ultra', 'Tab S10 Ultra'],
    category: 'Tablets',
    subcategory: 'Productivity Tablet',
    active: true,
  },
  {
    id: 'prod-sam-watch7',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy Watch Ultra / Watch 7',
    aliases: ['Galaxy Watch Ultra', 'Watch 7', 'Galaxy Watch 7', 'Galaxy Watch FE', 'Galaxy Ring'],
    category: 'Wearables',
    subcategory: 'Smartwatch',
    active: true,
  },
  {
    id: 'prod-sam-smarttag3',
    companyId: 'comp-samsung',
    name: 'Samsung SmartTag3',
    aliases: ['Samsung SmartTag3', 'SmartTag3', 'Galaxy SmartTag', 'SmartTag 3'],
    category: 'Wearables',
    subcategory: 'Tracking Accessory',
    active: true,
  },
  {
    id: 'prod-sam-budson',
    companyId: 'comp-samsung',
    name: 'Samsung Galaxy Buds Series',
    aliases: [
      'Galaxy Buds On',
      'Samsung Galaxy Buds On',
      'Galaxy Buds3 Pro',
      'Galaxy Buds3',
      'Galaxy Buds Pro',
      'Galaxy Buds FE',
    ],
    category: 'Audio',
    subcategory: 'ANC Earbuds',
    active: true,
  },

  // --------------------------------------------------------------------------
  // Apple
  // --------------------------------------------------------------------------
  {
    id: 'prod-app-ip16p',
    companyId: 'comp-apple',
    name: 'Apple iPhone 16 Pro Max',
    aliases: ['iPhone 16 Pro', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro Max', 'Apple iPhone 16'],
    category: 'Smartphones',
    subcategory: 'Premium Flagship',
    active: true,
  },
  {
    id: 'prod-app-ip17p',
    companyId: 'comp-apple',
    name: 'Apple iPhone 17 Pro',
    aliases: ['iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone 17 Slim', 'iPhone 17 Air'],
    category: 'Smartphones',
    subcategory: 'Next-Gen Flagship',
    active: true,
  },
  {
    id: 'prod-app-ip18p',
    companyId: 'comp-apple',
    name: 'Apple iPhone 18 Pro Max',
    aliases: ['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 18', 'Apple iPhone 18'],
    category: 'Smartphones',
    subcategory: 'Future Flagship',
    active: true,
  },
  {
    id: 'prod-app-watchu2',
    companyId: 'comp-apple',
    name: 'Apple Watch Ultra 2',
    aliases: ['Apple Watch Ultra', 'Series 10', 'Apple Watch Series 10', 'Apple Watch Series 9', 'Apple Watch Ultra 3'],
    category: 'Wearables',
    subcategory: 'Adventure Smartwatch',
    active: true,
  },
  {
    id: 'prod-app-visionpro',
    companyId: 'comp-apple',
    name: 'Apple Vision Pro',
    aliases: ['Vision Pro', 'Apple Vision Pro 2', 'visionOS'],
    category: 'Wearables',
    subcategory: 'Spatial Computing Headset',
    active: true,
  },
  {
    id: 'prod-app-airpodsp2',
    companyId: 'comp-apple',
    name: 'Apple AirPods Pro 2',
    aliases: ['AirPods Pro', 'AirPods Pro 2', 'AirPods Max', 'AirPods 4'],
    category: 'Audio',
    subcategory: 'ANC Earbuds',
    active: true,
  },
  {
    id: 'prod-app-airpods5',
    companyId: 'comp-apple',
    name: 'Apple AirPods 5',
    aliases: ['AirPods 5', 'Apple AirPods 5'],
    category: 'Audio',
    subcategory: 'Wireless Earbuds',
    active: true,
  },
  {
    id: 'prod-app-ipadprom4',
    companyId: 'comp-apple',
    name: 'Apple iPad Pro (M4)',
    aliases: ['iPad Pro', 'iPad Pro M4', 'iPad Air M2', 'iPad Air 6', 'iPad mini 7', 'Apple iPad'],
    category: 'Tablets',
    subcategory: 'OLED Productivity Tablet',
    active: true,
  },

  // --------------------------------------------------------------------------
  // Xiaomi
  // --------------------------------------------------------------------------
  {
    id: 'prod-xm-14u',
    companyId: 'comp-xiaomi',
    name: 'Xiaomi 14 Ultra',
    aliases: ['Xiaomi 14', '14 Ultra Leica', 'Xiaomi 14 Pro'],
    category: 'Smartphones',
    subcategory: 'Leica Flagship',
    active: true,
  },
  {
    id: 'prod-xm-15u',
    companyId: 'comp-xiaomi',
    name: 'Xiaomi 15 Ultra',
    aliases: ['Xiaomi 15', 'Xiaomi 15 Pro', 'Xiaomi 15 Ultra', '15 Ultra'],
    category: 'Smartphones',
    subcategory: 'Snapdragon 8 Elite Flagship',
    active: true,
  },
  {
    id: 'prod-xm-17u',
    companyId: 'comp-xiaomi',
    name: 'Xiaomi 17 Ultra',
    aliases: ['Xiaomi 17 Ultra', 'Xiaomi 17', '17 Ultra', 'Xiaomi 18 Pro', 'Xiaomi 18'],
    category: 'Smartphones',
    subcategory: 'Future Flagship',
    active: true,
  },
  {
    id: 'prod-xm-watchs3',
    companyId: 'comp-xiaomi',
    name: 'Xiaomi Watch S3',
    aliases: ['Watch S3', 'Smart Band 9', 'Xiaomi Watch 2', 'Xiaomi Watch 2 Pro', 'Smart Band 8'],
    category: 'Wearables',
    subcategory: 'Smartwatch & Band',
    active: true,
  },
  {
    id: 'prod-xm-pad7',
    companyId: 'comp-xiaomi',
    name: 'Xiaomi Pad 7 Pro',
    aliases: ['Xiaomi Pad 7', 'Xiaomi Pad 6', 'Pad 6 Pro', 'Pad 7 Pro'],
    category: 'Tablets',
    subcategory: 'Entertainment Tablet',
    active: true,
  },

  // --------------------------------------------------------------------------
  // HONOR
  // --------------------------------------------------------------------------
  {
    id: 'prod-hn-magicv3',
    companyId: 'comp-honor',
    name: 'HONOR Magic V3',
    aliases: ['Magic V3', 'Magic V2', 'HONOR Magic V3', 'Magic Vs', 'HONOR Magic V2'],
    category: 'Smartphones',
    subcategory: 'Ultra-thin Foldable',
    active: true,
  },
  {
    id: 'prod-hn-magic6p',
    companyId: 'comp-honor',
    name: 'HONOR Magic6 Pro',
    aliases: ['Magic6 Pro', 'Magic 6', 'HONOR Magic6', 'HONOR Magic 6 Pro'],
    category: 'Smartphones',
    subcategory: 'AI Flagship',
    active: true,
  },
  {
    id: 'prod-hn-magic9p',
    companyId: 'comp-honor',
    name: 'HONOR Magic 9 Pro Max',
    aliases: ['HONOR Magic 9 Pro Max', 'Magic 9 Pro', 'Magic 7 Pro', 'HONOR Magic 7'],
    category: 'Smartphones',
    subcategory: 'Future Flagship',
    active: true,
  },
  {
    id: 'prod-hn-magicpad4',
    companyId: 'comp-honor',
    name: 'HONOR MagicPad Series',
    aliases: ['MagicPad 4 (12.1)', 'MagicPad 2', 'HONOR MagicPad', 'MagicPad 4'],
    category: 'Tablets',
    subcategory: 'Productivity Tablet',
    active: true,
  },

  // --------------------------------------------------------------------------
  // Google
  // --------------------------------------------------------------------------
  {
    id: 'prod-goog-pixel9p',
    companyId: 'comp-google',
    name: 'Google Pixel 9 Pro',
    aliases: [
      'Pixel 9',
      'Pixel 9 Pro',
      'Pixel 9 Pro XL',
      'Pixel 9 Pro Fold',
      'Google Pixel 9',
      'Pixel 8a',
    ],
    category: 'Smartphones',
    subcategory: 'Gemini AI Smartphone',
    active: true,
  },
  {
    id: 'prod-goog-pixel11a',
    companyId: 'comp-google',
    name: 'Google Pixel 11a',
    aliases: ['Google Pixel 11a', 'Pixel 11a', 'Pixel 10', 'Pixel 10 Pro'],
    category: 'Smartphones',
    subcategory: 'Next-Gen A-Series',
    active: true,
  },
  {
    id: 'prod-goog-pixelwatch3',
    companyId: 'comp-google',
    name: 'Google Pixel Watch 3',
    aliases: ['Pixel Watch 3', 'Pixel Watch 2', 'Google Pixel Watch', 'Pixel Watch'],
    category: 'Wearables',
    subcategory: 'Fitbit Powered Smartwatch',
    active: true,
  },
  {
    id: 'prod-goog-pixelbudsp2',
    companyId: 'comp-google',
    name: 'Google Pixel Buds Pro 2',
    aliases: ['Pixel Buds Pro 2', 'Pixel Buds Pro', 'Pixel Buds A-Series'],
    category: 'Audio',
    subcategory: 'AI ANC Earbuds',
    active: true,
  },
  {
    id: 'prod-goog-pixeltablet',
    companyId: 'comp-google',
    name: 'Google Pixel Tablet',
    aliases: ['Pixel Tablet', 'Google Pixel Tablet 2'],
    category: 'Tablets',
    subcategory: 'Smart Home Hub Tablet',
    active: true,
  },

  // --------------------------------------------------------------------------
  // Garmin
  // --------------------------------------------------------------------------
  {
    id: 'prod-garmin-venu',
    companyId: 'comp-garmin',
    name: 'Garmin Venu Series',
    aliases: ['Venu 6', 'Venu 3', 'Venu 3S', 'Garmin Venu', 'Garmin Venu 3'],
    category: 'Wearables',
    subcategory: 'GPS Fitness Smartwatch',
    active: true,
  },
  {
    id: 'prod-garmin-fenix8',
    companyId: 'comp-garmin',
    name: 'Garmin Fenix 8',
    aliases: ['Fenix 8', 'Fenix 7 Pro', 'Garmin Fenix', 'Fenix 8 Solar', 'Epix Pro'],
    category: 'Wearables',
    subcategory: 'Multisport Outdoor GPS',
    active: true,
  },
  {
    id: 'prod-garmin-forerunner',
    companyId: 'comp-garmin',
    name: 'Garmin Forerunner Series',
    aliases: ['Forerunner 965', 'Forerunner 265', 'Forerunner 165', 'Garmin Forerunner'],
    category: 'Wearables',
    subcategory: 'Running Smartwatch',
    active: true,
  },

  // --------------------------------------------------------------------------
  // OPPO / OnePlus
  // --------------------------------------------------------------------------
  {
    id: 'prod-oppo-findx8',
    companyId: 'comp-oppo',
    name: 'OPPO Find X8 Pro',
    aliases: ['Find X8', 'Find X8 Pro', 'Find X7 Ultra', 'Find N3', 'Find N3 Flip'],
    category: 'Smartphones',
    subcategory: 'Hasselblad Flagship',
    active: true,
  },
  {
    id: 'prod-oppo-op16',
    companyId: 'comp-oppo',
    name: 'OnePlus 16 / OnePlus 13',
    aliases: ['OnePlus 16', 'OnePlus 13', 'OnePlus 12', 'OnePlus Open', 'OnePlus 13R'],
    category: 'Smartphones',
    subcategory: 'Performance Flagship',
    active: true,
  },
  {
    id: 'prod-oppo-watchx',
    companyId: 'comp-oppo',
    name: 'OPPO Watch X / OnePlus Watch 2',
    aliases: ['OPPO Watch X', 'OnePlus Watch 2', 'OnePlus Watch 2R'],
    category: 'Wearables',
    subcategory: 'Dual-Engine Smartwatch',
    active: true,
  },

  // --------------------------------------------------------------------------
  // vivo
  // --------------------------------------------------------------------------
  {
    id: 'prod-vivo-x200p',
    companyId: 'comp-vivo',
    name: 'vivo X200 Pro',
    aliases: [
      'vivo X200',
      'vivo X200 Pro',
      'vivo X100 Ultra',
      'vivo X100 Pro',
      'X200 Pro',
      'X100 Ultra',
      'X100 Pro',
      'X100',
    ],
    category: 'Smartphones',
    subcategory: 'Zeiss Telephoto Flagship',
    active: true,
  },
  {
    id: 'prod-vivo-xfold3p',
    companyId: 'comp-vivo',
    name: 'vivo X Fold3 Pro',
    aliases: ['vivo X Fold3', 'vivo X Fold3 Pro', 'X Fold3 Pro', 'X Fold3'],
    category: 'Smartphones',
    subcategory: 'Slim Foldable',
    active: true,
  },
  {
    id: 'prod-vivo-watch3',
    companyId: 'comp-vivo',
    name: 'vivo WATCH 3',
    aliases: ['vivo WATCH 3', 'vivo Watch 3', 'vivo Watch GT'],
    category: 'Wearables',
    subcategory: 'BlueOS Smartwatch',
    active: true,
  },
];

// ============================================================================
// 3. NON-HARDWARE CONCEPT GUARDS
// ============================================================================

export type NonDeviceCategory =
  | 'AI_SOFTWARE'
  | 'CHIPSET_SILICON'
  | 'OPERATING_SYSTEM'
  | 'AUTOMOTIVE_SOFTWARE'
  | 'SOFTWARE_TOOL'
  | 'TECH_CONCEPT';

export interface NonDeviceConcept {
  name: string;
  category: NonDeviceCategory;
  description: string;
}

const NON_DEVICE_CONCEPTS_MAP = new Map<string, NonDeviceConcept>([
  ['aiagents', { name: 'AI Agents', category: 'AI_SOFTWARE', description: 'Autonomous agentic AI workflow' }],
  ['aimodels', { name: 'AI Models', category: 'AI_SOFTWARE', description: 'Neural network architectures' }],
  ['gemini', { name: 'Gemini', category: 'AI_SOFTWARE', description: 'Multimodal AI model by Google' }],
  ['chatgpt', { name: 'ChatGPT', category: 'AI_SOFTWARE', description: 'Conversational LLM by OpenAI' }],
  ['applem5', { name: 'Apple M5', category: 'CHIPSET_SILICON', description: 'Apple Silicon System-on-Chip' }],
  ['applem4', { name: 'Apple M4', category: 'CHIPSET_SILICON', description: 'Apple Silicon System-on-Chip' }],
  ['mediatekdimensity9500', { name: 'MediaTek Dimensity 9500', category: 'CHIPSET_SILICON', description: 'Flagship mobile SoC' }],
  ['dimensity9400', { name: 'MediaTek Dimensity 9400', category: 'CHIPSET_SILICON', description: 'Flagship mobile SoC' }],
  ['snapdragon8gen3', { name: 'Snapdragon 8 Gen 3', category: 'CHIPSET_SILICON', description: 'Qualcomm mobile platform' }],
  ['snapdragon8elite', { name: 'Snapdragon 8 Elite', category: 'CHIPSET_SILICON', description: 'Qualcomm flagship platform' }],
  ['kirin9050', { name: 'Kirin 9050', category: 'CHIPSET_SILICON', description: 'HiSilicon mobile SoC' }],
  ['kirin9020', { name: 'Kirin 9020', category: 'CHIPSET_SILICON', description: 'HiSilicon mobile SoC' }],
  ['kirin9010', { name: 'Kirin 9010', category: 'CHIPSET_SILICON', description: 'HiSilicon mobile SoC' }],
  ['kirin9000s', { name: 'Kirin 9000S', category: 'CHIPSET_SILICON', description: 'HiSilicon mobile SoC' }],
  ['kirin9000', { name: 'Kirin 9000', category: 'CHIPSET_SILICON', description: 'HiSilicon mobile SoC' }],
  ['rtx60gpu', { name: 'RTX 60 GPU', category: 'CHIPSET_SILICON', description: 'NVIDIA GPU architecture' }],
  ['nvidiartx40series', { name: 'NVIDIA RTX 40 Series', category: 'CHIPSET_SILICON', description: 'Ada Lovelace architecture GPU' }],
  ['ipados27', { name: 'iPadOS 27', category: 'OPERATING_SYSTEM', description: 'Apple tablet operating system version' }],
  ['ipados', { name: 'iPadOS', category: 'OPERATING_SYSTEM', description: 'Apple tablet operating system' }],
  ['android15', { name: 'Android 15', category: 'OPERATING_SYSTEM', description: 'Google mobile operating system' }],
  ['android16', { name: 'Android 16', category: 'OPERATING_SYSTEM', description: 'Google mobile operating system' }],
  ['android', { name: 'Android', category: 'OPERATING_SYSTEM', description: 'Google mobile operating system' }],
  ['androidos', { name: 'Android OS', category: 'OPERATING_SYSTEM', description: 'Google mobile operating system' }],
  ['harmonyosnext', { name: 'HarmonyOS NEXT', category: 'OPERATING_SYSTEM', description: 'Independent Huawei operating system' }],
  ['harmonyos', { name: 'HarmonyOS', category: 'OPERATING_SYSTEM', description: 'Huawei distributed operating system' }],
  ['ios18', { name: 'iOS 18', category: 'OPERATING_SYSTEM', description: 'Apple mobile operating system' }],
  ['ios19', { name: 'iOS 19', category: 'OPERATING_SYSTEM', description: 'Apple mobile operating system' }],
  ['ios', { name: 'iOS', category: 'OPERATING_SYSTEM', description: 'Apple mobile operating system' }],
  ['oneui', { name: 'One UI', category: 'OPERATING_SYSTEM', description: 'Samsung custom software layer' }],
  ['watchos', { name: 'watchOS', category: 'OPERATING_SYSTEM', description: 'Apple Watch operating system' }],
  ['wearos', { name: 'Wear OS', category: 'OPERATING_SYSTEM', description: 'Google smartwatch operating system' }],
  ['hyperos', { name: 'HyperOS', category: 'OPERATING_SYSTEM', description: 'Xiaomi unified operating system' }],
  ['windows', { name: 'Windows', category: 'OPERATING_SYSTEM', description: 'Microsoft personal computer operating system' }],
  ['windows11', { name: 'Windows 11', category: 'OPERATING_SYSTEM', description: 'Microsoft personal computer operating system' }],

  // Automotive Software & Infotainment Platforms
  ['applecarplay', { name: 'Apple CarPlay', category: 'AUTOMOTIVE_SOFTWARE', description: 'Apple automotive infotainment platform' }],
  ['carplay', { name: 'CarPlay', category: 'AUTOMOTIVE_SOFTWARE', description: 'Apple automotive infotainment platform' }],
  ['androidauto', { name: 'Android Auto', category: 'AUTOMOTIVE_SOFTWARE', description: 'Google automotive projection platform' }],
  ['androidautomotive', { name: 'Android Automotive', category: 'AUTOMOTIVE_SOFTWARE', description: 'Google embedded automotive operating system' }],
  ['androidautomotiveos', { name: 'Android Automotive OS', category: 'AUTOMOTIVE_SOFTWARE', description: 'Google embedded automotive operating system' }],

  // Software Utilities & Developer Tools
  ['scrcpy', { name: 'scrcpy', category: 'SOFTWARE_TOOL', description: 'Open-source screen mirroring software utility' }],
]);

/**
 * Checks if a string represents an aggregated multi-series reference (e.g. "Samsung Galaxy S / A / M / F Series")
 * rather than a single distinct hardware model.
 */
export function isBroadMultiSeriesReference(name: string): boolean {
  if (!name) return false;
  // Detect multiple single letters separated by slashes: e.g. "S / A / M / F", "S/A/M/F", "X / Y / Z"
  return /[a-z]\s*\/\s*[a-z]\s*\/\s*[a-z]/i.test(name);
}

/**
 * Checks if an entity name is a software, chipset, or OS concept rather than a hardware product.
 */
export function classifyNonDeviceConcept(detectedName: string): NonDeviceConcept | null {
  if (!detectedName) return null;
  const trimmed = detectedName.trim();
  const key = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');

  const staticMatch = NON_DEVICE_CONCEPTS_MAP.get(key);
  if (staticMatch) return staticMatch;

  // 1. Version-aware Operating System Pattern Recognition
  if (/^ios\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Apple mobile operating system version' };
  }
  if (/^android\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Google mobile operating system version' };
  }
  if (/^ipados\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Apple tablet operating system version' };
  }
  if (/^watchos\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Apple Watch operating system version' };
  }
  if (/^wearos\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Google smartwatch operating system version' };
  }
  if (/^oneui\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Samsung custom software layer version' };
  }
  if (/^hyperos\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Xiaomi unified operating system version' };
  }
  if (/^harmonyos(next)?\d*$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Huawei operating system version' };
  }
  if (/^windows\d+$/.test(key)) {
    return { name: detectedName, category: 'OPERATING_SYSTEM', description: 'Microsoft personal computer operating system version' };
  }

  // 2. Chipset Naming Pattern Recognition (e.g. Kirin 9050 Pro, Dimensity 9500 Plus)
  if (/^kirin\d{3,4}(pro|plus|ultra|max|s|e)?$/.test(key)) {
    return { name: detectedName, category: 'CHIPSET_SILICON', description: 'HiSilicon mobile SoC variant' };
  }
  if (/^snapdragon\d+(gen\d+)?(elite|plus|pro)?$/.test(key)) {
    return { name: detectedName, category: 'CHIPSET_SILICON', description: 'Qualcomm mobile platform variant' };
  }
  if (/^(mediatek)?dimensity\d+(pro|plus|ultra|max)?$/.test(key)) {
    return { name: detectedName, category: 'CHIPSET_SILICON', description: 'MediaTek mobile SoC variant' };
  }

  // 3. Broad Multi-Series Product Family Aggregations (e.g. "Samsung Galaxy S / A / M / F Series")
  if (isBroadMultiSeriesReference(detectedName)) {
    return { name: detectedName, category: 'TECH_CONCEPT', description: 'Broad multi-series product family aggregation' };
  }

  return null;
}

// ============================================================================
// 4. ENTITY NORMALIZATION & KEY GENERATION
// ============================================================================

export function normalizeEntityKey(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Strips corporate legal suffixes safely with word boundaries.
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return '';
  let cleaned = name.trim();
  // Strip corporate suffixes using word boundaries
  cleaned = cleaned
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|gmbh|technologies|technology|consumer bg|device co|communication technology)\b\.?/gi, '')
    .trim();
  return normalizeEntityKey(cleaned);
}

// Generic tokens that must NEVER trigger substring/infix matches alone
export const GENERIC_PRODUCT_TOKENS = new Set([
  'air', 'pro', 'ultra', 'max', 'watch', 'buds', 'pad', 'plus', 'mini', 'band',
  'fit', 'tab', 'phone', 'ring', 'fold', 'flip', 'series', 'edition', 'smart',
  'wireless', 'headphone', 'headphones', 'earbuds', 'tablet', 'laptop',
]);

// ============================================================================
// DYNAMIC MERGED REGISTRY HELPERS & VALIDATION (Phase 4C.6B)
// ============================================================================

/**
 * Returns merged canonical companies (Static registry + Firestore companies),
 * with Firestore entities overriding or supplementing static seeds by ID.
 */
export function getMergedCanonicalCompanies(firestoreCompanies?: Company[]): Company[] {
  const map = new Map<string, Company>();
  for (const c of CANONICAL_COMPANIES_REGISTRY) {
    map.set(c.id, c);
  }
  if (firestoreCompanies && firestoreCompanies.length > 0) {
    for (const c of firestoreCompanies) {
      if (c && c.id) {
        map.set(c.id, c);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Returns merged canonical products (Static catalog + Firestore products),
 * with Firestore entities overriding or supplementing static seeds by ID.
 */
export function getMergedCanonicalProducts(firestoreProducts?: Product[]): Product[] {
  const map = new Map<string, Product>();
  for (const p of CANONICAL_PRODUCTS_REGISTRY) {
    const auditMeta = getProductAuditMetadata(p.id);
    map.set(p.id, {
      ...p,
      category: normalizeCatalogCategoryDisplay(p.category),
      lifecycle: p.lifecycle || auditMeta.lifecycle,
      entryType: p.entryType || auditMeta.entryType,
      launchDate: p.launchDate || auditMeta.launchDate,
      evidenceType: p.evidenceType || auditMeta.evidenceType,
      evidenceUrl: p.evidenceUrl || auditMeta.evidenceUrl,
      evidenceRationale: p.evidenceRationale || auditMeta.evidenceRationale,
      greekMarketAvailability: p.greekMarketAvailability || auditMeta.greekMarketAvailability,
    });
  }
  if (firestoreProducts && firestoreProducts.length > 0) {
    for (const p of firestoreProducts) {
      if (p && p.id) {
        const existing = map.get(p.id);
        const auditMeta = getProductAuditMetadata(p.id);
        map.set(p.id, {
          ...existing,
          ...p,
          category: normalizeCatalogCategoryDisplay(p.category || existing?.category),
          lifecycle: p.lifecycle || existing?.lifecycle || auditMeta.lifecycle,
          entryType: p.entryType || existing?.entryType || auditMeta.entryType,
          launchDate: p.launchDate || existing?.launchDate || auditMeta.launchDate,
          evidenceType: p.evidenceType || existing?.evidenceType || auditMeta.evidenceType,
          evidenceUrl: p.evidenceUrl || existing?.evidenceUrl || auditMeta.evidenceUrl,
          evidenceRationale: p.evidenceRationale || existing?.evidenceRationale || auditMeta.evidenceRationale,
          greekMarketAvailability: p.greekMarketAvailability || existing?.greekMarketAvailability || auditMeta.greekMarketAvailability,
        });
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Generates a collision-safe canonical company ID in the standard format `comp-{slug}`.
 */
export function generateCanonicalCompanyId(name: string): string {
  const slug = normalizeCompanyName(name) || normalizeEntityKey(name);
  return `comp-${slug}`;
}

/**
 * Generates a collision-safe canonical product ID in the standard format `prod-{compPrefix}-{slug}`.
 */
export function generateCanonicalProductId(companyId: string, name: string): string {
  const compSlug = companyId.replace(/^comp-/, '').slice(0, 4);
  const prodSlug = normalizeEntityKey(name);
  return `prod-${compSlug}-${prodSlug}`;
}

/**
 * Tests whether a string is a reserved generic product token that cannot be a standalone alias.
 */
export function isGenericProductToken(token: string): boolean {
  if (!token) return true;
  const norm = normalizeEntityKey(token);
  return GENERIC_PRODUCT_TOKENS.has(norm) || norm.length < 2;
}

/**
 * Validates whether an alias is safe to add to a canonical entity.
 */
export function validateCanonicalAlias(alias: string): { valid: boolean; reason?: string } {
  const trimmed = alias.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Alias cannot be empty.' };
  }
  if (trimmed.length < 2) {
    return { valid: false, reason: 'Alias is too short (minimum 2 characters).' };
  }
  if (isGenericProductToken(trimmed)) {
    return {
      valid: false,
      reason: `"${trimmed}" is a reserved generic token and cannot be used as a standalone alias.`,
    };
  }
  return { valid: true };
}

/**
 * Checks whether a proposed company name or alias collides with an existing canonical company.
 */
export function checkCompanyCollision(
  name: string,
  aliases: string[] = [],
  existingCompanies: Company[] = CANONICAL_COMPANIES_REGISTRY
): { hasCollision: boolean; conflictingCompany?: Company; reason?: string } {
  const targetId = generateCanonicalCompanyId(name);
  const targetNorm = normalizeCompanyName(name);

  for (const c of existingCompanies) {
    if (c.id === targetId) {
      return { hasCollision: true, conflictingCompany: c, reason: `Company ID "${targetId}" already exists.` };
    }
    if (normalizeCompanyName(c.name) === targetNorm) {
      return { hasCollision: true, conflictingCompany: c, reason: `Company name "${c.name}" already exists.` };
    }
    for (const a of c.aliases || []) {
      if (normalizeCompanyName(a) === targetNorm) {
        return { hasCollision: true, conflictingCompany: c, reason: `Name "${name}" matches existing alias of "${c.name}".` };
      }
    }
  }

  for (const alias of aliases) {
    const aliasNorm = normalizeCompanyName(alias);
    for (const c of existingCompanies) {
      if (normalizeCompanyName(c.name) === aliasNorm) {
        return { hasCollision: true, conflictingCompany: c, reason: `Proposed alias "${alias}" collides with existing company "${c.name}".` };
      }
      for (const a of c.aliases || []) {
        if (normalizeCompanyName(a) === aliasNorm) {
          return { hasCollision: true, conflictingCompany: c, reason: `Proposed alias "${alias}" collides with existing alias of "${c.name}".` };
        }
      }
    }
  }

  return { hasCollision: false };
}

/**
 * Checks whether a proposed product name or alias collides with an existing canonical product.
 */
export function checkProductCollision(
  name: string,
  category: string,
  companyId: string,
  aliases: string[] = [],
  existingProducts: Product[] = CANONICAL_PRODUCTS_REGISTRY
): { hasCollision: boolean; conflictingProduct?: Product; reason?: string } {
  const targetId = generateCanonicalProductId(companyId, name);
  const targetNorm = normalizeEntityKey(name);
  const targetCat = normalizeDeviceCategory(category);

  for (const p of existingProducts) {
    if (p.id === targetId) {
      return { hasCollision: true, conflictingProduct: p, reason: `Product ID "${targetId}" already exists.` };
    }
    const pCat = normalizeDeviceCategory(p.category);
    if (p.companyId === companyId && pCat === targetCat) {
      if (normalizeEntityKey(p.name) === targetNorm) {
        return { hasCollision: true, conflictingProduct: p, reason: `Product "${p.name}" already registered for this company.` };
      }
      for (const a of p.aliases || []) {
        if (normalizeEntityKey(a) === targetNorm) {
          return { hasCollision: true, conflictingProduct: p, reason: `Matches existing alias of product "${p.name}".` };
        }
      }
    }
  }

  for (const alias of aliases) {
    const aliasNorm = normalizeEntityKey(alias);
    for (const p of existingProducts) {
      if (p.companyId === companyId && normalizeDeviceCategory(p.category) === targetCat) {
        if (normalizeEntityKey(p.name) === aliasNorm) {
          return { hasCollision: true, conflictingProduct: p, reason: `Proposed alias "${alias}" collides with existing product "${p.name}".` };
        }
      }
    }
  }

  return { hasCollision: false };
}

// ============================================================================
// 5. DETERMINISTIC COMPANY RESOLVER
// ============================================================================

export interface CompanyResolutionResult {
  matchedCompany?: Company;
  matchedAlias?: string;
  isRecognizedEcosystem?: boolean;
  ecosystemSector?: string;
  confidence: number;
}

/**
 * Resolves a detected company name against canonical registered companies & aliases.
 * Resilient against case, corporate suffixes, punctuation, and word boundary collisions.
 */
export function resolveCompanySafe(
  detectedName: string,
  canonicalCompanies: Company[] = CANONICAL_COMPANIES_REGISTRY
): CompanyResolutionResult {
  if (!detectedName) return { confidence: 0 };
  const trimmed = detectedName.trim();
  const normDetected = normalizeCompanyName(trimmed);
  const rawNormDetected = normalizeEntityKey(trimmed);

  if (!normDetected && !rawNormDetected) return { confidence: 0 };

  // 1. Exact match on Canonical ID
  for (const company of canonicalCompanies) {
    if (company.id.toLowerCase() === detectedName.toLowerCase()) {
      return { matchedCompany: company, matchedAlias: company.name, confidence: 1.0 };
    }
  }

  // 2. Exact match on normalized Company Name
  for (const company of canonicalCompanies) {
    const compNorm = normalizeCompanyName(company.name);
    const compRawNorm = normalizeEntityKey(company.name);
    if (compNorm === normDetected || compRawNorm === rawNormDetected || compNorm === rawNormDetected) {
      return { matchedCompany: company, matchedAlias: company.name, confidence: 1.0 };
    }
  }

  // 3. Match against explicit aliases
  for (const company of canonicalCompanies) {
    for (const alias of company.aliases || []) {
      const aliasNorm = normalizeCompanyName(alias);
      const aliasRawNorm = normalizeEntityKey(alias);
      if (aliasNorm === normDetected || aliasRawNorm === rawNormDetected || aliasNorm === rawNormDetected) {
        return { matchedCompany: company, matchedAlias: alias, confidence: 0.98 };
      }
    }
  }

  // 4. Safe Word-Boundary Matching (AVOIDS substring collision like "vivobook" -> "vivo")
  for (const company of canonicalCompanies) {
    const companyCleanName = company.name.toLowerCase();
    // Only check if company name is an isolated word in detectedName
    const escaped = companyCleanName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const wordBoundaryRegex = new RegExp(`(^|\\s|[-_])${escaped}(\\s|[-_]|$)`, 'i');
    if (wordBoundaryRegex.test(trimmed)) {
      return { matchedCompany: company, matchedAlias: company.name, confidence: 0.95 };
    }

    // Also check aliases with word boundary
    for (const alias of company.aliases || []) {
      if (alias.length >= 4) {
        const aliasEscaped = alias.toLowerCase().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const aliasRegex = new RegExp(`(^|\\s|[-_])${aliasEscaped}(\\s|[-_]|$)`, 'i');
        if (aliasRegex.test(trimmed)) {
          return { matchedCompany: company, matchedAlias: alias, confidence: 0.92 };
        }
      }
    }
  }

  // 5. Check Recognized Non-Tracked Ecosystem Partners (e.g., Qualcomm, Sony, Bose, ASUS)
  for (const eco of RECOGNIZED_ECOSYSTEM_COMPANIES) {
    const ecoNorm = normalizeCompanyName(eco.name);
    if (ecoNorm === normDetected || ecoNorm === rawNormDetected) {
      return {
        isRecognizedEcosystem: true,
        ecosystemSector: eco.sector,
        matchedAlias: eco.name,
        confidence: 0.9,
      };
    }
    for (const alias of eco.aliases) {
      const aliasNorm = normalizeCompanyName(alias);
      if (aliasNorm === normDetected || aliasNorm === rawNormDetected) {
        return {
          isRecognizedEcosystem: true,
          ecosystemSector: eco.sector,
          matchedAlias: alias,
          confidence: 0.88,
        };
      }
    }
  }

  return { confidence: 0 };
}

// ============================================================================
// 6. DETERMINISTIC PRODUCT RESOLVER
// ============================================================================

export interface ProductResolutionResult {
  matchedProduct?: Product;
  matchedAlias?: string;
  isNonDeviceConcept?: boolean;
  nonDeviceCategory?: NonDeviceCategory;
  confidence: number;
}

/**
 * Resolves a detected product name against canonical registered products & aliases.
 * Enforces category compatibility, token isolation, and product family mapping.
 */
export function resolveProductSafe(
  detectedName: string,
  detectedCategory: string = 'OTHER',
  canonicalProducts: Product[] = CANONICAL_PRODUCTS_REGISTRY,
  parentCompanyHint?: string
): ProductResolutionResult {
  if (!detectedName) return { confidence: 0 };
  const trimmed = detectedName.trim();
  const normDetected = normalizeEntityKey(trimmed);
  const normCategory = normalizeDeviceCategory(detectedCategory || 'OTHER');

  if (!normDetected) return { confidence: 0 };

  // 0. Non-Hardware Concept Guard (e.g., "AI Agents", "iPadOS 27", "MediaTek Dimensity 9500")
  const concept = classifyNonDeviceConcept(trimmed);
  if (concept) {
    return {
      isNonDeviceConcept: true,
      nonDeviceCategory: concept.category,
      matchedAlias: concept.name,
      confidence: 0.95,
    };
  }

  // 1. Exact match on Product ID
  for (const product of canonicalProducts) {
    if (product.id.toLowerCase() === trimmed.toLowerCase()) {
      return { matchedProduct: product, matchedAlias: product.name, confidence: 1.0 };
    }
  }

  // 2. Exact match on Product Name (Category-compatible)
  for (const product of canonicalProducts) {
    const prodCategory = normalizeDeviceCategory(product.category || 'OTHER');
    const isCategoryCompatible =
      normCategory === 'UNKNOWN' ||
      normCategory === 'OTHER' ||
      prodCategory === 'UNKNOWN' ||
      prodCategory === 'OTHER' ||
      normCategory === prodCategory;

    if (!isCategoryCompatible) continue;

    if (normalizeEntityKey(product.name) === normDetected) {
      return { matchedProduct: product, matchedAlias: product.name, confidence: 1.0 };
    }
  }

  // 3. Exact match on Product Aliases (Category-compatible)
  for (const product of canonicalProducts) {
    const prodCategory = normalizeDeviceCategory(product.category || 'OTHER');
    const isCategoryCompatible =
      normCategory === 'UNKNOWN' ||
      normCategory === 'OTHER' ||
      prodCategory === 'UNKNOWN' ||
      prodCategory === 'OTHER' ||
      normCategory === prodCategory;

    if (!isCategoryCompatible) continue;

    for (const alias of product.aliases || []) {
      if (normalizeEntityKey(alias) === normDetected) {
        return { matchedProduct: product, matchedAlias: alias, confidence: 0.98 };
      }
    }
  }

  // 4. Token & Word-Boundary Substring Matching (Suppressing generic tokens)
  if (!GENERIC_PRODUCT_TOKENS.has(normDetected) && normDetected.length >= 6) {
    for (const product of canonicalProducts) {
      const prodCategory = normalizeDeviceCategory(product.category || 'OTHER');
      const isCategoryCompatible =
        normCategory === 'UNKNOWN' ||
        normCategory === 'OTHER' ||
        prodCategory === 'UNKNOWN' ||
        prodCategory === 'OTHER' ||
        normCategory === prodCategory;

      if (!isCategoryCompatible) continue;

      // Filter by company hint if available
      if (parentCompanyHint && product.companyId !== parentCompanyHint) {
        continue;
      }

      // Check product name
      const normName = normalizeEntityKey(product.name);
      if (!GENERIC_PRODUCT_TOKENS.has(normName) && normName.length >= 6) {
        if (normDetected === normName || (normDetected.length >= 8 && normDetected.includes(normName))) {
          return { matchedProduct: product, matchedAlias: product.name, confidence: 0.92 };
        }
      }

      // Check product aliases
      for (const alias of product.aliases || []) {
        const normAlias = normalizeEntityKey(alias);
        if (!GENERIC_PRODUCT_TOKENS.has(normAlias) && normAlias.length >= 6) {
          if (normDetected === normAlias || (normDetected.length >= 8 && normDetected.includes(normAlias))) {
            return { matchedProduct: product, matchedAlias: alias, confidence: 0.9 };
          }
        }
      }
    }
  }

  // 5. Special Family Matching for Future / Next-Gen Series Variants
  // Example: "Galaxy Tab S12 Ultra" matching "Galaxy Tab S12 Series"
  for (const product of canonicalProducts) {
    const prodCategory = normalizeDeviceCategory(product.category || 'OTHER');
    const isCategoryCompatible =
      normCategory === 'UNKNOWN' ||
      normCategory === 'OTHER' ||
      prodCategory === 'UNKNOWN' ||
      prodCategory === 'OTHER' ||
      normCategory === prodCategory;

    if (!isCategoryCompatible) continue;

    for (const alias of product.aliases || []) {
      const normAlias = normalizeEntityKey(alias);
      if (normAlias.length >= 6 && normDetected.includes(normAlias)) {
        return { matchedProduct: product, matchedAlias: alias, confidence: 0.88 };
      }
    }
  }

  return { confidence: 0 };
}

// ============================================================================
// 7. CANONICAL REVIEW DECISION ENGINE
// ============================================================================

export interface ReviewDecisionResult {
  shouldCreateReview: boolean;
  reason?: string;
  suggestedAction?: 'AUTO_RESOLVE' | 'DISMISS_NON_DEVICE' | 'QUEUE_FOR_REVIEW';
  matchedEntityId?: string;
  matchedEntityType?: 'COMPANY' | 'PRODUCT';
}

/**
 * Determines whether a detected entity genuinely requires human review in /entityReview
 * or can be auto-resolved to canonical registries / dismissed as a non-device concept.
 */
export function evaluateEntityReviewNeed(
  entityType: 'COMPANY' | 'PRODUCT',
  detectedName: string,
  category?: string,
  parentCompany?: string,
  canonicalCompanies: Company[] = CANONICAL_COMPANIES_REGISTRY,
  canonicalProducts: Product[] = CANONICAL_PRODUCTS_REGISTRY
): ReviewDecisionResult {
  if (!detectedName || detectedName.trim().length < 2) {
    return { shouldCreateReview: false, reason: 'INVALID_EMPTY_NAME', suggestedAction: 'DISMISS_NON_DEVICE' };
  }

  if (entityType === 'COMPANY') {
    const compRes = resolveCompanySafe(detectedName, canonicalCompanies);
    if (compRes.matchedCompany) {
      return {
        shouldCreateReview: false,
        reason: 'CANONICAL_COMPANY_RESOLVED',
        suggestedAction: 'AUTO_RESOLVE',
        matchedEntityId: compRes.matchedCompany.id,
        matchedEntityType: 'COMPANY',
      };
    }
    if (compRes.isRecognizedEcosystem) {
      return {
        shouldCreateReview: false,
        reason: `RECOGNIZED_ECOSYSTEM_${compRes.ecosystemSector?.toUpperCase() || 'PARTNER'}`,
        suggestedAction: 'DISMISS_NON_DEVICE',
      };
    }
    return {
      shouldCreateReview: true,
      reason: 'UNRESOLVED_COMPANY',
      suggestedAction: 'QUEUE_FOR_REVIEW',
    };
  }

  // PRODUCT resolution
  const prodRes = resolveProductSafe(detectedName, category, canonicalProducts, parentCompany);
  if (prodRes.matchedProduct) {
    return {
      shouldCreateReview: false,
      reason: 'CANONICAL_PRODUCT_RESOLVED',
      suggestedAction: 'AUTO_RESOLVE',
      matchedEntityId: prodRes.matchedProduct.id,
      matchedEntityType: 'PRODUCT',
    };
  }
  if (prodRes.isNonDeviceConcept) {
    return {
      shouldCreateReview: false,
      reason: `NON_DEVICE_CONCEPT_${prodRes.nonDeviceCategory}`,
      suggestedAction: 'DISMISS_NON_DEVICE',
    };
  }

  return {
    shouldCreateReview: true,
    reason: 'UNRESOLVED_PRODUCT',
    suggestedAction: 'QUEUE_FOR_REVIEW',
  };
}

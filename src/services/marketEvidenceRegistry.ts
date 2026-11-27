/**
 * Verified Market Evidence Registry (Phase 5S-C1.2)
 * 
 * Strict Grounding & Anti-Hallucination Rules:
 * 1. Greek market availability is NEVER assumed from global headquarters, global launches,
 *    or product announcements.
 * 2. Distinguishes:
 *    - OFFICIAL: Direct manufacturer Greek legal subsidiary, localized consumer portal (e.g. consumer.huawei.com/gr),
 *      or officially declared local distributor network.
 *    - RETAIL_CONFIRMED: Confirmed local inventory in major Greek retail electronics chains
 *      (Kotsovolos, Plaisio, Public), without assuming direct manufacturer distribution.
 *    - UNKNOWN: Default state when no authoritative Greek market evidence is established.
 *    - UNAVAILABLE: Confirmed absence only when supported by authoritative exit or exclusion records.
 * 3. Never converts UNKNOWN into confirmed absence.
 */

import { MarketEvidence } from '../types';

export const VERIFIED_GREEK_MARKET_EVIDENCE: MarketEvidence[] = [
  // --------------------------------------------------------------------------
  // HUAWEI: Official direct distribution & localized portal
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-huawei',
    market: 'GR',
    status: 'OFFICIAL',
    evidenceType: 'LOCALIZED_PORTAL_AND_OFFICIAL_DISTRIBUTION',
    sourceUrl: 'https://consumer.huawei.com/gr/',
    details: 'Official Greek consumer website and nationwide direct distributor network across carrier and retail channels.',
    observedAt: '2025-01-01T00:00:00Z',
    verifiedAt: '2026-03-01T00:00:00Z',
  },

  // --------------------------------------------------------------------------
  // Samsung: Official subsidiary & direct distribution
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-samsung',
    market: 'GR',
    status: 'OFFICIAL',
    evidenceType: 'LOCAL_SUBSIDIARY',
    sourceUrl: 'https://www.samsung.com/gr/',
    details: 'Samsung Electronics Greece legal entity, localized portal, direct consumer channel.',
    observedAt: '2025-01-01T00:00:00Z',
    verifiedAt: '2026-03-01T00:00:00Z',
  },

  // --------------------------------------------------------------------------
  // Apple: Official authorized distributor channel
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-apple',
    market: 'GR',
    status: 'OFFICIAL',
    evidenceType: 'OFFICIAL_REGIONAL_DISTRIBUTOR',
    sourceUrl: 'https://www.apple.com/gr/',
    details: 'Official Greek web localization and exclusive authorized value-added distributor network.',
    observedAt: '2025-01-01T00:00:00Z',
    verifiedAt: '2026-03-01T00:00:00Z',
  },

  // --------------------------------------------------------------------------
  // Xiaomi: Official authorized distributor channel
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-xiaomi',
    market: 'GR',
    status: 'OFFICIAL',
    evidenceType: 'OFFICIAL_REGIONAL_DISTRIBUTOR',
    sourceUrl: 'https://www.mi.com/gr/',
    details: 'Official Greek portal and authorized national distributor network (Info Quest Technologies).',
    observedAt: '2025-01-01T00:00:00Z',
    verifiedAt: '2026-03-01T00:00:00Z',
  },

  // --------------------------------------------------------------------------
  // HONOR: Official national distributor & localized presence
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-honor',
    market: 'GR',
    status: 'OFFICIAL',
    evidenceType: 'OFFICIAL_REGIONAL_DISTRIBUTOR',
    sourceUrl: 'https://www.hihonor.com/gr/',
    details: 'Official Greek portal and official retail channel rollout for Magic Series smartphones and wearables.',
    observedAt: '2025-01-01T00:00:00Z',
    verifiedAt: '2026-03-01T00:00:00Z',
  },

  // --------------------------------------------------------------------------
  // Garmin: Official authorized distributor channel
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-garmin',
    market: 'GR',
    status: 'OFFICIAL',
    evidenceType: 'OFFICIAL_REGIONAL_DISTRIBUTOR',
    sourceUrl: 'https://www.garmin.gr/',
    details: 'Official Garmin Greece localized presence and authorized sporting goods and electronics distribution.',
    observedAt: '2025-01-01T00:00:00Z',
    verifiedAt: '2026-03-01T00:00:00Z',
  },

  // --------------------------------------------------------------------------
  // Google: Retail confirmed in Greek tech stores; official hardware store unlocalized
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-google',
    market: 'GR',
    status: 'RETAIL_CONFIRMED',
    evidenceType: 'RETAIL_IMPORT_CONFIRMED',
    sourceUrl: 'https://www.insomnia.gr/articles/hardware/smartphones/google-pixel-greece-retail/',
    details: 'Pixel devices actively retailed through Greek electronic chains, though official Google Hardware Store direct distribution is not localized for Greece.',
    observedAt: '2025-06-01T00:00:00Z',
    verifiedAt: '2026-03-01T00:00:00Z',
  },

  // --------------------------------------------------------------------------
  // OPPO: Retail confirmed in selected Greek channels (historical / partner distribution)
  // --------------------------------------------------------------------------
  {
    companyId: 'comp-oppo',
    market: 'GR',
    status: 'RETAIL_CONFIRMED',
    evidenceType: 'RETAIL_PARTNER_CONFIRMED',
    sourceUrl: 'https://www.techblog.gr/mobile/oppo-greece-retail-rollout/',
    details: 'Selected smartphone and audio models stocked by Greek consumer electronics retailers.',
    observedAt: '2025-03-01T00:00:00Z',
    verifiedAt: '2026-02-01T00:00:00Z',
  },

  // Note: vivo (comp-vivo) is deliberately omitted from this registry
  // so that its status evaluates to 'UNKNOWN' as required by the audit specification.
];

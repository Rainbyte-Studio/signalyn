/**
 * Signalyn Service Intelligence - Official Source Registry (Phase S1.0)
 * 
 * Sources:
 * 1. Source A - Huawei Consumer Security (Smartphones, Tablets, Wearables, MateBooks)
 * 2. Source B - Apple Security (iOS, iPadOS, macOS, watchOS, repair programs)
 * 3. Source C - Samsung Mobile Security (Monthly SMRs, SVEs, supported model tiers)
 * 4. Source D - NIST National Vulnerability Database API 2.0 (CVSS metrics, CVE records)
 * 5. Source E - CISA Known Exploited Vulnerabilities (Active exploitation, binding directives)
 */

import { ServiceSource, ServiceSourceId } from '../../types/serviceIntelligence';

export const OFFICIAL_SERVICE_SOURCES: Record<ServiceSourceId, ServiceSource> = {
  'huawei-security': {
    id: 'huawei-security',
    name: 'Huawei Consumer Security Bulletins',
    manufacturerOrAuthority: 'Huawei',
    sourceType: 'MANUFACTURER_BULLETIN',
    officialUrl: 'https://consumer.huawei.com/gr/support/bulletin/',
    additionalUrls: [
      'https://consumer.huawei.com/en/support/bulletinlaptops/',
      'https://consumer.huawei.com/gr/support/',
    ],
    enabled: true,
    status: 'ACTIVE',
    collectionStatus: 'IDLE',
    recordsDiscovered: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    provenanceDescription:
      'Official monthly security bulletins, quarterly maintenance schedules, and device lists from consumer.huawei.com (GR & EN).',
  },
  'apple-security': {
    id: 'apple-security',
    name: 'Apple Security Releases',
    manufacturerOrAuthority: 'Apple',
    sourceType: 'MANUFACTURER_RELEASES',
    officialUrl: 'https://support.apple.com/100100',
    additionalUrls: [
      'https://support.apple.com/',
      'https://support.apple.com/service-programs',
    ],
    enabled: true,
    status: 'ACTIVE',
    collectionStatus: 'IDLE',
    recordsDiscovered: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    provenanceDescription:
      'Authoritative security releases, fixed software versions, and affected hardware models published on support.apple.com/100100.',
  },
  'samsung-security': {
    id: 'samsung-security',
    name: 'Samsung Mobile Security Updates',
    manufacturerOrAuthority: 'Samsung',
    sourceType: 'MANUFACTURER_BULLETIN',
    officialUrl: 'https://security.samsungmobile.com/securityUpdate.smsb',
    additionalUrls: [
      'https://security.samsungmobile.com/',
    ],
    enabled: true,
    status: 'ACTIVE',
    collectionStatus: 'IDLE',
    recordsDiscovered: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    provenanceDescription:
      'Official Security Maintenance Releases (SMR), Samsung Vulnerabilities & Exposures (SVE), and update frequency tiers from security.samsungmobile.com.',
  },
  'cisa-kev': {
    id: 'cisa-kev',
    name: 'CISA Known Exploited Vulnerabilities (KEV)',
    manufacturerOrAuthority: 'Cybersecurity and Infrastructure Security Agency (CISA)',
    sourceType: 'CYBERSECURITY_AUTHORITY',
    officialUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    additionalUrls: [
      'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    ],
    enabled: true,
    status: 'ACTIVE',
    collectionStatus: 'IDLE',
    recordsDiscovered: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    provenanceDescription:
      'Authoritative catalog of vulnerabilities known to be actively exploited in the wild, published by CISA with federal binding action dates.',
  },
  'nvd-api': {
    id: 'nvd-api',
    name: 'NIST National Vulnerability Database API 2.0',
    manufacturerOrAuthority: 'National Institute of Standards and Technology (NIST)',
    sourceType: 'CYBERSECURITY_AUTHORITY',
    officialUrl: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
    additionalUrls: [
      'https://nvd.nist.gov/',
    ],
    enabled: true,
    status: 'ACTIVE',
    collectionStatus: 'IDLE',
    recordsDiscovered: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    provenanceDescription:
      'U.S. government repository of standards-based vulnerability management data, providing CVSS v3.1 base metrics and descriptions.',
  },
};

export function getOfficialServiceSources(): ServiceSource[] {
  return Object.values(OFFICIAL_SERVICE_SOURCES);
}

export function getOfficialServiceSource(id: ServiceSourceId): ServiceSource | undefined {
  return OFFICIAL_SERVICE_SOURCES[id];
}

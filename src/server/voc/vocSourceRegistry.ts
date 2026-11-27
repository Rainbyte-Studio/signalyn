/**
 * Signalyn Voice of Customer — Phase 1 Source Feasibility Registry & Live Auditor
 *
 * Implements the authoritative VOC source registry grounded in empirical HTTP,
 * robots.txt, WAF/anti-bot, and API governance audits.
 *
 * Strict Governance Rules:
 * - Never label a source operational without successful real-world verification.
 * - Never bypass access restrictions, CAPTCHA, login requirements, or anti-bot protections.
 * - Collection is disabled across all sources in VOC P1.0 (`collectionEnabledInP1_0: false`).
 */

import { VocSource, VocSourceFeasibilityStatus } from '../../types/vocIntelligence';

export const VOC_SOURCE_AUDIT_VERSION = 'VOC-P1.0-feasibility-v1';

export const AUTHORITATIVE_VOC_SOURCES: VocSource[] = [
  {
    id: 'voc-src-huawei-community-en',
    name: 'Huawei Global Consumer Community',
    sourceCategory: 'OFFICIAL_COMMUNITY',
    targetManufacturers: ['Huawei'],
    officialUrl: 'https://consumer.huawei.com/en/community/',
    auditedEndpointUrl: 'https://consumer.huawei.com/en/community/list/?forumId=10014',
    robotsTxtUrl: 'https://consumer.huawei.com/robots.txt',
    feasibilityStatus: 'ACCESSIBLE_WITH_RESTRICTIONS',
    contentAvailability:
      'Public community shell HTML returns HTTP 200 (203 KB, meta robots="index,follow"), but individual thread listings and comment payloads are dynamically hydrated client-side via Huawei internal gateway (sgw-sg.c.huawei.com/forward & /*/ucmf/).',
    permittedAccessMethod: 'DYNAMIC_CSR_GATEWAY',
    authenticationRequired: false,
    authenticationDetails:
      'Public browsing requires no login, but backend JSON thread endpoints use Huawei UCMF/SGW gateway headers and disallow automated crawling in robots.txt.',
    rateLimits: 'Gateway-enforced IP rate limiting; no documented public REST rate quota.',
    termsOfServiceRestrictions:
      'Huawei Website Terms of Use permit personal/informational viewing; automated bulk scraping of internal UCMF APIs is restricted.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: true,
      disallowedPathsSample: ['/class', '/com', '/lib', '/*/filter', '/*/ucmf/', '/*/query-result/'],
      summary:
        'Allows /en/community/ HTML shell, but explicitly disallows /*/ucmf/ (Unified Community Management Framework API) and /*/filter.',
    },
    antiBotProtection: {
      detected: true,
      provider: 'Huawei PAAS-WEB / SGW Gateway',
      details:
        'Zero static thread anchor links in SSR HTML; requires signed gateway calls to sgw-sg.c.huawei.com/forward which are disallowed by robots.txt /*/ucmf/.',
    },
    availableDataFields: [
      'Thread Title (CSR)',
      'Forum Category / Device Section',
      'Publication Timestamp (CSR)',
      'Author Pseudonym',
      'Thread Excerpt (CSR)',
    ],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes:
      'Forum sections and thread titles frequently reference Huawei product lines (Pura 70, Mate 60, Watch GT 4/5, FreeBuds, HarmonyOS/EMUI).',
    publicationTimestampsAvailable: true,
    technicallyFeasible: false,
    legallyFeasible: false,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:18:30.000Z',
    lastHttpStatus: 200,
    verificationEvidence:
      'Live HTTP 200 on https://consumer.huawei.com/en/community/list/?forumId=10014 (203,470 bytes, Server: elb) and HTTP 200 on robots.txt (1,527 bytes, Server: PAAS-WEB). Confirmed 0 SSR thread links (<a href=".../community/details/...">) due to client-side SGW/UCMF API hydration coupled with Disallow: /*/ucmf/ in robots.txt.',
    recommendedP1_1Action:
      'Do not scrape internal /*/ucmf/ gateway endpoints. Request authorized Huawei Consumer BG community feed access or ingest only explicitly syndicated public RSS/sitemap entries.',
  },
  {
    id: 'voc-src-huawei-support-gr',
    name: 'Huawei Official Support Greece & Global',
    sourceCategory: 'OFFICIAL_SUPPORT',
    targetManufacturers: ['Huawei'],
    officialUrl: 'https://consumer.huawei.com/gr/support/',
    auditedEndpointUrl: 'https://consumer.huawei.com/gr/support/',
    robotsTxtUrl: 'https://consumer.huawei.com/robots.txt',
    feasibilityStatus: 'ACCESSIBLE_WITH_RESTRICTIONS',
    contentAvailability:
      'Publicly accessible Greek (el-GR) and English official troubleshooting articles, repair policy pages, and warranty FAQs (HTTP 200, 146,011 bytes). Does not expose raw customer support tickets or user complaint streams.',
    permittedAccessMethod: 'PUBLIC_HTML_SSR',
    authenticationRequired: false,
    authenticationDetails:
      'No authentication required for official troubleshooting & warranty documentation; customer repair tickets require private Huawei ID authentication.',
    rateLimits: 'Standard CDN rate limits (Server: elb).',
    termsOfServiceRestrictions:
      'Official support articles are copyrighted by Huawei Device Co., Ltd.; only metadata, URLs, and brief diagnostic references may be indexed.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: true,
      disallowedPathsSample: ['/*/query-result/', '/*/result/', '/*/failure/', '/*/failed/'],
      summary: 'Allows /gr/support/ and /en/support/ knowledge base pages; disallows interactive search result paths.',
    },
    antiBotProtection: {
      detected: false,
      details: 'Direct HTTP 200 HTML response without CAPTCHA challenge on public support documentation.',
    },
    availableDataFields: [
      'Support Article Title',
      'Official URL',
      'Language (el-GR / en)',
      'Product Category / Troubleshooting Topic',
    ],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes:
      'Support pages are structured by device model and EMUI/HarmonyOS version, suitable for official troubleshooting correlation rather than raw customer complaint counting.',
    publicationTimestampsAvailable: false,
    technicallyFeasible: true,
    legallyFeasible: true,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:17:45.000Z',
    lastHttpStatus: 200,
    verificationEvidence:
      'Live HTTP 200 on https://consumer.huawei.com/gr/support/ (146,011 bytes, lang="el-GR", Server: elb). Confirmed public availability of official support documentation, with zero public customer complaint stream.',
    recommendedP1_1Action:
      'Use strictly as an official troubleshooting knowledge reference to enrich VOC clusters; never count support KB articles as customer complaints.',
  },
  {
    id: 'voc-src-reddit-huawei',
    name: 'Reddit Public Discussions (r/Huawei & Tech Subreddits)',
    sourceCategory: 'PUBLIC_FORUM',
    targetManufacturers: ['Huawei', 'Samsung', 'Apple', 'Xiaomi', 'Honor'],
    officialUrl: 'https://www.reddit.com/r/Huawei/',
    auditedEndpointUrl: 'https://www.reddit.com/r/Huawei/new.json?limit=3',
    robotsTxtUrl: 'https://www.reddit.com/robots.txt',
    feasibilityStatus: 'REQUIRES_AUTHORIZATION',
    contentAvailability:
      'Unauthenticated requests to /r/Huawei/new.json return HTTP 403 Forbidden (Server: snooserv) and /r/Huawei/new/.rss returns HTTP 429 Too Many Requests. Access is available exclusively via the official Reddit Data API with OAuth2 credentials.',
    permittedAccessMethod: 'OAUTH2_API',
    authenticationRequired: true,
    authenticationDetails:
      'Requires registered Reddit OAuth2 application (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET) authenticating against https://www.reddit.com/api/v1/access_token and querying https://oauth.reddit.com/r/Huawei/new.',
    rateLimits: '100 queries per minute (QPM) per OAuth2 client ID with descriptive User-Agent header.',
    termsOfServiceRestrictions:
      'Governed by Reddit Data API Terms and Reddit Public Content Policy (https://support.reddithelp.com/hc/en-us/articles/26410290525844-Public-Content-Policy). Unauthenticated scraping is strictly prohibited.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: false,
      disallowedPathsSample: ['/'],
      summary:
        'robots.txt (538 bytes) specifies "User-agent: * Disallow: /" and directs automated consumers to Reddit Public Content Policy and official API.',
    },
    antiBotProtection: {
      detected: true,
      provider: 'Reddit snooserv Edge Gate',
      details: 'Blocks unauthenticated datacenter requests with HTTP 403 (JSON) and HTTP 429 (Atom/RSS).',
    },
    availableDataFields: [
      'Post ID (t3_*)',
      'Permalink URL',
      'Created UTC Timestamp',
      'Subreddit',
      'Flair / Post Title',
      'Self-text Excerpt',
      'Comment Count & Score',
    ],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes:
      'High signal density for specific models (e.g., Pura 70 Ultra, MatePad 11.5S, Watch GT 5, FreeBuds Pro 3) in post titles and user flairs.',
    publicationTimestampsAvailable: true,
    technicallyFeasible: true,
    legallyFeasible: true,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:19:22.000Z',
    lastHttpStatus: 403,
    verificationEvidence:
      'Live probe to https://www.reddit.com/r/Huawei/new.json?limit=3 returned HTTP 403 (Server: snooserv); probe to /r/Huawei/new/.rss returned HTTP 429; https://www.reddit.com/robots.txt returned HTTP 200 with "User-agent: * Disallow: /".',
    recommendedP1_1Action:
      'Provision official Reddit Data API OAuth2 credentials (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET) in Cloud Run Secret Manager before enabling read-only OAuth2 ingestion in VOC P1.1.',
  },
  {
    id: 'voc-src-public-gr-reviews',
    name: 'Public.gr Product Customer Reviews',
    sourceCategory: 'GREEK_RETAILER_REVIEWS',
    targetManufacturers: ['Huawei', 'Apple', 'Samsung', 'Xiaomi'],
    officialUrl: 'https://www.public.gr/',
    auditedEndpointUrl: 'https://www.public.gr/robots.txt',
    robotsTxtUrl: 'https://www.public.gr/robots.txt',
    feasibilityStatus: 'NOT_SUPPORTED',
    contentAvailability:
      'Automated server requests from Cloud Run / datacenter IPs are blocked at the CDN edge with HTTP 403 Access Denied (Server: AkamaiGHost). No public customer review REST API is exposed.',
    permittedAccessMethod: 'WAF_PROTECTED_HTML',
    authenticationRequired: false,
    authenticationDetails: 'No public API or partner review syndication endpoint available.',
    rateLimits: 'Blocked at edge (HTTP 403 Akamai Bot Manager).',
    termsOfServiceRestrictions:
      'Public.gr Terms of Use prohibit unauthorized automated scraping or circumvention of Akamai security controls.',
    robotsTxtStatus: {
      httpStatus: 403,
      targetPathAllowed: false,
      disallowedPathsSample: ['[HTTP 403 AkamaiGHost on /robots.txt]'],
      summary: 'AkamaiGHost returns HTTP 403 Access Denied even on /robots.txt from cloud datacenter IPs.',
    },
    antiBotProtection: {
      detected: true,
      provider: 'AkamaiGHost WAF / Bot Manager',
      details: 'Immediate HTTP 403 Access Denied (Reference #18.45690317.1793197066.168edbea) on automated server requests.',
    },
    availableDataFields: [],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes:
      'Reviews are attached to SKU pages, but collection is blocked by Akamai WAF and cannot be accessed without violating anti-bot governance rules.',
    publicationTimestampsAvailable: false,
    technicallyFeasible: false,
    legallyFeasible: false,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:17:46.000Z',
    lastHttpStatus: 403,
    verificationEvidence:
      'Live probe to https://www.public.gr/robots.txt returned HTTP 403 Access Denied (Server: AkamaiGHost, 381 bytes). Per Signalyn governance rules, WAF/anti-bot bypass is strictly prohibited.',
    recommendedP1_1Action:
      'Keep disabled. Do not attempt headless browser or proxy evasion against AkamaiGHost.',
  },
  {
    id: 'voc-src-kotsovolos-gr-reviews',
    name: 'Kotsovolos.gr Product Customer Reviews',
    sourceCategory: 'GREEK_RETAILER_REVIEWS',
    targetManufacturers: ['Huawei', 'Apple', 'Samsung', 'Xiaomi'],
    officialUrl: 'https://www.kotsovolos.gr/',
    auditedEndpointUrl: 'https://www.kotsovolos.gr/robots.txt',
    robotsTxtUrl: 'https://www.kotsovolos.gr/robots.txt',
    feasibilityStatus: 'NOT_SUPPORTED',
    contentAvailability:
      'Automated server requests from Cloud Run / datacenter IPs are blocked at the CDN edge with HTTP 403 Access Denied (Server: AkamaiGHost).',
    permittedAccessMethod: 'WAF_PROTECTED_HTML',
    authenticationRequired: false,
    authenticationDetails: 'No public API or authorized review feed available.',
    rateLimits: 'Blocked at edge (HTTP 403 Akamai Bot Manager).',
    termsOfServiceRestrictions:
      'Kotsovolos Terms of Use prohibit automated data extraction and circumvention of edge protection.',
    robotsTxtStatus: {
      httpStatus: 403,
      targetPathAllowed: false,
      disallowedPathsSample: ['[HTTP 403 AkamaiGHost on /robots.txt]'],
      summary: 'AkamaiGHost returns HTTP 403 Access Denied on /robots.txt from cloud datacenter IPs.',
    },
    antiBotProtection: {
      detected: true,
      provider: 'AkamaiGHost WAF / Bot Manager',
      details: 'Immediate HTTP 403 Access Denied (Reference #18.91741302.1793197066.3366) on automated server requests.',
    },
    availableDataFields: [],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes: 'SKU-linked on retail storefront, but inaccessible due to Akamai WAF.',
    publicationTimestampsAvailable: false,
    technicallyFeasible: false,
    legallyFeasible: false,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:17:46.000Z',
    lastHttpStatus: 403,
    verificationEvidence:
      'Live probe to https://www.kotsovolos.gr/robots.txt returned HTTP 403 Access Denied (Server: AkamaiGHost, 385 bytes).',
    recommendedP1_1Action:
      'Keep disabled. Do not bypass Akamai WAF protection.',
  },
  {
    id: 'voc-src-plaisio-gr-reviews',
    name: 'Plaisio.gr Product Customer Reviews',
    sourceCategory: 'GREEK_RETAILER_REVIEWS',
    targetManufacturers: ['Huawei', 'Apple', 'Samsung', 'Xiaomi'],
    officialUrl: 'https://www.plaisio.gr/',
    auditedEndpointUrl: 'https://www.plaisio.gr/robots.txt',
    robotsTxtUrl: 'https://www.plaisio.gr/robots.txt',
    feasibilityStatus: 'NOT_SUPPORTED',
    contentAvailability:
      'Automated server requests from Cloud Run / datacenter IPs are blocked at the CDN edge with HTTP 403 Access Denied (Server: AkamaiGHost).',
    permittedAccessMethod: 'WAF_PROTECTED_HTML',
    authenticationRequired: false,
    authenticationDetails: 'No public review syndication API available.',
    rateLimits: 'Blocked at edge (HTTP 403 Akamai Bot Manager).',
    termsOfServiceRestrictions:
      'Plaisio Terms of Use prohibit automated scraping and anti-bot circumvention.',
    robotsTxtStatus: {
      httpStatus: 403,
      targetPathAllowed: false,
      disallowedPathsSample: ['[HTTP 403 AkamaiGHost on /robots.txt]'],
      summary: 'AkamaiGHost returns HTTP 403 Access Denied on /robots.txt from cloud datacenter IPs.',
    },
    antiBotProtection: {
      detected: true,
      provider: 'AkamaiGHost WAF / Bot Manager',
      details: 'Immediate HTTP 403 Access Denied (Reference #18.5c690317.1793197066.18f98fa) on automated server requests.',
    },
    availableDataFields: [],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes: 'SKU-linked on retail storefront, but inaccessible due to Akamai WAF.',
    publicationTimestampsAvailable: false,
    technicallyFeasible: false,
    legallyFeasible: false,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:17:46.000Z',
    lastHttpStatus: 403,
    verificationEvidence:
      'Live probe to https://www.plaisio.gr/robots.txt returned HTTP 403 Access Denied (Server: AkamaiGHost, 382 bytes).',
    recommendedP1_1Action:
      'Keep disabled unless commercial Bazaarvoice/syndication feed credentials are provided.',
  },
  {
    id: 'voc-src-google-play-reviews',
    name: 'Google Play Store Application Reviews',
    sourceCategory: 'APP_STORE_REVIEWS',
    targetManufacturers: ['Huawei', 'Samsung', 'Apple', 'Xiaomi'],
    officialUrl: 'https://play.google.com/store/apps',
    auditedEndpointUrl: 'https://play.google.com/store/apps/details?id=com.huawei.health&hl=en&gl=GR',
    robotsTxtUrl: 'https://play.google.com/robots.txt',
    feasibilityStatus: 'REQUIRES_AUTHORIZATION',
    contentAvailability:
      '1) Core Huawei companion apps (com.huawei.health, com.huawei.smarthome, com.petalmaps.app, com.huawei.appmarket, com.huawei.phoneservice) return HTTP 404 Not Found on Google Play because Huawei distributes them via Huawei AppGallery. 2) Official Google Play Developer Reviews API (androidpublisher v3) requires first-party Play Console OAuth2 Service Account credentials and only grants access to apps owned by that developer account.',
    permittedAccessMethod: 'FIRST_PARTY_DEVELOPER_API',
    authenticationRequired: true,
    authenticationDetails:
      'Official Google Play Developer API (https://www.googleapis.com/androidpublisher/v3/applications/{packageName}/reviews) requires OAuth2 Service Account linked to the publisher Google Play Console.',
    rateLimits: '200,000 queries per day per Play Console Developer project.',
    termsOfServiceRestrictions:
      'Google Play Terms of Service Section 3 prohibits automated scraping of Play Store web UI or undocumented batchexecute RPCs.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: true,
      disallowedPathsSample: ['/store/purchase', '/store/apps/datasafety*', '/work/'],
      summary: 'robots.txt (3,199 bytes) allows public store detail pages, but Huawei core companion apps return HTTP 404 on Play Store.',
    },
    antiBotProtection: {
      detected: false,
      provider: 'Google ESF',
      details: 'Public store pages respond via ESF, but review pagination uses internal PlayStoreUi batchexecute RPCs not licensed for third-party scraping.',
    },
    availableDataFields: [
      'Review ID (via Official Publisher API)',
      'Star Rating (1-5)',
      'Review Text',
      'Last Modified Timestamp',
      'Device Metadata & App Version Code (Publisher API only)',
    ],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes:
      'Official Publisher API provides device code/model metadata, but only for first-party published apps actually listed on Google Play.',
    publicationTimestampsAvailable: true,
    technicallyFeasible: false,
    legallyFeasible: false,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:19:22.000Z',
    lastHttpStatus: 404,
    verificationEvidence:
      'Live probes to play.google.com for com.huawei.health, com.huawei.smarthome, com.petalmaps.app, com.huawei.appmarket, and com.huawei.phoneservice all returned HTTP 404 Not Found (1,673 bytes, Server: ESF), whereas com.whatsapp returned HTTP 200.',
    recommendedP1_1Action:
      'Do not scrape Play Store web UI. Only enable if first-party Google Play Console OAuth2 credentials are provided for an active Play Store package.',
  },
  {
    id: 'voc-src-gsmarena-user-opinions',
    name: 'GSMArena Device User Opinions & Reviews',
    sourceCategory: 'CONSUMER_REVIEW_PLATFORM',
    targetManufacturers: ['Huawei', 'Samsung', 'Apple', 'Xiaomi', 'Honor'],
    officialUrl: 'https://www.gsmarena.com/',
    auditedEndpointUrl: 'https://www.gsmarena.com/huawei_pura_70_ultra-reviews-12944.php',
    robotsTxtUrl: 'https://www.gsmarena.com/robots.txt',
    feasibilityStatus: 'NOT_SUPPORTED',
    contentAvailability:
      'Device review pages return an interactive Cloudflare Turnstile anti-bot challenge (<title>GSMArena Turnstile check</title>, challenges.cloudflare.com/turnstile/v0/api.js) with <meta name="robots" content="noindex,nofollow">.',
    permittedAccessMethod: 'CAPTCHA_GATED_HTML',
    authenticationRequired: false,
    authenticationDetails: 'No public API; gated by interactive Cloudflare Turnstile CAPTCHA.',
    rateLimits: 'Cloudflare Turnstile challenge enforced on review pages.',
    termsOfServiceRestrictions:
      'GSMArena Terms of Use and meta noindex,nofollow prohibit automated harvesting of user opinion pages.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: false,
      disallowedPathsSample: ['/postopinion.php3', '/postcomment.php3', '/forum/', '/forums/'],
      summary: 'robots.txt (1,851 bytes) disallows forum/comment scripts and review pages inject <meta name="robots" content="noindex,nofollow">.',
    },
    antiBotProtection: {
      detected: true,
      provider: 'Cloudflare Turnstile',
      details: 'Serves 7,907-byte Turnstile CAPTCHA verification wrapper instead of user reviews.',
    },
    availableDataFields: [],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes: 'Pages are per-device, but blocked by Cloudflare Turnstile challenge.',
    publicationTimestampsAvailable: false,
    technicallyFeasible: false,
    legallyFeasible: false,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:18:30.000Z',
    lastHttpStatus: 200,
    verificationEvidence:
      'Live probe to https://www.gsmarena.com/huawei_pura_70_ultra-reviews-12944.php returned HTTP 200 containing "<title>GSMArena Turnstile check</title>" and script "https://challenges.cloudflare.com/turnstile/v0/api.js".',
    recommendedP1_1Action:
      'Strictly excluded. Never bypass Cloudflare Turnstile CAPTCHA.',
  },
  {
    id: 'voc-src-trustpilot-reviews',
    name: 'Trustpilot Consumer Reviews',
    sourceCategory: 'CONSUMER_REVIEW_PLATFORM',
    targetManufacturers: ['Huawei', 'Samsung', 'Apple', 'Xiaomi'],
    officialUrl: 'https://www.trustpilot.com/',
    auditedEndpointUrl: 'https://www.trustpilot.com/robots.txt',
    robotsTxtUrl: 'https://www.trustpilot.com/robots.txt',
    feasibilityStatus: 'REQUIRES_AUTHORIZATION',
    contentAvailability:
      'Trustpilot robots.txt (25,101 bytes) explicitly disallows automated crawling of /reviews/, /product-reviews/, /api/*, and filter query parameters. Authorized access requires a commercial Trustpilot API key.',
    permittedAccessMethod: 'OAUTH2_API',
    authenticationRequired: true,
    authenticationDetails: 'Requires Trustpilot Business / Partner API key and OAuth2 token (https://api.trustpilot.com/v1/).',
    rateLimits: 'Governed by commercial Trustpilot API tier.',
    termsOfServiceRestrictions:
      'Trustpilot Terms of Use strictly prohibit scraping consumer reviews without an active API license.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: false,
      disallowedPathsSample: ['/reviews/', '/product-reviews/', '/api/*', '/*?*languages=', '/*?*stars='],
      summary: 'Explicitly disallows /reviews/, /product-reviews/, /api/*, and filtered review queries.',
    },
    antiBotProtection: {
      detected: true,
      provider: 'Trustpilot API & Crawl Policy Enforcement',
      details: 'Disallowed in robots.txt for all bots; API requires commercial key.',
    },
    availableDataFields: [
      'Review ID (via API)',
      'Star Rating',
      'Review Title & Excerpt',
      'Created Timestamp',
    ],
    productModelIdentificationPossible: false,
    productModelIdentificationNotes:
      'Trustpilot business profiles aggregate brand-level store/support reviews rather than structured hardware model SKUs.',
    publicationTimestampsAvailable: true,
    technicallyFeasible: false,
    legallyFeasible: false,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:18:30.000Z',
    lastHttpStatus: 200,
    verificationEvidence:
      'Live probe to https://www.trustpilot.com/robots.txt returned HTTP 200 (25,101 bytes) confirming explicit Disallow rules on /reviews/, /product-reviews/, and /api/*.',
    recommendedP1_1Action:
      'Do not scrape Trustpilot HTML. Require commercial API key if brand-level support reviews are desired in future phases.',
  },
  {
    id: 'voc-src-github-hms-issues',
    name: 'GitHub Public Issue Tracker (HMS Core & Huawei Device Ecosystem)',
    sourceCategory: 'DEVELOPER_ISSUE_TRACKER',
    targetManufacturers: ['Huawei'],
    officialUrl: 'https://github.com/HMS-Core',
    auditedEndpointUrl: 'https://api.github.com/search/issues?q=Huawei+battery+OR+update+in:title,body&per_page=3',
    robotsTxtUrl: 'https://github.com/robots.txt',
    feasibilityStatus: 'VERIFIED_ACCESSIBLE',
    contentAvailability:
      'Official GitHub REST API v3 (https://api.github.com/search/issues) returns structured JSON (HTTP 200, application/vnd.github+json) with public bug reports, firmware/SDK compatibility issues, device model strings, and ISO 8601 timestamps.',
    permittedAccessMethod: 'PUBLIC_REST_API',
    authenticationRequired: false,
    authenticationDetails:
      'Public unauthenticated access supported (10 search requests/min); optional GITHUB_TOKEN increases rate limit to 30 search requests/min and 5,000 core requests/hr.',
    rateLimits: '10 requests/min unauthenticated (X-RateLimit-Remaining header verified); 30 requests/min with token.',
    termsOfServiceRestrictions:
      'GitHub Terms of Service Section D.7 expressly permits public archival and analysis of public repositories and issue trackers via the official GitHub API.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: true,
      disallowedPathsSample: [],
      summary: 'Official api.github.com REST endpoint is explicitly designed and documented for programmatic consumption.',
    },
    antiBotProtection: {
      detected: false,
      details: 'Official REST API with standard X-RateLimit-* headers; no CAPTCHA or WAF blocks.',
    },
    availableDataFields: [
      'Issue ID & Number',
      'HTML URL',
      'Created At & Updated At (ISO 8601)',
      'Title & Body Excerpt',
      'Labels & State',
      'Repository Name',
    ],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes:
      'Issue templates and bug reports frequently state exact Huawei device models, HarmonyOS/EMUI versions, and HMS Core SDK versions.',
    publicationTimestampsAvailable: true,
    technicallyFeasible: true,
    legallyFeasible: true,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:19:53.000Z',
    lastHttpStatus: 200,
    verificationEvidence:
      'Live probe to https://api.github.com/search/issues?q=Huawei+battery+OR+update+in:title,body&per_page=3 returned HTTP 200 (Content-Type: application/vnd.github+json, X-RateLimit-Remaining: 9).',
    recommendedP1_1Action:
      'Approve for controlled, rate-limited P1.1 ingestion focused on APP_COMPATIBILITY, FIRMWARE_UPDATE_PROBLEMS, and SOFTWARE_BUGS.',
  },
  {
    id: 'voc-src-hn-algolia-api',
    name: 'Hacker News Algolia Public Discussion API',
    sourceCategory: 'PUBLIC_FORUM',
    targetManufacturers: ['Huawei', 'Apple', 'Samsung', 'Xiaomi'],
    officialUrl: 'https://hn.algolia.com/api',
    auditedEndpointUrl: 'https://hn.algolia.com/api/v1/search_by_date?query=Huawei&tags=comment&hitsPerPage=3',
    robotsTxtUrl: 'https://news.ycombinator.com/robots.txt',
    feasibilityStatus: 'VERIFIED_ACCESSIBLE',
    contentAvailability:
      'Official public Algolia REST Search API returning structured JSON (HTTP 200, application/json) with public technical discussions, user hardware/software experience comments, timestamps, and canonical item URLs.',
    permittedAccessMethod: 'PUBLIC_REST_API',
    authenticationRequired: false,
    authenticationDetails: 'Publicly documented REST API requiring no API key or user login.',
    rateLimits: '10,000 requests per hour per IP address.',
    termsOfServiceRestrictions:
      'Y Combinator / Algolia public API provided specifically for programmatic search and research over public HN items.',
    robotsTxtStatus: {
      httpStatus: 200,
      targetPathAllowed: true,
      disallowedPathsSample: [],
      summary: 'Dedicated public REST API endpoint (hn.algolia.com/api/v1).',
    },
    antiBotProtection: {
      detected: false,
      details: 'Open CORS-enabled JSON API returning HTTP 200.',
    },
    availableDataFields: [
      'Object ID (Item ID)',
      'Story Title & URL',
      'Comment Text (HTML/Plain)',
      'Created At (ISO 8601 & Unix Timestamp)',
      'Points / Comment Count',
    ],
    productModelIdentificationPossible: true,
    productModelIdentificationNotes:
      'Model identification is possible when comments explicitly name a hardware model (e.g., MateBook X Pro, Pura 70, iPhone 16 Pro); generic brand discussions are filtered out as UNMATCHED by the conservative product matcher.',
    publicationTimestampsAvailable: true,
    technicallyFeasible: true,
    legallyFeasible: true,
    collectionEnabledInP1_0: false,
    lastVerifiedAt: '2026-10-28T07:19:53.000Z',
    lastHttpStatus: 200,
    verificationEvidence:
      'Live probe to https://hn.algolia.com/api/v1/search_by_date?query=Huawei&tags=comment&hitsPerPage=3 returned HTTP 200 (Content-Type: application/json).',
    recommendedP1_1Action:
      'Approve as supplemental public discussion source in P1.1 subject to strict VERIFIED_MODEL / LIKELY_MODEL filtering so general corporate news discussions are excluded.',
  },
];

export interface LiveSourceProbeResult {
  sourceId: string;
  name: string;
  auditedEndpointUrl: string;
  probedAt: string;
  httpStatus: number;
  responseTimeMs: number;
  serverHeader: string | null;
  contentType: string | null;
  feasibilityStatus: VocSourceFeasibilityStatus;
  evidenceSummary: string;
}

/**
 * Returns a deep clone of the authoritative VOC source registry.
 */
export function getAuthoritativeVocSources(): VocSource[] {
  return AUTHORITATIVE_VOC_SOURCES.map((s) => ({
    ...s,
    targetManufacturers: [...s.targetManufacturers],
    availableDataFields: [...s.availableDataFields],
    robotsTxtStatus: {
      ...s.robotsTxtStatus,
      disallowedPathsSample: [...s.robotsTxtStatus.disallowedPathsSample],
    },
    antiBotProtection: { ...s.antiBotProtection },
  }));
}

/**
 * Executes a non-invasive live HTTP status verification against the audited endpoints
 * without ever bypassing CAPTCHA, login walls, or anti-bot WAFs.
 */
export async function runVocSourceFeasibilityAudit(options?: {
  liveProbe?: boolean;
  timeoutMs?: number;
}): Promise<{
  auditVersion: string;
  auditedAt: string;
  liveProbeExecuted: boolean;
  summary: {
    totalSources: number;
    verifiedAccessible: number;
    accessibleWithRestrictions: number;
    requiresAuthorization: number;
    notSupported: number;
    notYetVerified: number;
  };
  sources: VocSource[];
  liveProbes?: LiveSourceProbeResult[];
}> {
  const sources = getAuthoritativeVocSources();
  const liveProbes: LiveSourceProbeResult[] = [];
  const timeoutMs = options?.timeoutMs ?? 5000;

  if (options?.liveProbe) {
    for (const src of sources) {
      const start = Date.now();
      try {
        const res = await fetch(src.auditedEndpointUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Signalyn-VOC-Feasibility-Auditor/1.0 (+https://hw-signalyn.ai.studio)',
            Accept: 'application/json,text/plain,text/html,*/*',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const elapsed = Date.now() - start;
        const nowIso = new Date().toISOString();
        src.lastHttpStatus = res.status;
        src.lastVerifiedAt = nowIso;

        liveProbes.push({
          sourceId: src.id,
          name: src.name,
          auditedEndpointUrl: src.auditedEndpointUrl,
          probedAt: nowIso,
          httpStatus: res.status,
          responseTimeMs: elapsed,
          serverHeader: res.headers.get('server'),
          contentType: res.headers.get('content-type'),
          feasibilityStatus: src.feasibilityStatus,
          evidenceSummary: `HTTP ${res.status} (${res.headers.get('server') || 'edge'}) in ${elapsed}ms — ${src.verificationEvidence}`,
        });
      } catch (err: unknown) {
        const elapsed = Date.now() - start;
        const nowIso = new Date().toISOString();
        const msg = err instanceof Error ? err.message : 'Network timeout or connection error';
        liveProbes.push({
          sourceId: src.id,
          name: src.name,
          auditedEndpointUrl: src.auditedEndpointUrl,
          probedAt: nowIso,
          httpStatus: src.lastHttpStatus,
          responseTimeMs: elapsed,
          serverHeader: null,
          contentType: null,
          feasibilityStatus: src.feasibilityStatus,
          evidenceSummary: `Probe notice (${msg}) — Retaining verified baseline: ${src.verificationEvidence}`,
        });
      }
    }
  }

  const summary = {
    totalSources: sources.length,
    verifiedAccessible: sources.filter((s) => s.feasibilityStatus === 'VERIFIED_ACCESSIBLE').length,
    accessibleWithRestrictions: sources.filter((s) => s.feasibilityStatus === 'ACCESSIBLE_WITH_RESTRICTIONS').length,
    requiresAuthorization: sources.filter((s) => s.feasibilityStatus === 'REQUIRES_AUTHORIZATION').length,
    notSupported: sources.filter((s) => s.feasibilityStatus === 'NOT_SUPPORTED').length,
    notYetVerified: sources.filter((s) => s.feasibilityStatus === 'NOT_YET_VERIFIED').length,
  };

  return {
    auditVersion: VOC_SOURCE_AUDIT_VERSION,
    auditedAt: new Date().toISOString(),
    liveProbeExecuted: Boolean(options?.liveProbe),
    summary,
    sources,
    ...(options?.liveProbe ? { liveProbes } : {}),
  };
}

/**
 * Signalyn Retail Sources Management & Connectivity Architecture (P0.8)
 * 
 * Standalone test suite for:
 * 1. SSRF & URL Syntax Guards
 * 2. Configuration Management & State Persistence
 * 3. Bounded Read-Only Connectivity Diagnostics
 */

import {
  validateRetailSourceUrl,
  createDefaultCategoryEndpoints,
  DEFAULT_CATEGORY_URLS,
  RETAILER_DOMAIN_METADATA,
} from '../src/server/retail/retailSourceDefaults';
import {
  getRetailSourceConfigs,
  getRetailSourceConfig,
  updateRetailSourceConfig,
  resetRetailSourceDefaults,
  testRetailSourceConnection,
} from '../src/server/retail/retailSourceService';
import { RetailSourceId } from '../src/types/retailPrice';

async function runRetailSourcesManagementTests() {
  console.log('=== RUNNING SIGNALYN RETAIL SOURCES MANAGEMENT (P0.8) TESTS ===\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, detail: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${title}: ${detail}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${title}: ${detail}`);
      failed++;
    }
  }

  // Reset defaults
  await resetRetailSourceDefaults('plaisio-gr');
  await resetRetailSourceDefaults('public-gr');
  await resetRetailSourceDefaults('kotsovolos-gr');

  // --- 1. SSRF & URL Validation ---
  console.log('\n--- 1. SSRF & URL Syntax Validation ---');

  // 1a. Valid HTTPS URL matching domain
  const plaisioWearables = 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/wearables';
  const res1a = validateRetailSourceUrl('plaisio-gr', plaisioWearables);
  assert('Valid HTTPS URL', res1a.valid === true && !res1a.error, 'Plaisio wearables endpoint approved');

  // 1b. Insecure HTTP rejected
  const insecureUrl = 'http://www.plaisio.gr/list/wearables';
  const res1b = validateRetailSourceUrl('plaisio-gr', insecureUrl);
  assert('Insecure HTTP Rejected', res1b.valid === false && Boolean(res1b.error?.includes('secure HTTPS')), 'HTTP rejected');

  // 1c. Embedded credentials rejected
  const credUrl = 'https://admin:secret@www.plaisio.gr/list/wearables';
  const res1c = validateRetailSourceUrl('plaisio-gr', credUrl);
  assert('Embedded Credentials Rejected', res1c.valid === false && Boolean(res1c.error?.includes('Embedded username')), 'Credentials rejected');

  // 1d. Custom ports rejected
  const portUrl = 'https://www.plaisio.gr:8443/list/wearables';
  const res1d = validateRetailSourceUrl('plaisio-gr', portUrl);
  assert('Non-standard Port Rejected', res1d.valid === false && Boolean(res1d.error?.includes('Non-standard port')), 'Custom port 8443 rejected');

  // 1e. IP literals and metadata targets rejected
  const targets = [
    'https://127.0.0.1/list/wearables',
    'https://169.254.169.254/computeMetadata/v1/',
    'https://localhost/list/wearables',
    'https://192.168.1.1/admin',
  ];
  let allIpsBlocked = true;
  for (const t of targets) {
    const r = validateRetailSourceUrl('plaisio-gr', t);
    if (r.valid) allIpsBlocked = false;
  }
  assert('SSRF IP Literals & Metadata Blocked', allIpsBlocked, 'All private IPs and metadata targets blocked');

  // 1f. Open redirect wrappers rejected
  const redirectUrl = 'https://www.google.com/url?q=https://www.plaisio.gr/wearables';
  const res1f = validateRetailSourceUrl('plaisio-gr', redirectUrl);
  assert('Redirect Wrappers Rejected', res1f.valid === false && Boolean(res1f.error?.includes('Redirect wrappers')), 'google.com/url wrapper rejected');

  // 1g. Domain mismatches rejected
  const publicOnPlaisio = 'https://www.public.gr/cat/tilefonia/kinita-smartphones';
  const res1g = validateRetailSourceUrl('plaisio-gr', publicOnPlaisio);
  assert('Domain Mismatch Rejected', res1g.valid === false && Boolean(res1g.error?.includes('Domain mismatch')), 'Public URL rejected for Plaisio');

  // 1h. Verified default category URLs for all retailers
  const retailers: RetailSourceId[] = ['plaisio-gr', 'public-gr', 'kotsovolos-gr'];
  let allDefaultsValid = true;
  for (const rId of retailers) {
    const defaults = DEFAULT_CATEGORY_URLS[rId];
    for (const url of Object.values(defaults)) {
      const check = validateRetailSourceUrl(rId, url);
      if (!check.valid) allDefaultsValid = false;
    }
  }
  assert('All Default Category URLs Valid', allDefaultsValid, 'Verified endpoints for all 3 retailers pass validation');

  // --- 2. Retailer Configuration & Persistence ---
  console.log('\n--- 2. Retailer Configuration & State Persistence ---');

  // 2a. Retrieve all 3 retailers
  const configs = await getRetailSourceConfigs();
  assert('Retrieve Retailer Configs', configs.length === 3, 'Found 3 retailer configs');
  const plaisio = configs.find((c) => c.id === 'plaisio-gr');
  assert('Plaisio Default Config', Boolean(plaisio?.enabled && plaisio?.domain === 'plaisio.gr'), 'Plaisio domain & enabled status verified');

  // 2b. Update retailer configuration
  const updated = await updateRetailSourceConfig('plaisio-gr', {
    enabled: false,
    requestDelaySeconds: 5,
    timeoutSeconds: 15,
    customNotes: 'Temporarily paused for Linkwise affiliate test.',
  });
  assert('Update Configuration', updated.enabled === false && updated.requestDelaySeconds === 5, 'Enabled toggled to false and delay set to 5s');

  const retrieved = await getRetailSourceConfig('plaisio-gr');
  assert('Verify Persistence in State', retrieved?.enabled === false && retrieved?.timeoutSeconds === 15, 'Updated state retrieved correctly');

  // 2c. Update valid category URL
  const newSmartphonesUrl = 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/tilefona/smartphones?brand=HUAWEI';
  const updatedCat = await updateRetailSourceConfig('plaisio-gr', {
    categoryEndpoints: {
      ...createDefaultCategoryEndpoints('plaisio-gr'),
      SMARTPHONES: {
        category: 'SMARTPHONES',
        enabled: true,
        url: newSmartphonesUrl,
        defaultUrl: DEFAULT_CATEGORY_URLS['plaisio-gr'].SMARTPHONES,
        status: 'UNTESTED',
      },
    },
  });
  assert('Update Category URL', updatedCat.categoryEndpoints?.SMARTPHONES.url === newSmartphonesUrl, 'Smartphones category URL updated');

  // 2d. Reset retailer defaults
  const reset = await resetRetailSourceDefaults('plaisio-gr');
  assert('Reset Retailer Defaults', reset.enabled === true && reset.requestDelaySeconds === RETAILER_DOMAIN_METADATA['plaisio-gr'].defaultDelaySeconds, 'Defaults restored');

  // --- 3. Bounded Read-Only Connectivity Diagnostics ---
  console.log('\n--- 3. Bounded Read-Only Connectivity Diagnostics ---');

  // 3a. Fails fast on invalid URL
  const res3a = await testRetailSourceConnection('plaisio-gr', {
    customUrl: 'http://invalid-url.com',
  });
  assert('Fast Fail on Invalid URL', res3a.diagnostic.accessStatus === 'INVALID_URL' && res3a.diagnostic.httpStatus === 0, 'Invalid URL caught before fetch');

  // 3b. Diagnostic execution with mocked 200 response
  const originalFetch = global.fetch;
  global.fetch = async () => {
    return new Response(
      '<!doctype html><html><head><title>Plaisio Wearables</title></head><body><div id="StructuredDataItemListB2C">{"itemListElement":[{"item":{"sku":"4612984","name":"HUAWEI Watch GT 5 Pro","price":37900}}]}</div></body></html>',
      {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'server': 'AkamaiGHost',
          'x-akamai-transformed': '9 - 0 pmb=mRUM,1',
        },
      }
    );
  };

  try {
    const res3b = await testRetailSourceConnection('plaisio-gr', { category: 'WEARABLES' });
    assert(
      '200 OK Live Verified Diagnostic',
      res3b.diagnostic.httpStatus === 200 &&
        res3b.diagnostic.accessStatus === 'LIVE_VERIFIED' &&
        res3b.diagnostic.productsDetected === 1 &&
        res3b.diagnostic.serverHeaders['server'] === 'AkamaiGHost',
      'Diagnostic correctly verified HTTP 200, product detection, and Akamai server header'
    );
  } finally {
    global.fetch = originalFetch;
  }

  // 3c. Akamai HTTP 403 categorized as ACCESS_BLOCKED
  global.fetch = async () => {
    return new Response('<html><head><title>Access Denied</title></head><body>Access Denied</body></html>', {
      status: 403,
      headers: {
        'content-type': 'text/html',
        'server': 'AkamaiGHost',
        'x-akamai-request-id': '19a8.12345',
      },
    });
  };

  try {
    const res3c = await testRetailSourceConnection('plaisio-gr', { category: 'WEARABLES' });
    assert(
      'Akamai 403 Captured as ACCESS_BLOCKED',
      res3c.diagnostic.httpStatus === 403 &&
        res3c.diagnostic.accessStatus === 'ACCESS_BLOCKED' &&
        Boolean(res3c.diagnostic.diagnosticDetails?.includes('Perimeter Access Control')),
      'Truthful perimeter access blocked status without false error'
    );
  } finally {
    global.fetch = originalFetch;
  }

  // 3d. 404 Not Found categorized as INVALID_URL / INVALID_CATEGORY
  global.fetch = async () => {
    return new Response('<html><body>404 Not Found</body></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });
  };

  try {
    const res3d = await testRetailSourceConnection('plaisio-gr', { category: 'WEARABLES' });
    assert(
      'HTTP 404 Categorized as INVALID_URL & INVALID_CATEGORY',
      res3d.diagnostic.httpStatus === 404 &&
        res3d.diagnostic.accessStatus === 'INVALID_URL' &&
        res3d.diagnostic.validationStatus === 'INVALID_CATEGORY',
      '404 path not found correctly recorded'
    );
  } finally {
    global.fetch = originalFetch;
  }

  // --- 4. Signalyn P1.1: Category URL Corrections & Strict Validation Rules ---
  console.log('\n--- 4. Signalyn P1.1: Category URL Corrections & Strict Validation Rules ---');

  // 4a. Verify Plaisio URLs remain untouched
  assert(
    'Plaisio URLs Unchanged',
    DEFAULT_CATEGORY_URLS['plaisio-gr'].WEARABLES === 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/wearables' &&
      DEFAULT_CATEGORY_URLS['plaisio-gr'].SMARTPHONES === 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/tilefona/smartphones' &&
      DEFAULT_CATEGORY_URLS['plaisio-gr'].AUDIO === 'https://www.plaisio.gr/list/thleoraseis-ixos/ixos/akoustika' &&
      DEFAULT_CATEGORY_URLS['plaisio-gr'].TABLETS === 'https://www.plaisio.gr/list/tilefonia-tablet-wearables/tablet',
    'All 4 Plaisio category URLs preserved intact'
  );

  // 4b. Verify Public working URLs preserved and broken AUDIO/TABLETS corrected
  assert(
    'Public Category URLs Corrected (P1.1)',
    DEFAULT_CATEGORY_URLS['public-gr'].SMARTPHONES === 'https://www.public.gr/cat/tilefonia/kinita-smartphones' &&
      DEFAULT_CATEGORY_URLS['public-gr'].WEARABLES === 'https://www.public.gr/cat/tilefonia/wearables/smartwatches' &&
      DEFAULT_CATEGORY_URLS['public-gr'].AUDIO === 'https://www.public.gr/cat/ihos/akoustika/akoystika-kefalis' &&
      DEFAULT_CATEGORY_URLS['public-gr'].TABLETS === 'https://www.public.gr/cat/tablets/syskeyes-tablet',
    'Public AUDIO & TABLETS corrected; SMARTPHONES & WEARABLES preserved'
  );

  // 4c. Verify all 4 Kotsovolos category URLs corrected
  assert(
    'Kotsovolos Category URLs Corrected (P1.1)',
    DEFAULT_CATEGORY_URLS['kotsovolos-gr'].SMARTPHONES === 'https://www.kotsovolos.gr/mobile-phones-gps/mobile-phones/smartphones' &&
      DEFAULT_CATEGORY_URLS['kotsovolos-gr'].WEARABLES === 'https://www.kotsovolos.gr/mobile-phones-gps/wearables/smartwatches' &&
      DEFAULT_CATEGORY_URLS['kotsovolos-gr'].AUDIO === 'https://www.kotsovolos.gr/mobile-phones-gps/akoystika' &&
      DEFAULT_CATEGORY_URLS['kotsovolos-gr'].TABLETS === 'https://www.kotsovolos.gr/computing/laptop-tablet-ipad/tablets-ipad',
    'All 4 Kotsovolos category URLs updated to official navigation paths'
  );

  // 4d. HTTP 200 alone (generic HTML with 0 products) must NOT be marked VERIFIED / VALID_CATEGORY
  global.fetch = async () => {
    return new Response(
      '<!doctype html><html><head><title>Public.gr - Welcome</title></head><body><h1>Generic page without products</h1></body></html>',
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }
    );
  };

  try {
    const res4d = await testRetailSourceConnection('public-gr', { category: 'AUDIO' });
    assert(
      'Bare HTTP 200 Without Products Not Marked VERIFIED',
      res4d.diagnostic.httpStatus === 200 &&
        res4d.diagnostic.productsDetected === 0 &&
        res4d.diagnostic.validationStatus === 'UNVERIFIED' &&
        res4d.diagnostic.accessStatus !== 'LIVE_VERIFIED',
      `HTTP 200 with 0 products classified as ${res4d.diagnostic.validationStatus} (accessStatus=${res4d.diagnostic.accessStatus})`
    );
  } finally {
    global.fetch = originalFetch;
  }

  // 4e. Search-results URL rejected by validator
  const searchUrlCheck = validateRetailSourceUrl('kotsovolos-gr', 'https://www.kotsovolos.gr/search?q=smartphones');
  assert(
    'Search Results Page Rejected',
    searchUrlCheck.valid === false && Boolean(searchUrlCheck.error?.includes('Search-results')),
    'Search results URL rejected as category endpoint'
  );

  // 4f. HTTP 200 with products from wrong category marked INVALID_CATEGORY
  global.fetch = async () => {
    return new Response(
      '<!doctype html><html><head><title>Washing Machines</title></head><body><script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Product","sku":"WM100","name":"Bosch Serie 6 Πλυντήριο Ρούχων 9kg","offers":{"price":"549.00"}}]}</script></body></html>',
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }
    );
  };

  try {
    const res4f = await testRetailSourceConnection('kotsovolos-gr', { category: 'SMARTPHONES' });
    assert(
      'Unrelated Category Products Marked INVALID_CATEGORY',
      res4f.diagnostic.httpStatus === 200 &&
        res4f.diagnostic.productsDetected === 1 &&
        res4f.diagnostic.categoryMatchCount === 0 &&
        res4f.diagnostic.validationStatus === 'INVALID_CATEGORY',
      'Page with unrelated products marked INVALID_CATEGORY'
    );
  } finally {
    global.fetch = originalFetch;
  }

  // 4g. Manually configured VALID_CATEGORY URL cannot be overwritten without confirmation
  await resetRetailSourceDefaults('public-gr');
  const customValidAudioUrl = 'https://www.public.gr/cat/ihos/akoustika/bluetooth-handsfree';
  await updateRetailSourceConfig('public-gr', {
    categoryEndpoints: {
      ...createDefaultCategoryEndpoints('public-gr'),
      AUDIO: {
        category: 'AUDIO',
        enabled: true,
        url: customValidAudioUrl,
        defaultUrl: DEFAULT_CATEGORY_URLS['public-gr'].AUDIO,
        status: 'LIVE_VERIFIED',
        validationStatus: 'VALID_CATEGORY',
        isManuallyConfigured: true,
        productsDetected: 24,
        categoryMatchCount: 24,
      },
    },
  });

  let overwriteBlocked = false;
  try {
    await updateRetailSourceConfig('public-gr', {
      categoryEndpoints: {
        ...createDefaultCategoryEndpoints('public-gr'),
        AUDIO: {
          category: 'AUDIO',
          enabled: true,
          url: 'https://www.public.gr/cat/ihos/akoustika/earbuds',
          defaultUrl: DEFAULT_CATEGORY_URLS['public-gr'].AUDIO,
          status: 'UNVERIFIED',
        },
      },
    });
  } catch (err: any) {
    if (err.message?.includes('Confirmation required before overwriting manually configured valid URL')) {
      overwriteBlocked = true;
    }
  }
  assert(
    'Manual Valid URL Overwrite Guard',
    overwriteBlocked === true,
    'Overwriting manually configured VALID_CATEGORY URL blocked without confirmation'
  );

  // Restore clean defaults at end of test suite
  await resetRetailSourceDefaults('plaisio-gr');
  await resetRetailSourceDefaults('public-gr');
  await resetRetailSourceDefaults('kotsovolos-gr');

  console.log(`\n======================================================`);
  console.log(`RETAIL SOURCES MANAGEMENT TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runRetailSourcesManagementTests().catch((err) => {
  console.error('Fatal error running retail sources tests:', err);
  process.exit(1);
});

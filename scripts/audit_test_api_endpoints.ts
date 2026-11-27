async function testEndpoints() {
  const baseUrl = 'http://localhost:3000';
  const endpoints = [
    { name: 'Health Check', url: `${baseUrl}/api/health`, method: 'GET' },
    { name: 'Collector Status', url: `${baseUrl}/api/collector/status`, method: 'GET' },
    { name: 'Analysis Status', url: `${baseUrl}/api/analysis/status`, method: 'GET' },
    { name: 'Backfill Status', url: `${baseUrl}/api/backfill/status`, method: 'GET' },
    { name: 'Historical 30d', url: `${baseUrl}/api/analytics/historical?preset=30d`, method: 'GET' },
    { name: 'Historical All Preset', url: `${baseUrl}/api/analytics/historical?preset=all`, method: 'GET' },
    { name: 'Auth Handshake', url: `${baseUrl}/api/auth/handshake`, method: 'POST' },
  ];

  console.log('=== TESTING SERVER API ENDPOINTS (READ-ONLY) ===\n');

  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
      });
      const durationMs = Date.now() - start;
      const data = await res.json();
      console.log(`[${ep.name}] HTTP ${res.status} (${durationMs}ms):`);
      if (ep.name === 'Health Check') {
        console.log(`  status: ${data.status}, geminiConfigured: ${data.geminiConfigured}`);
      } else if (ep.name === 'Collector Status') {
        console.log(`  isRunning: ${data.isRunning}, lastRun: ${data.lastRun?.status}, lastSuccessfulGlobal: ${data.lastSuccessfulGlobalCollection}`);
      } else if (ep.name === 'Analysis Status') {
        console.log(`  configured: ${data.configured}, model: ${data.model}`);
      } else if (ep.name === 'Historical 30d') {
        console.log(`  totalArticles: ${data.metrics?.totalArticlesAnalyzed}, days: ${data.period?.availableBucketDays}`);
      } else if (ep.name === 'Historical All Preset') {
        console.log(`  totalArticles: ${data.metrics?.totalArticlesAnalyzed}, days: ${data.period?.availableBucketDays}`);
      } else if (ep.name === 'Auth Handshake') {
        console.log(`  token received: ${Boolean(data.token)}, expiresAt: ${data.expiresAt}`);
      } else {
        console.log(`  data keys:`, Object.keys(data));
      }
    } catch (err: any) {
      console.log(`[${ep.name}] FAILED (${err.message})`);
    }
  }

  process.exit(0);
}

testEndpoints();

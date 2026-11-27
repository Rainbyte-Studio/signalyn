async function testSecurityGuards() {
  console.log('=== TESTING SECURITY GUARDS (MUTATION PROTECTION) ===\n');

  // Test 1: POST /api/analysis/article without token
  const res1 = await fetch('http://localhost:3000/api/analysis/article/art-test-123', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceReanalyze: false }),
  });
  console.log(`[POST /api/analysis/article without token] Status: ${res1.status}`);
  const data1 = await res1.json();
  console.log(`  Response:`, data1.error);

  // Test 2: POST /api/analysis/batch without token
  const res2 = await fetch('http://localhost:3000/api/analysis/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleIds: ['art-test'] }),
  });
  console.log(`[POST /api/analysis/batch without token] Status: ${res2.status}`);
  const data2 = await res2.json();
  console.log(`  Response:`, data2.error);

  // Test 3: POST /api/backfill/start without token
  const res3 = await fetch('http://localhost:3000/api/backfill/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  console.log(`[POST /api/backfill/start without token] Status: ${res3.status}`);
  const data3 = await res3.json();
  console.log(`  Response:`, data3.error);

  process.exit(0);
}

testSecurityGuards();

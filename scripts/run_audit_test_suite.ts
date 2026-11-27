import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface TestResult {
  file: string;
  passed: boolean;
  durationMs: number;
  output: string;
  error?: string;
}

async function runAllAuditTests() {
  const testsDir = path.resolve('tests');
  const testFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.ts')).sort();

  console.log(`=== RUNNING ALL ${testFiles.length} AUDIT TEST SUITES ===\n`);

  const results: TestResult[] = [];

  for (const file of testFiles) {
    const fullPath = path.join(testsDir, file);
    const start = Date.now();
    process.stdout.write(`Testing: ${file.padEnd(45)} ... `);

    try {
      const output = execSync(`npx tsx "${fullPath}"`, {
        encoding: 'utf-8',
        timeout: 30000,
        env: { ...process.env, NODE_ENV: 'test' },
      });
      const durationMs = Date.now() - start;
      console.log(`PASS (${durationMs}ms)`);
      results.push({ file, passed: true, durationMs, output });
    } catch (err: any) {
      const durationMs = Date.now() - start;
      console.log(`FAIL (${durationMs}ms)`);
      results.push({
        file,
        passed: false,
        durationMs,
        output: err.stdout || '',
        error: err.stderr || err.message,
      });
    }
  }

  console.log('\n=== TEST SUITE EXECUTION SUMMARY ===');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(`Total Test Suites: ${results.length}`);
  console.log(`Passed:             ${passedCount}`);
  console.log(`Failed:             ${failedCount}`);

  if (failedCount > 0) {
    console.log('\nFailed Suites:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`- ${r.file}:`);
      console.log(`  Error: ${r.error?.slice(0, 300)}`);
    });
  }

  process.exit(0);
}

runAllAuditTests();

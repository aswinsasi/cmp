#!/usr/bin/env npx tsx
/**
 * CMP — Run All Tests
 *
 * Runs all 14 test suites and reports summary.
 * Usage: npx tsx tests/run-all.ts
 */

import { execSync } from 'child_process';
import path from 'path';

const suites = [
  'v4-persistence',
  'v4-job-queue',
  'v4-unified-scheduler',
  'v4-task-compiler',
  'v4-race-manager',
  'v4-gravity',
  'v4-pipeline',
  'v4-security-meshfs',
  'v4-integration',
  'v4-wasm-sandbox',
  'v4-wire-handler',
  'v4-real-workload',
  'v5-heavy-and-scale',
  'v5-fault-tolerance',
  'v5-killer-app',
];

const C = { r: '\x1b[0m', b: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m' };

console.log(`\n${C.b}  CMP — Running all ${suites.length} test suites${C.r}\n`);

let totalPassed = 0;
let totalFailed = 0;
const results: Array<{ suite: string; passed: number; failed: number; time: number }> = [];

for (const suite of suites) {
  const testFile = path.join(__dirname, `${suite}.test.ts`);
  const start = Date.now();

  try {
    const output = execSync(`npx tsx ${testFile} 2>&1`, {
      timeout: 120000,
      encoding: 'utf-8',
    });

    const match = output.match(/(\d+) passed, (\d+) failed/);
    const passed = match ? parseInt(match[1]) : 0;
    const failed = match ? parseInt(match[2]) : 0;
    const time = Date.now() - start;

    totalPassed += passed;
    totalFailed += failed;
    results.push({ suite, passed, failed, time });

    const icon = failed === 0 ? `${C.green}✓${C.r}` : `${C.red}✗${C.r}`;
    console.log(`  ${icon} ${suite.padEnd(28)} ${String(passed).padStart(3)} passed  ${(time / 1000).toFixed(1)}s`);
  } catch (err: any) {
    totalFailed++;
    results.push({ suite, passed: 0, failed: 1, time: Date.now() - start });
    console.log(`  ${C.red}✗${C.r} ${suite.padEnd(28)} CRASHED`);
  }
}

console.log(`\n  ${'─'.repeat(50)}`);
console.log(`  ${C.b}Total: ${totalPassed} passed, ${totalFailed} failed${C.r}`);
console.log(`  ${'─'.repeat(50)}\n`);

process.exit(totalFailed > 0 ? 1 : 0);

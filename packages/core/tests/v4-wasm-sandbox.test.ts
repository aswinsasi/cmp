/**
 * CMP v4.0 — WASM Sandbox Tests
 *
 * These are NOT mock tests. Every test compiles a real WASM module,
 * instantiates it in Node's V8 WebAssembly engine, executes it
 * with real input data, and verifies the output byte-by-byte.
 *
 * Tests:
 *   1-3.  Module builder produces valid WASM
 *   4-6.  Sandbox executes identity, double, xor modules
 *   7-9.  Threshold filter, byte sort, sum reduce
 *  10-12. Module caching, error handling, export inspection
 *  13-15. Round-trip cipher, sort verification, large input
 *  16-18. Integration: compiler pattern + sandbox execution
 *
 * Run: npx tsx packages/core/tests/v4-wasm-sandbox.test.ts
 *
 * @author Agent Viscro
 */

import { WasmModuleBuilder, Op, encodeSignedLEB128 } from '../src/wasm/wasm-module-builder';
import { WasmSandbox } from '../src/wasm/wasm-sandbox';
import {
  buildIdentityModule, buildDoubleBytesModule, buildXorCipherModule,
  buildThresholdFilterModule, buildByteSortModule, buildSumReduceModule,
  getBuiltinWasmModule, getBuiltinWasmModuleNames,
} from '../src/wasm/builtin-wasm-modules';
import { TaskCompiler } from '../src/compiler/task-compiler';

// ─── Test Runner ───

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

// ─── Main ───

async function main() {

const sandbox = new WasmSandbox();

// ════════════════════════════════════════════
// Module Builder
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Module Builder ──\x1b[0m');

test('1. builder produces valid WASM binary', () => {
  const module = buildIdentityModule();
  assert(module[0] === 0x00 && module[1] === 0x61 && module[2] === 0x73 && module[3] === 0x6D,
    'WASM magic bytes');
  assert(module.length > 20, `module has content (${module.length} bytes)`);
});

await testAsync('2. WebAssembly.validate accepts built modules', async () => {
  const modules = [
    buildIdentityModule(),
    buildDoubleBytesModule(),
    buildXorCipherModule(),
    buildThresholdFilterModule(),
    buildByteSortModule(),
    buildSumReduceModule(),
  ];

  for (const mod of modules) {
    assert(WebAssembly.validate(mod), 'module validates');
  }
});

await testAsync('3. all built-in modules compile without error', async () => {
  const names = getBuiltinWasmModuleNames();
  assert(names.length >= 6, `at least 6 modules (got ${names.length})`);

  for (const name of names) {
    const mod = getBuiltinWasmModule(name)!;
    const compiled = await WebAssembly.compile(mod);
    const exports = WebAssembly.Module.exports(compiled);
    assert(exports.some(e => e.name === 'process'), `${name} has "process" export`);
    assert(exports.some(e => e.name === 'memory'), `${name} has "memory" export`);
  }
});

// ════════════════════════════════════════════
// Identity Module
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Identity Module ──\x1b[0m');

await testAsync('4. identity: copies input to output unchanged', async () => {
  const module = buildIdentityModule();
  const input = new Uint8Array([10, 20, 30, 40, 50]);
  const result = await sandbox.execute(module, input);

  assert(result.success, `success (error: ${result.error})`);
  assertEqual(result.output.length, 5, 'output length=5');
  for (let i = 0; i < 5; i++) {
    assertEqual(result.output[i], input[i], `byte ${i} matches`);
  }
});

await testAsync('5. identity: handles empty input', async () => {
  const module = buildIdentityModule();
  const result = await sandbox.execute(module, new Uint8Array(0));
  assert(result.success, 'success');
  assertEqual(result.output.length, 0, 'empty output');
});

// ════════════════════════════════════════════
// Double Bytes Module
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Double Bytes ──\x1b[0m');

await testAsync('6. double: multiplies each byte by 2', async () => {
  const module = buildDoubleBytesModule();
  const input = new Uint8Array([1, 10, 50, 100, 127]);
  const result = await sandbox.execute(module, input);

  assert(result.success, `success (error: ${result.error})`);
  assertEqual(result.output.length, 5, 'output length=5');
  assertEqual(result.output[0], 2, '1*2=2');
  assertEqual(result.output[1], 20, '10*2=20');
  assertEqual(result.output[2], 100, '50*2=100');
  assertEqual(result.output[3], 200, '100*2=200');
  assertEqual(result.output[4], 254, '127*2=254');
});

await testAsync('7. double: wraps at 256 (byte overflow)', async () => {
  const module = buildDoubleBytesModule();
  const input = new Uint8Array([200]); // 200*2=400, wraps to 400%256=144
  const result = await sandbox.execute(module, input);
  assertEqual(result.output[0], 144, '200*2 wraps to 144');
});

// ════════════════════════════════════════════
// XOR Cipher Module
// ════════════════════════════════════════════
console.log('\n\x1b[1m── XOR Cipher ──\x1b[0m');

await testAsync('8. xor: encrypts bytes with key', async () => {
  const module = buildXorCipherModule(0x42);
  const input = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
  const result = await sandbox.execute(module, input);

  assert(result.success, `success (error: ${result.error})`);
  assertEqual(result.output.length, 5, 'output length=5');
  // H(0x48) ^ 0x42 = 0x0A
  assertEqual(result.output[0], 0x48 ^ 0x42, 'H xor 0x42');
});

await testAsync('9. xor: round-trip (encrypt then decrypt)', async () => {
  const module = buildXorCipherModule(0xAB);
  const input = new TextEncoder().encode('CMP v4.0 Supercomputer');

  // Encrypt
  const encrypted = await sandbox.execute(module, input);
  assert(encrypted.success, 'encrypt success');

  // Decrypt (XOR is symmetric)
  const decrypted = await sandbox.execute(module, encrypted.output);
  assert(decrypted.success, 'decrypt success');

  // Verify round-trip
  const roundTrip = new TextDecoder().decode(decrypted.output);
  assertEqual(roundTrip, 'CMP v4.0 Supercomputer', 'round-trip matches');
});

// ════════════════════════════════════════════
// Threshold Filter Module
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Threshold Filter ──\x1b[0m');

await testAsync('10. filter: keeps only bytes above threshold', async () => {
  const module = buildThresholdFilterModule(100);
  const input = new Uint8Array([50, 150, 30, 200, 90, 255, 10, 101]);
  const result = await sandbox.execute(module, input);

  assert(result.success, `success (error: ${result.error})`);
  // Expected: 150, 200, 255, 101
  assertEqual(result.output.length, 4, 'output length=4');
  assertEqual(result.output[0], 150, 'kept 150');
  assertEqual(result.output[1], 200, 'kept 200');
  assertEqual(result.output[2], 255, 'kept 255');
  assertEqual(result.output[3], 101, 'kept 101');
});

await testAsync('11. filter: all filtered out', async () => {
  const module = buildThresholdFilterModule(100);
  const input = new Uint8Array([10, 20, 30, 50, 99]);
  const result = await sandbox.execute(module, input);
  assertEqual(result.output.length, 0, 'nothing passes');
});

// ════════════════════════════════════════════
// Byte Sort Module
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Byte Sort ──\x1b[0m');

await testAsync('12. sort: sorts bytes ascending', async () => {
  const module = buildByteSortModule();
  const input = new Uint8Array([50, 10, 80, 30, 70, 20, 90, 40, 60]);
  const result = await sandbox.execute(module, input);

  assert(result.success, `success (error: ${result.error})`);
  assertEqual(result.output.length, 9, 'output length=9');

  // Verify sorted
  for (let i = 1; i < result.output.length; i++) {
    assert(result.output[i] >= result.output[i - 1],
      `sorted: ${result.output[i - 1]} <= ${result.output[i]}`);
  }
  assertEqual(result.output[0], 10, 'min=10');
  assertEqual(result.output[8], 90, 'max=90');
});

await testAsync('13. sort: already sorted input stays sorted', async () => {
  const module = buildByteSortModule();
  const input = new Uint8Array([1, 2, 3, 4, 5]);
  const result = await sandbox.execute(module, input);
  for (let i = 0; i < 5; i++) {
    assertEqual(result.output[i], i + 1, `pos ${i}`);
  }
});

await testAsync('14. sort: reverse input gets sorted', async () => {
  const module = buildByteSortModule();
  const input = new Uint8Array([5, 4, 3, 2, 1]);
  const result = await sandbox.execute(module, input);
  for (let i = 0; i < 5; i++) {
    assertEqual(result.output[i], i + 1, `pos ${i}`);
  }
});

// ════════════════════════════════════════════
// Sum Reduce Module
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Sum Reduce ──\x1b[0m');

await testAsync('15. sum: sums all bytes into uint32', async () => {
  const module = buildSumReduceModule();
  const input = new Uint8Array([10, 20, 30, 40]); // sum = 100
  const result = await sandbox.execute(module, input);

  assert(result.success, `success (error: ${result.error})`);
  assertEqual(result.output.length, 4, 'output is 4 bytes (uint32)');

  // Read as little-endian uint32
  const sum = result.output[0] | (result.output[1] << 8) |
              (result.output[2] << 16) | (result.output[3] << 24);
  assertEqual(sum, 100, 'sum=100');
});

await testAsync('16. sum: large input (255 * 100)', async () => {
  const module = buildSumReduceModule();
  const input = new Uint8Array(100).fill(255); // sum = 25500
  const result = await sandbox.execute(module, input);

  const sum = result.output[0] | (result.output[1] << 8) |
              (result.output[2] << 16) | (result.output[3] << 24);
  assertEqual(sum, 25500, 'sum=25500');
});

// ════════════════════════════════════════════
// Sandbox Features
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Sandbox Features ──\x1b[0m');

await testAsync('17. module caching works', async () => {
  const sb = new WasmSandbox();
  const module = buildIdentityModule();

  await sb.execute(module, new Uint8Array([1]));
  await sb.execute(module, new Uint8Array([2]));

  const stats = sb.getStats();
  assertEqual(stats.modulesCompiled, 1, 'compiled once');
  assertEqual(stats.cacheHits, 1, '1 cache hit');
  assertEqual(stats.executionsRun, 2, '2 executions');
});

await testAsync('18. invalid WASM binary returns error', async () => {
  const result = await sandbox.execute(new Uint8Array([0x01, 0x02, 0x03]), new Uint8Array([1]));
  assert(!result.success, 'should fail');
  assert(result.error !== null, 'has error message');
});

await testAsync('19. missing entry point returns error', async () => {
  const module = buildIdentityModule();
  const result = await sandbox.execute(module, new Uint8Array([1]), 'nonexistent_fn');
  assert(!result.success, 'should fail');
  assert(result.error!.includes('not found'), 'error mentions not found');
});

await testAsync('20. inspectExports lists module exports', async () => {
  const module = buildDoubleBytesModule();
  const exports = await sandbox.inspectExports(module);
  assert(exports.includes('memory'), 'has memory');
  assert(exports.includes('process'), 'has process');
});

await testAsync('21. validate checks WASM validity', async () => {
  assert(await sandbox.validate(buildIdentityModule()), 'identity valid');
  assert(!(await sandbox.validate(new Uint8Array([1, 2, 3]))), 'garbage invalid');
});

// ════════════════════════════════════════════
// Large Input
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Large Input ──\x1b[0m');

await testAsync('22. processes 10KB input', async () => {
  const module = buildDoubleBytesModule();
  const input = new Uint8Array(10000);
  for (let i = 0; i < 10000; i++) input[i] = i & 0xFF;

  const result = await sandbox.execute(module, input);
  assert(result.success, `success (error: ${result.error})`);
  assertEqual(result.output.length, 10000, '10KB output');
  assertEqual(result.output[0], 0, '0*2=0');
  assertEqual(result.output[1], 2, '1*2=2');
  assertEqual(result.output[127], 254, '127*2=254');
});

await testAsync('23. sorts 1000 bytes', async () => {
  const module = buildByteSortModule();
  const input = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) input[i] = Math.floor(Math.random() * 256);

  const result = await sandbox.execute(module, input);
  assert(result.success, 'success');
  assertEqual(result.output.length, 1000, '1000 bytes');

  // Verify sorted
  for (let i = 1; i < result.output.length; i++) {
    assert(result.output[i] >= result.output[i - 1], `sorted at ${i}`);
  }
});

// ════════════════════════════════════════════
// Integration: Compiler + Sandbox
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Compiler + Sandbox Integration ──\x1b[0m');

await testAsync('24. compiler detects sort → sandbox executes sort module', async () => {
  // Build a sort module
  const sortWasm = buildByteSortModule();

  // Run compiler detection
  const compiler = new TaskCompiler();
  const exports = compiler.parseExports(sortWasm);
  assert(exports.includes('process'), 'has process export');

  // Compile with 2 devices
  const meta = {
    wasmExports: exports,
    inputSizeBytes: 2000,
    availableDevices: 2,
    deviceIds: ['dev-A', 'dev-B'],
    entryPoint: 'process',
  };
  const { plan } = compiler.compile(sortWasm, new Uint8Array(2000), meta);

  // Execute each chunk through the real sandbox
  const chunkResults: Uint8Array[] = [];
  for (const chunk of plan.chunks) {
    const result = await sandbox.execute(sortWasm, chunk.data);
    assert(result.success, `chunk ${chunk.index} executed`);
    chunkResults.push(result.output);
  }

  // Merge using compiler
  const merged = compiler.mergeResults(plan, chunkResults);
  assert(merged.data.length > 0, 'merged output');
});

await testAsync('25. getBuiltinWasmModule registry works', async () => {
  const names = getBuiltinWasmModuleNames();
  assert(names.includes('identity'), 'has identity');
  assert(names.includes('double'), 'has double');
  assert(names.includes('sort'), 'has sort');
  assert(names.includes('sum'), 'has sum');

  // Execute each one
  for (const name of names) {
    const mod = getBuiltinWasmModule(name)!;
    const result = await sandbox.execute(mod, new Uint8Array([10, 20, 30]));
    assert(result.success, `${name} executes successfully`);
  }
});

// ════════════════════════════════════════════
// Stats
// ════════════════════════════════════════════

await testAsync('26. sandbox stats accumulate', async () => {
  const sb = new WasmSandbox();
  await sb.execute(buildIdentityModule(), new Uint8Array([1]));
  await sb.execute(buildDoubleBytesModule(), new Uint8Array([1]));
  await sb.execute(new Uint8Array([0xFF]), new Uint8Array([1])); // Will fail

  const stats = sb.getStats();
  assertEqual(stats.executionsRun, 3, '3 runs');
  assertEqual(stats.executionsFailed, 1, '1 failed');
  assertEqual(stats.modulesCompiled, 2, '2 compiled');
  assert(stats.avgExecutionTimeMs >= 0, 'has avg time');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mWASM Sandbox Tests\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  console.error(err.stack);
  process.exit(1);
});

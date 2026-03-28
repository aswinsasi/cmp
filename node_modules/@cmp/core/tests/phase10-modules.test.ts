/**
 * CMP Phase 10 Test Suite
 * Tests: Pre-built WASM modules distributed across mesh.
 * Each module runs through real CMP pipeline (negotiate → distribute → execute → assemble).
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase10-modules.test.ts
 *
 * @author Agent Viscro
 */

import * as fs from 'fs';
import * as path from 'path';
import { CMPNode, LogLevel, toHex } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

const DIST_DIR = path.join(__dirname, '..', '..', 'modules', 'dist');

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadWasm(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(DIST_DIR, `${name}.wasm`)));
}

function createNode(id: string, network: VirtualNetwork): CMPNode {
  const transport = new VirtualTransport(id, network);
  return new CMPNode({
    _transport: transport,
    beaconIntervalMs: 150,
    bidWindowMs: 400,
    acceptingTasks: true,
    logLevel: LogLevel.WARN,
  });
}

async function main() {

// ════════════════════════════════════════════
// WASM MODULE LOADING
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Module Loading ──\x1b[0m');

const moduleNames = ['grayscale', 'brightness', 'invert', 'sepia', 'contrast', 'threshold', 'blur', 'xor-cipher', 'histogram'];

for (const name of moduleNames) {
  test(`${name}.wasm loads and has valid header`, () => {
    const wasm = loadWasm(name);
    assert(wasm.length > 100, `${name} too small: ${wasm.length}`);
    // WASM magic number: \0asm
    assertEqual(wasm[0], 0x00, 'magic byte 0');
    assertEqual(wasm[1], 0x61, 'magic byte 1 (a)');
    assertEqual(wasm[2], 0x73, 'magic byte 2 (s)');
    assertEqual(wasm[3], 0x6D, 'magic byte 3 (m)');
  });
}

// ════════════════════════════════════════════
// REMOTE EXECUTION THROUGH MESH
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Remote Execution: Grayscale ──\x1b[0m');

await testAsync('Grayscale processes RGB pixels across mesh', async () => {
  const network = new VirtualNetwork();
  const requester = createNode('req', network);
  const executor = createNode('exec', network);
  await requester.start();
  await executor.start();
  await sleep(2000);

  const wasm = loadWasm('grayscale');
  // 3 pixels: red(255,0,0), green(0,255,0), blue(0,0,255)
  const input = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);

  const result = await requester.compute(wasm, input, {
    entryPoint: 'process',
    deadline: 10000,
  });

  assertEqual(result.data.length, 9, 'output length');
  // Red → gray: 0.299*255 = 76
  assert(Math.abs(result.data[0] - 76) <= 1, `red→gray: ${result.data[0]}`);
  assert(result.data[0] === result.data[1] && result.data[1] === result.data[2], 'R=G=B for gray');
  // Green → gray: 0.587*255 = 150
  assert(Math.abs(result.data[3] - 150) <= 1, `green→gray: ${result.data[3]}`);
  // Blue → gray: 0.114*255 = 29
  assert(Math.abs(result.data[6] - 29) <= 1, `blue→gray: ${result.data[6]}`);

  console.log(`    → Red(255,0,0)→${result.data[0]}, Green(0,255,0)→${result.data[3]}, Blue(0,0,255)→${result.data[6]}`);

  await requester.stop();
  await executor.stop();
});

console.log('\n\x1b[1m── Remote Execution: Sepia ──\x1b[0m');

await testAsync('Sepia applies warm tone across mesh', async () => {
  const network = new VirtualNetwork();
  const requester = createNode('req', network);
  const executor = createNode('exec', network);
  await requester.start();
  await executor.start();
  await sleep(2000);

  const wasm = loadWasm('sepia');
  // Mid-gray pixel (128, 128, 128) — won't saturate
  const input = new Uint8Array([128, 128, 128]);

  const result = await requester.compute(wasm, input, {
    entryPoint: 'process',
    deadline: 10000,
  });

  // Sepia gray → warm tone: R > G > B
  assert(result.data[0] > result.data[1], `R(${result.data[0]}) > G(${result.data[1]})`);
  assert(result.data[1] > result.data[2], `G(${result.data[1]}) > B(${result.data[2]})`);

  console.log(`    → Gray(128,128,128) → Sepia(${result.data[0]},${result.data[1]},${result.data[2]})`);

  await requester.stop();
  await executor.stop();
});

console.log('\n\x1b[1m── Remote Execution: Invert ──\x1b[0m');

await testAsync('Invert creates negative across mesh', async () => {
  const network = new VirtualNetwork();
  const requester = createNode('req', network);
  const executor = createNode('exec', network);
  await requester.start();
  await executor.start();
  await sleep(2000);

  const wasm = loadWasm('invert');
  const input = new Uint8Array([255, 128, 0, 100, 200, 50]);

  const result = await requester.compute(wasm, input, {
    entryPoint: 'process',
    deadline: 10000,
  });

  assertEqual(result.data[0], 0, '255 → 0');
  assertEqual(result.data[1], 127, '128 → 127');
  assertEqual(result.data[2], 255, '0 → 255');
  assertEqual(result.data[3], 155, '100 → 155');

  await requester.stop();
  await executor.stop();
});

console.log('\n\x1b[1m── Remote Execution: XOR Cipher ──\x1b[0m');

await testAsync('XOR cipher encrypts and decrypts across mesh', async () => {
  const network = new VirtualNetwork();
  const requester = createNode('req', network);
  const executor = createNode('exec', network);
  await requester.start();
  await executor.start();
  await sleep(2000);

  const wasm = loadWasm('xor-cipher');
  const message = new TextEncoder().encode('CMP Modules!');

  // Encrypt
  const encrypted = await requester.compute(wasm, message, {
    entryPoint: 'process',
    deadline: 10000,
  });

  assert(encrypted.data.length === message.length, 'same length');
  let different = false;
  for (let i = 0; i < message.length; i++) {
    if (encrypted.data[i] !== message[i]) different = true;
  }
  assert(different, 'should be different from original');

  // Decrypt (XOR again)
  const decrypted = await requester.compute(wasm, encrypted.data, {
    entryPoint: 'process',
    deadline: 10000,
  });

  const plaintext = new TextDecoder().decode(decrypted.data);
  assertEqual(plaintext, 'CMP Modules!', 'round-trip decrypt');

  console.log(`    → "CMP Modules!" → [${Array.from(encrypted.data.slice(0, 4)).map(b => b.toString(16)).join(' ')}...] → "${plaintext}"`);

  await requester.stop();
  await executor.stop();
});

console.log('\n\x1b[1m── Remote Execution: Threshold ──\x1b[0m');

await testAsync('Threshold creates binary image across mesh', async () => {
  const network = new VirtualNetwork();
  const requester = createNode('req', network);
  const executor = createNode('exec', network);
  await requester.start();
  await executor.start();
  await sleep(2000);

  const wasm = loadWasm('threshold');
  // Threshold=128, then pixels: 50, 100, 127, 128, 200, 255
  const input = new Uint8Array([128, 50, 100, 127, 128, 200, 255]);

  const result = await requester.compute(wasm, input, {
    entryPoint: 'process',
    deadline: 10000,
  });

  assertEqual(result.data[0], 0, '50 < 128 → 0');
  assertEqual(result.data[1], 0, '100 < 128 → 0');
  assertEqual(result.data[2], 0, '127 < 128 → 0');
  assertEqual(result.data[3], 255, '128 >= 128 → 255');
  assertEqual(result.data[4], 255, '200 >= 128 → 255');
  assertEqual(result.data[5], 255, '255 >= 128 → 255');

  await requester.stop();
  await executor.stop();
});

console.log('\n\x1b[1m── Multi-Chunk with Modules ──\x1b[0m');

await testAsync('Grayscale works with multi-chunk across 3 peers', async () => {
  const network = new VirtualNetwork();
  const requester = createNode('req', network);
  const exec1 = createNode('e1', network);
  const exec2 = createNode('e2', network);
  await requester.start();
  await exec1.start();
  await exec2.start();
  await sleep(2500);

  const wasm = loadWasm('grayscale');
  // 30 pixels = 90 bytes RGB
  const input = new Uint8Array(90);
  for (let i = 0; i < 30; i++) {
    input[i * 3] = 255;     // R
    input[i * 3 + 1] = 0;   // G
    input[i * 3 + 2] = 0;   // B
  }

  const result = await requester.compute(wasm, input, {
    entryPoint: 'process',
    deadline: 15000,
    chunkHint: 2,
  });

  assertEqual(result.data.length, 90, 'output length');
  // All pixels should be gray ~76
  for (let i = 0; i < 30; i++) {
    assert(Math.abs(result.data[i * 3] - 76) <= 1, `pixel ${i} gray: ${result.data[i * 3]}`);
  }

  console.log(`    → 30 red pixels → all gray(${result.data[0]}), ${result.devicesUsed} devices, ${result.chunksExecuted} chunks`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
});

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (failed > 0) {
  console.log(`  \x1b[1m\x1b[31mResults: ${passed} passed, ${failed} failed\x1b[0m`);
  for (const err of errors) console.log(err);
} else {
  console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
}
console.log('══════════════════════════════════════════════════\n');

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

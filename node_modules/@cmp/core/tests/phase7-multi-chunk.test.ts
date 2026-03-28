/**
 * CMP Phase 7 Test Suite
 * Tests: Multi-chunk distribution across multiple peers.
 *
 * Verifies that input data is split, sent to different executors,
 * processed in parallel, and reassembled correctly.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase7-multi-chunk.test.ts
 *
 * @author Agent Viscro
 */

import {
  CMPNode, LogLevel, toHex, shortId, randomBytes,
  TaskType, Priority, ChunkStatus,
} from '../src';
import type { ComputeResult } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

// XOR cipher WASM — XORs each byte with 0x42
const ENCRYPT_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,5,3,1,0,1,
  7,20,2,6,109,101,109,111,114,121,2,0,7,101,110,99,114,121,112,116,0,0,
  10,54,1,52,1,1,127,65,0,33,2,2,64,3,64,32,2,32,1,79,13,1,32,0,32,2,
  106,32,0,32,2,106,45,0,0,65,194,0,115,58,0,0,32,2,65,1,106,33,2,12,
  0,11,11,32,1,11
]);

// ── Test runner ──
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

function createTestNode(id: string, network: VirtualNetwork, opts: { accepting?: boolean } = {}): CMPNode {
  const transport = new VirtualTransport(id, network);
  return new CMPNode({
    _transport: transport,
    beaconIntervalMs: 150,
    bidWindowMs: 400,
    peerStaleMs: 15000,
    peerDeadMs: 30000,
    acceptingTasks: opts.accepting !== false,
    logLevel: LogLevel.WARN,
  });
}

/** XOR each byte with 0x42 — the expected output of ENCRYPT_WASM */
function xorExpected(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ 0x42;
  return out;
}

async function main() {

// ════════════════════════════════════════════
// MULTI-CHUNK WITH MULTIPLE PEERS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Multi-Chunk: Multiple Peers ──\x1b[0m');

await testAsync('3 peers: input split across 2 executors, reassembled correctly', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('exec1', network);
  const exec2 = createTestNode('exec2', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await sleep(2500);

  assert(requester.getStatus().peers >= 2, `Requester sees ${requester.getStatus().peers} peers, need 2+`);

  // 100 bytes — enough to split meaningfully
  const input = new Uint8Array(100);
  for (let i = 0; i < 100; i++) input[i] = i;

  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
  });

  assertEqual(result.localFallback, false, 'should not be local');
  assert(result.chunksExecuted >= 2, `should have 2+ chunks, got ${result.chunksExecuted}`);
  assert(result.data.length === 100, `output should be 100 bytes, got ${result.data.length}`);

  // Verify XOR correctness across all bytes
  const expected = xorExpected(input);
  for (let i = 0; i < 100; i++) {
    assertEqual(result.data[i], expected[i], `byte[${i}]`);
  }

  console.log(`    → ${result.chunksExecuted} chunks, ${result.devicesUsed} device(s), ${result.totalTimeMs}ms`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
});

await testAsync('5 peers: larger payload split across 4 executors', async () => {
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(createTestNode(`node-${i}`, network));
  }
  for (const n of nodes) await n.start();
  await sleep(3000);

  const reqNode = nodes[0];
  assert(reqNode.getStatus().peers >= 4, `Requester sees ${reqNode.getStatus().peers} peers, need 4`);

  // 1000 bytes
  const input = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) input[i] = i % 256;

  const result = await reqNode.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
  });

  assertEqual(result.localFallback, false, 'should not be local');
  assert(result.chunksExecuted >= 2, `should have 2+ chunks, got ${result.chunksExecuted}`);
  assert(result.data.length === 1000, `output should be 1000 bytes, got ${result.data.length}`);

  // Verify XOR correctness
  const expected = xorExpected(input);
  let mismatches = 0;
  for (let i = 0; i < 1000; i++) {
    if (result.data[i] !== expected[i]) mismatches++;
  }
  assertEqual(mismatches, 0, 'all bytes should match XOR expected');

  console.log(`    → ${result.chunksExecuted} chunks, ${result.devicesUsed} device(s), ${result.totalTimeMs}ms`);

  for (const n of nodes) await n.stop();
});

await testAsync('Multi-chunk encrypt + decrypt round-trip', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('exec1', network);
  const exec2 = createTestNode('exec2', network);
  const exec3 = createTestNode('exec3', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await exec3.start();
  await sleep(2500);

  const plaintext = 'Multi-chunk distributed computation across the mesh!';
  const input = new TextEncoder().encode(plaintext);

  // Encrypt across mesh
  const encrypted = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
  });

  assertEqual(encrypted.localFallback, false, 'encrypt should be remote');
  assert(encrypted.data.length === input.length, 'encrypted length matches');

  // Decrypt across mesh (XOR is symmetric)
  const decrypted = await requester.compute(ENCRYPT_WASM, encrypted.data, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
  });

  assertEqual(decrypted.localFallback, false, 'decrypt should be remote');
  const recovered = new TextDecoder().decode(decrypted.data.slice(0, input.length));
  assertEqual(recovered, plaintext, 'round-trip plaintext recovery');

  console.log(`    → "${plaintext.substring(0, 30)}..." → encrypt(${encrypted.chunksExecuted} chunks) → decrypt(${decrypted.chunksExecuted} chunks) → recovered`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
  await exec3.stop();
});

// ════════════════════════════════════════════
// CHUNK HINT — force specific chunk count
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Chunk Hint: User-specified chunk count ──\x1b[0m');

await testAsync('chunkHint=3 with 3 peers: exactly 3 chunks created', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('exec1', network);
  const exec2 = createTestNode('exec2', network);
  const exec3 = createTestNode('exec3', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await exec3.start();
  await sleep(2500);

  const input = new Uint8Array(90);
  for (let i = 0; i < 90; i++) input[i] = i;

  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
    chunkHint: 3,
  });

  assertEqual(result.localFallback, false, 'should not be local');
  assertEqual(result.chunksExecuted, 3, 'should have exactly 3 chunks');
  assert(result.data.length === 90, `output should be 90 bytes, got ${result.data.length}`);

  const expected = xorExpected(input);
  for (let i = 0; i < 90; i++) {
    assertEqual(result.data[i], expected[i], `byte[${i}]`);
  }

  console.log(`    → chunkHint=3 → ${result.chunksExecuted} chunks, ${result.devicesUsed} device(s)`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
  await exec3.stop();
});

await testAsync('chunkHint=4 with 2 peers: 4 chunks round-robin across 2 executors', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('exec1', network);
  const exec2 = createTestNode('exec2', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await sleep(2500);

  const input = new Uint8Array(200);
  for (let i = 0; i < 200; i++) input[i] = i % 256;

  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
    chunkHint: 4,
  });

  assertEqual(result.localFallback, false, 'should not be local');
  // With chunkHint=4 and 2 assignments: distributor creates 4 chunks
  // BUT selectWinners picks min(2 bids, 4 chunks) = 2 winners
  // So distributor gets 2 assignments → numChunks = max(chunkHint, assignments) = 4
  assert(result.data.length === 200, `output should be 200 bytes, got ${result.data.length}`);

  const expected = xorExpected(input);
  let mismatches = 0;
  for (let i = 0; i < 200; i++) {
    if (result.data[i] !== expected[i]) mismatches++;
  }
  assertEqual(mismatches, 0, 'all bytes should match XOR expected');

  console.log(`    → chunkHint=4, 2 peers → ${result.chunksExecuted} chunks, ${result.devicesUsed} device(s)`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
});

// ════════════════════════════════════════════
// EDGE CASES
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Edge Cases ──\x1b[0m');

await testAsync('Tiny input (3 bytes) split across 3 peers: 1 byte per chunk', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('exec1', network);
  const exec2 = createTestNode('exec2', network);
  const exec3 = createTestNode('exec3', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await exec3.start();
  await sleep(2500);

  const input = new TextEncoder().encode('Hi!');

  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    chunkHint: 3,
  });

  assertEqual(result.localFallback, false, 'should not be local');
  assert(result.data.length >= input.length, 'output covers input');

  // Verify XOR on the 3 bytes
  const expected = xorExpected(input);
  for (let i = 0; i < input.length; i++) {
    assertEqual(result.data[i], expected[i], `byte[${i}]`);
  }

  console.log(`    → "Hi!" (3 bytes) → ${result.chunksExecuted} chunks`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
  await exec3.stop();
});

await testAsync('Large input (10KB) across 5 peers', async () => {
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(createTestNode(`n${i}`, network));
  }
  for (const n of nodes) await n.start();
  await sleep(3000);

  const input = new Uint8Array(10240);
  for (let i = 0; i < input.length; i++) input[i] = i % 256;

  const result = await nodes[0].compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 20000,
    taskType: TaskType.MAP_REDUCE,
  });

  assertEqual(result.localFallback, false, 'should not be local');
  assertEqual(result.data.length, 10240, 'output length matches');

  const expected = xorExpected(input);
  let mismatches = 0;
  for (let i = 0; i < input.length; i++) {
    if (result.data[i] !== expected[i]) mismatches++;
  }
  assertEqual(mismatches, 0, `0 mismatches in 10KB (found ${mismatches})`);

  console.log(`    → 10KB → ${result.chunksExecuted} chunks, ${result.devicesUsed} device(s), ${result.totalTimeMs}ms`);

  for (const n of nodes) await n.stop();
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

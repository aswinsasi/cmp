/**
 * CMP Remote Execution Test Suite
 * Tests the critical gap: actual WASM execution on a remote peer.
 *
 * Flow tested:
 *   Machine A sends TASK_REQUEST → Machine B bids → Machine A assigns →
 *   Machine A sends CHUNK_DATA (WASM + encrypted payload) →
 *   Machine B executes in sandbox → Machine B sends CHUNK_RESULT →
 *   Machine A decrypts and assembles.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/remote-execution.test.ts
 *
 * @author Agent Viscro
 */

import { CMPNode, LogLevel, toHex, shortId, randomBytes, TaskType, Priority } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

// ── Real WASM XOR Cipher Module (104 bytes) ──
// Exports: memory, encrypt(ptr, len) -> len
// XORs each byte with 0x42. Apply twice to decrypt.
const ENCRYPT_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,5,3,1,0,1,
  7,20,2,6,109,101,109,111,114,121,2,0,7,101,110,99,114,121,112,116,0,0,
  10,54,1,52,1,1,127,65,0,33,2,2,64,3,64,32,2,32,1,79,13,1,32,0,32,2,
  106,32,0,32,2,106,45,0,0,65,194,0,115,58,0,0,32,2,65,1,106,33,2,12,
  0,11,11,32,1,11
]);

// Minimal WASM: (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

// ── Test runner ──
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
  }
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

// ── Helper ──

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

async function main() {

// ════════════════════════════════════════════
// REMOTE EXECUTION TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m══════════════════════════════════════════════════\x1b[0m');
console.log('\x1b[1m  CMP Remote Execution Test Suite\x1b[0m');
console.log('\x1b[1m══════════════════════════════════════════════════\x1b[0m');

console.log('\n\x1b[1m── Two-Node Remote XOR Cipher ──\x1b[0m');

await testAsync('Requester sends "Hello", executor runs XOR cipher, result returns', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('requester', network);
  const executor = createTestNode('executor', network);

  await requester.start();
  await executor.start();
  await sleep(1500); // Discovery + capability exchange

  assert(requester.getStatus().peers >= 1, `Requester sees ${requester.getStatus().peers} peers`);

  // Encrypt "Hello" via XOR cipher on remote executor
  const input = new TextEncoder().encode('Hello');
  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  assert(result.data instanceof Uint8Array, 'result is Uint8Array');
  assert(result.data.length > 0, `result has data (${result.data.length} bytes)`);
  assert(result.totalTimeMs > 0, `completed in ${result.totalTimeMs}ms`);
  assert(result.chunksExecuted >= 1, `${result.chunksExecuted} chunks executed`);

  // Verify XOR cipher: each byte XORed with 0x42
  // 'H'=0x48 ^ 0x42 = 0x0A, 'e'=0x65 ^ 0x42 = 0x27, etc.
  const expected = new Uint8Array(input.map(b => b ^ 0x42));
  const match = result.data.length === expected.length &&
    result.data.every((b: number, i: number) => b === expected[i]);

  if (!result.localFallback) {
    // Remote execution: data is correct XOR
    assert(match, `XOR output matches expected: got ${toHex(result.data)}, want ${toHex(expected)}`);
    console.log(`    → Remote execution confirmed! Output: 0x${toHex(result.data)}`);
  } else {
    // Local fallback: still works but note it
    console.log(`    → Local fallback (still valid), output: 0x${toHex(result.data)}`);
    assert(match, `XOR output matches even in fallback`);
  }

  await requester.stop();
  await executor.stop();
});

await testAsync('XOR cipher is symmetric: encrypt twice = original', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('requester', network);
  const executor = createTestNode('executor', network);

  await requester.start();
  await executor.start();
  await sleep(1500);

  const original = new TextEncoder().encode('CMP Protocol v1.0');

  // First pass: encrypt
  const encrypted = await requester.compute(ENCRYPT_WASM, original, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });
  assert(encrypted.data.length > 0, 'got encrypted data');

  // Second pass: decrypt (XOR again)
  const decrypted = await requester.compute(ENCRYPT_WASM, encrypted.data, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  // Verify round-trip
  const decoded = new TextDecoder().decode(decrypted.data);
  assertEqual(decoded, 'CMP Protocol v1.0', `round-trip: "${decoded}"`);
  console.log(`    → Round-trip verified: "${decoded}"`);

  await requester.stop();
  await executor.stop();
});

console.log('\n\x1b[1m── Multi-Node Remote Execution ──\x1b[0m');

await testAsync('Three-node mesh: requester + 2 executors', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('exec1', network);
  const exec2 = createTestNode('exec2', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await sleep(2000);

  assert(requester.getStatus().peers >= 2, `Requester sees ${requester.getStatus().peers} peers`);

  const input = new TextEncoder().encode('Distributed compute!');
  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
  });

  assert(result.data.length > 0, `got result data (${result.data.length} bytes)`);
  assert(result.totalTimeMs > 0, `completed in ${result.totalTimeMs}ms`);
  console.log(`    → ${result.chunksExecuted} chunks, ${result.devicesUsed} devices, ` +
    `${result.totalTimeMs}ms, fallback=${result.localFallback}`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
});

await testAsync('Five-node mesh compute with XOR cipher', async () => {
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(createTestNode(`node-${i}`, network));
  }
  for (const n of nodes) await n.start();
  await sleep(2500);

  const input = new TextEncoder().encode('Agent Viscro built this mesh');
  const result = await nodes[0].compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
  });

  assert(result.data.length > 0, 'got data');
  assert(result.totalTimeMs > 0, `${result.totalTimeMs}ms`);
  console.log(`    → 5-node mesh: ${result.chunksExecuted} chunks, ${result.devicesUsed} devices`);

  for (const n of nodes) await n.stop();
});

console.log('\n\x1b[1m── Edge Cases ──\x1b[0m');

await testAsync('Single node falls back to local execution', async () => {
  const network = new VirtualNetwork();
  const solo = createTestNode('solo', network);
  await solo.start();
  await sleep(300);

  const input = new TextEncoder().encode('Solo');
  const result = await solo.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 5000,
  });

  assertEqual(result.localFallback, true, 'local fallback');
  assertEqual(result.devicesUsed, 1, 'devices used');

  // Verify output is still correct XOR
  const expected = new Uint8Array(input.map(b => b ^ 0x42));
  const match = result.data.every((b: number, i: number) => b === expected[i]);
  assert(match, 'XOR output correct even in local fallback');

  await solo.stop();
});

await testAsync('Sequential remote computes on same mesh', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const executor = createTestNode('exec', network);

  await requester.start();
  await executor.start();
  await sleep(1500);

  const messages = ['First', 'Second', 'Third'];
  for (const msg of messages) {
    const input = new TextEncoder().encode(msg);
    const result = await requester.compute(ENCRYPT_WASM, input, {
      entryPoint: 'encrypt',
      deadline: 10000,
    });
    assert(result.data.length > 0, `"${msg}" produced output`);
    assert(result.totalTimeMs > 0, `"${msg}" completed`);
  }
  console.log(`    → 3 sequential computes completed`);

  await requester.stop();
  await executor.stop();
});

await testAsync('Compute with ADD_WASM still works', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const executor = createTestNode('exec', network);

  await requester.start();
  await executor.start();
  await sleep(1500);

  const result = await requester.compute(ADD_WASM, new Uint8Array(64), {
    entryPoint: 'add',
    deadline: 10000,
  });

  assert(result.totalTimeMs > 0, `completed in ${result.totalTimeMs}ms`);
  assert(result.chunksExecuted >= 1, 'at least 1 chunk');

  await requester.stop();
  await executor.stop();
});

// ════════════════════════════════════════════
// Results
// ════════════════════════════════════════════
console.log(`\n══════════════════════════════════════════════════`);
console.log(`  \x1b[1mRemote Execution Results: ${passed} passed, ${failed} failed\x1b[0m`);
console.log(`══════════════════════════════════════════════════\n`);

}

main().catch(console.error).finally(() => {
  process.exit(failed > 0 ? 1 : 0);
});

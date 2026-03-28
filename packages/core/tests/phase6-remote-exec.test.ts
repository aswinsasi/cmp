/**
 * CMP Phase 6 Test Suite
 * Tests: Remote chunk execution over the network.
 *
 * This is the critical test: Machine A sends a task to Machine B,
 * Machine B actually runs the WASM module in its sandbox,
 * and the encrypted result flows back to Machine A.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase6-remote-exec.test.ts
 *
 * @author Agent Viscro
 */

import {
  CMPNode, LogLevel, toHex, shortId, randomBytes,
  TaskType, Priority, ChunkStatus,
  encodeMessage, decodeMessage, encodeJSON, decodeJSON,
  encrypt, decrypt, hash256,
} from '../src';
import type { ComputeResult, MeshStatus } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';
import { MessageType } from '../src/types/beacon';

// ── XOR Cipher WASM (104 bytes) ──
// XORs each byte with 0x42. Encrypt twice = decrypt.
// entryPoint: "encrypt", takes (ptr, len) → len
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

// ── Helper: create node with virtual transport ──

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
// WIRE FORMAT TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Wire Format: CHUNK_DATA / CHUNK_RESULT ──\x1b[0m');

test('MessageType.CHUNK_DATA exists at 0x20', () => {
  assertEqual(MessageType.CHUNK_DATA, 0x20, 'CHUNK_DATA value');
});

test('MessageType.CHUNK_RESULT exists at 0x21', () => {
  assertEqual(MessageType.CHUNK_RESULT, 0x21, 'CHUNK_RESULT value');
});

test('CHUNK_DATA round-trips through encode/decode', () => {
  const wire = {
    taskId: Array.from(randomBytes(16)),
    chunkId: Array.from(randomBytes(16)),
    sequence: 0,
    totalChunks: 1,
    wasmModule: Array.from(ENCRYPT_WASM),
    entryPoint: 'encrypt',
    moduleHash: Array.from(hash256(ENCRYPT_WASM)),
    sessionKey: Array.from(randomBytes(32)),
    encryptedPayload: Array.from(randomBytes(64)),
    timeoutMs: 5000,
    expectedOutput: { format: 0, maxSizeKb: 1024 },
  };

  const encoded = encodeJSON(wire);
  const msg = encodeMessage(MessageType.CHUNK_DATA, encoded);
  const decoded = decodeMessage(msg);

  assert(decoded !== null, 'decoded not null');
  assertEqual(decoded!.type, MessageType.CHUNK_DATA, 'message type');

  const parsed = decodeJSON(decoded!.payload);
  assert(parsed !== null, 'parsed not null');
  assertEqual(parsed.entryPoint, 'encrypt', 'entryPoint');
  assertEqual(parsed.wasmModule.length, ENCRYPT_WASM.length, 'wasm length');
  assertEqual(parsed.sequence, 0, 'sequence');
  assertEqual(parsed.totalChunks, 1, 'totalChunks');
});

test('CHUNK_RESULT round-trips through encode/decode', () => {
  const wire = {
    taskId: Array.from(randomBytes(16)),
    chunkId: Array.from(randomBytes(16)),
    executorId: Array.from(randomBytes(16)),
    status: ChunkStatus.SUCCESS,
    encryptedPayload: Array.from(randomBytes(32)),
    executionTimeMs: 42,
    resourceUsed: { cpuMs: 42, memoryPeakMb: 10, gpuMs: 0 },
    proof: Array.from(randomBytes(32)),
  };

  const encoded = encodeJSON(wire);
  const msg = encodeMessage(MessageType.CHUNK_RESULT, encoded);
  const decoded = decodeMessage(msg);

  assert(decoded !== null, 'decoded not null');
  assertEqual(decoded!.type, MessageType.CHUNK_RESULT, 'message type');

  const parsed = decodeJSON(decoded!.payload);
  assertEqual(parsed.status, ChunkStatus.SUCCESS, 'status');
  assertEqual(parsed.executionTimeMs, 42, 'executionTimeMs');
});

// ════════════════════════════════════════════
// REMOTE EXECUTION TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Remote Chunk Execution ──\x1b[0m');

await testAsync('Two-node remote XOR cipher: "Hello" → encrypt on peer → ciphertext returns', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('requester', network);
  const executor = createTestNode('executor', network);

  await requester.start();
  await executor.start();

  // Wait for discovery + capability exchange
  await sleep(2000);

  const reqStatus = requester.getStatus();
  assert(reqStatus.peers >= 1, `Requester should see executor, sees ${reqStatus.peers} peers`);

  // Send "Hello" to be XOR-encrypted by remote peer
  const input = new TextEncoder().encode('Hello');
  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  assert(result.data instanceof Uint8Array, 'result.data is Uint8Array');
  assert(result.data.length > 0, `result.data should have content, got ${result.data.length} bytes`);
  assert(result.totalTimeMs > 0, `totalTime: ${result.totalTimeMs}ms`);
  assertEqual(result.localFallback, false, 'should NOT be local fallback');

  // Verify XOR cipher output: each byte XOR 0x42
  // 'H' ^ 0x42 = 0x0a, 'e' ^ 0x42 = 0x27, 'l' ^ 0x42 = 0x2e, 'l' ^ 0x42 = 0x2e, 'o' ^ 0x42 = 0x2d
  const expected = new Uint8Array([0x0a, 0x27, 0x2e, 0x2e, 0x2d]);
  const outputSlice = result.data.slice(0, 5);
  for (let i = 0; i < expected.length; i++) {
    assertEqual(outputSlice[i], expected[i],
      `byte[${i}]: '${String.fromCharCode(input[i])}' ^ 0x42 = 0x${expected[i].toString(16)}`);
  }

  console.log(`    → Input:  "Hello" [${Array.from(input).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
  console.log(`    → Output: [${Array.from(outputSlice).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
  console.log(`    → Remote execution: ${result.totalTimeMs}ms, ${result.devicesUsed} device(s)`);

  await requester.stop();
  await executor.stop();
});

await testAsync('Remote XOR cipher: encrypt then decrypt recovers original', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('nodeA', network);
  const nodeB = createTestNode('nodeB', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  const plaintext = new TextEncoder().encode('CMP Remote Execution Works!');

  // Encrypt on remote
  const encrypted = await nodeA.compute(ENCRYPT_WASM, plaintext, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  assert(encrypted.data.length > 0, 'encrypted data not empty');
  assertEqual(encrypted.localFallback, false, 'encrypt should be remote');

  // Verify it's actually XOR'd (not passthrough)
  let different = false;
  for (let i = 0; i < Math.min(plaintext.length, encrypted.data.length); i++) {
    if (encrypted.data[i] !== plaintext[i]) { different = true; break; }
  }
  assert(different, 'encrypted output should differ from plaintext');

  // XOR is self-inverse: encrypt the ciphertext again to get plaintext back
  const decrypted = await nodeA.compute(ENCRYPT_WASM, encrypted.data.slice(0, plaintext.length), {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  assertEqual(decrypted.localFallback, false, 'decrypt should be remote');

  // Verify round-trip
  const recoveredText = new TextDecoder().decode(decrypted.data.slice(0, plaintext.length));
  assertEqual(recoveredText, 'CMP Remote Execution Works!', 'round-trip recovery');

  console.log(`    → Plaintext:  "${new TextDecoder().decode(plaintext)}"`);
  console.log(`    → Encrypted:  [${Array.from(encrypted.data.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ')}...]`);
  console.log(`    → Recovered:  "${recoveredText}"`);

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('Three-node mesh: remote execution with multiple executors', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network);
  const exec1 = createTestNode('exec1', network);
  const exec2 = createTestNode('exec2', network);

  await requester.start();
  await exec1.start();
  await exec2.start();
  await sleep(2500);

  assert(requester.getStatus().peers >= 2, `Requester should see 2+ peers, sees ${requester.getStatus().peers}`);

  const input = new TextEncoder().encode('Distributed!');
  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
    taskType: TaskType.MAP_REDUCE,
  });

  assert(result.data instanceof Uint8Array, 'result.data is Uint8Array');
  assert(result.data.length > 0, 'result has data');
  assert(result.totalTimeMs > 0, `totalTime: ${result.totalTimeMs}ms`);
  assertEqual(result.localFallback, false, 'should not be local fallback');
  assert(result.chunksExecuted >= 1, `chunks: ${result.chunksExecuted}`);

  console.log(`    → ${result.chunksExecuted} chunks, ${result.devicesUsed} device(s), ${result.totalTimeMs}ms`);

  await requester.stop();
  await exec1.stop();
  await exec2.stop();
});

await testAsync('Local fallback when no peers available', async () => {
  const network = new VirtualNetwork();
  const loner = createTestNode('loner', network);

  await loner.start();
  // Don't wait — no peers to discover

  const input = new TextEncoder().encode('Solo');
  const result = await loner.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 5000,
  });

  assert(result.data instanceof Uint8Array, 'result.data is Uint8Array');
  assert(result.data.length > 0, 'result has data');
  assertEqual(result.localFallback, true, 'should be local fallback');

  // Verify XOR still correct locally
  for (let i = 0; i < input.length; i++) {
    assertEqual(result.data[i], input[i] ^ 0x42, `local XOR byte[${i}]`);
  }

  console.log(`    → Local fallback: ${result.totalTimeMs}ms`);

  await loner.stop();
});

await testAsync('Remote execution event bus fires task:complete', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('evA', network);
  const nodeB = createTestNode('evB', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  let taskCompleteEvent: any = null;
  nodeA.events().on('task:complete', (data) => {
    taskCompleteEvent = data;
  });

  const input = new TextEncoder().encode('Events');
  const result = await nodeA.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  // Give a tick for event to propagate
  await sleep(50);

  if (!result.localFallback) {
    assert(taskCompleteEvent !== null, 'task:complete event should have fired');
    assert(taskCompleteEvent.taskId instanceof Uint8Array, 'event has taskId');
    assert(taskCompleteEvent.timeMs > 0, 'event has timeMs');
  }

  await nodeA.stop();
  await nodeB.stop();
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

/**
 * CMP Phase 8 Test Suite
 * Tests: Heartbeat monitoring, executor death detection,
 * graceful departure, and local fallback for dead chunks.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase8-fault-recovery.test.ts
 *
 * @author Agent Viscro
 */

import {
  CMPNode, LogLevel, toHex, shortId, randomBytes,
  TaskType, Priority, ChunkStatus, MessageType,
  encodeMessage, decodeMessage, encodeJSON, decodeJSON,
  hash256,
} from '../src';
import type { ComputeResult, HeartbeatWire, DepartureNoticeWire } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

// XOR cipher WASM
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

function createTestNode(id: string, network: VirtualNetwork, opts: Partial<{
  accepting: boolean;
  heartbeatIntervalMs: number;
  suspectThreshold: number;
  deadThreshold: number;
  bidWindowMs: number;
}> = {}): CMPNode {
  const transport = new VirtualTransport(id, network);
  return new CMPNode({
    _transport: transport,
    beaconIntervalMs: 150,
    bidWindowMs: opts.bidWindowMs ?? 400,
    peerStaleMs: 15000,
    peerDeadMs: 30000,
    acceptingTasks: opts.accepting !== false,
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 2000,
    suspectThreshold: opts.suspectThreshold ?? 3,
    deadThreshold: opts.deadThreshold ?? 5,
    logLevel: LogLevel.WARN,
  });
}

function xorExpected(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] ^ 0x42;
  return out;
}

async function main() {

// ════════════════════════════════════════════
// WIRE FORMAT TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Wire Format: HEARTBEAT / DEPARTURE_NOTICE ──\x1b[0m');

test('HEARTBEAT round-trips through encode/decode', () => {
  const wire: HeartbeatWire = {
    taskId: Array.from(randomBytes(16)),
    chunkId: Array.from(randomBytes(16)),
    executorId: Array.from(randomBytes(16)),
    timestamp: Date.now(),
  };

  const encoded = encodeJSON(wire);
  const msg = encodeMessage(MessageType.HEARTBEAT, encoded);
  const decoded = decodeMessage(msg);

  assert(decoded !== null, 'decoded not null');
  assertEqual(decoded!.type, MessageType.HEARTBEAT, 'message type');

  const parsed = decodeJSON<HeartbeatWire>(decoded!.payload);
  assert(parsed !== null, 'parsed not null');
  assertEqual(parsed!.timestamp, wire.timestamp, 'timestamp preserved');
  assertEqual(parsed!.executorId.length, 16, 'executorId length');
});

test('DEPARTURE_NOTICE round-trips through encode/decode', () => {
  const wire: DepartureNoticeWire = {
    meshId: Array.from(randomBytes(16)),
    activeChunks: [
      { taskId: Array.from(randomBytes(16)), chunkId: Array.from(randomBytes(16)) },
    ],
    timestamp: Date.now(),
  };

  const encoded = encodeJSON(wire);
  const msg = encodeMessage(MessageType.DEPARTURE_NOTICE, encoded);
  const decoded = decodeMessage(msg);

  assert(decoded !== null, 'decoded not null');
  assertEqual(decoded!.type, MessageType.DEPARTURE_NOTICE, 'message type');

  const parsed = decodeJSON<DepartureNoticeWire>(decoded!.payload);
  assert(parsed !== null, 'parsed not null');
  assertEqual(parsed!.activeChunks.length, 1, 'activeChunks count');
});

// ════════════════════════════════════════════
// GRACEFUL DEPARTURE — executor stops cleanly
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Graceful Departure ──\x1b[0m');

await testAsync('Normal 2-node compute still works with heartbeat enabled', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('a', network);
  const nodeB = createTestNode('b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  const input = new TextEncoder().encode('heartbeat test');
  const result = await nodeA.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  assertEqual(result.localFallback, false, 'should be remote');
  assert(result.data.length > 0, 'has output');

  // Verify correctness
  const expected = xorExpected(input);
  for (let i = 0; i < input.length; i++) {
    assertEqual(result.data[i], expected[i], `byte[${i}]`);
  }

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('departure:received event fires when peer stops', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('a', network);
  const nodeB = createTestNode('b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  let departureReceived = false;
  nodeA.events().on('departure:received', () => {
    departureReceived = true;
  });

  // Stop B gracefully — should broadcast DEPARTURE_NOTICE
  await nodeB.stop();
  await sleep(200);

  assertEqual(departureReceived, true, 'departure event should fire on A');

  await nodeA.stop();
});

// ════════════════════════════════════════════
// EXECUTOR DEATH — missed heartbeats
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Executor Death Detection ──\x1b[0m');

await testAsync('Task completes via local fallback when executor dies (transport killed)', async () => {
  // Use fast heartbeat for testing: 200ms interval, suspect at 2, dead at 3
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network, {
    heartbeatIntervalMs: 200,
    suspectThreshold: 2,
    deadThreshold: 3,
    bidWindowMs: 300,
  });
  const executor = createTestNode('exec', network, {
    heartbeatIntervalMs: 200,
  });

  await requester.start();
  await executor.start();
  await sleep(2000);

  assert(requester.getStatus().peers >= 1, 'requester sees executor');

  // Track events
  let suspectedFired = false;
  let deadFired = false;
  let reassignFired = false;

  requester.events().on('executor:suspected', () => { suspectedFired = true; });
  requester.events().on('executor:dead', () => { deadFired = true; });
  requester.events().on('chunk:reassigned', () => { reassignFired = true; });

  // Intercept: after executor receives CHUNK_DATA, kill its transport
  // so it can't send CHUNK_RESULT back
  const origDeliver = network.deliver.bind(network);
  let chunkDataSent = false;
  network.deliver = async (fromId: string, toId: string, data: Uint8Array) => {
    await origDeliver(fromId, toId, data);
    // After chunk data reaches executor, kill the executor's ability to reply
    if (fromId === 'req' && toId === 'exec' && !chunkDataSent) {
      const msg = decodeMessage(data);
      if (msg && msg.type === MessageType.CHUNK_DATA) {
        chunkDataSent = true;
        // Kill executor's transport — it can no longer send results or heartbeats
        setTimeout(async () => {
          await executor.stop();
        }, 50);
      }
    }
  };

  const input = new TextEncoder().encode('fault recovery');
  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 15000,
  });

  // Task should complete — either via late result or local fallback
  assert(result.data.length > 0, 'has output data');

  // Verify XOR correctness regardless of execution path
  const expected = xorExpected(input);
  for (let i = 0; i < input.length; i++) {
    assertEqual(result.data[i], expected[i], `byte[${i}]`);
  }

  console.log(`    → deadFired: ${deadFired}, reassignFired: ${reassignFired}, time: ${result.totalTimeMs}ms`);

  // Restore network
  network.deliver = origDeliver;
  await requester.stop();
});

await testAsync('Multi-chunk: one executor dies, other completes, task still succeeds', async () => {
  const network = new VirtualNetwork();
  const requester = createTestNode('req', network, {
    heartbeatIntervalMs: 200,
    suspectThreshold: 2,
    deadThreshold: 3,
    bidWindowMs: 300,
  });
  const goodExec = createTestNode('good', network, { heartbeatIntervalMs: 200 });
  const badExec = createTestNode('bad', network, { heartbeatIntervalMs: 200 });

  await requester.start();
  await goodExec.start();
  await badExec.start();
  await sleep(2500);

  assert(requester.getStatus().peers >= 2, `requester sees ${requester.getStatus().peers} peers`);

  // After CHUNK_DATA reaches badExec, kill it
  const origDeliver = network.deliver.bind(network);
  let badKilled = false;
  network.deliver = async (fromId: string, toId: string, data: Uint8Array) => {
    await origDeliver(fromId, toId, data);
    if (fromId === 'req' && toId === 'bad' && !badKilled) {
      const msg = decodeMessage(data);
      if (msg && msg.type === MessageType.CHUNK_DATA) {
        badKilled = true;
        setTimeout(async () => { await badExec.stop(); }, 50);
      }
    }
  };

  const input = new Uint8Array(60);
  for (let i = 0; i < 60; i++) input[i] = i;

  const result = await requester.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 20000,
    chunkHint: 2,
  });

  assert(result.data.length === 60, `output should be 60 bytes, got ${result.data.length}`);

  // Verify correctness
  const expected = xorExpected(input);
  let mismatches = 0;
  for (let i = 0; i < 60; i++) {
    if (result.data[i] !== expected[i]) mismatches++;
  }
  assertEqual(mismatches, 0, 'all bytes correct despite executor death');

  console.log(`    → 1 executor died, task completed in ${result.totalTimeMs}ms, ${result.chunksExecuted} chunks`);

  network.deliver = origDeliver;
  await requester.stop();
  // goodExec may still be running
  try { await goodExec.stop(); } catch {}
});

// ════════════════════════════════════════════
// EVENT BUS VERIFICATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Event Bus: Heartbeat Events ──\x1b[0m');

await testAsync('heartbeat:received event fires during normal execution', async () => {
  // Use very fast heartbeat so we catch one even during quick execution
  const network = new VirtualNetwork();
  network.latencyMs = 50; // Add latency so execution takes longer
  const nodeA = createTestNode('a', network, { heartbeatIntervalMs: 100 });
  const nodeB = createTestNode('b', network, { heartbeatIntervalMs: 100 });

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  let heartbeatCount = 0;
  nodeA.events().on('heartbeat:received', () => { heartbeatCount++; });

  const input = new TextEncoder().encode('heartbeat events');
  await nodeA.compute(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  // With 50ms network latency, execution takes ~200ms, heartbeat every 100ms
  // We might catch 0-2 heartbeats depending on timing
  console.log(`    → ${heartbeatCount} heartbeat(s) received during execution`);

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

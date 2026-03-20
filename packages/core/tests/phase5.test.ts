/**
 * CMP Phase 5 Test Suite
 * Tests: CMPNode lifecycle, compute API, multi-node compute,
 * mesh status, peer info, and the CLI benchmark flow.
 *
 * Run: npx tsx packages/core/tests/phase5.test.ts
 *
 * @author Agent Viscro
 */

import { CMPNode, LogLevel, toHex, shortId, randomBytes, TaskType, Priority } from '../src';
import type { ComputeResult, MeshStatus, PeerInfo } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

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
// CMPNODE LIFECYCLE TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CMPNode Lifecycle Tests ──\x1b[0m');

test('CMPNode creates with valid mesh ID', () => {
  const network = new VirtualNetwork();
  const node = createTestNode('test', network);
  assert(node.meshIdHex().length === 32, 'hex ID is 32 chars');
  assert(node.shortMeshId().length === 8, 'short ID is 8 chars');
  assert(node.getMeshId().length === 16, 'raw ID is 16 bytes');
  assert(!node.isRunning(), 'not running before start');
});

await testAsync('CMPNode starts and stops', async () => {
  const network = new VirtualNetwork();
  const node = createTestNode('test', network);

  await node.start();
  assert(node.isRunning(), 'running after start');

  const status = node.getStatus();
  assertEqual(status.running, true, 'status.running');
  assert(status.uptime >= 0, 'has uptime');
  assert(status.meshId.length === 32, 'has mesh ID');

  await node.stop();
  assert(!node.isRunning(), 'not running after stop');
});

await testAsync('CMPNode events() returns EventBus', async () => {
  const network = new VirtualNetwork();
  const node = createTestNode('test', network);
  const bus = node.events();
  assert(bus !== null, 'bus exists');
  assert(typeof bus.on === 'function', 'bus.on is function');
});

await testAsync('CMPNode setAcceptingTasks works', async () => {
  const network = new VirtualNetwork();
  const node = createTestNode('test', network);
  await node.start();

  node.setAcceptingTasks(false);
  node.setAcceptingTasks(true);
  // No error = works

  await node.stop();
});

await testAsync('CMPNode rejects compute when not running', async () => {
  const network = new VirtualNetwork();
  const node = createTestNode('test', network);

  let threw = false;
  try {
    await node.compute(ADD_WASM, new Uint8Array(10), { entryPoint: 'add' });
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('not running'), `expected 'not running' error, got: ${err.message}`);
  }
  assert(threw, 'threw on compute when not running');
});

// ════════════════════════════════════════════
// MESH FORMATION TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Mesh Formation Tests ──\x1b[0m');

await testAsync('Two CMPNodes discover each other', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('node-a', network);
  const nodeB = createTestNode('node-b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(1500);

  assert(nodeA.getStatus().peers >= 1, `A sees ${nodeA.getStatus().peers} peers`);
  assert(nodeB.getStatus().peers >= 1, `B sees ${nodeB.getStatus().peers} peers`);

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('Five CMPNodes form full mesh', async () => {
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];

  for (let i = 0; i < 5; i++) {
    nodes.push(createTestNode(`node-${i}`, network));
  }
  for (const n of nodes) await n.start();
  await sleep(2000);

  for (let i = 0; i < nodes.length; i++) {
    const peers = nodes[i].getStatus().peers;
    assert(peers >= 3, `Node ${i} sees ${peers} peers (expected ≥3)`);
  }

  for (const n of nodes) await n.stop();
});

await testAsync('getPeers returns peer info', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('node-a', network);
  const nodeB = createTestNode('node-b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(1500);

  const peers = nodeA.getPeers();
  assert(peers.length >= 1, `got ${peers.length} peers`);

  const peer = peers[0];
  assert(peer.meshId.length === 32, 'meshId hex');
  assert(peer.shortId.length === 8, 'shortId');
  assert(peer.state === 'active', `state: ${peer.state}`);
  assert(peer.transports.length > 0, 'has transports');

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('Mesh resources aggregate correctly', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('node-a', network);
  const nodeB = createTestNode('node-b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(1500);

  const resources = nodeA.getStatus().resources;
  assert(resources.peerCount >= 1, `peerCount: ${resources.peerCount}`);
  assert(resources.totalCores >= 1, `totalCores: ${resources.totalCores}`);
  assert(resources.totalMemoryMb > 0, `totalMem: ${resources.totalMemoryMb}`);

  await nodeA.stop();
  await nodeB.stop();
});

// ════════════════════════════════════════════
// COMPUTE API TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Compute API Tests ──\x1b[0m');

await testAsync('Single node local fallback compute', async () => {
  const network = new VirtualNetwork();
  const node = createTestNode('solo', network);
  await node.start();
  await sleep(300); // No peers

  const result = await node.compute(ADD_WASM, new Uint8Array(64), {
    entryPoint: 'add',
    deadline: 5000,
  });

  assert(result.localFallback === true, 'local fallback');
  assert(result.totalTimeMs > 0, `totalTime: ${result.totalTimeMs}ms`);
  assertEqual(result.devicesUsed, 1, 'devices used');
  assertEqual(result.chunksExecuted, 1, 'chunks executed');
  assert(result.taskId.length === 16, 'has taskId');

  await node.stop();
});

await testAsync('Two-node mesh compute', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('requester', network);
  const nodeB = createTestNode('executor', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(1500);

  assert(nodeA.getStatus().peers >= 1, 'A sees peers');

  const result = await nodeA.compute(ADD_WASM, new Uint8Array(256), {
    entryPoint: 'add',
    deadline: 10000,
  });

  assert(result.totalTimeMs > 0, `totalTime: ${result.totalTimeMs}ms`);
  assert(result.chunksExecuted >= 1, `chunks: ${result.chunksExecuted}`);
  assert(result.taskId.length === 16, 'has taskId');
  assert(result.data instanceof Uint8Array, 'data is Uint8Array');

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('Five-node mesh distributed compute', async () => {
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(createTestNode(`node-${i}`, network));
  }
  for (const n of nodes) await n.start();
  await sleep(2000);

  // Submit from node 0
  const result = await nodes[0].compute(ADD_WASM, new Uint8Array(512), {
    entryPoint: 'add',
    deadline: 10000,
    taskType: TaskType.MAP_REDUCE,
  });

  assert(result.totalTimeMs > 0, `totalTime: ${result.totalTimeMs}`);
  assert(result.chunksExecuted >= 1, `chunks: ${result.chunksExecuted}`);

  for (const n of nodes) await n.stop();
});

await testAsync('Multiple sequential computes on same node', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('requester', network);
  const nodeB = createTestNode('executor', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(1500);

  // Submit 3 tasks sequentially
  for (let i = 0; i < 3; i++) {
    const result = await nodeA.compute(ADD_WASM, new Uint8Array(64 * (i + 1)), {
      entryPoint: 'add',
      deadline: 5000,
    });
    assert(result.totalTimeMs > 0, `task ${i} completed in ${result.totalTimeMs}ms`);
  }

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('Compute with high priority', async () => {
  const network = new VirtualNetwork();
  const node = createTestNode('solo', network);
  await node.start();
  await sleep(300);

  const result = await node.compute(ADD_WASM, new Uint8Array(32), {
    entryPoint: 'add',
    deadline: 5000,
    priority: Priority.CRITICAL,
  });

  assert(result.totalTimeMs > 0, 'completed');
  await node.stop();
});

// ════════════════════════════════════════════
// CLI BENCHMARK SIMULATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CLI Benchmark Simulation ──\x1b[0m');

await testAsync('Benchmark: 5-node mesh formation + compute', async () => {
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];

  const meshStart = Date.now();

  for (let i = 0; i < 5; i++) {
    nodes.push(createTestNode(`bench-${i}`, network));
  }
  for (const n of nodes) await n.start();
  await sleep(2000);

  const meshTime = Date.now() - meshStart;
  const peers = nodes[0].getStatus().peers;
  assert(peers >= 3, `mesh formed with ${peers} peers`);
  assert(meshTime < 10000, `mesh formation took ${meshTime}ms (expected < 10s)`);

  // Compute
  const computeStart = Date.now();
  const result = await nodes[0].compute(ADD_WASM, new Uint8Array(1024), {
    entryPoint: 'add',
    deadline: 5000,
  });
  const computeTime = Date.now() - computeStart;

  assert(computeTime < 10000, `compute took ${computeTime}ms (expected < 10s)`);
  assert(result.chunksExecuted >= 1, 'chunks executed');

  for (const n of nodes) await n.stop();

  console.log(`    ${'\x1b[2m'}Mesh: ${meshTime}ms | Compute: ${computeTime}ms | Peers: ${peers}${'\x1b[0m'}`);
});

// ════════════════════════════════════════════
// UNIQUE MESH IDS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Identity Tests ──\x1b[0m');

test('All CMPNodes get unique mesh IDs', () => {
  const network = new VirtualNetwork();
  const ids = new Set<string>();

  for (let i = 0; i < 20; i++) {
    const node = createTestNode(`node-${i}`, network);
    const id = node.meshIdHex();
    assert(!ids.has(id), `Duplicate: ${id}`);
    ids.add(id);
  }
  assertEqual(ids.size, 20, '20 unique IDs');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) {
  console.log('\n  Failed tests:');
  errors.forEach((e) => console.log(e));
}
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);

} // end main
main();

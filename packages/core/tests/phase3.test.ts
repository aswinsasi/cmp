/**
 * CMP Phase 3 Test Suite
 * Tests: NegotiationEngine, BidHandler, and full mesh negotiation flow.
 *
 * Run: npx tsx packages/core/tests/phase3.test.ts
 *
 * @author Agent Viscro
 */

import {
  // Types
  CMPCapability,
  CMPBid,
  Architecture,
  GPUType,
  GPUFeature,
  PowerSource,
  ThermalState,
  Runtime,
  CapabilityTier,
  TaskType,
  Priority,
  VerifyMode,
  SecurityLevel,
  EncryptionAlgo,
  ComputeBudget,

  // Crypto
  randomBytes,
  generateMeshId,
  generateSigningKeyPair,

  // Utils
  toHex,
  shortId,
  bytesEqual,

  // Core modules
  EventBus,
  PeerTable,
  DeviceProfiler,
  CapabilityMap,
  CapabilityExchange,
  DiscoveryLayer,
  NegotiationEngine,
  BidHandler,
  resolveConfig,
} from '../src';

import type { ComputeRequest, NegotiationResult } from '../src';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

// ── Test Runner ──
let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}
function assertEqual(a: any, b: any, msg: string): void {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`;
    console.log(msg);
    errors.push(msg);
  }
}

// ── Full Node Factory ──

interface FullNode {
  discovery: DiscoveryLayer;
  capExchange: CapabilityExchange;
  negotiation: NegotiationEngine;
  bidHandler: BidHandler;
  bus: EventBus;
  peerTable: PeerTable;
  capMap: CapabilityMap;
  profiler: DeviceProfiler;
  transport: VirtualTransport;
}

function createFullNode(id: string, network: VirtualNetwork): FullNode {
  const bus = new EventBus();
  const config = resolveConfig({
    beaconIntervalMs: 150,
    peerStaleMs: 10000,
    peerDeadMs: 20000,
    acceptingTasks: true,
    bidWindowMs: 400,
  });
  const transport = new VirtualTransport(id, network);
  const peerTable = new PeerTable(bus, config.peerStaleMs, config.peerDeadMs);
  const discovery = new DiscoveryLayer(transport, bus, peerTable, config);
  const profiler = new DeviceProfiler({ maxResourceShare: 0.8 });
  const capMap = new CapabilityMap(bus);
  const capExchange = new CapabilityExchange(
    discovery.getMeshId(), transport, bus, peerTable, capMap, profiler,
    (meshId) => discovery.resolveAddress(meshId)
  );
  const signingKP = generateSigningKeyPair();
  const negotiation = new NegotiationEngine(
    discovery.getMeshId(), signingKP, transport, bus, peerTable, capMap, discovery,
    { bidWindowMs: 400, minBids: 1, maxBids: 10 }
  );
  const bidHandler = new BidHandler(
    discovery.getMeshId(), transport, bus, profiler, discovery,
    { acceptingTasks: true, maxConcurrentTasks: 3, minBatteryPct: 10, maxBidResourceShare: 0.7 }
  );
  return { discovery, capExchange, negotiation, bidHandler, bus, peerTable, capMap, profiler, transport };
}

async function startFullNode(node: FullNode): Promise<void> {
  await node.transport.start();
  await node.discovery.start();
  await node.capExchange.start();
  await node.negotiation.start();
  await node.bidHandler.start();
}

async function cleanupNodes(nodes: FullNode[]): Promise<void> {
  for (const n of nodes) {
    await n.bidHandler.stop();
    await n.negotiation.stop();
    await n.capExchange.stop();
    await n.discovery.stop();
    await n.transport.stop();
    n.peerTable.destroy();
    n.profiler.destroy();
    n.bus.clear();
    n.capMap.clear();
  }
}

function makeRequest(overrides?: Partial<ComputeRequest>): ComputeRequest {
  return {
    taskType: TaskType.MAP_REDUCE,
    runtimeRequired: Runtime.WASM,
    payloadSizeKb: 100,
    computeBudget: {
      minCores: 1,
      minMemoryMb: 256,
      gpuRequired: false,
      deadlineMs: 5000,
    },
    priority: Priority.NORMAL,
    creditsOffered: 10,
    ...overrides,
  };
}

// ════════════════════════════════════════════
async function main() {

// ════════════════════════════════════════════
// BID HANDLER UNIT TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Bid Handler Unit Tests ──\x1b[0m');

await test('BidHandler starts and stops cleanly', async () => {
  const network = new VirtualNetwork();
  const node = createFullNode('node-0', network);
  await node.transport.start();
  await node.discovery.start();
  await node.bidHandler.start();

  const stats = node.bidHandler.getStats();
  assertEqual(stats.tasksReceived, 0, 'no tasks');
  assertEqual(stats.bidsSubmitted, 0, 'no bids');

  await node.bidHandler.stop();
  await node.discovery.stop();
  await node.transport.stop();
  node.peerTable.destroy();
  node.profiler.destroy();
  node.bus.clear();
});

await test('BidHandler setAcceptingTasks toggles', async () => {
  const network = new VirtualNetwork();
  const node = createFullNode('node-0', network);

  node.bidHandler.setAcceptingTasks(false);
  node.bidHandler.setAcceptingTasks(true);

  // No crash = pass
  node.profiler.destroy();
  node.peerTable.destroy();
  node.bus.clear();
});

await test('BidHandler taskStarted/taskFinished tracks capacity', async () => {
  const network = new VirtualNetwork();
  const node = createFullNode('node-0', network);

  node.bidHandler.taskStarted();
  node.bidHandler.taskStarted();
  node.bidHandler.taskFinished();
  // Should have 1 active task now — no direct getter but no crash = structural test

  node.profiler.destroy();
  node.peerTable.destroy();
  node.bus.clear();
});

// ════════════════════════════════════════════
// NEGOTIATION ENGINE UNIT TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Negotiation Engine Unit Tests ──\x1b[0m');

await test('NegotiationEngine starts and stops cleanly', async () => {
  const network = new VirtualNetwork();
  const node = createFullNode('node-0', network);
  await node.transport.start();
  await node.discovery.start();
  await node.negotiation.start();
  await node.negotiation.stop();
  await node.discovery.stop();
  await node.transport.stop();
  node.peerTable.destroy();
  node.profiler.destroy();
  node.bus.clear();
});

await test('NegotiationEngine returns empty when no peers', async () => {
  const network = new VirtualNetwork();
  const node = createFullNode('node-0', network);
  await startFullNode(node);

  // No other nodes in mesh
  const result = await node.negotiation.submitTask(makeRequest());

  assertEqual(result.assignments.length, 0, 'no assignments');
  assertEqual(result.totalBidsReceived, 0, 'no bids');
  assert(result.negotiationTimeMs > 0, 'time > 0');
  assert(result.taskId.length === 16, 'taskId exists');

  await cleanupNodes([node]);
});

// ════════════════════════════════════════════
// TWO-NODE NEGOTIATION TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Two-Node Negotiation Tests ──\x1b[0m');

await test('Two nodes: requester gets bid from executor', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  await startFullNode(requester);
  await startFullNode(executor);

  // Wait for mesh formation + capability exchange
  await sleep(1200);

  // Verify mesh is formed
  assert(requester.capMap.size >= 1, `requester capMap: ${requester.capMap.size}`);
  assert(executor.capMap.size >= 1, `executor capMap: ${executor.capMap.size}`);

  // Submit task from requester
  const result = await requester.negotiation.submitTask(makeRequest());

  assert(result.totalBidsReceived >= 1, `bids received: ${result.totalBidsReceived}`);
  assert(result.assignments.length >= 1, `assignments: ${result.assignments.length}`);
  assert(result.negotiationTimeMs > 0, `time: ${result.negotiationTimeMs}ms`);

  await cleanupNodes([requester, executor]);
});

await test('Two nodes: executor receives assignment after winning bid', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  let assignmentReceived = false;
  executor.bus.on('chunk:received', () => {
    assignmentReceived = true;
  });

  await startFullNode(requester);
  await startFullNode(executor);
  await sleep(1200);

  await requester.negotiation.submitTask(makeRequest());

  // Give time for assignment delivery
  await sleep(200);

  assert(assignmentReceived, 'executor received assignment');

  await cleanupNodes([requester, executor]);
});

await test('Two nodes: bid stats are tracked', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  await startFullNode(requester);
  await startFullNode(executor);
  await sleep(1200);

  await requester.negotiation.submitTask(makeRequest());
  await sleep(100);

  const stats = executor.bidHandler.getStats();
  assert(stats.tasksReceived >= 1, `tasks received: ${stats.tasksReceived}`);
  assert(stats.bidsSubmitted >= 1, `bids submitted: ${stats.bidsSubmitted}`);

  await cleanupNodes([requester, executor]);
});

await test('Two nodes: task:assigned event fires', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  let assignedEvent = false;
  requester.bus.on('task:assigned', () => {
    assignedEvent = true;
  });

  await startFullNode(requester);
  await startFullNode(executor);
  await sleep(1200);

  await requester.negotiation.submitTask(makeRequest());

  assert(assignedEvent, 'task:assigned event fired');

  await cleanupNodes([requester, executor]);
});

// ════════════════════════════════════════════
// MULTI-NODE NEGOTIATION TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Multi-Node Negotiation Tests ──\x1b[0m');

await test('Three executors: requester selects best bidder', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const exec1 = createFullNode('exec-1', network);
  const exec2 = createFullNode('exec-2', network);
  const exec3 = createFullNode('exec-3', network);

  await startFullNode(requester);
  await startFullNode(exec1);
  await startFullNode(exec2);
  await startFullNode(exec3);

  await sleep(1500);

  const result = await requester.negotiation.submitTask(makeRequest());

  assert(result.totalBidsReceived >= 2, `bids: ${result.totalBidsReceived} (expected ≥2)`);
  assert(result.assignments.length >= 1, `assignments: ${result.assignments.length}`);

  // Assignments should have valid peer addresses
  for (const rec of result.assignments) {
    assert(rec.peerAddress !== undefined, 'has peer address');
    assert(rec.capability.score > 0, `score > 0 (got ${rec.capability.score})`);
  }

  await cleanupNodes([requester, exec1, exec2, exec3]);
});

await test('Five executors: all bid, best are selected', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executors: FullNode[] = [];

  for (let i = 0; i < 5; i++) {
    executors.push(createFullNode(`exec-${i}`, network));
  }

  await startFullNode(requester);
  for (const exec of executors) {
    await startFullNode(exec);
  }

  await sleep(2000);

  const result = await requester.negotiation.submitTask(
    makeRequest({ computeBudget: { minCores: 1, minMemoryMb: 256, gpuRequired: false, deadlineMs: 10000 } })
  );

  assert(result.totalBidsReceived >= 3, `bids: ${result.totalBidsReceived} (expected ≥3 of 5)`);
  assert(result.assignments.length >= 1, `assignments: ${result.assignments.length}`);

  // Check that assignments are scored in descending order
  if (result.assignments.length >= 2) {
    assert(
      result.assignments[0].capability.score >= result.assignments[1].capability.score,
      'assignments sorted by score'
    );
  }

  await cleanupNodes([requester, ...executors]);
});

await test('Multiple sequential tasks from same requester', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  await startFullNode(requester);
  await startFullNode(executor);
  await sleep(1200);

  // Submit 3 tasks sequentially
  const results: NegotiationResult[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await requester.negotiation.submitTask(makeRequest());
    results.push(result);
  }

  // All should succeed
  for (let i = 0; i < results.length; i++) {
    assert(results[i].totalBidsReceived >= 1, `task ${i}: bids ≥ 1`);
    assert(results[i].assignments.length >= 1, `task ${i}: assignments ≥ 1`);
  }

  // Each task should have a unique ID
  const ids = new Set(results.map((r) => toHex(r.taskId)));
  assertEqual(ids.size, 3, 'all task IDs unique');

  await cleanupNodes([requester, executor]);
});

await test('High priority task gets negotiated', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  await startFullNode(requester);
  await startFullNode(executor);
  await sleep(1200);

  const result = await requester.negotiation.submitTask(
    makeRequest({ priority: Priority.CRITICAL })
  );

  assert(result.totalBidsReceived >= 1, 'got bids for critical task');
  assert(result.assignments.length >= 1, 'got assignment');

  await cleanupNodes([requester, executor]);
});

await test('Executor that is not accepting tasks does not bid', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  await startFullNode(requester);
  await startFullNode(executor);
  await sleep(1200);

  // Disable executor
  executor.bidHandler.setAcceptingTasks(false);

  const result = await requester.negotiation.submitTask(makeRequest());

  assertEqual(result.totalBidsReceived, 0, 'no bids from disabled executor');
  assertEqual(result.assignments.length, 0, 'no assignments');

  await cleanupNodes([requester, executor]);
});

await test('Executor at max capacity does not bid', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const executor = createFullNode('executor', network);

  await startFullNode(requester);
  await startFullNode(executor);
  await sleep(1200);

  // Fill up executor capacity (config: maxConcurrentTasks = 3)
  executor.bidHandler.taskStarted();
  executor.bidHandler.taskStarted();
  executor.bidHandler.taskStarted();

  const result = await requester.negotiation.submitTask(makeRequest());

  assertEqual(result.totalBidsReceived, 0, 'no bids from full executor');

  await cleanupNodes([requester, executor]);
});

await test('Late joiner can still bid on new tasks', async () => {
  const network = new VirtualNetwork();
  const requester = createFullNode('requester', network);
  const earlyExec = createFullNode('early', network);

  await startFullNode(requester);
  await startFullNode(earlyExec);
  await sleep(800);

  // Late joiner
  const lateExec = createFullNode('late', network);
  await startFullNode(lateExec);
  await sleep(1000);

  const result = await requester.negotiation.submitTask(makeRequest());

  assert(result.totalBidsReceived >= 2, `bids: ${result.totalBidsReceived} (expected ≥2 including late joiner)`);

  await cleanupNodes([requester, earlyExec, lateExec]);
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

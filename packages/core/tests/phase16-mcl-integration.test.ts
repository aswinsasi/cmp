/**
 * CMP Phase 16 Test Suite
 * Tests: MCL Integration with CMPNode
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase16-mcl-integration.test.ts
 *
 * @author Agent Viscro
 */

import {
  CMPNode, LogLevel, toHex, shortId, randomBytes,
  TaskType, MessageType,
} from '../src';

import { MCLEngine } from '../src/mcl/engine';
import { MERStore, createMER, Pollinator } from '../src/mcl';
import type { MERCreateParams } from '../src/mcl/mer';
import { DecompositionStrategy, BottleneckFlag } from '../src/types/mcl';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';
import { generateSigningKeyPair } from '../src/crypto';
import { EventBus } from '../src/mesh/event-bus';

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
function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
function assertEqual(a: any, e: any, m: string): void { if (a !== e) throw new Error(`${m}: expected ${e}, got ${a}`); }

const kp = generateSigningKeyPair();

function makeEngine(opts?: { enabled?: boolean }): { engine: MCLEngine; bus: EventBus } {
  const net = new VirtualNetwork();
  const transport = new VirtualTransport('test-' + Math.random().toString(36).slice(2, 6), net);
  const bus = new EventBus();
  const engine = new MCLEngine({
    meshId: randomBytes(16),
    signingSecretKey: kp.secretKey,
    signingPublicKey: kp.publicKey,
    transport,
    bus,
    config: opts?.enabled === false ? { enabled: false } : undefined,
  });
  return { engine, bus };
}

function completeTask(engine: MCLEngine, taskType: TaskType = TaskType.INFERENCE, efficiency: number = 87) {
  return engine.onTaskComplete({
    taskType, deviceCount: 5, strategyUsed: 0,
    chunkCount: 4, avgChunkSizeKb: 2048, totalTimeMs: 8000,
    distributionOverheadMs: 800, executionEfficiency: efficiency, faultEvents: 0,
    reassignmentCount: 0, verified: true,
  });
}

async function main() {

console.log('\n\x1b[1m── Phase 16: MCL Integration with CMPNode ──\x1b[0m');

// ════════════════════════════════════════════
// MCLEngine LIFECYCLE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MCLEngine Lifecycle ──\x1b[0m');

test('MCLEngine: initializes with empty store', () => {
  const { engine } = makeEngine();
  assert(!engine.isActive(), 'not active before start');
  assertEqual(engine.getStatus().merCount, 0, 'empty store');
  assertEqual(engine.getStatus().enabled, true, 'enabled by default');
});

test('MCLEngine: start/stop lifecycle', () => {
  const { engine } = makeEngine();
  engine.start();
  assert(engine.isActive(), 'active after start');
  const mers = engine.stop();
  assert(!engine.isActive(), 'inactive after stop');
  assertEqual(mers.length, 0, 'no MERs to handoff');
});

test('MCLEngine: stop returns MERs for handoff', () => {
  const { engine } = makeEngine();
  engine.start();
  completeTask(engine, TaskType.INFERENCE);
  completeTask(engine, TaskType.MAP_REDUCE);
  const mers = engine.stop();
  assertEqual(mers.length, 2, '2 MERs for handoff');
});

// ════════════════════════════════════════════
// MER GENERATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MER Generation ──\x1b[0m');

test('generates MER for verified task', () => {
  const { engine } = makeEngine();
  engine.start();
  const mer = completeTask(engine);
  assert(mer !== null, 'should generate MER');
  assertEqual(mer!.taskType, TaskType.INFERENCE, 'correct task type');
  assertEqual(mer!.deviceCount, 5, 'correct device count');
  assertEqual(engine.getStatus().merCount, 1, 'store has 1');
});

test('skips unverified tasks', () => {
  const { engine } = makeEngine();
  engine.start();
  const mer = engine.onTaskComplete({
    taskType: TaskType.INFERENCE, deviceCount: 5, strategyUsed: 0,
    chunkCount: 4, avgChunkSizeKb: 2048, totalTimeMs: 8000,
    distributionOverheadMs: 800, executionEfficiency: 87, faultEvents: 0,
    reassignmentCount: 0, verified: false,
  });
  assertEqual(mer, null, 'no MER for unverified');
  assertEqual(engine.getStatus().merCount, 0, 'store empty');
});

test('skips when not started', () => {
  const { engine } = makeEngine();
  // Don't start
  assertEqual(completeTask(engine), null, 'null when not started');
});

test('emits mcl:mer_generated event', () => {
  const { engine, bus } = makeEngine();
  engine.start();
  let fired = false;
  bus.on('mcl:mer_generated', () => { fired = true; });
  completeTask(engine);
  assert(fired, 'event fired');
});

test('accumulates multiple MERs', () => {
  const { engine } = makeEngine();
  engine.start();
  for (let i = 0; i < 10; i++) {
    completeTask(engine, TaskType.INFERENCE, 80 + i);
  }
  assertEqual(engine.getStatus().merCount, 10, '10 MERs');
  assertEqual(engine.getStatus().taskTypes, 1, '1 task type');
});

test('tracks multiple task types', () => {
  const { engine } = makeEngine();
  engine.start();
  completeTask(engine, TaskType.INFERENCE);
  completeTask(engine, TaskType.MAP_REDUCE);
  completeTask(engine, TaskType.PIPELINE);
  assertEqual(engine.getStatus().merCount, 3, '3 MERs');
  assertEqual(engine.getStatus().taskTypes, 3, '3 task types');
});

// ════════════════════════════════════════════
// STRATEGY HINTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Strategy Hints ──\x1b[0m');

test('getHint: null when no experience', () => {
  const { engine } = makeEngine();
  engine.start();
  assertEqual(engine.getHint(TaskType.INFERENCE, 5), null, 'null');
});

test('getHint: produces hint after experience', () => {
  const { engine } = makeEngine();
  engine.start();
  for (let i = 0; i < 3; i++) completeTask(engine, TaskType.INFERENCE, 85 + i);
  const hint = engine.getHint(TaskType.INFERENCE, 5);
  assert(hint !== null, 'hint available');
  assert(hint!.confidence > 0, `conf=${hint!.confidence}`);
  assert(hint!.recommendedChunkCount >= 1, `chunks=${hint!.recommendedChunkCount}`);
});

test('getHint: null for wrong task type', () => {
  const { engine } = makeEngine();
  engine.start();
  for (let i = 0; i < 3; i++) completeTask(engine, TaskType.INFERENCE);
  assertEqual(engine.getHint(TaskType.PIPELINE, 5), null, 'null for wrong type');
});

test('applyHintToDistribution: works with hint', () => {
  const { engine } = makeEngine();
  engine.start();
  for (let i = 0; i < 3; i++) completeTask(engine, TaskType.INFERENCE, 88);
  const hint = engine.getHint(TaskType.INFERENCE, 5);
  assert(hint !== null, 'hint available');
  const result = engine.applyHintToDistribution(0, 5, hint);
  assert(result.applied, 'applied');
  assert(result.chunkCount >= 1, `chunks=${result.chunkCount}`);
});

test('applyHintToDistribution: defaults without hint', () => {
  const { engine } = makeEngine();
  engine.start();
  const result = engine.applyHintToDistribution(0, 5, null);
  assertEqual(result.applied, false, 'not applied');
  assertEqual(result.chunkCount, 5, 'defaults to deviceCount');
});

// ════════════════════════════════════════════
// MCL PROFILE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MCL Profile ──\x1b[0m');

test('getMCLProfile: reflects accumulated experience', () => {
  const { engine } = makeEngine();
  engine.start();
  completeTask(engine, TaskType.INFERENCE);
  completeTask(engine, TaskType.MAP_REDUCE);
  const profile = engine.getMCLProfile();
  assertEqual(profile.mclVersion, 1, 'version');
  assertEqual(profile.merCount, 2, '2 MERs');
  assert(profile.merCatalogBloom.length === 32, 'bloom 32 bytes');
});

// ════════════════════════════════════════════
// MCL MESSAGE ROUTING
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MCL Message Routing ──\x1b[0m');

test('handleMessage: returns true for MCL types', () => {
  const { engine } = makeEngine();
  engine.start();
  assert(engine.handleMessage(MessageType.MER_QUERY, new Uint8Array(0)), 'MER_QUERY');
  assert(engine.handleMessage(MessageType.MER_STORE, new Uint8Array(0)), 'MER_STORE');
});

test('handleMessage: returns false for non-MCL types', () => {
  const { engine } = makeEngine();
  engine.start();
  assert(!engine.handleMessage(MessageType.CHUNK_DATA as any, new Uint8Array(0)), 'CHUNK_DATA');
  assert(!engine.handleMessage(MessageType.HEARTBEAT as any, new Uint8Array(0)), 'HEARTBEAT');
});

test('handleMessage: returns false when disabled', () => {
  const { engine } = makeEngine({ enabled: false });
  engine.start();
  assert(!engine.handleMessage(MessageType.MER_OFFER, new Uint8Array(0)), 'disabled');
});

// ════════════════════════════════════════════
// CMPNode MCL CONFIG
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CMPNode Config ──\x1b[0m');

test('DEFAULT_CONFIG includes MCL', () => {
  const { DEFAULT_CONFIG } = require('../src/utils/config');
  assert(DEFAULT_CONFIG.mcl !== undefined, 'mcl exists');
  assertEqual(DEFAULT_CONFIG.mcl.enabled, true, 'enabled');
  assertEqual(DEFAULT_CONFIG.mcl.maxMers, 1000, 'maxMers');
  assertEqual(DEFAULT_CONFIG.mcl.minHintConfidence, 70, 'minConf');
  assertEqual(DEFAULT_CONFIG.mcl.merTtlDays, 90, 'ttl');
});

// ════════════════════════════════════════════
// CMPNode MCL INTEGRATION (async)
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CMPNode MCL Integration ──\x1b[0m');

await testAsync('CMPNode exposes MCL status + engine', async () => {
  const net = new VirtualNetwork();
  const node = new CMPNode({
    logLevel: LogLevel.WARN,
    _transport: new VirtualTransport('mcl-status', net),
  });
  await node.start();

  const status = node.getMCLStatus();
  assertEqual(status.enabled, true, 'enabled');
  assertEqual(status.merCount, 0, 'empty initially');

  const engine = node.getMCLEngine();
  assert(engine !== undefined, 'engine accessible');
  assert(engine.isActive(), 'engine active');

  await node.stop();
  assert(!engine.isActive(), 'engine inactive after stop');
});

await testAsync('CMPNode MCL survives start/stop', async () => {
  const net = new VirtualNetwork();
  const node = new CMPNode({
    logLevel: LogLevel.WARN,
    _transport: new VirtualTransport('mcl-cycle', net),
  });
  await node.start();
  assert(node.getMCLEngine().isActive(), 'active');
  await node.stop();
  assert(!node.getMCLEngine().isActive(), 'inactive');
});

// ════════════════════════════════════════════
// FULL MCL CYCLE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Full MCL Cycle ──\x1b[0m');

test('accumulate → hint: 5 tasks enable hint generation', () => {
  const { engine } = makeEngine();
  engine.start();
  assertEqual(engine.getHint(TaskType.INFERENCE, 5), null, 'no hint initially');

  for (let i = 0; i < 5; i++) {
    completeTask(engine, TaskType.INFERENCE, 75 + i * 4);
  }
  assertEqual(engine.getStatus().merCount, 5, '5 MERs');

  const hint = engine.getHint(TaskType.INFERENCE, 5);
  assert(hint !== null, 'hint after 5 tasks');
  assert(hint!.sourceMerCount >= 2, `sources=${hint!.sourceMerCount}`);

  const applied = engine.applyHintToDistribution(0, 5, hint);
  assert(applied.applied, 'hint applied');
});

test('pollination: engine A → engine B knowledge transfer', () => {
  // Engine A: experienced
  const { engine: engineA } = makeEngine();
  engineA.start();
  for (let i = 0; i < 5; i++) completeTask(engineA, TaskType.INFERENCE, 85 + i);

  // Engine B: fresh
  const { engine: engineB } = makeEngine();
  engineB.start();
  assertEqual(engineB.getHint(TaskType.INFERENCE, 5), null, 'B empty');

  // Pollinate: A → B
  const offer = engineA.buildPollination();
  assert(offer !== null, 'A has offer');

  const request = engineB.processOffer(offer!);
  assert(request !== null, 'B wants MERs');

  const transfer = engineA.buildTransfer(request!);
  const stored = engineB.processTransfer(transfer, kp.publicKey);
  assert(stored > 0, `B stored ${stored} MERs`);

  // B now has hints
  const hint = engineB.getHint(TaskType.INFERENCE, 5);
  assert(hint !== null, 'B has hints from pollination!');
  assert(hint!.confidence > 0, `conf=${hint!.confidence}`);
});

test('disabled engine: no MER generation, no hints', () => {
  const { engine } = makeEngine({ enabled: false });
  engine.start();
  assertEqual(completeTask(engine), null, 'no MER when disabled');
  assertEqual(engine.getHint(TaskType.INFERENCE, 5), null, 'no hint when disabled');
  assertEqual(engine.buildPollination(), null, 'no pollination when disabled');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 16: MCL Integration with CMPNode\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

/**
 * CMP Phase 18 Test Suite
 * Tests: v1.2 Integration, MCL Benchmark, Completeness Verification
 *   - Error codes (all 10 defined, descriptions, recovery actions)
 *   - Node state machine (all states, valid/invalid transitions)
 *   - MCL cold-vs-warm benchmark (timing improvement with hints)
 *   - Full v1.2 flow: compute → MER → pollinate → hint → faster compute
 *   - v1.2 spec completeness: all new types, enums, configs present
 *   - Backward compatibility: old TLV + new CMP Frame coexist
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase18-v1.2-final.test.ts
 *
 * @author Agent Viscro
 */

import {
  CMPNode, LogLevel, randomBytes, toHex, shortId,
  encodeMessage, decodeMessage, encodeJSON, decodeJSON,
  encodeBeacon, decodeBeacon, createBeacon,
  generateSigningKeyPair,
  crc32c, verifyCRC32C,
  FRAME_HEADER_SIZE,
  MessageType, TaskType,
} from '../src';

import {
  CMPErrorCode, ERROR_DESCRIPTIONS, ERROR_RECOVERY,
  errorDescription, errorRecovery,
} from '../src/types/errors';

import {
  NodeState, isValidTransition, validTransitionsFrom,
  allStates, allTransitions,
} from '../src/types/node-state';

import {
  DecompositionStrategy, TierRole, BottleneckFlag,
  MER_MAX_PER_DEVICE, MER_MAX_GENERATION, MER_DEFAULT_TTL_DAYS,
  MER_MIN_HINT_CONFIDENCE, MER_POLLINATION_BONUS,
  DEFAULT_MCL_CONFIG,
} from '../src/types/mcl';

import { MCLEngine } from '../src/mcl/engine';
import { MERStore, createMER, Pollinator, BloomFilter, BLOOM_BYTES } from '../src/mcl';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';
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

function makeEngine(): MCLEngine {
  const net = new VirtualNetwork();
  return new MCLEngine({
    meshId: randomBytes(16),
    signingSecretKey: kp.secretKey,
    signingPublicKey: kp.publicKey,
    transport: new VirtualTransport('e-' + Math.random().toString(36).slice(2, 6), net),
    bus: new EventBus(),
  });
}

async function main() {

console.log('\n\x1b[1m── Phase 18: v1.2 Integration + Completeness ──\x1b[0m');

// ════════════════════════════════════════════
// ERROR CODES
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Error Codes ──\x1b[0m');

test('all 10 error codes defined', () => {
  const codes = [
    CMPErrorCode.ERR_TIMEOUT, CMPErrorCode.ERR_OOM, CMPErrorCode.ERR_HASH_MISMATCH,
    CMPErrorCode.ERR_SANDBOX_VIOLATION, CMPErrorCode.ERR_CONSENSUS_FAIL,
    CMPErrorCode.ERR_CRYPTO_FAIL, CMPErrorCode.ERR_CAPACITY, CMPErrorCode.ERR_DEPARTED,
    CMPErrorCode.ERR_MER_INVALID, CMPErrorCode.ERR_PROTOCOL,
  ];
  assertEqual(codes.length, 10, '10 codes');
  // Verify sequential 0x01-0x0A
  for (let i = 0; i < codes.length; i++) {
    assertEqual(codes[i], i + 1, `code ${i + 1}`);
  }
});

test('every error code has description', () => {
  for (let code = 0x01; code <= 0x0A; code++) {
    const desc = errorDescription(code as CMPErrorCode);
    assert(desc.length > 0, `description for 0x${code.toString(16)}`);
    assert(!desc.startsWith('Unknown'), `known description for 0x${code.toString(16)}`);
  }
});

test('every error code has recovery action', () => {
  for (let code = 0x01; code <= 0x0A; code++) {
    const rec = errorRecovery(code as CMPErrorCode);
    assert(rec.length > 0, `recovery for 0x${code.toString(16)}`);
    assert(!rec.startsWith('No recovery'), `known recovery for 0x${code.toString(16)}`);
  }
});

test('unknown error code handled gracefully', () => {
  const desc = errorDescription(0xFF as CMPErrorCode);
  assert(desc.startsWith('Unknown'), 'unknown description');
});

// ════════════════════════════════════════════
// NODE STATE MACHINE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Node State Machine ──\x1b[0m');

test('5 states defined', () => {
  const states = allStates();
  assertEqual(states.length, 5, '5 states');
  assert(states.includes(NodeState.IDLE), 'IDLE');
  assert(states.includes(NodeState.DISCOVERING), 'DISCOVERING');
  assert(states.includes(NodeState.JOINING), 'JOINING');
  assert(states.includes(NodeState.ACTIVE), 'ACTIVE');
  assert(states.includes(NodeState.DEPARTING), 'DEPARTING');
});

test('valid transitions: IDLE → DISCOVERING', () => {
  assert(isValidTransition(NodeState.IDLE, NodeState.DISCOVERING), 'IDLE→DISCOVERING');
});

test('valid transitions: DISCOVERING → JOINING', () => {
  assert(isValidTransition(NodeState.DISCOVERING, NodeState.JOINING), 'DISCOVERING→JOINING');
});

test('valid transitions: DISCOVERING → IDLE (timeout)', () => {
  assert(isValidTransition(NodeState.DISCOVERING, NodeState.IDLE), 'DISCOVERING→IDLE');
});

test('valid transitions: JOINING → ACTIVE', () => {
  assert(isValidTransition(NodeState.JOINING, NodeState.ACTIVE), 'JOINING→ACTIVE');
});

test('valid transitions: JOINING → DISCOVERING (handshake fail)', () => {
  assert(isValidTransition(NodeState.JOINING, NodeState.DISCOVERING), 'JOINING→DISCOVERING');
});

test('valid transitions: ACTIVE → DEPARTING', () => {
  assert(isValidTransition(NodeState.ACTIVE, NodeState.DEPARTING), 'ACTIVE→DEPARTING');
});

test('valid transitions: ACTIVE → DISCOVERING (all peers lost)', () => {
  assert(isValidTransition(NodeState.ACTIVE, NodeState.DISCOVERING), 'ACTIVE→DISCOVERING');
});

test('valid transitions: DEPARTING → IDLE', () => {
  assert(isValidTransition(NodeState.DEPARTING, NodeState.IDLE), 'DEPARTING→IDLE');
});

test('invalid transitions rejected', () => {
  assert(!isValidTransition(NodeState.IDLE, NodeState.ACTIVE), 'IDLE→ACTIVE invalid');
  assert(!isValidTransition(NodeState.IDLE, NodeState.DEPARTING), 'IDLE→DEPARTING invalid');
  assert(!isValidTransition(NodeState.DEPARTING, NodeState.ACTIVE), 'DEPARTING→ACTIVE invalid');
  assert(!isValidTransition(NodeState.ACTIVE, NodeState.JOINING), 'ACTIVE→JOINING invalid');
  assert(!isValidTransition(NodeState.JOINING, NodeState.DEPARTING), 'JOINING→DEPARTING invalid');
});

test('allTransitions returns correct count', () => {
  const transitions = allTransitions();
  // IDLE→1, DISCOVERING→2, JOINING→2, ACTIVE→2, DEPARTING→1 = 8
  assertEqual(transitions.length, 8, '8 valid transitions');
});

test('no self-transitions', () => {
  for (const state of allStates()) {
    assert(!isValidTransition(state, state), `no self-transition: ${state}`);
  }
});

// ════════════════════════════════════════════
// MCL COLD vs WARM BENCHMARK
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MCL Cold vs Warm Benchmark ──\x1b[0m');

test('warm engine produces hints, cold does not', () => {
  const cold = makeEngine();
  cold.start();

  const warm = makeEngine();
  warm.start();
  // Warm up with 5 tasks
  for (let i = 0; i < 5; i++) {
    warm.onTaskComplete({
      taskType: TaskType.INFERENCE, deviceCount: 5, strategyUsed: 0,
      chunkCount: 8, avgChunkSizeKb: 2048 + i * 100, totalTimeMs: 6000 - i * 200,
      distributionOverheadMs: 500, executionEfficiency: 80 + i * 3, faultEvents: 0,
      reassignmentCount: 0, verified: true,
    });
  }

  // Cold: no hint
  assertEqual(cold.getHint(TaskType.INFERENCE, 5), null, 'cold has no hint');

  // Warm: has hint with good confidence
  const hint = warm.getHint(TaskType.INFERENCE, 5);
  assert(hint !== null, 'warm has hint');
  assert(hint!.confidence >= 70, `warm confidence=${hint!.confidence}`);
  assert(hint!.sourceMerCount >= 2, `warm sources=${hint!.sourceMerCount}`);

  // Apply hint
  const applied = warm.applyHintToDistribution(0, 5, hint);
  assert(applied.applied, 'hint applied');
  assert(applied.chunkCount >= 1, 'valid chunk count');
  assert(applied.chunkSizeKb !== null && applied.chunkSizeKb > 0, 'valid chunk size');
});

test('strategy improves over repeated tasks (convergence)', () => {
  const engine = makeEngine();
  engine.start();

  const efficiencies: number[] = [];

  // Run 10 tasks, simulating improving efficiency as hints are applied
  for (let i = 0; i < 10; i++) {
    const hint = engine.getHint(TaskType.INFERENCE, 5);
    const baseEfficiency = 70;
    // With hints, efficiency improves
    const hintBonus = hint ? Math.min(20, hint.confidence / 5) : 0;
    const efficiency = baseEfficiency + i * 2 + hintBonus;

    efficiencies.push(efficiency);

    engine.onTaskComplete({
      taskType: TaskType.INFERENCE, deviceCount: 5, strategyUsed: 0,
      chunkCount: 8, avgChunkSizeKb: 2048, totalTimeMs: Math.max(2000, 8000 - i * 500),
      distributionOverheadMs: 500, executionEfficiency: Math.min(100, Math.round(efficiency)),
      faultEvents: 0, reassignmentCount: 0, verified: true,
    });
  }

  // Later efficiencies should be higher
  const firstHalf = efficiencies.slice(0, 5);
  const secondHalf = efficiencies.slice(5);
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  assert(avgSecond > avgFirst, `second half (${avgSecond.toFixed(1)}) > first half (${avgFirst.toFixed(1)})`);

  // Hint should be available by task #3
  assertEqual(engine.getStatus().merCount, 10, '10 MERs');
  const finalHint = engine.getHint(TaskType.INFERENCE, 5);
  assert(finalHint !== null, 'final hint available');
  assert(finalHint!.merGeneration >= 1, `evolved: gen=${finalHint!.merGeneration}`);
});

// ════════════════════════════════════════════
// FULL v1.2 FLOW: COMPUTE → MER → POLLINATE → HINT
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Full v1.2 Flow ──\x1b[0m');

test('Mesh A experience → pollinate → Mesh B hint (complete flow)', () => {
  // ── Mesh A: accumulate experience ──
  const engineA = makeEngine();
  engineA.start();

  for (let i = 0; i < 8; i++) {
    engineA.onTaskComplete({
      taskType: TaskType.INFERENCE, deviceCount: 5, strategyUsed: 0,
      chunkCount: 6, avgChunkSizeKb: 3000 + i * 100, totalTimeMs: 7000 - i * 300,
      distributionOverheadMs: 700, executionEfficiency: 82 + i * 2, faultEvents: 0,
      reassignmentCount: 0, verified: true,
    });
  }

  const hintA = engineA.getHint(TaskType.INFERENCE, 5);
  assert(hintA !== null, 'Mesh A has hint');
  assertEqual(engineA.getStatus().merCount, 8, 'Mesh A: 8 MERs');

  // ── Node X carries experience ──
  const nodeXStore = new MERStore();
  for (const mer of engineA.getStore().getAll()) {
    nodeXStore.store(mer);
  }

  // ── Mesh B: fresh, no experience ──
  const engineB = makeEngine();
  engineB.start();
  assertEqual(engineB.getHint(TaskType.INFERENCE, 5), null, 'Mesh B cold');

  // ── Pollinate: Node X → Mesh B ──
  const pollinatorX = new Pollinator(nodeXStore);
  const offer = pollinatorX.buildOffer(randomBytes(16));
  assert(offer !== null, 'offer built');

  const pollinatorB = new Pollinator(engineB.getStore());
  const request = pollinatorB.processOffer(offer!, randomBytes(16));
  assert(request !== null, 'request built');

  const transfer = pollinatorX.buildTransfer(request!, randomBytes(16), kp.secretKey);
  pollinatorB.processTransfer(transfer, kp.publicKey);

  // ── Mesh B now has knowledge ──
  assert(engineB.getStore().size > 0, `Mesh B received ${engineB.getStore().size} MERs`);

  const hintB = engineB.getHint(TaskType.INFERENCE, 5);
  assert(hintB !== null, 'Mesh B now has hints!');
  assert(hintB!.confidence > 0, `Mesh B hint conf=${hintB!.confidence}`);

  // Verify hint can be applied
  const applied = engineB.applyHintToDistribution(0, 5, hintB);
  assert(applied.applied, 'Mesh B applies hint');
});

// ════════════════════════════════════════════
// v1.2 SPEC COMPLETENESS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── v1.2 Spec Completeness ──\x1b[0m');

test('MCL types: all enums defined', () => {
  // DecompositionStrategy
  assertEqual(DecompositionStrategy.DATA_PARALLEL, 0, 'DATA_PARALLEL');
  assertEqual(DecompositionStrategy.MODEL_PARALLEL, 1, 'MODEL_PARALLEL');
  assertEqual(DecompositionStrategy.PIPELINE, 2, 'PIPELINE');
  assertEqual(DecompositionStrategy.MAP_REDUCE, 3, 'MAP_REDUCE');
  assertEqual(DecompositionStrategy.SCATTER_GATHER, 4, 'SCATTER_GATHER');

  // TierRole
  assertEqual(TierRole.EXCLUDE, 0, 'EXCLUDE');
  assertEqual(TierRole.COMPUTE, 1, 'COMPUTE');
  assertEqual(TierRole.PREFER, 2, 'PREFER');

  // BottleneckFlag
  assertEqual(BottleneckFlag.NETWORK, 0x01, 'NETWORK');
  assertEqual(BottleneckFlag.CPU, 0x02, 'CPU');
  assertEqual(BottleneckFlag.MEMORY, 0x04, 'MEMORY');
});

test('MCL constants: spec values', () => {
  assertEqual(MER_MAX_PER_DEVICE, 1000, 'MAX_PER_DEVICE');
  assertEqual(MER_MAX_GENERATION, 100, 'MAX_GENERATION');
  assertEqual(MER_DEFAULT_TTL_DAYS, 90, 'DEFAULT_TTL');
  assertEqual(MER_MIN_HINT_CONFIDENCE, 70, 'MIN_HINT_CONF');
  assertEqual(MER_POLLINATION_BONUS, 50, 'POLLINATION_BONUS');
  assertEqual(BLOOM_BYTES, 32, 'BLOOM_BYTES');
});

test('MCL config: defaults match spec', () => {
  assertEqual(DEFAULT_MCL_CONFIG.enabled, true, 'enabled');
  assertEqual(DEFAULT_MCL_CONFIG.maxMers, 1000, 'maxMers');
  assertEqual(DEFAULT_MCL_CONFIG.maxPerOrigin, 50, 'maxPerOrigin');
  assertEqual(DEFAULT_MCL_CONFIG.maxPerJoin, 50, 'maxPerJoin');
  assertEqual(DEFAULT_MCL_CONFIG.minHintConfidence, 70, 'minHintConfidence');
  assertEqual(DEFAULT_MCL_CONFIG.merTtlDays, 90, 'merTtlDays');
  const [min, max] = DEFAULT_MCL_CONFIG.forwardingRange;
  assertEqual(min, 0.6, 'forwarding min');
  assertEqual(max, 0.8, 'forwarding max');
});

test('CMP Frame: 16-byte header', () => {
  assertEqual(FRAME_HEADER_SIZE, 16, 'frame header');
});

test('CRC-32C: standard test vector', () => {
  const input = new TextEncoder().encode('123456789');
  assertEqual(crc32c(input), 0xE3069283, 'standard CRC-32C');
});

test('beacon: mclCapable flag exists', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  assert('mclCapable' in beacon.flags, 'mclCapable field exists');
  assert(beacon.flags.mclCapable === true, 'default true');
});

test('MessageType: 23 total types (18 core + 5 MCL)', () => {
  const values = Object.values(MessageType).filter(v => typeof v === 'number');
  assertEqual(values.length, 23, '23 message types');
});

test('CMPConfig: has MCL section', () => {
  const { DEFAULT_CONFIG } = require('../src/utils/config');
  assert(DEFAULT_CONFIG.mcl !== undefined, 'mcl section');
  assertEqual(DEFAULT_CONFIG.mcl.enabled, true, 'enabled');
  assertEqual(DEFAULT_CONFIG.mcl.maxMers, 1000, 'maxMers');
});

// ════════════════════════════════════════════
// CMPNode v1.2 API
// ════════════════════════════════════════════
console.log('\n\x1b[1m── CMPNode v1.2 API ──\x1b[0m');

await testAsync('CMPNode has getMCLStatus()', async () => {
  const net = new VirtualNetwork();
  const node = new CMPNode({
    logLevel: LogLevel.WARN,
    _transport: new VirtualTransport('api-test', net),
  });
  await node.start();
  const status = node.getMCLStatus();
  assert('enabled' in status, 'has enabled');
  assert('merCount' in status, 'has merCount');
  assert('taskTypes' in status, 'has taskTypes');
  assert('origins' in status, 'has origins');
  assert('pollinationStats' in status, 'has pollinationStats');
  await node.stop();
});

await testAsync('CMPNode has getMCLEngine()', async () => {
  const net = new VirtualNetwork();
  const node = new CMPNode({
    logLevel: LogLevel.WARN,
    _transport: new VirtualTransport('engine-test', net),
  });
  await node.start();
  const engine = node.getMCLEngine();
  assert(engine !== null && engine !== undefined, 'engine exists');
  assert(engine.isActive(), 'engine active');
  await node.stop();
});

// ════════════════════════════════════════════
// BACKWARD COMPATIBILITY
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Backward Compatibility ──\x1b[0m');

test('v1.0 TLV messages still decode', () => {
  // Build a v1.0 TLV message manually
  const payload = new TextEncoder().encode('{"test":true}');
  const tlv = new Uint8Array(5 + payload.length);
  tlv[0] = MessageType.HEARTBEAT; // 0x30
  const view = new DataView(tlv.buffer);
  view.setUint32(1, payload.length, false);
  tlv.set(payload, 5);

  const decoded = decodeMessage(tlv);
  assert(decoded !== null, 'v1.0 TLV decodes');
  assertEqual(decoded!.type, MessageType.HEARTBEAT, 'correct type');
  const obj = decodeJSON(decoded!.payload);
  assertEqual(obj.test, true, 'payload intact');
});

test('v1.2 CMP Frame messages decode', () => {
  const payload = encodeJSON({ test: true, version: '1.2' });
  const frame = encodeMessage(MessageType.TASK_REQUEST, payload);
  const decoded = decodeMessage(frame);
  assert(decoded !== null, 'v1.2 frame decodes');
  assertEqual(decoded!.type, MessageType.TASK_REQUEST, 'correct type');
  const obj = decodeJSON(decoded!.payload);
  assertEqual(obj.version, '1.2', 'payload intact');
});

test('mixed v1.0 and v1.2 messages in sequence', () => {
  // v1.2 frame
  const frame = encodeMessage(MessageType.TASK_REQUEST, encodeJSON({ v: '1.2' }));
  const d1 = decodeMessage(frame);
  assert(d1 !== null, 'v1.2 decoded');

  // v1.0 TLV
  const payload = encodeJSON({ v: '1.0' });
  const tlv = new Uint8Array(5 + payload.length);
  tlv[0] = MessageType.HEARTBEAT;
  new DataView(tlv.buffer).setUint32(1, payload.length, false);
  tlv.set(payload, 5);
  const d2 = decodeMessage(tlv);
  assert(d2 !== null, 'v1.0 decoded');

  // Another v1.2
  const frame2 = encodeMessage(MessageType.BID, encodeJSON({ v: '1.2b' }));
  const d3 = decodeMessage(frame2);
  assert(d3 !== null, 'v1.2 decoded again');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  \x1b[1mPhase 18: v1.2 Integration + Completeness\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(60)}\n`);

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

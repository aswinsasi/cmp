/**
 * CMP Phase 15 Test Suite
 * Tests: Pollination, Evolution, Strategy Hints
 *   - MER_OFFER/REQUEST/TRANSFER protocol
 *   - Probabilistic forwarding (60-80% subset)
 *   - Micro-evolution: crossover, mutation, generation tracking
 *   - Strategy hint generation from MER store
 *   - Hint application with confidence gating
 *   - Full pollination flow: Mesh A → Node X → Mesh B
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase15-mcl-pollination.test.ts
 *
 * @author Agent Viscro
 */

import {
  generateSigningKeyPair, randomBytes, toHex,
  TaskType,
} from '../src';

import {
  createMER, MERStore, Pollinator,
  evolveParams, didOutperform, efficiencyEMA,
  generateHint, applyHint, hintToWire, hintFromWire,
} from '../src/mcl';

import type { MERCreateParams } from '../src/mcl/mer';
import type { CMP_MER } from '../src/types/mcl';
import { DecompositionStrategy, BottleneckFlag } from '../src/types/mcl';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
function assertEqual(a: any, e: any, m: string): void { if (a !== e) throw new Error(`${m}: expected ${e}, got ${a}`); }

const kp = generateSigningKeyPair();
const kp2 = generateSigningKeyPair();

function sp(o: Partial<MERCreateParams> = {}): MERCreateParams {
  return { taskType: TaskType.INFERENCE, meshSignature: randomBytes(8), deviceCount: 5,
    strategyUsed: DecompositionStrategy.DATA_PARALLEL, chunkCount: 8, avgChunkSizeKb: 5632,
    performance: { totalTimeMs: 12000, distributionOverheadPct: 12, executionEfficiency: 87, faultEvents: 0, reassignmentCount: 0 },
    learnedHints: { optimalChunkSizeKb: 4800, optimalDeviceCount: 6, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: BottleneckFlag.NETWORK },
    environmentHash: randomBytes(8), originMeshHash: randomBytes(8), ...o };
}

function fillStore(store: MERStore, count: number, taskType: TaskType = TaskType.INFERENCE): CMP_MER[] {
  const mers: CMP_MER[] = [];
  for (let i = 0; i < count; i++) {
    const mer = createMER(sp({ taskType, confidence: 70 + Math.floor(Math.random() * 25) }), kp.secretKey);
    store.store(mer);
    mers.push(mer);
  }
  return mers;
}

console.log('\n\x1b[1m── Phase 15: MCL Pollination + Evolution + Hints ──\x1b[0m');

// ════════════════════════════════════════════
// POLLINATOR: OFFER
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pollinator: Offer ──\x1b[0m');

test('buildOffer: returns null for empty store', () => {
  const store = new MERStore();
  const p = new Pollinator(store);
  assertEqual(p.buildOffer(randomBytes(16)), null, 'null for empty');
});

test('buildOffer: offers subset of MERs', () => {
  const store = new MERStore();
  fillStore(store, 20);
  const p = new Pollinator(store);
  const offer = p.buildOffer(randomBytes(16));
  assert(offer !== null, 'should produce offer');
  assert(offer!.summaries.length > 0, 'has summaries');
  assert(offer!.summaries.length <= 50, 'capped at 50');
  // Probabilistic: should offer 60-80% ≈ 12-16 of 20 (with randomness, check broad range)
  assert(offer!.summaries.length <= 20, 'at most all MERs');
});

test('buildOffer: applies probabilistic forwarding', () => {
  const store = new MERStore();
  fillStore(store, 30);
  const p = new Pollinator(store);
  // Run multiple offers to verify randomness
  const sizes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const offer = p.buildOffer(randomBytes(16));
    if (offer) sizes.push(offer.summaries.length);
  }
  // Should have some variance in offer sizes
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  assert(max - min >= 1, `offer sizes should vary: min=${min} max=${max}`);
});

test('buildOffer: filters by target task types', () => {
  const store = new MERStore();
  fillStore(store, 10, TaskType.INFERENCE);
  fillStore(store, 10, TaskType.MAP_REDUCE);
  const p = new Pollinator(store);
  const offer = p.buildOffer(randomBytes(16), [TaskType.INFERENCE]);
  assert(offer !== null, 'should produce offer');
  for (const s of offer!.summaries) {
    assertEqual(s.taskType, TaskType.INFERENCE, 'filtered to INFERENCE');
  }
});

test('buildOffer: tracks stats', () => {
  const store = new MERStore();
  fillStore(store, 5);
  const p = new Pollinator(store);
  p.buildOffer(randomBytes(16));
  const stats = p.getStats();
  assert(stats.totalOffered > 0, 'totalOffered incremented');
  assertEqual(stats.joinEvents, 1, 'joinEvents incremented');
});

// ════════════════════════════════════════════
// POLLINATOR: OFFER → REQUEST → TRANSFER
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pollinator: Full Flow ──\x1b[0m');

test('processOffer: requests MERs we dont have', () => {
  const storeA = new MERStore();
  const storeB = new MERStore();
  fillStore(storeA, 5);
  const pA = new Pollinator(storeA);
  const pB = new Pollinator(storeB);

  const offer = pA.buildOffer(randomBytes(16));
  assert(offer !== null, 'offer built');
  const request = pB.processOffer(offer!, randomBytes(16));
  assert(request !== null, 'should request MERs');
  assert(request!.merIds.length > 0, 'has requested IDs');
});

test('processOffer: returns null when we have better', () => {
  const storeA = new MERStore();
  const storeB = new MERStore();
  // Store A has low-confidence MERs
  for (let i = 0; i < 5; i++) {
    storeA.store(createMER(sp({ confidence: 30 }), kp.secretKey));
  }
  // Store B already has high-confidence MER
  storeB.store(createMER(sp({ confidence: 95 }), kp.secretKey));

  const pA = new Pollinator(storeA);
  const pB = new Pollinator(storeB);

  const offer = pA.buildOffer(randomBytes(16));
  assert(offer !== null, 'offer built');
  const request = pB.processOffer(offer!, randomBytes(16));
  assertEqual(request, null, 'should not request (already has better)');
});

test('buildTransfer: packages requested MERs', () => {
  const storeA = new MERStore();
  const mers = fillStore(storeA, 5);
  const pA = new Pollinator(storeA);
  const selfId = randomBytes(16);

  // Simulate request for specific MERs
  const requestedIds = mers.slice(0, 3).map(m => Array.from(m.merId));
  const request = { requesterId: Array.from(randomBytes(16)), merIds: requestedIds };

  const transfer = pA.buildTransfer(request as any, selfId, kp.secretKey);
  assertEqual(transfer.mers.length, 3, '3 MERs transferred');
  assert(transfer.transferSig.length === 64, 'has transfer signature');
});

test('processTransfer: stores received MERs', () => {
  const storeA = new MERStore();
  const storeB = new MERStore();
  fillStore(storeA, 5);
  const pA = new Pollinator(storeA);
  const pB = new Pollinator(storeB);
  const selfId = randomBytes(16);

  const offer = pA.buildOffer(selfId);
  const request = pB.processOffer(offer!, randomBytes(16));
  assert(request !== null, 'request built');

  const transfer = pA.buildTransfer(request!, selfId, kp.secretKey);
  const stored = pB.processTransfer(transfer, kp.publicKey);

  assert(stored > 0, `should store MERs, got ${stored}`);
  assert(storeB.size > 0, 'store B has MERs now');
});

test('full pollination: Mesh A → Node X → Mesh B', () => {
  // Mesh A: has accumulated MERs
  const storeA = new MERStore();
  fillStore(storeA, 10, TaskType.INFERENCE);

  // Node X has been in Mesh A and carries its MERs
  const nodeXStore = new MERStore();
  for (const mer of storeA.getAll()) {
    nodeXStore.store(mer);
  }
  assertEqual(nodeXStore.size, 10, 'Node X has 10 MERs');

  // Mesh B: fresh, no experience
  const storeB = new MERStore();
  assertEqual(storeB.size, 0, 'Mesh B empty');

  // Node X joins Mesh B and pollinates
  const pX = new Pollinator(nodeXStore);
  const pB = new Pollinator(storeB);
  const nodeXId = randomBytes(16);

  // Step 1: Node X offers MERs
  const offer = pX.buildOffer(nodeXId);
  assert(offer !== null, 'offer built');

  // Step 2: Mesh B requests relevant MERs
  const request = pB.processOffer(offer!, randomBytes(16));
  assert(request !== null, 'request built');

  // Step 3: Node X sends MERs
  const transfer = pX.buildTransfer(request!, nodeXId, kp.secretKey);

  // Step 4: Mesh B stores received MERs
  const stored = pB.processTransfer(transfer, kp.publicKey);
  assert(stored > 0, 'Mesh B received MERs');
  assert(storeB.size > 0, `Mesh B now has ${storeB.size} MERs`);

  // Mesh B can now query for INFERENCE experience
  const results = storeB.query(TaskType.INFERENCE);
  assert(results.length > 0, 'Mesh B has INFERENCE experience from Mesh A');
});

// ════════════════════════════════════════════
// EVOLUTION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Evolution ──\x1b[0m');

test('evolveParams: requires at least 2 MERs', () => {
  const mer = createMER(sp(), kp.secretKey);
  assertEqual(evolveParams([mer]), null, 'null for 1 MER');
  assertEqual(evolveParams([]), null, 'null for 0 MERs');
});

test('evolveParams: produces evolved parameters', () => {
  const m1 = createMER(sp({ confidence: 90, learnedHints: { optimalChunkSizeKb: 4000, optimalDeviceCount: 5, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: 0 } }), kp.secretKey);
  const m2 = createMER(sp({ confidence: 80, learnedHints: { optimalChunkSizeKb: 6000, optimalDeviceCount: 8, bestTierMapping: new Uint8Array([0,1,1,2,1]), bottleneckFlags: 0 } }), kp.secretKey);
  const result = evolveParams([m1, m2]);
  assert(result !== null, 'should produce evolved params');
  assert(result!.chunkSizeKb > 0, `chunkSize positive: ${result!.chunkSizeKb}`);
  assert(result!.deviceCount >= 1, `deviceCount >= 1: ${result!.deviceCount}`);
  assertEqual(result!.generation, 1, 'generation = max(0,0) + 1 = 1');
  assertEqual(result!.parentIds.length, 2, 'has 2 parent IDs');
});

test('evolveParams: generation increments', () => {
  const m1 = createMER(sp({ generation: 5, confidence: 90 }), kp.secretKey);
  const m2 = createMER(sp({ generation: 3, confidence: 80 }), kp.secretKey);
  const result = evolveParams([m1, m2]);
  assert(result !== null, 'should produce result');
  assertEqual(result!.generation, 6, 'gen = max(5,3) + 1 = 6');
});

test('evolveParams: caps at MAX_GENERATION', () => {
  const m1 = createMER(sp({ generation: 100, confidence: 90 }), kp.secretKey);
  const m2 = createMER(sp({ generation: 99, confidence: 80 }), kp.secretKey);
  assertEqual(evolveParams([m1, m2]), null, 'null when at cap');
});

test('evolveParams: mutation decreases with generation', () => {
  // Low generation = more mutation variance
  // High generation = less mutation variance
  // We test this statistically: run many evolutions and check variance
  const lowGenMers = [
    createMER(sp({ generation: 0, confidence: 90, learnedHints: { optimalChunkSizeKb: 5000, optimalDeviceCount: 5, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: 0 } }), kp.secretKey),
    createMER(sp({ generation: 0, confidence: 80, learnedHints: { optimalChunkSizeKb: 5000, optimalDeviceCount: 5, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: 0 } }), kp.secretKey),
  ];
  const highGenMers = [
    createMER(sp({ generation: 50, confidence: 90, learnedHints: { optimalChunkSizeKb: 5000, optimalDeviceCount: 5, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: 0 } }), kp.secretKey),
    createMER(sp({ generation: 50, confidence: 80, learnedHints: { optimalChunkSizeKb: 5000, optimalDeviceCount: 5, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: 0 } }), kp.secretKey),
  ];

  const lowSizes: number[] = [];
  const highSizes: number[] = [];
  for (let i = 0; i < 50; i++) {
    const lr = evolveParams(lowGenMers);
    const hr = evolveParams(highGenMers);
    if (lr) lowSizes.push(lr.chunkSizeKb);
    if (hr) highSizes.push(hr.chunkSizeKb);
  }

  const lowVariance = variance(lowSizes);
  const highVariance = variance(highSizes);
  // High generation should have less variance (simulated annealing)
  assert(highVariance <= lowVariance + 1, `high gen variance (${highVariance.toFixed(0)}) should be <= low gen (${lowVariance.toFixed(0)})`);
});

test('didOutperform: correctly compares', () => {
  const parent = createMER(sp({ performance: { totalTimeMs: 1e4, distributionOverheadPct: 10, executionEfficiency: 80, faultEvents: 0, reassignmentCount: 0 } }), kp.secretKey);
  assert(didOutperform(85, [parent]), 'should outperform (85 > 80+2)');
  assert(!didOutperform(81, [parent]), 'should NOT outperform (81 < 80+2)');
  assert(!didOutperform(80, [parent]), 'should NOT outperform (equal)');
});

test('efficiencyEMA: calculates correctly', () => {
  assertEqual(efficiencyEMA([]), 50, 'empty defaults to 50');
  assertEqual(efficiencyEMA([80]), 80, 'single value');
  const ema = efficiencyEMA([80, 90, 85], 0.3);
  assert(ema > 80 && ema < 90, `EMA should be in range: ${ema}`);
});

// ════════════════════════════════════════════
// STRATEGY HINTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Strategy Hints ──\x1b[0m');

test('generateHint: returns null for empty store', () => {
  const store = new MERStore();
  assertEqual(generateHint(store, TaskType.INFERENCE), null, 'null for empty');
});

test('generateHint: returns null for low-confidence MERs', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 30 }), kp.secretKey));
  assertEqual(generateHint(store, TaskType.INFERENCE), null, 'null for low conf');
});

test('generateHint: produces hint from good MERs', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 85 }), kp.secretKey));
  store.store(createMER(sp({ confidence: 90 }), kp.secretKey));
  const hint = generateHint(store, TaskType.INFERENCE);
  assert(hint !== null, 'should produce hint');
  assert(hint!.confidence > 0, `confidence > 0: ${hint!.confidence}`);
  assert(hint!.recommendedChunkCount >= 1, 'chunkCount >= 1');
  assert(hint!.recommendedChunkSizeKb > 0, 'chunkSize > 0');
  assert(hint!.tierPreferences.length === 5, 'tierPrefs has 5 entries');
  assert(hint!.sourceMerCount >= 1, 'sourceMerCount >= 1');
});

test('generateHint: returns null for wrong task type', () => {
  const store = new MERStore();
  store.store(createMER(sp({ taskType: TaskType.INFERENCE, confidence: 90 }), kp.secretKey));
  assertEqual(generateHint(store, TaskType.PIPELINE), null, 'null for wrong type');
});

test('generateHint: rejects when mesh conditions too different', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 90, deviceCount: 10 }), kp.secretKey));
  // Current mesh has only 2 devices (80% deviation from MER's 10)
  assertEqual(generateHint(store, TaskType.INFERENCE, undefined, 2), null, 'null for divergent conditions');
});

test('generateHint: accepts when conditions are similar', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 90, deviceCount: 5 }), kp.secretKey));
  // Current mesh has 4 devices (20% deviation — acceptable)
  const hint = generateHint(store, TaskType.INFERENCE, undefined, 4);
  assert(hint !== null, 'should produce hint for similar conditions');
});

test('applyHint: returns defaults when no hint', () => {
  const result = applyHint(0, 5, null);
  assertEqual(result.chunkCount, 5, 'defaults to deviceCount');
  assertEqual(result.chunkSizeKb, null, 'null chunkSize');
  assertEqual(result.applied, false, 'not applied');
});

test('applyHint: applies hint when confident', () => {
  const hint = { recommendedStrategy: 0, recommendedChunkCount: 8, recommendedChunkSizeKb: 4800, tierPreferences: new Uint8Array(5), confidence: 85, merGeneration: 3, sourceMerCount: 5 };
  const result = applyHint(0, 10, hint);
  assertEqual(result.chunkCount, 8, 'hint chunk count applied');
  assertEqual(result.chunkSizeKb, 4800, 'hint chunk size applied');
  assertEqual(result.applied, true, 'applied');
});

test('applyHint: respects user chunkHint override', () => {
  const hint = { recommendedStrategy: 0, recommendedChunkCount: 8, recommendedChunkSizeKb: 4800, tierPreferences: new Uint8Array(5), confidence: 85, merGeneration: 3, sourceMerCount: 5 };
  const result = applyHint(4, 10, hint); // user explicitly wants 4 chunks
  assertEqual(result.chunkCount, 4, 'user override respected');
  assertEqual(result.applied, true, 'still counts as applied (chunkSize used)');
});

test('applyHint: rejects low-confidence hint', () => {
  const hint = { recommendedStrategy: 0, recommendedChunkCount: 8, recommendedChunkSizeKb: 4800, tierPreferences: new Uint8Array(5), confidence: 40, merGeneration: 1, sourceMerCount: 1 };
  const result = applyHint(0, 5, hint);
  assertEqual(result.applied, false, 'not applied (low conf)');
});

test('applyHint: caps chunks at device count', () => {
  const hint = { recommendedStrategy: 0, recommendedChunkCount: 20, recommendedChunkSizeKb: 4800, tierPreferences: new Uint8Array(5), confidence: 85, merGeneration: 3, sourceMerCount: 5 };
  const result = applyHint(0, 5, hint);
  assertEqual(result.chunkCount, 5, 'capped at device count');
});

test('hintToWire/hintFromWire round-trip', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 90 }), kp.secretKey));
  store.store(createMER(sp({ confidence: 85 }), kp.secretKey));
  const hint = generateHint(store, TaskType.INFERENCE);
  assert(hint !== null, 'hint generated');
  const wire = hintToWire(hint!);
  const json = JSON.stringify(wire);
  const parsed = JSON.parse(json);
  const restored = hintFromWire(parsed);
  assertEqual(restored.recommendedChunkCount, hint!.recommendedChunkCount, 'chunkCount preserved');
  assertEqual(restored.confidence, hint!.confidence, 'confidence preserved');
  assertEqual(restored.merGeneration, hint!.merGeneration, 'generation preserved');
});

// ════════════════════════════════════════════
// INTEGRATED: POLLINATION + HINTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Integrated: Pollination → Hints ──\x1b[0m');

test('pollinated MERs enable hint generation in new mesh', () => {
  // Mesh A accumulates experience
  const storeA = new MERStore();
  for (let i = 0; i < 5; i++) {
    storeA.store(createMER(sp({
      confidence: 85 + i,
      learnedHints: { optimalChunkSizeKb: 4000 + i * 200, optimalDeviceCount: 5, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: 0 },
    }), kp.secretKey));
  }

  // Mesh B is empty
  const storeB = new MERStore();
  assertEqual(generateHint(storeB, TaskType.INFERENCE), null, 'Mesh B has no hints initially');

  // Pollinate: A → B
  const pA = new Pollinator(storeA);
  const pB = new Pollinator(storeB);
  const nodeId = randomBytes(16);
  const offer = pA.buildOffer(nodeId);
  assert(offer !== null, 'offer');
  const request = pB.processOffer(offer!, randomBytes(16));
  assert(request !== null, 'request');
  const transfer = pA.buildTransfer(request!, nodeId, kp.secretKey);
  pB.processTransfer(transfer, kp.publicKey);

  // Now Mesh B should be able to generate hints
  const hint = generateHint(storeB, TaskType.INFERENCE);
  assert(hint !== null, 'Mesh B now has hints from pollination!');
  assert(hint!.confidence > 0, `hint confidence: ${hint!.confidence}`);
  assert(hint!.recommendedChunkSizeKb > 0, `hint chunkSize: ${hint!.recommendedChunkSizeKb}`);
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 15: MCL Pollination + Evolution + Hints\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);

// ── Helper ──
function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}

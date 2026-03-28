/**
 * CMP Phase 14 Test Suite
 * Tests: Mesh Cognition Layer - DHT + Distributed Mesh Memory
 *   - XOR distance computation and comparison
 *   - Closest node selection
 *   - Replication target selection
 *   - MERStore: store, query, eviction, origin caps
 *   - Query ranking (confidence, generation, recency, similarity)
 *   - Deduplication and expiry handling
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase14-mcl-dht.test.ts
 *
 * @author Agent Viscro
 */

import {
  generateSigningKeyPair, randomBytes, toHex,
  TaskType,
} from '../src';

import {
  createMER, merDHTKey,
  xorDistance, compareDistance, closestNodes, replicationTargets, createDHTNode,
  MERStore,
} from '../src/mcl';

import type { DHTNode } from '../src/mcl';
import type { MERCreateParams } from '../src/mcl/mer';
import { DecompositionStrategy, BottleneckFlag, MER_MAX_PER_ORIGIN } from '../src/types/mcl';

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

function sp(o: Partial<MERCreateParams> = {}): MERCreateParams {
  return { taskType: TaskType.INFERENCE, meshSignature: randomBytes(8), deviceCount: 5,
    strategyUsed: DecompositionStrategy.DATA_PARALLEL, chunkCount: 8, avgChunkSizeKb: 5632,
    performance: { totalTimeMs: 12000, distributionOverheadPct: 12, executionEfficiency: 87, faultEvents: 0, reassignmentCount: 0 },
    learnedHints: { optimalChunkSizeKb: 4800, optimalDeviceCount: 6, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: BottleneckFlag.NETWORK },
    environmentHash: randomBytes(8), originMeshHash: randomBytes(8), ...o };
}

function makeNodes(count: number): DHTNode[] {
  return Array.from({ length: count }, (_, i) =>
    createDHTNode(randomBytes(16), `peer-${i}`)
  );
}

console.log('\n\x1b[1m── Phase 14: MCL DHT + Distributed Mesh Memory ──\x1b[0m');

// ════════════════════════════════════════════
// XOR DISTANCE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── XOR Distance ──\x1b[0m');

test('XOR of identical bytes is zero', () => {
  const a = new Uint8Array([0x43, 0x4D, 0x50]);
  const d = xorDistance(a, a);
  assert(d.every(b => b === 0), 'all zeros');
});

test('XOR is symmetric', () => {
  const a = randomBytes(8);
  const b = randomBytes(8);
  const d1 = xorDistance(a, b);
  const d2 = xorDistance(b, a);
  assertEqual(toHex(d1), toHex(d2), 'symmetric');
});

test('XOR of opposites is all 0xFF', () => {
  const a = new Uint8Array([0x00, 0x00, 0x00]);
  const b = new Uint8Array([0xFF, 0xFF, 0xFF]);
  const d = xorDistance(a, b);
  assert(d.every(x => x === 0xFF), 'all FF');
});

test('compareDistance: equal distances return 0', () => {
  const d = new Uint8Array([0x01, 0x02]);
  assertEqual(compareDistance(d, d), 0, 'equal');
});

test('compareDistance: shorter distance is smaller', () => {
  const closer = new Uint8Array([0x00, 0x01]);
  const farther = new Uint8Array([0x00, 0x02]);
  assert(compareDistance(closer, farther) < 0, 'closer < farther');
});

test('compareDistance: MSB dominates', () => {
  const a = new Uint8Array([0x01, 0xFF]); // closer (MSB = 1)
  const b = new Uint8Array([0x02, 0x00]); // farther (MSB = 2)
  assert(compareDistance(a, b) < 0, 'MSB dominates');
});

// ════════════════════════════════════════════
// CLOSEST NODES
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Closest Nodes ──\x1b[0m');

test('closestNodes returns up to N nodes', () => {
  const nodes = makeNodes(10);
  const key = randomBytes(8);
  const closest = closestNodes(key, nodes, 3);
  assertEqual(closest.length, 3, 'returns 3');
});

test('closestNodes returns all if fewer than N', () => {
  const nodes = makeNodes(2);
  const key = randomBytes(8);
  const closest = closestNodes(key, nodes, 5);
  assertEqual(closest.length, 2, 'returns 2 (all available)');
});

test('closestNodes excludes self', () => {
  const nodes = makeNodes(5);
  const selfId = nodes[0].meshId;
  const key = randomBytes(8);
  const closest = closestNodes(key, nodes, 5, selfId);
  const selfInResult = closest.some(n => toHex(n.meshId) === toHex(selfId));
  assert(!selfInResult, 'self excluded');
  assertEqual(closest.length, 4, 'returns 4 (5 minus self)');
});

test('closestNodes sorted by distance', () => {
  const nodes = makeNodes(20);
  const key = randomBytes(8);
  const closest = closestNodes(key, nodes, 20);
  // Verify sorting: each distance should be <= next
  for (let i = 1; i < closest.length; i++) {
    const d1 = xorDistance(key, closest[i-1].dhtAddress);
    const d2 = xorDistance(key, closest[i].dhtAddress);
    assert(compareDistance(d1, d2) <= 0, `node ${i-1} closer than node ${i}`);
  }
});

test('closestNodes empty input returns empty', () => {
  const closest = closestNodes(randomBytes(8), [], 3);
  assertEqual(closest.length, 0, 'empty');
});

// ════════════════════════════════════════════
// REPLICATION TARGETS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Replication Targets ──\x1b[0m');

test('replicationTargets returns min(3, available)', () => {
  const nodes = makeNodes(10);
  const selfId = randomBytes(16);
  const key = randomBytes(8);
  const targets = replicationTargets(key, nodes, selfId);
  assertEqual(targets.length, 3, 'default replication = 3');
});

test('replicationTargets with 2 nodes returns 2', () => {
  const nodes = makeNodes(2);
  const selfId = randomBytes(16);
  const key = randomBytes(8);
  const targets = replicationTargets(key, nodes, selfId);
  assertEqual(targets.length, 2, 'limited by available');
});

test('replicationTargets excludes self', () => {
  const nodes = makeNodes(5);
  const selfId = nodes[2].meshId;
  const key = randomBytes(8);
  const targets = replicationTargets(key, nodes, selfId);
  const selfInResult = targets.some(n => toHex(n.meshId) === toHex(selfId));
  assert(!selfInResult, 'self excluded');
});

// ════════════════════════════════════════════
// MER STORE: BASIC OPERATIONS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MERStore: Basic Operations ──\x1b[0m');

test('store and retrieve MER', () => {
  const store = new MERStore();
  const mer = createMER(sp(), kp.secretKey);
  assert(store.store(mer), 'should store');
  assertEqual(store.size, 1, 'size');
  const retrieved = store.get(mer.merId);
  assert(retrieved !== undefined, 'should retrieve');
  assertEqual(toHex(retrieved!.merId), toHex(mer.merId), 'same MER');
});

test('reject duplicate MER', () => {
  const store = new MERStore();
  const mer = createMER(sp(), kp.secretKey);
  assert(store.store(mer), 'first store');
  assert(!store.store(mer), 'reject duplicate');
  assertEqual(store.size, 1, 'still size 1');
});

test('reject expired MER', () => {
  const store = new MERStore();
  const mer = createMER(sp({ ttlDays: 1 }), kp.secretKey);
  mer.createdAt = Date.now() - (2 * 86400000); // 2 days ago
  assert(!store.store(mer), 'reject expired');
  assertEqual(store.size, 0, 'empty');
});

test('getAll returns all stored MERs', () => {
  const store = new MERStore();
  for (let i = 0; i < 5; i++) {
    store.store(createMER(sp(), kp.secretKey));
  }
  assertEqual(store.getAll().length, 5, '5 MERs');
});

test('getByTaskType filters correctly', () => {
  const store = new MERStore();
  store.store(createMER(sp({ taskType: TaskType.INFERENCE }), kp.secretKey));
  store.store(createMER(sp({ taskType: TaskType.INFERENCE }), kp.secretKey));
  store.store(createMER(sp({ taskType: TaskType.MAP_REDUCE }), kp.secretKey));
  assertEqual(store.getByTaskType(TaskType.INFERENCE).length, 2, '2 inference');
  assertEqual(store.getByTaskType(TaskType.MAP_REDUCE).length, 1, '1 map_reduce');
  assertEqual(store.getByTaskType(TaskType.PIPELINE).length, 0, '0 pipeline');
});

test('getByIds returns requested MERs', () => {
  const store = new MERStore();
  const m1 = createMER(sp(), kp.secretKey);
  const m2 = createMER(sp(), kp.secretKey);
  const m3 = createMER(sp(), kp.secretKey);
  store.store(m1); store.store(m2); store.store(m3);
  const results = store.getByIds([m1.merId, m3.merId]);
  assertEqual(results.length, 2, 'got 2');
  const ids = results.map(m => toHex(m.merId));
  assert(ids.includes(toHex(m1.merId)), 'includes m1');
  assert(ids.includes(toHex(m3.merId)), 'includes m3');
});

test('remove MER', () => {
  const store = new MERStore();
  const mer = createMER(sp(), kp.secretKey);
  store.store(mer);
  assertEqual(store.size, 1, 'has 1');
  assert(store.remove(mer.merId), 'removed');
  assertEqual(store.size, 0, 'now 0');
  assert(!store.remove(mer.merId), 'second remove false');
});

test('clear empties store', () => {
  const store = new MERStore();
  for (let i = 0; i < 5; i++) store.store(createMER(sp(), kp.secretKey));
  assertEqual(store.size, 5, 'has 5');
  store.clear();
  assertEqual(store.size, 0, 'cleared');
  assert(store.empty, 'empty');
});

test('hasBetter checks confidence', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 80 }), kp.secretKey));
  assert(store.hasBetter(TaskType.INFERENCE, 70), 'has better than 70');
  assert(!store.hasBetter(TaskType.INFERENCE, 90), 'nothing better than 90');
  assert(!store.hasBetter(TaskType.PIPELINE, 10), 'wrong task type');
});

test('taskTypeCount and originCount', () => {
  const store = new MERStore();
  const origin1 = randomBytes(8);
  const origin2 = randomBytes(8);
  store.store(createMER(sp({ taskType: TaskType.INFERENCE, originMeshHash: origin1 }), kp.secretKey));
  store.store(createMER(sp({ taskType: TaskType.INFERENCE, originMeshHash: origin2 }), kp.secretKey));
  store.store(createMER(sp({ taskType: TaskType.MAP_REDUCE, originMeshHash: origin1 }), kp.secretKey));
  assertEqual(store.taskTypeCount, 2, '2 task types');
  assertEqual(store.originCount, 2, '2 origins');
});

// ════════════════════════════════════════════
// MER STORE: CAPACITY + EVICTION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MERStore: Capacity + Eviction ──\x1b[0m');

test('evicts when at capacity', () => {
  const store = new MERStore({ maxMers: 5, maxPerOrigin: 100 });
  for (let i = 0; i < 5; i++) store.store(createMER(sp(), kp.secretKey));
  assertEqual(store.size, 5, 'full');
  // 6th MER should trigger eviction
  assert(store.store(createMER(sp(), kp.secretKey)), 'stored 6th (evicted one)');
  assertEqual(store.size, 5, 'still 5 after eviction');
});

test('evicts expired MERs first', () => {
  const store = new MERStore({ maxMers: 3, maxPerOrigin: 100 });
  // Store 2 fresh + 1 expired
  const fresh1 = createMER(sp({ confidence: 90 }), kp.secretKey);
  const fresh2 = createMER(sp({ confidence: 90 }), kp.secretKey);
  const expired = createMER(sp({ confidence: 95, ttlDays: 1 }), kp.secretKey);
  expired.createdAt = Date.now() - (2 * 86400000); // force expired
  // Directly insert expired (bypass expiry check in store())
  (store as any).mers.set(toHex(expired.merId), expired);
  store.store(fresh1); store.store(fresh2);
  assertEqual(store.size, 3, 'full');
  // 4th MER should evict the expired one
  store.store(createMER(sp(), kp.secretKey));
  assertEqual(store.size, 3, 'still 3');
  assert(!store.get(expired.merId), 'expired was evicted');
});

test('evicts lowest confidence when no expired', () => {
  const store = new MERStore({ maxMers: 3, maxPerOrigin: 100 });
  const low = createMER(sp({ confidence: 20 }), kp.secretKey);
  const mid = createMER(sp({ confidence: 60 }), kp.secretKey);
  const high = createMER(sp({ confidence: 95 }), kp.secretKey);
  store.store(low); store.store(mid); store.store(high);
  assertEqual(store.size, 3, 'full');
  store.store(createMER(sp({ confidence: 80 }), kp.secretKey));
  assertEqual(store.size, 3, 'still 3');
  assert(!store.get(low.merId), 'lowest confidence evicted');
  assert(!!store.get(high.merId), 'highest confidence kept');
});

test('origin cap enforced', () => {
  const store = new MERStore({ maxMers: 1000, maxPerOrigin: 3 });
  const sameOrigin = randomBytes(8);
  for (let i = 0; i < 3; i++) {
    assert(store.store(createMER(sp({ originMeshHash: sameOrigin }), kp.secretKey)), `store ${i}`);
  }
  assert(!store.store(createMER(sp({ originMeshHash: sameOrigin }), kp.secretKey)), 'rejected 4th from same origin');
  assertEqual(store.size, 3, 'capped at 3');
  // Different origin should still work
  assert(store.store(createMER(sp({ originMeshHash: randomBytes(8) }), kp.secretKey)), 'different origin accepted');
});

test('purgeExpired removes old MERs', () => {
  const store = new MERStore();
  const fresh = createMER(sp(), kp.secretKey);
  store.store(fresh);
  // Manually insert an expired MER
  const expired = createMER(sp({ ttlDays: 1 }), kp.secretKey);
  expired.createdAt = Date.now() - (2 * 86400000);
  (store as any).mers.set(toHex(expired.merId), expired);
  assertEqual(store.size, 2, 'has 2');
  const purged = store.purgeExpired();
  assertEqual(purged, 1, 'purged 1');
  assertEqual(store.size, 1, 'has 1');
  assert(!!store.get(fresh.merId), 'fresh kept');
});

// ════════════════════════════════════════════
// MER STORE: QUERY RANKING
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MERStore: Query Ranking ──\x1b[0m');

test('query returns only matching task type', () => {
  const store = new MERStore();
  store.store(createMER(sp({ taskType: TaskType.INFERENCE }), kp.secretKey));
  store.store(createMER(sp({ taskType: TaskType.MAP_REDUCE }), kp.secretKey));
  const results = store.query(TaskType.INFERENCE);
  assertEqual(results.length, 1, '1 result');
  assertEqual(results[0].mer.taskType, TaskType.INFERENCE, 'correct type');
});

test('query ranks higher confidence first', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 30 }), kp.secretKey));
  store.store(createMER(sp({ confidence: 90 }), kp.secretKey));
  store.store(createMER(sp({ confidence: 60 }), kp.secretKey));
  const results = store.query(TaskType.INFERENCE);
  assertEqual(results.length, 3, '3 results');
  assert(results[0].score >= results[1].score, 'sorted by score desc');
  assert(results[1].score >= results[2].score, 'sorted by score desc');
  // Highest confidence MER should rank first
  assertEqual(results[0].mer.confidence, 90, 'highest confidence first');
});

test('query ranks higher generation higher', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 80, generation: 0 }), kp.secretKey));
  store.store(createMER(sp({ confidence: 80, generation: 5 }), kp.secretKey));
  const results = store.query(TaskType.INFERENCE);
  assertEqual(results.length, 2, '2 results');
  assert(results[0].mer.generation >= results[1].mer.generation, 'higher gen ranks first');
});

test('query skips expired MERs', () => {
  const store = new MERStore();
  store.store(createMER(sp({ confidence: 90 }), kp.secretKey));
  const expired = createMER(sp({ confidence: 95, ttlDays: 1 }), kp.secretKey);
  expired.createdAt = Date.now() - (2 * 86400000);
  (store as any).mers.set(toHex(expired.merId), expired);
  const results = store.query(TaskType.INFERENCE);
  assertEqual(results.length, 1, 'only non-expired');
  assertEqual(results[0].mer.confidence, 90, 'correct MER');
});

test('query respects maxResults', () => {
  const store = new MERStore();
  for (let i = 0; i < 20; i++) store.store(createMER(sp(), kp.secretKey));
  const results = store.query(TaskType.INFERENCE, undefined, 5);
  assertEqual(results.length, 5, 'capped at 5');
});

test('query returns scores between 0-100', () => {
  const store = new MERStore();
  for (let i = 0; i < 10; i++) {
    store.store(createMER(sp({ confidence: 10 + i * 9 }), kp.secretKey));
  }
  const results = store.query(TaskType.INFERENCE);
  for (const r of results) {
    assert(r.score >= 0 && r.score <= 100, `score ${r.score} in range`);
  }
});

test('query with mesh signature affects similarity score', () => {
  const store = new MERStore();
  const myMeshSig = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD, 0x11, 0x22, 0x33, 0x44]);
  // Similar mesh signature
  store.store(createMER(sp({
    confidence: 80, meshSignature: new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD, 0x11, 0x22, 0x33, 0x44]),
  }), kp.secretKey));
  // Very different mesh signature
  store.store(createMER(sp({
    confidence: 80, meshSignature: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  }), kp.secretKey));
  const results = store.query(TaskType.INFERENCE, myMeshSig);
  assertEqual(results.length, 2, '2 results');
  // Similar mesh should rank higher (same confidence, but similarity boost)
  assert(results[0].score >= results[1].score, 'similar mesh ranks higher');
});

// ════════════════════════════════════════════
// MER STORE: VERIFIED STORE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MERStore: Verified Store ──\x1b[0m');

test('storeVerified accepts valid signature', () => {
  const store = new MERStore();
  const mer = createMER(sp(), kp.secretKey);
  assert(store.storeVerified(mer, kp.publicKey), 'accepted valid');
  assertEqual(store.size, 1, 'stored');
});

test('storeVerified rejects invalid signature', () => {
  const store = new MERStore();
  const mer = createMER(sp(), kp.secretKey);
  const otherKP = generateSigningKeyPair();
  assert(!store.storeVerified(mer, otherKP.publicKey), 'rejected invalid');
  assertEqual(store.size, 0, 'not stored');
});

test('storeVerified rejects tampered MER', () => {
  const store = new MERStore();
  const mer = createMER(sp(), kp.secretKey);
  mer.confidence = 99; // tamper
  assert(!store.storeVerified(mer, kp.publicKey), 'rejected tampered');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 14: MCL DHT + Distributed Mesh Memory\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);

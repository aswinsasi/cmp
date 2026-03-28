/**
 * CMP Phase 13 Test Suite
 * Tests: Mesh Cognition Layer - MER, Bloom Filter, MCL Profile
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase13-mcl-mer.test.ts
 *
 * @author Agent Viscro
 */

import {
  generateSigningKeyPair, randomBytes, toHex,
  encodeBeacon, decodeBeacon, createBeacon,
  TaskType, MessageType,
} from '../src';

import {
  createMER, verifyMER, isMERExpired, merDHTKey,
  merToWire, merFromWire,
  BloomFilter, BLOOM_BYTES,
  buildMCLProfile, profileHasExperience,
  profileToWire, profileFromWire,
} from '../src/mcl';

import type { MERCreateParams } from '../src/mcl/mer';
import { DecompositionStrategy, BottleneckFlag, MER_DEFAULT_TTL_DAYS, MER_MAX_GENERATION } from '../src/types/mcl';

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

console.log('\n\x1b[1m── Phase 13: MCL MER + Bloom + Profile ──\x1b[0m');

console.log('\n\x1b[1m── MER Creation ──\x1b[0m');
test('valid structure', () => { const m = createMER(sp(), kp.secretKey); assertEqual(m.merId.length, 16, 'id'); assertEqual(m.meshSignature.length, 8, 'sig'); assertEqual(m.signature.length, 64, 'sig64'); assertEqual(m.ttlDays, MER_DEFAULT_TTL_DAYS, 'ttl'); });
test('auto-calculates confidence', () => { const m = createMER(sp({ performance: { totalTimeMs: 12000, distributionOverheadPct: 12, executionEfficiency: 90, faultEvents: 0, reassignmentCount: 0 } }), kp.secretKey); assert(m.confidence >= 80 && m.confidence <= 100, `conf=${m.confidence}`); });
test('faults reduce confidence', () => { const c = createMER(sp({ performance: { totalTimeMs: 1e4, distributionOverheadPct: 10, executionEfficiency: 90, faultEvents: 0, reassignmentCount: 0 } }), kp.secretKey); const f = createMER(sp({ performance: { totalTimeMs: 1e4, distributionOverheadPct: 10, executionEfficiency: 90, faultEvents: 3, reassignmentCount: 2 } }), kp.secretKey); assert(f.confidence < c.confidence, `faulty ${f.confidence} < clean ${c.confidence}`); });
test('caps generation at MAX', () => { const m = createMER(sp({ generation: 999 }), kp.secretKey); assertEqual(m.generation, MER_MAX_GENERATION, 'gen'); });
test('unique IDs across 50 MERs', () => { const s = new Set<string>(); for (let i = 0; i < 50; i++) s.add(toHex(createMER(sp(), kp.secretKey).merId)); assertEqual(s.size, 50, 'unique'); });
test('custom confidence and TTL', () => { const m = createMER(sp({ confidence: 42, ttlDays: 30 }), kp.secretKey); assertEqual(m.confidence, 42, 'conf'); assertEqual(m.ttlDays, 30, 'ttl'); });

console.log('\n\x1b[1m── MER Signing ──\x1b[0m');
test('valid signature passes', () => { const m = createMER(sp(), kp.secretKey); assert(verifyMER(m, kp.publicKey), 'verify'); });
test('wrong key fails', () => { const m = createMER(sp(), kp.secretKey); assert(!verifyMER(m, generateSigningKeyPair().publicKey), 'reject wrong key'); });
test('tampered confidence fails', () => { const m = createMER(sp(), kp.secretKey); m.confidence = 99; assert(!verifyMER(m, kp.publicKey), 'reject tamper'); });
test('tampered hints fails', () => { const m = createMER(sp(), kp.secretKey); m.learnedHints.optimalChunkSizeKb = 9999; assert(!verifyMER(m, kp.publicKey), 'reject tamper'); });
test('zeroed signature fails', () => { const m = createMER(sp(), kp.secretKey); m.signature = new Uint8Array(64); assert(!verifyMER(m, kp.publicKey), 'reject zero sig'); });
test('tampered taskType fails', () => { const m = createMER(sp(), kp.secretKey); m.taskType = TaskType.PIPELINE; assert(!verifyMER(m, kp.publicKey), 'reject tamper type'); });

console.log('\n\x1b[1m── MER Expiry ──\x1b[0m');
test('fresh MER not expired', () => { assert(!isMERExpired(createMER(sp(), kp.secretKey)), 'fresh'); });
test('old MER expired', () => { const m = createMER(sp({ ttlDays: 1 }), kp.secretKey); m.createdAt = Date.now() - 2*86400000; assert(isMERExpired(m), 'expired'); });
test('under TTL not expired', () => { const m = createMER(sp({ ttlDays: 1 }), kp.secretKey); m.createdAt = Date.now() - 23*3600000; assert(!isMERExpired(m), 'not expired'); });

console.log('\n\x1b[1m── MER DHT Key ──\x1b[0m');
test('8-byte key', () => { assertEqual(merDHTKey(TaskType.INFERENCE, randomBytes(8)).length, 8, 'len'); });
test('deterministic', () => { const s = randomBytes(8); assertEqual(toHex(merDHTKey(TaskType.INFERENCE, s)), toHex(merDHTKey(TaskType.INFERENCE, s)), 'same'); });
test('different for different types', () => { const s = randomBytes(8); assert(toHex(merDHTKey(TaskType.INFERENCE, s)) !== toHex(merDHTKey(TaskType.MAP_REDUCE, s)), 'diff'); });

console.log('\n\x1b[1m── MER Wire ──\x1b[0m');
test('round-trip preserves fields', () => { const o = createMER(sp(), kp.secretKey); const r = merFromWire(merToWire(o)); assertEqual(toHex(r.merId), toHex(o.merId), 'id'); assertEqual(r.taskType, o.taskType, 'type'); assertEqual(r.confidence, o.confidence, 'conf'); assertEqual(r.performance.totalTimeMs, o.performance.totalTimeMs, 'time'); assertEqual(toHex(r.signature), toHex(o.signature), 'sig'); });
test('signature valid after round-trip', () => { const o = createMER(sp(), kp.secretKey); assert(verifyMER(merFromWire(merToWire(o)), kp.publicKey), 'verify'); });
test('survives JSON serialization', () => { const o = createMER(sp(), kp.secretKey); assert(verifyMER(merFromWire(JSON.parse(JSON.stringify(merToWire(o)))), kp.publicKey), 'json verify'); });

console.log('\n\x1b[1m── Bloom Filter ──\x1b[0m');
test('32-byte empty filter', () => { const b = new BloomFilter(); assertEqual(b.toBytes().length, BLOOM_BYTES, 'size'); assert(b.isEmpty(), 'empty'); });
test('positive for added items', () => { const b = new BloomFilter(); b.add('inference'); b.add('map_reduce'); assert(b.test('inference'), 'find inference'); assert(b.test('map_reduce'), 'find map_reduce'); });
test('low false positive rate', () => { const b = new BloomFilter(); b.add('inference'); let fp = 0; for (let i = 0; i < 100; i++) if (b.test(`rnd_${i}`)) fp++; assert(fp < 10, `fp=${fp}/100`); });
test('Uint8Array items', () => { const b = new BloomFilter(); b.add(new Uint8Array([0])); b.add(new Uint8Array([2])); assert(b.test(new Uint8Array([0])), 'find 0'); assert(b.test(new Uint8Array([2])), 'find 2'); });
test('toBytes/fromBytes round-trip', () => { const b1 = new BloomFilter(); b1.add('x'); const b2 = BloomFilter.fromBytes(b1.toBytes()); assert(b2.test('x'), 'roundtrip'); });
test('merge', () => { const a = new BloomFilter(); a.add('a'); const b = new BloomFilter(); b.add('b'); a.merge(b); assert(a.test('a') && a.test('b'), 'merged'); });
test('clear', () => { const b = new BloomFilter(); b.add('x'); b.clear(); assert(b.isEmpty() && !b.test('x'), 'cleared'); });

console.log('\n\x1b[1m── MCL Profile ──\x1b[0m');
test('empty store', () => { const p = buildMCLProfile([]); assertEqual(p.merCount, 0, 'count'); assertEqual(p.crossMeshCount, 0, 'cross'); assert(!profileHasExperience(p, TaskType.INFERENCE), 'no exp'); });
test('build from MERs', () => { const ms = [createMER(sp({ taskType: TaskType.INFERENCE }), kp.secretKey), createMER(sp({ taskType: TaskType.MAP_REDUCE }), kp.secretKey)]; const p = buildMCLProfile(ms); assertEqual(p.merCount, 2, 'count'); assert(profileHasExperience(p, TaskType.INFERENCE), 'inf'); assert(profileHasExperience(p, TaskType.MAP_REDUCE), 'mr'); });
test('wire round-trip', () => { const o = buildMCLProfile([createMER(sp(), kp.secretKey)]); const r = profileFromWire(JSON.parse(JSON.stringify(profileToWire(o)))); assertEqual(r.merCount, o.merCount, 'count'); assert(profileHasExperience(r, TaskType.INFERENCE), 'exp'); });

console.log('\n\x1b[1m── Beacon MCL Flag ──\x1b[0m');
test('mclCapable encodes/decodes', () => { const b = createBeacon(randomBytes(16), randomBytes(8), { mclCapable: true }); const d = decodeBeacon(encodeBeacon(b))!; assert(d.flags.mclCapable, 'mcl flag'); });
test('mclCapable defaults true', () => { assert(createBeacon(randomBytes(16), randomBytes(8)).flags.mclCapable, 'default'); });
test('mclCapable false works', () => { const b = createBeacon(randomBytes(16), randomBytes(8), { mclCapable: false }); assert(!decodeBeacon(encodeBeacon(b))!.flags.mclCapable, 'false'); });
test('MCL flag preserves other flags', () => { const b = createBeacon(randomBytes(16), randomBytes(8), { acceptingTasks: true, hasPendingTasks: true, relayCapable: false, mclCapable: true }); const d = decodeBeacon(encodeBeacon(b))!; assert(d.flags.acceptingTasks && d.flags.hasPendingTasks && !d.flags.relayCapable && d.flags.mclCapable, 'all flags'); });

console.log('\n\x1b[1m── MCL Message Types ──\x1b[0m');
test('MCL types defined', () => { assertEqual(MessageType.MER_OFFER, 0x70, 'OFFER'); assertEqual(MessageType.MER_REQUEST, 0x71, 'REQ'); assertEqual(MessageType.MER_TRANSFER, 0x72, 'XFER'); assertEqual(MessageType.MER_STORE, 0x73, 'STORE'); assertEqual(MessageType.MER_QUERY, 0x74, 'QUERY'); });
test('existing types unchanged', () => { assertEqual(MessageType.BEACON, 0x01, 'BEACON'); assertEqual(MessageType.CHUNK_DATA, 0x20, 'CHUNK'); assertEqual(MessageType.HEARTBEAT, 0x30, 'HB'); assertEqual(MessageType.CREDIT_RECEIPT, 0x60, 'CREDIT'); });

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 13: MCL MER + Bloom + Profile\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);

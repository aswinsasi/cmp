/**
 * CMP Phase 19 Test Suite
 * Tests: SQLite MER Persistence
 *   - Save/load MERs to/from SQLite
 *   - Survive simulated restart (close + reopen)
 *   - Persistence hooks in MERStore (store/remove/purge/clear)
 *   - MCLEngine with persistence (initPersistence + start)
 *   - Graceful fallback when persistence unavailable
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase19-persistence.test.ts
 *
 * @author Agent Viscro
 */

import fs from 'fs';
import path from 'path';
import {
  generateSigningKeyPair, randomBytes, toHex,
  TaskType,
} from '../src';

import {
  createMER, MERStore, SQLiteMERPersistence,
  MCLEngine,
} from '../src/mcl';

import type { MERCreateParams } from '../src/mcl/mer';
import { DecompositionStrategy, BottleneckFlag } from '../src/types/mcl';
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
const TEST_DB_DIR = path.join(process.cwd(), 'cmp-test-data');
let testDbCounter = 0;

function testDbPath(): string {
  return path.join(TEST_DB_DIR, `test-mers-${Date.now()}-${testDbCounter++}.db`);
}

function sp(o: Partial<MERCreateParams> = {}): MERCreateParams {
  return { taskType: TaskType.INFERENCE, meshSignature: randomBytes(8), deviceCount: 5,
    strategyUsed: DecompositionStrategy.DATA_PARALLEL, chunkCount: 8, avgChunkSizeKb: 5632,
    performance: { totalTimeMs: 12000, distributionOverheadPct: 12, executionEfficiency: 87, faultEvents: 0, reassignmentCount: 0 },
    learnedHints: { optimalChunkSizeKb: 4800, optimalDeviceCount: 6, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: BottleneckFlag.NETWORK },
    environmentHash: randomBytes(8), originMeshHash: randomBytes(8), ...o };
}

function cleanup(): void {
  try {
    if (fs.existsSync(TEST_DB_DIR)) {
      const files = fs.readdirSync(TEST_DB_DIR);
      for (const f of files) {
        fs.unlinkSync(path.join(TEST_DB_DIR, f));
      }
      fs.rmdirSync(TEST_DB_DIR);
    }
  } catch {}
}

async function main() {

// Clean up from previous runs
cleanup();

console.log('\n\x1b[1m── Phase 19: SQLite MER Persistence ──\x1b[0m');

// ════════════════════════════════════════════
// SQLiteMERPersistence DIRECT
// ════════════════════════════════════════════
console.log('\n\x1b[1m── SQLiteMERPersistence ──\x1b[0m');

await testAsync('init creates database file', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();
  assert(fs.existsSync(dbPath), 'db file created');
  assertEqual(p.count(), 0, 'empty initially');
  p.close();
});

await testAsync('save and loadAll round-trip', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const m1 = createMER(sp({ confidence: 85 }), kp.secretKey);
  const m2 = createMER(sp({ confidence: 90, taskType: TaskType.MAP_REDUCE }), kp.secretKey);
  p.save(m1);
  p.save(m2);
  assertEqual(p.count(), 2, '2 saved');

  const loaded = p.loadAll();
  assertEqual(loaded.length, 2, '2 loaded');

  const ids = loaded.map(m => toHex(m.merId)).sort();
  const expected = [toHex(m1.merId), toHex(m2.merId)].sort();
  assertEqual(ids[0], expected[0], 'id match 1');
  assertEqual(ids[1], expected[1], 'id match 2');

  // Verify all fields
  const restored = loaded.find(m => toHex(m.merId) === toHex(m1.merId))!;
  assertEqual(restored.taskType, m1.taskType, 'taskType');
  assertEqual(restored.deviceCount, m1.deviceCount, 'deviceCount');
  assertEqual(restored.confidence, m1.confidence, 'confidence');
  assertEqual(restored.generation, m1.generation, 'generation');
  assertEqual(restored.performance.totalTimeMs, m1.performance.totalTimeMs, 'totalTimeMs');
  assertEqual(restored.learnedHints.optimalChunkSizeKb, m1.learnedHints.optimalChunkSizeKb, 'hintChunk');
  assertEqual(toHex(restored.meshSignature), toHex(m1.meshSignature), 'meshSig');
  assertEqual(toHex(restored.signature), toHex(m1.signature), 'signature');

  p.close();
});

await testAsync('delete removes specific MER', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const m1 = createMER(sp(), kp.secretKey);
  const m2 = createMER(sp(), kp.secretKey);
  p.save(m1);
  p.save(m2);
  assertEqual(p.count(), 2, 'has 2');

  p.delete(toHex(m1.merId));
  assertEqual(p.count(), 1, 'has 1');

  const loaded = p.loadAll();
  assertEqual(toHex(loaded[0].merId), toHex(m2.merId), 'correct one remains');

  p.close();
});

await testAsync('deleteMany bulk delete', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const mers = [];
  for (let i = 0; i < 5; i++) {
    const m = createMER(sp(), kp.secretKey);
    p.save(m);
    mers.push(m);
  }
  assertEqual(p.count(), 5, 'has 5');

  p.deleteMany([toHex(mers[0].merId), toHex(mers[2].merId), toHex(mers[4].merId)]);
  assertEqual(p.count(), 2, 'has 2 after bulk delete');

  p.close();
});

await testAsync('survives close + reopen (restart simulation)', async () => {
  const dbPath = testDbPath();

  // Session 1: save MERs
  const p1 = new SQLiteMERPersistence(dbPath);
  await p1.init();
  const m1 = createMER(sp({ confidence: 91, taskType: TaskType.INFERENCE }), kp.secretKey);
  const m2 = createMER(sp({ confidence: 88, taskType: TaskType.MAP_REDUCE }), kp.secretKey);
  const m3 = createMER(sp({ confidence: 75, taskType: TaskType.PIPELINE }), kp.secretKey);
  p1.save(m1);
  p1.save(m2);
  p1.save(m3);
  assertEqual(p1.count(), 3, 'session 1: 3 MERs');
  p1.close();

  // Session 2: reopen and verify
  const p2 = new SQLiteMERPersistence(dbPath);
  await p2.init();
  assertEqual(p2.count(), 3, 'session 2: 3 MERs survived');

  const loaded = p2.loadAll();
  assertEqual(loaded.length, 3, '3 loaded');

  // Verify specific MER survived correctly
  const found = loaded.find(m => toHex(m.merId) === toHex(m1.merId));
  assert(found !== undefined, 'specific MER found');
  assertEqual(found!.confidence, 91, 'confidence preserved');
  assertEqual(found!.taskType, TaskType.INFERENCE, 'taskType preserved');

  p2.close();
});

// ════════════════════════════════════════════
// MERStore WITH PERSISTENCE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MERStore with Persistence ──\x1b[0m');

await testAsync('store() persists automatically', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const store = new MERStore({ persistence: p });
  const mer = createMER(sp({ confidence: 85 }), kp.secretKey);
  store.store(mer);

  // Check persistence directly
  assertEqual(p.count(), 1, 'persisted');

  // Verify by loading from fresh persistence
  const loaded = p.loadAll();
  assertEqual(toHex(loaded[0].merId), toHex(mer.merId), 'correct MER persisted');

  p.close();
});

await testAsync('remove() deletes from persistence', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const store = new MERStore({ persistence: p });
  const m1 = createMER(sp(), kp.secretKey);
  const m2 = createMER(sp(), kp.secretKey);
  store.store(m1);
  store.store(m2);
  assertEqual(p.count(), 2, '2 persisted');

  store.remove(m1.merId);
  assertEqual(p.count(), 1, '1 after remove');
  assertEqual(store.size, 1, 'store size 1');

  p.close();
});

await testAsync('purgeExpired() syncs to persistence', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const store = new MERStore({ persistence: p });
  const fresh = createMER(sp({ confidence: 90 }), kp.secretKey);
  store.store(fresh);

  // Manually insert expired MER into both store and persistence
  const expired = createMER(sp({ confidence: 80, ttlDays: 1 }), kp.secretKey);
  expired.createdAt = Date.now() - (2 * 86400000);
  (store as any).mers.set(toHex(expired.merId), expired);
  p.save(expired);
  assertEqual(p.count(), 2, '2 in persistence');

  store.purgeExpired();
  assertEqual(store.size, 1, 'store: 1 after purge');
  assertEqual(p.count(), 1, 'persistence: 1 after purge');

  p.close();
});

await testAsync('clear() empties persistence', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const store = new MERStore({ persistence: p });
  for (let i = 0; i < 5; i++) store.store(createMER(sp(), kp.secretKey));
  assertEqual(p.count(), 5, '5 persisted');

  store.clear();
  assertEqual(store.size, 0, 'store empty');
  assertEqual(p.count(), 0, 'persistence empty');

  p.close();
});

await testAsync('loadFromPersistence restores MERs', async () => {
  const dbPath = testDbPath();

  // Session 1: save via store
  const p1 = new SQLiteMERPersistence(dbPath);
  await p1.init();
  const store1 = new MERStore({ persistence: p1 });
  for (let i = 0; i < 8; i++) {
    store1.store(createMER(sp({ confidence: 80 + i }), kp.secretKey));
  }
  assertEqual(store1.size, 8, 'session 1: 8 MERs');
  p1.close();

  // Session 2: fresh store, load from persistence
  const p2 = new SQLiteMERPersistence(dbPath);
  await p2.init();
  const store2 = new MERStore({ persistence: p2 });
  assertEqual(store2.size, 0, 'fresh store empty');

  const loaded = store2.loadFromPersistence();
  assertEqual(loaded, 8, '8 loaded from persistence');
  assertEqual(store2.size, 8, 'store has 8');

  p2.close();
});

await testAsync('eviction syncs to persistence', async () => {
  const dbPath = testDbPath();
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();

  const store = new MERStore({ maxMers: 3, maxPerOrigin: 100, persistence: p });
  store.store(createMER(sp({ confidence: 50 }), kp.secretKey));
  store.store(createMER(sp({ confidence: 60 }), kp.secretKey));
  store.store(createMER(sp({ confidence: 70 }), kp.secretKey));
  assertEqual(p.count(), 3, '3 persisted');

  // 4th triggers eviction of lowest confidence
  store.store(createMER(sp({ confidence: 90 }), kp.secretKey));
  assertEqual(store.size, 3, 'store still 3');
  assertEqual(p.count(), 3, 'persistence still 3 (evicted one, added one)');

  p.close();
});

// ════════════════════════════════════════════
// MCLEngine WITH PERSISTENCE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MCLEngine with Persistence ──\x1b[0m');

await testAsync('MCLEngine.initPersistence creates database', async () => {
  const dbPath = testDbPath();
  const net = new VirtualNetwork();
  const engine = new MCLEngine({
    meshId: randomBytes(16),
    signingSecretKey: kp.secretKey,
    signingPublicKey: kp.publicKey,
    transport: new VirtualTransport('persist-test', net),
    bus: new EventBus(),
  });

  await engine.initPersistence(dbPath);
  engine.start();

  assert(fs.existsSync(dbPath), 'db file created');

  // Generate MERs
  for (let i = 0; i < 3; i++) {
    engine.onTaskComplete({
      taskType: TaskType.INFERENCE, deviceCount: 5, strategyUsed: 0,
      chunkCount: 4, avgChunkSizeKb: 2048, totalTimeMs: 5000,
      distributionOverheadMs: 500, executionEfficiency: 85 + i,
      faultEvents: 0, reassignmentCount: 0, verified: true,
    });
  }

  assertEqual(engine.getStatus().merCount, 3, '3 MERs in engine');

  // Verify they're on disk
  const p = new SQLiteMERPersistence(dbPath);
  await p.init();
  assertEqual(p.count(), 3, '3 MERs on disk');
  p.close();

  engine.stop();
});

await testAsync('MCLEngine survives restart with persistence', async () => {
  const dbPath = testDbPath();
  const net = new VirtualNetwork();

  // Session 1: generate MERs
  const engine1 = new MCLEngine({
    meshId: randomBytes(16),
    signingSecretKey: kp.secretKey,
    signingPublicKey: kp.publicKey,
    transport: new VirtualTransport('s1', net),
    bus: new EventBus(),
  });
  await engine1.initPersistence(dbPath);
  engine1.start();

  for (let i = 0; i < 5; i++) {
    engine1.onTaskComplete({
      taskType: TaskType.INFERENCE, deviceCount: 3, strategyUsed: 0,
      chunkCount: 4, avgChunkSizeKb: 1024, totalTimeMs: 3000 + i * 500,
      distributionOverheadMs: 300, executionEfficiency: 80 + i * 3,
      faultEvents: 0, reassignmentCount: 0, verified: true,
    });
  }
  assertEqual(engine1.getStatus().merCount, 5, 'session 1: 5 MERs');
  engine1.stop();

  // Session 2: restart with same db
  const engine2 = new MCLEngine({
    meshId: randomBytes(16),
    signingSecretKey: kp.secretKey,
    signingPublicKey: kp.publicKey,
    transport: new VirtualTransport('s2', net),
    bus: new EventBus(),
  });
  await engine2.initPersistence(dbPath);
  engine2.start();

  assertEqual(engine2.getStatus().merCount, 5, 'session 2: 5 MERs restored!');

  // Should be able to generate hints from restored MERs
  const hint = engine2.getHint(TaskType.INFERENCE, 3);
  assert(hint !== null, 'hint available from restored MERs');
  assert(hint!.confidence > 0, `hint confidence: ${hint!.confidence}`);

  engine2.stop();
});

await testAsync('graceful fallback when persistence init fails', async () => {
  const net = new VirtualNetwork();
  const engine = new MCLEngine({
    meshId: randomBytes(16),
    signingSecretKey: kp.secretKey,
    signingPublicKey: kp.publicKey,
    transport: new VirtualTransport('fallback', net),
    bus: new EventBus(),
  });

  // Init with invalid path — should not throw, just warn
  await engine.initPersistence('/nonexistent/deeply/nested/impossible/path/mers.db');
  engine.start();

  // Should still work in-memory
  engine.onTaskComplete({
    taskType: TaskType.INFERENCE, deviceCount: 3, strategyUsed: 0,
    chunkCount: 2, avgChunkSizeKb: 512, totalTimeMs: 2000,
    distributionOverheadMs: 200, executionEfficiency: 90,
    faultEvents: 0, reassignmentCount: 0, verified: true,
  });
  assertEqual(engine.getStatus().merCount, 1, 'in-memory works as fallback');

  engine.stop();
});

// ════════════════════════════════════════════
// CLEANUP + SUMMARY
// ════════════════════════════════════════════
cleanup();

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 19: SQLite MER Persistence\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  console.error(err.stack);
  process.exit(1);
});

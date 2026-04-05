/**
 * CMP v4.0 — Phase 1: Persistent State Tests
 *
 * 33 tests covering:
 *   - V3StateStore: save/load, batch operations, Uint8Array/Map/Set serialization
 *   - Cortex Checkpoints: checkpoint/restore, integrity verification
 *   - Route Snapshots: per-subsystem snapshot/restore round-trips
 *   - State Migrator: version tracking, migration application, validation
 *   - Restart simulation: state survives close/reopen cycle
 *
 * Run: npx tsx packages/core/tests/v4-persistence.test.ts
 *
 * @author Agent Viscro
 */

import fs from 'fs';
import path from 'path';

import {
  V3StateStore,
  Subsystem,
  serializeJSON,
  deserializeJSON,
} from '../src/persistence/v3-state-store';
import type { CortexManifest } from '../src/persistence/v3-state-store';

import {
  CortexCheckpointManager,
  ICortexCheckpointable,
} from '../src/persistence/cortex-checkpoint';

import {
  snapshotConsciousness,
  restoreConsciousness,
  snapshotSpacetime,
  restoreSpacetime,
  snapshotImmune,
  restoreImmune,
  snapshotMetabolism,
  restoreMetabolism,
  snapshotEntanglement,
  restoreEntanglement,
  snapshotAll,
  restoreAll,
} from '../src/persistence/route-snapshot';

import {
  StateMigrator,
  Migration,
} from '../src/persistence/state-migrator';

// ─── Test Runner ───

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

// ─── Test DB ───

const TEST_DIR = '/tmp/cmp-v4-test';
const TEST_DB = path.join(TEST_DIR, 'v3-state-test.db');

function cleanup(): void {
  try { if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); } catch {}
  try { if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
}

// ─── Mocks ───

function mockConsciousness() {
  return {
    getStatus: () => ({
      behavior: 'exploring',
      pheromoneCount: 42,
      dominantPheromone: { type: 'success', intensity: 0.8 },
      quorumStates: [{ type: 'consensus', thresholdReached: true }],
      activeDecisions: 2,
    }),
  };
}

function mockSpacetime() {
  return {
    getStatus: () => ({
      dagNodes: 150,
      trunkHead: 'abc123',
      activeBranches: [{ id: 'branch-1', divergedAt: 100 }],
      activeRaces: 1,
    }),
  };
}

function mockThreatDetector() {
  return { getRecentThreats: () => [{ type: 'replay', deviceId: 'd1', ts: 1000 }, { type: 'sig', deviceId: 'd2', ts: 2000 }] };
}
function mockAntibodyGenerator() {
  return { getLoadedAntibodies: () => [{ pattern: 'replay', severity: 'high' }] };
}
function mockQuarantineManager() {
  return { getQuarantinedDevices: () => ['bad-1', 'bad-2'] };
}
function mockMetabolism() {
  return { getProfile: () => ({ state: 'active', energyBudget: 85, cpuAllocation: 0.6, memoryAllocation: 0.4 }) };
}
function mockMeshBreathing() {
  return { getCurrentPhase: () => 'inhale' };
}

function createMockCortex(modelId: string, partitions: number, bytesPerPart: number): ICortexCheckpointable & { _imported: Map<number, any> } {
  const data: Uint8Array[] = [];
  for (let i = 0; i < partitions; i++) {
    const buf = new Uint8Array(bytesPerPart);
    for (let j = 0; j < bytesPerPart; j++) buf[j] = (i * 37 + j * 13) & 0xFF;
    data.push(buf);
  }
  const imported = new Map<number, any>();

  return {
    _imported: imported,
    getModelId: () => modelId,
    getModelName: () => `Test-${modelId}`,
    getTotalLayers: () => partitions * 4,
    getTotalParams: () => bytesPerPart * partitions,
    getPartitionCount: () => partitions,
    getDtype: () => 'float32',
    exportPartition: (pid: number) => ({
      layerRange: [pid * 4, (pid + 1) * 4 - 1] as [number, number],
      weights: data[pid],
    }),
    importPartition: (pid: number, weights: Uint8Array, manifest: CortexManifest) => {
      imported.set(pid, { weights: new Uint8Array(weights), manifest });
    },
  };
}

// ─── Main ───

async function main() {

cleanup();

let store: V3StateStore;

// ════════════════════════════════════════════
// V3StateStore — Core API
// ════════════════════════════════════════════
console.log('\n\x1b[1m── V3StateStore: Core API ──\x1b[0m');

store = new V3StateStore(TEST_DB);
await store.init();

test('1. save and load simple state', () => {
  store.saveState('test', 'key1', { hello: 'world', count: 42 });
  const r = store.loadState<any>('test', 'key1');
  assertEqual(r.hello, 'world', 'hello field');
  assertEqual(r.count, 42, 'count field');
});

test('2. load returns null for missing key', () => {
  const r = store.loadState('test', 'nonexistent');
  assertEqual(r, null, 'should be null');
});

test('3. Uint8Array round-trip', () => {
  const data = {
    meshId: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
    nested: { sig: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
  };
  store.saveState('test', 'binary', data);
  const r = store.loadState<any>('test', 'binary');
  assert(r.meshId instanceof Uint8Array, 'meshId is Uint8Array');
  assertEqual(r.meshId.length, 4, 'meshId length');
  assertEqual(r.meshId[0], 0xDE, 'meshId[0]');
  assertEqual(r.meshId[3], 0xEF, 'meshId[3]');
  assert(r.nested.sig instanceof Uint8Array, 'nested sig is Uint8Array');
  assertEqual(r.nested.sig[7], 8, 'nested sig[7]');
});

test('4. Map round-trip', () => {
  store.saveState('test', 'maps', { routes: new Map([['a', 1], ['b', 2], ['c', 3]]) });
  const r = store.loadState<any>('test', 'maps');
  assert(r.routes instanceof Map, 'routes is Map');
  assertEqual(r.routes.get('a'), 1, 'a=1');
  assertEqual(r.routes.get('c'), 3, 'c=3');
  assertEqual(r.routes.size, 3, 'size=3');
});

test('5. Set round-trip', () => {
  store.saveState('test', 'sets', { peers: new Set(['p1', 'p2', 'p3']) });
  const r = store.loadState<any>('test', 'sets');
  assert(r.peers instanceof Set, 'peers is Set');
  assert(r.peers.has('p2'), 'has p2');
  assertEqual(r.peers.size, 3, 'size=3');
});

test('6. overwrite existing key', () => {
  store.saveState('test', 'ow', { v: 1 });
  store.saveState('test', 'ow', { v: 2 });
  assertEqual(store.loadState<any>('test', 'ow').v, 2, 'latest value');
});

test('7. loadAllKeys returns keys for subsystem', () => {
  store.saveState('s1', 'a', { x: 1 });
  store.saveState('s1', 'b', { x: 2 });
  store.saveState('s2', 'c', { x: 3 });
  const keys = store.loadAllKeys('s1');
  assertEqual(keys.length, 2, 'count');
  assert(keys.includes('a'), 'has a');
  assert(keys.includes('b'), 'has b');
});

test('8. loadAll returns all entries for subsystem', () => {
  const all = store.loadAll('s1');
  assertEqual(all.length, 2, 'count');
  const aEntry = all.find(e => e.key === 'a');
  assert(!!aEntry, 'found a');
  assertEqual(aEntry!.data.x, 1, 'a.x=1');
});

test('9. deleteState removes entry', () => {
  store.saveState('del', 'target', { x: 1 });
  assert(store.loadState('del', 'target') !== null, 'exists before');
  store.deleteState('del', 'target');
  assertEqual(store.loadState('del', 'target'), null, 'null after delete');
});

test('10. clearSubsystem removes only that subsystem', () => {
  store.saveState('clear1', 'a', { x: 1 });
  store.saveState('clear1', 'b', { x: 2 });
  store.saveState('clear2', 'c', { x: 3 });
  store.clearSubsystem('clear1');
  assertEqual(store.loadAllKeys('clear1').length, 0, 'clear1 empty');
  assert(store.loadState('clear2', 'c') !== null, 'clear2 untouched');
});

store.close();
cleanup();

// ════════════════════════════════════════════
// V3StateStore — Batch & Advanced
// ════════════════════════════════════════════
console.log('\n\x1b[1m── V3StateStore: Batch & Advanced ──\x1b[0m');

store = new V3StateStore(TEST_DB);
await store.init();

test('11. saveStateBatch writes atomically', () => {
  const totalBytes = store.saveStateBatch([
    { subsystem: 'batch', key: 'a', data: { v: 1 } },
    { subsystem: 'batch', key: 'b', data: { v: 2 } },
    { subsystem: 'batch', key: 'c', data: { v: 3 } },
  ]);
  assert(totalBytes > 0, 'bytes > 0');
  assertEqual(store.loadState<any>('batch', 'a').v, 1, 'a=1');
  assertEqual(store.loadState<any>('batch', 'c').v, 3, 'c=3');
});

test('12. clearAll wipes everything', () => {
  store.saveState('x1', 'k', { v: 1 });
  store.saveState('x2', 'k', { v: 2 });
  store.clearAll();
  assertEqual(store.loadAllKeys('x1').length, 0, 'x1 empty');
  assertEqual(store.loadAllKeys('x2').length, 0, 'x2 empty');
});

test('13. getInfo returns state summary', () => {
  store.saveState('consciousness', 'behavior', { b: 'exploring' });
  store.saveState('consciousness', 'quorum', { q: true });
  store.saveState('immune', 'threats', { t: [] });
  const info = store.getInfo();
  assertEqual(info.schemaVersion, 1, 'version=1');
  assertEqual(info.totalEntries, 3, 'total=3');
  assertEqual(info.subsystemCounts['consciousness'], 2, 'consciousness=2');
  assertEqual(info.subsystemCounts['immune'], 1, 'immune=1');
});

test('14. recordSave tracks history', () => {
  store.recordSave('manual', 5, 1024, 42);
  store.recordSave('auto', 3, 512, 18);
  const info = store.getInfo();
  assert(info.saveHistory.length >= 2, 'at least 2 saves');
  assertEqual(info.lastSaveType, 'auto', 'last type=auto');
});

test('15. forceSave flushes to disk', () => {
  store.saveState('flush', 'test', { flushed: true });
  store.forceSave();
  assert(fs.existsSync(TEST_DB), 'DB file exists');
  assert(fs.statSync(TEST_DB).size > 0, 'DB file not empty');
});

store.close();
cleanup();

// ════════════════════════════════════════════
// JSON Serialization
// ════════════════════════════════════════════
console.log('\n\x1b[1m── JSON Serialization ──\x1b[0m');

test('16. nested Uint8Array serialize/deserialize', () => {
  const orig = { a: new Uint8Array([1, 2, 3]), b: { c: new Uint8Array([255, 0, 128]) }, d: 'str' };
  const json = serializeJSON(orig);
  const r = deserializeJSON(json);
  assert(r.a instanceof Uint8Array, 'a is Uint8Array');
  assertEqual(r.a[2], 3, 'a[2]=3');
  assertEqual(r.b.c[0], 255, 'nested 255');
  assertEqual(r.d, 'str', 'string preserved');
});

test('17. Map + Set + Uint8Array combo', () => {
  const orig = {
    peers: new Set(['a', 'b']),
    routes: new Map<string, any>([['x', new Uint8Array([9, 8, 7])]]),
  };
  const r = deserializeJSON(serializeJSON(orig));
  assert(r.peers instanceof Set, 'peers is Set');
  assert(r.peers.has('a'), 'has a');
  assert(r.routes instanceof Map, 'routes is Map');
  const val = r.routes.get('x');
  assert(val instanceof Uint8Array, 'map value is Uint8Array');
  assertEqual(val[0], 9, 'x[0]=9');
});

// ════════════════════════════════════════════
// Cortex Checkpoints
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Cortex Checkpoints ──\x1b[0m');

store = new V3StateStore(TEST_DB);
await store.init();

test('18. checkpoint and restore model weights (exact match)', () => {
  const model = createMockCortex('model-001', 3, 64);
  const mgr = new CortexCheckpointManager(store);

  const ckpt = mgr.checkpoint(model);
  assertEqual(ckpt.partitionsSaved, 3, 'saved 3');
  assertEqual(ckpt.totalBytes, 192, '192 bytes');
  assertEqual(ckpt.integrityHashes.length, 3, '3 hashes');

  // Restore into fresh model
  const fresh = createMockCortex('model-001', 3, 64);
  const res = mgr.restore(fresh);
  assertEqual(res.partitionsRestored, 3, 'restored 3');
  assert(res.integrityValid, 'integrity valid');

  // Verify data matches byte-for-byte
  for (let i = 0; i < 3; i++) {
    const orig = model.exportPartition(i).weights;
    const rest = fresh._imported.get(i)!.weights;
    assertEqual(rest.length, orig.length, `part ${i} length`);
    for (let j = 0; j < orig.length; j++) {
      assertEqual(rest[j], orig[j], `part ${i} byte ${j}`);
    }
  }
});

test('19. hasCheckpoint', () => {
  const mgr = new CortexCheckpointManager(store);
  assert(!mgr.hasCheckpoint('nope'), 'no checkpoint');
  mgr.checkpoint(createMockCortex('check-me', 2, 32));
  assert(mgr.hasCheckpoint('check-me'), 'has checkpoint');
});

test('20. listCheckpoints shows all models', () => {
  const mgr = new CortexCheckpointManager(store);
  mgr.checkpoint(createMockCortex('m1', 2, 16));
  mgr.checkpoint(createMockCortex('m2', 4, 32));
  const list = mgr.listCheckpoints();
  assert(list.length >= 2, 'at least 2');
  const m1 = list.find(m => m.modelId === 'm1');
  assert(!!m1, 'found m1');
  assertEqual(m1!.partitions, 2, 'm1 partitions=2');
});

test('21. verifyCheckpoint detects intact data', () => {
  const mgr = new CortexCheckpointManager(store);
  mgr.checkpoint(createMockCortex('verify', 2, 48));
  const r = mgr.verifyCheckpoint('verify');
  assert(r.valid, 'valid');
  assertEqual(r.partitions, 2, 'partitions=2');
  assertEqual(r.errors.length, 0, 'no errors');
});

test('22. deleteCheckpoint removes model', () => {
  const mgr = new CortexCheckpointManager(store);
  mgr.checkpoint(createMockCortex('del', 2, 16));
  assert(mgr.hasCheckpoint('del'), 'exists');
  mgr.deleteCheckpoint('del');
  assert(!mgr.hasCheckpoint('del'), 'deleted');
});

store.close();
cleanup();

// ════════════════════════════════════════════
// Route Snapshots
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Route Snapshots ──\x1b[0m');

store = new V3StateStore(TEST_DB);
await store.init();

test('23. consciousness snapshot/restore', () => {
  const r = snapshotConsciousness(mockConsciousness(), store);
  assertEqual(r.keysWritten, 3, '3 keys');
  assertEqual(r.subsystem, 'consciousness', 'subsystem');

  const rest = restoreConsciousness(store);
  assertEqual(rest.behavior!.currentBehavior, 'exploring', 'behavior');
  assertEqual(rest.pheromones!.pheromoneCount, 42, 'pheromones');
  assertEqual(rest.quorum!.activeDecisions, 2, 'quorum');
});

test('24. spacetime snapshot/restore', () => {
  snapshotSpacetime(mockSpacetime(), store);
  const rest = restoreSpacetime(store);
  assertEqual(rest.dagSummary!.dagNodes, 150, 'dagNodes=150');
  assertEqual(rest.branches!.activeRaces, 1, 'races=1');
});

test('25. immune snapshot/restore', () => {
  snapshotImmune(mockThreatDetector(), mockAntibodyGenerator(), mockQuarantineManager(), store);
  const rest = restoreImmune(store);
  assertEqual(rest.threatLog!.recentThreats.length, 2, '2 threats');
  assertEqual(rest.antibodies!.loaded.length, 1, '1 antibody');
  assert(rest.quarantine!.devices.includes('bad-1'), 'quarantined bad-1');
});

test('26. metabolism snapshot/restore', () => {
  snapshotMetabolism(mockMetabolism(), mockMeshBreathing(), store);
  const rest = restoreMetabolism(store);
  assertEqual(rest.profile!.state, 'active', 'state=active');
  assertEqual(rest.profile!.energyBudget, 85, 'budget=85');
  assertEqual(rest.breathingState!.phase, 'inhale', 'phase=inhale');
});

test('27. entanglement snapshot with Map input', () => {
  const pairs = new Map([
    ['pair-1', { deviceA: 'a', deviceB: 'b', strength: 0.9 }],
    ['pair-2', { deviceA: 'c', deviceB: 'd', strength: 0.7 }],
  ]);
  snapshotEntanglement(pairs, store);
  const rest = restoreEntanglement(store);
  assertEqual(rest!.pairs.length, 2, '2 pairs');
  assertEqual(rest!.count, 2, 'count=2');
});

test('28. snapshotAll + restoreAll round-trip', () => {
  store.clearAll();
  const result = snapshotAll({
    consciousness: mockConsciousness(),
    spacetime: mockSpacetime(),
    threatDetector: mockThreatDetector(),
    antibodyGenerator: mockAntibodyGenerator(),
    quarantineManager: mockQuarantineManager(),
    metabolismManager: mockMetabolism(),
    meshBreathing: mockMeshBreathing(),
  }, store);

  assert(result.totalKeysWritten >= 8, `keys >= 8 (got ${result.totalKeysWritten})`);
  assert(result.subsystems.length >= 5, `subsystems >= 5 (got ${result.subsystems.length})`);

  const restored = restoreAll(store);
  assertEqual(restored.consciousness.behavior!.currentBehavior, 'exploring', 'consciousness ok');
  assert(restored.immune.quarantine!.devices.includes('bad-2'), 'immune ok');
});

store.close();
cleanup();

// ════════════════════════════════════════════
// State Migrator
// ════════════════════════════════════════════
console.log('\n\x1b[1m── State Migrator ──\x1b[0m');

store = new V3StateStore(TEST_DB);
await store.init();

test('29. reports current schema version', () => {
  const migrator = new StateMigrator(store);
  assertEqual(migrator.getCurrentVersion(), 1, 'version=1');
});

test('30. applies custom migrations in order', () => {
  const migs: Migration[] = [
    { name: 'v1_to_v2', targetVersion: 2, description: 'marker v2', up: (s) => { s.saveState('_m', 'v2', { ok: true }); } },
    { name: 'v2_to_v3', targetVersion: 3, description: 'marker v3', up: (s) => { s.saveState('_m', 'v3', { ok: true }); } },
  ];
  const migrator = new StateMigrator(store, migs);
  assert(migrator.needsMigration(), 'needs migration');
  assertEqual(migrator.getPendingMigrations().length, 2, '2 pending');

  const result = migrator.migrate();
  assertEqual(result.previousVersion, 1, 'from v1');
  assertEqual(result.currentVersion, 3, 'to v3');
  assertEqual(result.migrationsApplied.length, 2, '2 applied');
  assertEqual(result.errors.length, 0, 'no errors');
  assertEqual(store.loadState<any>('_m', 'v2').ok, true, 'v2 marker');
  assertEqual(store.loadState<any>('_m', 'v3').ok, true, 'v3 marker');
  assert(!migrator.needsMigration(), 'no more needed');
});

test('31. validate detects duplicate versions', () => {
  const bad: Migration[] = [
    { name: 'a', targetVersion: 2, description: 'first', up: () => {} },
    { name: 'b', targetVersion: 2, description: 'dupe', up: () => {} },
  ];
  const r = new StateMigrator(store, bad).validate();
  assert(!r.valid, 'not valid');
  assert(r.issues.some(i => i.includes('Duplicate')), 'has duplicate issue');
});

test('32. migration failure stops chain', () => {
  store.setSchemaVersion(1);
  const migs: Migration[] = [
    { name: 'v1_to_v2', targetVersion: 2, description: 'ok', up: (s) => { s.saveState('_f', 'v2', { ok: true }); } },
    { name: 'v2_to_v3', targetVersion: 3, description: 'boom', up: () => { throw new Error('boom'); } },
    { name: 'v3_to_v4', targetVersion: 4, description: 'skip', up: (s) => { s.saveState('_f', 'v4', { ok: true }); } },
  ];
  const result = new StateMigrator(store, migs).migrate();
  assertEqual(result.currentVersion, 2, 'stopped at v2');
  assertEqual(result.migrationsApplied.length, 1, '1 applied');
  assertEqual(result.errors.length, 1, '1 error');
  assertEqual(store.loadState('_f', 'v4'), null, 'v4 never applied');
});

store.close();
cleanup();

// ════════════════════════════════════════════
// Persistence Across Restart
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Persistence Across Restart ──\x1b[0m');

await testAsync('33. state survives close/reopen cycle', async () => {
  const store1 = new V3StateStore(TEST_DB);
  await store1.init();

  store1.saveState('restart', 'data', {
    meshId: new Uint8Array([0xCA, 0xFE]),
    count: 99,
    routes: new Map([['home', 42]]),
  });
  store1.forceSave();
  store1.close();

  // Reopen from disk
  const store2 = new V3StateStore(TEST_DB);
  await store2.init();

  const r = store2.loadState<any>('restart', 'data');
  assert(r !== null, 'data found after restart');
  assertEqual(r.count, 99, 'count=99');
  assert(r.meshId instanceof Uint8Array, 'meshId is Uint8Array');
  assertEqual(r.meshId[0], 0xCA, 'meshId[0]=0xCA');
  assertEqual(r.meshId[1], 0xFE, 'meshId[1]=0xFE');
  assert(r.routes instanceof Map, 'routes is Map');
  assertEqual(r.routes.get('home'), 42, 'routes.home=42');

  store2.close();
});

cleanup();

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 1: V4 Persistent State\x1b[0m`);
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

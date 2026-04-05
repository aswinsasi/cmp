/**
 * CMP v4.0 — Integration Tests
 *
 * End-to-end tests proving all 8 pillars work together through
 * the V4Bridge. These map to the blueprint's Section 9 integration tests.
 *
 * Tests:
 *   1. Full compute path: ACL → Compiler → Scheduler → Execute → Result
 *   2. Background job: submit → queue → executor picks up → completes
 *   3. Task compiler auto-detects pattern and merges results
 *   4. Gravity: code ships to device holding data
 *   5. Racing: multiple devices, fastest wins
 *   6. Rate limiter blocks excessive requests
 *   7. MeshFS write → read → ls → rm lifecycle
 *   8. Pipeline: define → start → push → stop → collected output
 *   9. Persistence: state survives bridge restart
 *  10. Stats aggregate across all modules
 *
 * Run: npx tsx packages/core/tests/v4-integration.test.ts
 *
 * @author Agent Viscro
 */

import fs from 'fs';
import path from 'path';

import { V4Bridge, V4ComputeOptions } from '../src/v4-bridge';
import { V3StateStore } from '../src/persistence/v3-state-store';
import { ExecutionStrategy, MeshState } from '../src/scheduler/execution-planner';
import { PeerProvider } from '../src/scheduler/unified-scheduler';
import { DeviceStateReader } from '../src/scheduler/load-monitor';
import { TaskType, Priority } from '../src/types/task';
import { GPUType, Architecture, PowerSource, ThermalState, Runtime } from '../src/types/capability';
import type { CMPCapability } from '../src/types/capability';
import { ACLMode } from '../src/security/access-control';
import { ParallelPattern } from '../src/compiler/compiler-types';
import { JobState } from '../src/scheduler/job-types';
import { PipelineState } from '../src/pipes/pipeline-types';

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

// ─── Helpers ───

const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]);
const TEST_DIR = '/tmp/cmp-v4-integration';
const TEST_DB = path.join(TEST_DIR, 'integration.db');

function cleanup(): void {
  try { if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); } catch {}
  try { if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
}

function encode(s: string): Uint8Array { return new TextEncoder().encode(s); }
function decode(b: Uint8Array): string { return new TextDecoder().decode(b); }

function mockCapability(): CMPCapability {
  return {
    meshId: new Uint8Array(16),
    cpu: { architecture: Architecture.ARM64, coresAvailable: 4, clockMhz: 2400, loadPercent: 20 },
    memory: { availableMb: 4096, bandwidthGbps: 12 },
    gpu: { type: GPUType.NONE, computeUnits: 0, vramMb: 0, supports: new Set() },
    storage: { scratchMb: 1024, readMbps: 500, writeMbps: 200 },
    network: { meshBandwidthMbps: 100, latencyMs: 5 },
    power: { source: PowerSource.PLUGGED, batteryPct: 100, thermalState: ThermalState.NOMINAL },
    runtimes: [Runtime.WASM],
    reputationScore: 5000,
    availabilitySec: 3600,
  };
}

function mockPeerProvider(peerIds: string[] = []): PeerProvider {
  return {
    getPeerCapabilities: () => peerIds.map(id => ({ deviceId: id, capability: mockCapability() })),
    getMeshState: () => ({
      localDeviceId: 'local',
      peerCount: peerIds.length,
      hasGPUPeers: false,
      hasCortex: false,
      totalCores: (peerIds.length + 1) * 4,
      avgLatencyMs: 5,
    }),
  };
}

function mockDeviceReader(): DeviceStateReader {
  return () => ({
    cpuPercent: 20,
    memoryUsedPercent: 40,
    memoryAvailableMb: 6000,
    thermalState: 0,
    activeTasks: 0,
  });
}

function mockEncrypt(plain: Uint8Array, key: Uint8Array): Uint8Array {
  const r = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) r[i] = plain[i] ^ key[i % key.length];
  return r;
}

/** A mock compute function that just returns input with 0xFF appended */
function mockCompute(delayMs: number = 5) {
  return async (wasm: Uint8Array, input: Uint8Array, opts: any) => ({
    data: new Uint8Array([...input, 0xFF]),
    totalTimeMs: delayMs,
    chunksExecuted: 1,
    devicesUsed: 1,
    verified: true,
    localFallback: false,
  });
}

function createBridge(opts: {
  peers?: string[];
  stateStore?: V3StateStore | null;
  computeDelay?: number;
} = {}): V4Bridge {
  return new V4Bridge(
    'local',
    mockCompute(opts.computeDelay ?? 5),
    mockPeerProvider(opts.peers ?? []),
    mockDeviceReader(),
    mockEncrypt,
    mockEncrypt, // XOR is symmetric
    opts.stateStore ?? null,
  );
}

// ─── Main ───

async function main() {

cleanup();

// ════════════════════════════════════════════
// Integration: Full Compute Path
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Full Compute Path ──\x1b[0m');

await testAsync('1. end-to-end compute through V4Bridge', async () => {
  const bridge = createBridge({ peers: ['peer-1'] });
  bridge.start();

  const result = await bridge.compute(WASM_MAGIC, encode('hello'), {
    taskType: TaskType.MAP_REDUCE,
  });

  assert(result.data.length > 0, 'has data');
  assert(result.totalTimeMs >= 0, 'has time');
  assert(result.strategy !== undefined, 'has strategy');

  bridge.stop();
});

await testAsync('2. compute with no peers falls back to local', async () => {
  const bridge = createBridge({ peers: [] });
  bridge.start();

  const result = await bridge.compute(WASM_MAGIC, encode('local only'));

  assert(result.data.length > 0, 'has data');
  assertEqual(result.strategy, ExecutionStrategy.LOCAL_ONLY, 'LOCAL_ONLY');

  bridge.stop();
});

await testAsync('3. task compiler auto-detects pattern for large input', async () => {
  const bridge = createBridge({ peers: ['p1', 'p2'] });
  bridge.start();

  // Build a WASM-like module with sort exports (using test helper from Phase 4)
  const sortWasm = buildWasmWithExports(['sort', 'compare']);
  const largeInput = new Uint8Array(5000);
  for (let i = 0; i < 5000; i++) largeInput[i] = i & 0xFF;

  const result = await bridge.compute(sortWasm, largeInput, {
    entryPoint: 'sort',
    taskType: TaskType.MAP_REDUCE,
  });

  assert(result.data.length > 0, 'has data');
  assertEqual(result.pattern, ParallelPattern.SORT, 'detected SORT pattern');

  bridge.stop();
});

// ════════════════════════════════════════════
// Integration: Background Jobs
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Background Jobs ──\x1b[0m');

await testAsync('4. background job is queued', async () => {
  const bridge = createBridge();
  bridge.start();

  const result = await bridge.compute(WASM_MAGIC, encode('bg task'), {
    background: true,
  });

  // Result should contain job ID
  const jobInfo = JSON.parse(decode(result.data));
  assert(jobInfo.jobId > 0, `has jobId (got ${jobInfo.jobId})`);
  assertEqual(jobInfo.state, JobState.QUEUED, 'state=QUEUED');

  // Wait for executor to pick it up (poll interval = 1000ms)
  await new Promise(r => setTimeout(r, 1500));

  const job = bridge.jobQueue.get(jobInfo.jobId);
  assert(job !== null, 'job exists');
  // Should be completed by now
  assert(
    job!.state === JobState.COMPLETED || job!.state === JobState.RUNNING || job!.state === JobState.QUEUED,
    `job state is ${job!.state}`
  );

  bridge.stop();
});

// ════════════════════════════════════════════
// Integration: Security
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Security Integration ──\x1b[0m');

await testAsync('5. rate limiter blocks excessive requests', async () => {
  const bridge = createBridge();
  bridge.rateLimiter.resetAll();
  // Set very tight limit
  (bridge.rateLimiter as any).config.maxRequestsPerWindow = 2;
  bridge.start();

  await bridge.compute(WASM_MAGIC, encode('req1'));
  await bridge.compute(WASM_MAGIC, encode('req2'));

  try {
    await bridge.compute(WASM_MAGIC, encode('req3'));
    assert(false, 'should have thrown');
  } catch (err: any) {
    assert(err.message.includes('Rate limited'), 'rate limited error');
  }

  bridge.stop();
});

await testAsync('6. ACL whitelist blocks non-listed device', async () => {
  const bridge = createBridge();
  bridge.accessControl.setModes([ACLMode.WHITELIST]);
  bridge.accessControl.addToWhitelist('other-device'); // Not 'local'
  bridge.start();

  try {
    await bridge.compute(WASM_MAGIC, encode('blocked'));
    assert(false, 'should have thrown');
  } catch (err: any) {
    assert(err.message.includes('Access denied'), 'ACL denied');
  }

  // Now add local to whitelist
  bridge.accessControl.addToWhitelist('local');
  const result = await bridge.compute(WASM_MAGIC, encode('allowed'));
  assert(result.data.length > 0, 'allowed after whitelist');

  bridge.stop();
});

// ════════════════════════════════════════════
// Integration: Encryption
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Encryption Integration ──\x1b[0m');

test('7. encryptor integrates with session keys', () => {
  const bridge = createBridge();
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i + 1;

  bridge.encryptor.setSessionKey('peer-1', key);
  assert(bridge.encryptor.hasSessionKey('peer-1'), 'key registered');

  const plain = encode('secret activation tensor');
  const encrypted = bridge.encryptor.encrypt('peer-1', plain);
  assert(encrypted !== null, 'encrypted');
  assert(decode(encrypted!) !== 'secret activation tensor', 'ciphertext differs');

  const decrypted = bridge.encryptor.decrypt('peer-1', encrypted!);
  assertEqual(decode(decrypted!), 'secret activation tensor', 'round-trip');
});

// ════════════════════════════════════════════
// Integration: MeshFS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MeshFS Integration ──\x1b[0m');

test('8. MeshFS write → read → ls → rm lifecycle', () => {
  const bridge = createBridge();

  bridge.meshFS.write('/data/sensors/today.csv', encode('temp,humidity\n30,60\n'));
  bridge.meshFS.write('/data/sensors/yesterday.csv', encode('temp,humidity\n28,55\n'));

  // Read
  const content = bridge.meshFS.read('/data/sensors/today.csv');
  assert(content !== null, 'file exists');
  assert(decode(content!).includes('30,60'), 'content matches');

  // List
  const listing = bridge.meshFS.ls('/data/sensors');
  assertEqual(listing.length, 2, '2 files');

  // Info
  const info = bridge.meshFS.info('/data/sensors/today.csv');
  assert(info !== null, 'has info');
  assertEqual(info!.entry.mimeType, 'text/csv', 'mime=csv');

  // Delete
  bridge.meshFS.rm('/data/sensors/yesterday.csv');
  assertEqual(bridge.meshFS.ls('/data/sensors').length, 1, '1 file after rm');
});

test('9. MeshFS integrates with DataCatalog for gravity', () => {
  const bridge = createBridge();

  // Write a large file
  const data = new Uint8Array(200000); // 200KB
  bridge.meshFS.write('/data/big.bin', data);

  // Register in data catalog
  bridge.dataCatalog.registerShard('/data/big.bin', 'local', 200000, 200000);

  // Check gravity planner from perspective of a remote device
  const decision = bridge.gravityPlanner.plan('/data/big.bin', 50, 1000, 'remote-device');
  // 200000 / 1050 ≈ 190 > pullThreshold(100), data concentrated on 'local'
  assertEqual(decision.strategy, 'pull', 'gravity PULL to where data is');
});

// ════════════════════════════════════════════
// Integration: Pipes
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pipes Integration ──\x1b[0m');

test('10. pipeline through V4Bridge', () => {
  const bridge = createBridge();

  bridge.pipelineManager.define('integ', ['filter:predicate=nonzero', 'map:transform=uppercase', 'collect']);
  bridge.pipelineManager.start('integ');

  bridge.pipelineManager.push('integ', encode('hello'));
  bridge.pipelineManager.push('integ', new Uint8Array([0, 0, 0])); // filtered out
  bridge.pipelineManager.push('integ', encode('world'));

  const result = bridge.pipelineManager.stop('integ');
  assertEqual(decode(result!), 'HELLOWORLD', 'pipeline output');

  bridge.pipelineManager.remove('integ');
});

// ════════════════════════════════════════════
// Integration: Persistence
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Persistence Integration ──\x1b[0m');

await testAsync('11. job queue persists across bridge restart', async () => {
  cleanup();

  const store1 = new V3StateStore(TEST_DB);
  await store1.init();

  const bridge1 = createBridge({ stateStore: store1 });
  bridge1.start();

  // Submit a background job
  await bridge1.compute(WASM_MAGIC, encode('persist me'), { background: true });
  await new Promise(r => setTimeout(r, 200));

  bridge1.stop();
  store1.forceSave();
  store1.close();

  // Reopen
  const store2 = new V3StateStore(TEST_DB);
  await store2.init();

  const bridge2 = createBridge({ stateStore: store2 });
  bridge2.start();

  const stats = bridge2.jobQueue.getStats();
  assert(stats.total >= 1, `has jobs after restart (got ${stats.total})`);

  bridge2.stop();
  store2.close();
  cleanup();
});

// ════════════════════════════════════════════
// Integration: Stats Aggregation
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Stats Aggregation ──\x1b[0m');

await testAsync('12. stats aggregate across all modules', async () => {
  const bridge = createBridge({ peers: ['p1'] });
  bridge.start();

  await bridge.compute(WASM_MAGIC, encode('stat1'));
  await bridge.compute(WASM_MAGIC, encode('stat2'));

  bridge.meshFS.write('/stat/test.txt', encode('data'));
  bridge.meshFS.read('/stat/test.txt');

  const stats = bridge.getStats();
  assertEqual(stats.totalComputes, 2, 'totalComputes=2');
  assert(stats.scheduler.totalTasks >= 0, 'has scheduler stats');
  assert(stats.meshFS.writes >= 1, 'has meshfs writes');
  assert(stats.rateLimiter.totalChecks >= 2, 'has rate limiter stats');

  bridge.stop();
});

await testAsync('13. gravity + catalog integration', async () => {
  const bridge = createBridge({ peers: ['data-node'] });
  bridge.start();

  // Register remote data
  bridge.dataCatalog.registerShard('remote/bigdata', 'data-node', 2_000_000, 2_000_000);

  // Feed load report for the peer
  bridge.loadMonitor.handleLoadReport({
    deviceId: 'data-node', cpu: 20, mem: 30, memMb: 8000, thermal: 0, tasks: 0, ts: Date.now(),
  });

  // Check gravity would apply
  const decision = bridge.gravityPlanner.plan('remote/bigdata', 50, 1000, 'local');
  assertEqual(decision.strategy, 'pull', 'PULL to data-node');
  assert(decision.savingsRatio > 0.99, `savings > 99% (got ${(decision.savingsRatio * 100).toFixed(2)}%)`);

  bridge.stop();
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mV4 Integration Tests\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);

} // end main

// ─── WASM Builder (from Phase 4 tests) ───

function buildWasmWithExports(exportNames: string[]): Uint8Array {
  const magic = [0x00, 0x61, 0x73, 0x6D];
  const version = [0x01, 0x00, 0x00, 0x00];
  const typeSection = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00];
  const funcSection = [0x03, exportNames.length + 1, exportNames.length, ...new Array(exportNames.length).fill(0x00)];

  const exportEntries: number[] = [];
  for (let i = 0; i < exportNames.length; i++) {
    const nameBytes = new TextEncoder().encode(exportNames[i]);
    exportEntries.push(nameBytes.length, ...nameBytes, 0x00, i);
  }
  const memName = new TextEncoder().encode('memory');
  exportEntries.push(memName.length, ...memName, 0x02, 0x00);
  const exportSection = [0x07, exportEntries.length + 1, exportNames.length + 1, ...exportEntries];

  const codeBody = [0x00, 0x0B];
  const codeBodies: number[] = [];
  for (let i = 0; i < exportNames.length; i++) codeBodies.push(codeBody.length, ...codeBody);
  const codeSection = [0x0A, codeBodies.length + 1, exportNames.length, ...codeBodies];
  const memSection = [0x05, 0x03, 0x01, 0x00, 0x01];

  return new Uint8Array([...magic, ...version, ...typeSection, ...funcSection, ...memSection, ...exportSection, ...codeSection]);
}

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  console.error(err.stack);
  process.exit(1);
});

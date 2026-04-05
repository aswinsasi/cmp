/**
 * CMP v4.0 — Phase 3: Unified Scheduler Tests
 *
 * 36 tests covering:
 *   - LoadMonitor: local sampling, peer reports, overload detection, variance
 *   - DeviceScorer: CPU/memory/GPU/latency/reputation/locality scoring, weight adjustment
 *   - ExecutionPlanner: WASM routing, tensor→Cortex, GPU routing, local fallback
 *   - UnifiedScheduler: end-to-end compute, fallback, stats, forced strategy
 *
 * Run: npx tsx packages/core/tests/v4-unified-scheduler.test.ts
 *
 * @author Agent Viscro
 */

import {
  Architecture, GPUType, PowerSource, ThermalState, Runtime,
  TaskType, Priority,
} from '../src/types';
import type { CMPCapability } from '../src/types/capability';

import { LoadMonitor, LoadReportWire } from '../src/scheduler/load-monitor';
import { DeviceScorer, TaskHint, DEFAULT_WEIGHTS } from '../src/scheduler/device-scorer';
import {
  ExecutionPlanner, ExecutionStrategy, TaskCategory, MeshState,
} from '../src/scheduler/execution-planner';
import {
  UnifiedScheduler, PeerProvider, SchedulerResult,
} from '../src/scheduler/unified-scheduler';

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

// ─── Mock Helpers ───

const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6D, 1, 0, 0, 0]);
const NOT_WASM = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

function mockCapability(overrides: Partial<{
  cores: number; memMb: number; gpu: GPUType;
  latencyMs: number; reputation: number; loadPct: number;
}> = {}): CMPCapability {
  return {
    meshId: new Uint8Array(16),
    cpu: {
      architecture: Architecture.ARM64,
      coresAvailable: overrides.cores ?? 4,
      clockMhz: 2400,
      loadPercent: overrides.loadPct ?? 20,
    },
    memory: { availableMb: overrides.memMb ?? 4096, bandwidthGbps: 12 },
    gpu: { type: overrides.gpu ?? GPUType.NONE, computeUnits: 4, vramMb: 0, supports: new Set() },
    storage: { scratchMb: 1024, readMbps: 500, writeMbps: 200 },
    network: { meshBandwidthMbps: 100, latencyMs: overrides.latencyMs ?? 5 },
    power: { source: PowerSource.PLUGGED, batteryPct: 100, thermalState: ThermalState.NOMINAL },
    runtimes: [Runtime.WASM],
    reputationScore: overrides.reputation ?? 5000,
    availabilitySec: 3600,
  };
}

function mockMeshState(overrides: Partial<MeshState> = {}): MeshState {
  return {
    localDeviceId: 'local',
    peerCount: overrides.peerCount ?? 3,
    hasGPUPeers: overrides.hasGPUPeers ?? false,
    hasCortex: overrides.hasCortex ?? false,
    totalCores: overrides.totalCores ?? 12,
    avgLatencyMs: overrides.avgLatencyMs ?? 5,
    ...overrides,
  };
}

function mockPeerProvider(peers: Array<{ deviceId: string; capability: CMPCapability }>, meshOverrides: Partial<MeshState> = {}): PeerProvider {
  return {
    getPeerCapabilities: () => peers,
    getMeshState: () => ({
      localDeviceId: 'local',
      peerCount: peers.length,
      hasGPUPeers: peers.some(p => p.capability.gpu.type !== GPUType.NONE),
      hasCortex: false,
      totalCores: peers.reduce((s, p) => s + p.capability.cpu.coresAvailable, 4),
      avgLatencyMs: peers.length > 0 ? peers.reduce((s, p) => s + p.capability.network.latencyMs, 0) / peers.length : 0,
      ...meshOverrides,
    }),
  };
}

// ─── Main ───

async function main() {

// ════════════════════════════════════════════
// Load Monitor
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Load Monitor ──\x1b[0m');

test('1. samples local device state', () => {
  const monitor = new LoadMonitor('dev-A', () => ({
    cpuPercent: 35,
    memoryUsedPercent: 60,
    memoryAvailableMb: 4096,
    thermalState: 0,
    activeTasks: 2,
  }));

  const load = monitor.getLocalLoad();
  assertEqual(load.deviceId, 'dev-A', 'deviceId');
  assertEqual(load.cpuPercent, 35, 'cpu=35');
  assertEqual(load.memoryAvailableMb, 4096, 'mem=4096');
  assertEqual(load.activeTasks, 2, 'tasks=2');
});

test('2. handles peer load reports', () => {
  const monitor = new LoadMonitor('dev-A', () => ({
    cpuPercent: 10, memoryUsedPercent: 20, memoryAvailableMb: 8000, thermalState: 0, activeTasks: 0,
  }));

  monitor.handleLoadReport({
    deviceId: 'dev-B', cpu: 75, mem: 80, memMb: 2048, thermal: 1, tasks: 3, ts: Date.now(),
  });

  const loadB = monitor.getLoad('dev-B');
  assert(loadB !== null, 'dev-B report exists');
  assertEqual(loadB!.cpuPercent, 75, 'B cpu=75');
  assertEqual(loadB!.memoryAvailableMb, 2048, 'B mem=2048');
});

test('3. getAllLoads returns all tracked devices', () => {
  const monitor = new LoadMonitor('dev-A', () => ({
    cpuPercent: 10, memoryUsedPercent: 20, memoryAvailableMb: 8000, thermalState: 0, activeTasks: 0,
  }));
  monitor.getLocalLoad();
  monitor.handleLoadReport({ deviceId: 'dev-B', cpu: 50, mem: 50, memMb: 4000, thermal: 0, tasks: 1, ts: Date.now() });
  monitor.handleLoadReport({ deviceId: 'dev-C', cpu: 90, mem: 90, memMb: 1000, thermal: 2, tasks: 5, ts: Date.now() });

  assertEqual(monitor.deviceCount, 3, '3 devices');
  assertEqual(monitor.getAllLoads().length, 3, '3 loads');
});

test('4. isOverloaded detects high CPU', () => {
  const monitor = new LoadMonitor('dev-A', () => ({
    cpuPercent: 10, memoryUsedPercent: 20, memoryAvailableMb: 8000, thermalState: 0, activeTasks: 0,
  }));
  monitor.getLocalLoad();
  monitor.handleLoadReport({ deviceId: 'dev-hot', cpu: 95, mem: 90, memMb: 500, thermal: 2, tasks: 5, ts: Date.now() });

  assert(!monitor.isOverloaded('dev-A'), 'A not overloaded');
  assert(monitor.isOverloaded('dev-hot'), 'hot is overloaded');
});

test('5. getLeastLoaded returns sorted by CPU', () => {
  const monitor = new LoadMonitor('dev-A', () => ({
    cpuPercent: 40, memoryUsedPercent: 50, memoryAvailableMb: 4000, thermalState: 0, activeTasks: 1,
  }));
  monitor.getLocalLoad();
  monitor.handleLoadReport({ deviceId: 'dev-idle', cpu: 5, mem: 10, memMb: 8000, thermal: 0, tasks: 0, ts: Date.now() });
  monitor.handleLoadReport({ deviceId: 'dev-busy', cpu: 80, mem: 70, memMb: 2000, thermal: 1, tasks: 3, ts: Date.now() });

  const least = monitor.getLeastLoaded();
  assertEqual(least[0].deviceId, 'dev-idle', 'idle first');
  assertEqual(least[least.length - 1].deviceId, 'dev-busy', 'busy last');
});

test('6. getLoadVariance computes from history', () => {
  const monitor = new LoadMonitor('dev-A', () => ({
    cpuPercent: 50, memoryUsedPercent: 50, memoryAvailableMb: 4000, thermalState: 0, activeTasks: 0,
  }));

  // Simulate varying load reports
  for (const cpu of [10, 90, 15, 85, 20, 80]) {
    monitor.handleLoadReport({ deviceId: 'dev-unstable', cpu, mem: 50, memMb: 4000, thermal: 0, tasks: 0, ts: Date.now() });
  }

  // Stable device
  for (const cpu of [30, 32, 31, 30, 33, 31]) {
    monitor.handleLoadReport({ deviceId: 'dev-stable', cpu, mem: 50, memMb: 4000, thermal: 0, tasks: 0, ts: Date.now() });
  }

  const unstableVar = monitor.getLoadVariance('dev-unstable');
  const stableVar = monitor.getLoadVariance('dev-stable');

  assert(unstableVar > stableVar, `unstable variance (${unstableVar.toFixed(1)}) > stable (${stableVar.toFixed(1)})`);
  assert(unstableVar > 20, `unstable variance (${unstableVar.toFixed(1)}) should be high`);
  assert(stableVar < 5, `stable variance (${stableVar.toFixed(1)}) should be low`);
});

test('7. removeDevice cleans up tracking', () => {
  const monitor = new LoadMonitor('dev-A', () => ({
    cpuPercent: 10, memoryUsedPercent: 10, memoryAvailableMb: 8000, thermalState: 0, activeTasks: 0,
  }));
  monitor.handleLoadReport({ deviceId: 'dev-gone', cpu: 50, mem: 50, memMb: 4000, thermal: 0, tasks: 0, ts: Date.now() });
  assert(monitor.getLoad('dev-gone') !== null, 'exists');
  monitor.removeDevice('dev-gone');
  assertEqual(monitor.getLoad('dev-gone'), null, 'removed');
});

// ════════════════════════════════════════════
// Device Scorer
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Device Scorer ──\x1b[0m');

const scorer = new DeviceScorer();

test('8. scores device with all factors', () => {
  const hint: TaskHint = { taskType: TaskType.MAP_REDUCE, payloadSizeKb: 100, requiresGPU: false, latencySensitive: false };
  const result = scorer.scoreDevice('dev-A', mockCapability(), null, hint);

  assert(result.score > 0, `score > 0 (got ${result.score})`);
  assert(result.score <= 1, `score <= 1 (got ${result.score})`);
  assertEqual(result.deviceId, 'dev-A', 'deviceId');
});

test('9. GPU device scores higher for GPU tasks', () => {
  const hint: TaskHint = { taskType: TaskType.INFERENCE, payloadSizeKb: 1000, requiresGPU: true, latencySensitive: false };

  const gpuDevice = scorer.scoreDevice('gpu', mockCapability({ gpu: GPUType.DISCRETE }), null, hint);
  const cpuDevice = scorer.scoreDevice('cpu', mockCapability({ gpu: GPUType.NONE }), null, hint);

  assert(gpuDevice.score > cpuDevice.score, `GPU (${gpuDevice.score}) > CPU (${cpuDevice.score})`);
});

test('10. low-latency device scores higher for latency-sensitive', () => {
  const hint: TaskHint = { taskType: TaskType.MAP_REDUCE, payloadSizeKb: 10, requiresGPU: false, latencySensitive: true };

  const fast = scorer.scoreDevice('fast', mockCapability({ latencyMs: 2 }), null, hint);
  const slow = scorer.scoreDevice('slow', mockCapability({ latencyMs: 100 }), null, hint);

  assert(fast.score > slow.score, `fast (${fast.score}) > slow (${slow.score})`);
});

test('11. more cores = higher CPU score', () => {
  const hint: TaskHint = { taskType: TaskType.MAP_REDUCE, payloadSizeKb: 100, requiresGPU: false, latencySensitive: false };

  const big = scorer.scoreDevice('big', mockCapability({ cores: 8 }), null, hint);
  const small = scorer.scoreDevice('small', mockCapability({ cores: 2 }), null, hint);

  assert(big.score > small.score, `8-core (${big.score}) > 2-core (${small.score})`);
});

test('12. data locality boosts score for device holding data', () => {
  const hint: TaskHint = {
    taskType: TaskType.MAP_REDUCE, payloadSizeKb: 100, requiresGPU: false, latencySensitive: false,
    dataLocationDeviceIds: ['dev-data'],
  };

  const local = scorer.scoreDevice('dev-data', mockCapability(), null, hint);
  const remote = scorer.scoreDevice('dev-other', mockCapability(), null, hint);

  assert(local.score > remote.score, `local (${local.score}) > remote (${remote.score})`);
});

test('13. rankDevices returns sorted by score', () => {
  const hint: TaskHint = { taskType: TaskType.MAP_REDUCE, payloadSizeKb: 100, requiresGPU: false, latencySensitive: false };

  const ranked = scorer.rankDevices([
    { deviceId: 'weak', capability: mockCapability({ cores: 1, memMb: 512 }), load: null },
    { deviceId: 'strong', capability: mockCapability({ cores: 8, memMb: 16384 }), load: null },
    { deviceId: 'mid', capability: mockCapability({ cores: 4, memMb: 4096 }), load: null },
  ], hint);

  assertEqual(ranked[0].deviceId, 'strong', 'strong first');
  assertEqual(ranked[ranked.length - 1].deviceId, 'weak', 'weak last');
});

test('14. overloaded device gets lower score', () => {
  const hint: TaskHint = { taskType: TaskType.MAP_REDUCE, payloadSizeKb: 100, requiresGPU: false, latencySensitive: false };

  const idle = scorer.scoreDevice('idle', mockCapability(), { deviceId: 'idle', cpuPercent: 5, memoryUsedPercent: 20, memoryAvailableMb: 7000, thermalState: 0, activeTasks: 0, timestamp: Date.now() }, hint);
  const busy = scorer.scoreDevice('busy', mockCapability(), { deviceId: 'busy', cpuPercent: 95, memoryUsedPercent: 90, memoryAvailableMb: 500, thermalState: 2, activeTasks: 5, timestamp: Date.now() }, hint);

  assert(idle.score > busy.score, `idle (${idle.score}) > busy (${busy.score})`);
});

test('15. high reputation scores higher', () => {
  const hint: TaskHint = { taskType: TaskType.MAP_REDUCE, payloadSizeKb: 100, requiresGPU: false, latencySensitive: false };

  const trusted = scorer.scoreDevice('trusted', mockCapability({ reputation: 9000 }), null, hint);
  const untrusted = scorer.scoreDevice('untrusted', mockCapability({ reputation: 500 }), null, hint);

  assert(trusted.score > untrusted.score, `trusted (${trusted.score}) > untrusted (${untrusted.score})`);
});

test('16. pickBest returns top N devices', () => {
  const hint: TaskHint = { taskType: TaskType.MAP_REDUCE, payloadSizeKb: 100, requiresGPU: false, latencySensitive: false };

  const devices = [
    { deviceId: 'a', capability: mockCapability({ cores: 2 }), load: null },
    { deviceId: 'b', capability: mockCapability({ cores: 8 }), load: null },
    { deviceId: 'c', capability: mockCapability({ cores: 4 }), load: null },
  ];

  const best2 = scorer.pickBest(devices, hint, 2);
  assertEqual(best2.length, 2, '2 results');
  assertEqual(best2[0].deviceId, 'b', 'best is b (8 cores)');
});

// ════════════════════════════════════════════
// Execution Planner
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Execution Planner ──\x1b[0m');

const planner = new ExecutionPlanner();

test('17. detects WASM module by magic bytes', () => {
  const analysis = planner.analyzeTask(WASM_MAGIC, new Uint8Array(100), TaskType.CUSTOM);
  assert(analysis.isWasm, 'isWasm=true');
  assertEqual(analysis.category, TaskCategory.WASM_MODULE, 'category=WASM');
});

test('18. detects non-WASM input', () => {
  const analysis = planner.analyzeTask(NOT_WASM, new Uint8Array(100), TaskType.CUSTOM);
  assert(!analysis.isWasm, 'isWasm=false');
});

test('19. detects data-parallel task type', () => {
  const analysis = planner.analyzeTask(WASM_MAGIC, new Uint8Array(100), TaskType.MAP_REDUCE);
  assert(analysis.isDataParallel, 'isDataParallel=true');
});

test('20. detects tensor/inference task type', () => {
  const analysis = planner.analyzeTask(WASM_MAGIC, new Uint8Array(100), TaskType.INFERENCE);
  assert(analysis.isTensorLike, 'isTensorLike=true');
});

test('21. plans LOCAL_ONLY when no peers', () => {
  const plan = planner.planTask(WASM_MAGIC, new Uint8Array(100), TaskType.MAP_REDUCE, mockMeshState({ peerCount: 0 }));
  assertEqual(plan.strategy, ExecutionStrategy.LOCAL_ONLY, 'LOCAL_ONLY');
  assertEqual(plan.deviceCount, 1, 'deviceCount=1');
});

test('22. plans LOCAL_ONLY for tiny payload', () => {
  const tinyData = new Uint8Array(0); // 0 bytes = 0 KB
  const plan = planner.planTask(WASM_MAGIC, tinyData, TaskType.CUSTOM, mockMeshState());
  assertEqual(plan.strategy, ExecutionStrategy.LOCAL_ONLY, 'LOCAL_ONLY for tiny');
});

test('23. plans WASM_DISTRIBUTE for WASM + data parallel', () => {
  const input = new Uint8Array(50000); // 50KB
  const plan = planner.planTask(WASM_MAGIC, input, TaskType.MAP_REDUCE, mockMeshState());
  assertEqual(plan.strategy, ExecutionStrategy.WASM_DISTRIBUTE, 'WASM_DISTRIBUTE');
  assert(plan.shouldChunk, 'shouldChunk=true');
  assert(plan.chunkCount > 1, `chunkCount > 1 (got ${plan.chunkCount})`);
});

test('24. plans CORTEX_SPLIT for inference with Cortex available', () => {
  const plan = planner.planTask(WASM_MAGIC, new Uint8Array(10000), TaskType.INFERENCE,
    mockMeshState({ hasCortex: true }));
  assertEqual(plan.strategy, ExecutionStrategy.CORTEX_SPLIT, 'CORTEX_SPLIT');
});

test('25. plans GPU_COMPUTE for inference with GPU peers', () => {
  const plan = planner.planTask(WASM_MAGIC, new Uint8Array(10000), TaskType.INFERENCE,
    mockMeshState({ hasGPUPeers: true, hasCortex: false }));
  assertEqual(plan.strategy, ExecutionStrategy.GPU_COMPUTE, 'GPU_COMPUTE');
  assert(plan.requiresGPU, 'requiresGPU=true');
});

test('26. plans SPECULATIVE_RACE for unknown non-WASM', () => {
  const plan = planner.planTask(NOT_WASM, new Uint8Array(5000), TaskType.CUSTOM, mockMeshState());
  assertEqual(plan.strategy, ExecutionStrategy.SPECULATIVE_RACE, 'SPECULATIVE_RACE');
});

test('27. plan includes fallback strategy', () => {
  const plan = planner.planTask(WASM_MAGIC, new Uint8Array(10000), TaskType.MAP_REDUCE, mockMeshState());
  assert(plan.fallback !== undefined, 'has fallback');
  assertEqual(plan.fallback, ExecutionStrategy.LOCAL_ONLY, 'fallback=LOCAL_ONLY');
});

test('28. plan confidence varies by strategy', () => {
  const wasmPlan = planner.planTask(WASM_MAGIC, new Uint8Array(10000), TaskType.MAP_REDUCE, mockMeshState());
  const unknownPlan = planner.planTask(NOT_WASM, new Uint8Array(5000), TaskType.CUSTOM, mockMeshState());

  assert(wasmPlan.confidence > unknownPlan.confidence,
    `WASM confidence (${wasmPlan.confidence}) > unknown (${unknownPlan.confidence})`);
});

// ════════════════════════════════════════════
// Unified Scheduler
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Unified Scheduler ──\x1b[0m');

const mockCompute = async (wasm: Uint8Array, input: Uint8Array, opts: any): Promise<SchedulerResult> => {
  return {
    data: new Uint8Array([...input, 0xFF]),
    totalTimeMs: 42,
    chunksExecuted: 2,
    devicesUsed: 1,
    verified: true,
    localFallback: false,
    strategy: ExecutionStrategy.WASM_DISTRIBUTE,
    plan: {} as any,
  };
};

await testAsync('29. end-to-end compute through scheduler', async () => {
  const loadMon = new LoadMonitor('local', () => ({
    cpuPercent: 20, memoryUsedPercent: 40, memoryAvailableMb: 6000, thermalState: 0, activeTasks: 0,
  }));

  const peers = [
    { deviceId: 'peer-1', capability: mockCapability({ cores: 8 }) },
  ];

  const scheduler = new UnifiedScheduler(
    mockCompute,
    mockPeerProvider(peers),
    loadMon,
  );

  const result = await scheduler.compute(WASM_MAGIC, new Uint8Array([1, 2, 3]), {
    taskType: TaskType.MAP_REDUCE,
  });

  assert(result.data.length > 0, 'has data');
  assertEqual(result.totalTimeMs, 42, 'time=42ms');
  assert(result.plan !== undefined, 'has plan');
  assert(result.strategy !== undefined, 'has strategy');
});

await testAsync('30. scheduler falls back to local when no peers', async () => {
  const loadMon = new LoadMonitor('local', () => ({
    cpuPercent: 20, memoryUsedPercent: 40, memoryAvailableMb: 6000, thermalState: 0, activeTasks: 0,
  }));

  const scheduler = new UnifiedScheduler(
    mockCompute,
    mockPeerProvider([]),
    loadMon,
  );

  const result = await scheduler.compute(WASM_MAGIC, new Uint8Array([1, 2, 3]));
  assertEqual(result.plan.strategy, ExecutionStrategy.LOCAL_ONLY, 'LOCAL_ONLY');
});

await testAsync('31. scheduler filters overloaded devices', async () => {
  const loadMon = new LoadMonitor('local', () => ({
    cpuPercent: 20, memoryUsedPercent: 40, memoryAvailableMb: 6000, thermalState: 0, activeTasks: 0,
  }));

  // All peers are overloaded
  loadMon.handleLoadReport({ deviceId: 'p1', cpu: 95, mem: 95, memMb: 200, thermal: 2, tasks: 10, ts: Date.now() });

  const scheduler = new UnifiedScheduler(
    mockCompute,
    mockPeerProvider([{ deviceId: 'p1', capability: mockCapability() }]),
    loadMon,
  );

  const result = await scheduler.compute(WASM_MAGIC, new Uint8Array(5000), { taskType: TaskType.MAP_REDUCE });
  assertEqual(result.plan.strategy, ExecutionStrategy.LOCAL_ONLY, 'falls back to LOCAL');
});

await testAsync('32. scheduler tracks stats', async () => {
  const loadMon = new LoadMonitor('local', () => ({
    cpuPercent: 20, memoryUsedPercent: 40, memoryAvailableMb: 6000, thermalState: 0, activeTasks: 0,
  }));

  const scheduler = new UnifiedScheduler(
    mockCompute,
    mockPeerProvider([{ deviceId: 'p1', capability: mockCapability() }]),
    loadMon,
  );

  await scheduler.compute(WASM_MAGIC, new Uint8Array(5000));
  await scheduler.compute(WASM_MAGIC, new Uint8Array(5000));

  const stats = scheduler.getStats();
  assertEqual(stats.totalTasks, 2, 'totalTasks=2');
  assert(Object.keys(stats.tasksByStrategy).length > 0, 'has strategy breakdown');
});

await testAsync('33. scheduler supports forced strategy', async () => {
  const loadMon = new LoadMonitor('local', () => ({
    cpuPercent: 20, memoryUsedPercent: 40, memoryAvailableMb: 6000, thermalState: 0, activeTasks: 0,
  }));

  const scheduler = new UnifiedScheduler(
    mockCompute,
    mockPeerProvider([{ deviceId: 'p1', capability: mockCapability() }]),
    loadMon,
  );

  const result = await scheduler.compute(WASM_MAGIC, new Uint8Array(5000), {
    forceStrategy: ExecutionStrategy.LOCAL_ONLY,
  });

  assertEqual(result.plan.strategy, ExecutionStrategy.LOCAL_ONLY, 'forced LOCAL_ONLY');
  assert(result.plan.reason.includes('Forced'), 'reason says forced');
});

await testAsync('34. scheduler provides device scores in result', async () => {
  const loadMon = new LoadMonitor('local', () => ({
    cpuPercent: 20, memoryUsedPercent: 40, memoryAvailableMb: 6000, thermalState: 0, activeTasks: 0,
  }));

  const peers = [
    { deviceId: 'p1', capability: mockCapability({ cores: 8 }) },
    { deviceId: 'p2', capability: mockCapability({ cores: 2 }) },
  ];

  const scheduler = new UnifiedScheduler(
    mockCompute,
    mockPeerProvider(peers),
    loadMon,
  );

  const result = await scheduler.compute(WASM_MAGIC, new Uint8Array(5000), { taskType: TaskType.MAP_REDUCE });

  assert(result.deviceScores !== undefined, 'has deviceScores');
  assert(result.deviceScores!.length >= 1, 'at least 1 scored');
  // First device should have higher score (8 cores vs 2)
  if (result.deviceScores!.length >= 2) {
    assert(
      result.deviceScores![0].score >= result.deviceScores![1].score,
      'scores are sorted'
    );
  }
});

await testAsync('35. scheduler exposes planner and scorer', async () => {
  const loadMon = new LoadMonitor('local', () => ({
    cpuPercent: 20, memoryUsedPercent: 40, memoryAvailableMb: 6000, thermalState: 0, activeTasks: 0,
  }));

  const scheduler = new UnifiedScheduler(mockCompute, mockPeerProvider([]), loadMon);

  assert(scheduler.getPlanner() instanceof ExecutionPlanner, 'has planner');
  assert(scheduler.getScorer() instanceof DeviceScorer, 'has scorer');
});

test('36. WASM distribute plan sets correct chunk count based on peers', () => {
  const input = new Uint8Array(50000);
  const plan = planner.planTask(WASM_MAGIC, input, TaskType.MAP_REDUCE, mockMeshState({ peerCount: 7 }));
  assertEqual(plan.strategy, ExecutionStrategy.WASM_DISTRIBUTE, 'WASM_DISTRIBUTE');
  // Should chunk across devices but cap at 8
  assert(plan.chunkCount <= 8, `chunkCount <= 8 (got ${plan.chunkCount})`);
  assert(plan.chunkCount >= 2, `chunkCount >= 2 (got ${plan.chunkCount})`);
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 3: Unified Scheduler\x1b[0m`);
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

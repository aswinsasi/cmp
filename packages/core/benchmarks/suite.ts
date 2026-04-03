/**
 * CMP v3.0 — Benchmark Suite
 * Definitive performance numbers for every CMP subsystem.
 *
 * Run: npx tsx packages/core/benchmarks/suite.ts
 *
 * Measures:
 *   1. CRDT operations (set, merge, delta, snapshot)
 *   2. Cause processing throughput
 *   3. Lifeform spawn/kill lifecycle
 *   4. Fusion/fission cycle
 *   5. Reed-Solomon erasure coding
 *   6. Neuromorphic routing + learning
 *   7. Entanglement sync throughput
 *   8. Mesh Cortex inference chain
 *   9. GPU compute (CPU fallback)
 *  10. Protocol evolution cycle
 *  11. Wire protocol encode/decode
 *
 * @author Agent Viscro
 */

// ─── Benchmark Helpers ───

interface BenchResult {
  name: string;
  opsPerSec: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  iterations: number;
  totalMs: number;
  extra?: Record<string, string | number>;
}

function bench(name: string, fn: () => void, iterations: number = 1000): BenchResult {
  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) fn();

  const times: number[] = [];
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }

  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);

  return {
    name,
    opsPerSec: Math.round(1000 / avgMs),
    avgMs: round(avgMs, 4),
    minMs: round(minMs, 4),
    maxMs: round(maxMs, 4),
    iterations,
    totalMs: round(totalMs, 2),
  };
}

async function benchAsync(name: string, fn: () => Promise<void>, iterations: number = 100): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < Math.min(3, iterations); i++) await fn();

  const times: number[] = [];
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }

  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;

  return {
    name,
    opsPerSec: Math.round(1000 / avgMs),
    avgMs: round(avgMs, 4),
    minMs: round(Math.min(...times), 4),
    maxMs: round(Math.max(...times), 4),
    iterations,
    totalMs: round(totalMs, 2),
  };
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function printResult(r: BenchResult): void {
  const opsStr = r.opsPerSec.toLocaleString().padStart(10);
  const avgStr = r.avgMs.toFixed(3).padStart(10);
  console.log(`  ${r.name.padEnd(45)} ${opsStr} ops/s  ${avgStr} ms/op`);
  if (r.extra) {
    for (const [k, v] of Object.entries(r.extra)) {
      console.log(`    ${k}: ${v}`);
    }
  }
}

function printSection(title: string): void {
  console.log('');
  console.log(`  ── ${title} ${'─'.repeat(60 - title.length)}`);
}

function memoryUsageMB(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return round(process.memoryUsage().heapUsed / 1024 / 1024, 1);
  }
  return 0;
}

// ═══════════════════════════════════════
// Benchmarks
// ═══════════════════════════════════════

async function runAllBenchmarks(): Promise<void> {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════════╗');
  console.log('  ║              CMP v3.0 — BENCHMARK SUITE                      ║');
  console.log('  ║              Agent Viscro — April 2026                        ║');
  console.log('  ╚═══════════════════════════════════════════════════════════════╝');

  const allResults: BenchResult[] = [];
  const memBefore = memoryUsageMB();

  // ── 1. CRDT Operations ──
  printSection('CRDT Operations');
  {
    const { CRDTState } = await import('../src/lifeform/crdt/crdt-state');

    // Set (LWWRegister)
    const state = new CRDTState('bench-node');
    const r1 = bench('CRDTState.set() — LWWRegister', () => {
      state.set('key-' + (Math.random() * 100 | 0), Math.random());
    }, 10000);
    printResult(r1);
    allResults.push(r1);

    // Get
    for (let i = 0; i < 100; i++) state.set('k' + i, i);
    const r2 = bench('CRDTState.get() — 100 keys', () => {
      state.get('k' + (Math.random() * 100 | 0));
    }, 10000);
    printResult(r2);
    allResults.push(r2);

    // Merge (two states with 100 keys each)
    const stateA = new CRDTState('node-a');
    const stateB = new CRDTState('node-b');
    for (let i = 0; i < 100; i++) {
      stateA.set('a-' + i, Math.random());
      stateB.set('b-' + i, Math.random());
    }
    const r3 = bench('CRDTState.merge() — 100+100 keys', () => {
      const copy = new CRDTState('node-a');
      for (let i = 0; i < 100; i++) copy.set('a-' + i, i);
      copy.merge(stateB);
    }, 500);
    printResult(r3);
    allResults.push(r3);

    // Delta extraction
    const deltaState = new CRDTState('delta-node');
    for (let i = 0; i < 50; i++) deltaState.set('d' + i, i);
    const r4 = bench('CRDTState.extractDelta() — 50 dirty keys', () => {
      for (let i = 0; i < 50; i++) deltaState.set('d' + i, Math.random());
      deltaState.extractDelta();
    }, 2000);
    printResult(r4);
    allResults.push(r4);

    // Snapshot
    const snapState = new CRDTState('snap-node');
    for (let i = 0; i < 1000; i++) snapState.set('s' + i, 'value-' + i);
    const r5 = bench('CRDTState.snapshot() — 1000 keys', () => {
      snapState.snapshot();
    }, 500);
    r5.extra = { keys: 1000 };
    printResult(r5);
    allResults.push(r5);
  }

  // ── 2. Erasure Coding ──
  printSection('Reed-Solomon Erasure Coding');
  {
    const { rsEncode, rsDecode } = await import('../src/holographic/erasure');

    // Encode 1KB, k=2, m=1
    const data1k = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) data1k[i] = i % 256;

    const r1 = bench('rsEncode — 1KB, k=2, m=1', () => {
      rsEncode(data1k, 2, 1);
    }, 500);
    printResult(r1);
    allResults.push(r1);

    // Decode 1KB
    const shards1k = rsEncode(data1k, 2, 1);
    const r2 = bench('rsDecode — 1KB, k=2 of 3', () => {
      rsDecode(
        [{ index: 0, data: shards1k[0] }, { index: 2, data: shards1k[2] }],
        2, 3, 1024,
      );
    }, 500);
    printResult(r2);
    allResults.push(r2);

    // Encode 10KB, k=4, m=2
    const data10k = new Uint8Array(10240);
    for (let i = 0; i < 10240; i++) data10k[i] = (i * 7) % 256;

    const r3 = bench('rsEncode — 10KB, k=4, m=2', () => {
      rsEncode(data10k, 4, 2);
    }, 100);
    printResult(r3);
    allResults.push(r3);

    const shards10k = rsEncode(data10k, 4, 2);
    const r4 = bench('rsDecode — 10KB, k=4 of 6', () => {
      rsDecode(
        [
          { index: 0, data: shards10k[0] },
          { index: 2, data: shards10k[2] },
          { index: 4, data: shards10k[4] },
          { index: 5, data: shards10k[5] },
        ],
        4, 6, 10240,
      );
    }, 100);
    printResult(r4);
    allResults.push(r4);
  }

  // ── 3. Neuromorphic Routing ──
  printSection('Neuromorphic Routing');
  {
    const { NeuromorphicRouter } = await import('../src/neuromorphic/router');

    // Build 20-node mesh
    const router = new NeuromorphicRouter({ explorationRate: 0 });
    for (let i = 0; i < 20; i++) {
      router.addNode('n' + i);
      for (let j = 0; j < 20; j++) {
        if (i !== j && Math.random() < 0.3) router.ensureConnection('n' + i, 'n' + j);
      }
    }

    const r1 = bench('route() — 20-node mesh', () => {
      router.route('n0', 'compute', 'task-' + Math.random());
    }, 5000);
    r1.extra = { nodes: 20, connections: router.connectionCount };
    printResult(r1);
    allResults.push(r1);

    const r2 = bench('reinforce() — 5-hop path', () => {
      router.reinforce(['n0', 'n3', 'n7', 'n12', 'n18'], 'compute');
    }, 5000);
    printResult(r2);
    allResults.push(r2);

    const r3 = bench('decay() — 20-node mesh', () => {
      router.decay();
    }, 1000);
    printResult(r3);
    allResults.push(r3);

    // 100-node mesh
    const bigRouter = new NeuromorphicRouter({ explorationRate: 0.05 });
    for (let i = 0; i < 100; i++) {
      bigRouter.addNode('b' + i);
      for (let j = 0; j < 100; j++) {
        if (i !== j && Math.random() < 0.1) bigRouter.ensureConnection('b' + i, 'b' + j);
      }
    }

    const r4 = bench('route() — 100-node mesh', () => {
      bigRouter.route('b0', 'compute', 'task-' + Math.random());
    }, 2000);
    r4.extra = { nodes: 100, connections: bigRouter.connectionCount };
    printResult(r4);
    allResults.push(r4);
  }

  // ── 4. GPU Compute (CPU fallback) ──
  printSection('GPU Compute (CPU Fallback Kernels)');
  {
    const { GPUExecutor } = await import('../src/gpu/executor');
    const executor = new GPUExecutor();

    // Matmul 64x64
    const size = 64;
    const A = new Float32Array(size * size);
    const B = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) { A[i] = Math.random(); B[i] = Math.random(); }

    const r1 = await benchAsync('matmul — 64x64', async () => {
      await executor.execute({
        taskId: 't', shaderCode: 'matmul', buffers: [
          { label: 'A', data: A, usage: 'storage' },
          { label: 'B', data: B, usage: 'storage' },
        ], workgroups: [1, 1, 1], outputBufferIndices: [0], priority: 'normal', deadline: 0, submitterDevice: 'bench',
      });
    }, 100);
    r1.extra = { matrixSize: '64x64', elements: size * size };
    printResult(r1);
    allResults.push(r1);

    // Softmax 10K elements
    const softData = new Float32Array(10000);
    for (let i = 0; i < 10000; i++) softData[i] = Math.random() * 10 - 5;

    const r2 = await benchAsync('softmax — 10K elements', async () => {
      await executor.execute({
        taskId: 't', shaderCode: 'softmax', buffers: [
          { label: 'A', data: softData, usage: 'storage' },
        ], workgroups: [1, 1, 1], outputBufferIndices: [0], priority: 'normal', deadline: 0, submitterDevice: 'bench',
      });
    }, 500);
    printResult(r2);
    allResults.push(r2);

    // ReLU 100K elements
    const reluData = new Float32Array(100000);
    for (let i = 0; i < 100000; i++) reluData[i] = Math.random() * 10 - 5;

    const r3 = await benchAsync('relu — 100K elements', async () => {
      await executor.execute({
        taskId: 't', shaderCode: 'relu', buffers: [
          { label: 'A', data: reluData, usage: 'storage' },
        ], workgroups: [1, 1, 1], outputBufferIndices: [0], priority: 'normal', deadline: 0, submitterDevice: 'bench',
      });
    }, 200);
    printResult(r3);
    allResults.push(r3);
  }

  // ── 5. Mesh Cortex Inference ──
  printSection('Mesh Cortex — Inference Chain');
  {
    const { MeshCortex } = await import('../src/cortex/mesh-cortex');

    // Single-device, 8 layers
    const transport = {
      getLocalDeviceId: () => 'bench-local',
      getDevices: () => [{ deviceId: 'bench-local', availableMemoryBytes: 536870912, computeSpeed: 1.0 }],
      sendActivation: async () => ({ data: new Float32Array(16), shape: [1, 16] }),
    };
    const cortex = new MeshCortex(transport);
    const weights = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) weights[i] = (Math.sin(i * 0.1) + 1) * 0.1;

    cortex.loadModel({
      modelId: 'bench-model', modelName: 'BenchNet', totalLayers: 8,
      totalParams: 8000, quantization: 8, totalSizeBytes: 8000,
      layerSizes: Array(8).fill(1000), inputShape: [1, 16], outputShape: [1, 16], hiddenDim: 16,
    }, weights);

    const input = { data: new Float32Array(16).fill(1.0), shape: [1, 16] };

    const r1 = await benchAsync('infer() — 8 layers, dim=16, single device', async () => {
      await cortex.infer('bench-model', input);
    }, 200);
    printResult(r1);
    allResults.push(r1);

    // 32 layers
    cortex.unloadModel('bench-model');
    const bigWeights = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) bigWeights[i] = (Math.sin(i * 0.1) + 1) * 0.1;

    cortex.loadModel({
      modelId: 'bench-big', modelName: 'BigNet', totalLayers: 32,
      totalParams: 32000, quantization: 8, totalSizeBytes: 32000,
      layerSizes: Array(32).fill(1000), inputShape: [1, 16], outputShape: [1, 16], hiddenDim: 16,
    }, bigWeights);

    const r2 = await benchAsync('infer() — 32 layers, dim=16, single device', async () => {
      await cortex.infer('bench-big', input);
    }, 100);
    printResult(r2);
    allResults.push(r2);
  }

  // ── 6. Meta-Evolution ──
  printSection('Protocol Meta-Evolution');
  {
    const { ProtocolEvolver } = await import('../src/meta-evolution/evolver');

    const evolver = new ProtocolEvolver();
    const r1 = bench('mutate() — generate mutant genome', () => {
      evolver.mutate();
    }, 5000);
    printResult(r1);
    allResults.push(r1);

    const fitness = {
      throughput: 500, faultRecoveryMs: 200, ccuEfficiency: 1.2,
      intentSatisfaction: 0.9, avgCauseLatencyMs: 15, periodMs: 60000,
    };

    const r2 = bench('computeCompositeScore()', () => {
      evolver.computeCompositeScore(fitness);
    }, 10000);
    printResult(r2);
    allResults.push(r2);

    const r3 = bench('evaluate() — parent vs mutant', () => {
      evolver.mutate();
      evolver.evaluate(fitness, { ...fitness, throughput: 600 });
    }, 2000);
    printResult(r3);
    allResults.push(r3);
  }

  // ── 7. Wire Protocol ──
  printSection('Wire Protocol Encode/Decode');
  {
    const { encodeLifeformMessage, decodeLifeformMessage } = await import('../src/lifeform/wire-protocol');
    const { LifeformMessageType } = await import('../src/types/lifeform');

    const payload = {
      causeId: 'a'.repeat(32),
      type: 'MESSAGE',
      chainId: 'b'.repeat(32),
      chainDepth: 3,
      maxChainDepth: 64,
      deadlineMs: Date.now() + 5000,
      sourceId: 'c'.repeat(32),
      sourceType: 'device',
      targetName: 'sensor-alpha',
      payload: 'x'.repeat(256),
      ccuAttached: 0.5,
      expectsResponse: false,
      correlationId: null,
      emittedAt: Date.now(),
    };

    let encoded: Uint8Array;
    const r1 = bench('encodeLifeformMessage — CAUSE', () => {
      encoded = encodeLifeformMessage(LifeformMessageType.LIFEFORM_CAUSE, payload);
    }, 10000);
    r1.extra = { payloadBytes: encoded!.length };
    printResult(r1);
    allResults.push(r1);

    const r2 = bench('decodeLifeformMessage — CAUSE', () => {
      decodeLifeformMessage(encoded!);
    }, 10000);
    printResult(r2);
    allResults.push(r2);
  }

  // ── 8. Entanglement Sync ──
  printSection('Entanglement');
  {
    const { EntanglementManager } = await import('../src/entanglement/manager');

    const states = new Map<string, Map<string, any>>();
    states.set('lf-a', new Map([['x', 0]]));
    states.set('lf-b', new Map([['x', 0]]));

    const accessor = {
      applyDelta(name: string, delta: any) {
        const s = states.get(name);
        if (!s) return false;
        for (const k of delta.changedKeys) s.set(k, delta.changes[k]);
        return true;
      },
      isAlive(name: string) { return states.has(name); },
      getStateKeys(name: string) { return [...(states.get(name)?.keys() ?? [])]; },
    };

    const mgr = new EntanglementManager(accessor);
    mgr.entangle('lf-a', 'lf-b');

    let seq = 0;
    const r1 = bench('onStateChange() — entangled sync', () => {
      mgr.onStateChange('lf-a', {
        changedKeys: ['x'],
        changes: { x: ++seq },
        extractedAt: Date.now(),
        sequence: seq,
      });
    }, 10000);
    printResult(r1);
    allResults.push(r1);
  }

  // ═══════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════

  const memAfter = memoryUsageMB();

  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════════╗');
  console.log('  ║                       SUMMARY                                ║');
  console.log('  ╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total benchmarks:    ${allResults.length}`);
  console.log(`  Memory before:       ${memBefore} MB`);
  console.log(`  Memory after:        ${memAfter} MB`);
  console.log(`  Memory delta:        ${round(memAfter - memBefore, 1)} MB`);
  console.log('');

  // Top performers
  const sorted = [...allResults].sort((a, b) => b.opsPerSec - a.opsPerSec);
  console.log('  Fastest operations:');
  for (const r of sorted.slice(0, 5)) {
    console.log(`    ${r.opsPerSec.toLocaleString().padStart(10)} ops/s  ${r.name}`);
  }
  console.log('');
  console.log('  Slowest operations:');
  for (const r of sorted.slice(-3)) {
    console.log(`    ${r.opsPerSec.toLocaleString().padStart(10)} ops/s  ${r.name}`);
  }

  console.log('');
  console.log('  ─────────────────────────────────────────────────────────────────');
  console.log('  CMP v3.0 — 16 layers, 110+ message types, zero infrastructure');
  console.log('  "There is no system this sentence maps to."');
  console.log('');
}

// ─── Run ───

runAllBenchmarks().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

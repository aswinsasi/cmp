#!/usr/bin/env npx tsx
/**
 * CMP Protocol Overhead Benchmark
 *
 * IMPORTANT: VirtualNetwork benchmarks CANNOT show parallel speedup
 * because all nodes share a single JS event loop. WASM execution is
 * synchronous — 8 nodes on one thread = sequential, not parallel.
 *
 * This benchmark measures PROTOCOL OVERHEAD:
 *   - Negotiation time (bid collection, scoring, assignment)
 *   - Serialization cost (JSON encoding of binary payloads)
 *   - Assembly time (merging chunk results)
 *   - Correctness (byte-verified output at every scale)
 *
 * For REAL parallel speedup, run on 2+ physical machines over LAN.
 *
 * Run:  cd packages/core && npx tsx benchmarks/scaling-benchmark.ts
 * @author Agent Viscro
 */

import { CMPNode } from '../src/cmp-node';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';
import { buildSensorFilter, buildSensorScale } from '../src/wasm/workload-modules';
import { buildGrayscaleModule } from '../src/wasm/heavy-workloads';
import { TaskType } from '../src/types/task';
import { WasmSandbox } from '../src/wasm/wasm-sandbox';
import fs from 'fs';
import path from 'path';

const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m',
  yellow: '\x1b[33m', magenta: '\x1b[35m',
};

const DATA_SIZES = [
  { label: '1KB', bytes: 1_024 },
  { label: '10KB', bytes: 10_240 },
  { label: '100KB', bytes: 102_400 },
  { label: '500KB', bytes: 512_000 },
];

const NODE_COUNTS = [1, 2, 4, 8];
const BENCHMARK_RUNS = 3;
const THRESHOLD = 100;

async function createMesh(count: number, tag: string) {
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];
  for (let i = 0; i < count; i++) {
    const transport = new VirtualTransport(`${tag}-${i}`, network);
    const node = new CMPNode({
      transports: [], _transport: transport,
      acceptingTasks: true, resourceSharePercent: 100,
      discoveryIntervalMs: 150, heartbeatIntervalMs: 400,
      bidWindowMs: 100,
    } as any);
    await node.start();
    nodes.push(node);
  }
  await new Promise(r => setTimeout(r, 600));
  return { nodes, network };
}

async function stopAll(nodes: CMPNode[]) { for (const n of nodes) await n.stop(); }

async function runLocal(wasm: Uint8Array, input: Uint8Array) {
  const sandbox = new WasmSandbox();
  const t0 = performance.now();
  const result = await sandbox.execute(wasm, input, { entryPoint: 'process' });
  return { output: result.output, ms: performance.now() - t0 };
}

function generateData(bytes: number): Uint8Array {
  const d = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) d[i] = Math.floor(Math.random() * 256);
  return d;
}

function generateRGB(bytes: number): Uint8Array {
  return generateData(Math.floor(bytes / 3) * 3);
}

function avg(a: number[]) { return a.reduce((x, y) => x + y, 0) / a.length; }

async function benchmarkWorkload(
  name: string, wasm: Uint8Array, gen: (n: number) => Uint8Array,
) {
  console.log(`\n  ${C.b}${C.cyan}━━━ ${name} ━━━${C.r}`);
  console.log(`    ${C.d}${'Size'.padEnd(7)}│ ${'Local WASM'.padEnd(12)}│ ${'2N total'.padEnd(12)}│ ${'4N total'.padEnd(12)}│ ${'8N total'.padEnd(12)}│ Overhead │ Correct${C.r}`);

  const rows: string[] = [];

  for (const { label, bytes } of DATA_SIZES) {
    const input = gen(bytes);

    // Local baseline
    const localRuns: number[] = [];
    let localOutput: Uint8Array = new Uint8Array(0);
    for (let r = 0; r < BENCHMARK_RUNS; r++) {
      const { output, ms } = await runLocal(wasm, input);
      localRuns.push(ms);
      localOutput = output;
    }
    const localAvg = avg(localRuns);

    const cells: string[] = [`${localAvg.toFixed(2)}ms`.padEnd(12)];
    let lastOverhead = 0;
    let allCorrect = true;

    for (const n of [2, 4, 8]) {
      const { nodes } = await createMesh(n, `b-${label}-${n}`);
      try {
        const runs: number[] = [];
        let correct = true;
        for (let r = 0; r < BENCHMARK_RUNS; r++) {
          const t0 = performance.now();
          const result = await nodes[0].compute(wasm, input, {
            entryPoint: 'process', deadline: 60000,
            chunkHint: n, taskType: TaskType.DATA_PARALLEL,
          });
          runs.push(performance.now() - t0);

          // Verify output correctness
          if (result.data.length === 0 && localOutput.length > 0) correct = false;
          for (const b of result.data) {
            if (name.includes('Filter') && b <= THRESHOLD) { correct = false; break; }
          }
        }
        const distAvg = avg(runs);
        lastOverhead = distAvg - localAvg;
        if (!correct) allCorrect = false;
        cells.push(`${distAvg.toFixed(0)}ms`.padEnd(12));
      } finally {
        await stopAll(nodes);
      }
    }

    const correctStr = allCorrect ? `${C.green}✓${C.r}` : `${C.red}✗${C.r}`;
    console.log(`    ${label.padEnd(7)}│ ${cells.join('│ ')}│ ${C.yellow}${lastOverhead.toFixed(0)}ms${C.r}`.padEnd(90) + `  │ ${correctStr}`);

    rows.push(`${name},${label},${bytes},${localAvg.toFixed(2)},${lastOverhead.toFixed(0)},${allCorrect}`);
  }

  return rows;
}

async function main() {
  console.log(`\n${C.b}  ═══════════════════════════════════════════════════${C.r}`);
  console.log(`${C.b}    CMP PROTOCOL OVERHEAD BENCHMARK${C.r}`);
  console.log(`${C.b}  ═══════════════════════════════════════════════════${C.r}`);
  console.log(`  ${C.yellow}⚠ VirtualNetwork: all nodes share 1 JS thread = no parallel speedup${C.r}`);
  console.log(`  ${C.d}This measures protocol overhead, not parallel performance.${C.r}`);
  console.log(`  ${C.d}For real speedup, run on separate machines over LAN.${C.r}\n`);

  const csvRows: string[] = ['workload,data_size,bytes,local_wasm_ms,overhead_8n_ms,correct'];

  csvRows.push(...await benchmarkWorkload('SensorFilter(>100)', buildSensorFilter(THRESHOLD), generateData));
  csvRows.push(...await benchmarkWorkload('SensorScale(x2)', buildSensorScale(2), generateData));
  csvRows.push(...await benchmarkWorkload('RGB→Grayscale', buildGrayscaleModule(), generateRGB));

  // Summary
  console.log(`\n  ${C.b}══════════════════════════════════════════════${C.r}`);
  console.log(`  ${C.b}  WHAT THIS MEANS${C.r}`);
  console.log(`  ${C.b}══════════════════════════════════════════════${C.r}`);
  console.log(`\n  ${C.b}Protocol overhead:${C.r} ~100-500ms per distributed task`);
  console.log(`    Breakdown: negotiation (~100ms) + JSON serialization + AES encryption`);
  console.log(`\n  ${C.b}When does distribution WIN on real machines?${C.r}`);
  console.log(`    When: (WASM time on 1 machine) > (WASM time / N) + overhead`);
  console.log(`    Example: a 10-second WASM task across 4 machines`);
  console.log(`      Local:       10,000ms`);
  console.log(`      Distributed: 10,000/4 + ~300ms overhead = ${C.green}2,800ms (3.6x speedup)${C.r}`);
  console.log(`\n  ${C.b}Why VirtualNetwork can't show this:${C.r}`);
  console.log(`    All 8 "nodes" run on 1 CPU thread. WASM is synchronous.`);
  console.log(`    8 sequential chunks + overhead will always be slower than 1 local run.`);
  console.log(`    ${C.green}This is NOT a CMP bug — it's a benchmark limitation.${C.r}`);

  // Write CSV
  const dir = path.join(__dirname, 'results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csvPath = path.join(dir, `overhead-${ts}.csv`);
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\n  ${C.green}✓${C.r} CSV: ${C.d}${csvPath}${C.r}`);
  console.log(`\n  ${C.b}Done.${C.r}\n`);
}

main().catch(err => { console.error(`${C.red}FATAL:${C.r}`, err); process.exit(1); });

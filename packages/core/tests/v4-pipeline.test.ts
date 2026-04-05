/**
 * CMP v4.0 — Phase 7: CMP Pipes Tests
 *
 * 40 tests covering:
 *   - Built-in stages: filter, map, batch, throttle, sample, log, collect
 *   - Pipeline lifecycle: define → start → push → stop
 *   - Streaming: push 1000 items through multi-stage pipeline
 *   - Backpressure: activation, release, bottleneck detection
 *   - Stage routing: device assignment, rebalancing
 *   - Pipeline metrics: throughput, latency, buffer
 *   - Edge cases: empty pipeline, duplicate names, max pipelines
 *
 * Run: npx tsx packages/core/tests/v4-pipeline.test.ts
 *
 * @author Agent Viscro
 */

import { PipelineManager } from '../src/pipes/pipeline-manager';
import { BackpressureController } from '../src/pipes/backpressure';
import { StageRouter } from '../src/pipes/stage-router';
import { StageExecutor } from '../src/pipes/stage-executor';
import { PipelineState, DEFAULT_PIPELINE_CONFIG } from '../src/pipes/pipeline-types';
import { getBuiltinStage, isBuiltinStage, flushCollect } from '../src/pipes/stages/builtin-stages';

// ─── Test Runner ───

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

// ─── Helpers ───

function encode(s: string): Uint8Array { return new TextEncoder().encode(s); }
function decode(b: Uint8Array): string { return new TextDecoder().decode(b); }

function uint32Bytes(n: number): Uint8Array {
  return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]);
}

// ─── Main ───

async function main() {

// ════════════════════════════════════════════
// Built-in Stages (unit)
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Built-in Stages ──\x1b[0m');

test('1. filter: nonzero passes non-zero items', () => {
  const filter = getBuiltinStage('filter')!;
  const r1 = filter(new Uint8Array([1, 2, 3]), { predicate: 'nonzero' });
  assertEqual(r1.length, 1, 'passes');
  const r2 = filter(new Uint8Array([0, 0, 0]), { predicate: 'nonzero' });
  assertEqual(r2.length, 0, 'filters zeros');
});

test('2. filter: gt threshold', () => {
  const filter = getBuiltinStage('filter')!;
  const r1 = filter(uint32Bytes(200), { predicate: 'gt:100' });
  assertEqual(r1.length, 1, '200 > 100 passes');
  const r2 = filter(uint32Bytes(50), { predicate: 'gt:100' });
  assertEqual(r2.length, 0, '50 > 100 filtered');
});

test('3. filter: contains text', () => {
  const filter = getBuiltinStage('filter')!;
  const r1 = filter(encode('hello world'), { predicate: 'contains:world' });
  assertEqual(r1.length, 1, 'contains passes');
  const r2 = filter(encode('hello world'), { predicate: 'contains:xyz' });
  assertEqual(r2.length, 0, 'not contains filtered');
});

test('4. map: double', () => {
  const map = getBuiltinStage('map')!;
  const result = map(new Uint8Array([10, 20, 30]), { transform: 'double' });
  assertEqual(result.length, 1, '1 output');
  assertEqual(result[0][0], 20, 'doubled 10→20');
  assertEqual(result[0][1], 40, 'doubled 20→40');
});

test('5. map: uppercase', () => {
  const map = getBuiltinStage('map')!;
  const result = map(encode('hello'), { transform: 'uppercase' });
  assertEqual(decode(result[0]), 'HELLO', 'uppercased');
});

test('6. map: reverse', () => {
  const map = getBuiltinStage('map')!;
  const result = map(new Uint8Array([1, 2, 3]), { transform: 'reverse' });
  assertEqual(result[0][0], 3, 'reversed');
  assertEqual(result[0][2], 1, 'reversed');
});

test('7. map: xor cipher', () => {
  const map = getBuiltinStage('map')!;
  const input = new Uint8Array([0x48, 0x65, 0x6C]); // "Hel"
  const encrypted = map(input, { transform: 'xor:66' });
  // XOR twice = original
  const decrypted = map(encrypted[0], { transform: 'xor:66' });
  assertEqual(decrypted[0][0], 0x48, 'round-trip');
  assertEqual(decrypted[0][2], 0x6C, 'round-trip');
});

test('8. batch: collects N items', () => {
  const batch = getBuiltinStage('batch')!;
  const config: any = { size: 3 };
  assertEqual(batch(encode('a'), config).length, 0, 'not full yet');
  assertEqual(batch(encode('b'), config).length, 0, 'not full yet');
  const result = batch(encode('c'), config);
  assertEqual(result.length, 1, 'emitted batch');
  assertEqual(decode(result[0]), 'abc', 'concatenated');
});

test('9. sample: passes every Nth item', () => {
  const sample = getBuiltinStage('sample')!;
  const config: any = { n: 3 };
  let passCount = 0;
  for (let i = 1; i <= 9; i++) {
    if (sample(encode(`item${i}`), config).length > 0) passCount++;
  }
  assertEqual(passCount, 3, '3 of 9 passed (every 3rd)');
});

test('10. throttle: limits rate', () => {
  const throttle = getBuiltinStage('throttle')!;
  const config: any = { rate: 1000 }; // 1000/sec = 1 per ms
  // First item always passes
  const r1 = throttle(encode('a'), config);
  assertEqual(r1.length, 1, 'first passes');
  // Immediate second should be dropped (same ms)
  const r2 = throttle(encode('b'), config);
  assertEqual(r2.length, 0, 'throttled');
});

test('11. collect: accumulates all items', () => {
  const collect = getBuiltinStage('collect')!;
  const config: any = {};
  collect(encode('one'), config);
  collect(encode('two'), config);
  collect(encode('three'), config);
  // Nothing emitted during streaming
  // Flush at end
  const result = flushCollect(config);
  assertEqual(decode(result), 'onetwothree', 'all collected');
});

test('12. isBuiltinStage identifies known stages', () => {
  assert(isBuiltinStage('filter'), 'filter is builtin');
  assert(isBuiltinStage('map'), 'map is builtin');
  assert(isBuiltinStage('batch'), 'batch is builtin');
  assert(isBuiltinStage('collect'), 'collect is builtin');
  assert(!isBuiltinStage('custom_xyz'), 'custom is not builtin');
});

// ════════════════════════════════════════════
// Backpressure
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Backpressure ──\x1b[0m');

test('13. backpressure activates when buffer exceeds threshold', () => {
  const bp = new BackpressureController({ ...DEFAULT_PIPELINE_CONFIG, defaultBufferCapacity: 10, backpressureThreshold: 0.8, rebalanceTimeoutMs: 30000, metricsIntervalMs: 5000, maxPipelines: 10 });
  bp.initStage(0);

  // Fill buffer to 80% (threshold)
  for (let i = 0; i < 8; i++) {
    bp.onItemEnter(0);
  }
  assert(bp.isActive(0), 'active at 80%');
});

test('14. backpressure releases when buffer drains', () => {
  const bp = new BackpressureController({ ...DEFAULT_PIPELINE_CONFIG, defaultBufferCapacity: 10, backpressureThreshold: 0.8, rebalanceTimeoutMs: 30000, metricsIntervalMs: 5000, maxPipelines: 10 });
  bp.initStage(0);

  // Fill to trigger
  for (let i = 0; i < 9; i++) bp.onItemEnter(0);
  assert(bp.isActive(0), 'active');

  // Drain below half threshold (4)
  for (let i = 0; i < 6; i++) bp.onItemExit(0);
  assert(!bp.isActive(0), 'released');
});

test('15. findBottleneck identifies highest-occupancy stage', () => {
  const bp = new BackpressureController({ ...DEFAULT_PIPELINE_CONFIG, defaultBufferCapacity: 10, backpressureThreshold: 0.5, rebalanceTimeoutMs: 30000, metricsIntervalMs: 5000, maxPipelines: 10 });
  bp.initStage(0);
  bp.initStage(1);
  bp.initStage(2);

  // Stage 1 is busiest
  for (let i = 0; i < 3; i++) bp.onItemEnter(0);
  for (let i = 0; i < 8; i++) bp.onItemEnter(1);
  for (let i = 0; i < 2; i++) bp.onItemEnter(2);

  assertEqual(bp.findBottleneck(), 1, 'stage 1 is bottleneck');
});

test('16. no bottleneck when all buffers low', () => {
  const bp = new BackpressureController({ ...DEFAULT_PIPELINE_CONFIG, defaultBufferCapacity: 100, backpressureThreshold: 0.8, rebalanceTimeoutMs: 30000, metricsIntervalMs: 5000, maxPipelines: 10 });
  bp.initStage(0);
  bp.initStage(1);
  bp.onItemEnter(0);
  bp.onItemEnter(1);
  assertEqual(bp.findBottleneck(), null, 'no bottleneck');
});

// ════════════════════════════════════════════
// Stage Router
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Stage Router ──\x1b[0m');

test('17. assigns stages round-robin', () => {
  const router = new StageRouter('local');
  const stages = [
    { name: 'input', type: 'builtin' as const, handler: 'filter', config: {}, index: 0 },
    { name: 'process', type: 'builtin' as const, handler: 'map', config: {}, index: 1 },
    { name: 'middle', type: 'builtin' as const, handler: 'map', config: {}, index: 2 },
    { name: 'output', type: 'builtin' as const, handler: 'collect', config: {}, index: 3 },
  ];
  const assignments = router.assignStages(stages, ['local', 'peer-1', 'peer-2']);

  assertEqual(assignments[0].deviceId, 'local', 'first=local');
  assertEqual(assignments[3].deviceId, 'local', 'last=local');
  // Middle stages distributed to peers
  assert(assignments[1].deviceId !== 'local' || assignments[2].deviceId !== 'local', 'middle stages distributed');
});

test('18. single device gets all stages', () => {
  const router = new StageRouter('local');
  const stages = [
    { name: 'a', type: 'builtin' as const, handler: 'filter', config: {}, index: 0 },
    { name: 'b', type: 'builtin' as const, handler: 'map', config: {}, index: 1 },
  ];
  const assignments = router.assignStages(stages, ['local']);
  assert(assignments.every(a => a.deviceId === 'local'), 'all local');
});

test('19. reassignStage picks alternative device', () => {
  const router = new StageRouter('local');
  const newDevice = router.reassignStage(1, 'peer-1', ['local', 'peer-1', 'peer-2']);
  assert(newDevice !== null, 'found alternative');
  assert(newDevice !== 'peer-1', 'different from current');
});

// ════════════════════════════════════════════
// Pipeline Manager — Lifecycle
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pipeline Manager: Lifecycle ──\x1b[0m');

test('20. define creates a pipeline', () => {
  const mgr = new PipelineManager('local');
  const inst = mgr.define('test1', ['filter', 'map', 'collect']);
  assertEqual(inst.name, 'test1', 'name');
  assertEqual(inst.state, PipelineState.DEFINED, 'DEFINED');
  assertEqual(inst.stages.length, 3, '3 stages');
  mgr.remove('test1');
});

test('21. start transitions to RUNNING', () => {
  const mgr = new PipelineManager('local');
  mgr.define('test2', ['filter', 'collect']);
  assert(mgr.start('test2'), 'started');
  assertEqual(mgr.get('test2')!.state, PipelineState.RUNNING, 'RUNNING');
  mgr.remove('test2');
});

test('22. stop transitions to STOPPED', () => {
  const mgr = new PipelineManager('local');
  mgr.define('test3', ['filter', 'collect']);
  mgr.start('test3');
  mgr.stop('test3');
  assertEqual(mgr.get('test3')!.state, PipelineState.STOPPED, 'STOPPED');
  mgr.remove('test3');
});

test('23. push into running pipeline', () => {
  const mgr = new PipelineManager('local');
  mgr.define('test4', ['map', 'collect']);
  mgr.start('test4');

  assert(mgr.push('test4', encode('hello')), 'push ok');
  assert(mgr.push('test4', encode('world')), 'push ok');

  const inst = mgr.get('test4')!;
  assertEqual(inst.totalItemsPushed, 2, '2 pushed');

  mgr.remove('test4');
});

test('24. push into stopped pipeline fails', () => {
  const mgr = new PipelineManager('local');
  mgr.define('test5', ['collect']);
  // Not started
  assert(!mgr.push('test5', encode('nope')), 'push fails when not running');
  mgr.remove('test5');
});

test('25. list returns all pipelines', () => {
  const mgr = new PipelineManager('local');
  mgr.define('p1', ['filter']);
  mgr.define('p2', ['map']);
  const list = mgr.list();
  assertEqual(list.length, 2, '2 pipelines');
  mgr.remove('p1');
  mgr.remove('p2');
});

test('26. remove deletes pipeline', () => {
  const mgr = new PipelineManager('local');
  mgr.define('del', ['filter']);
  mgr.remove('del');
  assertEqual(mgr.get('del'), null, 'removed');
});

test('27. duplicate name throws', () => {
  const mgr = new PipelineManager('local');
  mgr.define('dup', ['filter']);
  try {
    mgr.define('dup', ['map']);
    assert(false, 'should throw');
  } catch (err: any) {
    assert(err.message.includes('already exists'), 'duplicate error');
  }
  mgr.remove('dup');
});

// ════════════════════════════════════════════
// Pipeline Manager — Streaming
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pipeline Manager: Streaming ──\x1b[0m');

test('28. filter → collect pipeline', () => {
  const mgr = new PipelineManager('local');
  mgr.define('fc', ['filter:predicate=nonzero', 'collect']);
  mgr.start('fc');

  mgr.push('fc', new Uint8Array([1, 2, 3]));  // passes
  mgr.push('fc', new Uint8Array([0, 0, 0]));  // filtered
  mgr.push('fc', new Uint8Array([4, 5, 6]));  // passes

  const result = mgr.stop('fc');
  assert(result !== null, 'has result');
  assertEqual(result!.length, 6, '6 bytes (2 items passed, 1 filtered)');
  mgr.remove('fc');
});

test('29. map:uppercase → collect pipeline', () => {
  const mgr = new PipelineManager('local');
  mgr.define('uc', ['map:transform=uppercase', 'collect']);
  mgr.start('uc');

  mgr.push('uc', encode('hello'));
  mgr.push('uc', encode('world'));

  const result = mgr.stop('uc');
  assertEqual(decode(result!), 'HELLOWORLD', 'uppercased');
  mgr.remove('uc');
});

test('30. filter → map → collect 3-stage pipeline', () => {
  const mgr = new PipelineManager('local');
  mgr.define('fmc', ['filter:predicate=nonzero', 'map:transform=double', 'collect']);
  mgr.start('fmc');

  mgr.push('fmc', new Uint8Array([5]));
  mgr.push('fmc', new Uint8Array([0])); // filtered
  mgr.push('fmc', new Uint8Array([10]));

  const result = mgr.stop('fmc');
  assert(result !== null, 'has result');
  assertEqual(result![0], 10, '5 doubled');
  assertEqual(result![1], 20, '10 doubled');
  mgr.remove('fmc');
});

test('31. push 1000 items through pipeline', () => {
  const mgr = new PipelineManager('local');
  mgr.define('bulk', ['map:transform=identity', 'collect']);
  mgr.start('bulk');

  for (let i = 0; i < 1000; i++) {
    mgr.push('bulk', encode(`item-${i}`));
  }

  const result = mgr.stop('bulk');
  assert(result !== null, 'has result');
  assert(result!.length > 0, 'non-empty');
  assertEqual(mgr.get('bulk')!.totalItemsPushed, 1000, '1000 pushed');
  mgr.remove('bulk');
});

test('32. batch stage collects and emits', () => {
  const mgr = new PipelineManager('local');
  mgr.define('bat', ['batch:size=3', 'collect']);
  mgr.start('bat');

  // Push 7 items: should get 2 batches (3+3), 1 leftover flushed at stop
  for (let i = 0; i < 7; i++) {
    mgr.push('bat', new Uint8Array([i]));
  }

  const result = mgr.stop('bat');
  assert(result !== null, 'has result');
  // 2 batches of 3 bytes each = 6, plus flushed batch of 1 = 7
  assertEqual(result!.length, 7, 'all 7 bytes collected');
  mgr.remove('bat');
});

test('33. sample stage passes every Nth', () => {
  const mgr = new PipelineManager('local');
  mgr.define('samp', ['sample:n=5', 'collect']);
  mgr.start('samp');

  for (let i = 0; i < 20; i++) {
    mgr.push('samp', new Uint8Array([i]));
  }

  const result = mgr.stop('samp');
  assert(result !== null, 'has result');
  assertEqual(result!.length, 4, '4 of 20 passed (every 5th)');
  mgr.remove('samp');
});

// ════════════════════════════════════════════
// Pipeline Metrics
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pipeline Metrics ──\x1b[0m');

test('34. getMetrics returns stage-level data', () => {
  const mgr = new PipelineManager('local');
  mgr.define('met', ['filter', 'map', 'collect']);
  mgr.start('met');

  for (let i = 0; i < 10; i++) {
    mgr.push('met', new Uint8Array([i + 1]));
  }

  const metrics = mgr.getMetrics('met');
  assert(metrics !== null, 'has metrics');
  assertEqual(metrics!.stages.length, 3, '3 stage metrics');
  assertEqual(metrics!.totalItemsPushed, 10, '10 pushed');
  assert(metrics!.stages[0].itemsProcessed >= 1, 'stage 0 processed items');

  mgr.remove('met');
});

test('35. metrics track per-stage throughput', () => {
  const mgr = new PipelineManager('local');
  mgr.define('thr', ['map:transform=identity', 'collect']);
  mgr.start('thr');

  for (let i = 0; i < 50; i++) {
    mgr.push('thr', new Uint8Array([i]));
  }

  const metrics = mgr.getMetrics('thr')!;
  assert(metrics.stages[0].itemsProcessed >= 50, `stage 0 processed ≥50 (got ${metrics.stages[0].itemsProcessed})`);
  mgr.remove('thr');
});

test('36. metrics returns null for unknown pipeline', () => {
  const mgr = new PipelineManager('local');
  assertEqual(mgr.getMetrics('nonexistent'), null, 'null');
});

// ════════════════════════════════════════════
// Multi-device Routing
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Multi-device Routing ──\x1b[0m');

test('37. stages distributed across devices', () => {
  const mgr = new PipelineManager('local', ['peer-1', 'peer-2']);
  mgr.define('dist', ['filter', 'map', 'map', 'collect']);
  mgr.start('dist');

  const metrics = mgr.getMetrics('dist')!;
  const devices = new Set(metrics.stages.map(s => s.deviceId));
  assert(devices.size >= 2, `distributed across ≥2 devices (got ${devices.size})`);
  // First and last on local
  assertEqual(metrics.stages[0].deviceId, 'local', 'first=local');
  assertEqual(metrics.stages[3].deviceId, 'local', 'last=local');

  mgr.remove('dist');
});

test('38. pipeline works with peers (streaming still functions)', () => {
  const mgr = new PipelineManager('local', ['peer-1']);
  mgr.define('peer-test', ['filter:predicate=nonzero', 'map:transform=double', 'collect']);
  mgr.start('peer-test');

  mgr.push('peer-test', new Uint8Array([3]));
  mgr.push('peer-test', new Uint8Array([0]));
  mgr.push('peer-test', new Uint8Array([7]));

  const result = mgr.stop('peer-test');
  assertEqual(result![0], 6, '3 doubled');
  assertEqual(result![1], 14, '7 doubled');
  mgr.remove('peer-test');
});

// ════════════════════════════════════════════
// Events
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Events ──\x1b[0m');

test('39. pipeline emits lifecycle events', () => {
  const mgr = new PipelineManager('local');
  const events: string[] = [];
  mgr.onEvent(e => events.push(e.type));

  mgr.define('evt', ['collect']);
  mgr.start('evt');
  mgr.stop('evt');

  assert(events.includes('started'), 'started event');
  assert(events.includes('stopped'), 'stopped event');
  mgr.remove('evt');
});

test('40. pushMany processes multiple items', () => {
  const mgr = new PipelineManager('local');
  mgr.define('many', ['collect']);
  mgr.start('many');

  const items = [encode('a'), encode('b'), encode('c')];
  const count = mgr.pushMany('many', items);
  assertEqual(count, 3, '3 pushed');

  const result = mgr.stop('many');
  assertEqual(decode(result!), 'abc', 'all collected');
  mgr.remove('many');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 7: CMP Pipes\x1b[0m`);
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

/**
 * CMP v1.4 — Performance Benchmarks
 * Measures real performance characteristics of the Lifeform system.
 *
 * Run: npx ts-node --transpile-only packages/core/benchmarks/benchmark.ts
 *
 * @author Agent Viscro
 */

import { LifeformManager } from '../src/lifeform/manager';
import { CRDTState } from '../src/lifeform/crdt/crdt-state';
import { GCounter, PNCounter, LWWRegister, ORSet } from '../src/lifeform/crdt/crdts';
import { FusionEngine } from '../src/lifeform/fusion';
import { CauseQueue, EnqueueResult } from '../src/lifeform/cause-queue';
import { CausalExecutor } from '../src/lifeform/causal-executor';
import { WasmMutator, instantiateGenome, defaultSpec } from '../src/lifeform/wasm-mutator';
import { IntentRegistry, IntentVerifier } from '../src/lifeform/intent';
import { Cause, CauseType } from '../src/types/causal';
import { LifeformConfig } from '../src/types/lifeform';
import { StateConflictStrategy, FissionTrigger } from '../src/types/fusion';
import { PredicateType, ViolationAction } from '../src/types/intent';
import { generateId, generateKeypair } from '../src/lifeform/crypto';

// ── Helpers ──

function makeCause(): Cause {
  return {
    id: generateId(), type: CauseType.MESSAGE, chainId: generateId(),
    chainDepth: 0, maxChainDepth: 64, deadlineMs: 0,
    sourceId: generateId(), sourceType: 'device', targetId: generateId(),
    payload: new TextEncoder().encode('bench'),
    ccuAttached: 0, expectsResponse: false, correlationId: null, emittedAt: Date.now(),
  };
}

function makeConfig(name: string, ccu: number = 100000): LifeformConfig {
  return {
    name, wasmModule: new Uint8Array([0, 0x61, 0x73, 0x6d]),
    initialState: { status: 'active' }, initialCcu: ccu,
    minReplicas: 1, maxReplicas: 3, autoMigrate: true,
    mutationLibraryHash: null, maxCausesPerSecond: 100000, maxStateSizeBytes: 10 * 1024 * 1024,
  };
}

const C = {
  b: '\x1b[1m', r: '\x1b[0m', d: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', magenta: '\x1b[35m',
};

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

// ═══════════════════════════════════════
// Benchmark Runner
// ═══════════════════════════════════════

async function benchCausesPerSecond(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 1: Causes Per Second${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  const mgr = new LifeformManager({ deviceId: 'bench', maxHostedLifeforms: 100 });
  mgr.start();

  const hosted = mgr.spawn(makeConfig('bench-lf', 1000000))!;
  mgr.setHandler('bench-lf', async () => ({ stateMutations: 1, outgoingCauses: [] }));

  // Warmup
  for (let i = 0; i < 50; i++) await mgr.deliverCause('bench-lf', makeCause());

  // Measure
  for (const N of [1000, 5000]) {
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      await mgr.deliverCause('bench-lf', makeCause());
    }
    const elapsed = performance.now() - start;
    const rate = (N / elapsed * 1000).toFixed(0);
    console.log(`  ${C.green}${fmt(N)}${C.r} causes in ${C.cyan}${elapsed.toFixed(0)}ms${C.r} = ${C.b}${fmt(parseInt(rate))} causes/sec${C.r}`);
  }

  mgr.stop();
}

async function benchMaxLifeforms(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 2: Maximum Hosted Lifeforms${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  const mgr = new LifeformManager({ deviceId: 'bench', maxHostedLifeforms: 1000 });
  mgr.start();

  const memBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let count = 0;

  for (let i = 0; i < 50; i++) {
    const hosted = mgr.spawn(makeConfig(`lf-${i}`, 10000));
    if (!hosted) break;
    mgr.setHandler(`lf-${i}`, async () => ({ stateMutations: 0, outgoingCauses: [] }));
    count++;
  }

  const elapsed = performance.now() - start;
  const memAfter = process.memoryUsage().heapUsed;
  const memPerLf = (memAfter - memBefore) / count;

  console.log(`  Spawned ${C.b}${count}${C.r} Lifeforms in ${C.cyan}${elapsed.toFixed(0)}ms${C.r}`);
  console.log(`  Memory: ${C.cyan}${(memPerLf / 1024).toFixed(1)} KB${C.r} per Lifeform`);
  console.log(`  Total heap: ${C.cyan}${((memAfter) / 1024 / 1024).toFixed(1)} MB${C.r}`);

  // Deliver one cause to each
  const causeStart = performance.now();
  for (let i = 0; i < count; i++) {
    await mgr.deliverCause(`lf-${i}`, makeCause());
  }
  const causeElapsed = performance.now() - causeStart;
  console.log(`  Delivered 1 cause to each: ${C.cyan}${causeElapsed.toFixed(0)}ms${C.r} (${(causeElapsed / count).toFixed(2)}ms avg)`);

  mgr.stop();
}

async function benchCrdtMerge(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 3: CRDT Merge Latency${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  for (const keyCount of [10, 100, 1000, 5000]) {
    const stateA = new CRDTState('node-a');
    const stateB = new CRDTState('node-b');

    for (let i = 0; i < keyCount; i++) {
      stateA.set(`key-${i}`, `value-a-${i}`);
      stateB.set(`key-${i}`, `value-b-${i}`);
    }

    const start = performance.now();
    stateA.merge(stateB);
    const elapsed = performance.now() - start;

    console.log(`  ${C.green}${fmt(keyCount)}${C.r} keys: merge in ${C.cyan}${elapsed.toFixed(2)}ms${C.r}  (${(elapsed / keyCount * 1000).toFixed(1)}µs/key)`);
  }
}

async function benchSnapshotSize(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 4: State Snapshot Size${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  for (const keyCount of [10, 100, 500, 1000]) {
    const state = new CRDTState('node');
    for (let i = 0; i < keyCount; i++) {
      state.set(`key-${i}`, { value: i, label: `item-${i}`, active: i % 2 === 0 });
    }

    const snap = state.snapshot();
    const json = JSON.stringify(snap);

    console.log(`  ${C.green}${fmt(keyCount)}${C.r} keys: snapshot ${C.cyan}${(json.length / 1024).toFixed(1)} KB${C.r}  (${(json.length / keyCount).toFixed(0)} bytes/key)`);
  }
}

async function benchDeltaExtraction(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 5: Delta Extraction${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  const state = new CRDTState('node');
  // Populate with 1000 keys
  for (let i = 0; i < 1000; i++) state.set(`key-${i}`, i);
  state.extractDelta(); // Clear dirty

  for (const changeCount of [1, 10, 50, 100]) {
    // Modify N keys
    for (let i = 0; i < changeCount; i++) state.set(`key-${i}`, Math.random());

    const start = performance.now();
    const delta = state.extractDelta();
    const elapsed = performance.now() - start;

    console.log(`  ${C.green}${changeCount}${C.r} changed keys (of 1000): delta in ${C.cyan}${elapsed.toFixed(2)}ms${C.r}  (${delta.changedKeys.length} keys)`);
  }
}

async function benchFusionExecution(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 6: Fusion/Fission Time${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  for (const keyCount of [10, 100, 500]) {
    const engine = new FusionEngine();
    const kpA = generateKeypair();
    const kpB = generateKeypair();

    const soulA = {
      id: generateId(), name: 'bench-a', publicKey: kpA.publicKey,
      secretKey: kpA.secretKey, creatorId: generateId(),
      bornAt: Date.now(), generation: 0, parentId: null,
    };
    const soulB = {
      id: generateId(), name: 'bench-b', publicKey: kpB.publicKey,
      secretKey: kpB.secretKey, creatorId: generateId(),
      bornAt: Date.now(), generation: 0, parentId: null,
    };

    const stateA = new CRDTState('a');
    const stateB = new CRDTState('b');
    for (let i = 0; i < keyCount; i++) {
      stateA.set(`a-key-${i}`, `val-${i}`);
      stateB.set(`b-key-${i}`, `val-${i}`);
    }

    const proposal = engine.propose(soulA, soulB.id, {
      compositeName: 'bench-composite',
      stateConflictStrategy: StateConflictStrategy.NAMESPACE_PREFIX,
      ccuContributionRatio: 0.5, primaryGenome: 'proposer',
      fissionTriggers: [FissionTrigger.MANUAL_ONLY], maxFusionDurationMs: 0,
    });
    engine.accept(proposal.id, soulB);

    // Fusion
    const fusionStart = performance.now();
    const record = engine.execute(
      proposal.id, stateA, stateB,
      1000, 800, new Uint8Array(32), new Uint8Array(32),
    )!;
    const fusionElapsed = performance.now() - fusionStart;

    // Fission
    const fissionStart = performance.now();
    engine.fission(record.compositeSoul!.compositeId, record.mergedState!, 1800);
    const fissionElapsed = performance.now() - fissionStart;

    console.log(`  ${C.green}${fmt(keyCount)}${C.r} keys/side: fusion ${C.cyan}${fusionElapsed.toFixed(1)}ms${C.r}  fission ${C.cyan}${fissionElapsed.toFixed(1)}ms${C.r}`);
  }
}

async function benchCauseQueue(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 7: Cause Queue Throughput${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  const queue = new CauseQueue({ maxSize: 100000, maxCausesPerSecond: 1000000, maxChainDepth: 64 });

  for (const N of [1000, 5000]) {
    // Enqueue
    const enqStart = performance.now();
    for (let i = 0; i < N; i++) queue.enqueue(makeCause());
    const enqElapsed = performance.now() - enqStart;

    // Dequeue
    const deqStart = performance.now();
    while (queue.hasPending) queue.dequeue();
    const deqElapsed = performance.now() - deqStart;

    console.log(`  ${C.green}${fmt(N)}${C.r}: enqueue ${C.cyan}${enqElapsed.toFixed(0)}ms${C.r}  dequeue ${C.cyan}${deqElapsed.toFixed(0)}ms${C.r}  (${(enqElapsed / N * 1000).toFixed(1)}µs + ${(deqElapsed / N * 1000).toFixed(1)}µs per op)`);
  }
}

async function benchIntentVerification(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 8: Intent Verification${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  const verifier = new IntentVerifier();
  const state = new CRDTState('node');
  state.set('temperature', 25);
  state.set('humidity', 60);
  state.set('status', 'active');

  const intent = {
    id: generateId(), lifeformId: generateId(),
    description: 'temp < 30 AND humidity > 40',
    predicate: {
      type: PredicateType.COMPOUND, stateKey: '', operator: 'eq' as const, value: 0,
      logicOperator: 'and' as const,
      children: [
        { type: PredicateType.VALUE_CHECK, stateKey: 'temperature', operator: 'lt' as const, value: 30 },
        { type: PredicateType.VALUE_CHECK, stateKey: 'humidity', operator: 'gt' as const, value: 40 },
      ],
    },
    sampleIntervalMs: 60000, samplesPerInterval: 3,
    violationAction: ViolationAction.NOTIFY, ccuStaked: 10,
    beneficiaryId: generateId(), activeSince: Date.now(), expiresAt: 0,
    commitment: new Uint8Array(64), violationThreshold: 3, consecutiveViolations: 0,
  };

  const N = 10000;
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    verifier.evaluateIntent(intent, state);
  }
  const elapsed = performance.now() - start;

  console.log(`  ${C.green}${fmt(N)}${C.r} compound predicate evals in ${C.cyan}${elapsed.toFixed(0)}ms${C.r} = ${C.b}${fmt(Math.floor(N / elapsed * 1000))}/sec${C.r}`);
}

async function benchWasmCompileExecute(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 9: WASM Compile + Execute${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  const mutator = new WasmMutator();

  // Compile
  const compileStart = performance.now();
  const wasm = await mutator.createTestGenome(100, 0);
  const compileElapsed = performance.now() - compileStart;
  console.log(`  Compile: ${C.cyan}${compileElapsed.toFixed(1)}ms${C.r}  (${wasm.length} bytes)`);

  // Instantiate
  const instStart = performance.now();
  const { exports } = await instantiateGenome(wasm);
  const instElapsed = performance.now() - instStart;
  console.log(`  Instantiate: ${C.cyan}${instElapsed.toFixed(1)}ms${C.r}`);

  // Execute N causes
  for (const N of [1000, 10000, 50000]) {
    const execStart = performance.now();
    for (let i = 0; i < N; i++) exports.onCause!(0);
    const execElapsed = performance.now() - execStart;
    console.log(`  ${C.green}${fmt(N)}${C.r} onCause calls: ${C.cyan}${execElapsed.toFixed(1)}ms${C.r} = ${C.b}${fmt(Math.floor(N / execElapsed * 1000))}/sec${C.r}`);
  }

  // Mutation
  const spec = defaultSpec();
  const mutStart = performance.now();
  for (let i = 0; i < 10; i++) {
    await mutator.mutateThreshold(spec, 50 + i);
  }
  const mutElapsed = performance.now() - mutStart;
  console.log(`  10 mutations: ${C.cyan}${mutElapsed.toFixed(0)}ms${C.r}  (${(mutElapsed / 10).toFixed(1)}ms avg)`);
}

async function benchCryptoOps(): Promise<void> {
  console.log(`\n  ${C.b}Benchmark 10: Crypto Operations${C.r}`);
  console.log(`  ${C.d}────────────────────────────────────────${C.r}`);

  const { sign, verify, generateKeypair: genKp, hash32: h32 } = await import('../src/lifeform/crypto');

  // Keypair generation
  const N = 100;
  let kpStart = performance.now();
  for (let i = 0; i < N; i++) genKp();
  let kpElapsed = performance.now() - kpStart;
  console.log(`  ${fmt(N)} keypairs: ${C.cyan}${kpElapsed.toFixed(0)}ms${C.r}  (${(kpElapsed / N).toFixed(2)}ms each)`);

  // Sign
  const kp = genKp();
  const msg = new TextEncoder().encode('benchmark message for signing test');
  const signStart = performance.now();
  let sig: Uint8Array = new Uint8Array(64);
  for (let i = 0; i < N; i++) sig = sign(msg, kp.secretKey);
  const signElapsed = performance.now() - signStart;
  console.log(`  ${fmt(N)} signs: ${C.cyan}${signElapsed.toFixed(0)}ms${C.r}  (${(signElapsed / N).toFixed(2)}ms each)`);

  // Verify
  const verStart = performance.now();
  for (let i = 0; i < N; i++) verify(msg, sig, kp.publicKey);
  const verElapsed = performance.now() - verStart;
  console.log(`  ${fmt(N)} verifies: ${C.cyan}${verElapsed.toFixed(0)}ms${C.r}  (${(verElapsed / N).toFixed(2)}ms each)`);

  // Hash
  const data = new Uint8Array(1024);
  const hashStart = performance.now();
  for (let i = 0; i < 1000; i++) h32(data);
  const hashElapsed = performance.now() - hashStart;
  console.log(`  1,000 hashes (1KB): ${C.cyan}${hashElapsed.toFixed(0)}ms${C.r}  (${(hashElapsed / 1000 * 1000).toFixed(1)}µs each)`);
}

// ═══════════════════════════════════════
// Summary
// ═══════════════════════════════════════

async function main(): Promise<void> {
  console.log(`
  ${C.b}CMP v1.4 — Performance Benchmarks${C.r}
  ${C.d}Agent Viscro — ${new Date().toISOString().split('T')[0]}${C.r}
  ${C.d}Node.js ${process.version} / ${process.platform} ${process.arch}${C.r}
  ${C.d}────────────────────────────────────────${C.r}`);

  const totalStart = performance.now();

  await benchCausesPerSecond();
  await benchMaxLifeforms();
  await benchCrdtMerge();
  await benchSnapshotSize();
  await benchDeltaExtraction();
  await benchFusionExecution();
  await benchCauseQueue();
  await benchIntentVerification();
  await benchWasmCompileExecute();
  await benchCryptoOps();

  const totalElapsed = performance.now() - totalStart;

  console.log(`
  ${C.b}────────────────────────────────────────${C.r}
  ${C.b}Total benchmark time: ${C.cyan}${(totalElapsed / 1000).toFixed(1)}s${C.r}
  ${C.d}Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB heap used${C.r}
`);

  process.exit(0);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

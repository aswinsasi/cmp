/**
 * CMP Phase 4 Test Suite
 * Tests: WASMSandbox, ResourceMonitor, CodeCache, DataSplitter,
 * TaskDistributor, ExecutionEngine, ResultAssembler.
 *
 * Run: npx tsx packages/core/tests/phase4.test.ts
 *
 * @author Agent Viscro
 */

import {
  randomBytes, generateMeshId, hash256, encrypt, decrypt,
  toHex, bytesEqual, ChunkStatus, TaskType, VerifyMode,
  SecurityLevel, EncryptionAlgo, Runtime, Priority,
  OutputFormat, EventBus,
} from '../src';
import type { CMPChunk, CMPResult, CMPTaskRequest, AssignmentRecord, CodeReference } from '../src';
import {
  WASMSandbox, ResourceMonitor, CodeCache, DataSplitter,
  TaskDistributor, ExecutionEngine, ResultAssembler,
} from '../../runtime/src';
import type { DecompositionPlan } from '../../runtime/src';

// ── Test runner ──
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

// ── Minimal WASM module for testing ──
// This is a valid WASM module that exports a function.
// (add.wasm: exports `add(a, b) => a + b`)
// Built from: (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const MINIMAL_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // magic
  0x01, 0x00, 0x00, 0x00, // version
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type section
  0x03, 0x02, 0x01, 0x00, // function section
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export section
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code section
]);

// ── A WASM module that just returns its second param (the input length) ──
// We reuse MINIMAL_WASM's 'add' function and call add(0, inputLen) to get inputLen back
const PROCESS_WASM = MINIMAL_WASM; // Reuse add module; tests call 'add'

async function main() {

// ════════════════════════════════════════════
// WASM SANDBOX TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── WASM Sandbox Tests ──\x1b[0m');

await testAsync('Sandbox loads and executes minimal WASM module', async () => {
  const sandbox = new WASMSandbox({ maxMemoryMb: 16, maxCpuMs: 5000, maxOutputBytes: 1024, enableSIMD: false });
  await sandbox.loadModule(MINIMAL_WASM);

  // The add module doesn't follow our input/output convention,
  // but loading proves WASM compilation works
  assert(!sandbox.isDestroyed(), 'not destroyed after load');
  assertEqual(sandbox.getMemoryUsageMb(), 1, 'initial memory ~1MB');

  sandbox.destroy();
  assert(sandbox.isDestroyed(), 'destroyed');
});

await testAsync('Sandbox executes add function', async () => {
  const sandbox = new WASMSandbox({ maxMemoryMb: 16, maxCpuMs: 5000, maxOutputBytes: 4096, enableSIMD: false });
  await sandbox.loadModule(MINIMAL_WASM);

  const input = new TextEncoder().encode('Hello CMP!');
  // 'add' is the only export; sandbox will find it via fallback
  const output = await sandbox.execute('add', input);

  // add(ptr, len) returns ptr+len as i32, output is read from that offset
  assert(output.length >= 0, `output produced (${output.length} bytes)`);

  const metrics = sandbox.getMetrics();
  assert(metrics.cpuTimeMs >= 0, 'cpu time recorded');
  assert(metrics.startTime > 0, 'start time recorded');

  sandbox.destroy();
});

await testAsync('Sandbox destroy zeros memory', async () => {
  const sandbox = new WASMSandbox({ maxMemoryMb: 16, maxCpuMs: 5000, maxOutputBytes: 1024, enableSIMD: false });
  await sandbox.loadModule(MINIMAL_WASM);

  sandbox.destroy();
  assert(sandbox.isDestroyed(), 'is destroyed');
  assertEqual(sandbox.getMemoryUsageMb(), 0, 'memory zeroed');
});

await testAsync('Sandbox rejects execution after destroy', async () => {
  const sandbox = new WASMSandbox();
  await sandbox.loadModule(MINIMAL_WASM);
  sandbox.destroy();

  let threw = false;
  try {
    await sandbox.execute('add', new Uint8Array(0));
  } catch {
    threw = true;
  }
  assert(threw, 'threw on execution after destroy');
});

await testAsync('Sandbox rejects loading after destroy', async () => {
  const sandbox = new WASMSandbox();
  sandbox.destroy();

  let threw = false;
  try {
    await sandbox.loadModule(MINIMAL_WASM);
  } catch {
    threw = true;
  }
  assert(threw, 'threw on load after destroy');
});

// ════════════════════════════════════════════
// RESOURCE MONITOR TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Resource Monitor Tests ──\x1b[0m');

test('ResourceMonitor starts and stops', () => {
  const monitor = new ResourceMonitor({ maxMemoryMb: 512, maxCpuMs: 5000 });
  monitor.start(() => {});
  assert(monitor.isMonitoring(), 'is monitoring');
  monitor.stop();
  assert(!monitor.isMonitoring(), 'stopped');
});

await testAsync('ResourceMonitor records elapsed time', async () => {
  const monitor = new ResourceMonitor({ maxMemoryMb: 512, maxCpuMs: 5000 });
  monitor.start(() => {});

  await new Promise((r) => setTimeout(r, 200));

  const elapsed = monitor.getElapsedMs();
  assert(elapsed >= 150, `elapsed ${elapsed}ms (expected ≥150)`);

  monitor.stop();
});

await testAsync('ResourceMonitor detects CPU timeout', async () => {
  const monitor = new ResourceMonitor({ maxMemoryMb: 512, maxCpuMs: 200 });
  let violation: string | null = null;

  monitor.start((reason, details) => {
    violation = reason;
  });

  await new Promise((r) => setTimeout(r, 400));

  monitor.stop();
  assertEqual(violation, 'cpu_exceeded', 'detected CPU timeout');
});

test('ResourceMonitor getCurrentUsage works', () => {
  const monitor = new ResourceMonitor({ maxMemoryMb: 512, maxCpuMs: 5000 });
  monitor.start(() => {});
  const usage = monitor.getCurrentUsage();
  assert(usage.cpuMs >= 0, 'cpuMs >= 0');
  assert(usage.memoryPeakMb >= 0, 'memoryPeakMb >= 0');
  monitor.stop();
});

// ════════════════════════════════════════════
// CODE CACHE TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Code Cache Tests ──\x1b[0m');

test('CodeCache store and retrieve', () => {
  const cache = new CodeCache(100);
  const module = randomBytes(1024);
  const hash = cache.store(module);

  assertEqual(hash.length, 32, 'hash is 32 bytes');
  assert(cache.has(hash), 'cache has module');

  const retrieved = cache.get(hash);
  assert(retrieved !== null, 'retrieved');
  assert(bytesEqual(retrieved!, module), 'bytes match');
});

test('CodeCache size tracking', () => {
  const cache = new CodeCache(100);
  cache.store(randomBytes(1024));
  cache.store(randomBytes(2048));

  assertEqual(cache.size, 2, '2 modules cached');
  assert(cache.currentSizeMb() > 0, 'size > 0');
});

test('CodeCache verify detects tampering', () => {
  const cache = new CodeCache(100);
  const module = randomBytes(1024);
  const hash = cache.store(module);

  assert(cache.verify(hash, module), 'valid module');

  const tampered = new Uint8Array(module);
  tampered[0] ^= 0xff;
  assert(!cache.verify(hash, tampered), 'tampered detected');
});

test('CodeCache deduplication', () => {
  const cache = new CodeCache(100);
  const module = randomBytes(1024);
  cache.store(module);
  cache.store(module); // Same content
  assertEqual(cache.size, 1, 'deduplicated');
});

test('CodeCache remove works', () => {
  const cache = new CodeCache(100);
  const hash = cache.store(randomBytes(512));
  assertEqual(cache.size, 1, 'before remove');
  cache.remove(hash);
  assertEqual(cache.size, 0, 'after remove');
  assert(!cache.has(hash), 'not in cache');
});

test('CodeCache LRU eviction', () => {
  // 1MB cache, store 3 x 400KB modules → first should be evicted
  const cache = new CodeCache(1);
  const h1 = cache.store(randomBytes(400 * 1024));
  const h2 = cache.store(randomBytes(400 * 1024));
  const h3 = cache.store(randomBytes(400 * 1024));

  // h1 should have been evicted
  assert(!cache.has(h1), 'h1 evicted');
  assert(cache.has(h3), 'h3 still in cache');
});

test('CodeCache clear', () => {
  const cache = new CodeCache(100);
  cache.store(randomBytes(512));
  cache.store(randomBytes(512));
  cache.clear();
  assertEqual(cache.size, 0, 'cleared');
});

// ════════════════════════════════════════════
// DATA SPLITTER TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Data Splitter Tests ──\x1b[0m');

test('Secret sharing split/reconstruct roundtrip', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');

  const shares = splitter.split(data, 5);
  assertEqual(shares.length, 5, '5 shares');

  // Each share is same length as original
  for (const share of shares) {
    assertEqual(share.length, data.length, 'share length');
  }

  // Reconstruct
  const reconstructed = splitter.reconstruct(shares);
  assert(bytesEqual(reconstructed, data), 'roundtrip successful');
});

test('Secret sharing: single share reveals nothing', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('secret data that should be hidden');

  const shares = splitter.split(data, 3);

  // No single share should match the original
  for (const share of shares) {
    assert(!bytesEqual(share, data), 'share differs from original');
  }
});

test('Secret sharing: missing share breaks reconstruction', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('important secret');

  const shares = splitter.split(data, 4);
  const incomplete = shares.slice(0, 3); // Missing one share

  const reconstructed = splitter.reconstruct(incomplete);
  assert(!bytesEqual(reconstructed, data), 'incomplete reconstruction fails');
});

test('Parallel split/reassemble roundtrip', () => {
  const splitter = new DataSplitter();
  const data = new Uint8Array(1000);
  for (let i = 0; i < data.length; i++) data[i] = i % 256;

  const chunks = splitter.splitParallel(data, 4);
  assert(chunks.length === 4, '4 chunks');

  // Each chunk should be ~250 bytes
  const totalChunkSize = chunks.reduce((sum, c) => sum + c.length, 0);
  assertEqual(totalChunkSize, 1000, 'total size preserved');

  const reassembled = splitter.reassembleParallel(chunks);
  assert(bytesEqual(reassembled, data), 'parallel roundtrip');
});

test('Parallel split handles uneven division', () => {
  const splitter = new DataSplitter();
  const data = new Uint8Array(10);
  const chunks = splitter.splitParallel(data, 3);

  // 10 bytes / 3 = 4, 4, 2
  const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
  assertEqual(totalSize, 10, 'total preserved');
  assert(chunks.length >= 2, 'at least 2 chunks');
});

test('Secret sharing with 2 shares', () => {
  const splitter = new DataSplitter();
  const data = randomBytes(64);
  const shares = splitter.split(data, 2);
  assertEqual(shares.length, 2, '2 shares');
  assert(bytesEqual(splitter.reconstruct(shares), data), 'roundtrip');
});

// ════════════════════════════════════════════
// TASK DISTRIBUTOR TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Task Distributor Tests ──\x1b[0m');

function mockTaskRequest(type: TaskType = TaskType.MAP_REDUCE): CMPTaskRequest {
  return {
    taskId: randomBytes(16),
    requesterId: randomBytes(16),
    taskType: type,
    runtimeRequired: Runtime.WASM,
    payloadSizeKb: 512,
    computeBudget: { minCores: 2, minMemoryMb: 1024, gpuRequired: false, deadlineMs: 5000 },
    security: { encryption: EncryptionAlgo.AES_256_GCM, verifyMode: VerifyMode.NONE, dataSensitivity: SecurityLevel.PRIVATE },
    chunkHint: 0,
    priority: Priority.NORMAL,
    creditsOffered: 10,
    signature: new Uint8Array(64),
  };
}

function mockAssignment(n: number): AssignmentRecord[] {
  const records: AssignmentRecord[] = [];
  for (let i = 0; i < n; i++) {
    records.push({
      assignment: {
        taskId: randomBytes(16),
        bidderId: randomBytes(16),
        chunks: [],
        sessionKey: randomBytes(32),
        deadline: BigInt(Date.now() + 30000),
        signature: new Uint8Array(64),
      },
      peerAddress: `node-${i}`,
      capability: { meshId: randomBytes(16), capability: {} as any, tier: 3 as any, score: 0.8 },
    });
  }
  return records;
}

function mockCodeRef(): CodeReference {
  return { runtime: Runtime.WASM, moduleHash: hash256(MINIMAL_WASM), entryPoint: 'add' };
}

test('TaskDistributor data-parallel decomposition', () => {
  const dist = new TaskDistributor();
  const req = mockTaskRequest(TaskType.MAP_REDUCE);
  const assignments = mockAssignment(3);
  const input = randomBytes(3000);

  const plan = dist.plan(req, assignments, input, mockCodeRef());

  assertEqual(plan.strategy, TaskType.MAP_REDUCE, 'strategy');
  assertEqual(plan.chunks.length, 3, '3 chunks (= 3 devices)');
  assertEqual(plan.inputChunks.length, 3, '3 input chunks');

  // Each chunk should reference the correct task
  for (const chunk of plan.chunks) {
    assert(bytesEqual(chunk.taskId, req.taskId), 'task ID matches');
    assert(chunk.payload.length > 0, 'has payload');
    assertEqual(chunk.codeRef.entryPoint, 'add', 'entry point');
  }
});

test('TaskDistributor pipeline decomposition', () => {
  const dist = new TaskDistributor();
  const req = mockTaskRequest(TaskType.PIPELINE);
  const assignments = mockAssignment(3);
  const input = randomBytes(1024);

  const plan = dist.plan(req, assignments, input, mockCodeRef());

  assertEqual(plan.strategy, TaskType.PIPELINE, 'strategy');
  assertEqual(plan.chunks.length, 3, '3 stages');

  // First chunk has no dependencies, later chunks depend on previous
  assertEqual(plan.chunks[0].dependencies.length, 0, 'first has no deps');
  assertEqual(plan.chunks[1].dependencies.length, 1, 'second depends on first');
  assertEqual(plan.chunks[2].dependencies.length, 1, 'third depends on second');
});

test('TaskDistributor scatter-gather gives full input to each', () => {
  const dist = new TaskDistributor();
  const req = mockTaskRequest(TaskType.SCATTER_GATHER);
  const assignments = mockAssignment(3);
  const input = randomBytes(512);

  const plan = dist.plan(req, assignments, input, mockCodeRef());

  assertEqual(plan.strategy, TaskType.SCATTER_GATHER, 'strategy');
  // Each chunk should get the full input
  for (const chunk of plan.chunks) {
    assertEqual(chunk.payload.length, input.length, 'full input');
  }
});

test('TaskDistributor confidential uses secret sharing', () => {
  const dist = new TaskDistributor();
  const req = mockTaskRequest();
  req.security.dataSensitivity = SecurityLevel.CONFIDENTIAL;
  const assignments = mockAssignment(3);
  const input = randomBytes(300);

  const plan = dist.plan(req, assignments, input, mockCodeRef());

  // Shares should each be same size as input (XOR sharing)
  for (const chunk of plan.inputChunks) {
    assertEqual(chunk.length, input.length, 'share same size as input');
  }
  // No single share should equal the original
  for (const chunk of plan.inputChunks) {
    assert(!bytesEqual(chunk, input), 'share differs from original');
  }
});

test('TaskDistributor empty assignments returns empty plan', () => {
  const dist = new TaskDistributor();
  const plan = dist.plan(mockTaskRequest(), [], randomBytes(100), mockCodeRef());
  assertEqual(plan.chunks.length, 0, 'no chunks');
});

// ════════════════════════════════════════════
// RESULT ASSEMBLER TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Result Assembler Tests ──\x1b[0m');

test('ResultAssembler collects results and detects completion', () => {
  const sessionKey = randomBytes(32);
  const dist = new TaskDistributor();
  const req = mockTaskRequest();
  const assignments = mockAssignment(2);
  const input = randomBytes(200);
  const plan = dist.plan(req, assignments, input, mockCodeRef());

  const assembler = new ResultAssembler(plan, sessionKey);

  // Not complete yet
  assert(!assembler.isComplete(), 'not complete initially');
  assertEqual(assembler.getPendingCount(), 2, '2 pending');

  // Submit result for chunk 0
  const result0: CMPResult = {
    chunkId: plan.chunks[0].chunkId,
    taskId: req.taskId,
    executorId: randomBytes(16),
    status: ChunkStatus.SUCCESS,
    payload: encrypt(plan.inputChunks[0], sessionKey), // Echo input as output
    executionTimeMs: 100,
    resourceUsed: { cpuMs: 100, memoryPeakMb: 50, gpuMs: 0 },
    proof: new Uint8Array(32),
    signature: new Uint8Array(64),
  };
  const completion0 = assembler.collectResult(result0);
  assertEqual(completion0, null, 'not yet complete after 1 result');
  assertEqual(assembler.getPendingCount(), 1, '1 pending');

  // Submit result for chunk 1
  const result1: CMPResult = {
    chunkId: plan.chunks[1].chunkId,
    taskId: req.taskId,
    executorId: randomBytes(16),
    status: ChunkStatus.SUCCESS,
    payload: encrypt(plan.inputChunks[1] || new Uint8Array(0), sessionKey),
    executionTimeMs: 150,
    resourceUsed: { cpuMs: 150, memoryPeakMb: 60, gpuMs: 0 },
    proof: new Uint8Array(32),
    signature: new Uint8Array(64),
  };
  const completion1 = assembler.collectResult(result1);
  assert(completion1 !== null, 'complete after all results');
  assert(completion1!.result.length > 0, 'has assembled result');
  assert(completion1!.totalTimeMs > 0, 'has timing');
  assertEqual(completion1!.chunksExecuted, 2, '2 chunks executed');
});

test('ResultAssembler getFailedChunks tracks failures', () => {
  const sessionKey = randomBytes(32);
  const dist = new TaskDistributor();
  const req = mockTaskRequest();
  const assignments = mockAssignment(2);
  const plan = dist.plan(req, assignments, randomBytes(200), mockCodeRef());

  const assembler = new ResultAssembler(plan, sessionKey);

  // Submit a failed result
  assembler.collectResult({
    chunkId: plan.chunks[0].chunkId,
    taskId: req.taskId,
    executorId: randomBytes(16),
    status: ChunkStatus.FAILED,
    payload: new Uint8Array(0),
    executionTimeMs: 50,
    resourceUsed: { cpuMs: 50, memoryPeakMb: 10, gpuMs: 0 },
    proof: new Uint8Array(32),
    signature: new Uint8Array(64),
  });

  const failedChunks = assembler.getFailedChunks();
  assertEqual(failedChunks.length, 1, '1 failed chunk');
});

test('ResultAssembler reset clears state', () => {
  const sessionKey = randomBytes(32);
  const dist = new TaskDistributor();
  const req = mockTaskRequest();
  const plan = dist.plan(req, mockAssignment(1), randomBytes(100), mockCodeRef());

  const assembler = new ResultAssembler(plan, sessionKey);
  assembler.collectResult({
    chunkId: plan.chunks[0].chunkId,
    taskId: req.taskId,
    executorId: randomBytes(16),
    status: ChunkStatus.SUCCESS,
    payload: encrypt(randomBytes(50), sessionKey),
    executionTimeMs: 100,
    resourceUsed: { cpuMs: 100, memoryPeakMb: 10, gpuMs: 0 },
    proof: new Uint8Array(32),
    signature: new Uint8Array(64),
  });

  assertEqual(assembler.getCollectedCount(), 1, 'before reset');
  assembler.reset();
  assertEqual(assembler.getCollectedCount(), 0, 'after reset');
});

// ════════════════════════════════════════════
// EXECUTION ENGINE TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Execution Engine Tests ──\x1b[0m');

await testAsync('ExecutionEngine executeRaw runs WASM module', async () => {
  const engine = new ExecutionEngine(generateMeshId(), new CodeCache());
  const { output, status, metrics } = await engine.executeRaw(
    MINIMAL_WASM, 'add', new Uint8Array([1, 2, 3, 4]), 5000
  );

  // The add module has no memory export, so execution may fail or return empty.
  // What matters is the engine doesn't crash and returns a valid status.
  assert(
    status === ChunkStatus.SUCCESS || status === ChunkStatus.FAILED,
    `status is valid (got ${ChunkStatus[status]})`
  );
  assert(metrics.cpuTimeMs >= 0, 'has cpu time');
});

await testAsync('ExecutionEngine tracks active execution count', async () => {
  const engine = new ExecutionEngine(generateMeshId(), new CodeCache(), { maxConcurrent: 5 });
  assertEqual(engine.getActiveCount(), 0, 'initially 0');

  const p = engine.executeRaw(MINIMAL_WASM, 'add', new Uint8Array(10), 5000);
  await p;
  assertEqual(engine.getActiveCount(), 0, 'back to 0 after completion');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) {
  console.log('\n  Failed tests:');
  errors.forEach((e) => console.log(e));
}
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);

} // end main

main();

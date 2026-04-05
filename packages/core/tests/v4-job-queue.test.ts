/**
 * CMP v4.0 — Phase 2: Job Queue Tests
 *
 * 32 tests covering:
 *   - Job lifecycle: submit → queue → assign → run → complete
 *   - Priority ordering (CRITICAL > HIGH > NORMAL > LOW)
 *   - Auto-retry on failure (up to maxRetries)
 *   - Manual retry of failed/cancelled jobs
 *   - Cancel running/queued jobs
 *   - Job result persistence via V3StateStore
 *   - Background job survives node restart
 *   - Concurrent job limits
 *   - Job executor integration
 *   - Job announcer wire protocol
 *   - Stats and filtering
 *
 * Run: npx tsx packages/core/tests/v4-job-queue.test.ts
 *
 * @author Agent Viscro
 */

import fs from 'fs';
import path from 'path';

import { V3StateStore } from '../src/persistence/v3-state-store';
import { JobQueue } from '../src/scheduler/job-queue';
import { JobExecutor, ComputeFn } from '../src/scheduler/job-executor';
import { JobAnnouncer } from '../src/scheduler/job-announcer';
import {
  Job, JobState, JobResult, JobDefinition,
  JobMessageType, JobAnnounceWire, JobClaimWire,
  TERMINAL_STATES, ACTIVE_STATES,
} from '../src/scheduler/job-types';
import { Priority, TaskType } from '../src/types/task';

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

// ─── Test Helpers ───

const TEST_DIR = '/tmp/cmp-v4-job-test';
const TEST_DB = path.join(TEST_DIR, 'job-test.db');

function cleanup(): void {
  try { if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); } catch {}
  try { if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
}

/** Simple WASM-like module bytes (not real WASM, just for testing) */
const MOCK_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6D, 1, 0, 0, 0]); // \0asm magic

function mockDefinition(input: string = 'test-input'): JobDefinition {
  return {
    wasmModule: MOCK_WASM,
    inputData: new TextEncoder().encode(input),
    entryPoint: 'process',
    taskType: TaskType.MAP_REDUCE,
    deadlineMs: 5000,
    chunkHint: 0,
  };
}

function mockResult(data: string = 'result'): JobResult {
  return {
    data: new TextEncoder().encode(data),
    totalTimeMs: 100,
    chunksExecuted: 2,
    devicesUsed: 1,
    verified: true,
    localFallback: false,
  };
}

/** Mock compute function that succeeds after a delay */
function successCompute(delayMs: number = 10): ComputeFn {
  return async (wasm, input, opts) => {
    await new Promise(r => setTimeout(r, delayMs));
    return {
      data: new Uint8Array([...input, 0xFF]),
      totalTimeMs: delayMs,
      chunksExecuted: 1,
      devicesUsed: 1,
      verified: true,
      localFallback: false,
    };
  };
}

/** Mock compute function that always fails */
function failCompute(errorMsg: string = 'compute failed'): ComputeFn {
  return async () => {
    throw new Error(errorMsg);
  };
}

// ─── Main ───

async function main() {

cleanup();

// ════════════════════════════════════════════
// Job Queue — Basic Lifecycle
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Queue: Basic Lifecycle ──\x1b[0m');

let queue = new JobQueue(null);

test('1. submit creates a QUEUED job', () => {
  const job = queue.submit(mockDefinition('hello'));
  assertEqual(job.id, 1, 'id=1');
  assertEqual(job.state, JobState.QUEUED, 'state=QUEUED');
  assertEqual(job.priority, Priority.NORMAL, 'priority=NORMAL');
  assert(!job.background, 'not background');
  assertEqual(job.retryCount, 0, 'retryCount=0');
  assertEqual(job.error, null, 'no error');
  assertEqual(job.result, null, 'no result');
});

test('2. full lifecycle: submit → assign → start → complete', () => {
  const job = queue.submit(mockDefinition('lifecycle'));
  assertEqual(job.state, JobState.QUEUED, 'starts QUEUED');

  assert(queue.assign(job.id, 'device-A'), 'assign ok');
  assertEqual(queue.get(job.id)!.state, JobState.ASSIGNED, 'ASSIGNED');
  assertEqual(queue.get(job.id)!.claimedBy, 'device-A', 'claimed by A');

  assert(queue.start(job.id), 'start ok');
  assertEqual(queue.get(job.id)!.state, JobState.RUNNING, 'RUNNING');

  const result = mockResult('output');
  assert(queue.complete(job.id, result), 'complete ok');
  assertEqual(queue.get(job.id)!.state, JobState.COMPLETED, 'COMPLETED');
  assert(queue.get(job.id)!.result !== null, 'has result');
  assert(queue.get(job.id)!.completedAt !== null, 'has completedAt');
});

test('3. cancel a queued job', () => {
  const job = queue.submit(mockDefinition('cancel-me'));
  assert(queue.cancel(job.id), 'cancel ok');
  assertEqual(queue.get(job.id)!.state, JobState.CANCELLED, 'CANCELLED');
});

test('4. cancel a running job', () => {
  const job = queue.submit(mockDefinition('cancel-running'));
  queue.start(job.id);
  assertEqual(queue.get(job.id)!.state, JobState.RUNNING, 'RUNNING');
  assert(queue.cancel(job.id), 'cancel ok');
  assertEqual(queue.get(job.id)!.state, JobState.CANCELLED, 'CANCELLED');
});

test('5. cannot cancel completed job', () => {
  const job = queue.submit(mockDefinition());
  queue.start(job.id);
  queue.complete(job.id, mockResult());
  assert(!queue.cancel(job.id), 'cannot cancel completed');
});

test('6. get returns null for nonexistent', () => {
  assertEqual(queue.get(9999), null, 'null for missing');
});

// ════════════════════════════════════════════
// Priority & Ordering
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Queue: Priority & Ordering ──\x1b[0m');

queue = new JobQueue(null);

test('7. priority ordering: CRITICAL first', () => {
  queue.submit(mockDefinition('low'), { priority: Priority.LOW });
  queue.submit(mockDefinition('high'), { priority: Priority.HIGH });
  queue.submit(mockDefinition('critical'), { priority: Priority.CRITICAL });
  queue.submit(mockDefinition('normal'), { priority: Priority.NORMAL });

  const listed = queue.list();
  assertEqual(listed[0].priority, Priority.CRITICAL, 'first=CRITICAL');
  assertEqual(listed[1].priority, Priority.HIGH, 'second=HIGH');
  assertEqual(listed[2].priority, Priority.NORMAL, 'third=NORMAL');
  assertEqual(listed[3].priority, Priority.LOW, 'fourth=LOW');
});

test('8. nextPending returns highest priority', () => {
  const next = queue.nextPending();
  assert(next !== null, 'has pending');
  assertEqual(next!.priority, Priority.CRITICAL, 'CRITICAL first');
});

test('9. same priority ordered by submission time', () => {
  queue.clearAll();
  const j1 = queue.submit(mockDefinition('first'), { priority: Priority.NORMAL });
  const j2 = queue.submit(mockDefinition('second'), { priority: Priority.NORMAL });
  const listed = queue.list();
  assertEqual(listed[0].id, j1.id, 'first submitted = first listed');
});

// ════════════════════════════════════════════
// Auto-Retry
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Queue: Auto-Retry ──\x1b[0m');

queue = new JobQueue(null);

test('10. auto-retry on failure (retries remaining)', () => {
  const job = queue.submit(mockDefinition('retry-me'), { maxRetries: 3 });
  queue.start(job.id);

  assert(queue.fail(job.id, 'timeout'), 'fail ok');
  const updated = queue.get(job.id)!;
  assertEqual(updated.state, JobState.RETRY, 'state=RETRY');
  assertEqual(updated.retryCount, 1, 'retryCount=1');
  assertEqual(updated.error, 'timeout', 'error set');
});

test('11. exhausts retries → FAILED', () => {
  const job = queue.submit(mockDefinition('exhaust'), { maxRetries: 2 });

  // Attempt 1
  queue.start(job.id);
  queue.fail(job.id, 'err1');
  assertEqual(queue.get(job.id)!.state, JobState.RETRY, 'retry after 1st');

  // Attempt 2
  queue.start(job.id);
  queue.fail(job.id, 'err2');
  assertEqual(queue.get(job.id)!.state, JobState.RETRY, 'retry after 2nd');

  // Attempt 3 (final)
  queue.start(job.id);
  queue.fail(job.id, 'err3');
  assertEqual(queue.get(job.id)!.state, JobState.FAILED, 'FAILED after exhaustion');
  assertEqual(queue.get(job.id)!.retryCount, 2, 'retryCount=2');
});

test('12. manual retry of failed job', () => {
  const job = queue.submit(mockDefinition('manual-retry'), { maxRetries: 0 });
  queue.start(job.id);
  queue.fail(job.id, 'error');
  assertEqual(queue.get(job.id)!.state, JobState.FAILED, 'FAILED');

  assert(queue.retry(job.id), 'retry ok');
  assertEqual(queue.get(job.id)!.state, JobState.QUEUED, 'back to QUEUED');
  assertEqual(queue.get(job.id)!.error, null, 'error cleared');
});

test('13. manual retry of cancelled job', () => {
  const job = queue.submit(mockDefinition('cancelled-retry'));
  queue.cancel(job.id);
  assert(queue.retry(job.id), 'retry cancelled ok');
  assertEqual(queue.get(job.id)!.state, JobState.QUEUED, 'back to QUEUED');
});

// ════════════════════════════════════════════
// Filtering & Stats
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Queue: Filtering & Stats ──\x1b[0m');

queue = new JobQueue(null);

test('14. filter by state', () => {
  queue.submit(mockDefinition('a'));
  const j2 = queue.submit(mockDefinition('b'));
  queue.start(j2.id);
  queue.complete(j2.id, mockResult());
  queue.submit(mockDefinition('c'));

  const queued = queue.list({ state: JobState.QUEUED });
  assertEqual(queued.length, 2, '2 queued');

  const completed = queue.list({ state: JobState.COMPLETED });
  assertEqual(completed.length, 1, '1 completed');
});

test('15. filter by priority', () => {
  queue.clearAll();
  queue.submit(mockDefinition('h1'), { priority: Priority.HIGH });
  queue.submit(mockDefinition('n1'), { priority: Priority.NORMAL });
  queue.submit(mockDefinition('h2'), { priority: Priority.HIGH });

  const high = queue.list({ priority: Priority.HIGH });
  assertEqual(high.length, 2, '2 HIGH');
});

test('16. filter by background', () => {
  queue.clearAll();
  queue.submit(mockDefinition('fg'), { background: false });
  queue.submit(mockDefinition('bg'), { background: true });

  const bg = queue.list({ background: true });
  assertEqual(bg.length, 1, '1 background');
});

test('17. filter with limit', () => {
  queue.clearAll();
  for (let i = 0; i < 10; i++) queue.submit(mockDefinition(`j${i}`));
  const limited = queue.list({ limit: 3 });
  assertEqual(limited.length, 3, 'limited to 3');
});

test('18. getStats returns correct counts', () => {
  queue.clearAll();
  queue.submit(mockDefinition('s1'));
  queue.submit(mockDefinition('s2'));
  const j3 = queue.submit(mockDefinition('s3'));
  queue.start(j3.id);
  queue.complete(j3.id, mockResult());
  const j4 = queue.submit(mockDefinition('s4'));
  queue.start(j4.id);

  const stats = queue.getStats();
  assertEqual(stats.total, 4, 'total=4');
  assertEqual(stats.queued, 2, 'queued=2');
  assertEqual(stats.running, 1, 'running=1');
  assertEqual(stats.completed, 1, 'completed=1');
});

// ════════════════════════════════════════════
// Cleanup
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Queue: Cleanup ──\x1b[0m');

test('19. clearCompleted removes terminal jobs', () => {
  queue.clearAll();
  queue.submit(mockDefinition('keep'));
  const j2 = queue.submit(mockDefinition('done'));
  queue.start(j2.id);
  queue.complete(j2.id, mockResult());
  const j3 = queue.submit(mockDefinition('dead'));
  queue.cancel(j3.id);

  const cleared = queue.clearCompleted();
  assertEqual(cleared, 2, 'cleared 2');
  assertEqual(queue.list().length, 1, '1 remaining');
});

test('20. clearAll resets everything', () => {
  queue.submit(mockDefinition('x'));
  queue.submit(mockDefinition('y'));
  queue.clearAll();
  assertEqual(queue.list().length, 0, 'empty');
  assertEqual(queue.getStats().total, 0, 'stats total=0');
});

// ════════════════════════════════════════════
// Events
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Queue: Events ──\x1b[0m');

test('21. events emitted on state transitions', () => {
  queue = new JobQueue(null);
  const events: string[] = [];
  queue.onEvent((e) => events.push(`${e.type}:${e.jobId}`));

  const job = queue.submit(mockDefinition('evented'));
  queue.start(job.id);
  queue.complete(job.id, mockResult());

  assert(events.includes(`queued:${job.id}`), 'queued event');
  assert(events.includes(`started:${job.id}`), 'started event');
  assert(events.includes(`completed:${job.id}`), 'completed event');
});

test('22. unsubscribe stops events', () => {
  const events: string[] = [];
  const unsub = queue.onEvent((e) => events.push(e.type));
  queue.submit(mockDefinition());
  const before = events.length;
  unsub();
  queue.submit(mockDefinition());
  assertEqual(events.length, before, 'no new events after unsub');
});

// ════════════════════════════════════════════
// Persistence
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Queue: Persistence ──\x1b[0m');

cleanup();

await testAsync('23. jobs persist across restart', async () => {
  const store1 = new V3StateStore(TEST_DB);
  await store1.init();

  const q1 = new JobQueue(store1);
  q1.init();

  const j1 = q1.submit(mockDefinition('persistent-bg'), { background: true });
  const j2 = q1.submit(mockDefinition('persistent-done'));
  q1.start(j2.id);
  q1.complete(j2.id, mockResult('saved-result'));

  store1.forceSave();
  store1.close();

  // Reopen
  const store2 = new V3StateStore(TEST_DB);
  await store2.init();

  const q2 = new JobQueue(store2);
  q2.init();

  // Background job should be available
  const restored1 = q2.get(j1.id);
  assert(restored1 !== null, 'bg job found');
  assertEqual(restored1!.state, JobState.QUEUED, 'bg still QUEUED');
  assert(restored1!.background, 'still background');

  // Completed job should have result
  const restored2 = q2.get(j2.id);
  assert(restored2 !== null, 'completed job found');
  assertEqual(restored2!.state, JobState.COMPLETED, 'still COMPLETED');
  assert(restored2!.result !== null, 'has result');
  const resultText = new TextDecoder().decode(restored2!.result!.data);
  assertEqual(resultText, 'saved-result', 'result data intact');

  store2.close();
});

cleanup();

await testAsync('24. running jobs recover to RETRY on restart', async () => {
  const store1 = new V3StateStore(TEST_DB);
  await store1.init();

  const q1 = new JobQueue(store1);
  q1.init();

  const job = q1.submit(mockDefinition('crash-me'), { maxRetries: 3 });
  q1.start(job.id);
  assertEqual(q1.get(job.id)!.state, JobState.RUNNING, 'is RUNNING');

  // Simulate crash — close without completing
  store1.forceSave();
  store1.close();

  // Reopen — init should recover stuck jobs
  const store2 = new V3StateStore(TEST_DB);
  await store2.init();

  const q2 = new JobQueue(store2);
  q2.init();

  const recovered = q2.get(job.id);
  assert(recovered !== null, 'found');
  assertEqual(recovered!.state, JobState.RETRY, 'recovered to RETRY');
  assertEqual(recovered!.retryCount, 1, 'retry count incremented');

  store2.close();
});

cleanup();

await testAsync('25. job IDs persist across restart', async () => {
  const store1 = new V3StateStore(TEST_DB);
  await store1.init();

  const q1 = new JobQueue(store1);
  q1.init();
  q1.submit(mockDefinition('a'));
  q1.submit(mockDefinition('b'));
  q1.submit(mockDefinition('c'));
  // Next ID should be 4
  store1.forceSave();
  store1.close();

  const store2 = new V3StateStore(TEST_DB);
  await store2.init();
  const q2 = new JobQueue(store2);
  q2.init();
  const newJob = q2.submit(mockDefinition('d'));
  assertEqual(newJob.id, 4, 'continues from 4');

  store2.close();
});

cleanup();

// ════════════════════════════════════════════
// Job Executor
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Executor ──\x1b[0m');

await testAsync('26. executor runs queued job to completion', async () => {
  const queue = new JobQueue(null);
  const executor = new JobExecutor(queue, successCompute(10), { pollIntervalMs: 50, deviceId: 'dev1' });

  const job = queue.submit(mockDefinition('exec-me'));

  executor.start();
  // Wait for execution
  await new Promise(r => setTimeout(r, 200));
  executor.stop();

  const finished = queue.get(job.id)!;
  assertEqual(finished.state, JobState.COMPLETED, 'COMPLETED');
  assert(finished.result !== null, 'has result');
  assert(finished.result!.data.length > 0, 'result has data');
});

await testAsync('27. executor handles compute failure → RETRY', async () => {
  const queue = new JobQueue(null);
  const executor = new JobExecutor(queue, failCompute('oops'), { pollIntervalMs: 50, deviceId: 'dev1' });

  const job = queue.submit(mockDefinition('fail-me'), { maxRetries: 2 });

  executor.start();
  await new Promise(r => setTimeout(r, 200));
  executor.stop();

  const state = queue.get(job.id)!.state;
  // Should be either RETRY or FAILED depending on timing
  assert(state === JobState.RETRY || state === JobState.FAILED, `state is ${state}`);
  assert(queue.get(job.id)!.retryCount > 0, 'retried');
});

await testAsync('28. executeNow runs a job synchronously', async () => {
  const queue = new JobQueue(null);
  const executor = new JobExecutor(queue, successCompute(5), { deviceId: 'dev1' });

  const job = queue.submit(mockDefinition('now'));
  const result = await executor.executeNow(job.id);

  assert(result !== null, 'got result');
  assertEqual(queue.get(job.id)!.state, JobState.COMPLETED, 'COMPLETED');
});

await testAsync('29. executor respects maxConcurrent', async () => {
  const queue = new JobQueue(null);
  let running = 0;
  let maxSeen = 0;

  const slowCompute: ComputeFn = async (w, i, o) => {
    running++;
    maxSeen = Math.max(maxSeen, running);
    await new Promise(r => setTimeout(r, 100));
    running--;
    return { data: i, totalTimeMs: 100, chunksExecuted: 1, devicesUsed: 1, verified: true, localFallback: false };
  };

  const executor = new JobExecutor(queue, slowCompute, { pollIntervalMs: 20, maxConcurrent: 2, deviceId: 'dev1' });

  // Submit 5 jobs
  for (let i = 0; i < 5; i++) queue.submit(mockDefinition(`conc-${i}`));

  executor.start();
  await new Promise(r => setTimeout(r, 600));
  executor.stop();

  assert(maxSeen <= 2, `max concurrent was ${maxSeen}, expected <= 2`);
});

// ════════════════════════════════════════════
// Job Announcer
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Job Announcer ──\x1b[0m');

test('30. announcer emits JOB_ANNOUNCE wire messages', () => {
  const queue = new JobQueue(null);
  queue.submit(mockDefinition('announce-me'), { priority: Priority.HIGH });

  const broadcasts: any[] = [];
  const announcer = new JobAnnouncer(queue, { announceIntervalMs: 100000, deviceId: 'node-A' });
  announcer.setTransport(
    (type, payload) => broadcasts.push({ type, payload }),
    () => {},
  );

  // Manually trigger announce
  (announcer as any).announcePendingJobs();

  assertEqual(broadcasts.length, 1, '1 broadcast');
  assertEqual(broadcasts[0].type, JobMessageType.JOB_ANNOUNCE, 'JOB_ANNOUNCE');
  assertEqual(broadcasts[0].payload.priority, Priority.HIGH, 'priority=HIGH');
  assertEqual(broadcasts[0].payload.announcerId, 'node-A', 'announcer ID');
});

test('31. announcer handles JOB_CLAIM → assigns job', () => {
  const queue = new JobQueue(null);
  const job = queue.submit(mockDefinition('claimable'));

  const announcer = new JobAnnouncer(queue, { deviceId: 'node-A' });
  announcer.setTransport(() => {}, () => {});

  // Simulate claim from remote device
  const claim: JobClaimWire = {
    jobId: job.id,
    claimerId: 'node-B',
    estimatedTimeMs: 500,
  };
  announcer.handleMessage(JobMessageType.JOB_CLAIM, claim);

  assertEqual(queue.get(job.id)!.state, JobState.ASSIGNED, 'ASSIGNED');
  assertEqual(queue.get(job.id)!.claimedBy, 'node-B', 'claimed by node-B');
});

test('32. announcer handles JOB_RESULT → completes job', () => {
  const queue = new JobQueue(null);
  const job = queue.submit(mockDefinition('remote-exec'));
  queue.assign(job.id, 'node-B');
  queue.start(job.id);

  const announcer = new JobAnnouncer(queue, { deviceId: 'node-A' });

  const resultWire = {
    jobId: job.id,
    executorId: 'node-B',
    success: true,
    resultHex: '48454c4c4f', // "HELLO"
    totalTimeMs: 200,
    chunksExecuted: 2,
    devicesUsed: 1,
    error: null,
  };
  announcer.handleMessage(JobMessageType.JOB_RESULT, resultWire);

  assertEqual(queue.get(job.id)!.state, JobState.COMPLETED, 'COMPLETED');
  const data = queue.get(job.id)!.result!.data;
  assertEqual(new TextDecoder().decode(data), 'HELLO', 'result data');
});

cleanup();

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 2: Job Queue\x1b[0m`);
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

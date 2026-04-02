/**
 * CMP v1.4 — Phase B Test Suite: Core Lifecycle + CauseQueue + CausalExecutor
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-b.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CauseQueue, EnqueueResult } from '../src/lifeform/cause-queue';
import { CausalExecutor } from '../src/lifeform/causal-executor';
import { LifeformLifecycle } from '../src/lifeform/lifecycle';
import { Cause, CauseType } from '../src/types/causal';
import { LifeformState, LifeformSoul, LifeformConfig } from '../src/types/lifeform';

// ── Helpers ──

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function makeCause(overrides?: Partial<Cause>): Cause {
  return {
    id: overrides?.id ?? randomBytes(16),
    type: overrides?.type ?? CauseType.MESSAGE,
    chainId: overrides?.chainId ?? randomBytes(16),
    chainDepth: overrides?.chainDepth ?? 0,
    maxChainDepth: overrides?.maxChainDepth ?? 64,
    deadlineMs: overrides?.deadlineMs ?? 0,
    sourceId: overrides?.sourceId ?? randomBytes(16),
    sourceType: overrides?.sourceType ?? 'device',
    targetId: overrides?.targetId ?? randomBytes(16),
    payload: overrides?.payload ?? new Uint8Array([1, 2, 3]),
    ccuAttached: overrides?.ccuAttached ?? 0,
    expectsResponse: overrides?.expectsResponse ?? false,
    correlationId: overrides?.correlationId ?? null,
    emittedAt: overrides?.emittedAt ?? Date.now(),
  };
}

function makeSoul(): LifeformSoul {
  return {
    id: randomBytes(16),
    name: `lf-${Math.random().toString(36).substring(2, 8)}`,
    publicKey: randomBytes(32),
    secretKey: randomBytes(64),
    creatorId: randomBytes(16),
    bornAt: Date.now(),
    generation: 0,
    parentId: null,
  };
}

function makeConfig(overrides?: Partial<LifeformConfig>): LifeformConfig {
  return {
    name: overrides?.name ?? 'test-lf',
    wasmModule: overrides?.wasmModule ?? new Uint8Array([0, 0x61, 0x73, 0x6d]),
    initialState: overrides?.initialState ?? {},
    initialCcu: overrides?.initialCcu ?? 100,
    minReplicas: overrides?.minReplicas ?? 1,
    maxReplicas: overrides?.maxReplicas ?? 3,
    autoMigrate: overrides?.autoMigrate ?? true,
    mutationLibraryHash: overrides?.mutationLibraryHash ?? null,
    maxCausesPerSecond: overrides?.maxCausesPerSecond ?? 100,
    maxStateSizeBytes: overrides?.maxStateSizeBytes ?? 1024 * 1024,
  };
}

// ═══════════════════════════════════════
// CauseQueue Tests
// ═══════════════════════════════════════

describe('CauseQueue', () => {
  let queue: CauseQueue;

  beforeEach(() => {
    queue = new CauseQueue({ maxSize: 10, maxCausesPerSecond: 100, maxChainDepth: 64 });
  });

  it('should enqueue and dequeue causes', () => {
    const cause = makeCause();
    assert.equal(queue.enqueue(cause), EnqueueResult.OK);
    assert.equal(queue.size, 1);

    const dequeued = queue.dequeue();
    assert.ok(dequeued);
    assert.equal(queue.size, 0);
  });

  it('should reject when queue is full', () => {
    for (let i = 0; i < 10; i++) {
      assert.equal(queue.enqueue(makeCause()), EnqueueResult.OK);
    }
    assert.equal(queue.enqueue(makeCause()), EnqueueResult.QUEUE_FULL);
  });

  it('should reject expired deadlines', () => {
    const cause = makeCause({ deadlineMs: Date.now() - 1000 }); // Already expired
    assert.equal(queue.enqueue(cause), EnqueueResult.DEADLINE_EXPIRED);
  });

  it('should reject chain depth exceeding max', () => {
    const cause = makeCause({ chainDepth: 100 }); // Exceeds default 64
    assert.equal(queue.enqueue(cause), EnqueueResult.CHAIN_TOO_DEEP);
  });

  it('should prioritize causes with tighter deadlines', () => {
    const now = Date.now();
    queue.enqueue(makeCause({ deadlineMs: now + 5000 })); // 5s deadline
    queue.enqueue(makeCause({ deadlineMs: now + 1000 })); // 1s deadline (tighter)
    queue.enqueue(makeCause({ deadlineMs: now + 3000 })); // 3s deadline

    const first = queue.dequeue()!;
    assert.equal(first.deadlineMs, now + 1000); // Tightest first
  });

  it('should prioritize deadline causes over no-deadline causes', () => {
    const now = Date.now();
    queue.enqueue(makeCause({ deadlineMs: 0, emittedAt: now - 5000 })); // Old, no deadline
    queue.enqueue(makeCause({ deadlineMs: now + 10000 })); // Has deadline

    const first = queue.dequeue()!;
    assert.ok(first.deadlineMs > 0); // Deadline cause first
  });

  it('should drain causes for a specific chain', () => {
    const chainId = randomBytes(16);
    queue.enqueue(makeCause({ chainId }));
    queue.enqueue(makeCause({ chainId }));
    queue.enqueue(makeCause()); // Different chain

    const removed = queue.drainChain(chainId);
    assert.equal(removed, 2);
    assert.equal(queue.size, 1);
  });

  it('should call onReady callback when cause enqueued', () => {
    let called = false;
    queue.onReady(() => { called = true; });
    queue.enqueue(makeCause());
    assert.equal(called, true);
  });

  it('should return null when dequeuing empty queue', () => {
    assert.equal(queue.dequeue(), null);
  });

  it('should track stats', () => {
    queue.enqueue(makeCause());
    queue.enqueue(makeCause({ deadlineMs: Date.now() - 1 })); // Rejected
    queue.dequeue();

    const stats = queue.getStats();
    assert.equal(stats.totalEnqueued, 1);
    assert.equal(stats.totalDequeued, 1);
    assert.equal(stats.totalRejected, 1);
  });
});

// ═══════════════════════════════════════
// CausalExecutor Tests
// ═══════════════════════════════════════

describe('CausalExecutor', () => {
  let executor: CausalExecutor;

  beforeEach(() => {
    executor = new CausalExecutor({ maxChainDepth: 10, maxChainCcu: 50 });
    executor.start();
  });

  it('should execute a cause and return result', async () => {
    executor.setHandler(async (cause) => ({
      stateMutations: 2,
      outgoingCauses: [],
    }));

    const cause = makeCause();
    const result = await executor.executeCause(cause);

    assert.equal(result.success, true);
    assert.equal(result.stateMutations, 2);
    assert.ok(result.ccuCost > 0);
    assert.ok(result.executionTimeMs >= 0);
  });

  it('should fail when executor not running', async () => {
    executor.stop();

    const result = await executor.executeCause(makeCause());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('not running'));
  });

  it('should fail when no handler set', async () => {
    const exec2 = new CausalExecutor();
    exec2.start();

    const result = await exec2.executeCause(makeCause());
    assert.equal(result.success, false);
    exec2.stop();
  });

  it('should track causal chains', async () => {
    executor.setHandler(async () => ({ stateMutations: 0, outgoingCauses: [] }));

    const chainId = randomBytes(16);
    await executor.executeCause(makeCause({ chainId, chainDepth: 0 }));
    await executor.executeCause(makeCause({ chainId, chainDepth: 1 }));
    await executor.executeCause(makeCause({ chainId, chainDepth: 2 }));

    const chain = executor.getChain(chainId);
    assert.ok(chain);
    assert.equal(chain.totalCauses, 3);
    assert.equal(chain.maxDepthReached, 2);
  });

  it('should apply backpressure on chain depth', async () => {
    executor.setHandler(async () => ({ stateMutations: 0, outgoingCauses: [] }));

    const cause = makeCause({ chainDepth: 15 }); // Exceeds max 10
    const result = await executor.executeCause(cause);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Chain depth'));
  });

  it('should reject causes past deadline', async () => {
    executor.setHandler(async () => ({ stateMutations: 0, outgoingCauses: [] }));

    const cause = makeCause({ deadlineMs: Date.now() - 1000 });
    const result = await executor.executeCause(cause);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Deadline'));
  });

  it('should stamp outgoing causes with chain info', async () => {
    const chainId = randomBytes(16);
    const outgoing = makeCause();

    executor.setHandler(async () => ({
      stateMutations: 0,
      outgoingCauses: [outgoing],
    }));

    const result = await executor.executeCause(makeCause({ chainId, chainDepth: 3 }));

    assert.equal(result.success, true);
    assert.equal(result.outgoingCauses.length, 1);
    // Outgoing cause should inherit chain info
    assert.deepEqual(result.outgoingCauses[0].chainId, chainId);
    assert.equal(result.outgoingCauses[0].chainDepth, 4); // Parent depth + 1
  });

  it('should handle handler errors gracefully', async () => {
    executor.setHandler(async () => { throw new Error('Boom!'); });

    const result = await executor.executeCause(makeCause());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Boom'));
  });

  it('should set and fire one-shot timer', async () => {
    const lifeformId = randomBytes(16);
    let timerFired = false;

    executor.onTimer((cause) => {
      timerFired = true;
      assert.equal(cause.type, CauseType.TIMER);
    });

    executor.setTimer(lifeformId, 50, 0, new Uint8Array([42]));
    await sleep(150);

    assert.equal(timerFired, true);
  });

  it('should cancel timer', async () => {
    const lifeformId = randomBytes(16);
    let fireCount = 0;

    executor.onTimer(() => { fireCount++; });

    const timerId = executor.setTimer(lifeformId, 50, 0, new Uint8Array(0));
    executor.cancelTimer(timerId);

    await sleep(150);
    assert.equal(fireCount, 0);
  });

  it('should cancel all timers for a lifeform', () => {
    const lfId = randomBytes(16);
    executor.setTimer(lfId, 1000, 0, new Uint8Array(0));
    executor.setTimer(lfId, 2000, 0, new Uint8Array(0));
    executor.setTimer(randomBytes(16), 3000, 0, new Uint8Array(0));

    const cancelled = executor.cancelAllTimers(lfId);
    assert.equal(cancelled, 2);
  });

  it('should track executor stats', async () => {
    executor.setHandler(async () => ({ stateMutations: 1, outgoingCauses: [] }));

    await executor.executeCause(makeCause());
    await executor.executeCause(makeCause());

    const stats = executor.getStats();
    assert.equal(stats.totalExecuted, 2);
    assert.ok(stats.totalCcuSpent > 0);
  });

  it('should get chain stats', async () => {
    executor.setHandler(async () => ({ stateMutations: 0, outgoingCauses: [] }));

    await executor.executeCause(makeCause());
    await executor.executeCause(makeCause());

    const chainStats = executor.getChainStats();
    assert.ok(chainStats.totalChains >= 1);
    assert.ok(chainStats.activeChains >= 1);
  });
});

// ═══════════════════════════════════════
// LifeformLifecycle Tests
// ═══════════════════════════════════════

describe('LifeformLifecycle', () => {
  let lifecycle: LifeformLifecycle;

  beforeEach(() => {
    lifecycle = new LifeformLifecycle(makeSoul(), makeConfig(), randomBytes(16));
  });

  it('should start in SPAWNING state', () => {
    assert.equal(lifecycle.state, LifeformState.SPAWNING);
  });

  it('should transition SPAWNING → ALIVE', () => {
    assert.equal(lifecycle.transitionTo(LifeformState.ALIVE, 'Boot complete'), true);
    assert.equal(lifecycle.state, LifeformState.ALIVE);
    assert.equal(lifecycle.isProcessable, true);
  });

  it('should reject invalid transitions', () => {
    // SPAWNING → MIGRATING is not allowed
    assert.equal(lifecycle.transitionTo(LifeformState.MIGRATING), false);
    assert.equal(lifecycle.state, LifeformState.SPAWNING);
  });

  it('should handle ALIVE → DEAD transition', () => {
    lifecycle.transitionTo(LifeformState.ALIVE);
    assert.equal(lifecycle.transitionTo(LifeformState.DEAD, 'CCU depleted'), true);
    assert.equal(lifecycle.isDead, true);
  });

  it('should not allow transitions from DEAD', () => {
    lifecycle.transitionTo(LifeformState.ALIVE);
    lifecycle.transitionTo(LifeformState.DEAD);
    assert.equal(lifecycle.transitionTo(LifeformState.ALIVE), false); // Dead is terminal
  });

  it('should track CCU balance', () => {
    assert.equal(lifecycle.ccuBalance, 100); // initialCcu

    lifecycle.earnCcu(50);
    assert.equal(lifecycle.ccuBalance, 150);

    assert.equal(lifecycle.spendCcu(30), true);
    assert.equal(lifecycle.ccuBalance, 120);

    assert.equal(lifecycle.spendCcu(200), false); // Insufficient
    assert.equal(lifecycle.ccuBalance, 120); // Unchanged
  });

  it('should top up CCU', () => {
    lifecycle.topUpCcu(500);
    assert.equal(lifecycle.ccuBalance, 600);
  });

  it('should charge hosting cost', () => {
    const cost = lifecycle.chargeHostingCost(100 * 1024); // 100KB
    assert.ok(cost > 0);
    assert.ok(cost < 1);
    assert.ok(lifecycle.ccuBalance < 100);
  });

  it('should return -1 when hosting cost exceeds balance', () => {
    lifecycle.spendCcu(99.99); // Nearly empty
    const cost = lifecycle.chargeHostingCost(100 * 1024 * 1024); // 100MB — expensive
    assert.equal(cost, -1);
  });

  it('should handle fusion lifecycle', () => {
    lifecycle.transitionTo(LifeformState.ALIVE);

    const compositeId = randomBytes(16);
    const partnerId = randomBytes(16);

    assert.equal(lifecycle.fuse(compositeId, partnerId, 'primary'), true);
    assert.equal(lifecycle.state, LifeformState.FUSED);
    assert.ok(lifecycle.fusionInfo);
    assert.equal(lifecycle.fusionInfo!.role, 'primary');
    assert.equal(lifecycle.isProcessable, true); // FUSED is processable
  });

  it('should handle unfuse (fission)', () => {
    lifecycle.transitionTo(LifeformState.ALIVE);
    lifecycle.fuse(randomBytes(16), randomBytes(16), 'secondary');

    assert.equal(lifecycle.unfuse(), true);
    assert.equal(lifecycle.state, LifeformState.ALIVE);
    assert.equal(lifecycle.fusionInfo, null);
  });

  it('should manage replica hosts', () => {
    const replica1 = randomBytes(16);
    const replica2 = randomBytes(16);

    lifecycle.addReplica(replica1);
    lifecycle.addReplica(replica2);
    assert.equal(lifecycle.replicaCount, 2);

    // Don't add duplicates
    lifecycle.addReplica(replica1);
    assert.equal(lifecycle.replicaCount, 2);

    lifecycle.removeReplica(replica1);
    assert.equal(lifecycle.replicaCount, 1);
  });

  it('should record cause execution and update stats', () => {
    lifecycle.recordCauseExecution(0.05);
    lifecycle.recordCauseExecution(0.03);

    assert.equal(lifecycle.causesProcessed, 2);
    assert.ok(lifecycle.ccuBalance < 100);
  });

  it('should track state transition log', () => {
    lifecycle.transitionTo(LifeformState.ALIVE);
    lifecycle.transitionTo(LifeformState.HIBERNATING);
    lifecycle.transitionTo(LifeformState.ALIVE);

    const transitions = lifecycle.getTransitions();
    assert.equal(transitions.length, 3);
    assert.equal(transitions[0].from, LifeformState.SPAWNING);
    assert.equal(transitions[0].to, LifeformState.ALIVE);
  });

  it('should get full instance', () => {
    lifecycle.transitionTo(LifeformState.ALIVE);
    const inst = lifecycle.getInstance();

    assert.equal(inst.state, LifeformState.ALIVE);
    assert.equal(inst.ccuBalance, 100);
    assert.ok(inst.soul.name);
  });
});

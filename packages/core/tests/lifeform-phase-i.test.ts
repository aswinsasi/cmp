/**
 * CMP v1.4 — Phase I Test Suite: Orchestration Bridge
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-i.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DistributionBridge,
  DistributionResult,
  DistributionStatus,
} from '../src/lifeform/distribution-bridge';
import { TaskType } from '../src/types/task';
import { CauseType } from '../src/types/causal';

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('DistributionBridge', () => {
  let bridge: DistributionBridge;
  let submittedRequests: any[];

  beforeEach(() => {
    bridge = new DistributionBridge();
    submittedRequests = [];
    bridge.onSubmit(async (req) => { submittedRequests.push(req); });
  });

  it('should submit a distribution request', async () => {
    const corrId = await bridge.submit(
      randomBytes(16), 'sensor-1',
      randomBytes(32), new Uint8Array([1, 2, 3]),
      TaskType.MAP_REDUCE, 5000, 1, 10,
    );

    assert.ok(corrId);
    assert.equal(corrId.length, 16);
    assert.equal(submittedRequests.length, 1);
    assert.equal(submittedRequests[0].lifeformName, 'sensor-1');
    assert.equal(submittedRequests[0].taskType, TaskType.MAP_REDUCE);

    const stats = bridge.getStats();
    assert.equal(stats.totalSubmitted, 1);
    assert.equal(stats.pending, 1);
  });

  it('should look up request by correlation ID', async () => {
    const corrId = await bridge.submit(
      randomBytes(16), 'sensor-1',
      randomBytes(32), new Uint8Array([1]),
      TaskType.INFERENCE, 0, 0, 5,
    );

    const req = bridge.getByCorrelation(corrId);
    assert.ok(req);
    assert.equal(req.lifeformName, 'sensor-1');
  });

  it('should handle result and deliver cause to Lifeform', async () => {
    let deliveredCause: any = null;
    bridge.onDeliverResult(async (name, cause) => {
      deliveredCause = { name, cause };
    });

    const corrId = await bridge.submit(
      randomBytes(16), 'processor',
      randomBytes(32), new Uint8Array([10, 20]),
      TaskType.MAP_REDUCE, 0, 0, 10,
    );

    const req = bridge.getByCorrelation(corrId)!;
    const result: DistributionResult = {
      requestId: req.id,
      resultData: new Uint8Array([42, 43, 44]),
      devicesUsed: 3,
      executionTimeMs: 150,
      ccuSpent: 2.5,
      success: true,
    };

    const handled = await bridge.handleResult(result);
    assert.equal(handled, true);
    assert.ok(deliveredCause);
    assert.equal(deliveredCause.name, 'processor');
    assert.equal(deliveredCause.cause.type, CauseType.DISTRIBUTION_RESULT);
    assert.deepEqual(deliveredCause.cause.payload, new Uint8Array([42, 43, 44]));

    const stats = bridge.getStats();
    assert.equal(stats.totalCompleted, 1);
    assert.equal(stats.pending, 0);
  });

  it('should handle failed result', async () => {
    const corrId = await bridge.submit(
      randomBytes(16), 'worker',
      randomBytes(32), new Uint8Array([1]),
      TaskType.PIPELINE, 0, 0, 5,
    );

    const req = bridge.getByCorrelation(corrId)!;
    await bridge.handleResult({
      requestId: req.id,
      resultData: new Uint8Array(0),
      devicesUsed: 0,
      executionTimeMs: 0,
      ccuSpent: 0,
      success: false,
      error: 'No workers available',
    });

    assert.equal(bridge.getStats().totalFailed, 1);
  });

  it('should return false for unknown result requestId', async () => {
    const handled = await bridge.handleResult({
      requestId: randomBytes(16),
      resultData: new Uint8Array(0),
      devicesUsed: 0,
      executionTimeMs: 0,
      ccuSpent: 0,
      success: true,
    });
    assert.equal(handled, false);
  });

  it('should detect timed-out requests', async () => {
    const lfId = randomBytes(16);

    // Submit with a deadline already passed
    const req1 = await bridge.submit(
      lfId, 'timer-test',
      randomBytes(32), new Uint8Array([1]),
      TaskType.MAP_REDUCE, 1, 0, 5, // 1ms deadline
    );

    // Force the deadline to be in the past
    const pending = bridge.getByCorrelation(req1);
    if (pending) (pending as any).deadlineMs = Date.now() - 100;

    const timedOut = bridge.checkTimeouts();
    assert.equal(timedOut, 1);
    assert.equal(bridge.pendingCount, 0);
  });

  it('should get pending requests for a Lifeform', async () => {
    await bridge.submit(randomBytes(16), 'sensor', randomBytes(32), new Uint8Array(0), TaskType.INFERENCE, 0, 0, 5);
    await bridge.submit(randomBytes(16), 'sensor', randomBytes(32), new Uint8Array(0), TaskType.MAP_REDUCE, 0, 0, 5);
    await bridge.submit(randomBytes(16), 'other', randomBytes(32), new Uint8Array(0), TaskType.PIPELINE, 0, 0, 5);

    assert.equal(bridge.getPendingFor('sensor').length, 2);
    assert.equal(bridge.getPendingFor('other').length, 1);
  });

  it('should handle submit without pipeline callback', async () => {
    const bridge2 = new DistributionBridge();
    // No onSubmit set
    const corrId = await bridge2.submit(
      randomBytes(16), 'orphan',
      randomBytes(32), new Uint8Array(0),
      TaskType.MAP_REDUCE, 0, 0, 5,
    );
    assert.ok(corrId);
    assert.equal(bridge2.pendingCount, 1);
  });
});

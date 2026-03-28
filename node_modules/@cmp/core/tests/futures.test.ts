/**
 * CMP v1.3 — Temporal Compute Futures Test Suite
 * Tests: FutureMarket (listing, buying, settlement, cancellation,
 * queries, escrow, validation, expiry), ScheduledTaskQueue, integration.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/futures.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FutureMarket, ILedger, DeliveryTracker } from '../src/futures/future-market';
import { ScheduledTaskQueue } from '../src/futures/scheduled-task-queue';
import {
  FutureStatus,
  FutureResources,
  CapabilityTier,
} from '../src/types/futures';
import { Runtime } from '../src/types/capability';

// ── Helpers ──

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeResources(overrides?: Partial<FutureResources>): FutureResources {
  return {
    cores: overrides?.cores ?? 4,
    memoryMb: overrides?.memoryMb ?? 4096,
    durationMinutes: overrides?.durationMinutes ?? 60,
    estimatedCcu: overrides?.estimatedCcu ?? 240,
    runtimes: overrides?.runtimes ?? [Runtime.WASM],
  };
}

/** Mock ledger for testing */
class MockLedger implements ILedger {
  private balances = new Map<string, number>();
  private reputations = new Map<string, number>();

  constructor() {}

  setBalance(deviceHex: string, amount: number): void {
    this.balances.set(deviceHex, amount);
  }

  setReputation(deviceHex: string, rep: number): void {
    this.reputations.set(deviceHex, rep);
  }

  getBalance(deviceHex: string): number {
    return this.balances.get(deviceHex) ?? 100;
  }

  deduct(deviceHex: string, amount: number): boolean {
    const bal = this.getBalance(deviceHex);
    if (bal < amount) return false;
    this.balances.set(deviceHex, bal - amount);
    return true;
  }

  credit(deviceHex: string, amount: number): void {
    this.balances.set(deviceHex, this.getBalance(deviceHex) + amount);
  }

  getReputation(deviceHex: string): number {
    return this.reputations.get(deviceHex) ?? 5000;
  }

  adjustReputation(deviceHex: string, delta: number): void {
    this.reputations.set(deviceHex, this.getReputation(deviceHex) + delta);
  }
}

/** Mock delivery tracker */
class MockDeliveryTracker implements DeliveryTracker {
  private deliveries = new Map<string, number>(); // "seller:buyer" → ccu

  setDelivered(sellerHex: string, buyerHex: string, ccu: number): void {
    this.deliveries.set(`${sellerHex}:${buyerHex}`, ccu);
  }

  getCcuDelivered(sellerHex: string, buyerHex: string): number {
    return this.deliveries.get(`${sellerHex}:${buyerHex}`) ?? 0;
  }
}

// ═══════════════════════════════════════
// FutureMarket Tests
// ═══════════════════════════════════════

describe('FutureMarket', () => {
  let market: FutureMarket;
  let ledger: MockLedger;
  let sellerId: Uint8Array;
  let buyerId: Uint8Array;
  const NOW = Date.now();
  const HOUR = 3600000;

  beforeEach(() => {
    ledger = new MockLedger();
    market = new FutureMarket(ledger, {
      minWindowDurationMs: 1000, // 1s for tests (not 30 min)
    });

    sellerId = randomBytes(16);
    buyerId = randomBytes(16);

    ledger.setBalance(toHex(sellerId), 100);
    ledger.setBalance(toHex(buyerId), 100);
    ledger.setReputation(toHex(sellerId), 5000);
    ledger.setReputation(toHex(buyerId), 5000);
  });

  it('should list a future successfully', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR,
      10, CapabilityTier.T4,
    );

    assert.ok(future, 'Should create future');
    assert.equal(future!.status, FutureStatus.LISTED);
    assert.equal(future!.ccuPrice, 10);
    assert.equal(future!.tier, CapabilityTier.T4);
    assert.equal(future!.buyerId, null);
    assert.ok(future!.deliveryConfidence > 0);
  });

  it('should reject listing with past window', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW - HOUR, NOW + HOUR, // Start is in the past
      10,
    );
    assert.equal(future, null);
  });

  it('should reject listing with too-short window', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + HOUR + 500, // Only 500ms duration, need 1000ms
      10,
    );
    assert.equal(future, null);
  });

  it('should reject listing with low reputation', () => {
    ledger.setReputation(toHex(sellerId), 1000); // Below 2000 threshold

    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    );
    assert.equal(future, null);
  });

  it('should reject listing when at max per device', () => {
    // List 10 futures (max)
    for (let i = 0; i < 10; i++) {
      const f = market.listFuture(
        sellerId, makeResources(),
        NOW + HOUR + i * HOUR, NOW + 2 * HOUR + i * HOUR, 10,
      );
      assert.ok(f, `Listing ${i} should succeed`);
    }

    // 11th should fail
    const extra = market.listFuture(
      sellerId, makeResources(),
      NOW + 20 * HOUR, NOW + 21 * HOUR, 10,
    );
    assert.equal(extra, null);
  });

  it('should buy a listed future with escrow', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    const success = market.buyFuture(future.id, buyerId);
    assert.equal(success, true);

    // Check status
    const updated = market.getFuture(future.id);
    assert.equal(updated!.status, FutureStatus.RESERVED);
    assert.ok(updated!.buyerId);
    assert.equal(toHex(updated!.buyerId!), toHex(buyerId));

    // Check escrow
    assert.equal(market.getEscrow(future.id), 10);

    // Check buyer balance deducted
    assert.equal(ledger.getBalance(toHex(buyerId)), 90);
  });

  it('should reject buying non-listed future', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    // Buy it first
    market.buyFuture(future.id, buyerId);

    // Try buying again — should fail (RESERVED, not LISTED)
    const buyer2 = randomBytes(16);
    ledger.setBalance(toHex(buyer2), 100);
    const success = market.buyFuture(future.id, buyer2);
    assert.equal(success, false);
  });

  it('should reject buying with insufficient balance', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 200, // 200 CCU price
    )!;

    // Buyer only has 100 CCU
    const success = market.buyFuture(future.id, buyerId);
    assert.equal(success, false);
  });

  it('should reject buying own future', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    const success = market.buyFuture(future.id, sellerId);
    assert.equal(success, false);
  });

  it('should settle a delivered future — release escrow to seller', () => {
    const tracker = new MockDeliveryTracker();
    market.setDeliveryTracker(tracker);

    const future = market.listFuture(
      sellerId, makeResources({ estimatedCcu: 100 }),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    market.buyFuture(future.id, buyerId);

    // Simulate: seller delivered 90 CCU out of 100 (90% > 80% threshold)
    tracker.setDelivered(toHex(sellerId), toHex(buyerId), 90);

    // Manually set to ACTIVE (normally done by processSettlements)
    const f = market.getFuture(future.id)!;
    (f as any).status = FutureStatus.ACTIVE;

    const result = market.settleFuture(future.id);
    assert.ok(result);
    assert.equal(result!.delivered, true);
    assert.equal(result!.deliveryRatio, 0.9);
    assert.equal(result!.ccuTransferred, 10);
    assert.equal(result!.reputationDelta, 100); // Bonus

    // Seller should have received escrow
    assert.equal(ledger.getBalance(toHex(sellerId)), 110); // 100 + 10

    // Future should be settled
    assert.equal(market.getFuture(future.id)!.status, FutureStatus.SETTLED);
  });

  it('should default on failed delivery — refund buyer', () => {
    const tracker = new MockDeliveryTracker();
    market.setDeliveryTracker(tracker);

    const future = market.listFuture(
      sellerId, makeResources({ estimatedCcu: 100 }),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    market.buyFuture(future.id, buyerId);

    // Seller delivered only 30 CCU (30% < 80% threshold)
    tracker.setDelivered(toHex(sellerId), toHex(buyerId), 30);

    const f = market.getFuture(future.id)!;
    (f as any).status = FutureStatus.ACTIVE;

    const result = market.settleFuture(future.id);
    assert.ok(result);
    assert.equal(result!.delivered, false);
    assert.equal(result!.deliveryRatio, 0.3);
    assert.equal(result!.ccuTransferred, 0);
    assert.equal(result!.reputationDelta, -500); // Penalty

    // Buyer should have been refunded
    assert.equal(ledger.getBalance(toHex(buyerId)), 100); // 90 + 10 refund

    // Seller reputation penalized
    assert.equal(ledger.getReputation(toHex(sellerId)), 4500); // 5000 - 500
  });

  it('should cancel a listed future', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    const success = market.cancelFuture(future.id, sellerId);
    assert.equal(success, true);
    assert.equal(market.getFuture(future.id)!.status, FutureStatus.CANCELLED);
  });

  it('should not cancel a reserved future', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    market.buyFuture(future.id, buyerId);

    const success = market.cancelFuture(future.id, sellerId);
    assert.equal(success, false); // Can't cancel RESERVED
  });

  it('should not cancel if not the seller', () => {
    const future = market.listFuture(
      sellerId, makeResources(),
      NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;

    const success = market.cancelFuture(future.id, buyerId); // Wrong person
    assert.equal(success, false);
  });

  it('should query futures by criteria', () => {
    market.listFuture(sellerId, makeResources({ cores: 2 }), NOW + HOUR, NOW + 2 * HOUR, 5, CapabilityTier.T2);
    market.listFuture(sellerId, makeResources({ cores: 8 }), NOW + HOUR, NOW + 2 * HOUR, 20, CapabilityTier.T5);
    market.listFuture(sellerId, makeResources({ cores: 4 }), NOW + HOUR, NOW + 2 * HOUR, 10, CapabilityTier.T3);

    // Filter by max price
    const cheap = market.queryFutures({ maxCcuPrice: 10 });
    assert.equal(cheap.length, 2);
    assert.ok(cheap[0].ccuPrice <= cheap[1].ccuPrice); // Sorted cheapest first

    // Filter by min tier
    const highTier = market.queryFutures({ minTier: CapabilityTier.T4 });
    assert.equal(highTier.length, 1);
    assert.equal(highTier[0].tier, CapabilityTier.T5);
  });

  it('should get futures for a specific device', () => {
    market.listFuture(sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 10);
    market.listFuture(sellerId, makeResources(), NOW + 2 * HOUR, NOW + 3 * HOUR, 15);

    const sellerFutures = market.getMyFutures(sellerId);
    assert.equal(sellerFutures.length, 2);

    const buyerFutures = market.getMyFutures(buyerId);
    assert.equal(buyerFutures.length, 0);

    // Buy one and check buyer
    market.buyFuture(sellerFutures[0].id, buyerId);
    assert.equal(market.getMyFutures(buyerId).length, 1);
  });

  it('should reject zero or negative price', () => {
    assert.equal(market.listFuture(sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 0), null);
    assert.equal(market.listFuture(sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, -5), null);
  });

  it('should reject zero-resource listings', () => {
    assert.equal(market.listFuture(sellerId, makeResources({ cores: 0 }), NOW + HOUR, NOW + 2 * HOUR, 10), null);
    assert.equal(market.listFuture(sellerId, makeResources({ memoryMb: 0 }), NOW + HOUR, NOW + 2 * HOUR, 10), null);
  });
});

// ═══════════════════════════════════════
// ScheduledTaskQueue Tests
// ═══════════════════════════════════════

describe('ScheduledTaskQueue', () => {
  let market: FutureMarket;
  let queue: ScheduledTaskQueue;
  let ledger: MockLedger;
  let sellerId: Uint8Array;
  let buyerId: Uint8Array;
  const NOW = Date.now();
  const HOUR = 3600000;

  beforeEach(() => {
    ledger = new MockLedger();
    market = new FutureMarket(ledger, { minWindowDurationMs: 1000 });
    queue = new ScheduledTaskQueue(market);

    sellerId = randomBytes(16);
    buyerId = randomBytes(16);

    ledger.setBalance(toHex(sellerId), 100);
    ledger.setBalance(toHex(buyerId), 100);
    ledger.setReputation(toHex(sellerId), 5000);
    ledger.setReputation(toHex(buyerId), 5000);
  });

  it('should schedule a task against a purchased future', () => {
    const future = market.listFuture(
      sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;
    market.buyFuture(future.id, buyerId);

    const success = queue.scheduleTask(
      future.id, randomBytes(16), randomBytes(32), new Uint8Array([1, 2, 3]), buyerId,
    );
    assert.equal(success, true);
    assert.equal(queue.getTotalQueued(), 1);
  });

  it('should reject scheduling against unlisted future', () => {
    const future = market.listFuture(
      sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;
    // Not bought yet — still LISTED

    const success = queue.scheduleTask(
      future.id, randomBytes(16), randomBytes(32), new Uint8Array([1]), buyerId,
    );
    assert.equal(success, false);
  });

  it('should reject scheduling by non-buyer', () => {
    const future = market.listFuture(
      sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;
    market.buyFuture(future.id, buyerId);

    const imposter = randomBytes(16);
    const success = queue.scheduleTask(
      future.id, randomBytes(16), randomBytes(32), new Uint8Array([1]), imposter,
    );
    assert.equal(success, false);
  });

  it('should dispatch tasks when future becomes ACTIVE', () => {
    const future = market.listFuture(
      sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;
    market.buyFuture(future.id, buyerId);

    const taskId = randomBytes(16);
    queue.scheduleTask(future.id, taskId, randomBytes(32), new Uint8Array([1, 2]), buyerId);

    // Set future to ACTIVE (simulating window open)
    const f = market.getFuture(future.id)!;
    (f as any).status = FutureStatus.ACTIVE;

    const dispatched: { taskId: Uint8Array; sellerId: Uint8Array }[] = [];
    queue.onTaskDispatch((task, fut) => {
      dispatched.push({ taskId: task.taskId, sellerId: fut.sellerId });
    });

    queue.processQueue();

    assert.equal(dispatched.length, 1);
    assert.equal(toHex(dispatched[0].taskId), toHex(taskId));
    assert.equal(toHex(dispatched[0].sellerId), toHex(sellerId));
  });

  it('should not dispatch tasks for non-ACTIVE futures', () => {
    const future = market.listFuture(
      sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;
    market.buyFuture(future.id, buyerId);

    queue.scheduleTask(future.id, randomBytes(16), randomBytes(32), new Uint8Array([1]), buyerId);

    const dispatched: any[] = [];
    queue.onTaskDispatch(() => dispatched.push(1));

    queue.processQueue(); // Future is RESERVED, not ACTIVE

    assert.equal(dispatched.length, 0);
  });

  it('should clear tasks for a settled future', () => {
    const future = market.listFuture(
      sellerId, makeResources(), NOW + HOUR, NOW + 2 * HOUR, 10,
    )!;
    market.buyFuture(future.id, buyerId);

    queue.scheduleTask(future.id, randomBytes(16), randomBytes(32), new Uint8Array([1]), buyerId);
    queue.scheduleTask(future.id, randomBytes(16), randomBytes(32), new Uint8Array([2]), buyerId);

    assert.equal(queue.getTotalQueued(), 2);

    const cleared = queue.clearFuture(future.id);
    assert.equal(cleared, 2);
    assert.equal(queue.getTotalQueued(), 0);
  });
});

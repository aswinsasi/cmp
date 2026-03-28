/**
 * CMP v1.3 — Mesh Morphogenesis Test Suite
 * Tests: AffinityTracker (EMA, specialization, decay), OrganManager
 * (formation, membership, health, dissolution, merge), OrganRouter
 * (organ routing, fallback), MorphogenSignaler (emit, receive, decay),
 * and full integration.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/morphogenesis.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { AffinityTracker } from '../src/morphogenesis/affinity-tracker';
import { OrganManager } from '../src/morphogenesis/organ-manager';
import { OrganRouter } from '../src/morphogenesis/organ-router';
import { MorphogenSignaler } from '../src/morphogenesis/morphogen-signaler';
import { TaskType } from '../src/types/task';
import { OrganEvent } from '../src/types/morphogenesis';

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════
// AffinityTracker Tests
// ═══════════════════════════════════════

describe('AffinityTracker', () => {
  let tracker: AffinityTracker;

  beforeEach(() => {
    tracker = new AffinityTracker({ minSpecializationScore: 0.3 });
  });

  it('should record task completions and build affinity', () => {
    tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
    tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);

    const affinity = tracker.getAffinity('device-a');
    assert.ok(affinity);
    assert.equal(affinity.primaryAffinity, TaskType.MAP_REDUCE);
    assert.ok(affinity.affinities.get(TaskType.MAP_REDUCE)! > 0);
  });

  it('should increase specialization with repeated same-type tasks', () => {
    // 20 MAP_REDUCE tasks → should become specialist
    for (let i = 0; i < 20; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
    }

    const affinity = tracker.getAffinity('device-a');
    assert.ok(affinity);
    assert.ok(affinity.specializationScore > 0.3, `Score ${affinity.specializationScore} should be > 0.3`);
    assert.equal(affinity.primaryAffinity, TaskType.MAP_REDUCE);
  });

  it('should have low specialization for generalists', () => {
    // Mix of task types → should be generalist
    for (let i = 0; i < 5; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
      tracker.recordTaskCompletion('device-a', TaskType.INFERENCE, 0.85);
      tracker.recordTaskCompletion('device-a', TaskType.PIPELINE, 0.85);
    }

    const affinity = tracker.getAffinity('device-a');
    assert.ok(affinity);
    assert.ok(affinity.specializationScore < 0.3, `Generalist score ${affinity.specializationScore} should be < 0.3`);
  });

  it('should decay other affinities when one type dominates', () => {
    // Build up INFERENCE affinity first
    for (let i = 0; i < 5; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.INFERENCE, 0.85);
    }
    const inferenceScore1 = tracker.getAffinity('device-a')!.affinities.get(TaskType.INFERENCE)!;

    // Now do 10 MAP_REDUCE tasks → INFERENCE should decay
    for (let i = 0; i < 10; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
    }

    const inferenceScore2 = tracker.getAffinity('device-a')!.affinities.get(TaskType.INFERENCE)!;
    assert.ok(inferenceScore2 < inferenceScore1, 'INFERENCE affinity should decay');
  });

  it('should get specialists above threshold', () => {
    // Device A: specialist
    for (let i = 0; i < 20; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
    }
    // Device B: generalist
    for (let i = 0; i < 5; i++) {
      tracker.recordTaskCompletion('device-b', TaskType.MAP_REDUCE, 0.85);
      tracker.recordTaskCompletion('device-b', TaskType.INFERENCE, 0.85);
    }

    const specialists = tracker.getSpecialists(0.3);
    const specIds = specialists.map(s => s.deviceId);
    assert.ok(specIds.includes('device-a'), 'Device A should be specialist');
  });

  it('should get specialists for a specific task type', () => {
    for (let i = 0; i < 20; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
      tracker.recordTaskCompletion('device-b', TaskType.INFERENCE, 0.85);
    }

    const mrSpecs = tracker.getSpecialistsForType(TaskType.MAP_REDUCE, 0.3);
    assert.ok(mrSpecs.some(s => s.deviceId === 'device-a'));
    assert.ok(!mrSpecs.some(s => s.deviceId === 'device-b'));
  });

  it('should apply time-based decay', () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
    }

    const before = tracker.getAffinity('device-a')!.affinities.get(TaskType.MAP_REDUCE)!;
    tracker.applyDecay();
    const after = tracker.getAffinity('device-a')!.affinities.get(TaskType.MAP_REDUCE)!;

    assert.ok(after < before, 'Affinity should decrease after decay');
  });

  it('should load from history', () => {
    tracker.loadFromHistory([
      { deviceId: 'dev-1', taskType: TaskType.INFERENCE, successScore: 0.85 },
      { deviceId: 'dev-1', taskType: TaskType.INFERENCE, successScore: 0.90 },
      { deviceId: 'dev-2', taskType: TaskType.MAP_REDUCE, successScore: 0.80 },
    ]);

    assert.equal(tracker.size, 2);
    assert.ok(tracker.getAffinity('dev-1'));
    assert.ok(tracker.getAffinity('dev-2'));
  });
});

// ═══════════════════════════════════════
// OrganManager Tests
// ═══════════════════════════════════════

describe('OrganManager', () => {
  let tracker: AffinityTracker;
  let manager: OrganManager;

  beforeEach(() => {
    tracker = new AffinityTracker({ minSpecializationScore: 0.3 });
    manager = new OrganManager(tracker, { minOrganSize: 3, minSpecializationScore: 0.3, dissolutionThreshold: 0.2, signalIntervalMs: 100000 });
  });

  it('should form organ when enough specialists exist', () => {
    // 3 devices specializing in MAP_REDUCE
    for (const dev of ['dev-a', 'dev-b', 'dev-c']) {
      for (let i = 0; i < 20; i++) {
        tracker.recordTaskCompletion(dev, TaskType.MAP_REDUCE, 0.85);
      }
    }

    const formed = manager.evaluateFormation();
    assert.ok(formed.length > 0, 'Should form an organ');
    assert.equal(formed[0].specialization, TaskType.MAP_REDUCE);
    assert.equal(formed[0].members.size, 3);
  });

  it('should not form organ with fewer than minOrganSize specialists', () => {
    // Only 2 devices (need 3)
    for (const dev of ['dev-a', 'dev-b']) {
      for (let i = 0; i < 20; i++) {
        tracker.recordTaskCompletion(dev, TaskType.MAP_REDUCE, 0.85);
      }
    }

    const formed = manager.evaluateFormation();
    assert.equal(formed.length, 0);
  });

  it('should add new members to existing organ', () => {
    // Form organ with 3 devices
    for (const dev of ['dev-a', 'dev-b', 'dev-c']) {
      for (let i = 0; i < 20; i++) {
        tracker.recordTaskCompletion(dev, TaskType.MAP_REDUCE, 0.85);
      }
    }
    manager.evaluateFormation();

    // New specialist appears
    for (let i = 0; i < 20; i++) {
      tracker.recordTaskCompletion('dev-d', TaskType.MAP_REDUCE, 0.85);
    }
    manager.evaluateFormation();

    const organ = manager.getOrganForType(TaskType.MAP_REDUCE);
    assert.ok(organ);
    assert.ok(organ.members.has('dev-d'), 'New member should be added');
  });

  it('should track task processing and update health', () => {
    const organ = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    const organId = Array.from(organ.id).map(b => b.toString(16).padStart(2, '0')).join('');

    manager.recordTaskProcessed(organId, 100);
    manager.recordTaskProcessed(organId, 80);
    manager.recordTaskProcessed(organId, 120);

    const updated = manager.getOrgan(organId);
    assert.ok(updated);
    assert.equal(updated.tasksProcessed, 3);
    assert.ok(updated.avgProcessingTimeMs > 0);
  });

  it('should allow devices to join and leave organs', () => {
    const organ = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    const organId = Array.from(organ.id).map(b => b.toString(16).padStart(2, '0')).join('');

    assert.equal(manager.joinOrgan(organId, 'dev-d'), true);
    assert.equal(organ.members.size, 4);

    assert.equal(manager.leaveOrgan(organId, 'dev-d'), true);
    assert.equal(organ.members.size, 3);
  });

  it('should dissolve organ when too few members', () => {
    const organ = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    const organId = Array.from(organ.id).map(b => b.toString(16).padStart(2, '0')).join('');

    manager.leaveOrgan(organId, 'dev-a');
    manager.leaveOrgan(organId, 'dev-b');
    // Only 1 member left, below minOrganSize=3 → dissolved

    assert.equal(manager.getOrgan(organId), undefined);
  });

  it('should merge two organs of the same type', () => {
    const org1 = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    const org2 = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-d', 'dev-e']);
    const id1 = Array.from(org1.id).map(b => b.toString(16).padStart(2, '0')).join('');
    const id2 = Array.from(org2.id).map(b => b.toString(16).padStart(2, '0')).join('');

    const merged = manager.mergeOrgans(id1, id2);
    assert.ok(merged);
    assert.equal(merged.members.size, 5);
    assert.equal(manager.organCount, 1); // Only one organ remains
  });

  it('should not merge organs of different types', () => {
    const org1 = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    const org2 = manager.formOrgan(TaskType.INFERENCE, ['dev-d', 'dev-e', 'dev-f']);
    const id1 = Array.from(org1.id).map(b => b.toString(16).padStart(2, '0')).join('');
    const id2 = Array.from(org2.id).map(b => b.toString(16).padStart(2, '0')).join('');

    const merged = manager.mergeOrgans(id1, id2);
    assert.equal(merged, null);
    assert.equal(manager.organCount, 2); // Both still exist
  });

  it('should find organ for a device', () => {
    manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);

    const organ = manager.getDeviceOrgan('dev-b');
    assert.ok(organ);
    assert.equal(organ.specialization, TaskType.MAP_REDUCE);

    assert.equal(manager.getDeviceOrgan('dev-unknown'), undefined);
  });

  it('should log organ events', () => {
    manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);

    const log = manager.getEventLog();
    assert.ok(log.length > 0);
    assert.equal(log[0].event, OrganEvent.FORMING);
  });
});

// ═══════════════════════════════════════
// OrganRouter Tests
// ═══════════════════════════════════════

describe('OrganRouter', () => {
  let tracker: AffinityTracker;
  let manager: OrganManager;
  let router: OrganRouter;

  beforeEach(() => {
    tracker = new AffinityTracker({ minSpecializationScore: 0.3 });
    manager = new OrganManager(tracker, { minOrganSize: 3, minSpecializationScore: 0.3, signalIntervalMs: 100000 });
    router = new OrganRouter(manager, { minHealthForRouting: 0.5, minMembersForRouting: 2 });
  });

  it('should route to organ when healthy organ exists', () => {
    const organ = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);

    const decision = router.route(TaskType.MAP_REDUCE);
    assert.equal(decision.useOrgan, true);
    assert.ok(decision.organ);
    assert.equal(decision.targetDevices.length, 3);
  });

  it('should fall back to mesh-wide when no organ exists', () => {
    const decision = router.route(TaskType.MAP_REDUCE);
    assert.equal(decision.useOrgan, false);
    assert.equal(decision.organ, null);
    assert.equal(decision.targetDevices.length, 0);
  });

  it('should fall back when organ health is too low', () => {
    const organ = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    organ.health = 0.3; // Below minHealthForRouting=0.5

    const decision = router.route(TaskType.MAP_REDUCE);
    assert.equal(decision.useOrgan, false);
    assert.ok(decision.reason.includes('health too low'));
  });

  it('should track routing statistics', () => {
    manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);

    router.route(TaskType.MAP_REDUCE); // organ route
    router.route(TaskType.MAP_REDUCE); // organ route
    router.route(TaskType.INFERENCE);  // mesh route (no organ)

    const stats = router.getStats();
    assert.equal(stats.organRoutes, 2);
    assert.equal(stats.meshRoutes, 1);
    assert.ok(Math.abs(stats.organRouteRatio - 2 / 3) < 0.01);
  });

  it('should reduce organ health on fallback', () => {
    const organ = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    const organId = Array.from(organ.id).map(b => b.toString(16).padStart(2, '0')).join('');
    const healthBefore = organ.health;

    router.recordOrganFallback(organId);

    assert.ok(organ.health < healthBefore, 'Health should decrease on fallback');
  });

  it('should increase organ health on success', () => {
    const organ = manager.formOrgan(TaskType.MAP_REDUCE, ['dev-a', 'dev-b', 'dev-c']);
    const organId = Array.from(organ.id).map(b => b.toString(16).padStart(2, '0')).join('');
    organ.health = 0.8; // Start below max

    router.recordOrganSuccess(organId, 100);

    assert.ok(organ.health > 0.8, 'Health should increase on success');
  });
});

// ═══════════════════════════════════════
// MorphogenSignaler Tests
// ═══════════════════════════════════════

describe('MorphogenSignaler', () => {
  let tracker: AffinityTracker;

  beforeEach(() => {
    tracker = new AffinityTracker({ minSpecializationScore: 0.3 });
  });

  it('should emit signal when device is specialized', () => {
    // Build specialization
    for (let i = 0; i < 20; i++) {
      tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.85);
    }

    const signaler = new MorphogenSignaler('device-a', tracker, { minSpecializationScore: 0.3 });
    const signal = signaler.emitSignal();

    assert.ok(signal, 'Should emit signal');
    assert.equal(signal!.taskType, TaskType.MAP_REDUCE);
    assert.equal(signal!.emitterId, 'device-a');
    assert.ok(signal!.concentration > 0);
    assert.equal(signal!.ttl, 5);
  });

  it('should not emit signal when device is not specialized', () => {
    tracker.recordTaskCompletion('device-a', TaskType.MAP_REDUCE, 0.5);

    const signaler = new MorphogenSignaler('device-a', tracker, { minSpecializationScore: 0.6 });
    const signal = signaler.emitSignal();

    assert.equal(signal, null);
  });

  it('should receive and decay signals per hop', () => {
    const signaler = new MorphogenSignaler('device-b', tracker, { morphogenDecayRate: 0.3 });

    signaler.receiveSignal({
      emitterId: 'device-a',
      taskType: TaskType.MAP_REDUCE,
      concentration: 1.0,
      organId: null,
      ttl: 5,
      emittedAt: Date.now(),
    });

    const concentration = signaler.getConcentration(TaskType.MAP_REDUCE);
    assert.ok(concentration > 0);
    assert.ok(concentration < 1.0, `Concentration ${concentration} should be decayed below 1.0`);
    assert.ok(Math.abs(concentration - 0.7) < 0.01, `Should be ~0.7 after 30% decay`);
  });

  it('should ignore own signals', () => {
    const signaler = new MorphogenSignaler('device-a', tracker);

    signaler.receiveSignal({
      emitterId: 'device-a', // Same as our ID
      taskType: TaskType.MAP_REDUCE,
      concentration: 1.0,
      organId: null,
      ttl: 5,
      emittedAt: Date.now(),
    });

    assert.equal(signaler.getConcentration(TaskType.MAP_REDUCE), 0);
  });

  it('should aggregate concentration from multiple signals', () => {
    const signaler = new MorphogenSignaler('device-c', tracker, { morphogenDecayRate: 0.0 });

    // Two signals for the same task type
    signaler.receiveSignal({
      emitterId: 'device-a',
      taskType: TaskType.MAP_REDUCE,
      concentration: 0.5,
      organId: null,
      ttl: 5,
      emittedAt: Date.now(),
    });
    signaler.receiveSignal({
      emitterId: 'device-b',
      taskType: TaskType.MAP_REDUCE,
      concentration: 0.3,
      organId: null,
      ttl: 5,
      emittedAt: Date.now(),
    });

    const concentration = signaler.getConcentration(TaskType.MAP_REDUCE);
    assert.ok(Math.abs(concentration - 0.8) < 0.01, `Should be ~0.8 (0.5+0.3), got ${concentration}`);
  });

  it('should get strong signals above threshold', () => {
    const signaler = new MorphogenSignaler('device-c', tracker, { morphogenDecayRate: 0.0 });

    signaler.receiveSignal({
      emitterId: 'device-a',
      taskType: TaskType.MAP_REDUCE,
      concentration: 0.8,
      organId: null, ttl: 5, emittedAt: Date.now(),
    });
    signaler.receiveSignal({
      emitterId: 'device-b',
      taskType: TaskType.INFERENCE,
      concentration: 0.2,
      organId: null, ttl: 5, emittedAt: Date.now(),
    });

    const strong = signaler.getStrongSignals(0.5);
    assert.equal(strong.length, 1);
    assert.equal(strong[0].taskType, TaskType.MAP_REDUCE);
  });

  it('should forward signals with decay', () => {
    const signaler = new MorphogenSignaler('device-relay', tracker, { morphogenDecayRate: 0.3 });
    let emittedSignal: any = null;
    signaler.onEmit(s => { emittedSignal = s; });

    const forwarded = signaler.forwardSignal({
      emitterId: 'device-a',
      taskType: TaskType.MAP_REDUCE,
      concentration: 1.0,
      organId: null,
      ttl: 3,
      emittedAt: Date.now(),
    });

    assert.ok(forwarded);
    assert.equal(forwarded!.ttl, 2); // Decremented
    assert.ok(forwarded!.concentration < 1.0); // Decayed
    assert.ok(emittedSignal, 'Should have called emitFn');
  });

  it('should not forward signals with TTL <= 1', () => {
    const signaler = new MorphogenSignaler('device-relay', tracker);

    const forwarded = signaler.forwardSignal({
      emitterId: 'device-a',
      taskType: TaskType.MAP_REDUCE,
      concentration: 0.5,
      organId: null,
      ttl: 1, // Will die
      emittedAt: Date.now(),
    });

    assert.equal(forwarded, null);
  });
});

// ═══════════════════════════════════════
// Integration Tests
// ═══════════════════════════════════════

describe('Morphogenesis — Integration', () => {
  it('should form organ from workload pattern and route tasks through it', () => {
    const tracker = new AffinityTracker({ minSpecializationScore: 0.3 });
    const manager = new OrganManager(tracker, { minOrganSize: 3, minSpecializationScore: 0.3, signalIntervalMs: 100000 });
    const router = new OrganRouter(manager);

    // Simulate 5 devices doing MAP_REDUCE tasks
    for (const dev of ['dev-a', 'dev-b', 'dev-c', 'dev-d', 'dev-e']) {
      for (let i = 0; i < 20; i++) {
        tracker.recordTaskCompletion(dev, TaskType.MAP_REDUCE, 0.85);
      }
    }

    // Trigger organ formation
    const formed = manager.evaluateFormation();
    assert.ok(formed.length > 0, 'Should form organ');
    assert.equal(formed[0].members.size, 5);

    // Route a MAP_REDUCE task → should go through organ
    const decision = router.route(TaskType.MAP_REDUCE);
    assert.equal(decision.useOrgan, true);
    assert.equal(decision.targetDevices.length, 5);

    // Route an INFERENCE task → mesh-wide (no organ)
    const decision2 = router.route(TaskType.INFERENCE);
    assert.equal(decision2.useOrgan, false);
  });

  it('should form separate organs for different task types', () => {
    const tracker = new AffinityTracker({ minSpecializationScore: 0.3 });
    const manager = new OrganManager(tracker, { minOrganSize: 3, minSpecializationScore: 0.3, signalIntervalMs: 100000 });

    // 3 devices doing MAP_REDUCE
    for (const dev of ['mr-1', 'mr-2', 'mr-3']) {
      for (let i = 0; i < 20; i++) {
        tracker.recordTaskCompletion(dev, TaskType.MAP_REDUCE, 0.85);
      }
    }

    // 3 devices doing INFERENCE
    for (const dev of ['inf-1', 'inf-2', 'inf-3']) {
      for (let i = 0; i < 20; i++) {
        tracker.recordTaskCompletion(dev, TaskType.INFERENCE, 0.85);
      }
    }

    const formed = manager.evaluateFormation();
    assert.equal(formed.length, 2, 'Should form two organs');

    const mrOrgan = manager.getOrganForType(TaskType.MAP_REDUCE);
    const infOrgan = manager.getOrganForType(TaskType.INFERENCE);

    assert.ok(mrOrgan, 'MAP_REDUCE organ should exist');
    assert.ok(infOrgan, 'INFERENCE organ should exist');
    assert.equal(mrOrgan!.members.size, 3);
    assert.equal(infOrgan!.members.size, 3);
  });

  it('full signal → formation → routing pipeline', () => {
    const tracker = new AffinityTracker({ minSpecializationScore: 0.3 });
    const manager = new OrganManager(tracker, { minOrganSize: 3, minSpecializationScore: 0.3, signalIntervalMs: 100000 });
    const router = new OrganRouter(manager);

    // Build specialist devices
    const devices = ['alpha', 'beta', 'gamma'];
    for (const dev of devices) {
      for (let i = 0; i < 20; i++) {
        tracker.recordTaskCompletion(dev, TaskType.INFERENCE, 0.85);
      }
    }

    // Create signalers
    const signalers = devices.map(d => new MorphogenSignaler(d, tracker, { minSpecializationScore: 0.3, morphogenDecayRate: 0.0 }));

    // Each device emits a signal
    const signals = signalers.map(s => s.emitSignal()).filter(Boolean);
    assert.equal(signals.length, 3, 'All 3 should emit signals');

    // Each device receives others' signals
    for (const signaler of signalers) {
      for (const signal of signals) {
        if (signal) signaler.receiveSignal(signal);
      }
    }

    // All should see strong concentration for INFERENCE
    for (const signaler of signalers) {
      const conc = signaler.getConcentration(TaskType.INFERENCE);
      assert.ok(conc > 0, `Should have INFERENCE concentration, got ${conc}`);
    }

    // Evaluate organ formation
    const formed = manager.evaluateFormation();
    assert.ok(formed.length > 0, 'Should form INFERENCE organ');

    // Route INFERENCE task → organ
    const decision = router.route(TaskType.INFERENCE);
    assert.equal(decision.useOrgan, true);
    assert.equal(decision.targetDevices.length, 3);

    // Record success → organ health increases
    const organId = Array.from(formed[0].id).map(b => b.toString(16).padStart(2, '0')).join('');
    formed[0].health = 0.8;
    router.recordOrganSuccess(organId, 50);
    assert.ok(formed[0].health > 0.8);
  });
});

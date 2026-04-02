/**
 * CMP v1.4 — Phase A Test Suite: Types + CRDTs
 * Tests: GCounter, PNCounter, LWWRegister, ORSet, MVRegister,
 * CRDTState (get/set, merge, delta, snapshot, partition, fusion merge).
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-a.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GCounter, PNCounter, LWWRegister, ORSet, MVRegister,
  CRDTType, createCRDT, deserializeCRDT,
} from '../src/lifeform/crdt/crdts';
import { CRDTState } from '../src/lifeform/crdt/crdt-state';
import { CauseType } from '../src/types/causal';
import { calculateCauseCost, DEFAULT_CAUSE_BILLING, calculateHostingCost } from '../src/types/causal';
import { LifeformState, LifeformMessageType } from '../src/types/lifeform';
import { FissionTrigger, StateConflictStrategy } from '../src/types/fusion';
import { MutationType, calculateFitness } from '../src/types/evolution';
import { PredicateType, ViolationAction } from '../src/types/intent';

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════
// GCounter Tests
// ═══════════════════════════════════════

describe('GCounter', () => {
  it('should start at zero', () => {
    const c = new GCounter('node-a');
    assert.equal(c.value(), 0);
  });

  it('should increment and return total', () => {
    const c = new GCounter('node-a');
    c.increment(5);
    c.increment(3);
    assert.equal(c.value(), 8);
  });

  it('should reject negative increments', () => {
    const c = new GCounter('node-a');
    assert.throws(() => c.increment(-1));
  });

  it('should merge by taking max per node', () => {
    const a = new GCounter('node-a');
    const b = new GCounter('node-b');

    a.increment(5);
    b.increment(3);

    a.merge(b);
    assert.equal(a.value(), 8); // 5 + 3

    // Merge again — idempotent
    a.merge(b);
    assert.equal(a.value(), 8);
  });

  it('should serialize and deserialize', () => {
    const c = new GCounter('node-a');
    c.increment(42);

    const data = c.serialize();
    const restored = GCounter.deserialize(data);
    assert.equal(restored.value(), 42);
  });
});

// ═══════════════════════════════════════
// PNCounter Tests
// ═══════════════════════════════════════

describe('PNCounter', () => {
  it('should support increment and decrement', () => {
    const c = new PNCounter('node-a');
    c.increment(10);
    c.decrement(3);
    assert.equal(c.value(), 7);
  });

  it('should go negative', () => {
    const c = new PNCounter('node-a');
    c.decrement(5);
    assert.equal(c.value(), -5);
  });

  it('should merge two PNCounters', () => {
    const a = new PNCounter('node-a');
    const b = new PNCounter('node-b');

    a.increment(10);
    a.decrement(3);  // a = 7

    b.increment(5);
    b.decrement(2);  // b = 3

    a.merge(b);
    assert.equal(a.value(), 10); // 10+5 - 3+2 = 10
  });

  it('should serialize and deserialize', () => {
    const c = new PNCounter('node-a');
    c.increment(100);
    c.decrement(30);

    const data = c.serialize();
    const restored = PNCounter.deserialize(data);
    assert.equal(restored.value(), 70);
  });
});

// ═══════════════════════════════════════
// LWWRegister Tests
// ═══════════════════════════════════════

describe('LWWRegister', () => {
  it('should store and retrieve values', () => {
    const r = new LWWRegister<string>('node-a');
    r.set('hello');
    assert.equal(r.value(), 'hello');
  });

  it('should start as null', () => {
    const r = new LWWRegister<string>('node-a');
    assert.equal(r.value(), null);
  });

  it('should merge keeping higher timestamp', async () => {
    const a = new LWWRegister<string>('node-a');
    const b = new LWWRegister<string>('node-b');

    a.set('first');
    await sleep(10);
    b.set('second');

    a.merge(b);
    assert.equal(a.value(), 'second'); // b wrote later
  });

  it('should handle complex values', () => {
    const r = new LWWRegister<{ x: number; y: number }>('node-a');
    r.set({ x: 10, y: 20 });
    assert.deepEqual(r.value(), { x: 10, y: 20 });
  });

  it('should serialize and deserialize', () => {
    const r = new LWWRegister<number>('node-a');
    r.set(42);

    const data = r.serialize();
    const restored = LWWRegister.deserialize<number>(data);
    assert.equal(restored.value(), 42);
  });
});

// ═══════════════════════════════════════
// ORSet Tests
// ═══════════════════════════════════════

describe('ORSet', () => {
  it('should add and check membership', () => {
    const s = new ORSet<string>('node-a');
    s.add('apple');
    s.add('banana');

    assert.equal(s.has('apple'), true);
    assert.equal(s.has('cherry'), false);
    assert.equal(s.size, 2);
  });

  it('should remove elements', () => {
    const s = new ORSet<string>('node-a');
    s.add('apple');
    s.add('banana');
    s.remove('apple');

    assert.equal(s.has('apple'), false);
    assert.equal(s.size, 1);
  });

  it('should handle concurrent add+remove (add wins)', () => {
    const a = new ORSet<string>('node-a');
    const b = new ORSet<string>('node-b');

    a.add('item');
    b.add('item');
    a.remove('item'); // A removes its observed tag

    a.merge(b); // B's add tag survives
    assert.equal(a.has('item'), true); // Concurrent add wins
  });

  it('should merge two sets', () => {
    const a = new ORSet<string>('node-a');
    const b = new ORSet<string>('node-b');

    a.add('apple');
    b.add('banana');

    a.merge(b);
    assert.equal(a.has('apple'), true);
    assert.equal(a.has('banana'), true);
    assert.equal(a.size, 2);
  });

  it('should serialize and deserialize', () => {
    const s = new ORSet<string>('node-a');
    s.add('x');
    s.add('y');

    const data = s.serialize();
    const restored = ORSet.deserialize<string>(data);
    assert.equal(restored.has('x'), true);
    assert.equal(restored.has('y'), true);
    assert.equal(restored.size, 2);
  });
});

// ═══════════════════════════════════════
// MVRegister Tests
// ═══════════════════════════════════════

describe('MVRegister', () => {
  it('should store and retrieve single value', () => {
    const r = new MVRegister<string>('node-a');
    r.set('hello');
    assert.deepEqual(r.value(), ['hello']);
    assert.equal(r.single(), 'hello');
  });

  it('should start empty', () => {
    const r = new MVRegister<string>('node-a');
    assert.deepEqual(r.value(), []);
    assert.equal(r.single(), null);
  });

  it('should preserve concurrent writes', () => {
    const a = new MVRegister<string>('node-a');
    const b = new MVRegister<string>('node-b');

    a.set('A-value');
    b.set('B-value');

    a.merge(b);
    const values = a.value();
    assert.equal(values.length, 2);
    assert.ok(values.includes('A-value'));
    assert.ok(values.includes('B-value'));
  });

  it('should resolve when one dominates', () => {
    const a = new MVRegister<string>('node-a');
    a.set('first');
    const snapshot = a.clone();
    a.set('second'); // Causally after first

    a.merge(snapshot); // Merge in the old value
    // 'second' should dominate 'first'
    assert.equal(a.value().length, 1);
    assert.equal(a.value()[0], 'second');
  });

  it('should serialize and deserialize', () => {
    const r = new MVRegister<number>('node-a');
    r.set(42);

    const data = r.serialize();
    const restored = MVRegister.deserialize<number>(data);
    assert.deepEqual(restored.value(), [42]);
  });
});

// ═══════════════════════════════════════
// CRDTState Manager Tests
// ═══════════════════════════════════════

describe('CRDTState', () => {
  let state: CRDTState;

  beforeEach(() => {
    state = new CRDTState('node-a');
  });

  it('should get/set LWWRegister values', () => {
    state.set('name', 'sensor-1');
    state.set('temp', 25.5);

    assert.equal(state.get('name'), 'sensor-1');
    assert.equal(state.get('temp'), 25.5);
    assert.equal(state.get('missing'), undefined);
  });

  it('should support counter operations', () => {
    state.increment('requests', 5);
    state.increment('requests', 3);
    state.decrement('requests', 2);

    assert.equal(state.get('requests'), 6);
  });

  it('should support ORSet operations', () => {
    state.addToSet('tags', 'alpha');
    state.addToSet('tags', 'beta');
    state.removeFromSet('tags', 'alpha');

    const tags = state.get('tags') as Set<string>;
    assert.equal(tags.has('alpha'), false);
    assert.equal(tags.has('beta'), true);
  });

  it('should check key existence and deletion', () => {
    state.set('key1', 'val');
    assert.equal(state.has('key1'), true);
    assert.equal(state.has('key2'), false);

    state.delete('key1');
    assert.equal(state.has('key1'), false);
  });

  it('should list all keys', () => {
    state.set('a', 1);
    state.set('b', 2);
    state.increment('c', 1);

    const keys = state.keys();
    assert.equal(keys.length, 3);
    assert.ok(keys.includes('a'));
    assert.ok(keys.includes('b'));
    assert.ok(keys.includes('c'));
  });

  it('should merge two CRDTStates (for replication)', () => {
    const stateA = new CRDTState('node-a');
    const stateB = new CRDTState('node-b');

    stateA.set('name', 'sensor-a');
    stateA.increment('count', 5);

    stateB.set('location', 'room-1');
    stateB.increment('count', 3);

    stateA.merge(stateB);

    assert.equal(stateA.get('name'), 'sensor-a');
    assert.equal(stateA.get('location'), 'room-1');
    assert.equal(stateA.get('count'), 8); // Merged PNCounters: 5 + 3
  });

  it('should merge with namespace prefix (for fusion)', () => {
    const stateA = new CRDTState('node-a');
    const stateB = new CRDTState('node-b');

    stateA.set('temp', 25);
    stateB.set('temp', 30);

    stateA.merge(stateB, 'sensor-b');

    assert.equal(stateA.get('temp'), 25);              // Original
    assert.equal(stateA.get('sensor-b.temp'), 30);     // Namespaced
  });

  it('should extract delta of changed keys', () => {
    state.set('a', 1);
    state.set('b', 2);

    const delta1 = state.extractDelta();
    assert.equal(delta1.changedKeys.length, 2);
    assert.equal(delta1.sequence, 1);

    // No changes → empty delta
    const delta2 = state.extractDelta();
    assert.equal(delta2.changedKeys.length, 0);
    assert.equal(delta2.sequence, 2);

    // New change
    state.set('c', 3);
    const delta3 = state.extractDelta();
    assert.equal(delta3.changedKeys.length, 1);
    assert.ok(delta3.changedKeys.includes('c'));
  });

  it('should apply delta from another replica', () => {
    const primary = new CRDTState('primary');
    const replica = new CRDTState('replica');

    primary.set('x', 100);
    primary.increment('counter', 5);

    const delta = primary.extractDelta();
    replica.applyDelta(delta);

    assert.equal(replica.get('x'), 100);
    assert.equal(replica.get('counter'), 5);
  });

  it('should snapshot and restore', () => {
    state.set('name', 'test');
    state.increment('count', 42);
    state.addToSet('tags', 'important');

    const snap = state.snapshot();
    assert.equal(snap.entryCount, 3);
    assert.ok(snap.sizeBytes > 0);

    // Restore into new state
    const restored = new CRDTState('node-b');
    restored.restore(snap);

    assert.equal(restored.get('name'), 'test');
    assert.equal(restored.get('count'), 42);
    assert.equal((restored.get('tags') as Set<string>).has('important'), true);
  });

  it('should partition state by key prefix (for fission)', () => {
    state.set('sensor.temp', 25);
    state.set('sensor.humidity', 60);
    state.set('processor.result', 'ok');
    state.set('shared.status', 'active');

    const sensorState = state.partition('sensor');
    assert.equal(sensorState.get('temp'), 25);
    assert.equal(sensorState.get('humidity'), 60);
    assert.equal(sensorState.has('processor.result'), false);
    assert.equal(sensorState.size, 2);
  });

  it('should track mutation count for billing', () => {
    state.set('a', 1);
    state.set('b', 2);
    state.increment('c', 5);

    const mutations = state.consumeMutationCount();
    assert.equal(mutations, 3);

    // After consume, count resets
    assert.equal(state.consumeMutationCount(), 0);
  });

  it('should estimate state size', () => {
    state.set('key', 'a very long string value here');
    const size = state.estimateSize();
    assert.ok(size > 0);
  });
});

// ═══════════════════════════════════════
// CRDT Factory Tests
// ═══════════════════════════════════════

describe('CRDT Factory', () => {
  it('should create all CRDT types', () => {
    const gc = createCRDT(CRDTType.G_COUNTER, 'n');
    assert.ok(gc instanceof GCounter);

    const pn = createCRDT(CRDTType.PN_COUNTER, 'n');
    assert.ok(pn instanceof PNCounter);

    const lww = createCRDT(CRDTType.LWW_REGISTER, 'n', 'hello');
    assert.ok(lww instanceof LWWRegister);
    assert.equal(lww.value(), 'hello');

    const os = createCRDT(CRDTType.OR_SET, 'n');
    assert.ok(os instanceof ORSet);

    const mv = createCRDT(CRDTType.MV_REGISTER, 'n');
    assert.ok(mv instanceof MVRegister);
  });

  it('should round-trip serialize all CRDT types', () => {
    const types = [CRDTType.G_COUNTER, CRDTType.PN_COUNTER, CRDTType.LWW_REGISTER, CRDTType.OR_SET, CRDTType.MV_REGISTER];

    for (const type of types) {
      const crdt = createCRDT(type, 'node-test');
      const data = crdt.serialize();
      const restored = deserializeCRDT(data);
      assert.equal(restored.type, type);
    }
  });
});

// ═══════════════════════════════════════
// Type Validation Tests
// ═══════════════════════════════════════

describe('Type Definitions', () => {
  it('should have all CauseType values', () => {
    assert.ok(CauseType.MESSAGE);
    assert.ok(CauseType.SYNAPSE_SIGNAL);
    assert.ok(CauseType.TIMER);
    assert.ok(CauseType.STATE_WATCH);
    assert.ok(CauseType.MESH_EVENT);
    assert.ok(CauseType.CCU_THRESHOLD);
    assert.ok(CauseType.INTENT_VIOLATION);
    assert.ok(CauseType.FUSION_REQUEST);
    assert.ok(CauseType.DISTRIBUTION_RESULT);
  });

  it('should have all LifeformState values', () => {
    assert.ok(LifeformState.SPAWNING);
    assert.ok(LifeformState.ALIVE);
    assert.ok(LifeformState.MIGRATING);
    assert.ok(LifeformState.FUSED);
    assert.ok(LifeformState.HIBERNATING);
    assert.ok(LifeformState.DEAD);
  });

  it('should have all 33 Lifeform message types', () => {
    assert.equal(LifeformMessageType.LIFEFORM_SPAWN, 0xC0);
    assert.equal(LifeformMessageType.LIFEFORM_STATE_READ, 0xE0);
    // Verify range
    const values = Object.values(LifeformMessageType).filter(v => typeof v === 'number') as number[];
    assert.ok(values.length >= 33);
    assert.ok(values.every(v => v >= 0xC0 && v <= 0xE0));
  });

  it('should calculate cause CCU cost', () => {
    const cost = calculateCauseCost(DEFAULT_CAUSE_BILLING, 50, 3);
    // 0.01 base + 50*0.001 compute + 3*0.002 state = 0.01 + 0.05 + 0.006 = 0.066
    assert.ok(Math.abs(cost - 0.066) < 0.001);
  });

  it('should calculate hosting cost', () => {
    const hourly = calculateHostingCost(DEFAULT_CAUSE_BILLING, 100 * 1024); // 100KB
    // 100KB = 0.0977 MB * 0.5 CCU/MB/hr ≈ 0.0488
    assert.ok(hourly > 0);
    assert.ok(hourly < 0.1);
  });

  it('should calculate fitness scores', () => {
    const fitness = calculateFitness({
      avgResponseTimeMs: 50,
      ccuEfficiency: 0.8,
      errorRate: 0.05,
      throughput: 50,
      intentSatisfactionRate: 0.9,
    });

    assert.ok(fitness.composite > 0);
    assert.ok(fitness.composite <= 1);
  });

  it('should have all FissionTrigger values', () => {
    assert.ok(FissionTrigger.LOW_LOAD);
    assert.ok(FissionTrigger.LOW_CCU);
    assert.ok(FissionTrigger.DURATION_EXPIRED);
    assert.ok(FissionTrigger.MANUAL_ONLY);
  });

  it('should have all MutationType values', () => {
    assert.ok(MutationType.CONSTANT_MUTATION);
    assert.ok(MutationType.FUNCTION_SWAP);
    assert.ok(MutationType.CROSSOVER);
  });

  it('should have all ViolationAction values', () => {
    assert.ok(ViolationAction.NOTIFY);
    assert.ok(ViolationAction.SLASH);
    assert.ok(ViolationAction.KILL);
    assert.ok(ViolationAction.FORCE_FISSION);
  });
});

/**
 * CMP v3.0 — Computation Entanglement Tests
 *
 * Tests bidirectional CRDT mirroring between Lifeform pairs.
 *
 * Run: npx tsx packages/core/tests/entanglement.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EntanglementManager } from '../src/entanglement/manager';
import type { EntanglementStateAccessor } from '../src/entanglement/manager';
import type { StateDelta } from '../src/lifeform/crdt/crdt-state';

// ─── Mock State Accessor ───

class MockStateAccessor implements EntanglementStateAccessor {
  /** Lifeform name → key → value */
  private states = new Map<string, Map<string, any>>();
  private aliveSet = new Set<string>();

  /** Track all applyDelta calls for assertions */
  appliedDeltas: Array<{ name: string; delta: StateDelta }> = [];

  addLifeform(name: string, initialState?: Record<string, any>): void {
    const state = new Map<string, any>();
    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) state.set(k, v);
    }
    this.states.set(name, state);
    this.aliveSet.add(name);
  }

  killLifeform(name: string): void {
    this.aliveSet.delete(name);
  }

  applyDelta(lifeformName: string, delta: StateDelta): boolean {
    const state = this.states.get(lifeformName);
    if (!state) return false;
    if (!this.aliveSet.has(lifeformName)) return false;

    this.appliedDeltas.push({ name: lifeformName, delta });

    // Apply changes to mock state
    for (const key of delta.changedKeys) {
      if (delta.changes[key] === null) {
        state.delete(key);
      } else {
        state.set(key, delta.changes[key]);
      }
    }

    return true;
  }

  isAlive(lifeformName: string): boolean {
    return this.aliveSet.has(lifeformName);
  }

  getStateKeys(lifeformName: string): string[] {
    return [...(this.states.get(lifeformName)?.keys() ?? [])];
  }

  getState(name: string, key: string): any {
    return this.states.get(name)?.get(key);
  }
}

// ─── Helpers ───

function makeDelta(changes: Record<string, any>, seq = 1): StateDelta {
  return {
    changedKeys: Object.keys(changes),
    changes,
    extractedAt: Date.now(),
    sequence: seq,
  };
}

// ═══════════════════════════════════════

describe('EntanglementManager', () => {
  function setup(): { mgr: EntanglementManager; accessor: MockStateAccessor } {
    const accessor = new MockStateAccessor();
    accessor.addLifeform('sensor-a', { temperature: 20, humidity: 50 });
    accessor.addLifeform('sensor-b', { temperature: 22, humidity: 55 });
    accessor.addLifeform('processor', { load: 0.3 });

    const mgr = new EntanglementManager(accessor);
    return { mgr, accessor };
  }

  describe('Entangle / Disentangle', () => {
    it('should create entanglement between two Lifeforms', () => {
      const { mgr } = setup();
      const record = mgr.entangle('sensor-a', 'sensor-b');

      assert.ok(record !== null);
      assert.equal(record!.lifeformA, 'sensor-a');
      assert.equal(record!.lifeformB, 'sensor-b');
      assert.equal(record!.active, true);
      assert.equal(record!.deltasSynced, 0);
      assert.equal(mgr.activeCount, 1);
    });

    it('should reject self-entanglement', () => {
      const { mgr } = setup();
      const record = mgr.entangle('sensor-a', 'sensor-a');
      assert.equal(record, null);
    });

    it('should reject duplicate entanglement', () => {
      const { mgr } = setup();
      mgr.entangle('sensor-a', 'sensor-b');
      const dup = mgr.entangle('sensor-a', 'sensor-b');
      assert.equal(dup, null);
    });

    it('should reject reverse duplicate', () => {
      const { mgr } = setup();
      mgr.entangle('sensor-a', 'sensor-b');
      const dup = mgr.entangle('sensor-b', 'sensor-a');
      assert.equal(dup, null);
    });

    it('should reject entanglement with dead Lifeform', () => {
      const { mgr, accessor } = setup();
      accessor.killLifeform('sensor-b');
      const record = mgr.entangle('sensor-a', 'sensor-b');
      assert.equal(record, null);
    });

    it('should enforce max entanglements per Lifeform', () => {
      const accessor = new MockStateAccessor();
      accessor.addLifeform('hub');
      accessor.addLifeform('spoke-1');
      accessor.addLifeform('spoke-2');
      accessor.addLifeform('spoke-3');
      accessor.addLifeform('spoke-4');

      const mgr = new EntanglementManager(accessor, { maxEntanglementsPerLifeform: 2 });

      assert.ok(mgr.entangle('hub', 'spoke-1') !== null);
      assert.ok(mgr.entangle('hub', 'spoke-2') !== null);
      assert.equal(mgr.entangle('hub', 'spoke-3'), null); // Exceeds limit for 'hub'
    });

    it('should disentangle by ID', () => {
      const { mgr } = setup();
      const record = mgr.entangle('sensor-a', 'sensor-b')!;

      assert.ok(mgr.areEntangled('sensor-a', 'sensor-b'));
      mgr.disentangle(record.id);
      assert.ok(!mgr.areEntangled('sensor-a', 'sensor-b'));
      assert.equal(mgr.activeCount, 0);
    });

    it('should disentangle all for a Lifeform', () => {
      const { mgr } = setup();
      mgr.entangle('sensor-a', 'sensor-b');
      mgr.entangle('sensor-a', 'processor');

      assert.equal(mgr.activeCount, 2);
      const removed = mgr.disentangleAll('sensor-a');
      assert.equal(removed, 2);
      assert.equal(mgr.activeCount, 0);
    });
  });

  describe('Bidirectional State Sync', () => {
    it('should sync A→B on state change', () => {
      const { mgr, accessor } = setup();
      mgr.entangle('sensor-a', 'sensor-b');

      const delta = makeDelta({ temperature: 25 });
      const synced = mgr.onStateChange('sensor-a', delta);

      assert.equal(synced, 1);
      assert.equal(accessor.getState('sensor-b', 'temperature'), 25);
    });

    it('should sync B→A on state change', () => {
      const { mgr, accessor } = setup();
      mgr.entangle('sensor-a', 'sensor-b');

      const delta = makeDelta({ humidity: 70 });
      const synced = mgr.onStateChange('sensor-b', delta);

      assert.equal(synced, 1);
      assert.equal(accessor.getState('sensor-a', 'humidity'), 70);
    });

    it('should sync to multiple partners', () => {
      const { mgr, accessor } = setup();
      mgr.entangle('sensor-a', 'sensor-b');
      mgr.entangle('sensor-a', 'processor');

      const delta = makeDelta({ temperature: 30 });
      const synced = mgr.onStateChange('sensor-a', delta);

      assert.equal(synced, 2);
      assert.equal(accessor.getState('sensor-b', 'temperature'), 30);
      assert.equal(accessor.getState('processor', 'temperature'), 30);
    });

    it('should NOT sync if no entanglement exists', () => {
      const { mgr, accessor } = setup();

      const delta = makeDelta({ temperature: 99 });
      const synced = mgr.onStateChange('sensor-a', delta);

      assert.equal(synced, 0);
      assert.equal(accessor.appliedDeltas.length, 0);
    });

    it('should NOT sync after disentanglement', () => {
      const { mgr, accessor } = setup();
      const record = mgr.entangle('sensor-a', 'sensor-b')!;
      mgr.disentangle(record.id);

      const delta = makeDelta({ temperature: 99 });
      const synced = mgr.onStateChange('sensor-a', delta);

      assert.equal(synced, 0);
    });

    it('should increment deltasSynced counter', () => {
      const { mgr } = setup();
      const record = mgr.entangle('sensor-a', 'sensor-b')!;

      mgr.onStateChange('sensor-a', makeDelta({ x: 1 }));
      mgr.onStateChange('sensor-b', makeDelta({ y: 2 }));
      mgr.onStateChange('sensor-a', makeDelta({ z: 3 }));

      const updated = mgr.getRecord(record.id)!;
      assert.equal(updated.deltasSynced, 3);
    });
  });

  describe('Re-entrancy Guard', () => {
    it('should prevent infinite loops when sync triggers another sync', () => {
      // Scenario: A changes → sync to B → B's applyDelta triggers onStateChange for B
      // → guard blocks re-entry
      const accessor = new MockStateAccessor();
      accessor.addLifeform('lf-a', {});
      accessor.addLifeform('lf-b', {});

      const mgr = new EntanglementManager(accessor);
      mgr.entangle('lf-a', 'lf-b');

      // Override applyDelta to simulate a re-entrant call
      const originalApply = accessor.applyDelta.bind(accessor);
      let reentrantCalls = 0;
      accessor.applyDelta = (name: string, delta: StateDelta) => {
        const result = originalApply(name, delta);
        // Simulate the Lifeform manager calling onStateChange again
        // when it detects B's state changed
        reentrantCalls++;
        if (reentrantCalls <= 5) {
          mgr.onStateChange(name, delta); // Should be blocked by guard
        }
        return result;
      };

      const delta = makeDelta({ value: 42 });
      mgr.onStateChange('lf-a', delta);

      // applyDelta should have been called exactly once (A→B)
      // The re-entrant call from B should be blocked
      assert.ok(reentrantCalls <= 2, `Re-entrant calls should be limited: ${reentrantCalls}`);
    });
  });

  describe('Key Filters', () => {
    it('should only sync filtered keys', () => {
      const { mgr, accessor } = setup();
      mgr.entangle('sensor-a', 'sensor-b', ['temperature']);

      // Change both temperature and humidity
      const delta = makeDelta({ temperature: 30, humidity: 90 });
      mgr.onStateChange('sensor-a', delta);

      // Only temperature should sync
      assert.equal(accessor.getState('sensor-b', 'temperature'), 30);
      // humidity should NOT have been overwritten
      assert.equal(accessor.getState('sensor-b', 'humidity'), 55); // original value
    });

    it('should sync all keys when no filter', () => {
      const { mgr, accessor } = setup();
      mgr.entangle('sensor-a', 'sensor-b'); // no key filter

      const delta = makeDelta({ temperature: 30, humidity: 90, pressure: 1013 });
      mgr.onStateChange('sensor-a', delta);

      assert.equal(accessor.getState('sensor-b', 'temperature'), 30);
      assert.equal(accessor.getState('sensor-b', 'humidity'), 90);
      assert.equal(accessor.getState('sensor-b', 'pressure'), 1013);
    });

    it('should skip sync when no filtered keys changed', () => {
      const { mgr, accessor } = setup();
      mgr.entangle('sensor-a', 'sensor-b', ['pressure']); // filter on non-existent key

      const delta = makeDelta({ temperature: 30 });
      const synced = mgr.onStateChange('sensor-a', delta);

      assert.equal(synced, 0);
      assert.equal(accessor.appliedDeltas.length, 0);
    });
  });

  describe('Query', () => {
    it('should check entanglement between two Lifeforms', () => {
      const { mgr } = setup();
      assert.ok(!mgr.areEntangled('sensor-a', 'sensor-b'));

      mgr.entangle('sensor-a', 'sensor-b');
      assert.ok(mgr.areEntangled('sensor-a', 'sensor-b'));
      assert.ok(mgr.areEntangled('sensor-b', 'sensor-a')); // symmetric
    });

    it('should list entangled partners', () => {
      const { mgr } = setup();
      mgr.entangle('sensor-a', 'sensor-b');
      mgr.entangle('sensor-a', 'processor');

      const partners = mgr.getPartners('sensor-a');
      assert.equal(partners.length, 2);
      assert.ok(partners.includes('sensor-b'));
      assert.ok(partners.includes('processor'));
    });

    it('should list entanglements for a Lifeform', () => {
      const { mgr } = setup();
      mgr.entangle('sensor-a', 'sensor-b');

      const records = mgr.getEntanglements('sensor-a');
      assert.equal(records.length, 1);
      assert.equal(records[0].lifeformB, 'sensor-b');
    });
  });

  describe('Events', () => {
    it('should log creation and breaking events', () => {
      const { mgr } = setup();
      const record = mgr.entangle('sensor-a', 'sensor-b')!;
      mgr.disentangle(record.id);

      const events = mgr.getEvents();
      assert.equal(events.length, 2);
      assert.equal(events[0].type, 'created');
      assert.equal(events[1].type, 'broken');
    });
  });

  describe('Stats', () => {
    it('should report accurate stats', () => {
      const { mgr } = setup();
      mgr.entangle('sensor-a', 'sensor-b');
      mgr.onStateChange('sensor-a', makeDelta({ x: 1 }));
      mgr.onStateChange('sensor-b', makeDelta({ y: 2 }));

      const stats = mgr.getStats();
      assert.equal(stats.activeEntanglements, 1);
      assert.equal(stats.totalDeltasSynced, 2);
      assert.equal(stats.entangledLifeforms, 2);
    });
  });

  describe('Batched mode', () => {
    it('should accumulate and flush in batched mode', async () => {
      const accessor = new MockStateAccessor();
      accessor.addLifeform('lf-a', {});
      accessor.addLifeform('lf-b', {});

      const mgr = new EntanglementManager(accessor, {
        syncMode: 'batched',
        batchIntervalMs: 50,
      });

      mgr.entangle('lf-a', 'lf-b');

      // Send multiple changes rapidly
      mgr.onStateChange('lf-a', makeDelta({ x: 1 }, 1));
      mgr.onStateChange('lf-a', makeDelta({ y: 2 }, 2));
      mgr.onStateChange('lf-a', makeDelta({ z: 3 }, 3));

      // In batched mode, deltas are NOT applied immediately
      assert.equal(accessor.getState('lf-b', 'x'), undefined);

      // Wait for batch flush
      await new Promise(r => setTimeout(r, 100));

      // Now they should be applied
      assert.equal(accessor.getState('lf-b', 'x'), 1);
      assert.equal(accessor.getState('lf-b', 'y'), 2);
      assert.equal(accessor.getState('lf-b', 'z'), 3);

      mgr.destroy();
    });
  });

  describe('Edge cases', () => {
    it('should handle non-existent Lifeform in onStateChange', () => {
      const { mgr } = setup();
      const synced = mgr.onStateChange('nonexistent', makeDelta({ x: 1 }));
      assert.equal(synced, 0);
    });

    it('should handle disentangle of non-existent ID', () => {
      const { mgr } = setup();
      assert.equal(mgr.disentangle('fake-id'), false);
    });

    it('should handle deletion changes in delta', () => {
      const { mgr, accessor } = setup();
      mgr.entangle('sensor-a', 'sensor-b');

      accessor.getState('sensor-b', 'temperature'); // exists
      const delta = makeDelta({ temperature: null }); // delete
      mgr.onStateChange('sensor-a', delta);

      assert.equal(accessor.getState('sensor-b', 'temperature'), undefined);
    });
  });
});

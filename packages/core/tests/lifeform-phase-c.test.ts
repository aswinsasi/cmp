/**
 * CMP v1.4 — Phase C Test Suite: Distribution
 * Tests: HostSelector, MigrationManager, ReplicationManager, LifeformDNS.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-c.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { HostSelector, HostCandidate } from '../src/lifeform/host-selector';
import { MigrationManager, MigrationReason, MigrationStatus } from '../src/lifeform/migration';
import { ReplicationManager } from '../src/lifeform/replication';
import { LifeformDNS } from '../src/lifeform/dns';

// ── Helpers ──

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function makeCandidate(overrides?: Partial<HostCandidate>): HostCandidate {
  return {
    deviceId: overrides?.deviceId ?? Math.random().toString(36).substring(2, 10),
    availableCores: overrides?.availableCores ?? 4,
    availableMemMb: overrides?.availableMemMb ?? 512,
    scratchMb: overrides?.scratchMb ?? 100,
    reputation: overrides?.reputation ?? 5000,
    currentLifeformCount: overrides?.currentLifeformCount ?? 0,
    maxLifeforms: overrides?.maxLifeforms ?? 5,
    pluggedIn: overrides?.pluggedIn ?? true,
    batteryPct: overrides?.batteryPct ?? 100,
    throttled: overrides?.throttled ?? false,
  };
}

// ═══════════════════════════════════════
// HostSelector Tests
// ═══════════════════════════════════════

describe('HostSelector', () => {
  let selector: HostSelector;

  beforeEach(() => {
    selector = new HostSelector();
  });

  it('should select the best host from candidates', () => {
    const candidates = [
      makeCandidate({ deviceId: 'weak', availableCores: 1, availableMemMb: 128 }),
      makeCandidate({ deviceId: 'strong', availableCores: 8, availableMemMb: 2048, reputation: 8000 }),
      makeCandidate({ deviceId: 'medium', availableCores: 4, availableMemMb: 512 }),
    ];

    const best = selector.selectBest(candidates);
    assert.ok(best);
    assert.equal(best.deviceId, 'strong');
  });

  it('should filter out ineligible candidates', () => {
    const candidates = [
      makeCandidate({ deviceId: 'throttled', throttled: true }),
      makeCandidate({ deviceId: 'low-battery', batteryPct: 5 }),
      makeCandidate({ deviceId: 'low-rep', reputation: 500 }),
      makeCandidate({ deviceId: 'full', currentLifeformCount: 5, maxLifeforms: 5 }),
      makeCandidate({ deviceId: 'good' }),
    ];

    const scored = selector.selectHost(candidates);
    assert.equal(scored.length, 1);
    assert.equal(scored[0].deviceId, 'good');
  });

  it('should return empty when no candidates meet requirements', () => {
    const candidates = [
      makeCandidate({ availableMemMb: 10 }), // Below 64MB minimum
    ];

    const scored = selector.selectHost(candidates);
    assert.equal(scored.length, 0);
    assert.equal(selector.selectBest(candidates), null);
  });

  it('should prefer plugged-in hosts', () => {
    const candidates = [
      makeCandidate({ deviceId: 'battery', pluggedIn: false, batteryPct: 60, availableCores: 4, availableMemMb: 512 }),
      makeCandidate({ deviceId: 'plugged', pluggedIn: true, availableCores: 4, availableMemMb: 512 }),
    ];

    const scored = selector.selectHost(candidates);
    assert.equal(scored[0].deviceId, 'plugged');
  });

  it('should select multiple replicas excluding primary', () => {
    const candidates = [
      makeCandidate({ deviceId: 'primary' }),
      makeCandidate({ deviceId: 'replica-1' }),
      makeCandidate({ deviceId: 'replica-2' }),
      makeCandidate({ deviceId: 'replica-3' }),
    ];

    const replicas = selector.selectReplicas(candidates, 2, 'primary');
    assert.equal(replicas.length, 2);
    assert.ok(replicas.every(r => r.deviceId !== 'primary'));
  });

  it('should prefer less loaded devices', () => {
    const candidates = [
      makeCandidate({ deviceId: 'loaded', currentLifeformCount: 4, maxLifeforms: 5 }),
      makeCandidate({ deviceId: 'empty', currentLifeformCount: 0, maxLifeforms: 5 }),
    ];

    const scored = selector.selectHost(candidates);
    assert.equal(scored[0].deviceId, 'empty');
  });
});

// ═══════════════════════════════════════
// MigrationManager Tests
// ═══════════════════════════════════════

describe('MigrationManager', () => {
  let manager: MigrationManager;

  beforeEach(() => {
    manager = new MigrationManager();
  });

  it('should initiate a migration', () => {
    const record = manager.initiate(
      randomBytes(16), randomBytes(16), randomBytes(16),
      MigrationReason.BETTER_HOST,
      { crdts: {}, sizeBytes: 1024, snapshotAt: Date.now(), entryCount: 5 },
    );

    assert.equal(record.status, MigrationStatus.PENDING);
    assert.equal(record.reason, MigrationReason.BETTER_HOST);
    assert.equal(record.stateSize, 1024);
  });

  it('should track migration lifecycle', () => {
    const record = manager.initiate(
      randomBytes(16), randomBytes(16), randomBytes(16),
      MigrationReason.MANUAL,
      { crdts: {}, sizeBytes: 0, snapshotAt: Date.now(), entryCount: 0 },
    );

    assert.equal(manager.markTransferring(record.id), true);
    assert.equal(manager.markConfirming(record.id), true);
    assert.equal(manager.complete(record.id), true);

    const stats = manager.getStats();
    assert.equal(stats.successful, 1);
    assert.equal(stats.active, 0);
  });

  it('should handle migration failure', () => {
    const record = manager.initiate(
      randomBytes(16), randomBytes(16), randomBytes(16),
      MigrationReason.HOST_DEPARTURE,
      { crdts: {}, sizeBytes: 0, snapshotAt: Date.now(), entryCount: 0 },
    );

    manager.markTransferring(record.id);
    manager.fail(record.id, 'Target host unavailable');

    const stats = manager.getStats();
    assert.equal(stats.failed, 1);
  });

  it('should check if Lifeform is migrating', () => {
    const lfId = randomBytes(16);
    assert.equal(manager.isMigrating(lfId), false);

    manager.initiate(
      lfId, randomBytes(16), randomBytes(16),
      MigrationReason.LOAD_BALANCE,
      { crdts: {}, sizeBytes: 0, snapshotAt: Date.now(), entryCount: 0 },
    );

    assert.equal(manager.isMigrating(lfId), true);
  });
});

// ═══════════════════════════════════════
// ReplicationManager Tests
// ═══════════════════════════════════════

describe('ReplicationManager', () => {
  let manager: ReplicationManager;

  beforeEach(() => {
    manager = new ReplicationManager({ minReplicas: 2, maxReplicas: 4 });
  });

  it('should initialize with primary replica', () => {
    manager.initializeReplica('lf-1', 'host-a');

    const replicas = manager.getReplicas('lf-1');
    assert.equal(replicas.length, 1);
    assert.equal(replicas[0].isPrimary, true);
    assert.equal(replicas[0].hostId, 'host-a');
  });

  it('should add secondary replicas', () => {
    manager.initializeReplica('lf-1', 'host-a');
    assert.equal(manager.addReplica('lf-1', 'host-b'), true);
    assert.equal(manager.addReplica('lf-1', 'host-c'), true);

    assert.equal(manager.replicaCount('lf-1'), 3);
  });

  it('should reject duplicate replicas', () => {
    manager.initializeReplica('lf-1', 'host-a');
    assert.equal(manager.addReplica('lf-1', 'host-a'), false); // Already primary
  });

  it('should enforce maxReplicas', () => {
    manager.initializeReplica('lf-1', 'host-a');
    manager.addReplica('lf-1', 'host-b');
    manager.addReplica('lf-1', 'host-c');
    manager.addReplica('lf-1', 'host-d');
    assert.equal(manager.addReplica('lf-1', 'host-e'), false); // At max (4)
  });

  it('should not remove primary replica', () => {
    manager.initializeReplica('lf-1', 'host-a');
    assert.equal(manager.removeReplica('lf-1', 'host-a'), false);
  });

  it('should remove secondary replicas', () => {
    manager.initializeReplica('lf-1', 'host-a');
    manager.addReplica('lf-1', 'host-b');

    assert.equal(manager.removeReplica('lf-1', 'host-b'), true);
    assert.equal(manager.replicaCount('lf-1'), 1);
  });

  it('should promote secondary to primary', () => {
    manager.initializeReplica('lf-1', 'host-a');
    manager.addReplica('lf-1', 'host-b');

    const newPrimary = manager.promoteToPrimary('lf-1');
    assert.equal(newPrimary, 'host-b');

    const replicas = manager.getReplicas('lf-1');
    const primary = replicas.find(r => r.isPrimary);
    assert.ok(primary);
    assert.equal(primary.hostId, 'host-b');
  });

  it('should record delta sync', () => {
    manager.initializeReplica('lf-1', 'host-a');
    manager.addReplica('lf-1', 'host-b');

    manager.recordDeltaSync('lf-1', 'host-b', 5);

    const replica = manager.getReplica('lf-1', 'host-b');
    assert.ok(replica);
    assert.equal(replica.lastDeltaSequence, 5);
    assert.equal(replica.syncLagMs, 0);
  });

  it('should get secondary hosts', () => {
    manager.initializeReplica('lf-1', 'host-a');
    manager.addReplica('lf-1', 'host-b');
    manager.addReplica('lf-1', 'host-c');

    const secondaries = manager.getSecondaryHosts('lf-1');
    assert.equal(secondaries.length, 2);
    assert.ok(!secondaries.includes('host-a'));
  });

  it('should detect need for more replicas', () => {
    manager.initializeReplica('lf-1', 'host-a'); // Only 1, needs 2

    const health = manager.healthCheck('lf-1');
    assert.equal(health.needsReplica, true);
  });
});

// ═══════════════════════════════════════
// LifeformDNS Tests
// ═══════════════════════════════════════

describe('LifeformDNS', () => {
  let dns: LifeformDNS;

  beforeEach(() => {
    dns = new LifeformDNS();
  });

  it('should register and resolve a name', () => {
    assert.equal(dns.register('sensor-1', 'lf-abc', 'host-xyz'), true);

    const result = dns.resolve('sensor-1');
    assert.ok(result.record);
    assert.equal(result.record.lifeformId, 'lf-abc');
    assert.equal(result.record.hostId, 'host-xyz');
  });

  it('should reject duplicate names for different Lifeforms', () => {
    dns.register('sensor-1', 'lf-abc', 'host-1');
    assert.equal(dns.register('sensor-1', 'lf-different', 'host-2'), false);
  });

  it('should allow re-registration by same Lifeform', () => {
    dns.register('sensor-1', 'lf-abc', 'host-1');
    assert.equal(dns.register('sensor-1', 'lf-abc', 'host-2'), true);

    assert.equal(dns.resolveHost('sensor-1'), 'host-2');
  });

  it('should update host after migration', () => {
    dns.register('sensor-1', 'lf-abc', 'host-old');
    dns.updateHost('sensor-1', 'host-new');

    assert.equal(dns.resolveHost('sensor-1'), 'host-new');
  });

  it('should handle redirects (for fusion)', () => {
    dns.register('sensor-a', 'lf-a', 'host-1');
    dns.register('sensor-b', 'lf-b', 'host-1');
    dns.register('composite-ab', 'lf-composite', 'host-1');

    dns.setRedirect('sensor-a', 'composite-ab');
    dns.setRedirect('sensor-b', 'composite-ab');

    const resultA = dns.resolve('sensor-a');
    assert.ok(resultA.record);
    assert.equal(resultA.record.name, 'composite-ab');
    assert.equal(resultA.redirectCount, 1);

    const resultB = dns.resolve('sensor-b');
    assert.ok(resultB.record);
    assert.equal(resultB.record.name, 'composite-ab');
  });

  it('should clear redirects (for fission)', () => {
    dns.register('sensor-a', 'lf-a', 'host-1');
    dns.register('composite', 'lf-comp', 'host-1');
    dns.setRedirect('sensor-a', 'composite');

    dns.clearRedirect('sensor-a');

    const result = dns.resolve('sensor-a');
    assert.ok(result.record);
    assert.equal(result.record.name, 'sensor-a'); // No redirect
  });

  it('should return null for unknown names', () => {
    const result = dns.resolve('nonexistent');
    assert.equal(result.record, null);
  });

  it('should unregister names', () => {
    dns.register('temp', 'lf-1', 'host-1');
    dns.unregister('temp');

    assert.equal(dns.resolveHost('temp'), null);
  });

  it('should query by wildcard pattern', () => {
    dns.register('sensor-1', 'lf-1', 'host-1');
    dns.register('sensor-2', 'lf-2', 'host-1');
    dns.register('processor-1', 'lf-3', 'host-1');

    const sensors = dns.query('sensor-*');
    assert.equal(sensors.length, 2);

    const all = dns.query('processor-1');
    assert.equal(all.length, 1);
  });

  it('should check name availability', () => {
    assert.equal(dns.isAvailable('new-name'), true);
    dns.register('new-name', 'lf-1', 'host-1');
    assert.equal(dns.isAvailable('new-name'), false);
  });
});

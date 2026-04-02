/**
 * CMP v1.4 — Phase E Test Suite: LifeformManager Integration
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-e.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LifeformManager } from '../src/lifeform/manager';
import { LifeformConfig, LifeformState } from '../src/types/lifeform';
import { Cause, CauseType } from '../src/types/causal';

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function makeConfig(name: string, overrides?: Partial<LifeformConfig>): LifeformConfig {
  return {
    name,
    wasmModule: new Uint8Array([0, 0x61, 0x73, 0x6d]),
    initialState: overrides?.initialState ?? { status: 'active' },
    initialCcu: overrides?.initialCcu ?? 100,
    minReplicas: 1,
    maxReplicas: 3,
    autoMigrate: true,
    mutationLibraryHash: null,
    maxCausesPerSecond: 100,
    maxStateSizeBytes: 1024 * 1024,
  };
}

function makeCause(overrides?: Partial<Cause>): Cause {
  return {
    id: randomBytes(16),
    type: overrides?.type ?? CauseType.MESSAGE,
    chainId: randomBytes(16),
    chainDepth: overrides?.chainDepth ?? 0,
    maxChainDepth: 64,
    deadlineMs: overrides?.deadlineMs ?? 0,
    sourceId: randomBytes(16),
    sourceType: 'device',
    targetId: randomBytes(16),
    payload: overrides?.payload ?? new Uint8Array([1, 2, 3]),
    ccuAttached: overrides?.ccuAttached ?? 0,
    expectsResponse: false,
    correlationId: null,
    emittedAt: Date.now(),
  };
}

describe('LifeformManager', () => {
  let manager: LifeformManager;

  beforeEach(() => {
    manager = new LifeformManager({ deviceId: 'test-device', maxHostedLifeforms: 5 });
    manager.start();
  });

  afterEach(() => {
    manager.stop();
  });

  it('should spawn a Lifeform', () => {
    const hosted = manager.spawn(makeConfig('sensor-1'));
    assert.ok(hosted);
    assert.equal(hosted.lifecycle.name, 'sensor-1');
    assert.equal(hosted.lifecycle.state, LifeformState.ALIVE);
    assert.equal(manager.hostedCount, 1);
  });

  it('should initialize state on spawn', () => {
    const hosted = manager.spawn(makeConfig('s1', { initialState: { temp: 25 } }));
    assert.ok(hosted);
    assert.equal(hosted.state.get('temp'), 25);
  });

  it('should register DNS on spawn', () => {
    manager.spawn(makeConfig('s1'));
    assert.equal(manager.getDNS().resolveHost('s1'), 'test-device');
  });

  it('should reject duplicate names', () => {
    manager.spawn(makeConfig('s1'));
    assert.equal(manager.spawn(makeConfig('s1')), null);
  });

  it('should enforce max capacity', () => {
    for (let i = 0; i < 5; i++) manager.spawn(makeConfig(`lf-${i}`));
    assert.equal(manager.spawn(makeConfig('overflow')), null);
  });

  it('should kill a Lifeform', () => {
    manager.spawn(makeConfig('doomed'));
    assert.equal(manager.kill('doomed'), true);
    assert.equal(manager.hostedCount, 0);
  });

  it('should get by name', () => {
    manager.spawn(makeConfig('findme'));
    assert.ok(manager.getByName('findme'));
    assert.equal(manager.getByName('ghost'), null);
  });

  it('should list names', () => {
    manager.spawn(makeConfig('a'));
    manager.spawn(makeConfig('b'));
    assert.equal(manager.getNames().length, 2);
  });

  it('should get all instances', () => {
    manager.spawn(makeConfig('x'));
    manager.spawn(makeConfig('y'));
    assert.equal(manager.getAllInstances().length, 2);
  });

  it('should report remaining capacity', () => {
    assert.equal(manager.remainingCapacity, 5);
    manager.spawn(makeConfig('z'));
    assert.equal(manager.remainingCapacity, 4);
  });

  it('should set handler and process cause', async () => {
    manager.spawn(makeConfig('proc'));
    let called = false;
    manager.setHandler('proc', async () => {
      called = true;
      return { stateMutations: 0, outgoingCauses: [] };
    });
    assert.equal(await manager.deliverCause('proc', makeCause()), true);
    assert.equal(called, true);
  });

  it('should bill CCU on processing', async () => {
    const hosted = manager.spawn(makeConfig('billed'))!;
    manager.setHandler('billed', async () => ({ stateMutations: 2, outgoingCauses: [] }));
    await manager.deliverCause('billed', makeCause());
    assert.ok(hosted.lifecycle.ccuBalance < 100);
  });

  it('should earn CCU from attached payment', async () => {
    const hosted = manager.spawn(makeConfig('earner', { initialCcu: 50 }))!;
    manager.setHandler('earner', async () => ({ stateMutations: 0, outgoingCauses: [] }));
    await manager.deliverCause('earner', makeCause({ ccuAttached: 10 }));
    assert.ok(hosted.lifecycle.ccuBalance > 50);
  });

  it('should reject cause for unknown name', async () => {
    assert.equal(await manager.deliverCause('ghost', makeCause()), false);
  });

  it('should kill on CCU depletion', async () => {
    manager.spawn(makeConfig('poor', { initialCcu: 0.005 }));
    manager.setHandler('poor', async () => ({ stateMutations: 5, outgoingCauses: [] }));
    await manager.deliverCause('poor', makeCause());
    assert.equal(manager.getByName('poor'), null);
  });

  it('should create synapse', () => {
    manager.spawn(makeConfig('s1'));
    manager.spawn(makeConfig('s2'));
    assert.equal(manager.createSynapse('s1', 's2'), true);
  });

  it('should clean up synapses on kill', () => {
    manager.spawn(makeConfig('n1'));
    manager.spawn(makeConfig('n2'));
    manager.createSynapse('n1', 'n2');
    manager.kill('n1');
    assert.equal(manager.getSynapses().totalCount, 0);
  });

  it('should track stats', () => {
    manager.spawn(makeConfig('sa', { initialCcu: 50 }));
    manager.spawn(makeConfig('sb', { initialCcu: 75 }));
    const stats = manager.getStats();
    assert.equal(stats.hosted, 2);
    assert.equal(stats.totalCcuBalance, 125);
  });

  it('should handle full lifecycle', async () => {
    const hosted = manager.spawn(makeConfig('echo', { initialState: { count: 0 } }))!;
    manager.setHandler('echo', async () => {
      hosted.state.set('count', (hosted.state.get('count') ?? 0) + 1);
      return { stateMutations: 1, outgoingCauses: [] };
    });
    for (let i = 0; i < 5; i++) await manager.deliverCause('echo', makeCause());
    assert.equal(hosted.state.get('count'), 5);
    manager.kill('echo');
    assert.equal(manager.hostedCount, 0);
  });

  it('should chain causes across two Lifeforms', async () => {
    manager.spawn(makeConfig('producer'));
    manager.spawn(makeConfig('consumer'));
    manager.createSynapse('producer', 'consumer');

    let consumerCalled = false;
    manager.setHandler('producer', async (cause) => ({
      stateMutations: 0,
      outgoingCauses: [{
        ...makeCause(),
        type: CauseType.SYNAPSE_SIGNAL,
        chainId: cause.chainId,
        chainDepth: cause.chainDepth + 1,
        targetId: new TextEncoder().encode('consumer').slice(0, 16),
      }],
    }));
    manager.setHandler('consumer', async () => {
      consumerCalled = true;
      return { stateMutations: 0, outgoingCauses: [] };
    });
    await manager.deliverCause('producer', makeCause());
    assert.equal(consumerCalled, true);
  });
});

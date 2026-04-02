/**
 * CMP v1.4 — Phase D Test Suite: Synapses + Wire Protocol
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-d.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SynapseManager } from '../src/lifeform/synapse';
import {
  encodeLifeformMessage,
  decodeLifeformMessage,
  isLifeformMessage,
  lifeformMessageName,
} from '../src/lifeform/wire-protocol';
import { LifeformMessageType } from '../src/types/lifeform';

// ═══════════════════════════════════════
// SynapseManager Tests
// ═══════════════════════════════════════

describe('SynapseManager', () => {
  let manager: SynapseManager;

  beforeEach(() => {
    manager = new SynapseManager({ maxSynapsesPerLifeform: 10 });
  });

  it('should create a synapse between two Lifeforms', () => {
    const syn = manager.createSynapse('sensor-a', 'processor-b');
    assert.ok(syn);
    assert.equal(syn.fromName, 'sensor-a');
    assert.equal(syn.toName, 'processor-b');
    assert.equal(syn.strength, 0.5); // Default initial
    assert.equal(syn.active, true);
    assert.equal(manager.totalCount, 1);
  });

  it('should not create duplicate synapses', () => {
    manager.createSynapse('a', 'b');
    const dup = manager.createSynapse('a', 'b');
    assert.ok(dup); // Returns existing
    assert.equal(manager.totalCount, 1);
  });

  it('should create directional synapses (A→B != B→A)', () => {
    manager.createSynapse('a', 'b');
    manager.createSynapse('b', 'a');
    assert.equal(manager.totalCount, 2);
  });

  it('should enforce max synapses per Lifeform', () => {
    for (let i = 0; i < 10; i++) {
      assert.ok(manager.createSynapse('source', `target-${i}`));
    }
    assert.equal(manager.createSynapse('source', 'target-overflow'), null);
  });

  it('should strengthen synapse on transmission (Hebbian)', () => {
    manager.createSynapse('a', 'b');
    const before = manager.findSynapse('a', 'b')!.strength;

    manager.transmit('a', 'b', 1.0);
    manager.transmit('a', 'b', 1.0);
    manager.transmit('a', 'b', 1.0);

    const after = manager.findSynapse('a', 'b')!.strength;
    assert.ok(after > before, `Strength should increase: ${before} → ${after}`);
  });

  it('should track causes transmitted and CCU flowed', () => {
    manager.createSynapse('a', 'b');

    manager.transmit('a', 'b', 5.0);
    manager.transmit('a', 'b', 3.0);

    const syn = manager.findSynapse('a', 'b')!;
    assert.equal(syn.causesTransmitted, 2);
    assert.equal(syn.ccuFlowed, 8.0);
  });

  it('should not transmit through nonexistent synapse', () => {
    assert.equal(manager.transmit('x', 'y'), false);
  });

  it('should get outgoing and incoming synapses', () => {
    manager.createSynapse('hub', 'spoke-1');
    manager.createSynapse('hub', 'spoke-2');
    manager.createSynapse('external', 'hub');

    assert.equal(manager.getOutgoing('hub').length, 2);
    assert.equal(manager.getIncoming('hub').length, 1);
    assert.equal(manager.getAllFor('hub').length, 3);
  });

  it('should remove a synapse', () => {
    const syn = manager.createSynapse('a', 'b')!;
    assert.equal(manager.removeSynapse(syn.id), true);
    assert.equal(manager.totalCount, 0);
    assert.equal(manager.findSynapse('a', 'b'), null);
  });

  it('should remove all synapses for a Lifeform', () => {
    manager.createSynapse('dead', 'alive-1');
    manager.createSynapse('dead', 'alive-2');
    manager.createSynapse('alive-3', 'dead');
    manager.createSynapse('other', 'other2');

    const removed = manager.removeAllFor('dead');
    assert.equal(removed, 3);
    assert.equal(manager.totalCount, 1); // Only other→other2 remains
  });

  it('should transfer synapses for fusion', () => {
    // Component A has synapses
    manager.createSynapse('comp-a', 'external-1');
    manager.createSynapse('external-2', 'comp-a');

    // Component B has synapses
    manager.createSynapse('comp-b', 'external-3');

    const transferred = manager.transferForFusion('comp-a', 'comp-b', 'composite');

    assert.ok(transferred > 0);
    // Composite should now have outgoing to external-1, external-3
    // and incoming from external-2
    const outgoing = manager.getOutgoing('composite');
    assert.ok(outgoing.length >= 2);
  });

  it('should partition synapses for fission', () => {
    manager.createSynapse('composite', 'ext-1');
    manager.createSynapse('composite', 'ext-2');
    manager.createSynapse('composite', 'ext-3');
    manager.createSynapse('composite', 'ext-4');

    const { forA, forB } = manager.partitionForFission('composite', 'comp-a', 'comp-b');

    assert.ok(forA.length > 0);
    assert.ok(forB.length > 0);
    assert.equal(forA.length + forB.length, 4);
  });

  it('should count active synapses', () => {
    const s1 = manager.createSynapse('a', 'b')!;
    manager.createSynapse('c', 'd');

    assert.equal(manager.activeCount, 2);

    // Deactivate one
    s1.active = false;
    assert.equal(manager.activeCount, 1);
  });
});

// ═══════════════════════════════════════
// Wire Protocol Tests
// ═══════════════════════════════════════

describe('Wire Protocol', () => {
  it('should encode and decode SPAWN message', () => {
    const payload = {
      name: 'test-lf',
      wasmModuleHash: 'abcd1234',
      initialCcu: 100,
      minReplicas: 1,
      maxReplicas: 3,
      spawnerId: 'device-abc',
      preferredHost: null,
      initialState: { temp: 25 },
    };

    const encoded = encodeLifeformMessage(LifeformMessageType.LIFEFORM_SPAWN, payload);
    const decoded = decodeLifeformMessage(encoded);

    assert.ok(decoded);
    assert.equal(decoded.type, LifeformMessageType.LIFEFORM_SPAWN);
    assert.equal(decoded.name, 'test-lf');
    assert.equal(decoded.initialCcu, 100);
  });

  it('should encode and decode CAUSE message', () => {
    const payload = {
      causeId: 'cause-123',
      type: 'message',
      chainId: 'chain-abc',
      chainDepth: 3,
      maxChainDepth: 64,
      deadlineMs: Date.now() + 5000,
      sourceId: 'device-xyz',
      sourceType: 'device',
      targetName: 'sensor-1',
      payload: Buffer.from('hello').toString('base64'),
      ccuAttached: 0.5,
      expectsResponse: true,
      correlationId: 'corr-456',
      emittedAt: Date.now(),
    };

    const encoded = encodeLifeformMessage(LifeformMessageType.LIFEFORM_CAUSE, payload);
    const decoded = decodeLifeformMessage(encoded);

    assert.ok(decoded);
    assert.equal(decoded.type, LifeformMessageType.LIFEFORM_CAUSE);
    assert.equal(decoded.targetName, 'sensor-1');
    assert.equal(decoded.chainDepth, 3);
    assert.equal(decoded.ccuAttached, 0.5);
  });

  it('should encode and decode FUSION_PROPOSE message', () => {
    const payload = {
      proposalId: 'prop-abc',
      proposerName: 'sensor-a',
      targetName: 'processor-b',
      compositeName: 'sensor-processor',
      stateConflictStrategy: 'namespace_prefix',
      ccuContributionRatio: 0.5,
      primaryGenome: 'proposer',
      maxFusionDurationMs: 3600000,
      expiresAt: Date.now() + 60000,
    };

    const encoded = encodeLifeformMessage(LifeformMessageType.LIFEFORM_FUSION_PROPOSE, payload);
    const decoded = decodeLifeformMessage(encoded);

    assert.ok(decoded);
    assert.equal(decoded.type, LifeformMessageType.LIFEFORM_FUSION_PROPOSE);
    assert.equal(decoded.compositeName, 'sensor-processor');
    assert.equal(decoded.primaryGenome, 'proposer');
  });

  it('should encode and decode DNS_UPDATE message', () => {
    const payload = {
      name: 'my-sensor',
      lifeformId: 'lf-abc',
      hostId: 'host-xyz',
      replicaHostIds: ['host-2', 'host-3'],
      redirect: null,
      version: 5,
    };

    const encoded = encodeLifeformMessage(LifeformMessageType.LIFEFORM_DNS_UPDATE, payload);
    const decoded = decodeLifeformMessage(encoded);

    assert.ok(decoded);
    assert.equal(decoded.name, 'my-sensor');
    assert.equal(decoded.version, 5);
    assert.equal(decoded.replicaHostIds.length, 2);
  });

  it('should encode and decode INTENT_DECLARE message', () => {
    const payload = {
      intentId: 'intent-123',
      lifeformName: 'monitor',
      description: 'Temperature stays below 30',
      predicate: { type: 'value_check', stateKey: 'temp', operator: 'lt', value: 30 },
      sampleIntervalMs: 60000,
      samplesPerInterval: 5,
      violationAction: 'slash',
      ccuStaked: 50,
      expiresAt: 0,
    };

    const encoded = encodeLifeformMessage(LifeformMessageType.LIFEFORM_INTENT_DECLARE, payload);
    const decoded = decodeLifeformMessage(encoded);

    assert.ok(decoded);
    assert.equal(decoded.type, LifeformMessageType.LIFEFORM_INTENT_DECLARE);
    assert.equal(decoded.description, 'Temperature stays below 30');
    assert.equal(decoded.predicate.operator, 'lt');
  });

  it('should return null for invalid data', () => {
    assert.equal(decodeLifeformMessage(new Uint8Array([0, 1, 2])), null);
    assert.equal(decodeLifeformMessage(new TextEncoder().encode('not json {')), null);
  });

  it('should identify Lifeform message type range', () => {
    assert.equal(isLifeformMessage(0xC0), true);
    assert.equal(isLifeformMessage(0xD5), true);
    assert.equal(isLifeformMessage(0xE0), true);
    assert.equal(isLifeformMessage(0xBF), false);
    assert.equal(isLifeformMessage(0xE1), false);
    assert.equal(isLifeformMessage(0x10), false); // CMP core
  });

  it('should get message names for all 33 types', () => {
    for (let code = 0xC0; code <= 0xE0; code++) {
      const name = lifeformMessageName(code);
      assert.ok(!name.startsWith('UNKNOWN'), `0x${code.toString(16)} should have a name, got ${name}`);
    }
  });

  it('should round-trip all message types', () => {
    const types = [
      LifeformMessageType.LIFEFORM_SPAWN,
      LifeformMessageType.LIFEFORM_CAUSE,
      LifeformMessageType.LIFEFORM_STATE_DELTA,
      LifeformMessageType.LIFEFORM_MIGRATE_OFFER,
      LifeformMessageType.LIFEFORM_DNS_UPDATE,
      LifeformMessageType.LIFEFORM_SYNAPSE_OFFER,
      LifeformMessageType.LIFEFORM_FUSION_PROPOSE,
      LifeformMessageType.LIFEFORM_MUTATE,
      LifeformMessageType.LIFEFORM_INTENT_DECLARE,
      LifeformMessageType.LIFEFORM_STATE_READ,
    ];

    for (const type of types) {
      const encoded = encodeLifeformMessage(type, { test: true, value: 42 });
      const decoded = decodeLifeformMessage(encoded);
      assert.ok(decoded, `Should decode type 0x${type.toString(16)}`);
      assert.equal(decoded!.type, type);
      assert.equal(decoded!.test, true);
    }
  });
});

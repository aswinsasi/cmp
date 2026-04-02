/**
 * CMP v1.4 — Phase F Test Suite: Fusion/Fission Engine
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-f.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FusionEngine, FusionStatus } from '../src/lifeform/fusion';
import { CRDTState } from '../src/lifeform/crdt/crdt-state';
import { LifeformSoul } from '../src/types/lifeform';
import {
  FusionConfig,
  StateConflictStrategy,
  FissionTrigger,
} from '../src/types/fusion';
import { generateKeypair, generateId } from '../src/lifeform/crypto';

// ── Helpers ──

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function makeSoul(name: string): LifeformSoul {
  const kp = generateKeypair();
  return {
    id: generateId(),
    name,
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    creatorId: generateId(),
    bornAt: Date.now(),
    generation: 0,
    parentId: null,
  };
}

function makeConfig(overrides?: Partial<FusionConfig>): FusionConfig {
  return {
    compositeName: overrides?.compositeName ?? 'composite-ab',
    stateConflictStrategy: overrides?.stateConflictStrategy ?? StateConflictStrategy.NAMESPACE_PREFIX,
    ccuContributionRatio: overrides?.ccuContributionRatio ?? 0.5,
    primaryGenome: overrides?.primaryGenome ?? 'proposer',
    fissionTriggers: overrides?.fissionTriggers ?? [FissionTrigger.MANUAL_ONLY],
    maxFusionDurationMs: overrides?.maxFusionDurationMs ?? 0,
  };
}

// ═══════════════════════════════════════
// Fusion Proposal Tests
// ═══════════════════════════════════════

describe('FusionEngine — Proposals', () => {
  let engine: FusionEngine;
  let soulA: LifeformSoul;
  let soulB: LifeformSoul;

  beforeEach(() => {
    engine = new FusionEngine();
    soulA = makeSoul('sensor-a');
    soulB = makeSoul('processor-b');
  });

  it('should create a fusion proposal', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig());
    assert.ok(proposal);
    assert.ok(proposal.id.length === 16);

    const record = engine.getProposal(proposal.id);
    assert.ok(record);
    assert.equal(record.status, FusionStatus.PROPOSED);
  });

  it('should accept a proposal', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig());
    assert.equal(engine.accept(proposal.id, soulB), true);

    const record = engine.getProposal(proposal.id);
    assert.equal(record!.status, FusionStatus.ACCEPTED);
    assert.equal(record!.soulB!.name, 'processor-b');
  });

  it('should reject a proposal', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig());
    assert.equal(engine.reject(proposal.id), true);

    const record = engine.getProposal(proposal.id);
    assert.equal(record!.status, FusionStatus.REJECTED);
  });

  it('should expire proposals past deadline', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig(), 1); // 1ms expiry
    // Force expiry by backdating
    const record = engine.getProposal(proposal.id)!;
    record.proposal.expiresAt = Date.now() - 100;

    assert.equal(engine.accept(proposal.id, soulB), false);
    assert.equal(record.status, FusionStatus.EXPIRED);
  });

  it('should not accept already rejected proposals', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig());
    engine.reject(proposal.id);
    assert.equal(engine.accept(proposal.id, soulB), false);
  });

  it('should track proposal stats', () => {
    engine.propose(soulA, soulB.id, makeConfig());
    const p2 = engine.propose(soulA, soulB.id, makeConfig());
    engine.reject(p2.id);

    const stats = engine.getStats();
    assert.equal(stats.totalProposals, 2);
    assert.equal(stats.totalRejections, 1);
    assert.equal(stats.pendingProposals, 1);
  });
});

// ═══════════════════════════════════════
// Fusion Execution Tests
// ═══════════════════════════════════════

describe('FusionEngine — Execute', () => {
  let engine: FusionEngine;
  let soulA: LifeformSoul;
  let soulB: LifeformSoul;

  beforeEach(() => {
    engine = new FusionEngine();
    soulA = makeSoul('sensor-a');
    soulB = makeSoul('processor-b');
  });

  it('should execute fusion with NAMESPACE_PREFIX strategy', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig({
      stateConflictStrategy: StateConflictStrategy.NAMESPACE_PREFIX,
    }));
    engine.accept(proposal.id, soulB);

    const stateA = new CRDTState('a');
    stateA.set('temp', 25);
    stateA.set('humidity', 60);

    const stateB = new CRDTState('b');
    stateB.set('result', 'ok');
    stateB.set('temp', 30); // Same key name as A

    const record = engine.execute(
      proposal.id, stateA, stateB,
      100, 80, randomBytes(32), randomBytes(32),
    );

    assert.ok(record);
    assert.equal(record.status, FusionStatus.ACTIVE);
    assert.ok(record.mergedState);

    // Check namespaced keys
    assert.equal(record.mergedState!.get('sensor-a.temp'), 25);
    assert.equal(record.mergedState!.get('sensor-a.humidity'), 60);
    assert.equal(record.mergedState!.get('processor-b.result'), 'ok');
    assert.equal(record.mergedState!.get('processor-b.temp'), 30);
  });

  it('should execute fusion with CRDT_MERGE strategy', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig({
      stateConflictStrategy: StateConflictStrategy.CRDT_MERGE,
    }));
    engine.accept(proposal.id, soulB);

    const stateA = new CRDTState('a');
    stateA.increment('count', 5);

    const stateB = new CRDTState('b');
    stateB.increment('count', 3);

    const record = engine.execute(
      proposal.id, stateA, stateB,
      50, 50, randomBytes(32), randomBytes(32),
    );

    assert.ok(record);
    // PNCounters merge: 5 + 3 = 8
    assert.equal(record.mergedState!.get('count'), 8);
  });

  it('should pool CCU with contribution ratio', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig({
      ccuContributionRatio: 0.6, // A contributes 60%
    }));
    engine.accept(proposal.id, soulB);

    const record = engine.execute(
      proposal.id, new CRDTState('a'), new CRDTState('b'),
      100, 80, randomBytes(32), randomBytes(32),
    );

    assert.ok(record);
    // A contributes 100*0.6=60, B contributes 80*0.4=32 → pool=92
    assert.equal(record.pooledCcu, 92);
    // A escrow: 100-60=40, B escrow: 80-32=48
    assert.equal(record.escrowA, 40);
    assert.equal(record.escrowB, 48);
  });

  it('should create composite soul and genome', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig({
      primaryGenome: 'proposer',
    }));
    engine.accept(proposal.id, soulB);

    const hashA = randomBytes(32);
    const hashB = randomBytes(32);

    const record = engine.execute(
      proposal.id, new CRDTState('a'), new CRDTState('b'),
      50, 50, hashA, hashB,
    );

    assert.ok(record!.compositeSoul);
    assert.equal(record!.compositeSoul!.components.length, 2);
    assert.equal(record!.compositeSoul!.components[0].name, 'sensor-a');
    assert.equal(record!.compositeSoul!.components[1].name, 'processor-b');

    assert.ok(record!.compositeGenome);
    assert.equal(record!.compositeGenome!.executionOrder, 'a_first');
    assert.equal(record!.compositeGenome!.stateNamespaces.componentA, 'sensor-a');
  });

  it('should index active fusions', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig());
    engine.accept(proposal.id, soulB);

    const record = engine.execute(
      proposal.id, new CRDTState('a'), new CRDTState('b'),
      50, 50, randomBytes(32), randomBytes(32),
    );

    assert.ok(record);
    assert.equal(engine.isFused(soulA.id), true);
    assert.equal(engine.isFused(soulB.id), true);
    assert.equal(engine.getActiveFusions().length, 1);
  });

  it('should not execute unaccepted proposal', () => {
    const proposal = engine.propose(soulA, soulB.id, makeConfig());
    // Not accepted

    const result = engine.execute(
      proposal.id, new CRDTState('a'), new CRDTState('b'),
      50, 50, randomBytes(32), randomBytes(32),
    );
    assert.equal(result, null);
  });
});

// ═══════════════════════════════════════
// Fission Tests
// ═══════════════════════════════════════

describe('FusionEngine — Fission', () => {
  let engine: FusionEngine;
  let soulA: LifeformSoul;
  let soulB: LifeformSoul;

  function setupActiveFusion(config?: Partial<FusionConfig>): FusionRecord {
    const proposal = engine.propose(soulA, soulB.id, makeConfig(config));
    engine.accept(proposal.id, soulB);

    const stateA = new CRDTState('a');
    stateA.set('temp', 25);
    const stateB = new CRDTState('b');
    stateB.set('result', 'ok');

    return engine.execute(
      proposal.id, stateA, stateB,
      100, 80, randomBytes(32), randomBytes(32),
    )!;
  }

  beforeEach(() => {
    engine = new FusionEngine();
    soulA = makeSoul('sensor-a');
    soulB = makeSoul('processor-b');
  });

  it('should fission composite back to components', () => {
    const record = setupActiveFusion();
    const compositeId = record.compositeSoul!.compositeId;

    const result = engine.fission(compositeId, record.mergedState!, 120, 'manual');

    assert.ok(result);
    assert.deepEqual(result.compositeId, compositeId);
    assert.ok(result.componentA.stateKeys.length > 0);
    assert.ok(result.componentB.stateKeys.length > 0);
    assert.equal(result.trigger, 'manual');
  });

  it('should partition state keys by namespace', () => {
    const record = setupActiveFusion();
    const compositeId = record.compositeSoul!.compositeId;

    // Add some shared state
    record.mergedState!.set('shared.status', 'active');

    const result = engine.fission(compositeId, record.mergedState!, 100);

    assert.ok(result);
    // sensor-a.* keys → component A
    assert.ok(result.componentA.stateKeys.some(k => k.includes('sensor-a')));
    // processor-b.* keys → component B
    assert.ok(result.componentB.stateKeys.some(k => k.includes('processor-b')));
    // shared.* keys → both
    assert.ok(result.componentA.stateKeys.some(k => k.includes('shared')));
    assert.ok(result.componentB.stateKeys.some(k => k.includes('shared')));
  });

  it('should divide CCU correctly on fission', () => {
    const record = setupActiveFusion({ ccuContributionRatio: 0.5 });
    const compositeId = record.compositeSoul!.compositeId;
    // escrowA=50, escrowB=40, pool=90

    // Composite earned extra CCU while fused
    const currentBalance = 150; // 90 pool + 60 earned

    const result = engine.fission(compositeId, record.mergedState!, currentBalance);

    assert.ok(result);
    // A: escrow(50) + earned*0.5
    // B: escrow(40) + earned*0.5
    assert.ok(result.componentA.ccuBalance > 0);
    assert.ok(result.componentB.ccuBalance > 0);
    // Total should roughly equal currentBalance
    const total = result.componentA.ccuBalance + result.componentB.ccuBalance;
    assert.ok(Math.abs(total - currentBalance) < 1, `Total ${total} should ≈ ${currentBalance}`);
  });

  it('should clean up indices on fission', () => {
    const record = setupActiveFusion();
    const compositeId = record.compositeSoul!.compositeId;

    assert.equal(engine.isFused(soulA.id), true);
    assert.equal(engine.isFused(soulB.id), true);

    engine.fission(compositeId, record.mergedState!, 100);

    assert.equal(engine.isFused(soulA.id), false);
    assert.equal(engine.isFused(soulB.id), false);
    assert.equal(engine.getActiveFusions().length, 0);
  });

  it('should not fission non-active fusion', () => {
    const result = engine.fission(randomBytes(16), new CRDTState('x'), 100);
    assert.equal(result, null);
  });

  it('should check fission triggers — LOW_CCU', () => {
    const record = setupActiveFusion({
      fissionTriggers: [FissionTrigger.LOW_CCU],
    });
    const cid = record.compositeSoul!.compositeId;

    assert.equal(engine.checkFissionTriggers(cid, 50, 0), null); // CCU OK
    assert.equal(engine.checkFissionTriggers(cid, 0.5, 0), FissionTrigger.LOW_CCU);
  });

  it('should check fission triggers — DURATION_EXPIRED', () => {
    const record = setupActiveFusion({
      fissionTriggers: [FissionTrigger.DURATION_EXPIRED],
      maxFusionDurationMs: 60000,
    });
    const cid = record.compositeSoul!.compositeId;

    assert.equal(engine.checkFissionTriggers(cid, 100, 30000), null); // Not expired
    assert.equal(engine.checkFissionTriggers(cid, 100, 60000), FissionTrigger.DURATION_EXPIRED);
  });

  it('should track fusion/fission stats', () => {
    setupActiveFusion();
    // Second fusion needs different souls (compositeId is deterministic now)
    soulA = makeSoul('sensor-x');
    soulB = makeSoul('processor-y');
    const record = setupActiveFusion();
    engine.fission(record.compositeSoul!.compositeId, record.mergedState!, 100);

    const stats = engine.getStats();
    assert.equal(stats.totalFusions, 2);
    assert.equal(stats.totalFissions, 1);
    assert.equal(stats.activeFusions, 1);
  });
});

// ═══════════════════════════════════════
// Full Lifecycle Integration
// ═══════════════════════════════════════

describe('FusionEngine — Full Lifecycle', () => {
  it('should handle propose → accept → execute → fission lifecycle', () => {
    const engine = new FusionEngine();
    const soulA = makeSoul('temp-sensor');
    const soulB = makeSoul('data-processor');

    // 1. Propose
    const proposal = engine.propose(soulA, soulB.id, makeConfig({
      compositeName: 'smart-sensor',
      stateConflictStrategy: StateConflictStrategy.NAMESPACE_PREFIX,
      ccuContributionRatio: 0.5,
      fissionTriggers: [FissionTrigger.MANUAL_ONLY],
    }));

    // 2. Accept
    engine.accept(proposal.id, soulB);

    // 3. Build states
    const stateA = new CRDTState('a');
    stateA.set('temperature', 25.5);
    stateA.increment('readings', 100);

    const stateB = new CRDTState('b');
    stateB.set('model', 'linear-v2');
    stateB.set('accuracy', 0.95);

    // 4. Execute fusion
    const record = engine.execute(
      proposal.id, stateA, stateB,
      200, 150, randomBytes(32), randomBytes(32),
    );

    assert.ok(record);
    assert.equal(record.status, FusionStatus.ACTIVE);
    assert.equal(record.mergedState!.get('temp-sensor.temperature'), 25.5);
    assert.equal(record.mergedState!.get('data-processor.model'), 'linear-v2');
    assert.equal(record.pooledCcu, 175); // 200*0.5 + 150*0.5

    // 5. Verify composite identity
    assert.ok(record.compositeSoul);
    assert.equal(record.compositeSoul!.components[0].name, 'temp-sensor');
    assert.equal(record.compositeSoul!.components[1].name, 'data-processor');

    // 6. Fission
    const fissionResult = engine.fission(
      record.compositeSoul!.compositeId,
      record.mergedState!,
      200, // Earned more while fused
    );

    assert.ok(fissionResult);
    assert.ok(fissionResult.componentA.ccuBalance > 0);
    assert.ok(fissionResult.componentB.ccuBalance > 0);
    assert.equal(engine.getActiveFusions().length, 0);
  });
});

/**
 * CMP v1.4 — Phase H Test Suite: Intent System
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-h.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  IntentRegistry,
  IntentVerifier,
  IntentSampler,
  ViolationHandler,
} from '../src/lifeform/intent';
import { CRDTState } from '../src/lifeform/crdt/crdt-state';
import {
  IntentContract,
  IntentSample,
  PredicateType,
  ViolationAction,
} from '../src/types/intent';

// ── Helpers ──

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeIntent(overrides?: Partial<IntentContract>): IntentContract {
  return {
    id: overrides?.id ?? randomBytes(16),
    lifeformId: overrides?.lifeformId ?? randomBytes(16),
    description: overrides?.description ?? 'Temperature stays below 30',
    predicate: overrides?.predicate ?? {
      type: PredicateType.VALUE_CHECK,
      stateKey: 'temp',
      operator: 'lt' as const,
      value: 30,
    },
    sampleIntervalMs: overrides?.sampleIntervalMs ?? 60000,
    samplesPerInterval: overrides?.samplesPerInterval ?? 3,
    violationAction: overrides?.violationAction ?? ViolationAction.NOTIFY,
    ccuStaked: overrides?.ccuStaked ?? 50,
    beneficiaryId: overrides?.beneficiaryId ?? randomBytes(16),
    activeSince: overrides?.activeSince ?? Date.now(),
    expiresAt: overrides?.expiresAt ?? 0,
    commitment: overrides?.commitment ?? randomBytes(64),
    violationThreshold: overrides?.violationThreshold ?? 3,
    consecutiveViolations: overrides?.consecutiveViolations ?? 0,
  };
}

function makeSample(intentId: Uint8Array, satisfied: boolean): IntentSample {
  return {
    id: randomBytes(16),
    intentId,
    samplerId: randomBytes(16),
    observedValue: satisfied ? '25' : '35',
    satisfied,
    sampledAt: Date.now(),
    signature: randomBytes(64),
  };
}

// ═══════════════════════════════════════
// IntentRegistry Tests
// ═══════════════════════════════════════

describe('IntentRegistry', () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  it('should declare an intent', () => {
    const intent = makeIntent();
    assert.equal(registry.declare(intent), true);
    assert.equal(registry.size, 1);
    assert.ok(registry.get(intent.id));
  });

  it('should reject duplicate intent ID', () => {
    const intent = makeIntent();
    registry.declare(intent);
    assert.equal(registry.declare(intent), false);
  });

  it('should get intents for a Lifeform', () => {
    const lfId = randomBytes(16);
    registry.declare(makeIntent({ lifeformId: lfId }));
    registry.declare(makeIntent({ lifeformId: lfId }));
    registry.declare(makeIntent()); // Different LF

    assert.equal(registry.getForLifeform(lfId).length, 2);
  });

  it('should revoke an intent with penalty', () => {
    const intent = makeIntent({ ccuStaked: 100 });
    registry.declare(intent);

    const { revoked, ccuReturned } = registry.revoke(intent.id);
    assert.equal(revoked, true);
    assert.equal(ccuReturned, 90); // 100 - 10% penalty
    assert.equal(registry.size, 0);
  });

  it('should track consecutive violations', () => {
    const intent = makeIntent({ violationThreshold: 3 });
    registry.declare(intent);

    assert.equal(registry.recordViolation(intent.id), false); // 1 of 3
    assert.equal(registry.recordViolation(intent.id), false); // 2 of 3
    assert.equal(registry.recordViolation(intent.id), true);  // 3 of 3 — threshold!
  });

  it('should reset violations', () => {
    const intent = makeIntent({ violationThreshold: 3 });
    registry.declare(intent);

    registry.recordViolation(intent.id);
    registry.recordViolation(intent.id);
    registry.resetViolations(intent.id);
    assert.equal(registry.recordViolation(intent.id), false); // Reset to 1
  });

  it('should remove all intents for a Lifeform', () => {
    const lfId = randomBytes(16);
    registry.declare(makeIntent({ lifeformId: lfId }));
    registry.declare(makeIntent({ lifeformId: lfId }));

    assert.equal(registry.removeAllFor(lfId), 2);
    assert.equal(registry.size, 0);
  });

  it('should filter expired intents', () => {
    registry.declare(makeIntent({ expiresAt: Date.now() - 1000 })); // Expired
    registry.declare(makeIntent({ expiresAt: 0 })); // Permanent
    registry.declare(makeIntent({ expiresAt: Date.now() + 60000 })); // Active

    assert.equal(registry.getActive().length, 2);
  });
});

// ═══════════════════════════════════════
// IntentVerifier Tests
// ═══════════════════════════════════════

describe('IntentVerifier', () => {
  let verifier: IntentVerifier;
  let state: CRDTState;

  beforeEach(() => {
    verifier = new IntentVerifier();
    state = new CRDTState('test-node');
    state.set('temp', 25);
    state.set('humidity', 60);
    state.set('status', 'active');
    state.increment('count', 5);
  });

  it('should evaluate lt operator', () => {
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'lt', value: 30 }, state), true);
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'lt', value: 20 }, state), false);
  });

  it('should evaluate gt operator', () => {
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'gt', value: 20 }, state), true);
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'gt', value: 30 }, state), false);
  });

  it('should evaluate eq operator', () => {
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'status', operator: 'eq', value: 'active' }, state), true);
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'status', operator: 'eq', value: 'idle' }, state), false);
  });

  it('should evaluate between operator', () => {
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'between', value: [20, 30] }, state), true);
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'between', value: [30, 40] }, state), false);
  });

  it('should evaluate not_empty operator', () => {
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'status', operator: 'not_empty', value: '' }, state), true);
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'missing', operator: 'not_empty', value: '' }, state), false);
  });

  it('should evaluate compound AND predicate', () => {
    const predicate = {
      type: PredicateType.COMPOUND,
      stateKey: '',
      operator: 'eq' as const,
      value: 0,
      logicOperator: 'and' as const,
      children: [
        { type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'lt' as const, value: 30 },
        { type: PredicateType.VALUE_CHECK, stateKey: 'humidity', operator: 'gt' as const, value: 50 },
      ],
    };
    assert.equal(verifier.evaluate(predicate, state), true);
  });

  it('should evaluate compound OR predicate', () => {
    const predicate = {
      type: PredicateType.COMPOUND,
      stateKey: '',
      operator: 'eq' as const,
      value: 0,
      logicOperator: 'or' as const,
      children: [
        { type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'gt' as const, value: 100 }, // false
        { type: PredicateType.VALUE_CHECK, stateKey: 'humidity', operator: 'gt' as const, value: 50 }, // true
      ],
    };
    assert.equal(verifier.evaluate(predicate, state), true);
  });

  it('should fail compound AND when one child fails', () => {
    const predicate = {
      type: PredicateType.COMPOUND,
      stateKey: '',
      operator: 'eq' as const,
      value: 0,
      logicOperator: 'and' as const,
      children: [
        { type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'lt' as const, value: 30 }, // true
        { type: PredicateType.VALUE_CHECK, stateKey: 'temp', operator: 'gt' as const, value: 100 }, // false
      ],
    };
    assert.equal(verifier.evaluate(predicate, state), false);
  });

  it('should return false for missing keys', () => {
    assert.equal(verifier.evaluate({ type: PredicateType.VALUE_CHECK, stateKey: 'missing', operator: 'lt', value: 30 }, state), false);
  });
});

// ═══════════════════════════════════════
// IntentSampler Tests
// ═══════════════════════════════════════

describe('IntentSampler', () => {
  let sampler: IntentSampler;

  beforeEach(() => {
    sampler = new IntentSampler();
  });

  it('should start a sampling round', () => {
    const intent = makeIntent({ samplesPerInterval: 3 });
    const round = sampler.startRound(intent, ['peer-a', 'peer-b', 'peer-c', 'peer-d']);

    assert.ok(round);
    assert.equal(round.selectedPeers.length, 3);
    assert.equal(round.status, 'collecting');
  });

  it('should return null with no peers', () => {
    assert.equal(sampler.startRound(makeIntent(), []), null);
  });

  it('should evaluate when all samples collected — majority satisfied', () => {
    const intent = makeIntent({ samplesPerInterval: 3 });
    const round = sampler.startRound(intent, ['a', 'b', 'c'])!;

    sampler.recordSample(intent.id, makeSample(intent.id, true));
    sampler.recordSample(intent.id, makeSample(intent.id, true));
    sampler.recordSample(intent.id, makeSample(intent.id, false));

    // Round should auto-complete
    assert.equal(round.status, 'complete');
    assert.equal(round.result, true); // 2/3 satisfied
  });

  it('should detect violation — majority not satisfied', () => {
    const intent = makeIntent({ samplesPerInterval: 3 });
    sampler.startRound(intent, ['a', 'b', 'c']);

    sampler.recordSample(intent.id, makeSample(intent.id, false));
    sampler.recordSample(intent.id, makeSample(intent.id, false));
    sampler.recordSample(intent.id, makeSample(intent.id, true));

    const stats = sampler.getStats();
    assert.equal(stats.totalViolations, 1);
  });

  it('should force-complete a round on timeout', () => {
    const intent = makeIntent({ samplesPerInterval: 5 });
    sampler.startRound(intent, ['a', 'b', 'c', 'd', 'e']);

    // Only 2 of 5 samples arrive
    sampler.recordSample(intent.id, makeSample(intent.id, true));
    sampler.recordSample(intent.id, makeSample(intent.id, false));

    const result = sampler.forceComplete(intent.id);
    assert.ok(result);
    assert.equal(result.samplesCollected, 2);
  });
});

// ═══════════════════════════════════════
// ViolationHandler Tests
// ═══════════════════════════════════════

describe('ViolationHandler', () => {
  let handler: ViolationHandler;

  beforeEach(() => {
    handler = new ViolationHandler();
  });

  it('should handle NOTIFY violation', () => {
    let notified = false;
    handler.setCallbacks({ onNotify: () => { notified = true; } });

    const intent = makeIntent({ violationAction: ViolationAction.NOTIFY });
    handler.handleViolation(intent);

    assert.equal(notified, true);
    assert.equal(handler.getHistory().length, 1);
  });

  it('should handle SLASH violation', () => {
    let slashedAmount = 0;
    handler.setCallbacks({ onSlash: (_id, amount) => { slashedAmount = amount; } });

    const intent = makeIntent({ violationAction: ViolationAction.SLASH, ccuStaked: 50 });
    const record = handler.handleViolation(intent);

    assert.equal(slashedAmount, 50);
    assert.equal(record.ccuSlashed, 50);
  });

  it('should handle KILL violation (slash + kill)', () => {
    let killed = false;
    let slashed = false;
    handler.setCallbacks({
      onSlash: () => { slashed = true; },
      onKill: () => { killed = true; },
    });

    const intent = makeIntent({ violationAction: ViolationAction.KILL });
    handler.handleViolation(intent);

    assert.equal(slashed, true);
    assert.equal(killed, true);
  });

  it('should handle FORCE_FISSION violation', () => {
    let fissioned = false;
    handler.setCallbacks({ onForceFission: () => { fissioned = true; } });

    const intent = makeIntent({ violationAction: ViolationAction.FORCE_FISSION });
    handler.handleViolation(intent);

    assert.equal(fissioned, true);
  });

  it('should track violation count per Lifeform', () => {
    const lfId = randomBytes(16);
    handler.handleViolation(makeIntent({ lifeformId: lfId }));
    handler.handleViolation(makeIntent({ lifeformId: lfId }));
    handler.handleViolation(makeIntent()); // Different LF

    assert.equal(handler.getViolationCount(lfId), 2);
  });
});

// ═══════════════════════════════════════
// Full Intent Lifecycle
// ═══════════════════════════════════════

describe('Intent System — Full Lifecycle', () => {
  it('should declare → verify → sample → violate → slash', () => {
    const registry = new IntentRegistry();
    const verifier = new IntentVerifier();
    const sampler = new IntentSampler();
    const violationHandler = new ViolationHandler();

    let slashedCcu = 0;
    violationHandler.setCallbacks({
      onSlash: (_id, amount) => { slashedCcu = amount; },
    });

    // 1. Declare intent: temp must stay below 30
    const intent = makeIntent({
      violationAction: ViolationAction.SLASH,
      ccuStaked: 100,
      violationThreshold: 2,
      samplesPerInterval: 3,
    });
    registry.declare(intent);

    // 2. First check: temp=25 → satisfied
    const state1 = new CRDTState('node');
    state1.set('temp', 25);
    const eval1 = verifier.evaluateIntent(intent, state1);
    assert.equal(eval1.satisfied, true);
    registry.resetViolations(intent.id);

    // 3. Second check: temp=35 → violated!
    const state2 = new CRDTState('node');
    state2.set('temp', 35);
    const eval2 = verifier.evaluateIntent(intent, state2);
    assert.equal(eval2.satisfied, false);
    registry.recordViolation(intent.id); // 1 of 2

    // 4. Third check: temp=32 → violated again!
    const state3 = new CRDTState('node');
    state3.set('temp', 32);
    const eval3 = verifier.evaluateIntent(intent, state3);
    assert.equal(eval3.satisfied, false);
    const thresholdCrossed = registry.recordViolation(intent.id); // 2 of 2
    assert.equal(thresholdCrossed, true);

    // 5. Execute violation action
    const record = violationHandler.handleViolation(intent);
    assert.equal(record.ccuSlashed, 100);
    assert.equal(slashedCcu, 100);
  });
});

/**
 * CMP v1.4 — Phase J: Example Scenarios
 * Integration tests demonstrating the full Lifeform system.
 *
 *   1. echo-counter: simple causal model test
 *   2. sensor-fusion: two sensor Lifeforms FUSE during emergency
 *   3. evolving-processor: self-mutating data processor
 *   4. intent-monitor: temperature monitor with intent contract
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-j.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LifeformManager } from '../src/lifeform/manager';
import { FusionEngine } from '../src/lifeform/fusion';
import { GenomeMutator, FitnessEvaluator, SelectionPressure, GenerationTracker, Genome } from '../src/lifeform/evolution';
import { IntentRegistry, IntentVerifier, ViolationHandler } from '../src/lifeform/intent';
import { DistributionBridge } from '../src/lifeform/distribution-bridge';
import { CRDTState } from '../src/lifeform/crdt/crdt-state';
import { LifeformConfig, LifeformState } from '../src/types/lifeform';
import { Cause, CauseType } from '../src/types/causal';
import { StateConflictStrategy, FissionTrigger } from '../src/types/fusion';
import { MutationType } from '../src/types/evolution';
import { PredicateType, ViolationAction } from '../src/types/intent';
import { TaskType } from '../src/types/task';
import { generateKeypair, generateId } from '../src/lifeform/crypto';

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function makeCause(overrides?: Partial<Cause>): Cause {
  return {
    id: randomBytes(16),
    type: overrides?.type ?? CauseType.MESSAGE,
    chainId: randomBytes(16),
    chainDepth: 0,
    maxChainDepth: 64,
    deadlineMs: 0,
    sourceId: randomBytes(16),
    sourceType: 'device',
    targetId: randomBytes(16),
    payload: overrides?.payload ?? new Uint8Array([1]),
    ccuAttached: overrides?.ccuAttached ?? 0,
    expectsResponse: false,
    correlationId: null,
    emittedAt: Date.now(),
  };
}

function makeConfig(name: string, opts?: Partial<LifeformConfig>): LifeformConfig {
  return {
    name,
    wasmModule: new Uint8Array([0, 0x61, 0x73, 0x6d]),
    initialState: opts?.initialState,
    initialCcu: opts?.initialCcu ?? 200,
    minReplicas: 1, maxReplicas: 3,
    autoMigrate: true,
    mutationLibraryHash: null,
    maxCausesPerSecond: 100,
    maxStateSizeBytes: 1024 * 1024,
  };
}

// ═══════════════════════════════════════
// Example 1: Echo-Counter
// ═══════════════════════════════════════

describe('Example: echo-counter', () => {
  let mgr: LifeformManager;

  afterEach(() => mgr.stop());

  it('should count incoming causes and track CCU spend', async () => {
    mgr = new LifeformManager({ deviceId: 'dev-1' });
    mgr.start();

    const hosted = mgr.spawn(makeConfig('echo-counter', {
      initialCcu: 100,
      initialState: { count: 0, lastPayload: '' },
    }))!;

    mgr.setHandler('echo-counter', async (cause) => {
      const count = hosted.state.get('count') ?? 0;
      hosted.state.set('count', count + 1);
      hosted.state.set('lastPayload', new TextDecoder().decode(cause.payload));
      return { stateMutations: 2, outgoingCauses: [] };
    });

    // Send 10 causes with different payloads
    for (let i = 0; i < 10; i++) {
      await mgr.deliverCause('echo-counter', makeCause({
        payload: new TextEncoder().encode(`msg-${i}`),
      }));
    }

    assert.equal(hosted.state.get('count'), 10);
    assert.equal(hosted.state.get('lastPayload'), 'msg-9');
    assert.equal(hosted.lifecycle.causesProcessed, 10);
    assert.ok(hosted.lifecycle.ccuBalance < 100); // CCU was spent
    assert.ok(hosted.lifecycle.ccuBalance > 0);   // But not depleted
  });
});

// ═══════════════════════════════════════
// Example 2: Sensor Fusion
// ═══════════════════════════════════════

describe('Example: sensor-fusion', () => {
  it('should fuse two sensors during emergency and split after', () => {
    const fusionEngine = new FusionEngine();

    // Two independent temperature sensors
    const kpA = generateKeypair();
    const soulA = {
      id: generateId(), name: 'temp-sensor-floor1',
      publicKey: kpA.publicKey, secretKey: kpA.secretKey,
      creatorId: generateId(), bornAt: Date.now(),
      generation: 0, parentId: null,
    };
    const kpB = generateKeypair();
    const soulB = {
      id: generateId(), name: 'temp-sensor-floor2',
      publicKey: kpB.publicKey, secretKey: kpB.secretKey,
      creatorId: generateId(), bornAt: Date.now(),
      generation: 0, parentId: null,
    };

    // Each sensor has its own state
    const stateA = new CRDTState('a');
    stateA.set('temperature', 28);
    stateA.set('location', 'Floor 1');
    stateA.increment('readings', 500);

    const stateB = new CRDTState('b');
    stateB.set('temperature', 45); // EMERGENCY — fire detected!
    stateB.set('location', 'Floor 2');
    stateB.increment('readings', 480);

    // Emergency triggers fusion: combine both sensors into one entity
    const proposal = fusionEngine.propose(soulA, soulB.id, {
      compositeName: 'fire-response-unit',
      stateConflictStrategy: StateConflictStrategy.NAMESPACE_PREFIX,
      ccuContributionRatio: 0.5,
      primaryGenome: 'target', // B has the emergency — it leads
      fissionTriggers: [FissionTrigger.DURATION_EXPIRED],
      maxFusionDurationMs: 300000, // 5 minutes
    });

    fusionEngine.accept(proposal.id, soulB);
    const record = fusionEngine.execute(
      proposal.id, stateA, stateB,
      100, 80, randomBytes(32), randomBytes(32),
    )!;

    // Verify composite has both sensors' data
    assert.equal(record.status, 'active');
    assert.equal(record.mergedState!.get('temp-sensor-floor1.temperature'), 28);
    assert.equal(record.mergedState!.get('temp-sensor-floor2.temperature'), 45);
    assert.equal(record.mergedState!.get('temp-sensor-floor1.location'), 'Floor 1');
    assert.equal(record.compositeGenome!.executionOrder, 'b_first'); // B leads

    // After emergency passes, fission back
    const fissionResult = fusionEngine.fission(
      record.compositeSoul!.compositeId,
      record.mergedState!,
      200, // Earned CCU while fused
      FissionTrigger.DURATION_EXPIRED,
    );

    assert.ok(fissionResult);
    assert.ok(fissionResult.componentA.ccuBalance > 0);
    assert.ok(fissionResult.componentB.ccuBalance > 0);
    // Both sensors restored independently
    assert.ok(fissionResult.componentA.stateKeys.some(k => k.includes('temp-sensor-floor1')));
    assert.ok(fissionResult.componentB.stateKeys.some(k => k.includes('temp-sensor-floor2')));
  });
});

// ═══════════════════════════════════════
// Example 3: Evolving Processor
// ═══════════════════════════════════════

describe('Example: evolving-processor', () => {
  it('should mutate genome and select fitter variant', () => {
    const mutator = new GenomeMutator();
    const evaluator = new FitnessEvaluator();
    const selection = new SelectionPressure();
    const tracker = new GenerationTracker();

    // Gen 0: data processor with initial constants
    let genome: Genome = {
      hash: randomBytes(32),
      functions: new Map([
        ['process', new Uint8Array([0x01, 0x02, 0x03])],
        ['filter', new Uint8Array([0x10, 0x20])],
      ]),
      constants: [0.5, 100, 0.01], // threshold, batchSize, learningRate
      globals: new Map([['maxRetries', 3]]),
      generation: 0,
      parentHash: null,
    };

    // Gen 1: mutate the threshold constant
    const mutant = mutator.mutate(genome, {
      parentId: randomBytes(16),
      mutationType: MutationType.CONSTANT_MUTATION,
      params: { constantIndex: 0, newConstantValue: 0.7 },
      libraryHash: randomBytes(32),
      evaluationPeriodMs: 5000,
    })!;
    assert.equal(mutant.constants[0], 0.7);
    assert.equal(mutant.generation, 1);

    // Evaluate: mutant performs better
    const session = evaluator.startEvaluation(
      randomBytes(16), randomBytes(16),
      { parentId: randomBytes(16), mutationType: MutationType.CONSTANT_MUTATION,
        params: {}, libraryHash: randomBytes(32), evaluationPeriodMs: 5000 }, 1,
    );
    for (let i = 0; i < 10; i++) {
      evaluator.recordExecution(session, true, 80, 0.1, 0.05, false);  // Parent: slow
      evaluator.recordExecution(session, false, 30, 0.05, 0.15, false); // Mutant: fast + efficient
    }
    const result = evaluator.evaluate(session)!;
    assert.equal(result.winner, 'mutant');

    // Track lineage
    tracker.record('data-processor', result);
    assert.equal(tracker.getGeneration('data-processor'), 1);

    // Mutant survives — apply selection
    const survives = selection.shouldSurvive(0.8, 0.7, 0.9);
    assert.equal(survives.survives, true);

    // Promote mutant
    genome = mutant;
    assert.equal(genome.generation, 1);
  });
});

// ═══════════════════════════════════════
// Example 4: Intent Monitor
// ═══════════════════════════════════════

describe('Example: intent-monitor', () => {
  let mgr: LifeformManager;

  afterEach(() => mgr?.stop());

  it('should monitor temperature and slash on violation', async () => {
    mgr = new LifeformManager({ deviceId: 'dev-1' });
    mgr.start();

    const registry = new IntentRegistry();
    const verifier = new IntentVerifier();
    const violationHandler = new ViolationHandler();

    let slashedAmount = 0;
    let killedName = '';
    violationHandler.setCallbacks({
      onSlash: (_id, amount) => { slashedAmount = amount; },
      onKill: (_id, reason) => { killedName = reason; },
    });

    // Spawn a temperature monitor
    const hosted = mgr.spawn(makeConfig('temp-monitor', {
      initialCcu: 200,
      initialState: { temperature: 22 },
    }))!;

    mgr.setHandler('temp-monitor', async (cause) => {
      // Simulate temperature readings
      const temp = cause.payload[0]; // Use first byte as temp
      hosted.state.set('temperature', temp);
      return { stateMutations: 1, outgoingCauses: [] };
    });

    // Declare intent: temperature must stay below 35°C
    const intent = {
      id: randomBytes(16),
      lifeformId: hosted.lifecycle.id,
      description: 'Temperature below 35°C',
      predicate: {
        type: PredicateType.VALUE_CHECK,
        stateKey: 'temperature',
        operator: 'lt' as const,
        value: 35,
      },
      sampleIntervalMs: 1000,
      samplesPerInterval: 3,
      violationAction: ViolationAction.SLASH,
      ccuStaked: 50,
      beneficiaryId: randomBytes(16),
      activeSince: Date.now(),
      expiresAt: 0,
      commitment: randomBytes(64),
      violationThreshold: 2,
      consecutiveViolations: 0,
    };
    registry.declare(intent);

    // Normal operation: temp=25 → intent satisfied
    await mgr.deliverCause('temp-monitor', makeCause({ payload: new Uint8Array([25]) }));
    const eval1 = verifier.evaluateIntent(intent, hosted.state);
    assert.equal(eval1.satisfied, true);

    // Temperature spike: temp=40 → violation!
    await mgr.deliverCause('temp-monitor', makeCause({ payload: new Uint8Array([40]) }));
    const eval2 = verifier.evaluateIntent(intent, hosted.state);
    assert.equal(eval2.satisfied, false);
    registry.recordViolation(intent.id);

    // Another spike: temp=38 → second violation, crosses threshold!
    await mgr.deliverCause('temp-monitor', makeCause({ payload: new Uint8Array([38]) }));
    const eval3 = verifier.evaluateIntent(intent, hosted.state);
    assert.equal(eval3.satisfied, false);
    const crossed = registry.recordViolation(intent.id);
    assert.equal(crossed, true);

    // Execute violation: slash 50 CCU
    violationHandler.handleViolation(intent);
    assert.equal(slashedAmount, 50);
  });
});

// ═══════════════════════════════════════
// Example 5: Orchestration
// ═══════════════════════════════════════

describe('Example: orchestration', () => {
  let mgr: LifeformManager;

  afterEach(() => mgr?.stop());

  it('should distribute work and receive result as cause', async () => {
    mgr = new LifeformManager({ deviceId: 'dev-1' });
    mgr.start();

    const bridge = new DistributionBridge();

    // Mock CMP pipeline: immediately returns a result
    bridge.onSubmit(async (req) => {
      // Simulate mesh processing
      const result = {
        requestId: req.id,
        resultData: new Uint8Array([99, 98, 97]), // processed data
        devicesUsed: 4,
        executionTimeMs: 200,
        ccuSpent: 3.5,
        success: true,
      };
      await bridge.handleResult(result);
    });

    // Wire result delivery to LifeformManager
    let resultReceived = false;
    bridge.onDeliverResult(async (name, cause) => {
      resultReceived = true;
      assert.equal(name, 'orchestrator');
      assert.equal(cause.type, CauseType.DISTRIBUTION_RESULT);
      assert.deepEqual(cause.payload, new Uint8Array([99, 98, 97]));
    });

    // Spawn orchestrator Lifeform
    mgr.spawn(makeConfig('orchestrator', { initialCcu: 100 }));

    // Submit distributed work
    await bridge.submit(
      randomBytes(16), 'orchestrator',
      randomBytes(32), new Uint8Array([1, 2, 3, 4, 5]),
      TaskType.MAP_REDUCE, 5000, 1, 10,
    );

    assert.equal(resultReceived, true);
    assert.equal(bridge.getStats().totalCompleted, 1);
  });
});

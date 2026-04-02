/**
 * CMP v1.4 — Phase G Test Suite: Evolution Engine
 *
 * Run: npx ts-node --transpile-only packages/core/tests/lifeform-phase-g.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GenomeMutator,
  Genome,
  FitnessEvaluator,
  SelectionPressure,
  GenerationTracker,
} from '../src/lifeform/evolution';
import { MutationType, MutationRequest } from '../src/types/evolution';

// ── Helpers ──

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function makeGenome(overrides?: Partial<Genome>): Genome {
  const g: Genome = {
    hash: randomBytes(32),
    functions: new Map([
      ['onCause', new Uint8Array([0x00, 0x61, 0x01, 0x02])],
      ['helper', new Uint8Array([0x10, 0x20, 0x30])],
      ['optional', new Uint8Array([0x40, 0x50])],
    ]),
    constants: [1.0, 0.5, 100, 3.14],
    globals: new Map([
      ['threshold', 30],
      ['rate', 0.1],
    ]),
    generation: 0,
    parentHash: null,
  };
  if (overrides?.functions) g.functions = overrides.functions;
  if (overrides?.constants) g.constants = overrides.constants;
  if (overrides?.globals) g.globals = overrides.globals;
  if (overrides?.generation !== undefined) g.generation = overrides.generation;
  return g;
}

function makeMutation(type: MutationType, params?: any): MutationRequest {
  return {
    parentId: randomBytes(16),
    mutationType: type,
    params: params ?? {},
    libraryHash: randomBytes(32),
    evaluationPeriodMs: 1000,
  };
}

// ═══════════════════════════════════════
// GenomeMutator Tests
// ═══════════════════════════════════════

describe('GenomeMutator', () => {
  let mutator: GenomeMutator;

  beforeEach(() => {
    mutator = new GenomeMutator();
  });

  it('should mutate a constant by explicit value', () => {
    const genome = makeGenome();
    const mutant = mutator.mutate(genome, makeMutation(MutationType.CONSTANT_MUTATION, {
      constantIndex: 0,
      newConstantValue: 42,
    }));

    assert.ok(mutant);
    assert.equal(mutant.constants[0], 42);
    assert.equal(genome.constants[0], 1.0); // Original unchanged
    assert.equal(mutant.generation, 1);
  });

  it('should mutate a constant by random perturbation', () => {
    const genome = makeGenome();
    const original = genome.constants[2]; // 100
    const mutant = mutator.mutate(genome, makeMutation(MutationType.CONSTANT_MUTATION, {
      constantIndex: 2,
    }));

    assert.ok(mutant);
    assert.notEqual(mutant.constants[2], original);
    // Within ±10% of 100
    assert.ok(mutant.constants[2] >= 90 && mutant.constants[2] <= 110);
  });

  it('should reject constant mutation with invalid index', () => {
    const genome = makeGenome();
    const result = mutator.mutate(genome, makeMutation(MutationType.CONSTANT_MUTATION, {
      constantIndex: 999,
    }));
    assert.equal(result, null);
  });

  it('should mutate a global variable', () => {
    const genome = makeGenome();
    const mutant = mutator.mutate(genome, makeMutation(MutationType.GLOBAL_MUTATION, {
      targetFunction: 'threshold',
      newConstantValue: 50,
    }));

    assert.ok(mutant);
    assert.equal(mutant.globals.get('threshold'), 50);
    assert.equal(genome.globals.get('threshold'), 30); // Original unchanged
  });

  it('should swap a function from mutation library', () => {
    const genome = makeGenome();
    const library = {
      hash: randomBytes(32),
      functions: new Map([
        ['betterHelper', new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD])],
      ]),
      compatibleGenomes: [],
      creatorId: randomBytes(16),
    };

    const mutant = mutator.mutate(genome, makeMutation(MutationType.FUNCTION_SWAP, {
      targetFunction: 'helper',
      replacementFunction: 'betterHelper',
    }), library);

    assert.ok(mutant);
    assert.deepEqual(mutant.functions.get('helper'), new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]));
  });

  it('should insert a function from library', () => {
    const genome = makeGenome();
    const library = {
      hash: randomBytes(32),
      functions: new Map([
        ['newFunc', new Uint8Array([0xFF, 0xEE])],
      ]),
      compatibleGenomes: [],
      creatorId: randomBytes(16),
    };

    const mutant = mutator.mutate(genome, makeMutation(MutationType.FUNCTION_INSERT, {
      replacementFunction: 'newFunc',
    }), library);

    assert.ok(mutant);
    assert.ok(mutant.functions.has('newFunc'));
    assert.equal(mutant.functions.size, 4); // 3 original + 1 new
  });

  it('should remove a function', () => {
    const genome = makeGenome();
    const mutant = mutator.mutate(genome, makeMutation(MutationType.FUNCTION_REMOVE, {
      targetFunction: 'optional',
    }));

    assert.ok(mutant);
    assert.equal(mutant.functions.has('optional'), false);
    assert.equal(mutant.functions.size, 2);
  });

  it('should crossover two parent genomes', () => {
    const parentA = makeGenome();
    const parentB = makeGenome({
      functions: new Map([
        ['onCause', new Uint8Array([0xAA, 0xBB])],
        ['unique_b', new Uint8Array([0xCC])],
      ]),
      constants: [99, 88],
      globals: new Map([['threshold', 50], ['speed', 5]]),
      generation: 2,
    });

    const child = mutator.crossover(parentA, parentB, 0.5);

    assert.ok(child);
    assert.equal(child.generation, 3); // max(0, 2) + 1
    // Should have functions from both parents
    assert.ok(child.functions.has('onCause'));
    // unique_b should be from B
    assert.ok(child.functions.has('unique_b'));
  });

  it('should track parent hash and generation', () => {
    const genome = makeGenome();
    const mutant = mutator.mutate(genome, makeMutation(MutationType.CONSTANT_MUTATION, {
      constantIndex: 0, newConstantValue: 1,
    }));

    assert.ok(mutant);
    assert.deepEqual(mutant.parentHash, genome.hash);
    assert.equal(mutant.generation, genome.generation + 1);
  });
});

// ═══════════════════════════════════════
// FitnessEvaluator Tests
// ═══════════════════════════════════════

describe('FitnessEvaluator', () => {
  let evaluator: FitnessEvaluator;

  beforeEach(() => {
    evaluator = new FitnessEvaluator();
  });

  it('should start an evaluation session', () => {
    const sessionId = evaluator.startEvaluation(
      randomBytes(16), randomBytes(16),
      makeMutation(MutationType.CONSTANT_MUTATION), 1,
    );

    assert.ok(sessionId);
    const session = evaluator.getSession(sessionId);
    assert.ok(session);
    assert.equal(session.status, 'running');
    assert.equal(evaluator.activeCount, 1);
  });

  it('should record execution metrics for parent and mutant', () => {
    const sessionId = evaluator.startEvaluation(
      randomBytes(16), randomBytes(16),
      makeMutation(MutationType.CONSTANT_MUTATION), 1,
    );

    evaluator.recordExecution(sessionId, true, 10, 0.05, 0.1, false);
    evaluator.recordExecution(sessionId, true, 20, 0.03, 0.08, false);
    evaluator.recordExecution(sessionId, false, 5, 0.04, 0.15, false);

    const session = evaluator.getSession(sessionId)!;
    assert.equal(session.parentMetrics.causesProcessed, 2);
    assert.equal(session.mutantMetrics.causesProcessed, 1);
  });

  it('should evaluate and declare winner', () => {
    const sessionId = evaluator.startEvaluation(
      randomBytes(16), randomBytes(16),
      makeMutation(MutationType.CONSTANT_MUTATION), 1,
    );

    // Parent: slow, expensive
    for (let i = 0; i < 5; i++) {
      evaluator.recordExecution(sessionId, true, 200, 0.5, 0.1, false);
    }
    // Mutant: fast, efficient
    for (let i = 0; i < 10; i++) {
      evaluator.recordExecution(sessionId, false, 20, 0.1, 0.5, false);
    }

    const result = evaluator.evaluate(sessionId);
    assert.ok(result);
    assert.equal(result.winner, 'mutant');
    assert.ok(result.mutantFitness.composite > result.parentFitness.composite);
  });

  it('should handle intent satisfaction in fitness', () => {
    const sessionId = evaluator.startEvaluation(
      randomBytes(16), randomBytes(16),
      makeMutation(MutationType.CONSTANT_MUTATION), 1,
    );

    evaluator.recordExecution(sessionId, true, 10, 0.05, 0.1, false);
    evaluator.recordIntentCheck(sessionId, true, true);
    evaluator.recordIntentCheck(sessionId, true, true);
    evaluator.recordIntentCheck(sessionId, true, false);

    const session = evaluator.getSession(sessionId)!;
    assert.equal(session.parentMetrics.intentsTotal, 3);
    assert.equal(session.parentMetrics.intentsSatisfied, 2);
  });

  it('should abort evaluation', () => {
    const sessionId = evaluator.startEvaluation(
      randomBytes(16), randomBytes(16),
      makeMutation(MutationType.CONSTANT_MUTATION), 1,
    );

    assert.equal(evaluator.abort(sessionId), true);
    assert.equal(evaluator.getSession(sessionId)!.status, 'aborted');
  });
});

// ═══════════════════════════════════════
// SelectionPressure Tests
// ═══════════════════════════════════════

describe('SelectionPressure', () => {
  let selection: SelectionPressure;

  beforeEach(() => {
    selection = new SelectionPressure({ minimumFitness: 0.3 });
  });

  it('should survive with high scores', () => {
    const result = selection.shouldSurvive(0.8, 0.7, 0.9);
    assert.equal(result.survives, true);
    assert.ok(result.compositeScore > 0.3);
  });

  it('should die with low scores', () => {
    const result = selection.shouldSurvive(0.1, 0.1, 0.1);
    assert.equal(result.survives, false);
    assert.ok(result.compositeScore < 0.3);
  });

  it('should weight economic pressure highest', () => {
    // High economic, low others
    const r1 = selection.shouldSurvive(0.9, 0.1, 0.1);
    // Low economic, high others
    const r2 = selection.shouldSurvive(0.1, 0.9, 0.9);

    // Economic weight=0.4, performance=0.4 — both matter equally
    // r1: 0.9*0.4 + 0.1*0.4 + 0.1*0.2 = 0.36+0.04+0.02 = 0.42
    // r2: 0.1*0.4 + 0.9*0.4 + 0.9*0.2 = 0.04+0.36+0.18 = 0.58
    assert.ok(r1.compositeScore > 0.3);
    assert.ok(r2.compositeScore > r1.compositeScore);
  });
});

// ═══════════════════════════════════════
// GenerationTracker Tests
// ═══════════════════════════════════════

describe('GenerationTracker', () => {
  let tracker: GenerationTracker;

  beforeEach(() => {
    tracker = new GenerationTracker();
  });

  it('should record and retrieve lineage', () => {
    const record = {
      generation: 1,
      parentGenomeHash: randomBytes(32),
      mutantGenomeHash: randomBytes(32),
      mutation: makeMutation(MutationType.CONSTANT_MUTATION),
      evaluationStartAt: Date.now(),
      evaluationEndAt: Date.now() + 1000,
      parentFitness: { avgResponseTimeMs: 50, ccuEfficiency: 0.5, errorRate: 0.1, throughput: 10, intentSatisfactionRate: 1, composite: 0.6 },
      mutantFitness: { avgResponseTimeMs: 30, ccuEfficiency: 0.7, errorRate: 0.05, throughput: 15, intentSatisfactionRate: 1, composite: 0.75 },
      winner: 'mutant' as const,
    };

    tracker.record('lf-1', record);
    assert.equal(tracker.getGeneration('lf-1'), 1);
    assert.equal(tracker.getLineage('lf-1').length, 1);
  });

  it('should track mutation win rate', () => {
    const makeRecord = (gen: number, winner: 'parent' | 'mutant') => ({
      generation: gen,
      parentGenomeHash: randomBytes(32),
      mutantGenomeHash: randomBytes(32),
      mutation: makeMutation(MutationType.CONSTANT_MUTATION),
      evaluationStartAt: Date.now(),
      evaluationEndAt: Date.now(),
      parentFitness: { avgResponseTimeMs: 50, ccuEfficiency: 0.5, errorRate: 0.1, throughput: 10, intentSatisfactionRate: 1, composite: 0.5 },
      mutantFitness: { avgResponseTimeMs: 50, ccuEfficiency: 0.5, errorRate: 0.1, throughput: 10, intentSatisfactionRate: 1, composite: 0.5 },
      winner,
    });

    tracker.record('lf-1', makeRecord(1, 'mutant'));
    tracker.record('lf-1', makeRecord(2, 'parent'));
    tracker.record('lf-1', makeRecord(3, 'mutant'));
    tracker.record('lf-1', makeRecord(4, 'mutant'));

    assert.equal(tracker.getMutationWinRate('lf-1'), 0.75);
    assert.equal(tracker.getGeneration('lf-1'), 4);
  });

  it('should return 0 for unknown Lifeforms', () => {
    assert.equal(tracker.getGeneration('unknown'), 0);
    assert.equal(tracker.getMutationWinRate('unknown'), 0);
    assert.equal(tracker.getLineage('unknown').length, 0);
  });
});

// ═══════════════════════════════════════
// Full Evolution Lifecycle
// ═══════════════════════════════════════

describe('Evolution — Full Lifecycle', () => {
  it('should mutate → evaluate → select → track across generations', () => {
    const mutator = new GenomeMutator();
    const evaluator = new FitnessEvaluator();
    const selection = new SelectionPressure();
    const tracker = new GenerationTracker();

    // Gen 0 genome
    let currentGenome = makeGenome();
    const lfId = 'evolving-sensor';

    // Gen 1: mutate a constant
    const mutant1 = mutator.mutate(currentGenome, makeMutation(MutationType.CONSTANT_MUTATION, {
      constantIndex: 0, newConstantValue: 2.0,
    }));
    assert.ok(mutant1);

    // Evaluate
    const session1 = evaluator.startEvaluation(
      randomBytes(16), randomBytes(16),
      makeMutation(MutationType.CONSTANT_MUTATION, { constantIndex: 0 }), 1,
    );
    // Mutant performs better
    for (let i = 0; i < 5; i++) {
      evaluator.recordExecution(session1, true, 100, 0.5, 0.1, false);
      evaluator.recordExecution(session1, false, 30, 0.1, 0.3, false);
    }
    const result1 = evaluator.evaluate(session1)!;
    assert.equal(result1.winner, 'mutant');

    // Track
    tracker.record(lfId, result1);
    assert.equal(tracker.getGeneration(lfId), 1);

    // Mutant survives → becomes new current genome
    currentGenome = mutant1;

    // Gen 2: remove a function
    const mutant2 = mutator.mutate(currentGenome, makeMutation(MutationType.FUNCTION_REMOVE, {
      targetFunction: 'optional',
    }));
    assert.ok(mutant2);
    assert.equal(mutant2.generation, 2);

    // Selection check
    const survivalCheck = selection.shouldSurvive(0.7, 0.6, 0.8);
    assert.equal(survivalCheck.survives, true);

    // Track gen 2
    tracker.record(lfId, {
      ...result1,
      generation: 2,
      winner: 'parent', // This time parent was better
    });

    assert.equal(tracker.getGeneration(lfId), 2);
    assert.equal(tracker.getMutationWinRate(lfId), 0.5); // 1 win, 1 loss
  });
});

/**
 * CMP v3.0 — Meta-Evolution Tests
 *
 * Tests protocol parameter mutation, fitness evaluation,
 * generation tracking, and composite scoring.
 *
 * Run: npx tsx packages/core/tests/meta-evolution.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ProtocolEvolver } from '../src/meta-evolution/evolver';
import type { FitnessCollector } from '../src/meta-evolution/evolver';
import type { ProtocolGenome, ProtocolFitness } from '../src/types/meta-evolution';
import { DEFAULT_PROTOCOL_GENOME } from '../src/types/meta-evolution';

// ─── Mock Fitness Collector ───

class MockCollector implements FitnessCollector {
  appliedGenomes: ProtocolGenome[] = [];
  private fitness: ProtocolFitness;

  constructor(fitness?: Partial<ProtocolFitness>) {
    this.fitness = {
      throughput: 500,
      faultRecoveryMs: 200,
      ccuEfficiency: 1.2,
      intentSatisfaction: 0.9,
      avgCauseLatencyMs: 15,
      periodMs: 60000,
      ...fitness,
    };
  }

  collectFitness(): ProtocolFitness {
    return { ...this.fitness };
  }

  applyGenome(genome: ProtocolGenome): void {
    this.appliedGenomes.push({ ...genome });
  }

  setFitness(fitness: Partial<ProtocolFitness>): void {
    this.fitness = { ...this.fitness, ...fitness };
  }
}

// ═══════════════════════════════════════

describe('ProtocolEvolver', () => {

  describe('Initialization', () => {
    it('should start with default genome', () => {
      const evolver = new ProtocolEvolver();
      const genome = evolver.getActiveGenome();
      assert.equal(genome.fusionCcuThreshold, 1);
      assert.equal(genome.intentSampleIntervalMs, 30000);
      assert.equal(genome.catabolicThreshold, 0.30);
    });

    it('should accept custom initial genome', () => {
      const evolver = new ProtocolEvolver({ fusionCcuThreshold: 5 });
      assert.equal(evolver.getActiveGenome().fusionCcuThreshold, 5);
    });

    it('should apply genome to collector on setup', () => {
      const collector = new MockCollector();
      const evolver = new ProtocolEvolver();
      evolver.setCollector(collector);

      assert.equal(collector.appliedGenomes.length, 1);
      assert.equal(collector.appliedGenomes[0].fusionCcuThreshold, 1);
    });
  });

  describe('Mutation', () => {
    it('should generate a mutant genome', () => {
      const evolver = new ProtocolEvolver();
      const mutant = evolver.mutate();

      assert.ok(mutant);
      assert.ok(evolver.getPendingMutant() !== null);
    });

    it('should perturb parameters within bounds', () => {
      const evolver = new ProtocolEvolver({}, { mutationsPerGeneration: 5 });

      // Mutate many times and check bounds
      for (let i = 0; i < 50; i++) {
        const mutant = evolver.mutate();
        assert.ok(mutant.fusionCcuThreshold >= 0.1 && mutant.fusionCcuThreshold <= 100);
        assert.ok(mutant.catabolicThreshold >= 0.05 && mutant.catabolicThreshold <= 0.80);
        assert.ok(mutant.maxCausesPerSecond >= 10 && mutant.maxCausesPerSecond <= 10000);
        assert.ok(mutant.intentSampleIntervalMs >= 1000);
        assert.ok(Number.isInteger(mutant.maxCausesPerSecond), 'Integer params should stay integer');
        assert.ok(Number.isInteger(mutant.intentSampleIntervalMs));
      }
    });

    it('should change at least one parameter', () => {
      const evolver = new ProtocolEvolver({}, { mutationsPerGeneration: 1 });
      const original = evolver.getActiveGenome();
      const mutant = evolver.mutate();

      // At least one parameter should differ
      const keys = Object.keys(original) as (keyof ProtocolGenome)[];
      let different = false;
      for (const key of keys) {
        if (mutant[key] !== original[key]) { different = true; break; }
      }
      assert.ok(different, 'Mutant should differ from parent in at least one parameter');
    });
  });

  describe('Fitness Scoring', () => {
    it('should compute composite score', () => {
      const evolver = new ProtocolEvolver();

      const fitness: ProtocolFitness = {
        throughput: 1000,
        faultRecoveryMs: 0,
        ccuEfficiency: 2.0,
        intentSatisfaction: 1.0,
        avgCauseLatencyMs: 0,
        periodMs: 60000,
      };

      const score = evolver.computeCompositeScore(fitness);
      assert.equal(score, 1.0, 'Perfect fitness should score 1.0');
    });

    it('should score zero fitness low', () => {
      const evolver = new ProtocolEvolver();

      const fitness: ProtocolFitness = {
        throughput: 0,
        faultRecoveryMs: 10000,
        ccuEfficiency: 0,
        intentSatisfaction: 0,
        avgCauseLatencyMs: 100,
        periodMs: 60000,
      };

      const score = evolver.computeCompositeScore(fitness);
      assert.ok(score < 0.1, `Zero fitness should score low: ${score}`);
    });

    it('should rank better fitness higher', () => {
      const evolver = new ProtocolEvolver();

      const good: ProtocolFitness = {
        throughput: 800, faultRecoveryMs: 100, ccuEfficiency: 1.5,
        intentSatisfaction: 0.95, avgCauseLatencyMs: 10, periodMs: 60000,
      };

      const bad: ProtocolFitness = {
        throughput: 200, faultRecoveryMs: 5000, ccuEfficiency: 0.5,
        intentSatisfaction: 0.3, avgCauseLatencyMs: 80, periodMs: 60000,
      };

      const goodScore = evolver.computeCompositeScore(good);
      const badScore = evolver.computeCompositeScore(bad);

      assert.ok(goodScore > badScore, `Good (${goodScore}) should beat bad (${badScore})`);
    });
  });

  describe('Evaluation', () => {
    it('should select parent when mutant is not significantly better', () => {
      const evolver = new ProtocolEvolver({}, { minImprovementThreshold: 0.05 });
      evolver.mutate();

      const parentFitness: ProtocolFitness = {
        throughput: 500, faultRecoveryMs: 200, ccuEfficiency: 1.2,
        intentSatisfaction: 0.9, avgCauseLatencyMs: 15, periodMs: 60000,
      };
      const mutantFitness: ProtocolFitness = {
        throughput: 510, faultRecoveryMs: 195, ccuEfficiency: 1.21,
        intentSatisfaction: 0.91, avgCauseLatencyMs: 14, periodMs: 60000,
      };

      const winner = evolver.evaluate(parentFitness, mutantFitness);
      assert.equal(winner, 'parent', 'Marginal improvement should keep parent');
    });

    it('should select mutant when significantly better', () => {
      const evolver = new ProtocolEvolver({}, { minImprovementThreshold: 0.05 });
      evolver.mutate();

      const parentFitness: ProtocolFitness = {
        throughput: 300, faultRecoveryMs: 500, ccuEfficiency: 0.8,
        intentSatisfaction: 0.6, avgCauseLatencyMs: 50, periodMs: 60000,
      };
      const mutantFitness: ProtocolFitness = {
        throughput: 800, faultRecoveryMs: 100, ccuEfficiency: 1.5,
        intentSatisfaction: 0.95, avgCauseLatencyMs: 10, periodMs: 60000,
      };

      const winner = evolver.evaluate(parentFitness, mutantFitness);
      assert.equal(winner, 'mutant', 'Big improvement should adopt mutant');
    });

    it('should update active genome when mutant wins', () => {
      const evolver = new ProtocolEvolver({ fusionCcuThreshold: 1 }, { minImprovementThreshold: 0 });
      const mutant = evolver.mutate();
      const mutantThreshold = mutant.fusionCcuThreshold;

      const bad: ProtocolFitness = {
        throughput: 100, faultRecoveryMs: 5000, ccuEfficiency: 0.2,
        intentSatisfaction: 0.1, avgCauseLatencyMs: 90, periodMs: 60000,
      };
      const good: ProtocolFitness = {
        throughput: 900, faultRecoveryMs: 50, ccuEfficiency: 1.8,
        intentSatisfaction: 0.99, avgCauseLatencyMs: 5, periodMs: 60000,
      };

      evolver.evaluate(bad, good);
      assert.equal(evolver.getActiveGenome().fusionCcuThreshold, mutantThreshold);
    });

    it('should record generation history', () => {
      const evolver = new ProtocolEvolver();
      evolver.mutate();

      const fitness: ProtocolFitness = {
        throughput: 500, faultRecoveryMs: 200, ccuEfficiency: 1.2,
        intentSatisfaction: 0.9, avgCauseLatencyMs: 15, periodMs: 60000,
      };

      evolver.evaluate(fitness, fitness);
      const history = evolver.getHistory();

      assert.equal(history.length, 1);
      assert.equal(history[0].generation, 0);
      assert.ok(history[0].mutatedParams.length > 0);
      assert.ok(['parent', 'mutant'].includes(history[0].winner));
    });
  });

  describe('Full Cycle', () => {
    it('should run a complete evolution cycle', async () => {
      const collector = new MockCollector({
        throughput: 500, faultRecoveryMs: 200, ccuEfficiency: 1.2,
        intentSatisfaction: 0.9, avgCauseLatencyMs: 15,
      });

      const evolver = new ProtocolEvolver({}, { minImprovementThreshold: 0 });
      evolver.setCollector(collector);

      const record = await evolver.runCycle();

      assert.ok(record !== null);
      assert.equal(record!.generation, 0);
      assert.ok(record!.parentScore > 0);
      assert.ok(record!.mutantScore > 0);
    });

    it('should evolve over multiple generations', async () => {
      const collector = new MockCollector();
      const evolver = new ProtocolEvolver({}, { minImprovementThreshold: 0 });
      evolver.setCollector(collector);

      for (let i = 0; i < 10; i++) {
        await evolver.runCycle();
      }

      assert.equal(evolver.currentGeneration, 10);
      assert.equal(evolver.getHistory().length, 10);
      assert.ok(evolver.getMutantWinRate() >= 0 && evolver.getMutantWinRate() <= 1);
    });
  });

  describe('Drift Tracking', () => {
    it('should track parameter drift from defaults', () => {
      const evolver = new ProtocolEvolver({ fusionCcuThreshold: 2 });
      const drift = evolver.getDrift();

      assert.equal(drift.fusionCcuThreshold.default, 1);
      assert.equal(drift.fusionCcuThreshold.current, 2);
      assert.equal(drift.fusionCcuThreshold.drift, 1.0); // +100%
    });
  });

  describe('Stats', () => {
    it('should report stats', async () => {
      const collector = new MockCollector();
      const evolver = new ProtocolEvolver();
      evolver.setCollector(collector);

      await evolver.runCycle();
      const stats = evolver.getStats();

      assert.equal(stats.generation, 1);
      assert.equal(stats.totalEvaluations, 1);
    });
  });
});

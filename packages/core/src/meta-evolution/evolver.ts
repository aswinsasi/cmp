/**
 * CMP v3.0 — Protocol Evolver (Meta-Evolution)
 * The protocol itself is a Lifeform whose genome IS the configuration.
 *
 * Flow:
 *   1. Current genome = active protocol parameters
 *   2. mutate() → perturb 1-N parameters within ±20%
 *   3. Run both parent and mutant for evaluationPeriodMs
 *   4. Measure fitness: throughput, latency, CCU efficiency, fault recovery
 *   5. evaluate() → composite score → winner survives
 *   6. Repeat every evolutionIntervalMs
 *
 * The mesh literally optimizes its own rules through natural selection.
 *
 * @module meta-evolution/evolver
 * @author Agent Viscro
 */

import type {
  ProtocolGenome,
  MetaEvolutionConfig,
  ProtocolFitness,
  ProtocolGeneration,
} from '../types/meta-evolution';
import { DEFAULT_PROTOCOL_GENOME, DEFAULT_META_EVOLUTION_CONFIG } from '../types/meta-evolution';

// ─── Fitness Collector (injected by CMPNode) ───

export interface FitnessCollector {
  /** Collect fitness metrics over the evaluation period */
  collectFitness(): ProtocolFitness;
  /** Apply a genome to the live protocol */
  applyGenome(genome: ProtocolGenome): void;
}

// ─── Parameter Constraints ───

interface ParamConstraint {
  min: number;
  max: number;
  integer: boolean;
}

const PARAM_CONSTRAINTS: Record<keyof ProtocolGenome, ParamConstraint> = {
  fusionCcuThreshold: { min: 0.1, max: 100, integer: false },
  intentSampleIntervalMs: { min: 1000, max: 300000, integer: true },
  catabolicThreshold: { min: 0.05, max: 0.80, integer: false },
  hebbianIncrement: { min: 0.001, max: 0.5, integer: false },
  synapseDecayPerHour: { min: 0.001, max: 0.5, integer: false },
  maxCausesPerSecond: { min: 10, max: 10000, integer: true },
  replicationDeltaIntervalMs: { min: 100, max: 60000, integer: true },
  precognitionConfidenceThreshold: { min: 0.1, max: 0.99, integer: false },
  morphogenesisMinSpecialists: { min: 2, max: 20, integer: true },
  neuromorphicLearningRate: { min: 0.001, max: 0.5, integer: false },
  neuromorphicExplorationRate: { min: 0.0, max: 0.5, integer: false },
};

// ═══════════════════════════════════════

export class ProtocolEvolver {
  private config: MetaEvolutionConfig;

  /** Current active genome */
  private activeGenome: ProtocolGenome;

  /** Pending mutant (null when not evaluating) */
  private pendingMutant: ProtocolGenome | null = null;
  private mutatedParams: string[] = [];

  /** Generation history */
  private generations: ProtocolGeneration[] = [];
  private generationNumber = 0;

  /** Auto-evolution timer */
  private evolutionTimer: ReturnType<typeof setInterval> | null = null;

  /** Fitness collector */
  private collector: FitnessCollector | null = null;

  /** Parent fitness (collected before switching to mutant) */
  private parentFitness: ProtocolFitness | null = null;

  /** Evaluation state */
  private evaluating: 'idle' | 'measuring_parent' | 'measuring_mutant' = 'idle';
  private evaluationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initialGenome?: Partial<ProtocolGenome>,
    config?: Partial<MetaEvolutionConfig>,
  ) {
    this.activeGenome = { ...DEFAULT_PROTOCOL_GENOME, ...initialGenome };
    this.config = { ...DEFAULT_META_EVOLUTION_CONFIG, ...config };
  }

  // ═══════════════════════════════════════
  // Setup
  // ═══════════════════════════════════════

  /** Connect to the fitness collector */
  setCollector(collector: FitnessCollector): void {
    this.collector = collector;
    this.collector.applyGenome(this.activeGenome);
  }

  // ═══════════════════════════════════════
  // Mutation
  // ═══════════════════════════════════════

  /**
   * Generate a mutant genome by perturbing N random parameters.
   */
  mutate(): ProtocolGenome {
    const mutant = { ...this.activeGenome };
    const keys = Object.keys(PARAM_CONSTRAINTS) as (keyof ProtocolGenome)[];
    const mutated: string[] = [];

    // Select N random parameters to mutate
    const shuffled = [...keys].sort(() => Math.random() - 0.5);
    const toMutate = shuffled.slice(0, this.config.mutationsPerGeneration);

    for (const key of toMutate) {
      const constraint = PARAM_CONSTRAINTS[key];
      const current = mutant[key] as number;

      // Perturb: ±maxPerturbation relative to current value
      const perturbation = (Math.random() * 2 - 1) * this.config.maxPerturbation;
      let newValue = current * (1 + perturbation);

      // Clamp to constraints
      newValue = Math.max(constraint.min, Math.min(constraint.max, newValue));
      if (constraint.integer) newValue = Math.round(newValue);

      (mutant as any)[key] = newValue;
      mutated.push(key);
    }

    this.pendingMutant = mutant;
    this.mutatedParams = mutated;

    return mutant;
  }

  // ═══════════════════════════════════════
  // Evaluation
  // ═══════════════════════════════════════

  /**
   * Compare parent and mutant fitness. Returns the winner.
   */
  evaluate(parentFitness: ProtocolFitness, mutantFitness: ProtocolFitness): 'parent' | 'mutant' {
    const parentScore = this.computeCompositeScore(parentFitness);
    const mutantScore = this.computeCompositeScore(mutantFitness);

    const mutant = this.pendingMutant ?? this.activeGenome;
    const winner = mutantScore > parentScore * (1 + this.config.minImprovementThreshold)
      ? 'mutant'
      : 'parent';

    const record: ProtocolGeneration = {
      generation: this.generationNumber++,
      parentGenome: { ...this.activeGenome },
      mutantGenome: { ...mutant },
      mutatedParams: [...this.mutatedParams],
      parentFitness,
      mutantFitness,
      parentScore,
      mutantScore,
      winner,
      evaluatedAt: Date.now(),
    };

    this.generations.push(record);

    // Apply winner
    if (winner === 'mutant') {
      this.activeGenome = { ...mutant };
      if (this.collector) {
        this.collector.applyGenome(this.activeGenome);
      }
    }

    // Reset
    this.pendingMutant = null;
    this.mutatedParams = [];

    return winner;
  }

  /**
   * Compute a composite fitness score from individual metrics.
   *
   * Weights:
   *   throughput:         25% (higher = better)
   *   faultRecoveryMs:    20% (lower = better)
   *   ccuEfficiency:      25% (higher = better)
   *   intentSatisfaction: 15% (higher = better)
   *   avgCauseLatencyMs:  15% (lower = better)
   */
  computeCompositeScore(fitness: ProtocolFitness): number {
    // Normalize each metric to 0-1 range using reasonable bounds
    const throughputNorm = Math.min(1, fitness.throughput / 1000);
    const recoveryNorm = 1 - Math.min(1, fitness.faultRecoveryMs / 10000);
    const ccuNorm = Math.min(1, fitness.ccuEfficiency / 2);
    const intentNorm = fitness.intentSatisfaction;
    const latencyNorm = 1 - Math.min(1, fitness.avgCauseLatencyMs / 100);

    return (
      throughputNorm * 0.25 +
      recoveryNorm * 0.20 +
      ccuNorm * 0.25 +
      intentNorm * 0.15 +
      latencyNorm * 0.15
    );
  }

  // ═══════════════════════════════════════
  // Auto-Evolution (Full Cycle)
  // ═══════════════════════════════════════

  /**
   * Run one full evolution cycle:
   *   1. Measure parent fitness
   *   2. Generate mutant
   *   3. Apply mutant
   *   4. Measure mutant fitness
   *   5. Evaluate → winner survives
   *
   * For manual/test use. Auto-evolution uses startAutoEvolution().
   */
  async runCycle(): Promise<ProtocolGeneration | null> {
    if (!this.collector) return null;

    // 1. Measure parent
    const parentFitness = this.collector.collectFitness();

    // 2. Generate mutant
    const mutant = this.mutate();

    // 3. Apply mutant
    this.collector.applyGenome(mutant);

    // 4. Measure mutant (in real usage, wait for evaluationPeriodMs)
    const mutantFitness = this.collector.collectFitness();

    // 5. Evaluate
    this.evaluate(parentFitness, mutantFitness);

    return this.generations[this.generations.length - 1] ?? null;
  }

  /**
   * Start automatic evolution timer.
   */
  startAutoEvolution(): void {
    if (this.evolutionTimer) return;
    this.evolutionTimer = setInterval(() => {
      this.runCycle().catch(() => {});
    }, this.config.evolutionIntervalMs);
  }

  /**
   * Stop automatic evolution.
   */
  stopAutoEvolution(): void {
    if (this.evolutionTimer) {
      clearInterval(this.evolutionTimer);
      this.evolutionTimer = null;
    }
    if (this.evaluationTimer) {
      clearTimeout(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  // ═══════════════════════════════════════
  // Query
  // ═══════════════════════════════════════

  /** Get the current active genome */
  getActiveGenome(): ProtocolGenome {
    return { ...this.activeGenome };
  }

  /** Get pending mutant (null if not evaluating) */
  getPendingMutant(): ProtocolGenome | null {
    return this.pendingMutant ? { ...this.pendingMutant } : null;
  }

  /** Get generation history */
  getHistory(): ProtocolGeneration[] {
    return [...this.generations];
  }

  /** Get current generation number */
  get currentGeneration(): number {
    return this.generationNumber;
  }

  /** Get win rate of mutants */
  getMutantWinRate(): number {
    if (this.generations.length === 0) return 0;
    const wins = this.generations.filter(g => g.winner === 'mutant').length;
    return wins / this.generations.length;
  }

  /** Get parameter drift from defaults */
  getDrift(): Record<string, { default: number; current: number; drift: number }> {
    const drift: Record<string, { default: number; current: number; drift: number }> = {};
    const keys = Object.keys(DEFAULT_PROTOCOL_GENOME) as (keyof ProtocolGenome)[];

    for (const key of keys) {
      const def = DEFAULT_PROTOCOL_GENOME[key];
      const cur = this.activeGenome[key];
      drift[key] = {
        default: def,
        current: cur,
        drift: def !== 0 ? (cur - def) / def : 0,
      };
    }

    return drift;
  }

  /** Get stats */
  getStats(): {
    generation: number;
    mutantWinRate: number;
    totalEvaluations: number;
    evaluating: string;
  } {
    return {
      generation: this.generationNumber,
      mutantWinRate: this.getMutantWinRate(),
      totalEvaluations: this.generations.length,
      evaluating: this.evaluating,
    };
  }
}

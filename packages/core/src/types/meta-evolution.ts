/**
 * CMP v3.0 — Self-Modifying Protocol Type Definitions
 * Protocol parameters stored as CRDT state that evolve via natural selection.
 *
 * The ProtocolLifeform's genome IS the protocol configuration.
 * Every 24 hours: mutate → run parent vs mutant → winner survives.
 *
 * @module types/meta-evolution
 * @author Agent Viscro
 */

// ─── Protocol Parameters (the "genome") ───

export interface ProtocolGenome {
  /** Fusion: minimum CCU to accept fusion (default: 1) */
  fusionCcuThreshold: number;
  /** Intent: sample interval in ms (default: 30000) */
  intentSampleIntervalMs: number;
  /** Metabolism: battery % to enter CATABOLIC (default: 0.30) */
  catabolicThreshold: number;
  /** Synapses: Hebbian increment per transmission (default: 0.02) */
  hebbianIncrement: number;
  /** Synapses: decay per hour (default: 0.05) */
  synapseDecayPerHour: number;
  /** Causes: max causes per second backpressure (default: 100) */
  maxCausesPerSecond: number;
  /** Replication: delta sync interval in ms (default: 5000) */
  replicationDeltaIntervalMs: number;
  /** Precognition: confidence threshold for shortcuts (default: 0.8) */
  precognitionConfidenceThreshold: number;
  /** Morphogenesis: min specialists to form organ (default: 3) */
  morphogenesisMinSpecialists: number;
  /** Neuromorphic: learning rate (default: 0.1) */
  neuromorphicLearningRate: number;
  /** Neuromorphic: exploration rate (default: 0.1) */
  neuromorphicExplorationRate: number;
}

export const DEFAULT_PROTOCOL_GENOME: ProtocolGenome = {
  fusionCcuThreshold: 1,
  intentSampleIntervalMs: 30000,
  catabolicThreshold: 0.30,
  hebbianIncrement: 0.02,
  synapseDecayPerHour: 0.05,
  maxCausesPerSecond: 100,
  replicationDeltaIntervalMs: 5000,
  precognitionConfidenceThreshold: 0.8,
  morphogenesisMinSpecialists: 3,
  neuromorphicLearningRate: 0.1,
  neuromorphicExplorationRate: 0.1,
};

// ─── Mutation Config ───

export interface MetaEvolutionConfig {
  /** Evaluation period in ms (default: 12 hours per candidate) */
  evaluationPeriodMs: number;
  /** Max parameter perturbation (±percentage, default: 0.2 = ±20%) */
  maxPerturbation: number;
  /** Min fitness improvement to adopt mutant (default: 0.05 = 5%) */
  minImprovementThreshold: number;
  /** How many parameters to mutate at once (default: 2) */
  mutationsPerGeneration: number;
  /** Auto-evolve interval in ms (default: 24 hours) */
  evolutionIntervalMs: number;
}

export const DEFAULT_META_EVOLUTION_CONFIG: MetaEvolutionConfig = {
  evaluationPeriodMs: 43200000,     // 12 hours
  maxPerturbation: 0.2,
  minImprovementThreshold: 0.05,
  mutationsPerGeneration: 2,
  evolutionIntervalMs: 86400000,    // 24 hours
};

// ─── Fitness Metrics ───

export interface ProtocolFitness {
  /** Causes processed per second (higher = better) */
  throughput: number;
  /** Average fault recovery time in ms (lower = better) */
  faultRecoveryMs: number;
  /** CCU efficiency: earned / spent ratio (higher = better) */
  ccuEfficiency: number;
  /** Intent satisfaction rate 0.0-1.0 (higher = better) */
  intentSatisfaction: number;
  /** Average cross-device cause latency in ms (lower = better) */
  avgCauseLatencyMs: number;
  /** Measurement period in ms */
  periodMs: number;
}

// ─── Generation Record ───

export interface ProtocolGeneration {
  /** Generation number */
  generation: number;
  /** Parent genome */
  parentGenome: ProtocolGenome;
  /** Mutant genome */
  mutantGenome: ProtocolGenome;
  /** Which parameters were mutated */
  mutatedParams: string[];
  /** Parent fitness score */
  parentFitness: ProtocolFitness;
  /** Mutant fitness score */
  mutantFitness: ProtocolFitness;
  /** Composite parent score */
  parentScore: number;
  /** Composite mutant score */
  mutantScore: number;
  /** Winner: 'parent' or 'mutant' */
  winner: 'parent' | 'mutant';
  /** Timestamp */
  evaluatedAt: number;
}

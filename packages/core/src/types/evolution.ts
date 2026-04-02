/**
 * CMP v1.4 — Genome Mutation + Natural Selection Types
 * The WASM binary itself can be mutated. A Lifeform spawns a MUTANT —
 * a next-generation copy with modified code — and the mesh applies
 * selection pressure to determine which generation survives.
 *
 * @module types/evolution
 * @author Agent Viscro
 */

// ─── Mutation Types ───

export enum MutationType {
  /** Change a numeric constant in a function body */
  CONSTANT_MUTATION = 'constant_mutation',
  /** Swap one function's body with another from mutation library */
  FUNCTION_SWAP = 'function_swap',
  /** Add a new function from mutation library */
  FUNCTION_INSERT = 'function_insert',
  /** Remove a non-essential function */
  FUNCTION_REMOVE = 'function_remove',
  /** Change a global variable's initial value */
  GLOBAL_MUTATION = 'global_mutation',
  /** Crossover: combine functions from two parent genomes */
  CROSSOVER = 'crossover',
}

// ─── Mutation Request ───

export interface MutationRequest {
  /** Parent Lifeform ID */
  parentId: Uint8Array;
  /** Mutation type */
  mutationType: MutationType;
  /** Mutation parameters (type-specific) */
  params: MutationParams;
  /** Mutation library hash (pre-uploaded WASM fragment library) */
  libraryHash: Uint8Array;
  /** Evaluation period: how long to compare parent vs mutant (ms) */
  evaluationPeriodMs: number;
}

export interface MutationParams {
  /** For CONSTANT_MUTATION: which constant index to change and new value */
  constantIndex?: number;
  newConstantValue?: number;
  /** For FUNCTION_SWAP: which function to replace and library function name */
  targetFunction?: string;
  replacementFunction?: string;
  /** For CROSSOVER: second parent Lifeform ID */
  crossoverParentId?: Uint8Array;
  /** Mutation rate: probability of each eligible site being mutated (0.0-1.0) */
  mutationRate?: number;
}

// ─── Generation Record ───

export interface GenerationRecord {
  /** Generation number */
  generation: number;
  /** Parent genome hash */
  parentGenomeHash: Uint8Array;
  /** Mutant genome hash */
  mutantGenomeHash: Uint8Array;
  /** Mutation applied */
  mutation: MutationRequest;
  /** Evaluation period start */
  evaluationStartAt: number;
  /** Evaluation period end */
  evaluationEndAt: number;
  /** Parent fitness during evaluation */
  parentFitness: FitnessScore;
  /** Mutant fitness during evaluation */
  mutantFitness: FitnessScore;
  /** Winner: 'parent' | 'mutant' */
  winner: 'parent' | 'mutant';
}

// ─── Fitness Score ───

export interface FitnessScore {
  /** Average cause processing time (lower = better) */
  avgResponseTimeMs: number;
  /** CCU earned / CCU spent ratio (higher = better) */
  ccuEfficiency: number;
  /** Error rate (lower = better) */
  errorRate: number;
  /** Causes processed per hour */
  throughput: number;
  /** Intent satisfaction rate if applicable */
  intentSatisfactionRate: number;
  /** Composite fitness = weighted sum, higher = more fit */
  composite: number;
}

/**
 * Calculate composite fitness score from individual metrics.
 */
export function calculateFitness(score: Omit<FitnessScore, 'composite'>): FitnessScore {
  // Normalize each metric to 0-1 range and weight
  const responseScore = Math.max(0, 1 - score.avgResponseTimeMs / 1000); // <1s = good
  const efficiencyScore = Math.min(1, score.ccuEfficiency);
  const errorScore = Math.max(0, 1 - score.errorRate);
  const throughputScore = Math.min(1, score.throughput / 100); // 100/hr = good
  const intentScore = score.intentSatisfactionRate;

  const composite =
    responseScore * 0.20 +
    efficiencyScore * 0.30 +
    errorScore * 0.25 +
    throughputScore * 0.15 +
    intentScore * 0.10;

  return { ...score, composite };
}

// ─── Mutation Library ───

export interface MutationLibrary {
  /** Library hash (SHA-256 of contents) */
  hash: Uint8Array;
  /** Available function fragments: name → WASM bytes */
  functions: Map<string, Uint8Array>;
  /** Compatible genome hashes (which Lifeforms can use this library) */
  compatibleGenomes: Uint8Array[];
  /** Creator device ID */
  creatorId: Uint8Array;
}

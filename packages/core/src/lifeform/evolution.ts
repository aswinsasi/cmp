/**
 * CMP v1.4 — Evolution Engine
 * The WASM binary itself can be mutated. A Lifeform spawns a MUTANT —
 * a next-generation copy with modified code — and the mesh applies
 * selection pressure to determine which generation survives.
 *
 * Components:
 *   - GenomeMutator: applies mutations to WASM-like genome representations
 *   - FitnessEvaluator: compares parent vs mutant over evaluation period
 *   - SelectionPressure: economic + performance + social scoring
 *   - GenerationTracker: tracks lineage across generations
 *
 * Note: Real WASM binary manipulation requires a WASM parser. This
 * implementation works with a simplified genome representation
 * (function table + constants + globals) that maps to WASM sections.
 *
 * @module lifeform/evolution
 * @author Agent Viscro
 */

import {
  MutationType,
  MutationRequest,
  MutationParams,
  GenerationRecord,
  FitnessScore,
  MutationLibrary,
  calculateFitness,
} from '../types/evolution';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ═══════════════════════════════════════
// Genome Representation
// ═══════════════════════════════════════

/**
 * Simplified genome representation that maps to WASM sections.
 * Real implementation would parse actual WASM binary.
 */
export interface Genome {
  /** Genome hash (identity) */
  hash: Uint8Array;
  /** Function table: name → function body bytes */
  functions: Map<string, Uint8Array>;
  /** Numeric constants used in function bodies */
  constants: number[];
  /** Global variables: name → initial value */
  globals: Map<string, number>;
  /** Generation number */
  generation: number;
  /** Parent genome hash (null for gen 0) */
  parentHash: Uint8Array | null;
}

function hashGenome(genome: Genome): Uint8Array {
  // Simplified hash — real impl uses SHA-256
  const parts: number[] = [];
  for (const [name, body] of genome.functions) {
    for (const c of name) parts.push(c.charCodeAt(0));
    for (const b of body) parts.push(b);
  }
  for (const c of genome.constants) parts.push(Math.floor(c * 1000) & 0xFF);
  for (const [name, val] of genome.globals) {
    for (const c of name) parts.push(c.charCodeAt(0));
    parts.push(Math.floor(val * 1000) & 0xFF);
  }
  const hash = new Uint8Array(32);
  for (let i = 0; i < parts.length; i++) {
    hash[i % 32] ^= parts[i];
  }
  return hash;
}

// ═══════════════════════════════════════
// Genome Mutator
// ═══════════════════════════════════════

export class GenomeMutator {
  /**
   * Apply a mutation to a genome, producing a new mutant genome.
   * The original genome is NOT modified.
   */
  mutate(genome: Genome, mutation: MutationRequest, library?: MutationLibrary): Genome | null {
    const mutant: Genome = {
      hash: new Uint8Array(32),
      functions: new Map(genome.functions),
      constants: [...genome.constants],
      globals: new Map(genome.globals),
      generation: genome.generation + 1,
      parentHash: genome.hash,
    };

    let success = false;

    switch (mutation.mutationType) {
      case MutationType.CONSTANT_MUTATION:
        success = this.mutateConstant(mutant, mutation.params);
        break;
      case MutationType.GLOBAL_MUTATION:
        success = this.mutateGlobal(mutant, mutation.params);
        break;
      case MutationType.FUNCTION_SWAP:
        success = this.swapFunction(mutant, mutation.params, library);
        break;
      case MutationType.FUNCTION_INSERT:
        success = this.insertFunction(mutant, mutation.params, library);
        break;
      case MutationType.FUNCTION_REMOVE:
        success = this.removeFunction(mutant, mutation.params);
        break;
      case MutationType.CROSSOVER:
        // Crossover needs a second parent — handled separately
        success = false;
        break;
      default:
        success = false;
    }

    if (!success) return null;

    mutant.hash = hashGenome(mutant);
    return mutant;
  }

  /**
   * Crossover: combine functions from two parent genomes.
   * Takes random functions from each parent.
   */
  crossover(parentA: Genome, parentB: Genome, mutationRate: number = 0.5): Genome {
    const child: Genome = {
      hash: new Uint8Array(32),
      functions: new Map(),
      constants: [],
      globals: new Map(),
      generation: Math.max(parentA.generation, parentB.generation) + 1,
      parentHash: parentA.hash,
    };

    // Crossover functions: take from A or B randomly, fallback to whichever has it
    const allFunctions = new Set([...parentA.functions.keys(), ...parentB.functions.keys()]);
    for (const name of allFunctions) {
      const useB = Math.random() < mutationRate;
      let body = useB ? parentB.functions.get(name) : parentA.functions.get(name);
      if (!body) body = parentA.functions.get(name) ?? parentB.functions.get(name);
      if (body) child.functions.set(name, new Uint8Array(body));
    }

    // Crossover constants: mix from both parents
    const maxLen = Math.max(parentA.constants.length, parentB.constants.length);
    for (let i = 0; i < maxLen; i++) {
      const useB = Math.random() < mutationRate;
      if (useB && i < parentB.constants.length) {
        child.constants.push(parentB.constants[i]);
      } else if (i < parentA.constants.length) {
        child.constants.push(parentA.constants[i]);
      } else if (i < parentB.constants.length) {
        child.constants.push(parentB.constants[i]);
      }
    }

    // Crossover globals: fallback to whichever has it
    const allGlobals = new Set([...parentA.globals.keys(), ...parentB.globals.keys()]);
    for (const name of allGlobals) {
      const useB = Math.random() < mutationRate;
      let val = useB ? parentB.globals.get(name) : parentA.globals.get(name);
      if (val === undefined) val = parentA.globals.get(name) ?? parentB.globals.get(name);
      if (val !== undefined) child.globals.set(name, val);
    }

    child.hash = hashGenome(child);
    return child;
  }

  // ── Mutation implementations ──

  private mutateConstant(genome: Genome, params: MutationParams): boolean {
    const idx = params.constantIndex ?? 0;
    if (idx < 0 || idx >= genome.constants.length) return false;

    if (params.newConstantValue !== undefined) {
      genome.constants[idx] = params.newConstantValue;
    } else {
      // Random perturbation: ±10%
      const current = genome.constants[idx];
      const delta = current * (Math.random() * 0.2 - 0.1);
      genome.constants[idx] = current + delta;
    }
    return true;
  }

  private mutateGlobal(genome: Genome, params: MutationParams): boolean {
    const name = params.targetFunction;
    if (!name) return false;

    if (!genome.globals.has(name)) return false;

    if (params.newConstantValue !== undefined) {
      genome.globals.set(name, params.newConstantValue);
    } else {
      const current = genome.globals.get(name)!;
      const delta = current * (Math.random() * 0.2 - 0.1);
      genome.globals.set(name, current + delta);
    }
    return true;
  }

  private swapFunction(genome: Genome, params: MutationParams, library?: MutationLibrary): boolean {
    if (!params.targetFunction || !params.replacementFunction || !library) return false;
    if (!genome.functions.has(params.targetFunction)) return false;

    const replacement = library.functions.get(params.replacementFunction);
    if (!replacement) return false;

    genome.functions.set(params.targetFunction, new Uint8Array(replacement));
    return true;
  }

  private insertFunction(genome: Genome, params: MutationParams, library?: MutationLibrary): boolean {
    if (!params.replacementFunction || !library) return false;

    const body = library.functions.get(params.replacementFunction);
    if (!body) return false;

    // Insert with the library function name
    genome.functions.set(params.replacementFunction, new Uint8Array(body));
    return true;
  }

  private removeFunction(genome: Genome, params: MutationParams): boolean {
    if (!params.targetFunction) return false;
    return genome.functions.delete(params.targetFunction);
  }
}

// ═══════════════════════════════════════
// Fitness Evaluator
// ═══════════════════════════════════════

export interface EvaluationSession {
  /** Parent Lifeform ID */
  parentId: Uint8Array;
  /** Mutant Lifeform ID */
  mutantId: Uint8Array;
  /** Evaluation start time */
  startedAt: number;
  /** Evaluation end time */
  endsAt: number;
  /** Parent metrics collected so far */
  parentMetrics: FitnessMetrics;
  /** Mutant metrics collected so far */
  mutantMetrics: FitnessMetrics;
  /** Generation number */
  generation: number;
  /** Mutation applied */
  mutation: MutationRequest;
  /** Status */
  status: 'running' | 'complete' | 'aborted';
}

export interface FitnessMetrics {
  totalResponseTimeMs: number;
  causesProcessed: number;
  ccuEarned: number;
  ccuSpent: number;
  errors: number;
  intentsSatisfied: number;
  intentsTotal: number;
}

function emptyMetrics(): FitnessMetrics {
  return {
    totalResponseTimeMs: 0,
    causesProcessed: 0,
    ccuEarned: 0,
    ccuSpent: 0,
    errors: 0,
    intentsSatisfied: 0,
    intentsTotal: 0,
  };
}

export class FitnessEvaluator {
  /** sessionId hex → EvaluationSession */
  private sessions = new Map<string, EvaluationSession>();

  /**
   * Start an evaluation session: parent vs mutant.
   */
  startEvaluation(
    parentId: Uint8Array,
    mutantId: Uint8Array,
    mutation: MutationRequest,
    generation: number,
  ): Uint8Array {
    const sessionId = randomBytes(16);
    this.sessions.set(toHex(sessionId), {
      parentId,
      mutantId,
      startedAt: Date.now(),
      endsAt: Date.now() + mutation.evaluationPeriodMs,
      parentMetrics: emptyMetrics(),
      mutantMetrics: emptyMetrics(),
      generation,
      mutation,
      status: 'running',
    });
    return sessionId;
  }

  /**
   * Record a cause execution for parent or mutant.
   */
  recordExecution(
    sessionId: Uint8Array,
    isParent: boolean,
    responseTimeMs: number,
    ccuCost: number,
    ccuEarned: number,
    isError: boolean,
  ): void {
    const session = this.sessions.get(toHex(sessionId));
    if (!session || session.status !== 'running') return;

    const metrics = isParent ? session.parentMetrics : session.mutantMetrics;
    metrics.causesProcessed++;
    metrics.totalResponseTimeMs += responseTimeMs;
    metrics.ccuSpent += ccuCost;
    metrics.ccuEarned += ccuEarned;
    if (isError) metrics.errors++;
  }

  /**
   * Record an intent check result.
   */
  recordIntentCheck(sessionId: Uint8Array, isParent: boolean, satisfied: boolean): void {
    const session = this.sessions.get(toHex(sessionId));
    if (!session || session.status !== 'running') return;

    const metrics = isParent ? session.parentMetrics : session.mutantMetrics;
    metrics.intentsTotal++;
    if (satisfied) metrics.intentsSatisfied++;
  }

  /**
   * Complete evaluation — compare fitness and declare winner.
   */
  evaluate(sessionId: Uint8Array): GenerationRecord | null {
    const session = this.sessions.get(toHex(sessionId));
    if (!session) return null;

    session.status = 'complete';

    const parentFitness = this.calculateFitnessFromMetrics(session.parentMetrics);
    const mutantFitness = this.calculateFitnessFromMetrics(session.mutantMetrics);
    const winner = mutantFitness.composite > parentFitness.composite ? 'mutant' : 'parent';

    return {
      generation: session.generation,
      parentGenomeHash: randomBytes(32), // Simplified
      mutantGenomeHash: randomBytes(32),
      mutation: session.mutation,
      evaluationStartAt: session.startedAt,
      evaluationEndAt: Date.now(),
      parentFitness,
      mutantFitness,
      winner,
    };
  }

  /**
   * Check if evaluation period has elapsed.
   */
  isComplete(sessionId: Uint8Array): boolean {
    const session = this.sessions.get(toHex(sessionId));
    if (!session) return false;
    return Date.now() >= session.endsAt || session.status === 'complete';
  }

  /**
   * Abort an evaluation.
   */
  abort(sessionId: Uint8Array): boolean {
    const session = this.sessions.get(toHex(sessionId));
    if (!session) return false;
    session.status = 'aborted';
    return true;
  }

  /** Get a session */
  getSession(sessionId: Uint8Array): EvaluationSession | null {
    return this.sessions.get(toHex(sessionId)) ?? null;
  }

  /** Active evaluation count */
  get activeCount(): number {
    let count = 0;
    for (const s of this.sessions.values()) if (s.status === 'running') count++;
    return count;
  }

  // ── Internals ──

  private calculateFitnessFromMetrics(m: FitnessMetrics): FitnessScore {
    const avgResponseTime = m.causesProcessed > 0
      ? m.totalResponseTimeMs / m.causesProcessed : 1000;
    const ccuEfficiency = m.ccuSpent > 0 ? m.ccuEarned / m.ccuSpent : 0;
    const errorRate = m.causesProcessed > 0 ? m.errors / m.causesProcessed : 1;
    const throughput = m.causesProcessed; // Simplified: total causes in eval period
    const intentRate = m.intentsTotal > 0 ? m.intentsSatisfied / m.intentsTotal : 1;

    return calculateFitness({
      avgResponseTimeMs: avgResponseTime,
      ccuEfficiency,
      errorRate,
      throughput,
      intentSatisfactionRate: intentRate,
    });
  }
}

// ═══════════════════════════════════════
// Selection Pressure
// ═══════════════════════════════════════

export interface SelectionConfig {
  /** Weight for economic selection (default: 0.4) */
  economicWeight: number;
  /** Weight for performance selection (default: 0.4) */
  performanceWeight: number;
  /** Weight for social selection (default: 0.2) */
  socialWeight: number;
  /** Minimum fitness to survive (default: 0.2) */
  minimumFitness: number;
}

const DEFAULT_SELECTION: SelectionConfig = {
  economicWeight: 0.4,
  performanceWeight: 0.4,
  socialWeight: 0.2,
  minimumFitness: 0.2,
};

export class SelectionPressure {
  private config: SelectionConfig;

  constructor(config?: Partial<SelectionConfig>) {
    this.config = { ...DEFAULT_SELECTION, ...config };
  }

  /**
   * Determine if a Lifeform should survive based on three pressures.
   */
  shouldSurvive(
    ccuEfficiency: number,
    performanceScore: number,
    socialScore: number,
  ): { survives: boolean; compositeScore: number; reason: string } {
    const composite =
      ccuEfficiency * this.config.economicWeight +
      performanceScore * this.config.performanceWeight +
      socialScore * this.config.socialWeight;

    if (composite < this.config.minimumFitness) {
      return {
        survives: false,
        compositeScore: composite,
        reason: `Fitness ${composite.toFixed(3)} below minimum ${this.config.minimumFitness}`,
      };
    }

    return {
      survives: true,
      compositeScore: composite,
      reason: `Fitness ${composite.toFixed(3)} above minimum`,
    };
  }

  /**
   * Compare parent vs mutant and decide winner.
   */
  selectWinner(
    parentRecord: GenerationRecord,
  ): 'parent' | 'mutant' {
    return parentRecord.mutantFitness.composite > parentRecord.parentFitness.composite
      ? 'mutant' : 'parent';
  }
}

// ═══════════════════════════════════════
// Generation Tracker
// ═══════════════════════════════════════

export class GenerationTracker {
  /** lifeformId hex → generation records (lineage) */
  private lineages = new Map<string, GenerationRecord[]>();

  /** Record a generation result */
  record(lifeformId: string, result: GenerationRecord): void {
    if (!this.lineages.has(lifeformId)) {
      this.lineages.set(lifeformId, []);
    }
    this.lineages.get(lifeformId)!.push(result);
  }

  /** Get lineage for a Lifeform */
  getLineage(lifeformId: string): GenerationRecord[] {
    return this.lineages.get(lifeformId) ?? [];
  }

  /** Get current generation number */
  getGeneration(lifeformId: string): number {
    const lineage = this.lineages.get(lifeformId);
    if (!lineage || lineage.length === 0) return 0;
    return lineage[lineage.length - 1].generation;
  }

  /** Get win rate of mutations for a Lifeform */
  getMutationWinRate(lifeformId: string): number {
    const lineage = this.lineages.get(lifeformId);
    if (!lineage || lineage.length === 0) return 0;
    const wins = lineage.filter(r => r.winner === 'mutant').length;
    return wins / lineage.length;
  }

  /** Total tracked Lifeforms */
  get trackedCount(): number {
    return this.lineages.size;
  }
}

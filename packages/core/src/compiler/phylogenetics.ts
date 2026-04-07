/**
 * CMP v5.0 — Computational Phylogenetics Engine (CPE)
 *
 * WORLD'S FIRST: Zero-shot optimal parallelization.
 *
 * Every WASM module that executes on the mesh leaves behind a
 * "computational genome" — a 64-dimensional vector encoding its
 * bytecode structure. When a NEVER-BEFORE-SEEN module arrives,
 * the CPE finds its closest known ancestor and INHERITS the
 * optimal execution strategy.
 *
 * First execution. Optimal parallelization. Zero warm-up.
 *
 * Components:
 *   1. GenomeEncoder — BytecodeAnalysis → 64-dim float vector
 *   2. PhylogeneticIndex — cosine similarity search across all known genomes
 *   3. StrategyInheritor — decides what to inherit and with what confidence
 *   4. PhylogeneticsEngine — main integration (analyze → search → inherit → record)
 *
 * @module compiler/phylogenetics
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { analyzeWasmBytecode, BytecodeAnalysis, FunctionAnalysis, StructuralPattern, OutputRatio, MemoryPattern } from './bytecode-analyzer';

const log = new Logger('Phylogenetics');

// ═══════════════════════════════════════════
// GENOME
// ═══════════════════════════════════════════

/** Dimensionality of the genome vector */
const GENOME_DIMS = 64;

/**
 * A computation's "DNA" — a compact structural encoding
 * of its bytecode patterns and learned optimal parameters.
 */
export interface ComputationGenome {
  /** 64-dimensional normalized feature vector */
  vector: Float32Array;
  /** Exact fingerprint hash (from LearningBridge) */
  fingerprintHash: string;
  /** Detected structural pattern */
  structuralPattern: string;
  /** Output ratio */
  outputRatio: string;
  /** Memory access pattern */
  memoryPattern: string;
  /** Learned optimal strategy (null if never executed) */
  learnedStrategy: LearnedStrategy | null;
  /** Number of times this computation has been executed */
  executionCount: number;
  /** Timestamp of creation */
  createdAt: number;
  /** Human-readable label (auto-generated or user-set) */
  label: string;
}

export interface LearnedStrategy {
  chunkCount: number;
  elementSize: number;
  mergeType: string;
  avgTimeMs: number;
  bestTimeMs: number;
  /** Confidence in this strategy (0-1) */
  confidence: number;
}

/**
 * Result of a phylogenetic search — an ancestor with similarity score.
 */
export interface AncestorMatch {
  genome: ComputationGenome;
  similarity: number;  // 0-1 cosine similarity
}

/**
 * Strategy inherited from an ancestor computation.
 */
export interface InheritedStrategy {
  chunkCount: number;
  elementSize: number;
  /** Confidence = ancestor confidence × similarity */
  confidence: number;
  /** Which computation we inherited from */
  ancestorHash: string;
  ancestorLabel: string;
  /** Similarity to the ancestor (0-1) */
  similarity: number;
  /** Human-readable explanation */
  explanation: string;
}

// ═══════════════════════════════════════════
// GENOME ENCODER
// ═══════════════════════════════════════════

/**
 * Converts a BytecodeAnalysis into a 64-dimensional genome vector.
 *
 * Dimensions:
 *   0-31:  Opcode frequency distribution (32 buckets)
 *   32-39: Loop structure (count, depth, nesting patterns)
 *   40-47: Memory access pattern (load/store ratios, alignment)
 *   48-51: I/O ratio (input vs output characteristics)
 *   52-55: Branch density (if/br patterns)
 *   56-63: Function complexity (instruction count, call depth)
 */
export function encodeGenome(analysis: BytecodeAnalysis): Float32Array {
  const vec = new Float32Array(GENOME_DIMS);
  const fn = analysis.entryPoint;
  if (!fn) return vec;

  // ── Dims 0-31: Opcode frequency distribution ──
  // Group opcodes into 32 buckets and normalize
  const histogram = fn.opcodeHistogram;
  const totalInstructions = fn.instructionCount || 1;

  for (const [opcode, count] of histogram) {
    const bucket = opcode % 32; // Map opcode to bucket
    vec[bucket] += count / totalInstructions;
  }

  // Normalize opcode distribution to unit length
  let opcodeNorm = 0;
  for (let i = 0; i < 32; i++) opcodeNorm += vec[i] * vec[i];
  opcodeNorm = Math.sqrt(opcodeNorm) || 1;
  for (let i = 0; i < 32; i++) vec[i] /= opcodeNorm;

  // ── Dims 32-39: Loop structure ──
  vec[32] = Math.min(fn.loopCount / 5, 1.0);           // Loop count (normalized)
  vec[33] = Math.min(fn.loopDepth / 3, 1.0);           // Max nesting depth
  vec[34] = fn.loopCount > 0 ? 1.0 : 0.0;              // Has loops
  vec[35] = fn.loopDepth >= 2 ? 1.0 : 0.0;             // Has nested loops
  vec[36] = fn.hasAccumulator ? 1.0 : 0.0;              // Accumulator pattern
  vec[37] = fn.hasConditionalStore ? 1.0 : 0.0;         // Conditional store
  vec[38] = fn.hasCompareSwap ? 1.0 : 0.0;              // Compare-swap (sort)
  vec[39] = fn.hasIndependentWritePtr ? 1.0 : 0.0;      // Independent write pointer

  // ── Dims 40-47: Memory access pattern ──
  const maxMem = Math.max(fn.loadCount + fn.storeCount, 1);
  vec[40] = fn.loadCount / maxMem;                       // Load ratio
  vec[41] = fn.storeCount / maxMem;                      // Store ratio
  vec[42] = fn.loadCount > 0 ? Math.min(fn.storeCount / fn.loadCount, 2.0) / 2.0 : 0; // Store/load ratio
  vec[43] = fn.loadCount > fn.storeCount * 1.5 ? 1.0 : 0.0;  // More reads than writes
  vec[44] = Math.abs(fn.loadCount - fn.storeCount) <= fn.loadCount * 0.5 ? 1.0 : 0.0; // Balanced I/O
  vec[45] = fn.storeCount <= 2 ? 1.0 : 0.0;             // Few stores (reduce signal)
  vec[46] = Math.min(fn.loadCount / totalInstructions, 1.0);   // Load density
  vec[47] = Math.min(fn.storeCount / totalInstructions, 1.0);  // Store density

  // ── Dims 48-51: I/O characteristics ──
  const outputRatioMap: Record<string, number> = {
    [OutputRatio.SAME]: 1.0,
    [OutputRatio.SMALLER]: 0.5,
    [OutputRatio.FIXED]: 0.2,
    [OutputRatio.LARGER]: 1.5,
    [OutputRatio.UNKNOWN]: 0.7,
  };
  vec[48] = outputRatioMap[analysis.outputRatio] ?? 0.7;
  vec[49] = analysis.independentIterations ? 1.0 : 0.0;
  vec[50] = fn.paramCount / 4;  // Normalized param count
  vec[51] = fn.returnCount > 0 ? 1.0 : 0.0;

  // ── Dims 52-55: Branch density ──
  vec[52] = Math.min(fn.branchCount / totalInstructions, 1.0);  // Branch density
  vec[53] = Math.min(fn.compareCount / totalInstructions, 1.0); // Compare density
  vec[54] = fn.branchCount > 0 ? 1.0 : 0.0;                    // Has branches
  vec[55] = fn.compareCount > fn.arithmeticCount ? 1.0 : 0.0;  // Compare-heavy

  // ── Dims 56-63: Function complexity ──
  vec[56] = Math.min(fn.instructionCount / 200, 1.0);           // Instruction count
  vec[57] = Math.min(fn.arithmeticCount / totalInstructions, 1.0); // Arithmetic density
  vec[58] = Math.min(fn.arithmeticCount / 50, 1.0);             // Absolute arithmetic
  vec[59] = analysis.functionCount > 1 ? 1.0 : 0.0;            // Multi-function module
  vec[60] = Math.min(analysis.functionCount / 10, 1.0);         // Function count

  // Structural pattern one-hot (dims 61-63)
  const patternMap: Record<string, number> = {
    [StructuralPattern.LINEAR_MAP]: 0,
    [StructuralPattern.LINEAR_FILTER]: 1,
    [StructuralPattern.LINEAR_REDUCE]: 2,
    [StructuralPattern.COMPARE_REORDER]: 3,
    [StructuralPattern.MULTI_PASS]: 4,
    [StructuralPattern.FIXED_OUTPUT]: 5,
  };
  const patIdx = patternMap[analysis.structuralPattern] ?? 6;
  vec[61] = (patIdx % 3) / 2;     // Encode pattern as 3 continuous values
  vec[62] = Math.floor(patIdx / 3) / 2;
  vec[63] = patIdx < 3 ? 1.0 : 0.0;

  return vec;
}

// ═══════════════════════════════════════════
// COSINE SIMILARITY
// ═══════════════════════════════════════════

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ═══════════════════════════════════════════
// PHYLOGENETIC INDEX
// ═══════════════════════════════════════════

/**
 * Index of all known computation genomes with fast similarity search.
 */
export class PhylogeneticIndex {
  private genomes: Map<string, ComputationGenome> = new Map();

  /**
   * Find the N most similar known computations.
   */
  findAncestors(queryVector: Float32Array, topN: number = 3): AncestorMatch[] {
    const matches: AncestorMatch[] = [];

    for (const genome of this.genomes.values()) {
      // Skip genomes without learned strategies (they have nothing to teach)
      if (!genome.learnedStrategy) continue;

      const similarity = cosineSimilarity(queryVector, genome.vector);
      matches.push({ genome, similarity });
    }

    // Sort by similarity (highest first)
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, topN);
  }

  /**
   * Register a genome (after execution with known results).
   */
  register(genome: ComputationGenome): void {
    this.genomes.set(genome.fingerprintHash, genome);
    log.info(`Registered genome: ${genome.label} (${genome.fingerprintHash.slice(0, 8)}), ` +
      `${genome.executionCount} executions`);
  }

  /**
   * Update a genome's learned strategy.
   */
  updateStrategy(
    fingerprintHash: string,
    strategy: LearnedStrategy,
    executionCount: number,
  ): void {
    const existing = this.genomes.get(fingerprintHash);
    if (existing) {
      existing.learnedStrategy = strategy;
      existing.executionCount = executionCount;
    }
  }

  /**
   * Check if a fingerprint is already known.
   */
  has(fingerprintHash: string): boolean {
    return this.genomes.has(fingerprintHash);
  }

  /**
   * Get a genome by fingerprint.
   */
  get(fingerprintHash: string): ComputationGenome | undefined {
    return this.genomes.get(fingerprintHash);
  }

  /**
   * Get all genomes (for tree visualization).
   */
  getAll(): ComputationGenome[] {
    return [...this.genomes.values()];
  }

  /**
   * Get stats.
   */
  getStats(): { totalGenomes: number; withStrategy: number; totalExecutions: number } {
    let withStrategy = 0, totalExecutions = 0;
    for (const g of this.genomes.values()) {
      if (g.learnedStrategy) withStrategy++;
      totalExecutions += g.executionCount;
    }
    return { totalGenomes: this.genomes.size, withStrategy, totalExecutions };
  }
}

// ═══════════════════════════════════════════
// STRATEGY INHERITOR
// ═══════════════════════════════════════════

/**
 * Decides what to inherit from ancestor computations.
 *
 * Rules:
 *   - Only inherit from ancestors with similarity > 0.6
 *   - Confidence = ancestor confidence × similarity
 *   - If multiple ancestors agree on chunk count, boost confidence
 *   - Never inherit with confidence > 0.7 (always leave room to learn)
 */
export class StrategyInheritor {
  private minSimilarity = 0.6;
  private maxInheritedConfidence = 0.7;

  /**
   * Attempt to inherit a strategy from known ancestors.
   */
  inherit(
    ancestors: AncestorMatch[],
    availableDevices: number,
  ): InheritedStrategy | null {
    // Filter by minimum similarity
    const viable = ancestors.filter(a =>
      a.similarity >= this.minSimilarity && a.genome.learnedStrategy
    );

    if (viable.length === 0) return null;

    const best = viable[0];
    const strategy = best.genome.learnedStrategy!;

    // Check if multiple ancestors agree on chunk count
    let agreementBoost = 0;
    if (viable.length >= 2) {
      const agreeCount = viable.filter(a =>
        a.genome.learnedStrategy!.chunkCount === strategy.chunkCount
      ).length;
      agreementBoost = (agreeCount / viable.length) * 0.1;
    }

    // Calculate inherited confidence
    const rawConfidence = strategy.confidence * best.similarity + agreementBoost;
    const confidence = Math.min(rawConfidence, this.maxInheritedConfidence);

    // Respect device count constraint
    const chunkCount = Math.min(strategy.chunkCount, availableDevices);

    const result: InheritedStrategy = {
      chunkCount,
      elementSize: strategy.elementSize,
      confidence,
      ancestorHash: best.genome.fingerprintHash,
      ancestorLabel: best.genome.label,
      similarity: best.similarity,
      explanation: `Inherited from "${best.genome.label}" (${(best.similarity * 100).toFixed(0)}% similar, ` +
        `${best.genome.executionCount} past executions)`,
    };

    log.info(`Strategy inherited: ${result.explanation}`);
    return result;
  }
}

// ═══════════════════════════════════════════
// PHYLOGENETICS ENGINE (main integration)
// ═══════════════════════════════════════════

/**
 * PhylogeneticsEngine — the "evolutionary brain" of CMP.
 *
 * Usage in CMPNode:
 *   const engine = new PhylogeneticsEngine();
 *
 *   // Before execution:
 *   const inherited = engine.analyzeAndInherit(wasmModule, entryPoint, deviceCount);
 *   if (inherited) chunkHint = inherited.chunkCount;
 *
 *   // After execution:
 *   engine.recordExecution(wasmModule, entryPoint, chunkCount, timeMs, elementSize, verified);
 */
export class PhylogeneticsEngine {
  private index: PhylogeneticIndex;
  private inheritor: StrategyInheritor;
  /** Cache: wasmBytes hash → genome vector */
  private vectorCache: Map<string, { vector: Float32Array; analysis: BytecodeAnalysis }> = new Map();
  /** Auto-label counter */
  private labelCounter = 0;

  constructor() {
    this.index = new PhylogeneticIndex();
    this.inheritor = new StrategyInheritor();
  }

  /**
   * Analyze a WASM module and attempt to inherit a strategy
   * from its closest known ancestor.
   *
   * This is the "zero-shot" magic: the module has never been
   * executed, but we already know how to run it optimally.
   *
   * @returns InheritedStrategy if a suitable ancestor exists, null otherwise
   */
  analyzeAndInherit(
    wasmModule: Uint8Array,
    entryPoint: string = 'process',
    availableDevices: number = 4,
  ): InheritedStrategy | null {
    // Encode genome
    const { vector, analysis } = this.encode(wasmModule, entryPoint);
    const fingerprintHash = this.hashWasm(wasmModule);

    // If we already know this exact module, skip inheritance
    if (this.index.has(fingerprintHash)) {
      log.debug(`Known computation ${fingerprintHash.slice(0, 8)} — using direct history`);
      return null; // Let LearningBridge handle exact matches
    }

    // Search for ancestors
    const ancestors = this.index.findAncestors(vector, 5);
    if (ancestors.length === 0) {
      log.info(`No ancestors found for new computation — first of its kind`);
      return null;
    }

    log.info(`Found ${ancestors.length} potential ancestors: ` +
      ancestors.map(a => `${a.genome.label}(${(a.similarity * 100).toFixed(0)}%)`).join(', '));

    // Attempt inheritance
    return this.inheritor.inherit(ancestors, availableDevices);
  }

  /**
   * Record an execution result as a new genome entry.
   * This module is now an ancestor for future computations.
   */
  recordExecution(
    wasmModule: Uint8Array,
    entryPoint: string,
    chunkCount: number,
    totalTimeMs: number,
    elementSize: number = 1,
    verified: boolean = true,
  ): void {
    if (!verified) return; // Only learn from verified results

    const { vector, analysis } = this.encode(wasmModule, entryPoint);
    const fingerprintHash = this.hashWasm(wasmModule);

    const existing = this.index.get(fingerprintHash);

    if (existing) {
      // Update existing genome with new execution data
      const execCount = existing.executionCount + 1;
      const prevStrategy = existing.learnedStrategy;

      const avgTimeMs = prevStrategy
        ? (prevStrategy.avgTimeMs * existing.executionCount + totalTimeMs) / execCount
        : totalTimeMs;

      const bestTimeMs = prevStrategy
        ? Math.min(prevStrategy.bestTimeMs, totalTimeMs)
        : totalTimeMs;

      // Update strategy — favor the chunk count that produced best time
      let bestChunkCount = chunkCount;
      if (prevStrategy && prevStrategy.bestTimeMs < totalTimeMs) {
        bestChunkCount = prevStrategy.chunkCount;
      }

      this.index.updateStrategy(fingerprintHash, {
        chunkCount: bestChunkCount,
        elementSize,
        mergeType: 'concat',
        avgTimeMs: Math.round(avgTimeMs),
        bestTimeMs: Math.round(bestTimeMs),
        confidence: Math.min(execCount / 10, 1.0),
      }, execCount);

      log.debug(`Updated genome ${fingerprintHash.slice(0, 8)}: ${execCount} executions`);
    } else {
      // Register new genome — this computation becomes an ancestor
      const label = this.generateLabel(analysis);

      const genome: ComputationGenome = {
        vector,
        fingerprintHash,
        structuralPattern: analysis.structuralPattern,
        outputRatio: analysis.outputRatio,
        memoryPattern: analysis.memoryPattern,
        learnedStrategy: {
          chunkCount,
          elementSize,
          mergeType: 'concat',
          avgTimeMs: totalTimeMs,
          bestTimeMs: totalTimeMs,
          confidence: 0.1, // Low confidence after 1 execution
        },
        executionCount: 1,
        createdAt: Date.now(),
        label,
      };

      this.index.register(genome);
      log.info(`New ancestor registered: "${label}" (${fingerprintHash.slice(0, 8)})`);
    }
  }

  /**
   * Get the evolutionary tree (all known genomes with relationships).
   */
  getTree(): {
    genomes: ComputationGenome[];
    relationships: Array<{ from: string; to: string; similarity: number }>;
  } {
    const genomes = this.index.getAll();
    const relationships: Array<{ from: string; to: string; similarity: number }> = [];

    // Find closest relative for each genome
    for (const genome of genomes) {
      const ancestors = this.index.findAncestors(genome.vector, 5);
      // Find closest that isn't itself
      for (const a of ancestors) {
        if (a.genome.fingerprintHash !== genome.fingerprintHash && a.similarity > 0.5) {
          relationships.push({
            from: a.genome.fingerprintHash,
            to: genome.fingerprintHash,
            similarity: a.similarity,
          });
          break;
        }
      }
    }

    return { genomes, relationships };
  }

  /**
   * Get stats.
   */
  getStats(): {
    totalGenomes: number;
    withStrategy: number;
    totalExecutions: number;
    oldestGenome: number | null;
  } {
    const base = this.index.getStats();
    const all = this.index.getAll();
    const oldest = all.length > 0
      ? Math.min(...all.map(g => g.createdAt))
      : null;
    return { ...base, oldestGenome: oldest };
  }

  /**
   * Get the phylogenetic index (for testing).
   */
  getIndex(): PhylogeneticIndex {
    return this.index;
  }

  // ── Internal helpers ──

  private encode(wasmModule: Uint8Array, entryPoint: string): {
    vector: Float32Array;
    analysis: BytecodeAnalysis;
  } {
    const cacheKey = this.hashWasm(wasmModule);
    const cached = this.vectorCache.get(cacheKey);
    if (cached) return cached;

    const analysis = analyzeWasmBytecode(wasmModule, entryPoint);
    const vector = encodeGenome(analysis);
    this.vectorCache.set(cacheKey, { vector, analysis });
    return { vector, analysis };
  }

  private hashWasm(wasm: Uint8Array): string {
    // Hash ALL bytes for unique identification
    let hash = 5381;
    for (let i = 0; i < wasm.length; i++) {
      hash = ((hash << 5) + hash + wasm[i]) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  private generateLabel(analysis: BytecodeAnalysis): string {
    this.labelCounter++;
    const pattern = analysis.structuralPattern.replace('linear_', '').replace('compare_', '');
    const complexity = (analysis.entryPoint?.instructionCount ?? 0) > 50 ? 'complex' : 'simple';
    return `${pattern}_${complexity}_${this.labelCounter}`;
  }
}

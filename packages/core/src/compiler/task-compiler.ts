/**
 * CMP v4.0 — Universal Task Compiler
 *
 * Main entry point for auto-parallelization.
 * User submits ANY function. CMP analyzes it, detects parallelizable
 * patterns, generates an execution plan, decomposes data, executes
 * chunks in parallel, and merges results.
 *
 * Usage:
 *   const compiler = new TaskCompiler();
 *   const plan = compiler.compile(wasmModule, inputData, meta);
 *   // Execute chunks on devices...
 *   const merged = compiler.mergeResults(plan, chunkResults);
 *
 * What is novel:
 *   HPC requires MPI annotations.
 *   Cloud serverless requires developer-designed parallelism.
 *   CMP is the first system that auto-parallelizes on a P2P mesh
 *   with zero developer effort.
 *
 * @module compiler/task-compiler
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import {
  ParallelPattern, PatternMatch, CompilationPlan,
  MergeResult, TaskMeta, TaskCompilerConfig, DEFAULT_COMPILER_CONFIG,
  IPattern,
} from './compiler-types';
import { PatternDetector, parseWasmExports } from './pattern-detector';
import { PlanGenerator } from './plan-generator';
import { analyzeInputStructure, InputFormat } from './input-analyzer';
import { verifyMergeCorrectness, VerificationResult } from './merge-verifier';

const log = new Logger('Compiler');

// ─── Compile Result ───

export interface CompileResult {
  /** The full compilation plan */
  plan: CompilationPlan;
  /** All pattern matches (for debugging) */
  allMatches: PatternMatch[];
  /** Time taken to compile (ms) */
  compileTimeMs: number;
  /** Original input data (stored for merge verification) */
  inputData: Uint8Array;
}

// ─── Task Compiler ───

export class TaskCompiler {
  private detector: PatternDetector;
  private generator: PlanGenerator;
  private config: TaskCompilerConfig;

  // Stats
  private stats = {
    totalCompilations: 0,
    totalCompileTimeMs: 0,
    patternCounts: {} as Record<string, number>,
  };

  constructor(config: Partial<TaskCompilerConfig> = {}) {
    this.config = { ...DEFAULT_COMPILER_CONFIG, ...config };
    this.detector = new PatternDetector(this.config);
    this.generator = new PlanGenerator(this.detector.getRegistry(), this.config);
  }

  /**
   * Compile a task: analyze WASM module, detect pattern, generate plan.
   *
   * @param wasmModule - The WASM module to distribute
   * @param inputData - The input data to process
   * @param meta - Task metadata (devices, entry point, etc.)
   * @returns CompileResult with plan and all pattern matches
   */
  compile(wasmModule: Uint8Array, inputData: Uint8Array, meta: TaskMeta): CompileResult {
    const startMs = Date.now();

    // Check minimum input size
    if (inputData.length < this.config.minInputSizeBytes && meta.availableDevices > 1) {
      log.info(`Input too small (${inputData.length} bytes) — using single-device execution`);
      meta = { ...meta, availableDevices: 1, deviceIds: meta.deviceIds.slice(0, 1) };
    }

    // ── Auto-detect input structure (element size, record boundaries) ──
    if (!meta.elementSizeBytes) {
      try {
        const inputStructure = analyzeInputStructure(inputData);
        if (inputStructure.elementSize > 1) {
          meta = { ...meta, elementSizeBytes: inputStructure.elementSize };
          log.info(`Input analysis: ${inputStructure.format}, element size: ${inputStructure.elementSize} bytes`);
        }
      } catch {
        // Input analysis failed, continue with default
      }
    }

    // Detect patterns (includes bytecode analysis)
    const allMatches = this.detector.detect(wasmModule, inputData, meta);
    const bestMatch = this.detector.detectBest(wasmModule, inputData, meta);

    // Generate plan
    const plan = this.generator.generate(bestMatch, wasmModule, inputData, meta);

    const compileTimeMs = Date.now() - startMs;

    // Update stats
    this.stats.totalCompilations++;
    this.stats.totalCompileTimeMs += compileTimeMs;
    this.stats.patternCounts[bestMatch.pattern] =
      (this.stats.patternCounts[bestMatch.pattern] || 0) + 1;

    log.info(
      `Compiled: ${bestMatch.pattern} (${(bestMatch.confidence * 100).toFixed(0)}%), ` +
      `${plan.chunkCount} chunks, ${compileTimeMs}ms`
    );

    return { plan, allMatches, compileTimeMs, inputData };
  }

  /**
   * Merge chunk results using the plan's merge strategy.
   *
   * @param plan - The compilation plan (from compile())
   * @param results - Results from each chunk, in chunk index order
   * @returns Merged result
   */
  mergeResults(plan: CompilationPlan, results: Uint8Array[]): MergeResult {
    const pattern = this.detector.getRegistry().get(plan.pattern);
    if (!pattern) {
      throw new Error(`Unknown pattern for merge: ${plan.pattern}`);
    }

    const mergeResult = pattern.merge(results, plan.meta);

    log.info(
      `Merged: ${plan.pattern}, ${mergeResult.chunksProcessed} chunks → ` +
      `${mergeResult.data.length} bytes, ${mergeResult.mergeTimeMs}ms`
    );

    return mergeResult;
  }

  /**
   * Verify merge correctness by comparing distributed result
   * with local execution on a small sample.
   *
   * Call this after mergeResults() to prove the parallelization
   * produced the correct output.
   *
   * @param compileResult - Result from compile()
   * @param mergedData - Output from mergeResults()
   * @returns Verification result (passed/failed + details)
   */
  async verifyMerge(
    compileResult: CompileResult,
    mergedData: Uint8Array,
  ): Promise<VerificationResult> {
    const elementSize = compileResult.plan.meta.elementSize ?? 1;
    return verifyMergeCorrectness(
      compileResult.plan.wasmModule,
      compileResult.inputData,
      mergedData,
      compileResult.plan.meta.entryPoint ?? 'process',
      elementSize,
    );
  }

  /**
   * Convenience: compile + get a specific pattern instance.
   */
  getPattern(name: ParallelPattern): IPattern | undefined {
    return this.detector.getRegistry().get(name);
  }

  /**
   * Parse WASM module exports (useful for debugging).
   */
  parseExports(wasmModule: Uint8Array): string[] {
    return parseWasmExports(wasmModule);
  }

  /**
   * Get compiler statistics.
   */
  getStats(): {
    totalCompilations: number;
    avgCompileTimeMs: number;
    patternCounts: Record<string, number>;
  } {
    return {
      totalCompilations: this.stats.totalCompilations,
      avgCompileTimeMs: this.stats.totalCompilations > 0
        ? Math.round(this.stats.totalCompileTimeMs / this.stats.totalCompilations)
        : 0,
      patternCounts: { ...this.stats.patternCounts },
    };
  }

  /**
   * Get the pattern detector (for direct access/testing).
   */
  getDetector(): PatternDetector {
    return this.detector;
  }
}

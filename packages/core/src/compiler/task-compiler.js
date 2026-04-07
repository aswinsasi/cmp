"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskCompiler = void 0;
const logger_1 = require("../utils/logger");
const compiler_types_1 = require("./compiler-types");
const pattern_detector_1 = require("./pattern-detector");
const plan_generator_1 = require("./plan-generator");
const log = new logger_1.Logger('Compiler');
// ─── Task Compiler ───
class TaskCompiler {
    detector;
    generator;
    config;
    // Stats
    stats = {
        totalCompilations: 0,
        totalCompileTimeMs: 0,
        patternCounts: {},
    };
    constructor(config = {}) {
        this.config = { ...compiler_types_1.DEFAULT_COMPILER_CONFIG, ...config };
        this.detector = new pattern_detector_1.PatternDetector(this.config);
        this.generator = new plan_generator_1.PlanGenerator(this.detector.getRegistry(), this.config);
    }
    /**
     * Compile a task: analyze WASM module, detect pattern, generate plan.
     *
     * @param wasmModule - The WASM module to distribute
     * @param inputData - The input data to process
     * @param meta - Task metadata (devices, entry point, etc.)
     * @returns CompileResult with plan and all pattern matches
     */
    compile(wasmModule, inputData, meta) {
        const startMs = Date.now();
        // Check minimum input size
        if (inputData.length < this.config.minInputSizeBytes && meta.availableDevices > 1) {
            log.info(`Input too small (${inputData.length} bytes) — using single-device execution`);
            meta = { ...meta, availableDevices: 1, deviceIds: meta.deviceIds.slice(0, 1) };
        }
        // Detect patterns
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
        log.info(`Compiled: ${bestMatch.pattern} (${(bestMatch.confidence * 100).toFixed(0)}%), ` +
            `${plan.chunkCount} chunks, ${compileTimeMs}ms`);
        return { plan, allMatches, compileTimeMs };
    }
    /**
     * Merge chunk results using the plan's merge strategy.
     *
     * @param plan - The compilation plan (from compile())
     * @param results - Results from each chunk, in chunk index order
     * @returns Merged result
     */
    mergeResults(plan, results) {
        const pattern = this.detector.getRegistry().get(plan.pattern);
        if (!pattern) {
            throw new Error(`Unknown pattern for merge: ${plan.pattern}`);
        }
        const mergeResult = pattern.merge(results, plan.meta);
        log.info(`Merged: ${plan.pattern}, ${mergeResult.chunksProcessed} chunks → ` +
            `${mergeResult.data.length} bytes, ${mergeResult.mergeTimeMs}ms`);
        return mergeResult;
    }
    /**
     * Convenience: compile + get a specific pattern instance.
     */
    getPattern(name) {
        return this.detector.getRegistry().get(name);
    }
    /**
     * Parse WASM module exports (useful for debugging).
     */
    parseExports(wasmModule) {
        return (0, pattern_detector_1.parseWasmExports)(wasmModule);
    }
    /**
     * Get compiler statistics.
     */
    getStats() {
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
    getDetector() {
        return this.detector;
    }
}
exports.TaskCompiler = TaskCompiler;
//# sourceMappingURL=task-compiler.js.map
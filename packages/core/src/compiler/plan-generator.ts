/**
 * CMP v4.0 — Plan Generator
 *
 * Given a detected pattern and mesh state, generates a full
 * CompilationPlan including:
 *   - Number of chunks (data-aware splitting)
 *   - Device assignments (based on capability, load, data locality)
 *   - Merge strategy (how results combine)
 *   - Fallback plan (if a device fails)
 *
 * @module compiler/plan-generator
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import {
  IPattern, ParallelPattern, PatternMatch, CompilationPlan,
  MergeType, DataChunk, TaskMeta, DecompositionResult,
  TaskCompilerConfig, DEFAULT_COMPILER_CONFIG,
} from './compiler-types';
import { PatternRegistry } from './pattern-detector';

const log = new Logger('PlanGen');

// ─── Plan Generator ───

export class PlanGenerator {
  private registry: PatternRegistry;
  private config: TaskCompilerConfig;

  constructor(registry: PatternRegistry, config: Partial<TaskCompilerConfig> = {}) {
    this.registry = registry;
    this.config = { ...DEFAULT_COMPILER_CONFIG, ...config };
  }

  /**
   * Generate a full compilation plan.
   */
  generate(
    match: PatternMatch,
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    meta: TaskMeta,
  ): CompilationPlan {
    const pattern = this.registry.get(match.pattern);
    if (!pattern) {
      throw new Error(`Unknown pattern: ${match.pattern}`);
    }

    // Determine chunk count
    const chunkCount = this.computeChunkCount(match, inputData, meta);

    // Decompose input data
    const decomposition = pattern.decompose(inputData, chunkCount, meta);

    // Assign chunks to devices
    const deviceAssignments = this.assignDevices(decomposition.chunks, meta);

    // Build plan
    const plan: CompilationPlan = {
      pattern: match.pattern,
      confidence: match.confidence,
      chunkCount: decomposition.chunks.length,
      mergeType: pattern.mergeType,
      orderPreserving: match.orderPreserving,
      deviceAssignments,
      wasmModule,
      chunks: decomposition.chunks,
      meta: decomposition.meta,
      fallbackPattern: this.chooseFallback(match.pattern),
      explanation: this.buildExplanation(match, decomposition, meta),
    };

    log.info(
      `Plan: ${match.pattern}, ${plan.chunkCount} chunks, ` +
      `${deviceAssignments.size} devices, merge: ${pattern.mergeType}`
    );

    return plan;
  }

  // ══════════════════════════════════════
  // Chunk Count
  // ══════════════════════════════════════

  private computeChunkCount(match: PatternMatch, inputData: Uint8Array, meta: TaskMeta): number {
    // Use pattern's suggestion as starting point
    let count = match.suggestedChunks;

    // Adjust based on input size
    const minChunkSizeBytes = 512; // Don't create chunks smaller than 512 bytes
    const maxBySize = Math.max(1, Math.floor(inputData.length / minChunkSizeBytes));
    count = Math.min(count, maxBySize);

    // Cap by available devices
    count = Math.min(count, meta.availableDevices);

    // Cap by config max
    count = Math.min(count, this.config.maxChunks);

    // Minimum 1
    count = Math.max(1, count);

    // Generic pattern: don't chunk (replicate instead)
    if (match.pattern === ParallelPattern.GENERIC) {
      count = Math.min(3, meta.availableDevices);
    }

    return count;
  }

  // ══════════════════════════════════════
  // Device Assignment
  // ══════════════════════════════════════

  /**
   * Assign chunks to available devices using round-robin.
   * In future phases, this will use DeviceScorer for smarter assignment.
   */
  private assignDevices(chunks: DataChunk[], meta: TaskMeta): Map<string, number[]> {
    const assignments = new Map<string, number[]>();
    const deviceIds = meta.deviceIds;

    if (deviceIds.length === 0) {
      // No devices — assign all to 'local'
      assignments.set('local', chunks.map(c => c.index));
      return assignments;
    }

    // Round-robin assignment
    for (const chunk of chunks) {
      const deviceId = deviceIds[chunk.index % deviceIds.length];
      const existing = assignments.get(deviceId) ?? [];
      existing.push(chunk.index);
      assignments.set(deviceId, existing);
    }

    return assignments;
  }

  // ══════════════════════════════════════
  // Fallback
  // ══════════════════════════════════════

  private chooseFallback(pattern: ParallelPattern): ParallelPattern {
    switch (pattern) {
      case ParallelPattern.SORT:
      case ParallelPattern.MATRIX:
      case ParallelPattern.ML_TRAIN:
        return ParallelPattern.MAP; // Fall back to simple map if specialized fails
      case ParallelPattern.SEARCH:
        return ParallelPattern.MAP; // Search can fall back to map (process all)
      case ParallelPattern.MAP:
      case ParallelPattern.FILTER:
      case ParallelPattern.REDUCE:
        return ParallelPattern.GENERIC; // Simple patterns fall back to race
      default:
        return ParallelPattern.GENERIC;
    }
  }

  // ══════════════════════════════════════
  // Explanation
  // ══════════════════════════════════════

  private buildExplanation(
    match: PatternMatch,
    decomposition: DecompositionResult,
    meta: TaskMeta,
  ): string {
    const chunks = decomposition.chunks;
    const totalBytes = chunks.reduce((s, c) => s + c.length, 0);
    const avgChunkBytes = chunks.length > 0 ? Math.round(totalBytes / chunks.length) : 0;

    return [
      `Pattern: ${match.pattern} (confidence: ${(match.confidence * 100).toFixed(0)}%)`,
      `Reason: ${match.reason}`,
      `Chunks: ${chunks.length} (avg ${avgChunkBytes} bytes each)`,
      `Devices: ${meta.availableDevices} available`,
      `Order: ${match.orderPreserving ? 'preserved' : 'not required'}`,
    ].join('\n');
  }
}

"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanGenerator = void 0;
const logger_1 = require("../utils/logger");
const compiler_types_1 = require("./compiler-types");
const log = new logger_1.Logger('PlanGen');
// ─── Plan Generator ───
class PlanGenerator {
    registry;
    config;
    constructor(registry, config = {}) {
        this.registry = registry;
        this.config = { ...compiler_types_1.DEFAULT_COMPILER_CONFIG, ...config };
    }
    /**
     * Generate a full compilation plan.
     */
    generate(match, wasmModule, inputData, meta) {
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
        const plan = {
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
        log.info(`Plan: ${match.pattern}, ${plan.chunkCount} chunks, ` +
            `${deviceAssignments.size} devices, merge: ${pattern.mergeType}`);
        return plan;
    }
    // ══════════════════════════════════════
    // Chunk Count
    // ══════════════════════════════════════
    computeChunkCount(match, inputData, meta) {
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
        if (match.pattern === compiler_types_1.ParallelPattern.GENERIC) {
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
    assignDevices(chunks, meta) {
        const assignments = new Map();
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
    chooseFallback(pattern) {
        switch (pattern) {
            case compiler_types_1.ParallelPattern.SORT:
            case compiler_types_1.ParallelPattern.MATRIX:
            case compiler_types_1.ParallelPattern.ML_TRAIN:
                return compiler_types_1.ParallelPattern.MAP; // Fall back to simple map if specialized fails
            case compiler_types_1.ParallelPattern.SEARCH:
                return compiler_types_1.ParallelPattern.MAP; // Search can fall back to map (process all)
            case compiler_types_1.ParallelPattern.MAP:
            case compiler_types_1.ParallelPattern.FILTER:
            case compiler_types_1.ParallelPattern.REDUCE:
                return compiler_types_1.ParallelPattern.GENERIC; // Simple patterns fall back to race
            default:
                return compiler_types_1.ParallelPattern.GENERIC;
        }
    }
    // ══════════════════════════════════════
    // Explanation
    // ══════════════════════════════════════
    buildExplanation(match, decomposition, meta) {
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
exports.PlanGenerator = PlanGenerator;
//# sourceMappingURL=plan-generator.js.map
"use strict";
/**
 * CMP Strategy Hint Generator
 * Queries the MER store and produces CMP_STRATEGY_HINT objects
 * that bias (but don't override) the negotiation and distribution layers.
 *
 * Hints are generated before task submission when the local Mesh Memory
 * contains relevant experience for the pending task type.
 *
 * Integration points:
 *   - NegotiationEngine: hint populates strategy_hint in task request
 *   - TaskDistributor: hint's chunkSize/deviceCount used as initial params
 *
 * @module mcl/hints
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateHint = generateHint;
exports.applyHint = applyHint;
exports.hintToWire = hintToWire;
exports.hintFromWire = hintFromWire;
const __1 = require("../");
const mcl_1 = require("../types/mcl");
const evolution_1 = require("./evolution");
const log = new __1.Logger('Hints');
/**
 * Generate a strategy hint for a given task type.
 *
 * Queries the MER store, ranks results, optionally runs micro-evolution
 * if multiple MERs exist, and produces a hint.
 *
 * Returns null if:
 *   - No MERs found for this task type
 *   - Best MER's confidence is below minConfidence
 *   - Current mesh conditions differ too much from MER context
 *
 * @param store - Local MER store
 * @param taskType - Task type to generate hint for
 * @param currentMeshSignature - Current mesh's capability signature (optional)
 * @param currentDeviceCount - Current mesh device count (for condition check)
 * @param minConfidence - Minimum confidence to produce a hint (0-100)
 * @returns Strategy hint, or null if insufficient data
 */
function generateHint(store, taskType, currentMeshSignature, currentDeviceCount, minConfidence = mcl_1.MER_MIN_HINT_CONFIDENCE) {
    // Query ranked MERs for this task type
    const results = store.query(taskType, currentMeshSignature, 10);
    if (results.length === 0) {
        log.debug(`No MERs found for task type ${taskType}`);
        return null;
    }
    const bestResult = results[0];
    const bestMer = bestResult.mer;
    // Confidence gate
    if (bestMer.confidence < minConfidence) {
        log.debug(`Best MER confidence (${bestMer.confidence}) below threshold (${minConfidence})`);
        return null;
    }
    // Condition divergence check: if current mesh is very different
    // from the MER's context, downweight or skip
    if (currentDeviceCount !== undefined && bestMer.deviceCount > 0) {
        const deviation = Math.abs(currentDeviceCount - bestMer.deviceCount) / bestMer.deviceCount;
        if (deviation > 0.6) {
            log.debug(`Mesh conditions too different: current=${currentDeviceCount} vs MER=${bestMer.deviceCount} (${(deviation * 100).toFixed(0)}% deviation)`);
            return null;
        }
    }
    // If we have multiple MERs, try evolution for better parameters
    let hintChunkSize = bestMer.learnedHints.optimalChunkSizeKb;
    let hintDeviceCount = bestMer.learnedHints.optimalDeviceCount;
    let hintTierPrefs = new Uint8Array(bestMer.learnedHints.bestTierMapping);
    let hintStrategy = bestMer.strategyUsed;
    let hintGeneration = bestMer.generation;
    if (results.length >= 2) {
        const evolved = (0, evolution_1.evolveParams)(results.map(r => r.mer));
        if (evolved) {
            hintChunkSize = evolved.chunkSizeKb;
            hintDeviceCount = evolved.deviceCount;
            hintTierPrefs = evolved.tierMapping;
            hintStrategy = evolved.strategy;
            hintGeneration = evolved.generation;
            log.info(`Using evolved hint: gen=${hintGeneration} chunk=${hintChunkSize}KB devices=${hintDeviceCount}`);
        }
    }
    // Calculate aggregate confidence from contributing MERs
    const avgConfidence = Math.round(results.reduce((sum, r) => sum + r.mer.confidence, 0) / results.length);
    // Apply condition-based downweighting
    let finalConfidence = avgConfidence;
    if (currentDeviceCount !== undefined && bestMer.deviceCount > 0) {
        const deviation = Math.abs(currentDeviceCount - bestMer.deviceCount) / bestMer.deviceCount;
        // Linear downweight: 0% deviation = 100% confidence, 40% deviation = 60% confidence
        finalConfidence = Math.round(avgConfidence * (1 - deviation));
    }
    const hint = {
        recommendedStrategy: hintStrategy,
        recommendedChunkCount: Math.max(1, hintDeviceCount), // chunks ≈ devices for data-parallel
        recommendedChunkSizeKb: Math.max(1, hintChunkSize),
        tierPreferences: hintTierPrefs,
        confidence: Math.max(0, Math.min(100, finalConfidence)),
        merGeneration: hintGeneration,
        sourceMerCount: results.length,
    };
    log.info(`Hint generated: strategy=${hint.recommendedStrategy} chunks=${hint.recommendedChunkCount} ` +
        `chunkSize=${hint.recommendedChunkSizeKb}KB conf=${hint.confidence} from ${hint.sourceMerCount} MERs`);
    return hint;
}
/**
 * Apply a strategy hint to task distribution parameters.
 *
 * This function is called by the TaskDistributor to apply learned
 * parameters. It biases but does NOT override — if the hint confidence
 * is below threshold, original parameters are returned unchanged.
 *
 * @param originalChunkHint - Original chunk hint from task request (0 = auto)
 * @param originalDeviceCount - Number of assigned devices
 * @param hint - Strategy hint from generateHint()
 * @param minConfidence - Minimum confidence to apply hint
 * @returns Adjusted parameters: { chunkCount, chunkSizeKb }
 */
function applyHint(originalChunkHint, originalDeviceCount, hint, minConfidence = mcl_1.MER_MIN_HINT_CONFIDENCE) {
    // No hint or below confidence
    if (!hint || hint.confidence < minConfidence) {
        return {
            chunkCount: originalChunkHint > 0 ? originalChunkHint : originalDeviceCount,
            chunkSizeKb: null, // use default
            applied: false,
        };
    }
    // Apply hint chunk count (but don't exceed available devices)
    const hintedChunkCount = Math.min(hint.recommendedChunkCount, originalDeviceCount);
    // Use original if user explicitly set chunkHint
    const chunkCount = originalChunkHint > 0 ? originalChunkHint : hintedChunkCount;
    log.debug(`Hint applied: chunks=${chunkCount} (hint=${hint.recommendedChunkCount}, ` +
        `original=${originalChunkHint || 'auto'}, devices=${originalDeviceCount})`);
    return {
        chunkCount: Math.max(1, chunkCount),
        chunkSizeKb: hint.recommendedChunkSizeKb,
        applied: true,
    };
}
/**
 * Convert a strategy hint to wire format for JSON serialization.
 */
function hintToWire(hint) {
    return {
        recommendedStrategy: hint.recommendedStrategy,
        recommendedChunkCount: hint.recommendedChunkCount,
        recommendedChunkSizeKb: hint.recommendedChunkSizeKb,
        tierPreferences: Array.from(hint.tierPreferences),
        confidence: hint.confidence,
        merGeneration: hint.merGeneration,
        sourceMerCount: hint.sourceMerCount,
    };
}
/**
 * Reconstruct a strategy hint from wire format.
 */
function hintFromWire(wire) {
    return {
        recommendedStrategy: wire.recommendedStrategy,
        recommendedChunkCount: wire.recommendedChunkCount,
        recommendedChunkSizeKb: wire.recommendedChunkSizeKb,
        tierPreferences: new Uint8Array(wire.tierPreferences),
        confidence: wire.confidence,
        merGeneration: wire.merGeneration,
        sourceMerCount: wire.sourceMerCount,
    };
}
//# sourceMappingURL=hints.js.map
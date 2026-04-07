"use strict";
/**
 * CMP Adaptive Decomposition Evolution
 * Evolves task decomposition strategies through natural selection.
 *
 * When multiple MERs exist for the same task type, the evolution engine:
 *   1. Select: Rank MERs by confidence × efficiency
 *   2. Crossover: Best MER's chunk_size + second-best's device_count
 *   3. Mutate: ±10% perturbation (rate decreases with generation)
 *   4. Evaluate: Parameters used for next task execution
 *   5. Record: If outperforms parents, new MER with generation+1
 *
 * Convergence: Generation capped at 100, mutation rate = 10% / sqrt(gen+1)
 * This implements simulated annealing — early exploration, late exploitation.
 *
 * @module mcl/evolution
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evolveParams = evolveParams;
exports.didOutperform = didOutperform;
exports.efficiencyEMA = efficiencyEMA;
const __1 = require("../");
const mcl_1 = require("../types/mcl");
const log = new __1.Logger('Evolution');
/**
 * Evolve decomposition parameters from multiple MERs.
 *
 * Requires at least 2 MERs. Returns null if evolution is not possible.
 *
 * @param mers - MERs for the same task type, pre-ranked by quality
 * @returns Evolved parameters, or null if insufficient data
 */
function evolveParams(mers) {
    if (mers.length < 2) {
        log.debug('Evolution requires at least 2 MERs, skipping');
        return null;
    }
    // Step 1: Select — rank by fitness (confidence × efficiency / 100)
    const ranked = [...mers]
        .map(m => ({
        mer: m,
        fitness: (m.confidence * m.performance.executionEfficiency) / 100,
    }))
        .sort((a, b) => b.fitness - a.fitness);
    const best = ranked[0].mer;
    const second = ranked[1].mer;
    const maxGen = Math.max(best.generation, second.generation);
    // Generation cap
    if (maxGen >= mcl_1.MER_MAX_GENERATION) {
        log.debug(`Generation cap reached (${maxGen}), no further evolution`);
        return null;
    }
    // Step 2: Crossover — best's chunk_size + second's device_count
    let chunkSizeKb = best.learnedHints.optimalChunkSizeKb;
    let deviceCount = second.learnedHints.optimalDeviceCount;
    // Tier mapping: take from best parent
    const tierMapping = new Uint8Array(best.learnedHints.bestTierMapping);
    // Step 3: Mutate — perturbation decreases with generation (simulated annealing)
    const mutationRate = 0.10 / Math.sqrt(maxGen + 1);
    chunkSizeKb = mutateValue(chunkSizeKb, mutationRate, 64, 65536);
    deviceCount = mutateValue(deviceCount, mutationRate, 1, 50);
    deviceCount = Math.round(deviceCount); // Must be integer
    // Occasionally mutate tier mapping (20% chance per tier)
    for (let i = 0; i < tierMapping.length; i++) {
        if (Math.random() < mutationRate * 2) {
            tierMapping[i] = Math.floor(Math.random() * 3); // 0=EXCLUDE, 1=COMPUTE, 2=PREFER
        }
    }
    const newGen = maxGen + 1;
    log.info(`Evolved: gen=${newGen} chunk=${chunkSizeKb}KB devices=${deviceCount} ` +
        `(from parents gen=${best.generation},${second.generation} mut=${(mutationRate * 100).toFixed(1)}%)`);
    return {
        chunkSizeKb: Math.round(chunkSizeKb),
        deviceCount,
        tierMapping,
        strategy: best.strategyUsed,
        generation: newGen,
        parentIds: [best.merId, second.merId],
    };
}
/**
 * Check if evolved parameters outperformed parent MERs.
 * Call this after executing a task with evolved parameters.
 *
 * @param evolvedEfficiency - Execution efficiency of the evolved run (0-100)
 * @param parents - Parent MERs used for evolution
 * @returns true if evolved run was better than both parents
 */
function didOutperform(evolvedEfficiency, parents) {
    if (parents.length === 0)
        return true;
    const bestParentEfficiency = Math.max(...parents.map(p => p.performance.executionEfficiency));
    // Must outperform by at least 2% to avoid noise
    const threshold = bestParentEfficiency + 2;
    const result = evolvedEfficiency >= threshold;
    log.debug(`Outperform check: evolved=${evolvedEfficiency}% vs best_parent=${bestParentEfficiency}% ` +
        `threshold=${threshold}% → ${result ? 'YES' : 'NO'}`);
    return result;
}
/**
 * Calculate an Exponential Moving Average of recent efficiencies.
 * Provides stability for production workloads alongside evolution.
 *
 * @param history - Recent efficiency values (0-100)
 * @param alpha - Smoothing factor (0-1, higher = more weight on recent)
 * @returns EMA value
 */
function efficiencyEMA(history, alpha = 0.3) {
    if (history.length === 0)
        return 50; // neutral default
    if (history.length === 1)
        return history[0];
    let ema = history[0];
    for (let i = 1; i < history.length; i++) {
        ema = alpha * history[i] + (1 - alpha) * ema;
    }
    return Math.round(ema);
}
// ── Helpers ──
/**
 * Mutate a numeric value by ±mutationRate percent.
 * Clamps to [min, max] range.
 */
function mutateValue(value, mutationRate, min, max) {
    const delta = value * mutationRate * (Math.random() * 2 - 1); // ±mutationRate%
    return Math.max(min, Math.min(max, value + delta));
}
//# sourceMappingURL=evolution.js.map
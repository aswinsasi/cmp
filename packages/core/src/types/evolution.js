"use strict";
/**
 * CMP v1.4 — Genome Mutation + Natural Selection Types
 * The WASM binary itself can be mutated. A Lifeform spawns a MUTANT —
 * a next-generation copy with modified code — and the mesh applies
 * selection pressure to determine which generation survives.
 *
 * @module types/evolution
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MutationType = void 0;
exports.calculateFitness = calculateFitness;
// ─── Mutation Types ───
var MutationType;
(function (MutationType) {
    /** Change a numeric constant in a function body */
    MutationType["CONSTANT_MUTATION"] = "constant_mutation";
    /** Swap one function's body with another from mutation library */
    MutationType["FUNCTION_SWAP"] = "function_swap";
    /** Add a new function from mutation library */
    MutationType["FUNCTION_INSERT"] = "function_insert";
    /** Remove a non-essential function */
    MutationType["FUNCTION_REMOVE"] = "function_remove";
    /** Change a global variable's initial value */
    MutationType["GLOBAL_MUTATION"] = "global_mutation";
    /** Crossover: combine functions from two parent genomes */
    MutationType["CROSSOVER"] = "crossover";
})(MutationType || (exports.MutationType = MutationType = {}));
/**
 * Calculate composite fitness score from individual metrics.
 */
function calculateFitness(score) {
    // Normalize each metric to 0-1 range and weight
    const responseScore = Math.max(0, 1 - score.avgResponseTimeMs / 1000); // <1s = good
    const efficiencyScore = Math.min(1, score.ccuEfficiency);
    const errorScore = Math.max(0, 1 - score.errorRate);
    const throughputScore = Math.min(1, score.throughput / 100); // 100/hr = good
    const intentScore = score.intentSatisfactionRate;
    const composite = responseScore * 0.20 +
        efficiencyScore * 0.30 +
        errorScore * 0.25 +
        throughputScore * 0.15 +
        intentScore * 0.10;
    return { ...score, composite };
}
//# sourceMappingURL=evolution.js.map
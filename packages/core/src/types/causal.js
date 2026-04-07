"use strict";
/**
 * CMP v1.4 — Causal Reactive Execution Types
 * Lifeforms compute ONLY when CAUSED to compute. Causes propagate
 * through synapse networks creating emergent cascading behavior.
 *
 * Key innovations:
 *   - Causal chain tracking across the mesh
 *   - CCU-per-cause billing (not per-tick)
 *   - Causal backpressure (circuit-breaking at causal level)
 *   - Causal deadlines (end-to-end propagation)
 *
 * @module types/causal
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CAUSE_BILLING = exports.WatchCondition = exports.CauseType = void 0;
exports.calculateCauseCost = calculateCauseCost;
exports.calculateHostingCost = calculateHostingCost;
// ─── Cause Types ───
var CauseType;
(function (CauseType) {
    /** External message from a device */
    CauseType["MESSAGE"] = "message";
    /** Synapse signal from another Lifeform */
    CauseType["SYNAPSE_SIGNAL"] = "synapse_signal";
    /** Timer expiration (one-shot or recurring) */
    CauseType["TIMER"] = "timer";
    /** State change on a watched CRDT key */
    CauseType["STATE_WATCH"] = "state_watch";
    /** Mesh event: peer joined, peer left, lifeform migrated */
    CauseType["MESH_EVENT"] = "mesh_event";
    /** CCU balance crossed a threshold */
    CauseType["CCU_THRESHOLD"] = "ccu_threshold";
    /** Intent violation detected */
    CauseType["INTENT_VIOLATION"] = "intent_violation";
    /** Fusion request from another Lifeform */
    CauseType["FUSION_REQUEST"] = "fusion_request";
    /** Distributed computation result returned */
    CauseType["DISTRIBUTION_RESULT"] = "distribution_result";
})(CauseType || (exports.CauseType = CauseType = {}));
var WatchCondition;
(function (WatchCondition) {
    WatchCondition["ANY_CHANGE"] = "any_change";
    WatchCondition["THRESHOLD_ABOVE"] = "threshold_above";
    WatchCondition["THRESHOLD_BELOW"] = "threshold_below";
    WatchCondition["MEMBERSHIP_CHANGE"] = "membership_change";
})(WatchCondition || (exports.WatchCondition = WatchCondition = {}));
exports.DEFAULT_CAUSE_BILLING = {
    baseCostCcu: 0.01,
    computeCostPerMs: 0.001,
    stateMutationCost: 0.002,
    stateHostingCostPerMbHour: 0.5,
};
/**
 * Calculate the CCU cost of a single cause execution.
 */
function calculateCauseCost(billing, executionTimeMs, stateMutations) {
    return billing.baseCostCcu +
        (executionTimeMs * billing.computeCostPerMs) +
        (stateMutations * billing.stateMutationCost);
}
/**
 * Calculate hourly state hosting cost.
 */
function calculateHostingCost(billing, stateSizeBytes) {
    const sizeMb = stateSizeBytes / (1024 * 1024);
    return sizeMb * billing.stateHostingCostPerMbHour;
}
//# sourceMappingURL=causal.js.map
"use strict";
/**
 * CMP v3.0 — Mesh Dreaming Type Definitions
 * When the mesh is idle, it "dreams" — running background self-optimization.
 *
 * 5 dream phases:
 *   1. DEFRAGMENT — rebalance Lifeform placement, compact CRDT tombstones
 *   2. SPECULATE — run Precognition predictions, pre-cache results
 *   3. EVOLVE — evaluate pending genome mutations on idle CPU
 *   4. OPTIMIZE — prune neuromorphic routing, adjust organ boundaries
 *   5. DISCOVER — mine MER history for patterns, store as Computation Fossils
 *
 * @module types/dreaming
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DREAM_CONFIG = exports.DreamState = exports.DreamPhase = void 0;
// ─── Dream Phases ───
var DreamPhase;
(function (DreamPhase) {
    /** Rebalance and compact */
    DreamPhase["DEFRAGMENT"] = "defragment";
    /** Pre-compute predicted tasks */
    DreamPhase["SPECULATE"] = "speculate";
    /** Run evolution evaluations without live traffic */
    DreamPhase["EVOLVE"] = "evolve";
    /** Prune weak neural pathways, adjust organs */
    DreamPhase["OPTIMIZE"] = "optimize";
    /** Mine execution history for undiscovered patterns */
    DreamPhase["DISCOVER"] = "discover";
})(DreamPhase || (exports.DreamPhase = DreamPhase = {}));
// ─── Dream State ───
var DreamState;
(function (DreamState) {
    /** Not dreaming — mesh is active */
    DreamState["AWAKE"] = "awake";
    /** Entering dream state */
    DreamState["FALLING_ASLEEP"] = "falling_asleep";
    /** Actively dreaming */
    DreamState["DREAMING"] = "dreaming";
    /** Waking up (task arrived) */
    DreamState["WAKING"] = "waking";
})(DreamState || (exports.DreamState = DreamState = {}));
exports.DEFAULT_DREAM_CONFIG = {
    idleThresholdMs: 30000,
    maxDreamDurationMs: 300000,
    phaseTimeMs: 60000,
    enabledPhases: [
        DreamPhase.DEFRAGMENT,
        DreamPhase.SPECULATE,
        DreamPhase.EVOLVE,
        DreamPhase.OPTIMIZE,
        DreamPhase.DISCOVER,
    ],
    maxDreamCPU: 0.3,
};
//# sourceMappingURL=dreaming.js.map
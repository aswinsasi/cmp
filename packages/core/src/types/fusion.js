"use strict";
/**
 * CMP v1.4 — Computational Fusion/Fission Types
 * Two Lifeforms can MERGE into a single composite entity (Fusion)
 * and later SPLIT back (Fission). Completely unprecedented in computing.
 *
 * Fusion merges: CRDT state, WASM genomes, identities, CCU balances.
 * The composite can do things NEITHER component could alone.
 *
 * @module types/fusion
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FissionTrigger = exports.StateConflictStrategy = void 0;
var StateConflictStrategy;
(function (StateConflictStrategy) {
    /** Keep the CRDT value with higher timestamp */
    StateConflictStrategy["TIMESTAMP_WINS"] = "timestamp_wins";
    /** Prefix all keys with original Lifeform name */
    StateConflictStrategy["NAMESPACE_PREFIX"] = "namespace_prefix";
    /** Merge CRDTs directly (only works if same CRDT type) */
    StateConflictStrategy["CRDT_MERGE"] = "crdt_merge";
})(StateConflictStrategy || (exports.StateConflictStrategy = StateConflictStrategy = {}));
var FissionTrigger;
(function (FissionTrigger) {
    /** Split when load drops below threshold */
    FissionTrigger["LOW_LOAD"] = "low_load";
    /** Split when CCU balance drops below threshold */
    FissionTrigger["LOW_CCU"] = "low_ccu";
    /** Split after a fixed duration */
    FissionTrigger["DURATION_EXPIRED"] = "duration_expired";
    /** Split when an intent is satisfied */
    FissionTrigger["INTENT_SATISFIED"] = "intent_satisfied";
    /** Manual fission only */
    FissionTrigger["MANUAL_ONLY"] = "manual_only";
})(FissionTrigger || (exports.FissionTrigger = FissionTrigger = {}));
//# sourceMappingURL=fusion.js.map
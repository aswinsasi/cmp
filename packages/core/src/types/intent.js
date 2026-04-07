"use strict";
/**
 * CMP v1.4 — Intent Contract Types
 * A Lifeform declares machine-verifiable INTENTs — formal promises
 * about what it will achieve. The mesh verifies via probabilistic
 * sampling without re-execution or global consensus.
 *
 * @module types/intent
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViolationAction = exports.PredicateType = void 0;
var PredicateType;
(function (PredicateType) {
    /** Simple value comparison on a single CRDT key */
    PredicateType["VALUE_CHECK"] = "value_check";
    /** Rate check: value change per time window */
    PredicateType["RATE_CHECK"] = "rate_check";
    /** Freshness: key was updated within N ms */
    PredicateType["FRESHNESS_CHECK"] = "freshness_check";
    /** Compound: AND/OR of sub-predicates */
    PredicateType["COMPOUND"] = "compound";
})(PredicateType || (exports.PredicateType = PredicateType = {}));
// ─── Violation Actions ───
var ViolationAction;
(function (ViolationAction) {
    /** Emit INTENT_VIOLATION cause to the Lifeform (self-correct) */
    ViolationAction["NOTIFY"] = "notify";
    /** Slash staked CCU and notify beneficiary */
    ViolationAction["SLASH"] = "slash";
    /** Kill the Lifeform */
    ViolationAction["KILL"] = "kill";
    /** Force fission if composite */
    ViolationAction["FORCE_FISSION"] = "force_fission";
})(ViolationAction || (exports.ViolationAction = ViolationAction = {}));
//# sourceMappingURL=intent.js.map
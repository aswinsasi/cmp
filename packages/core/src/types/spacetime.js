"use strict";
/**
 * CMP v2.0 — Layer 12: Computation Spacetime Types
 *
 * Fork reality. Run parallel universes. Merge the best one back.
 *
 * Every cause execution becomes a node in a Merkle DAG — a complete,
 * content-addressed, immutable computation history. Timelines can be
 * forked into parallel branches, raced against each other, and merged
 * back using CRDT conflict-free merge.
 *
 * Wire Protocol: 0xE6-0xEB
 *
 * @module types/spacetime
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SPACETIME_CONFIG = exports.FitnessMetric = exports.RaceState = exports.BranchState = exports.SpacetimeMessageType = void 0;
// ═══════════════════════════════════════
// Wire Protocol Messages (0xE6-0xEB)
// ═══════════════════════════════════════
var SpacetimeMessageType;
(function (SpacetimeMessageType) {
    /** Fork a Lifeform's timeline into a new branch */
    SpacetimeMessageType[SpacetimeMessageType["TIMELINE_FORK"] = 230] = "TIMELINE_FORK";
    /** Sync branch state to interested peers */
    SpacetimeMessageType[SpacetimeMessageType["BRANCH_STATE_SYNC"] = 231] = "BRANCH_STATE_SYNC";
    /** Start a branch race (N branches, best wins) */
    SpacetimeMessageType[SpacetimeMessageType["BRANCH_RACE_START"] = 232] = "BRANCH_RACE_START";
    /** Branch fitness metrics update */
    SpacetimeMessageType[SpacetimeMessageType["BRANCH_METRICS"] = 233] = "BRANCH_METRICS";
    /** Merge a winning branch back into trunk */
    SpacetimeMessageType[SpacetimeMessageType["TIMELINE_MERGE"] = 234] = "TIMELINE_MERGE";
    /** Query historical computation state from DAG */
    SpacetimeMessageType[SpacetimeMessageType["ARCHAEOLOGY_QUERY"] = 235] = "ARCHAEOLOGY_QUERY";
})(SpacetimeMessageType || (exports.SpacetimeMessageType = SpacetimeMessageType = {}));
var BranchState;
(function (BranchState) {
    /** Active and accepting causes */
    BranchState["ACTIVE"] = "active";
    /** Paused (not processing causes) */
    BranchState["PAUSED"] = "paused";
    /** Merged back into parent */
    BranchState["MERGED"] = "merged";
    /** Abandoned (lost a race or manually killed) */
    BranchState["ABANDONED"] = "abandoned";
    /** Racing against other branches */
    BranchState["RACING"] = "racing";
})(BranchState || (exports.BranchState = BranchState = {}));
var RaceState;
(function (RaceState) {
    RaceState["RUNNING"] = "running";
    RaceState["JUDGING"] = "judging";
    RaceState["DECIDED"] = "decided";
    RaceState["CANCELLED"] = "cancelled";
})(RaceState || (exports.RaceState = RaceState = {}));
var FitnessMetric;
(function (FitnessMetric) {
    /** Lowest CCU cost per cause */
    FitnessMetric["CCU_EFFICIENCY"] = "ccu_efficiency";
    /** Fastest execution time per cause */
    FitnessMetric["SPEED"] = "speed";
    /** Highest state mutations (most productive) */
    FitnessMetric["PRODUCTIVITY"] = "productivity";
    /** Custom scoring function */
    FitnessMetric["CUSTOM"] = "custom";
})(FitnessMetric || (exports.FitnessMetric = FitnessMetric = {}));
exports.DEFAULT_SPACETIME_CONFIG = {
    maxDAGNodes: 1000,
    maxBranches: 8,
    defaultRaceDurationMs: 30000,
    defaultMinCausesPerBranch: 5,
    snapshotEveryN: 10,
    dagNodeTtlMs: 3600000,
};
//# sourceMappingURL=spacetime.js.map
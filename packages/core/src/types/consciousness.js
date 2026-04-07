"use strict";
/**
 * CMP v2.0 — Layer 11: Collective Consciousness Types
 *
 * The mesh thinks as one — without anyone being in charge.
 *
 * Three bio-inspired coordination mechanisms:
 *   1. Stigmergy: indirect coordination through pheromone trails
 *   2. Quorum Sensing: mesh-wide behavioral shift at signal threshold
 *   3. Swarm Decision: stochastic distributed decision without voting
 *
 * @module types/consciousness
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONSCIOUSNESS_CONFIG = exports.MeshBehavior = exports.SwarmDecisionState = exports.QuorumAction = exports.PheromoneType = exports.ConsciousnessMessageType = void 0;
// ═══════════════════════════════════════
// Wire Protocol Messages (0xE1-0xE5)
// ═══════════════════════════════════════
/** Layer 11 message types — add to MessageType enum */
var ConsciousnessMessageType;
(function (ConsciousnessMessageType) {
    /** Node deposits a pheromone trail into the mesh */
    ConsciousnessMessageType[ConsciousnessMessageType["PHEROMONE_DEPOSIT"] = 225] = "PHEROMONE_DEPOSIT";
    /** Node detects quorum has been reached for a signal */
    ConsciousnessMessageType[ConsciousnessMessageType["QUORUM_SIGNAL"] = 226] = "QUORUM_SIGNAL";
    /** Swarm decision initiated — request sampling */
    ConsciousnessMessageType[ConsciousnessMessageType["SWARM_DECISION_INIT"] = 227] = "SWARM_DECISION_INIT";
    /** Individual node's stochastic sample for a decision */
    ConsciousnessMessageType[ConsciousnessMessageType["SWARM_DECISION_SAMPLE"] = 228] = "SWARM_DECISION_SAMPLE";
    /** Mesh-wide emergent behavior notification */
    ConsciousnessMessageType[ConsciousnessMessageType["EMERGENCE_NOTIFY"] = 229] = "EMERGENCE_NOTIFY";
})(ConsciousnessMessageType || (exports.ConsciousnessMessageType = ConsciousnessMessageType = {}));
// ═══════════════════════════════════════
// Pheromone System (Stigmergy)
// ═══════════════════════════════════════
/** Types of pheromone trails nodes can deposit */
var PheromoneType;
(function (PheromoneType) {
    /** Computation completed successfully here — attract similar tasks */
    PheromoneType["COMPUTE_SUCCESS"] = "compute_success";
    /** High resource availability — attract compute-hungry tasks */
    PheromoneType["RESOURCE_AVAILABLE"] = "resource_available";
    /** Task failed / timed out — repel similar tasks */
    PheromoneType["COMPUTE_FAILURE"] = "compute_failure";
    /** Threat detected — warn others away */
    PheromoneType["DANGER"] = "danger";
    /** High network latency to this region — reroute */
    PheromoneType["CONGESTION"] = "congestion";
    /** Custom application-defined pheromone */
    PheromoneType["CUSTOM"] = "custom";
})(PheromoneType || (exports.PheromoneType = PheromoneType = {}));
/** What happens when quorum is reached */
var QuorumAction;
(function (QuorumAction) {
    /** Mesh-wide alert broadcast */
    QuorumAction["ALERT"] = "alert";
    /** Trigger collective resource reallocation */
    QuorumAction["REALLOCATE"] = "reallocate";
    /** Activate/deactivate a mesh behavior */
    QuorumAction["BEHAVIOR_SHIFT"] = "behavior_shift";
    /** Trigger immune response */
    QuorumAction["IMMUNE_RESPONSE"] = "immune_response";
    /** Custom callback */
    QuorumAction["CUSTOM"] = "custom";
})(QuorumAction || (exports.QuorumAction = QuorumAction = {}));
var SwarmDecisionState;
(function (SwarmDecisionState) {
    /** Collecting samples from nodes */
    SwarmDecisionState["SAMPLING"] = "sampling";
    /** Enough samples, computing result */
    SwarmDecisionState["COMPUTING"] = "computing";
    /** Decision reached */
    SwarmDecisionState["DECIDED"] = "decided";
    /** Not enough samples — inconclusive */
    SwarmDecisionState["INCONCLUSIVE"] = "inconclusive";
    /** Decision expired */
    SwarmDecisionState["EXPIRED"] = "expired";
})(SwarmDecisionState || (exports.SwarmDecisionState = SwarmDecisionState = {}));
// ═══════════════════════════════════════
// Emergent Behavior
// ═══════════════════════════════════════
/** Mesh-wide behavioral states that emerge from collective signals */
var MeshBehavior;
(function (MeshBehavior) {
    /** Normal operation */
    MeshBehavior["NORMAL"] = "normal";
    /** High demand detected — mesh enters performance mode */
    MeshBehavior["HIGH_DEMAND"] = "high_demand";
    /** Threat detected — mesh enters defensive mode */
    MeshBehavior["DEFENSIVE"] = "defensive";
    /** Low energy collective — mesh enters conservation mode */
    MeshBehavior["CONSERVATION"] = "conservation";
    /** Learning mode — mesh is consolidating patterns (dreaming) */
    MeshBehavior["DREAMING"] = "dreaming";
    /** Growth mode — mesh is actively recruiting/forming organs */
    MeshBehavior["GROWTH"] = "growth";
})(MeshBehavior || (exports.MeshBehavior = MeshBehavior = {}));
exports.DEFAULT_CONSCIOUSNESS_CONFIG = {
    pheromoneDecayRate: 0.05,
    pheromoneDiffusionRate: 0.3,
    maxPheromoneHops: 5,
    defaultPheromoneTtlMs: 60000,
    pheromoneCleanupIntervalMs: 5000,
    maxPheromonesPerNode: 500,
    defaultQuorumThreshold: 0.5,
    defaultQuorumWindowMs: 30000,
    defaultQuorumCooldownMs: 60000,
    defaultSamplingWindowMs: 5000,
    defaultMinSamples: 3,
    swarmConfidenceThreshold: 0.6,
    emergenceEvalIntervalMs: 10000,
};
//# sourceMappingURL=consciousness.js.map
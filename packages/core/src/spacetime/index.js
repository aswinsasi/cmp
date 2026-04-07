"use strict";
/**
 * CMP v2.0 — Layer 12: Computation Spacetime
 *
 * Fork reality. Run parallel universes. Merge the best one back.
 *
 * Orchestrates:
 *   - CausalMerkleDAG: immutable content-addressed computation history
 *   - TemporalForker: timeline branching, racing, and merging
 *
 * Wire Protocol: 0xE6-0xEB
 *
 * @module spacetime
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemporalForker = exports.CausalMerkleDAG = exports.SpacetimeLayer = void 0;
const causal_dag_1 = require("./causal-dag");
const temporal_forker_1 = require("./temporal-forker");
const spacetime_1 = require("../types/spacetime");
// ─── Spacetime Layer ───
class SpacetimeLayer {
    /** The causal Merkle DAG */
    dag;
    /** The temporal forker */
    forker;
    config;
    lifeformId;
    /** Transport callback */
    sendMessage = null;
    /** Listeners */
    listeners = new Set();
    constructor(lifeformId, config) {
        this.lifeformId = lifeformId;
        this.config = { ...spacetime_1.DEFAULT_SPACETIME_CONFIG, ...config };
        this.dag = new causal_dag_1.CausalMerkleDAG(config);
        this.forker = new temporal_forker_1.TemporalForker(lifeformId, this.dag, config);
        // Forward forker events
        this.forker.onEvent((event) => {
            for (const listener of this.listeners) {
                try {
                    listener(event);
                }
                catch { }
            }
        });
    }
    /** Set transport callback */
    setTransport(sendFn) {
        this.sendMessage = sendFn;
    }
    /** Subscribe to spacetime events */
    onEvent(listener) {
        this.listeners.add(listener);
    }
    /** Stop all timers */
    stop() {
        this.forker.stop();
    }
    // ══════════════════════════════════════
    // High-Level API
    // ══════════════════════════════════════
    /**
     * Record a cause execution. Appends to DAG and updates branch fitness.
     * Call this after every cause handler execution.
     */
    recordExecution(branchId, causeId, stateHash, resultHash, executionTimeMs, ccuCost, stateMutations, stateSnapshot) {
        // Forker handles both DAG append AND fitness update
        this.forker.recordExecution(branchId, causeId, stateHash, resultHash, executionTimeMs, ccuCost, stateMutations, stateSnapshot);
        // Get the node that was just appended
        const node = this.dag.getHead(branchId);
        // Broadcast state sync
        if (this.sendMessage) {
            const wire = {
                branchId,
                headHash: node.hash,
                latestNode: node,
                fitness: this.forker.getBranch(branchId)?.fitness,
            };
            this.sendMessage(spacetime_1.SpacetimeMessageType.BRANCH_STATE_SYNC, wire);
        }
        return node;
    }
    /**
     * Fork the current timeline. Creates a parallel universe.
     */
    fork(label, stateSnapshot, parentBranchId) {
        const branch = this.forker.fork(label, parentBranchId, stateSnapshot);
        if (!branch)
            return null;
        // Broadcast fork
        if (this.sendMessage) {
            const wire = {
                lifeformId: this.lifeformId,
                branchId: branch.id,
                label: branch.label,
                forkPointHash: branch.forkPointHash,
                parentBranchId: branch.parentBranchId,
                timestamp: Date.now(),
            };
            this.sendMessage(spacetime_1.SpacetimeMessageType.TIMELINE_FORK, wire);
        }
        return branch.id;
    }
    /**
     * Start a race between branches.
     */
    startRace(branchIds, metric = spacetime_1.FitnessMetric.CCU_EFFICIENCY, maxDurationMs) {
        const race = this.forker.startRace(branchIds, metric, maxDurationMs);
        if (!race)
            return null;
        // Broadcast race start
        if (this.sendMessage) {
            const wire = {
                raceId: race.id,
                lifeformId: this.lifeformId,
                branchIds: race.branchIds,
                maxDurationMs: race.maxDurationMs,
                minCausesPerBranch: race.minCausesPerBranch,
                fitnessMetric: race.fitnessMetric,
                startedAt: race.startedAt,
            };
            this.sendMessage(spacetime_1.SpacetimeMessageType.BRANCH_RACE_START, wire);
        }
        return race.id;
    }
    /**
     * Merge a branch back into trunk.
     * Returns the snapshot for CRDT merge (caller does the actual state merge).
     */
    merge(branchId) {
        const result = this.forker.merge(branchId);
        if (!result)
            return null;
        // Broadcast merge
        if (this.sendMessage) {
            const headHash = this.dag.getHead(branchId)?.hash || '';
            const wire = {
                sourceBranchId: branchId,
                targetBranchId: 'trunk',
                mergeNodeHash: headHash,
                timestamp: Date.now(),
            };
            this.sendMessage(spacetime_1.SpacetimeMessageType.TIMELINE_MERGE, wire);
        }
        return result;
    }
    // ══════════════════════════════════════
    // Archaeology (Historical Queries)
    // ══════════════════════════════════════
    /**
     * Reconstruct the state at a specific point in history.
     * Finds the nearest snapshot and replays from there.
     */
    getHistoricalState(branchId, atSequence) {
        const snapshot = this.dag.findNearestSnapshot(branchId, atSequence);
        return snapshot?.stateSnapshot || null;
    }
    /**
     * Get the computation timeline for a branch.
     */
    getTimeline(branchId, limit) {
        if (limit) {
            return this.dag.getRecentNodes(branchId, limit);
        }
        return this.dag.getBranchHistory(branchId);
    }
    /**
     * Verify the integrity of a branch's computation history.
     */
    verifyHistory(branchId) {
        return this.dag.verifyBranch(branchId);
    }
    // ══════════════════════════════════════
    // Message Handling
    // ══════════════════════════════════════
    /**
     * Handle an incoming Layer 12 message from a peer.
     */
    handleMessage(msgType, payload) {
        switch (msgType) {
            case spacetime_1.SpacetimeMessageType.BRANCH_STATE_SYNC:
                // Could store peer's branch state for cross-device awareness
                break;
            case spacetime_1.SpacetimeMessageType.TIMELINE_FORK:
                // Peer forked a timeline — informational
                break;
            case spacetime_1.SpacetimeMessageType.BRANCH_RACE_START:
                // Peer started a race — informational
                break;
            case spacetime_1.SpacetimeMessageType.BRANCH_METRICS:
                // Peer's branch fitness update
                break;
            case spacetime_1.SpacetimeMessageType.TIMELINE_MERGE:
                // Peer merged a branch
                break;
            case spacetime_1.SpacetimeMessageType.ARCHAEOLOGY_QUERY: {
                const query = payload;
                // Respond with requested DAG nodes if we have them
                if (query.nodeHash) {
                    const node = this.dag.getNode(query.nodeHash);
                    if (node && this.sendMessage) {
                        this.sendMessage(spacetime_1.SpacetimeMessageType.BRANCH_STATE_SYNC, {
                            branchId: node.branchId,
                            headHash: node.hash,
                            latestNode: node,
                        });
                    }
                }
                break;
            }
        }
    }
    // ══════════════════════════════════════
    // Status
    // ══════════════════════════════════════
    /** Get comprehensive Layer 12 status */
    getStatus() {
        const dagInfo = this.dag.getInfo();
        return {
            lifeformId: this.lifeformId,
            dagNodes: dagInfo.totalNodes,
            dagBranches: dagInfo.branchCount,
            totalComputeMs: dagInfo.totalComputeMs,
            totalCcu: dagInfo.totalCcu,
            activeBranches: this.forker.getActiveBranches().map(b => ({
                id: b.id,
                label: b.label,
                length: b.length,
                state: b.state,
                fitness: b.fitness,
            })),
            activeRaces: this.forker.getActiveRaces().length,
            stats: this.forker.getStats(),
        };
    }
}
exports.SpacetimeLayer = SpacetimeLayer;
// ─── Re-exports ───
var causal_dag_2 = require("./causal-dag");
Object.defineProperty(exports, "CausalMerkleDAG", { enumerable: true, get: function () { return causal_dag_2.CausalMerkleDAG; } });
var temporal_forker_2 = require("./temporal-forker");
Object.defineProperty(exports, "TemporalForker", { enumerable: true, get: function () { return temporal_forker_2.TemporalForker; } });
//# sourceMappingURL=index.js.map
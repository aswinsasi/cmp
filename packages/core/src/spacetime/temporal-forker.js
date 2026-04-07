"use strict";
/**
 * CMP v2.0 — Temporal Forker
 *
 * Fork a Lifeform's timeline into parallel branches, race them
 * against each other, and merge the winner back.
 *
 * This is git-for-live-computation:
 *   fork()  → create a new branch from current state
 *   race()  → run N branches in parallel, track fitness
 *   judge() → pick the winner based on fitness metrics
 *   merge() → merge winning branch state back to trunk
 *
 * Each branch has its own CRDT state (cloned at fork point) and
 * its own section of the Causal Merkle DAG. Because state is
 * CRDT-based, merging is always conflict-free.
 *
 * @module spacetime/temporal-forker
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemporalForker = void 0;
const spacetime_1 = require("../types/spacetime");
function randomId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < 8; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ─── Temporal Forker ───
class TemporalForker {
    /** All branches: branchId → Branch */
    branches = new Map();
    /** Active races: raceId → BranchRace */
    races = new Map();
    /** Race timers */
    raceTimers = new Map();
    dag;
    config;
    lifeformId;
    /** Event listeners */
    listeners = new Set();
    /** Stats */
    stats = {
        totalForks: 0,
        totalMerges: 0,
        totalRaces: 0,
        totalAbandoned: 0,
    };
    constructor(lifeformId, dag, config) {
        this.lifeformId = lifeformId;
        this.dag = dag;
        this.config = { ...spacetime_1.DEFAULT_SPACETIME_CONFIG, ...config };
        // Create the trunk branch
        this.branches.set('trunk', {
            id: 'trunk',
            label: 'trunk',
            parentBranchId: '',
            forkPointHash: '',
            headHash: '',
            length: 0,
            createdAt: Date.now(),
            state: spacetime_1.BranchState.ACTIVE,
        });
    }
    /** Subscribe to events */
    onEvent(listener) {
        this.listeners.add(listener);
    }
    // ══════════════════════════════════════
    // Fork
    // ══════════════════════════════════════
    /**
     * Fork the current timeline into a new branch.
     * The new branch starts with a clone of the trunk's current CRDT state.
     *
     * @param label - Human-readable branch name
     * @param parentBranchId - Branch to fork from (default: 'trunk')
     * @param stateSnapshot - CRDT state snapshot at fork point
     * @returns The new Branch, or null if max branches reached
     */
    fork(label, parentBranchId = 'trunk', stateSnapshot) {
        const activeBranches = [...this.branches.values()].filter(b => b.state === spacetime_1.BranchState.ACTIVE || b.state === spacetime_1.BranchState.RACING);
        if (activeBranches.length >= this.config.maxBranches) {
            return null; // Max branches reached
        }
        const parent = this.branches.get(parentBranchId);
        if (!parent)
            return null;
        const forkPointHash = this.dag.getHead(parentBranchId)?.hash || '';
        const branchId = `branch-${randomId()}`;
        // Create branch in DAG
        if (forkPointHash) {
            this.dag.createBranch(branchId, forkPointHash);
        }
        const branch = {
            id: branchId,
            label,
            parentBranchId,
            forkPointHash,
            headHash: forkPointHash,
            length: 0,
            createdAt: Date.now(),
            state: spacetime_1.BranchState.ACTIVE,
            forkSnapshot: stateSnapshot,
            fitness: this.emptyFitness(),
        };
        this.branches.set(branchId, branch);
        this.stats.totalForks++;
        this.emit({ kind: 'branch_created', branchId, data: { label, parentBranchId } });
        return branch;
    }
    // ══════════════════════════════════════
    // Record Execution
    // ══════════════════════════════════════
    /**
     * Record a cause execution on a branch.
     * Updates the DAG and branch fitness metrics.
     */
    recordExecution(branchId, causeId, stateHash, resultHash, executionTimeMs, ccuCost, stateMutations, stateSnapshot) {
        const branch = this.branches.get(branchId);
        if (!branch || (branch.state !== spacetime_1.BranchState.ACTIVE && branch.state !== spacetime_1.BranchState.RACING)) {
            return;
        }
        // Append to DAG
        const node = this.dag.append(branchId, causeId, stateHash, resultHash, executionTimeMs, ccuCost, stateSnapshot);
        // Update branch
        branch.headHash = node.hash;
        branch.length++;
        // Update fitness
        if (!branch.fitness)
            branch.fitness = this.emptyFitness();
        const f = branch.fitness;
        f.causesProcessed++;
        f.totalExecutionMs += executionTimeMs;
        f.totalCcu += ccuCost;
        f.totalMutations += stateMutations;
        f.avgExecutionMs = f.totalExecutionMs / f.causesProcessed;
        f.avgCcuPerCause = f.totalCcu / f.causesProcessed;
        f.updatedAt = Date.now();
        this.emit({ kind: 'fitness_updated', branchId, data: f });
    }
    // ══════════════════════════════════════
    // Race
    // ══════════════════════════════════════
    /**
     * Start a race between branches.
     * All branches run in parallel; after minCausesPerBranch causes or
     * maxDurationMs time, the fittest branch wins.
     *
     * @param branchIds - Branches to race
     * @param metric - How to judge fitness
     * @returns The BranchRace, or null if branches not valid
     */
    startRace(branchIds, metric = spacetime_1.FitnessMetric.CCU_EFFICIENCY, maxDurationMs, minCausesPerBranch) {
        // Validate all branches exist and are active
        for (const id of branchIds) {
            const branch = this.branches.get(id);
            if (!branch || branch.state !== spacetime_1.BranchState.ACTIVE)
                return null;
        }
        const race = {
            id: `race-${randomId()}`,
            lifeformId: this.lifeformId,
            branchIds: [...branchIds],
            startedAt: Date.now(),
            maxDurationMs: maxDurationMs || this.config.defaultRaceDurationMs,
            minCausesPerBranch: minCausesPerBranch || this.config.defaultMinCausesPerBranch,
            state: spacetime_1.RaceState.RUNNING,
            fitnessMetric: metric,
        };
        // Mark branches as racing
        for (const id of branchIds) {
            const branch = this.branches.get(id);
            branch.state = spacetime_1.BranchState.RACING;
            // Reset fitness for fair race
            branch.fitness = this.emptyFitness();
        }
        this.races.set(race.id, race);
        this.stats.totalRaces++;
        // Auto-judge timer
        const timer = setTimeout(() => {
            this.judgeRace(race.id);
        }, race.maxDurationMs);
        this.raceTimers.set(race.id, timer);
        this.emit({ kind: 'race_started', raceId: race.id, data: { branchIds, metric } });
        return race;
    }
    /**
     * Judge a race — determine the winner.
     * Can be called manually or automatically after the timer.
     */
    judgeRace(raceId) {
        const race = this.races.get(raceId);
        if (!race || race.state !== spacetime_1.RaceState.RUNNING)
            return null;
        race.state = spacetime_1.RaceState.JUDGING;
        // Clear timer if judged manually
        const timer = this.raceTimers.get(raceId);
        if (timer) {
            clearTimeout(timer);
            this.raceTimers.delete(raceId);
        }
        // Collect fitness per branch
        const allFitness = new Map();
        for (const branchId of race.branchIds) {
            const branch = this.branches.get(branchId);
            allFitness.set(branchId, branch?.fitness || this.emptyFitness());
        }
        // Score based on metric
        let winnerId = race.branchIds[0];
        let bestScore = -Infinity;
        for (const [branchId, fitness] of allFitness) {
            const score = this.scoreFitness(fitness, race.fitnessMetric);
            if (score > bestScore) {
                bestScore = score;
                winnerId = branchId;
            }
        }
        const result = {
            winnerId,
            winnerFitness: allFitness.get(winnerId),
            allFitness,
            decidedAt: Date.now(),
            reason: `Best ${race.fitnessMetric}: branch ${winnerId}`,
        };
        race.result = result;
        race.state = spacetime_1.RaceState.DECIDED;
        // Mark loser branches as abandoned
        for (const branchId of race.branchIds) {
            if (branchId !== winnerId) {
                const branch = this.branches.get(branchId);
                if (branch) {
                    branch.state = spacetime_1.BranchState.ABANDONED;
                    this.stats.totalAbandoned++;
                }
            }
        }
        // Winner goes back to ACTIVE
        const winner = this.branches.get(winnerId);
        if (winner)
            winner.state = spacetime_1.BranchState.ACTIVE;
        this.emit({ kind: 'race_decided', raceId, data: result });
        return result;
    }
    /** Cancel a race */
    cancelRace(raceId) {
        const race = this.races.get(raceId);
        if (!race || race.state !== spacetime_1.RaceState.RUNNING)
            return false;
        const timer = this.raceTimers.get(raceId);
        if (timer) {
            clearTimeout(timer);
            this.raceTimers.delete(raceId);
        }
        race.state = spacetime_1.RaceState.CANCELLED;
        // Return all branches to active
        for (const branchId of race.branchIds) {
            const branch = this.branches.get(branchId);
            if (branch && branch.state === spacetime_1.BranchState.RACING) {
                branch.state = spacetime_1.BranchState.ACTIVE;
            }
        }
        this.emit({ kind: 'race_cancelled', raceId });
        return true;
    }
    // ══════════════════════════════════════
    // Merge
    // ══════════════════════════════════════
    /**
     * Merge a branch back into its parent.
     * Returns the state snapshot from the branch head (for CRDT merge by caller).
     */
    merge(branchId) {
        const branch = this.branches.get(branchId);
        if (!branch)
            return null;
        if (branch.state !== spacetime_1.BranchState.ACTIVE)
            return null;
        if (branchId === 'trunk')
            return null; // Can't merge trunk into itself
        const headNode = this.dag.getHead(branchId);
        const snapshot = headNode?.stateSnapshot || branch.forkSnapshot;
        const fitness = branch.fitness || this.emptyFitness();
        branch.state = spacetime_1.BranchState.MERGED;
        this.stats.totalMerges++;
        this.emit({ kind: 'branch_merged', branchId, data: { targetBranch: branch.parentBranchId } });
        return { snapshot, fitness };
    }
    /**
     * Abandon a branch (discard it without merging).
     */
    abandon(branchId) {
        const branch = this.branches.get(branchId);
        if (!branch || branchId === 'trunk')
            return false;
        branch.state = spacetime_1.BranchState.ABANDONED;
        this.stats.totalAbandoned++;
        this.emit({ kind: 'branch_abandoned', branchId });
        return true;
    }
    // ══════════════════════════════════════
    // Query
    // ══════════════════════════════════════
    /** Get a branch by ID */
    getBranch(branchId) {
        return this.branches.get(branchId) || null;
    }
    /** Get all branches */
    getAllBranches() {
        return [...this.branches.values()];
    }
    /** Get active branches */
    getActiveBranches() {
        return [...this.branches.values()].filter(b => b.state === spacetime_1.BranchState.ACTIVE || b.state === spacetime_1.BranchState.RACING);
    }
    /** Get a race by ID */
    getRace(raceId) {
        return this.races.get(raceId) || null;
    }
    /** Get active races */
    getActiveRaces() {
        return [...this.races.values()].filter(r => r.state === spacetime_1.RaceState.RUNNING);
    }
    /** Get the DAG */
    getDAG() {
        return this.dag;
    }
    /** Get stats */
    getStats() {
        return {
            ...this.stats,
            activeBranches: this.getActiveBranches().length,
            totalBranches: this.branches.size,
            activeRaces: this.getActiveRaces().length,
            dagSize: this.dag.size,
        };
    }
    /** Stop all race timers */
    stop() {
        for (const [, timer] of this.raceTimers) {
            clearTimeout(timer);
        }
        this.raceTimers.clear();
    }
    // ── Internal ──
    emptyFitness() {
        return {
            causesProcessed: 0,
            totalExecutionMs: 0,
            totalCcu: 0,
            totalMutations: 0,
            avgExecutionMs: 0,
            avgCcuPerCause: 0,
            customScore: 0,
            updatedAt: Date.now(),
        };
    }
    scoreFitness(fitness, metric) {
        if (fitness.causesProcessed === 0)
            return -Infinity;
        switch (metric) {
            case spacetime_1.FitnessMetric.CCU_EFFICIENCY:
                // Lower CCU per cause = better → negate for "higher is better"
                return fitness.avgCcuPerCause > 0 ? -fitness.avgCcuPerCause : -Infinity;
            case spacetime_1.FitnessMetric.SPEED:
                // Lower execution time = better → negate
                return fitness.avgExecutionMs > 0 ? -fitness.avgExecutionMs : -Infinity;
            case spacetime_1.FitnessMetric.PRODUCTIVITY:
                // More mutations = better
                return fitness.totalMutations;
            case spacetime_1.FitnessMetric.CUSTOM:
                return fitness.customScore;
            default:
                return 0;
        }
    }
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch { }
        }
    }
}
exports.TemporalForker = TemporalForker;
//# sourceMappingURL=temporal-forker.js.map
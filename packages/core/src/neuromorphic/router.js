"use strict";
/**
 * CMP v3.0 — Neuromorphic Router
 * Spiking neural network for mesh task routing.
 *
 * How it works:
 *   1. Task arrives → generates a "spike" at the entry node
 *   2. Spike propagates through weighted connections
 *   3. At each node, spike follows strongest connection (with exploration)
 *   4. Route terminates when spike reaches a capable executor or dies
 *   5. On success: connections reinforced (long-term potentiation)
 *   6. On failure: connections weakened (long-term depression)
 *   7. Spike-Timing Dependent Plasticity: quick successions strengthen more
 *   8. Unused connections decay over time
 *
 * This is Hebbian learning applied to network routing:
 * "Neurons that fire together, wire together."
 *
 * @module neuromorphic/router
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeuromorphicRouter = void 0;
const neuromorphic_1 = require("../types/neuromorphic");
// ─── Helpers ───
function randomId() {
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ═══════════════════════════════════════
class NeuromorphicRouter {
    config;
    /** Adjacency: fromNode → toNode → weight */
    weights = new Map();
    /** Known nodes in the network */
    nodes = new Set();
    /** Learning history (capped ring buffer) */
    learningLog = [];
    maxLogSize = 1000;
    /** Decay timer */
    decayTimer = null;
    /** Stats */
    totalRoutes = 0;
    totalExplorations = 0;
    constructor(config) {
        this.config = { ...neuromorphic_1.DEFAULT_NEUROMORPHIC_CONFIG, ...config };
    }
    // ═══════════════════════════════════════
    // Network Management
    // ═══════════════════════════════════════
    /** Register a node in the network */
    addNode(nodeId) {
        this.nodes.add(nodeId);
    }
    /** Remove a node and all its connections */
    removeNode(nodeId) {
        this.nodes.delete(nodeId);
        this.weights.delete(nodeId);
        for (const [, targets] of this.weights) {
            targets.delete(nodeId);
        }
    }
    /** Ensure a connection exists between two nodes */
    ensureConnection(from, to) {
        this.nodes.add(from);
        this.nodes.add(to);
        if (!this.weights.has(from)) {
            this.weights.set(from, new Map());
        }
        const targets = this.weights.get(from);
        if (!targets.has(to)) {
            targets.set(to, {
                from,
                to,
                weight: this.config.initialWeight,
                lastFired: 0,
                successCount: 0,
                failureCount: 0,
                taskTypes: new Set(),
            });
        }
        return targets.get(to);
    }
    /** Get weight between two nodes (0 if no connection) */
    getWeight(from, to) {
        return this.weights.get(from)?.get(to)?.weight ?? 0;
    }
    /** Get all outgoing connections from a node */
    getOutgoing(nodeId) {
        const targets = this.weights.get(nodeId);
        if (!targets)
            return [];
        return Array.from(targets.values()).filter(w => w.weight >= this.config.activationThreshold);
    }
    // ═══════════════════════════════════════
    // Routing (Spike Propagation)
    // ═══════════════════════════════════════
    /**
     * Route a task through the neural network.
     * Returns the path the spike followed.
     *
     * @param sourceNode - Node where the task entered the mesh
     * @param taskType - Type of task (influences weight selection)
     * @param taskId - Task identifier
     * @param targetFilter - Optional: only accept nodes matching this filter
     */
    route(sourceNode, taskType, taskId, targetFilter) {
        const start = Date.now();
        this.totalRoutes++;
        const spike = {
            id: randomId(),
            sourceNode,
            taskType,
            energy: 1.0,
            timestamp: Date.now(),
            path: [sourceNode],
            taskId,
        };
        let current = sourceNode;
        let explored = false;
        for (let hop = 0; hop < this.config.maxHops; hop++) {
            // Get outgoing connections from current node
            const outgoing = this.getOutgoing(current);
            if (outgoing.length === 0)
                break;
            // Filter out already-visited nodes (avoid loops)
            const visited = new Set(spike.path);
            const candidates = outgoing.filter(w => !visited.has(w.to));
            if (candidates.length === 0)
                break;
            // Choose next node
            let next;
            if (Math.random() < this.config.explorationRate) {
                // Exploration: random choice
                next = candidates[Math.floor(Math.random() * candidates.length)].to;
                explored = true;
                this.totalExplorations++;
            }
            else {
                // Exploitation: weighted selection favoring task type affinity
                next = this.selectWeighted(candidates, taskType);
            }
            // Decay spike energy
            spike.energy -= this.config.spikeDecayPerHop;
            if (spike.energy <= 0)
                break;
            // Record firing
            const conn = this.weights.get(current)?.get(next);
            if (conn) {
                conn.lastFired = Date.now();
                conn.taskTypes.add(taskType);
            }
            spike.path.push(next);
            current = next;
            // Check if target reached
            if (targetFilter && targetFilter(current))
                break;
        }
        // Calculate total route weight
        let totalWeight = 1.0;
        for (let i = 0; i < spike.path.length - 1; i++) {
            const w = this.getWeight(spike.path[i], spike.path[i + 1]);
            totalWeight *= w;
        }
        return {
            path: spike.path,
            totalWeight,
            explored,
            routingMs: Date.now() - start,
        };
    }
    /**
     * Weighted selection: choose next node proportional to connection weight.
     * Connections that have handled this taskType before get a bonus.
     */
    selectWeighted(candidates, taskType) {
        // Calculate effective weights with task affinity bonus
        const effective = candidates.map(c => {
            const affinityBonus = c.taskTypes.has(taskType) ? 0.2 : 0;
            return { nodeId: c.to, weight: c.weight + affinityBonus };
        });
        // Weighted random selection
        const totalWeight = effective.reduce((sum, e) => sum + e.weight, 0);
        if (totalWeight === 0)
            return candidates[0].to;
        let random = Math.random() * totalWeight;
        for (const entry of effective) {
            random -= entry.weight;
            if (random <= 0)
                return entry.nodeId;
        }
        return effective[effective.length - 1].nodeId;
    }
    // ═══════════════════════════════════════
    // Learning
    // ═══════════════════════════════════════
    /**
     * Long-Term Potentiation: reinforce a successful path.
     * Called when a task completed successfully along this route.
     */
    reinforce(path, taskType) {
        for (let i = 0; i < path.length - 1; i++) {
            const conn = this.weights.get(path[i])?.get(path[i + 1]);
            if (conn) {
                const delta = this.config.learningRate * (1 - conn.weight);
                conn.weight = Math.min(1.0, conn.weight + delta);
                conn.successCount++;
                conn.taskTypes.add(taskType);
            }
        }
        this.logEvent({
            type: 'ltp',
            path,
            taskType,
            weightDelta: this.config.learningRate,
            timestamp: Date.now(),
        });
    }
    /**
     * Long-Term Depression: weaken a failed path.
     * Called when a task failed or timed out along this route.
     */
    weaken(path, taskType) {
        const penalty = this.config.learningRate * 2; // Failures punish harder
        for (let i = 0; i < path.length - 1; i++) {
            const conn = this.weights.get(path[i])?.get(path[i + 1]);
            if (conn) {
                conn.weight = Math.max(0, conn.weight - penalty);
                conn.failureCount++;
            }
        }
        this.logEvent({
            type: 'ltd',
            path,
            taskType,
            weightDelta: -penalty,
            timestamp: Date.now(),
        });
    }
    /**
     * Spike-Timing Dependent Plasticity (STDP).
     * Connections fired in quick succession strengthen more.
     *
     * @param preFiredAt - When the presynaptic node fired
     * @param postFiredAt - When the postsynaptic node fired
     * @param from - Presynaptic node
     * @param to - Postsynaptic node
     */
    applySTDP(preFiredAt, postFiredAt, from, to) {
        const dt = postFiredAt - preFiredAt;
        const conn = this.weights.get(from)?.get(to);
        if (!conn)
            return;
        if (dt > 0 && dt < this.config.stdpWindowMs) {
            // Causal: pre fires before post → strengthen
            // Strength inversely proportional to time gap
            const factor = 1 - (dt / this.config.stdpWindowMs);
            const delta = this.config.learningRate * factor * 0.5;
            conn.weight = Math.min(1.0, conn.weight + delta);
            this.logEvent({
                type: 'stdp',
                path: [from, to],
                taskType: '',
                weightDelta: delta,
                timestamp: Date.now(),
            });
        }
        else if (dt < 0 && Math.abs(dt) < this.config.stdpWindowMs) {
            // Anti-causal: post fires before pre → weaken
            const factor = 1 - (Math.abs(dt) / this.config.stdpWindowMs);
            const delta = this.config.learningRate * factor * 0.3;
            conn.weight = Math.max(0, conn.weight - delta);
            this.logEvent({
                type: 'stdp',
                path: [from, to],
                taskType: '',
                weightDelta: -delta,
                timestamp: Date.now(),
            });
        }
    }
    /**
     * Decay all connection weights.
     * Simulates synaptic pruning: unused connections fade.
     * Called periodically (every decayIntervalMs).
     */
    decay() {
        let pruned = 0;
        for (const [fromId, targets] of this.weights) {
            for (const [toId, conn] of targets) {
                conn.weight = Math.max(0, conn.weight - this.config.decayRate);
                // Prune dead connections
                if (conn.weight < this.config.activationThreshold) {
                    targets.delete(toId);
                    pruned++;
                }
            }
            // Clean up empty maps
            if (targets.size === 0) {
                this.weights.delete(fromId);
            }
        }
        if (pruned > 0) {
            this.logEvent({
                type: 'decay',
                path: [],
                taskType: '',
                weightDelta: -this.config.decayRate,
                timestamp: Date.now(),
            });
        }
        return pruned;
    }
    /**
     * Start automatic decay timer.
     */
    startDecay() {
        if (this.decayTimer)
            return;
        this.decayTimer = setInterval(() => this.decay(), this.config.decayIntervalMs);
    }
    /**
     * Stop automatic decay timer.
     */
    stopDecay() {
        if (this.decayTimer) {
            clearInterval(this.decayTimer);
            this.decayTimer = null;
        }
    }
    // ═══════════════════════════════════════
    // Topology & Stats
    // ═══════════════════════════════════════
    /**
     * Get a snapshot of the current network topology.
     */
    getTopology() {
        const connections = [];
        let totalWeight = 0;
        for (const [, targets] of this.weights) {
            for (const [, conn] of targets) {
                if (conn.weight >= this.config.activationThreshold) {
                    const total = conn.successCount + conn.failureCount;
                    connections.push({
                        from: conn.from,
                        to: conn.to,
                        weight: conn.weight,
                        successRate: total > 0 ? conn.successCount / total : 0,
                    });
                    totalWeight += conn.weight;
                }
            }
        }
        // Find dominant paths per task type
        const dominantPaths = new Map();
        const taskTypes = new Set();
        for (const [, targets] of this.weights) {
            for (const [, conn] of targets) {
                for (const tt of conn.taskTypes)
                    taskTypes.add(tt);
            }
        }
        for (const taskType of taskTypes) {
            const best = this.findStrongestPath(taskType);
            if (best.length > 0)
                dominantPaths.set(taskType, best);
        }
        return {
            nodes: Array.from(this.nodes),
            connections,
            dominantPaths,
            totalConnections: connections.length,
            avgWeight: connections.length > 0 ? totalWeight / connections.length : 0,
        };
    }
    /**
     * Find the strongest path for a given task type using greedy traversal.
     */
    findStrongestPath(taskType) {
        // Start from each node, greedily follow strongest connections
        let bestPath = [];
        let bestWeight = 0;
        for (const startNode of this.nodes) {
            const path = [startNode];
            const visited = new Set([startNode]);
            let current = startNode;
            let totalWeight = 1.0;
            for (let i = 0; i < this.config.maxHops; i++) {
                const outgoing = this.getOutgoing(current)
                    .filter(w => !visited.has(w.to) && w.taskTypes.has(taskType));
                if (outgoing.length === 0)
                    break;
                // Pick strongest
                outgoing.sort((a, b) => b.weight - a.weight);
                const next = outgoing[0];
                totalWeight *= next.weight;
                path.push(next.to);
                visited.add(next.to);
                current = next.to;
            }
            if (path.length > 1 && totalWeight > bestWeight) {
                bestPath = path;
                bestWeight = totalWeight;
            }
        }
        return bestPath;
    }
    /**
     * Get total node count.
     */
    get nodeCount() {
        return this.nodes.size;
    }
    /**
     * Get total active connection count.
     */
    get connectionCount() {
        let count = 0;
        for (const [, targets] of this.weights) {
            for (const [, conn] of targets) {
                if (conn.weight >= this.config.activationThreshold)
                    count++;
            }
        }
        return count;
    }
    /**
     * Get learning log (recent events).
     */
    getLearningLog() {
        return [...this.learningLog];
    }
    /**
     * Get routing stats.
     */
    getStats() {
        return {
            totalRoutes: this.totalRoutes,
            totalExplorations: this.totalExplorations,
            explorationRate: this.totalRoutes > 0
                ? this.totalExplorations / this.totalRoutes
                : 0,
        };
    }
    // ─── Internal ───
    logEvent(event) {
        this.learningLog.push(event);
        if (this.learningLog.length > this.maxLogSize) {
            this.learningLog.shift();
        }
    }
}
exports.NeuromorphicRouter = NeuromorphicRouter;
//# sourceMappingURL=router.js.map
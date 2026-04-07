"use strict";
/**
 * CMP v2.0 — Pheromone Field (Stigmergy Engine)
 *
 * Nodes leave "pheromone trails" in the mesh that influence other nodes'
 * behavior — without any direct communication or coordination.
 *
 * Inspired by ant colony optimization:
 *   - Success pheromones attract similar tasks to proven paths
 *   - Failure pheromones repel tasks from bad routes
 *   - Danger pheromones trigger immune awareness
 *   - All pheromones decay over time (evaporation)
 *   - Pheromones diffuse to neighboring nodes (spatial propagation)
 *
 * This is coordination WITHOUT communication. A node doesn't tell
 * others what to do — it modifies the shared environment, and others
 * react to that modified environment independently.
 *
 * @module consciousness/pheromone-field
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PheromoneField = void 0;
const consciousness_1 = require("../types/consciousness");
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
// ─── Pheromone Field ───
class PheromoneField {
    /** All active pheromones: id → Pheromone */
    pheromones = new Map();
    /** Index: type → set of pheromone IDs */
    typeIndex = new Map();
    /** Index: taskType → set of pheromone IDs */
    taskTypeIndex = new Map();
    config;
    deviceId;
    decayTimer = null;
    /** Callback for pheromones to diffuse to peers */
    onDiffuse = null;
    /** Listeners for pheromone events */
    listeners = new Set();
    /** Stats */
    stats = {
        totalDeposited: 0,
        totalReceived: 0,
        totalEvaporated: 0,
        totalDiffused: 0,
    };
    constructor(deviceId, config) {
        this.deviceId = deviceId;
        this.config = { ...consciousness_1.DEFAULT_CONSCIOUSNESS_CONFIG, ...config };
    }
    /** Start the decay/cleanup timer */
    start() {
        this.decayTimer = setInterval(() => this.tick(), this.config.pheromoneCleanupIntervalMs);
    }
    /** Stop the timer */
    stop() {
        if (this.decayTimer) {
            clearInterval(this.decayTimer);
            this.decayTimer = null;
        }
    }
    /** Set callback for diffusing pheromones to peers */
    onDiffuseCallback(fn) {
        this.onDiffuse = fn;
    }
    /** Subscribe to pheromone events */
    onEvent(listener) {
        this.listeners.add(listener);
    }
    // ── Deposit ──
    /**
     * Deposit a new pheromone into the field.
     * This is the primary way a node influences the mesh environment.
     */
    deposit(type, concentration = 1.0, taskType, payload) {
        // Enforce limits
        if (this.pheromones.size >= this.config.maxPheromonesPerNode) {
            this.evictOldest();
        }
        const pheromone = {
            id: randomId(),
            type,
            emitterId: this.deviceId,
            concentration: Math.min(1.0, Math.max(0.0, concentration)),
            taskType,
            payload,
            depositedAt: Date.now(),
            ttlMs: this.config.defaultPheromoneTtlMs,
            hops: 0,
            maxHops: this.config.maxPheromoneHops,
        };
        this.addPheromone(pheromone);
        this.stats.totalDeposited++;
        this.emit({ kind: 'deposited', pheromone });
        // Diffuse to peers
        if (this.onDiffuse) {
            this.onDiffuse(this.toWire(pheromone));
            this.stats.totalDiffused++;
        }
        return pheromone;
    }
    /**
     * Receive a pheromone from a peer (diffusion).
     * Concentration is reduced based on hops and diffusion rate.
     */
    receive(wire) {
        // Already have this one?
        if (this.pheromones.has(wire.id))
            return null;
        // Expired?
        if (Date.now() - wire.depositedAt > wire.ttlMs)
            return null;
        // Max hops reached?
        if (wire.hops >= wire.maxHops)
            return null;
        // Reduce concentration by diffusion rate per hop
        const diffusedConcentration = wire.concentration * (1 - this.config.pheromoneDiffusionRate);
        if (diffusedConcentration < 0.01)
            return null; // Too weak to matter
        const pheromone = {
            id: wire.id,
            type: wire.type,
            emitterId: wire.emitterId,
            concentration: diffusedConcentration,
            taskType: wire.taskType,
            payload: wire.payload,
            depositedAt: wire.depositedAt,
            ttlMs: wire.ttlMs,
            hops: wire.hops + 1,
            maxHops: wire.maxHops,
        };
        if (this.pheromones.size >= this.config.maxPheromonesPerNode) {
            this.evictOldest();
        }
        this.addPheromone(pheromone);
        this.stats.totalReceived++;
        this.emit({ kind: 'received', pheromone });
        // Continue diffusing (if still has hops and meaningful concentration)
        if (pheromone.hops < pheromone.maxHops && this.onDiffuse && pheromone.concentration > 0.05) {
            this.onDiffuse(this.toWire(pheromone));
            this.stats.totalDiffused++;
        }
        return pheromone;
    }
    // ── Reading ──
    /**
     * Read the concentration of a specific pheromone type.
     * This is how a node "smells" the environment.
     */
    read(type, taskType) {
        let totalConcentration = 0;
        let depositCount = 0;
        let latestDeposit = 0;
        const ids = this.typeIndex.get(type);
        if (ids) {
            for (const id of ids) {
                const p = this.pheromones.get(id);
                if (!p)
                    continue;
                if (taskType && p.taskType !== taskType)
                    continue;
                totalConcentration += p.concentration;
                depositCount++;
                if (p.depositedAt > latestDeposit)
                    latestDeposit = p.depositedAt;
            }
        }
        return { type, taskType, totalConcentration, depositCount, latestDeposit };
    }
    /**
     * Read all concentration levels — the full "scent map".
     */
    readAll() {
        const readings = [];
        const seen = new Set();
        for (const [, p] of this.pheromones) {
            const key = `${p.type}:${p.taskType || ''}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            readings.push(this.read(p.type, p.taskType));
        }
        return readings;
    }
    /**
     * Get the dominant pheromone type — what the environment "smells like most".
     */
    dominant() {
        const readings = this.readAll();
        if (readings.length === 0)
            return null;
        return readings.reduce((max, r) => r.totalConcentration > max.totalConcentration ? r : max);
    }
    /**
     * Check if a specific pheromone type concentration exceeds a threshold.
     * Used for simple yes/no environmental checks.
     */
    exceeds(type, threshold, taskType) {
        return this.read(type, taskType).totalConcentration > threshold;
    }
    // ── State ──
    /** Number of active pheromones */
    get size() {
        return this.pheromones.size;
    }
    /** Get all active pheromones */
    getAll() {
        return [...this.pheromones.values()];
    }
    /** Get stats */
    getStats() {
        return { ...this.stats, active: this.pheromones.size };
    }
    /** Clear all pheromones */
    clear() {
        this.pheromones.clear();
        this.typeIndex.clear();
        this.taskTypeIndex.clear();
    }
    // ── Internal ──
    /** Periodic tick: decay concentrations, evaporate expired */
    tick() {
        const now = Date.now();
        const toRemove = [];
        for (const [id, p] of this.pheromones) {
            // Evaporate expired
            if (now - p.depositedAt > p.ttlMs) {
                toRemove.push(id);
                continue;
            }
            // Decay concentration
            const age = (now - p.depositedAt) / 1000; // seconds
            const decayFactor = Math.exp(-this.config.pheromoneDecayRate * age);
            p.concentration = Math.max(0, p.concentration * decayFactor);
            // Remove if too weak
            if (p.concentration < 0.001) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            this.removePheromone(id);
            this.stats.totalEvaporated++;
        }
    }
    addPheromone(p) {
        this.pheromones.set(p.id, p);
        if (!this.typeIndex.has(p.type))
            this.typeIndex.set(p.type, new Set());
        this.typeIndex.get(p.type).add(p.id);
        if (p.taskType) {
            const key = String(p.taskType);
            if (!this.taskTypeIndex.has(key))
                this.taskTypeIndex.set(key, new Set());
            this.taskTypeIndex.get(key).add(p.id);
        }
    }
    removePheromone(id) {
        const p = this.pheromones.get(id);
        if (!p)
            return;
        this.pheromones.delete(id);
        this.typeIndex.get(p.type)?.delete(id);
        if (p.taskType) {
            this.taskTypeIndex.get(String(p.taskType))?.delete(id);
        }
    }
    evictOldest() {
        let oldestId = null;
        let oldestTime = Infinity;
        for (const [id, p] of this.pheromones) {
            if (p.depositedAt < oldestTime) {
                oldestTime = p.depositedAt;
                oldestId = id;
            }
        }
        if (oldestId)
            this.removePheromone(oldestId);
    }
    toWire(p) {
        return {
            id: p.id,
            type: p.type,
            emitterId: p.emitterId,
            concentration: p.concentration,
            taskType: p.taskType ? String(p.taskType) : undefined,
            payload: p.payload,
            depositedAt: p.depositedAt,
            ttlMs: p.ttlMs,
            hops: p.hops,
            maxHops: p.maxHops,
        };
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
exports.PheromoneField = PheromoneField;
//# sourceMappingURL=pheromone-field.js.map
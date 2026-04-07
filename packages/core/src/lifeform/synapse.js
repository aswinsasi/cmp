"use strict";
/**
 * CMP v1.4 — Synapse Manager
 * Communication channels between Lifeforms. Causes flow through
 * synapses with Hebbian strength learning — frequently used
 * connections get stronger, unused ones decay.
 *
 * Features:
 *   - Directional synapses (A→B, B→A are separate)
 *   - Hebbian strength: 0.0 (dormant) to 1.0 (strong)
 *   - Strength increases on use, decays on inactivity
 *   - Backpressure propagation through synapse network
 *   - Synapse partition for fusion/fission
 *
 * @module lifeform/synapse
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SynapseManager = void 0;
function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < n; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
const DEFAULT_CONFIG = {
    initialStrength: 0.5,
    strengthIncrease: 0.02,
    strengthDecayPerHour: 0.05,
    minActiveStrength: 0.1,
    maxSynapsesPerLifeform: 50,
};
class SynapseManager {
    /** synapseId hex → Synapse */
    synapses = new Map();
    /** fromName → Set of synapse IDs */
    outgoing = new Map();
    /** toName → Set of synapse IDs */
    incoming = new Map();
    config;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Create a synapse between two Lifeforms.
     * @returns Synapse ID or null if limit reached
     */
    createSynapse(fromName, toName) {
        // Check limits
        const outCount = this.outgoing.get(fromName)?.size ?? 0;
        if (outCount >= this.config.maxSynapsesPerLifeform)
            return null;
        // Check for existing synapse
        const existing = this.findSynapse(fromName, toName);
        if (existing)
            return existing;
        const id = randomBytes(16);
        const hex = toHex(id);
        const synapse = {
            id,
            fromName,
            toName,
            strength: this.config.initialStrength,
            causesTransmitted: 0,
            ccuFlowed: 0,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            active: true,
        };
        this.synapses.set(hex, synapse);
        // Index
        if (!this.outgoing.has(fromName))
            this.outgoing.set(fromName, new Set());
        this.outgoing.get(fromName).add(hex);
        if (!this.incoming.has(toName))
            this.incoming.set(toName, new Set());
        this.incoming.get(toName).add(hex);
        return synapse;
    }
    /**
     * Transmit a cause through a synapse.
     * Strengthens the synapse (Hebbian learning).
     * @returns true if transmitted, false if synapse not found or inactive
     */
    transmit(fromName, toName, ccuAmount = 0) {
        const synapse = this.findSynapse(fromName, toName);
        if (!synapse || !synapse.active)
            return false;
        synapse.causesTransmitted++;
        synapse.ccuFlowed += ccuAmount;
        synapse.lastUsedAt = Date.now();
        // Hebbian strengthening
        synapse.strength = Math.min(1.0, synapse.strength + this.config.strengthIncrease);
        return true;
    }
    /**
     * Get all outgoing synapses for a Lifeform (who does it send causes to?).
     */
    getOutgoing(lifeformName) {
        const ids = this.outgoing.get(lifeformName);
        if (!ids)
            return [];
        return [...ids].map(id => this.synapses.get(id)).filter(Boolean);
    }
    /**
     * Get all incoming synapses for a Lifeform (who sends causes to it?).
     */
    getIncoming(lifeformName) {
        const ids = this.incoming.get(lifeformName);
        if (!ids)
            return [];
        return [...ids].map(id => this.synapses.get(id)).filter(Boolean);
    }
    /**
     * Get all synapses involving a Lifeform (incoming + outgoing).
     */
    getAllFor(lifeformName) {
        const out = this.getOutgoing(lifeformName);
        const inc = this.getIncoming(lifeformName);
        const seen = new Set();
        const result = [];
        for (const s of [...out, ...inc]) {
            const hex = toHex(s.id);
            if (!seen.has(hex)) {
                seen.add(hex);
                result.push(s);
            }
        }
        return result;
    }
    /**
     * Find a specific synapse by from→to.
     */
    findSynapse(fromName, toName) {
        const ids = this.outgoing.get(fromName);
        if (!ids)
            return null;
        for (const id of ids) {
            const synapse = this.synapses.get(id);
            if (synapse && synapse.toName === toName)
                return synapse;
        }
        return null;
    }
    /**
     * Remove a synapse.
     */
    removeSynapse(synapseId) {
        const hex = toHex(synapseId);
        const synapse = this.synapses.get(hex);
        if (!synapse)
            return false;
        this.outgoing.get(synapse.fromName)?.delete(hex);
        this.incoming.get(synapse.toName)?.delete(hex);
        this.synapses.delete(hex);
        return true;
    }
    /**
     * Remove all synapses for a Lifeform (on death).
     */
    removeAllFor(lifeformName) {
        const all = this.getAllFor(lifeformName);
        for (const s of all) {
            this.removeSynapse(s.id);
        }
        return all.length;
    }
    /**
     * Apply time-based decay to all synapses.
     * Deactivates synapses below minimum strength.
     * @returns number of synapses deactivated
     */
    applyDecay() {
        const now = Date.now();
        let deactivated = 0;
        for (const [hex, synapse] of this.synapses) {
            const hoursSinceUse = (now - synapse.lastUsedAt) / 3600000;
            if (hoursSinceUse > 0) {
                synapse.strength -= this.config.strengthDecayPerHour * hoursSinceUse;
                synapse.strength = Math.max(0, synapse.strength);
            }
            if (synapse.strength < this.config.minActiveStrength) {
                synapse.active = false;
                deactivated++;
            }
        }
        return deactivated;
    }
    /**
     * Transfer synapses during fusion.
     * All synapses from both components transfer to the composite name.
     * @returns number of synapses transferred
     */
    transferForFusion(componentAName, componentBName, compositeName) {
        let transferred = 0;
        // Redirect outgoing synapses from components to composite
        for (const name of [componentAName, componentBName]) {
            const outgoing = this.getOutgoing(name);
            for (const syn of outgoing) {
                // Create new synapse from composite to the target
                if (syn.toName !== componentAName && syn.toName !== componentBName) {
                    const newSyn = this.createSynapse(compositeName, syn.toName);
                    if (newSyn) {
                        newSyn.strength = syn.strength;
                        newSyn.causesTransmitted = syn.causesTransmitted;
                        transferred++;
                    }
                }
            }
            // Redirect incoming synapses to composite
            const incoming = this.getIncoming(name);
            for (const syn of incoming) {
                if (syn.fromName !== componentAName && syn.fromName !== componentBName) {
                    const newSyn = this.createSynapse(syn.fromName, compositeName);
                    if (newSyn) {
                        newSyn.strength = syn.strength;
                        newSyn.causesTransmitted = syn.causesTransmitted;
                        transferred++;
                    }
                }
            }
        }
        return transferred;
    }
    /**
     * Partition synapses during fission.
     * Returns synapses grouped by original component.
     */
    partitionForFission(compositeName, componentAName, componentBName) {
        const all = this.getAllFor(compositeName);
        const forA = [];
        const forB = [];
        for (const syn of all) {
            // Assign based on which component had the original connection
            // Simple heuristic: even distribution by synapse index
            if (forA.length <= forB.length) {
                forA.push(syn);
            }
            else {
                forB.push(syn);
            }
        }
        return { forA, forB };
    }
    /** Get total synapse count */
    get totalCount() {
        return this.synapses.size;
    }
    /** Get all synapses */
    getAll() {
        return [...this.synapses.values()];
    }
    /** Get active synapse count */
    get activeCount() {
        let count = 0;
        for (const s of this.synapses.values()) {
            if (s.active)
                count++;
        }
        return count;
    }
}
exports.SynapseManager = SynapseManager;
//# sourceMappingURL=synapse.js.map
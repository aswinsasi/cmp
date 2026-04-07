"use strict";
/**
 * CMP v1.4 — CRDT State Manager
 * Manages a Lifeform's entire state as a map of named CRDTs.
 * Supports get, set, merge (for replication/fusion), delta extraction
 * (for efficient sync), and snapshot/restore (for persistence/migration).
 *
 * Key operations:
 *   - get(key) → value
 *   - set(key, value) → LWWRegister auto-created if key doesn't exist
 *   - counter(key) → GCounter/PNCounter
 *   - set_collection(key) → ORSet
 *   - merge(otherState) → conflict-free merge of all CRDTs
 *   - delta() → changes since last delta call
 *   - snapshot() → serializable state
 *   - restore(snapshot) → rebuild from snapshot
 *
 * @module lifeform/crdt/crdt-state
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRDTState = void 0;
const crdts_1 = require("./crdts");
class CRDTState {
    /** key → CRDT instance */
    state = new Map();
    /** Keys modified since last delta extraction */
    dirtyKeys = new Set();
    /** Node ID for CRDT operations */
    nodeId;
    /** Delta sequence counter */
    deltaSequence = 0;
    /** Mutation count (for billing) */
    mutationCount = 0;
    constructor(nodeId) {
        this.nodeId = nodeId;
    }
    // ═══════════════════════════════════════
    // Basic Get/Set (LWWRegister)
    // ═══════════════════════════════════════
    /**
     * Get the value of a key.
     * Returns the resolved CRDT value (type depends on CRDT type).
     */
    get(key) {
        const crdt = this.state.get(key);
        if (!crdt)
            return undefined;
        return crdt.value();
    }
    /**
     * Set a key to a value.
     * Creates an LWWRegister if the key doesn't exist.
     * If key exists as LWWRegister, updates it.
     */
    set(key, value) {
        let crdt = this.state.get(key);
        if (!crdt) {
            crdt = new crdts_1.LWWRegister(this.nodeId);
            this.state.set(key, crdt);
        }
        if (crdt instanceof crdts_1.LWWRegister) {
            crdt.set(value);
        }
        else {
            throw new Error(`Key "${key}" is a ${crdt.type}, not LWWRegister. Use specific methods.`);
        }
        this.markDirty(key);
    }
    // ═══════════════════════════════════════
    // Counter Operations
    // ═══════════════════════════════════════
    /**
     * Get or create a PNCounter for a key.
     */
    counter(key) {
        let crdt = this.state.get(key);
        if (!crdt) {
            crdt = new crdts_1.PNCounter(this.nodeId);
            this.state.set(key, crdt);
        }
        if (!(crdt instanceof crdts_1.PNCounter)) {
            throw new Error(`Key "${key}" is a ${crdt.type}, not PNCounter`);
        }
        return crdt;
    }
    /**
     * Increment a counter key.
     */
    increment(key, amount = 1) {
        this.counter(key).increment(amount);
        this.markDirty(key);
    }
    /**
     * Decrement a counter key.
     */
    decrement(key, amount = 1) {
        this.counter(key).decrement(amount);
        this.markDirty(key);
    }
    // ═══════════════════════════════════════
    // Set Operations (ORSet)
    // ═══════════════════════════════════════
    /**
     * Get or create an ORSet for a key.
     */
    orset(key) {
        let crdt = this.state.get(key);
        if (!crdt) {
            crdt = new crdts_1.ORSet(this.nodeId);
            this.state.set(key, crdt);
        }
        if (!(crdt instanceof crdts_1.ORSet)) {
            throw new Error(`Key "${key}" is a ${crdt.type}, not ORSet`);
        }
        return crdt;
    }
    /**
     * Add element to a set key.
     */
    addToSet(key, element) {
        this.orset(key).add(element);
        this.markDirty(key);
    }
    /**
     * Remove element from a set key.
     */
    removeFromSet(key, element) {
        this.orset(key).remove(element);
        this.markDirty(key);
    }
    // ═══════════════════════════════════════
    // Multi-Value Register
    // ═══════════════════════════════════════
    /**
     * Get or create an MVRegister for a key.
     */
    mvregister(key) {
        let crdt = this.state.get(key);
        if (!crdt) {
            crdt = new crdts_1.MVRegister(this.nodeId);
            this.state.set(key, crdt);
        }
        if (!(crdt instanceof crdts_1.MVRegister)) {
            throw new Error(`Key "${key}" is a ${crdt.type}, not MVRegister`);
        }
        return crdt;
    }
    // ═══════════════════════════════════════
    // Raw CRDT Access
    // ═══════════════════════════════════════
    /**
     * Get the raw CRDT for a key.
     */
    getCRDT(key) {
        return this.state.get(key);
    }
    /**
     * Set a raw CRDT for a key.
     */
    setCRDT(key, crdt) {
        this.state.set(key, crdt);
        this.markDirty(key);
    }
    /**
     * Check if a key exists.
     */
    has(key) {
        return this.state.has(key);
    }
    /**
     * Delete a key.
     */
    delete(key) {
        const deleted = this.state.delete(key);
        if (deleted)
            this.markDirty(key);
        return deleted;
    }
    /**
     * Get all keys.
     */
    keys() {
        return [...this.state.keys()];
    }
    /**
     * Get total number of keys.
     */
    get size() {
        return this.state.size;
    }
    // ═══════════════════════════════════════
    // Merge (for replication + fusion)
    // ═══════════════════════════════════════
    /**
     * Merge another CRDTState into this one.
     * This is the core operation that makes fusion possible.
     * CRDTs guarantee conflict-free merge.
     *
     * @param other - the state to merge in
     * @param namespace - optional prefix to add to other's keys (for fusion)
     */
    merge(other, namespace) {
        for (const [key, otherCrdt] of other.state) {
            const targetKey = namespace ? `${namespace}.${key}` : key;
            const myCrdt = this.state.get(targetKey);
            if (!myCrdt) {
                // Key doesn't exist locally — take the other's CRDT
                this.state.set(targetKey, otherCrdt.clone());
            }
            else if (myCrdt.type === otherCrdt.type) {
                // Same CRDT type — merge
                myCrdt.merge(otherCrdt);
            }
            else {
                // Different CRDT types — namespace to avoid conflict
                const nsKey = `${namespace || 'merged'}.${key}`;
                this.state.set(nsKey, otherCrdt.clone());
            }
            this.markDirty(targetKey);
        }
    }
    // ═══════════════════════════════════════
    // Delta Extraction (for efficient sync)
    // ═══════════════════════════════════════
    /**
     * Extract changes since last delta call.
     * Resets the dirty set.
     */
    extractDelta() {
        const changedKeys = [...this.dirtyKeys];
        const changes = {};
        for (const key of changedKeys) {
            const crdt = this.state.get(key);
            if (crdt) {
                changes[key] = crdt.serialize();
            }
            else {
                changes[key] = null; // Deleted
            }
        }
        this.dirtyKeys.clear();
        this.deltaSequence++;
        return {
            changedKeys,
            changes,
            extractedAt: Date.now(),
            sequence: this.deltaSequence,
        };
    }
    /**
     * Apply a delta received from another replica.
     */
    applyDelta(delta) {
        for (const key of delta.changedKeys) {
            const incoming = delta.changes[key];
            if (incoming === null) {
                // Key was deleted
                this.state.delete(key);
                continue;
            }
            const incomingCrdt = (0, crdts_1.deserializeCRDT)(incoming);
            const existing = this.state.get(key);
            if (!existing) {
                this.state.set(key, incomingCrdt);
            }
            else if (existing.type === incomingCrdt.type) {
                existing.merge(incomingCrdt);
            }
            // If types mismatch, keep local (shouldn't happen in well-formed deltas)
        }
    }
    // ═══════════════════════════════════════
    // Snapshot / Restore (for persistence + migration)
    // ═══════════════════════════════════════
    /**
     * Create a full snapshot of the state.
     */
    snapshot() {
        const crdts = {};
        let sizeEstimate = 0;
        for (const [key, crdt] of this.state) {
            const serialized = crdt.serialize();
            crdts[key] = serialized;
            sizeEstimate += JSON.stringify(serialized).length;
        }
        return {
            crdts,
            sizeBytes: sizeEstimate,
            snapshotAt: Date.now(),
            entryCount: this.state.size,
        };
    }
    /**
     * Restore state from a snapshot.
     */
    restore(snapshot) {
        this.state.clear();
        this.dirtyKeys.clear();
        for (const [key, data] of Object.entries(snapshot.crdts)) {
            this.state.set(key, (0, crdts_1.deserializeCRDT)(data));
        }
    }
    /**
     * Estimate total state size in bytes.
     */
    estimateSize() {
        let size = 0;
        for (const [key, crdt] of this.state) {
            size += key.length * 2; // UTF-16
            size += JSON.stringify(crdt.serialize()).length;
        }
        return size;
    }
    // ═══════════════════════════════════════
    // Partition (for fission)
    // ═══════════════════════════════════════
    /**
     * Partition state by key prefix.
     * Returns a new CRDTState containing only keys matching the prefix.
     * Keys are renamed to remove the prefix.
     */
    partition(prefix) {
        const partitioned = new CRDTState(this.nodeId);
        const prefixDot = prefix + '.';
        for (const [key, crdt] of this.state) {
            if (key.startsWith(prefixDot)) {
                const newKey = key.substring(prefixDot.length);
                partitioned.state.set(newKey, crdt.clone());
            }
        }
        return partitioned;
    }
    // ═══════════════════════════════════════
    // Billing
    // ═══════════════════════════════════════
    /** Get and reset mutation count (for billing) */
    consumeMutationCount() {
        const count = this.mutationCount;
        this.mutationCount = 0;
        return count;
    }
    /** Clear all state */
    clear() {
        this.state.clear();
        this.dirtyKeys.clear();
        this.mutationCount = 0;
    }
    // ── Internals ──
    markDirty(key) {
        this.dirtyKeys.add(key);
        this.mutationCount++;
    }
}
exports.CRDTState = CRDTState;
//# sourceMappingURL=crdt-state.js.map
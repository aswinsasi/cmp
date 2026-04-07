"use strict";
/**
 * CMP v1.4 — CRDT Implementations
 * Conflict-free Replicated Data Types for Lifeform state.
 * CRDTs guarantee merge without conflicts — the enabling technology
 * for Computational Fusion.
 *
 * Implements:
 *   - GCounter (grow-only counter)
 *   - PNCounter (positive-negative counter)
 *   - LWWRegister (last-writer-wins register)
 *   - ORSet (observed-remove set)
 *   - MVRegister (multi-value register)
 *
 * @module lifeform/crdt/crdts
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MVRegister = exports.ORSet = exports.LWWRegister = exports.PNCounter = exports.GCounter = exports.CRDTType = void 0;
exports.createCRDT = createCRDT;
exports.deserializeCRDT = deserializeCRDT;
// ─── CRDT Interface ───
var CRDTType;
(function (CRDTType) {
    CRDTType["G_COUNTER"] = "g_counter";
    CRDTType["PN_COUNTER"] = "pn_counter";
    CRDTType["LWW_REGISTER"] = "lww_register";
    CRDTType["OR_SET"] = "or_set";
    CRDTType["MV_REGISTER"] = "mv_register";
})(CRDTType || (exports.CRDTType = CRDTType = {}));
// ═══════════════════════════════════════
// GCounter — Grow-Only Counter
// ═══════════════════════════════════════
/**
 * Grow-only counter. Each node increments its own slot.
 * Value = sum of all slots. Merge = max of each slot.
 */
class GCounter {
    type = CRDTType.G_COUNTER;
    /** nodeId → count */
    counts = new Map();
    nodeId;
    constructor(nodeId, initial) {
        this.nodeId = nodeId;
        if (initial) {
            this.counts = new Map(initial);
        }
    }
    /** Increment by amount (must be positive) */
    increment(amount = 1) {
        if (amount < 0)
            throw new Error('GCounter can only increment');
        const current = this.counts.get(this.nodeId) ?? 0;
        this.counts.set(this.nodeId, current + amount);
    }
    /** Get total count across all nodes */
    value() {
        let total = 0;
        for (const count of this.counts.values())
            total += count;
        return total;
    }
    /** Merge: take max of each node's count */
    merge(other) {
        if (!(other instanceof GCounter))
            throw new Error('Can only merge with GCounter');
        for (const [nodeId, count] of other.counts) {
            const existing = this.counts.get(nodeId) ?? 0;
            this.counts.set(nodeId, Math.max(existing, count));
        }
    }
    serialize() {
        return { type: this.type, nodeId: this.nodeId, counts: Object.fromEntries(this.counts) };
    }
    clone() {
        return new GCounter(this.nodeId, new Map(this.counts));
    }
    static deserialize(data) {
        return new GCounter(data.nodeId, new Map(Object.entries(data.counts).map(([k, v]) => [k, v])));
    }
}
exports.GCounter = GCounter;
// ═══════════════════════════════════════
// PNCounter — Positive-Negative Counter
// ═══════════════════════════════════════
/**
 * Counter that supports both increment and decrement.
 * Implemented as two GCounters: P (positive) and N (negative).
 * Value = P.value() - N.value()
 */
class PNCounter {
    type = CRDTType.PN_COUNTER;
    p;
    n;
    constructor(nodeId, p, n) {
        this.p = p ?? new GCounter(nodeId);
        this.n = n ?? new GCounter(nodeId);
    }
    /** Increment by amount */
    increment(amount = 1) {
        if (amount < 0)
            throw new Error('Use decrement() for negative values');
        this.p.increment(amount);
    }
    /** Decrement by amount */
    decrement(amount = 1) {
        if (amount < 0)
            throw new Error('Decrement amount must be positive');
        this.n.increment(amount);
    }
    /** Get net count (positive - negative) */
    value() {
        return this.p.value() - this.n.value();
    }
    /** Merge both P and N counters */
    merge(other) {
        if (!(other instanceof PNCounter))
            throw new Error('Can only merge with PNCounter');
        this.p.merge(other.p);
        this.n.merge(other.n);
    }
    serialize() {
        return { type: this.type, p: this.p.serialize(), n: this.n.serialize() };
    }
    clone() {
        return new PNCounter('', this.p.clone(), this.n.clone());
    }
    static deserialize(data) {
        return new PNCounter('', GCounter.deserialize(data.p), GCounter.deserialize(data.n));
    }
}
exports.PNCounter = PNCounter;
// ═══════════════════════════════════════
// LWWRegister — Last-Writer-Wins Register
// ═══════════════════════════════════════
/**
 * Register where the most recent write wins.
 * Stores any JSON-serializable value with a timestamp.
 */
class LWWRegister {
    type = CRDTType.LWW_REGISTER;
    val;
    ts;
    nodeId;
    constructor(nodeId, value = null, timestamp = 0) {
        this.nodeId = nodeId;
        this.val = value;
        this.ts = timestamp;
    }
    /** Set value with current timestamp */
    set(value) {
        this.val = value;
        this.ts = Date.now();
    }
    /** Set value with explicit timestamp */
    setAt(value, timestamp) {
        if (timestamp > this.ts) {
            this.val = value;
            this.ts = timestamp;
        }
    }
    /** Get current value */
    value() {
        return this.val;
    }
    /** Get timestamp of current value */
    timestamp() {
        return this.ts;
    }
    /** Merge: keep value with higher timestamp */
    merge(other) {
        if (!(other instanceof LWWRegister))
            throw new Error('Can only merge with LWWRegister');
        const otherReg = other;
        if (otherReg.ts > this.ts) {
            this.val = otherReg.val;
            this.ts = otherReg.ts;
        }
        else if (otherReg.ts === this.ts && otherReg.nodeId > this.nodeId) {
            // Tie-break by node ID (deterministic)
            this.val = otherReg.val;
            this.ts = otherReg.ts;
        }
    }
    serialize() {
        return { type: this.type, nodeId: this.nodeId, value: this.val, timestamp: this.ts };
    }
    clone() {
        return new LWWRegister(this.nodeId, this.val, this.ts);
    }
    static deserialize(data) {
        return new LWWRegister(data.nodeId, data.value, data.timestamp);
    }
}
exports.LWWRegister = LWWRegister;
// ═══════════════════════════════════════
// ORSet — Observed-Remove Set
// ═══════════════════════════════════════
/**
 * Set that supports both add and remove without conflicts.
 * Each element is tagged with a unique ID on add. Remove removes
 * only the observed tags. Concurrent add+remove = element survives.
 */
class ORSet {
    type = CRDTType.OR_SET;
    /** element (serialized) → Set of unique tags */
    elements = new Map();
    /** Tombstoned tags (removed) */
    tombstones = new Set();
    nodeId;
    tagCounter = 0;
    constructor(nodeId) {
        this.nodeId = nodeId;
    }
    /** Add an element */
    add(element) {
        const key = JSON.stringify(element);
        const tag = `${this.nodeId}:${++this.tagCounter}:${Date.now()}`;
        if (!this.elements.has(key)) {
            this.elements.set(key, new Set());
        }
        this.elements.get(key).add(tag);
    }
    /** Remove an element (removes all observed tags) */
    remove(element) {
        const key = JSON.stringify(element);
        const tags = this.elements.get(key);
        if (tags) {
            for (const tag of tags) {
                this.tombstones.add(tag);
            }
            this.elements.delete(key);
        }
    }
    /** Check if element is in the set */
    has(element) {
        const key = JSON.stringify(element);
        const tags = this.elements.get(key);
        if (!tags)
            return false;
        // Element is present if it has any non-tombstoned tags
        for (const tag of tags) {
            if (!this.tombstones.has(tag))
                return true;
        }
        return false;
    }
    /** Get all elements in the set */
    value() {
        const result = new Set();
        for (const [key, tags] of this.elements) {
            for (const tag of tags) {
                if (!this.tombstones.has(tag)) {
                    result.add(JSON.parse(key));
                    break; // Only need one live tag
                }
            }
        }
        return result;
    }
    /** Number of elements */
    get size() {
        return this.value().size;
    }
    /** Merge with another ORSet */
    merge(other) {
        if (!(other instanceof ORSet))
            throw new Error('Can only merge with ORSet');
        const otherSet = other;
        // Union elements
        for (const [key, tags] of otherSet.elements) {
            if (!this.elements.has(key)) {
                this.elements.set(key, new Set());
            }
            const myTags = this.elements.get(key);
            for (const tag of tags) {
                myTags.add(tag);
            }
        }
        // Union tombstones
        for (const tag of otherSet.tombstones) {
            this.tombstones.add(tag);
        }
        // Clean up: remove elements where all tags are tombstoned
        for (const [key, tags] of this.elements) {
            let hasLive = false;
            for (const tag of tags) {
                if (!this.tombstones.has(tag)) {
                    hasLive = true;
                    break;
                }
            }
            if (!hasLive)
                this.elements.delete(key);
        }
    }
    serialize() {
        const elements = {};
        for (const [key, tags] of this.elements) {
            elements[key] = [...tags];
        }
        return {
            type: this.type,
            nodeId: this.nodeId,
            elements,
            tombstones: [...this.tombstones],
            tagCounter: this.tagCounter,
        };
    }
    clone() {
        const copy = new ORSet(this.nodeId);
        for (const [key, tags] of this.elements) {
            copy.elements.set(key, new Set(tags));
        }
        copy.tombstones = new Set(this.tombstones);
        copy.tagCounter = this.tagCounter;
        return copy;
    }
    static deserialize(data) {
        const set = new ORSet(data.nodeId);
        for (const [key, tags] of Object.entries(data.elements)) {
            set.elements.set(key, new Set(tags));
        }
        set.tombstones = new Set(data.tombstones);
        set.tagCounter = data.tagCounter;
        return set;
    }
}
exports.ORSet = ORSet;
// ═══════════════════════════════════════
// MVRegister — Multi-Value Register
// ═══════════════════════════════════════
/**
 * Register that preserves ALL concurrent writes.
 * Value is an array of all concurrently written values.
 * Merge combines values, resolves via vector clock.
 */
class MVRegister {
    type = CRDTType.MV_REGISTER;
    /** Each entry: { value, clock: { nodeId: counter } } */
    entries = [];
    nodeId;
    counter = 0;
    constructor(nodeId) {
        this.nodeId = nodeId;
    }
    /** Set a value (generates a new vector clock entry) */
    set(value) {
        this.counter++;
        const clock = new Map();
        // Include all known clocks + our increment
        for (const entry of this.entries) {
            for (const [nid, cnt] of entry.clock) {
                clock.set(nid, Math.max(clock.get(nid) ?? 0, cnt));
            }
        }
        clock.set(this.nodeId, this.counter);
        // Replace all entries with just this one (our write supersedes our previous writes)
        this.entries = [{ value, clock }];
    }
    /** Get all concurrent values */
    value() {
        return this.entries.map(e => e.value);
    }
    /** Get single value (first) or null */
    single() {
        return this.entries.length > 0 ? this.entries[0].value : null;
    }
    /** Merge: keep values that are not dominated by another entry's clock */
    merge(other) {
        if (!(other instanceof MVRegister))
            throw new Error('Can only merge with MVRegister');
        const otherReg = other;
        const combined = [...this.entries, ...otherReg.entries];
        // Remove dominated entries: entry A dominates B if A's clock >= B's clock for all nodes
        const survivors = [];
        for (let i = 0; i < combined.length; i++) {
            let dominated = false;
            for (let j = 0; j < combined.length; j++) {
                if (i === j)
                    continue;
                if (this.dominates(combined[j].clock, combined[i].clock)) {
                    dominated = true;
                    break;
                }
            }
            if (!dominated)
                survivors.push(combined[i]);
        }
        // Deduplicate by value
        const seen = new Set();
        this.entries = [];
        for (const entry of survivors) {
            const key = JSON.stringify(entry.value);
            if (!seen.has(key)) {
                seen.add(key);
                this.entries.push(entry);
            }
        }
    }
    /** Check if clock A strictly dominates clock B */
    dominates(a, b) {
        let strictlyGreater = false;
        // A must be >= B for all keys in B
        for (const [nid, cnt] of b) {
            const aCnt = a.get(nid) ?? 0;
            if (aCnt < cnt)
                return false;
            if (aCnt > cnt)
                strictlyGreater = true;
        }
        // A must be > B for at least one key
        if (!strictlyGreater) {
            for (const [nid, cnt] of a) {
                if ((b.get(nid) ?? 0) < cnt) {
                    strictlyGreater = true;
                    break;
                }
            }
        }
        return strictlyGreater;
    }
    serialize() {
        return {
            type: this.type,
            nodeId: this.nodeId,
            counter: this.counter,
            entries: this.entries.map(e => ({
                value: e.value,
                clock: Object.fromEntries(e.clock),
            })),
        };
    }
    clone() {
        const copy = new MVRegister(this.nodeId);
        copy.counter = this.counter;
        copy.entries = this.entries.map(e => ({
            value: e.value,
            clock: new Map(e.clock),
        }));
        return copy;
    }
    static deserialize(data) {
        const reg = new MVRegister(data.nodeId);
        reg.counter = data.counter;
        reg.entries = data.entries.map((e) => ({
            value: e.value,
            clock: new Map(Object.entries(e.clock).map(([k, v]) => [k, v])),
        }));
        return reg;
    }
}
exports.MVRegister = MVRegister;
// ═══════════════════════════════════════
// CRDT Factory
// ═══════════════════════════════════════
function createCRDT(type, nodeId, initialValue) {
    switch (type) {
        case CRDTType.G_COUNTER:
            return new GCounter(nodeId);
        case CRDTType.PN_COUNTER:
            return new PNCounter(nodeId);
        case CRDTType.LWW_REGISTER: {
            const reg = new LWWRegister(nodeId);
            if (initialValue !== undefined)
                reg.set(initialValue);
            return reg;
        }
        case CRDTType.OR_SET:
            return new ORSet(nodeId);
        case CRDTType.MV_REGISTER:
            return new MVRegister(nodeId);
        default:
            throw new Error(`Unknown CRDT type: ${type}`);
    }
}
function deserializeCRDT(data) {
    switch (data.type) {
        case CRDTType.G_COUNTER: return GCounter.deserialize(data);
        case CRDTType.PN_COUNTER: return PNCounter.deserialize(data);
        case CRDTType.LWW_REGISTER: return LWWRegister.deserialize(data);
        case CRDTType.OR_SET: return ORSet.deserialize(data);
        case CRDTType.MV_REGISTER: return MVRegister.deserialize(data);
        default: throw new Error(`Unknown CRDT type: ${data.type}`);
    }
}
//# sourceMappingURL=crdts.js.map
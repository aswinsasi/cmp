"use strict";
/**
 * CMP v3.0 — Entanglement Manager
 * Bidirectional symmetric CRDT state mirroring between Lifeform pairs.
 *
 * When two Lifeforms are entangled:
 *   - Any state change in A is immediately applied to B (and vice versa)
 *   - Uses CRDT merge — guaranteed convergence regardless of concurrent writes
 *   - Both Lifeforms are primaries (unlike replication which is master→slave)
 *
 * Use cases:
 *   - Two sensors monitoring the same environment from different angles
 *   - Redundant computation where both must stay in sync
 *   - Pre-fusion warmup: entangle first, then fuse with zero merge cost
 *
 * Integration:
 *   After every cause execution on any Lifeform, the LifeformManager calls
 *   entanglementManager.onStateChange(name, delta). If that Lifeform is
 *   entangled, the delta is applied to all partners.
 *
 * @module entanglement/manager
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntanglementManager = void 0;
const entanglement_1 = require("../types/entanglement");
function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++)
        arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ═══════════════════════════════════════
class EntanglementManager {
    config;
    accessor;
    /** All active entanglements: id → record */
    entanglements = new Map();
    /** Lifeform name → set of entanglement IDs it participates in */
    lifeformIndex = new Map();
    /** Event log (ring buffer) */
    events = [];
    maxEvents = 500;
    /** Re-entrancy guard: prevents infinite loops when A's change triggers B's change */
    syncing = new Set();
    /** Batch timers (only used in 'batched' mode) */
    batchTimers = new Map();
    /** Pending batch deltas: entanglementId → accumulated delta changes */
    pendingBatches = new Map();
    constructor(accessor, config) {
        this.config = { ...entanglement_1.DEFAULT_ENTANGLEMENT_CONFIG, ...config };
        this.accessor = accessor;
    }
    // ═══════════════════════════════════════
    // Entangle / Disentangle
    // ═══════════════════════════════════════
    /**
     * Entangle two Lifeforms — their states will mirror bidirectionally.
     *
     * @param nameA - First Lifeform name
     * @param nameB - Second Lifeform name
     * @param keyFilter - Optional: only entangle specific keys (empty = all)
     * @returns The entanglement record, or null if constraints violated
     */
    entangle(nameA, nameB, keyFilter = []) {
        // Validate
        if (nameA === nameB)
            return null;
        if (!this.accessor.isAlive(nameA) || !this.accessor.isAlive(nameB))
            return null;
        // Check if already entangled
        if (this.areEntangled(nameA, nameB))
            return null;
        // Check max entanglements
        const countA = this.lifeformIndex.get(nameA)?.size ?? 0;
        const countB = this.lifeformIndex.get(nameB)?.size ?? 0;
        if (countA >= this.config.maxEntanglementsPerLifeform)
            return null;
        if (countB >= this.config.maxEntanglementsPerLifeform)
            return null;
        const record = {
            id: randomHex(8),
            lifeformA: nameA,
            lifeformB: nameB,
            createdAt: Date.now(),
            active: true,
            deltasSynced: 0,
            keyFilter,
        };
        this.entanglements.set(record.id, record);
        // Index both Lifeforms
        if (!this.lifeformIndex.has(nameA))
            this.lifeformIndex.set(nameA, new Set());
        if (!this.lifeformIndex.has(nameB))
            this.lifeformIndex.set(nameB, new Set());
        this.lifeformIndex.get(nameA).add(record.id);
        this.lifeformIndex.get(nameB).add(record.id);
        // Start batch timer if in batched mode
        if (this.config.syncMode === 'batched') {
            this.pendingBatches.set(record.id, new Map());
            this.batchTimers.set(record.id, setInterval(() => {
                this.flushBatch(record.id);
            }, this.config.batchIntervalMs));
        }
        this.logEvent({
            type: 'created',
            entanglementId: record.id,
            lifeformA: nameA,
            lifeformB: nameB,
            timestamp: Date.now(),
        });
        return record;
    }
    /**
     * Break an entanglement. States diverge from this point.
     */
    disentangle(entanglementId) {
        const record = this.entanglements.get(entanglementId);
        if (!record)
            return false;
        record.active = false;
        // Clean up indices
        this.lifeformIndex.get(record.lifeformA)?.delete(entanglementId);
        this.lifeformIndex.get(record.lifeformB)?.delete(entanglementId);
        // Clean up empty index entries
        if (this.lifeformIndex.get(record.lifeformA)?.size === 0) {
            this.lifeformIndex.delete(record.lifeformA);
        }
        if (this.lifeformIndex.get(record.lifeformB)?.size === 0) {
            this.lifeformIndex.delete(record.lifeformB);
        }
        // Stop batch timer
        const timer = this.batchTimers.get(entanglementId);
        if (timer) {
            clearInterval(timer);
            this.batchTimers.delete(entanglementId);
        }
        this.pendingBatches.delete(entanglementId);
        this.entanglements.delete(entanglementId);
        this.logEvent({
            type: 'broken',
            entanglementId,
            lifeformA: record.lifeformA,
            lifeformB: record.lifeformB,
            timestamp: Date.now(),
        });
        return true;
    }
    /**
     * Break all entanglements for a Lifeform (called on kill/migrate).
     */
    disentangleAll(lifeformName) {
        const ids = this.lifeformIndex.get(lifeformName);
        if (!ids)
            return 0;
        let count = 0;
        for (const id of [...ids]) {
            if (this.disentangle(id))
                count++;
        }
        return count;
    }
    // ═══════════════════════════════════════
    // State Change Hook
    // ═══════════════════════════════════════
    /**
     * Called by LifeformManager after every cause execution.
     * If the Lifeform is entangled, applies the delta to all partners.
     *
     * The re-entrancy guard (this.syncing) prevents infinite loops:
     * A changes → sync to B → B's applyDelta would trigger onStateChange for B
     * → guard blocks the re-entry → no infinite loop.
     */
    onStateChange(lifeformName, delta) {
        const entanglementIds = this.lifeformIndex.get(lifeformName);
        if (!entanglementIds || entanglementIds.size === 0)
            return 0;
        let synced = 0;
        for (const eid of entanglementIds) {
            // Re-entrancy guard
            const guardKey = `${eid}:${lifeformName}`;
            if (this.syncing.has(guardKey))
                continue;
            const record = this.entanglements.get(eid);
            if (!record || !record.active)
                continue;
            // Determine partner
            const partner = record.lifeformA === lifeformName
                ? record.lifeformB
                : record.lifeformA;
            // Apply key filter
            const filteredDelta = this.filterDelta(delta, record.keyFilter);
            if (filteredDelta.changedKeys.length === 0)
                continue;
            if (this.config.syncMode === 'immediate') {
                // Immediate sync
                this.syncing.add(guardKey);
                try {
                    const applied = this.accessor.applyDelta(partner, filteredDelta);
                    if (applied) {
                        record.deltasSynced++;
                        synced++;
                    }
                }
                finally {
                    this.syncing.delete(guardKey);
                }
            }
            else {
                // Batched: accumulate delta
                const batch = this.pendingBatches.get(eid);
                if (batch) {
                    for (const key of filteredDelta.changedKeys) {
                        batch.set(key, filteredDelta.changes[key]);
                    }
                }
                synced++;
            }
        }
        return synced;
    }
    // ═══════════════════════════════════════
    // Query
    // ═══════════════════════════════════════
    /** Check if two Lifeforms are entangled */
    areEntangled(nameA, nameB) {
        const idsA = this.lifeformIndex.get(nameA);
        if (!idsA)
            return false;
        for (const eid of idsA) {
            const record = this.entanglements.get(eid);
            if (!record || !record.active)
                continue;
            if ((record.lifeformA === nameA && record.lifeformB === nameB) ||
                (record.lifeformA === nameB && record.lifeformB === nameA)) {
                return true;
            }
        }
        return false;
    }
    /** Get all entanglements for a Lifeform */
    getEntanglements(lifeformName) {
        const ids = this.lifeformIndex.get(lifeformName);
        if (!ids)
            return [];
        const results = [];
        for (const eid of ids) {
            const record = this.entanglements.get(eid);
            if (record && record.active)
                results.push(record);
        }
        return results;
    }
    /** Get entangled partners for a Lifeform */
    getPartners(lifeformName) {
        return this.getEntanglements(lifeformName).map(r => r.lifeformA === lifeformName ? r.lifeformB : r.lifeformA);
    }
    /** Get a specific entanglement record */
    getRecord(entanglementId) {
        return this.entanglements.get(entanglementId);
    }
    /** Total active entanglements */
    get activeCount() {
        return this.entanglements.size;
    }
    /** Get recent events */
    getEvents() {
        return [...this.events];
    }
    // ─── Stats ───
    getStats() {
        let totalSynced = 0;
        for (const record of this.entanglements.values()) {
            totalSynced += record.deltasSynced;
        }
        return {
            activeEntanglements: this.entanglements.size,
            totalDeltasSynced: totalSynced,
            entangledLifeforms: this.lifeformIndex.size,
        };
    }
    /** Clean up all timers */
    destroy() {
        for (const timer of this.batchTimers.values()) {
            clearInterval(timer);
        }
        this.batchTimers.clear();
        this.pendingBatches.clear();
    }
    // ═══════════════════════════════════════
    // Internal
    // ═══════════════════════════════════════
    /** Filter delta to only include keys in the key filter */
    filterDelta(delta, keyFilter) {
        if (keyFilter.length === 0)
            return delta; // No filter = all keys
        const filteredKeys = delta.changedKeys.filter(k => keyFilter.includes(k));
        const filteredChanges = {};
        for (const k of filteredKeys) {
            filteredChanges[k] = delta.changes[k];
        }
        return {
            changedKeys: filteredKeys,
            changes: filteredChanges,
            extractedAt: delta.extractedAt,
            sequence: delta.sequence,
        };
    }
    /** Flush a batch of accumulated deltas to the partner */
    flushBatch(entanglementId) {
        const record = this.entanglements.get(entanglementId);
        const batch = this.pendingBatches.get(entanglementId);
        if (!record || !record.active || !batch || batch.size === 0)
            return;
        const delta = {
            changedKeys: [...batch.keys()],
            changes: Object.fromEntries(batch),
            extractedAt: Date.now(),
            sequence: record.deltasSynced + 1,
        };
        // Apply to both sides (both could have accumulated changes)
        const guardA = `${entanglementId}:${record.lifeformA}`;
        const guardB = `${entanglementId}:${record.lifeformB}`;
        this.syncing.add(guardA);
        this.syncing.add(guardB);
        try {
            this.accessor.applyDelta(record.lifeformA, delta);
            this.accessor.applyDelta(record.lifeformB, delta);
            record.deltasSynced++;
        }
        finally {
            this.syncing.delete(guardA);
            this.syncing.delete(guardB);
        }
        batch.clear();
    }
    logEvent(event) {
        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events.shift();
        }
    }
}
exports.EntanglementManager = EntanglementManager;
//# sourceMappingURL=manager.js.map
"use strict";
/**
 * CMP v1.4 — Lifeform Lifecycle Manager
 * Manages a single Lifeform's lifecycle state machine:
 *   SPAWNING → ALIVE → MIGRATING/FUSED/HIBERNATING/DEAD
 *
 * Handles:
 *   - State transitions with validation
 *   - CCU balance tracking (earn, spend, billing)
 *   - Host tracking (primary + replicas)
 *   - Fusion/fission state sub-management
 *
 * @module lifeform/lifecycle
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifeformLifecycle = void 0;
const lifeform_1 = require("../types/lifeform");
const causal_1 = require("../types/causal");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
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
// ─── Valid state transitions ───
const VALID_TRANSITIONS = {
    [lifeform_1.LifeformState.SPAWNING]: [lifeform_1.LifeformState.ALIVE, lifeform_1.LifeformState.DEAD],
    [lifeform_1.LifeformState.ALIVE]: [lifeform_1.LifeformState.MIGRATING, lifeform_1.LifeformState.FUSED, lifeform_1.LifeformState.HIBERNATING, lifeform_1.LifeformState.DEAD],
    [lifeform_1.LifeformState.MIGRATING]: [lifeform_1.LifeformState.ALIVE, lifeform_1.LifeformState.DEAD],
    [lifeform_1.LifeformState.FUSED]: [lifeform_1.LifeformState.ALIVE, lifeform_1.LifeformState.DEAD],
    [lifeform_1.LifeformState.HIBERNATING]: [lifeform_1.LifeformState.ALIVE, lifeform_1.LifeformState.DEAD],
    [lifeform_1.LifeformState.DEAD]: [], // Terminal state
};
class LifeformLifecycle {
    instance;
    billing;
    /** State transition log */
    transitions = [];
    constructor(soul, config, hostId, billing) {
        this.billing = { ...causal_1.DEFAULT_CAUSE_BILLING, ...billing };
        this.instance = {
            soul,
            state: lifeform_1.LifeformState.SPAWNING,
            config,
            genomeHash: new Uint8Array(32), // Will be set when WASM loads
            hostId,
            replicaHosts: [],
            ccuBalance: config.initialCcu,
            causesProcessed: 0,
            ccuEarned: 0,
            ccuSpent: 0,
            lastActiveAt: Date.now(),
            fusionInfo: null,
        };
    }
    // ═══════════════════════════════════════
    // State Transitions
    // ═══════════════════════════════════════
    /**
     * Transition to a new state.
     * Validates the transition is allowed.
     */
    transitionTo(newState, reason = '') {
        const currentState = this.instance.state;
        const allowed = VALID_TRANSITIONS[currentState];
        if (!allowed.includes(newState)) {
            return false; // Invalid transition
        }
        this.transitions.push({
            from: currentState,
            to: newState,
            timestamp: Date.now(),
            reason,
        });
        this.instance.state = newState;
        if (newState === lifeform_1.LifeformState.ALIVE) {
            this.instance.lastActiveAt = Date.now();
        }
        return true;
    }
    /**
     * Get current state.
     */
    get state() {
        return this.instance.state;
    }
    /**
     * Check if the Lifeform is in a processable state.
     */
    get isProcessable() {
        return this.instance.state === lifeform_1.LifeformState.ALIVE ||
            this.instance.state === lifeform_1.LifeformState.FUSED;
    }
    /**
     * Check if the Lifeform is dead.
     */
    get isDead() {
        return this.instance.state === lifeform_1.LifeformState.DEAD;
    }
    // ═══════════════════════════════════════
    // CCU Economy
    // ═══════════════════════════════════════
    /**
     * Spend CCU (for cause execution, hosting, etc).
     * Returns false if insufficient balance.
     */
    spendCcu(amount, reason = '') {
        if (this.instance.ccuBalance < amount)
            return false;
        this.instance.ccuBalance -= amount;
        this.instance.ccuSpent += amount;
        return true;
    }
    /**
     * Earn CCU (from incoming causes with CCU attached, or work).
     */
    earnCcu(amount) {
        this.instance.ccuBalance += amount;
        this.instance.ccuEarned += amount;
    }
    /**
     * Top up CCU from external source.
     */
    topUpCcu(amount) {
        this.instance.ccuBalance += amount;
    }
    /**
     * Get current CCU balance.
     */
    get ccuBalance() {
        return this.instance.ccuBalance;
    }
    /**
     * Calculate and deduct hourly hosting cost.
     * Should be called periodically (e.g. every hour).
     * @returns the cost deducted, or -1 if insufficient balance (triggers death)
     */
    chargeHostingCost(stateSizeBytes) {
        const cost = (0, causal_1.calculateHostingCost)(this.billing, stateSizeBytes);
        if (this.instance.ccuBalance < cost) {
            // Can't afford hosting — Lifeform should die
            return -1;
        }
        this.instance.ccuBalance -= cost;
        this.instance.ccuSpent += cost;
        return cost;
    }
    /**
     * Record a cause execution.
     */
    recordCauseExecution(ccuCost) {
        this.instance.causesProcessed++;
        this.instance.lastActiveAt = Date.now();
        // Always deduct — can go negative (death checked by manager)
        this.instance.ccuBalance -= ccuCost;
        this.instance.ccuSpent += ccuCost;
    }
    // ═══════════════════════════════════════
    // Fusion
    // ═══════════════════════════════════════
    /**
     * Enter fused state.
     */
    fuse(compositeId, partnerId, role) {
        if (!this.transitionTo(lifeform_1.LifeformState.FUSED, `Fusion with ${toHex(partnerId).substring(0, 8)}`)) {
            return false;
        }
        this.instance.fusionInfo = {
            compositeId,
            partnerId,
            role,
            fusedAt: Date.now(),
        };
        return true;
    }
    /**
     * Exit fused state (fission).
     */
    unfuse() {
        if (this.instance.state !== lifeform_1.LifeformState.FUSED)
            return false;
        this.instance.fusionInfo = null;
        return this.transitionTo(lifeform_1.LifeformState.ALIVE, 'Fission — restored to independent');
    }
    /**
     * Get fusion info.
     */
    get fusionInfo() {
        return this.instance.fusionInfo;
    }
    // ═══════════════════════════════════════
    // Host Management
    // ═══════════════════════════════════════
    /**
     * Update primary host (after migration).
     */
    setHost(hostId) {
        this.instance.hostId = hostId;
    }
    /**
     * Add a replica host.
     */
    addReplica(hostId) {
        const hex = toHex(hostId);
        const existing = this.instance.replicaHosts.map(h => toHex(h));
        if (!existing.includes(hex)) {
            this.instance.replicaHosts.push(hostId);
        }
    }
    /**
     * Remove a replica host.
     */
    removeReplica(hostId) {
        const hex = toHex(hostId);
        const idx = this.instance.replicaHosts.findIndex(h => toHex(h) === hex);
        if (idx >= 0) {
            this.instance.replicaHosts.splice(idx, 1);
            return true;
        }
        return false;
    }
    /**
     * Get primary host ID.
     */
    get hostId() {
        return this.instance.hostId;
    }
    /**
     * Get replica count.
     */
    get replicaCount() {
        return this.instance.replicaHosts.length;
    }
    // ═══════════════════════════════════════
    // Genome
    // ═══════════════════════════════════════
    /**
     * Set genome hash (after WASM module loaded).
     */
    setGenomeHash(hash) {
        this.instance.genomeHash = hash;
    }
    // ═══════════════════════════════════════
    // Accessors
    // ═══════════════════════════════════════
    /** Get the full instance */
    getInstance() {
        return { ...this.instance };
    }
    /** Get the soul */
    get soul() {
        return this.instance.soul;
    }
    /** Get the lifeform ID */
    get id() {
        return this.instance.soul.id;
    }
    /** Get the lifeform name */
    get name() {
        return this.instance.soul.name;
    }
    /** Get transition log */
    getTransitions() {
        return [...this.transitions];
    }
    /** Get total causes processed */
    get causesProcessed() {
        return this.instance.causesProcessed;
    }
    /** Get last active timestamp */
    get lastActiveAt() {
        return this.instance.lastActiveAt;
    }
}
exports.LifeformLifecycle = LifeformLifecycle;
//# sourceMappingURL=lifecycle.js.map
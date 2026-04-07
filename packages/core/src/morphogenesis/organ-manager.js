"use strict";
/**
 * CMP v1.3 — Organ Manager
 * Creates, manages, and dissolves organs — specialized sub-meshes that
 * form around workload affinity patterns. Handles organ lifecycle:
 * formation → membership → health tracking → dissolution.
 *
 * Organ Formation Algorithm:
 *   1. Count specialists for each task type
 *   2. If specialists >= minOrganSize and no organ exists → form organ
 *   3. Track organ health based on task throughput
 *   4. Dissolve organs with health below dissolutionThreshold
 *
 * @module morphogenesis/organ-manager
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrganManager = void 0;
const morphogenesis_1 = require("../types/morphogenesis");
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
    minOrganSize: 3,
    minSpecializationScore: 0.6,
    signalIntervalMs: 10000,
    morphogenDecayRate: 0.3,
    maxMorphogenTtl: 5,
    dissolutionThreshold: 0.2,
    minTasksForActive: 10,
    affinityDecayRate: 0.05,
};
class OrganManager {
    /** organId hex → Organ */
    organs = new Map();
    affinityTracker;
    config;
    eventLog = [];
    healthTimer = null;
    constructor(affinityTracker, config) {
        this.affinityTracker = affinityTracker;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** Start periodic health check */
    start() {
        this.healthTimer = setInterval(() => this.healthCheck(), this.config.signalIntervalMs);
    }
    /** Stop health check */
    stop() {
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
    }
    /**
     * Evaluate whether new organs should form based on current affinities.
     * Called periodically or after affinity updates.
     *
     * Algorithm:
     * 1. Get all specialists from AffinityTracker
     * 2. Group by primary affinity (task type)
     * 3. For each task type with >= minOrganSize specialists:
     *    a. If no organ exists for this type → form one
     *    b. Add all specialists as members
     */
    evaluateFormation() {
        const formed = [];
        const specialists = this.affinityTracker.getSpecialists(this.config.minSpecializationScore);
        // Group specialists by primary affinity
        const byType = new Map();
        for (const spec of specialists) {
            const existing = byType.get(spec.primaryAffinity) || [];
            existing.push(spec.deviceId);
            byType.set(spec.primaryAffinity, existing);
        }
        for (const [taskType, deviceIds] of byType) {
            if (deviceIds.length < this.config.minOrganSize)
                continue;
            // Check if organ already exists for this task type
            const existingOrgan = this.getOrganForType(taskType);
            if (existingOrgan) {
                // Add new members to existing organ
                for (const devId of deviceIds) {
                    if (!existingOrgan.members.has(devId)) {
                        existingOrgan.members.add(devId);
                        this.logEvent(existingOrgan, morphogenesis_1.OrganEvent.DEVICE_JOINED, devId);
                    }
                }
                continue;
            }
            // Form new organ
            const organ = this.formOrgan(taskType, deviceIds);
            formed.push(organ);
        }
        return formed;
    }
    /**
     * Form a new organ for a specific task type.
     */
    formOrgan(taskType, memberIds) {
        const id = randomBytes(16);
        const organ = {
            id,
            specialization: taskType,
            members: new Set(memberIds),
            formedAt: Date.now(),
            health: 1.0,
            tasksProcessed: 0,
            avgProcessingTimeMs: 0,
            morphogenConcentration: 1.0,
        };
        const hex = toHex(id);
        this.organs.set(hex, organ);
        this.logEvent(organ, morphogenesis_1.OrganEvent.FORMING);
        return organ;
    }
    /**
     * Record a task processed by an organ.
     * Updates health and processing time averages.
     */
    recordTaskProcessed(organId, processingTimeMs) {
        const organ = this.organs.get(organId);
        if (!organ)
            return;
        organ.tasksProcessed++;
        // EMA for processing time
        organ.avgProcessingTimeMs = organ.avgProcessingTimeMs * 0.9 + processingTimeMs * 0.1;
        // Health increases with activity
        organ.health = Math.min(1.0, organ.health + 0.05);
        if (organ.tasksProcessed >= this.config.minTasksForActive) {
            this.logEvent(organ, morphogenesis_1.OrganEvent.ACTIVE);
        }
    }
    /**
     * Add a device to an organ.
     * @returns true if successfully joined
     */
    joinOrgan(organId, deviceId) {
        const organ = this.organs.get(organId);
        if (!organ)
            return false;
        if (organ.members.has(deviceId))
            return true; // Already a member
        organ.members.add(deviceId);
        this.logEvent(organ, morphogenesis_1.OrganEvent.DEVICE_JOINED, deviceId);
        return true;
    }
    /**
     * Remove a device from an organ.
     */
    leaveOrgan(organId, deviceId) {
        const organ = this.organs.get(organId);
        if (!organ)
            return false;
        const removed = organ.members.delete(deviceId);
        if (removed) {
            this.logEvent(organ, morphogenesis_1.OrganEvent.DEVICE_LEFT, deviceId);
            // Dissolve if too few members
            if (organ.members.size < this.config.minOrganSize) {
                this.dissolveOrgan(organId);
            }
        }
        return removed;
    }
    /**
     * Dissolve an organ.
     */
    dissolveOrgan(organId) {
        const organ = this.organs.get(organId);
        if (!organ)
            return false;
        this.logEvent(organ, morphogenesis_1.OrganEvent.DISSOLVING);
        this.organs.delete(organId);
        return true;
    }
    /**
     * Merge two organs of the same specialization.
     * The larger organ absorbs the smaller one.
     */
    mergeOrgans(organId1, organId2) {
        const org1 = this.organs.get(organId1);
        const org2 = this.organs.get(organId2);
        if (!org1 || !org2)
            return null;
        if (org1.specialization !== org2.specialization)
            return null;
        // Larger absorbs smaller
        const [keeper, absorbed] = org1.members.size >= org2.members.size
            ? [org1, org2] : [org2, org1];
        for (const member of absorbed.members) {
            keeper.members.add(member);
        }
        keeper.tasksProcessed += absorbed.tasksProcessed;
        keeper.health = Math.max(keeper.health, absorbed.health);
        const absorbedId = toHex(absorbed.id);
        this.logEvent(keeper, morphogenesis_1.OrganEvent.MERGING);
        this.organs.delete(absorbedId);
        return keeper;
    }
    /**
     * Periodic health check. Decays health of inactive organs
     * and dissolves those below the threshold.
     */
    healthCheck() {
        const toDissolve = [];
        for (const [id, organ] of this.organs) {
            // Health decays over time without activity
            organ.health *= 0.95;
            organ.morphogenConcentration *= 0.95;
            // Dissolve if health too low
            if (organ.health < this.config.dissolutionThreshold) {
                toDissolve.push(id);
            }
            // Remove members who are no longer specialists
            for (const memberId of organ.members) {
                const affinity = this.affinityTracker.getAffinity(memberId);
                if (affinity && affinity.primaryAffinity !== organ.specialization) {
                    organ.members.delete(memberId);
                    this.logEvent(organ, morphogenesis_1.OrganEvent.DEVICE_LEFT, memberId);
                }
            }
            // Dissolve if too few members after cleanup
            if (organ.members.size < this.config.minOrganSize) {
                toDissolve.push(id);
            }
        }
        for (const id of new Set(toDissolve)) {
            this.dissolveOrgan(id);
        }
    }
    // ── Queries ──
    /** Get organ for a specific task type */
    getOrganForType(taskType) {
        for (const organ of this.organs.values()) {
            if (organ.specialization === taskType)
                return organ;
        }
        return undefined;
    }
    /** Get organ by ID */
    getOrgan(organId) {
        return this.organs.get(organId);
    }
    /** Get all active organs */
    getAllOrgans() {
        return [...this.organs.values()];
    }
    /** Check if a device is a member of any organ */
    getDeviceOrgan(deviceId) {
        for (const organ of this.organs.values()) {
            if (organ.members.has(deviceId))
                return organ;
        }
        return undefined;
    }
    /** Get recent event log */
    getEventLog() {
        return this.eventLog.slice(-50); // Last 50 events
    }
    /** Number of active organs */
    get organCount() {
        return this.organs.size;
    }
    // ── Internals ──
    logEvent(organ, event, deviceId) {
        this.eventLog.push({
            organId: toHex(organ.id),
            event,
            deviceId,
            taskType: organ.specialization,
            timestamp: Date.now(),
        });
        // Keep event log bounded
        if (this.eventLog.length > 200) {
            this.eventLog = this.eventLog.slice(-100);
        }
    }
}
exports.OrganManager = OrganManager;
//# sourceMappingURL=organ-manager.js.map
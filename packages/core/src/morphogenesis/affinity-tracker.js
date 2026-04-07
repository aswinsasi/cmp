"use strict";
/**
 * CMP v1.3 — Affinity Tracker
 * Tracks per-device task type affinity scores. After each task completion,
 * the affinity for that task type increases (EMA) while all other affinities
 * decay slightly. Devices that repeatedly execute the same task type become
 * "specialists" with high specialization scores.
 *
 * Affinity Algorithm:
 *   affinity[taskType] = (affinity[taskType] * 0.9) + (successScore * 0.1)
 *   for each otherType != taskType: affinity[otherType] *= 0.995
 *   specializationScore = max(affinities) - mean(affinities)
 *
 * @module morphogenesis/affinity-tracker
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AffinityTracker = void 0;
const task_1 = require("../types/task");
const DEFAULT_CONFIG = {
    minSpecializationScore: 0.6,
    affinityDecayRate: 0.05,
};
class AffinityTracker {
    /** deviceId hex → DeviceAffinity */
    affinities = new Map();
    config;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Record a task completion for a device.
     * Updates the device's affinity profile using EMA.
     *
     * @param deviceId - hex mesh ID
     * @param taskType - type of task completed
     * @param successScore - 0.0 (failed) to 1.0 (perfect) — typically 0.85 for success
     */
    recordTaskCompletion(deviceId, taskType, successScore) {
        const affinity = this.getOrCreate(deviceId);
        // Update affinity for completed task type (EMA)
        const current = affinity.affinities.get(taskType) ?? 0;
        affinity.affinities.set(taskType, current * 0.9 + successScore * 0.1);
        // Decay all other affinities slightly
        for (const [type, score] of affinity.affinities) {
            if (type !== taskType) {
                affinity.affinities.set(type, score * 0.995);
            }
        }
        // Recalculate specialization
        this.recalculateSpecialization(affinity);
        affinity.updatedAt = Date.now();
    }
    /**
     * Bulk-load affinities from MER history.
     * Replays task completions to build initial affinity profiles.
     */
    loadFromHistory(history) {
        for (const entry of history) {
            this.recordTaskCompletion(entry.deviceId, entry.taskType, entry.successScore);
        }
    }
    /**
     * Apply time-based decay to all affinities.
     * Called periodically (e.g. every hour).
     */
    applyDecay() {
        const decayRate = this.config.affinityDecayRate ?? 0.05;
        for (const affinity of this.affinities.values()) {
            for (const [type, score] of affinity.affinities) {
                affinity.affinities.set(type, score * (1 - decayRate));
            }
            this.recalculateSpecialization(affinity);
        }
    }
    /**
     * Get a device's affinity profile.
     */
    getAffinity(deviceId) {
        return this.affinities.get(deviceId);
    }
    /**
     * Get all devices with specialization above the threshold.
     */
    getSpecialists(minScore) {
        const threshold = minScore ?? this.config.minSpecializationScore ?? 0.6;
        return [...this.affinities.values()].filter(a => a.specializationScore >= threshold);
    }
    /**
     * Get all devices specialized in a specific task type.
     */
    getSpecialistsForType(taskType, minScore) {
        const threshold = minScore ?? this.config.minSpecializationScore ?? 0.6;
        return [...this.affinities.values()].filter(a => a.primaryAffinity === taskType && a.specializationScore >= threshold);
    }
    /**
     * Get all tracked affinities.
     */
    getAll() {
        return [...this.affinities.values()];
    }
    /** Number of tracked devices */
    get size() {
        return this.affinities.size;
    }
    /** Clear all affinities */
    clear() {
        this.affinities.clear();
    }
    // ── Internals ──
    getOrCreate(deviceId) {
        let affinity = this.affinities.get(deviceId);
        if (!affinity) {
            affinity = {
                deviceId,
                affinities: new Map(),
                primaryAffinity: task_1.TaskType.MAP_REDUCE,
                specializationScore: 0,
                updatedAt: Date.now(),
            };
            this.affinities.set(deviceId, affinity);
        }
        return affinity;
    }
    recalculateSpecialization(affinity) {
        if (affinity.affinities.size === 0) {
            affinity.specializationScore = 0;
            return;
        }
        // Total number of task types in CMP (INFERENCE=0..CUSTOM=4)
        const TOTAL_TASK_TYPES = 5;
        let maxScore = 0;
        let maxType = task_1.TaskType.MAP_REDUCE;
        let sum = 0;
        for (const [type, score] of affinity.affinities) {
            sum += score;
            if (score > maxScore) {
                maxScore = score;
                maxType = type;
            }
        }
        affinity.primaryAffinity = maxType;
        // Average across ALL task types (including untouched ones at 0)
        // This ensures a device doing only one type gets high specialization
        const avg = sum / TOTAL_TASK_TYPES;
        affinity.specializationScore = Math.max(0, Math.min(1, maxScore - avg));
    }
}
exports.AffinityTracker = AffinityTracker;
//# sourceMappingURL=affinity-tracker.js.map
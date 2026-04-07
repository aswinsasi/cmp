"use strict";
/**
 * CMP v1.3 — Morphogen Signaler
 * Emits and responds to chemical-gradient-inspired signals.
 * Specialized devices emit morphogen signals advertising their affinity.
 * Nearby devices with matching affinities respond, creating concentration
 * gradients that drive organ formation.
 *
 * Signal Lifecycle:
 *   1. Device with high specialization emits MORPHOGEN_SIGNAL
 *   2. Signal propagates through mesh, losing concentration per hop
 *   3. Devices receiving strong matching signals join or form organs
 *   4. Signals decay naturally over time
 *
 * @module morphogenesis/morphogen-signaler
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MorphogenSignaler = void 0;
const DEFAULT_CONFIG = {
    signalIntervalMs: 10000,
    morphogenDecayRate: 0.3,
    maxMorphogenTtl: 5,
    minSpecializationScore: 0.6,
};
class MorphogenSignaler {
    affinityTracker;
    config;
    /** Received signals: emitterId → latest signal */
    receivedSignals = new Map();
    /** Concentration per task type from all received signals */
    concentrationMap = new Map();
    /** Signal emission timer */
    signalTimer = null;
    /** Our device ID (hex) */
    deviceId;
    /** Callback for emitting signals to the mesh */
    emitFn = null;
    constructor(deviceId, affinityTracker, config) {
        this.deviceId = deviceId;
        this.affinityTracker = affinityTracker;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** Set callback for emitting signals to the transport layer */
    onEmit(fn) {
        this.emitFn = fn;
    }
    /** Start periodic signal emission */
    start() {
        const interval = this.config.signalIntervalMs ?? 10000;
        this.signalTimer = setInterval(() => this.emitSignal(), interval);
    }
    /** Stop signal emission */
    stop() {
        if (this.signalTimer) {
            clearInterval(this.signalTimer);
            this.signalTimer = null;
        }
    }
    /**
     * Emit a morphogen signal if this device is specialized enough.
     * Called periodically by the timer.
     */
    emitSignal() {
        const affinity = this.affinityTracker.getAffinity(this.deviceId);
        if (!affinity)
            return null;
        const minScore = this.config.minSpecializationScore ?? 0.6;
        if (affinity.specializationScore < minScore)
            return null;
        const signal = {
            emitterId: this.deviceId,
            taskType: affinity.primaryAffinity,
            concentration: affinity.specializationScore,
            organId: null, // Will be set by OrganManager if device is in an organ
            ttl: this.config.maxMorphogenTtl ?? 5,
            emittedAt: Date.now(),
        };
        if (this.emitFn) {
            this.emitFn(signal);
        }
        return signal;
    }
    /**
     * Receive a morphogen signal from another device.
     * Applies hop decay and updates concentration map.
     */
    receiveSignal(signal) {
        // Ignore own signals
        if (signal.emitterId === this.deviceId)
            return;
        // Ignore expired signals
        if (signal.ttl <= 0)
            return;
        // Apply hop decay
        const decayRate = this.config.morphogenDecayRate ?? 0.3;
        const decayedConcentration = signal.concentration * (1 - decayRate);
        // Store with decayed concentration
        const received = {
            ...signal,
            concentration: decayedConcentration,
            ttl: signal.ttl - 1,
        };
        this.receivedSignals.set(signal.emitterId, received);
        // Update concentration map
        this.updateConcentrationMap();
    }
    /**
     * Get the total morphogen concentration for a task type.
     * High concentration means many nearby specialists for this type.
     */
    getConcentration(taskType) {
        return this.concentrationMap.get(taskType) ?? 0;
    }
    /**
     * Get all task types with concentration above a threshold.
     */
    getStrongSignals(minConcentration = 0.5) {
        const results = [];
        for (const [taskType, concentration] of this.concentrationMap) {
            if (concentration >= minConcentration) {
                results.push({ taskType, concentration });
            }
        }
        return results.sort((a, b) => b.concentration - a.concentration);
    }
    /**
     * Get all received signals (for CLI display).
     */
    getReceivedSignals() {
        return [...this.receivedSignals.values()];
    }
    /**
     * Forward a signal (relay) with decremented TTL.
     * Used by CirculatoryRelay nodes to propagate signals.
     */
    forwardSignal(signal) {
        if (signal.ttl <= 1)
            return null; // Don't forward dying signals
        const decayRate = this.config.morphogenDecayRate ?? 0.3;
        const forwarded = {
            ...signal,
            concentration: signal.concentration * (1 - decayRate),
            ttl: signal.ttl - 1,
        };
        if (this.emitFn) {
            this.emitFn(forwarded);
        }
        return forwarded;
    }
    /**
     * Clean up expired signals (older than 2x signal interval).
     */
    cleanup() {
        const maxAge = (this.config.signalIntervalMs ?? 10000) * 2;
        const cutoff = Date.now() - maxAge;
        let removed = 0;
        for (const [id, signal] of this.receivedSignals) {
            if (signal.emittedAt < cutoff) {
                this.receivedSignals.delete(id);
                removed++;
            }
        }
        if (removed > 0) {
            this.updateConcentrationMap();
        }
        return removed;
    }
    // ── Internals ──
    updateConcentrationMap() {
        this.concentrationMap.clear();
        for (const signal of this.receivedSignals.values()) {
            const current = this.concentrationMap.get(signal.taskType) ?? 0;
            this.concentrationMap.set(signal.taskType, current + signal.concentration);
        }
    }
}
exports.MorphogenSignaler = MorphogenSignaler;
//# sourceMappingURL=morphogen-signaler.js.map
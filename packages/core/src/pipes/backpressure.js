"use strict";
/**
 * CMP v4.0 — Backpressure Controller
 *
 * Flow control between pipeline stages. Prevents fast producers
 * from overwhelming slow consumers.
 *
 * Algorithm:
 *   1. Each stage has a buffer with configurable capacity
 *   2. When buffer exceeds threshold → activate backpressure
 *   3. Upstream pauses until downstream drains
 *   4. Persistent backpressure (>30s) → request stage rebalance
 *
 * @module pipes/backpressure
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackpressureController = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('Backpressure');
// ─── Backpressure Controller ───
class BackpressureController {
    buffers = new Map();
    config;
    rebalanceCallback = null;
    checkTimer = null;
    constructor(config) {
        this.config = config;
    }
    /**
     * Initialize buffer tracking for a stage.
     */
    initStage(stageIndex, capacity) {
        const cap = capacity ?? this.config.defaultBufferCapacity;
        this.buffers.set(stageIndex, {
            stageIndex,
            currentSize: 0,
            capacity: cap,
            threshold: Math.floor(cap * this.config.backpressureThreshold),
            isActive: false,
            activeSince: null,
            totalPaused: 0,
            totalProcessed: 0,
        });
    }
    /**
     * Record an item entering a stage's buffer.
     * Returns true if the item should be processed, false if backpressure should pause.
     */
    onItemEnter(stageIndex) {
        const buf = this.buffers.get(stageIndex);
        if (!buf)
            return true;
        buf.currentSize++;
        if (buf.currentSize >= buf.threshold && !buf.isActive) {
            buf.isActive = true;
            buf.activeSince = Date.now();
            log.info(`Backpressure ACTIVE on stage ${stageIndex} (buffer: ${buf.currentSize}/${buf.capacity})`);
        }
        if (buf.isActive) {
            buf.totalPaused++;
            return false; // Signal upstream to slow down
        }
        return true;
    }
    /**
     * Record an item leaving a stage's buffer (processed).
     */
    onItemExit(stageIndex) {
        const buf = this.buffers.get(stageIndex);
        if (!buf)
            return;
        buf.currentSize = Math.max(0, buf.currentSize - 1);
        buf.totalProcessed++;
        // Deactivate backpressure when buffer drains below half threshold
        if (buf.isActive && buf.currentSize < buf.threshold / 2) {
            buf.isActive = false;
            buf.activeSince = null;
            log.info(`Backpressure RELEASED on stage ${stageIndex} (buffer: ${buf.currentSize}/${buf.capacity})`);
        }
    }
    /**
     * Check if backpressure is active for a stage.
     */
    isActive(stageIndex) {
        return this.buffers.get(stageIndex)?.isActive ?? false;
    }
    /**
     * Get buffer state for a stage.
     */
    getBufferState(stageIndex) {
        return this.buffers.get(stageIndex) ?? null;
    }
    /**
     * Get all buffer states.
     */
    getAllBufferStates() {
        return Array.from(this.buffers.values());
    }
    /**
     * Find the bottleneck stage (highest buffer occupancy).
     */
    findBottleneck() {
        let maxOccupancy = 0;
        let bottleneck = null;
        for (const [idx, buf] of this.buffers) {
            const occupancy = buf.currentSize / buf.capacity;
            if (occupancy > maxOccupancy) {
                maxOccupancy = occupancy;
                bottleneck = idx;
            }
        }
        return maxOccupancy > this.config.backpressureThreshold ? bottleneck : null;
    }
    /**
     * Set callback for rebalance requests.
     */
    onRebalanceNeeded(callback) {
        this.rebalanceCallback = callback;
    }
    /**
     * Start periodic check for persistent backpressure.
     */
    startMonitoring() {
        if (this.checkTimer)
            return;
        this.checkTimer = setInterval(() => this.checkPersistent(), 5000);
    }
    /**
     * Stop monitoring.
     */
    stopMonitoring() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }
    /**
     * Reset all buffer states.
     */
    reset() {
        this.buffers.clear();
        this.stopMonitoring();
    }
    // ─── Internal ───
    checkPersistent() {
        const now = Date.now();
        for (const buf of this.buffers.values()) {
            if (buf.isActive && buf.activeSince) {
                const duration = now - buf.activeSince;
                if (duration >= this.config.rebalanceTimeoutMs) {
                    log.warn(`Persistent backpressure on stage ${buf.stageIndex} (${(duration / 1000).toFixed(0)}s) — requesting rebalance`);
                    if (this.rebalanceCallback) {
                        this.rebalanceCallback(buf.stageIndex);
                    }
                }
            }
        }
    }
}
exports.BackpressureController = BackpressureController;
//# sourceMappingURL=backpressure.js.map
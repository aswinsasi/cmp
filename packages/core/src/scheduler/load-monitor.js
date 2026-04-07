"use strict";
/**
 * CMP v4.0 — Load Monitor
 *
 * Tracks real-time CPU, memory, and thermal state for this device
 * and all known peers. Broadcasts LOAD_REPORT (0xD0) periodically
 * so the scheduler has fresh data for device scoring.
 *
 * Data sources:
 *   - Local: os.cpus(), os.freemem(), or provided reader function
 *   - Remote: LOAD_REPORT messages from peers
 *
 * @module scheduler/load-monitor
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoadMonitor = exports.LOAD_REPORT_MSG = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('LoadMon');
// ─── Wire Protocol ───
exports.LOAD_REPORT_MSG = 0xD0;
// ─── Load Monitor ───
class LoadMonitor {
    deviceId;
    reader;
    reports = new Map();
    history = new Map();
    broadcastFn = null;
    broadcastTimer = null;
    broadcastIntervalMs;
    maxHistoryPerDevice;
    running = false;
    constructor(deviceId, reader, config = {}) {
        this.deviceId = deviceId;
        this.reader = reader;
        this.broadcastIntervalMs = config.broadcastIntervalMs ?? 5000;
        this.maxHistoryPerDevice = config.maxHistoryPerDevice ?? 60; // 5 min at 5s intervals
    }
    /**
     * Set the broadcast function for sending load reports to peers.
     */
    setTransport(broadcast) {
        this.broadcastFn = broadcast;
    }
    /**
     * Start periodic load monitoring and broadcasting.
     */
    start() {
        if (this.running)
            return;
        this.running = true;
        // Sample immediately
        this.sampleLocal();
        // Broadcast periodically
        this.broadcastTimer = setInterval(() => {
            this.sampleLocal();
            this.broadcastLoad();
        }, this.broadcastIntervalMs);
        log.info(`Load monitor started (interval: ${this.broadcastIntervalMs}ms)`);
    }
    /**
     * Stop monitoring.
     */
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.broadcastTimer) {
            clearInterval(this.broadcastTimer);
            this.broadcastTimer = null;
        }
        log.info('Load monitor stopped');
    }
    // ══════════════════════════════════════
    // Query API
    // ══════════════════════════════════════
    /**
     * Get the latest load report for a device.
     */
    getLoad(deviceId) {
        return this.reports.get(deviceId) ?? null;
    }
    /**
     * Get local device load.
     */
    getLocalLoad() {
        this.sampleLocal();
        return this.reports.get(this.deviceId);
    }
    /**
     * Get all known device loads.
     */
    getAllLoads() {
        return Array.from(this.reports.values());
    }
    /**
     * Get devices sorted by load (lightest first).
     */
    getLeastLoaded(limit) {
        const sorted = this.getAllLoads()
            .filter(r => Date.now() - r.timestamp < this.broadcastIntervalMs * 3) // Stale filter
            .sort((a, b) => a.cpuPercent - b.cpuPercent);
        return limit ? sorted.slice(0, limit) : sorted;
    }
    /**
     * Check if a device is overloaded (CPU > 85% or thermal throttled).
     */
    isOverloaded(deviceId) {
        const report = this.reports.get(deviceId);
        if (!report)
            return false;
        return report.cpuPercent > 85 || report.thermalState >= 2;
    }
    /**
     * Get load variance for a device (from history).
     * High variance = unpredictable performance → candidate for racing.
     */
    getLoadVariance(deviceId) {
        const samples = this.history.get(deviceId);
        if (!samples || samples.length < 3)
            return 0;
        const cpuValues = samples.map(s => s.cpuPercent);
        const mean = cpuValues.reduce((s, v) => s + v, 0) / cpuValues.length;
        const variance = cpuValues.reduce((s, v) => s + (v - mean) ** 2, 0) / cpuValues.length;
        return Math.sqrt(variance);
    }
    /**
     * Get average CPU load for a device over recent history.
     */
    getAverageLoad(deviceId) {
        const samples = this.history.get(deviceId);
        if (!samples || samples.length === 0) {
            const report = this.reports.get(deviceId);
            return report?.cpuPercent ?? 50; // Default to 50% if unknown
        }
        return samples.reduce((s, v) => s + v.cpuPercent, 0) / samples.length;
    }
    /**
     * Get number of tracked devices.
     */
    get deviceCount() {
        return this.reports.size;
    }
    // ══════════════════════════════════════
    // Message Handling
    // ══════════════════════════════════════
    /**
     * Handle an incoming LOAD_REPORT from a peer.
     */
    handleLoadReport(wire) {
        if (wire.deviceId === this.deviceId)
            return; // Ignore own reports
        const report = {
            deviceId: wire.deviceId,
            cpuPercent: wire.cpu,
            memoryUsedPercent: wire.mem,
            memoryAvailableMb: wire.memMb,
            thermalState: wire.thermal,
            activeTasks: wire.tasks,
            timestamp: wire.ts,
        };
        this.reports.set(wire.deviceId, report);
        this.addSample(wire.deviceId, report);
    }
    /**
     * Remove a device from tracking (peer left).
     */
    removeDevice(deviceId) {
        this.reports.delete(deviceId);
        this.history.delete(deviceId);
    }
    // ══════════════════════════════════════
    // Internals
    // ══════════════════════════════════════
    sampleLocal() {
        const state = this.reader();
        const report = {
            deviceId: this.deviceId,
            cpuPercent: state.cpuPercent,
            memoryUsedPercent: state.memoryUsedPercent,
            memoryAvailableMb: state.memoryAvailableMb,
            thermalState: state.thermalState,
            activeTasks: state.activeTasks,
            timestamp: Date.now(),
        };
        this.reports.set(this.deviceId, report);
        this.addSample(this.deviceId, report);
    }
    broadcastLoad() {
        if (!this.broadcastFn)
            return;
        const report = this.reports.get(this.deviceId);
        if (!report)
            return;
        const wire = {
            deviceId: report.deviceId,
            cpu: report.cpuPercent,
            mem: report.memoryUsedPercent,
            memMb: report.memoryAvailableMb,
            thermal: report.thermalState,
            tasks: report.activeTasks,
            ts: report.timestamp,
        };
        this.broadcastFn(exports.LOAD_REPORT_MSG, wire);
    }
    addSample(deviceId, report) {
        let samples = this.history.get(deviceId);
        if (!samples) {
            samples = [];
            this.history.set(deviceId, samples);
        }
        samples.push({
            cpuPercent: report.cpuPercent,
            memoryUsedPercent: report.memoryUsedPercent,
            timestamp: report.timestamp,
        });
        // Trim to max history
        if (samples.length > this.maxHistoryPerDevice) {
            samples.splice(0, samples.length - this.maxHistoryPerDevice);
        }
    }
}
exports.LoadMonitor = LoadMonitor;
//# sourceMappingURL=load-monitor.js.map
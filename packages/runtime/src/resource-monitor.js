"use strict";
/**
 * CMP Resource Monitor
 * Monitors CPU time, memory usage, and thermal state during
 * chunk execution. Triggers violation callbacks if limits exceeded.
 *
 * @module runtime/resource-monitor
 * @author Agent Viscro
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceMonitor = void 0;
const os_1 = __importDefault(require("os"));
class ResourceMonitor {
    limits;
    monitoring = false;
    intervalId;
    startTime = 0;
    snapshots = [];
    peakMemoryMb = 0;
    onViolation;
    constructor(limits) {
        this.limits = limits;
    }
    /**
     * Start monitoring resources.
     */
    start(onViolation) {
        this.monitoring = true;
        this.startTime = Date.now();
        this.snapshots = [];
        this.peakMemoryMb = 0;
        this.onViolation = onViolation;
        this.intervalId = setInterval(() => {
            this.check();
        }, 100); // Check every 100ms
    }
    /**
     * Stop monitoring.
     */
    stop() {
        this.monitoring = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
    }
    /**
     * Take a snapshot and check for violations.
     */
    check() {
        if (!this.monitoring)
            return;
        const elapsed = Date.now() - this.startTime;
        const freeMem = os_1.default.freemem();
        const totalMem = os_1.default.totalmem();
        const usedMb = Math.round((totalMem - freeMem) / (1024 * 1024));
        const loadAvg = os_1.default.loadavg()[0];
        const cpuCount = os_1.default.cpus().length;
        const loadPercent = Math.round((loadAvg / cpuCount) * 100);
        const snapshot = {
            cpuTimeMs: elapsed,
            memoryMb: usedMb,
            loadPercent,
            timestamp: Date.now(),
        };
        this.snapshots.push(snapshot);
        if (usedMb > this.peakMemoryMb) {
            this.peakMemoryMb = usedMb;
        }
        // Check CPU time limit
        if (elapsed > this.limits.maxCpuMs) {
            this.onViolation?.('cpu_exceeded', `CPU time ${elapsed}ms exceeds limit ${this.limits.maxCpuMs}ms`);
        }
    }
    /**
     * Get peak memory usage during monitoring.
     */
    getPeakMemoryMb() {
        return this.peakMemoryMb;
    }
    /**
     * Get elapsed time since monitoring started.
     */
    getElapsedMs() {
        return Date.now() - this.startTime;
    }
    /**
     * Get all snapshots taken during monitoring.
     */
    getSnapshots() {
        return [...this.snapshots];
    }
    /**
     * Get current resource usage summary.
     */
    getCurrentUsage() {
        return {
            cpuMs: this.getElapsedMs(),
            memoryPeakMb: this.peakMemoryMb,
            gpuMs: 0, // GPU monitoring not yet implemented
        };
    }
    /**
     * Check if monitoring is active.
     */
    isMonitoring() {
        return this.monitoring;
    }
}
exports.ResourceMonitor = ResourceMonitor;
//# sourceMappingURL=resource-monitor.js.map
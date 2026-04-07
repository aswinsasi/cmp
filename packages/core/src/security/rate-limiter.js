"use strict";
/**
 * CMP v4.0 — Rate Limiter
 *
 * Per-requester rate limiting using a sliding window counter.
 * Prevents abuse by capping the number of tasks a device can
 * submit per time window.
 *
 * Algorithm: Sliding window counter
 *   - Each requester gets a window (default: 60 seconds)
 *   - Maximum N requests per window (default: 30)
 *   - Requests older than the window are pruned
 *
 * @module security/rate-limiter
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = exports.DEFAULT_RATE_LIMIT_CONFIG = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('RateLimit');
exports.DEFAULT_RATE_LIMIT_CONFIG = {
    maxRequestsPerWindow: 30,
    windowMs: 60000, // 1 minute
    cleanupIntervalMs: 30000,
};
// ─── Rate Limiter ───
class RateLimiter {
    config;
    windows = new Map(); // deviceId → timestamps
    cleanupTimer = null;
    // Stats
    stats = {
        totalChecks: 0,
        totalAllowed: 0,
        totalDenied: 0,
        deniedByDevice: new Map(),
    };
    constructor(config = {}) {
        this.config = { ...exports.DEFAULT_RATE_LIMIT_CONFIG, ...config };
    }
    /**
     * Start periodic cleanup of stale windows.
     */
    start() {
        if (this.cleanupTimer)
            return;
        this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    }
    /**
     * Stop the cleanup timer.
     */
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Check if a request from a device is allowed.
     */
    check(deviceId) {
        this.stats.totalChecks++;
        const now = Date.now();
        const windowStart = now - this.config.windowMs;
        // Get or create window
        let timestamps = this.windows.get(deviceId);
        if (!timestamps) {
            timestamps = [];
            this.windows.set(deviceId, timestamps);
        }
        // Prune old entries
        while (timestamps.length > 0 && timestamps[0] < windowStart) {
            timestamps.shift();
        }
        // Check limit
        if (timestamps.length >= this.config.maxRequestsPerWindow) {
            this.stats.totalDenied++;
            const existing = this.stats.deniedByDevice.get(deviceId) || 0;
            this.stats.deniedByDevice.set(deviceId, existing + 1);
            const oldestInWindow = timestamps[0];
            const resetInMs = oldestInWindow + this.config.windowMs - now;
            return {
                allowed: false,
                remaining: 0,
                resetInMs: Math.max(0, resetInMs),
                reason: `Rate limit exceeded: ${timestamps.length}/${this.config.maxRequestsPerWindow} per ${this.config.windowMs}ms`,
            };
        }
        // Allow and record
        timestamps.push(now);
        this.stats.totalAllowed++;
        return {
            allowed: true,
            remaining: this.config.maxRequestsPerWindow - timestamps.length,
            resetInMs: timestamps.length > 0 ? timestamps[0] + this.config.windowMs - now : this.config.windowMs,
            reason: 'OK',
        };
    }
    /**
     * Record a request (without checking — for tracking purposes).
     */
    record(deviceId) {
        let timestamps = this.windows.get(deviceId);
        if (!timestamps) {
            timestamps = [];
            this.windows.set(deviceId, timestamps);
        }
        timestamps.push(Date.now());
    }
    /**
     * Get remaining requests for a device.
     */
    remaining(deviceId) {
        const now = Date.now();
        const windowStart = now - this.config.windowMs;
        const timestamps = this.windows.get(deviceId);
        if (!timestamps)
            return this.config.maxRequestsPerWindow;
        const active = timestamps.filter(t => t >= windowStart);
        return Math.max(0, this.config.maxRequestsPerWindow - active.length);
    }
    /**
     * Reset rate limit for a device.
     */
    reset(deviceId) {
        this.windows.delete(deviceId);
    }
    /**
     * Reset all rate limits.
     */
    resetAll() {
        this.windows.clear();
    }
    /**
     * Get stats.
     */
    getStats() {
        const topDenied = Array.from(this.stats.deniedByDevice.entries())
            .map(([deviceId, count]) => ({ deviceId, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        return {
            totalChecks: this.stats.totalChecks,
            totalAllowed: this.stats.totalAllowed,
            totalDenied: this.stats.totalDenied,
            trackedDevices: this.windows.size,
            topDenied,
        };
    }
    // ─── Internal ───
    cleanup() {
        const windowStart = Date.now() - this.config.windowMs;
        for (const [deviceId, timestamps] of this.windows) {
            const active = timestamps.filter(t => t >= windowStart);
            if (active.length === 0) {
                this.windows.delete(deviceId);
            }
            else {
                this.windows.set(deviceId, active);
            }
        }
    }
}
exports.RateLimiter = RateLimiter;
//# sourceMappingURL=rate-limiter.js.map
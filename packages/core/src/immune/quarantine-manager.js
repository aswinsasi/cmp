"use strict";
/**
 * CMP v1.3 — Quarantine Manager
 * Isolates suspicious devices from task assignment.
 * Three levels: WATCH (monitored), RESTRICTED (excluded from tasks),
 * EXPELLED (disconnected).
 *
 * Quarantines are time-limited — devices can rehabilitate.
 *
 * @module immune/quarantine-manager
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuarantineManager = void 0;
const immune_1 = require("../types/immune");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
const DEFAULT_CONFIG = {
    minIncidentsForAntibody: 3,
    antibodyTtlMs: 7 * 24 * 3600 * 1000,
    mediumQuarantineDurationMs: 3600 * 1000,
    highQuarantineDurationMs: 24 * 3600 * 1000,
    maxFalsePositives: 5,
    enablePollinatedImmunity: true,
    minShareConfidence: 0.8,
};
class QuarantineManager {
    /** deviceId hex → QuarantineEntry */
    quarantines = new Map();
    config;
    cleanupTimer = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** Start periodic cleanup of expired quarantines */
    start() {
        this.cleanupTimer = setInterval(() => this.purgeExpired(), 60000);
    }
    /** Stop cleanup timer */
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Quarantine a device based on threat severity.
     * Severity mapping:
     *   LOW → WATCH
     *   MEDIUM → RESTRICTED (1 hour)
     *   HIGH → RESTRICTED (24 hours)
     *   CRITICAL → EXPELLED (24 hours)
     */
    quarantine(deviceId, severity, antibodyId) {
        const now = Date.now();
        const hex = toHex(deviceId);
        let level;
        let durationMs;
        switch (severity) {
            case immune_1.ThreatSeverity.LOW:
                level = immune_1.QuarantineLevel.WATCH;
                durationMs = this.config.mediumQuarantineDurationMs / 2;
                break;
            case immune_1.ThreatSeverity.MEDIUM:
                level = immune_1.QuarantineLevel.RESTRICTED;
                durationMs = this.config.mediumQuarantineDurationMs;
                break;
            case immune_1.ThreatSeverity.HIGH:
                level = immune_1.QuarantineLevel.RESTRICTED;
                durationMs = this.config.highQuarantineDurationMs;
                break;
            case immune_1.ThreatSeverity.CRITICAL:
                level = immune_1.QuarantineLevel.EXPELLED;
                durationMs = this.config.highQuarantineDurationMs;
                break;
        }
        // Escalate if already quarantined
        const existing = this.quarantines.get(hex);
        if (existing) {
            if (levelRank(level) <= levelRank(existing.level)) {
                // Escalate: upgrade level and extend duration
                level = escalate(existing.level);
                durationMs = Math.max(durationMs, existing.expiresAt - now + durationMs);
            }
        }
        const entry = {
            deviceId,
            level,
            triggeredBy: antibodyId,
            startedAt: now,
            expiresAt: now + durationMs,
            appealable: level !== immune_1.QuarantineLevel.EXPELLED,
        };
        this.quarantines.set(hex, entry);
        return entry;
    }
    /**
     * Check if a device is quarantined.
     * Returns the quarantine entry or null.
     */
    getQuarantine(deviceId) {
        const hex = toHex(deviceId);
        const entry = this.quarantines.get(hex);
        if (!entry)
            return null;
        // Check expiry
        if (Date.now() > entry.expiresAt) {
            this.quarantines.delete(hex);
            return null;
        }
        return entry;
    }
    /**
     * Check if a device is excluded from task assignment.
     * RESTRICTED and EXPELLED devices are excluded.
     */
    isExcluded(deviceId) {
        const entry = this.getQuarantine(deviceId);
        if (!entry)
            return false;
        return entry.level === immune_1.QuarantineLevel.RESTRICTED ||
            entry.level === immune_1.QuarantineLevel.EXPELLED;
    }
    /**
     * Check if a device should be disconnected.
     */
    isExpelled(deviceId) {
        const entry = this.getQuarantine(deviceId);
        return entry?.level === immune_1.QuarantineLevel.EXPELLED;
    }
    /**
     * Release a device from quarantine (e.g. on appeal or admin override).
     */
    release(deviceId) {
        const hex = toHex(deviceId);
        return this.quarantines.delete(hex);
    }
    /**
     * Purge expired quarantines.
     * @returns number of entries purged
     */
    purgeExpired() {
        const now = Date.now();
        let purged = 0;
        for (const [hex, entry] of this.quarantines) {
            if (now > entry.expiresAt) {
                this.quarantines.delete(hex);
                purged++;
            }
        }
        return purged;
    }
    /**
     * Load quarantine entries (from persistence).
     */
    loadEntries(entries) {
        const now = Date.now();
        for (const entry of entries) {
            if (now < entry.expiresAt) {
                this.quarantines.set(toHex(entry.deviceId), entry);
            }
        }
    }
    /** Get all active quarantine entries */
    getAll() {
        return [...this.quarantines.values()];
    }
    /** Number of quarantined devices */
    get size() {
        return this.quarantines.size;
    }
}
exports.QuarantineManager = QuarantineManager;
// ── Helpers ──
function levelRank(level) {
    switch (level) {
        case immune_1.QuarantineLevel.WATCH: return 1;
        case immune_1.QuarantineLevel.RESTRICTED: return 2;
        case immune_1.QuarantineLevel.EXPELLED: return 3;
    }
}
function escalate(level) {
    switch (level) {
        case immune_1.QuarantineLevel.WATCH: return immune_1.QuarantineLevel.RESTRICTED;
        case immune_1.QuarantineLevel.RESTRICTED: return immune_1.QuarantineLevel.EXPELLED;
        case immune_1.QuarantineLevel.EXPELLED: return immune_1.QuarantineLevel.EXPELLED;
    }
}
//# sourceMappingURL=quarantine-manager.js.map
"use strict";
/**
 * CMP v1.4 — Lifeform DNS
 * Name resolution service for the Lifeform mesh.
 * Maps human-readable Lifeform names to host device mesh IDs.
 *
 * Features:
 *   - Name → host resolution
 *   - Redirect support (for fusion: old names → composite name)
 *   - TTL-based cache with auto-expiry
 *   - Conflict detection (duplicate names)
 *   - Wildcard queries
 *
 * @module lifeform/dns
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifeformDNS = void 0;
const DEFAULT_CONFIG = {
    defaultTtlMs: 60000,
    maxRedirects: 5,
    cleanupIntervalMs: 30000,
};
class LifeformDNS {
    /** name → DNSRecord */
    records = new Map();
    config;
    cleanupTimer = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** Start periodic cache cleanup */
    start() {
        this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    }
    /** Stop cleanup timer */
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Register a Lifeform name.
     * @returns true if registered, false if name already taken
     */
    register(name, lifeformId, hostId, replicaHostIds = []) {
        const existing = this.records.get(name);
        if (existing && existing.lifeformId !== lifeformId) {
            return false; // Name taken by different Lifeform
        }
        this.records.set(name, {
            name,
            lifeformId,
            hostId,
            replicaHostIds,
            redirect: null,
            version: existing ? existing.version + 1 : 1,
            updatedAt: Date.now(),
            ttlMs: this.config.defaultTtlMs,
        });
        return true;
    }
    /**
     * Update a record's host (after migration).
     */
    updateHost(name, newHostId) {
        const record = this.records.get(name);
        if (!record)
            return false;
        record.hostId = newHostId;
        record.version++;
        record.updatedAt = Date.now();
        return true;
    }
    /**
     * Update replica hosts.
     */
    updateReplicas(name, replicaHostIds) {
        const record = this.records.get(name);
        if (!record)
            return false;
        record.replicaHostIds = replicaHostIds;
        record.version++;
        record.updatedAt = Date.now();
        return true;
    }
    /**
     * Set a redirect (for fusion: old name → composite name).
     */
    setRedirect(fromName, toName) {
        const record = this.records.get(fromName);
        if (!record)
            return false;
        record.redirect = toName;
        record.version++;
        record.updatedAt = Date.now();
        return true;
    }
    /**
     * Clear a redirect (for fission: restore original name).
     */
    clearRedirect(name) {
        const record = this.records.get(name);
        if (!record)
            return false;
        if (!record.redirect)
            return false;
        record.redirect = null;
        record.version++;
        record.updatedAt = Date.now();
        return true;
    }
    /**
     * Resolve a name to its DNS record.
     * Follows redirects (up to maxRedirects).
     */
    resolve(name) {
        let current = name;
        let redirectCount = 0;
        for (let i = 0; i <= this.config.maxRedirects; i++) {
            const record = this.records.get(current);
            if (!record) {
                return { record: null, redirectCount, fromCache: false };
            }
            if (!record.redirect) {
                return { record, redirectCount, fromCache: true };
            }
            // Follow redirect
            current = record.redirect;
            redirectCount++;
        }
        // Too many redirects
        return { record: null, redirectCount, fromCache: false };
    }
    /**
     * Resolve a name to just the host ID.
     */
    resolveHost(name) {
        const result = this.resolve(name);
        return result.record?.hostId ?? null;
    }
    /**
     * Unregister a name (Lifeform death).
     */
    unregister(name) {
        return this.records.delete(name);
    }
    /**
     * Query records matching a pattern.
     * Supports '*' wildcard at end (e.g., "sensor-*").
     */
    query(pattern) {
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            return [...this.records.values()].filter(r => r.name.startsWith(prefix));
        }
        const record = this.records.get(pattern);
        return record ? [record] : [];
    }
    /**
     * Get all records.
     */
    getAll() {
        return [...this.records.values()];
    }
    /**
     * Check if a name is available.
     */
    isAvailable(name) {
        return !this.records.has(name);
    }
    /**
     * Clean up expired records (records not updated within 2x TTL).
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [name, record] of this.records) {
            if (now - record.updatedAt > record.ttlMs * 2) {
                this.records.delete(name);
                cleaned++;
            }
        }
        return cleaned;
    }
    /** Number of registered names */
    get size() {
        return this.records.size;
    }
}
exports.LifeformDNS = LifeformDNS;
//# sourceMappingURL=dns.js.map
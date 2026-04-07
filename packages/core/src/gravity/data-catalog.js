"use strict";
/**
 * CMP v4.0 — Data Catalog
 *
 * Global index of data locations across the mesh.
 * Tracks which devices hold which data shards, enabling the
 * Gravity Planner to decide whether to move code or data.
 *
 * Built on top of Holographic Memory's shard model:
 *   - Every write records: key → list of devices holding shards
 *   - Gossip-based catalog sync between devices
 *   - Bloom filter for fast "does this device have data X?" checks
 *
 * @module gravity/data-catalog
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataCatalog = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('DataCatalog');
// ─── Bloom Filter (simple) ───
class SimpleBloomFilter {
    bits;
    hashCount;
    constructor(size = 1024, hashCount = 3) {
        this.bits = new Uint8Array(size);
        this.hashCount = hashCount;
    }
    add(key) {
        for (let i = 0; i < this.hashCount; i++) {
            const idx = this.hash(key, i) % (this.bits.length * 8);
            this.bits[Math.floor(idx / 8)] |= (1 << (idx % 8));
        }
    }
    mightContain(key) {
        for (let i = 0; i < this.hashCount; i++) {
            const idx = this.hash(key, i) % (this.bits.length * 8);
            if ((this.bits[Math.floor(idx / 8)] & (1 << (idx % 8))) === 0)
                return false;
        }
        return true;
    }
    clear() {
        this.bits.fill(0);
    }
    hash(key, seed) {
        let h = seed * 0x9e3779b9;
        for (let i = 0; i < key.length; i++) {
            h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
        }
        return h;
    }
}
// ─── Data Catalog ───
class DataCatalog {
    entries = new Map();
    deviceIndex = new Map(); // deviceId → set of data keys
    bloom = new SimpleBloomFilter(2048, 3);
    localDeviceId;
    broadcastFn = null;
    gossipIntervalMs;
    gossipTimer = null;
    constructor(localDeviceId, config = {}) {
        this.localDeviceId = localDeviceId;
        this.gossipIntervalMs = config.gossipIntervalMs ?? 15000;
    }
    /**
     * Set transport for gossip broadcasts.
     */
    setTransport(broadcast) {
        this.broadcastFn = broadcast;
    }
    /**
     * Start gossip timer.
     */
    start() {
        if (this.gossipTimer)
            return;
        this.gossipTimer = setInterval(() => this.broadcastGossip(), this.gossipIntervalMs);
    }
    /**
     * Stop gossip timer.
     */
    stop() {
        if (this.gossipTimer) {
            clearInterval(this.gossipTimer);
            this.gossipTimer = null;
        }
    }
    // ══════════════════════════════════════
    // Registration
    // ══════════════════════════════════════
    /**
     * Register that a device holds data for a key.
     */
    registerShard(key, deviceId, sizeBytes, totalSizeBytes) {
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { key, totalSizeBytes, shards: new Map(), updatedAt: Date.now() };
            this.entries.set(key, entry);
        }
        entry.totalSizeBytes = totalSizeBytes;
        entry.shards.set(deviceId, {
            sizeBytes,
            fraction: totalSizeBytes > 0 ? sizeBytes / totalSizeBytes : 0,
            verifiedAt: Date.now(),
        });
        entry.updatedAt = Date.now();
        // Update device index
        let keys = this.deviceIndex.get(deviceId);
        if (!keys) {
            keys = new Set();
            this.deviceIndex.set(deviceId, keys);
        }
        keys.add(key);
        // Update bloom filter
        this.bloom.add(`${deviceId}:${key}`);
    }
    /**
     * Remove a shard registration.
     */
    removeShard(key, deviceId) {
        const entry = this.entries.get(key);
        if (!entry)
            return;
        entry.shards.delete(deviceId);
        entry.updatedAt = Date.now();
        if (entry.shards.size === 0) {
            this.entries.delete(key);
        }
        const keys = this.deviceIndex.get(deviceId);
        if (keys) {
            keys.delete(key);
            if (keys.size === 0)
                this.deviceIndex.delete(deviceId);
        }
    }
    /**
     * Remove all shards for a device (device left mesh).
     */
    removeDevice(deviceId) {
        const keys = this.deviceIndex.get(deviceId);
        if (!keys)
            return;
        for (const key of keys) {
            const entry = this.entries.get(key);
            if (entry) {
                entry.shards.delete(deviceId);
                if (entry.shards.size === 0)
                    this.entries.delete(key);
            }
        }
        this.deviceIndex.delete(deviceId);
    }
    // ══════════════════════════════════════
    // Query
    // ══════════════════════════════════════
    /**
     * Quick bloom filter check: might this device have this data?
     */
    mightHaveData(deviceId, key) {
        return this.bloom.mightContain(`${deviceId}:${key}`);
    }
    /**
     * Get detailed location info for a data key.
     */
    locate(key) {
        const entry = this.entries.get(key);
        if (!entry)
            return null;
        const devices = Array.from(entry.shards.entries())
            .map(([deviceId, shard]) => ({
            deviceId,
            sizeBytes: shard.sizeBytes,
            fraction: shard.fraction,
        }))
            .sort((a, b) => b.fraction - a.fraction);
        const primary = devices.length > 0 ? devices[0] : null;
        return {
            key,
            totalSizeBytes: entry.totalSizeBytes,
            devices,
            primaryDevice: primary?.deviceId ?? null,
            primaryFraction: primary?.fraction ?? 0,
            isConcentrated: (primary?.fraction ?? 0) > 0.6,
            isDistributed: devices.length > 1 && devices.every(d => d.fraction < 0.5),
        };
    }
    /**
     * Get all data keys held by a device.
     */
    getDeviceData(deviceId) {
        return Array.from(this.deviceIndex.get(deviceId) ?? []);
    }
    /**
     * Get all tracked data keys.
     */
    getAllKeys() {
        return Array.from(this.entries.keys());
    }
    /**
     * Get entry count.
     */
    get size() {
        return this.entries.size;
    }
    /**
     * Get total bytes tracked across all entries.
     */
    get totalBytes() {
        let total = 0;
        for (const entry of this.entries.values()) {
            total += entry.totalSizeBytes;
        }
        return total;
    }
    // ══════════════════════════════════════
    // Gossip
    // ══════════════════════════════════════
    /**
     * Handle incoming gossip from a peer.
     */
    handleGossip(wire) {
        if (wire.senderId === this.localDeviceId)
            return;
        for (const entry of wire.entries) {
            // Only accept if newer than what we have
            const existing = this.entries.get(entry.key);
            if (existing && entry.updatedAt <= existing.updatedAt)
                continue;
            for (const shard of entry.shards) {
                this.registerShard(entry.key, shard.deviceId, shard.sizeBytes, entry.totalSize);
            }
        }
    }
    /**
     * Broadcast our catalog state to peers.
     */
    broadcastGossip() {
        if (!this.broadcastFn)
            return;
        // Only gossip entries where we hold shards
        const myEntries = [];
        for (const [key, entry] of this.entries) {
            if (entry.shards.has(this.localDeviceId)) {
                myEntries.push({
                    key,
                    totalSize: entry.totalSizeBytes,
                    shards: Array.from(entry.shards.entries()).map(([did, si]) => ({
                        deviceId: did,
                        sizeBytes: si.sizeBytes,
                        fraction: si.fraction,
                    })),
                    updatedAt: entry.updatedAt,
                });
            }
        }
        if (myEntries.length > 0) {
            const wire = {
                senderId: this.localDeviceId,
                entries: myEntries,
                timestamp: Date.now(),
            };
            this.broadcastFn(0xFC, wire); // Using 0xFC for catalog gossip
        }
    }
    /**
     * Clear all catalog data.
     */
    clear() {
        this.entries.clear();
        this.deviceIndex.clear();
        this.bloom.clear();
    }
}
exports.DataCatalog = DataCatalog;
//# sourceMappingURL=data-catalog.js.map
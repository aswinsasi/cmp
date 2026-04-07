"use strict";
/**
 * CMP v3.0 — Mesh Memory (Holographic State - Layer 15)
 *
 * Distributed shared memory across mesh devices using erasure coding.
 * Any k-of-n devices can reconstruct any piece of data.
 * The mesh collectively acts as one memory space.
 *
 * Architecture:
 *   write("model_output", data)
 *     → Reed-Solomon encode into n shards
 *     → Distribute shards to n devices via transport
 *     → Each device stores shard locally
 *
 *   read("model_output")
 *     → Query k nearest shard holders
 *     → Reconstruct from any k shards
 *     → Return full data
 *
 * Shards can optionally be backed by Lifeforms (getting migration,
 * replication, DNS, and CCU economy for free).
 *
 * @module holographic/mesh-memory
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeshMemory = void 0;
const erasure_1 = require("./erasure");
const holographic_1 = require("../types/holographic");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ═══════════════════════════════════════
class MeshMemory {
    config;
    transport;
    /** Local shard storage: key:shardIndex → shard */
    localShards = new Map();
    /** Key metadata: key → meta */
    keyMeta = new Map();
    /** Total bytes stored locally */
    localBytes = 0;
    constructor(transport, config) {
        this.config = { ...holographic_1.DEFAULT_MESH_MEMORY_CONFIG, ...config };
        this.transport = transport;
    }
    // ═══════════════════════════════════════
    // Write
    // ═══════════════════════════════════════
    /**
     * Write data to mesh memory (erasure-coded across devices).
     * Returns the number of shards successfully distributed.
     */
    async write(key, data, options) {
        if (data.length === 0)
            throw new Error('Cannot write empty data');
        // Calculate shard counts
        let k, m;
        if (options?.requiredShards && options?.totalShards) {
            k = options.requiredShards;
            m = options.totalShards - k;
        }
        else {
            const counts = (0, erasure_1.calculateShardCounts)(data.length, this.config.maxShardSizeBytes, this.config.defaultRedundancy);
            k = counts.k;
            m = counts.m;
        }
        const n = k + m;
        const ttlMs = options?.ttlMs ?? this.config.defaultTtlMs;
        const now = Date.now();
        // Erasure encode
        const shards = (0, erasure_1.rsEncode)(data, k, m);
        // Build shard descriptors
        const descriptors = shards.map((shardData, index) => ({
            key,
            shardIndex: index,
            totalShards: n,
            requiredShards: k,
            data: shardData,
            checksum: (0, erasure_1.simpleHash)(shardData),
            originalSize: data.length,
            writtenAt: now,
            ttlMs,
        }));
        // Select target devices for each shard
        const peers = this.transport.getPeers();
        const localId = this.transport.getLocalDeviceId();
        const allDevices = [localId, ...peers.map(p => p.deviceId)];
        // Spread shards across devices (round-robin with capacity check)
        const shardLocations = new Map();
        let distributed = 0;
        for (let i = 0; i < n; i++) {
            const targetIdx = i % allDevices.length;
            const targetDevice = allDevices[targetIdx];
            if (targetDevice === localId) {
                // Store locally
                this.storeLocalShard(descriptors[i]);
                shardLocations.set(i, localId);
                distributed++;
            }
            else {
                // Send to peer
                const success = await this.transport.sendShard(targetDevice, descriptors[i]);
                if (success) {
                    shardLocations.set(i, targetDevice);
                    distributed++;
                }
                else {
                    // Fallback: store locally if peer rejected
                    this.storeLocalShard(descriptors[i]);
                    shardLocations.set(i, localId);
                    distributed++;
                }
            }
        }
        // Record metadata
        this.keyMeta.set(key, {
            key,
            originalSize: data.length,
            k,
            n,
            shardSize: shards[0].length,
            writtenAt: now,
            ttlMs,
            shardLocations,
        });
        return distributed;
    }
    // ═══════════════════════════════════════
    // Read
    // ═══════════════════════════════════════
    /**
     * Read data from mesh memory (reconstruct from any k shards).
     */
    async read(key) {
        const meta = this.keyMeta.get(key);
        if (!meta)
            throw new Error(`Key not found: ${key}`);
        // Check TTL
        if (meta.ttlMs > 0 && Date.now() > meta.writtenAt + meta.ttlMs) {
            this.deleteKey(key);
            throw new Error(`Key expired: ${key}`);
        }
        const startTime = Date.now();
        // Collect k shards
        const collected = [];
        // Try local shards first (fastest)
        for (const [shardIndex, deviceId] of meta.shardLocations) {
            if (deviceId === this.transport.getLocalDeviceId()) {
                const local = this.getLocalShard(key, shardIndex);
                if (local) {
                    collected.push({ index: shardIndex, data: local.descriptor.data });
                    if (collected.length >= meta.k)
                        break;
                }
            }
        }
        // If still need more, request from peers
        if (collected.length < meta.k) {
            const collectedIndices = new Set(collected.map(c => c.index));
            for (const [shardIndex, deviceId] of meta.shardLocations) {
                if (collectedIndices.has(shardIndex))
                    continue;
                if (deviceId === this.transport.getLocalDeviceId())
                    continue;
                const shard = await this.transport.requestShard(deviceId, key, shardIndex);
                if (shard && (0, erasure_1.verifyShard)(shard.data, shard.checksum)) {
                    collected.push({ index: shardIndex, data: shard.data });
                    if (collected.length >= meta.k)
                        break;
                }
            }
        }
        if (collected.length < meta.k) {
            throw new Error(`Insufficient shards for ${key}: need ${meta.k}, got ${collected.length}`);
        }
        // Reconstruct
        const data = (0, erasure_1.rsDecode)(collected, meta.k, meta.n, meta.originalSize);
        return {
            data,
            key,
            shardsUsed: collected.length,
            shardsAvailable: meta.shardLocations.size,
            reconstructionMs: Date.now() - startTime,
        };
    }
    // ═══════════════════════════════════════
    // Delete
    // ═══════════════════════════════════════
    /**
     * Delete a key and all its shards from mesh memory.
     */
    deleteKey(key) {
        const meta = this.keyMeta.get(key);
        if (!meta)
            return false;
        // Remove local shards
        for (const [shardIndex, deviceId] of meta.shardLocations) {
            if (deviceId === this.transport.getLocalDeviceId()) {
                this.removeLocalShard(key, shardIndex);
            }
            // Note: remote shard cleanup would require transport messages
            // For now, they'll expire via TTL or be overwritten
        }
        this.keyMeta.delete(key);
        return true;
    }
    // ═══════════════════════════════════════
    // Local Shard Management
    // ═══════════════════════════════════════
    /**
     * Store a shard received from a peer (or from local write).
     * Called both internally and by the transport handler when a
     * SHARD_WRITE message arrives from another device.
     */
    storeLocalShard(descriptor) {
        const storeKey = `${descriptor.key}:${descriptor.shardIndex}`;
        // Check capacity
        if (this.localBytes + descriptor.data.length > this.config.maxContributionBytes) {
            // Try eviction
            if (!this.evict(descriptor.data.length)) {
                return false; // Cannot make room
            }
        }
        const existing = this.localShards.get(storeKey);
        if (existing) {
            this.localBytes -= existing.descriptor.data.length;
        }
        this.localShards.set(storeKey, {
            descriptor,
            accessCount: 0,
            lastAccessed: Date.now(),
        });
        this.localBytes += descriptor.data.length;
        return true;
    }
    /**
     * Retrieve a locally stored shard.
     */
    getLocalShard(key, shardIndex) {
        const storeKey = `${key}:${shardIndex}`;
        const shard = this.localShards.get(storeKey);
        if (!shard)
            return null;
        // Check TTL
        if (shard.descriptor.ttlMs > 0) {
            const expired = Date.now() > shard.descriptor.writtenAt + shard.descriptor.ttlMs;
            if (expired) {
                this.removeLocalShard(key, shardIndex);
                return null;
            }
        }
        shard.accessCount++;
        shard.lastAccessed = Date.now();
        return shard;
    }
    /**
     * Check if we have a local shard.
     */
    hasLocalShard(key, shardIndex) {
        return this.localShards.has(`${key}:${shardIndex}`);
    }
    /**
     * Get all locally stored shard keys.
     */
    getLocalKeys() {
        const keys = new Set();
        for (const shard of this.localShards.values()) {
            keys.add(shard.descriptor.key);
        }
        return Array.from(keys);
    }
    removeLocalShard(key, shardIndex) {
        const storeKey = `${key}:${shardIndex}`;
        const existing = this.localShards.get(storeKey);
        if (existing) {
            this.localBytes -= existing.descriptor.data.length;
            this.localShards.delete(storeKey);
        }
    }
    // ─── Eviction ───
    evict(neededBytes) {
        if (this.config.evictionPolicy === 'lru') {
            return this.evictLRU(neededBytes);
        }
        else if (this.config.evictionPolicy === 'lfu') {
            return this.evictLFU(neededBytes);
        }
        else {
            return this.evictTTL(neededBytes);
        }
    }
    evictLRU(neededBytes) {
        const entries = Array.from(this.localShards.entries())
            .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
        let freed = 0;
        for (const [storeKey, shard] of entries) {
            if (freed >= neededBytes)
                break;
            freed += shard.descriptor.data.length;
            this.localBytes -= shard.descriptor.data.length;
            this.localShards.delete(storeKey);
        }
        return freed >= neededBytes;
    }
    evictLFU(neededBytes) {
        const entries = Array.from(this.localShards.entries())
            .sort((a, b) => a[1].accessCount - b[1].accessCount);
        let freed = 0;
        for (const [storeKey, shard] of entries) {
            if (freed >= neededBytes)
                break;
            freed += shard.descriptor.data.length;
            this.localBytes -= shard.descriptor.data.length;
            this.localShards.delete(storeKey);
        }
        return freed >= neededBytes;
    }
    evictTTL(neededBytes) {
        const now = Date.now();
        let freed = 0;
        for (const [storeKey, shard] of this.localShards) {
            if (freed >= neededBytes)
                break;
            if (shard.descriptor.ttlMs > 0 && now > shard.descriptor.writtenAt + shard.descriptor.ttlMs) {
                freed += shard.descriptor.data.length;
                this.localBytes -= shard.descriptor.data.length;
                this.localShards.delete(storeKey);
            }
        }
        return freed >= neededBytes;
    }
    // ═══════════════════════════════════════
    // Stats
    // ═══════════════════════════════════════
    getStats() {
        const keys = new Set();
        for (const shard of this.localShards.values()) {
            keys.add(shard.descriptor.key);
        }
        let totalRedundancy = 0;
        let metaCount = 0;
        for (const meta of this.keyMeta.values()) {
            totalRedundancy += meta.n / meta.k;
            metaCount++;
        }
        return {
            totalKeys: keys.size,
            localShards: this.localShards.size,
            localBytes: this.localBytes,
            meshBytes: this.localBytes * (this.config.defaultRedundancy || 1.5), // estimate
            contributingDevices: this.transport.getPeers().length + 1,
            avgRedundancy: metaCount > 0 ? totalRedundancy / metaCount : 0,
        };
    }
    /**
     * Get metadata for a stored key.
     */
    getKeyMeta(key) {
        return this.keyMeta.get(key);
    }
    /**
     * Check if a key exists in mesh memory.
     */
    hasKey(key) {
        return this.keyMeta.has(key);
    }
    /**
     * Garbage collect expired shards.
     */
    gc() {
        const now = Date.now();
        let removed = 0;
        for (const [storeKey, shard] of this.localShards) {
            if (shard.descriptor.ttlMs > 0 && now > shard.descriptor.writtenAt + shard.descriptor.ttlMs) {
                this.localBytes -= shard.descriptor.data.length;
                this.localShards.delete(storeKey);
                removed++;
            }
        }
        // Also clean expired key meta
        for (const [key, meta] of this.keyMeta) {
            if (meta.ttlMs > 0 && now > meta.writtenAt + meta.ttlMs) {
                this.keyMeta.delete(key);
            }
        }
        return removed;
    }
}
exports.MeshMemory = MeshMemory;
//# sourceMappingURL=mesh-memory.js.map
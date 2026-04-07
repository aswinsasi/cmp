"use strict";
/**
 * CMP Code Cache
 * Content-addressed cache for WASM modules and ONNX models.
 * Modules are identified by their SHA-256 hash.
 *
 * @module runtime/code-cache
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeCache = void 0;
const src_1 = require("../../core/src");
const src_2 = require("../../core/src");
class CodeCache {
    /** hash hex → module bytes */
    cache = new Map();
    /** hash hex → last access timestamp (for LRU) */
    accessTimes = new Map();
    maxSizeMb;
    constructor(maxSizeMb = 100) {
        this.maxSizeMb = maxSizeMb;
    }
    /**
     * Check if a module exists in cache.
     */
    has(moduleHash) {
        return this.cache.has((0, src_2.toHex)(moduleHash));
    }
    /**
     * Get a module from cache by hash.
     */
    get(moduleHash) {
        const hex = (0, src_2.toHex)(moduleHash);
        const module = this.cache.get(hex);
        if (module) {
            this.accessTimes.set(hex, Date.now());
            return module;
        }
        return null;
    }
    /**
     * Store a module in cache. Returns its hash.
     */
    store(moduleBytes) {
        const moduleHash = (0, src_1.hash256)(moduleBytes);
        const hex = (0, src_2.toHex)(moduleHash);
        if (this.cache.has(hex))
            return moduleHash;
        // Evict LRU entries if over size limit
        while (this.currentSizeMb() + moduleBytes.length / (1024 * 1024) > this.maxSizeMb) {
            this.evictLRU();
            if (this.cache.size === 0)
                break;
        }
        this.cache.set(hex, moduleBytes);
        this.accessTimes.set(hex, Date.now());
        return moduleHash;
    }
    /**
     * Verify a module's integrity against its expected hash.
     */
    verify(expectedHash, moduleBytes) {
        const actualHash = (0, src_1.hash256)(moduleBytes);
        return (0, src_2.bytesEqual)(actualHash, expectedHash);
    }
    /**
     * Remove a specific module from cache.
     */
    remove(moduleHash) {
        const hex = (0, src_2.toHex)(moduleHash);
        this.accessTimes.delete(hex);
        return this.cache.delete(hex);
    }
    /**
     * Current cache size in MB.
     */
    currentSizeMb() {
        let total = 0;
        for (const bytes of this.cache.values()) {
            total += bytes.length;
        }
        return total / (1024 * 1024);
    }
    /**
     * Number of cached modules.
     */
    get size() {
        return this.cache.size;
    }
    /**
     * Clear all cached modules.
     */
    clear() {
        this.cache.clear();
        this.accessTimes.clear();
    }
    /**
     * Evict the least recently used entry.
     */
    evictLRU() {
        let oldestHex = '';
        let oldestTime = Infinity;
        for (const [hex, time] of this.accessTimes) {
            if (time < oldestTime) {
                oldestTime = time;
                oldestHex = hex;
            }
        }
        if (oldestHex) {
            this.cache.delete(oldestHex);
            this.accessTimes.delete(oldestHex);
        }
    }
}
exports.CodeCache = CodeCache;
//# sourceMappingURL=code-cache.js.map
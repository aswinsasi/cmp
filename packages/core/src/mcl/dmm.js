"use strict";
/**
 * CMP Distributed Mesh Memory (DMM)
 * Local MER storage with capacity management, eviction, and query ranking.
 *
 * Each device maintains a local MER store that participates in the
 * distributed mesh memory. MERs are stored locally and replicated
 * to peers via the DHT (handled by the Pollinator in Week 3).
 *
 * This module handles:
 *   - Local MER storage with capacity limits
 *   - Eviction policy (expired TTL → lowest confidence → oldest)
 *   - Query ranking (confidence 40%, generation 30%, recency 20%, similarity 10%)
 *   - Origin-based caps (max 50 MERs per origin mesh)
 *   - MER deduplication
 *
 * @module mcl/dmm
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERStore = exports.DEFAULT_MER_STORE_CONFIG = void 0;
const __1 = require("../");
const mcl_1 = require("../types/mcl");
const mer_1 = require("./mer");
const log = new __1.Logger('DMM');
// ── Query Ranking Weights ──
const RANK_WEIGHT_CONFIDENCE = 0.4;
const RANK_WEIGHT_GENERATION = 0.3;
const RANK_WEIGHT_RECENCY = 0.2;
const RANK_WEIGHT_SIMILARITY = 0.1;
/** Maximum age in days for recency scoring (older = 0 recency score) */
const MAX_RECENCY_DAYS = 90;
exports.DEFAULT_MER_STORE_CONFIG = {
    maxMers: mcl_1.MER_MAX_PER_DEVICE,
    maxPerOrigin: mcl_1.MER_MAX_PER_ORIGIN,
};
/**
 * Local MER Store — the device-side component of Distributed Mesh Memory.
 *
 * Stores MERs in memory with capacity management.
 * Thread-safe for single-threaded JS (no concurrent mutation).
 */
class MERStore {
    /** merId hex → CMP_MER */
    mers = new Map();
    config;
    persistence;
    constructor(config = {}) {
        this.config = { ...exports.DEFAULT_MER_STORE_CONFIG, ...config };
        this.persistence = this.config.persistence;
    }
    /**
     * Load MERs from persistence backend (if configured).
     * Call this after construction to restore saved MERs.
     */
    loadFromPersistence() {
        if (!this.persistence)
            return 0;
        const mers = this.persistence.loadAll();
        let loaded = 0;
        for (const mer of mers) {
            if (!(0, mer_1.isMERExpired)(mer)) {
                const hex = (0, __1.toHex)(mer.merId);
                if (!this.mers.has(hex)) {
                    this.mers.set(hex, mer);
                    loaded++;
                }
            }
        }
        log.info(`Loaded ${loaded} MERs from persistence (${mers.length - loaded} skipped/expired)`);
        return loaded;
    }
    /**
     * Set or replace the persistence backend.
     * Used for late-binding when persistence requires async init.
     */
    setPersistence(persistence) {
        this.persistence = persistence;
    }
    /**
     * Store a MER. Returns true if stored, false if rejected.
     *
     * Rejection reasons:
     *   - Duplicate (same merId already stored)
     *   - Expired TTL
     *   - Origin cap exceeded (>50 MERs from same origin mesh)
     *   - Capacity full and this MER has lower value than all stored MERs
     *
     * If capacity is full but this MER has higher value than the lowest,
     * the lowest-value MER is evicted to make room.
     */
    store(mer) {
        const merHex = (0, __1.toHex)(mer.merId);
        // Reject duplicates
        if (this.mers.has(merHex)) {
            log.debug(`MER ${merHex.substring(0, 8)} already stored, skipping`);
            return false;
        }
        // Reject expired
        if ((0, mer_1.isMERExpired)(mer)) {
            log.debug(`MER ${merHex.substring(0, 8)} expired, rejecting`);
            return false;
        }
        // Check origin cap
        const originHex = (0, __1.toHex)(mer.originMeshHash);
        const originCount = this.countByOrigin(originHex);
        if (originCount >= this.config.maxPerOrigin) {
            log.debug(`Origin ${originHex.substring(0, 8)} at cap (${originCount}), rejecting`);
            return false;
        }
        // Capacity check — evict if needed
        if (this.mers.size >= this.config.maxMers) {
            const evicted = this.evictOne();
            if (!evicted) {
                log.debug('Store full, could not evict, rejecting');
                return false;
            }
        }
        this.mers.set(merHex, mer);
        log.debug(`MER stored: ${merHex.substring(0, 8)} gen=${mer.generation} conf=${mer.confidence}`);
        // Persist to SQLite if configured
        if (this.persistence) {
            this.persistence.save(mer);
        }
        return true;
    }
    /**
     * Store a MER after verifying its signature.
     * Use this when receiving MERs from peers (untrusted source).
     *
     * @param mer - MER to store
     * @param publicKey - Ed25519 public key of the MER creator
     * @returns true if signature valid AND stored successfully
     */
    storeVerified(mer, publicKey) {
        if (!(0, mer_1.verifyMER)(mer, publicKey)) {
            log.warn(`MER ${(0, __1.toHex)(mer.merId).substring(0, 8)} signature invalid, rejecting`);
            return false;
        }
        return this.store(mer);
    }
    /**
     * Query MERs by task type, ranked by relevance.
     *
     * Ranking formula:
     *   score = confidence (40%) + generation (30%) + recency (20%) + similarity (10%)
     *
     * @param taskType - Task type to search for
     * @param meshSignature - Current mesh's capability signature (for similarity scoring)
     * @param maxResults - Maximum results to return (default: 10)
     * @returns Ranked array of MERs with scores
     */
    query(taskType, meshSignature, maxResults = 10) {
        const now = Date.now();
        const results = [];
        for (const mer of this.mers.values()) {
            // Filter by task type
            if (mer.taskType !== taskType)
                continue;
            // Skip expired (lazy cleanup)
            if ((0, mer_1.isMERExpired)(mer))
                continue;
            // Calculate ranking score
            const score = this.rankMER(mer, meshSignature, now);
            results.push({ mer, score });
        }
        // Sort by score descending
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, maxResults);
    }
    /**
     * Get all MERs (for profile building, export, etc.)
     */
    getAll() {
        return [...this.mers.values()];
    }
    /**
     * Get a specific MER by ID.
     */
    get(merId) {
        return this.mers.get((0, __1.toHex)(merId));
    }
    /**
     * Get MERs by their IDs (for MER_REQUEST responses).
     */
    getByIds(merIds) {
        const results = [];
        for (const id of merIds) {
            const mer = this.mers.get((0, __1.toHex)(id));
            if (mer && !(0, mer_1.isMERExpired)(mer)) {
                results.push(mer);
            }
        }
        return results;
    }
    /**
     * Get all MERs matching a task type (unranked).
     */
    getByTaskType(taskType) {
        return [...this.mers.values()].filter(m => m.taskType === taskType && !(0, mer_1.isMERExpired)(m));
    }
    /**
     * Check if the store has a MER with higher confidence than the given value
     * for a specific task type. Used to decide whether to accept offered MERs.
     */
    hasBetter(taskType, confidence) {
        for (const mer of this.mers.values()) {
            if (mer.taskType === taskType && mer.confidence > confidence && !(0, mer_1.isMERExpired)(mer)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Remove a specific MER by ID.
     */
    remove(merId) {
        const hex = (0, __1.toHex)(merId);
        const existed = this.mers.delete(hex);
        if (existed && this.persistence) {
            this.persistence.delete(hex);
        }
        return existed;
    }
    /**
     * Remove all expired MERs. Returns count removed.
     */
    purgeExpired() {
        let count = 0;
        const deletedIds = [];
        for (const [hex, mer] of this.mers) {
            if ((0, mer_1.isMERExpired)(mer)) {
                this.mers.delete(hex);
                deletedIds.push(hex);
                count++;
            }
        }
        if (count > 0) {
            if (this.persistence) {
                this.persistence.deleteMany(deletedIds);
            }
            log.info(`Purged ${count} expired MERs`);
        }
        return count;
    }
    /**
     * Get store size.
     */
    get size() {
        return this.mers.size;
    }
    /**
     * Check if store is empty.
     */
    get empty() {
        return this.mers.size === 0;
    }
    /**
     * Get count of distinct task types with experience.
     */
    get taskTypeCount() {
        const types = new Set();
        for (const mer of this.mers.values()) {
            if (!(0, mer_1.isMERExpired)(mer))
                types.add(mer.taskType);
        }
        return types.size;
    }
    /**
     * Get count of distinct origin meshes.
     */
    get originCount() {
        const origins = new Set();
        for (const mer of this.mers.values()) {
            origins.add((0, __1.toHex)(mer.originMeshHash));
        }
        return origins.size;
    }
    /**
     * Clear all MERs.
     */
    clear() {
        const ids = [...this.mers.keys()];
        this.mers.clear();
        if (this.persistence && ids.length > 0) {
            this.persistence.deleteMany(ids);
        }
    }
    // ── Eviction ──
    /**
     * Evict one MER to make room. Returns true if something was evicted.
     *
     * Eviction priority:
     *   1. Expired TTL (free cleanup)
     *   2. Lowest confidence
     *   3. Oldest creation date (tie-breaker)
     */
    evictOne() {
        // First pass: find any expired MER
        for (const [hex, mer] of this.mers) {
            if ((0, mer_1.isMERExpired)(mer)) {
                this.mers.delete(hex);
                if (this.persistence)
                    this.persistence.delete(hex);
                log.debug(`Evicted expired MER: ${hex.substring(0, 8)}`);
                return true;
            }
        }
        // Second pass: find lowest-value MER
        let worstHex = null;
        let worstScore = Infinity;
        for (const [hex, mer] of this.mers) {
            // Score: lower = more evictable
            // Weight confidence heavily, then recency
            const ageDays = (Date.now() - mer.createdAt) / (24 * 60 * 60 * 1000);
            const score = mer.confidence * 100 + mer.generation * 10 - ageDays;
            if (score < worstScore) {
                worstScore = score;
                worstHex = hex;
            }
        }
        if (worstHex) {
            this.mers.delete(worstHex);
            if (this.persistence)
                this.persistence.delete(worstHex);
            log.debug(`Evicted lowest-value MER: ${worstHex.substring(0, 8)} (score=${worstScore.toFixed(1)})`);
            return true;
        }
        return false;
    }
    // ── Ranking ──
    /**
     * Calculate ranking score for a MER (0-100).
     */
    rankMER(mer, meshSignature, now) {
        const timestamp = now ?? Date.now();
        // Confidence component (0-100, weight 40%)
        const confidenceScore = mer.confidence;
        // Generation component (0-100, weight 30%)
        // Higher generation = more evolved = more reliable
        const generationScore = Math.min(mer.generation * 10, 100);
        // Recency component (0-100, weight 20%)
        // Newer = higher score, linearly decaying over MAX_RECENCY_DAYS
        const ageDays = (timestamp - mer.createdAt) / (24 * 60 * 60 * 1000);
        const recencyScore = Math.max(0, 100 * (1 - ageDays / MAX_RECENCY_DAYS));
        // Similarity component (0-100, weight 10%)
        // How similar is the MER's mesh to our current mesh?
        let similarityScore = 50; // default: neutral
        if (meshSignature && meshSignature.length >= 8) {
            similarityScore = this.meshSimilarity(mer.meshSignature, meshSignature);
        }
        const score = confidenceScore * RANK_WEIGHT_CONFIDENCE +
            generationScore * RANK_WEIGHT_GENERATION +
            recencyScore * RANK_WEIGHT_RECENCY +
            similarityScore * RANK_WEIGHT_SIMILARITY;
        return Math.round(Math.max(0, Math.min(100, score)));
    }
    /**
     * Calculate similarity between two mesh signatures (0-100).
     * Uses hamming distance on the 8-byte LSH hashes.
     * Identical = 100, completely different = 0.
     */
    meshSimilarity(a, b) {
        const len = Math.min(a.length, b.length, 8);
        let matchingBits = 0;
        let totalBits = len * 8;
        for (let i = 0; i < len; i++) {
            let xor = a[i] ^ b[i];
            // Count matching bits (bits where XOR = 0)
            let diffBits = 0;
            while (xor) {
                diffBits += xor & 1;
                xor >>= 1;
            }
            matchingBits += 8 - diffBits;
        }
        return Math.round((matchingBits / totalBits) * 100);
    }
    // ── Helpers ──
    /**
     * Count MERs from a specific origin mesh.
     */
    countByOrigin(originHex) {
        let count = 0;
        for (const mer of this.mers.values()) {
            if ((0, __1.toHex)(mer.originMeshHash) === originHex)
                count++;
        }
        return count;
    }
}
exports.MERStore = MERStore;
//# sourceMappingURL=dmm.js.map
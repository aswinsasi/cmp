"use strict";
/**
 * CMP v1.3 — Speculative Distributor
 * Distributes speculative work for DreamScheduler predictions to idle peers.
 * Manages active speculations, handles ACK/RESULT/ABORT lifecycle.
 *
 * All speculative work is "soft-allocated" — can be aborted instantly
 * when a real task arrives and needs the resources.
 *
 * @module precognition/speculative-distributor
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeculativeDistributor = void 0;
const precognition_1 = require("../types/precognition");
const phantom_cache_1 = require("./phantom-cache");
// ── Helpers ──
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < n; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}
class SpeculativeDistributor {
    phantomCache;
    /** predictionId hex → active chunks */
    activeSpeculations = new Map();
    /** Total speculative CCU spent this cycle */
    ccuSpentThisCycle = 0;
    /** Send function injected from CMPNode */
    sendFn;
    /** Get idle peers function injected from CMPNode */
    getIdlePeersFn;
    constructor(phantomCache, sendFn, getIdlePeersFn) {
        this.phantomCache = phantomCache;
        this.sendFn = sendFn;
        this.getIdlePeersFn = getIdlePeersFn;
    }
    /**
     * Distribute speculative work for a prediction set.
     *
     * Algorithm:
     * 1. Filter predictions above minimum confidence threshold
     * 2. For each prediction (highest confidence first):
     *    a. Check if result already in PhantomCache → skip
     *    b. Find idle peers (CPU < 15%, accepting tasks, not throttled)
     *    c. Build speculative chunks (soft-allocation)
     *    d. Track in activeSpeculations map
     *    e. Deduct from speculative CCU budget
     *    f. Stop if budget exhausted
     */
    async distributeSpeculative(predictionSet) {
        this.ccuSpentThisCycle = 0;
        for (const prediction of predictionSet.predictions) {
            if (this.ccuSpentThisCycle >= predictionSet.speculativeBudget) {
                break; // Budget exhausted
            }
            if (prediction.confidence < 0.3)
                continue; // Too low confidence
            // Check if already cached
            const cacheKey = phantom_cache_1.PhantomCache.generateKey(prediction.moduleHash, prediction.inputFingerprint, String(prediction.taskType));
            if (this.phantomCache.has(cacheKey))
                continue;
            // Find idle peers
            const idlePeers = this.getIdlePeersFn().filter(p => p.cpuLoad < 0.15 &&
                p.acceptingTasks &&
                p.batteryPct > 20 &&
                !p.thermalThrottled);
            if (idlePeers.length === 0)
                continue;
            // Select best idle peer (lowest CPU load)
            const selectedPeer = idlePeers.sort((a, b) => a.cpuLoad - b.cpuLoad)[0];
            // Build speculative chunk
            const chunk = {
                predictionId: prediction.id,
                chunkId: randomBytes(16),
                taskId: randomBytes(16),
                executorId: selectedPeer.meshId,
                status: precognition_1.SpeculativeChunkStatus.QUEUED,
                softAllocation: true,
                startedAt: Date.now(),
            };
            // Track
            const pidHex = toHex(prediction.id);
            if (!this.activeSpeculations.has(pidHex)) {
                this.activeSpeculations.set(pidHex, []);
            }
            this.activeSpeculations.get(pidHex).push(chunk);
            // Deduct from budget (1 CCU per speculative chunk — conservative)
            this.ccuSpentThisCycle += 1;
            // Send SPECULATIVE_OFFER (0x80)
            try {
                const payload = this.encodeSpeculativeOffer(prediction, chunk);
                await this.sendFn(selectedPeer.meshId, 0x80, payload);
                chunk.status = precognition_1.SpeculativeChunkStatus.QUEUED;
            }
            catch {
                chunk.status = precognition_1.SpeculativeChunkStatus.ABORTED;
            }
        }
    }
    /**
     * Handle SPECULATIVE_ACK from peer.
     */
    handleSpeculativeAck(peerId, predictionId, chunkId, accepted) {
        const pidHex = toHex(predictionId);
        const cidHex = toHex(chunkId);
        const chunks = this.activeSpeculations.get(pidHex);
        if (!chunks)
            return;
        const chunk = chunks.find(c => toHex(c.chunkId) === cidHex);
        if (!chunk)
            return;
        if (accepted) {
            chunk.status = precognition_1.SpeculativeChunkStatus.EXECUTING;
        }
        else {
            chunk.status = precognition_1.SpeculativeChunkStatus.ABORTED;
        }
    }
    /**
     * Handle SPECULATIVE_RESULT from peer.
     * Stores result in PhantomCache.
     */
    handleSpeculativeResult(peerId, predictionId, chunkId, resultHash, resultData, executionTimeMs) {
        const pidHex = toHex(predictionId);
        const cidHex = toHex(chunkId);
        const chunks = this.activeSpeculations.get(pidHex);
        if (!chunks)
            return;
        const chunk = chunks.find(c => toHex(c.chunkId) === cidHex);
        if (!chunk)
            return;
        chunk.status = precognition_1.SpeculativeChunkStatus.COMPLETED;
        chunk.completedAt = Date.now();
        // Find the prediction to get cache key parameters
        // We store moduleHash/inputFingerprint in the chunk's task context
        // For now, use prediction ID as part of the cache key
        const cacheKey = `speculative:${pidHex}`;
        this.phantomCache.store({
            cacheKey,
            resultData,
            resultHash,
            confidence: 0.7, // Default speculative confidence
            ttlMs: 300000, // 5 minutes
            cachedAt: Date.now(),
            predictionId,
            executorIds: [peerId],
            hitCount: 0,
        });
    }
    /**
     * Abort all speculative work for a prediction.
     * Sends SPECULATIVE_ABORT to all executing peers.
     */
    async abortPrediction(predictionId, reason) {
        const pidHex = toHex(predictionId);
        const chunks = this.activeSpeculations.get(pidHex);
        if (!chunks)
            return;
        const abortPayload = this.encodeSpeculativeAbort(predictionId, reason);
        for (const chunk of chunks) {
            if (chunk.status === precognition_1.SpeculativeChunkStatus.QUEUED ||
                chunk.status === precognition_1.SpeculativeChunkStatus.EXECUTING) {
                chunk.status = precognition_1.SpeculativeChunkStatus.ABORTED;
                try {
                    await this.sendFn(chunk.executorId, 0x83, abortPayload);
                }
                catch { }
            }
        }
        this.activeSpeculations.delete(pidHex);
    }
    /**
     * Abort ALL speculative work immediately.
     * Called when the device becomes busy with real tasks.
     */
    async abortAll() {
        for (const [pidHex, chunks] of this.activeSpeculations) {
            const predictionId = this.hexToBytes(pidHex);
            await this.abortPrediction(predictionId, precognition_1.SpeculativeAbortReason.RESOURCE_NEEDED);
        }
        this.activeSpeculations.clear();
    }
    /** Get active speculation count */
    getActiveCount() {
        let count = 0;
        for (const chunks of this.activeSpeculations.values()) {
            count += chunks.filter(c => c.status === precognition_1.SpeculativeChunkStatus.QUEUED ||
                c.status === precognition_1.SpeculativeChunkStatus.EXECUTING).length;
        }
        return count;
    }
    /** Get all active speculations (for CLI) */
    getActiveSpeculations() {
        return new Map(this.activeSpeculations);
    }
    /** Get CCU spent this cycle */
    getCcuSpent() {
        return this.ccuSpentThisCycle;
    }
    // ── Wire Protocol Encoding ──
    encodeSpeculativeOffer(prediction, chunk) {
        // Simplified encoding — in production would use proper binary format
        const data = {
            predictionId: Array.from(prediction.id),
            chunkId: Array.from(chunk.chunkId),
            moduleHash: Array.from(prediction.moduleHash),
            taskType: prediction.taskType,
            confidence: prediction.confidence,
        };
        return new TextEncoder().encode(JSON.stringify(data));
    }
    encodeSpeculativeAbort(predictionId, reason) {
        const data = {
            predictionId: Array.from(predictionId),
            reason,
        };
        return new TextEncoder().encode(JSON.stringify(data));
    }
    hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
    }
}
exports.SpeculativeDistributor = SpeculativeDistributor;
//# sourceMappingURL=speculative-distributor.js.map
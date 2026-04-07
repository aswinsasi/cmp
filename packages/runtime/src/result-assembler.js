"use strict";
/**
 * CMP Result Assembler
 * Layer 6: Collects chunk results, verifies correctness,
 * and reassembles the final task output.
 *
 * @module runtime/result-assembler
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultAssembler = void 0;
const src_1 = require("../../core/src");
const data_splitter_1 = require("./data-splitter");
const log = new src_1.Logger('Assembler');
class ResultAssembler {
    /** chunkId hex → results (may have multiple for redundant execution) */
    results = new Map();
    plan;
    sessionKey;
    startTime;
    splitter = new data_splitter_1.DataSplitter();
    constructor(plan, sessionKey) {
        this.plan = plan;
        this.sessionKey = sessionKey;
        this.startTime = Date.now();
    }
    /**
     * Submit a chunk result. Returns TaskCompletion if all chunks are done.
     */
    collectResult(result) {
        const chunkHex = (0, src_1.toHex)(result.chunkId);
        if (!this.results.has(chunkHex)) {
            this.results.set(chunkHex, []);
        }
        this.results.get(chunkHex).push(result);
        log.debug(`Result collected for chunk ${(0, src_1.shortId)(result.chunkId)}: ${src_1.ChunkStatus[result.status]}`, {
            executorId: (0, src_1.shortId)(result.executorId),
            timeMs: result.executionTimeMs,
        });
        if (this.isComplete()) {
            return this.assemble();
        }
        return null;
    }
    /**
     * Check if all chunks have at least one successful result.
     */
    isComplete() {
        for (const chunk of this.plan.chunks) {
            const chunkHex = (0, src_1.toHex)(chunk.chunkId);
            const results = this.results.get(chunkHex) || [];
            const hasSuccess = results.some((r) => r.status === src_1.ChunkStatus.SUCCESS);
            if (!hasSuccess)
                return false;
        }
        return true;
    }
    /**
     * Get count of collected results.
     */
    getCollectedCount() {
        let count = 0;
        for (const results of this.results.values()) {
            count += results.length;
        }
        return count;
    }
    /**
     * Get count of chunks still pending.
     */
    getPendingCount() {
        let pending = 0;
        for (const chunk of this.plan.chunks) {
            const chunkHex = (0, src_1.toHex)(chunk.chunkId);
            const results = this.results.get(chunkHex) || [];
            const hasSuccess = results.some((r) => r.status === src_1.ChunkStatus.SUCCESS);
            if (!hasSuccess)
                pending++;
        }
        return pending;
    }
    /**
     * Get list of failed chunk IDs.
     */
    getFailedChunks() {
        const failed = [];
        for (const chunk of this.plan.chunks) {
            const chunkHex = (0, src_1.toHex)(chunk.chunkId);
            const results = this.results.get(chunkHex) || [];
            const allFailed = results.length > 0 && results.every((r) => r.status !== src_1.ChunkStatus.SUCCESS);
            if (allFailed)
                failed.push(chunk.chunkId);
        }
        return failed;
    }
    /**
     * Assemble all results into final task output.
     */
    assemble() {
        // Sort chunks by sequence
        const ordered = [...this.plan.chunks].sort((a, b) => a.sequence - b.sequence);
        // Select best result for each chunk (with verification)
        const selectedResults = [];
        let verifyResult = { valid: true, confidence: 1.0 };
        for (const chunk of ordered) {
            const chunkHex = (0, src_1.toHex)(chunk.chunkId);
            const chunkResults = this.results.get(chunkHex) || [];
            const successResults = chunkResults.filter((r) => r.status === src_1.ChunkStatus.SUCCESS);
            if (successResults.length === 0) {
                // Should not happen if isComplete() was true, but handle gracefully
                verifyResult = { valid: false, confidence: 0, reason: `No success result for chunk ${(0, src_1.shortId)(chunk.chunkId)}` };
                continue;
            }
            // If redundant execution, verify consistency
            if (successResults.length >= 2) {
                const vr = this.verifyRedundant(successResults);
                if (!vr.valid) {
                    verifyResult = vr;
                }
            }
            selectedResults.push(successResults[0]);
        }
        // Decrypt all results
        const decryptedChunks = [];
        for (const result of selectedResults) {
            try {
                const decrypted = (0, src_1.decrypt)(result.payload, this.sessionKey);
                decryptedChunks.push(decrypted);
            }
            catch {
                // Try raw (unencrypted) payload
                decryptedChunks.push(result.payload);
            }
        }
        // Merge based on strategy
        const assembled = this.mergeByStrategy(decryptedChunks);
        const totalTimeMs = Date.now() - this.startTime;
        const devicesUsed = new Set(selectedResults.map((r) => (0, src_1.toHex)(r.executorId))).size;
        log.info(`Task assembled: ${decryptedChunks.length} chunks, ${devicesUsed} devices, ${totalTimeMs}ms`);
        return {
            taskId: this.plan.chunks[0]?.taskId || new Uint8Array(16),
            result: assembled,
            totalTimeMs,
            chunksExecuted: selectedResults.length,
            devicesUsed,
            verificationType: this.plan.redundancy > 1 ? 'REDUNDANT' : 'NONE',
            verificationResult: verifyResult,
        };
    }
    /**
     * Verify redundant execution results via majority voting.
     */
    verifyRedundant(results) {
        // Hash each result's payload
        const hashCounts = new Map();
        for (const result of results) {
            const h = (0, src_1.toHex)((0, src_1.hash256)(result.payload));
            hashCounts.set(h, (hashCounts.get(h) || 0) + 1);
        }
        // Find majority
        let maxCount = 0;
        let majorityHash = '';
        for (const [h, count] of hashCounts) {
            if (count > maxCount) {
                maxCount = count;
                majorityHash = h;
            }
        }
        const confidence = maxCount / results.length;
        const valid = confidence > 0.5;
        if (!valid) {
            log.warn('Redundant verification failed: no majority consensus', {
                results: results.length,
                uniqueHashes: hashCounts.size,
            });
        }
        return { valid, confidence, majorityHash };
    }
    /**
     * Merge chunks based on the decomposition strategy.
     */
    mergeByStrategy(chunks) {
        if (chunks.length === 0)
            return new Uint8Array(0);
        switch (this.plan.strategy) {
            case src_1.TaskType.MAP_REDUCE:
            case src_1.TaskType.CUSTOM:
            case src_1.TaskType.INFERENCE:
                // Concatenate in order
                return this.splitter.reassembleParallel(chunks);
            case src_1.TaskType.PIPELINE:
                // Pipeline: final stage output is the result
                return chunks[chunks.length - 1];
            case src_1.TaskType.SCATTER_GATHER:
                // Scatter-gather: return all results concatenated
                // (application layer decides how to use multiple results)
                return this.splitter.reassembleParallel(chunks);
            default:
                return this.splitter.reassembleParallel(chunks);
        }
    }
    /**
     * Reset the assembler for reuse.
     */
    reset() {
        this.results.clear();
        this.startTime = Date.now();
    }
    /**
     * Get all collected results (for certification).
     * Returns a map of chunkId hex → array of CMPResults from all executors.
     */
    getAllResults() {
        return new Map(this.results);
    }
}
exports.ResultAssembler = ResultAssembler;
//# sourceMappingURL=result-assembler.js.map
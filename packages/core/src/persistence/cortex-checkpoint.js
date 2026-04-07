"use strict";
/**
 * CMP v4.0 — Cortex Checkpoint
 *
 * Higher-level checkpoint orchestrator for Cortex L14 model partitions.
 * Wraps V3StateStore's cortex checkpoint API with:
 *   - Model partition splitting & reassembly
 *   - Integrity verification (hash before/after)
 *   - Restore validation
 *   - Checkpoint metadata tracking
 *
 * Interface-driven: Cortex L14 implements ICortexCheckpointable
 * and this module handles the persistence mechanics.
 *
 * @module persistence/cortex-checkpoint
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CortexCheckpointManager = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('CortexCkpt');
// ─── Hex/Hash Helpers ───
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Simple FNV-1a hash for integrity checks.
 * Not cryptographic — just for detecting corruption.
 */
function fnv1a(data) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
        hash ^= data[i];
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
// ─── Cortex Checkpoint Manager ───
class CortexCheckpointManager {
    store;
    constructor(store) {
        this.store = store;
    }
    /**
     * Checkpoint an entire model — iterates all partitions,
     * exports weights, computes integrity hashes, saves to SQLite.
     */
    checkpoint(model) {
        const startMs = Date.now();
        const modelId = model.getModelId();
        const partitionCount = model.getPartitionCount();
        const hashes = [];
        let totalBytes = 0;
        log.info(`Checkpointing model ${modelId} (${partitionCount} partitions)...`);
        for (let i = 0; i < partitionCount; i++) {
            const { layerRange, weights } = model.exportPartition(i);
            const hash = fnv1a(weights);
            hashes.push(hash);
            totalBytes += weights.length;
            const manifest = {
                modelId,
                modelName: model.getModelName(),
                totalLayers: model.getTotalLayers(),
                totalParams: model.getTotalParams(),
                partitionCount,
                layerRange,
                dtype: model.getDtype(),
                checkpointedAt: Date.now(),
            };
            this.store.checkpointModel(modelId, i, manifest, weights);
        }
        // Save integrity hashes as state metadata
        this.store.saveState('cortex', `integrity:${modelId}`, {
            hashes,
            partitionCount,
            totalBytes,
            checkpointedAt: Date.now(),
        });
        const durationMs = Date.now() - startMs;
        log.info(`Checkpointed ${modelId}: ${partitionCount} partitions, ${(totalBytes / 1024).toFixed(1)} KB in ${durationMs}ms`);
        return { modelId, partitionsSaved: partitionCount, totalBytes, durationMs, integrityHashes: hashes };
    }
    /**
     * Restore a model from checkpoint — loads all partitions,
     * verifies integrity, imports weights into the model.
     */
    restore(model) {
        const startMs = Date.now();
        const modelId = model.getModelId();
        log.info(`Restoring model ${modelId}...`);
        // Load integrity metadata
        const integrity = this.store.loadState('cortex', `integrity:${modelId}`);
        // Load checkpoints
        const checkpoints = this.store.restoreModel(modelId);
        if (checkpoints.length === 0) {
            log.warn(`No checkpoint found for model ${modelId}`);
            return { modelId, partitionsRestored: 0, totalBytes: 0, durationMs: Date.now() - startMs, integrityValid: false };
        }
        let totalBytes = 0;
        let integrityValid = true;
        for (const ckpt of checkpoints) {
            // Verify integrity if we have hashes
            if (integrity && integrity.hashes[ckpt.partitionId]) {
                const expectedHash = integrity.hashes[ckpt.partitionId];
                const actualHash = fnv1a(ckpt.weights);
                if (actualHash !== expectedHash) {
                    log.warn(`Integrity check failed for ${modelId} partition ${ckpt.partitionId}: expected ${expectedHash}, got ${actualHash}`);
                    integrityValid = false;
                }
            }
            model.importPartition(ckpt.partitionId, ckpt.weights, ckpt.manifest);
            totalBytes += ckpt.weights.length;
        }
        const durationMs = Date.now() - startMs;
        log.info(`Restored ${modelId}: ${checkpoints.length} partitions, ${(totalBytes / 1024).toFixed(1)} KB in ${durationMs}ms (integrity: ${integrityValid ? 'OK' : 'FAILED'})`);
        return { modelId, partitionsRestored: checkpoints.length, totalBytes, durationMs, integrityValid };
    }
    /**
     * Check if a model has a saved checkpoint.
     */
    hasCheckpoint(modelId) {
        const checkpoints = this.store.restoreModel(modelId);
        return checkpoints.length > 0;
    }
    /**
     * List all checkpointed models with metadata.
     */
    listCheckpoints() {
        const models = this.store.listModels();
        return models.map(m => {
            // Get first partition manifest for model name
            const ckpts = this.store.restoreModel(m.modelId);
            const manifest = ckpts.length > 0 ? ckpts[0].manifest : null;
            const integrity = this.store.loadState('cortex', `integrity:${m.modelId}`);
            return {
                modelId: m.modelId,
                modelName: manifest?.modelName ?? 'unknown',
                partitions: m.partitions,
                totalBytes: m.totalBytes,
                checkpointedAt: manifest?.checkpointedAt ?? 0,
                integrityHashCount: integrity?.hashes?.length ?? 0,
            };
        });
    }
    /**
     * Delete a model checkpoint.
     */
    deleteCheckpoint(modelId) {
        this.store.deleteModel(modelId);
        this.store.deleteState('cortex', `integrity:${modelId}`);
        log.info(`Deleted checkpoint for model ${modelId}`);
    }
    /**
     * Verify a checkpoint's integrity without restoring it.
     */
    verifyCheckpoint(modelId) {
        const integrity = this.store.loadState('cortex', `integrity:${modelId}`);
        const checkpoints = this.store.restoreModel(modelId);
        const errors = [];
        if (checkpoints.length === 0) {
            return { valid: false, partitions: 0, errors: ['No checkpoint data found'] };
        }
        if (!integrity) {
            return { valid: false, partitions: checkpoints.length, errors: ['No integrity metadata found'] };
        }
        if (checkpoints.length !== integrity.partitionCount) {
            errors.push(`Expected ${integrity.partitionCount} partitions, found ${checkpoints.length}`);
        }
        for (const ckpt of checkpoints) {
            if (integrity.hashes[ckpt.partitionId]) {
                const actual = fnv1a(ckpt.weights);
                if (actual !== integrity.hashes[ckpt.partitionId]) {
                    errors.push(`Partition ${ckpt.partitionId}: hash mismatch (expected ${integrity.hashes[ckpt.partitionId]}, got ${actual})`);
                }
            }
        }
        return { valid: errors.length === 0, partitions: checkpoints.length, errors };
    }
}
exports.CortexCheckpointManager = CortexCheckpointManager;
//# sourceMappingURL=cortex-checkpoint.js.map